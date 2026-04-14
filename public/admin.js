'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let agents = [];
let agentTypes = [];
let providers = [];
let mcpServers = [];
let editingAgentId = null;

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const agentListContainer = document.getElementById('agentListContainer');
const btnCreateNew       = document.getElementById('btnCreateNew');
const btnWelcomeCreate   = document.getElementById('btnWelcomeCreate');
const btnBackToDashboard = document.getElementById('btnBackToDashboard');
const btnDeleteAgent     = document.getElementById('btnDeleteAgent');
const btnSaveAgent       = document.getElementById('btnSaveAgent');

const noAgentSelected = document.getElementById('noAgentSelected');
const agentEditor     = document.getElementById('agentEditor');
const formTitle       = document.getElementById('formTitle');
const formSubtitle    = document.getElementById('formSubtitle');

const inputName        = document.getElementById('agentName');
const selectType       = document.getElementById('agentType');
const selectProvider   = document.getElementById('agentProvider');
const inputModel       = document.getElementById('agentModel');
const inputTemp        = document.getElementById('agentTemperature');
const inputTokens      = document.getElementById('agentMaxTokens');
const inputPrompt      = document.getElementById('agentSystemPrompt');
const inputBaseUrl     = document.getElementById('agentBaseUrl');
const baseUrlGroup     = document.getElementById('baseUrlGroup');
const loadModelsBtn    = document.getElementById('loadModelsBtn');

// MCP DOM Elements
const mcpServersList       = document.getElementById('mcpServersList');
const btnAddGoogleSheetMcp = document.getElementById('btnAddGoogleSheetMcp');
const mcpGoogleSheetModal  = document.getElementById('mcpGoogleSheetModal');
const closeMcpModal        = document.getElementById('closeMcpModal');
const btnCancelMcpSheet    = document.getElementById('btnCancelMcpSheet');
const btnSaveMcpSheet      = document.getElementById('btnSaveMcpSheet');
const mcpSheetName         = document.getElementById('mcpSheetName');
const mcpSheetUrl          = document.getElementById('mcpSheetUrl');
const mcpSheetCreds        = document.getElementById('mcpSheetCreds');
const mcpSheetRead         = document.getElementById('mcpSheetRead');
const mcpSheetWrite        = document.getElementById('mcpSheetWrite');

// ─── Initialization ───────────────────────────────────────────────────────────
async function init() {
    try {
        await Promise.all([
            loadTypes(),
            loadProviders(),
            loadAgents()
        ]);
        
        setupEventListeners();
        renderAgentList();
    } catch (err) {
        showToast('Failed to load data from server. Is the backend running?', 'error');
        console.error(err);
    }
}

async function loadTypes() {
    const res = await fetch('/api/agents/types');
    agentTypes = await res.json();
    selectType.innerHTML = agentTypes.map(t => `<option value="${t.type}">${t.label}</option>`).join('');
}

async function loadProviders() {
    const res = await fetch('/api/agents/providers');
    const allProviders = await res.json();
    const localProviders = ['ollama', 'lmstudio'];
    providers = allProviders.filter(p => p.configured || localProviders.includes(p.id));
    selectProvider.innerHTML = providers.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
}

async function loadAgents() {
    const res = await fetch('/api/agents');
    agents = await res.json();
}

// ─── UI Rendering ─────────────────────────────────────────────────────────────
function renderAgentList() {
    agentListContainer.innerHTML = '';
    
    if (agents.length === 0) {
        agentListContainer.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">No agents found. Create one to get started.</p>';
        return;
    }
    
    agents.forEach(agent => {
        const item = document.createElement('div');
        item.className = `agent-list-item ${editingAgentId === agent.id ? 'selected' : ''}`;
        
        let providerLabel = providers.find(p => p.id === agent.provider)?.label || agent.provider;
        let typeLabel = agentTypes.find(t => t.type === agent.agent_type)?.label || agent.agent_type;
        
        item.innerHTML = `
            <div class="agent-avatar"><i data-lucide="bot" size="20"></i></div>
            <div style="flex: 1; overflow: hidden;">
                <h3 style="font-size: 15px; font-weight: 500; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${agent.name}</h3>
                <p style="font-size: 12px; color: var(--text-secondary);">${providerLabel} • ${typeLabel}</p>
            </div>
        `;
        
        item.onclick = () => selectAgent(agent.id);
        agentListContainer.appendChild(item);
    });
    
    if (window.lucide) lucide.createIcons();
}

