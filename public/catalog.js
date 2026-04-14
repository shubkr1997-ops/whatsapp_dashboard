'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let contacts = [];
let products = [];
let catalogs = [];
let selectedCatalogId = null;
let selectedContactId = null;
let selectedProduct = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const catalogSelect = document.getElementById('catalogSelect');
const btnConnectCatalog = document.getElementById('btnConnectCatalog');
const btnSyncProducts = document.getElementById('btnSyncProducts');
const btnLoadCatalog = document.getElementById('btnLoadCatalog');
const productsGrid = document.getElementById('productsGrid');
const emptyState = document.getElementById('emptyState');
const productCount = document.getElementById('productCount');
const catalogStatus = document.getElementById('catalogStatus');
const loadingOverlay = document.getElementById('loadingOverlay');
const productSearch = document.getElementById('productSearch');
const contactListForSend = document.getElementById('contactListForSend');

// Send Product Modal
const sendProductModal = document.getElementById('sendProductModal');
const closeSendProductModal = document.getElementById('closeSendProductModal');
const btnConfirmSendProduct = document.getElementById('btnConfirmSendProduct');
const btnCancelSendProduct = document.getElementById('btnCancelSendProduct');
const sendProductContact = document.getElementById('sendProductContact');
const sendProductMessage = document.getElementById('sendProductMessage');
const sendProductImg = document.getElementById('sendProductImg');
const sendProductName = document.getElementById('sendProductName');
const sendProductPrice = document.getElementById('sendProductPrice');

// Send Catalog Modal
const sendCatalogModal = document.getElementById('sendCatalogModal');
const closeSendCatalogModal = document.getElementById('closeSendCatalogModal');
const btnConfirmSendCatalog = document.getElementById('btnConfirmSendCatalog');
const btnCancelSendCatalog = document.getElementById('btnCancelSendCatalog');
const sendCatalogContact = document.getElementById('sendCatalogContact');
const sendCatalogHeader = document.getElementById('sendCatalogHeader');
const sendCatalogBody = document.getElementById('sendCatalogBody');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
    await Promise.all([loadContacts(), loadCatalogs()]);
    setupEventListeners();
}

// ─── Loading ──────────────────────────────────────────────────────────────────

function showLoading(msg) {
    loadingOverlay.querySelector('span').textContent = msg || 'Loading...';
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

async function loadContacts() {
    try {
        const res = await fetch('/api/contacts');
        contacts = await res.json();
        renderContactList();
        populateContactSelects();
    } catch (err) {
        console.error('[Catalog] Failed to load contacts:', err);
    }
}

function renderContactList() {
    const header = contactListForSend.querySelector('.contact-list-header');
    contactListForSend.innerHTML = '';
    if (header) contactListForSend.appendChild(header);

    contacts.forEach(c => {
        const div = document.createElement('div');
        div.className = 'catalog-contact-item';
        div.innerHTML = `
            <img src="${c.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + c.id}" alt="${escapeHtml(c.name)}">
            <div>
                <div class="contact-name">${escapeHtml(c.name)}</div>
                <div class="contact-phone">${c.phone || ''}</div>
            </div>`;
        div.onclick = () => {
            selectedContactId = c.id;
            openSendCatalogModalForContact(c);
        };
        contactListForSend.appendChild(div);
    });
}

function populateContactSelects() {
    const options = '<option value="">-- Select a contact --</option>' +
        contacts.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.phone || 'no phone'})</option>`).join('');
    sendProductContact.innerHTML = options;
    sendCatalogContact.innerHTML = options;
}

// ─── Catalogs ─────────────────────────────────────────────────────────────────

async function loadCatalogs() {
    try {
        const res = await fetch('/api/catalog/catalogs');
        const data = await res.json();
        
        const allCatalogs = [...(data.local || []), ...(data.remote || [])];
        const uniqueCatalogs = [];
        const seenIds = new Set();
        allCatalogs.forEach(c => {
            if (c.catalog_id && c.catalog_id !== 'pending' && !seenIds.has(c.catalog_id)) {
                seenIds.add(c.catalog_id);
                uniqueCatalogs.push(c);
            }
        });
        
        catalogs = uniqueCatalogs;
        renderCatalogSelect();
        updateCatalogStatus();
    } catch (err) {
        console.error('[Catalog] Failed to load catalogs:', err);
    }
}

function renderCatalogSelect() {
    catalogSelect.innerHTML = '<option value="">-- Choose a catalog --</option>';
    catalogs.forEach(c => {
        if (c.catalog_id && c.catalog_id !== 'pending') {
            catalogSelect.innerHTML += `<option value="${c.catalog_id}">${escapeHtml(c.name || c.catalog_id)}</option>`;
        }
    });
}

function updateCatalogStatus() {
    if (catalogs.length > 0) {
        const active = catalogs.find(c => c.catalog_id && c.catalog_id !== 'pending');
        if (active) {
            catalogStatus.innerHTML = `
                <span class="status-dot connected"></span>
                <span>Connected: ${escapeHtml(active.name || active.catalog_id)}</span>`;
            selectedCatalogId = active.catalog_id;
            catalogSelect.value = active.catalog_id;
            btnLoadCatalog.disabled = false;
            btnSyncProducts.disabled = false;
        }
    }
}

// ─── Products ─────────────────────────────────────────────────────────────────

async function loadProducts(catalogId, sync = false) {
    if (!catalogId) return;
    showLoading(sync ? 'Syncing products from Meta...' : 'Loading products...');

    try {
        const url = `/api/catalog/products/${catalogId}${sync ? '?sync=true' : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        products = data.products || [];
        renderProducts(products);
        productCount.textContent = `${products.length} items`;

        if (sync) {
            showToast(`Synced ${data.count || products.length} products`, 'success');
        }
    } catch (err) {
        console.error('[Catalog] Failed to load products:', err);
        showToast('Failed to load products', 'error');
    } finally {
        hideLoading();
    }
}

