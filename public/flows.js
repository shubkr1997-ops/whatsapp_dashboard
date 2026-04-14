'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let flows = [];
let contacts = [];
let currentFlow = null;
let currentFlowId = null;
let currentScreens = [];
let editingScreenIndex = -1;
let editingComponentIndex = -1;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const flowsList = document.getElementById('flowsList');
const flowsWelcome = document.getElementById('flowsWelcome');
const flowEditor = document.getElementById('flowEditor');
const flowResponses = document.getElementById('flowResponses');
const flowSearch = document.getElementById('flowSearch');

const btnCreateFlow = document.getElementById('btnCreateFlow');
const btnCreateFlowWelcome = document.getElementById('btnCreateFlowWelcome');
const btnFromTemplate = document.getElementById('btnFromTemplate');
const templateModal = document.getElementById('templateModal');
const templatesGrid = document.getElementById('templatesGrid');
const closeTemplateModal = document.getElementById('closeTemplateModal');
const btnBackToFlows = document.getElementById('btnBackToFlows');
const flowEditorName = document.getElementById('flowEditorName');
const flowStatusBadge = document.getElementById('flowStatusBadge');
const flowDescription = document.getElementById('flowDescription');
const flowCategory = document.getElementById('flowCategory');
const flowMetaId = document.getElementById('flowMetaId');
const btnSaveFlow = document.getElementById('btnSaveFlow');
const btnPublishFlow = document.getElementById('btnPublishFlow');
const btnDeleteFlow = document.getElementById('btnDeleteFlow');
const btnPreviewFlow = document.getElementById('btnPreviewFlow');
const flowScreensList = document.getElementById('flowScreensList');
const btnAddScreen = document.getElementById('btnAddScreen');

const screenEditor = document.getElementById('screenEditor');
const screenEditorTitle = document.getElementById('screenEditorTitle');
const screenId = document.getElementById('screenId');
const screenTitle = document.getElementById('screenTitle');
const screenComponentsList = document.getElementById('screenComponentsList');
const addComponentType = document.getElementById('addComponentType');
const btnAddComponent = document.getElementById('btnAddComponent');
const btnSaveScreen = document.getElementById('btnSaveScreen');
const btnCloseScreenEditor = document.getElementById('btnCloseScreenEditor');

const responsesFlowName = document.getElementById('responsesFlowName');
const flowResponsesBody = document.getElementById('flowResponsesBody');
const btnViewEditor = document.getElementById('btnViewEditor');
const btnBackFromResponses = document.getElementById('btnBackFromResponses');

const sendFlowModal = document.getElementById('sendFlowModal');
const sendFlowSelect = document.getElementById('sendFlowSelect');
const sendFlowContact = document.getElementById('sendFlowContact');
const sendFlowHeader = document.getElementById('sendFlowHeader');
const sendFlowBody = document.getElementById('sendFlowBody');
const sendFlowCTA = document.getElementById('sendFlowCTA');
const btnConfirmSendFlow = document.getElementById('btnConfirmSendFlow');
const btnCancelSendFlow = document.getElementById('btnCancelSendFlow');
const closeSendFlowModal = document.getElementById('closeSendFlowModal');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
    await Promise.all([loadFlows(), loadContacts()]);
    setupEventListeners();
}

// ─── Flows CRUD ───────────────────────────────────────────────────────────────

async function loadFlows() {
    try {
        const res = await fetch('/api/flows');
        flows = await res.json();
        renderFlowsList();
    } catch (err) {
        console.error('[Flows] Load error:', err);
    }
}

function renderFlowsList() {
    const q = (flowSearch.value || '').toLowerCase();
    const filtered = flows.filter(f => f.name.toLowerCase().includes(q));

    if (filtered.length === 0) {
        flowsList.innerHTML = '<div class="flow-list-empty">No flows yet</div>';
        return;
    }

    flowsList.innerHTML = filtered.map(f => `
        <div class="flow-list-item${currentFlowId === f.flow_id ? ' active' : ''}" data-flow-id="${f.flow_id}">
            <div class="flow-list-icon"><i data-lucide="git-branch" size="18"></i></div>
            <div class="flow-list-info">
                <div class="flow-list-name">${escapeHtml(f.name)}</div>
                <div class="flow-list-meta">
                    <span class="flow-status-badge ${f.status}" style="font-size:10px;padding:2px 6px">${f.status}</span>
                    <span>${f.category || 'CUSTOMER_SUPPORT'}</span>
                </div>
            </div>
        </div>
    `).join('');

    flowsList.querySelectorAll('.flow-list-item').forEach(item => {
        item.onclick = () => openFlowEditor(item.dataset.flowId);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: flowsList });
}

