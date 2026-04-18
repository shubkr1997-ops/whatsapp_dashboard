'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const axios      = require('axios');
const multer     = require('multer');
const db         = require('./data/db');
const { processIncomingMessage, AGENT_PROMPTS } = require('./ai/engine');

const app    = express();
const admin      = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const bucket = admin.storage().bucket();


const PORT = process.env.PORT || 8000;

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer config for image/video uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 }, // 16MB max
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/3gpp', 'video/quicktime',
        ];
        cb(null, allowed.includes(file.mimetype));
    },
});

// Multer config for training file uploads (PDF/CSV)
const TRAINING_DIR = path.join(__dirname, 'training_files');
fs.mkdirSync(TRAINING_DIR, { recursive: true });

const trainingStorage = multer.memoryStorage();
const uploadTraining = multer({
    storage: trainingStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for training files
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'text/csv', 'application/vnd.ms-excel'];
        cb(null, allowed.includes(file.mimetype));
    },
});

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Socket.io ───────────────────────────────────────────────────────────────

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
        to: toPhone.replace(/\D/g, ''),   // strip non-digits
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

// ─── Helper: Download media from WhatsApp Cloud API ────────────────────────────

async function downloadWhatsAppMedia(mediaId) {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN;
    if (!accessToken) return null;

    // Step 1: Get the media URL from Meta
    const metaUrl = `https://graph.facebook.com/v20.0/${mediaId}`;
    const metaRes = await axios.get(metaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const mediaUrl = metaRes.data.url;
    const mimeType = metaRes.data.mime_type || 'image/jpeg';

    // Step 2: Download the actual file
    const fileRes = await axios.get(mediaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'arraybuffer',
    });

    // Step 3: Save to Firebase Storage
    const ext = mimeType.split('/')[1] || 'jpg';
    const filename = `wa_${mediaId}_${Date.now()}.${ext}`;
    
    const file = bucket.file(`uploads/${filename}`);
    await file.save(Buffer.from(fileRes.data), {
        metadata: { contentType: mimeType }
    });
    // Make public so WhatsApp can potentially access it, although incoming might not need it public
    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/uploads/${filename}`;

    return { localUrl: publicUrl, mimeType };
}

// ─── Helper: Send Image via WhatsApp Cloud API (Meta) ──────────────────────────

async function sendImageViaWhatsApp(toPhone, imageUrl, caption = '') {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
        console.log('[WhatsApp] No API credentials set — skipping image send.');
        return { simulated: true };
    }

    // Convert localhost URLs to public ngrok URL if available
    if (imageUrl.includes('localhost')) {
        const publicBase = process.env.PUBLIC_URL;
        if (publicBase) {
            const localPath = new URL(imageUrl).pathname;
            imageUrl = publicBase + localPath;
        }
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace(/\D/g, ''),
        type: 'image',
        image: {
            link: imageUrl,
            caption: caption || undefined,
        },
    };

    const response = await axios.post(url, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    return response.data;
}

// ─── Helper: Send Video via WhatsApp Cloud API (Meta) ──────────────────────────

async function sendVideoViaWhatsApp(toPhone, videoUrl, caption = '') {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
        console.log('[WhatsApp] No API credentials set — skipping video send.');
        return { simulated: true };
    }

    // Convert localhost URLs to public ngrok URL if available
    if (videoUrl.includes('localhost')) {
        const publicBase = process.env.PUBLIC_URL;
        if (publicBase) {
            const localPath = new URL(videoUrl).pathname;
            videoUrl = publicBase + localPath;
        }
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace(/\D/g, ''),
        type: 'video',
        video: {
            link: videoUrl,
            caption: caption || undefined,
        },
    };

    const response = await axios.post(url, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    return response.data;
}

// ─── Helper: Upload media to Meta and get media_id (for outbound) ──────────────

async function uploadMediaToMeta(filePath, mimeType) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) return null;

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/media`;

    const FormData = require('form-data');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', fs.createReadStream(filePath), {
        contentType: mimeType,
        filename: path.basename(filePath),
    });

    const response = await axios.post(url, form, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...form.getHeaders(),
        },
    });

    return response.data.id; // media_id
}

// ─── ROUTES: Contacts ─────────────────────────────────────────────────────────

