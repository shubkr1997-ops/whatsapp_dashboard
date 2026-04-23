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

// ─── ROUTES: Messages (Outbound) ─────────────────────────────────────────────

// POST /api/contacts/:id/messages — send a text message
router.post('/contacts/:id/messages', async (req, res) => {
    const id   = parseInt(req.params.id);
    const { text, media_type, media_url, caption } = req.body;

    if (!text || !text.trim()) {
        if (!media_url) return res.status(400).json({ error: 'text or media_url is required' });
    }

    const contact = await db.getContactById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // 1. Optimistically save to DB as 'sent'
    const savedMsg = await db.addMessage({
        contact_id: id,
        type: 'outgoing',
        text: (text || caption || '').trim(),
        media_type: media_type || 'text',
        media_url: media_url || null,
        caption: caption || null,
        status: 'sent',
    });

    const formatted = {
        id:        savedMsg.id,
        type:      'outgoing',
        text:      savedMsg.text,
        media_type: savedMsg.media_type,
        media_url:  savedMsg.media_url,
        caption:    savedMsg.caption,
        status:     savedMsg.status,
        time:       formatTime(savedMsg.timestamp),
    };

    // 2. Broadcast instantly to all clients watching this chat
    /* io.to.emit removed */

    /* io.emit removed */
    // time: formatTime(savedMsg.timestamp),
    // });

    // 4. Try sending via WhatsApp API (non-blocking)
    if (contact.phone && !contact.is_group) {
        if (media_type === 'image' && media_url) {
            // Send image via WhatsApp
            whatsappService.sendImageViaWhatsApp(contact.phone, media_url, caption || '')
                .then(async (apiRes) => {
                    const waId = apiRes?.messages?.[0]?.id;
                    if (waId && !apiRes.simulated) {
                        await db.markMessageDelivered(savedMsg.id);
                        /* io.to.emit removed */
                    }
                })
                .catch((err) => {
                    console.error('[WhatsApp Image Send Error]', err.response?.data || err.message);
                });
        } else {
            // Send text via WhatsApp
            whatsappService.sendViaWhatsApp(contact.phone, (text || '').trim())
                .then(async (apiRes) => {
                    const waId = apiRes?.messages?.[0]?.id;
                    if (waId && !apiRes.simulated) {
                        await db.markMessageDelivered(savedMsg.id);
                        /* io.to.emit removed */
                    }
                })
                .catch((err) => {
                    console.error('[WhatsApp Send Error]', {
                        message: err.message,
                        status: err.response?.status,
                        data: err.response?.data,
                        phone: contact.phone
                    });
                });
        }
    }

    res.status(201).json(formatted);
});

// POST /api/contacts/:id/upload — upload an image or video file and send it
router.post('/contacts/:id/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const id = req.params.id;
    const caption = req.body.caption || '';
    const contact = await db.getContactById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Upload to Firebase Storage
    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const file = bucket.file(`uploads/${filename}`);
    
    await file.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype }
    });
    await file.makePublic();
    
    const localUrl = `https://storage.googleapis.com/${bucket.name}/uploads/${filename}`;

    // Determine media type from mimetype
    let mediaType = 'image';
    if (req.file.mimetype.startsWith('video/')) {
        mediaType = 'video';
    }

    // Build public URL for WhatsApp API
    const publicUrl = localUrl;

    // Save to DB
    const savedMsg = await db.addMessage({
        contact_id: id,
        type: 'outgoing',
        text: caption || `[${mediaType === 'video' ? 'Video' : 'Image'}]`,
        media_type: mediaType,
        media_url: localUrl,
        media_mime: req.file.mimetype,
        caption,
        status: 'sent',
    });

    const formatted = {
        id:        savedMsg.id,
        type:      'outgoing',
        text:      savedMsg.text,
        media_type: mediaType,
        media_url:  localUrl,
        caption,
        status:     savedMsg.status,
        time:       formatTime(savedMsg.timestamp),
    };

    // Broadcast
    /* io.emit removed */
    // time: formatTime(savedMsg.timestamp),
    // });

    // Send via WhatsApp using public URL
    if (contact.phone && !contact.is_group) {
        const sendFn = mediaType === 'video' ? sendVideoViaWhatsApp : sendImageViaWhatsApp;
        sendFn(contact.phone, publicUrl, caption)
            .then(async (apiRes) => {
                const waId = apiRes?.messages?.[0]?.id;
                if (waId && !apiRes.simulated) {
                    await db.markMessageDelivered(savedMsg.id);
                    /* io.to.emit removed */
                }
            })
            .catch((err) => {
                console.error(`[WhatsApp ${mediaType} Upload Error]`, err.response?.data || err.message);
            });
    }

    res.status(201).json(formatted);
});

module.exports = router;
