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

// ─── ROUTES: Meta Flows ───────────────────────────────────────────────────────

// GET /api/flows — List all flows
router.get('/flows', async (req, res) => {
    res.json(await db.getAllFlows());
});

// GET /api/flows/:flowId — Get single flow
router.get('/flows/:flowId', async (req, res) => {
    const flow = await db.getFlowByFlowId(req.params.flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(flow);
});

// POST /api/flows — Create a new flow
router.post('/flows', async (req, res) => {
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
router.put('/flows/:flowId', async (req, res) => {
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
router.delete('/flows/:flowId', async (req, res) => {
    const existing = await db.getFlowByFlowId(req.params.flowId);
    if (!existing) return res.status(404).json({ error: 'Flow not found' });
    await db.deleteFlow(req.params.flowId);
    res.json({ success: true });
});

// POST /api/flows/:flowId/publish — Publish flow to Meta (create + upload JSON + publish)
router.post('/flows/:flowId/publish', async (req, res) => {
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
router.post('/flows/:flowId/send', async (req, res) => {
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
    /* io.emit removed */

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
router.post('/flows/:flowId/webhook', async (req, res) => {
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
            /* io.emit removed */
            //    screen_id,
            //    response: response || req.body,
            // });
        }
    } catch (err) {
        console.error('[Flow Webhook] Error:', err.message);
    }
});

// GET /api/flows/:flowId/responses — Get all responses for a flow
router.get('/flows/:flowId/responses', async (req, res) => {
    const flow = await db.getFlowByFlowId(req.params.flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(await db.getFlowResponses(req.params.flowId));
});

// GET /api/flows/:flowId/responses/:contactId — Get responses for a flow from a specific contact
router.get('/flows/:flowId/responses/:contactId', async (req, res) => {
    const flow = await db.getFlowByFlowId(req.params.flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(await db.getFlowResponsesByContact(req.params.flowId, parseInt(req.params.contactId)));
});

// GET /api/flows/:flowId/stats — Get flow analytics
router.get('/flows/:flowId/stats', async (req, res) => {
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
router.get('/flows/templates', (req, res) => {
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
router.post('/flows/templates/:templateId/create', async (req, res) => {
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
router.post('/flows/validate-token', async (req, res) => {
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

module.exports = router;
