// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBBMGdORhteEe1QtQqBQIaiOq6NWe5eJfE",
    authDomain: "bookify-extension.firebaseapp.com",
    projectId: "bookify-extension",
    storageBucket: "bookify-extension.firebasestorage.app",
    messagingSenderId: "882791110164",
    appId: "1:882791110164:web:ee21a39f638bb7ff247901"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- STATE MANAGEMENT ---
let currentUser = null;
let bookmarks = [];
let privateBookmarks = [];
let aiMetadata = {}; // { url: { category: '...', tags: [...] } }
let customCategories = []; // Array of strings
let apiKey = '';
let tagsMap = {};
let isVaultUnlocked = false;



const screens = {
    auth: document.getElementById('auth-screen'),
    dashboard: document.getElementById('dashboard-screen')
};
const views = {
    categories: document.getElementById('categories-view'),
    all: document.getElementById('all-bookmarks-view'),
    privateLocked: document.getElementById('private-locked-view'),
    privateUnlocked: document.getElementById('private-unlocked-view'),
    categoryDetail: document.getElementById('category-detail-view')
};

// --- AUTHENTICATION ---
document.getElementById('google-login-btn').addEventListener('click', () => {
    chrome.identity.getAuthToken({ interactive: true }, function (token) {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            alert("Login failed: " + chrome.runtime.lastError.message);
            return;
        }
        console.log("Token received:", token);
        if (!token) {
            console.error("No token received");
            return;
        }
        const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
        console.log("Credential created:", credential);

        auth.signInWithCredential(credential).catch((error) => {
            console.error("Login Error Details:", error);
            console.log("Error Code:", error.code);
            console.log("Error Message:", error.message);

            // If token is invalid, remove it
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/duplicate-raw-id') {
                chrome.identity.removeCachedAuthToken({ token: token }, function () {
                    alert("Authentication error. Please try again.");
                });
            } else {
                alert("Firebase Login Error: " + error.message);
            }
        });
    });
});

document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('user-email').innerText = user.email;
        screens.auth.classList.add('hidden');
        screens.dashboard.classList.remove('hidden');
        await loadUserData();
        loadChromeBookmarks();
    } else {
        currentUser = null;
        screens.auth.classList.remove('hidden');
        screens.dashboard.classList.add('hidden');
    }
});

// --- SEARCH LOGIC ---
// Semantic Search Toggle
// Semantic Search Toggle (Removed from UI)
// document.getElementById('semantic-search-toggle').addEventListener('click', ...);

// Search Input Handler
document.getElementById('search-input').addEventListener('input', async (e) => {
    const query = e.target.value.trim();

    if (query.length > 0) {
        const filtered = textSearchBookmarks(query.toLowerCase());
        switchToSearchView(filtered);
    } else {
        // If query cleared, reload all
        renderAllBookmarks();
    }
});

// Text Search Function (old logic extracted)
function textSearchBookmarks(query) {
    return bookmarks.filter(bm => {
        const inTitle = bm.title.toLowerCase().includes(query);
        const inUrl = bm.url.toLowerCase().includes(query);

        // Search manual tags
        const manualTags = tagsMap[bm.url] || [];
        const inManualTags = manualTags.some(t => t.toLowerCase().includes(query));

        // Search AI tags
        const aiTags = (aiMetadata[bm.url] && aiMetadata[bm.url].tags) ? aiMetadata[bm.url].tags : [];
        const inAiTags = aiTags.some(t => t.toLowerCase().includes(query));

        // Search AI category
        const aiCategory = (aiMetadata[bm.url] && aiMetadata[bm.url].category) ? aiMetadata[bm.url].category : '';
        const inCategory = aiCategory.toLowerCase().includes(query);

        return inTitle || inUrl || inManualTags || inAiTags || inCategory;
    });
}

// Semantic Search Function (AI-powered)


