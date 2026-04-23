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

// ─── ROUTES: MCP Servers (Tools) ──────────────────────────────────────────────

router.get('/agents/:id/mcp_servers', async (req, res) => {
    const agentId = parseInt(req.params.id);
    const servers = await db.getMcpServersByAgent(agentId);
    res.json(servers);
});

router.post('/agents/:id/mcp_servers/google-sheet', async (req, res) => {
    try {
        const agentId = parseInt(req.params.id);
        const { name, sheet_url, credentials, allow_read, allow_write } = req.body;

        if (!sheet_url || !credentials) {
            return res.status(400).json({ error: 'sheet_url and credentials are required' });
        }

        const agent = await db.getAgentConfigById(agentId);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const config_json = JSON.stringify({
            sheet_url,
            credentials,
            allow_read: !!allow_read,
            allow_write: !!allow_write
        });

        const server = await db.addMcpServer({
            agent_config_id: agentId,
            type: 'google_sheet',
            name: name || 'Google Sheets',
            config_json
        });

        res.status(201).json(server);
    } catch (err) {
        console.error('[MCP Google Sheet Error]', err);
        res.status(500).json({ error: 'Failed to add MCP Google Sheet: ' + err.message });
    }
});

router.delete('/mcp_servers/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const server = await db.getMcpServerById(id);
    if (!server) {
        return res.status(404).json({ error: 'MCP Server not found' });
    }
    await db.deleteMcpServer(id);
    res.json({ success: true });
});

module.exports = router;