async function loadMcpServers() {
    if (!editingAgentId) return;
    try {
        const res = await fetch(`/api/agents/${editingAgentId}/mcp_servers`);
        mcpServers = await res.json();
        renderMcpServers();
    } catch (err) {
        console.error('Failed to load MCP servers', err);
    }
}

function renderMcpServers() {
    mcpServersList.innerHTML = '';
    
    if (!editingAgentId) {
        mcpServersList.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary);">Save the agent first to attach servers.</p>';
        return;
    }

    if (mcpServers.length === 0) {
        mcpServersList.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary);">No external servers attached yet.</p>';
        return;
    }

    mcpServers.forEach(server => {
        let config = {};
        try { config = JSON.parse(server.config_json); } catch(e){}

        const item = document.createElement('div');
        item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);';
        
        item.innerHTML = `
            <div style="display:flex; gap: 12px; align-items:center;">
                <div style="background: rgba(255,255,255,0.1); padding: 8px; border-radius: 6px;">
                    <i data-lucide="table" size="18"></i>
                </div>
                <div>
                    <div style="font-size: 14px; font-weight: 500;">${server.name}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">Google Sheet • R: ${config.allow_read ? 'Yes' : 'No'} / W: ${config.allow_write ? 'Yes' : 'No'}</div>
                </div>
            </div>
            <button class="icon-btn" onclick="deleteMcpServer(${server.id})"><i data-lucide="trash-2" size="16"></i></button>
        `;
        mcpServersList.appendChild(item);
    });

    if (window.lucide) lucide.createIcons();
}

async function deleteMcpServer(id) {
    if (!confirm('Remove this MCP Server?')) return;
    try {
        await fetch(`/api/mcp_servers/${id}`, { method: 'DELETE' });
        showToast('MCP Server removed', 'success');
        loadMcpServers();
    } catch(e) {
        showToast('Failed to remove server', 'error');
    }
}

function selectAgent(id) {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;
    
    editingAgentId = agent.id;
    renderAgentList(); // highlights selected
    
    noAgentSelected.classList.add('hidden');
    agentEditor.classList.remove('hidden');
    
    formTitle.innerText = "Edit Configuration";
    formSubtitle.innerText = `Updating AI Agent: ${agent.name}`;
    btnDeleteAgent.classList.remove('hidden');
    
    inputName.value   = agent.name;
    selectType.value  = agent.agent_type;
    selectProvider.value = agent.provider;
    inputModel.value  = agent.model || '';
    inputTemp.value   = agent.temperature !== null ? agent.temperature : 0.7;
    inputTokens.value = agent.max_tokens !== null ? agent.max_tokens : 1024;
    inputPrompt.value = agent.system_prompt || '';
    inputBaseUrl.value = agent.base_url || '';
    toggleBaseUrlVisibility(agent.provider);
    
    // Load MCP Servers
    loadMcpServers();
}

function createNewAgent() {
    editingAgentId = null;
    renderAgentList(); // clears selection
    
    noAgentSelected.classList.add('hidden');
    agentEditor.classList.remove('hidden');
    
    formTitle.innerText = "Create New AI Agent";
    formSubtitle.innerText = "Configure a new digital personality.";
    btnDeleteAgent.classList.add('hidden');
    
    inputName.value   = '';
    selectType.value  = agentTypes[0]?.type || 'custom';
    selectProvider.value = providers[0]?.id || 'openai';
    inputBaseUrl.value = '';
    
    // Auto populate defaults based on selections
    onProviderChange();
    onTypeChange();
    
    // Clear MCP
    mcpServers = [];
    renderMcpServers();
}

