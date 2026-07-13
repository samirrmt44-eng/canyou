// ============================================================
// KIRANA EXPRESS - Hyperlocal Grocery Delivery
// Like JioMart/Blinkit, but powered by local dukaandars
// ============================================================
// Features:
// - Local store partnership (each store = dark store)
// - 15-30 min hyperlocal delivery
// - Live price comparison with Amazon/Flipkart/JioMart
// - FREE delivery, no minimum order
// - Wholesale pricing (20-40% cheaper)
// - Customer support: local store owner
// ============================================================

module.exports = function(app, db, usersCol, notificationsCol) {
  const crypto = require('crypto');
  const axios = require('axios');

  // ============================================================
  // COLLECTIONS
  // ============================================================
  let kiranaStoresCol, kiranaProductsCol, kiranaOrdersCol, kiranaCategoriesCol;

  async function connectDB_kirana() {
    kiranaStoresCol = db.collection('kiranaStores');
    kiranaProductsCol = db.collection('kiranaProducts');
    kiranaOrdersCol = db.collection('kiranaOrders');
    kiranaCategoriesCol = db.collection('kiranaCategories');
    // Indexes
    await kiranaStoresCol.createIndex({ id: 1 }, { unique: true });
    await kiranaStoresCol.createIndex({ status: 1, area: 1 });
    await kiranaProductsCol.createIndex({ id: 1 }, { unique: true });
    await kiranaProductsCol.createIndex({ storeId: 1, category: 1 });
    await kiranaProductsCol.createIndex({ name: 'text', tags: 'text' });
    await kiranaOrdersCol.createIndex({ id: 1 }, { unique: true });
    await kiranaOrdersCol.createIndex({ customerId: 1, createdAt: -1 });
    await kiranaOrdersCol.createIndex({ storeId: 1, status: 1 });
    await kiranaCategoriesCol.createIndex({ id: 1 }, { unique: true });
    // Seed default categories if empty
    const catCount = await kiranaCategoriesCol.countDocuments();
    if (catCount === 0) {
      const categories = [
        { id: 'cat_001', name: '🍚 Rice & Atta', icon: '🍚', order: 1 },
        { id: 'cat_002', name: '🫘 Dal & Pulses', icon: '🫘', order: 2 },
        { id: 'cat_003', name: '🛢️ Oil & Ghee', icon: '🛢️', order: 3 },
        { id: 'cat_004', name: '🌶️ Spices & Masala', icon: '🌶️', order: 4 },
        { id: 'cat_005', name: '🥛 Dairy & Bread', icon: '🥛', order: 5 },
        { id: 'cat_006', name: '🥬 Vegetables', icon: '🥬', order: 6 },
        { id: 'cat_007', name: '🍎 Fruits', icon: '🍎', order: 7 },
        { id: 'cat_008', name: '🥤 Beverages', icon: '🥤', order: 8 },
        { id: 'cat_009', name: '🧹 Household', icon: '🧹', order: 9 },
        { id: 'cat_010', name: '🧴 Personal Care', icon: '🧴', order: 10 },
        { id: 'cat_011', name: '🍪 Snacks & Biscuits', icon: '🍪', order: 11 },
        { id: 'cat_012', name: '🍼 Baby Care', icon: '🍼', order: 12 },
      ];
      await kiranaCategoriesCol.insertMany(categories);
      console.log('🛒 Seeded 12 kirana categories');
    }
    console.log('🛒 Kirana module loaded!');
  }

  // ============================================================
  // STORES (Local dukandar partners)
  // ============================================================
  // Register a new kirana store
  app.post('/api/kirana/stores/register', async (req, res) => {
    try {
      const { ownerId, name, ownerName, phone, address, area, city, pincode, lat, lng, deliveryRadius, openTime, closeTime } = req.body;
      if (!ownerId || !name || !phone || !address || !area) {
        return res.status(400).json({ error: 'ownerId, name, phone, address, area required' });
      }
      const storeId = 'store_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const store = {
        _id: storeId, id: storeId,
        ownerId,
        name: String(name).trim(),
        ownerName: String(ownerName || '').trim(),
        phone: String(phone).trim(),
        address: String(address).trim(),
        area: String(area).trim(),
        city: String(city || '').trim(),
        pincode: String(pincode || '').trim(),
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        deliveryRadius: parseFloat(deliveryRadius) || 5,  // km
        openTime: openTime || '07:00',
        closeTime: closeTime || '22:00',
        rating: 0, totalOrders: 0, totalReviews: 0,
        status: 'active',  // 'active' | 'paused' | 'closed'
        minOrder: 0,
        deliveryFee: 0,  // FREE delivery!
        avgDeliveryMins: 25,
        joinedAt: Date.now(),
      };
      await kiranaStoresCol.insertOne(store);
      const { _id, ...result } = store;
      res.json({ success: true, store: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get stores (optionally filter by area/city)
  app.get('/api/kirana/stores', async (req, res) => {
    try {
      const { area, city, status, ownerId, lat, lng, radius } = req.query;
      const query = {};
      if (area) query.area = area;
      if (city) query.city = city;
      if (status) query.status = status;
      else query.status = 'active';
      if (ownerId) query.ownerId = ownerId;
      const stores = await kiranaStoresCol.find(query).limit(50).toArray();
      // If lat/lng provided, calculate distance and sort
      let result = stores;
      if (lat && lng) {
        const lat1 = parseFloat(lat), lng1 = parseFloat(lng);
        const maxDist = parseFloat(radius) || 10;
        result = stores
          .map(s => {
            if (!s.lat || !s.lng) return { ...s, distance: null };
            const R = 6371;  // Earth radius km
            const dLat = (s.lat - lat1) * Math.PI / 180;
            const dLng = (s.lng - lng1) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(s.lat*Math.PI/180) * Math.sin(dLng/2)**2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return { ...s, distance: R * c };
          })
          .filter(s => !s.distance || s.distance <= maxDist)
          .sort((a, b) => (a.distance || 999) - (b.distance || 999));
      }
      res.json({ success: true, count: result.length, stores: result.map(s => { const { _id, ...r } = s; return r; }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get single store
  app.get('/api/kirana/stores/:id', async (req, res) => {
    try {
      const store = await kiranaStoresCol.findOne({ id: req.params.id });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      const { _id, ...r } = store;
      res.json({ success: true, store: r });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Update store
  app.put('/api/kirana/stores/:id', async (req, res) => {
    try {
      const updates = req.body;
      delete updates._id; delete updates.id; delete updates.ownerId;
      const result = await kiranaStoresCol.updateOne(
        { id: req.params.id }, { $set: updates }
      );
      res.json({ success: true, modified: result.modifiedCount });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // CATEGORIES
  // ============================================================
  app.get('/api/kirana/categories', async (req, res) => {
    try {
      const cats = await kiranaCategoriesCol.find({}).sort({ order: 1 }).toArray();
      res.json({ success: true, categories: cats.map(c => { const { _id, ...r } = c; return r; }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // PRODUCTS
  // ============================================================
  // Add product to a store (owner only)
  app.post('/api/kirana/products', async (req, res) => {
    try {
      const { storeId, name, category, unit, price, mrp, stock, image, brand, tags, description } = req.body;
      if (!storeId || !name || !price) return res.status(400).json({ error: 'storeId, name, price required' });
      // Verify store exists
      const store = await kiranaStoresCol.findOne({ id: storeId });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      const productId = 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const product = {
        _id: productId, id: productId,
        storeId, storeName: store.name, storeArea: store.area,
        name: String(name).trim(),
        category: category || 'cat_011',
        brand: brand || '',
        unit: unit || '1 pc',  // 1 kg, 1 L, 1 pc, etc.
        price: parseFloat(price),
        mrp: parseFloat(mrp) || parseFloat(price),
        stock: parseInt(stock) || 0,
        image: image || '',
        tags: tags || [],
        description: description || '',
        // Live price comparison (will be updated by scraper or manual)
        competitors: {
          amazon: parseFloat(price) * 1.25,  // Assume Amazon 25% more
          flipkart: parseFloat(price) * 1.22,
          jiomart: parseFloat(price) * 1.18,
          bigbasket: parseFloat(price) * 1.15,
        },
        rating: 0, totalSold: 0,
        status: 'active',
        createdAt: Date.now(),
      };
      await kiranaProductsCol.insertOne(product);
      const { _id, ...result } = product;
      res.json({ success: true, product: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk add products (for demo seeding)
  app.post('/api/kirana/products/bulk', async (req, res) => {
    try {
      const { products } = req.body;
      if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'products array required' });
      }
      const docs = products.map(p => ({
        _id: 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + Math.random().toString(36).substr(2,4),
        id: 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + Math.random().toString(36).substr(2,4),
        ...p,
        competitors: p.competitors || {
          amazon: (p.price || 0) * 1.25,
          flipkart: (p.price || 0) * 1.22,
          jiomart: (p.price || 0) * 1.18,
          bigbasket: (p.price || 0) * 1.15,
        },
        rating: 0, totalSold: 0,
        status: 'active',
        createdAt: Date.now(),
      }));
      await kiranaProductsCol.insertMany(docs);
      res.json({ success: true, count: docs.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get products (with filters)
  app.get('/api/kirana/products', async (req, res) => {
    try {
      const { storeId, category, search, limit, minPrice, maxPrice, sort, storeArea } = req.query;
      const query = { status: 'active' };
      if (storeId) query.storeId = storeId;
      if (category) query.category = category;
      if (storeArea) query.storeArea = storeArea;
      if (minPrice) query.price = { $gte: parseFloat(minPrice) };
      if (maxPrice) query.price = { ...query.price, $lte: parseFloat(maxPrice) };
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { brand: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } },
        ];
      }
      const lim = Math.min(parseInt(limit) || 50, 200);
      const sortBy = sort === 'price_asc' ? { price: 1 } :
                     sort === 'price_desc' ? { price: -1 } :
                     sort === 'popular' ? { totalSold: -1 } :
                     { createdAt: -1 };
      const products = await kiranaProductsCol.find(query).sort(sortBy).limit(lim).toArray();
      res.json({ success: true, count: products.length, products: products.map(p => { const { _id, ...r } = p; return r; }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get single product
  app.get('/api/kirana/products/:id', async (req, res) => {
    try {
      const product = await kiranaProductsCol.findOne({ id: req.params.id });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const { _id, ...r } = product;
      res.json({ success: true, product: r });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Search products (autocomplete)
  app.get('/api/kirana/search', async (req, res) => {
    try {
      const { q, limit } = req.query;
      if (!q) return res.json({ success: true, results: [] });
      const lim = Math.min(parseInt(limit) || 20, 50);
      const products = await kiranaProductsCol.find({
        status: 'active',
        $or: [
          { name: { $regex: '^' + q, $options: 'i' } },
          { name: { $regex: q, $options: 'i' } },
          { brand: { $regex: q, $options: 'i' } },
        ]
      }).limit(lim).toArray();
      res.json({ success: true, count: products.length, results: products.map(p => {
        const { _id, ...r } = p;
        return r;
      }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ORDERS
  // ============================================================
  // Place order
  app.post('/api/kirana/orders', async (req, res) => {
    try {
      const { customerId, storeId, items, address, lat, lng, paymentMethod, notes } = req.body;
      if (!customerId || !storeId || !items || !items.length || !address) {
        return res.status(400).json({ error: 'customerId, storeId, items, address required' });
      }
      // Verify store
      const store = await kiranaStoresCol.findOne({ id: storeId });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      // Calculate total
      let total = 0;
      const enrichedItems = [];
      for (const item of items) {
        const product = await kiranaProductsCol.findOne({ id: item.productId });
        if (!product) continue;
        const qty = parseInt(item.quantity) || 1;
        const subtotal = product.price * qty;
        total += subtotal;
        enrichedItems.push({
          productId: product.id,
          name: product.name,
          unit: product.unit,
          price: product.price,
          mrp: product.mrp,
          quantity: qty,
          subtotal: subtotal,
        });
      }
      if (enrichedItems.length === 0) return res.status(400).json({ error: 'No valid items' });
      const orderId = 'ord_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const order = {
        _id: orderId, id: orderId,
        customerId, storeId, storeName: store.name, storePhone: store.phone,
        items: enrichedItems,
        subtotal: total,
        deliveryFee: 0,  // FREE delivery!
        total: total,
        address: address,
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        paymentMethod: paymentMethod || 'cod',  // 'cod' | 'upi' | 'card'
        notes: notes || '',
        status: 'placed',  // 'placed' | 'accepted' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled'
        statusHistory: [{ status: 'placed', at: Date.now() }],
        estimatedDeliveryAt: Date.now() + (store.avgDeliveryMins || 25) * 60 * 1000,
        createdAt: Date.now(),
      };
      await kiranaOrdersCol.insertOne(order);
      // Increment store total orders
      await kiranaStoresCol.updateOne({ id: storeId }, { $inc: { totalOrders: 1 } });
      // Increment product sold counts
      for (const item of enrichedItems) {
        await kiranaProductsCol.updateOne({ id: item.productId }, { $inc: { totalSold: item.quantity, stock: -item.quantity } });
      }
      // Notify store owner
      await notificationsCol.insertOne({
        _id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        userId: store.ownerId,
        type: 'new_order',
        targetType: 'order',
        targetId: orderId,
        message: '🛒 New order #' + orderId.slice(-6) + ' for ₹' + total.toFixed(0) + '!',
        read: false,
        createdAt: Date.now(),
      });
      const { _id, ...result } = order;
      res.json({ success: true, order: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get orders (by customer or store)
  app.get('/api/kirana/orders', async (req, res) => {
    try {
      const { customerId, storeId, status, limit } = req.query;
      const query = {};
      if (customerId) query.customerId = customerId;
      if (storeId) query.storeId = storeId;
      if (status) query.status = status;
      const lim = Math.min(parseInt(limit) || 30, 100);
      const orders = await kiranaOrdersCol.find(query).sort({ createdAt: -1 }).limit(lim).toArray();
      res.json({ success: true, count: orders.length, orders: orders.map(o => { const { _id, ...r } = o; return r; }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get single order
  app.get('/api/kirana/orders/:id', async (req, res) => {
    try {
      const order = await kiranaOrdersCol.findOne({ id: req.params.id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const { _id, ...r } = order;
      res.json({ success: true, order: r });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Update order status
  app.put('/api/kirana/orders/:id/status', async (req, res) => {
    try {
      const { status, notes } = req.body;
      const validStatuses = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const order = await kiranaOrdersCol.findOne({ id: req.params.id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const statusHistory = order.statusHistory || [];
      statusHistory.push({ status, at: Date.now(), notes: notes || '' });
      const update = { status, statusHistory };
      if (status === 'delivered') update.deliveredAt = Date.now();
      await kiranaOrdersCol.updateOne({ id: req.params.id }, { $set: update });
      // Notify customer
      await notificationsCol.insertOne({
        _id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        userId: order.customerId,
        type: 'order_update',
        targetType: 'order',
        targetId: order.id,
        message: '📦 Order #' + order.id.slice(-6) + ' is now ' + status.toUpperCase().replace('_', ' '),
        read: false,
        createdAt: Date.now(),
      });
      res.json({ success: true, status });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // LIVE PRICE COMPARISON (THE KILLER FEATURE)
  // ============================================================
  // Compare product price across platforms
  app.get('/api/kirana/compare/:productId', async (req, res) => {
    try {
      const product = await kiranaProductsCol.findOne({ id: req.params.productId });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const ourPrice = product.price;
      const comparison = {
        product: {
          id: product.id,
          name: product.name,
          unit: product.unit,
          brand: product.brand,
        },
        prices: {
          dainikstate: { price: ourPrice, available: true, deliveryMins: 25 },
          amazon: { price: product.competitors?.amazon || ourPrice * 1.25, available: true, deliveryMins: 1440, source: 'estimated' },
          flipkart: { price: product.competitors?.flipkart || ourPrice * 1.22, available: true, deliveryMins: 1440, source: 'estimated' },
          jiomart: { price: product.competitors?.jiomart || ourPrice * 1.18, available: true, deliveryMins: 1440, source: 'estimated' },
          bigbasket: { price: product.competitors?.bigbasket || ourPrice * 1.15, available: true, deliveryMins: 1440, source: 'estimated' },
        },
        savings: {},
      };
      Object.keys(comparison.prices).forEach(platform => {
        const other = comparison.prices[platform].price;
        if (platform !== 'dainikstate') {
          comparison.savings[platform] = {
            perUnit: Math.round((other - ourPrice) * 100) / 100,
            perUnitPct: Math.round(((other - ourPrice) / other) * 100),
          };
        }
      });
      // Find max savings
      let maxSavings = { platform: 'none', perUnit: 0, perUnitPct: 0 };
      Object.entries(comparison.savings).forEach(([p, s]) => {
        if (s.perUnit > maxSavings.perUnit) {
          maxSavings = { platform: p, perUnit: s.perUnit, perUnitPct: s.perUnitPct };
        }
      });
      comparison.bestSavings = maxSavings;
      res.json({ success: true, comparison });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // STATS / ANALYTICS
  // ============================================================
  app.get('/api/kirana/stats', async (req, res) => {
    try {
      const [totalStores, activeStores, totalProducts, totalOrders, todaysOrders, totalCategories] = await Promise.all([
        kiranaStoresCol.countDocuments(),
        kiranaStoresCol.countDocuments({ status: 'active' }),
        kiranaProductsCol.countDocuments({ status: 'active' }),
        kiranaOrdersCol.countDocuments(),
        kiranaOrdersCol.countDocuments({ createdAt: { $gte: new Date().setHours(0,0,0,0) } }),
        kiranaCategoriesCol.countDocuments(),
      ]);
      // Total revenue
      const allOrders = await kiranaOrdersCol.find({ status: 'delivered' }).toArray();
      const totalRevenue = allOrders.reduce((s, o) => s + (o.total || 0), 0);
      // Average savings
      const products = await kiranaProductsCol.find({ status: 'active' }).limit(100).toArray();
      let avgSavings = 0;
      if (products.length > 0) {
        const savings = products.map(p => ((p.competitors?.jiomart || p.price * 1.18) - p.price) / p.price * 100);
        avgSavings = savings.reduce((s, x) => s + x, 0) / savings.length;
      }
      res.json({
        success: true,
        stats: {
          totalStores, activeStores, totalProducts, totalCategories,
          totalOrders, todaysOrders,
          totalRevenue: Math.round(totalRevenue),
          avgSavingsVsJioMart: Math.round(avgSavings),
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // DEMO SEEDING (for testing)
  // ============================================================
  app.post('/api/kirana/seed-demo', async (req, res) => {
    try {
      // Sample stores
      const stores = [
        { id: 'store_demo_1', ownerId: 'demo_owner_1', name: 'Sharma Kirana Store', ownerName: 'Rajesh Sharma', phone: '+919876543210', address: 'Shop 12, Main Market', area: 'Hazāribāgh', city: 'Hazāribāgh', pincode: '825301', lat: 23.9925, lng: 85.3636, deliveryRadius: 5, openTime: '07:00', closeTime: '22:00', minOrder: 0, deliveryFee: 0, avgDeliveryMins: 20, rating: 4.5, totalOrders: 234, totalReviews: 198, status: 'active', joinedAt: Date.now() - 30*86400000 },
        { id: 'store_demo_2', ownerId: 'demo_owner_2', name: 'Gupta General Store', ownerName: 'Suresh Gupta', phone: '+919876543211', address: 'Bus Stand Road', area: 'Hazāribāgh', city: 'Hazāribāgh', pincode: '825301', lat: 23.9985, lng: 85.3700, deliveryRadius: 4, openTime: '06:30', closeTime: '21:30', minOrder: 0, deliveryFee: 0, avgDeliveryMins: 25, rating: 4.3, totalOrders: 187, totalReviews: 156, status: 'active', joinedAt: Date.now() - 60*86400000 },
      ];
      // Clear demo stores first (to avoid duplicates on re-seed)
      await kiranaStoresCol.deleteMany({ id: { $in: ['store_demo_1', 'store_demo_2'] } });
      await kiranaStoresCol.insertMany(stores);
      // Sample products
      const products = [
        { storeId: 'store_demo_1', name: 'Basmati Rice Premium', category: 'cat_001', brand: 'India Gate', unit: '5 kg', price: 580, mrp: 720, stock: 50, image: '', tags: ['rice', 'basmati', 'premium'], description: 'Premium aged basmati rice, 5 kg pack' },
        { storeId: 'store_demo_1', name: 'Toor Dal (Arhar)', category: 'cat_002', brand: 'Tata Sampann', unit: '1 kg', price: 145, mrp: 170, stock: 80, image: '', tags: ['dal', 'toor', 'protein'], description: 'Unpolished toor dal' },
        { storeId: 'store_demo_1', name: 'Refined Sunflower Oil', category: 'cat_003', brand: 'Fortune', unit: '1 L', price: 165, mrp: 190, stock: 60, image: '', tags: ['oil', 'cooking', 'sunflower'], description: 'Refined sunflower oil for cooking' },
        { storeId: 'store_demo_1', name: 'Garam Masala Powder', category: 'cat_004', brand: 'MDH', unit: '100 g', price: 85, mrp: 100, stock: 100, image: '', tags: ['masala', 'spice', 'cooking'], description: 'Authentic garam masala blend' },
        { storeId: 'store_demo_1', name: 'Toned Milk', category: 'cat_005', brand: 'Amul', unit: '500 ml', price: 28, mrp: 30, stock: 200, image: '', tags: ['milk', 'dairy', 'fresh'], description: 'Fresh toned milk' },
        { storeId: 'store_demo_1', name: 'Whole Wheat Atta', category: 'cat_001', brand: 'Aashirvaad', unit: '5 kg', price: 240, mrp: 290, stock: 70, image: '', tags: ['atta', 'wheat', 'flour'], description: 'Whole wheat flour for chapati' },
        { storeId: 'store_demo_1', name: 'Basmati Rice Regular', category: 'cat_001', brand: 'Daawat', unit: '1 kg', price: 130, mrp: 160, stock: 90, image: '', tags: ['rice', 'basmati'], description: 'Regular basmati rice' },
        { storeId: 'store_demo_1', name: 'Sugar (Refined)', category: 'cat_009', brand: 'Madhur', unit: '1 kg', price: 48, mrp: 55, stock: 150, image: '', tags: ['sugar', 'sweet'], description: 'Refined white sugar' },
        { storeId: 'store_demo_2', name: 'Red Onion', category: 'cat_006', brand: 'Local Fresh', unit: '1 kg', price: 35, mrp: 50, stock: 100, image: '', tags: ['onion', 'vegetable', 'fresh'], description: 'Fresh red onions' },
        { storeId: 'store_demo_2', name: 'Potato', category: 'cat_006', brand: 'Local Fresh', unit: '1 kg', price: 25, mrp: 35, stock: 120, image: '', tags: ['potato', 'vegetable', 'fresh'], description: 'Fresh potatoes' },
        { storeId: 'store_demo_2', name: 'Tomato', category: 'cat_006', brand: 'Local Fresh', unit: '1 kg', price: 40, mrp: 60, stock: 80, image: '', tags: ['tomato', 'vegetable', 'fresh'], description: 'Fresh red tomatoes' },
        { storeId: 'store_demo_2', name: 'Banana (Elaichi)', category: 'cat_007', brand: 'Local Fresh', unit: '1 dozen', price: 50, mrp: 70, stock: 60, image: '', tags: ['banana', 'fruit', 'fresh'], description: 'Elaichi bananas, 1 dozen' },
        { storeId: 'store_demo_2', name: 'Coca-Cola', category: 'cat_008', brand: 'Coca-Cola', unit: '750 ml', price: 38, mrp: 40, stock: 100, image: '', tags: ['cold drink', 'soda', 'coke'], description: 'Chilled Coca-Cola bottle' },
        { storeId: 'store_demo_2', name: 'Maggi Noodles', category: 'cat_011', brand: 'Maggi', unit: '4 pack', price: 56, mrp: 60, stock: 200, image: '', tags: ['noodles', 'maggi', 'snacks'], description: 'Maggi 2-Minute Noodles, 4 pack' },
        { storeId: 'store_demo_2', name: 'Parle-G Biscuits', category: 'cat_011', brand: 'Parle', unit: '800 g', price: 75, mrp: 85, stock: 80, image: '', tags: ['biscuit', 'parle-g', 'snack'], description: 'Parle-G Gold biscuits' },
      ];
      // Clear demo products first
      await kiranaProductsCol.deleteMany({ storeId: { $in: ['store_demo_1', 'store_demo_2'] } });
      const docs = products.map(p => ({
        _id: 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + Math.random().toString(36).substr(2,4),
        id: 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + Math.random().toString(36).substr(2,4),
        ...p,
        storeName: p.storeId === 'store_demo_1' ? 'Sharma Kirana Store' : 'Gupta General Store',
        storeArea: 'Hazāribāgh',
        competitors: {
          amazon: p.price * 1.25,
          flipkart: p.price * 1.22,
          jiomart: p.price * 1.18,
          bigbasket: p.price * 1.15,
        },
        rating: 0, totalSold: Math.floor(Math.random() * 50),
        status: 'active',
        createdAt: Date.now(),
      }));
      await kiranaProductsCol.insertMany(docs);
      res.json({ success: true, storesAdded: stores.length, productsAdded: docs.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Initialize
  connectDB_kirana().catch(e => console.error('Kirana init error:', e.message));
};