function renderProducts(items) {
    if (items.length === 0) {
        productsGrid.innerHTML = '';
        productsGrid.appendChild(emptyState);
        emptyState.style.display = '';
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: productsGrid });
        return;
    }

    emptyState.style.display = 'none';
    productsGrid.innerHTML = items.map(p => `
        <div class="product-card" data-product-id="${escapeHtml(p.product_id)}">
            <div class="product-card-image">
                ${p.image_url
                    ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-image\\'><i data-lucide=\\'image\\' size=\\'32\\'></i></div>'">`
                    : `<div class="no-image"><i data-lucide="image" size="32"></i></div>`
                }
            </div>
            <div class="product-card-body">
                <div class="product-card-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
                <div class="product-card-price">${escapeHtml(p.price || 'N/A')}</div>
                <div class="product-card-retailer">ID: ${escapeHtml(p.retailer_id || p.product_id || '—')}</div>
                <div class="product-card-actions">
                    <button class="catalog-btn catalog-btn-primary catalog-btn-sm" onclick="openSendProductModal('${escapeHtml(p.product_id)}', '${escapeHtml(p.name)}', '${escapeHtml(p.price || '')}', '${escapeHtml(p.image_url || '')}')">
                        <i data-lucide="send" size="12"></i> Send
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: productsGrid });
}

// ─── Search ───────────────────────────────────────────────────────────────────

function filterProducts(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
        renderProducts(products);
        return;
    }
    const filtered = products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.retailer_id || '').toLowerCase().includes(q) ||
        (p.price || '').toLowerCase().includes(q)
    );
    renderProducts(filtered);
}

// ─── Send Product Modal ───────────────────────────────────────────────────────

function openSendProductModal(productId, name, price, imageUrl) {
    selectedProduct = { product_id: productId, name, price, image_url: imageUrl };
    sendProductImg.src = imageUrl || '';
    sendProductName.textContent = name;
    sendProductPrice.textContent = price || 'N/A';
    sendProductMessage.value = `Check out ${name}!`;
    sendProductModal.classList.remove('hidden');
}

function closeSendProductFn() {
    sendProductModal.classList.add('hidden');
    selectedProduct = null;
}

async function confirmSendProduct() {
    const contactId = sendProductContact.value;
    if (!contactId || !selectedProduct || !selectedCatalogId) {
        return showToast('Select a contact and catalog first', 'error');
    }

    try {
        const res = await fetch('/api/catalog/send-product', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: parseInt(contactId),
                catalog_id: selectedCatalogId,
                product_retailer_id: selectedProduct.product_id,
                body_text: sendProductMessage.value || `Check out ${selectedProduct.name}!`,
            }),
        });

        if (!res.ok) throw new Error(await res.text());
        showToast('Product sent!', 'success');
        closeSendProductFn();
    } catch (err) {
        console.error('[Send Product] Error:', err);
        showToast('Failed to send product: ' + err.message, 'error');
    }
}

