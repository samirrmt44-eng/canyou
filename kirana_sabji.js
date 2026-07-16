// ============================================================
// KIRANA + SABJI - Local grocery + vegetable marketplace
// ============================================================
// Free platform - stores list items, customers order via WhatsApp
// ============================================================

module.exports = function(app, db, usersCol, notificationsCol) {
  const crypto = require('crypto');
  let kiranaStoresCol, kiranaItemsCol, kiranaOrdersCol;
  let sabjiFarmersCol, sabjiItemsCol, sabjiOrdersCol;

  async function connectDB() {
    kiranaStoresCol = db.collection('kiranaStores');
    kiranaItemsCol = db.collection('kiranaItems');
    kiranaOrdersCol = db.collection('kiranaOrders');
    sabjiFarmersCol = db.collection('sabjiFarmers');
    sabjiItemsCol = db.collection('sabjiItems');
    sabjiOrdersCol = db.collection('sabjiOrders');

    await kiranaStoresCol.createIndex({ area: 1 }).catch(()=>{});
    await kiranaItemsCol.createIndex({ storeId: 1 }).catch(()=>{});
    await sabjiFarmersCol.createIndex({ area: 1 }).catch(()=>{});
    console.log('🛒 Kirana + Sabji module loaded!');
  }

  // ============== KIRANA ==============

  // Get stats
  app.get('/api/kirana/stats', async (req, res) => {
    try {
      if (!kiranaStoresCol) await connectDB();
      const stores = await kiranaStoresCol.countDocuments({});
      const items = await kiranaItemsCol.countDocuments({});
      const orders = await kiranaOrdersCol.countDocuments({});
      res.json({ success: true, stores, items, orders });
    } catch (e) {
      res.json({ success: true, stores: 0, items: 0, orders: 0 });
    }
  });

  // Get all stores
  app.get('/api/kirana/stores', async (req, res) => {
    try {
      if (!kiranaStoresCol) await connectDB();
      const { area } = req.query;
      const query = {};
      if (area) query.area = { $regex: area, $options: 'i' };
      const stores = await kiranaStoresCol.find(query).limit(50).toArray();
      res.json({ success: true, count: stores.length, stores: stores.map(s => { const { _id, ...r } = s; return r; }) });
    } catch (e) {
      res.json({ success: true, count: 0, stores: [] });
    }
  });

  // Register store
  app.post('/api/kirana/store/register', async (req, res) => {
    try {
      if (!kiranaStoresCol) await connectDB();
      const { userId, name, phone, area, address, items } = req.body;
      if (!userId || !name || !phone) return res.status(400).json({ error: 'Missing fields' });
      const storeId = 'store_' + crypto.randomBytes(6).toString('hex');
      const store = {
        _id: storeId, id: storeId, userId, name, phone,
        area: area || 'Hazaribagh', address: address || '',
        items: items || 50,
        verified: true,
        rating: 0, totalOrders: 0,
        createdAt: Date.now()
      };
      await kiranaStoresCol.insertOne(store);
      await usersCol.updateOne({ id: userId }, { $set: { kiranaStoreId: storeId, role: 'shopkeeper' } });
      res.json({ success: true, store });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Add item to store
  app.post('/api/kirana/item/add', async (req, res) => {
    try {
      if (!kiranaItemsCol) await connectDB();
      const { storeId, name, price, unit, category, image } = req.body;
      if (!storeId || !name || !price) return res.status(400).json({ error: 'Missing fields' });
      const itemId = 'item_' + crypto.randomBytes(6).toString('hex');
      const item = {
        _id: itemId, id: itemId, storeId,
        name, price, unit: unit || 'piece', category: category || 'अनाज',
        image: image || '', inStock: true,
        createdAt: Date.now()
      };
      await kiranaItemsCol.insertOne(item);
      res.json({ success: true, item });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============== SABJI ==============

  // Get farmers
  app.get('/api/sabji/farmers', async (req, res) => {
    try {
      if (!sabjiFarmersCol) await connectDB();
      const { area } = req.query;
      const query = {};
      if (area) query.area = { $regex: area, $options: 'i' };
      const farmers = await sabjiFarmersCol.find(query).limit(50).toArray();
      res.json({ success: true, count: farmers.length, farmers: farmers.map(f => { const { _id, ...r } = f; return r; }) });
    } catch (e) {
      res.json({ success: true, count: 0, farmers: [] });
    }
  });

  // Register farmer
  app.post('/api/sabji/farmer/register', async (req, res) => {
    try {
      if (!sabjiFarmersCol) await connectDB();
      const { userId, name, phone, area, items, village } = req.body;
      if (!userId || !name || !phone) return res.status(400).json({ error: 'Missing fields' });
      const farmerId = 'farmer_' + crypto.randomBytes(6).toString('hex');
      const farmer = {
        _id: farmerId, id: farmerId, userId, name, phone,
        area: area || 'Hazaribagh', village: village || '',
        items: items || 'सब्ज़ियां',
        verified: true,
        rating: 0, totalOrders: 0,
        createdAt: Date.now()
      };
      await sabjiFarmersCol.insertOne(farmer);
      await usersCol.updateOne({ id: userId }, { $set: { sabjiFarmerId: farmerId, role: 'farmer' } });
      res.json({ success: true, farmer });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============== AUTH (Phone+OTP) ==============

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { phone, name, role } = req.body;
      if (!phone) return res.status(400).json({ error: 'phone required' });
      const userId = 'u_' + crypto.createHash('md5').update(phone).digest('hex').slice(0, 12);
      const user = {
        _id: userId, id: userId, phone, name: name || '',
        role: role || 'parent',
        createdAt: Date.now(),
        lastLogin: Date.now()
      };
      await usersCol.updateOne({ id: userId }, { $set: user }, { upsert: true });
      res.json({ success: true, user: { id: userId, phone, name: user.name, role: user.role } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Initialize
  connectDB().catch(e => console.error('Kirana/Sabji init error:', e.message));
};
