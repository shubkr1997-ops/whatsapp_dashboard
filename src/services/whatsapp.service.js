const axios = require("axios");
const fs = require('fs');
const path = require('path');
const admin = require("firebase-admin");
const bucket = admin.storage().bucket();

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

module.exports = {
    sendViaWhatsApp,
    downloadWhatsAppMedia,
    sendImageViaWhatsApp,
    sendVideoViaWhatsApp,
    uploadMediaToMeta
};
