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

// ─── ROUTES: Webhook (Inbound) ────────────────────────────────────────────────

// GET /api/webhook — Meta webhook verification challenge
router.get('/webhook', (req, res) => {
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
router.post('/webhook', async (req, res) => {
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
                        const downloaded = await whatsappService.downloadWhatsAppMedia(waMediaId);
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
                console.log('[Socket] New contact created:', newContactData);
                /* io.emit removed — use Firestore real-time listeners on client */
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

            // AI Agent: process incoming message if conversation is in AI mode
            processIncomingMessage(contact.id, text, contact, null, mediaUrl, mediaMime)
                .then((aiMsg) => {
                    if (!aiMsg) return; // human mode or error

                    const aiFormatted = {
                        id:     aiMsg.id,
                        type:   'outgoing',
                        text:   aiMsg.text,
                        status: aiMsg.status,
                        time:   formatTime(aiMsg.timestamp),
                    };

                    // Send AI reply via WhatsApp API
                    if (contact.phone && !contact.is_group) {
                        whatsappService.sendViaWhatsApp(contact.phone, aiMsg.text)
                            .then(async (apiRes) => {
                                const waId = apiRes?.messages?.[0]?.id;
                                if (waId && !apiRes.simulated) {
                                    await db.markMessageDelivered(aiMsg.id);
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
router.post('/simulate/receive', async (req, res) => {
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

    // AI Agent: process simulated incoming if conversation is in AI mode
    processIncomingMessage(contact.id, text, contact, null)
        .then((aiMsg) => {
            if (!aiMsg) return;
            const aiFormatted = {
                id: aiMsg.id, type: 'outgoing', text: aiMsg.text,
                status: aiMsg.status, time: formatTime(aiMsg.timestamp),
            };
        })
        .catch((err) => console.error('[AI Engine] Simulate processing error:', err.message));

    res.status(201).json({ success: true, message: formatted });
});

module.exports = router;
