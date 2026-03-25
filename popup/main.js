import { state } from './state.js';
import { setupAuthUI } from './auth.js';
import { loadLocalState, persistLocalState, loadCloudState, saveApiKey, syncCloudState } from './storage.js';
import { analyzeBookmarksWithGemini } from './ai.js';

const views = {
    categories: document.getElementById('categories-view'),
    all: document.getElementById('all-bookmarks-view'),
    privateLocked: document.getElementById('private-locked-view'),
    privateUnlocked: document.getElementById('private-unlocked-view'),
    categoryDetail: document.getElementById('category-detail-view'),
    settings: document.getElementById('settings-view')
};

const moveModal = document.getElementById('move-modal');
const categorySelect = document.getElementById('category-select');
const newCategoryInput = document.getElementById('new-category-container');
const newCategoryName = document.getElementById('new-category-name');
let currentMoveUrl = null;
let activeCategoryDetailName = null;

init();

async function init() {
    await loadLocalState(state);
    hydrateUiFromState();
    setupEvents();
    setupAuthUI(state, handleAuthChange);
    loadChromeBookmarks();
}

async function handleAuthChange(user) {
    if (user) {
        await loadCloudState(state);
        hydrateUiFromState();
        renderCategories();
        renderAllBookmarks();
    }
}

function setupEvents() {
    document.getElementById('search-input').addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (!query) {
            renderAllBookmarks();
            return;
        }
        const filtered = state.bookmarks.filter((bm) => {
            const inTitle = bm.title.toLowerCase().includes(query);
            const inUrl = bm.url.toLowerCase().includes(query);
            const manualTags = state.tagsMap[bm.url] || [];
            const aiTags = state.aiMetadata[bm.url]?.tags || [];
            const inManualTags = manualTags.some((t) => t.toLowerCase().includes(query));
            const inAiTags = aiTags.some((t) => t.toLowerCase().includes(query));
            const aiCategory = (state.aiMetadata[bm.url]?.category || '').toLowerCase();
            return inTitle || inUrl || inManualTags || inAiTags || aiCategory.includes(query);
        });
        switchToSearchView(filtered);
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab-btn').dataset.tab;
            switchTab(tab);
        });
    });

    document.getElementById('back-to-categories').addEventListener('click', () => {
        views.categoryDetail.classList.add('hidden');
        document.getElementById('category-grid').classList.remove('hidden');
        document.getElementById('create-category-btn').classList.remove('hidden');
    });

    document.getElementById('create-category-btn').addEventListener('click', async () => {
        const name = prompt("Enter new category name:");
        if (!name || !name.trim()) return;
        const cat = name.trim();
        if (state.customCategories.includes(cat)) return;
        state.customCategories.push(cat);
        await syncCloudState(state, { customCategories: state.customCategories });
        renderCategories();
    });

    document.getElementById('settings-btn').addEventListener('click', () => {
        showSettings();
    });

    document.getElementById('save-api-key-btn').addEventListener('click', async () => {
        const key = document.getElementById('gemini-api-key').value.trim();
        if (!key) {
            document.getElementById('api-key-status').innerText = 'API key cleared. AI is now optional/off.';
            document.getElementById('api-key-status').style.color = 'orange';
            await saveApiKey(state, '');
            await chrome.storage.local.remove(['gemini_api_key']);
            setAnalyzeEnabled(false);
            return;
        }
        await saveApiKey(state, key);
        document.getElementById('api-key-status').innerText = "API Key Saved!";
        document.getElementById('api-key-status').style.color = "green";
        setAnalyzeEnabled(true);
        setTimeout(() => { document.getElementById('api-key-status').innerText = ""; }, 3000);
    });

    document.getElementById('analyze-btn').addEventListener('click', async () => {
        if (!state.apiKey) {
            alert('Gemini API key is optional, but required for AI analysis. Add one in Settings to run categorization.');
            return;
        }
        const btn = document.getElementById('analyze-btn');
        const progress = document.getElementById('analysis-progress');
        const status = document.getElementById('analysis-status');
        btn.disabled = true;
        progress.classList.remove('hidden');
        status.innerText = 'Analyzing bookmarks...';
        try {
            await analyzeBookmarksWithGemini(state, state.bookmarks, (text) => {
                status.innerText = text;
            });
            await syncCloudState(state, { aiMetadata: state.aiMetadata });
            status.innerText = 'Analysis complete!';
            renderCategories();
            renderAllBookmarks();
        } catch (error) {
            status.innerText = `Error: ${error.message}`;
        } finally {
            setTimeout(() => {
                progress.classList.add('hidden');
                setAnalyzeEnabled(Boolean(state.apiKey));
            }, 700);
        }
    });

    setupListDelegation('bookmarks-list');
    setupListDelegation('category-list');
    setupPrivateListDelegation();
    setupVaultEvents();
    setupMoveModalEvents();
    setupShortcutSettings();
}

