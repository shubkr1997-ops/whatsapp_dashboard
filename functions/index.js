const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
admin.initializeApp();

// Import existing modules
const db = require('./data/db');
const { processIncomingMessage, AGENT_PROMPTS } = require('./ai/engine');

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Import all the routes from server.js logic
// For brevity, I'll include the key routes here

// ─── Helper functions (copied from server.js) ────────────────────────────────

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

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/contacts — list all (lightweight, no messages)
app.get('/api/contacts', async (req, res) => {
    try {
        const raw = await db.getAllContacts();
        const contacts = raw.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            avatar: c.avatar,
            status: c.status,
            about: c.about,
            is_group: c.is_group,
            is_favorite: c.is_favorite,
            lastMessage: c.lastMessage || '',
            time: formatTime(c.lastTime),
            unread: c.unread || 0,
        }));
        res.json(contacts);
    } catch (err) {
        console.error('[API Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contacts/:id — full contact + messages
app.get('/api/contacts/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const contact = await db.getContactById(id);
        if (!contact) return res.status(404).json({ error: 'Contact not found' });

        // Mark all incoming messages as read
        await db.markMessagesRead(id);

        const rawMsgs = await db.getMessages(id);
        const messages = rawMsgs.map(m => ({
            id: m.id,
            type: m.type,
            text: m.text,
            media_type: m.media_type || 'text',
            media_url: m.media_url,
            caption: m.caption,
            status: m.status,
            time: formatTime(m.timestamp),
        }));

        res.json({ ...contact, messages });
    } catch (err) {
        console.error('[API Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contacts — create a new contact
app.post('/api/contacts', async (req, res) => {
    try {
        const { name, phone, avatar, status, about, is_group } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });

        // Prevent duplicate phone numbers
        if (phone) {
            const existing = await db.getContactByPhone(phone);
            if (existing) return res.status(409).json({ error: 'Contact with this phone already exists', contact: existing });
        }

        const contact = await db.createContact({ name, phone, avatar, status, about, is_group });
        res.status(201).json(contact);
    } catch (err) {
        console.error('[API Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/contacts/:id/favorite — toggle favorite status
app.put('/api/contacts/:id/favorite', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { is_favorite } = req.body;

        const contact = await db.getContactById(id);
        if (!contact) return res.status(404).json({ error: 'Contact not found' });

        await db.updateFavorite(id, is_favorite);

        res.json({ success: true, is_favorite: is_favorite ? 1 : 0 });
    } catch (err) {
        console.error('[API Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/agents — list all agent configs
app.get('/api/agents', async (req, res) => {
    try {
        res.json(await db.getAllAgentConfigs());
    } catch (err) {
        console.error('[API Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/agents/types — available agent types
app.get('/api/agents/types', (req, res) => {
    const types = Object.keys(AGENT_PROMPTS).map(key => ({
        type: key,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        defaultPrompt: AGENT_PROMPTS[key],
    }));
    res.json(types);
});

// POST /api/agents — create new agent config
app.post('/api/agents', async (req, res) => {
    try {
        const { name, agent_type, provider, model, system_prompt, temperature, max_tokens, base_url, is_default } = req.body;
        if (!name || !agent_type || !provider) {
            return res.status(400).json({ error: 'name, agent_type, and provider are required' });
        }
        const prompt = system_prompt || AGENT_PROMPTS[agent_type] || AGENT_PROMPTS.custom;
        const agent = await db.createAgentConfig({
            name, agent_type, provider,
            model: model || undefined,
            system_prompt: prompt,
            temperature: temperature ?? undefined,
            max_tokens: max_tokens ?? undefined,
            base_url: base_url || null,
            is_default: is_default ? 1 : 0,
        });
        res.status(201).json(agent);
    } catch (err) {
        console.error('[API Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/contacts/:id/mode — set conversation mode
app.put('/api/contacts/:id/mode', async (req, res) => {
    try {
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

        res.json(result);
    } catch (err) {
        console.error('[API Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contacts/:id/messages — send a text message
app.post('/api/contacts/:id/messages', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { text, media_type, media_url, caption } = req.body;

        if (!text || !text.trim()) {
            if (!media_url) return res.status(400).json({ error: 'text or media_url is required' });
        }

        const contact = await db.getContactById(id);
        if (!contact) return res.status(404).json({ error: 'Contact not found' });

        // Save to DB as 'sent'
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
            id: savedMsg.id,
            type: 'outgoing',
            text: savedMsg.text,
            media_type: savedMsg.media_type,
            media_url: savedMsg.media_url,
            caption: savedMsg.caption,
            status: savedMsg.status,
            time: formatTime(savedMsg.timestamp),
        };

        // Send via WhatsApp API (simplified - would need full implementation)
        // For now, just return the message

        res.status(201).json(formatted);
    } catch (err) {
        console.error('[API Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export the Express app as a Firebase Function
exports.api = functions.https.onRequest(app);

// Separate webhook function for better performance
exports.webhook = functions.https.onRequest(async (req, res) => {
    // Webhook logic here - simplified version
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Always respond 200 fast to prevent retries
    res.status(200).send('EVENT_RECEIVED');

    try {
        // Process webhook payload
        const entry = req.body?.entry?.[0];
        const change = entry?.changes?.[0]?.value;
        const msgArr = change?.messages;

        if (!msgArr || msgArr.length === 0) return;

        for (const waMeta of msgArr) {
            const fromPhone = waMeta.from;
            const msgType = waMeta.type;

            let text = '';
            let mediaType = 'text';
            let mediaUrl = null;
            let waMediaId = null;

            if (msgType === 'text') {
                text = waMeta.text?.body || '';
            } else if (msgType === 'image') {
                const imageData = waMeta.image;
                waMediaId = imageData?.id;
                const caption = imageData?.caption || '';
                mediaType = 'image';
                text = caption || '[Image]';
            } else {
                text = `[${msgType}]`;
            }

            // Normalise phone
            const normPhone = `+${fromPhone}`;

            let contact = await db.getContactByPhone(normPhone);

            // Auto-create contact if not found
            if (!contact) {
                contact = await db.createContact({
                    name: normPhone,
                    phone: normPhone,
                    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromPhone}`,
                    status: 'Online',
                });
            }

            // Persist message
            await db.addMessage({
                contact_id: contact.id,
                type: 'incoming',
                text,
                media_type: mediaType,
                media_url: mediaUrl,
                status: 'delivered',
            });

            // AI processing (fire-and-forget)
            processIncomingMessage(contact.id, text, contact, null, mediaUrl, null)
                .then((aiMsg) => {
                    if (!aiMsg) return;
                    // Send AI reply via WhatsApp API
                    // Note: In Firebase Functions, WhatsApp API calls need proper error handling
                    console.log('[AI] Would send reply:', aiMsg.text);
                })
                .catch((err) => console.error('[AI Engine] Processing error:', err.message));
        }
    } catch (err) {
        console.error('[Webhook] Processing error:', err.message);
    }
});