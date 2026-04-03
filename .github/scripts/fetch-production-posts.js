const fs = require('fs');
const GhostAdminAPI = require('@tryghost/admin-api');

const REQUIRED_ENV = ['GHOST_ADMIN_API_URL', 'GHOST_ADMIN_API_KEY'];

for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const api = new GhostAdminAPI({
    url: process.env.GHOST_ADMIN_API_URL,
    key: process.env.GHOST_ADMIN_API_KEY,
    version: 'v5.0',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setOutput(name, value) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
    console.log('Fetching all posts from production...\n');

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

    console.log(`Fetched ${allPosts.length} posts from production`);

    // Compare current slugs against cached slugs from last run
    const currentSlugs = allPosts.map((p) => p.slug).sort();
    const currentSlugsJson = JSON.stringify(currentSlugs);

    let hasNewPosts = true;
    const forceSync = process.env.FORCE_SYNC === 'true';
    const cacheFile = 'cached-production-slugs.json';

    if (forceSync) {
        console.log('\nForce sync enabled — skipping cache check.');
    } else if (fs.existsSync(cacheFile)) {
        const cachedSlugsJson = fs.readFileSync(cacheFile, 'utf-8');
        if (cachedSlugsJson === currentSlugsJson) {
            console.log('\nNo new posts since last run — skipping sync.');
            hasNewPosts = false;
        } else {
            const cachedSlugs = new Set(JSON.parse(cachedSlugsJson));
            const newSlugs = currentSlugs.filter((s) => !cachedSlugs.has(s));
            console.log(`\nNew posts detected: ${newSlugs.join(', ')}`);
        }
    } else {
        console.log('\nNo cache found — first run, will sync all posts.');
    }

    // Always update the cache with current slugs
    fs.writeFileSync(cacheFile, currentSlugsJson);

    setOutput('has_new_posts', hasNewPosts ? 'true' : 'false');

    if (!hasNewPosts) return;

    // Write full post data for the push-to-staging job
    const posts = allPosts.map((post) => ({
        title: post.title,
        slug: post.slug,
        status: post.status,
        lexical: post.lexical || null,
        mobiledoc: post.mobiledoc || null,
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
        tags: post.tags ? post.tags.map((t) => t.name) : [],
    }));

    fs.writeFileSync('production-posts.json', JSON.stringify(posts, null, 2));
    console.log('Saved to production-posts.json');
}

main().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
