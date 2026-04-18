const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Replace downloadWhatsAppMedia body
const downloadWhatsAppMediaRegex = /async function downloadWhatsAppMedia\(mediaId\) \{[\s\S]*?return \{ localUrl: `\/uploads\/\$\{filename\}`, mimeType \};\n\}/;
const newDownloadFn = `async function downloadWhatsAppMedia(mediaId) {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN;
    if (!accessToken) return null;

    // Step 1: Get the media URL from Meta
    const metaUrl = \`https://graph.facebook.com/v20.0/\${mediaId}\`;
    const metaRes = await axios.get(metaUrl, {
        headers: { Authorization: \`Bearer \${accessToken}\` },
    });
    const mediaUrl = metaRes.data.url;
    const mimeType = metaRes.data.mime_type || 'image/jpeg';

    // Step 2: Download the actual file
    const fileRes = await axios.get(mediaUrl, {
        headers: { Authorization: \`Bearer \${accessToken}\` },
        responseType: 'arraybuffer',
    });

    // Step 3: Save to Firebase Storage
    const ext = mimeType.split('/')[1] || 'jpg';
    const filename = \`wa_\${mediaId}_\${Date.now()}.\${ext}\`;
    
    const file = bucket.file(\`uploads/\${filename}\`);
    await file.save(Buffer.from(fileRes.data), {
        metadata: { contentType: mimeType }
    });
    // Make public so WhatsApp can potentially access it, although incoming might not need it public
    await file.makePublic();

    const publicUrl = \`https://storage.googleapis.com/\${bucket.name}/uploads/\${filename}\`;

    return { localUrl: publicUrl, mimeType };
}`;

code = code.replace(downloadWhatsAppMediaRegex, newDownloadFn);

// Replace /api/contacts/:id/upload route file handling
// From: const localUrl = `/uploads/${req.file.filename}`;
// To: Firebase Storage upload
const oldContactUploadRegex = /app\.post\('\/api\/contacts\/:id\/upload', upload\.single\('file'\), async \(req, res\) => \{[\s\S]*?const localUrl = `\/uploads\/\$\{req\.file\.filename\}`;/g;

code = code.replace(oldContactUploadRegex, `app.post('/api/contacts/:id/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const id = req.params.id;
    const caption = req.body.caption || '';
    const contact = await db.getContactById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Upload to Firebase Storage
    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = \`media_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\${ext}\`;
    const file = bucket.file(\`uploads/\${filename}\`);
    
    await file.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype }
    });
    await file.makePublic();
    
    const localUrl = \`https://storage.googleapis.com/\${bucket.name}/uploads/\${filename}\`;`);

// Remove "const publicBase... publicUrl" formatting since `localUrl` is now the full URL
code = code.replace(/const publicBase = process\.env\.PUBLIC_URL \|\| \`\$\{req\.protocol\}:\/\/\$\{req\.get\('host'\)\}\`;\n\s*const publicUrl = publicBase \+ localUrl;/g, 'const publicUrl = localUrl;');

// Replace /api/agents/:id/knowledge/upload route file handling
const oldKnowledgeUploadRegex = /app\.post\('\/api\/agents\/:id\/knowledge\/upload', uploadTraining\.single\('file'\), async \(req, res\) => \{[\s\S]*?const filePath = path\.join\(TRAINING_DIR, req\.file\.filename\);/g;

code = code.replace(oldKnowledgeUploadRegex, `app.post('/api/agents/:id/knowledge/upload', uploadTraining.single('file'), async (req, res) => {
    try {
        const agentId = req.params.id;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Save to Firebase Storage
        const ext = path.extname(req.file.originalname) || '.pdf';
        const filename = \`training_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\${ext}\`;
        const file = bucket.file(\`training/\${filename}\`);
        
        await file.save(req.file.buffer, {
            metadata: { contentType: req.file.mimetype }
        });
        
        const filePath = \`gs://\${bucket.name}/training/\${filename}\`;
        
        // Write a temporary file for parsing (since pdf-parse needs a file buffer or stream, 
        // we can actually just pass req.file.buffer directly to pdf-parse!)
`);

// Since pdf-parse and csv-parse can use buffer directly:
// Remove fs.readFileSync(filePath) for pdf-parse
code = code.replace(/const dataBuffer = fs\.readFileSync\(filePath\);\n\s*const pdfData = await pdfParse\(dataBuffer\);/g, 'const pdfData = await pdfParse(req.file.buffer);');

// Replace fs.createReadStream(filePath) with parsing buffer directly for CSV
const csvParseRegex = /return new Promise\(\(resolve, reject\) => \{\n\s*const results = \[\];\n\s*fs\.createReadStream\(filePath\)[\s\S]*?\}\);/g;
code = code.replace(csvParseRegex, `return new Promise((resolve, reject) => {
            const { parse } = require('csv-parse'); // Ensure parse is required
            const results = [];
            parse(req.file.buffer, {
                columns: true,
                skip_empty_lines: true
            })
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
        });`);

fs.writeFileSync('server.js', code);
