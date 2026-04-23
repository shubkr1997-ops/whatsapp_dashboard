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

// ─── ROUTES: Catalog Integration ──────────────────────────────────────────────

// POST /api/catalog/auth — Initiate Meta OAuth / Embedded Signup
router.post('/catalog/auth', async (req, res) => {
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
router.get('/catalog/catalogs', async (req, res) => {
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
router.post('/catalog/connect', async (req, res) => {
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
router.get('/catalog/products/:catalogId', async (req, res) => {
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
router.post('/catalog/send-product', async (req, res) => {
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
    /* io.emit removed */

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
router.post('/catalog/send-catalog', async (req, res) => {
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
    /* io.emit removed */

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
router.delete('/catalog/disconnect/:catalogId', async (req, res) => {
    const { catalogId } = req.params;
    await db.deleteCatalog(catalogId);
    res.json({ success: true });
});

// GET /api/catalog/list — List locally stored catalogs
router.get('/catalog/list', async (req, res) => {
    const catalogs = await db.getAllCatalogs();
    res.json(catalogs);
});

module.exports = router;