function hydrateUiFromState() {
    document.getElementById('gemini-api-key').value = state.apiKey || '';
    setAnalyzeEnabled(Boolean(state.apiKey));
}

function setAnalyzeEnabled(enabled) {
    document.getElementById('analyze-btn').disabled = !enabled;
}

function loadChromeBookmarks() {
    chrome.bookmarks.getTree((bookmarkTreeNodes) => {
        state.bookmarks = [];
        processBookmarkTree(bookmarkTreeNodes);
        renderCategories();
        renderAllBookmarks();
        refreshCategoryDetailIfVisible();
    });
}

function processBookmarkTree(nodes) {
    nodes.forEach((node) => {
        if (node.url) {
            state.bookmarks.push({
                id: node.id,
                title: node.title,
                url: node.url,
                dateAdded: node.dateAdded
            });
        }
        if (node.children) {
            processBookmarkTree(node.children);
        }
    });
}

function renderCategories() {
    const grid = document.getElementById('category-grid');
    grid.innerHTML = '';
    const groups = {};

    state.customCategories.forEach((cat) => {
        groups[cat] = [];
    });

    state.bookmarks.forEach((bm) => {
        const cat = state.aiMetadata[bm.url]?.category || 'Unsorted';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(bm);
    });

    Object.keys(groups).sort().forEach((cat) => {
        const items = groups[cat];
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
            <h4>${cat}</h4>
            <div class="cat-footer">
                <p>${items.length} items</p>
                <i class="fas fa-trash delete-cat-btn" title="Delete Category"></i>
            </div>
        `;
        card.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-cat-btn');
            if (deleteBtn) return;
            showCategoryDetail(cat, items);
        });
        card.querySelector('.delete-cat-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteCategory(cat, items);
        });
        grid.appendChild(card);
    });
}

async function deleteCategory(categoryName, items) {
    const hasBookmarks = items.length > 0;
    let confirmMsg = `Delete category "${categoryName}"?`;
    if (hasBookmarks) {
        confirmMsg += `\n\nWARNING: This category contains ${items.length} bookmarks.\nDeleting it will PERMANENTLY DELETE these bookmarks.`;
    }
    if (!confirm(confirmMsg)) return;

    if (hasBookmarks) {
        for (const bm of items) {
            if (bm.id) {
                await new Promise((resolve) => chrome.bookmarks.remove(bm.id, resolve));
            }
            delete state.aiMetadata[bm.url];
        }
    }

    state.customCategories = state.customCategories.filter((c) => c !== categoryName);
    await syncCloudState(state, {
        customCategories: state.customCategories,
        aiMetadata: state.aiMetadata
    });
    loadChromeBookmarks();
}

function showCategoryDetail(categoryName, items) {
    activeCategoryDetailName = categoryName;
    document.getElementById('category-grid').classList.add('hidden');
    document.getElementById('create-category-btn').classList.add('hidden');
    views.categoryDetail.classList.remove('hidden');
    document.getElementById('category-title').innerText = categoryName;
    renderBookmarkList(items, 'category-list');
}

function renderAllBookmarks(subset = null) {
    renderBookmarkList(subset || state.bookmarks, 'bookmarks-list');
}

function renderBookmarkList(data, listId) {
    const list = document.getElementById(listId);
    list.innerHTML = '';
    if (!data.length) {
        list.innerHTML = '<li class="empty-list-msg">No bookmarks found</li>';
        return;
    }

    data.forEach((bm) => {
        const li = document.createElement('li');
        li.className = 'bookmark-item';
        const manualTags = state.tagsMap[bm.url] || [];
        const aiTags = state.aiMetadata[bm.url]?.tags || [];
        const uniqueAiTags = aiTags.filter((t) => !manualTags.includes(t));
        li.innerHTML = `
            <div class="bm-header">
                <a href="${bm.url}" target="_blank" class="bm-link" title="${bm.title}">
                    <img src="https://www.google.com/s2/favicons?domain=${bm.url}" class="favicon-img">
                    ${bm.title}
                </a>
                <div class="bm-actions">
                    <i class="fas fa-folder move-btn" data-url="${bm.url}" title="Move to Category"></i>
                    <i class="fas fa-lock lock-btn move-to-vault" data-id="${bm.id}" data-url="${bm.url}" data-title="${bm.title}" title="Move to Vault"></i>
                    <i class="fas fa-trash delete-btn public-delete" data-id="${bm.id}"></i>
                </div>
            </div>
            <div class="tags-container">
                ${manualTags.map((t) => `<span class="tag">${t} <i class="fas fa-times" data-remove-tag="${t}" data-url="${bm.url}"></i></span>`).join('')}
                ${uniqueAiTags.map((t) => `<span class="tag ai-tag"><i class="fas fa-robot"></i> ${t}</span>`).join('')}
                <input type="text" class="tag-input" placeholder="+ Tag" data-url="${bm.url}">
            </div>
        `;
        list.appendChild(li);
    });
}

function setupListDelegation(listId) {
    const list = document.getElementById(listId);
    if (!list) return;

    list.addEventListener('click', async (e) => {
        const target = e.target;

        const moveToVaultBtn = target.closest('.move-to-vault');
        if (moveToVaultBtn) {
            const id = moveToVaultBtn.dataset.id;
            const url = moveToVaultBtn.dataset.url;
            const title = moveToVaultBtn.dataset.title;
            if (!confirm("Move to Vault?\n\nThis will remove it from Chrome bookmarks and secure it in your private vault.")) return;
            state.privateBookmarks.push({ url, title, createdAt: new Date().toISOString() });
            await syncCloudState(state, { privateBookmarks: state.privateBookmarks });
            chrome.bookmarks.remove(id, () => loadChromeBookmarks());
            return;
        }

        const publicDeleteBtn = target.closest('.public-delete');
        if (publicDeleteBtn) {
            const id = publicDeleteBtn.dataset.id;
            chrome.bookmarks.remove(id, () => loadChromeBookmarks());
            return;
        }

        const removeTagEl = target.closest('[data-remove-tag]');
        if (removeTagEl) {
            const tag = removeTagEl.dataset.removeTag;
            const url = removeTagEl.dataset.url;
            if (state.tagsMap[url]) {
                state.tagsMap[url] = state.tagsMap[url].filter((t) => t !== tag);
                await syncCloudState(state, { tags: state.tagsMap });
                renderAllBookmarks();
                refreshCategoryDetailIfVisible();
            }
            return;
        }

        const moveBtnEl = target.closest('.move-btn');
        if (moveBtnEl) {
            openMoveModal(moveBtnEl.dataset.url);
        }
    });

    list.addEventListener('keypress', async (e) => {
        if (!e.target.classList.contains('tag-input') || e.key !== 'Enter') return;
        const tag = e.target.value.trim();
        const url = e.target.dataset.url;
        if (!tag) return;
        if (!state.tagsMap[url]) state.tagsMap[url] = [];
        if (!state.tagsMap[url].includes(tag)) {
            state.tagsMap[url].push(tag);
            await syncCloudState(state, { tags: state.tagsMap });
            renderAllBookmarks();
            refreshCategoryDetailIfVisible();
        }
    });
}

function setupMoveModalEvents() {
    categorySelect.addEventListener('change', (e) => {
        if (e.target.value === "__NEW__") {
            newCategoryInput.classList.remove('hidden');
        } else {
            newCategoryInput.classList.add('hidden');
        }
    });

    moveModal.querySelector('.close-modal').addEventListener('click', () => {
        moveModal.classList.add('hidden');
    });

    document.getElementById('confirm-move-btn').addEventListener('click', async () => {
        if (!currentMoveUrl) return;
        let selectedCat = categorySelect.value;
        if (selectedCat === "__NEW__") {
            const newName = newCategoryName.value.trim();
            if (!newName) {
                alert("Please enter a category name.");
                return;
            }
            selectedCat = newName;
            if (!state.customCategories.includes(newName)) {
                state.customCategories.push(newName);
            }
        }

        if (!state.aiMetadata[currentMoveUrl]) state.aiMetadata[currentMoveUrl] = {};
        state.aiMetadata[currentMoveUrl].category = selectedCat;
        await syncCloudState(state, {
            aiMetadata: state.aiMetadata,
            customCategories: state.customCategories
        });

        moveModal.classList.add('hidden');
        views.categoryDetail.classList.add('hidden');
        document.getElementById('category-grid').classList.remove('hidden');
        document.getElementById('create-category-btn').classList.remove('hidden');
        renderCategories();
        renderAllBookmarks();
    });
}

function openMoveModal(url) {
    currentMoveUrl = url;
    moveModal.classList.remove('hidden');
    categorySelect.innerHTML = '<option value="" disabled selected>Select Category</option>';
    const allCats = new Set([...state.customCategories]);
    const currentUrls = new Set(state.bookmarks.map((b) => b.url));
    Object.entries(state.aiMetadata).forEach(([metaUrl, m]) => {
        if (currentUrls.has(metaUrl) && m.category) {
            allCats.add(m.category);
        }
    });

    Array.from(allCats).sort().forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        categorySelect.appendChild(opt);
    });

    const newOpt = document.createElement('option');
    newOpt.value = "__NEW__";
    newOpt.innerText = "+ Create New Category";
    categorySelect.appendChild(newOpt);
    newCategoryInput.classList.add('hidden');
}

function switchToSearchView(filtered) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="all-bookmarks"]`).classList.add('active');
    views.categories.classList.add('hidden');
    views.privateLocked.classList.add('hidden');
    views.privateUnlocked.classList.add('hidden');
    views.categoryDetail.classList.add('hidden');
    views.settings.classList.add('hidden');
    views.all.classList.remove('hidden');
    renderAllBookmarks(filtered);
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    const searchContainer = document.getElementById('search-container');
    if (tabName === 'private') {
        checkVaultLock();
        return;
    }

    searchContainer.classList.remove('hidden');
    if (tabName === 'categories') {
        renderCategories();
        document.getElementById('category-grid').classList.remove('hidden');
        views.categoryDetail.classList.add('hidden');
        views.categories.classList.remove('hidden');
    } else if (tabName === 'all-bookmarks') {
        document.getElementById('search-input').value = '';
        renderAllBookmarks();
        views.all.classList.remove('hidden');
    }
}

function showSettings() {
    views.settings.classList.remove('hidden');
    views.categories.classList.add('hidden');
    views.all.classList.add('hidden');
    views.privateLocked.classList.add('hidden');
    views.privateUnlocked.classList.add('hidden');
    views.categoryDetail.classList.add('hidden');
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
}

function setupVaultEvents() {
    const setPinBtn = document.getElementById('set-pin-btn');
    if (setPinBtn) {
        setPinBtn.addEventListener('click', () => {
            const pin = document.getElementById('new-pin').value;
            if (pin.length === 4) {
                chrome.storage.local.set({ bookify_pin: pin }, () => {
                    alert("PIN set successfully!");
                    document.getElementById('setup-pin-section').classList.add('hidden');
                });
            }
        });
    }

    const unlockBtn = document.getElementById('unlock-vault-btn');
    if (unlockBtn) {
        unlockBtn.addEventListener('click', () => {
            const inputPin = document.getElementById('vault-pin').value;
            chrome.storage.local.get(['bookify_pin'], (result) => {
                if (inputPin === result.bookify_pin) {
                    state.isVaultUnlocked = true;
                    document.getElementById('vault-error').classList.add('hidden');
                    views.privateLocked.classList.add('hidden');
                    checkVaultLock();
                } else {
                    document.getElementById('vault-error').classList.remove('hidden');
                }
            });
        });
    }

    const lockBtn = document.getElementById('lock-vault-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            state.isVaultUnlocked = false;
            document.getElementById('vault-pin').value = '';
            switchTab('private');
        });
    }

    const updatePinBtn = document.getElementById('update-pin-btn');
    if (updatePinBtn) {
        updatePinBtn.addEventListener('click', () => {
            const oldPinInput = document.getElementById('old-pin-input').value;
            const newPinInput = document.getElementById('new-pin-input').value;
            const msg = document.getElementById('pin-msg');
            chrome.storage.local.get(['bookify_pin'], (result) => {
                if (oldPinInput !== result.bookify_pin) {
                    msg.style.color = 'red';
                    msg.innerText = "Old PIN is incorrect.";
                    return;
                }
                if (newPinInput.length !== 4) {
                    msg.style.color = 'red';
                    msg.innerText = "New PIN must be 4 digits.";
                    return;
                }
                chrome.storage.local.set({ bookify_pin: newPinInput }, () => {
                    msg.style.color = 'green';
                    msg.innerText = "PIN updated successfully!";
                    document.getElementById('old-pin-input').value = '';
                    document.getElementById('new-pin-input').value = '';
                });
            });
        });
    }

    const resetVaultBtn = document.getElementById('reset-vault-pin-btn');
    if (resetVaultBtn) {
        resetVaultBtn.addEventListener('click', async () => {
            if (!confirm('Reset Vault PIN?\n\nThis will permanently delete ALL bookmarks stored in your private vault and clear the PIN.')) return;

            state.privateBookmarks = [];
            state.isVaultUnlocked = false;
            state.aiMetadata = state.aiMetadata || {};

            // Persist vault deletion (and keep guest mode functional)
            await syncCloudState(state, { privateBookmarks: state.privateBookmarks });

            await new Promise((resolve) => {
                chrome.storage.local.remove(['bookify_pin'], () => resolve());
            });

            document.getElementById('vault-pin').value = '';
            document.getElementById('vault-error').classList.add('hidden');

            switchTab('private');
        });
    }
}