// ─── Event Handlers ───────────────────────────────────────────────────────────
function setupEventListeners() {
    btnCreateNew.onclick = createNewAgent;
    btnWelcomeCreate.onclick = createNewAgent;
    btnBackToDashboard.onclick = () => window.location.href = '/';
    
    selectProvider.onchange = onProviderChange;
    selectType.onchange = onTypeChange;
    loadModelsBtn.onclick = loadProviderModels;
    
    // MCP Events
    btnAddGoogleSheetMcp.onclick = () => {
        if (!editingAgentId) {
            return showToast('Please save the Agent first before attaching MCP Servers.', 'error');
        }
        mcpGoogleSheetModal.classList.remove('hidden');
    };
    
    const closeMcp = () => mcpGoogleSheetModal.classList.add('hidden');
    closeMcpModal.onclick = closeMcp;
    btnCancelMcpSheet.onclick = closeMcp;
    
    btnSaveMcpSheet.onclick = async () => {
        const name = mcpSheetName.value.trim();
        const sheet_url = mcpSheetUrl.value.trim();
        const credentials = mcpSheetCreds.value.trim();
        const allow_read = mcpSheetRead.checked;
        const allow_write = mcpSheetWrite.checked;
        
        if (!sheet_url || !credentials) {
            return showToast('URL and Credentials are required', 'error');
        }
        
        try {
            const res = await fetch(`/api/agents/${editingAgentId}/mcp_servers/google-sheet`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, sheet_url, credentials, allow_read, allow_write })
            });
            const data = await res.json();
            
            if (res.ok) {
                showToast('MCP Server Added', 'success');
                closeMcp();
                mcpSheetName.value = '';
                mcpSheetUrl.value = '';
                mcpSheetCreds.value = '';
                loadMcpServers();
            } else {
                showToast(data.error || 'Failed to add MCP Server', 'error');
            }
        } catch (e) {
            showToast('Network error', 'error');
        }
    };
    
    btnSaveAgent.onclick = async () => {
        saveAgentData();
    };
    
    btnDeleteAgent.onclick = async () => {
        if (!editingAgentId) return;
        if (!confirm("Are you sure you want to permanently delete this agent?")) return;
        
        try {
            await fetch(`/api/agents/${editingAgentId}`, { method: 'DELETE' });
            showToast('Agent deleted successfully', 'success');
            await loadAgents();
            
            editingAgentId = null;
            agentEditor.classList.add('hidden');
            noAgentSelected.classList.remove('hidden');
            renderAgentList();
        } catch (err) {
            showToast('Failed to delete agent', 'error');
        }
    };
}

function onProviderChange() {
    const pId = selectProvider.value;
    const pData = providers.find(p => p.id === pId);
    if (pData && pData.defaultModel) {
        inputModel.value = pData.defaultModel;
    }
    toggleBaseUrlVisibility(pId);
}

function toggleBaseUrlVisibility(providerId) {
    const localProviders = ['ollama', 'lmstudio'];
    if (localProviders.includes(providerId)) {
        baseUrlGroup.style.display = 'block';
        const pData = providers.find(p => p.id === providerId);
        if (pData && pData.defaultUrl && !inputBaseUrl.value) {
            inputBaseUrl.value = pData.defaultUrl;
        }
    } else {
        baseUrlGroup.style.display = 'none';
        inputBaseUrl.value = '';
    }
}

async function loadProviderModels() {
    const provider = selectProvider.value;
    const baseUrl = inputBaseUrl.value.trim();
    
    if (!['ollama', 'lmstudio'].includes(provider)) {
        showToast('Model loading only for local providers', 'error');
        return;
    }
    
    try {
        const res = await fetch(`/api/providers/${provider}/models?baseUrl=${encodeURIComponent(baseUrl)}`);
        const data = await res.json();
        
        if (res.ok && data.models && data.models.length > 0) {
            inputModel.value = data.models[0];
            showToast(`Loaded ${data.models.length} models`, 'success');
        } else {
            showToast(data.error || 'No models found', 'error');
        }
    } catch (err) {
        showToast('Failed to load models: ' + err.message, 'error');
    }
}

function onTypeChange() {
    const tId = selectType.value;
    const tData = agentTypes.find(t => t.type === tId);
    if (tData && tData.defaultPrompt) {
        // Only overwrite if it's currently empty or we are creating new
        if (!inputPrompt.value.trim() || !editingAgentId) {
            inputPrompt.value = tData.defaultPrompt;
        }
    }
}

async function saveAgentData() {
    const name = inputName.value.trim();
    if (!name) return showToast('Agent Name is required', 'error');
    
    const payload = {
        name,
        agent_type: selectType.value,
        provider: selectProvider.value,
        model: inputModel.value.trim() || undefined,
        temperature: parseFloat(inputTemp.value),
        max_tokens: parseInt(inputTokens.value, 10),
        base_url: inputBaseUrl.value.trim() || null,
        system_prompt: inputPrompt.value.trim() || undefined
    };
    
    try {
        let url = '/api/agents';
        let method = 'POST';
        
        if (editingAgentId) {
            url = `/api/agents/${editingAgentId}`;
            method = 'PUT';
        }
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            showToast('AI Agent configuration saved!', 'success');
            await loadAgents();
            
            // Re-select to update ID if it was new
            const savedAgent = await res.json();
            editingAgentId = savedAgent.id;
            renderAgentList();
        } else {
            const err = await res.json();
            showToast(`Error: ${err.error || 'Failed to save config'}`, 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Network error while saving', 'error');
    }
}

// ─── Toast System ─────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    
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
    if (window.lucide) lucide.createIcons({ root: toast });

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); 
    }, 3000);
}

// Boot
init();
