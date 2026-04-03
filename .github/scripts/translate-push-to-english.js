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

const SKIP_NODE_TYPES = new Set(['codeblock', 'code']);

// --- Lexical tree walking ---

function walkLexical(node, callback) {
    if (!node || typeof node !== 'object') return;
    if (SKIP_NODE_TYPES.has(node.type)) return;

    if (node.type === 'text' && typeof node.text === 'string' && node.text.trim()) {
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

    for (const tag of post.tags) {
        texts.push(tag);
    }

    if (post.lexical) {
        const lexical = JSON.parse(post.lexical);
        walkLexical(lexical.root, (node, field) => {
            texts.push(node[field]);
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

    for (let i = 0; i < post.tags.length; i++) {
        post.tags[i] = translations[idx++];
    }

    if (post.lexical) {
        const lexical = JSON.parse(post.lexical);
        walkLexical(lexical.root, (node, field) => {
            node[field] = translations[idx++];
        });
        post.lexical = JSON.stringify(lexical);
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

async function fetchEnglishSlugs() {
    const slugs = new Set();
    let page = 1;

    while (true) {
        const result = await ghost.posts.browse({
            limit: 15,
            page,
            filter: 'status:[published,draft]',
            fields: 'slug',
        });

        for (const post of result) {
            slugs.add(post.slug);
        }

        if (!result.meta.pagination.next) break;
        page = result.meta.pagination.next;
        await sleep(50);
    }

    return slugs;
}

// --- Main ---

async function main() {
    const prodPosts = JSON.parse(fs.readFileSync('production-posts.json', 'utf-8'));
    console.log(`Loaded ${prodPosts.length} production posts\n`);

    const englishSlugs = await fetchEnglishSlugs();
    console.log(`Found ${englishSlugs.size} existing posts on English instance\n`);

    const stats = { created: 0, skipped: 0, skippedMobiledoc: 0, translationErrors: 0, pushErrors: 0 };

    for (const post of prodPosts) {
        if (englishSlugs.has(post.slug)) {
            console.log(`  SKIP: "${post.title}" (${post.slug})`);
            stats.skipped++;
            continue;
        }

        if (!post.lexical) {
            if (post.mobiledoc) {
                console.warn(`  WARN: "${post.title}" (${post.slug}) uses mobiledoc — skipping`);
                stats.skippedMobiledoc++;
            } else {
                console.warn(`  WARN: "${post.title}" (${post.slug}) has no content — skipping`);
                stats.pushErrors++;
            }
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
            lexical: translatedPost.lexical,
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
            tags: translatedPost.tags.map((name) => ({ name })),
        };

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
    console.log(`  Created:             ${stats.created}`);
    console.log(`  Skipped (existing):  ${stats.skipped}`);
    console.log(`  Skipped (mobiledoc): ${stats.skippedMobiledoc}`);
    console.log(`  Translation errors:  ${stats.translationErrors}`);
    console.log(`  Push errors:         ${stats.pushErrors}`);

    if (stats.translationErrors > 0 || stats.pushErrors > 0) process.exit(1);
}

main().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