// Helper to switch to search view
function switchToSearchView(filtered) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="all-bookmarks"]`).classList.add('active');

    views.categories.classList.add('hidden');
    views.privateLocked.classList.add('hidden');
    views.privateUnlocked.classList.add('hidden');
    views.all.classList.remove('hidden');

    renderAllBookmarks(filtered);
}


// --- DATA HANDLING ---
async function loadUserData() {
    if (!currentUser) return;
    const userRef = db.collection("users").doc(currentUser.uid);
    const docSnap = await userRef.get();

    if (docSnap.exists) {
        const data = docSnap.data();
        tagsMap = data.tags || {};
        privateBookmarks = data.privateBookmarks || [];
        aiMetadata = data.aiMetadata || {};
        customCategories = data.customCategories || [];
    } else {
        await userRef.set({ tags: {}, privateBookmarks: [], aiMetadata: {}, customCategories: [] });
    }

    // Load Backup if Firestore is empty
    if (Object.keys(aiMetadata).length === 0) {
        chrome.storage.local.get(['aiMetadata_backup'], (result) => {
            if (result.aiMetadata_backup) {
                console.log("Using local backup for AI Metadata");
                aiMetadata = result.aiMetadata_backup;
                renderCategories(); // Re-render with backup
            }
        });
    }

    // Load API Key
    chrome.storage.local.get(['gemini_api_key'], (result) => {
        if (result.gemini_api_key) {
            apiKey = result.gemini_api_key;
            document.getElementById('gemini-api-key').value = apiKey;
            document.getElementById('analyze-btn').disabled = false;
        }
    });

    // Sync local AI metadata to Firestore
    chrome.storage.local.get(['aiMetadata_local'], async (result) => {
        if (result.aiMetadata_local && Object.keys(result.aiMetadata_local).length > 0) {
            console.log('🔄 Syncing local AI metadata to Firestore...');
            // Merge local metadata with existing
            aiMetadata = { ...aiMetadata, ...result.aiMetadata_local };

            // Save to Firestore
            await userRef.update({ aiMetadata: aiMetadata });

            // Clear local storage after sync
            chrome.storage.local.remove(['aiMetadata_local']);
            console.log('✅ Synced and cleared local AI metadata');

            // Refresh UI
            renderCategories();
            renderAllBookmarks();
        }
    });
}

async function syncTags() {
    if (currentUser) {
        const userRef = db.collection("users").doc(currentUser.uid);
        await userRef.update({ tags: tagsMap });
    }
}

function loadChromeBookmarks() {
    chrome.bookmarks.getTree((bookmarkTreeNodes) => {
        bookmarks = [];
        processBookmarkTree(bookmarkTreeNodes);
        renderCategories();
        renderAllBookmarks();
    });
}

function processBookmarkTree(nodes) {
    nodes.forEach(node => {
        if (node.url) {
            bookmarks.push({
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

function getBookmarksByCategory(categoryName) {
    if (categoryName === 'Unsorted') {
        return bookmarks.filter(bm => {
            const meta = aiMetadata[bm.url];
            return !meta || !meta.category;
        });
    }
    return bookmarks.filter(bm => {
        const meta = aiMetadata[bm.url];
        return meta && meta.category === categoryName;
    });
}

// --- RENDERING ---
function renderCategories() {
    const grid = document.getElementById('category-grid');
    grid.innerHTML = '';

    // Group bookmarks by AI category
    const groups = {};

    // Initialize with custom categories
    if (Array.isArray(customCategories)) {
        customCategories.forEach(cat => {
            groups[cat] = [];
        });
    } else {
        customCategories = [];
    }

    bookmarks.forEach(bm => {
        const meta = aiMetadata[bm.url];
        const cat = (meta && meta.category) ? meta.category : 'Unsorted';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(bm);
    });

    Object.keys(groups).sort().forEach(cat => {
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

        // Click on card to open
        card.addEventListener('click', (e) => {
            if (!e.target.classList.contains('delete-cat-btn')) {
                showCategoryDetail(cat, items);
            }
        });

        // Click on delete button
        const deleteBtn = card.querySelector('.delete-cat-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteCategory(cat, items);
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

    if (confirm(confirmMsg)) {
        // 1. Delete bookmarks if any
        if (hasBookmarks) {
            for (const bm of items) {
                // Remove from Chrome
                // Note: chrome.bookmarks.remove requires an ID. 
                // We need to ensure 'bm' has an 'id'. Our 'bookmarks' array usually comes from chrome.bookmarks.getTree
                if (bm.id) {
                    await new Promise(resolve => chrome.bookmarks.remove(bm.id, resolve));
                }

                // Remove from aiMetadata
                if (aiMetadata[bm.url]) {
                    delete aiMetadata[bm.url];
                }
            }
        }

        // 2. Remove from customCategories
        const catIndex = customCategories.indexOf(categoryName);
        if (catIndex > -1) {
            customCategories.splice(catIndex, 1);
        }

        // 3. Sync to Firestore
        if (currentUser) {
            const userRef = db.collection("users").doc(currentUser.uid);
            await userRef.update({
                customCategories: customCategories,
                aiMetadata: aiMetadata
            });
        }

        // 4. Refresh UI
        // We need to reload bookmarks from Chrome to reflect deletions
        loadChromeBookmarks();
    }
}

function showCategoryDetail(categoryName, items) {
    document.getElementById('category-grid').classList.add('hidden');
    document.getElementById('create-category-btn').classList.add('hidden'); // Hide button
    document.getElementById('category-detail-view').classList.remove('hidden');
    document.getElementById('category-title').innerText = categoryName;

    renderBookmarkList(items, 'category-list');
}

document.getElementById('back-to-categories').addEventListener('click', () => {
    document.getElementById('category-detail-view').classList.add('hidden');
    document.getElementById('category-grid').classList.remove('hidden');
    document.getElementById('create-category-btn').classList.remove('hidden'); // Show button
});

// Create Category Logic
document.getElementById('create-category-btn').addEventListener('click', async () => {
    const name = prompt("Enter new category name:");
    if (name && name.trim() !== "") {
        const cat = name.trim();
        if (!customCategories.includes(cat)) {
            customCategories.push(cat);

            // Save to Firestore
            if (currentUser) {
                const userRef = db.collection("users").doc(currentUser.uid);
                await userRef.update({ customCategories: customCategories });
            }

            renderCategories();
        }
    }
});

function renderAllBookmarks(subset = null) {
    const data = subset || bookmarks;
    renderBookmarkList(data, 'bookmarks-list');
}

function renderBookmarkList(data, listId) {
    const list = document.getElementById(listId);
    list.innerHTML = '';

    if (data.length === 0) {
        list.innerHTML = '<li class="empty-list-msg">No bookmarks found</li>';
        return;
    }

    data.forEach(bm => {
        const li = document.createElement('li');
        li.className = 'bookmark-item';

        const manualTags = tagsMap[bm.url] || [];
        const aiTags = (aiMetadata[bm.url] && aiMetadata[bm.url].tags) ? aiMetadata[bm.url].tags : [];

        // Filter out duplicates
        const uniqueAiTags = aiTags.filter(t => !manualTags.includes(t));

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
            <div class="tags-container" id="tags-${bm.id}">
                ${manualTags.map(t => `<span class="tag">${t} <i class="fas fa-times" data-remove-tag="${t}" data-url="${bm.url}"></i></span>`).join('')}
                ${uniqueAiTags.map(t => `<span class="tag ai-tag"><i class="fas fa-robot"></i> ${t}</span>`).join('')}
                <input type="text" class="tag-input" placeholder="+ Tag" data-url="${bm.url}">
            </div>
        `;
        list.appendChild(li);
    });
    // attachItemListeners(); // Removed: Using delegation instead
}

