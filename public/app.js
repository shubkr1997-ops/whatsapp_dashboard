'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let contacts      = [];
let activeChatId  = null;
let unreadCounts  = {};
let originalTitle = document.title;
let currentMode   = null;  // { mode, agent_config_id, ... } for active chat
let agents        = [];    // cached agent configs
let providers     = [];    // cached provider status
let agentTypes    = [];    // cached agent type presets
let currentFilter = 'all'; // filter-pill state

// ─── DOM References ───────────────────────────────────────────────────────────

const chatList          = document.getElementById('chatList');
const welcomeScreen     = document.getElementById('welcomeScreen');
const chatArea          = document.getElementById('chatArea');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput      = document.getElementById('messageInput');
const sendBtn           = document.getElementById('sendBtn');
const micBtn            = document.getElementById('micBtn');
const plusBtn           = document.getElementById('plusBtn');
const attachmentMenu    = document.getElementById('attachmentMenu');
const recordingUI       = document.getElementById('recordingUI');
const chatSearch        = document.getElementById('chatSearch');

// Settings UI DOM
const settingsDrawer      = document.getElementById('settingsDrawer');
const closeSettings       = document.getElementById('closeSettings');
const btnSettings         = document.getElementById('btnSettings');
let settingsOverlay       = null; // Created dynamically

const headerAvatar  = document.getElementById('headerAvatar');
const headerName    = document.getElementById('headerName');
const headerStatus  = document.getElementById('headerStatus');

const detailsPanel  = document.getElementById('detailsPanel');
const detailsAvatar = document.getElementById('detailsAvatar');
const detailsName   = document.getElementById('detailsName');
const detailsPhone  = document.getElementById('detailsPhone');
const detailsAbout  = document.getElementById('detailsAbout');

// Mode toggle DOM
const modeToggleBtn   = document.getElementById('modeToggleBtn');
const modeLabel       = document.getElementById('modeLabel');
const modeIcon        = document.getElementById('modeIcon');

// Details AI section DOM
const detailsModeValue       = document.getElementById('detailsModeValue');
const detailsAgentRow        = document.getElementById('detailsAgentRow');
const detailsAgentName       = document.getElementById('detailsAgentName');
const detailsProviderRow     = document.getElementById('detailsProviderRow');
const detailsProviderName    = document.getElementById('detailsProviderName');
const detailsToggleModeBtn   = document.getElementById('detailsToggleModeBtn');
const detailsConfigureAgentBtn = document.getElementById('detailsConfigureAgentBtn');
const detailsClearHistoryBtn = document.getElementById('detailsClearHistoryBtn');

// Agent Modal DOM
const agentModalOverlay    = document.getElementById('agentModalOverlay');
const closeAgentModal      = document.getElementById('closeAgentModal');
const agentPresetsList     = document.getElementById('agentPresetsList');
const createAgentBtn       = document.getElementById('createAgentBtn');
const agentEditorSection   = document.getElementById('agentEditorSection');
const agentEditorTitle     = document.getElementById('agentEditorTitle');
const agentNameInput       = document.getElementById('agentName');
const agentTypeSelect      = document.getElementById('agentType');
const agentProviderSelect  = document.getElementById('agentProvider');
const agentModelInput      = document.getElementById('agentModel');
const agentTemperatureInput = document.getElementById('agentTemperature');
const agentMaxTokensInput  = document.getElementById('agentMaxTokens');
const agentSystemPrompt    = document.getElementById('agentSystemPrompt');
const agentIsDefault       = document.getElementById('agentIsDefault');
const agentBaseUrl         = document.getElementById('agentBaseUrl');
const baseUrlGroup         = document.getElementById('baseUrlGroup');
const btnLoadModels        = document.getElementById('btnLoadModels');
const saveAgentBtn         = document.getElementById('saveAgentBtn');
const cancelAgentBtn       = document.getElementById('cancelAgentBtn');
const assignAgentSelect    = document.getElementById('assignAgentSelect');
const assignAgentBtn       = document.getElementById('assignAgentBtn');
const providerStatusList   = document.getElementById('providerStatusList');
const quickAssignSection   = document.getElementById('quickAssignSection');

// Training Section DOM
const trainingFilesList    = document.getElementById('trainingFilesList');
const trainingFileInput     = document.getElementById('trainingFileInput');
const btnUploadTraining     = document.getElementById('btnUploadTraining');
const btnConfirmUpload      = document.getElementById('btnConfirmUpload');
const trainingFileName      = document.getElementById('trainingFileName');
const sheetUrl              = document.getElementById('sheetUrl');
const sheetName             = document.getElementById('sheetName');
const sheetCredentials      = document.getElementById('sheetCredentials');
const btnAddGoogleSheet      = document.getElementById('btnAddGoogleSheet');

let selectedTrainingFile = null;
let currentTrainingAgentId = null;

let editingAgentId = null; // null = creating new, number = editing existing

// ─── Socket.io ────────────────────────────────────────────────────────────────

const socket = io();

socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id);
    if (activeChatId) socket.emit('join_chat', activeChatId);
});

socket.on('disconnect', () => {
    console.log('[Socket] Disconnected');
});

socket.on('connect_error', (error) => {
    console.error('[Socket] Connection error:', error);
});

socket.on('new_message', ({ contactId, message }) => {
    console.log('[Socket] New message received:', { contactId, message });

    const contact = contacts.find(c => c.id === contactId);
    console.log('[Socket] Found contact:', contact);

    if (contact) {
        contact.lastMessage = message.text;
        contact.time        = message.time;
    }

    if (contactId === activeChatId) {
        console.log('[Socket] Appending message to active chat');
        appendMessageBubble(message, true);
    } else {
        console.log('[Socket] Message for inactive chat, updating unread count');
        unreadCounts[contactId] = (unreadCounts[contactId] || 0) + 1;
        if (contact) contact.unread = unreadCounts[contactId];
        updateChatCard(contactId);
        flashTabTitle(contact?.name || 'New message');
    }

    sortAndRenderChatList();
});

socket.on('contact_updated', ({ id, lastMessage, time, unread, is_favorite }) => {
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;
 
    if (lastMessage !== undefined) contact.lastMessage = lastMessage;
    if (time        !== undefined) contact.time        = time;
    if (is_favorite !== undefined) contact.is_favorite = is_favorite;
 
    if (unread === 0) {
        contact.unread   = 0;
        unreadCounts[id] = 0;
    } else if (unread === '+1') {
        contact.unread   = (contact.unread || 0) + 1;
        unreadCounts[id] = contact.unread;
    } else if (typeof unread === 'number') {
        contact.unread   = unread;
        unreadCounts[id] = unread;
    }
 
    updateChatCard(id);
    if (id === activeChatId && is_favorite !== undefined) {
        updateFavoriteUI(is_favorite);
    }
});

socket.on('new_contact', (newContact) => {
    console.log('[Socket] New contact received:', newContact);
    contacts.unshift(newContact);
    unreadCounts[newContact.id] = newContact.unread || 0;
    sortAndRenderChatList();
    console.log('[Socket] Contact list updated, total contacts:', contacts.length);
    // Force refresh the chat list display
    const chatListElement = document.getElementById('chatList');
    if (chatListElement) {
        chatListElement.innerHTML = '';
        sortAndRenderChatList();
    }
});

socket.on('message_status', ({ msgId, status }) => {
    const bubble = document.querySelector(`.message[data-msg-id="${msgId}"] .msg-status`);
    if (bubble) bubble.textContent = statusIcon(status);
});

// AI typing indicator
socket.on('ai_typing', ({ contactId, typing }) => {
    if (contactId !== activeChatId) return;
    const existing = document.getElementById('aiTypingIndicator');
    if (typing && !existing) {
        const div = document.createElement('div');
        div.id = 'aiTypingIndicator';
        div.className = 'message incoming ai-typing';
        div.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span> AI is typing...';
        messagesContainer.appendChild(div);
        scrollToBottom();
    } else if (!typing && existing) {
        existing.remove();
    }
});