async function createFlow() {
    try {
        const res = await fetch('/api/flows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Untitled Flow',
                flow_json: {
                    version: '5.0',
                    screens: [{
                        id: 'QUESTION_ONE',
                        title: 'Welcome',
                        data: {},
                        layout: {
                            type: 'SingleColumnLayout',
                            children: [
                                { type: 'TextHeading', text: 'Welcome' },
                                { type: 'TextBody', text: 'Please fill out this form.' },
                                { type: 'TextInput', name: 'name', label: 'Your Name', required: true },
                                { type: 'Footer', label: 'Continue', 'on-click-action': { name: 'complete', payload: {} } }
                            ]
                        }
                    }]
                },
            }),
        });
        const flow = await res.json();
        flows.unshift(flow);
        renderFlowsList();
        openFlowEditor(flow.flow_id);
        showToast('Flow created', 'success');
    } catch (err) {
        console.error('[Flows] Create error:', err);
        showToast('Failed to create flow', 'error');
    }
}

function openFlowEditor(flowId) {
    const flow = flows.find(f => f.flow_id === flowId);
    if (!flow) return;

    currentFlow = flow;
    currentFlowId = flowId;

    // Parse flow JSON
    try {
        const fj = typeof flow.flow_json === 'string' ? JSON.parse(flow.flow_json) : flow.flow_json;
        currentScreens = fj.screens || [];
    } catch {
        currentScreens = [];
    }

    // Fill editor
    flowEditorName.value = flow.name;
    flowStatusBadge.textContent = flow.status;
    flowStatusBadge.className = 'flow-status-badge ' + flow.status;
    flowDescription.value = flow.description || '';
    flowCategory.value = flow.category || 'CUSTOMER_SUPPORT';
    flowMetaId.value = flow.meta_flow_id || '';

    // Show editor
    flowsWelcome.classList.add('hidden');
    flowResponses.classList.add('hidden');
    flowEditor.classList.remove('hidden');
    screenEditor.classList.add('hidden');

    renderScreensList();
    renderFlowsList();
}

