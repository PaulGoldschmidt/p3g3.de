const fs = require('fs');
const GhostAdminAPI = require('@tryghost/admin-api');
const OpenAI = require('openai');

const REQUIRED_ENV = ['GHOST_ADMIN_API_URL', 'GHOST_ADMIN_API_KEY', 'OPENAI_API_KEY'];

for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const ghost = new GhostAdminAPI({
    url: process.env.GHOST_ADMIN_API_URL,
    key: process.env.GHOST_ADMIN_API_KEY,
    version: 'v5.0',
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const SOURCE_TAG_PREFIX = '#source:';
const SKIP_NODE_TYPES = new Set(['codeblock', 'code']);
const TEXT_NODE_TYPES = new Set(['text', 'extended-text']);

// --- Lexical tree walking ---

function walkLexical(node, callback) {
    if (!node || typeof node !== 'object') return;
    if (SKIP_NODE_TYPES.has(node.type)) return;

    if (TEXT_NODE_TYPES.has(node.type) && typeof node.text === 'string' && node.text.trim()) {
        callback(node, 'text');
    }

    if (typeof node.alt === 'string' && node.alt.trim()) {
        callback(node, 'alt');
    }
    if (typeof node.caption === 'string' && node.caption.trim()) {
        callback(node, 'caption');
    }

    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            walkLexical(child, callback);
        }
    }
}

// --- Mobiledoc tree walking ---
// Mobiledoc sections: [1, tag, markers] = markup, [3, tag, items] = list, [10, cardIdx] = card
// Markers: [0, openMarkups, closeCount, text] = text marker, [1, ...] = atom marker

function walkMobiledocMarkers(markers, callback) {
    for (const marker of markers) {
        if (marker[0] === 0 && typeof marker[3] === 'string' && marker[3].trim()) {
            callback(marker, 3);
        }
    }
}

function walkMobiledocCard(payload, callback) {
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.alt === 'string' && payload.alt.trim()) {
        callback(payload, 'alt');
    }
    if (typeof payload.caption === 'string' && payload.caption.trim()) {
        callback(payload, 'caption');
    }
}

function walkMobiledoc(mobiledoc, callback) {
    const { sections, cards } = mobiledoc;
    if (!Array.isArray(sections)) return;

    for (const section of sections) {
        const type = section[0];
        if (type === 1) {
            // Markup section: [1, tagName, markers]
            walkMobiledocMarkers(section[2] || [], callback);
        } else if (type === 3) {
            // List section: [3, tagName, items], each item is an array of markers
            for (const item of section[2] || []) {
                walkMobiledocMarkers(item, callback);
            }
        } else if (type === 10) {
            // Card section: [10, cardIndex]
            const card = cards && cards[section[1]];
            if (card) {
                walkMobiledocCard(card[1], callback);
            }
        }
    }
}

function collectTranslatableStrings(post) {
    const texts = [];

    const metaFields = [
        'title', 'custom_excerpt', 'meta_title', 'meta_description',
        'og_title', 'og_description', 'twitter_title', 'twitter_description',
        'feature_image_alt', 'feature_image_caption',
    ];

    for (const field of metaFields) {
        if (post[field] && post[field].trim()) {
            texts.push(post[field]);
        }
    }

    // Slug (translated separately, slugified after)
    texts.push(post.slug);

    for (const tag of post.tags) {
        texts.push(tag);
    }

    if (post.lexical) {
        const lexical = JSON.parse(post.lexical);
        walkLexical(lexical.root, (obj, key) => {
            texts.push(obj[key]);
        });
    } else if (post.mobiledoc) {
        const mobiledoc = JSON.parse(post.mobiledoc);
        walkMobiledoc(mobiledoc, (obj, key) => {
            texts.push(obj[key]);
        });
    }

    return texts;
}

function applyTranslations(post, translations) {
    let idx = 0;

    const metaFields = [
        'title', 'custom_excerpt', 'meta_title', 'meta_description',
        'og_title', 'og_description', 'twitter_title', 'twitter_description',
        'feature_image_alt', 'feature_image_caption',
    ];

    for (const field of metaFields) {
        if (post[field] && post[field].trim()) {
            post[field] = translations[idx++];
        }
    }

    // Slug — slugify the translated result
    post.slug = slugify(translations[idx++]);

    for (let i = 0; i < post.tags.length; i++) {
        post.tags[i] = translations[idx++];
    }

    if (post.lexical) {
        const lexical = JSON.parse(post.lexical);
        walkLexical(lexical.root, (obj, key) => {
            obj[key] = translations[idx++];
        });
        post.lexical = JSON.stringify(lexical);
    } else if (post.mobiledoc) {
        const mobiledoc = JSON.parse(post.mobiledoc);
        walkMobiledoc(mobiledoc, (obj, key) => {
            obj[key] = translations[idx++];
        });
        post.mobiledoc = JSON.stringify(mobiledoc);
    }

    if (idx !== translations.length) {
        throw new Error(`Translation alignment error: used ${idx} of ${translations.length}`);
    }

    return post;
}

// --- OpenAI translation ---