// Mode changed event
socket.on('mode_changed', ({ contactId, mode, agentName }) => {
    if (contactId === activeChatId) {
        updateModeUI(mode, agentName);
    }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
    try {
        const res = await fetch('/api/contacts');
        contacts  = await res.json();
        contacts.forEach(c => { unreadCounts[c.id] = c.unread || 0; });
        sortAndRenderChatList();
        setupEventListeners();
    } catch (err) {
        console.error('[Init] Failed to load contacts:', err);
        chatList.innerHTML = `<p style="padding:1rem;color:#8696a0">Could not load chats. Is the server running?</p>`;
    }
}

// ─── Render: Chat List ────────────────────────────────────────────────────────

function sortAndRenderChatList() {
    const query = chatSearch.value.toLowerCase();
    let filtered = contacts.filter(c =>
        c.name.toLowerCase().includes(query) ||
        (c.lastMessage || '').toLowerCase().includes(query)
    );
    
    if (currentFilter === 'unread') {
        filtered = filtered.filter(c => c.unread > 0);
    } else if (currentFilter === 'favorites') {
        filtered = filtered.filter(c => c.is_favorite);
    } else if (currentFilter === 'groups') {
        filtered = filtered.filter(c => c.is_group);
    }
    
    // Sort by timestamp if available
    filtered.sort((a, b) => {
        if (!a.time) return 1;
        if (!b.time) return -1;
        // Basic string desc check (works if time corresponds to recency roughly, or just fallback)
        return new Date(b.time) - new Date(a.time); // Assuming formatTime output is sometimes parsable, but originally it relies on the pre-sorted backend list.
    });

    renderChatList(filtered);
}

function renderChatList(data) {
    chatList.innerHTML = '';
    data.forEach(contact => {
        const card = createChatCard(contact);
        chatList.appendChild(card);
    });
}

function createChatCard(contact) {
    const card      = document.createElement('div');
    card.className  = `chat-card${activeChatId === contact.id ? ' active' : ''}`;
    card.dataset.contactId = contact.id;

    const unread = contact.unread || 0;
    card.innerHTML  = `
        <img src="${contact.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + contact.id}" alt="${contact.name}">
        <div class="chat-card-info">
            <div class="chat-card-header">
                <h3>${contact.name}</h3>
                <span class="time">${contact.time || ''}</span>
            </div>
            <div class="chat-card-body">
                <div class="preview-line">
                    ${contact.is_favorite ? '<i data-lucide="star" class="fav-star-mini" size="12"></i> ' : ''}
                    <p class="preview">${contact.lastMessage || ''}</p>
                </div>
                ${unread > 0 ? `<span class="unread">${unread}</span>` : ''}
            </div>
        </div>`;
    card.addEventListener('click', () => selectChat(contact.id));
    if (typeof lucide !== 'undefined') lucide.createIcons({ root: card });
    return card;
}

function updateChatCard(contactId) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    const existing = chatList.querySelector(`.chat-card[data-contact-id="${contactId}"]`);
    if (existing) {
        const newCard = createChatCard(contact);
        existing.replaceWith(newCard);
    } else {
        sortAndRenderChatList();
    }
}

// ─── Select a Chat ────────────────────────────────────────────────────────────

async function selectChat(id) {
    if (activeChatId && activeChatId !== id) socket.emit('leave_chat', activeChatId);

    activeChatId = id;
    socket.emit('join_chat', id);

    document.querySelectorAll('.chat-card').forEach(c => c.classList.remove('active'));
    const activeCard = chatList.querySelector(`.chat-card[data-contact-id="${id}"]`);
    if (activeCard) activeCard.classList.add('active');

    try {
        const res     = await fetch(`/api/contacts/${id}`);
        const contact = await res.json();

        const idx = contacts.findIndex(c => c.id === id);
        if (idx !== -1) {
            contacts[idx] = { ...contacts[idx], ...contact, messages: undefined };
            contacts[idx].unread = 0;
            unreadCounts[id]     = 0;
        }

        welcomeScreen.classList.add('hidden');
        chatArea.classList.remove('hidden');
        document.querySelector('.active-conversation-panel').classList.add('show-mobile');

        headerAvatar.src       = contact.avatar || '';
        headerName.textContent  = contact.name;
        headerStatus.textContent = contact.status || '';

        detailsAvatar.src         = contact.avatar || '';
        detailsName.textContent    = contact.name;
        detailsPhone.textContent   = contact.phone || 'Group Chat';
        detailsAbout.textContent   = contact.about || '';

        updateChatCard(id);
        renderMessages(contact.messages || []);
        scrollToBottom();
 
        // Update Favorite UI
        updateFavoriteUI(contact.is_favorite);
 
        // Load AI mode for this contact
        await loadConversationMode(id);

    } catch (err) {
        console.error('[selectChat] Error:', err);
    }
}

// ─── AI Mode Management ───────────────────────────────────────────────────────

async function loadConversationMode(contactId) {
    try {
        const res = await fetch(`/api/contacts/${contactId}/mode`);
        currentMode = await res.json();
        updateModeUI(currentMode.mode, currentMode.agent_name);
    } catch (err) {
        console.error('[loadConversationMode] Error:', err);
        updateModeUI('human', null);
    }
}

function updateModeUI(mode, agentName) {
    if (currentMode) currentMode.mode = mode;

    if (mode === 'ai') {
        modeToggleBtn.classList.add('mode-ai');
        modeToggleBtn.classList.remove('mode-human');
        modeLabel.textContent = 'AI';
        modeIcon.setAttribute('data-lucide', 'bot');

        detailsModeValue.textContent = 'AI Active';
        detailsModeValue.className = 'ai-mode-value ai-active';
        detailsAgentRow.style.display = 'flex';
        detailsAgentName.textContent = agentName || 'Default Agent';
        detailsProviderRow.style.display = currentMode?.provider ? 'flex' : 'none';
        detailsProviderName.textContent = currentMode?.provider || '';
    } else {
        modeToggleBtn.classList.remove('mode-ai');
        modeToggleBtn.classList.add('mode-human');
        modeLabel.textContent = 'Human';
        modeIcon.setAttribute('data-lucide', 'user');

        detailsModeValue.textContent = 'Human';
        detailsModeValue.className = 'ai-mode-value';
        detailsAgentRow.style.display = 'none';
        detailsProviderRow.style.display = 'none';
    }

    // Re-init lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function toggleMode() {
    if (!activeChatId) return;
    const newMode = (currentMode?.mode === 'ai') ? 'human' : 'ai';

    try {
        const body = { mode: newMode };
        if (newMode === 'ai') {
            // Use currently assigned agent or default
            body.agent_config_id = currentMode?.agent_config_id || null;
        }

        const res = await fetch(`/api/contacts/${activeChatId}/mode`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        currentMode = await res.json();
        updateModeUI(currentMode.mode, currentMode.agent_name);
    } catch (err) {
        console.error('[toggleMode] Error:', err);
    }
}
 
async function toggleFavorite() {
    if (!activeChatId) return;
    const contact = contacts.find(c => c.id === activeChatId);
    if (!contact) return;
 
    const newStatus = !contact.is_favorite;
    try {
        const res = await fetch(`/api/contacts/${activeChatId}/favorite`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_favorite: newStatus }),
        });
        if (res.ok) {
            contact.is_favorite = newStatus;
            updateFavoriteUI(newStatus);
            updateChatCard(activeChatId);
            showToast(newStatus ? 'Added to favorites' : 'Removed from favorites', 'success');
        }
    } catch (err) {
        console.error('[toggleFavorite] Error:', err);
    }
}
 