async function saveFlow() {
    if (!currentFlowId) return;

    const flowJson = { version: '5.0', screens: currentScreens };

    try {
        const res = await fetch(`/api/flows/${currentFlowId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: flowEditorName.value,
                description: flowDescription.value,
                category: flowCategory.value,
                flow_json: flowJson,
            }),
        });
        const updated = await res.json();

        const idx = flows.findIndex(f => f.flow_id === currentFlowId);
        if (idx !== -1) flows[idx] = updated;
        currentFlow = updated;

        flowStatusBadge.textContent = updated.status;
        flowStatusBadge.className = 'flow-status-badge ' + updated.status;

        renderFlowsList();
        showToast('Flow saved', 'success');
    } catch (err) {
        console.error('[Flows] Save error:', err);
        showToast('Failed to save flow', 'error');
    }
}

async function publishFlow() {
    if (!currentFlowId) return;
    await saveFlow();

    try {
        const res = await fetch(`/api/flows/${currentFlowId}/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();

        if (data.meta_flow_id) flowMetaId.value = data.meta_flow_id;

        const flow = flows.find(f => f.flow_id === currentFlowId);
        if (flow) flow.status = 'PUBLISHED';

        flowStatusBadge.textContent = 'PUBLISHED';
        flowStatusBadge.className = 'flow-status-badge PUBLISHED';
        renderFlowsList();

        showToast('Flow published' + (data.warning ? ' (local only)' : ''), data.warning ? 'info' : 'success');
    } catch (err) {
        console.error('[Flows] Publish error:', err);
        showToast('Failed to publish flow', 'error');
    }
}

async function deleteFlow() {
    if (!currentFlowId) return;
    if (!confirm('Delete this flow? This cannot be undone.')) return;

    try {
        await fetch(`/api/flows/${currentFlowId}`, { method: 'DELETE' });
        flows = flows.filter(f => f.flow_id !== currentFlowId);
        currentFlow = null;
        currentFlowId = null;
        flowEditor.classList.add('hidden');
        flowsWelcome.classList.remove('hidden');
        renderFlowsList();
        showToast('Flow deleted', 'success');
    } catch (err) {
        console.error('[Flows] Delete error:', err);
    }
}

// ─── Screen Builder ───────────────────────────────────────────────────────────

function renderScreensList() {
    flowScreensList.innerHTML = currentScreens.map((s, i) => `
        <div class="screen-card${editingScreenIndex === i ? ' active' : ''}" data-index="${i}">
            <div class="screen-card-info">
                <div class="screen-card-title">${escapeHtml(s.title || s.id)}</div>
                <div class="screen-card-id">${escapeHtml(s.id)}</div>
            </div>
            <div class="screen-card-actions">
                <button class="icon-btn" data-action="edit-screen" data-index="${i}" title="Edit"><i data-lucide="pencil" size="12"></i></button>
                <button class="icon-btn" data-action="delete-screen" data-index="${i}" title="Delete"><i data-lucide="trash-2" size="12"></i></button>
            </div>
        </div>
    `).join('') || '<div class="flow-list-empty">No screens yet</div>';

    flowScreensList.querySelectorAll('[data-action="edit-screen"]').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); openScreenEditor(parseInt(btn.dataset.index)); };
    });
    flowScreensList.querySelectorAll('[data-action="delete-screen"]').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); deleteScreen(parseInt(btn.dataset.index)); };
    });

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: flowScreensList });
}

function addScreen() {
    const id = 'SCREEN_' + (currentScreens.length + 1);
    currentScreens.push({
        id,
        title: 'New Screen',
        data: {},
        layout: {
            type: 'SingleColumnLayout',
            children: [
                { type: 'TextHeading', text: 'New Screen' },
                { type: 'TextBody', text: 'Add your content here.' },
                { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: {} } }
            ]
        }
    });
    renderScreensList();
    openScreenEditor(currentScreens.length - 1);
}

function deleteScreen(index) {
    currentScreens.splice(index, 1);
    if (editingScreenIndex === index) {
        editingScreenIndex = -1;
        screenEditor.classList.add('hidden');
    }
    renderScreensList();
}

function openScreenEditor(index) {
    editingScreenIndex = index;
    const screen = currentScreens[index];
    if (!screen) return;

    screenEditorTitle.textContent = `Edit: ${screen.title || screen.id}`;
    screenId.value = screen.id;
    screenTitle.value = screen.title || '';

    renderScreenComponents(screen);
    screenEditor.classList.remove('hidden');
    renderScreensList();
}

