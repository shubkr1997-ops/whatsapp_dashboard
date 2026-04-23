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

// ─── ROUTES: Calls ─────────────────────────────────────────────────────────────

// GET /api/calls — get all calls
router.get('/calls', async (req, res) => {
    res.json(await db.getAllCalls());
});

// GET /api/calls/:contactId — get calls for a specific contact
router.get('/calls/:contactId', async (req, res) => {
    const contactId = parseInt(req.params.contactId);
    res.json(await db.getCallsByContact(contactId));
});

// POST /api/calls — create a new call record
router.post('/calls', async (req, res) => {
    const { contact_id, type, direction, status } = req.body;
    if (!contact_id || !type || !direction) {
        return res.status(400).json({ error: 'contact_id, type, and direction are required' });
    }

    const call = await db.createCall({ contact_id, type, direction, status });
    res.status(201).json(call);
});

// PUT /api/calls/:id — update call status
router.put('/calls/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await db.getCallById(id);
    if (!existing) return res.status(404).json({ error: 'Call not found' });

    const { status, duration } = req.body;
    const ended_at = status === 'completed' || status === 'failed' ? new Date().toISOString() : null;

    await db.updateCallStatus(id, status, duration, ended_at);
    res.json({ success: true });
});

module.exports = router;
