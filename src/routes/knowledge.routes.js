const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const db = require('../../data/db');
const { processIncomingMessage, AGENT_PROMPTS } = require('../../ai/engine');
const admin = require('firebase-admin');
const bucket = admin.storage().bucket();

const { upload, uploadTraining } = require('../middlewares/upload.middleware');
const whatsappService = require('../services/whatsapp.service');
const { formatTime } = require('../utils/helpers');

const router = express.Router();

// ─── ROUTES: Knowledge Base (AI Training) ────────────────────────────────────

let pdfParse;
try { pdfParse = require('pdf-parse'); } catch(e) { pdfParse = null; }
const { parse: csvParse } = require('csv-parse/sync');

router.get('/agents/:id/knowledge', async (req, res) => {
    const agentId = parseInt(req.params.id);
    const knowledge = await db.getKnowledgeByAgent(agentId);
    res.json(knowledge);
});

router.post('/agents/:id/knowledge/upload', uploadTraining.single('file'), async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const agent = await db.getAgentConfigById(agentId);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const fileType = req.file.mimetype === 'application/pdf' ? 'pdf' : 'csv';
        const fileName = req.file.originalname;
        const ext = path.extname(fileName) || (fileType === 'pdf' ? '.pdf' : '.csv');
        const storageFilename = `training_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
        
        // Upload to Firebase Storage
        const fileObj = bucket.file(`training/${storageFilename}`);
        await fileObj.save(req.file.buffer, {
            metadata: { contentType: req.file.mimetype }
        });
        
        const filePath = `gs://${bucket.name}/training/${storageFilename}`;

        let content = '';
        let recordCount = 0;

        if (fileType === 'pdf') {
            if (!pdfParse) throw new Error('pdf-parse module not available');
            const pdfData = await pdfParse(req.file.buffer);
            content = pdfData.text.substring(0, 100000);
            recordCount = pdfData.numpages || 1;
        } else {
            const csvContent = req.file.buffer.toString('utf-8');
            const records = csvParse(csvContent, { columns: true, skip_empty_lines: true });
            content = csvContent.substring(0, 100000);
            recordCount = records.length || 0;
        }

        const knowledge = await db.addKnowledge({
            agent_id: agentId,
            type: fileType,
            name: fileName,
            file_path: filePath,
            content: content,
            record_count: recordCount,
        });

        res.status(201).json(knowledge);
    } catch (err) {
        console.error('[Knowledge Upload Error]', err);
        res.status(500).json({ error: 'Failed to process file: ' + err.message });
    }
});

router.post('/agents/:id/knowledge/google-sheet', async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const { sheet_url, credentials, sheet_name } = req.body;

        if (!sheet_url || !credentials) {
            return res.status(400).json({ error: 'sheet_url and credentials are required' });
        }

        const agent = await db.getAgentConfigById(agentId);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const sheetId = sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1] || sheet_url;

        const knowledge = await db.addKnowledge({
            agent_id: agentId,
            type: 'google_sheet',
            name: sheet_name || `Google Sheet (${sheetId})`,
            sheet_id: sheetId,
            sheet_url: sheet_url,
            credentials: credentials,
            record_count: 0,
        });

        res.status(201).json(knowledge);
    } catch (err) {
        console.error('[Google Sheet Error]', err);
        res.status(500).json({ error: 'Failed to add Google Sheet: ' + err.message });
    }
});

router.get('/knowledge/:kid/sync', async (req, res) => {
    try {
        const kid = parseInt(req.params.kid);
        const knowledge = await db.getKnowledgeById(kid);

        if (!knowledge) {
            return res.status(404).json({ error: 'Knowledge entry not found' });
        }

        if (knowledge.type === 'google_sheet') {
            try {
                const creds = JSON.parse(knowledge.credentials);
                const response = await axios.get(
                    `https://sheets.googleapis.com/v4/spreadsheets/${knowledge.sheet_id}/values/${knowledge.sheet_name || 'Sheet1'}?key=${process.env.GOOGLE_SHEETS_API_KEY}`,
                    { headers: { Authorization: `Bearer ${creds.access_token}` } }
                );

                const rows = response.data.values || [];
                const content = rows.map(r => r.join(', ')).join('\n');

                await db.updateKnowledge(kid, {
                    content: content.substring(0, 100000),
                    last_synced: new Date().toISOString(),
                    record_count: rows.length,
                });

                res.json({ success: true, record_count: rows.length });
            } catch (sheetErr) {
                res.status(500).json({ error: 'Failed to sync sheet: ' + sheetErr.message });
            }
        } else {
            res.json({ success: true, message: 'File-based knowledge does not need sync' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/knowledge/:kid/write-sheet', async (req, res) => {
    try {
        const kid = parseInt(req.params.kid);
        const { range, values } = req.body;
        const knowledge = await db.getKnowledgeById(kid);

        if (!knowledge || knowledge.type !== 'google_sheet') {
            return res.status(404).json({ error: 'Google Sheet knowledge entry not found' });
        }

        if (!range || !values) {
            return res.status(400).json({ error: 'range and values are required' });
        }

        const creds = JSON.parse(knowledge.credentials);
        const response = await axios.post(
            `https://sheets.googleapis.com/v4/spreadsheets/${knowledge.sheet_id}/values/${range}:append?valueInputOption=RAW`,
            { values: [values.split(',').map(v => v.trim())] },
            { headers: { Authorization: `Bearer ${creds.access_token}` } }
        );

        res.json({ success: true, updates: response.data.updates });
    } catch (err) {
        res.status(500).json({ error: 'Failed to write to sheet: ' + err.message });
    }
});

router.delete('/knowledge/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const knowledge = await db.getKnowledgeById(id);
    if (!knowledge) {
        return res.status(404).json({ error: 'Knowledge entry not found' });
    }

    // Files are stored in Firebase Storage, not local disk
    await db.deleteKnowledge(id);
    res.json({ success: true });
});

module.exports = router;