// ─── Send Catalog Modal ──────────────────────────────────────────────────────

function openSendCatalogModalForContact(contact) {
    sendCatalogContact.value = contact.id;
    sendCatalogModal.classList.remove('hidden');
}

function openSendCatalogModal() {
    sendCatalogModal.classList.remove('hidden');
}

function closeSendCatalogFn() {
    sendCatalogModal.classList.add('hidden');
}

async function confirmSendCatalog() {
    const contactId = sendCatalogContact.value;
    if (!contactId || !selectedCatalogId) {
        return showToast('Select a contact and catalog first', 'error');
    }

    // Build sections from current products (max 10 per section)
    const sections = [{
        title: 'All Items',
        product_items: products.slice(0, 10).map(p => ({
            product_retailer_id: p.retailer_id || p.product_id,
        })),
    }];

    try {
        const res = await fetch('/api/catalog/send-catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: parseInt(contactId),
                catalog_id: selectedCatalogId,
                header_text: sendCatalogHeader.value || 'Our Products',
                body_text: sendCatalogBody.value || 'Choose from our catalog',
                sections,
            }),
        });

        if (!res.ok) throw new Error(await res.text());
        showToast('Catalog sent!', 'success');
        closeSendCatalogFn();
    } catch (err) {
        console.error('[Send Catalog] Error:', err);
        showToast('Failed to send catalog: ' + err.message, 'error');
    }
}

// ─── Connect Catalog ─────────────────────────────────────────────────────────

async function connectCatalog() {
    // Show prompt for access token
    const token = prompt('Enter your Meta Access Token (with catalog_management permission):');
    if (!token) return;

    const businessId = prompt('Enter your Business ID:') || '';
    const wabaId = prompt('Enter your WABA ID:') || '';

    showLoading('Connecting catalog...');

    try {
        const res = await fetch('/api/catalog/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                access_token: token,
                business_id: businessId,
                waba_id: wabaId,
            }),
        });

        if (!res.ok) throw new Error(await res.text());
        showToast('Catalog credentials saved!', 'success');
        await loadCatalogs();
    } catch (err) {
        console.error('[Connect Catalog] Error:', err);
        showToast('Failed to connect: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

async function connectSelectedCatalog() {
    const catalogId = catalogSelect.value;
    if (!catalogId) return showToast('Select a catalog first', 'error');

    showLoading('Connecting catalog...');

    try {
        const res = await fetch('/api/catalog/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalog_id: catalogId }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        selectedCatalogId = catalogId;
        btnSyncProducts.disabled = false;
        showToast('Catalog connected!', 'success');

        updateCatalogStatus();
        await loadProducts(catalogId);
    } catch (err) {
        console.error('[Connect Selected Catalog] Error:', err);
        showToast('Failed: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
    btnConnectCatalog.onclick = connectCatalog;

    btnSyncProducts.onclick = () => {
        if (selectedCatalogId) loadProducts(selectedCatalogId, true);
        else showToast('Connect a catalog first', 'error');
    };

    btnLoadCatalog.onclick = connectSelectedCatalog;

    catalogSelect.onchange = () => {
        const val = catalogSelect.value;
        btnLoadCatalog.disabled = !val;
        if (val) {
            selectedCatalogId = val;
            loadProducts(val);
            btnSyncProducts.disabled = false;
        }
    };

    productSearch.oninput = () => filterProducts(productSearch.value);

    // Send Product Modal
    closeSendProductModal.onclick = closeSendProductFn;
    btnCancelSendProduct.onclick = closeSendProductFn;
    btnConfirmSendProduct.onclick = confirmSendProduct;
    sendProductModal.onclick = (e) => { if (e.target === sendProductModal) closeSendProductFn(); };

    // Send Catalog Modal
    closeSendCatalogModal.onclick = closeSendCatalogFn;
    btnCancelSendCatalog.onclick = closeSendCatalogFn;
    btnConfirmSendCatalog.onclick = confirmSendCatalog;
    sendCatalogModal.onclick = (e) => { if (e.target === sendCatalogModal) closeSendCatalogFn(); };
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

    toast.innerHTML = `
        <div class="toast-icon"><i data-lucide="${icon}" size="18"></i></div>
        <div class="toast-message">${message}</div>`;

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons({ root: toast });

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