function updateFavoriteUI(isFavorite) {
    const btn = document.getElementById('btnFavorite');
    if (!btn) return;
    if (isFavorite) {
        btn.classList.add('active-fav');
        btn.querySelector('i').setAttribute('data-lucide', 'star');
        btn.style.color = '#ffb703';
    } else {
        btn.classList.remove('active-fav');
        btn.querySelector('i').setAttribute('data-lucide', 'star');
        btn.style.color = '';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons({ root: btn });
}

// ─── Agent Configuration Modal ────────────────────────────────────────────────

async function openAgentModal() {
    agentModalOverlay.classList.remove('hidden');
    editingAgentId = null;
    agentEditorSection.classList.add('hidden');

    await Promise.all([
        loadAgents(),
        loadProviders(),
        loadAgentTypes(),
    ]);

    renderAgentPresets();
    renderProviderStatus();
    populateAssignSelect();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeAgentModalFn() {
    agentModalOverlay.classList.add('hidden');
    agentEditorSection.classList.add('hidden');
    editingAgentId = null;
}

async function loadAgents() {
    try {
        const res = await fetch('/api/agents');
        agents = await res.json();
    } catch (err) {
        agents = [];
    }
}

async function loadProviders() {
    try {
        const res = await fetch('/api/agents/providers');
        providers = await res.json();
    } catch (err) {
        providers = [];
    }
}

async function loadAgentTypes() {
    try {
        const res = await fetch('/api/agents/types');
        agentTypes = await res.json();
    } catch (err) {
        agentTypes = [];
    }
}

function renderAgentPresets() {
    agentPresetsList.innerHTML = '';
    if (agents.length === 0) {
        agentPresetsList.innerHTML = '<p class="empty-text">No agents configured yet. Create one to get started.</p>';
        return;
    }
    agents.forEach(agent => {
        const div = document.createElement('div');
        div.className = 'agent-preset-card';
        div.innerHTML = `
            <div class="agent-preset-info">
                <strong>${escapeHtml(agent.name)}</strong>
                <span class="agent-preset-meta">${agent.agent_type.replace(/_/g, ' ')} &middot; ${agent.provider} &middot; ${agent.model}</span>
                ${agent.is_default ? '<span class="agent-default-badge">Default</span>' : ''}
            </div>
            <div class="agent-preset-actions">
                <button class="icon-btn" data-action="edit" data-id="${agent.id}" title="Edit"><i data-lucide="pencil" size="14"></i></button>
                <button class="icon-btn" data-action="delete" data-id="${agent.id}" title="Delete"><i data-lucide="trash-2" size="14"></i></button>
            </div>`;
        agentPresetsList.appendChild(div);
    });

    // Attach event listeners
    agentPresetsList.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.onclick = () => editAgent(parseInt(btn.dataset.id));
    });
    agentPresetsList.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.onclick = () => deleteAgent(parseInt(btn.dataset.id));
    });
}

function renderProviderStatus() {
    providerStatusList.innerHTML = '';
    providers.forEach(p => {
        const div = document.createElement('div');
        div.className = 'provider-status-item';
        div.innerHTML = `
            <span class="provider-name">${p.label}</span>
            <span class="provider-badge ${p.configured ? 'configured' : 'not-configured'}">
                ${p.configured ? 'Configured' : 'Not Set'}
            </span>
            <span class="provider-model">${p.defaultModel}</span>`;
        providerStatusList.appendChild(div);
    });
}

function populateAssignSelect() {
    assignAgentSelect.innerHTML = '<option value="">-- Select Agent --</option>';
    agents.forEach(agent => {
        assignAgentSelect.innerHTML += `<option value="${agent.id}">${escapeHtml(agent.name)} (${agent.provider})</option>`;
    });
}

function showAgentEditor(agent = null) {
    agentEditorSection.classList.remove('hidden');
    editingAgentId = agent ? agent.id : null;
    agentEditorTitle.textContent = agent ? 'Edit Agent' : 'Create New Agent';

    agentNameInput.value       = agent?.name || '';
    agentTypeSelect.value      = agent?.agent_type || 'customer_support';
    agentProviderSelect.value  = agent?.provider || 'openai';
    agentModelInput.value      = agent?.model || '';
    agentTemperatureInput.value = agent?.temperature ?? 0.7;
    agentMaxTokensInput.value  = agent?.max_tokens ?? 1024;
    agentSystemPrompt.value    = agent?.system_prompt || '';
    agentIsDefault.checked     = !!agent?.is_default;
    agentBaseUrl.value         = agent?.base_url || '';
    toggleBaseUrlVisibility(agentProviderSelect.value);
}

function editAgent(id) {
    const agent = agents.find(a => a.id === id);
    if (agent) showAgentEditor(agent);
}

async function saveAgent() {
    const body = {
        name: agentNameInput.value.trim(),
        agent_type: agentTypeSelect.value,
        provider: agentProviderSelect.value,
        model: agentModelInput.value.trim() || undefined,
        system_prompt: agentSystemPrompt.value.trim(),
        temperature: parseFloat(agentTemperatureInput.value) || 0.7,
        max_tokens: parseInt(agentMaxTokensInput.value) || 1024,
        base_url: agentBaseUrl.value.trim() || null,
        is_default: agentIsDefault.checked,
    };

    if (!body.name) return alert('Agent name is required');

    try {
        const url = editingAgentId ? `/api/agents/${editingAgentId}` : '/api/agents';
        const method = editingAgentId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error(await res.text());

        agentEditorSection.classList.add('hidden');
        editingAgentId = null;
        await loadAgents();
        renderAgentPresets();
        populateAssignSelect();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('[saveAgent] Error:', err);
        alert('Failed to save agent: ' + err.message);
    }
}

async function deleteAgent(id) {
    if (!confirm('Delete this agent configuration?')) return;
    try {
        await fetch(`/api/agents/${id}`, { method: 'DELETE' });
        await loadAgents();
        renderAgentPresets();
        populateAssignSelect();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
        console.error('[deleteAgent] Error:', err);
    }
}

async function assignAndActivate() {
    const agentId = parseInt(assignAgentSelect.value);
    if (!agentId || !activeChatId) return;

    try {
        const res = await fetch(`/api/contacts/${activeChatId}/mode`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'ai', agent_config_id: agentId, auto_handover: true }),
        });
        currentMode = await res.json();
        updateModeUI(currentMode.mode, currentMode.agent_name);
        closeAgentModalFn();
    } catch (err) {
        console.error('[assignAndActivate] Error:', err);
    }
}

async function clearConversationHistory() {
    if (!activeChatId) return;
    if (!confirm('Clear AI conversation memory for this chat? The AI will forget the conversation context.')) return;

    try {
        await fetch(`/api/contacts/${activeChatId}/history/clear`, { method: 'POST' });
        alert('AI conversation memory cleared.');
    } catch (err) {
        console.error('[clearConversationHistory] Error:', err);
    }
}

// ─── AI Training Functions ─────────────────────────────────────────────────────

async function loadTrainingData(agentId) {
    try {
        const res = await fetch(`/api/agents/${agentId}/knowledge`);
        return await res.json();
    } catch (err) {
        console.error('[loadTrainingData] Error:', err);
        return [];
    }
}