// --- EVENT DELEGATION FOR LISTS ---
function setupListDelegation(listId) {
    const list = document.getElementById(listId);
    if (!list) return;

    list.addEventListener('click', async (e) => {
        const target = e.target;

        // Move to Vault
        if (target.classList.contains('move-to-vault')) {
            const id = target.dataset.id;
            const url = target.dataset.url;
            const title = target.dataset.title;

            if (confirm("Move to Vault?\n\nThis will remove it from Chrome bookmarks and secure it in your private vault.")) {
                const newBm = { url, title, createdAt: new Date().toISOString() };
                privateBookmarks.push(newBm);

                if (currentUser) {
                    const userRef = db.collection("users").doc(currentUser.uid);
                    await userRef.update({
                        privateBookmarks: firebase.firestore.FieldValue.arrayUnion(newBm)
                    });
                }

                chrome.bookmarks.remove(id, () => {
                    if (chrome.runtime.lastError) {
                        console.warn("Bookmark removal failed (likely already deleted):", chrome.runtime.lastError.message);
                    }
                    loadChromeBookmarks();
                });
            }
            return;
        }

        // Delete Public Bookmark
        if (target.classList.contains('public-delete')) {
            const id = target.dataset.id;
            chrome.storage.local.get(['suppressDeleteWarning'], (result) => {
                const performDelete = () => {
                    chrome.bookmarks.remove(id, () => {
                        if (chrome.runtime.lastError) {
                            console.warn("Bookmark removal failed (likely already deleted):", chrome.runtime.lastError.message);
                        }

                        // Check if we're in a category detail view
                        const categoryDetailView = document.getElementById('category-detail-view');
                        const isInCategoryDetail = categoryDetailView && !categoryDetailView.classList.contains('hidden');

                        if (isInCategoryDetail) {
                            // Get the current category name
                            const currentCategoryName = document.getElementById('category-title').innerText;

                            // Reload bookmarks first
                            chrome.bookmarks.getTree((bookmarkTreeNodes) => {
                                bookmarks = [];
                                processBookmarkTree(bookmarkTreeNodes);

                                // Get updated bookmarks for this category
                                const updatedItems = getBookmarksByCategory(currentCategoryName);

                                // Re-render the category detail view with updated data
                                renderBookmarkList(updatedItems, 'category-list');

                                // Also update other views
                                renderCategories();
                                renderAllBookmarks();
                            });
                        } else {
                            // Normal refresh if not in category detail
                            loadChromeBookmarks();
                        }
                    });
                };

                if (result.suppressDeleteWarning) {
                    performDelete();
                } else {
                    if (confirm("Are you sure you want to delete this bookmark?\n\nThis warning will not appear again.")) {
                        chrome.storage.local.set({ suppressDeleteWarning: true });
                        performDelete();
                    }
                }
            });
            return;
        }

        // Remove Tag
        if (target.dataset.removeTag) {
            const tag = target.dataset.removeTag;
            const url = target.dataset.url;
            if (tagsMap[url]) {
                tagsMap[url] = tagsMap[url].filter(t => t !== tag);
                await syncTags();
                renderAllBookmarks();
            }
            return;
        }

        // Move to Category
        if (target.classList.contains('move-btn')) {
            const url = target.dataset.url;
            openMoveModal(url);
            return;
        }
    });

    // Tag Input (Keypress delegation)
    list.addEventListener('keypress', async (e) => {
        if (e.target.classList.contains('tag-input') && e.key === 'Enter') {
            const tag = e.target.value.trim();
            const url = e.target.dataset.url;
            if (tag) {
                if (!tagsMap[url]) tagsMap[url] = [];
                if (!tagsMap[url].includes(tag)) {
                    tagsMap[url].push(tag);
                    await syncTags();
                    renderAllBookmarks();
                }
            }
        }
    });
}