// GET /api/contacts — list all (lightweight, no messages)
app.get('/api/contacts', (req, res) => {
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
app.get('/api/contacts/:id', (req, res) => {
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
app.post('/api/contacts', (req, res) => {
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
app.put('/api/contacts/:id/favorite', (req, res) => {
    const id = parseInt(req.params.id);
    const { is_favorite } = req.body;
    
    const contact = await db.getContactById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    await db.updateFavorite(id, is_favorite);
    
    // Broadcast update to all clients
    /* io.emit removed */
    
    res.json({ success: true, is_favorite: is_favorite ? 1 : 0 });
});

// ─── ROUTES: Messages (Outbound) ─────────────────────────────────────────────

// POST /api/contacts/:id/messages — send a text message
app.post('/api/contacts/:id/messages', async (req, res) => {
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

    // 3. Also update sidebar for all clients
    /* io.emit removed */,
        time: formatTime(savedMsg.timestamp),
    });

    // 4. Try sending via WhatsApp API (non-blocking)
    if (contact.phone && !contact.is_group) {
        if (media_type === 'image' && media_url) {
            // Send image via WhatsApp
            sendImageViaWhatsApp(contact.phone, media_url, caption || '')
                .then((apiRes) => {
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
            sendViaWhatsApp(contact.phone, (text || '').trim())
                .then((apiRes) => {
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
app.post('/api/contacts/:id/upload', upload.single('file'), async (req, res) => {
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
    /* io.to.emit removed */
    /* io.emit removed */,
        time: formatTime(savedMsg.timestamp),
    });

    // Send via WhatsApp using public URL
    if (contact.phone && !contact.is_group) {
        const sendFn = mediaType === 'video' ? sendVideoViaWhatsApp : sendImageViaWhatsApp;
        sendFn(contact.phone, publicUrl, caption)
            .then((apiRes) => {
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

// ─── ROUTES: Webhook (Inbound) ────────────────────────────────────────────────

// GET /api/webhook — Meta webhook verification challenge
app.get('/api/webhook', (req, res) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        console.log('[Webhook] ✅ Verified by Meta');
        return res.status(200).send(challenge);
    }
    console.warn('[Webhook] ❌ Verification failed');
    res.sendStatus(403);
});

// POST /api/webhook — receive inbound message from Meta / any provider
app.post('/api/webhook', async (req, res) => {
    // Always respond 200 fast to prevent Meta from retrying
    res.status(200).send('EVENT_RECEIVED');

    try {
        // ── Meta WhatsApp Cloud API Payload ──────────────────────────────
        const entry   = req.body?.entry?.[0];
        const change  = entry?.changes?.[0]?.value;
        const msgArr  = change?.messages;

        if (!msgArr || msgArr.length === 0) return; // Not a message event

        for (const waMeta of msgArr) {
            const fromPhone = waMeta.from;
            const msgType   = waMeta.type; // 'text', 'image', 'video', 'document', 'audio'

            let text = '';
            let mediaType = 'text';
            let mediaUrl = null;
            let mediaMime = null;
            let caption = null;
            let waMediaId = null;

            if (msgType === 'image') {
                const imageData = waMeta.image;
                waMediaId = imageData?.id;
                caption = imageData?.caption || '';
                mediaMime = imageData?.mime_type || 'image/jpeg';
                mediaType = 'image';
                text = caption || '[Image]';

                // Download the image from Meta and save locally
                if (waMediaId) {
                    try {
                        const downloaded = await downloadWhatsAppMedia(waMediaId);
                        if (downloaded) {
                            mediaUrl = downloaded.localUrl;
                        }
                    } catch (dlErr) {
                        console.error('[Webhook] Image download failed:', dlErr.message);
                        mediaUrl = null; // fallback — will show caption only
                    }
                }
            } else if (msgType === 'video') {
                const videoData = waMeta.video;
                waMediaId = videoData?.id;
                caption = videoData?.caption || '';
                mediaType = 'video';
                text = caption || '[Video]';
            } else if (msgType === 'document') {
                const docData = waMeta.document;
                waMediaId = docData?.id;
                caption = docData?.filename || '';
                mediaType = 'document';
                text = caption || '[Document]';
            } else if (msgType === 'audio') {
                const audioData = waMeta.audio;
                waMediaId = audioData?.id;
                mediaType = 'audio';
                text = '[Audio]';
            } else if (msgType === 'interactive') {
                // Handle Flow responses and interactive message replies
                const interactive = waMeta.interactive;
                if (interactive?.type === 'nfm_reply') {
                    // Meta Flow response
                    const flowResponse = interactive.nfm_reply;
                    const flowToken = flowResponse.response_json ? JSON.parse(flowResponse.response_json) : {};
                    const responseMetadata = flowResponse.response_json || '{}';

                    text = `[Flow Response] ${flowResponse.name || 'Form submitted'}`;

                    // Save flow response to DB
                    try {
                        const flowId = flowToken.flow_id || flowToken.flowId;
                        if (flowId) {
                            // We'll save the response after contact lookup
                            text = `[Flow] Response received`;
                        }
                    } catch (parseErr) {
                        console.error('[Webhook] Flow response parse error:', parseErr.message);
                    }

                    // Store raw flow data for later processing
                    waMeta._flowResponse = flowResponse;
                } else if (interactive?.type === 'button_reply') {
                    text = interactive.button_reply?.title || '[Button]';
                } else if (interactive?.type === 'list_reply') {
                    text = interactive.list_reply?.title || '[List Selection]';
                } else {
                    text = '[Interactive Message]';
                }
            } else {
                // Default: text message
                text = waMeta.text?.body || msgType;
            }

            // Normalise phone for lookup
            const normPhone = `+${fromPhone}`;

            let contact = await db.getContactByPhone(normPhone);

            // Auto-create contact if not found
            if (!contact) {
                console.log(`[Webhook] New number: ${normPhone} — auto-creating contact.`);
                contact = await db.createContact({
                    name:   normPhone,
                    phone:  normPhone,
                    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${fromPhone}`,
                    status: 'Online',
                });
                // Notify all clients about the new contact
                const newContactData = {
                    id:          contact.id,
                    name:        contact.name,
                    phone:       contact.phone,
                    avatar:      contact.avatar,
                    status:      contact.status,
                    lastMessage: text,
                    time:        formatTime(new Date().toISOString()),
                    unread:      1,
                };
                console.log('[Socket] Emitting new_contact:', newContactData);
                /* io.emit removed */
            }

            // Save flow response if this is a flow reply
            if (waMeta._flowResponse) {
                try {
                    const flowResp = waMeta._flowResponse;
                    const respJson = flowResp.response_json || '{}';
                    const parsedResp = JSON.parse(respJson);
                    const flowId = parsedResp.flow_id || parsedResp.flowId;

                    if (flowId) {
                        await db.saveFlowResponse({
                            flow_id: flowId,
                            contact_id: contact.id,
                            screen_id: parsedResp.screen || null,
                            response_json: respJson,
                        });
                        console.log(`[Webhook] Flow response saved for flow ${flowId}`);

                        /* io.emit removed */
                    }
                } catch (flowErr) {
                    console.error('[Webhook] Flow response save error:', flowErr.message);
                }
            }

            // Persist message
            const savedMsg = await db.addMessage({
                contact_id:  contact.id,
                type:        'incoming',
                text,
                media_type:  mediaType,
                media_url:   mediaUrl,
                media_mime:  mediaMime,
                caption,
                wa_media_id: waMediaId,
                status:      'delivered',
            });

            const formatted = {
                id:        savedMsg.id,
                type:      'incoming',
                text:      savedMsg.text,
                media_type: savedMsg.media_type,
                media_url:  savedMsg.media_url,
                caption:    savedMsg.caption,
                status:     savedMsg.status,
                time:       formatTime(savedMsg.timestamp),
            };

            console.log(`[Webhook] ${mediaType === 'image' ? 'Image' : 'Message'} from ${normPhone}${caption ? ': "' + caption + '"' : ''}`);

            // Push to the chat room in real-time
            console.log('[Socket] Emitting new_message to room:', `chat_${contact.id}`, formatted);
            /* io.to.emit removed */

            // Update sidebar for all clients
            /* io.emit removed */,
                unread:      '+1',
            });

            // AI Agent: process incoming message if conversation is in AI mode
            processIncomingMessage(contact.id, text, contact, io, mediaUrl, mediaMime)
                .then((aiMsg) => {
                    if (!aiMsg) return; // human mode or error

                    const aiFormatted = {
                        id:     aiMsg.id,
                        type:   'outgoing',
                        text:   aiMsg.text,
                        status: aiMsg.status,
                        time:   formatTime(aiMsg.timestamp),
                    };

                    // Broadcast AI reply to chat room
                    /* io.to.emit removed */

                    // Update sidebar
                    /* io.emit removed */,
                    });

                    // Send AI reply via WhatsApp API
                    if (contact.phone && !contact.is_group) {
                        sendViaWhatsApp(contact.phone, aiMsg.text)
                            .then((apiRes) => {
                                const waId = apiRes?.messages?.[0]?.id;
                                if (waId && !apiRes.simulated) {
                                    await db.markMessageDelivered(aiMsg.id);
                                    /* io.to.emit removed */
                                }
                            })
                            .catch((err) => {
                                console.error('[AI WhatsApp Send Error]', {
                                    message: err.message,
                                    status: err.response?.status,
                                    data: err.response?.data,
                                    phone: contact.phone
                                });
                            });
                    }
                })
                .catch((err) => console.error('[AI Engine] Processing error:', err.message));
        }
    } catch (err) {
        console.error('[Webhook] Processing error:', err.message);
    }
});

// POST /api/simulate/receive — Dev-only: simulate receiving an inbound message
//  Body: { contactId, text }
app.post('/api/simulate/receive', (req, res) => {
    const { contactId, text = 'Hey! Simulated message 👋' } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    const contact = await db.getContactById(parseInt(contactId));
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const savedMsg = await db.addMessage({ contact_id: contact.id, type: 'incoming', text, status: 'delivered' });
    const formatted = {
        id:     savedMsg.id,
        type:   'incoming',
        text:   savedMsg.text,
        status: savedMsg.status,
        time:   formatTime(savedMsg.timestamp),
    };

    /* io.to.emit removed */
    /* io.emit removed */,
        unread:      '+1',
    });

    // AI Agent: process simulated incoming if conversation is in AI mode
    processIncomingMessage(contact.id, text, contact, io)
        .then((aiMsg) => {
            if (!aiMsg) return;
            const aiFormatted = {
                id: aiMsg.id, type: 'outgoing', text: aiMsg.text,
                status: aiMsg.status, time: formatTime(aiMsg.timestamp),
            };
            /* io.to.emit removed */
            /* io.emit removed */,
            });
        })
        .catch((err) => console.error('[AI Engine] Simulate processing error:', err.message));

    res.status(201).json({ success: true, message: formatted });
});

// ─── ROUTES: Agent Configs ─────────────────────────────────────────────────────

// GET /api/agents — list all agent configs
app.get('/api/agents', (req, res) => {
    res.json(await db.getAllAgentConfigs());
});

// GET /api/agents/types — available agent types and their default prompts
app.get('/api/agents/types', (req, res) => {
    const types = Object.keys(AGENT_PROMPTS).map(key => ({
        type: key,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        defaultPrompt: AGENT_PROMPTS[key],
    }));
    res.json(types);
});

// GET /api/agents/providers — available AI providers and their env status
app.get('/api/agents/providers', (req, res) => {
    res.json([
        { id: 'openai',   label: 'OpenAI',    configured: !!process.env.OPENAI_API_KEY,    defaultModel: 'gpt-4o' },
        { id: 'chatgpt',  label: 'ChatGPT',   configured: !!process.env.OPENAI_API_KEY,    defaultModel: 'gpt-4o' },
        { id: 'gemini',   label: 'Gemini',     configured: !!process.env.GEMINI_API_KEY,    defaultModel: 'gemini-1.5-pro' },
        { id: 'ollama',   label: 'Ollama',     configured: true,                            defaultModel: process.env.OLLAMA_MODEL || 'llama3', defaultUrl: 'http://localhost:11434' },
        { id: 'lmstudio', label: 'LM Studio',  configured: true,                            defaultModel: 'local-model', defaultUrl: 'http://localhost:1234' },
    ]);
});

// GET /api/providers/:provider/models — get available models from local providers
app.get('/api/providers/:provider/models', async (req, res) => {
    const { provider } = req.params;
    const baseUrl = req.query.baseUrl;

    try {
        if (provider === 'lmstudio') {
            const { getLMStudioModels } = require('./ai/providers');
            const url = baseUrl || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234';
            const models = await getLMStudioModels(url);
            res.json({ models });
        } else if (provider === 'ollama') {
            const axios = require('axios');
            const url = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
            const response = await axios.get(`${url}/api/tags`, { timeout: 5000 });
            const models = response.data?.models?.map(m => m.name) || [];
            res.json({ models });
        } else {
            res.status(400).json({ error: 'Provider does not support model listing' });
        }
    } catch (err) {
        console.error(`[getModels] Error for ${provider}:`, err.message);
        res.status(500).json({ error: 'Failed to get models: ' + err.message });
    }
});

// GET /api/agents/:id — get single agent config
app.get('/api/agents/:id', (req, res) => {
    const agent = await db.getAgentConfigById(parseInt(req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent config not found' });
    res.json(agent);
});

// POST /api/agents — create new agent config
app.post('/api/agents', (req, res) => {
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
});

// PUT /api/agents/:id — update agent config
app.put('/api/agents/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await db.getAgentConfigById(id);
    if (!existing) return res.status(404).json({ error: 'Agent config not found' });

    const { name, agent_type, provider, model, system_prompt, temperature, max_tokens, base_url, is_default } = req.body;
    const agent = await db.updateAgentConfig(id, {
        name:            name ?? existing.name,
        agent_type:      agent_type ?? existing.agent_type,
        provider:        provider ?? existing.provider,
        model:           model ?? existing.model,
        system_prompt:   system_prompt ?? existing.system_prompt,
        temperature:     temperature ?? existing.temperature,
        max_tokens:      max_tokens ?? existing.max_tokens,
        base_url:        base_url !== undefined ? base_url : existing.base_url,
        is_default:      is_default !== undefined ? (is_default ? 1 : 0) : existing.is_default,
    });
    res.json(agent);
});

// DELETE /api/agents/:id — delete agent config
app.delete('/api/agents/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await db.getAgentConfigById(id);
    if (!existing) return res.status(404).json({ error: 'Agent config not found' });
    await db.deleteAgentConfig(id);
    res.json({ success: true });
});

// ─── ROUTES: Knowledge Base (AI Training) ────────────────────────────────────

const { parsePDF } = require('pdf-parse');
const { parseCSV } = require('csv-parse');

app.get('/api/agents/:id/knowledge', (req, res) => {
    const agentId = parseInt(req.params.id);
    const knowledge = await db.getKnowledgeByAgent(agentId);
    res.json(knowledge);
});

app.post('/api/agents/:id/knowledge/upload', uploadTraining.single('file'), async (req, res) => {
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
            const pdfData = await parsePDF(req.file.buffer);
            content = pdfData.text.substring(0, 100000);
            recordCount = pdfData.numpages || 1;
        } else {
            const csvContent = req.file.buffer.toString('utf-8');
            const records = await new Promise((resolve, reject) => {
                parseCSV(csvContent, { columns: true }, (err, records) => {
                    if (err) reject(err);
                    else resolve(records);
                });
            });
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

app.post('/api/agents/:id/knowledge/google-sheet', (req, res) => {
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

app.get('/api/knowledge/:kid/sync', async (req, res) => {
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

app.post('/api/knowledge/:kid/write-sheet', async (req, res) => {
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

app.delete('/api/knowledge/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const knowledge = await db.getKnowledgeById(id);
    if (!knowledge) {
        return res.status(404).json({ error: 'Knowledge entry not found' });
    }

    if (knowledge.file_path && fs.existsSync(knowledge.file_path)) {
        fs.unlinkSync(knowledge.file_path);
    }
    await db.deleteKnowledge(id);
    res.json({ success: true });
});

// ─── ROUTES: MCP Servers (Tools) ──────────────────────────────────────────────

app.get('/api/agents/:id/mcp_servers', (req, res) => {
    const agentId = parseInt(req.params.id);
    const servers = await db.getMcpServersByAgent(agentId);
    res.json(servers);
});

app.post('/api/agents/:id/mcp_servers/google-sheet', (req, res) => {
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

app.delete('/api/mcp_servers/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const server = await db.getMcpServerById(id);
    if (!server) {
        return res.status(404).json({ error: 'MCP Server not found' });
    }
    await db.deleteMcpServer(id);
    res.json({ success: true });
});

// ─── ROUTES: Calls ─────────────────────────────────────────────────────────────

// GET /api/calls — get all calls
app.get('/api/calls', (req, res) => {
    res.json(await db.getAllCalls());
});

// GET /api/calls/:contactId — get calls for a specific contact
app.get('/api/calls/:contactId', (req, res) => {
    const contactId = parseInt(req.params.contactId);
    res.json(await db.getCallsByContact(contactId));
});

// POST /api/calls — create a new call record
app.post('/api/calls', (req, res) => {
    const { contact_id, type, direction, status } = req.body;
    if (!contact_id || !type || !direction) {
        return res.status(400).json({ error: 'contact_id, type, and direction are required' });
    }

    const call = await db.createCall({ contact_id, type, direction, status });
    res.status(201).json(call);
});

// PUT /api/calls/:id — update call status
app.put('/api/calls/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await db.getCallById(id);
    if (!existing) return res.status(404).json({ error: 'Call not found' });

    const { status, duration } = req.body;
    const ended_at = status === 'completed' || status === 'failed' ? new Date().toISOString() : null;

    await db.updateCallStatus(id, status, duration, ended_at);
    res.json({ success: true });
});

// ─── ROUTES: Conversation Modes ────────────────────────────────────────────────

// GET /api/contacts/:id/mode — get conversation mode for a contact
app.get('/api/contacts/:id/mode', (req, res) => {
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
app.put('/api/contacts/:id/mode', (req, res) => {
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
app.post('/api/contacts/:id/history/clear', (req, res) => {
    const contactId = parseInt(req.params.id);
    const contact = await db.getContactById(contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    await db.clearHistory(contactId);
    res.json({ success: true, message: 'Conversation history cleared' });
});

// GET /api/contacts/:id/history — get conversation history (AI context)
app.get('/api/contacts/:id/history', (req, res) => {
    const contactId = parseInt(req.params.id);
    const contact = await db.getContactById(contactId);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(await db.getConversationHistory(contactId));
});

// ─── ROUTES: Catalog Integration ──────────────────────────────────────────────

// POST /api/catalog/auth — Initiate Meta OAuth / Embedded Signup
app.post('/api/catalog/auth', async (req, res) => {
    const { access_token, business_id, waba_id } = req.body;

    if (!access_token) {
        // Return the Meta OAuth URL for the frontend to redirect to
        const appId = process.env.META_APP_ID;
        const redirectUri = process.env.META_REDIRECT_URI || `${req.protocol}://${req.get('host')}/catalog.html`;
        const scope = 'whatsapp_business_management,business_management,catalog_management';
        const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&config_id=${process.env.META_CONFIG_ID || ''}`;
        return res.json({ oauth_url: oauthUrl });
    }

    // Store credentials
    try {
        await db.upsertCatalog({
            business_id: business_id || null,
            waba_id: waba_id || null,
            catalog_id: 'pending',
            access_token,
        });
        res.json({ success: true, access_token, business_id, waba_id });
    } catch (err) {
        console.error('[Catalog Auth] Error:', err.message);
        res.status(500).json({ error: 'Failed to save credentials' });
    }
});

// GET /api/catalog/catalogs — Fetch catalogs for a business
app.get('/api/catalog/catalogs', async (req, res) => {
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || process.env.WHATSAPP_ACCESS_TOKEN;
    const businessId = req.query.business_id || process.env.META_BUSINESS_ID;

    if (!accessToken) return res.status(400).json({ error: 'No access token available' });

    try {
        const url = `https://graph.facebook.com/v19.0/${businessId}/owned_product_catalogs`;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const catalogs = (response.data.data || []).map(c => ({
            id: c.id,
            name: c.name || `Catalog ${c.id}`,
        }));

        // Also return locally stored catalogs
        const localCatalogs = await db.getAllCatalogs();

        res.json({ remote: catalogs, local: localCatalogs });
    } catch (err) {
        console.error('[Catalog List] Error:', err.response?.data || err.message);
        // Fallback to local catalogs
        res.json({ remote: [], local: await db.getAllCatalogs(), error: err.response?.data?.error?.message || err.message });
    }
});

// POST /api/catalog/connect — Connect a catalog to WABA
app.post('/api/catalog/connect', async (req, res) => {
    const { catalog_id, business_id, waba_id } = req.body;
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || process.env.WHATSAPP_ACCESS_TOKEN;

    if (!catalog_id) return res.status(400).json({ error: 'catalog_id is required' });

    try {
        // Attach catalog to WABA via Meta API
        const waId = waba_id || process.env.META_WABA_ID;
        if (waId && accessToken) {
            const attachUrl = `https://graph.facebook.com/v19.0/${waId}`;
            await axios.post(attachUrl, { product_catalog_id: catalog_id }, {
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            });
        }

        // Store in local DB
        const catalog = await db.upsertCatalog({
            business_id: business_id || process.env.META_BUSINESS_ID || null,
            waba_id: waId || null,
            catalog_id,
            access_token: accessToken || null,
            name: req.body.name || '',
        });

        res.json({ success: true, catalog });
    } catch (err) {
        console.error('[Catalog Connect] Error:', err.response?.data || err.message);
        // Still save locally even if Meta API fails
        const catalog = await db.upsertCatalog({
            business_id: business_id || process.env.META_BUSINESS_ID || null,
            waba_id: waba_id || process.env.META_WABA_ID || null,
            catalog_id,
            access_token: accessToken || null,
            name: req.body.name || '',
        });
        res.json({ success: true, catalog, warning: 'Saved locally but Meta API returned error' });
    }
});

// GET /api/catalog/products/:catalogId — Fetch products from Meta or local DB
app.get('/api/catalog/products/:catalogId', async (req, res) => {
    const { catalogId } = req.params;
    const sync = req.query.sync === 'true';
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || process.env.WHATSAPP_ACCESS_TOKEN;

    if (sync && accessToken) {
        try {
            // Fetch from Meta API and sync to local DB
            let url = `https://graph.facebook.com/v19.0/${catalogId}/products?fields=id,name,price,retailer_id,description,images&limit=100`;
            let allProducts = [];

            while (url) {
                const response = await axios.get(url, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                allProducts = allProducts.concat(response.data.data || []);
                url = response.data.paging?.next || null;
            }

            // Store in local DB
            await db.clearProductsForCatalog(catalogId);
            for (const p of allProducts) {
                await db.upsertProduct({
                    catalog_id: catalogId,
                    product_id: p.id,
                    name: p.name || '',
                    price: p.price ? String(p.price) : '',
                    image_url: p.images?.[0]?.image_url || p.image_url || '',
                    description: p.description || '',
                    retailer_id: p.retailer_id || p.id || '',
                });
            }

            const localProducts = await db.getProductsByCatalog(catalogId);
            return res.json({ products: localProducts, synced: true, count: localProducts.length });
        } catch (err) {
            console.error('[Catalog Products Sync] Error:', err.response?.data || err.message);
            // Fall through to local data
        }
    }

    // Return local products
    const products = await db.getProductsByCatalog(catalogId);
    res.json({ products, synced: false, count: products.length });
});

// POST /api/catalog/send-product — Send a single product message
app.post('/api/catalog/send-product', async (req, res) => {
    const { contact_id, catalog_id, product_retailer_id, body_text } = req.body;
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!contact_id || !catalog_id || !product_retailer_id) {
        return res.status(400).json({ error: 'contact_id, catalog_id, and product_retailer_id are required' });
    }

    const contact = await db.getContactById(parseInt(contact_id));
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Get product info for display
    const product = db.getProductByRetailerId ? null : null; // We'll use the name from request
    const displayText = body_text || `Shared a product`;

    // Save outgoing message to DB
    const savedMsg = await db.addMessage({
        contact_id: contact.id,
        type: 'outgoing',
        text: displayText,
        media_type: 'text',
        status: 'sent',
    });

    const formatted = {
        id: savedMsg.id,
        type: 'outgoing',
        text: displayText,
        media_type: 'text',
        status: 'sent',
        time: formatTime(savedMsg.timestamp),
    };

    // Broadcast to chat
    /* io.to.emit removed */
    /* io.emit removed */ });

    // Send via WhatsApp Cloud API
    if (accessToken && phoneNumberId && contact.phone && !contact.is_group) {
        try {
            const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
            const payload = {
                messaging_product: 'whatsapp',
                to: contact.phone.replace(/\D/g, ''),
                type: 'interactive',
                interactive: {
                    type: 'product',
                    body: { text: body_text || 'Check out this product!' },
                    action: {
                        catalog_id: catalog_id,
                        product_retailer_id: product_retailer_id,
                    },
                },
            };

            const apiRes = await axios.post(url, payload, {
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            });

            const waId = apiRes.data?.messages?.[0]?.id;
            if (waId) {
                await db.markMessageDelivered(savedMsg.id);
                /* io.to.emit removed */
            }
        } catch (err) {
            console.error('[Send Product Error]', err.response?.data || err.message);
        }
    }

    res.status(201).json(formatted);
});

// POST /api/catalog/send-catalog — Send a product_list message
app.post('/api/catalog/send-catalog', async (req, res) => {
    const { contact_id, catalog_id, header_text, body_text, sections } = req.body;
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!contact_id || !catalog_id) {
        return res.status(400).json({ error: 'contact_id and catalog_id are required' });
    }

    const contact = await db.getContactById(parseInt(contact_id));
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const displayText = body_text || 'Shared product catalog';

    // Save outgoing message
    const savedMsg = await db.addMessage({
        contact_id: contact.id,
        type: 'outgoing',
        text: displayText,
        media_type: 'text',
        status: 'sent',
    });

    const formatted = {
        id: savedMsg.id,
        type: 'outgoing',
        text: displayText,
        media_type: 'text',
        status: 'sent',
        time: formatTime(savedMsg.timestamp),
    };

    /* io.to.emit removed */
    /* io.emit removed */ });

    // Build sections from request or use all products
    let productSections = sections;
    if (!productSections || productSections.length === 0) {
        const products = await db.getProductsByCatalog(catalog_id);
        productSections = [{
            title: 'All Items',
            product_items: products.slice(0, 10).map(p => ({ product_retailer_id: p.retailer_id || p.product_id })),
        }];
    }

    // Send via WhatsApp Cloud API
    if (accessToken && phoneNumberId && contact.phone && !contact.is_group) {
        try {
            const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
            const payload = {
                messaging_product: 'whatsapp',
                to: contact.phone.replace(/\D/g, ''),
                type: 'interactive',
                interactive: {
                    type: 'product_list',
                    header: { type: 'text', text: header_text || 'Our Products' },
                    body: { text: body_text || 'Choose from our catalog' },
                    action: {
                        catalog_id: catalog_id,
                        sections: productSections,
                    },
                },
            };

            const apiRes = await axios.post(url, payload, {
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            });

            const waId = apiRes.data?.messages?.[0]?.id;
            if (waId) {
                await db.markMessageDelivered(savedMsg.id);
                /* io.to.emit removed */
            }
        } catch (err) {
            console.error('[Send Catalog Error]', err.response?.data || err.message);
        }
    }

    res.status(201).json(formatted);
});

// DELETE /api/catalog/disconnect/:catalogId — Disconnect a catalog
app.delete('/api/catalog/disconnect/:catalogId', (req, res) => {
    const { catalogId } = req.params;
    await db.deleteCatalog(catalogId);
    res.json({ success: true });
});

// GET /api/catalog/list — List locally stored catalogs
app.get('/api/catalog/list', (req, res) => {
    const catalogs = await db.getAllCatalogs();
    res.json(catalogs);
});

// ─── ROUTES: Meta Flows ───────────────────────────────────────────────────────

// GET /api/flows — List all flows
app.get('/api/flows', (req, res) => {
    res.json(await db.getAllFlows());
});

// GET /api/flows/:flowId — Get single flow
app.get('/api/flows/:flowId', (req, res) => {
    const flow = await db.getFlowByFlowId(req.params.flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(flow);
});

// POST /api/flows — Create a new flow
app.post('/api/flows', (req, res) => {
    const { name, description, category, flow_json } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const flowId = 'flow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const flow = await db.createFlow({
        flow_id: flowId,
        name,
        description: description || '',
        category: category || 'CUSTOMER_SUPPORT',
        flow_json: JSON.stringify(flow_json || { version: "5.0", screens: [] }),
    });
    res.status(201).json(flow);
});

// PUT /api/flows/:flowId — Update a flow
app.put('/api/flows/:flowId', (req, res) => {
    const existing = await db.getFlowByFlowId(req.params.flowId);
    if (!existing) return res.status(404).json({ error: 'Flow not found' });

    const { name, description, category, status, flow_json } = req.body;
    const flow = await db.updateFlow(req.params.flowId, {
        name: name ?? existing.name,
        description: description ?? existing.description,
        category: category ?? existing.category,
        status: status ?? existing.status,
        flow_json: typeof flow_json === 'string' ? flow_json : JSON.stringify(flow_json || JSON.parse(existing.flow_json || '{}')),
        meta_flow_id: existing.meta_flow_id,
        endpoint_url: existing.endpoint_url,
        token: existing.token,
    });
    res.json(flow);
});

// DELETE /api/flows/:flowId — Delete a flow
app.delete('/api/flows/:flowId', (req, res) => {
    const existing = await db.getFlowByFlowId(req.params.flowId);
    if (!existing) return res.status(404).json({ error: 'Flow not found' });
    await db.deleteFlow(req.params.flowId);
    res.json({ success: true });
});

// POST /api/flows/:flowId/publish — Publish flow to Meta (create + upload JSON + publish)
app.post('/api/flows/:flowId/publish', async (req, res) => {
    const existing = await db.getFlowByFlowId(req.params.flowId);
    if (!existing) return res.status(404).json({ error: 'Flow not found' });

    const accessToken = req.headers.authorization?.replace('Bearer ', '') || process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) return res.status(400).json({ error: 'No access token available' });

    const wabaId = process.env.META_WABA_ID;
    if (!wabaId) return res.status(400).json({ error: 'META_WABA_ID not configured in .env' });

    try {
        let metaFlowId = existing.meta_flow_id;

        // Step 1: Create flow on Meta if not exists
        if (!metaFlowId) {
            const createUrl = `https://graph.facebook.com/v19.0/${wabaId}/flows`;
            const createRes = await axios.post(createUrl, {
                name: existing.name,
                categories: [existing.category || 'CUSTOMER_SUPPORT'],
            }, {
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            });
            metaFlowId = createRes.data.id;
            await db.updateFlowMetaId(req.params.flowId, metaFlowId);
            console.log(`[Flow Publish] Created Meta flow: ${metaFlowId}`);
        }

        // Step 2: Upload flow JSON definition to Meta
        const flowJson = existing.flow_json || '{}';
        const assetUrl = `https://graph.facebook.com/v19.0/${metaFlowId}/flow_json`;

        try {
            await axios.post(assetUrl, {
                flow_json: flowJson,
            }, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            });
            console.log(`[Flow Publish] Uploaded flow JSON for ${metaFlowId}`);
        } catch (uploadErr) {
            // Try alternative upload method
            console.log('[Flow Publish] Trying alternative upload...');
            const altUrl = `https://graph.facebook.com/v19.0/${metaFlowId}`;
            await axios.post(altUrl, {
                flow_json: flowJson,
            }, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            });
        }

        // Step 3: Publish the flow
        const publishUrl = `https://graph.facebook.com/v19.0/${metaFlowId}/publish`;
        await axios.post(publishUrl, {}, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        });

        await db.updateFlowStatus(req.params.flowId, 'PUBLISHED');
        console.log(`[Flow Publish] Published flow ${metaFlowId}`);
        res.json({ success: true, meta_flow_id: metaFlowId, status: 'PUBLISHED' });
    } catch (err) {
        console.error('[Flow Publish] Error:', err.response?.data || err.message);
        const metaError = err.response?.data?.error;
        // Mark as published locally for offline testing
        await db.updateFlowStatus(req.params.flowId, 'PUBLISHED');
        res.json({
            success: true,
            warning: 'Marked as published locally.',
            meta_error: metaError?.message || err.message,
            meta_error_code: metaError?.code,
            meta_flow_id: existing.meta_flow_id,
        });
    }
});

// POST /api/flows/:flowId/send — Send flow message to a contact
app.post('/api/flows/:flowId/send', async (req, res) => {
    const { contact_id, header_text, body_text, footer_text, flow_cta } = req.body;
    const flow = await db.getFlowByFlowId(req.params.flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });

    const contact = await db.getContactById(parseInt(contact_id));
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const accessToken = req.headers.authorization?.replace('Bearer ', '') || process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const displayText = `[Flow] ${flow.name}`;

    // Save outgoing message
    const savedMsg = await db.addMessage({
        contact_id: contact.id,
        type: 'outgoing',
        text: displayText,
        media_type: 'text',
        status: 'sent',
    });

    const formatted = {
        id: savedMsg.id,
        type: 'outgoing',
        text: displayText,
        media_type: 'text',
        status: 'sent',
        time: formatTime(savedMsg.timestamp),
    };

    /* io.to.emit removed */
    /* io.emit removed */ });

    // Send via WhatsApp Cloud API as Flow message
    if (accessToken && phoneNumberId && contact.phone && !contact.is_group) {
        try {
            const metaFlowId = flow.meta_flow_id || flow.flow_id;
            const flowToken = Buffer.from(JSON.stringify({ flow_id: flow.flow_id, contact_id: contact.id })).toString('base64');
            const endpointUrl = flow.endpoint_url || `${req.protocol}://${req.get('host')}/api/flows/${flow.flow_id}/webhook`;

            const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
            const payload = {
                messaging_product: 'whatsapp',
                to: contact.phone.replace(/\D/g, ''),
                type: 'interactive',
                interactive: {
                    type: 'flow',
                    header: header_text ? { type: 'text', text: header_text } : undefined,
                    body: { text: body_text || `Please fill out this form: ${flow.name}` },
                    footer: footer_text ? { text: footer_text } : undefined,
                    action: {
                        name: 'flow',
                        parameters: {
                            flow_message_version: '3',
                            flow_token: flowToken,
                            flow_id: metaFlowId,
                            flow_cta: flow_cta || 'Start',
                            flow_action: 'navigate',
                            flow_action_payload: {
                                screen: 'QUESTION_ONE',
                            },
                        },
                    },
                },
            };

            const apiRes = await axios.post(url, payload, {
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            });

            const waId = apiRes.data?.messages?.[0]?.id;
            if (waId) {
                await db.markMessageDelivered(savedMsg.id);
                /* io.to.emit removed */
            }
        } catch (err) {
            console.error('[Send Flow Error]', err.response?.data || err.message);
        }
    }

    res.status(201).json(formatted);
});

// POST /api/flows/:flowId/webhook — Receive flow responses from Meta
app.post('/api/flows/:flowId/webhook', (req, res) => {
    res.status(200).json({ success: true });

    try {
        const { flow_id } = req.params;
        const { contact_id, screen_id, response } = req.body;

        if (contact_id) {
            await db.saveFlowResponse({
                flow_id,
                contact_id: parseInt(contact_id),
                screen_id: screen_id || null,
                response_json: JSON.stringify(response || req.body),
            });

            console.log(`[Flow Webhook] Response received for flow ${flow_id} from contact ${contact_id}`);

            // Notify clients via socket
            /* io.emit removed */,
                screen_id,
                response: response || req.body,
            });
        }
    } catch (err) {
        console.error('[Flow Webhook] Error:', err.message);
    }
});