function renderTrainingFiles(files) {
    if (!files || files.length === 0) {
        trainingFilesList.innerHTML = '<p class="empty-text">No training data added yet.</p>';
        return;
    }
    
    trainingFilesList.innerHTML = files.map(f => `
        <div class="agent-preset-card" style="margin-bottom:8px;">
            <div class="agent-preset-info">
                <strong>${escapeHtml(f.name)}</strong>
                <span class="agent-preset-meta">
                    ${f.type === 'pdf' ? '📄 PDF' : f.type === 'csv' ? '📊 CSV' : '📗 Google Sheet'} 
                    &middot; ${f.record_count || 0} records
                    ${f.last_synced ? `&middot; Synced: ${new Date(f.last_synced).toLocaleDateString()}` : ''}
                </span>
            </div>
            <div class="agent-preset-actions">
                ${f.type === 'google_sheet' ? `<button class="icon-btn" data-action="sync" data-id="${f.id}" title="Sync"><i data-lucide="refresh-cw" size="14"></i></button>` : ''}
                <button class="icon-btn" data-action="delete" data-id="${f.id}" title="Delete"><i data-lucide="trash-2" size="14"></i></button>
            </div>
        </div>
    `).join('');

    trainingFilesList.querySelectorAll('[data-action="sync"]').forEach(btn => {
        btn.onclick = () => syncTrainingData(parseInt(btn.dataset.id));
    });
    trainingFilesList.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.onclick = () => deleteTrainingData(parseInt(btn.dataset.id));
    });
}

async function syncTrainingData(id) {
    try {
        const res = await fetch(`/api/knowledge/${id}/sync`, { method: 'GET' });
        const data = await res.json();
        if (res.ok) {
            showToast(`Synced successfully! ${data.record_count || 0} records loaded.`, 'success');
            if (currentTrainingAgentId) {
                const files = await loadTrainingData(currentTrainingAgentId);
                renderTrainingFiles(files);
            }
        } else {
            showToast('Sync failed: ' + data.error, 'error');
        }
    } catch (err) {
        showToast('Sync failed: ' + err.message, 'error');
    }
}

async function deleteTrainingData(id) {
    if (!confirm('Delete this training data?')) return;
    try {
        await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
        showToast('Training data deleted', 'success');
        if (currentTrainingAgentId) {
            const files = await loadTrainingData(currentTrainingAgentId);
            renderTrainingFiles(files);
        }
    } catch (err) {
        showToast('Failed to delete: ' + err.message, 'error');
    }
}

async function uploadTrainingFile() {
    if (!selectedTrainingFile || !currentTrainingAgentId) {
        showToast('Please select a file first', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', selectedTrainingFile);

    try {
        const res = await fetch(`/api/agents/${currentTrainingAgentId}/knowledge/upload`, {
            method: 'POST',
            body: formData,
        });
        const data = await res.json();
        
        if (res.ok) {
            showToast('Training file uploaded successfully!', 'success');
            selectedTrainingFile = null;
            trainingFileInput.value = '';
            trainingFileName.textContent = '';
            btnConfirmUpload.disabled = true;
            const files = await loadTrainingData(currentTrainingAgentId);
            renderTrainingFiles(files);
        } else {
            showToast('Upload failed: ' + data.error, 'error');
        }
    } catch (err) {
        showToast('Upload failed: ' + err.message, 'error');
    }
}

async function addGoogleSheet() {
    if (!currentTrainingAgentId) {
        showToast('Please select an agent first', 'error');
        return;
    }

    const url = sheetUrl.value.trim();
    const creds = sheetCredentials.value.trim();
    const name = sheetName.value.trim();

    if (!url) {
        showToast('Please enter a Sheet URL', 'error');
        return;
    }
    if (!creds) {
        showToast('Please enter Service Account JSON', 'error');
        return;
    }

    try {
        JSON.parse(creds);
    } catch {
        showToast('Invalid JSON for credentials', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/agents/${currentTrainingAgentId}/knowledge/google-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheet_url: url, credentials: creds, sheet_name: name }),
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Google Sheet added successfully!', 'success');
            sheetUrl.value = '';
            sheetName.value = '';
            sheetCredentials.value = '';
            const files = await loadTrainingData(currentTrainingAgentId);
            renderTrainingFiles(files);
        } else {
            showToast('Failed: ' + data.error, 'error');
        }
    } catch (err) {
        showToast('Failed: ' + err.message, 'error');
    }
}

// Auto-populate model and system prompt when type/provider changes
function onAgentTypeChange() {
    const type = agentTypeSelect.value;
    const typeData = agentTypes.find(t => t.type === type);
    if (typeData && !agentSystemPrompt.value) {
        agentSystemPrompt.value = typeData.defaultPrompt;
    }
}

function onAgentProviderChange() {
    const provider = agentProviderSelect.value;
    const provData = providers.find(p => p.id === provider);
    if (provData) {
        agentModelInput.value = provData.defaultModel || '';
    }
    toggleBaseUrlVisibility(provider);
    
    if (['ollama', 'lmstudio'].includes(provider)) {
        setTimeout(() => autoLoadModels(provider), 100);
    }
}

async function autoLoadModels(provider) {
    const baseUrl = agentBaseUrl.value.trim() || null;
    
    if (!baseUrl) {
        console.log('[autoLoadModels] No baseUrl set, skipping auto-load');
        return;
    }

    try {
        const res = await fetch(`/api/providers/${provider}/models?baseUrl=${encodeURIComponent(baseUrl)}`);
        const data = await res.json();
        
        if (res.ok && data.models && data.models.length > 0) {
            agentModelInput.value = data.models[0];
            showToast(`Auto-detected model: ${data.models[0]}`, 'success');
        }
    } catch (err) {
        console.log('[autoLoadModels] Failed:', err.message);
    }
}

function toggleBaseUrlVisibility(provider) {
    const localProviders = ['ollama', 'lmstudio'];
    if (localProviders.includes(provider)) {
        baseUrlGroup.style.display = 'block';
        const provData = providers.find(p => p.id === provider);
        if (provData && provData.defaultUrl && !agentBaseUrl.value) {
            agentBaseUrl.value = provData.defaultUrl;
        }
        setTimeout(() => autoLoadModels(provider), 200);
    } else {
        baseUrlGroup.style.display = 'none';
        agentBaseUrl.value = '';
    }
}

