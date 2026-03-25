export async function analyzeBookmarksWithGemini(state, bookmarksList, onProgress) {
    if (!state.apiKey) {
        throw new Error('No Gemini API key configured.');
    }

    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < bookmarksList.length; i += BATCH_SIZE) {
        batches.push(bookmarksList.slice(i, i + BATCH_SIZE));
    }

    let processedCount = 0;

    for (const batch of batches) {
        processedCount += batch.length;
        onProgress(`Processing ${processedCount}/${bookmarksList.length}...`);

        const existingCategories = new Set([...state.customCategories]);
        Object.values(state.aiMetadata).forEach((meta) => {
            if (meta.category) existingCategories.add(meta.category);
        });
        const existingCategoriesList = Array.from(existingCategories).sort().join(', ');

        const prompt = `
Analyze the following bookmarks and categorize them intelligently. For each bookmark:
1. Assign ONE specific, meaningful category that best describes its content
2. Generate 2 relevant tags

EXISTING CATEGORIES:
${existingCategoriesList || 'None yet'}

Return ONLY a JSON object where keys are bookmark URLs and values are { "category": "...", "tags": ["...", "..."] }.

Bookmarks:
${batch.map((b) => `- ${b.url} (${b.title})`).join('\n')}
        `;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${state.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(`Gemini Error: ${data.error.message} (Code: ${data.error.code})`);
            }

            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) {
                throw new Error('Gemini returned an empty response.');
            }

            const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
            const result = JSON.parse(jsonStr);
            state.aiMetadata = { ...state.aiMetadata, ...result };
        } catch (error) {
            console.error('Batch failed', error);
        }
    }
}