function renderScreenComponents(screen) {
    const children = screen.layout?.children || [];

    screenComponentsList.innerHTML = children.map((c, i) => {
        let fields = '';
        const type = c.type;

        if (type === 'TextHeading' || type === 'TextSubheading' || type === 'TextBody') {
            fields = `<input type="text" data-field="text" value="${escapeHtml(c.text || '')}" placeholder="Text content">`;
        } else if (type === 'TextInput') {
            fields = `
                <input type="text" data-field="label" value="${escapeHtml(c.label || '')}" placeholder="Label">
                <input type="text" data-field="name" value="${escapeHtml(c.name || '')}" placeholder="Field name" style="margin-top:4px">
            `;
        } else if (type === 'TextArea') {
            fields = `
                <input type="text" data-field="label" value="${escapeHtml(c.label || '')}" placeholder="Label">
                <input type="text" data-field="name" value="${escapeHtml(c.name || '')}" placeholder="Field name" style="margin-top:4px">
            `;
        } else if (type === 'DatePicker') {
            fields = `
                <input type="text" data-field="label" value="${escapeHtml(c.label || '')}" placeholder="Label">
                <input type="text" data-field="name" value="${escapeHtml(c.name || '')}" placeholder="Field name" style="margin-top:4px">
            `;
        } else if (type === 'Dropdown') {
            const opts = (c['data-source'] || []).map(o => o.title).join(', ');
            fields = `
                <input type="text" data-field="label" value="${escapeHtml(c.label || '')}" placeholder="Label">
                <input type="text" data-field="name" value="${escapeHtml(c.name || '')}" placeholder="Field name" style="margin-top:4px">
                <textarea data-field="options" placeholder="Options (comma separated)" style="margin-top:4px">${escapeHtml(opts)}</textarea>
            `;
        } else if (type === 'CheckboxGroup' || type === 'RadioButtonsGroup') {
            const items = (c['data-source'] || []).map(it => it.title).join(', ');
            fields = `
                <input type="text" data-field="label" value="${escapeHtml(c.label || '')}" placeholder="Label">
                <input type="text" data-field="name" value="${escapeHtml(c.name || '')}" placeholder="Field name" style="margin-top:4px">
                <textarea data-field="options" placeholder="Options (comma separated)" style="margin-top:4px">${escapeHtml(items)}</textarea>
            `;
        } else if (type === 'Footer') {
            fields = `<input type="text" data-field="label" value="${escapeHtml(c.label || '')}" placeholder="Button text">`;
        }

        return `
            <div class="component-card" data-index="${i}">
                <div class="component-card-info">
                    <div class="component-type-label">${type}</div>
                    ${fields}
                </div>
                <div class="component-card-actions">
                    <button class="icon-btn" data-action="delete-component" data-index="${i}" title="Remove"><i data-lucide="x" size="12"></i></button>
                </div>
            </div>
        `;
    }).join('') || '<div class="flow-list-empty">No components</div>';

    screenComponentsList.querySelectorAll('[data-action="delete-component"]').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.index);
            const screen = currentScreens[editingScreenIndex];
            if (screen?.layout?.children) {
                screen.layout.children.splice(idx, 1);
                renderScreenComponents(screen);
            }
        };
    });

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: screenComponentsList });
}

function addComponent() {
    const type = addComponentType.value;
    const screen = currentScreens[editingScreenIndex];
    if (!screen) return;

    if (!screen.layout) screen.layout = { type: 'SingleColumnLayout', children: [] };
    if (!screen.layout.children) screen.layout.children = [];

    let component = { type };

    switch (type) {
        case 'TextHeading': component.text = 'Heading'; break;
        case 'TextSubheading': component.text = 'Subheading'; break;
        case 'TextBody': component.text = 'Body text goes here.'; break;
        case 'TextInput': component.label = 'Text Input'; component.name = 'input_' + Date.now(); component.required = false; break;
        case 'TextArea': component.label = 'Text Area'; component.name = 'textarea_' + Date.now(); break;
        case 'DatePicker': component.label = 'Select Date'; component.name = 'date_' + Date.now(); break;
        case 'Dropdown':
            component.label = 'Select Option';
            component.name = 'dropdown_' + Date.now();
            component['data-source'] = [{ id: 'opt1', title: 'Option 1' }];
            break;
        case 'CheckboxGroup':
            component.label = 'Select Multiple';
            component.name = 'checkbox_' + Date.now();
            component['data-source'] = [{ id: 'chk1', title: 'Choice 1' }];
            break;
        case 'RadioButtonsGroup':
            component.label = 'Select One';
            component.name = 'radio_' + Date.now();
            component['data-source'] = [{ id: 'rad1', title: 'Option A' }];
            break;
        case 'Footer':
            component.label = 'Continue';
            component['on-click-action'] = { name: 'complete', payload: {} };
            break;
    }

    screen.layout.children.push(component);
    renderScreenComponents(screen);
}

function saveScreen() {
    const screen = currentScreens[editingScreenIndex];
    if (!screen) return;

    screen.id = screenId.value || screen.id;
    screen.title = screenTitle.value || '';

    // Save component values from DOM
    screenComponentsList.querySelectorAll('.component-card').forEach(card => {
        const idx = parseInt(card.dataset.index);
        const comp = screen.layout?.children?.[idx];
        if (!comp) return;

        card.querySelectorAll('[data-field]').forEach(input => {
            const field = input.dataset.field;
            if (field === 'options') {
                const opts = input.value.split(',').map(s => s.trim()).filter(Boolean);
                if (comp.type === 'Dropdown') {
                    comp['data-source'] = opts.map((o, i) => ({ id: 'opt' + i, title: o }));
                } else if (comp.type === 'CheckboxGroup' || comp.type === 'RadioButtonsGroup') {
                    comp['data-source'] = opts.map((o, i) => ({ id: 'item' + i, title: o }));
                }
            } else if (field === 'text' || field === 'label' || field === 'name') {
                comp[field] = input.value;
            }
        });
    });

    renderScreensList();
    showToast('Screen saved', 'success');
}