async function loadProviderModels() {
    const provider = agentProviderSelect.value;
    const baseUrl = agentBaseUrl.value.trim() || null;
    
    if (!['ollama', 'lmstudio'].includes(provider)) {
        showToast('Model loading only available for local providers', 'error');
        return;
    }

    btnLoadModels.disabled = true;
    btnLoadModels.innerHTML = '<i data-lucide="loader" size="14" class="spin"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
        const res = await fetch(`/api/providers/${provider}/models?baseUrl=${encodeURIComponent(baseUrl || '')}`);
        const data = await res.json();
        
        if (res.ok && data.models && data.models.length > 0) {
            agentModelInput.value = data.models[0];
            showToast(`Loaded ${data.models.length} models from ${provider}`, 'success');
            
            if (data.models.length > 1) {
                const selected = prompt(`Select model (1-${data.models.length}):\n${data.models.map((m, i) => `${i + 1}. ${m}`).join('\n')}`);
                if (selected) {
                    const idx = parseInt(selected) - 1;
                    if (idx >= 0 && idx < data.models.length) {
                        agentModelInput.value = data.models[idx];
                    }
                }
            }
        } else {
            showToast(data.error || 'No models found. Is the server running?', 'error');
        }
    } catch (err) {
        showToast('Failed to load models: ' + err.message, 'error');
    } finally {
        btnLoadModels.disabled = false;
        btnLoadModels.innerHTML = '<i data-lucide="refresh-cw" size="14"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

// ─── Render Messages ──────────────────────────────────────────────────────────

function renderMessages(messages) {
    messagesContainer.innerHTML = '';
    messages.forEach(msg => appendMessageBubble(msg, false));
}

function appendMessageBubble(msg, animate = true) {
    const div       = document.createElement('div');
    div.className   = `message ${msg.type}${animate ? ' msg-animate' : ''}`;
    div.dataset.msgId = msg.id || '';

    if (msg.media_type === 'image' && msg.media_url) {
        div.classList.add('message-media');
        div.innerHTML = `
            <img src="${escapeHtml(msg.media_url)}" alt="${escapeHtml(msg.caption || 'Image')}" class="msg-media" loading="lazy" onclick="window.open('${escapeHtml(msg.media_url)}', '_blank')">
            ${msg.caption ? `<p>${escapeHtml(msg.caption)}</p>` : ''}
            ${msg.text && msg.text !== '[Image]' && msg.text !== msg.caption ? `<p>${escapeHtml(msg.text)}</p>` : ''}
            <div class="msg-meta">
                <span class="msg-time">${msg.time || ''}</span>
                ${msg.type === 'outgoing' ? `<span class="msg-status">${statusIcon(msg.status)}</span>` : ''}
            </div>`;
    } else if (msg.media_type === 'video' && msg.media_url) {
        div.classList.add('message-media');
        div.innerHTML = `
            <video src="${escapeHtml(msg.media_url)}" class="msg-media" controls preload="metadata"></video>
            ${msg.caption ? `<p>${escapeHtml(msg.caption)}</p>` : ''}
            ${msg.text && msg.text !== '[Video]' && msg.text !== msg.caption ? `<p>${escapeHtml(msg.text)}</p>` : ''}
            <div class="msg-meta">
                <span class="msg-time">${msg.time || ''}</span>
                ${msg.type === 'outgoing' ? `<span class="msg-status">${statusIcon(msg.status)}</span>` : ''}
            </div>`;
    } else {
        div.innerHTML = `
            <p>${escapeHtml(msg.text)}</p>
            <div class="msg-meta">
                <span class="msg-time">${msg.time || ''}</span>
                ${msg.type === 'outgoing' ? `<span class="msg-status">${statusIcon(msg.status)}</span>` : ''}
            </div>`;
    }

    messagesContainer.appendChild(div);
    if (animate) scrollToBottom();
}

function statusIcon(status) {
    if (status === 'read')      return '✓✓';
    if (status === 'delivered') return '✓✓';
    if (status === 'sent')      return '✓';
    if (status === 'failed')    return '✗';
    return '';
}

// ─── Send Message ─────────────────────────────────────────────────────────────

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activeChatId) return;

    messageInput.value = '';
    messageInput.style.height = 'auto'; // Reset height
    updateInputButtons();

    try {
        const res = await fetch(`/api/contacts/${activeChatId}/messages`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text }),
        });

        if (!res.ok) throw new Error(await res.text());

    } catch (err) {
        console.error('[sendMessage] Error:', err);
        appendMessageBubble({ type: 'outgoing', text, status: 'failed', time: 'now' }, true);
    }
}

// ─── Input Area Helpers ───────────────────────────────────────────────────────

function updateInputButtons() {
    if (messageInput.value.trim().length > 0) {
        sendBtn.classList.remove('hidden');
        micBtn.classList.add('hidden');
    } else {
        sendBtn.classList.add('hidden');
        micBtn.classList.remove('hidden');
    }
}

function adjustTextareaHeight() {
    messageInput.style.height = 'auto';
    const newHeight = Math.min(messageInput.scrollHeight, 150);
    messageInput.style.height = newHeight + 'px';
}

