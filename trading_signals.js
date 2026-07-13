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

  // Submit feedback (community posts)
  app.post('/api/signals/feedback', async (req, res) => {
    try {
      const { text, name, sessionId } = req.body;
      if (!text || !text.trim()) return res.status(400).json({ error: 'Feedback text required' });
      const trimmed = String(text).trim().slice(0, 200);
      let userName = name || 'Anonymous';
      let userId = null;
      if (sessionId) {
        const u = await usersCol.findOne({ sessionId });
        if (u) { userName = u.name; userId = u.id; }
      }
      const feedbackCol = db.collection('feedback');
      const post = {
        _id: 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        id: 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        userId, userName, text: trimmed,
        likes: 0, likedBy: [],
        createdAt: Date.now(),
        status: 'active',
      };
      await feedbackCol.insertOne(post);
      const { _id, likedBy, ...result } = post;
      res.json({ success: true, post: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get all feedback (community posts)
  app.get('/api/signals/feedback', async (req, res) => {
    try {
      const { limit } = req.query;
      const lim = Math.min(parseInt(limit) || 30, 100);
      const feedbackCol = db.collection('feedback');
      const posts = await feedbackCol.find({ status: 'active' })
        .sort({ createdAt: -1 }).limit(lim).toArray();
      res.json({
        success: true,
        count: posts.length,
        posts: posts.map(p => {
          const { _id, likedBy, ...r } = p;
          return r;
        }),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Like a feedback post
  app.post('/api/signals/feedback/:id/like', async (req, res) => {
    try {
      const feedbackCol = db.collection('feedback');
      const { sessionId } = req.body;
      const post = await feedbackCol.findOne({ id: req.params.id });
      if (!post) return res.status(404).json({ error: 'Post not found' });
      const likedBy = post.likedBy || [];
      let liked = false;
      if (sessionId && likedBy.includes(sessionId)) {
        // Unlike
        await feedbackCol.updateOne(
          { id: req.params.id },
          { $pull: { likedBy: sessionId }, $inc: { likes: -1 } }
        );
        liked = false;
      } else if (sessionId) {
        // Like
        await feedbackCol.updateOne(
          { id: req.params.id },
          { $addToSet: { likedBy: sessionId }, $inc: { likes: 1 } }
        );
        liked = true;
      } else {
        // Anonymous like (just count)
        await feedbackCol.updateOne({ id: req.params.id }, { $inc: { likes: 1 } });
      }
      const updated = await feedbackCol.findOne({ id: req.params.id });
      res.json({ success: true, likes: updated.likes, liked: liked });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Set price alert
  app.post('/api/signals/alerts', async (req, res) => {
    try {
      const { coin, condition, targetPrice, sessionId } = req.body;
      if (!coin || !condition || !targetPrice) {
        return res.status(400).json({ error: 'coin, condition, targetPrice required' });
      }
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const user = await usersCol.findOne({ sessionId });
      if (!user) return res.status(401).json({ error: 'Login required' });
      const alertsCol = db.collection('priceAlerts');
      const alert = {
        _id: 'al_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        id: 'al_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        userId: user.id,
        sessionId,
        coin: String(coin).toUpperCase(),
        condition: String(condition),  // 'above' | 'below'
        targetPrice: parseFloat(targetPrice),
        status: 'active',  // 'active' | 'triggered' | 'cancelled'
        createdAt: Date.now(),
        triggeredAt: null,
        triggeredPrice: null,
      };
      await alertsCol.insertOne(alert);
      const { _id, ...result } = alert;
      res.json({ success: true, alert: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get user's price alerts
  app.get('/api/signals/alerts', async (req, res) => {
    try {
      const { sessionId } = req.query;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const alertsCol = db.collection('priceAlerts');
      const alerts = await alertsCol.find({ sessionId })
        .sort({ createdAt: -1 }).limit(50).toArray();
      res.json({
        success: true,
        count: alerts.length,
        alerts: alerts.map(a => { const { _id, ...r } = a; return r; }),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cancel/delete alert
  app.delete('/api/signals/alerts/:id', async (req, res) => {
    try {
      const alertsCol = db.collection('priceAlerts');
      const result = await alertsCol.deleteOne({ id: req.params.id });
      res.json({ success: true, deleted: result.deletedCount });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Background price monitor: check active alerts every 30s
  function startPriceMonitor() {
    setInterval(async () => {
      try {
        const alertsCol = db.collection('priceAlerts');
        const activeAlerts = await alertsCol.find({ status: 'active' }).toArray();
        if (activeAlerts.length === 0) return;
        // Get unique coins
        const coins = [...new Set(activeAlerts.map(a => a.coin))];
        const symbolsParam = encodeURIComponent(JSON.stringify(coins));
        // Use cached prices
        let allTickers;
        if (global._binanceCache && (Date.now() - global._binanceCache.ts) < 10000) {
          allTickers = global._binanceCache.data;
        } else {
          try {
            const r = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price', { timeout: 5000 });
            allTickers = r.data;
            global._binanceCache = { ts: Date.now(), data: allTickers };
          } catch (e) { return; }
        }
        const priceMap = {};
        allTickers.forEach(t => { priceMap[t.symbol] = parseFloat(t.price); });
        // Check each alert
        for (const alert of activeAlerts) {
          const price = priceMap[alert.coin] || 0;
          if (price <= 0) continue;
          let triggered = false;
          if (alert.condition === 'above' && price >= alert.targetPrice) triggered = true;
          else if (alert.condition === 'below' && price <= alert.targetPrice) triggered = true;
          if (triggered) {
            await alertsCol.updateOne(
              { id: alert.id },
              { $set: { status: 'triggered', triggeredAt: Date.now(), triggeredPrice: price } }
            );
            // Create notification
            await notificationsCol.insertOne({
              _id: 'n_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
              id: 'n_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
              userId: alert.userId,
              type: 'price_alert',
              targetType: 'alert',
              targetId: alert.id,
              message: '🔔 ' + alert.coin + ' is now $' + price + ' (' + alert.condition + ' $' + alert.targetPrice + ')',
              read: false,
              createdAt: Date.now(),
            });
            console.log('🔔 Alert triggered:', alert.coin, alert.condition, alert.targetPrice, 'at', price);
          }
        }
      } catch (e) {
        console.error('Price monitor error:', e.message);
      }
    }, 30 * 1000);  // Every 30s
  }

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

  // Get 24h mini chart data for a coin (for sparkline visualization)
  app.get('/api/signals/sparkline/:coin', async (req, res) => {
    try {
      const rawCoin = req.params.coin.toUpperCase();
      const coin = rawCoin.includes('/') ? rawCoin.replace('/', '') : rawCoin;
      const interval = req.query.interval || '15m';
      const limit = parseInt(req.query.limit) || 96;  // 24h with 15m
      // Try Binance spot first, then futures
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${coin}&interval=${interval}&limit=${limit}`;
      const r = await axios.get(url, { timeout: 8000 });
      if (!Array.isArray(r.data)) return res.status(400).json({ error: 'No data' });
      const candles = r.data.map(k => ({
        t: k[0],
        o: parseFloat(k[1]),
        h: parseFloat(k[2]),
        l: parseFloat(k[3]),
        c: parseFloat(k[4]),
        v: parseFloat(k[5]),
      }));
      const first = candles[0]?.c || 0;
      const last = candles[candles.length - 1]?.c || 0;
      const change24h = first > 0 ? ((last - first) / first) * 100 : 0;
      // Resample to ~50 points for smooth chart
      const target = 50;
      const step = Math.max(1, Math.floor(candles.length / target));
      const sampled = [];
      for (let i = 0; i < candles.length; i += step) sampled.push(candles[i].c);
      if (sampled[sampled.length - 1] !== candles[candles.length - 1].c) {
        sampled.push(candles[candles.length - 1].c);
      }
      res.json({
        success: true,
        coin: coin,
        interval: interval,
        currentPrice: last,
        change24h: Number(change24h.toFixed(2)),
        high24h: Math.max(...candles.map(c => c.h)),
        low24h: Math.min(...candles.map(c => c.l)),
        volume24h: candles.reduce((s, c) => s + c.v, 0),
        prices: sampled,
        candles: candles,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Calculate live PnL% for given signal IDs using current Binance prices
  // Useful for signals with pnl=0 (no stored pnl) - we compute unrealized PnL from entry + leverage
  app.get('/api/signals/live-pnl', async (req, res) => {
    try {
      const { signalIds, defaultLeverage } = req.query;
      if (!signalIds) return res.status(400).json({ error: 'signalIds param required (comma-separated)' });
      const idList = signalIds.split(',').filter(Boolean);
      if (idList.length === 0) return res.json({ success: true, pnl: {} });
      if (idList.length > 100) return res.status(400).json({ error: 'Too many signals (max 100)' });
      const defLev = parseFloat(defaultLeverage) || 3;  // Default 3x if not specified
      // Fetch signals from DB
      const signals = await signalsCol.find({ id: { $in: idList } }).toArray();
      // Collect unique coins
      const coins = [...new Set(signals.map(s => s.coin).filter(Boolean))];
      if (coins.length === 0) return res.json({ success: true, pnl: {} });
      // Normalize coins (BTC/USDT -> BTCUSDT)
      const symbols = coins.map(c => c.includes('/') ? c.replace('/', '').toUpperCase() : c.toUpperCase());
      // Fetch prices (use cache if fresh)
      const now = Date.now();
      let allTickers;
      if (global._binanceCache && (now - global._binanceCache.ts) < 5000) {
        allTickers = global._binanceCache.data;
      } else {
        const r = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price', { timeout: 5000 });
        allTickers = r.data;
        global._binanceCache = { ts: now, data: allTickers };
      }
      // Build price map
      const priceMap = {};
      const wantedSet = new Set(symbols);
      allTickers.forEach(t => { if (wantedSet.has(t.symbol)) priceMap[t.symbol] = parseFloat(t.price); });
      // Calculate pnl for each signal
      const pnlMap = {};
      signals.forEach(s => {
        let pnl = 0;
        // Extract leverage from string like "10x"
        let lev = defLev;
        if (s.leverage) {
          const m = String(s.leverage).match(/(\d+(?:\.\d+)?)/);
          if (m) lev = parseFloat(m[1]);
        }
        // Determine side from signal
        const isShort = s.signal === 'SHORT' || s.signal === 'CLOSE_SHORT' ||
                       s.signal === 'SELL' || s.signal === 'CLOSE_SELL';
        const isLong = s.signal === 'LONG' || s.signal === 'CLOSE_LONG' ||
                      s.signal === 'BUY' || s.signal === 'CLOSE_BUY';
        // For CLOSE signals, prefer stored pnl if available and >0
        if (s.signal.includes('CLOSE') && s.pnl && Math.abs(s.pnl) > 0.0001) {
          pnl = s.pnl;
        } else {
          // Calculate unrealized PnL from entry + current price
          const coinNorm = (s.coin || '').includes('/') ? s.coin.replace('/', '').toUpperCase() : (s.coin || '').toUpperCase();
          const mark = priceMap[coinNorm] || 0;
          const entry = parseFloat(s.entry) || 0;
          if (mark > 0 && entry > 0) {
            if (isLong) {
              pnl = ((mark - entry) / entry) * 100 * lev;
            } else if (isShort) {
              pnl = ((entry - mark) / entry) * 100 * lev;
            }
          }
        }
        pnlMap[s.id] = {
          pnl: Number(pnl.toFixed(2)),
          mark: priceMap[(s.coin || '').includes('/') ? s.coin.replace('/', '').toUpperCase() : (s.coin || '').toUpperCase()] || null,
          entry: parseFloat(s.entry) || null,
          leverage: lev,
          side: isShort ? 'SHORT' : (isLong ? 'LONG' : null),
        };
      });
      res.json({ success: true, pnl: pnlMap, prices: priceMap, ts: now });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
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
      // Fetch from Binance - use individual calls or batch with proper format
      // Binance's ?symbols=[...] works in POST but not GET query. Use batch approach:
      // Get all tickers then filter client-side (cached, single call)
      // Cache for 5 seconds to avoid rate limits
      const now = Date.now();
      if (!global._binanceCache || (now - global._binanceCache.ts) > 5000) {
        const r = await axios.get('https://fapi.binance.com/fapi/v1/ticker/price', { timeout: 5000 });
        global._binanceCache = { ts: now, data: r.data };
      }
      const allTickers = global._binanceCache.data;
      const priceMap = {};
      const wantedSet = new Set(symbols);
      allTickers.forEach(t => {
        if (wantedSet.has(t.symbol)) {
          priceMap[t.symbol] = parseFloat(t.price);
        }
      });
      res.json({ success: true, prices: priceMap, ts: now });
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

  // Admin report - detailed analytics for all members
  app.get('/api/signals/admin/report', async (req, res) => {
    try {
      const members = await usersCol.find({ role: 'signal-member' })
        .sort({ joinedAt: -1 })
        .project({
          id: 1, name: 1, phone: 1, location: 1, country: 1, avatar: 1,
          signalsPosted: 1, joinedAt: 1, lastSeen: 1, online: 1
        })
        .toArray();
      const now = Date.now();
      const enriched = members.map(m => {
        const lastSeenAgo = now - (m.lastSeen || 0);
        const joinedAgo = now - (m.joinedAt || 0);
        const daysSinceJoin = Math.floor(joinedAgo / 86400000);
        return {
          ...m,
          _id: undefined,
          isOnline: lastSeenAgo < 5 * 60 * 1000,
          isRecent: lastSeenAgo < 24 * 60 * 60 * 1000,
          daysSinceJoin: daysSinceJoin,
          activity: lastSeenAgo < 3600000 ? 'active' : lastSeenAgo < 86400000 ? 'today' : lastSeenAgo < 7 * 86400000 ? 'this week' : 'inactive',
        };
      });
      const stats = {
        total: enriched.length,
        online: enriched.filter(m => m.isOnline).length,
        activeToday: enriched.filter(m => m.isRecent).length,
        activeThisWeek: enriched.filter(m => m.activity !== 'inactive').length,
        inactive: enriched.filter(m => m.activity === 'inactive').length,
        postedSignals: enriched.filter(m => (m.signalsPosted || 0) > 0).length,
        topPosters: enriched.sort((a, b) => (b.signalsPosted || 0) - (a.signalsPosted || 0)).slice(0, 10),
      };
      res.json({ success: true, stats, members: enriched });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Advanced multi-strategy analyzer
  // Combines CCI + RSI + MACD + Volume + Trend + Sentiment
  // Returns consensus signal with high accuracy
  app.get('/api/signals/analyze/:coin', async (req, res) => {
    try {
      const rawCoin = req.params.coin.toUpperCase();
      const coin = rawCoin.includes('/') ? rawCoin.replace('/', '') : rawCoin;
      const interval = req.query.interval || '15m';
      const limit = 200;
      // Fetch klines (enough for all indicators)
      const klineUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${coin}&interval=${interval}&limit=${limit}`;
      const klineR = await axios.get(klineUrl, { timeout: 8000 });
      if (!Array.isArray(klineR.data) || klineR.data.length < 100) {
        return res.status(400).json({ error: 'Not enough candle data for ' + coin });
      }
      const candles = klineR.data.map(k => ({
        t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
        l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]),
      }));
      // ====== INDICATOR FUNCTIONS ======
      function calcCCI(data, period) {
        if (data.length < period) return null;
        const sl = data.slice(-period);
        const tp = sl.map(c => (c.h + c.l + c.c) / 3);
        const sma = tp.reduce((a, b) => a + b, 0) / period;
        const md = tp.reduce((a, b) => a + Math.abs(b - sma), 0) / period;
        if (md === 0) return 0;
        return (tp[tp.length - 1] - sma) / (0.015 * md);
      }
      function calcRSI(data, period) {
        if (data.length < period + 1) return null;
        const sl = data.slice(-(period + 1));
        let gains = 0, losses = 0;
        for (let i = 1; i < sl.length; i++) {
          const diff = sl[i].c - sl[i-1].c;
          if (diff > 0) gains += diff;
          else losses -= diff;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
      }
      function calcEMA(prices, period) {
        if (prices.length < period) return null;
        const k = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < prices.length; i++) {
          ema = prices[i] * k + ema * (1 - k);
        }
        return ema;
      }
      function calcMACD(prices) {
        const ema12 = calcEMA(prices, 12);
        const ema26 = calcEMA(prices, 26);
        const macd = ema12 - ema26;
        // Signal line
        const macdSeries = [];
        const k = 2 / (10 + 1);
        let signal = null;
        for (let i = 26; i < prices.length; i++) {
          const e12 = calcEMA(prices.slice(0, i + 1), 12);
          const e26 = calcEMA(prices.slice(0, i + 1), 26);
          macdSeries.push(e12 - e26);
        }
        if (macdSeries.length >= 9) {
          signal = macdSeries.slice(-9).reduce((a, b) => a + b, 0) / 9;
        }
        const histogram = signal !== null ? macd - signal : 0;
        return { macd, signal, histogram };
      }
      function calcSMA(prices, period) {
        if (prices.length < period) return null;
        return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
      }
      // ====== CALCULATE ALL INDICATORS ======
      // CCI (sum of two periods)
      const cci14 = calcCCI(candles, 14);
      const cci30 = calcCCI(candles, 30);
      const cci14Prev = calcCCI(candles.slice(0, -1), 14);
      const cci30Prev = calcCCI(candles.slice(0, -1), 30);
      const cciSum = (cci14 || 0) + (cci30 || 0);
      const cciSumPrev = (cci14Prev || 0) + (cci30Prev || 0);
      // RSI
      const closes = candles.map(c => c.c);
      const rsi = calcRSI(candles, 14);
      const rsiPrev = calcRSI(candles.slice(0, -1), 14);
      // MACD
      const macd = calcMACD(closes);
      // MAs for trend
      const sma20 = calcSMA(closes, 20);
      const sma50 = calcSMA(closes, 50);
      const sma200 = calcSMA(closes.slice(0, -1), 200);  // need 200+ candles
      const currentPrice = closes[closes.length - 1];
      // Volume analysis
      const recentVols = candles.slice(-20).map(c => c.v);
      const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
      const lastVol = candles[candles.length - 1].v;
      const volRatio = avgVol > 0 ? lastVol / avgVol : 1;
      // Volatility (ATR-like)
      const ranges = candles.slice(-14).map(c => c.h - c.l);
      const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      const volatility = (avgRange / currentPrice) * 100;  // as %
      // Price momentum (3-candle change)
      const momentum3 = ((currentPrice - candles[candles.length - 4].c) / candles[candles.length - 4].c) * 100;
      // Price momentum (10-candle change)
      const momentum10 = ((currentPrice - candles[candles.length - 11].c) / candles[candles.length - 11].c) * 100;
      // ====== STRATEGY VOTING ======
      const strategies = [];
      // 1. CCI Strategy (35% weight)
      let cciAction = 'NEUTRAL';
      let cciConfidence = 50;
      let cciReason = '';
      if (cciSumPrev <= 20 && cciSum > 20) {
        cciAction = 'LONG';
        cciConfidence = Math.min(95, 60 + Math.abs(cciSum - 20) * 0.5);
        cciReason = 'CCI bullish crossover';
      } else if (cciSumPrev >= -20 && cciSum < -20) {
        cciAction = 'SHORT';
        cciConfidence = Math.min(95, 60 + Math.abs(-20 - cciSum) * 0.5);
        cciReason = 'CCI bearish crossover';
      } else if (cciSum > 20) {
        cciAction = 'LONG';
        cciConfidence = 50 + Math.min(cciSum, 80) * 0.4;
        cciReason = 'CCI in LONG zone';
      } else if (cciSum < -20) {
        cciAction = 'SHORT';
        cciConfidence = 50 + Math.min(Math.abs(cciSum), 80) * 0.4;
        cciReason = 'CCI in SHORT zone';
      } else {
        cciAction = 'NEUTRAL';
        cciConfidence = 50;
        cciReason = 'CCI neutral';
      }
      strategies.push({ name: 'CCI Crossover', action: cciAction, confidence: cciConfidence, weight: 0.35, reason: cciReason });
      // 2. RSI Strategy (25% weight)
      let rsiAction = 'NEUTRAL';
      let rsiConfidence = 50;
      let rsiReason = '';
      if (rsi < 30) {
        rsiAction = 'LONG';
        rsiConfidence = 60 + (30 - rsi) * 1.2;
        rsiReason = 'RSI oversold (' + rsi.toFixed(1) + ') — reversal expected';
      } else if (rsi > 70) {
        rsiAction = 'SHORT';
        rsiConfidence = 60 + (rsi - 70) * 1.2;
        rsiReason = 'RSI overbought (' + rsi.toFixed(1) + ') — pullback expected';
      } else if (rsi < 50 && rsiPrev < rsi) {
        rsiAction = 'LONG';
        rsiConfidence = 55;
        rsiReason = 'RSI recovering (' + rsi.toFixed(1) + ')';
      } else if (rsi > 50 && rsiPrev > rsi) {
        rsiAction = 'SHORT';
        rsiConfidence = 55;
        rsiReason = 'RSI weakening (' + rsi.toFixed(1) + ')';
      } else {
        rsiReason = 'RSI neutral (' + rsi.toFixed(1) + ')';
      }
      strategies.push({ name: 'RSI Momentum', action: rsiAction, confidence: Math.min(95, rsiConfidence), weight: 0.25, reason: rsiReason });
      // 3. MACD Strategy (20% weight)
      let macdAction = 'NEUTRAL';
      let macdConfidence = 50;
      let macdReason = '';
      if (macd.macd !== null && macd.signal !== null) {
        if (macd.macd > macd.signal && macd.histogram > 0) {
          macdAction = 'LONG';
          macdConfidence = 60 + Math.min(Math.abs(macd.histogram) * 5, 30);
          macdReason = 'MACD bullish (above signal)';
        } else if (macd.macd < macd.signal && macd.histogram < 0) {
          macdAction = 'SHORT';
          macdConfidence = 60 + Math.min(Math.abs(macd.histogram) * 5, 30);
          macdReason = 'MACD bearish (below signal)';
        } else {
          macdReason = 'MACD neutral';
        }
      }
      strategies.push({ name: 'MACD Trend', action: macdAction, confidence: Math.min(95, macdConfidence), weight: 0.20, reason: macdReason });
      // 4. Trend (MA) Strategy (15% weight)
      let trendAction = 'NEUTRAL';
      let trendConfidence = 50;
      let trendReason = '';
      if (sma20 && sma50) {
        if (currentPrice > sma20 && sma20 > sma50) {
          trendAction = 'LONG';
          trendConfidence = 75;
          trendReason = 'Uptrend: Price > SMA20 > SMA50';
        } else if (currentPrice < sma20 && sma20 < sma50) {
          trendAction = 'SHORT';
          trendConfidence = 75;
          trendReason = 'Downtrend: Price < SMA20 < SMA50';
        } else if (currentPrice > sma20) {
          trendAction = 'LONG';
          trendConfidence = 60;
          trendReason = 'Above SMA20';
        } else {
          trendAction = 'SHORT';
          trendConfidence = 60;
          trendReason = 'Below SMA20';
        }
      }
      strategies.push({ name: 'Trend (MA)', action: trendAction, confidence: trendConfidence, weight: 0.15, reason: trendReason });
      // 5. Volume confirmation (5% weight)
      let volAction = 'NEUTRAL';
      let volConfidence = 50;
      let volReason = '';
      if (volRatio > 2 && momentum3 > 0) {
        volAction = 'LONG';
        volConfidence = 65;
        volReason = 'High volume + positive momentum (' + volRatio.toFixed(1) + 'x avg)';
      } else if (volRatio > 2 && momentum3 < 0) {
        volAction = 'SHORT';
        volConfidence = 65;
        volReason = 'High volume + negative momentum (' + volRatio.toFixed(1) + 'x avg)';
      } else {
        volReason = 'Volume ' + volRatio.toFixed(1) + 'x avg';
      }
      strategies.push({ name: 'Volume', action: volAction, confidence: volConfidence, weight: 0.05, reason: volReason });
      // ====== AGGREGATE ======
      let longScore = 0, shortScore = 0;
      strategies.forEach(s => {
        const weighted = s.confidence * s.weight;
        if (s.action === 'LONG') longScore += weighted;
        else if (s.action === 'SHORT') shortScore += weighted;
      });
      const totalScore = longScore + shortScore;
      const longPct = totalScore > 0 ? (longScore / totalScore) * 100 : 50;
      const shortPct = totalScore > 0 ? (shortScore / totalScore) * 100 : 50;
      // Determine final action
      let finalAction = 'WAIT';
      let finalConfidence = 50;
      let agreement = 0;  // how many strategies agree
      strategies.forEach(s => {
        if ((finalAction === 'LONG' && s.action === 'LONG') ||
            (finalAction === 'SHORT' && s.action === 'SHORT') ||
            (finalAction === 'WAIT' && s.action === 'NEUTRAL')) {
          agreement += s.weight;
        }
      });
      if (longScore > shortScore && longPct >= 60) {
        finalAction = 'LONG';
        finalConfidence = Math.min(98, longPct);
      } else if (shortScore > longScore && shortPct >= 60) {
        finalAction = 'SHORT';
        finalConfidence = Math.min(98, shortPct);
      } else if (longScore > shortScore) {
        finalAction = 'HOLD_LONG';
        finalConfidence = Math.min(90, longPct);
      } else if (shortScore > longScore) {
        finalAction = 'HOLD_SHORT';
        finalConfidence = Math.min(90, shortPct);
      } else {
        finalAction = 'WAIT';
        finalConfidence = 50;
      }
      // Boost confidence when strategies agree strongly
      const agreementCount = strategies.filter(s => s.action === finalAction || s.action === 'NEUTRAL').length;
      if (agreementCount === strategies.length) {
        finalConfidence = Math.min(98, finalConfidence + 10);  // All agree = strong boost
      } else if (agreementCount >= 4) {
        finalConfidence = Math.min(98, finalConfidence + 5);
      }
      // Build reason
      const reasonParts = [];
      strategies.forEach(s => {
        if (s.action !== 'NEUTRAL') {
          const emoji = s.action === 'LONG' ? '🟢' : '🔴';
          reasonParts.push(emoji + ' ' + s.name + ': ' + s.reason);
        }
      });
      const reason = reasonParts.length > 0
        ? reasonParts.join(' • ')
        : '⏳ All strategies neutral. Wait for clearer signal.';
      // Entry/Exit levels
      let entry = currentPrice;
      let target = null, stopLoss = null;
      if (finalAction === 'LONG') {
        stopLoss = currentPrice * (1 - Math.max(0.015, volatility * 0.5));
        target = currentPrice * (1 + Math.max(0.025, volatility * 1.5));
      } else if (finalAction === 'SHORT') {
        stopLoss = currentPrice * (1 + Math.max(0.015, volatility * 0.5));
        target = currentPrice * (1 - Math.max(0.025, volatility * 1.5));
      } else if (finalAction === 'HOLD_LONG') {
        stopLoss = currentPrice * 0.98;
        target = currentPrice * 1.04;
      } else if (finalAction === 'HOLD_SHORT') {
        stopLoss = currentPrice * 1.02;
        target = currentPrice * 0.96;
      }
      // Next signal distance (what would flip the consensus)
      let nextSignal = null;
      if (finalAction === 'WAIT' || finalAction === 'HOLD_LONG' || finalAction === 'HOLD_SHORT') {
        if (longScore >= shortScore) {
          nextSignal = { type: 'SHORT', threshold: shortScore + 1, currentGap: Math.max(0, longScore - shortScore).toFixed(1) };
        } else {
          nextSignal = { type: 'LONG', threshold: longScore + 1, currentGap: Math.max(0, shortScore - longScore).toFixed(1) };
        }
      }
      // 24h price change
      const change24h = ((currentPrice - candles[0].c) / candles[0].c) * 100;
      const high24h = Math.max(...candles.map(c => c.h));
      const low24h = Math.min(...candles.map(c => c.l));
      res.json({
        success: true,
        coin: coin,
        interval: interval,
        currentPrice: currentPrice,
        change24h: Number(change24h.toFixed(2)),
        high24h: high24h,
        low24h: low24h,
        volatility: Number(volatility.toFixed(2)),
        // Strategy breakdown
        indicators: {
          cci: { sum: Number(cciSum.toFixed(2)), prev: Number(cciSumPrev.toFixed(2)), cci14: Number((cci14 || 0).toFixed(2)), cci30: Number((cci30 || 0).toFixed(2)) },
          rsi: { value: Number((rsi || 50).toFixed(2)), prev: Number((rsiPrev || 50).toFixed(2)) },
          macd: { value: Number((macd.macd || 0).toFixed(2)), signal: Number((macd.signal || 0).toFixed(2)), histogram: Number((macd.histogram || 0).toFixed(2)) },
          sma20: Number((sma20 || currentPrice).toFixed(2)),
          sma50: Number((sma50 || currentPrice).toFixed(2)),
          volume: { ratio: Number(volRatio.toFixed(2)), avg: avgVol, last: lastVol },
          momentum3: Number(momentum3.toFixed(2)),
          momentum10: Number(momentum10.toFixed(2)),
        },
        // Strategy votes
        strategies: strategies.map(s => ({ name: s.name, action: s.action, confidence: Math.round(s.confidence), weight: s.weight, reason: s.reason })),
        // Final signal
        signal: {
          action: finalAction,
          confidence: Math.round(finalConfidence),
          agreement: agreementCount + '/' + strategies.length,
          longPct: Math.round(longPct),
          shortPct: Math.round(shortPct),
          longScore: Math.round(longScore),
          shortScore: Math.round(shortScore),
          reason: reason,
          entry: entry,
          target: target,
          stopLoss: stopLoss,
          nextSignal: nextSignal,
        },
        timestamp: Date.now(),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get TOP BEST signal (highest score across all strategies)
  // Auto-analyzes multiple coins and returns the best opportunity
  app.get('/api/signals/best-opportunity', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      // Get all unique coins from recent signals
      const recentSignals = await signalsCol.find({ status: 'active', visibility: { $in: ['public', null] } })
        .sort({ createdAt: -1 }).limit(50).toArray();
      const uniqueCoins = [...new Set(recentSignals.map(s => s.coin).filter(c => c && !c.includes('/')))];
      if (uniqueCoins.length === 0) {
        return res.json({ success: true, opportunities: [], message: 'No coins yet' });
      }
      // Analyze top coins
      const coinsToAnalyze = uniqueCoins.slice(0, 10);
      const opportunities = [];
      for (const coin of coinsToAnalyze) {
        try {
          // Call our own analyze endpoint internally via the module function
          const r = await axios.get(`${req.protocol}://${req.get('host')}/api/signals/analyze/${encodeURIComponent(coin)}?interval=15m`, { timeout: 15000 });
          if (r.data && r.data.success) {
            const sig = r.data.signal;
            // Include both active signals and HOLD with high confidence
            if ((sig.action === 'LONG' || sig.action === 'SHORT') && sig.confidence >= 65) {
              opportunities.push({
                coin: coin,
                action: sig.action,
                confidence: sig.confidence,
                agreement: sig.agreement,
                currentPrice: r.data.currentPrice,
                change24h: r.data.change24h,
                reason: sig.reason,
                entry: sig.entry,
                target: sig.target,
                stopLoss: sig.stopLoss,
                score: sig.confidence + (parseInt(sig.agreement.split('/')[0]) * 5),
              });
            }
          }
        } catch (e) { /* skip */ }
      }
      opportunities.sort((a, b) => b.score - a.score);
      res.json({ success: true, count: opportunities.length, opportunities: opportunities.slice(0, limit) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Market overview - top movers + sentiment
  app.get('/api/signals/market-overview', async (req, res) => {
    try {
      // Get top BTC/ETH/SOL data with 24h stats
      const tickers = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT', { timeout: 8000 });
      const topCoins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
      const tickerMap = {};
      if (Array.isArray(tickers.data)) {
        tickers.data.forEach(t => { tickerMap[t.symbol] = t; });
      }
      const overview = topCoins.map(coin => {
        const t = tickerMap[coin] || {};
        return {
          coin: coin,
          lastPrice: parseFloat(t.lastPrice || 0),
          priceChange: parseFloat(t.priceChangePercent || 0),
          highPrice: parseFloat(t.highPrice || 0),
          lowPrice: parseFloat(t.lowPrice || 0),
          volume: parseFloat(t.volume || 0),
          quoteVolume: parseFloat(t.quoteVolume || 0),
        };
      });
      res.json({ success: true, overview, ts: Date.now() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get random top N coins for analysis (rotates every request)
  // Returns 10 popular crypto coins, shuffled for variety
  app.get('/api/signals/rotating-coins', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;
      // Popular crypto universe (top trading pairs)
      const popularCoins = [
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
        'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'MATICUSDT', 'LTCUSDT',
        'ARBUSDT', 'OPUSDT', 'TRXUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT',
        'INJUSDT', 'SUIUSDT', 'TONUSDT', 'ICPUSDT', 'FILUSDT', 'ETCUSDT',
        'WLDUSDT', 'PEPEUSDT', 'WIFUSDT', 'BONKUSDT', 'FLOKIUSDT', 'SHIBUSDT',
        'UNIUSDT', 'AAVEUSDT', 'MKRUSDT', 'COMPUSDT', 'CRVUSDT', 'SNXUSDT',
        'SXPUSDT', 'YFIUSDT', 'BALUSDT', 'SUSHIUSDT', 'GRTUSDT', 'RNDRUSDT',
        'FETUSDT', 'AGIXUSDT', 'OCEANUSDT', 'RUNEUSDT', 'KSMUSDT', 'ZECUSDT',
        'DASHUSDT', 'EOSUSDT', 'XLMUSDT', 'NEOUSDT', 'WAVESUSDT', 'QTUMUSDT',
        'CHZUSDT', 'ENJUSDT', 'MANAUSDT', 'SANDUSDT', 'AXSUSDT', 'GALAUSDT',
        'IMXUSDT', 'LDOUSDT', 'BLURUSDT', 'MASKUSDT', 'DYDXUSDT', 'GMXUSDT',
        'CHIPUSDT', 'TAGUSDT', 'FHEUSDT', 'DEXEUSDT', 'BANKUSDT', 'KAITOUSDT',
        'VANRYUSDT', 'BASEDUSDT', 'CLOUSDT', 'TUSDT', 'SXTUSDT', 'HIFIUSDT',
      ];
      // Shuffle with date-based seed so it's the same for everyone that minute
      const now = Date.now();
      const minuteSeed = Math.floor(now / 60000);  // changes every minute
      // Simple seeded shuffle
      const shuffled = [...popularCoins];
      let seed = minuteSeed;
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (seed * 9301 + 49297) % 233280;
        const j = seed % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const selected = shuffled.slice(0, limit);
      res.json({
        success: true,
        coins: selected,
        minute: minuteSeed,
        rotatesAt: (minuteSeed + 1) * 60000,
        ts: now,
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
    startPriceMonitor();
    console.log('📈 Trading Signals auto-polling started (every 30s)');
    console.log('🔔 Price alert monitor started (every 30s)');
  }).catch(e => console.error('Signals init error:', e.message));
};
