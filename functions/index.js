const functions = require('firebase-functions/v2');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const multer = require('multer');
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const bucket = admin.storage().bucket();

// Local modules (now inside functions directory)
const db = require('./data/db');
const { processIncomingMessage, AGENT_PROMPTS } = require('./ai/engine');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Note: Hosting will handle static files in public/, but rewrites in firebase.json 
// can point to this function if needed.

// ─── Helper: Format timestamp for display ────────────────────────────────────
function formatTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Helper: Send via WhatsApp Cloud API (Meta) ───────────────────────────────
async function sendViaWhatsApp(toPhone, text) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
        console.log('[WhatsApp] No API credentials set — skipping external send.');
        return { simulated: true };
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace(/\D/g, ''),
        type: 'text',
        text: { preview_url: false, body: text },
    };

    const response = await axios.post(url, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    return response.data;
}

// Routes from server.js (adapted for async/await)
app.get('/api/contacts', async (req, res) => {
    try {
        const raw = await db.getAllContacts();
        const contactsWithTime = raw.map(c => ({
            ...c,
            time: formatTime(c.lastTime),
        }));
        res.json(contactsWithTime);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/contacts/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const contact = await db.getContactById(id);
        if (!contact) return res.status(404).json({ error: 'Contact not found' });
        await db.markMessagesRead(id);
        const rawMsgs = await db.getMessages(id);
        const messages = rawMsgs.map(m => ({ ...m, time: formatTime(m.timestamp) }));
        res.json({ ...contact, messages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/contacts', async (req, res) => {
    try {
        const contact = await db.createContact(req.body);
        res.status(201).json(contact);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/contacts/:id/favorite', async (req, res) => {
    try {
        await db.updateFavorite(req.params.id, req.body.is_favorite);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Multer and Storage logic
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post('/api/contacts/:id/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const id = req.params.id;
        const filename = `media_${Date.now()}_${path.basename(req.file.originalname)}`;
        const file = bucket.file(`uploads/${filename}`);
        await file.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
        await file.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/uploads/${filename}`;
        
        const savedMsg = await db.addMessage({
            contact_id: id,
            type: 'outgoing',
            text: req.body.caption || '',
            media_type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
            media_url: publicUrl,
            status: 'sent'
        });
        res.status(201).json(savedMsg);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Webhook handling
app.get('/api/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

app.post('/api/webhook', async (req, res) => {
    // Respond quickly to Meta
    res.status(200).send('EVENT_RECEIVED');
    
    try {
        const entry = req.body?.entry?.[0];
        const change = entry?.changes?.[0]?.value;
        const messages = change?.messages;
        if (!messages) return;

        for (const msg of messages) {
            const from = msg.from;
            const text = msg.text?.body || '';
            let contact = await db.getContactByPhone(`+${from}`);
            if (!contact) {
                contact = await db.createContact({ name: from, phone: `+${from}` });
            }
            await db.addMessage({
                contact_id: contact.id,
                type: 'incoming',
                text,
                status: 'delivered'
            });
            // AI logic
            await processIncomingMessage(contact.id, text, contact, null);
        }
    } catch (err) {
        console.error('[Webhook Error]', err.message);
    }
});

// Final Export
exports.api = functions.https.onRequest({ cors: true }, app);