function toggleAttachmentMenu() {
    attachmentMenu.classList.toggle('hidden');
    if (!attachmentMenu.classList.contains('hidden')) {
        // Auto-close when clicking outside
        const closeMenu = (e) => {
            if (!attachmentMenu.contains(e.target) && e.target !== plusBtn && !plusBtn.contains(e.target)) {
                attachmentMenu.classList.add('hidden');
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }
}

let recordingInterval = null;
function toggleRecording() {
    const isRecording = !recordingUI.classList.contains('hidden');
    
    if (!isRecording) {
        // Start recording simulation
        recordingUI.classList.remove('hidden');
        messageInput.classList.add('hidden');
        let seconds = 0;
        const timerSpan = recordingUI.querySelector('.recording-timer');
        timerSpan.textContent = '0:00';
        
        recordingInterval = setInterval(() => {
            seconds++;
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            timerSpan.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }, 1000);
        
        showToast('Recording voice message...', 'info');
    } else {
        // Stop recording simulation
        clearInterval(recordingInterval);
        recordingUI.classList.add('hidden');
        messageInput.classList.remove('hidden');
        showToast('Voice message sent (simulated)', 'success');
    }
}

// ─── Send Media (Image/Video) ──────────────────────────────────────────────────

async function sendMedia(file) {
    if (!file || !activeChatId) return;

    const isVideo = file.type.startsWith('video/');
    const label = isVideo ? 'video' : 'image';
    const caption = prompt(`Add a caption for the ${label} (or leave empty):`) || '';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('caption', caption);

    try {
        const res = await fetch(`/api/contacts/${activeChatId}/upload`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) throw new Error(await res.text());
    } catch (err) {
        console.error('[sendMedia] Error:', err);
        alert('Failed to send ' + label + ': ' + err.message);
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

let flashInterval = null;
let focusHandler = null;
function flashTabTitle(name) {
    if (document.hasFocus()) return;
    clearInterval(flashInterval);
    // Remove previous focus listener to avoid leak
    if (focusHandler) {
        window.removeEventListener('focus', focusHandler);
    }
    let toggle = true;
    flashInterval = setInterval(() => {
        document.title = toggle ? `💬 ${name}` : originalTitle;
        toggle = !toggle;
    }, 1500);

    focusHandler = () => {
        clearInterval(flashInterval);
        document.title = originalTitle;
        focusHandler = null;
    };
    window.addEventListener('focus', focusHandler, { once: true });
}

// ─── Simulation ──────────────────────────────────────────────────────────────

async function simulateInboundMessage() {
    if (!activeChatId) return;
    const text = prompt("Enter a test message the contact should 'send' you:");
    if (!text) return;

    try {
        await fetch('/api/simulate/receive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId: activeChatId, text })
        });
    } catch (err) {
        console.error('[simulateInboundMessage] Error:', err);
    }
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

function setupEventListeners() {
    sendBtn.onclick        = sendMessage;
    plusBtn.onclick        = toggleAttachmentMenu;
    micBtn.onclick         = toggleRecording;

    messageInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    messageInput.addEventListener('input', () => {
        adjustTextareaHeight();
        updateInputButtons();
    });
    chatSearch.oninput     = sortAndRenderChatList;

    document.getElementById('openDetails').onclick = () => {
        document.querySelector('.app-wrapper').classList.add('details-open');
    };
    document.getElementById('closeDetails').onclick = () => {
        document.querySelector('.app-wrapper').classList.remove('details-open');
    };
    document.getElementById('backBtn').onclick = () => {
        document.querySelector('.active-conversation-panel').classList.remove('show-mobile');
    };

    // Filter Pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
        pill.onclick = (e) => {
            document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.textContent.trim().toLowerCase();
            sortAndRenderChatList();
        };
    });

    // Settings Drawer Logic
    if (!document.getElementById('settingsOverlay')) {
        settingsOverlay = document.createElement('div');
        settingsOverlay.id = 'settingsOverlay';
        settingsOverlay.className = 'settings-overlay';
        const appWrapper = document.querySelector('.app-wrapper');
        if (appWrapper) {
            appWrapper.appendChild(settingsOverlay);
        } else {
            document.body.appendChild(settingsOverlay);
        }
    } else {
        settingsOverlay = document.getElementById('settingsOverlay');
    }

    function toggleSettingsDrawer() {
        const isOpen = settingsDrawer.classList.contains('open');
        if (isOpen) {
            settingsDrawer.classList.remove('open');
            settingsOverlay.classList.remove('active');
            btnSettings.classList.remove('settings-active');
        } else {
            settingsDrawer.classList.add('open');
            settingsOverlay.classList.add('active');
            btnSettings.classList.add('settings-active');
        }
    }

    if (btnSettings) btnSettings.onclick = toggleSettingsDrawer;
    if (closeSettings) closeSettings.onclick = toggleSettingsDrawer;
    if (settingsOverlay) settingsOverlay.onclick = toggleSettingsDrawer;

    // Settings Menu Actions
    const btnsettingsAIAgents = document.getElementById('settingsAIAgents');
    if (btnsettingsAIAgents) {
        btnsettingsAIAgents.onclick = () => {
            window.location.href = '/admin.html';
        };
    }
    
    const btnsettingsCatalog = document.getElementById('settingsCatalog');
    if (btnsettingsCatalog) btnsettingsCatalog.onclick = () => window.location.href = 'catalog.html';
    
    const btnsettingsFlows = document.getElementById('settingsFlows');
    if (btnsettingsFlows) btnsettingsFlows.onclick = () => window.location.href = 'flows.html';
    
    const btnsettingsAdmin = document.getElementById('settingsAdmin');
    if (btnsettingsAdmin) btnsettingsAdmin.onclick = () => window.location.href = '/admin.html';
    
    ['settingsCommunities', 'settingsStatus', 'settingsChannels'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.onclick = () => showToast('Feature coming soon in future updates!');
    });

    // Missing Feature Toasts for Chat UI features
    const unmappedButtons = [
        'btnNewChat', 'chatSearchBtn', 'chatMenuBtn', 'btnEmoji'
    ];
    unmappedButtons.forEach(id => {
        let btn = document.getElementById(id);
        if (!btn) {
            if (id === 'micBtn') btn = document.querySelector('.mic-btn');
        }
        if (btn) btn.onclick = () => showToast('Feature coming soon in future updates!');
    });

    // Refresh button - reload contacts
    document.getElementById('btnRefresh').onclick = async () => {
        console.log('[Refresh] Reloading contacts...');
        try {
            const res = await fetch('/api/contacts');
            contacts = await res.json();
            contacts.forEach(c => { unreadCounts[c.id] = c.unread || 0; });
            sortAndRenderChatList();
            showToast('Contacts refreshed!');
        } catch (err) {
            console.error('[Refresh] Failed to reload contacts:', err);
            showToast('Failed to refresh contacts');
        }
    };

    // AI mode toggle button (in chat header)
    modeToggleBtn.onclick = toggleMode;

    // Image upload button
    document.getElementById('imageUploadBtn').onclick = () => {
        if (!activeChatId) return;
        document.getElementById('imageFileInput').click();
    };
    document.getElementById('imageFileInput').onchange = (e) => {
        const file = e.target.files[0];
        if (file) sendMedia(file);
        e.target.value = '';
    };

    // Favorite toggle button
    document.getElementById('btnFavorite').onclick = toggleFavorite;

    // Video upload button
    document.getElementById('videoUploadBtn').onclick = () => {
        if (!activeChatId) return;
        document.getElementById('videoFileInput').click();
    };
    document.getElementById('videoFileInput').onchange = (e) => {
        const file = e.target.files[0];
        if (file) sendMedia(file);
        e.target.value = '';
    };

    // Simulate inbound message button
    document.getElementById('simulateMsgBtn').onclick = simulateInboundMessage;

    // Details panel AI buttons
    detailsToggleModeBtn.onclick = toggleMode;
    detailsConfigureAgentBtn.onclick = openAgentModal;
    detailsClearHistoryBtn.onclick = clearConversationHistory;

    // Agent modal
    closeAgentModal.onclick = closeAgentModalFn;
    agentModalOverlay.onclick = (e) => { if (e.target === agentModalOverlay) closeAgentModalFn(); };
    createAgentBtn.onclick = () => showAgentEditor();
    saveAgentBtn.onclick = saveAgent;
    cancelAgentBtn.onclick = () => { agentEditorSection.classList.add('hidden'); editingAgentId = null; };
    assignAgentBtn.onclick = assignAndActivate;
    agentTypeSelect.onchange = onAgentTypeChange;
    agentProviderSelect.onchange = onAgentProviderChange;
    btnLoadModels.onclick = loadProviderModels;

    // Training section
    btnUploadTraining.onclick = () => trainingFileInput.click();
    trainingFileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            selectedTrainingFile = file;
            trainingFileName.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
            btnConfirmUpload.disabled = false;
        }
    };
    btnConfirmUpload.onclick = uploadTrainingFile;
    btnAddGoogleSheet.onclick = addGoogleSheet;

    // Update currentTrainingAgentId when editing an agent
    const originalShowAgentEditor = showAgentEditor;
    showAgentEditor = async (agent = null) => {
        await originalShowAgentEditor(agent);
        const targetId = agent ? agent.id : (agents.length > 0 ? agents[0].id : null);
        if (targetId) {
            currentTrainingAgentId = targetId;
            const files = await loadTrainingData(targetId);
            renderTrainingFiles(files);
        }
    };

    // Update training agent when selecting an agent from presets
    const originalRenderAgentPresets = renderAgentPresets;
    renderAgentPresets = () => {
        originalRenderAgentPresets();
        agentPresetsList.querySelectorAll('.agent-preset-card').forEach(card => {
            card.onclick = async (e) => {
                if (e.target.closest('.agent-preset-actions')) return;
                const id = parseInt(card.querySelector('[data-action="edit"]')?.dataset.id);
                if (id) {
                    currentTrainingAgentId = id;
                    const files = await loadTrainingData(id);
                    renderTrainingFiles(files);
                }
            };
        });
    };

    // Catalog buttons in attachment menu
    document.getElementById('btnSendCatalog').onclick = () => {
        attachmentMenu.classList.add('hidden');
        if (!activeChatId) return showToast('Select a chat first', 'error');
        openChatCatalogModal('catalog');
    };
    document.getElementById('btnSendProduct').onclick = () => {
        attachmentMenu.classList.add('hidden');
        if (!activeChatId) return showToast('Select a chat first', 'error');
        openChatCatalogModal('product');
    };

    // Send Flow button
    document.getElementById('btnSendFlow').onclick = () => {
        attachmentMenu.classList.add('hidden');
        if (!activeChatId) return showToast('Select a chat first', 'error');
        openChatFlowModal();
    };
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    
    // Icon based on type
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'error') icon = 'alert-triangle';
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i data-lucide="${icon}" size="18"></i>
        </div>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);
    
    // Initialize icons for the new DOM element
    if (window.lucide) {
        lucide.createIcons({ root: toast });
    }

    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // Wait for transition
    }, 3000);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

init();

// ─── Chat Catalog Modal ──────────────────────────────────────────────────────

let chatCatalogMode = 'catalog'; // 'catalog' or 'product'
let chatCatalogProducts = [];
let chatSelectedCatalogId = null;
let chatSelectedProductId = null;

const chatCatalogModal = document.getElementById('chatCatalogModal');
const chatCatalogModalTitle = document.getElementById('chatCatalogModalTitle');
const chatCatalogSelect = document.getElementById('chatCatalogSelect');
const chatCatalogProductsSection = document.getElementById('chatCatalogProductsSection');
const chatCatalogSearch = document.getElementById('chatCatalogSearch');
const chatCatalogProductList = document.getElementById('chatCatalogProductList');
const chatCatalogMessage = document.getElementById('chatCatalogMessage');
const btnChatCatalogSend = document.getElementById('btnChatCatalogSend');
const btnChatCatalogCancel = document.getElementById('btnChatCatalogCancel');
const chatCatalogSendLabel = document.getElementById('chatCatalogSendLabel');
const closeChatCatalogModal = document.getElementById('closeChatCatalogModal');