// ─── Responses ────────────────────────────────────────────────────────────────

async function viewResponses(flowId) {
    const flow = flows.find(f => f.flow_id === flowId);
    if (!flow) return;

    currentFlowId = flowId;
    responsesFlowName.textContent = `Responses: ${flow.name}`;

    flowsWelcome.classList.add('hidden');
    flowEditor.classList.add('hidden');
    flowResponses.classList.remove('hidden');

    try {
        const res = await fetch(`/api/flows/${flowId}/responses`);
        const data = await res.json();
        renderResponses(data);
    } catch (err) {
        flowResponsesBody.innerHTML = '<div class="no-responses"><p>Failed to load responses</p></div>';
    }
}

function renderResponses(data) {
    if (!data || data.length === 0) {
        flowResponsesBody.innerHTML = `
            <div class="no-responses">
                <i data-lucide="inbox" size="40"></i>
                <h3>No Responses Yet</h3>
                <p>Send this flow to a contact and responses will appear here.</p>
            </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: flowResponsesBody });
        return;
    }

    flowResponsesBody.innerHTML = data.map(r => {
        let parsed;
        try { parsed = JSON.parse(r.response_json); } catch { parsed = {}; }
        return `
            <div class="response-card">
                <div class="response-card-header">
                    <div class="response-contact">
                        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${r.contact_id}" alt="">
                        <div>
                            <div class="response-contact-name">${escapeHtml(r.contact_name || 'Unknown')}</div>
                            <div class="response-contact-phone">${escapeHtml(r.contact_phone || '')}</div>
                        </div>
                    </div>
                    <div class="response-time">${r.received_at || ''}</div>
                </div>
                <div class="response-data">${escapeHtml(JSON.stringify(parsed, null, 2))}</div>
            </div>
        `;
    }).join('');
}

// ─── Send Flow ────────────────────────────────────────────────────────────────

async function openSendFlowModal() {
    sendFlowModal.classList.remove('hidden');

    sendFlowSelect.innerHTML = '<option value="">-- Select a flow --</option>' +
        flows.filter(f => f.status === 'PUBLISHED').map(f =>
            `<option value="${f.flow_id}">${escapeHtml(f.name)}</option>`
        ).join('');

    sendFlowContact.innerHTML = '<option value="">-- Select a contact --</option>' +
        contacts.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.phone || 'no phone'})</option>`).join('');

    sendFlowHeader.value = '';
    sendFlowBody.value = 'Please fill out this form';
    sendFlowCTA.value = 'Start';
}

