const GhostAdminAPI = require('@tryghost/admin-api');

const REQUIRED_ENV = [
    'PROD_GHOST_URL',
    'PROD_GHOST_KEY',
    'STAGING_GHOST_URL',
    'STAGING_GHOST_KEY',
];

for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const prodApi = new GhostAdminAPI({
    url: process.env.PROD_GHOST_URL,
    key: process.env.PROD_GHOST_KEY,
    version: 'v5.0',
});

const stagingApi = new GhostAdminAPI({
    url: process.env.STAGING_GHOST_URL,
    key: process.env.STAGING_GHOST_KEY,
    version: 'v5.0',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAllPosts(api) {
    const allPosts = [];
    let page = 1;

    while (true) {
        const result = await api.posts.browse({
            limit: 15,
            page,
            filter: 'status:[published,draft]',
            formats: 'lexical,mobiledoc',
            include: 'tags',
        });

        allPosts.push(...result);

        if (!result.meta.pagination.next) break;
        page = result.meta.pagination.next;
        await sleep(50);
    }

    return allPosts;
}

async function fetchStagingSlugs() {
    const slugs = new Set();
    let page = 1;

    while (true) {
        const result = await stagingApi.posts.browse({
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

async function main() {
    console.log('Starting content sync from production to staging...\n');

    const prodPosts = await fetchAllPosts(prodApi);
    console.log(`Found ${prodPosts.length} posts on production`);

    const stagingSlugs = await fetchStagingSlugs();
    console.log(`Found ${stagingSlugs.size} posts on staging\n`);

    const stats = { created: 0, skipped: 0, errors: 0 };

    for (const post of prodPosts) {
        if (stagingSlugs.has(post.slug)) {
            console.log(`  SKIP: "${post.title}" (${post.slug})`);
            stats.skipped++;
            continue;
        }

        const postData = {
            title: post.title,
            slug: post.slug,
            status: post.status,
            feature_image: post.feature_image,
            feature_image_alt: post.feature_image_alt,
            feature_image_caption: post.feature_image_caption,
            custom_excerpt: post.custom_excerpt,
            meta_title: post.meta_title,
            meta_description: post.meta_description,
            og_image: post.og_image,
            og_title: post.og_title,
            og_description: post.og_description,
            twitter_image: post.twitter_image,
            twitter_title: post.twitter_title,
            twitter_description: post.twitter_description,
            canonical_url: post.canonical_url,
            published_at: post.published_at,
            tags: post.tags ? post.tags.map((t) => ({ name: t.name })) : [],
        };

        if (post.lexical) {
            postData.lexical = post.lexical;
        } else if (post.mobiledoc) {
            postData.mobiledoc = post.mobiledoc;
        } else {
            console.warn(`  WARN: "${post.title}" has no content, skipping`);
            stats.errors++;
            continue;
        }

        try {
            await stagingApi.posts.add(postData);
            console.log(`  CREATE: "${post.title}" (${post.slug})`);
            stats.created++;
        } catch (err) {
            console.error(`  ERROR: "${post.title}" (${post.slug}): ${err.message}`);
            stats.errors++;
        }

        await sleep(100);
    }

    console.log('\nSync complete.');
    console.log(`  Created: ${stats.created}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  Errors:  ${stats.errors}`);

    if (stats.errors > 0) process.exit(1);
}

main().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
