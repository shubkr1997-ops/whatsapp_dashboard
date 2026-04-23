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

// ─── ROUTES: Contacts ─────────────────────────────────────────────────────────

// GET /api/contacts — list all (lightweight, no messages)
router.get('/contacts', async (req, res) => {
    const raw = await db.getAllContacts();
    const contacts = raw.map(c => ({
        id:          c.id,
        name:        c.name,
        phone:       c.phone,
        avatar:      c.avatar,
        status:      c.status,
        about:       c.about,
        is_group:    c.is_group,
        is_favorite: c.is_favorite,
        lastMessage: c.lastMessage || '',
        time:        formatTime(c.lastTime),
        unread:      c.unread || 0,
    }));
    res.json(contacts);
});

// GET /api/contacts/:id — full contact + messages
router.get('/contacts/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const contact = await db.getContactById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Mark all incoming messages as read
    await db.markMessagesRead(id);

    const rawMsgs = await db.getMessages(id);
    const messages = rawMsgs.map(m => ({
        id:        m.id,
        type:      m.type,
        text:      m.text,
        media_type: m.media_type || 'text',
        media_url:  m.media_url,
        caption:    m.caption,
        status:     m.status,
        time:       formatTime(m.timestamp),
    }));

    // Broadcast updated unread count (now 0) to all clients
    /* io.emit removed */

    res.json({ ...contact, messages });
});

// POST /api/contacts — create a new contact
router.post('/contacts', async (req, res) => {
    const { name, phone, avatar, status, about, is_group } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Prevent duplicate phone numbers
    if (phone) {
        const existing = await db.getContactByPhone(phone);
        if (existing) return res.status(409).json({ error: 'Contact with this phone already exists', contact: existing });
    }

    const contact = await db.createContact({ name, phone, avatar, status, about, is_group });
    res.status(201).json(contact);
});

// PUT /api/contacts/:id/favorite — toggle favorite status
router.put('/contacts/:id/favorite', async (req, res) => {
    const id = parseInt(req.params.id);
    const { is_favorite } = req.body;
    
    const contact = await db.getContactById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    await db.updateFavorite(id, is_favorite);
    
    // Broadcast update to all clients
    /* io.emit removed */
    
    res.json({ success: true, is_favorite: is_favorite ? 1 : 0 });
});

module.exports = router;
