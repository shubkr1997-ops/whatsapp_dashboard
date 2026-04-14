'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        phone       TEXT    UNIQUE,
        avatar      TEXT,
        status      TEXT    DEFAULT 'Offline',
        about       TEXT    DEFAULT 'Hey there! I am using WhatsApp.',
        is_group    INTEGER DEFAULT 0,
        is_favorite INTEGER DEFAULT 0,
        created_at  TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type        TEXT    NOT NULL CHECK(type IN ('incoming','outgoing')),
        text        TEXT    NOT NULL DEFAULT '',
        media_type  TEXT    DEFAULT 'text' CHECK(media_type IN ('text','image','video','document','audio')),
        media_url   TEXT,
        media_mime  TEXT,
        caption     TEXT,
        wa_media_id TEXT,
        status      TEXT    DEFAULT 'sent' CHECK(status IN ('sent','delivered','read','failed')),
        timestamp   TEXT    DEFAULT (datetime('now','localtime')),
        created_at  REAL    DEFAULT (unixepoch('now','subsec'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_configs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        agent_type      TEXT    NOT NULL CHECK(agent_type IN ('customer_support','sales','general','custom')),
        provider        TEXT    NOT NULL CHECK(provider IN ('openai','gemini','ollama','chatgpt','lmstudio')),
        model           TEXT    NOT NULL DEFAULT 'gpt-4o',
        system_prompt   TEXT    NOT NULL,
        temperature     REAL    DEFAULT 0.7,
        max_tokens      INTEGER DEFAULT 1024,
        base_url        TEXT,
        is_default      INTEGER DEFAULT 0,
        created_at      TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS conversation_modes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id      INTEGER NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
        mode            TEXT    NOT NULL DEFAULT 'human' CHECK(mode IN ('human','ai')),
        agent_config_id INTEGER REFERENCES agent_configs(id) ON DELETE SET NULL,
        auto_handover   INTEGER DEFAULT 0,
        updated_at      TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS conversation_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        role            TEXT    NOT NULL CHECK(role IN ('system','user','assistant')),
        content         TEXT    NOT NULL,
        created_at      TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_conv_history_contact ON conversation_history(contact_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS calls (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type            TEXT    NOT NULL CHECK(type IN ('audio','video')),
        direction       TEXT    NOT NULL CHECK(direction IN ('incoming','outgoing')),
        status          TEXT    NOT NULL DEFAULT 'ongoing' CHECK(status IN ('ongoing','completed','missed','failed')),
        duration        INTEGER DEFAULT 0, -- in seconds
        started_at      TEXT    DEFAULT (datetime('now','localtime')),
        ended_at        TEXT,
        created_at      TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_calls_contact ON calls(contact_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS catalogs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id     TEXT,
        waba_id         TEXT,
        catalog_id      TEXT    NOT NULL UNIQUE,
        access_token    TEXT,
        name            TEXT    DEFAULT '',
        connected_at    TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS products (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id      TEXT    NOT NULL,
        product_id      TEXT    NOT NULL,
        name            TEXT    NOT NULL DEFAULT '',
        price           TEXT    DEFAULT '',
        image_url       TEXT    DEFAULT '',
        description     TEXT    DEFAULT '',
        retailer_id     TEXT    DEFAULT '',
        synced_at       TEXT    DEFAULT (datetime('now','localtime')),
        UNIQUE(catalog_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(catalog_id);

    CREATE TABLE IF NOT EXISTS flows (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        flow_id         TEXT    NOT NULL UNIQUE,
        name            TEXT    NOT NULL DEFAULT 'Untitled Flow',
        description     TEXT    DEFAULT '',
        category        TEXT    DEFAULT 'CUSTOMER_SUPPORT',
        status          TEXT    DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
        flow_json       TEXT    DEFAULT '{}',
        meta_flow_id    TEXT,
        endpoint_url    TEXT,
        token           TEXT,
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        updated_at      TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS flow_responses (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        flow_id         TEXT    NOT NULL,
        contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        screen_id       TEXT,
        response_json   TEXT    NOT NULL DEFAULT '{}',
        received_at     TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_flow_responses_flow ON flow_responses(flow_id);
    CREATE INDEX IF NOT EXISTS idx_flow_responses_contact ON flow_responses(contact_id);

    CREATE TABLE IF NOT EXISTS knowledge_base (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id        INTEGER REFERENCES agent_configs(id) ON DELETE CASCADE,
        type            TEXT    NOT NULL CHECK(type IN ('pdf','csv','google_sheet')),
        name            TEXT    NOT NULL,
        file_path       TEXT,
        content         TEXT,
        sheet_id        TEXT,
        sheet_url       TEXT,
        credentials     TEXT,
        last_synced     TEXT,
        record_count    INTEGER DEFAULT 0,
        created_at      TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge_base(agent_id);

    CREATE TABLE IF NOT EXISTS mcp_servers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_config_id INTEGER REFERENCES agent_configs(id) ON DELETE CASCADE,
        type            TEXT    NOT NULL CHECK(type IN ('google_sheet')),
        name            TEXT    NOT NULL,
        config_json     TEXT    NOT NULL DEFAULT '{}',
        created_at      TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_servers_agent ON mcp_servers(agent_config_id);

    -- Migration: Add is_favorite if it doesn't exist (handle legacy databases)
    PRAGMA table_info(contacts);
`);

// Simple migration check for existing databases
try {
    db.exec(`ALTER TABLE contacts ADD COLUMN is_favorite INTEGER DEFAULT 0`);
} catch (e) {
    // If it already exists, ignore the error
    if (!e.message.includes('duplicate column name')) {
        console.error('[DB Migration Error]', e.message);
    }
}

// Migration: Add base_url to agent_configs if it doesn't exist
try {
    db.exec(`ALTER TABLE agent_configs ADD COLUMN base_url TEXT`);
} catch (e) {
    if (!e.message.includes('duplicate column name')) {
        console.error('[DB Migration Error base_url]', e.message);
    }
}

// ─── Contact Helpers ──────────────────────────────────────────────────────────

const stmts = {
    getAllContacts: db.prepare(`
        SELECT
            c.*,
            m.text        AS lastMessage,
            m.timestamp   AS lastTime,
            COUNT(CASE WHEN m2.type = 'incoming' AND m2.status != 'read' THEN 1 END) AS unread
        FROM contacts c
        LEFT JOIN messages m ON m.id = (
            SELECT id FROM messages WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1
        )
        LEFT JOIN messages m2 ON m2.contact_id = c.id
        GROUP BY c.id
        ORDER BY c.is_favorite DESC, m.created_at DESC, c.created_at DESC
    `),

    getContactById: db.prepare(`SELECT * FROM contacts WHERE id = ?`),

    getContactByPhone: db.prepare(`SELECT * FROM contacts WHERE phone = ?`),

    insertContact: db.prepare(`
        INSERT INTO contacts (name, phone, avatar, status, about, is_group)
        VALUES (@name, @phone, @avatar, @status, @about, @is_group)
    `),

    updateContactStatus: db.prepare(`UPDATE contacts SET status = ? WHERE id = ?`),

    updateFavorite: db.prepare(`UPDATE contacts SET is_favorite = ? WHERE id = ?`),

    // ─── Message Helpers ─────────────────────────────────────────────────────
    getMessages: db.prepare(`
        SELECT * FROM messages WHERE contact_id = ? ORDER BY created_at ASC
    `),

    insertMessage: db.prepare(`
        INSERT INTO messages (contact_id, type, text, media_type, media_url, media_mime, caption, wa_media_id, status)
        VALUES (@contact_id, @type, @text, @media_type, @media_url, @media_mime, @caption, @wa_media_id, @status)
        RETURNING *
    `),

    markRead: db.prepare(`
        UPDATE messages SET status = 'read'
        WHERE contact_id = ? AND type = 'incoming' AND status != 'read'
    `),

    markDelivered: db.prepare(`UPDATE messages SET status = 'delivered' WHERE id = ?`),

    // ─── Agent Config Helpers ──────────────────────────────────────────────
    getAllAgentConfigs: db.prepare(`SELECT * FROM agent_configs ORDER BY created_at DESC`),

    getAgentConfigById: db.prepare(`SELECT * FROM agent_configs WHERE id = ?`),

    getDefaultAgentConfig: db.prepare(`SELECT * FROM agent_configs WHERE is_default = 1 LIMIT 1`),

    insertAgentConfig: db.prepare(`
        INSERT INTO agent_configs (name, agent_type, provider, model, system_prompt, temperature, max_tokens, base_url, is_default)
        VALUES (@name, @agent_type, @provider, @model, @system_prompt, @temperature, @max_tokens, @base_url, @is_default)
    `),

    updateAgentConfig: db.prepare(`
        UPDATE agent_configs SET name=@name, agent_type=@agent_type, provider=@provider, model=@model,
        system_prompt=@system_prompt, temperature=@temperature, max_tokens=@max_tokens, base_url=@base_url, is_default=@is_default
        WHERE id=@id
    `),

    deleteAgentConfig: db.prepare(`DELETE FROM agent_configs WHERE id = ?`),

    clearDefaultFlags: db.prepare(`UPDATE agent_configs SET is_default = 0`),

    // ─── Conversation Mode Helpers ─────────────────────────────────────────
    getConversationMode: db.prepare(`
        SELECT cm.*, ac.name as agent_name, ac.agent_type, ac.provider, ac.model, ac.system_prompt, ac.temperature, ac.max_tokens
        FROM conversation_modes cm
        LEFT JOIN agent_configs ac ON cm.agent_config_id = ac.id
        WHERE cm.contact_id = ?
    `),

    upsertConversationMode: db.prepare(`
        INSERT INTO conversation_modes (contact_id, mode, agent_config_id, auto_handover)
        VALUES (@contact_id, @mode, @agent_config_id, @auto_handover)
        ON CONFLICT(contact_id) DO UPDATE SET
            mode = @mode, agent_config_id = @agent_config_id, auto_handover = @auto_handover,
            updated_at = datetime('now','localtime')
    `),

    // ─── Conversation History Helpers ──────────────────────────────────────
    getConversationHistory: db.prepare(`
        SELECT role, content FROM conversation_history
        WHERE contact_id = ? ORDER BY created_at ASC
    `),

    insertConversationHistory: db.prepare(`
        INSERT INTO conversation_history (contact_id, role, content)
        VALUES (@contact_id, @role, @content)
    `),

    clearConversationHistory: db.prepare(`DELETE FROM conversation_history WHERE contact_id = ?`),

    trimConversationHistory: db.prepare(`
        DELETE FROM conversation_history WHERE id IN (
            SELECT id FROM conversation_history WHERE contact_id = ?
            ORDER BY created_at ASC LIMIT ?
        )
    `),

    // ─── Catalog Helpers ─────────────────────────────────────────────────────
    getAllCatalogs: db.prepare(`SELECT * FROM catalogs ORDER BY connected_at DESC`),

    getCatalogById: db.prepare(`SELECT * FROM catalogs WHERE catalog_id = ?`),

    insertCatalog: db.prepare(`
        INSERT OR REPLACE INTO catalogs (business_id, waba_id, catalog_id, access_token, name)
        VALUES (@business_id, @waba_id, @catalog_id, @access_token, @name)
    `),

    deleteCatalog: db.prepare(`DELETE FROM catalogs WHERE catalog_id = ?`),

    updateCatalogToken: db.prepare(`UPDATE catalogs SET access_token = ? WHERE catalog_id = ?`),

    // ─── Product Helpers ─────────────────────────────────────────────────────
    getProductsByCatalog: db.prepare(`SELECT * FROM products WHERE catalog_id = ? ORDER BY name ASC`),

    getProductByRetailerId: db.prepare(`SELECT * FROM products WHERE catalog_id = ? AND retailer_id = ?`),

    upsertProduct: db.prepare(`
        INSERT OR REPLACE INTO products (catalog_id, product_id, name, price, image_url, description, retailer_id, synced_at)
        VALUES (@catalog_id, @product_id, @name, @price, @image_url, @description, @retailer_id, datetime('now','localtime'))
    `),

    clearProductsForCatalog: db.prepare(`DELETE FROM products WHERE catalog_id = ?`),

    // ─── Flow Helpers ──────────────────────────────────────────────────────
    getAllFlows: db.prepare(`SELECT * FROM flows ORDER BY created_at DESC`),

    getFlowByFlowId: db.prepare(`SELECT * FROM flows WHERE flow_id = ?`),

    getFlowById: db.prepare(`SELECT * FROM flows WHERE id = ?`),

    insertFlow: db.prepare(`
        INSERT INTO flows (flow_id, name, description, category, status, flow_json, meta_flow_id, endpoint_url, token)
        VALUES (@flow_id, @name, @description, @category, @status, @flow_json, @meta_flow_id, @endpoint_url, @token)
    `),

    updateFlow: db.prepare(`
        UPDATE flows SET name=@name, description=@description, category=@category, status=@status,
        flow_json=@flow_json, meta_flow_id=@meta_flow_id, endpoint_url=@endpoint_url, token=@token,
        updated_at=datetime('now','localtime')
        WHERE flow_id=@flow_id
    `),

    deleteFlow: db.prepare(`DELETE FROM flows WHERE flow_id = ?`),

    updateFlowStatus: db.prepare(`UPDATE flows SET status=?, updated_at=datetime('now','localtime') WHERE flow_id=?`),

    updateFlowMetaId: db.prepare(`UPDATE flows SET meta_flow_id=?, updated_at=datetime('now','localtime') WHERE flow_id=?`),

    // ─── Flow Response Helpers ─────────────────────────────────────────────
    insertFlowResponse: db.prepare(`
        INSERT INTO flow_responses (flow_id, contact_id, screen_id, response_json)
        VALUES (@flow_id, @contact_id, @screen_id, @response_json)
    `),

    getFlowResponses: db.prepare(`
        SELECT fr.*, c.name as contact_name, c.phone as contact_phone
        FROM flow_responses fr
        JOIN contacts c ON fr.contact_id = c.id
        WHERE fr.flow_id = ?
        ORDER BY fr.received_at DESC
    `),

    getFlowResponsesByContact: db.prepare(`
        SELECT * FROM flow_responses WHERE flow_id = ? AND contact_id = ? ORDER BY received_at DESC
    `),

    // --- Calls ---
    insertCall: db.prepare(`
        INSERT INTO calls (contact_id, type, direction, status)
        VALUES (?, ?, ?, ?)
    `),

    updateCallStatus: db.prepare(`
        UPDATE calls SET status = ?, duration = ?, ended_at = ? WHERE id = ?
    `),

    getCallById: db.prepare(`
        SELECT c.*, ct.name as contact_name, ct.phone as contact_phone
        FROM calls c
        JOIN contacts ct ON c.contact_id = ct.id
        WHERE c.id = ?
    `),

    getCallsByContact: db.prepare(`
        SELECT * FROM calls WHERE contact_id = ? ORDER BY started_at DESC
    `),

    getAllCalls: db.prepare(`
        SELECT c.*, ct.name as contact_name, ct.phone as contact_phone
        FROM calls c
        JOIN contacts ct ON c.contact_id = ct.id
        ORDER BY c.started_at DESC
    `),

    // ─── Knowledge Base Helpers ─────────────────────────────────────────────
    getKnowledgeByAgent: db.prepare(`SELECT * FROM knowledge_base WHERE agent_id = ? ORDER BY created_at DESC`),

    getKnowledgeById: db.prepare(`SELECT * FROM knowledge_base WHERE id = ?`),

    insertKnowledge: db.prepare(`
        INSERT INTO knowledge_base (agent_id, type, name, file_path, content, sheet_id, sheet_url, credentials, record_count)
        VALUES (@agent_id, @type, @name, @file_path, @content, @sheet_id, @sheet_url, @credentials, @record_count)
    `),

    updateKnowledge: db.prepare(`
        UPDATE knowledge_base SET name=@name, content=@content, sheet_url=@sheet_url, credentials=@credentials,
        last_synced=@last_synced, record_count=@record_count WHERE id=@id
    `),

    deleteKnowledge: db.prepare(`DELETE FROM knowledge_base WHERE id = ?`),

    // ─── MCP Servers Helpers ───────────────────────────────────────────────
    getMcpServersByAgent: db.prepare(`SELECT * FROM mcp_servers WHERE agent_config_id = ? ORDER BY created_at DESC`),

    getMcpServerById: db.prepare(`SELECT * FROM mcp_servers WHERE id = ?`),

    insertMcpServer: db.prepare(`
        INSERT INTO mcp_servers (agent_config_id, type, name, config_json)
        VALUES (@agent_config_id, @type, @name, @config_json)
    `),

    updateMcpServer: db.prepare(`
        UPDATE mcp_servers SET name=@name, config_json=@config_json
        WHERE id=@id
    `),

    deleteMcpServer: db.prepare(`DELETE FROM mcp_servers WHERE id = ?`),
};

// ─── High-Level API ───────────────────────────────────────────────────────────

module.exports = {
    db,

    // --- Contacts ---
    getAllContacts() {
        return stmts.getAllContacts.all();
    },

    getContactById(id) {
        return stmts.getContactById.get(id);
    },

    getContactByPhone(phone) {
        // Normalize: strip all non-digits then try to match
        return stmts.getContactByPhone.get(phone);
    },

    createContact({ name, phone = null, avatar = null, status = 'Offline', about = 'Hey there!', is_group = 0 }) {
        const result = stmts.insertContact.run({ name, phone, avatar, status, about, is_group });
        return stmts.getContactById.get(result.lastInsertRowid);
    },

    updateContactStatus(id, status) {
        stmts.updateContactStatus.run(status, id);
    },

    updateFavorite(id, isFavorite) {
        stmts.updateFavorite.run(isFavorite ? 1 : 0, id);
    },

    // --- Messages ---
    getMessages(contactId) {
        return stmts.getMessages.all(contactId);
    },

    addMessage({ contact_id, type, text = '', media_type = 'text', media_url = null, media_mime = null, caption = null, wa_media_id = null, status = 'sent' }) {
        const [row] = stmts.insertMessage.all({ contact_id, type, text, media_type, media_url, media_mime, caption, wa_media_id, status });
        return row;
    },

    markMessagesRead(contactId) {
        stmts.markRead.run(contactId);
    },

    markMessageDelivered(msgId) {
        stmts.markDelivered.run(msgId);
    },

    // --- Agent Configs ---
    getAllAgentConfigs() {
        return stmts.getAllAgentConfigs.all();
    },

    getAgentConfigById(id) {
        return stmts.getAgentConfigById.get(id);
    },

    getDefaultAgentConfig() {
        return stmts.getDefaultAgentConfig.get();
    },

    createAgentConfig({ name, agent_type, provider, model = 'gpt-4o', system_prompt, temperature = 0.7, max_tokens = 1024, base_url = null, is_default = 0 }) {
        if (is_default) stmts.clearDefaultFlags.run();
        const result = stmts.insertAgentConfig.run({ name, agent_type, provider, model, system_prompt, temperature, max_tokens, base_url, is_default });
        return stmts.getAgentConfigById.get(result.lastInsertRowid);
    },

    updateAgentConfig(id, { name, agent_type, provider, model, system_prompt, temperature, max_tokens, base_url, is_default }) {
        if (is_default) stmts.clearDefaultFlags.run();
        stmts.updateAgentConfig.run({ id, name, agent_type, provider, model, system_prompt, temperature, max_tokens, base_url, is_default });
        return stmts.getAgentConfigById.get(id);
    },

    deleteAgentConfig(id) {
        stmts.deleteAgentConfig.run(id);
    },

    // --- Conversation Modes ---
    getConversationMode(contactId) {
        return stmts.getConversationMode.get(contactId);
    },

    setConversationMode({ contact_id, mode = 'human', agent_config_id = null, auto_handover = 0 }) {
        stmts.upsertConversationMode.run({ contact_id, mode, agent_config_id, auto_handover });
        return stmts.getConversationMode.get(contact_id);
    },

    // --- Conversation History ---
    getConversationHistory(contactId) {
        return stmts.getConversationHistory.all(contactId);
    },

    addToHistory({ contact_id, role, content }) {
        stmts.insertConversationHistory.run({ contact_id, role, content });
    },

    clearHistory(contactId) {
        stmts.clearConversationHistory.run(contactId);
    },

    trimHistory(contactId, keepCount = 40) {
        const countStmt = db.prepare('SELECT COUNT(*) as total FROM conversation_history WHERE contact_id = ?');
        const { total } = countStmt.get(contactId);
        if (total > keepCount) {
            stmts.trimConversationHistory.run(contactId, total - keepCount);
        }
    },

    // --- Catalogs ---
    getAllCatalogs() {
        return stmts.getAllCatalogs.all();
    },

    getCatalogById(catalogId) {
        return stmts.getCatalogById.get(catalogId);
    },

    upsertCatalog({ business_id = null, waba_id = null, catalog_id, access_token = null, name = '' }) {
        stmts.insertCatalog.run({ business_id, waba_id, catalog_id, access_token, name });
        return stmts.getCatalogById.get(catalog_id);
    },

    deleteCatalog(catalogId) {
        stmts.clearProductsForCatalog.run(catalogId);
        stmts.deleteCatalog.run(catalogId);
    },

    updateCatalogToken(catalogId, token) {
        stmts.updateCatalogToken.run(token, catalogId);
    },

    // --- Products ---
    getProductsByCatalog(catalogId) {
        return stmts.getProductsByCatalog.all(catalogId);
    },

    upsertProduct({ catalog_id, product_id, name = '', price = '', image_url = '', description = '', retailer_id = '' }) {
        stmts.upsertProduct.run({ catalog_id, product_id, name, price, image_url, description, retailer_id });
    },

    clearProductsForCatalog(catalogId) {
        stmts.clearProductsForCatalog.run(catalogId);
    },

    // --- Flows ---
    getAllFlows() {
        return stmts.getAllFlows.all();
    },

    getFlowByFlowId(flowId) {
        return stmts.getFlowByFlowId.get(flowId);
    },

    getFlowById(id) {
        return stmts.getFlowById.get(id);
    },

    createFlow({ flow_id, name = 'Untitled Flow', description = '', category = 'CUSTOMER_SUPPORT', status = 'DRAFT', flow_json = '{}', meta_flow_id = null, endpoint_url = null, token = null }) {
        stmts.insertFlow.run({ flow_id, name, description, category, status, flow_json, meta_flow_id, endpoint_url, token });
        return stmts.getFlowByFlowId.get(flow_id);
    },

    updateFlow(flowId, { name, description, category, status, flow_json, meta_flow_id = null, endpoint_url = null, token = null }) {
        stmts.updateFlow.run({ flow_id: flowId, name, description, category, status, flow_json, meta_flow_id, endpoint_url, token });
        return stmts.getFlowByFlowId.get(flowId);
    },

    deleteFlow(flowId) {
        stmts.deleteFlow.run(flowId);
    },

    updateFlowStatus(flowId, status) {
        stmts.updateFlowStatus.run(status, flowId);
    },

    updateFlowMetaId(flowId, metaFlowId) {
        stmts.updateFlowMetaId.run(metaFlowId, flowId);
    },

    // --- Flow Responses ---
    saveFlowResponse({ flow_id, contact_id, screen_id = null, response_json = '{}' }) {
        stmts.insertFlowResponse.run({ flow_id, contact_id, screen_id, response_json });
    },

    getFlowResponses(flowId) {
        return stmts.getFlowResponses.all(flowId);
    },

    getFlowResponsesByContact(flowId, contactId) {
        return stmts.getFlowResponsesByContact.all(flowId, contactId);
    },

    // --- Calls ---
    createCall({ contact_id, type, direction, status = 'ongoing' }) {
        const result = stmts.insertCall.run({ contact_id, type, direction, status });
        return stmts.getCallById.get(result.lastInsertRowid);
    },

    updateCallStatus(id, status, duration = null, ended_at = null) {
        stmts.updateCallStatus.run({ status, duration, ended_at, id });
    },

    getCallById(id) {
        return stmts.getCallById.get(id);
    },

    getCallsByContact(contactId) {
        return stmts.getCallsByContact.all(contactId);
    },

    getAllCalls() {
        return stmts.getAllCalls.all();
    },

    // --- Knowledge Base ---
    getKnowledgeByAgent(agentId) {
        return stmts.getKnowledgeByAgent.all(agentId);
    },

    getKnowledgeById(id) {
        return stmts.getKnowledgeById.get(id);
    },

    addKnowledge({ agent_id, type, name, file_path = null, content = null, sheet_id = null, sheet_url = null, credentials = null, record_count = 0 }) {
        const result = stmts.insertKnowledge.run({ agent_id, type, name, file_path, content, sheet_id, sheet_url, credentials, record_count });
        return stmts.getKnowledgeById.get(result.lastInsertRowid);
    },

    updateKnowledge(id, { name, content, sheet_url, credentials, last_synced, record_count }) {
        stmts.updateKnowledge.run({ id, name, content, sheet_url, credentials, last_synced, record_count });
        return stmts.getKnowledgeById.get(id);
    },

    deleteKnowledge(id) {
        stmts.deleteKnowledge.run(id);
    },

    // --- MCP Servers ---
    getMcpServersByAgent(agentId) {
        return stmts.getMcpServersByAgent.all(agentId);
    },

    getMcpServerById(id) {
        return stmts.getMcpServerById.get(id);
    },

    addMcpServer({ agent_config_id, type, name, config_json }) {
        const result = stmts.insertMcpServer.run({ agent_config_id, type, name, config_json });
        return stmts.getMcpServerById.get(result.lastInsertRowid);
    },

    updateMcpServer(id, { name, config_json }) {
        stmts.updateMcpServer.run({ id, name, config_json });
        return stmts.getMcpServerById.get(id);
    },

    deleteMcpServer(id) {
        stmts.deleteMcpServer.run(id);
    },
};
