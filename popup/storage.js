import { db } from './auth.js';

const LOCAL_KEYS = {
    tags: 'tags_local',
    privateBookmarks: 'privateBookmarks_local',
    aiMetadata: 'aiMetadata_backup',
    customCategories: 'customCategories_local',
    apiKey: 'gemini_api_key',
    pendingAi: 'aiMetadata_local'
};

export async function loadLocalState(state) {
    const result = await chrome.storage.local.get(Object.values(LOCAL_KEYS));
    state.tagsMap = result[LOCAL_KEYS.tags] || {};
    state.privateBookmarks = result[LOCAL_KEYS.privateBookmarks] || [];
    state.aiMetadata = result[LOCAL_KEYS.aiMetadata] || {};
    state.customCategories = result[LOCAL_KEYS.customCategories] || [];
    state.apiKey = result[LOCAL_KEYS.apiKey] || '';

    // Merge in any background auto-analysis staged data (guest mode support)
    const pendingAi = result[LOCAL_KEYS.pendingAi];
    if (pendingAi && Object.keys(pendingAi).length > 0) {
        state.aiMetadata = { ...state.aiMetadata, ...pendingAi };
        await chrome.storage.local.remove([LOCAL_KEYS.pendingAi]);
    }
}

export async function persistLocalState(state) {
    await chrome.storage.local.set({
        [LOCAL_KEYS.tags]: state.tagsMap,
        [LOCAL_KEYS.privateBookmarks]: state.privateBookmarks,
        [LOCAL_KEYS.aiMetadata]: state.aiMetadata,
        [LOCAL_KEYS.customCategories]: state.customCategories
    });
}

export async function saveApiKey(state, key) {
    state.apiKey = key;
    await chrome.storage.local.set({ [LOCAL_KEYS.apiKey]: key });
}

export async function loadCloudState(state) {
    if (!state.currentUser) {
        return;
    }
    const userRef = db.collection("users").doc(state.currentUser.uid);
    const docSnap = await userRef.get();

    if (docSnap.exists) {
        const data = docSnap.data();
        state.tagsMap = { ...state.tagsMap, ...(data.tags || {}) };
        state.privateBookmarks = mergeBookmarkArrays(state.privateBookmarks, data.privateBookmarks || []);
        state.aiMetadata = { ...state.aiMetadata, ...(data.aiMetadata || {}) };
        state.customCategories = unique([...state.customCategories, ...(data.customCategories || [])]);
    } else {
        await userRef.set({ tags: {}, privateBookmarks: [], aiMetadata: {}, customCategories: [] });
    }

    const localPending = await chrome.storage.local.get([LOCAL_KEYS.pendingAi]);
    if (localPending[LOCAL_KEYS.pendingAi] && Object.keys(localPending[LOCAL_KEYS.pendingAi]).length > 0) {
        state.aiMetadata = { ...state.aiMetadata, ...localPending[LOCAL_KEYS.pendingAi] };
        await userRef.update({ aiMetadata: state.aiMetadata });
        await chrome.storage.local.remove([LOCAL_KEYS.pendingAi]);
    }

    await persistLocalState(state);
}

export async function syncCloudState(state, partial = null) {
    await persistLocalState(state);
    if (!state.currentUser) {
        return;
    }
    const userRef = db.collection("users").doc(state.currentUser.uid);
    const payload = partial || {
        tags: state.tagsMap,
        privateBookmarks: state.privateBookmarks,
        aiMetadata: state.aiMetadata,
        customCategories: state.customCategories
    };
    await userRef.set(payload, { merge: true });
}

function mergeBookmarkArrays(a, b) {
    const map = new Map();
    [...a, ...b].forEach((item) => {
        map.set(`${item.url}::${item.title}`, item);
    });
    return [...map.values()];
}

function unique(items) {
    return [...new Set(items)];
}
