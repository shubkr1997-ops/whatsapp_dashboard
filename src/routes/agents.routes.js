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

// ─── ROUTES: Agent Configs ─────────────────────────────────────────────────────

// GET /api/agents — list all agent configs
router.get('/agents', async (req, res) => {
    res.json(await db.getAllAgentConfigs());
});

// GET /api/agents/types — available agent types and their default prompts
router.get('/agents/types', (req, res) => {
    const types = Object.keys(AGENT_PROMPTS).map(key => ({
        type: key,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        defaultPrompt: AGENT_PROMPTS[key],
    }));
    res.json(types);
});

// GET /api/agents/providers — available AI providers and their env status
router.get('/agents/providers', (req, res) => {
    res.json([
        { id: 'openai',   label: 'OpenAI',    configured: !!process.env.OPENAI_API_KEY,    defaultModel: 'gpt-4o' },
        { id: 'chatgpt',  label: 'ChatGPT',   configured: !!process.env.OPENAI_API_KEY,    defaultModel: 'gpt-4o' },
        { id: 'gemini',   label: 'Gemini',     configured: !!process.env.GEMINI_API_KEY,    defaultModel: 'gemini-1.5-pro' },
        { id: 'ollama',   label: 'Ollama',     configured: true,                            defaultModel: process.env.OLLAMA_MODEL || 'llama3', defaultUrl: 'http://localhost:11434' },
        { id: 'lmstudio', label: 'LM Studio',  configured: true,                            defaultModel: 'local-model', defaultUrl: 'http://localhost:1234' },
    ]);
});

// GET /api/providers/:provider/models — get available models from local providers
router.get('/providers/:provider/models', async (req, res) => {
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
router.get('/agents/:id', async (req, res) => {
    const agent = await db.getAgentConfigById(parseInt(req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent config not found' });
    res.json(agent);
});

// POST /api/agents — create new agent config
router.post('/agents', async (req, res) => {
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
router.put('/agents/:id', async (req, res) => {
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
router.delete('/agents/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await db.getAgentConfigById(id);
    if (!existing) return res.status(404).json({ error: 'Agent config not found' });
    await db.deleteAgentConfig(id);
    res.json({ success: true });
});

module.exports = router;
