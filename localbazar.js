// ============================================================
// LOCAL BAZAR - Hyperlocal "Everything" Delivery
// Like JioMart/Blinkit, but powered by local dukaandars
// Local Bazar = ANY product (grocery, medical, hardware, clothes, etc.)
// ============================================================

module.exports = function(app, db, usersCol, notificationsCol) {
  const crypto = require('crypto');
  const axios = require('axios');

  let localbazarStoresCol, localbazarProductsCol, localbazarOrdersCol, localbazarCategoriesCol;

  async function connectDB_localbazar() {
    localbazarStoresCol = db.collection('localbazarStores');
    localbazarProductsCol = db.collection('localbazarProducts');
    localbazarOrdersCol = db.collection('localbazarOrders');
    localbazarCategoriesCol = db.collection('localbazarCategories');
    await localbazarStoresCol.createIndex({ id: 1 }, { unique: true });
    await localbazarStoresCol.createIndex({ status: 1, area: 1 });
    await localbazarProductsCol.createIndex({ id: 1 }, { unique: true });
    await localbazarProductsCol.createIndex({ storeId: 1, category: 1 });
    await localbazarProductsCol.createIndex({ name: 'text', tags: 'text' });
    await localbazarOrdersCol.createIndex({ id: 1 }, { unique: true });
    await localbazarOrdersCol.createIndex({ customerId: 1, createdAt: -1 });
    await localbazarOrdersCol.createIndex({ storeId: 1, status: 1 });
    await localbazarCategoriesCol.createIndex({ id: 1 }, { unique: true });
    // Seed 25+ categories covering EVERYTHING in a local bazar
    const catCount = await localbazarCategoriesCol.countDocuments();
    if (catCount === 0) {
      const categories = [
        // 🍚 Grocery
        { id: 'cat_grocery_rice', name: '🍚 चावल / आटा / दाल', group: 'grocery', order: 1 },
        { id: 'cat_grocery_oil', name: '🛢️ तेल / मसाले / चीनी', group: 'grocery', order: 2 },
        { id: 'cat_grocery_snacks', name: '🍪 नाश्ता / बिस्किट / नूडल्स', group: 'grocery', order: 3 },
        { id: 'cat_grocery_beverages', name: '🥤 पेय पदार्थ / कोल्ड ड्रिंक', group: 'grocery', order: 4 },
        { id: 'cat_grocery_dairy', name: '🥛 डेयरी / ब्रेड / अंडे', group: 'grocery', order: 5 },
        { id: 'cat_grocery_dryfruits', name: '🥜 मेवे / ड्राई फ्रूट्स', group: 'grocery', order: 6 },
        // 🥬 Fresh
        { id: 'cat_fresh_vegetables', name: '🥬 सब्जियां (ताज़ा)', group: 'fresh', order: 7 },
        { id: 'cat_fresh_fruits', name: '🍎 फल (ताज़ा)', group: 'fresh', order: 8 },
        { id: 'cat_fresh_flowers', name: '💐 फूल / पूजा सामग्री', group: 'fresh', order: 9 },
        // 🏠 Home
        { id: 'cat_home_cleaning', name: '🧹 सफाई / घरेलू सामान', group: 'home', order: 10 },
        { id: 'cat_home_kitchen', name: '🍳 किचन / बर्तन / कुकवेयर', group: 'home', order: 11 },
        { id: 'cat_home_electronics', name: '🔌 इलेक्ट्रॉनिक्स / बिजली सामान', group: 'home', order: 12 },
        { id: 'cat_home_hardware', name: '🔧 हार्डवेयर / पाइप / नट बोल्ट', group: 'home', order: 13 },
        // 🧴 Personal
        { id: 'cat_personal_care', name: '🧴 साबुन / शैम्पू / कॉस्मेटिक', group: 'personal', order: 14 },
        { id: 'cat_personal_health', name: '💊 दवाई / स्वास्थ्य सामान', group: 'personal', order: 15 },
        // 👕 Fashion
        { id: 'cat_fashion_clothes', name: '👕 कपड़े / साड़ी / कुर्ता', group: 'fashion', order: 16 },
        { id: 'cat_fashion_footwear', name: '👟 जूते / चप्पल / सैंडल', group: 'fashion', order: 17 },
        { id: 'cat_fashion_accessories', name: '👜 बैग / बेल्ट / घड़ी / गहने', group: 'fashion', order: 18 },
        // 🍼 Family
        { id: 'cat_baby', name: '🍼 बच्चों के सामान (डायपर/फीड)', group: 'family', order: 19 },
        { id: 'cat_pet', name: '🐕 पालतू जानवर सामान', group: 'family', order: 20 },
        { id: 'cat_stationery', name: '✏️ स्टेशनरी / किताबें', group: 'family', order: 21 },
        // 🔧 Services
        { id: 'cat_services_photo', name: '📸 फोटो / फ्रेमिंग', group: 'services', order: 22 },
        { id: 'cat_services_repair', name: '🛠️ रिपेयर सामान / पुर्जे', group: 'services', order: 23 },
        { id: 'cat_services_others', name: '📦 अन्य सामान', group: 'services', order: 24 },
      ];
      await localbazarCategoriesCol.insertMany(categories);
      console.log('🛒 Seeded 24 Local Bazar categories (ALL items)');
    }
    console.log('🛒 Local Bazar module loaded!');
  }

  // Auto-detect category from product name (Hindi/English)
  function detectCategory(productName) {
    const name = productName.toLowerCase();
    // Map keywords to categories
    const keywordMap = {
      // Grocery
      'चावल': 'cat_grocery_rice', 'चाव': 'cat_grocery_rice', 'rice': 'cat_grocery_rice', 'basmati': 'cat_grocery_rice', 'आटा': 'cat_grocery_rice', 'atta': 'cat_grocery_rice', 'wheat': 'cat_grocery_rice', 'दाल': 'cat_grocery_rice', 'dal': 'cat_grocery_rice', 'बेसन': 'cat_grocery_rice',
      'तेल': 'cat_grocery_oil', 'oil': 'cat_grocery_oil', 'मसाला': 'cat_grocery_oil', 'masala': 'cat_grocery_oil', 'मिर्च': 'cat_grocery_oil', 'हल्दी': 'cat_grocery_oil', 'चीनी': 'cat_grocery_oil', 'sugar': 'cat_grocery_oil', 'नमक': 'cat_grocery_oil', 'salt': 'cat_grocery_oil',
      'बिस्किट': 'cat_grocery_snacks', 'biscuit': 'cat_grocery_snacks', 'नूडल्स': 'cat_grocery_snacks', 'noodles': 'cat_grocery_snacks', 'maggi': 'cat_grocery_snacks', 'चिप्स': 'cat_grocery_snacks', 'chips': 'cat_grocery_snacks', 'नमकीन': 'cat_grocery_snacks',
      'कोल्ड': 'cat_grocery_beverages', 'cold': 'cat_grocery_beverages', 'ड्रिंक': 'cat_grocery_beverages', 'drink': 'cat_grocery_beverages', 'coke': 'cat_grocery_beverages', 'pepsi': 'cat_grocery_beverages', 'fanta': 'cat_grocery_beverages', 'juice': 'cat_grocery_beverages', 'रस': 'cat_grocery_beverages', 'पानी': 'cat_grocery_beverages', 'water': 'cat_grocery_beverages',
      'दूध': 'cat_grocery_dairy', 'milk': 'cat_grocery_dairy', 'डेयरी': 'cat_grocery_dairy', 'dairy': 'cat_grocery_dairy', 'दही': 'cat_grocery_dairy', 'पनीर': 'cat_grocery_dairy', 'मक्खन': 'cat_grocery_dairy', 'butter': 'cat_grocery_dairy', 'अंडे': 'cat_grocery_dairy', 'egg': 'cat_grocery_dairy', 'ब्रेड': 'cat_grocery_dairy', 'bread': 'cat_grocery_dairy',
      'मेवे': 'cat_grocery_dryfruits', 'dry': 'cat_grocery_dryfruits', 'nuts': 'cat_grocery_dryfruits', 'badam': 'cat_grocery_dryfruits', 'kaju': 'cat_grocery_dryfruits', 'pista': 'cat_grocery_dryfruits', 'kishmish': 'cat_grocery_dryfruits',
      // Fresh
      'सब्जी': 'cat_fresh_vegetables', 'vegetable': 'cat_fresh_vegetables', 'प्याज': 'cat_fresh_vegetables', 'आलू': 'cat_fresh_vegetables', 'टमाटर': 'cat_fresh_vegetables', 'tomato': 'cat_fresh_vegetables', 'potato': 'cat_fresh_vegetables', 'onion': 'cat_fresh_vegetables', 'भिंडी': 'cat_fresh_vegetables',
      'फल': 'cat_fresh_fruits', 'fruit': 'cat_fresh_fruits', 'सेब': 'cat_fresh_fruits', 'apple': 'cat_fresh_fruits', 'केला': 'cat_fresh_fruits', 'banana': 'cat_fresh_fruits', 'अमरूद': 'cat_fresh_fruits', 'संतरा': 'cat_fresh_fruits',
      'फूल': 'cat_fresh_flowers', 'flower': 'cat_fresh_flowers', 'पूजा': 'cat_fresh_flowers', 'puja': 'cat_fresh_flowers', 'अगरबत्ती': 'cat_fresh_flowers', 'धूप': 'cat_fresh_flowers',
      // Home
      'सफाई': 'cat_home_cleaning', 'cleaning': 'cat_home_cleaning', 'झाड़ू': 'cat_home_cleaning', 'बाल्टी': 'cat_home_cleaning', 'साबुन': 'cat_home_cleaning', 'detergent': 'cat_home_cleaning',
      'बर्तन': 'cat_home_kitchen', 'किचन': 'cat_home_kitchen', 'kitchen': 'cat_home_kitchen', 'पैन': 'cat_home_kitchen', 'pan': 'cat_home_kitchen', 'कटोरा': 'cat_home_kitchen',
      'बिजली': 'cat_home_electronics', 'electric': 'cat_home_electronics', 'बल्ब': 'cat_home_electronics', 'bulb': 'cat_home_electronics', 'wire': 'cat_home_electronics', 'तार': 'cat_home_electronics', 'switch': 'cat_home_electronics', 'बैटरी': 'cat_home_electronics', 'battery': 'cat_home_electronics',
      'हार्डवेयर': 'cat_home_hardware', 'hardware': 'cat_home_hardware', 'पाइप': 'cat_home_hardware', 'pipe': 'cat_home_hardware', 'नट': 'cat_home_hardware', 'बोल्ट': 'cat_home_hardware', 'हथौड़ा': 'cat_home_hardware', 'hammer': 'cat_home_hardware',
      // Personal
      'शैम्पू': 'cat_personal_care', 'shampoo': 'cat_personal_care', 'क्रीम': 'cat_personal_care', 'cream': 'cat_personal_care', 'परफ्यूम': 'cat_personal_care', 'perfume': 'cat_personal_care', 'तौलिया': 'cat_personal_care', 'toothbrush': 'cat_personal_care',
      'दवाई': 'cat_personal_health', 'दवा': 'cat_personal_health', 'medicine': 'cat_personal_health', 'paracetamol': 'cat_personal_health', 'crocin': 'cat_personal_health', 'dolo': 'cat_personal_health', 'aspirin': 'cat_personal_health', 'tablet': 'cat_personal_health', 'capsule': 'cat_personal_health', 'injection': 'cat_personal_health', 'syrup': 'cat_personal_health', 'tablet': 'cat_personal_health', 'गोली': 'cat_personal_health', 'syrup': 'cat_personal_health', 'कैप्सूल': 'cat_personal_health', 'first': 'cat_personal_health', 'aid': 'cat_personal_health',
      // Fashion
      'कपड़ा': 'cat_fashion_clothes', 'कपड़े': 'cat_fashion_clothes', 'cloth': 'cat_fashion_clothes', 'शर्ट': 'cat_fashion_clothes', 'shirt': 'cat_fashion_clothes', 'पैंट': 'cat_fashion_clothes', 'pant': 'cat_fashion_clothes', 'साड़ी': 'cat_fashion_clothes', 'saree': 'cat_fashion_clothes', 'कुर्ता': 'cat_fashion_clothes', 't-shirt': 'cat_fashion_clothes',
      'जूता': 'cat_fashion_footwear', 'shoe': 'cat_fashion_footwear', 'चप्पल': 'cat_fashion_footwear', 'sandal': 'cat_fashion_footwear', 'सैंडल': 'cat_fashion_footwear',
      'बैग': 'cat_fashion_accessories', 'bag': 'cat_fashion_accessories', 'बेल्ट': 'cat_fashion_accessories', 'belt': 'cat_fashion_accessories', 'घड़ी': 'cat_fashion_accessories', 'watch': 'cat_fashion_accessories', 'गहना': 'cat_fashion_accessories',
      // Family
      'बच्चा': 'cat_baby', 'baby': 'cat_baby', 'डायपर': 'cat_baby', 'diaper': 'cat_baby', 'फीड': 'cat_baby', 'cerelac': 'cat_baby', 'toy': 'cat_baby', 'खिलौना': 'cat_baby',
      'pet': 'cat_pet', 'dog': 'cat_pet', 'कुत्ता': 'cat_pet', 'बिल्ली': 'cat_pet', 'cat food': 'cat_pet',
      'किताब': 'cat_stationery', 'book': 'cat_stationery', 'पेन': 'cat_stationery', 'pen': 'cat_stationery', 'पेंसिल': 'cat_stationery', 'pencil': 'cat_stationery', 'copy': 'cat_stationery',
    };
    for (const [keyword, cat] of Object.entries(keywordMap)) {
      if (name.includes(keyword.toLowerCase())) return cat;
    }
    return null;  // User will select manually
  }

  // ============================================================
  // STORES, PRODUCTS, ORDERS (same as before)
  // ============================================================
  app.post('/api/localbazar/stores/register', async (req, res) => {
    try {
      const { ownerId, name, ownerName, phone, address, area, city, pincode, lat, lng, deliveryRadius, openTime, closeTime, storeType } = req.body;
      if (!ownerId || !name || !phone || !address || !area) {
        return res.status(400).json({ error: 'ownerId, name, phone, address, area required' });
      }
      const storeId = 'store_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const store = {
        _id: storeId, id: storeId, ownerId,
        name: String(name).trim(),
        ownerName: String(ownerName || '').trim(),
        phone: String(phone).trim(),
        address: String(address).trim(),
        area: String(area).trim(),
        city: String(city || '').trim(),
        pincode: String(pincode || '').trim(),
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        deliveryRadius: parseFloat(deliveryRadius) || 5,
        openTime: openTime || '07:00',
        closeTime: closeTime || '22:00',
        storeType: storeType || 'general',  // 'general' | 'grocery' | 'medical' | 'hardware' etc.
        rating: 0, totalOrders: 0, totalReviews: 0,
        status: 'active', minOrder: 0, deliveryFee: 0,
        avgDeliveryMins: 25,
        joinedAt: Date.now(),
      };
      await localbazarStoresCol.insertOne(store);
      const { _id, ...result } = store;
      res.json({ success: true, store: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/stores', async (req, res) => {
    try {
      const { area, city, status, ownerId, lat, lng, radius, storeType } = req.query;
      const query = {};
      if (area) query.area = area;
      if (city) query.city = city;
      if (status) query.status = status;
      else query.status = 'active';
      if (ownerId) query.ownerId = ownerId;
      if (storeType) query.storeType = storeType;
      const stores = await localbazarStoresCol.find(query).limit(50).toArray();
      let result = stores;
      if (lat && lng) {
        const lat1 = parseFloat(lat), lng1 = parseFloat(lng);
        const maxDist = parseFloat(radius) || 10;
        result = stores.map(s => {
          if (!s.lat || !s.lng) return { ...s, distance: null };
          const R = 6371;
          const dLat = (s.lat - lat1) * Math.PI / 180;
          const dLng = (s.lng - lng1) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(s.lat*Math.PI/180) * Math.sin(dLng/2)**2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          return { ...s, distance: R * c };
        }).filter(s => !s.distance || s.distance <= maxDist)
          .sort((a, b) => (a.distance || 999) - (b.distance || 999));
      }
      res.json({ success: true, count: result.length, stores: result.map(s => { const { _id, ...r } = s; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/stores/:id', async (req, res) => {
    try {
      const store = await localbazarStoresCol.findOne({ id: req.params.id });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      const { _id, ...r } = store;
      res.json({ success: true, store: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/localbazar/stores/:id', async (req, res) => {
    try {
      const updates = req.body;
      delete updates._id; delete updates.id; delete updates.ownerId;
      const result = await localbazarStoresCol.updateOne({ id: req.params.id }, { $set: updates });
      res.json({ success: true, modified: result.modifiedCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/categories', async (req, res) => {
    try {
      const cats = await localbazarCategoriesCol.find({}).sort({ order: 1 }).toArray();
      res.json({ success: true, categories: cats.map(c => { const { _id, ...r } = c; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Admin: reset categories to latest (24 categories)
  app.post('/api/localbazar/reset-categories', async (req, res) => {
    try {
      await localbazarCategoriesCol.deleteMany({});
      const categories = [
        { id: 'cat_grocery_rice', name: '🍚 चावल / आटा / दाल', group: 'grocery', order: 1 },
        { id: 'cat_grocery_oil', name: '🛢️ तेल / मसाले / चीनी', group: 'grocery', order: 2 },
        { id: 'cat_grocery_snacks', name: '🍪 नाश्ता / बिस्किट / नूडल्स', group: 'grocery', order: 3 },
        { id: 'cat_grocery_beverages', name: '🥤 पेय पदार्थ / कोल्ड ड्रिंक', group: 'grocery', order: 4 },
        { id: 'cat_grocery_dairy', name: '🥛 डेयरी / ब्रेड / अंडे', group: 'grocery', order: 5 },
        { id: 'cat_grocery_dryfruits', name: '🥜 मेवे / ड्राई फ्रूट्स', group: 'grocery', order: 6 },
        { id: 'cat_fresh_vegetables', name: '🥬 सब्जियां (ताज़ा)', group: 'fresh', order: 7 },
        { id: 'cat_fresh_fruits', name: '🍎 फल (ताज़ा)', group: 'fresh', order: 8 },
        { id: 'cat_fresh_flowers', name: '💐 फूल / पूजा सामग्री', group: 'fresh', order: 9 },
        { id: 'cat_home_cleaning', name: '🧹 सफाई / घरेलू सामान', group: 'home', order: 10 },
        { id: 'cat_home_kitchen', name: '🍳 किचन / बर्तन / कुकवेयर', group: 'home', order: 11 },
        { id: 'cat_home_electronics', name: '🔌 इलेक्ट्रॉनिक्स / बिजली सामान', group: 'home', order: 12 },
        { id: 'cat_home_hardware', name: '🔧 हार्डवेयर / पाइप / नट बोल्ट', group: 'home', order: 13 },
        { id: 'cat_personal_care', name: '🧴 साबुन / शैम्पू / कॉस्मेटिक', group: 'personal', order: 14 },
        { id: 'cat_personal_health', name: '💊 दवाई / स्वास्थ्य सामान', group: 'personal', order: 15 },
        { id: 'cat_fashion_clothes', name: '👕 कपड़े / साड़ी / कुर्ता', group: 'fashion', order: 16 },
        { id: 'cat_fashion_footwear', name: '👟 जूते / चप्पल / सैंडल', group: 'fashion', order: 17 },
        { id: 'cat_fashion_accessories', name: '👜 बैग / बेल्ट / घड़ी / गहने', group: 'fashion', order: 18 },
        { id: 'cat_baby', name: '🍼 बच्चों के सामान (डायपर/फीड)', group: 'family', order: 19 },
        { id: 'cat_pet', name: '🐕 पालतू जानवर सामान', group: 'family', order: 20 },
        { id: 'cat_stationery', name: '✏️ स्टेशनरी / किताबें', group: 'family', order: 21 },
        { id: 'cat_services_photo', name: '📸 फोटो / फ्रेमिंग', group: 'services', order: 22 },
        { id: 'cat_services_repair', name: '🛠️ रिपेयर सामान / पुर्जे', group: 'services', order: 23 },
        { id: 'cat_services_others', name: '📦 अन्य सामान', group: 'services', order: 24 },
      ];
      await localbazarCategoriesCol.insertMany(categories);
      res.json({ success: true, count: categories.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Products
  app.post('/api/localbazar/products', async (req, res) => {
    try {
      const { storeId, name, category, unit, price, mrp, stock, image, brand, tags, description } = req.body;
      if (!storeId || !name || !price) return res.status(400).json({ error: 'storeId, name, price required' });
      const store = await localbazarStoresCol.findOne({ id: storeId });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      // Auto-detect category if not provided or generic
      let finalCategory = category;
      if (!finalCategory || finalCategory === 'cat_011') {
        const detected = detectCategory(name);
        if (detected) finalCategory = detected;
      }
      const productId = 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const product = {
        _id: productId, id: productId,
        storeId, storeName: store.name, storeArea: store.area,
        name: String(name).trim(),
        category: finalCategory || 'cat_services_others',
        brand: brand || '',
        unit: unit || '1 pc',
        price: parseFloat(price),
        mrp: parseFloat(mrp) || parseFloat(price),
        stock: parseInt(stock) || 0,
        image: image || '',
        tags: tags || [],
        description: description || '',
        competitors: {
          amazon: parseFloat(price) * 1.25,
          flipkart: parseFloat(price) * 1.22,
          jiomart: parseFloat(price) * 1.18,
          bigbasket: parseFloat(price) * 1.15,
        },
        rating: 0, totalSold: 0,
        status: 'active',
        createdAt: Date.now(),
      };
      await localbazarProductsCol.insertOne(product);
      const { _id, ...result } = product;
      res.json({ success: true, product: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/localbazar/products/bulk', async (req, res) => {
    try {
      const { products } = req.body;
      if (!Array.isArray(products) || products.length === 0) return res.status(400).json({ error: 'products array required' });
      const docs = products.map(p => ({
        _id: 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + Math.random().toString(36).substr(2,4),
        id: 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + Math.random().toString(36).substr(2,4),
        ...p,
        competitors: p.competitors || {
          amazon: (p.price || 0) * 1.25, flipkart: (p.price || 0) * 1.22,
          jiomart: (p.price || 0) * 1.18, bigbasket: (p.price || 0) * 1.15,
        },
        rating: 0, totalSold: 0, status: 'active', createdAt: Date.now(),
      }));
      await localbazarProductsCol.insertMany(docs);
      res.json({ success: true, count: docs.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/products', async (req, res) => {
    try {
      const { storeId, category, search, limit, minPrice, maxPrice, sort, storeArea, group } = req.query;
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
      let products = await localbazarProductsCol.find(query).sort(sortBy).limit(lim).toArray();
      // Filter by group if specified
      if (group) {
        const catIds = products.map(p => p.category).filter(Boolean);
        const catDetails = await localbazarCategoriesCol.find({ id: { $in: catIds } }).toArray();
        const validCats = new Set(catDetails.filter(c => c.group === group).map(c => c.id));
        products = products.filter(p => validCats.has(p.category));
      }
      res.json({ success: true, count: products.length, products: products.map(p => { const { _id, ...r } = p; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/products/:id', async (req, res) => {
    try {
      const product = await localbazarProductsCol.findOne({ id: req.params.id });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const { _id, ...r } = product;
      res.json({ success: true, product: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/search', async (req, res) => {
    try {
      const { q, limit } = req.query;
      if (!q) return res.json({ success: true, results: [] });
      const lim = Math.min(parseInt(limit) || 20, 50);
      const products = await localbazarProductsCol.find({
        status: 'active',
        $or: [
          { name: { $regex: '^' + q, $options: 'i' } },
          { name: { $regex: q, $options: 'i' } },
          { brand: { $regex: q, $options: 'i' } },
        ]
      }).limit(lim).toArray();
      res.json({ success: true, count: products.length, results: products.map(p => { const { _id, ...r } = p; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Orders
  app.post('/api/localbazar/orders', async (req, res) => {
    try {
      const { customerId, storeId, items, address, lat, lng, paymentMethod, notes } = req.body;
      if (!customerId || !storeId || !items || !items.length || !address) return res.status(400).json({ error: 'customerId, storeId, items, address required' });
      const store = await localbazarStoresCol.findOne({ id: storeId });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      let total = 0;
      const enrichedItems = [];
      for (const item of items) {
        const product = await localbazarProductsCol.findOne({ id: item.productId });
        if (!product) continue;
        const qty = parseInt(item.quantity) || 1;
        const subtotal = product.price * qty;
        total += subtotal;
        enrichedItems.push({
          productId: product.id, name: product.name, unit: product.unit,
          price: product.price, mrp: product.mrp, quantity: qty, subtotal: subtotal,
        });
      }
      if (enrichedItems.length === 0) return res.status(400).json({ error: 'No valid items' });
      const orderId = 'ord_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const order = {
        _id: orderId, id: orderId,
        customerId, storeId, storeName: store.name, storePhone: store.phone,
        items: enrichedItems, subtotal: total, deliveryFee: 0, total: total,
        address: address, lat: parseFloat(lat) || 0, lng: parseFloat(lng) || 0,
        paymentMethod: paymentMethod || 'cod', notes: notes || '',
        status: 'placed', statusHistory: [{ status: 'placed', at: Date.now() }],
        estimatedDeliveryAt: Date.now() + (store.avgDeliveryMins || 25) * 60 * 1000,
        createdAt: Date.now(),
      };
      await localbazarOrdersCol.insertOne(order);
      await localbazarStoresCol.updateOne({ id: storeId }, { $inc: { totalOrders: 1 } });
      for (const item of enrichedItems) {
        await localbazarProductsCol.updateOne({ id: item.productId }, { $inc: { totalSold: item.quantity, stock: -item.quantity } });
      }
      await notificationsCol.insertOne({
        _id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        userId: store.ownerId, type: 'new_order', targetType: 'order', targetId: orderId,
        message: '🛒 New order #' + orderId.slice(-6) + ' for ₹' + total.toFixed(0) + '!',
        read: false, createdAt: Date.now(),
      });
      const { _id, ...result } = order;
      res.json({ success: true, order: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/orders', async (req, res) => {
    try {
      const { customerId, storeId, status, limit } = req.query;
      const query = {};
      if (customerId) query.customerId = customerId;
      if (storeId) query.storeId = storeId;
      if (status) query.status = status;
      const lim = Math.min(parseInt(limit) || 30, 100);
      const orders = await localbazarOrdersCol.find(query).sort({ createdAt: -1 }).limit(lim).toArray();
      res.json({ success: true, count: orders.length, orders: orders.map(o => { const { _id, ...r } = o; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/orders/:id', async (req, res) => {
    try {
      const order = await localbazarOrdersCol.findOne({ id: req.params.id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const { _id, ...r } = order;
      res.json({ success: true, order: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/localbazar/orders/:id/status', async (req, res) => {
    try {
      const { status, notes } = req.body;
      const validStatuses = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const order = await localbazarOrdersCol.findOne({ id: req.params.id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const statusHistory = order.statusHistory || [];
      statusHistory.push({ status, at: Date.now(), notes: notes || '' });
      const update = { status, statusHistory };
      if (status === 'delivered') update.deliveredAt = Date.now();
      await localbazarOrdersCol.updateOne({ id: req.params.id }, { $set: update });
      await notificationsCol.insertOne({
        _id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        userId: order.customerId, type: 'order_update', targetType: 'order', targetId: order.id,
        message: '📦 Order #' + order.id.slice(-6) + ' is now ' + status.replace('_', ' ').toUpperCase(),
        read: false, createdAt: Date.now(),
      });
      res.json({ success: true, status });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Compare
  app.get('/api/localbazar/compare/:productId', async (req, res) => {
    try {
      const product = await localbazarProductsCol.findOne({ id: req.params.productId });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const ourPrice = product.price;
      const comparison = {
        product: { id: product.id, name: product.name, unit: product.unit, brand: product.brand },
        prices: {
          localbazar: { price: ourPrice, available: true, deliveryMins: 25 },
          amazon: { price: product.competitors?.amazon || ourPrice * 1.25, available: true, deliveryMins: 1440, source: 'estimated' },
          flipkart: { price: product.competitors?.flipkart || ourPrice * 1.22, available: true, deliveryMins: 1440, source: 'estimated' },
          jiomart: { price: product.competitors?.jiomart || ourPrice * 1.18, available: true, deliveryMins: 1440, source: 'estimated' },
          bigbasket: { price: product.competitors?.bigbasket || ourPrice * 1.15, available: true, deliveryMins: 1440, source: 'estimated' },
        },
        savings: {},
      };
      Object.keys(comparison.prices).forEach(platform => {
        const other = comparison.prices[platform].price;
        if (platform !== 'localbazar') {
          comparison.savings[platform] = {
            perUnit: Math.round((other - ourPrice) * 100) / 100,
            perUnitPct: Math.round(((other - ourPrice) / other) * 100),
          };
        }
      });
      let maxSavings = { platform: 'none', perUnit: 0, perUnitPct: 0 };
      Object.entries(comparison.savings).forEach(([p, s]) => {
        if (s.perUnit > maxSavings.perUnit) maxSavings = { platform: p, perUnit: s.perUnit, perUnitPct: s.perUnitPct };
      });
      comparison.bestSavings = maxSavings;
      res.json({ success: true, comparison });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/stats', async (req, res) => {
    try {
      const [totalStores, activeStores, totalProducts, totalOrders, todaysOrders, totalCategories] = await Promise.all([
        localbazarStoresCol.countDocuments(),
        localbazarStoresCol.countDocuments({ status: 'active' }),
        localbazarProductsCol.countDocuments({ status: 'active' }),
        localbazarOrdersCol.countDocuments(),
        localbazarOrdersCol.countDocuments({ createdAt: { $gte: new Date().setHours(0,0,0,0) } }),
        localbazarCategoriesCol.countDocuments(),
      ]);
      const allOrders = await localbazarOrdersCol.find({ status: 'delivered' }).toArray();
      const totalRevenue = allOrders.reduce((s, o) => s + (o.total || 0), 0);
      const products = await localbazarProductsCol.find({ status: 'active' }).limit(100).toArray();
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
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // AI-ASSISTED ONBOARDING WIZARD (Hindi, Flexible, with STOP option)
  // ============================================================
  const wizardSessions = {};

  app.post('/api/localbazar/wizard/start', async (req, res) => {
    try {
      const { sessionId, phone, name } = req.body;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      let user = null;
      if (phone) user = await usersCol.findOne({ phone: phone });
      if (!user && name) {
        const userId = 'u_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
        user = {
          _id: userId, id: userId, sessionId, name: String(name).trim(),
          phone: phone || '', role: 'localbazar-dukandar',
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ff6b35&color=fff&bold=true&size=200`,
          joinedAt: Date.now(), lastSeen: Date.now(),
          onboardingComplete: false, storeId: null,
        };
        await usersCol.insertOne(user);
      }
      let wiz = wizardSessions[sessionId];
      if (!wiz) {
        wiz = {
          step: 0, language: 'hi', complete: false,
          data: {
            ownerName: user?.name || name || '', phone: user?.phone || phone || '',
            storeName: '', ownerPhone: user?.phone || phone || '',
            address: '', area: '', city: '', pincode: '',
            deliveryRadius: 3, openTime: '07:00', closeTime: '22:00',
            productCount: 0, storeId: null, storeType: 'general',
          },
          messages: [], userId: user?.id || null,
        };
        wizardSessions[sessionId] = wiz;
      }
      const welcomeMsg = {
        role: 'assistant',
        text: '🙏 नमस्ते! मैं Local Bazar सहायक हूँ।\n\n✅ मैं आपकी दुकान ऑनलाइन लाने में मदद करूँगा।\n\n🎯 सिर्फ सवालों के जवाब दें, बाकी मैं सब कर दूँगा।\n\n📝 पहला सवाल:\nआपकी दुकान का नाम क्या है?\n(जैसे: शर्मा किराना, गुप्ता जनरल स्टोर, मेडिकल स्टोर)',
        options: null, step: 0,
      };
      wiz.messages = [welcomeMsg];
      wiz.step = 0;
      res.json({ success: true, wizard: { step: wiz.step, message: welcomeMsg, data: wiz.data } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/localbazar/wizard/message', async (req, res) => {
    try {
      const { sessionId, message } = req.body;
      if (!sessionId || !message) return res.status(400).json({ error: 'sessionId, message required' });
      const wiz = wizardSessions[sessionId];
      if (!wiz) return res.status(404).json({ error: 'Wizard not started. Call /wizard/start first' });
      wiz.messages.push({ role: 'user', text: message });
      const result = await processWizardStep(wiz, message);
      if (wiz.complete && result.redirect) result.redirect = result.redirect;
      res.json({ success: true, response: result, data: wiz.data, complete: wiz.complete || false });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/localbazar/wizard/option', async (req, res) => {
    try {
      const { sessionId, option } = req.body;
      if (!sessionId || !option) return res.status(400).json({ error: 'sessionId, option required' });
      const wiz = wizardSessions[sessionId];
      if (!wiz) return res.status(404).json({ error: 'Wizard not started' });
      wiz.messages.push({ role: 'user', text: option });
      const result = await processWizardStep(wiz, option);
      res.json({ success: true, response: result, data: wiz.data, complete: wiz.complete || false });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/localbazar/wizard/:sessionId', async (req, res) => {
    const wiz = wizardSessions[req.params.sessionId];
    if (!wiz) return res.status(404).json({ error: 'Wizard not started' });
    res.json({ success: true, step: wiz.step, messages: wiz.messages, data: wiz.data, complete: wiz.complete || false });
  });

  // End wizard early (user clicked Save & Exit)
  app.post('/api/localbazar/wizard/complete', async (req, res) => {
    const { sessionId } = req.body;
    const wiz = wizardSessions[sessionId];
    if (!wiz) return res.status(404).json({ error: 'Wizard not started' });
    wiz.complete = true;
    wiz.messages.push({ role: 'user', text: '🛑 बस! / Save & Exit' });
    wiz.messages.push({ role: 'assistant', text: '✅ ठीक है! आपकी दुकान तैयार है। बाद में product जोड़ सकते हैं।\n\n🏠 अब dashboard देखें: /localbazar-dukandar.html' });
    res.json({ success: true, complete: true, storeId: wiz.data.storeId, redirect: '/localbazar-dukandar.html' });
  });

  async function processWizardStep(wiz, userInput) {
    const step = wiz.step;
    const input = (userInput || '').trim();
    let response = null;
    let nextStep = step;
    let complete = false;

    // Universal STOP keywords - exit anytime
    const stopKeywords = ['बस', 'बस!', 'रुको', 'stop', 'exit', 'बाद में', 'save', 'done', 'ho gaya', 'पूरा', 'खत्म', 'khatam', 'bas'];
    if (step >= 9 && stopKeywords.some(kw => input.toLowerCase().includes(kw.toLowerCase()))) {
      complete = true;
      response = {
        text: '✅ ठीक है! आपकी दुकान तैयार है।\n\n🏠 Dashboard पर जाएं: /localbazar-dukandar.html\n\n📦 Products बाद में भी जोड़ सकते हैं।',
        options: null, redirect: '/localbazar-dukandar.html',
        storeId: wiz.data.storeId, complete: true,
      };
      wiz.step = nextStep;
      wiz.messages.push({ role: 'assistant', text: response.text });
      wiz.complete = true;
      return response;
    }

    switch (step) {
      case 0:  // Store name
        if (input.length < 2) {
          response = { text: '⚠️ कृपया दुकान का सही नाम लिखें (कम से कम 2 अक्षर)', options: null };
        } else {
          wiz.data.storeName = input;
          nextStep = 1;
          response = {
            text: '✅ बढ़िया! "' + input + '" एक अच्छा नाम है।\n\n📍 अब अपनी दुकान का पूरा पता बताइए:\n(जैसे: मेन बाजार, हजारीबाग)',
            options: null,
          };
        }
        break;
      case 1:
        if (input.length < 5) {
          response = { text: '⚠️ कृपया पूरा पता लिखें', options: null };
        } else {
          wiz.data.address = input;
          nextStep = 2;
          response = { text: '📝 अपना क्षेत्र/मोहल्ला बताइए:\n(जैसे: बस स्टैंड के पास, पुराना बाजार)', options: null };
        }
        break;
      case 2:
        if (input.length < 2) {
          response = { text: '⚠️ कृपया क्षेत्र का नाम लिखें', options: null };
        } else {
          wiz.data.area = input;
          nextStep = 3;
          response = { text: '🏙️ अपना शहर बताइए:', options: null };
        }
        break;
      case 3:
        if (input.length < 2) {
          response = { text: '⚠️ कृपया शहर का नाम लिखें', options: null };
        } else {
          wiz.data.city = input;
          nextStep = 4;
          response = { text: '📮 पिनकोड (6 अंक):', options: null };
        }
        break;
      case 4:
        if (!/^\d{6}$/.test(input)) {
          response = { text: '⚠️ कृपया सही 6 अंकों का पिनकोड लिखें', options: null };
        } else {
          wiz.data.pincode = input;
          nextStep = 5;
          response = { text: '⏰ दुकान कब खुलती है? (जैसे: सुबह 7 बजे)', options: ['सुबह 6 बजे', 'सुबह 7 बजे', 'सुबह 8 बजे', 'सुबह 9 बजे', 'सुबह 10 बजे'] };
        }
        break;
      case 5:
        const timeMap = { 'सुबह 6 बजे': '06:00', 'सुबह 7 बजे': '07:00', 'सुबह 8 बजे': '08:00', 'सुबह 9 बजे': '09:00', 'सुबह 10 बजे': '10:00' };
        wiz.data.openTime = timeMap[input] || input;
        nextStep = 6;
        response = { text: '🌙 दुकान कब बंद होती है?', options: ['रात 8 बजे', 'रात 9 बजे', 'रात 10 बजे', 'रात 11 बजे'] };
        break;
      case 6:
        const closeMap = { 'रात 8 बजे': '20:00', 'रात 9 बजे': '21:00', 'रात 10 बजे': '22:00', 'रात 11 बजे': '23:00' };
        wiz.data.closeTime = closeMap[input] || input;
        nextStep = 7;
        response = { text: '🚚 कितने किलोमीटर तक डिलीवरी?', options: ['2 km', '3 km', '5 km', '7 km', '10 km'] };
        break;
      case 7:
        const radiusMap = { '2 km': 2, '3 km': 3, '5 km': 5, '7 km': 7, '10 km': 10 };
        wiz.data.deliveryRadius = radiusMap[input] || 5;
        nextStep = 8;
        response = { text: '🎉 बहुत बढ़िया! अब मैं आपकी दुकान बना देता हूँ।\n\n⏳ कृपया 5 सेकंड प्रतीक्षा करें...', options: null };
        // Create the store
        try {
          const storeId = 'store_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
          const store = {
            _id: storeId, id: storeId,
            ownerId: wiz.userId || ('anon_' + Date.now()),
            ownerName: wiz.data.ownerName || wiz.data.phone || 'Owner',
            name: wiz.data.storeName, phone: wiz.data.phone,
            address: wiz.data.address, area: wiz.data.area, city: wiz.data.city, pincode: wiz.data.pincode,
            lat: 0, lng: 0, deliveryRadius: wiz.data.deliveryRadius,
            openTime: wiz.data.openTime, closeTime: wiz.data.closeTime,
            storeType: wiz.data.storeType || 'general',
            rating: 0, totalOrders: 0, totalReviews: 0,
            status: 'active', minOrder: 0, deliveryFee: 0, avgDeliveryMins: 25,
            joinedAt: Date.now(),
          };
          await localbazarStoresCol.insertOne(store);
          wiz.data.storeId = storeId;
          if (wiz.userId) {
            await usersCol.updateOne({ id: wiz.userId }, { $set: { storeId: storeId, onboardingComplete: true, role: 'localbazar-dukandar' } });
          }
          nextStep = 9;
          response = {
            text: '✅ आपकी दुकान "' + wiz.data.storeName + '" सफलतापूर्वक बन गई! 🎉\n\n📦 अब products जोड़ सकते हैं (या बाद में भी कर सकते हैं)।\n\n💡 हर product के लिए सिर्फ नाम, कीमत, और quantity बताइए - बाकी मैं सब कर दूँगा!\n\n⏱️ 5 min में पूरा हो जाएगा!',
            options: ['हाँ, अभी products जोड़ें!', 'बाद में करूँगा (Skip)'],
            storeId: storeId, storeName: wiz.data.storeName,
          };
        } catch (e) {
          response = { text: '❌ दुकान बनाने में error: ' + e.message, options: null };
        }
        break;
      case 9:  // Add products? OR done?
        if (input.toLowerCase().match(/(बाद|नहीं|skip|baad|nahi|no|done|बस|ho gaya|पूरा|खत्म|khatam|bas)/)) {
          // Skip products
          complete = true;
          response = {
            text: '✅ ठीक है! आपकी दुकान तैयार है।\n\n📦 Products बाद में जोड़ सकते हैं dashboard से।\n\n🏠 Dashboard: /localbazar-dukandar.html',
            options: null, redirect: '/localbazar-dukandar.html',
            storeId: wiz.data.storeId,
          };
        } else {
          nextStep = 10;
          response = {
            text: '✅ शानदार! पहले product का नाम बताइए:\n\n💡 सुझाव: कुछ भी - "चावल", "दवाई", "बैटरी", "कपड़ा" - मैं खुद category पहचान लूँगा!',
            options: null, productsAdded: 0,
          };
        }
        break;
      case 10:  // Product name + auto-detect category
        if (input.length < 2) {
          response = { text: '⚠️ कृपया product का सही नाम लिखें', options: null };
        } else {
          // Auto-detect category from name
          const detectedCat = detectCategory(input);
          wiz.data.currentProduct = { name: input, category: detectedCat };
          if (detectedCat) {
            // Skip category question, go to price
            nextStep = 11;
            response = {
              text: '✅ "' + input + '" note kiya! Mene automatic category detect kar liya.\n\n💰 Ab iski keemat bataiye (rupaye mein):\nJaise: 150 (150 rupaye)',
              options: null,
              autoCategory: detectedCat,
            };
          } else {
            nextStep = 10.5;  // Show category options
            response = {
              text: '📦 "' + input + '" - kis category me hai?',
              options: [
                '🍚 चावल/आटा/दाल', '🛢️ तेल/मसाले', '🥛 डेयरी/ब्रेड',
                '🥬 सब्जियां/फल', '🥤 पेय/नाश्ता', '💊 दवाई/स्वास्थ्य',
                '🧴 साबुन/कॉस्मेटिक', '👕 कपड़े/जूते', '🔧 हार्डवेयर/इलेक्ट्रॉनिक्स',
                '🧹 घरेलू सामान', '🍼 बच्चों के सामान', '✏️ स्टेशनरी', '📦 अन्य',
              ],
            };
          }
        }
        break;
      case 10.5:  // Category selection
        const catMap10 = {
          '🍚 चावल/आटा/दाल': 'cat_grocery_rice', '🛢️ तेल/मसाले': 'cat_grocery_oil',
          '🥛 डेयरी/ब्रेड': 'cat_grocery_dairy', '🥬 सब्जियां/फल': 'cat_fresh_vegetables',
          '🥤 पेय/नाश्ता': 'cat_grocery_beverages', '💊 दवाई/स्वास्थ्य': 'cat_personal_health',
          '🧴 साबुन/कॉस्मेटिक': 'cat_personal_care', '👕 कपड़े/जूते': 'cat_fashion_clothes',
          '🔧 हार्डवेयर/इलेक्ट्रॉनिक्स': 'cat_home_hardware', '🧹 घरेलू सामान': 'cat_home_cleaning',
          '🍼 बच्चों के सामान': 'cat_baby', '✏️ स्टेशनरी': 'cat_stationery', '📦 अन्य': 'cat_services_others',
        };
        wiz.data.currentProduct.category = catMap10[input] || 'cat_services_others';
        nextStep = 11;
        response = { text: '💰 "' + wiz.data.currentProduct.name + '" ki keemat?\nJaise: 150 (rupaye)', options: null };
        break;
      case 11:  // Price
        const price = parseFloat(input.replace(/[^\d.]/g, ''));
        if (isNaN(price) || price <= 0) {
          response = { text: '⚠️ कृपया सही कीमत लिखें (संख्या में, जैसे 150)', options: null };
        } else {
          wiz.data.currentProduct.price = price;
          wiz.data.currentProduct.mrp = Math.round(price * 1.2);
          nextStep = 12;
          response = { text: '📏 Kitna weight/size hai? (jaise: 1 kg, 1 L, 1 dozen, 1 pc)', options: null };
        }
        break;
      case 12:  // Unit
        wiz.data.currentProduct.unit = input || '1 pc';
        nextStep = 13;
        response = { text: '📊 Kitna stock hai? (kitne pieces available hain)\n\nJaise: 50, ya options me se choose karein:', options: ['10', '25', '50', '100', '200+'] };
        break;
      case 13:  // Stock + save
        const stock = parseInt(input) || 10;
        try {
          const productId = 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
          const product = {
            _id: productId, id: productId,
            storeId: wiz.data.storeId,
            storeName: wiz.data.storeName,
            storeArea: wiz.data.area,
            name: wiz.data.currentProduct.name,
            category: wiz.data.currentProduct.category,
            unit: wiz.data.currentProduct.unit,
            price: wiz.data.currentProduct.price,
            mrp: wiz.data.currentProduct.mrp,
            stock: stock,
            image: '', tags: [], description: '',
            competitors: {
              amazon: wiz.data.currentProduct.price * 1.25,
              flipkart: wiz.data.currentProduct.price * 1.22,
              jiomart: wiz.data.currentProduct.price * 1.18,
              bigbasket: wiz.data.currentProduct.price * 1.15,
            },
            rating: 0, totalSold: 0, status: 'active', createdAt: Date.now(),
          };
          await localbazarProductsCol.insertOne(product);
          wiz.data.productCount = (wiz.data.productCount || 0) + 1;
          // Back to "add more?" step
          nextStep = 9;
          const totalAdded = wiz.data.productCount;
          response = {
            text: '✅ "' + product.name + '" successfully add ho gaya! 🎉\n\n📦 Aapne ab tak ' + totalAdded + ' product add kiya hai.\n\n💡 Aur product jodna hai ya yahin pe rukna hai?',
            options: [
              '➕ Aur jodo (next product)',
              '⏭️ Aur 4 jodo (quick mode)',
              '✅ Bas! Dashboard pe jao (Save & Exit)',
            ],
            productAdded: product.name,
          };
        } catch (e) {
          response = { text: '❌ Product add karne me error: ' + e.message, options: null };
        }
        break;
    }
    wiz.step = nextStep;
    wiz.messages.push({ role: 'assistant', text: response.text });
    if (complete) wiz.complete = true;
    return response;
  }

  // Endpoints for store orders
  app.get('/api/localbazar/store/:storeId/orders', async (req, res) => {
    try {
      const { status, limit } = req.query;
      const query = { storeId: req.params.storeId };
      if (status) query.status = status;
      const lim = Math.min(parseInt(limit) || 50, 200);
      const orders = await localbazarOrdersCol.find(query).sort({ createdAt: -1 }).limit(lim).toArray();
      res.json({ success: true, count: orders.length, orders: orders.map(o => { const { _id, ...r } = o; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/localbazar/orders/:id/delivery', async (req, res) => {
    try {
      const { status, deliveryNotes, otp } = req.body;
      const order = await localbazarOrdersCol.findOne({ id: req.params.id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const update = { status, updatedAt: Date.now() };
      const statusHistory = order.statusHistory || [];
      statusHistory.push({ status, at: Date.now(), notes: deliveryNotes || '', otp: otp || '' });
      update.statusHistory = statusHistory;
      if (status === 'delivered') {
        update.deliveredAt = Date.now();
        update.deliveryOtp = otp;
      }
      if (status === 'cancelled') {
        update.cancelledAt = Date.now();
        update.cancellationReason = deliveryNotes || '';
      }
      await localbazarOrdersCol.updateOne({ id: req.params.id }, { $set: update });
      await notificationsCol.insertOne({
        _id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        id: 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
        userId: order.customerId, type: 'order_update', targetType: 'order', targetId: order.id,
        message: '📦 Order #' + order.id.slice(-6) + ': ' + status.replace('_', ' ').toUpperCase(),
        read: false, createdAt: Date.now(),
      });
      res.json({ success: true, status });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Demo seeder (with diverse categories for ALL Local Bazar items)
  app.post('/api/localbazar/seed-demo', async (req, res) => {
    try {
      const stores = [
        { id: 'store_demo_1', ownerId: 'demo_owner_1', name: 'Sharma Local Bazar Store', ownerName: 'Rajesh Sharma', phone: '+919876543210', address: 'Shop 12, Main Market', area: 'Hazāribāgh', city: 'Hazāribāgh', pincode: '825301', lat: 23.9925, lng: 85.3636, deliveryRadius: 5, openTime: '07:00', closeTime: '22:00', storeType: 'general', minOrder: 0, deliveryFee: 0, avgDeliveryMins: 20, rating: 4.5, totalOrders: 234, totalReviews: 198, status: 'active', joinedAt: Date.now() - 30*86400000 },
        { id: 'store_demo_2', ownerId: 'demo_owner_2', name: 'Gupta General Store', ownerName: 'Suresh Gupta', phone: '+919876543211', address: 'Bus Stand Road', area: 'Hazāribāgh', city: 'Hazāribāgh', pincode: '825301', lat: 23.9985, lng: 85.3700, deliveryRadius: 4, openTime: '06:30', closeTime: '21:30', storeType: 'general', minOrder: 0, deliveryFee: 0, avgDeliveryMins: 25, rating: 4.3, totalOrders: 187, totalReviews: 156, status: 'active', joinedAt: Date.now() - 60*86400000 },
      ];
      await localbazarStoresCol.deleteMany({ id: { $in: ['store_demo_1', 'store_demo_2'] } });
      await localbazarStoresCol.insertMany(stores);
      const products = [
        { storeId: 'store_demo_1', name: 'Basmati Rice Premium', category: 'cat_grocery_rice', brand: 'India Gate', unit: '5 kg', price: 580, mrp: 720, stock: 50 },
        { storeId: 'store_demo_1', name: 'Toor Dal', category: 'cat_grocery_rice', brand: 'Tata Sampann', unit: '1 kg', price: 145, mrp: 170, stock: 80 },
        { storeId: 'store_demo_1', name: 'Refined Sunflower Oil', category: 'cat_grocery_oil', brand: 'Fortune', unit: '1 L', price: 165, mrp: 190, stock: 60 },
        { storeId: 'store_demo_1', name: 'Garam Masala Powder', category: 'cat_grocery_oil', brand: 'MDH', unit: '100 g', price: 85, mrp: 100, stock: 100 },
        { storeId: 'store_demo_1', name: 'Toned Milk', category: 'cat_grocery_dairy', brand: 'Amul', unit: '500 ml', price: 28, mrp: 30, stock: 200 },
        { storeId: 'store_demo_1', name: 'Paracetamol Tablet', category: 'cat_personal_health', brand: 'Crocin', unit: '10 tablets', price: 30, mrp: 35, stock: 150 },
        { storeId: 'store_demo_2', name: 'Red Onion', category: 'cat_fresh_vegetables', brand: 'Local Fresh', unit: '1 kg', price: 35, mrp: 50, stock: 100 },
        { storeId: 'store_demo_2', name: 'Potato', category: 'cat_fresh_vegetables', brand: 'Local Fresh', unit: '1 kg', price: 25, mrp: 35, stock: 120 },
        { storeId: 'store_demo_2', name: 'Tomato', category: 'cat_fresh_vegetables', brand: 'Local Fresh', unit: '1 kg', price: 40, mrp: 60, stock: 80 },
        { storeId: 'store_demo_2', name: 'Banana', category: 'cat_fresh_fruits', brand: 'Local Fresh', unit: '1 dozen', price: 50, mrp: 70, stock: 60 },
        { storeId: 'store_demo_2', name: 'Maggi Noodles', category: 'cat_grocery_snacks', brand: 'Maggi', unit: '4 pack', price: 56, mrp: 60, stock: 200 },
        { storeId: 'store_demo_2', name: 'Coca-Cola', category: 'cat_grocery_beverages', brand: 'Coca-Cola', unit: '750 ml', price: 38, mrp: 40, stock: 100 },
        { storeId: 'store_demo_2', name: 'AA Battery', category: 'cat_home_electronics', brand: 'Duracell', unit: '4 pack', price: 120, mrp: 150, stock: 60 },
        { storeId: 'store_demo_2', name: 'LED Bulb 9W', category: 'cat_home_electronics', brand: 'Philips', unit: '1 pc', price: 95, mrp: 120, stock: 80 },
        { storeId: 'store_demo_2', name: 'Shampoo Bottle', category: 'cat_personal_care', brand: 'Dove', unit: '200 ml', price: 145, mrp: 180, stock: 70 },
        { storeId: 'store_demo_2', name: 'Wheat Atta', category: 'cat_grocery_rice', brand: 'Aashirvaad', unit: '5 kg', price: 240, mrp: 290, stock: 75 },
      ];
      await localbazarProductsCol.deleteMany({ storeId: { $in: ['store_demo_1', 'store_demo_2'] } });
      const docs = products.map(p => ({
        _id: 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + Math.random().toString(36).substr(2,4),
        id: 'prod_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + Math.random().toString(36).substr(2,4),
        ...p,
        storeName: p.storeId === 'store_demo_1' ? 'Sharma Local Bazar Store' : 'Gupta General Store',
        storeArea: 'Hazāribāgh',
        competitors: {
          amazon: p.price * 1.25, flipkart: p.price * 1.22,
          jiomart: p.price * 1.18, bigbasket: p.price * 1.15,
        },
        rating: 0, totalSold: Math.floor(Math.random() * 50),
        status: 'active', createdAt: Date.now(),
      }));
      await localbazarProductsCol.insertMany(docs);
      res.json({ success: true, storesAdded: stores.length, productsAdded: docs.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  connectDB_localbazar().catch(e => console.error('Local Bazar init error:', e.message));
};