// Initialize delegation
setupListDelegation('bookmarks-list');
setupListDelegation('category-list');

// --- MOVE MODAL LOGIC ---
const moveModal = document.getElementById('move-modal');
const categorySelect = document.getElementById('category-select');
const newCategoryInput = document.getElementById('new-category-container');
const newCategoryName = document.getElementById('new-category-name');
let currentMoveUrl = null;

function openMoveModal(url) {
    currentMoveUrl = url;
    moveModal.classList.remove('hidden');

    // Populate categories
    categorySelect.innerHTML = '<option value="" disabled selected>Select Category</option>';

    // Get all unique categories (AI + Custom)
    const allCats = new Set([...customCategories]);

    // Create a Set of current bookmark URLs for fast lookup
    const currentUrls = new Set(bookmarks.map(b => b.url));

    Object.entries(aiMetadata).forEach(([url, m]) => {
        if (currentUrls.has(url) && m.category) {
            allCats.add(m.category);
        }
    });

    Array.from(allCats).sort().forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        categorySelect.appendChild(opt);
    });

    // Add "New Category" option
    const newOpt = document.createElement('option');
    newOpt.value = "__NEW__";
    newOpt.innerText = "+ Create New Category";
    categorySelect.appendChild(newOpt);

    newCategoryInput.classList.add('hidden');
}

categorySelect.addEventListener('change', (e) => {
    if (e.target.value === "__NEW__") {
        newCategoryInput.classList.remove('hidden');
    } else {
        newCategoryInput.classList.add('hidden');
    }
});

document.querySelector('.close-modal').addEventListener('click', () => {
    moveModal.classList.add('hidden');
});

