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

  // API: Get single article
  app.get('/api/news/:slug', async (req, res) => {
    if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
    const article = await newsCol.findOne({ slug: req.params.slug });
    if (!article) return res.status(404).json({ error: 'Article not found' });
    newsCol.updateOne({ _id: article._id }, { $inc: { views: 1 } }).catch(()=>{});
    const { _id, ...result } = article;
    res.json({ success: true, article: result });
  });

  // API: Get categories with counts
  app.get('/api/news/categories/list', async (req, res) => {
    if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
    const categories = await newsCol.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    res.json({ success: true, categories });
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

  // API: Get breaking news (top 5)
  app.get('/api/news/breaking', async (req, res) => {
    if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
    const articles = await newsCol.find({}).sort({ publishedAt: -1 }).limit(5).toArray();
    res.json({ success: true, articles: articles.map(a => { const { _id, ...r } = a; return r; }) });
  });

  // Initialize
  connectDB_news().then(() => {
    // Auto-scrape on startup + every 30 minutes
    setTimeout(() => scrapeNews().catch(e => console.error('Initial scrape error:', e.message)), 5000);
    setInterval(() => scrapeNews().catch(e => console.error('Scheduled scrape error:', e.message)), 30 * 60 * 1000);
  }).catch(e => console.error('News init error:', e.message));
};