function checkVaultLock() {
    const searchContainer = document.getElementById('search-container');
    if (state.isVaultUnlocked) {
        renderPrivateBookmarks();
        views.privateUnlocked.classList.remove('hidden');
        searchContainer.classList.add('hidden');
    } else {
        views.privateLocked.classList.remove('hidden');
        searchContainer.classList.add('hidden');
        chrome.storage.local.get(['bookify_pin'], (result) => {
            const savedPin = result.bookify_pin;
            const setup = document.getElementById('setup-pin-section');
            if (!savedPin) setup.classList.remove('hidden');
            else setup.classList.add('hidden');
        });
    }
}

function renderPrivateBookmarks() {
    const list = document.getElementById('private-list');
    list.innerHTML = '';
    state.privateBookmarks.forEach((bm, index) => {
        const li = document.createElement('li');
        li.className = 'bookmark-item private-bookmark-item';
        li.innerHTML = `
            <div class="bm-header">
                <a href="${bm.url}" target="_blank" class="bm-link">${bm.title}</a>
                <div class="bm-actions">
                    <i class="fas fa-unlock lock-btn move-to-public" data-index="${index}" title="Move to Public"></i>
                    <i class="fas fa-trash delete-btn private-delete" data-index="${index}"></i>
                </div>
            </div>
        `;
        list.appendChild(li);
    });
}

