// ============================================================
// DAINIKSTATE TV CHANNELS - Admin-controlled
// ============================================================
// Admin creates/curates TV Channels. Each channel has a custom
// playlist of news items (filtered from scraped newsCol).
// ============================================================

module.exports = function(app, db, usersCol) {
  const crypto = require('crypto');
  let tvChannelsCol, newsCol;

  async function connectDB_tv() {
    tvChannelsCol = db.collection('tvChannels');
    newsCol = db.collection('news');
    await tvChannelsCol.createIndex({ id: 1 }, { unique: true });
    await tvChannelsCol.createIndex({ createdAt: -1 });
    await tvChannelsCol.createIndex({ order: 1 });
    console.log('📺 TV Channels module initialized!');
  }

  // ============================================================
  // ADMIN AUTH (uses shared global __dsAdminTokens)
  // ============================================================
  function requireAdmin(req, res, next) {
    // Try multiple token locations (in order of preference)
    let token = req.headers['x-admin-token']
             || req.body?.adminToken
             || req.query?.adminToken;
    // Support Authorization: Bearer <token> (used by adminFetch)
    if (!token && req.headers['authorization']) {
      token = req.headers['authorization'].replace(/^Bearer\s+/i, '').trim();
    }
    if (!global.__dsAdminTokens) global.__dsAdminTokens = new Set();
    if (!token || !global.__dsAdminTokens.has(token)) {
      return res.status(401).json({ error: 'Admin token required. Login first via /api/admin/login with PIN 1234' });
    }
    next();
  }

  // ============================================================
  // PUBLIC: List all active TV channels
  // GET /api/tv-channels
  // ============================================================
  app.get('/api/tv-channels', async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const channels = await tvChannelsCol.find({ active: { $ne: false } })
        .sort({ order: 1, createdAt: -1 })
        .toArray();
      // For each channel, hydrate with current news items
      const result = [];
      for (const ch of channels) {
        let items = [];
        if (ch.itemIds && ch.itemIds.length > 0) {
          // Fetch selected news by ID
          const news = await newsCol.find({
            url: { $in: ch.itemIds }
          }).toArray();
          // Preserve order
          const newsMap = {};
          news.forEach(n => { newsMap[n.url] = n; });
          items = ch.itemIds.map(url => newsMap[url]).filter(Boolean);
        }
        // Filter out items without videoUrl (TV needs video)
        items = items.filter(it => it.videoUrl || it.youtubeUrl || it.vimeoUrl || it.mp4Url || it.hlsUrl);
        const { _id, ...rest } = ch;
        result.push({ ...rest, items, itemCount: items.length });
      }
      res.json({ success: true, count: result.length, channels: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // PUBLIC: Get a single TV channel by ID
  // GET /api/tv-channels/:id
  // ============================================================
  app.get('/api/tv-channels/:id', async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const ch = await tvChannelsCol.findOne({ id: req.params.id });
      if (!ch) return res.status(404).json({ error: 'TV Channel not found' });
      // Hydrate items
      let items = [];
      if (ch.itemIds && ch.itemIds.length > 0) {
        const news = await newsCol.find({ url: { $in: ch.itemIds } }).toArray();
        const newsMap = {};
        news.forEach(n => { newsMap[n.url] = n; });
        items = ch.itemIds.map(url => newsMap[url]).filter(Boolean);
      }
      items = items.filter(it => it.videoUrl || it.youtubeUrl || it.vimeoUrl || it.mp4Url || it.hlsUrl);
      const { _id, ...rest } = ch;
      res.json({ success: true, channel: { ...rest, items, itemCount: items.length } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ADMIN: List ALL TV channels (active + inactive)
  // GET /api/tv-channels/admin/list
  // ============================================================
  app.get('/api/tv-channels/admin/list', requireAdmin, async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const channels = await tvChannelsCol.find({})
        .sort({ order: 1, createdAt: -1 })
        .toArray();
      // For admin: include item details (which ones still exist)
      const result = [];
      for (const ch of channels) {
        let existingCount = 0;
        if (ch.itemIds && ch.itemIds.length > 0) {
          existingCount = await newsCol.countDocuments({
            url: { $in: ch.itemIds },
            $or: [
              { videoUrl: { $exists: true, $ne: '' } },
              { youtubeUrl: { $exists: true, $ne: '' } },
              { vimeoUrl: { $exists: true, $ne: '' } },
              { mp4Url: { $exists: true, $ne: '' } },
              { hlsUrl: { $exists: true, $ne: '' } },
            ]
          });
        }
        const { _id, ...rest } = ch;
        result.push({ ...rest, existingItemCount: existingCount });
      }
      res.json({ success: true, count: result.length, channels: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ADMIN: Create new TV channel
  // POST /api/tv-channels/admin/create
  // Body: { name, description, icon, color, itemIds: [url1, url2...], active, order }
  // ============================================================
  app.post('/api/tv-channels/admin/create', requireAdmin, async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const { name, description, icon, color, itemIds, active, order, autoplay, loop, schedule } = req.body;
      if (!name) return res.status(400).json({ error: 'name required' });
      const channelId = 'tvc_' + crypto.randomBytes(6).toString('hex');
      const channel = {
        _id: channelId,
        id: channelId,
        name,
        description: description || '',
        icon: icon || '📺',
        color: color || '#dc2626',
        itemIds: itemIds || [],
        active: active !== false,
        autoplay: autoplay !== false,
        loop: loop !== false,
        order: order || 0,
        schedule: schedule || null,  // optional: { startHour, endHour, days: [0,1,2,3,4,5,6] }
        playCount: 0,
        viewCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'admin',
      };
      await tvChannelsCol.insertOne(channel);
      const { _id, ...result } = channel;
      res.json({ success: true, channel: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ADMIN: Update TV channel
  // PUT /api/tv-channels/admin/:id
  // ============================================================
  app.put('/api/tv-channels/admin/:id', requireAdmin, async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const channel = await tvChannelsCol.findOne({ id: req.params.id });
      if (!channel) return res.status(404).json({ error: 'TV Channel not found' });
      const allowed = ['name', 'description', 'icon', 'color', 'itemIds', 'active', 'autoplay', 'loop', 'order', 'schedule'];
      const update = { updatedAt: Date.now() };
      for (const k of allowed) {
        if (req.body[k] !== undefined) update[k] = req.body[k];
      }
      await tvChannelsCol.updateOne({ id: req.params.id }, { $set: update });
      const updated = await tvChannelsCol.findOne({ id: req.params.id });
      const { _id, ...result } = updated;
      res.json({ success: true, channel: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ADMIN: Delete TV channel
  // DELETE /api/tv-channels/admin/:id
  // ============================================================
  app.delete('/api/tv-channels/admin/:id', requireAdmin, async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const channel = await tvChannelsCol.findOne({ id: req.params.id });
      if (!channel) return res.status(404).json({ error: 'TV Channel not found' });
      await tvChannelsCol.deleteOne({ id: req.params.id });
      res.json({ success: true, deleted: req.params.id, name: channel.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ADMIN: Reorder channels
  // POST /api/tv-channels/admin/reorder
  // Body: { order: ['tvc_aaa', 'tvc_bbb', 'tvc_ccc'] }
  // ============================================================
  app.post('/api/tv-channels/admin/reorder', requireAdmin, async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of channel IDs' });
      let i = 0;
      for (const id of order) {
        await tvChannelsCol.updateOne({ id }, { $set: { order: i++ } });
      }
      res.json({ success: true, reordered: order.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ADMIN: Toggle active/inactive
  // POST /api/tv-channels/admin/:id/toggle
  // ============================================================
  app.post('/api/tv-channels/admin/:id/toggle', requireAdmin, async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const channel = await tvChannelsCol.findOne({ id: req.params.id });
      if (!channel) return res.status(404).json({ error: 'TV Channel not found' });
      const newActive = !channel.active;
      await tvChannelsCol.updateOne({ id: req.params.id }, { $set: { active: newActive, updatedAt: Date.now() } });
      res.json({ success: true, active: newActive });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // PUBLIC: Increment view count (called when user opens channel)
  // POST /api/tv-channels/:id/view
  // ============================================================
  app.post('/api/tv-channels/:id/view', async (req, res) => {
    if (!tvChannelsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      await tvChannelsCol.updateOne({ id: req.params.id }, { $inc: { viewCount: 1 } });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ADMIN: Search news items with video to add to channel
  // GET /api/tv-channels/admin/search-news?q=keyword&limit=20
  // ============================================================
  app.get('/api/tv-channels/admin/search-news', requireAdmin, async (req, res) => {
    if (!newsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const { q, limit, source } = req.query;
      const query = {
        $or: [
          { videoUrl: { $exists: true, $ne: '' } },
          { youtubeUrl: { $exists: true, $ne: '' } },
          { vimeoUrl: { $exists: true, $ne: '' } },
          { mp4Url: { $exists: true, $ne: '' } },
          { hlsUrl: { $exists: true, $ne: '' } },
        ],
      };
      if (q) {
        query.$and = [
          { $or: [
            { title: { $regex: q, $options: 'i' } },
            { description: { $regex: q, $options: 'i' } },
            { category: { $regex: q, $options: 'i' } },
          ]}
        ];
      }
      if (source) query.source = source;
      const lim = parseInt(limit) || 30;
      const items = await newsCol.find(query)
        .sort({ publishedAt: -1, scrapedAt: -1 })
        .limit(lim)
        .toArray();
      res.json({ success: true, count: items.length, items: items.map(n => {
        const { _id, ...r } = n;
        return r;
      })});
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return { connectDB_tv };
};
