// Basic listener to log installation
chrome.runtime.onInstalled.addListener(() => {
    console.log("Bookify Extension Installed");
});

// --- AUTO-ANALYSIS: Listen for New Bookmarks ---
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
    // Only analyze if bookmark has a URL (not a folder)
    if (!bookmark.url) return;

    // Check if API key exists
    const { gemini_api_key } = await chrome.storage.local.get(['gemini_api_key']);

    if (!gemini_api_key) {
        console.log('⚠️ No API key found. Skipping auto-analysis.');
        return;
    }

    console.log('🤖 Auto-analyzing new bookmark:', bookmark.title);

    // Analyze this single bookmark
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${gemini_api_key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Analyze this bookmark and return ONLY a JSON object with "category" (single word like Development, News, Entertainment, Shopping, Social, Finance, Travel) and "tags" (array of 2 relevant tags). No explanation, just JSON.

Bookmark URL: ${bookmark.url}
Bookmark Title: ${bookmark.title}

Format: {"category": "CategoryName", "tags": ["tag1", "tag2"]}`
                    }]
                }]
            })
        });

        const data = await response.json();
        if (data.error) {
            console.error('❌ AI Analysis error:', data.error.message);
            return;
        }

        const text = data.candidates[0].content.parts[0].text;
        // Extract JSON from markdown code block if present
        const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
        const result = JSON.parse(jsonStr);

        console.log('✅ Auto-analyzed:', bookmark.title, '→', result);

        // Store locally - will be synced to Firestore by popup
        const { aiMetadata_local } = await chrome.storage.local.get(['aiMetadata_local']);
        const metadata = aiMetadata_local || {};
        metadata[bookmark.url] = result;

        await chrome.storage.local.set({ aiMetadata_local: metadata });
        console.log('💾 Saved locally. Will sync to Firestore when popup opens.');

    } catch (error) {
        console.error('❌ Auto-analysis failed:', error);
    }
});

// --- KEYBOARD SHORTCUT (optional) ---
// Note: Chrome owns the actual key combo. Users can change it in chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-bookify-popup') return;

    chrome.storage.local.get(['shortcut_enabled'], (result) => {
        const enabled = result.shortcut_enabled !== false; // default true
        if (!enabled) return;

        // We can open the popup; closing isn't controllable via commands.
        chrome.action.openPopup();
    });
});