function setupPrivateListDelegation() {
    const list = document.getElementById('private-list');
    if (!list) return;
    list.addEventListener('click', async (e) => {
        const target = e.target;

        const deleteBtn = target.closest('.private-delete');
        if (deleteBtn) {
            const index = parseInt(deleteBtn.dataset.index, 10);
            state.privateBookmarks.splice(index, 1);
            await syncCloudState(state, { privateBookmarks: state.privateBookmarks });
            renderPrivateBookmarks();
            return;
        }

        const moveToPublicBtn = target.closest('.move-to-public');
        if (moveToPublicBtn) {
            const index = parseInt(moveToPublicBtn.dataset.index, 10);
            const itemToMove = state.privateBookmarks[index];
            if (!itemToMove) return;
            state.privateBookmarks.splice(index, 1);
            await syncCloudState(state, { privateBookmarks: state.privateBookmarks });
            chrome.bookmarks.create({
                parentId: '1',
                title: itemToMove.title,
                url: itemToMove.url
            }, () => {
                renderPrivateBookmarks();
                loadChromeBookmarks();
            });
        }
    });
}

function refreshCategoryDetailIfVisible() {
    const detail = views.categoryDetail;
    if (!detail || detail.classList.contains('hidden')) return;
    if (!activeCategoryDetailName) return;
    const items = getBookmarksByCategory(activeCategoryDetailName);
    renderBookmarkList(items, 'category-list');
}

function getBookmarksByCategory(categoryName) {
    if (categoryName === 'Unsorted') {
        return state.bookmarks.filter((bm) => {
            const meta = state.aiMetadata[bm.url];
            return !meta || !meta.category;
        });
    }
    return state.bookmarks.filter((bm) => state.aiMetadata[bm.url]?.category === categoryName);
}

function setupShortcutSettings() {
    const checkbox = document.getElementById('shortcut-enabled-checkbox');
    if (!checkbox) return;

    chrome.storage.local.get(['shortcut_enabled'], (result) => {
        const enabled = result.shortcut_enabled !== false; // default true
        checkbox.checked = enabled;
    });

    checkbox.addEventListener('change', () => {
        chrome.storage.local.set({ shortcut_enabled: checkbox.checked });
    });
}
