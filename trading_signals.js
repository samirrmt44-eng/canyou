// ============================================================
// TRADING SIGNALS MODULE - V2
// Auto-member, per-user API keys, pagination, public/private signals
// ============================================================

module.exports = function(app, db, usersCol) {
  const axios = require('axios');
  const crypto = require('crypto');
  let signalsCol;

  async function connectDB_signals() {
    signalsCol = db.collection('tradingSignals');
    await signalsCol.createIndex({ createdAt: -1 });
    await signalsCol.createIndex({ coin: 1, createdAt: -1 });
    await signalsCol.createIndex({ status: 1 });
    await signalsCol.createIndex({ userId: 1 });
    await signalsCol.createIndex({ visibility: 1, createdAt: -1 });
    console.log('📈 Trading Signals module loaded!');
  }

  // ============================================================
  // AUTO-MEMBER CREATION (called from trading.html on first visit)
  // ============================================================
  app.post('/api/signals/auto-register', async (req, res) => {
    try {
      const { name, phone, location, country, avatar } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      // Check if user with this phone already exists
      let user = null;
      if (phone) {
        user = await usersCol.findOne({ phone: phone });
      }
      if (!user) {
        // Create new user
        const userId = 'u_' + crypto.randomBytes(8).toString('hex');
        const sessionId = crypto.randomBytes(16).toString('hex');
        // Generate unique API key for signals
        const apiKey = 'sig_' + crypto.randomBytes(12).toString('hex');
        user = {
          _id: userId, id: userId, sessionId,
          name: name.trim(),
          phone: phone || '',
          location: location || 'Unknown',
          country: country || 'India',
          avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=667eea&color=fff&bold=true&size=200`,
          bio: 'Trading signals member',
          reputation: 1,
          signalApiKey: apiKey,
          signalsPosted: 0,
          joinedAt: Date.now(),
          lastSeen: Date.now(),
          online: true,
          role: 'signal-member',
        };
        await usersCol.insertOne(user);
      } else {
        // Existing user - update last seen and ensure API key
        const updates = { lastSeen: Date.now(), online: true };
        if (!user.signalApiKey) {
          updates.signalApiKey = 'sig_' + crypto.randomBytes(12).toString('hex');
        }
        if (phone) updates.phone = phone;
        if (location) updates.location = location;
        await usersCol.updateOne({ id: user.id }, { $set: updates });
        user = await usersCol.findOne({ id: user.id });
      }
      const { _id, signalApiKey, ...userData } = user;
      // Build personalized webhook URL
      const webhookUrl = `https://canyou-uqkp.onrender.com/api/signals/webhook?key=${signalApiKey}`;
      res.json({
        success: true,
        user: userData,
        sessionId: user.sessionId,
        apiKey: signalApiKey,
        webhookUrl: webhookUrl,
      });
    } catch (e) {
      console.error('Auto-register error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Login by phone (returning user)
  app.post('/api/signals/login', async (req, res) => {
    try {
      const { phone } = req.body || {};
      if (!phone) return res.status(400).json({ error: 'Phone required' });
      const user = await usersCol.findOne({ phone: phone });
      if (!user) return res.status(404).json({ error: 'No account found with this phone' });
      await usersCol.updateOne({ id: user.id }, { $set: { lastSeen: Date.now() } });
      const { _id, signalApiKey, ...userData } = user;
      const webhookUrl = `https://canyou-uqkp.onrender.com/api/signals/webhook?key=${signalApiKey}`;
      res.json({
        success: true,
        user: userData,
        sessionId: user.sessionId,
        apiKey: signalApiKey,
        webhookUrl: webhookUrl,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get current user info (verify session)
  app.get('/api/signals/me', async (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const user = await usersCol.findOne({ sessionId });
    if (!user) return res.status(404).json({ error: 'Session invalid' });
    const { _id, signalApiKey, ...userData } = user;
    res.json({
      success: true,
      user: userData,
      apiKey: signalApiKey,
      webhookUrl: `https://canyou-uqkp.onrender.com/api/signals/webhook?key=${signalApiKey}`,
    });
  });

  // ============================================================
  // WEBHOOK with per-user API key support
  // Usage: POST /api/signals/webhook?key=sig_XXXX
  // Body: { coin, signal, pnl, entry, target, stopLoss }
  // ============================================================
  async function authenticateWebhook(req) {
    const apiKey = req.query.key || req.body.apiKey || req.headers['x-api-key'];
    if (!apiKey) return { error: 'API key required (use ?key=sig_xxx in URL)' };
    const user = await usersCol.findOne({ signalApiKey: apiKey });
    if (!user) return { error: 'Invalid API key' };
    return { user };
  }

  app.post('/api/signals/webhook', async (req, res) => {
    try {
      const auth = await authenticateWebhook(req);
      if (auth.error) return res.status(401).json({ error: auth.error });
      const { coin, signal, entry, target, stopLoss, pnl, note, leverage, timeframe, visibility } = req.body;
      if (!coin || !signal) {
        return res.status(400).json({ error: 'coin and signal are required' });
      }
      const signalData = {
        _id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        coin: String(coin).toUpperCase(),
        signal: String(signal).toUpperCase(),
        entry: parseFloat(entry) || null,
        target: parseFloat(target) || null,
        stopLoss: parseFloat(stopLoss) || null,
        pnl: parseFloat(pnl) || 0,
        leverage: leverage || '1x',
        timeframe: timeframe || '1H',
        note: note || '',
        source: 'bot:' + auth.user.name,
        userId: auth.user.id,
        userName: auth.user.name,
        visibility: visibility || 'public',  // 'public' | 'private'
        status: 'active',
        createdAt: Date.now(),
        views: 0,
      };
      await signalsCol.insertOne(signalData);
      // Increment user's signal count
      await usersCol.updateOne({ id: auth.user.id }, { $inc: { signalsPosted: 1 } });
      const { _id, ...result } = signalData;
      console.log(`📈 [${auth.user.name}] New signal: ${result.coin} ${result.signal} PnL:${result.pnl}%`);
      res.json({ success: true, signal: result });
    } catch (e) {
      console.error('Webhook error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk webhook
  app.post('/api/signals/webhook/bulk', async (req, res) => {
    try {
      const auth = await authenticateWebhook(req);
      if (auth.error) return res.status(401).json({ error: auth.error });
      const signals = req.body.signals || (Array.isArray(req.body) ? req.body : []);
      if (!Array.isArray(signals) || signals.length === 0) {
        return res.status(400).json({ error: 'signals array required' });
      }
      const docs = signals.map(s => ({
        _id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        coin: String(s.coin || '').toUpperCase(),
        signal: String(s.signal || '').toUpperCase(),
        entry: parseFloat(s.entry) || null,
        target: parseFloat(s.target) || null,
        stopLoss: parseFloat(s.stopLoss) || null,
        pnl: parseFloat(s.pnl) || 0,
        leverage: s.leverage || '1x',
        timeframe: s.timeframe || '1H',
        note: s.note || '',
        source: 'bot:' + auth.user.name,
        userId: auth.user.id,
        userName: auth.user.name,
        visibility: s.visibility || 'public',
        status: 'active',
        createdAt: Date.now(),
        views: 0,
      }));
      await signalsCol.insertMany(docs);
      res.json({ success: true, count: docs.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manual entry
  app.post('/api/signals/manual', async (req, res) => {
    try {
      const { coin, signal, entry, target, stopLoss, pnl, note, leverage, timeframe, visibility, sessionId } = req.body;
      if (!coin || !signal) return res.status(400).json({ error: 'coin and signal required' });
      // Try to authenticate via sessionId for tracking who posted
      let user = null;
      if (sessionId) user = await usersCol.findOne({ sessionId });
      const signalData = {
        _id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        coin: String(coin).toUpperCase(),
        signal: String(signal).toUpperCase(),
        entry: parseFloat(entry) || null,
        target: parseFloat(target) || null,
        stopLoss: parseFloat(stopLoss) || null,
        pnl: parseFloat(pnl) || 0,
        leverage: leverage || '1x',
        timeframe: timeframe || '1H',
        note: note || '',
        source: user ? ('manual:' + user.name) : 'manual',
        userId: user ? user.id : null,
        userName: user ? user.name : null,
        visibility: visibility || 'public',
        status: 'active',
        createdAt: Date.now(),
        views: 0,
      };
      await signalsCol.insertOne(signalData);
      if (user) await usersCol.updateOne({ id: user.id }, { $inc: { signalsPosted: 1 } });
      const { _id, ...result } = signalData;
      res.json({ success: true, signal: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // READ ENDPOINTS - PAGINATED
  // ============================================================
  // Get signals with pagination
  app.get('/api/signals', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const { limit, page, coin, signal, status, userId, sort } = req.query;
      const pageSize = Math.min(parseInt(limit) || 50, 200);  // Max 200 per page
      const pageNum = Math.max(parseInt(page) || 1, 1);
      const query = { visibility: { $in: ['public', null] } };  // Only public by default
      if (coin) query.coin = String(coin).toUpperCase();
      if (signal) query.signal = String(signal).toUpperCase();
      if (status) query.status = status;
      else query.status = 'active';
      if (userId) query.userId = userId;
      const sortBy = sort === 'pnl_desc' ? { pnl: -1, createdAt: -1 }
                   : sort === 'pnl_asc' ? { pnl: 1, createdAt: -1 }
                   : sort === 'views' ? { views: -1, createdAt: -1 }
                   : { createdAt: -1 };
      const total = await signalsCol.countDocuments(query);
      const totalPages = Math.ceil(total / pageSize);
      const skip = (pageNum - 1) * pageSize;
      const signals = await signalsCol.find(query).sort(sortBy).skip(skip).limit(pageSize).toArray();
      res.json({
        success: true,
        count: signals.length,
        total: total,
        page: pageNum,
        pageSize: pageSize,
        totalPages: totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
        signals: signals.map(s => { const { _id, ...r } = s; return r; }),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Today's signals
  app.get('/api/signals/today', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startTime = today.getTime();
    const query = { createdAt: { $gte: startTime }, visibility: { $in: ['public', null] } };
    const signals = await signalsCol.find(query).sort({ createdAt: -1 }).toArray();
    const stats = {
      total: signals.length,
      buy: signals.filter(s => s.signal === 'BUY' || s.signal === 'LONG').length,
      sell: signals.filter(s => s.signal === 'SELL' || s.signal === 'SHORT').length,
      totalPnL: signals.reduce((sum, s) => sum + (s.pnl || 0), 0).toFixed(2),
      avgPnL: signals.length > 0 ? (signals.reduce((sum, s) => sum + (s.pnl || 0), 0) / signals.length).toFixed(2) : 0,
      winners: signals.filter(s => s.pnl > 0).length,
      losers: signals.filter(s => s.pnl < 0).length,
    };
    res.json({ success: true, stats, signals: signals.map(s => { const { _id, ...r } = s; return r; }) });
  });

  // Widget endpoint (latest N signals for live display)
  app.get('/api/signals/widget', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const { count } = req.query;
    const lim = Math.min(parseInt(count) || 10, 100);
    const signals = await signalsCol.find({ status: 'active', visibility: { $in: ['public', null] } })
      .sort({ createdAt: -1 }).limit(lim).toArray();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const allToday = await signalsCol.find({
      createdAt: { $gte: today.getTime() },
      visibility: { $in: ['public', null] }
    }).toArray();
    const stats = {
      total: allToday.length,
      buy: allToday.filter(s => s.signal === 'BUY' || s.signal === 'LONG').length,
      sell: allToday.filter(s => s.signal === 'SELL' || s.signal === 'SHORT').length,
      totalPnL: allToday.reduce((sum, s) => sum + (s.pnl || 0), 0).toFixed(2),
      winRate: allToday.length > 0
        ? Math.round((allToday.filter(s => s.pnl > 0).length / allToday.length) * 100)
        : 0,
    };
    res.json({ success: true, stats, signals: signals.map(s => { const { _id, ...r } = s; return r; }) });
  });

  // Per-coin summary (all signals for one coin aggregated)
  app.get('/api/signals/coin/:coin/summary', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const coin = String(req.params.coin).toUpperCase();
    const signals = await signalsCol.find({ coin, status: 'active', visibility: { $in: ['public', null] } })
      .sort({ createdAt: -1 }).limit(100).toArray();
    if (signals.length === 0) {
      return res.json({ success: true, coin, signals: [], stats: { total: 0, totalPnL: 0, winRate: 0, lastSignal: null } });
    }
    const closed = signals.filter(s => s.signal.includes('CLOSE'));
    const totalPnL = closed.reduce((s, x) => s + (x.pnl || 0), 0);
    const winners = closed.filter(s => s.pnl > 0).length;
    res.json({
      success: true,
      coin,
      stats: {
        total: signals.length,
        closed: closed.length,
        totalPnL: Number(totalPnL.toFixed(2)),
        winRate: closed.length > 0 ? Math.round((winners / closed.length) * 100) : 0,
        lastSignal: signals[0],
      },
      signals: signals.map(s => { const { _id, ...r } = s; return r; }),
    });
  });

  // Get unique coins from all signals
  app.get('/api/signals/coins', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const allSignals = await signalsCol.find({ status: 'active', visibility: { $in: ['public', null] } })
      .sort({ createdAt: -1 }).limit(1000).toArray();
    const coinMap = {};
    allSignals.forEach(s => {
      if (!coinMap[s.coin]) {
        coinMap[s.coin] = { coin: s.coin, count: 0, totalPnL: 0, lastSignal: null, winners: 0, losers: 0 };
      }
      coinMap[s.coin].count++;
      if (s.signal.includes('CLOSE')) {
        coinMap[s.coin].totalPnL += s.pnl || 0;
        if (s.pnl > 0) coinMap[s.coin].winners++;
        else if (s.pnl < 0) coinMap[s.coin].losers++;
      }
      if (!coinMap[s.coin].lastSignal || s.createdAt > coinMap[s.coin].lastSignal) {
        coinMap[s.coin].lastSignal = s.createdAt;
      }
    });
    const coins = Object.values(coinMap).map(c => ({
      ...c,
      totalPnL: Number(c.totalPnL.toFixed(2)),
    })).sort((a, b) => b.lastSignal - a.lastSignal);
    res.json({ success: true, count: coins.length, coins });
  });

  // Get live prices from Binance for given coins (for frontend live pnl calc)
  app.get('/api/signals/live-prices', async (req, res) => {
    try {
      const { coins } = req.query;
      if (!coins) return res.status(400).json({ error: 'coins param required (comma-separated)' });
      const coinList = coins.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
      if (coinList.length === 0) return res.json({ success: true, prices: {} });
      if (coinList.length > 50) return res.status(400).json({ error: 'Too many coins (max 50)' });
      // Normalize: handle BTCUSDT vs BTC/USDT vs BTCUSDT.P etc.
      const symbols = coinList.map(c => {
        // Convert BTC/USDT to BTCUSDT (Binance format)
        if (c.includes('/')) {
          return c.replace('/', '').toUpperCase();
        }
        return c;
      });
      // Fetch from Binance
      const symbolsParam = encodeURIComponent(JSON.stringify(symbols));
      const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbols=${symbolsParam}`;
      const r = await axios.get(url, { timeout: 5000 });
      const priceMap = {};
      if (Array.isArray(r.data)) {
        r.data.forEach(t => {
          priceMap[t.symbol] = parseFloat(t.price);
        });
      }
      res.json({ success: true, prices: priceMap, ts: Date.now() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Increment view count
  app.post('/api/signals/:id/view', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    await signalsCol.updateOne({ id: req.params.id }, { $inc: { views: 1 } });
    res.json({ success: true });
  });

  // Track page visit
  app.post('/api/signals/track-visit', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const visitsCol = db.collection('signalPageVisits');
    const { sessionId, referrer } = req.body || {};
    const sid = sessionId || ('anon_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'));
    const cutoff = Date.now() - 30 * 60 * 1000;
    const existing = await visitsCol.findOne({ sessionId: sid, lastSeen: { $gte: cutoff } });
    if (existing) {
      await visitsCol.updateOne({ _id: existing._id }, { $set: { lastSeen: Date.now() }, $inc: { hits: 1 } });
      const total = await visitsCol.countDocuments({});
      return res.json({ success: true, sessionId: sid, unique: false, totalVisitors: total });
    }
    await visitsCol.insertOne({
      _id: 'visit_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
      sessionId: sid,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      hits: 1,
      referrer: referrer || '',
    });
    const total = await visitsCol.countDocuments({});
    res.json({ success: true, sessionId: sid, unique: true, totalVisitors: total });
  });

  // Overall stats
  app.get('/api/signals/stats', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    try {
      const visitsCol = db.collection('signalPageVisits');
      const activeCutoff = Date.now() - 5 * 60 * 1000;
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayMs = todayStart.getTime();

      const [totalVisitors, todayVisitors, activeNow, totalSignalsAll, todaySigs,
             totalMembers, onlineMembers, todayNewMembers] = await Promise.all([
        visitsCol.countDocuments({}),
        visitsCol.countDocuments({ firstSeen: { $gte: todayMs } }),
        visitsCol.countDocuments({ lastSeen: { $gte: activeCutoff } }),
        signalsCol.countDocuments({}),
        signalsCol.countDocuments({ createdAt: { $gte: todayMs } }),
        // Members: users with role='signal-member' AND have an API key
        usersCol.countDocuments({ role: 'signal-member', signalApiKey: { $exists: true, $ne: '' } }),
        usersCol.countDocuments({ role: 'signal-member', lastSeen: { $gte: activeCutoff } }),
        usersCol.countDocuments({ role: 'signal-member', joinedAt: { $gte: todayMs } }),
      ]);

      // For top viewed, only fetch fields we need (lighter)
      const topViewedFull = await signalsCol.find({ visibility: { $in: ['public', null] } })
        .sort({ views: -1 }).limit(5).project({ id: 1, coin: 1, signal: 1, views: 1, pnl: 1 }).toArray();
      const totalViews = topViewedFull.reduce((s, x) => s + (x.views || 0), 0);

      res.json({
        success: true,
        visitors: { total: totalVisitors, today: todayVisitors, activeNow: activeNow, totalViews: totalViews },
        members: {
          total: totalMembers,
          online: onlineMembers,
          newToday: todayNewMembers,
        },
        signals: {
          total: totalSignalsAll,
          today: todaySigs,
          topViewed: topViewedFull.map(s => { const { _id, ...r } = s; return r; }),
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get list of all signal members (for leaderboard)
  app.get('/api/signals/members', async (req, res) => {
    try {
      const { limit, sort } = req.query;
      const lim = Math.min(parseInt(limit) || 50, 200);
      const sortBy = sort === 'recent' ? { lastSeen: -1 }
                   : sort === 'signals' ? { signalsPosted: -1, lastSeen: -1 }
                   : sort === 'name' ? { name: 1 }
                   : { lastSeen: -1 };
      const members = await usersCol.find({ role: 'signal-member', signalApiKey: { $exists: true, $ne: '' } })
        .sort(sortBy)
        .limit(lim)
        .project({ id: 1, name: 1, location: 1, country: 1, avatar: 1, signalsPosted: 1, joinedAt: 1, lastSeen: 1, online: 1 })
        .toArray();
      res.json({
        success: true,
        count: members.length,
        members: members.map(m => {
          const { _id, ...r } = m;
          return r;
        }),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get specific member's stats + their recent signals
  app.get('/api/signals/members/:userId', async (req, res) => {
    try {
      const user = await usersCol.findOne({ id: req.params.userId, role: 'signal-member' });
      if (!user) return res.status(404).json({ error: 'Member not found' });
      const signals = await signalsCol.find({ userId: req.params.userId })
        .sort({ createdAt: -1 }).limit(50).toArray();
      const closed = signals.filter(s => s.signal.includes('CLOSE'));
      const totalPnl = closed.reduce((s, x) => s + (x.pnl || 0), 0);
      const winners = closed.filter(s => s.pnl > 0).length;
      const { _id, signalApiKey, sessionId, ...safeUser } = user;
      res.json({
        success: true,
        member: safeUser,
        stats: {
          totalSignals: signals.length,
          closed: closed.length,
          totalPnl: Number(totalPnl.toFixed(2)),
          winRate: closed.length > 0 ? Math.round((winners / closed.length) * 100) : 0,
        },
        recentSignals: signals.map(s => { const { _id, ...r } = s; return r; }),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mark signal as closed
  app.post('/api/signals/:id/close', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const { finalPnl, apiKey } = req.body;
    // Optional auth - only the owner can close
    if (apiKey) {
      const user = await usersCol.findOne({ signalApiKey: apiKey });
      if (user) {
        await signalsCol.updateOne(
          { id: req.params.id, userId: user.id },
          { $set: { status: 'closed', closedAt: Date.now(), pnl: parseFloat(finalPnl) || 0 } }
        );
        return res.json({ success: true });
      }
    }
    const update = { status: 'closed', closedAt: Date.now() };
    if (finalPnl !== undefined) update.pnl = parseFloat(finalPnl);
    await signalsCol.updateOne({ id: req.params.id }, { $set: update });
    res.json({ success: true });
  });

  // Delete signal (owner only)
  app.delete('/api/signals/:id', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const apiKey = req.query.key || req.body.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    const user = await usersCol.findOne({ signalApiKey: apiKey });
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    const result = await signalsCol.deleteOne({ id: req.params.id, userId: user.id });
    res.json({ success: true, deleted: result.deletedCount });
  });

  // ============================================================
  // DEMO DATA
  // ============================================================
  app.post('/api/signals/demo', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const coins = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
    const signals = ['LONG', 'SHORT', 'CLOSE_LONG', 'CLOSE_SHORT'];
    const demo = [];
    for (let i = 0; i < 8; i++) {
      const coin = coins[Math.floor(Math.random() * coins.length)];
      const sig = signals[Math.floor(Math.random() * signals.length)];
      const entry = parseFloat((Math.random() * 50000 + 100).toFixed(2));
      const pnl = parseFloat((Math.random() * 20 - 5).toFixed(2));
      demo.push({
        _id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + i,
        id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + i,
        coin, signal: sig,
        entry, target: parseFloat((entry * 1.05).toFixed(2)),
        stopLoss: parseFloat((entry * 0.97).toFixed(2)),
        pnl, leverage: '5x', timeframe: '1H',
        note: 'Demo signal',
        source: 'demo-generator',
        userId: null, userName: null,
        visibility: 'public',
        status: 'active',
        createdAt: Date.now() - Math.floor(Math.random() * 3600000),
        views: 0,
      });
    }
    await signalsCol.insertMany(demo);
    res.json({ success: true, count: demo.length, message: 'Demo signals added!' });
  });

  // ============================================================
  // CONFIGURE (existing API polling)
  // ============================================================
  app.post('/api/signals/configure', async (req, res) => {
    const { apiKey, name, sourceUrl, pollInterval } = req.body;
    if (!apiKey || !sourceUrl) return res.status(400).json({ error: 'apiKey and sourceUrl required' });
    const user = await usersCol.findOne({ signalApiKey: apiKey });
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    const configCol = db.collection('signalConfigs');
    await configCol.updateOne(
      { userId: user.id, name: name || 'default' },
      { $set: { userId: user.id, name: name || 'default', sourceUrl, pollInterval: pollInterval || 30, createdAt: Date.now() } },
      { upsert: true }
    );
    res.json({ success: true, message: 'Signal source configured. Polling will start in 10 seconds.' });
    setTimeout(() => pollSignalSource(user.id, sourceUrl, name || 'default'), 10000);
  });

  async function pollSignalSource(userId, sourceUrl, configName) {
    try {
      const response = await axios.get(sourceUrl, { timeout: 15000 });
      const data = response.data;
      const signals = Array.isArray(data) ? data : (data.signals || []);
      if (!Array.isArray(signals) || signals.length === 0) return;
      const user = await usersCol.findOne({ id: userId });
      for (const s of signals) {
        if (!s.coin || !s.signal) continue;
        const existing = await signalsCol.findOne({
          coin: String(s.coin).toUpperCase(),
          signal: String(s.signal).toUpperCase(),
          entry: parseFloat(s.entry) || null,
          createdAt: { $gt: Date.now() - 60 * 60 * 1000 }
        });
        if (existing) continue;
        const signalData = {
          _id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
          id: 'sig_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
          coin: String(s.coin).toUpperCase(),
          signal: String(s.signal).toUpperCase(),
          entry: parseFloat(s.entry) || null,
          target: parseFloat(s.target) || null,
          stopLoss: parseFloat(s.stopLoss) || null,
          pnl: parseFloat(s.pnl) || 0,
          leverage: s.leverage || '1x',
          timeframe: s.timeframe || '1H',
          note: s.note || '',
          source: 'api-poll:' + new URL(sourceUrl).hostname,
          userId: user.id, userName: user.name,
          visibility: 'public',
          status: 'active',
          createdAt: Date.now(),
          views: 0,
        };
        await signalsCol.insertOne(signalData);
      }
    } catch (e) {
      console.error(`Poll error for ${sourceUrl}:`, e.message);
    }
  }

  function startAutoPolling() {
    setInterval(async () => {
      const configCol = db.collection('signalConfigs');
      const configs = await configCol.find({}).toArray();
      for (const cfg of configs) {
        await pollSignalSource(cfg.userId, cfg.sourceUrl, cfg.name);
      }
    }, 30 * 1000);
  }

  // Initialize
  connectDB_signals().then(() => {
    startAutoPolling();
    console.log('📈 Trading Signals auto-polling started (every 30s)');
  }).catch(e => console.error('Signals init error:', e.message));
};