// GET /api/flows/:flowId/responses — Get all responses for a flow
app.get('/api/flows/:flowId/responses', (req, res) => {
    const flow = await db.getFlowByFlowId(req.params.flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(await db.getFlowResponses(req.params.flowId));
});

// GET /api/flows/:flowId/responses/:contactId — Get responses for a flow from a specific contact
app.get('/api/flows/:flowId/responses/:contactId', (req, res) => {
    const flow = await db.getFlowByFlowId(req.params.flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(await db.getFlowResponsesByContact(req.params.flowId, parseInt(req.params.contactId)));
});

// GET /api/flows/:flowId/stats — Get flow analytics
app.get('/api/flows/:flowId/stats', (req, res) => {
    const flow = await db.getFlowByFlowId(req.params.flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });

    const responses = await db.getFlowResponses(req.params.flowId);
    const uniqueContacts = new Set(responses.map(r => r.contact_id));

    res.json({
        flow_id: req.params.flowId,
        flow_name: flow.name,
        status: flow.status,
        total_responses: responses.length,
        unique_respondents: uniqueContacts.size,
        last_response_at: responses.length > 0 ? responses[0].received_at : null,
        created_at: flow.created_at,
    });
});

// GET /api/flows/templates — Get pre-built flow templates
app.get('/api/flows/templates', (req, res) => {
    res.json([
        {
            id: 'contact_us',
            name: 'Contact Us',
            description: 'Simple contact form with name, email, and message',
            category: 'CONTACT_US',
            flow_json: {
                version: '5.0',
                screens: [
                    {
                        id: 'CONTACT_FORM',
                        title: 'Contact Us',
                        data: {},
                        layout: {
                            type: 'SingleColumnLayout',
                            children: [
                                { type: 'TextHeading', text: 'Contact Us' },
                                { type: 'TextBody', text: 'We will get back to you shortly.' },
                                { type: 'TextInput', label: 'Full Name', name: 'full_name', required: true, 'input-type': 'text' },
                                { type: 'TextInput', label: 'Email Address', name: 'email', required: true, 'input-type': 'email' },
                                { type: 'TextArea', label: 'Your Message', name: 'message', required: true },
                                { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: {} } }
                            ]
                        }
                    }
                ]
            }
        },
        {
            id: 'lead_gen',
            name: 'Lead Generation',
            description: 'Capture leads with phone, email, and interest selection',
            category: 'LEAD_GENERATION',
            flow_json: {
                version: '5.0',
                screens: [
                    {
                        id: 'LEAD_CAPTURE',
                        title: 'Get a Quote',
                        data: {},
                        layout: {
                            type: 'SingleColumnLayout',
                            children: [
                                { type: 'TextHeading', text: 'Get a Free Quote' },
                                { type: 'TextBody', text: 'Fill in your details and we will reach out.' },
                                { type: 'TextInput', label: 'Full Name', name: 'name', required: true, 'input-type': 'text' },
                                { type: 'TextInput', label: 'Phone Number', name: 'phone', required: true, 'input-type': 'phone' },
                                { type: 'TextInput', label: 'Email', name: 'email', required: false, 'input-type': 'email' },
                                {
                                    type: 'Dropdown',
                                    label: 'What are you interested in?',
                                    name: 'interest',
                                    required: true,
                                    'data-source': [
                                        { id: 'prod1', title: 'Product A' },
                                        { id: 'prod2', title: 'Product B' },
                                        { id: 'service', title: 'Service' }
                                    ]
                                },
                                { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: {} } }
                            ]
                        }
                    }
                ]
            }
        },
        {
            id: 'appointment',
            name: 'Appointment Booking',
            description: 'Book an appointment with date and time selection',
            category: 'APPOINTMENT_BOOKING',
            flow_json: {
                version: '5.0',
                screens: [
                    {
                        id: 'BOOKING',
                        title: 'Book Appointment',
                        data: {},
                        layout: {
                            type: 'SingleColumnLayout',
                            children: [
                                { type: 'TextHeading', text: 'Book an Appointment' },
                                { type: 'TextBody', text: 'Select a date and time that works for you.' },
                                { type: 'TextInput', label: 'Your Name', name: 'name', required: true, 'input-type': 'text' },
                                { type: 'DatePicker', label: 'Preferred Date', name: 'date', required: true },
                                {
                                    type: 'Dropdown',
                                    label: 'Preferred Time',
                                    name: 'time_slot',
                                    required: true,
                                    'data-source': [
                                        { id: 'morning', title: '9:00 AM - 11:00 AM' },
                                        { id: 'afternoon', title: '12:00 PM - 2:00 PM' },
                                        { id: 'evening', title: '3:00 PM - 5:00 PM' }
                                    ]
                                },
                                { type: 'Footer', label: 'Book Now', 'on-click-action': { name: 'complete', payload: {} } }
                            ]
                        }
                    }
                ]
            }
        },
        {
            id: 'survey',
            name: 'Customer Survey',
            description: 'Collect feedback with ratings and comments',
            category: 'CUSTOM',
            flow_json: {
                version: '5.0',
                screens: [
                    {
                        id: 'SURVEY',
                        title: 'Feedback',
                        data: {},
                        layout: {
                            type: 'SingleColumnLayout',
                            children: [
                                { type: 'TextHeading', text: 'Customer Feedback' },
                                { type: 'TextBody', text: 'Help us improve by sharing your experience.' },
                                {
                                    type: 'RadioButtonsGroup',
                                    label: 'How satisfied are you?',
                                    name: 'satisfaction',
                                    required: true,
                                    'data-source': [
                                        { id: '5', title: 'Very Satisfied' },
                                        { id: '4', title: 'Satisfied' },
                                        { id: '3', title: 'Neutral' },
                                        { id: '2', title: 'Dissatisfied' },
                                        { id: '1', title: 'Very Dissatisfied' }
                                    ]
                                },
                                {
                                    type: 'CheckboxGroup',
                                    label: 'What did you like?',
                                    name: 'liked',
                                    'data-source': [
                                        { id: 'quality', title: 'Product Quality' },
                                        { id: 'service', title: 'Customer Service' },
                                        { id: 'price', title: 'Pricing' },
                                        { id: 'speed', title: 'Delivery Speed' }
                                    ]
                                },
                                { type: 'TextArea', label: 'Additional Comments', name: 'comments' },
                                { type: 'Footer', label: 'Submit Feedback', 'on-click-action': { name: 'complete', payload: {} } }
                            ]
                        }
                    }
                ]
            }
        },
        {
            id: 'signup',
            name: 'Sign Up Form',
            description: 'User registration with validation',
            category: 'SIGN_UP',
            flow_json: {
                version: '5.0',
                screens: [
                    {
                        id: 'SIGNUP',
                        title: 'Sign Up',
                        data: {},
                        layout: {
                            type: 'SingleColumnLayout',
                            children: [
                                { type: 'TextHeading', text: 'Create Account' },
                                { type: 'TextBody', text: 'Join us today! Fill in your details below.' },
                                { type: 'TextInput', label: 'Full Name', name: 'full_name', required: true, 'input-type': 'text' },
                                { type: 'TextInput', label: 'Email', name: 'email', required: true, 'input-type': 'email' },
                                { type: 'TextInput', label: 'Phone', name: 'phone', required: true, 'input-type': 'phone' },
                                {
                                    type: 'RadioButtonsGroup',
                                    label: 'Account Type',
                                    name: 'account_type',
                                    required: true,
                                    'data-source': [
                                        { id: 'personal', title: 'Personal' },
                                        { id: 'business', title: 'Business' }
                                    ]
                                },
                                { type: 'Footer', label: 'Sign Up', 'on-click-action': { name: 'complete', payload: {} } }
                            ]
                        }
                    }
                ]
            }
        }
    ]);
});

