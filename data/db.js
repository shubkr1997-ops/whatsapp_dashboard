'use strict';
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
}

const db = admin.firestore();

// ─── High-Level API (Firestore Implementation) ────────────────────────────────

module.exports = {
    // --- Contacts ---
    async getAllContacts() {
        const snapshot = await db.collection('contacts').orderBy('created_at', 'desc').get();
        // Note: Joining with last message in Firestore usually involves denormalization.
        // For now, we perform a flat fetch and sort favorites in memory.
        const contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort favorites first, then by creation date
        return contacts.sort((a, b) => {
            if (a.is_favorite && !b.is_favorite) return -1;
            if (!a.is_favorite && b.is_favorite) return 1;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
    },

    async getContactById(id) {
        const doc = await db.collection('contacts').doc(String(id)).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },

    async getContactByPhone(phone) {
        const snapshot = await db.collection('contacts').where('phone', '==', phone).limit(1).get();
        if (snapshot.empty) return null;
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    },

    async createContact({ name, phone = null, avatar = null, status = 'Offline', about = 'Hey there!', is_group = 0 }) {
        const data = {
            name,
            phone,
            avatar,
            status,
            about,
            is_group,
            is_favorite: 0,
            created_at: new Date().toISOString()
        };
        const ref = await db.collection('contacts').add(data);
        return { id: ref.id, ...data };
    },

    async updateContactStatus(id, status) {
        await db.collection('contacts').doc(String(id)).update({ status });
    },

    async updateFavorite(id, isFavorite) {
        await db.collection('contacts').doc(String(id)).update({ is_favorite: isFavorite ? 1 : 0 });
    },

    // --- Messages ---
    async getMessages(contactId) {
        const snapshot = await db.collection('messages')
            .where('contact_id', '==', String(contactId))
            .orderBy('created_at', 'asc')
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    async addMessage(data) {
        const messageData = {
            ...data,
            contact_id: String(data.contact_id),
            timestamp: new Date().toISOString(),
            created_at: Date.now() / 1000
        };
        const ref = await db.collection('messages').add(messageData);
        
        // Denormalize last message onto contact for better performance
        await db.collection('contacts').doc(String(data.contact_id)).update({
            lastMessage: messageData.text,
            lastTime: messageData.timestamp
        }).catch(() => {}); // Ignore if contact doesn't exist

        return { id: ref.id, ...messageData };
    },

    async markMessagesRead(contactId) {
        const snapshot = await db.collection('messages')
            .where('contact_id', '==', String(contactId))
            .where('type', '==', 'incoming')
            .where('status', '!=', 'read')
            .get();
        
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { status: 'read' });
        });
        await batch.commit();
    },

    async markMessageDelivered(msgId) {
        if (!msgId) return;
        await db.collection('messages').doc(String(msgId)).update({ status: 'delivered' });
    },

    // --- Agent Configs ---
    async getAllAgentConfigs() {
        const snapshot = await db.collection('agent_configs').orderBy('created_at', 'desc').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    async getAgentConfigById(id) {
        const doc = await db.collection('agent_configs').doc(String(id)).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },

    async getDefaultAgentConfig() {
        const snapshot = await db.collection('agent_configs').where('is_default', '==', 1).limit(1).get();
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    },

    async createAgentConfig(data) {
        if (data.is_default) {
            await this.clearDefaultFlags();
        }
        const configData = {
            ...data,
            created_at: new Date().toISOString()
        };
        const ref = await db.collection('agent_configs').add(configData);
        return { id: ref.id, ...configData };
    },

    async updateAgentConfig(id, data) {
        if (data.is_default) {
            await this.clearDefaultFlags();
        }
        await db.collection('agent_configs').doc(String(id)).update(data);
        return { id, ...data };
    },

    async deleteAgentConfig(id) {
        await db.collection('agent_configs').doc(String(id)).delete();
    },

    async clearDefaultFlags() {
        const snapshot = await db.collection('agent_configs').where('is_default', '==', 1).get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { is_default: 0 });
        });
        await batch.commit();
    },

    // --- Conversation Modes ---
    async getConversationMode(contactId) {
        const doc = await db.collection('conversation_modes').doc(String(contactId)).get();
        if (!doc.exists) return null;
        const data = doc.data();
        
        // Fetch agent config details if linked
        if (data.agent_config_id) {
            const agent = await this.getAgentConfigById(data.agent_config_id);
            if (agent) Object.assign(data, agent);
        }
        return { id: doc.id, ...data };
    },

    async setConversationMode({ contact_id, mode = 'human', agent_config_id = null, auto_handover = 0 }) {
        const data = {
            contact_id: String(contact_id),
            mode,
            agent_config_id: agent_config_id ? String(agent_config_id) : null,
            auto_handover,
            updated_at: new Date().toISOString()
        };
        await db.collection('conversation_modes').doc(String(contact_id)).set(data, { merge: true });
        return this.getConversationMode(contact_id);
    },

    // --- Conversation History ---
    async getConversationHistory(contactId) {
        const snapshot = await db.collection('conversation_history')
            .where('contact_id', '==', String(contactId))
            .orderBy('created_at', 'asc')
            .get();
        return snapshot.docs.map(doc => doc.data());
    },

    async addToHistory({ contact_id, role, content }) {
        await db.collection('conversation_history').add({
            contact_id: String(contact_id),
            role,
            content,
            created_at: new Date().toISOString()
        });
    },

    async clearHistory(contactId) {
        const snapshot = await db.collection('conversation_history')
            .where('contact_id', '==', String(contactId))
            .get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    },

    // --- MCP Servers ---
    async getMcpServersByAgent(agentId) {
        const snapshot = await db.collection('mcp_servers')
            .where('agent_config_id', '==', String(agentId))
            .orderBy('created_at', 'desc')
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    async addMcpServer({ agent_config_id, type, name, config_json }) {
        const data = {
            agent_config_id: String(agent_config_id),
            type,
            name,
            config_json,
            created_at: new Date().toISOString()
        };
        const ref = await db.collection('mcp_servers').add(data);
        return { id: ref.id, ...data };
    },

    async deleteMcpServer(id) {
        await db.collection('mcp_servers').doc(String(id)).delete();
    },

    // --- Catalogs ---
    async upsertCatalog({ business_id, waba_id, catalog_id, access_token, name }) {
        const data = {
            business_id: business_id || null,
            waba_id: waba_id || null,
            catalog_id: String(catalog_id),
            access_token: access_token || null,
            name: name || '',
            updated_at: new Date().toISOString()
        };
        await db.collection('catalogs').doc(String(catalog_id)).set(data, { merge: true });
        return { id: catalog_id, ...data };
    },

    async getAllCatalogs() {
        const snapshot = await db.collection('catalogs').orderBy('updated_at', 'desc').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    async deleteCatalog(catalogId) {
        await db.collection('catalogs').doc(String(catalogId)).delete();
        // Also delete all products for this catalog
        const snapshot = await db.collection('products').where('catalog_id', '==', String(catalogId)).get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    },

    // --- Products ---
    async upsertProduct({ catalog_id, product_id, name, price, image_url, description, retailer_id }) {
        const data = {
            catalog_id: String(catalog_id),
            product_id: String(product_id),
            name: name || '',
            price: price || '',
            image_url: image_url || '',
            description: description || '',
            retailer_id: retailer_id || String(product_id),
            updated_at: new Date().toISOString()
        };
        await db.collection('products').doc(String(product_id)).set(data, { merge: true });
        return { id: product_id, ...data };
    },

    async getProductsByCatalog(catalogId) {
        const snapshot = await db.collection('products')
            .where('catalog_id', '==', String(catalogId))
            .orderBy('updated_at', 'desc')
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    async clearProductsForCatalog(catalogId) {
        const snapshot = await db.collection('products').where('catalog_id', '==', String(catalogId)).get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
};