document.getElementById('confirm-move-btn').addEventListener('click', async () => {
    if (!currentMoveUrl) return;

    let selectedCat = categorySelect.value;

    if (selectedCat === "__NEW__") {
        const newName = newCategoryName.value.trim();
        if (newName) {
            selectedCat = newName;
            // Add to custom categories if not exists
            if (!customCategories.includes(newName)) {
                customCategories.push(newName);
                if (currentUser) {
                    const userRef = db.collection("users").doc(currentUser.uid);
                    await userRef.update({ customCategories: customCategories });
                }
            }
        } else {
            alert("Please enter a category name.");
            return;
        }
    }

    if (selectedCat) {
        // Update AI Metadata
        if (!aiMetadata[currentMoveUrl]) aiMetadata[currentMoveUrl] = {};
        aiMetadata[currentMoveUrl].category = selectedCat;

        // Save to Firestore
        if (currentUser) {
            const userRef = db.collection("users").doc(currentUser.uid);
            await userRef.update({ aiMetadata: aiMetadata });
        }

        // Refresh UI
        moveModal.classList.add('hidden');

        // Check if we're in a category detail view
        const categoryDetailView = document.getElementById('category-detail-view');
        const isInCategoryDetail = !categoryDetailView.classList.contains('hidden');

        if (isInCategoryDetail) {
            // Get the current category being viewed
            const currentCategoryName = document.getElementById('category-title').innerText;

            // Go back to categories view
            document.getElementById('category-detail-view').classList.add('hidden');
            document.getElementById('category-grid').classList.remove('hidden');
            document.getElementById('create-category-btn').classList.remove('hidden');
        }

        renderCategories();
        renderAllBookmarks();
    }
});

// --- TABS & NAVIGATION ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab-btn').dataset.tab;
        switchTab(tab);
    });
});

function switchTab(tabName, refresh = true) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    const searchContainer = document.getElementById('search-container');

    if (tabName === 'private') {
        checkVaultLock();
    } else {
        if (searchContainer) searchContainer.classList.remove('hidden');

        if (tabName === 'categories') {
            renderCategories();
            document.getElementById('category-grid').classList.remove('hidden');
            document.getElementById('category-detail-view').classList.add('hidden');
            views.categories.classList.remove('hidden');
        } else if (tabName === 'all-bookmarks') {
            document.getElementById('search-input').value = '';
            if (refresh) renderAllBookmarks();
            views.all.classList.remove('hidden');
        }
    }
}
function checkVaultLock() {
    const searchContainer = document.getElementById('search-container');

    if (isVaultUnlocked) {
        // Unlock View
        renderPrivateBookmarks();
        views.privateUnlocked.classList.remove('hidden');
        if (searchContainer) searchContainer.classList.add('hidden');
    } else {
        // Locked View
        views.privateLocked.classList.remove('hidden');
        if (searchContainer) searchContainer.classList.add('hidden');

        chrome.storage.local.get(['bookify_pin'], (result) => {
            const savedPin = result.bookify_pin;
            if (!savedPin) {
                document.getElementById('setup-pin-section').classList.remove('hidden');
            } else {
                document.getElementById('setup-pin-section').classList.add('hidden');
            }
        });
    }
}

// Setup New PIN
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

// Unlock Vault
const unlockBtn = document.getElementById('unlock-vault-btn');
if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
        const inputPin = document.getElementById('vault-pin').value;

        chrome.storage.local.get(['bookify_pin'], (result) => {
            const savedPin = result.bookify_pin;

            if (inputPin === savedPin) {
                isVaultUnlocked = true;
                document.getElementById('vault-error').classList.add('hidden');
                views.privateLocked.classList.add('hidden');
                checkVaultLock();
            } else {
                document.getElementById('vault-error').classList.remove('hidden');
            }
        });
    });
}

// Lock Button Logic
const lockBtn = document.getElementById('lock-vault-btn');
if (lockBtn) {
    lockBtn.addEventListener('click', () => {
        isVaultUnlocked = false;
        document.getElementById('vault-pin').value = '';
        switchTab('private');
    });
}



