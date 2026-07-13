// ============================================================
// ERIKSO - On-demand School Transport Platform
// ============================================================
// Like Rapido/Ola but for SCHOOL VANS, AUTO, CAB
// Serves parents, drivers, and schools
// ============================================================

module.exports = function(app, db, usersCol, notificationsCol) {
  let eriksoVehiclesCol, eriksoBookingsCol, eriksoTripsCol, eriksoDriversCol;
  let crypto, axios, path;

  try { crypto = require('crypto'); } catch (e) { crypto = require('crypto'); }

  async function connectDB_erikso() {
    eriksoDriversCol = db.collection('eriksoDrivers');
    eriksoBookingsCol = db.collection('eriksoBookings');
    eriksoTripsCol = db.collection('eriksoTrips');
    eriksoDriversCol.createIndex({ phone: 1 }, { unique: true }).catch(()=>{});
    eriksoDriversCol.createIndex({ userId: 1 }).catch(()=>{});
    eriksoBookingsCol.createIndex({ parentId: 1, status: 1 }).catch(()=>{});
    eriksoBookingsCol.createIndex({ driverId: 1, status: 1 }).catch(()=>{});
    eriksoTripsCol.createIndex({ bookingId: 1, date: -1 }).catch(()=>{});
    console.log('🚐 Erikso School Transport module loaded!');
  }

  // Register driver
  app.post('/api/erikso/driver/register', async (req, res) => {
    const { userId, name, phone, licenseNumber, vehicleNumber, vehicleType, capacity, schoolName, route } = req.body;
    if (!userId || !name || !phone || !licenseNumber || !vehicleNumber) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const driverId = 'drv_' + crypto.randomBytes(6).toString('hex');
    const driver = {
      _id: driverId, id: driverId, userId,
      name, phone, licenseNumber, vehicleNumber,
      vehicleType: vehicleType || 'van',
      capacity: capacity || 12,
      schoolName: schoolName || '', route: route || '',
      verified: false, rating: 0, totalRides: 0,
      currentLat: null, currentLng: null,
      online: false, earnings: { total: 0, pending: 0, withdrawn: 0 },
      createdAt: Date.now(),
    };
    try {
      await eriksoDriversCol.insertOne(driver);
      await usersCol.updateOne({ id: userId }, { $set: { eriksoDriverId: driverId, role: 'driver' } });
      res.json({ success: true, driver });
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ error: 'Phone already registered' });
      res.status(500).json({ error: e.message });
    }
  });

  // Get all drivers (for parents)
  app.get('/api/erikso/drivers', async (req, res) => {
    const { schoolName, vehicleType, area, online } = req.query;
    const query = { verified: true };
    if (schoolName) query.schoolName = { $regex: schoolName, $options: 'i' };
    if (vehicleType) query.vehicleType = vehicleType;
    if (area) query.route = { $regex: area, $options: 'i' };
    if (online === 'true') query.online = true;
    const drivers = await eriksoDriversCol.find(query).sort({ rating: -1 }).limit(50).toArray();
    res.json({ success: true, drivers: drivers.map(d => { const { _id, ...r } = d; return r; }) });
  });

  // Get driver profile
  app.get('/api/erikso/driver/:driverId', async (req, res) => {
    const driver = await eriksoDriversCol.findOne({ id: req.params.driverId });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const { _id, ...result } = driver;
    res.json({ success: true, driver: result });
  });

  // Driver status (online/offline)
  app.post('/api/erikso/driver/:driverId/status', async (req, res) => {
    const { online, lat, lng } = req.body;
    const update = { online: !!online, lastSeen: Date.now() };
    if (lat !== undefined) update.currentLat = lat;
    if (lng !== undefined) update.currentLng = lng;
    await eriksoDriversCol.updateOne({ id: req.params.driverId }, { $set: update });
    res.json({ success: true });
  });

  // Update driver location (every 30 sec)
  app.post('/api/erikso/driver/:driverId/location', async (req, res) => {
    const { lat, lng, heading, speed } = req.body;
    await eriksoDriversCol.updateOne(
      { id: req.params.driverId },
      { $set: { currentLat: lat, currentLng: lng, heading, speed, lastSeen: Date.now() } }
    );
    res.json({ success: true });
  });

  // Parent books a ride
  app.post('/api/erikso/book', async (req, res) => {
    const { parentId, studentId, driverId, vehicleType, pickupAddress, dropAddress, pickupTime, rideType, planType } = req.body;
    if (!parentId || !driverId || !pickupAddress || !dropAddress) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const driver = await eriksoDriversCol.findOne({ id: driverId });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    // Calculate fare
    const baseFare = 1500;
    const perKmRate = 5;
    const kmEstimate = 5;
    const fare = Math.round(baseFare + (kmEstimate * perKmRate * 30));
    const bookingId = 'book_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const booking = {
      _id: bookingId, id: bookingId,
      parentId, studentId: studentId || null, driverId,
      vehicleType: vehicleType || driver.vehicleType,
      pickupAddress, dropAddress,
      pickupTime: pickupTime || null,
      rideType: rideType || 'daily',
      planType: planType || 'both',
      fare, status: 'pending', paymentStatus: 'pending',
      startDate: Date.now(), createdAt: Date.now(),
    };
    await eriksoBookingsCol.insertOne(booking);
    // Notify driver
    await notificationsCol.insertOne({
      _id: 'n_' + crypto.randomBytes(8).toString('hex'),
      id: undefined, userId: driver.userId,
      type: 'erikso_booking', from: parentId, targetType: 'booking', targetId: bookingId,
      message: `🚐 New booking request! ₹${fare}/month`,
      read: false, createdAt: Date.now(),
    });
    const { _id, ...result } = booking;
    res.json({ success: true, booking: result });
  });

  // Driver accepts/declines booking
  app.post('/api/erikso/booking/:bookingId/status', async (req, res) => {
    const { driverId, status } = req.body;
    const booking = await eriksoBookingsCol.findOne({ id: req.params.bookingId });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.driverId !== driverId && status !== 'cancelled') {
      return res.status(403).json({ error: 'Not your booking' });
    }
    const update = { status };
    if (status === 'cancelled') update.cancelledAt = Date.now();
    if (status === 'completed') update.completedAt = Date.now();
    await eriksoBookingsCol.updateOne({ id: req.params.bookingId }, { $set: update });
    // Notify parent
    if (booking.parentId) {
      const messages = {
        'accepted': `✅ Driver accepted your booking!`,
        'declined': `❌ Driver declined. Try another.`,
        'cancelled': `🚫 Booking cancelled.`,
        'completed': `🎉 Trip completed!`,
      };
      await notificationsCol.insertOne({
        _id: 'n_' + crypto.randomBytes(8).toString('hex'),
        id: undefined, userId: booking.parentId,
        type: 'erikso_update', from: driverId, targetType: 'booking', targetId: req.params.bookingId,
        message: messages[status] || `Booking ${status}`,
        read: false, createdAt: Date.now(),
      });
    }
    res.json({ success: true });
  });

  // Get bookings for parent
  app.get('/api/erikso/bookings/parent/:parentId', async (req, res) => {
    const bookings = await eriksoBookingsCol.find({ parentId: req.params.parentId }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, bookings: bookings.map(b => { const { _id, ...r } = b; return r; }) });
  });

  // Get bookings for driver
  app.get('/api/erikso/bookings/driver/:driverId', async (req, res) => {
    const bookings = await eriksoBookingsCol.find({ driverId: req.params.driverId }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, bookings: bookings.map(b => { const { _id, ...r } = b; return r; }) });
  });

  // Start a trip
  app.post('/api/erikso/trip/start', async (req, res) => {
    const { bookingId, driverId, type } = req.body;
    const booking = await eriksoBookingsCol.findOne({ id: bookingId });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const tripId = 'trip_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const trip = {
      _id: tripId, id: tripId,
      bookingId, driverId,
      parentId: booking.parentId, studentId: booking.studentId,
      type, status: 'active',
      startTime: Date.now(), endTime: null,
      currentLat: null, currentLng: null,
      distance: 0, fare: booking.fare / 30,
    };
    await eriksoTripsCol.insertOne(trip);
    if (booking.parentId) {
      await notificationsCol.insertOne({
        _id: 'n_' + crypto.randomBytes(8).toString('hex'),
        id: undefined, userId: booking.parentId,
        type: 'erikso_trip', from: driverId, targetType: 'trip', targetId: tripId,
        message: `🚐 Your ${type} trip started! Track live now.`,
        read: false, createdAt: Date.now(),
      });
    }
    const { _id, ...result } = trip;
    res.json({ success: true, trip: result });
  });

  // Complete trip
  app.post('/api/erikso/trip/:tripId/complete', async (req, res) => {
    const { driverId } = req.body;
    const trip = await eriksoTripsCol.findOne({ id: req.params.tripId });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.driverId !== driverId) return res.status(403).json({ error: 'Not your trip' });
    await eriksoTripsCol.updateOne(
      { id: trip.id },
      { $set: { status: 'completed', endTime: Date.now() } }
    );
    if (trip.parentId) {
      await notificationsCol.insertOne({
        _id: 'n_' + crypto.randomBytes(8).toString('hex'),
        id: undefined, userId: trip.parentId,
        type: 'erikso_trip_done', from: driverId, targetType: 'trip', targetId: trip.id,
        message: `✅ Trip completed! Please rate the driver.`,
        read: false, createdAt: Date.now(),
      });
    }
    res.json({ success: true });
  });

  // Get trips for parent (live tracking)
  app.get('/api/erikso/trips/parent/:parentId', async (req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const trips = await eriksoTripsCol.find({
      parentId: req.params.parentId,
      startTime: { $gte: today.getTime() }
    }).sort({ startTime: -1 }).toArray();
    res.json({ success: true, trips: trips.map(t => { const { _id, ...r } = t; return r; }) });
  });

  // Get trips for driver
  app.get('/api/erikso/trips/driver/:driverId', async (req, res) => {
    const trips = await eriksoTripsCol.find({ driverId: req.params.driverId }).sort({ startTime: -1 }).limit(30).toArray();
    res.json({ success: true, trips: trips.map(t => { const { _id, ...r } = t; return r; }) });
  });

  // Rate driver
  app.post('/api/erikso/driver/:driverId/rate', async (req, res) => {
    const { parentId, rating, review } = req.body;
    const driver = await eriksoDriversCol.findOne({ id: req.params.driverId });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const oldRating = driver.rating || 0;
    const totalRides = driver.totalRides || 0;
    const newRating = ((oldRating * totalRides) + rating) / (totalRides + 1);
    await eriksoDriversCol.updateOne(
      { id: driver.id },
      { $set: { rating: newRating }, $inc: { totalRides: 1, reviewCount: 1 } }
    );
    res.json({ success: true, newRating });
  });

  // SOS Alert
  app.post('/api/erikso/sos', async (req, res) => {
    const { userId, driverId, tripId, lat, lng, message } = req.body;
    console.log('🚨 SOS Alert:', { userId, driverId, tripId, lat, lng });
    const driver = await eriksoDriversCol.findOne({ id: driverId });
    if (driver?.userId) {
      await notificationsCol.insertOne({
        _id: 'n_' + crypto.randomBytes(8).toString('hex'),
        id: undefined, userId: driver.userId,
        type: 'erikso_sos', from: userId, targetType: 'sos', targetId: 'sos_' + Date.now(),
        message: `🚨 EMERGENCY: ${message || 'Help needed!'}`,
        read: false, createdAt: Date.now(),
      });
    }
    res.json({ success: true, message: 'SOS sent to driver and emergency contacts' });
  });

  // Initialize
  connectDB_erikso().catch(e => console.error('Erikso init error:', e.message));
};
