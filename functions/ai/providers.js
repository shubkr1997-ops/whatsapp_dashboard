'use strict';

const axios = require('axios');
const { readGoogleSheetSchema, writeGoogleSheetSchema, executeReadSheet, executeWriteSheet } = require('./tools/googleSheetsMcp');

/**
 * Unified AI Provider Layer
 * Supports: openai, chatgpt (same backend), gemini, ollama
 */

// ─── OpenAI / ChatGPT ─────────────────────────────────────────────────────────

async function callOpenAI({ messages, model = 'gpt-4o', temperature = 0.7, max_tokens = 1024, apiKey, mcpServers = [] }) {
    let formattedMessages = messages.map(m => {
        if (m.images && m.images.length > 0) {
            return {
                role: m.role,
                content: [
                    { type: 'text', text: m.content || '' },
                    { type: 'image_url', image_url: { url: `data:${m.mediaMime || 'image/jpeg'};base64,${m.images[0]}` } }
                ]
            };
        }
        if (m.role === 'tool') {
            return { role: m.role, tool_call_id: m.tool_call_id, content: m.content };
        }
        if (m.tool_calls) {
            return { role: m.role, content: m.content || null, tool_calls: m.tool_calls };
        }
        return { role: m.role, content: m.content || '' };
    });

    const url = 'https://api.openai.com/v1/chat/completions';
    
    // Construct Tools Array from MCP Servers
    let tools = [];
    let hasGoogleSheet = mcpServers.some(s => s.type === 'google_sheet');
    if (hasGoogleSheet) {
        tools.push({ type: 'function', function: readGoogleSheetSchema });
        tools.push({ type: 'function', function: writeGoogleSheetSchema });
    }

    let hasMoreTools = false;
    let fallbackCount = 0;

    do {
        hasMoreTools = false;
        try {
            const payload = {
                model,
                messages: formattedMessages,
                temperature,
                max_tokens,
            };
            if (tools.length > 0) {
                payload.tools = tools;
            }

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60000,
            });
            const message = response.data?.choices?.[0]?.message;
            if (!message) throw new Error('Empty or invalid response from OpenAI API');
            
            if (message.tool_calls && message.tool_calls.length > 0 && fallbackCount < 5) {
                fallbackCount++;
                formattedMessages.push(message);
                
                for (const toolCall of message.tool_calls) {
                    const funcName = toolCall.function.name;
                    let args = {};
                    try { args = JSON.parse(toolCall.function.arguments); } catch(e){}
                    
                    let toolResult = "Error: Tool execution failed";
                    
                    if (funcName === 'read_google_sheet' || funcName === 'write_google_sheet') {
                        // Find the google sheet config
                        const sheetConfigRaw = mcpServers.find(s => s.type === 'google_sheet');
                        if (sheetConfigRaw) {
                            try {
                                const config = JSON.parse(sheetConfigRaw.config_json);
                                if (funcName === 'read_google_sheet') toolResult = await executeReadSheet(config, args);
                                if (funcName === 'write_google_sheet') toolResult = await executeWriteSheet(config, args);
                            } catch (e) {
                                toolResult = `Error executing sheet tool: ${e.message}`;
                            }
                        } else {
                            toolResult = "Error: Configured Google Sheet MCP Server not found.";
                        }
                    }

                    formattedMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
                    });
                }
                hasMoreTools = true;
            } else {
                return message.content || "";
            }
        } catch (err) {
            const status = err.response?.status;
            const body = err.response?.data;
            if (status === 401) throw new Error('[OpenAI] Authentication failed — check OPENAI_API_KEY');
            if (status === 429) throw new Error('[OpenAI] Rate limited — please try again shortly');
            if (status === 400) throw new Error(`[OpenAI] Bad request: ${body?.error?.message || 'unknown'}`);
            throw new Error(`[OpenAI] ${err.message}`);
        }
    } while (hasMoreTools);
    
    return "";
}

// ─── Google Gemini ─────────────────────────────────────────────────────────────

async function callGemini({ messages, model = 'gemini-1.5-pro', temperature = 0.7, max_tokens = 1024, apiKey }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Convert OpenAI-format messages to Gemini format
    // Gemini requires strict user/model alternation — no consecutive same-role messages
    const rawContents = messages
        .filter(m => m.role !== 'system')
        .map(m => {
            const parts = [{ text: m.content || '' }];
            if (m.images && m.images.length > 0) {
                parts.push({
                    inlineData: {
                        mimeType: m.mediaMime || 'image/jpeg',
                        data: m.images[0]
                    }
                });
            }
            return {
                role: m.role === 'assistant' ? 'model' : 'user',
                parts,
            };
        });

    // Merge consecutive same-role messages to enforce alternation
    const contents = [];
    for (const msg of rawContents) {
        const last = contents[contents.length - 1];
        if (last && last.role === msg.role) {
            // Merge consecutive same-role messages into one
            last.parts[0].text += '\n' + msg.parts[0].text;
        } else {
            contents.push({ ...msg });
        }
    }

    // Prepend system prompt as first user/model pair if present
    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg) {
        const preamble = {
            role: 'user',
            parts: [{ text: `[System Instruction] ${systemMsg.content}` }],
        };
        const ack = {
            role: 'model',
            parts: [{ text: 'Understood. I will follow these instructions.' }],
        };
        // If first real content is a user message, insert preamble before it
        if (contents.length > 0 && contents[0].role === 'user') {
            contents.splice(0, 0, ack);
            contents.splice(0, 0, preamble);
        } else {
            contents.unshift(preamble);
            contents.splice(1, 0, ack);
        }
    }

    try {
        const response = await axios.post(url, {
            contents,
            generationConfig: {
                temperature,
                maxOutputTokens: max_tokens,
            },
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000,
        });

        const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) throw new Error('Empty or invalid response from Gemini API');
        return content;
    } catch (err) {
        const status = err.response?.status;
        const body = err.response?.data;
        if (status === 401 || status === 403) throw new Error('[Gemini] Authentication failed — check GEMINI_API_KEY');
        if (status === 429) throw new Error('[Gemini] Rate limited — please try again shortly');
        if (status === 400) throw new Error(`[Gemini] Bad request: ${body?.error?.message || 'unknown'}`);
        throw new Error(`[Gemini] ${err.message}`);
    }
}