function renderPrivateBookmarks() {
    const list = document.getElementById('private-list');
    list.innerHTML = '';
    privateBookmarks.forEach((bm, index) => {
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

// Event delegation for private bookmarks list
function setupPrivateListDelegation() {
    const list = document.getElementById('private-list');
    if (!list) return;

    list.addEventListener('click', async (e) => {
        const target = e.target;

        // Delete from Vault
        if (target.classList.contains('private-delete')) {
            const index = parseInt(target.dataset.index);
            chrome.storage.local.get(['suppressDeleteWarning'], (result) => {
                const deleteItem = async () => {
                    const itemToDelete = privateBookmarks[index];
                    privateBookmarks.splice(index, 1);

                    if (currentUser) {
                        const userRef = db.collection("users").doc(currentUser.uid);
                        await userRef.update({
                            privateBookmarks: firebase.firestore.FieldValue.arrayRemove(itemToDelete)
                        });
                    }

                    renderPrivateBookmarks();
                };

                if (result.suppressDeleteWarning) {
                    deleteItem();
                } else {
                    if (confirm("Delete from Vault?\n\nThis warning will not appear again.")) {
                        chrome.storage.local.set({ suppressDeleteWarning: true });
                        deleteItem();
                    }
                }
            });
            return;
        }

        // Move to Public
        if (target.classList.contains('move-to-public')) {
            const index = parseInt(target.dataset.index);
            const itemToMove = privateBookmarks[index];

            if (confirm("Move to Public Bookmarks?\n\nThis will restore it to Chrome bookmarks.")) {
                // Remove from private
                privateBookmarks.splice(index, 1);

                if (currentUser) {
                    const userRef = db.collection("users").doc(currentUser.uid);
                    await userRef.update({
                        privateBookmarks: firebase.firestore.FieldValue.arrayRemove(itemToMove)
                    });
                }

                // Add back to Chrome
                chrome.bookmarks.create({
                    parentId: '1', // Bookmarks Bar
                    title: itemToMove.title,
                    url: itemToMove.url
                }, () => {
                    renderPrivateBookmarks();
                    loadChromeBookmarks();
                });
            }
            return;
        }
    });
}

// Call this once when the page loads
setupPrivateListDelegation();

// FEATURE: Change PIN Logic
const updatePinBtn = document.getElementById('update-pin-btn');
if (updatePinBtn) {
    updatePinBtn.addEventListener('click', () => {
        const oldPinInput = document.getElementById('old-pin-input').value;
        const newPinInput = document.getElementById('new-pin-input').value;
        const msg = document.getElementById('pin-msg');

        chrome.storage.local.get(['bookify_pin'], (result) => {
            const savedPin = result.bookify_pin;

            if (oldPinInput !== savedPin) {
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

// --- SETTINGS LOGIC ---
document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-view').classList.remove('hidden');

    // Hide all other views
    Object.values(views).forEach(view => {
        if (view) view.classList.add('hidden');
    });

    // Reset tabs
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
});

document.getElementById('save-api-key-btn').addEventListener('click', () => {
    const key = document.getElementById('gemini-api-key').value.trim();
    if (key) {
        chrome.storage.local.set({ gemini_api_key: key }, () => {
            apiKey = key;
            document.getElementById('api-key-status').innerText = "API Key Saved!";
            document.getElementById('api-key-status').style.color = "green";
            document.getElementById('analyze-btn').disabled = false;
            setTimeout(() => { document.getElementById('api-key-status').innerText = ""; }, 3000);
        });
    }
});

document.getElementById('analyze-btn').addEventListener('click', async () => {
    if (!apiKey) return;

    const btn = document.getElementById('analyze-btn');
    const progress = document.getElementById('analysis-progress');
    const status = document.getElementById('analysis-status');

    btn.disabled = true;
    progress.classList.remove('hidden');
    status.innerText = "Analyzing bookmarks...";

    try {
        await analyzeBookmarksWithGemini(bookmarks, apiKey);
        status.innerText = "Analysis Complete!";
        setTimeout(() => {
            progress.classList.add('hidden');
            btn.disabled = false;
            // Refresh view
            renderCategories();
            alert("Analysis Complete! Check your categories.");
        }, 1000);
    } catch (error) {
        console.error(error);
        status.innerText = "Error: " + error.message;
        btn.disabled = false;
    }
});

// --- AI SERVICE ---
async function analyzeBookmarksWithGemini(bookmarksList, key) {
    const BATCH_SIZE = 10;
    const batches = [];

    for (let i = 0; i < bookmarksList.length; i += BATCH_SIZE) {
        batches.push(bookmarksList.slice(i, i + BATCH_SIZE));
    }

    let processedCount = 0;
    const status = document.getElementById('analysis-status');

    for (const batch of batches) {
        processedCount += batch.length;
        status.innerText = `Processing ${processedCount}/${bookmarksList.length}...`;

        // Get all existing categories (custom + AI-generated)
        const existingCategories = new Set([...customCategories]);
        Object.values(aiMetadata).forEach(meta => {
            if (meta.category) existingCategories.add(meta.category);
        });
        const existingCategoriesList = Array.from(existingCategories).sort().join(', ');

        const prompt = `
Analyze the following bookmarks and categorize them intelligently. For each bookmark:
1. Assign ONE specific, meaningful category that best describes its content
2. Generate 2 relevant tags

**EXISTING CATEGORIES (use these when appropriate):**
${existingCategoriesList || 'None yet'}

**Category Guidelines:**
- **CRITICAL: Check if an existing category above is semantically similar or related to what you would assign**
  - Example: If "online shopping" exists, use it instead of creating "Shopping"
  - Example: If "Web Development" exists, use it instead of creating "Development" or "Web Dev"
  - Example: If "Machine Learning" exists, use it instead of creating "AI" or "ML"
- **Prioritize using existing categories** - match by meaning, not just exact wording
- Only create a NEW category if NO existing category is related or suitable
- Create specific categories that accurately describe the content (e.g., "Cooking & Recipes", "Web Development", "Machine Learning")
- Keep category names concise (2-3 words max)
- Use "&" to combine related topics if needed

**Important:** 
- If a manually created category exists that fits the bookmark, USE IT (even if worded differently)
- Match categories by CONCEPT, not just exact text
- Prioritize accuracy and consistency with user's existing organization
- For food/recipe sites, use "Cooking & Recipes" or "Food & Dining", NOT "Entertainment"

Return ONLY a JSON object where keys are the bookmark URLs and values are objects with "category" and "tags".

**Bookmarks:**
${batch.map(b => `- ${b.url} (${b.title})`).join('\n')}

**Output format:**
{
  "url1": { "category": "Exact Category Name From Above", "tags": ["tag1", "tag2", "tag3"] },
  "url2": { "category": "Another Category", "tags": ["tag1", "tag2", "tag3"] }
}
        `;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            const data = await response.json();
            if (data.error) {
                console.error("Gemini API Error Details:", JSON.stringify(data.error, null, 2));
                throw new Error(`Gemini Error: ${data.error.message} (Code: ${data.error.code})`);
            }

            const text = data.candidates[0].content.parts[0].text;
            // Extract JSON from markdown code block if present
            const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
            const result = JSON.parse(jsonStr);

            // Post-process: Match AI-generated categories with existing similar ones
            const existingCategoriesArray = Array.from(existingCategories);
            Object.keys(result).forEach(url => {
                const aiCategory = result[url].category;

                // Check for exact match (case-insensitive)
                const exactMatch = existingCategoriesArray.find(
                    existing => existing.toLowerCase() === aiCategory.toLowerCase()
                );

                if (exactMatch) {
                    result[url].category = exactMatch;
                } else {
                    // Check for partial/fuzzy match (one contains the other)
                    const fuzzyMatch = existingCategoriesArray.find(existing => {
                        const existingLower = existing.toLowerCase();
                        const aiLower = aiCategory.toLowerCase();

                        // Remove common words for better matching
                        const cleanExisting = existingLower.replace(/\s*&\s*/g, ' ').replace(/\s+/g, ' ').trim();
                        const cleanAi = aiLower.replace(/\s*&\s*/g, ' ').replace(/\s+/g, ' ').trim();

                        // Check if one contains the other or they share significant overlap
                        return cleanExisting.includes(cleanAi) ||
                            cleanAi.includes(cleanExisting) ||
                            cleanExisting.split(' ').some(word => word.length > 3 && cleanAi.includes(word)) &&
                            cleanAi.split(' ').some(word => word.length > 3 && cleanExisting.includes(word));
                    });

                    if (fuzzyMatch) {
                        console.log(`🔄 Category fuzzy match: "${aiCategory}" → "${fuzzyMatch}"`);
                        result[url].category = fuzzyMatch;
                    }
                }
            });

            // Merge into aiMetadata
            aiMetadata = { ...aiMetadata, ...result };

            // Save locally immediately as backup
            chrome.storage.local.set({ aiMetadata_backup: aiMetadata });

        } catch (err) {
            console.error("Batch failed", err);
        }
    }

    // Save to Firestore
    if (currentUser) {
        const userRef = db.collection("users").doc(currentUser.uid);
        await userRef.update({ aiMetadata: aiMetadata });
    }
}