async function translateStrings(texts, postTitle) {
    const response = await openai.chat.completions.create({
        model: 'gpt-5.4-2026-03-05',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages: [
            {
                role: 'system',
                content: `You are a professional translator specializing in blog content. Translate the following texts from German to English. Return a JSON object with a single key "translations" containing an array of translated strings, in the exact same order as the input array. Rules:
- Preserve any HTML tags within strings exactly as they are.
- Do not add, remove, or reorder any entries.
- Keep proper nouns, brand names, and technical terms as-is when appropriate.
- Maintain the tone and style of a personal blog.
- The array must have exactly ${texts.length} elements.`,
            },
            {
                role: 'user',
                content: JSON.stringify({ texts }),
            },
        ],
    });

    const parsed = JSON.parse(response.choices[0].message.content);

    if (!Array.isArray(parsed.translations) || parsed.translations.length !== texts.length) {
        throw new Error(
            `Translation count mismatch for "${postTitle}": expected ${texts.length}, got ${parsed.translations?.length ?? 'undefined'}`
        );
    }

    return parsed.translations;
}

// --- Ghost API ---

async function fetchSyncedSlugs() {
    const syncedSlugs = new Set();
    let page = 1;

    while (true) {
        const result = await ghost.posts.browse({
            limit: 15,
            page,
            filter: 'status:[published,draft]',
            include: 'tags',
        });

        for (const post of result) {
            if (!post.tags) continue;
            for (const tag of post.tags) {
                if (tag.name.startsWith(SOURCE_TAG_PREFIX)) {
                    syncedSlugs.add(tag.name.slice(SOURCE_TAG_PREFIX.length));
                }
            }
        }

        if (!result.meta.pagination.next) break;
        page = result.meta.pagination.next;
        await sleep(50);
    }

    return syncedSlugs;
}

// --- Main ---

async function main() {
    const prodPosts = JSON.parse(fs.readFileSync('production-posts.json', 'utf-8'));
    console.log(`Loaded ${prodPosts.length} production posts\n`);

    const syncedSlugs = await fetchSyncedSlugs();
    console.log(`Found ${syncedSlugs.size} already-synced posts on English instance\n`);

    const stats = { created: 0, skipped: 0, translationErrors: 0, pushErrors: 0 };

    for (const post of prodPosts) {
        if (syncedSlugs.has(post.slug)) {
            console.log(`  SKIP: "${post.title}" (${post.slug})`);
            stats.skipped++;
            continue;
        }

        if (!post.lexical && !post.mobiledoc) {
            console.warn(`  WARN: "${post.title}" (${post.slug}) has no content — skipping`);
            stats.pushErrors++;
            continue;
        }

        const texts = collectTranslatableStrings(post);

        if (texts.length === 0) {
            console.warn(`  WARN: "${post.title}" has no translatable text — pushing as-is`);
        }

        let translations;
        if (texts.length > 0) {
            try {
                translations = await translateStrings(texts, post.title);
                console.log(`  TRANSLATED: "${post.title}" (${texts.length} strings)`);
            } catch (err) {
                console.error(`  ERROR translating "${post.title}": ${err.message}`);
                stats.translationErrors++;
                continue;
            }
        }

        let translatedPost = { ...post };
        if (translations) {
            try {
                translatedPost = applyTranslations({ ...post }, translations);
            } catch (err) {
                console.error(`  ERROR applying translations for "${post.title}": ${err.message}`);
                stats.translationErrors++;
                continue;
            }
        }

        const postData = {
            title: translatedPost.title,
            slug: translatedPost.slug,
            status: translatedPost.status,
            feature_image: translatedPost.feature_image,
            feature_image_alt: translatedPost.feature_image_alt,
            feature_image_caption: translatedPost.feature_image_caption,
            custom_excerpt: translatedPost.custom_excerpt,
            meta_title: translatedPost.meta_title,
            meta_description: translatedPost.meta_description,
            og_image: translatedPost.og_image,
            og_title: translatedPost.og_title,
            og_description: translatedPost.og_description,
            twitter_image: translatedPost.twitter_image,
            twitter_title: translatedPost.twitter_title,
            twitter_description: translatedPost.twitter_description,
            canonical_url: translatedPost.canonical_url,
            published_at: translatedPost.published_at,
            tags: [
                { name: SOURCE_TAG_PREFIX + post.slug },
                ...translatedPost.tags.map((name) => ({ name })),
            ],
        };

        if (translatedPost.lexical) {
            postData.lexical = translatedPost.lexical;
        } else if (translatedPost.mobiledoc) {
            postData.mobiledoc = translatedPost.mobiledoc;
        }

        try {
            await ghost.posts.add(postData);
            console.log(`  CREATE: "${translatedPost.title}" (${translatedPost.slug})`);
            stats.created++;
        } catch (err) {
            console.error(`  ERROR creating "${translatedPost.title}" (${translatedPost.slug}): ${err.message}`);
            stats.pushErrors++;
        }

        await sleep(500);
    }

    console.log('\nTranslation sync complete.');
    console.log(`  Created:            ${stats.created}`);
    console.log(`  Skipped (existing): ${stats.skipped}`);
    console.log(`  Translation errors: ${stats.translationErrors}`);
    console.log(`  Push errors:        ${stats.pushErrors}`);

    if (stats.translationErrors > 0 || stats.pushErrors > 0) process.exit(1);
}

main().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