// POST /api/flows/templates/:templateId/create — Create flow from template
app.post('/api/flows/templates/:templateId/create', (req, res) => {
    const templateId = req.params.templateId;

    // Fetch templates
    const templates = {
        contact_us: { name: 'Contact Us', category: 'CONTACT_US', description: 'Simple contact form' },
        lead_gen: { name: 'Lead Generation', category: 'LEAD_GENERATION', description: 'Capture leads' },
        appointment: { name: 'Appointment Booking', category: 'APPOINTMENT_BOOKING', description: 'Book appointments' },
        survey: { name: 'Customer Survey', category: 'CUSTOM', description: 'Collect feedback' },
        signup: { name: 'Sign Up Form', category: 'SIGN_UP', description: 'User registration' },
    };

    const template = templates[templateId];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    // Get the full template JSON from the templates list
    // We re-use the GET /api/flows/templates endpoint logic inline
    const templateMap = {
        contact_us: {
            version: '5.0', screens: [{
                id: 'CONTACT_FORM', title: 'Contact Us', data: {},
                layout: { type: 'SingleColumnLayout', children: [
                    { type: 'TextHeading', text: 'Contact Us' },
                    { type: 'TextBody', text: 'We will get back to you shortly.' },
                    { type: 'TextInput', label: 'Full Name', name: 'full_name', required: true, 'input-type': 'text' },
                    { type: 'TextInput', label: 'Email Address', name: 'email', required: true, 'input-type': 'email' },
                    { type: 'TextArea', label: 'Your Message', name: 'message', required: true },
                    { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: {} } }
                ]}
            }]
        },
        lead_gen: {
            version: '5.0', screens: [{
                id: 'LEAD_CAPTURE', title: 'Get a Quote', data: {},
                layout: { type: 'SingleColumnLayout', children: [
                    { type: 'TextHeading', text: 'Get a Free Quote' },
                    { type: 'TextBody', text: 'Fill in your details and we will reach out.' },
                    { type: 'TextInput', label: 'Full Name', name: 'name', required: true, 'input-type': 'text' },
                    { type: 'TextInput', label: 'Phone Number', name: 'phone', required: true, 'input-type': 'phone' },
                    { type: 'TextInput', label: 'Email', name: 'email', required: false, 'input-type': 'email' },
                    { type: 'Dropdown', label: 'Interest', name: 'interest', required: true, 'data-source': [{ id: 'a', title: 'Product A' }, { id: 'b', title: 'Product B' }] },
                    { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: {} } }
                ]}
            }]
        },
        appointment: {
            version: '5.0', screens: [{
                id: 'BOOKING', title: 'Book Appointment', data: {},
                layout: { type: 'SingleColumnLayout', children: [
                    { type: 'TextHeading', text: 'Book an Appointment' },
                    { type: 'TextInput', label: 'Your Name', name: 'name', required: true, 'input-type': 'text' },
                    { type: 'DatePicker', label: 'Preferred Date', name: 'date', required: true },
                    { type: 'Dropdown', label: 'Time Slot', name: 'time_slot', required: true, 'data-source': [{ id: 'am', title: 'Morning' }, { id: 'pm', title: 'Afternoon' }] },
                    { type: 'Footer', label: 'Book Now', 'on-click-action': { name: 'complete', payload: {} } }
                ]}
            }]
        },
        survey: {
            version: '5.0', screens: [{
                id: 'SURVEY', title: 'Feedback', data: {},
                layout: { type: 'SingleColumnLayout', children: [
                    { type: 'TextHeading', text: 'Customer Feedback' },
                    { type: 'RadioButtonsGroup', label: 'Satisfaction', name: 'satisfaction', required: true, 'data-source': [{ id: '5', title: 'Very Satisfied' }, { id: '1', title: 'Very Dissatisfied' }] },
                    { type: 'TextArea', label: 'Comments', name: 'comments' },
                    { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: {} } }
                ]}
            }]
        },
        signup: {
            version: '5.0', screens: [{
                id: 'SIGNUP', title: 'Sign Up', data: {},
                layout: { type: 'SingleColumnLayout', children: [
                    { type: 'TextHeading', text: 'Create Account' },
                    { type: 'TextInput', label: 'Full Name', name: 'full_name', required: true, 'input-type': 'text' },
                    { type: 'TextInput', label: 'Email', name: 'email', required: true, 'input-type': 'email' },
                    { type: 'TextInput', label: 'Phone', name: 'phone', required: true, 'input-type': 'phone' },
                    { type: 'Footer', label: 'Sign Up', 'on-click-action': { name: 'complete', payload: {} } }
                ]}
            }]
        },
    };

    const flowJson = templateMap[templateId];
    if (!flowJson) return res.status(404).json({ error: 'Template data not found' });

    const flowId = 'flow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const flow = await db.createFlow({
        flow_id: flowId,
        name: req.body.name || template.name,
        description: template.description,
        category: template.category,
        flow_json: JSON.stringify(flowJson),
    });

    res.status(201).json(flow);
});

// POST /api/flows/validate-token — Validate a flow token (for webhook security)
app.post('/api/flows/validate-token', (req, res) => {
    const { flow_token } = req.body;
    if (!flow_token) return res.status(400).json({ valid: false, error: 'No token provided' });

    try {
        const decoded = Buffer.from(flow_token, 'base64').toString('utf8');
        const data = JSON.parse(decoded);

        if (!data.flow_id) return res.json({ valid: false, error: 'Missing flow_id in token' });

        const flow = await db.getFlowByFlowId(data.flow_id);
        if (!flow) return res.json({ valid: false, error: 'Flow not found' });

        res.json({
            valid: true,
            flow_id: data.flow_id,
            contact_id: data.contact_id,
            flow_name: flow.name,
        });
    } catch (err) {
        res.json({ valid: false, error: 'Invalid token format' });
    }
});

// ─── 404 fallback (for SPA) ───────────────────────────────────────────────────

app.get('/{*path}', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────

// Crash protection — keep running on uncaught errors
process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (err) => {
    console.error('[Unhandled Rejection]', err);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down...');
});

process.on('SIGINT', () => {
    console.log('[Server] SIGINT received, shutting down...');
});


const functions = require('firebase-functions/v2');
exports.api = functions.https.onRequest(app);
