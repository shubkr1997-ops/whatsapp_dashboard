const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// 1. Make all Express route handlers async
// app.get('/path', (req, res) => { ... })  => app.get('/path', async (req, res) => { ... })
code = code.replace(/app\.(get|post|put|delete)\(([^,]+),\s*(?:upload[\w\.]*\([^)]*\),\s*)?(req,\s*res)\s*=>\s*\{/g, (match, method, path, args, offset, str) => {
    // If it's already async, skip
    const before = str.slice(Math.max(0, offset - 10), offset);
    if (before.includes('async')) return match;
    
    return match.replace(args + ' =>', 'async ' + args + ' =>');
});

// Same for app.post with upload middleware:
// app.post('/api/contacts/:id/upload', upload.single('file'), (req, res) => {
code = code.replace(/app\.(get|post|put|delete)\(([^,]+),\s*([^,]+),\s*(req,\s*res)\s*=>\s*\{/g, (match, method, path, mid, args, offset, str) => {
    const before = str.slice(Math.max(0, offset - 10), offset);
    if (before.includes('async')) return match;
    return match.replace(args + ' =>', 'async ' + args + ' =>');
});

// 2. Add await to all db.* calls
// db.getAllContacts() => await db.getAllContacts()
// Prevent double await: await await db...
code = code.replace(/([^\w])db\.([a-zA-Z0-9_]+)\(/g, (match, prefix, method, offset, str) => {
    const before = str.slice(Math.max(0, offset - 10), offset);
    if (before.match(/\bawait\s*$/)) return match; // already has await
    
    // Add await
    return prefix + 'await db.' + method + '(';
});

// 3. Remove socket.io initialization and logic since it won't work in Serverless
// We'll comment out the io.on('connection') block
code = code.replace(/io\.on\('connection',([\s\S]*?)\}\);/g, '/* Socket.io removed for Firebase Serverless */');

// Remove io.emit and io.to.emit calls
code = code.replace(/io\.to\([^)]*\)\.emit\([^)]*\);?/g, '/* io.to.emit removed */');
code = code.replace(/io\.emit\([^)]*\);?/g, '/* io.emit removed */');

// 4. Update the export for Firebase Functions
// Replace `server.listen(...)` with Firebase export
code = code.replace(/server\.listen\([\s\S]*$/, `
const functions = require('firebase-functions/v2');
exports.api = functions.https.onRequest(app);
`);

// 5. Update multer for Firebase Storage (use memory storage)
code = code.replace(/multer\.diskStorage\(\{[\s\S]*?\}\)/g, 'multer.memoryStorage()');

fs.writeFileSync('server.js', code);
console.log('Refactoring complete');
