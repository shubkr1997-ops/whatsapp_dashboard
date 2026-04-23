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

// ─── ROUTES: Conversation Modes ────────────────────────────────────────────────

// GET /api/contacts/:id/mode — get conversation mode for a contact
router.get('/contacts/:id/mode', async (req, res) => {
    const contactId = parseInt(req.params.id);
    const contact = await db.getContactById(contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    let mode = await db.getConversationMode(contactId);
    if (!mode) {
        mode = await db.setConversationMode({ contact_id: contactId, mode: 'human' });
    }
    res.json(mode);
});

// PUT /api/contacts/:id/mode — set conversation mode (AI or Human)
router.put('/contacts/:id/mode', async (req, res) => {
    const contactId = parseInt(req.params.id);
    const contact = await db.getContactById(contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { mode, agent_config_id, auto_handover } = req.body;
    if (mode && !['human', 'ai'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "human" or "ai"' });
    }

    const result = await db.setConversationMode({
        contact_id: contactId,
        mode: mode || 'human',
        agent_config_id: agent_config_id || null,
        auto_handover: auto_handover ? 1 : 0,
    });

    // Notify all clients about mode change
    /* io.emit removed */

    res.json(result);
});

// POST /api/contacts/:id/history/clear — clear conversation history (reset AI memory)
router.post('/contacts/:id/history/clear', async (req, res) => {
    const contactId = parseInt(req.params.id);
    const contact = await db.getContactById(contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    await db.clearHistory(contactId);
    res.json({ success: true, message: 'Conversation history cleared' });
});

// GET /api/contacts/:id/history — get conversation history (AI context)
router.get('/contacts/:id/history', async (req, res) => {
    const contactId = parseInt(req.params.id);
    const contact = await db.getContactById(contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(await db.getConversationHistory(contactId));
});

module.exports = router;
