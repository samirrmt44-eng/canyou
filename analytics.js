// ============================================================
// ANALYTICS - Visitor tracking + Admin dashboard
// Lightweight: tracks pageviews, clicks, time spent
// Admin dashboard: /admin-dashboard.html (PIN-protected)
// ============================================================

module.exports = function(app, db, usersCol, notificationsCol) {
  const crypto = require('crypto');

  let visitsCol, eventsCol, sessionsCol, pageviewsCol;
  let adminPin = process.env.ADMIN_PIN || '1234';  // Default PIN (change in .env)
  let adminToken = null;  // Set after login

  async function connectDB_analytics() {
    visitsCol = db.collection('analytics_visits');     // One per page view
    eventsCol = db.collection('analytics_events');      // Clicks, form submits, etc.
    sessionsCol = db.collection('analytics_sessions');  // One per unique visitor
    pageviewsCol = db.collection('analytics_pageviews'); // Aggregated page stats

    await visitsCol.createIndex({ sessionId: 1 });
    await visitsCol.createIndex({ ts: -1 });
    await visitsCol.createIndex({ page: 1 });
    await eventsCol.createIndex({ sessionId: 1 });
    await eventsCol.createIndex({ ts: -1 });
    await eventsCol.createIndex({ type: 1 });
    await sessionsCol.createIndex({ sessionId: 1 }, { unique: true });
    await sessionsCol.createIndex({ lastSeen: -1 });
    await pageviewsCol.createIndex({ page: 1, day: 1 }, { unique: true });

    console.log('📊 Analytics module loaded!');
  }

  // Get client IP
  function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress
      || 'unknown';
  }

  // Get browser/device info
  function parseUA(ua) {
    if (!ua) return { browser: 'unknown', os: 'unknown', device: 'unknown' };
    const lower = ua.toLowerCase();
    let browser = 'unknown';
    if (lower.includes('chrome')) browser = 'Chrome';
    else if (lower.includes('safari')) browser = 'Safari';
    else if (lower.includes('firefox')) browser = 'Firefox';
    else if (lower.includes('edge')) browser = 'Edge';
    else if (lower.includes('opera')) browser = 'Opera';
    let os = 'unknown';
    if (lower.includes('android')) os = 'Android';
    else if (lower.includes('iphone') || lower.includes('ipad')) os = 'iOS';
    else if (lower.includes('windows')) os = 'Windows';
    else if (lower.includes('mac')) os = 'Mac';
    else if (lower.includes('linux')) os = 'Linux';
    let device = 'desktop';
    if (lower.includes('mobile') || lower.includes('android') || lower.includes('iphone')) device = 'mobile';
    else if (lower.includes('tablet') || lower.includes('ipad')) device = 'tablet';
    return { browser, os, device };
  }

  // ============================================================
  // TRACKING MIDDLEWARE - logs every page view
  // ============================================================
  app.use(async (req, res, next) => {
    // Only track actual page views (not API, not static assets, not /admin)
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/admin')) return next();
    if (req.path.startsWith('/_')) return next();
    if (req.path.includes('.') && !req.path.endsWith('.html')) return next();  // Skip .js, .css, .png etc
    // Track the view
    try {
      const sessionId = req.headers['x-session-id'] || ('sess_' + crypto.randomBytes(6).toString('hex'));
      const ip = getClientIp(req);
      const ua = req.headers['user-agent'] || '';
      const { browser, os, device } = parseUA(ua);
      const referrer = req.headers['referer'] || 'direct';
      const ts = Date.now();
      const page = req.path === '/' ? '/index.html' : req.path;

      // Update or create session
      await sessionsCol.updateOne(
        { sessionId },
        {
          $set: { lastSeen: ts, lastPage: page, browser, os, device, ip },
          $setOnInsert: { firstSeen: ts, sessionId },
          $inc: { pageviews: 1 }
        },
        { upsert: true }
      );

      // Log visit
      await visitsCol.insertOne({
        sessionId, page, ip, browser, os, device, referrer, ts
      });

      // Aggregate by day
      const day = new Date(ts).toISOString().split('T')[0];
      await pageviewsCol.updateOne(
        { page, day },
        { $inc: { count: 1 }, $setOnInsert: { page, day, lastTs: ts } },
        { upsert: true }
      );
    } catch (e) {
      console.error('Analytics track error:', e.message);
    }
    next();
  });

  // ============================================================
  // EVENT TRACKING - client reports custom events
  // ============================================================
  app.post('/api/analytics/event', async (req, res) => {
    try {
      const { sessionId, type, label, value, page, meta } = req.body;
      if (!type) return res.status(400).json({ error: 'type required' });
      await eventsCol.insertOne({
        sessionId: sessionId || 'unknown',
        type,
        label: label || '',
        value: value || 0,
        page: page || '',
        meta: meta || {},
        ts: Date.now()
      });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // ADMIN AUTH
  // ============================================================
  app.post('/api/admin/login', async (req, res) => {
    try {
      const { pin } = req.body;
      if (pin !== adminPin) {
        return res.status(401).json({ error: 'Galat PIN!' });
      }
      adminToken = crypto.randomBytes(32).toString('hex');
      res.json({ success: true, token: adminToken });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  function checkAdmin(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '');
    if (token !== adminToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // ============================================================
  // ADMIN DASHBOARD APIs
  // ============================================================
  app.get('/api/admin/stats', checkAdmin, async (req, res) => {
    try {
      const now = Date.now();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();
      const weekMs = now - 7 * 24 * 60 * 60 * 1000;
      const monthMs = now - 30 * 24 * 60 * 60 * 1000;

      // Counts
      const [totalVisits, totalSessions, todayVisits, todaySessions, weekVisits, monthVisits, totalEvents] = await Promise.all([
        visitsCol.countDocuments(),
        sessionsCol.countDocuments(),
        visitsCol.countDocuments({ ts: { $gte: todayMs } }),
        sessionsCol.countDocuments({ lastSeen: { $gte: todayMs } }),
        visitsCol.countDocuments({ ts: { $gte: weekMs } }),
        visitsCol.countDocuments({ ts: { $gte: monthMs } }),
        eventsCol.countDocuments()
      ]);

      // Live visitors (last 5 min)
      const fiveMinAgo = now - 5 * 60 * 1000;
      const liveVisitors = await sessionsCol.countDocuments({ lastSeen: { $gte: fiveMinAgo } });

      // Top pages (last 7 days)
      const topPages = await pageviewsCol.aggregate([
        { $match: { day: { $gte: new Date(weekMs).toISOString().split('T')[0] } } },
        { $group: { _id: '$page', count: { $sum: '$count' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray();

      // Top events
      const topEvents = await eventsCol.aggregate([
        { $match: { ts: { $gte: weekMs } } },
        { $group: { _id: { type: '$type', label: '$label' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 }
      ]).toArray();

      // Devices
      const devices = await sessionsCol.aggregate([
        { $group: { _id: '$device', count: { $sum: 1 } } }
      ]).toArray();

      // Browsers
      const browsers = await sessionsCol.aggregate([
        { $group: { _id: '$browser', count: { $sum: 1 } } }
      ]).toArray();

      // Recent activity
      const recentVisits = await visitsCol.find({})
        .sort({ ts: -1 })
        .limit(20)
        .toArray();

      res.json({
        success: true,
        stats: {
          total: { visits: totalVisits, sessions: totalSessions, events: totalEvents },
          today: { visits: todayVisits, sessions: todaySessions },
          week: { visits: weekVisits },
          month: { visits: monthVisits },
          liveVisitors,
          topPages: topPages.map(p => ({ page: p._id, count: p.count })),
          topEvents: topEvents.map(e => ({ type: e._id.type, label: e._id.label, count: e.count })),
          devices: devices.map(d => ({ device: d._id || 'unknown', count: d.count })),
          browsers: browsers.map(b => ({ browser: b._id || 'unknown', count: b.count })),
          recentVisits: recentVisits.map(v => ({
            page: v.page, browser: v.browser, os: v.os, device: v.device,
            ts: v.ts, ip: v.ip ? v.ip.substring(0, 8) + '...' : 'hidden'
          }))
        }
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Chart data - daily visits for last 30 days
  app.get('/api/admin/chart', checkAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      const daily = await pageviewsCol.aggregate([
        { $match: { day: { $gte: startDate.toISOString().split('T')[0] } } },
        {
          $group: {
            _id: '$day',
            count: { $sum: '$count' },
            uniqueVisitors: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]).toArray();

      // Get unique visitors per day
      const days_arr = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const dayStr = d.toISOString().split('T')[0];
        const found = daily.find(x => x._id === dayStr);
        days_arr.push({
          day: dayStr,
          visits: found ? found.count : 0,
          visitors: found ? found.uniqueVisitors : 0
        });
      }

      res.json({ success: true, days: days_arr });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Top sessions with full activity
  app.get('/api/admin/sessions', checkAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const sessions = await sessionsCol.find({})
        .sort({ lastSeen: -1 })
        .limit(limit)
        .toArray();

      // For each session, get their events
      const enriched = await Promise.all(sessions.map(async (s) => {
        const events = await eventsCol.find({ sessionId: s.sessionId })
          .sort({ ts: -1 })
          .limit(20)
          .toArray();
        const recentPages = await visitsCol.find({ sessionId: s.sessionId })
          .sort({ ts: -1 })
          .limit(10)
          .toArray();
        return {
          sessionId: s.sessionId,
          firstSeen: s.firstSeen,
          lastSeen: s.lastSeen,
          pageviews: s.pageviews,
          browser: s.browser,
          os: s.os,
          device: s.device,
          ip: s.ip ? s.ip.substring(0, 8) + '...' : 'hidden',
          events: events.map(e => ({ type: e.type, label: e.label, value: e.value, page: e.page, ts: e.ts })),
          recentPages: recentPages.map(p => p.page)
        };
      }));

      res.json({ success: true, count: enriched.length, sessions: enriched });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Event details
  app.get('/api/admin/events', checkAdmin, async (req, res) => {
    try {
      const { type, limit } = req.query;
      const query = {};
      if (type) query.type = type;
      const events = await eventsCol.find(query)
        .sort({ ts: -1 })
        .limit(Math.min(parseInt(limit) || 100, 500))
        .toArray();
      res.json({ success: true, count: events.length, events });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  connectDB_analytics().catch(e => console.error('Analytics init error:', e.message));
};
