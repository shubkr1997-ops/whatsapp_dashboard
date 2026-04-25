'use strict';

const { generateChatCompletion } = require('./providers');
const db = require('../data/db');

const MAX_HISTORY_TURNS = 40; // keep last 40 messages in context

// ─── Pre-Built System Prompts ──────────────────────────────────────────────────

const AGENT_PROMPTS = {
    customer_support: `You are a professional customer support agent for a business communicating via WhatsApp.
- Be empathetic, concise, and solution-oriented.
- Greet the customer warmly and ask how you can help.
- If you don't know an answer, say so honestly and offer to escalate to a human agent.
- Use clear, non-technical language.
- If the customer is frustrated, acknowledge their feelings first.
- End conversations by asking if there's anything else they need.
- Keep responses under 3 sentences unless detailed explanation is needed.
- Never make up product prices, policies, or promises.
- If the customer wants to speak to a human, acknowledge and say a team member will take over.`,

    sales: `You are a friendly, knowledgeable sales assistant for a business communicating via WhatsApp.
- Be enthusiastic but not pushy.
- Ask qualifying questions to understand customer needs.
- Recommend products/services based on their requirements.
- Mention relevant offers, bundles, or discounts when appropriate.
- Handle objections gracefully with facts, not pressure.
- Guide the customer toward a purchase decision naturally.
- If asked about order status, ask for their order number and provide updates.
- Keep responses concise and engaging.
- Never fabricate product specifications or availability.`,

    general: `You are a helpful, friendly AI assistant communicating via WhatsApp.
- Be conversational and warm, like texting a knowledgeable friend.
- Keep responses concise — this is a chat, not email.
- Use simple language and short paragraphs.
- Be honest when you don't know something.
- Offer to help with follow-up questions.
- Adapt your tone to match the user's energy.
- Use occasional emojis naturally but don't overdo it.`,

    custom: `You are a helpful AI assistant. Adapt your communication style to be friendly, professional, and concise. Respond in the language the user writes in.`,
};

// ─── Engine: Process Incoming Message ──────────────────────────────────────────

/**
 * Process an incoming message through the AI agent if the conversation is in AI mode.
 *
 * @param {number} contactId
 * @param {string} incomingText
 * @param {Object} contact - The contact row from DB
 * @param {Object} io - Socket.io instance for real-time emit
 * @param {string} mediaUrl - The relative URL path for the media (if any)
 * @param {string} mediaMime - The MIME type of the media (if any)
 * @returns {Promise<Object|null>} The saved outgoing message or null if human mode
 */
async function processIncomingMessage(contactId, incomingText, contact, io, mediaUrl = null, mediaMime = null) {
    // Check conversation mode
    let modeRow = await db.getConversationMode(contactId);

    // Default to human mode if no mode row exists
    if (!modeRow) {
        await db.setConversationMode({ contact_id: contactId, mode: 'human', agent_config_id: null });
        return null;
    }

    if (modeRow.mode !== 'ai') return null;

    // Get agent config (from conversation_modes join or default)
    let agentConfig = null;
    if (modeRow.agent_config_id) {
        agentConfig = await db.getAgentConfigById(modeRow.agent_config_id);
    }
    if (!agentConfig) {
        agentConfig = await db.getDefaultAgentConfig();
    }
    if (!agentConfig) {
        console.error('[AI Engine] No agent config found for contact', contactId);
        return null;
    }

    try {
        // Build conversation context
        const systemPrompt = agentConfig.system_prompt || AGENT_PROMPTS[agentConfig.agent_type] || AGENT_PROMPTS.general;

        // Add incoming message to history
        await db.addToHistory({ contact_id: contactId, role: 'user', content: incomingText });

        // Get history
        const history = await db.getConversationHistory(contactId);

        // Build messages array
        const messages = [
            { role: 'system', content: `${systemPrompt}\n\nCustomer name: ${contact.name}. Phone: ${contact.phone || 'N/A'}.` },
            ...history.map(h => ({ role: h.role, content: h.content })),
        ];

        // Attach image data to the last user message if present
        if (mediaUrl) {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, '..', 'public', mediaUrl);
            if (fs.existsSync(filePath)) {
                try {
                    const base64Image = fs.readFileSync(filePath, 'base64');
                    const lastMsgIdx = messages.length - 1;
                    messages[lastMsgIdx].images = [base64Image];
                    messages[lastMsgIdx].mediaMime = mediaMime || 'image/jpeg';
                } catch (e) {
                    console.error('[AI Engine] Failed to read image for AI:', e.message);
                }
            }
        }

        // Trim history if too long
        if (history.length > MAX_HISTORY_TURNS * 2) {
            await db.trimHistory(contactId, MAX_HISTORY_TURNS * 2);
        }

        // Emit typing indicator
        if (io) {
            /* io.to.emit removed */
        }

        // Safety timeout to force-clear typing indicator if AI hangs
        let typingTimeout = null;
        if (io) {
            typingTimeout = setTimeout(() => {
                /* io.to.emit removed */
            }, 35000);
        }

        // Get MCP Servers for this agent
        const mcpServers = await db.getMcpServersByAgent(agentConfig.id) || [];

        // Generate AI response
        const aiReply = await generateChatCompletion({
            provider: agentConfig.provider,
            model: agentConfig.model,
            messages,
            temperature: agentConfig.temperature,
            max_tokens: agentConfig.max_tokens,
            baseUrl: agentConfig.base_url,
            mcpServers: mcpServers,
        });

        // Clear fallback timeout and stop typing indicator
        if (typingTimeout) clearTimeout(typingTimeout);
        if (io) {
            /* io.to.emit removed */
        }

        // Check for handover signal (AI says to transfer to human)
        const handoverKeywords = ['transfer to human', 'human agent', 'speak to someone', 'human representative'];
        const shouldHandover = handoverKeywords.some(kw => aiReply.toLowerCase().includes(kw));

        if (shouldHandover && modeRow.auto_handover) {
            // Switch mode BEFORE saving — don't save the raw AI reply
            await db.setConversationMode({ contact_id: contactId, mode: 'human', agent_config_id: modeRow.agent_config_id, auto_handover: modeRow.auto_handover });
            if (io) io.emit('mode_changed', { contactId, mode: 'human', agentName: modeRow.agent_name });

            // Save a brief handover message to history (not the full AI reply)
            await db.addToHistory({ contact_id: contactId, role: 'assistant', content: '[Handover triggered] Transferring to human agent.' });

            // Send a clean handover message to the user
            const handoverMsg = await db.addMessage({
                contact_id: contactId,
                type: 'outgoing',
                text: 'Let me connect you with a human agent who can help you further.',
                status: 'sent',
            });
            return handoverMsg;
        }

        // Save AI reply to history
        await db.addToHistory({ contact_id: contactId, role: 'assistant', content: aiReply });

        // Save as outgoing message
        const savedMsg = await db.addMessage({
            contact_id: contactId,
            type: 'outgoing',
            text: aiReply,
            status: 'sent',
        });

        return savedMsg;

    } catch (err) {
        console.error('[AI Engine] Error generating response:', err.message);

        // Stop typing indicator on error
        if (io) {
            /* io.to.emit removed */
        }

        return null;
    }
}

module.exports = { processIncomingMessage, AGENT_PROMPTS };