// ─── Ollama (Local) ────────────────────────────────────────────────────────────

async function callOllama({ messages, model = 'llama3', temperature = 0.7, max_tokens = 1024, baseUrl }) {
    const url = `${baseUrl || 'http://localhost:11434'}/api/chat`;
    try {
        const response = await axios.post(url, {
            model,
            messages,
            stream: false,
            options: {
                temperature,
                num_predict: max_tokens,
            },
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 120000,
        });

        const content = response.data?.message?.content;
        if (!content) throw new Error('Empty or invalid response from Ollama API');
        return content;
    } catch (err) {
        const status = err.response?.status;
        if (status === 404) throw new Error(`[Ollama] Model not found — ensure the model is installed (e.g. ollama pull ${model})`);
        if (err.code === 'ECONNREFUSED') throw new Error('[Ollama] Connection refused — is Ollama running? (ollama serve)');
        throw new Error(`[Ollama] ${err.message}`);
    }
}

// ─── LM Studio (Local - OpenAI Compatible) ────────────────────────────────────

async function callLMStudio({ messages, model = 'local-model', temperature = 0.7, max_tokens = 1024, baseUrl }) {
    const formattedMessages = messages.map(m => {
        if (m.images && m.images.length > 0) {
            return {
                role: m.role,
                content: [
                    { type: 'text', text: m.content || '' },
                    { type: 'image_url', image_url: { url: `data:${m.mediaMime || 'image/jpeg'};base64,${m.images[0]}` } }
                ]
            };
        }
        return { role: m.role, content: m.content || '' };
    });

    const url = `${baseUrl || 'http://localhost:1234'}/v1/chat/completions`;
    try {
        const response = await axios.post(url, {
            model,
            messages: formattedMessages,
            temperature,
            max_tokens,
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 120000,
        });
        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) throw new Error('Empty or invalid response from LM Studio API');
        return content;
    } catch (err) {
        const status = err.response?.status;
        if (status === 404) throw new Error('[LM Studio] API not found — is LM Studio running with API enabled?');
        if (err.code === 'ECONNREFUSED') throw new Error('[LM Studio] Connection refused — is LM Studio running on port 1234?');
        throw new Error(`[LM Studio] ${err.message}`);
    }
}

// ─── LM Studio: Get Available Models ──────────────────────────────────────────

async function getLMStudioModels(baseUrl = 'http://localhost:1234') {
    try {
        const response = await axios.get(`${baseUrl}/v1/models`, { timeout: 5000 });
        return response.data?.data?.map(m => m.id) || [];
    } catch (err) {
        return [];
    }
}

// ─── Unified Dispatcher ────────────────────────────────────────────────────────

/**
 * Generate a chat completion using the specified provider.
 *
 * @param {Object} opts
 * @param {string} opts.provider - 'openai' | 'chatgpt' | 'gemini' | 'ollama' | 'lmstudio'
 * @param {string} opts.model - Model name (e.g. 'gpt-4o', 'gemini-1.5-pro', 'llama3')
 * @param {Array}  opts.messages - [{role, content}] in OpenAI chat format
 * @param {number} opts.temperature
 * @param {number} opts.max_tokens
 * @param {string} opts.baseUrl - Custom base URL for local providers (ollama, lmstudio)
 * @returns {Promise<string>} The assistant's reply text
 */
async function generateChatCompletion({ provider, model, messages, temperature, max_tokens, baseUrl, mcpServers = [] }) {
    switch (provider) {
        case 'openai':
        case 'chatgpt': {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY not set in environment');
            return callOpenAI({ messages, model: model || 'gpt-4o', temperature, max_tokens, apiKey, mcpServers });
        }

        case 'gemini': {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) throw new Error('GEMINI_API_KEY not set in environment');
            return callGemini({ messages, model: model || 'gemini-1.5-pro', temperature, max_tokens, apiKey });
        }

        case 'ollama': {
            const url = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
            return callOllama({ messages, model: model || 'llama3', temperature, max_tokens, baseUrl: url });
        }

        case 'lmstudio': {
            const url = baseUrl || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234';
            return callLMStudio({ messages, model: model || 'local-model', temperature, max_tokens, baseUrl: url });
        }

        default:
            throw new Error(`Unsupported AI provider: ${provider}`);
    }
}

module.exports = { generateChatCompletion, getLMStudioModels };
