// ============================================================
// TRADING SIGNALS MODULE
// ============================================================
// Receives trading signals from your HTML bot via:
// 1. Webhook (POST /api/signals/webhook)
// 2. API Polling (GET /api/signals/poll)
// 3. Manual entry (POST /api/signals/manual)
// Displays LIVE on DainikState app
// ============================================================

module.exports = function(app, db, usersCol) {
  const axios = require('axios');
  let signalsCol;

  async function connectDB_signals() {
    signalsCol = db.collection('tradingSignals');
    await signalsCol.createIndex({ createdAt: -1 });
    await signalsCol.createIndex({ coin: 1, createdAt: -1 });
    await signalsCol.createIndex({ status: 1 });
    console.log('📈 Trading Signals module loaded!');
  }

  // ============================================================
  // METHOD 1: WEBHOOK (Bot directly posts to this endpoint)
  // ============================================================
  app.post('/api/signals/webhook', async (req, res) => {
    try {
      const { coin, signal, entry, target, stopLoss, pnl, note, leverage, timeframe } = req.body;
      if (!coin || !signal) {
        return res.status(400).json({ error: 'coin and signal are required' });
      }
      const signalData = {
        _id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        coin: String(coin).toUpperCase(),
        signal: String(signal).toUpperCase(),  // 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'CLOSE'
        entry: parseFloat(entry) || null,
        target: parseFloat(target) || null,
        stopLoss: parseFloat(stopLoss) || null,
        pnl: parseFloat(pnl) || 0,
        leverage: leverage || '1x',
        timeframe: timeframe || '1H',
        note: note || '',
        source: req.body.source || 'html-bot',
        status: 'active',  // 'active' | 'closed' | 'expired'
        createdAt: Date.now(),
        views: 0,
      };
      await signalsCol.insertOne(signalData);
      const { _id, ...result } = signalData;
      console.log(`📈 New signal: ${result.coin} ${result.signal} (PnL: ${result.pnl}%)`);
      res.json({ success: true, signal: result });
    } catch (e) {
      console.error('Webhook error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk webhook (multiple signals at once)
  app.post('/api/signals/webhook/bulk', async (req, res) => {
    try {
      const signals = req.body.signals || (Array.isArray(req.body) ? req.body : []);
      if (!Array.isArray(signals) || signals.length === 0) {
        return res.status(400).json({ error: 'signals array required' });
      }
      const docs = signals.map(s => ({
        _id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        coin: String(s.coin || '').toUpperCase(),
        signal: String(s.signal || '').toUpperCase(),
        entry: parseFloat(s.entry) || null,
        target: parseFloat(s.target) || null,
        stopLoss: parseFloat(s.stopLoss) || null,
        pnl: parseFloat(s.pnl) || 0,
        leverage: s.leverage || '1x',
        timeframe: s.timeframe || '1H',
        note: s.note || '',
        source: s.source || 'html-bot',
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

  // ============================================================
  // METHOD 2: API POLLING (Your bot has its own API)
  // ============================================================
  app.post('/api/signals/configure', async (req, res) => {
    const { userId, name, sourceUrl, pollInterval } = req.body;
    if (!userId || !sourceUrl) return res.status(400).json({ error: 'userId and sourceUrl required' });
    // Store config in a separate collection
    const configCol = db.collection('signalConfigs');
    await configCol.updateOne(
      { userId, name: name || 'default' },
      { $set: { userId, name: name || 'default', sourceUrl, pollInterval: pollInterval || 30, createdAt: Date.now() } },
      { upsert: true }
    );
    res.json({ success: true, message: 'Signal source configured. Polling will start in 10 seconds.' });
    // Trigger immediate poll
    setTimeout(() => pollSignalSource(userId, sourceUrl, name || 'default'), 10000);
  });

  // Poll a signal source URL
  async function pollSignalSource(userId, sourceUrl, configName) {
    try {
      const response = await axios.get(sourceUrl, { timeout: 15000 });
      const data = response.data;
      // Expect data to be array of signals or { signals: [...] }
      const signals = Array.isArray(data) ? data : (data.signals || []);
      if (!Array.isArray(signals) || signals.length === 0) {
        console.log(`📈 No signals from ${sourceUrl}`);
        return;
      }
      for (const s of signals) {
        if (!s.coin || !s.signal) continue;
        // Check if already exists (by coin + signal + similar timestamp)
        const existing = await signalsCol.findOne({
          coin: String(s.coin).toUpperCase(),
          signal: String(s.signal).toUpperCase(),
          entry: parseFloat(s.entry) || null,
          createdAt: { $gt: Date.now() - 60 * 60 * 1000 }  // Last 1 hour
        });
        if (existing) continue;  // Skip duplicates
        // Insert new
        const signalData = {
          _id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
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
          status: 'active',
          createdAt: Date.now(),
          views: 0,
        };
        await signalsCol.insertOne(signalData);
      }
      console.log(`📈 Polled ${signals.length} signals from ${sourceUrl}`);
    } catch (e) {
      console.error(`Poll error for ${sourceUrl}:`, e.message);
    }
  }

  // Auto-poll every N seconds for all configured sources
  function startAutoPolling() {
    setInterval(async () => {
      const configCol = db.collection('signalConfigs');
      const configs = await configCol.find({}).toArray();
      for (const cfg of configs) {
        await pollSignalSource(cfg.userId, cfg.sourceUrl, cfg.name);
      }
    }, 30 * 1000);  // Poll every 30 seconds
  }

  // ============================================================
  // METHOD 3: MANUAL ENTRY (Admin panel)
  // ============================================================
  app.post('/api/signals/manual', async (req, res) => {
    const { userId, coin, signal, entry, target, stopLoss, pnl, note } = req.body;
    if (!userId || !coin || !signal) return res.status(400).json({ error: 'Missing fields' });
    const signalData = {
      _id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      coin: String(coin).toUpperCase(),
      signal: String(signal).toUpperCase(),
      entry: parseFloat(entry) || null,
      target: parseFloat(target) || null,
      stopLoss: parseFloat(stopLoss) || null,
      pnl: parseFloat(pnl) || 0,
      leverage: req.body.leverage || '1x',
      timeframe: req.body.timeframe || '1H',
      note: note || '',
      source: 'manual',
      status: 'active',
      createdAt: Date.now(),
      views: 0,
    };
    await signalsCol.insertOne(signalData);
    const { _id, ...result } = signalData;
    res.json({ success: true, signal: result });
  });

  // ============================================================
  // READ ENDPOINTS
  // ============================================================
  // Get latest signals
  app.get('/api/signals', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const { limit, coin, signal, status } = req.query;
    const query = {};
    if (coin) query.coin = String(coin).toUpperCase();
    if (signal) query.signal = String(signal).toUpperCase();
    if (status) query.status = status;
    else query.status = 'active';
    const lim = parseInt(limit) || 50;
    const signals = await signalsCol.find(query).sort({ createdAt: -1 }).limit(lim).toArray();
    res.json({
      success: true,
      count: signals.length,
      signals: signals.map(s => { const { _id, ...r } = s; return r; })
    });
  });

  // Get today's signals with stats
  app.get('/api/signals/today', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startTime = today.getTime();
    const signals = await signalsCol.find({ createdAt: { $gte: startTime } }).sort({ createdAt: -1 }).toArray();
    const stats = {
      total: signals.length,
      buy: signals.filter(s => s.signal === 'BUY' || s.signal === 'LONG').length,
      sell: signals.filter(s => s.signal === 'SELL' || s.signal === 'SHORT').length,
      totalPnL: signals.reduce((sum, s) => sum + (s.pnl || 0), 0).toFixed(2),
      avgPnL: signals.length > 0 ? (signals.reduce((sum, s) => sum + (s.pnl || 0), 0) / signals.length).toFixed(2) : 0,
      winners: signals.filter(s => s.pnl > 0).length,
      losers: signals.filter(s => s.pnl < 0).length,
    };
    res.json({
      success: true,
      stats,
      signals: signals.map(s => { const { _id, ...r } = s; return r; })
    });
  });

  // Get signal configs
  app.get('/api/signals/configs/:userId', async (req, res) => {
    const configCol = db.collection('signalConfigs');
    const configs = await configCol.find({ userId: req.params.userId }).toArray();
    res.json({ success: true, configs: configs.map(c => { const { _id, ...r } = c; return r; }) });
  });

  // Get widget data (optimized for frontend)
  app.get('/api/signals/widget', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const { count } = req.query;
    const lim = parseInt(count) || 10;
    const signals = await signalsCol.find({ status: 'active' }).sort({ createdAt: -1 }).limit(lim).toArray();
    // Calculate aggregate stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const allToday = await signalsCol.find({ createdAt: { $gte: today.getTime() } }).toArray();
    const stats = {
      total: allToday.length,
      buy: allToday.filter(s => s.signal === 'BUY' || s.signal === 'LONG').length,
      sell: allToday.filter(s => s.signal === 'SELL' || s.signal === 'SHORT').length,
      totalPnL: allToday.reduce((sum, s) => sum + (s.pnl || 0), 0).toFixed(2),
      winRate: allToday.length > 0 
        ? Math.round((allToday.filter(s => s.pnl > 0).length / allToday.length) * 100) 
        : 0,
    };
    res.json({
      success: true,
      stats,
      signals: signals.map(s => { const { _id, ...r } = s; return r; })
    });
  });

  // Increment view count
  app.post('/api/signals/:id/view', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    await signalsCol.updateOne({ id: req.params.id }, { $inc: { views: 1 } });
    res.json({ success: true });
  });

  // Mark signal as closed
  app.post('/api/signals/:id/close', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const { finalPnl } = req.body;
    const update = { status: 'closed', closedAt: Date.now() };
    if (finalPnl !== undefined) update.pnl = parseFloat(finalPnl);
    await signalsCol.updateOne({ id: req.params.id }, { $set: update });
    res.json({ success: true });
  });

  // Delete signal
  app.delete('/api/signals/:id', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    await signalsCol.deleteOne({ id: req.params.id });
    res.json({ success: true });
  });

  // ============================================================
  // GENERATE DEMO DATA (for testing)
  // ============================================================
  app.post('/api/signals/demo', async (req, res) => {
    if (!signalsCol) return res.status(503).json({ error: 'DB not ready' });
    const coins = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT'];
    const signals = ['BUY', 'SELL', 'LONG', 'SHORT'];
    const demo = [];
    for (let i = 0; i < 8; i++) {
      const coin = coins[Math.floor(Math.random() * coins.length)];
      const sig = signals[Math.floor(Math.random() * signals.length)];
      const entry = parseFloat((Math.random() * 50000 + 100).toFixed(2));
      const pnl = parseFloat((Math.random() * 20 - 5).toFixed(2));
      demo.push({
        _id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + i,
        id: 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + i,
        coin, signal: sig,
        entry, target: parseFloat((entry * 1.05).toFixed(2)),
        stopLoss: parseFloat((entry * 0.97).toFixed(2)),
        pnl, leverage: '5x', timeframe: '1H',
        note: 'Demo signal',
        source: 'demo-generator',
        status: 'active',
        createdAt: Date.now() - Math.floor(Math.random() * 3600000),
        views: 0,
      });
    }
    await signalsCol.insertMany(demo);
    res.json({ success: true, count: demo.length, message: 'Demo signals added!' });
  });

  // Initialize
  connectDB_signals().then(() => {
    startAutoPolling();
    console.log('📈 Trading Signals auto-polling started (every 30s)');
  }).catch(e => console.error('Signals init error:', e.message));
};