async function confirmSendFlow() {
    const flowId = sendFlowSelect.value;
    const contactId = sendFlowContact.value;

    if (!flowId || !contactId) return showToast('Select a flow and contact', 'error');

    try {
        const res = await fetch(`/api/flows/${flowId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: parseInt(contactId),
                header_text: sendFlowHeader.value || null,
                body_text: sendFlowBody.value || 'Please fill out this form',
                flow_cta: sendFlowCTA.value || 'Start',
            }),
        });

        if (!res.ok) throw new Error(await res.text());
        showToast('Flow sent!', 'success');
        sendFlowModal.classList.add('hidden');
    } catch (err) {
        console.error('[Send Flow] Error:', err);
        showToast('Failed to send flow', 'error');
    }
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

async function loadContacts() {
    try {
        const res = await fetch('/api/contacts');
        contacts = await res.json();
    } catch (err) {
        console.error('[Flows] Load contacts error:', err);
    }
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function previewFlow() {
    if (!currentScreens.length) return showToast('No screens to preview', 'info');

    const flowJson = JSON.stringify({ version: '5.0', screens: currentScreens }, null, 2);

    const w = window.open('', '_blank', 'width=500,height=600');
    w.document.write(`<pre style="background:#111;color:#0f0;padding:20px;font-size:13px;white-space:pre-wrap">${escapeHtml(flowJson)}</pre>`);
    w.document.title = `Preview: ${flowEditorName.value}`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

async function openTemplateModal() {
    templateModal.classList.remove('hidden');
    templatesGrid.innerHTML = '<div class="flow-list-empty">Loading templates...</div>';

    try {
        const res = await fetch('/api/flows/templates');
        const templates = await res.json();

        templatesGrid.innerHTML = templates.map(t => `
            <div class="template-card" data-template-id="${t.id}">
                <div class="template-card-name">
                    <i data-lucide="${getTemplateIcon(t.id)}" size="16"></i>
                    ${escapeHtml(t.name)}
                </div>
                <div class="template-card-desc">${escapeHtml(t.description)}</div>
                <div class="template-card-cat">${escapeHtml(t.category)}</div>
            </div>
        `).join('');

        templatesGrid.querySelectorAll('.template-card').forEach(card => {
            card.onclick = () => createFromTemplate(card.dataset.templateId);
        });

        if (typeof lucide !== 'undefined') lucide.createIcons({ root: templatesGrid });
    } catch (err) {
        templatesGrid.innerHTML = '<div class="flow-list-empty">Failed to load templates</div>';
    }
}

function getTemplateIcon(id) {
    const icons = {
        contact_us: 'mail',
        lead_gen: 'target',
        appointment: 'calendar',
        survey: 'clipboard-list',
        signup: 'user-plus',
    };
    return icons[id] || 'git-branch';
}

async function createFromTemplate(templateId) {
    try {
        const res = await fetch(`/api/flows/templates/${templateId}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const flow = await res.json();
        flows.unshift(flow);
        renderFlowsList();
        templateModal.classList.add('hidden');
        openFlowEditor(flow.flow_id);
        showToast('Flow created from template', 'success');
    } catch (err) {
        console.error('[Template] Create error:', err);
        showToast('Failed to create flow from template', 'error');
    }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    btnCreateFlow.onclick = createFlow;
    btnCreateFlowWelcome.onclick = createFlow;

    // Template modal
    btnFromTemplate.onclick = openTemplateModal;
    closeTemplateModal.onclick = () => templateModal.classList.add('hidden');
    templateModal.onclick = (e) => { if (e.target === templateModal) templateModal.classList.add('hidden'); };

    btnBackToFlows.onclick = () => {
        flowEditor.classList.add('hidden');
        flowsWelcome.classList.remove('hidden');
        currentFlowId = null;
        renderFlowsList();
    };

    btnSaveFlow.onclick = saveFlow;
    btnPublishFlow.onclick = publishFlow;
    btnDeleteFlow.onclick = deleteFlow;
    btnPreviewFlow.onclick = previewFlow;

    btnAddScreen.onclick = addScreen;

    btnAddComponent.onclick = addComponent;
    btnSaveScreen.onclick = saveScreen;
    btnCloseScreenEditor.onclick = () => {
        screenEditor.classList.add('hidden');
        editingScreenIndex = -1;
        renderScreensList();
    };

    btnBackFromResponses.onclick = () => {
        flowResponses.classList.add('hidden');
        flowsWelcome.classList.remove('hidden');
    };

    btnViewEditor.onclick = () => {
        flowResponses.classList.add('hidden');
        openFlowEditor(currentFlowId);
    };

    flowSearch.oninput = renderFlowsList;

    // Send Flow Modal
    closeSendFlowModal.onclick = () => sendFlowModal.classList.add('hidden');
    btnCancelSendFlow.onclick = () => sendFlowModal.classList.add('hidden');
    btnConfirmSendFlow.onclick = confirmSendFlow;
    sendFlowModal.onclick = (e) => { if (e.target === sendFlowModal) sendFlowModal.classList.add('hidden'); };
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'error') icon = 'alert-triangle';
    toast.innerHTML = `<div class="toast-icon"><i data-lucide="${icon}" size="18"></i></div><div class="toast-message">${message}</div>`;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons({ root: toast });
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3000);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