async function openChatCatalogModal(mode) {
    chatCatalogMode = mode;
    chatSelectedProductId = null;
    chatCatalogModalTitle.textContent = mode === 'catalog' ? 'Send Catalog' : 'Send Product';
    chatCatalogSendLabel.textContent = mode === 'catalog' ? 'Send Catalog' : 'Send Product';
    chatCatalogMessage.value = mode === 'catalog' ? 'Browse our catalog!' : 'Check out this product!';
    chatCatalogProductsSection.classList.add('hidden');
    btnChatCatalogSend.disabled = true;
    chatCatalogModal.classList.remove('hidden');

    // Load catalogs
    try {
        const res = await fetch('/api/catalog/catalogs');
        const data = await res.json();
        
        // Merge local and remote catalogs, deduplicating by catalog_id
        const allCatalogs = [...(data.local || []), ...(data.remote || [])];
        const uniqueCatalogs = [];
        const seenIds = new Set();
        allCatalogs.forEach(c => {
            if (c.catalog_id && c.catalog_id !== 'pending' && !seenIds.has(c.catalog_id)) {
                seenIds.add(c.catalog_id);
                uniqueCatalogs.push(c);
            }
        });

        chatCatalogSelect.innerHTML = '<option value="">-- Select a catalog --</option>';
        uniqueCatalogs.forEach(c => {
            chatCatalogSelect.innerHTML += `<option value="${c.catalog_id}">${escapeHtml(c.name || c.catalog_id)}</option>`;
        });
    } catch (err) {
        chatCatalogSelect.innerHTML = '<option value="">Failed to load catalogs</option>';
        console.error('[Catalog Load]', err);
    }
}

function closeChatCatalogModalFn() {
    chatCatalogModal.classList.add('hidden');
}

async function loadChatCatalogProducts(catalogId) {
    chatSelectedCatalogId = catalogId;
    chatCatalogProductsSection.classList.remove('hidden');
    chatCatalogProductList.innerHTML = '<p class="empty-text">Loading products...</p>';

    try {
        const res = await fetch(`/api/catalog/products/${catalogId}`);
        const data = await res.json();
        chatCatalogProducts = data.products || [];
        renderChatCatalogProducts(chatCatalogProducts);
    } catch (err) {
        chatCatalogProductList.innerHTML = '<p class="empty-text">Failed to load products</p>';
    }
}

function renderChatCatalogProducts(items) {
    if (items.length === 0) {
        chatCatalogProductList.innerHTML = '<p class="empty-text">No products found</p>';
        return;
    }

    chatCatalogProductList.innerHTML = items.map(p => `
        <div class="chat-catalog-product-item" data-id="${escapeHtml(p.product_id || p.retailer_id)}" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;cursor:pointer;border:1px solid transparent;margin-bottom:4px;transition:all 0.2s">
            ${p.image_url ? `<img src="${escapeHtml(p.image_url)}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;border:1px solid var(--glass-border)">` : '<div style="width:40px;height:40px;border-radius:8px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center"><i data-lucide="image" size="16" style="color:var(--text-secondary)"></i></div>'}
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</div>
                <div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(p.price || 'N/A')}</div>
            </div>
            <div style="width:18px;height:18px;border-radius:50%;border:2px solid var(--glass-border);flex-shrink:0" class="product-radio"></div>
        </div>
    `).join('');

    // Click handlers for product selection
    chatCatalogProductList.querySelectorAll('.chat-catalog-product-item').forEach(item => {
        item.onclick = () => {
            chatCatalogProductList.querySelectorAll('.chat-catalog-product-item').forEach(i => {
                i.style.borderColor = 'transparent';
                i.querySelector('.product-radio').style.background = 'transparent';
                i.querySelector('.product-radio').style.borderColor = 'var(--glass-border)';
            });
            item.style.borderColor = 'var(--accent-vibrant)';
            item.querySelector('.product-radio').style.background = 'var(--accent-vibrant)';
            item.querySelector('.product-radio').style.borderColor = 'var(--accent-vibrant)';
            chatSelectedProductId = item.dataset.id;
            btnChatCatalogSend.disabled = false;
        };
    });

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: chatCatalogProductList });
}

async function sendChatCatalogMessage() {
    if (!activeChatId || !chatSelectedCatalogId) return;

    const msg = chatCatalogMessage.value || '';

    try {
        let url, body;

        if (chatCatalogMode === 'product' && chatSelectedProductId) {
            url = '/api/catalog/send-product';
            body = {
                contact_id: activeChatId,
                catalog_id: chatSelectedCatalogId,
                product_retailer_id: chatSelectedProductId,
                body_text: msg,
            };
        } else {
            // Send full catalog
            const sections = [{
                title: 'All Items',
                product_items: chatCatalogProducts.slice(0, 10).map(p => ({
                    product_retailer_id: p.retailer_id || p.product_id,
                })),
            }];
            url = '/api/catalog/send-catalog';
            body = {
                contact_id: activeChatId,
                catalog_id: chatSelectedCatalogId,
                header_text: 'Our Products',
                body_text: msg,
                sections,
            };
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error(await res.text());
        showToast(chatCatalogMode === 'catalog' ? 'Catalog sent!' : 'Product sent!', 'success');
        closeChatCatalogModalFn();
    } catch (err) {
        console.error('[Chat Catalog Send] Error:', err);
        showToast('Failed to send: ' + err.message, 'error');
    }
}

// Wire up chat catalog modal events
closeChatCatalogModal.onclick = closeChatCatalogModalFn;
btnChatCatalogCancel.onclick = closeChatCatalogModalFn;
btnChatCatalogSend.onclick = sendChatCatalogMessage;
chatCatalogModal.onclick = (e) => { if (e.target === chatCatalogModal) closeChatCatalogModalFn(); };
chatCatalogSelect.onchange = () => {
    const val = chatCatalogSelect.value;
    if (val) loadChatCatalogProducts(val);
    else {
        chatCatalogProductsSection.classList.add('hidden');
        btnChatCatalogSend.disabled = true;
    }
};
chatCatalogSearch.oninput = () => {
    const q = chatCatalogSearch.value.toLowerCase().trim();
    if (!q) return renderChatCatalogProducts(chatCatalogProducts);
    renderChatCatalogProducts(chatCatalogProducts.filter(p =>
        p.name.toLowerCase().includes(q) || (p.retailer_id || '').toLowerCase().includes(q)
    ));
};

// ─── Chat Flow Modal ─────────────────────────────────────────────────────────

const chatFlowModal = document.getElementById('chatFlowModal');
const chatFlowSelect = document.getElementById('chatFlowSelect');
const chatFlowHeader = document.getElementById('chatFlowHeader');
const chatFlowBody = document.getElementById('chatFlowBody');
const chatFlowCTA = document.getElementById('chatFlowCTA');
const btnChatFlowSend = document.getElementById('btnChatFlowSend');
const btnChatFlowCancel = document.getElementById('btnChatFlowCancel');
const closeChatFlowModal = document.getElementById('closeChatFlowModal');

async function openChatFlowModal() {
    chatFlowModal.classList.remove('hidden');
    btnChatFlowSend.disabled = true;

    try {
        const res = await fetch('/api/flows');
        const allFlows = await res.json();
        const published = allFlows.filter(f => f.status === 'PUBLISHED');

        chatFlowSelect.innerHTML = '<option value="">-- Select a flow --</option>';
        published.forEach(f => {
            chatFlowSelect.innerHTML += `<option value="${f.flow_id}">${escapeHtml(f.name)}</option>`;
        });

        if (published.length === 0) {
            chatFlowSelect.innerHTML = '<option value="">No published flows available</option>';
        }
    } catch (err) {
        chatFlowSelect.innerHTML = '<option value="">Failed to load flows</option>';
    }
}

// ─── WebRTC Calling System ──────────────────────────────────────────────────

// Call state variables
let currentCall = null;
let localStream = null;
let peerConnection = null;
let isInCall = false;
let callType = 'audio'; // 'audio' or 'video'

// WebRTC configuration
const rtcConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// DOM elements
const callModal = document.getElementById('callModal');
const callerName = document.getElementById('callerName');
const callerAvatar = document.getElementById('callerAvatar');
const callStatus = document.getElementById('callStatus');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const endCallBtn = document.getElementById('endCallBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const speakerBtn = document.getElementById('speakerBtn');

// Initialize call system
async function initCallSystem() {
    try {
        // Request microphone/camera permissions on page load
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false // Start with audio only
        });
        console.log('[Call] Media permissions granted');
    } catch (err) {
        console.error('[Call] Failed to get media permissions:', err);
    }
}

