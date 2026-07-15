// ============================================================
// DAINIKSTATE.COM NEWS SCRAPER
// ============================================================
// Automatically scrapes news from dainikstate.com and stores in DB
// Updates every 30 minutes
// ============================================================

module.exports = function(app, db, usersCol) {
  const axios = require('axios');
  const cheerio = require('cheerio');
  let newsCol;

  async function connectDB_news() {
    newsCol = db.collection('news');
    newsCol.createIndex({ url: 1 }, { unique: true }).catch(()=>{});
    newsCol.createIndex({ publishedAt: -1 }).catch(()=>{});
    newsCol.createIndex({ category: 1 }).catch(()=>{});
    console.log('📰 News scraper initialized!');
  }

  // Scrape homepage to get article URLs
  async function scrapeArticleList() {
    try {
      const { data } = await axios.get('https://dainikstate.com/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 30000,
      });
      const $ = cheerio.load(data);
      const articles = [];
      // Find all article links - DainikState uses /NNNNN/ pattern
      $('a[href*="dainikstate.com/"]').each((i, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        // Match pattern: https://dainikstate.com/NNNNN/ or relative /NNNNN/
        const match = href.match(/dainikstate\.com\/(\d{5,7})\/?$/);
        if (match) {
          const url = href.startsWith('http') ? href : `https://dainikstate.com/${match[1]}/`;
          const title = $(el).text().trim();
          if (title.length > 15 && title.length < 300) {
            articles.push({ url, title, slug: match[1] });
          }
        }
      });
      // Dedupe
      const unique = Array.from(new Map(articles.map(a => [a.url, a])).values());
      return unique;
    } catch (e) {
      console.error('Article list scrape error:', e.message);
      return [];
    }
  }

  // Scrape individual article details
  async function scrapeArticleDetails(url, fallbackTitle = '') {
    try {
      const { data } = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000,
      });
      const $ = cheerio.load(data);

      // Extract from Open Graph meta tags (most reliable)
      const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text() || fallbackTitle;
      const ogDescription = $('meta[property="og:description"]').attr('content') || '';
      const ogImage = $('meta[property="og:image"]').attr('content') || '';
      const ogUrl = $('meta[property="og:url"]').attr('content') || url;

      // Extract article body from common WordPress patterns
      let content = '';
      const contentSelectors = [
        '.entry-content', '.post-content', 'article .content',
        '.article-body', '.news-content', 'article p', '.post p'
      ];
      for (const sel of contentSelectors) {
        const el = $(sel).first();
        if (el.length) {
          el.find('p').each((i, p) => {
            const text = $(p).text().trim();
            if (text.length > 30) content += text + '\n\n';
          });
          if (content.length > 200) break;
        }
      }
      // If no content found, use description
      if (content.length < 100) {
        content = ogDescription;
      }

      // Extract publish date
      let publishedAt = Date.now();
      const dateSelectors = [
        'meta[property="article:published_time"]',
        'meta[property="og:article:published_time"]',
        'time[datetime]', '.post-date', '.entry-date',
        'meta[name="date"]'
      ];
      for (const sel of dateSelectors) {
        const val = $(sel).attr('content') || $(sel).attr('datetime') || $(sel).text();
        if (val) {
          const d = new Date(val);
          if (!isNaN(d.getTime())) { publishedAt = d.getTime(); break; }
        }
      }

      // Auto-detect category from URL/title
      const urlLower = url.toLowerCase();
      const titleLower = ogTitle.toLowerCase();
      let category = 'state';
      if (urlLower.includes('crime') || titleLower.includes('हत्या') || titleLower.includes('अपराध') || titleLower.includes('गिरफ्तार')) category = 'crime';
      else if (urlLower.includes('politics') || titleLower.includes('सरकार') || titleLower.includes('विधायक')) category = 'politics';
      else if (urlLower.includes('sport') || titleLower.includes('क्रिकेट') || titleLower.includes('खेल')) category = 'sports';
      else if (urlLower.includes('business') || titleLower.includes('बिजनेस') || titleLower.includes('कंपनी')) category = 'business';
      else if (urlLower.includes('bihar') || titleLower.includes('बिहार')) category = 'bihar';
      else if (urlLower.includes('ramgarh') || titleLower.includes('रामगढ़')) category = 'ramgarh';
      else if (urlLower.includes('ranchi') || titleLower.includes('रांची')) category = 'ranchi';

      // Extract slug from URL
      const slugMatch = url.match(/\/(\d{5,7})\/?$/);
      const slug = slugMatch ? slugMatch[1] : '';

      return {
        title: ogTitle.replace(/\s*\|\s*Dainik State\s*$/i, '').trim(),
        description: ogDescription,
        content: content.trim().slice(0, 5000),  // Limit to 5000 chars
        image: ogImage,
        url: ogUrl || url,
        slug,
        category,
        publishedAt,
        source: 'dainikstate.com',
        scrapedAt: Date.now(),
        views: 0,
        featured: false,
      };
    } catch (e) {
      console.error('Article scrape error for', url, ':', e.message);
      return null;
    }
  }

  // Main scrape function - fetches homepage + details
  async function scrapeNews() {
    if (!newsCol) return { success: false, error: 'DB not ready' };
    console.log('📰 Starting news scrape...');
    const articleList = await scrapeArticleList();
    console.log(`📰 Found ${articleList.length} article URLs`);
    let added = 0, updated = 0, failed = 0;
    for (const item of articleList) {
      // Check if exists
      const existing = await newsCol.findOne({ url: item.url });
      if (existing && (Date.now() - existing.scrapedAt) < 24 * 60 * 60 * 1000) {
        // Already scraped in last 24h - skip detailed scrape
        continue;
      }
      const details = await scrapeArticleDetails(item.url, item.title);
      if (!details) { failed++; continue; }
      try {
        await newsCol.updateOne(
          { url: details.url },
          { $set: { ...details, scrapedAt: Date.now() } },
          { upsert: true }
        );
        if (existing) updated++; else added++;
      } catch (e) {
        failed++;
      }
    }
    console.log(`📰 Scrape done: ${added} new, ${updated} updated, ${failed} failed`);
    return { success: true, added, updated, failed, total: articleList.length };
  }

  // API: Get news feed (with pagination)
  app.get('/api/news', async (req, res) => {
    if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
    const { category, search, limit, skip } = req.query;
    const query = {};
    if (category && category !== 'all') query.category = category;
    if (search) {
      const re = new RegExp(search, 'i');
      query.$or = [{ title: re }, { description: re }];
    }
    const lim = parseInt(limit) || 20;
    const sk = parseInt(skip) || 0;
    const articles = await newsCol.find(query).sort({ publishedAt: -1 }).skip(sk).limit(lim).toArray();
    const total = await newsCol.countDocuments(query);
    // Increment views (async, don't wait)
    if (articles.length > 0) {
      const ids = articles.map(a => a._id);
      newsCol.updateMany({ _id: { $in: ids } }, { $inc: { views: 1 } }).catch(()=>{});
    }
    res.json({
      success: true,
      total,
      count: articles.length,
      hasMore: sk + articles.length < total,
      articles: articles.map(a => { const { _id, ...r } = a; return r; })
    });
  });

  // API: Get breaking news (top 5) - MUST be before :slug route!
  app.get('/api/news/breaking', async (req, res) => {
    if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
    const articles = await newsCol.find({}).sort({ publishedAt: -1 }).limit(5).toArray();
    res.json({ success: true, articles: articles.map(a => { const { _id, ...r } = a; return r; }) });
  });

  // API: Get categories list (MUST be before :slug route!)
  app.get('/api/news/categories/list', async (req, res) => {
    if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
    const categories = await newsCol.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    res.json({ success: true, categories });
  });

  // API: Get single article (by slug or id) - MUST be LAST!
  app.get('/api/news/:slug', async (req, res) => {
    if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
    const { slug } = req.params;
    // First try by slug
    let article = await newsCol.findOne({ slug });
    // Then by id (for manual news)
    if (!article) article = await newsCol.findOne({ _id: slug });
    if (!article) return res.status(404).json({ error: 'Article not found' });
    newsCol.updateOne({ _id: article._id }, { $inc: { views: 1 } }).catch(()=>{});
    const { _id, ...result } = article;
    res.json({ success: true, article: result });
  });

  // API: Track view (separate from detail view to count unique views)
  app.post('/api/news/:id/view', async (req, res) => {
    try {
      if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
      const { id } = req.params;
      const { sessionId } = req.body;
      // Track unique view per session (avoid double-counting)
      if (sessionId) {
        const viewsCol = db.collection('newsViews');
        const existing = await viewsCol.findOne({ newsId: id, sessionId });
        if (existing) {
          return res.json({ success: true, unique: false });
        }
        await viewsCol.insertOne({ newsId: id, sessionId, viewedAt: Date.now() });
      }
      // Increment total view count
      const result = await newsCol.updateOne(
        { $or: [{ _id: id }, { id: id }, { slug: id }] },
        { $inc: { views: 1 } }
      );
      res.json({ success: true, unique: true, updated: result.modifiedCount });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // API: React to news (like/love/etc)
  app.post('/api/news/:id/react', async (req, res) => {
    try {
      if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
      const { id } = req.params;
      const { sessionId, reaction } = req.body;
      if (!sessionId || !reaction) return res.status(400).json({ error: 'sessionId, reaction required' });
      // Validate reaction type
      const validReactions = ['like', 'love', 'wow', 'sad', 'angry', 'laugh'];
      if (!validReactions.includes(reaction)) return res.status(400).json({ error: 'Invalid reaction type' });
      // Store reaction (one per session per article per type)
      const reactionsCol = db.collection('newsReactions');
      const existing = await reactionsCol.findOne({ newsId: id, sessionId, reaction });
      if (existing) {
        // Toggle off
        await reactionsCol.deleteOne({ _id: existing._id });
        await newsCol.updateOne(
          { $or: [{ _id: id }, { id: id }, { slug: id }] },
          { $inc: { [`reactions.${reaction}`]: -1 } }
        ).catch(()=>{});
        return res.json({ success: true, action: 'removed' });
      }
      // Add new reaction
      await reactionsCol.insertOne({ newsId: id, sessionId, reaction, createdAt: Date.now() });
      // Increment count
      await newsCol.updateOne(
        { $or: [{ _id: id }, { id: id }, { slug: id }] },
        { $inc: { [`reactions.${reaction}`]: 1 } }
      ).catch(()=>{});
      res.json({ success: true, action: 'added' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // API: Get news with full stats
  app.get('/api/news/stats/summary', async (req, res) => {
    try {
      if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
      const total = await newsCol.countDocuments();
      const last24h = await newsCol.countDocuments({ publishedAt: { $gte: Date.now() - 86400000 } });
      const categoryCounts = await newsCol.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray();
      const topViewed = await newsCol.find({}).sort({ views: -1 }).limit(5).toArray();
      res.json({
        success: true,
        total,
        last24h,
        categoryCounts,
        topViewed: topViewed.map(a => { const { _id, ...r } = a; return r; })
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // API: Manual scrape trigger (admin)
  app.post('/api/news/scrape', async (req, res) => {
    const { secret } = req.body;
    if (secret !== process.env.SCRAPE_SECRET && secret !== 'dainikstate-scrape-2025') {
      return res.status(403).json({ error: 'Invalid secret' });
    }
    const result = await scrapeNews();
    res.json(result);
  });

  // ============================================================
  // ADMIN-ONLY: Manual news add/edit/delete
  // Only the site owner can add news (PIN-protected via /api/admin)
  // ============================================================

  // Admin auth check (reuses the same PIN as /api/admin/login)
  const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
  function checkAdmin(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '');
    // Verify admin token by checking against the global adminToken from analytics.js
    // We use a simple shared secret: requires the request to have admin-token header
    // that matches what /api/admin/login returned. Since both modules share process,
    // we keep a static mapping.
    if (!global.__dsAdminTokens) global.__dsAdminTokens = new Set();
    if (!token || !global.__dsAdminTokens.has(token)) {
      return res.status(401).json({ error: 'Unauthorized - admin login required' });
    }
    next();
  }

  // Admin: Add news manually (only the site owner can do this)
  app.post('/api/news/admin/add', checkAdmin, async (req, res) => {
    try {
      if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
      const { title, description, content, image, url, category, featured, tags } = req.body;
      if (!title) return res.status(400).json({ error: 'Title required' });
      // Auto-generate slug from title or use timestamp
      const slug = 'manual_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const article = {
        _id: slug,
        id: slug,
        slug,
        title: String(title).trim(),
        description: String(description || '').trim().slice(0, 500),
        content: String(content || '').trim().slice(0, 10000),
        image: image || '',
        url: url || '',
        category: category || 'state',
        tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []),
        featured: featured === true || featured === 'true',
        publishedAt: Date.now(),
        scrapedAt: Date.now(),
        source: 'admin',
        addedBy: 'site-owner',
        views: 0,
      };
      await newsCol.insertOne(article);
      const { _id, ...result } = article;
      res.json({ success: true, article: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin: Update existing news
  app.put('/api/news/admin/:id', checkAdmin, async (req, res) => {
    try {
      if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
      const { title, description, content, image, url, category, featured, tags } = req.body;
      const updates = {};
      if (title !== undefined) updates.title = String(title).trim();
      if (description !== undefined) updates.description = String(description).trim().slice(0, 500);
      if (content !== undefined) updates.content = String(content).trim().slice(0, 10000);
      if (image !== undefined) updates.image = image;
      if (url !== undefined) updates.url = url;
      if (category !== undefined) updates.category = category;
      if (featured !== undefined) updates.featured = featured === true || featured === 'true';
      if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []);
      updates.editedAt = Date.now();
      const result = await newsCol.updateOne(
        { $or: [{ _id: req.params.id }, { id: req.params.id }, { slug: req.params.id }] },
        { $set: updates }
      );
      if (result.matchedCount === 0) return res.status(404).json({ error: 'News not found' });
      res.json({ success: true, modified: result.modifiedCount });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin: Delete news
  app.delete('/api/news/admin/:id', checkAdmin, async (req, res) => {
    try {
      if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
      const result = await newsCol.deleteOne({
        $or: [{ _id: req.params.id }, { id: req.params.id }, { slug: req.params.id }]
      });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'News not found' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin: Get all news (with full data for editing)
  app.get('/api/news/admin/list', checkAdmin, async (req, res) => {
    try {
      if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
      const articles = await newsCol.find({}).sort({ publishedAt: -1 }).limit(200).toArray();
      res.json({
        success: true,
        count: articles.length,
        articles: articles.map(a => { const { _id, ...r } = a; return r; })
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Initialize
  connectDB_news().then(() => {
    // Auto-scrape on startup + every 30 minutes
    setTimeout(() => scrapeNews().catch(e => console.error('Initial scrape error:', e.message)), 5000);
    setInterval(() => scrapeNews().catch(e => console.error('Scheduled scrape error:', e.message)), 30 * 60 * 1000);
  }).catch(e => console.error('News init error:', e.message));
};