// Create peer connection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfiguration);

    // Add local stream tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        console.log('[Call] Received remote stream');
        remoteVideo.srcObject = event.streams[0];
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('[Call] Sending ICE candidate');
            socket.emit('call_ice_candidate', {
                candidate: event.candidate,
                to: currentCall.contactId
            });
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
        console.log('[Call] Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            callStatus.textContent = 'Connected';
            isInCall = true;
        }
    };

    return peerConnection;
}

// Start a call
async function startCall(contactId, type = 'audio') {
    if (!contactId) {
        showToast('Please select a contact first');
        return;
    }

    const contact = contacts.find(c => c.id === contactId);
    if (!contact) {
        showToast('Contact not found');
        return;
    }

    callType = type;
    currentCall = {
        contactId,
        contactName: contact.name,
        contactAvatar: contact.avatar,
        type,
        initiator: true,
        startTime: Date.now()
    };

    try {
        // Create call record in database
        const response = await fetch('/api/calls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: contactId,
                type: type,
                direction: 'outgoing',
                status: 'ongoing'
            })
        });

        if (response.ok) {
            const callRecord = await response.json();
            currentCall.id = callRecord.id;
            console.log('[Call] Call record created:', callRecord.id);
        }

        // Get media stream based on call type
        if (type === 'video') {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            });
            localVideo.srcObject = localStream;
            localVideo.style.display = 'block';
        } else {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
            localVideo.style.display = 'none';
        }

        // Create peer connection
        peerConnection = createPeerConnection();

        // Create offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Show call modal
        showCallModal(currentCall.contactName, currentCall.contactAvatar, 'Calling...');

        // Send call offer via Socket.IO
        socket.emit('call_offer', {
            offer,
            to: contactId,
            type
        });

        console.log('[Call] Call initiated to:', contact.name);

    } catch (err) {
        console.error('[Call] Failed to start call:', err);
        showToast('Failed to start call - check microphone/camera permissions');
        endCall();
    }
}

// Answer incoming call
async function answerCall(callData) {
    const { offer, from, type } = callData;
    const contact = contacts.find(c => c.id === from);

    if (!contact) {
        console.error('[Call] Contact not found for incoming call');
        return;
    }

    callType = type;
    currentCall = {
        contactId: from,
        contactName: contact.name,
        contactAvatar: contact.avatar,
        type,
        initiator: false
    };

    try {
        // Get media stream
        if (type === 'video') {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            });
            localVideo.srcObject = localStream;
            localVideo.style.display = 'block';
        } else {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
            localVideo.style.display = 'none';
        }

        // Create peer connection
        peerConnection = createPeerConnection();

        // Set remote description
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Show call modal
        showCallModal(currentCall.contactName, currentCall.contactAvatar, 'Connecting...');

        // Send answer
        socket.emit('call_answer', {
            answer,
            to: from
        });

        console.log('[Call] Call answered from:', contact.name);

    } catch (err) {
        console.error('[Call] Failed to answer call:', err);
        endCall();
    }
}

// Show call modal
function showCallModal(name, avatar, status) {
    callerName.textContent = name;
    callerAvatar.src = avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
    callStatus.textContent = status;
    callModal.classList.add('show');

    // Update call controls based on call type
    if (callType === 'audio') {
        videoBtn.style.display = 'none';
    } else {
        videoBtn.style.display = 'flex';
    }
}

// End call
async function endCall() {
    console.log('[Call] Ending call');

    // Calculate duration and update database
    if (currentCall && currentCall.id) {
        const duration = Math.floor((Date.now() - currentCall.startTime) / 1000);
        try {
            await fetch(`/api/calls/${currentCall.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: isInCall ? 'completed' : 'failed',
                    duration: duration
                })
            });
            console.log('[Call] Call record updated:', currentCall.id, 'duration:', duration);
        } catch (err) {
            console.error('[Call] Failed to update call record:', err);
        }
    }

    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Stop media streams
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Hide videos
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    localVideo.style.display = 'none';

    // Hide modal
    callModal.classList.remove('show');

    // Notify other party
    if (currentCall && isInCall) {
        socket.emit('call_end', { to: currentCall.contactId });
    }

    // Reset state
    currentCall = null;
    isInCall = false;
}

// Toggle mute
function toggleMute() {
    if (!localStream) return;

    const audioTracks = localStream.getAudioTracks();
    const isMuted = audioTracks[0].enabled;

    audioTracks.forEach(track => {
        track.enabled = !isMuted;
    });

    muteBtn.classList.toggle('muted', !isMuted);
    const icon = muteBtn.querySelector('i');
    icon.setAttribute('data-lucide', isMuted ? 'mic-off' : 'mic');
    lucide.createIcons();
}

// Toggle video
function toggleVideo() {
    if (!localStream || callType === 'audio') return;

    const videoTracks = localStream.getVideoTracks();
    const isVideoOn = videoTracks[0].enabled;

    videoTracks.forEach(track => {
        track.enabled = !isVideoOn;
    });

    videoBtn.classList.toggle('active', !isVideoOn);
}

// Toggle speaker
function toggleSpeaker() {
    if (!remoteVideo.srcObject) return;

    const audioTracks = remoteVideo.srcObject.getAudioTracks();
    const isSpeakerOn = audioTracks[0].enabled;

    audioTracks.forEach(track => {
        track.enabled = !isSpeakerOn;
    });

    speakerBtn.classList.toggle('active', !isSpeakerOn);
}

// Socket.IO call event handlers
socket.on('call_offer', (data) => {
    console.log('[Socket] Incoming call offer:', data);
    // For now, auto-answer calls. In production, show accept/reject dialog
    answerCall(data);
});

socket.on('call_answer', async (data) => {
    console.log('[Socket] Call answered:', data);
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        callStatus.textContent = 'Connecting...';
    }
});

socket.on('call_ice_candidate', (data) => {
    console.log('[Socket] Received ICE candidate');
    if (peerConnection) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

socket.on('call_end', () => {
    console.log('[Socket] Call ended by other party');
    endCall();
});

// Event listeners
videoCallBtn.onclick = () => startCall(activeChatId, 'video');
voiceCallBtn.onclick = () => startCall(activeChatId, 'audio');
endCallBtn.onclick = endCall;
muteBtn.onclick = toggleMute;
videoBtn.onclick = toggleVideo;
speakerBtn.onclick = toggleSpeaker;

// Initialize call system
initCallSystem();

function closeChatFlowModalFn() {
    chatFlowModal.classList.add('hidden');
}

async function sendChatFlow() {
    const flowId = chatFlowSelect.value;
    if (!flowId || !activeChatId) return;

    try {
        const res = await fetch(`/api/flows/${flowId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: activeChatId,
                header_text: chatFlowHeader.value || null,
                body_text: chatFlowBody.value || 'Please fill out this form',
                flow_cta: chatFlowCTA.value || 'Start',
            }),
        });

        if (!res.ok) throw new Error(await res.text());
        showToast('Flow sent!', 'success');
        closeChatFlowModalFn();
    } catch (err) {
        console.error('[Chat Flow Send] Error:', err);
        showToast('Failed to send flow: ' + err.message, 'error');
    }
}

chatFlowSelect.onchange = () => { btnChatFlowSend.disabled = !chatFlowSelect.value; };
closeChatFlowModal.onclick = closeChatFlowModalFn;
btnChatFlowCancel.onclick = closeChatFlowModalFn;
btnChatFlowSend.onclick = sendChatFlow;
chatFlowModal.onclick = (e) => { if (e.target === chatFlowModal) closeChatFlowModalFn(); };
