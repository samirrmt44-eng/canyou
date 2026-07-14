// ============================================================
// SCHOOL MANAGEMENT SYSTEM - Complete Pre-School Solution
// For Nursery / LKG / UKG (below class 1)
// Multi-school support, FREE for all schools
// ============================================================
// Features:
// - Student admission (with parent linking)
// - Daily diary (mood, meals, naps, activities)
// - Photo gallery (class photos, events)
// - Transport tracking (link to Erikso)
// - Health records (vaccination, allergies, growth)
// - PTM (Parent-Teacher Meeting) scheduling
// - Holiday calendar
// - Emergency alerts
// - Pickup authorization (OTP-based)
// - Multi-school support
// ============================================================

module.exports = function(app, db, usersCol, notificationsCol) {
  const crypto = require('crypto');

  let schoolsCol, classesCol, studentsCol, diaryCol, photosCol;
  let healthCol, ptmCol, holidaysCol, pickupAuthCol, schoolMessagesCol;

  async function connectDB_school() {
    schoolsCol = db.collection('schools');
    classesCol = db.collection('schoolClasses');     // Nursery, LKG, UKG (sections A, B, C)
    studentsCol = db.collection('schoolStudents');
    diaryCol = db.collection('schoolDiary');         // Daily report
    photosCol = db.collection('schoolPhotos');       // Class/event photos
    healthCol = db.collection('schoolHealth');
    ptmCol = db.collection('schoolPTM');
    holidaysCol = db.collection('schoolHolidays');
    pickupAuthCol = db.collection('schoolPickupAuth');
    schoolMessagesCol = db.collection('schoolMessages');

    // Indexes
    await schoolsCol.createIndex({ slug: 1 }, { unique: true });
    await schoolsCol.createIndex({ ownerId: 1 });
    await classesCol.createIndex({ schoolId: 1, className: 1, section: 1 }, { unique: true });
    await studentsCol.createIndex({ schoolId: 1, rollNo: 1 }, { unique: true });
    await studentsCol.createIndex({ parentPhone: 1 });
    await studentsCol.createIndex({ schoolId: 1, status: 1 });
    await diaryCol.createIndex({ schoolId: 1, classId: 1, date: -1 });
    await photosCol.createIndex({ schoolId: 1, classId: 1, createdAt: -1 });
    await healthCol.createIndex({ studentId: 1 });
    await ptmCol.createIndex({ schoolId: 1, date: 1 });
    await holidaysCol.createIndex({ schoolId: 1, date: 1 });
    await pickupAuthCol.createIndex({ studentId: 1, date: 1 });
    await schoolMessagesCol.createIndex({ schoolId: 1, classId: 1, createdAt: -1 });

    console.log('🎓 School Management module loaded!');
  }

  // ============================================================
  // SCHOOL REGISTRATION (any user can register a school - FREE)
  // ============================================================
  app.post('/api/school/register', async (req, res) => {
    try {
      if (!schoolsCol) return res.status(503).json({ error: 'DB not ready' });
      const { ownerId, name, slug, address, city, state, phone, email, logo, principalName, board, classes, monthlyFee } = req.body;
      if (!ownerId || !name || !slug || !phone) {
        return res.status(400).json({ error: 'ownerId, name, slug, phone required' });
      }
      const schoolId = 'sch_' + crypto.randomBytes(6).toString('hex');
      const school = {
        _id: schoolId, id: schoolId, ownerId,
        name: String(name).trim(),
        slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        address: address || '',
        city: city || '',
        state: state || '',
        phone: String(phone).trim(),
        email: email || '',
        logo: logo || '',
        principalName: principalName || '',
        board: board || 'state',  // 'state' | 'cbse' | 'icse' | 'cambridge' | 'other'
        monthlyFee: parseInt(monthlyFee) || 0,
        // Pre-defined classes for below class 1
        defaultClasses: ['Nursery', 'LKG', 'UKG'],
        studentCount: 0, teacherCount: 0,
        verified: false, featured: false,
        rating: 0, reviewCount: 0,
        subscription: 'free',  // always free for now
        createdAt: Date.now(),
      };
      await schoolsCol.insertOne(school);
      // Update owner user
      await usersCol.updateOne({ id: ownerId }, { $set: { schoolId, schoolRole: 'owner' } });
      // Auto-create default classes
      const classDocs = [];
      for (const cn of school.defaultClasses) {
        classDocs.push({
          _id: schoolId + '_' + cn,
          id: schoolId + '_' + cn,
          schoolId,
          className: cn,
          section: 'A',
          teacherId: null,
          teacherName: '',
          studentCount: 0,
          createdAt: Date.now(),
        });
      }
      await classesCol.insertMany(classDocs);
      const { _id, ...result } = school;
      res.json({ success: true, school: result, classesCreated: classDocs.length });
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ error: 'School slug already taken. Try a different one.' });
      res.status(500).json({ error: e.message });
    }
  });

  // Get school by slug
  app.get('/api/school/:slug', async (req, res) => {
    try {
      const school = await schoolsCol.findOne({ slug: req.params.slug });
      if (!school) return res.status(404).json({ error: 'School not found' });
      const { _id, ...result } = school;
      res.json({ success: true, school: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get all schools (discover)
  app.get('/api/schools', async (req, res) => {
    try {
      const { city, search, limit } = req.query;
      const query = {};
      if (city) query.city = { $regex: city, $options: 'i' };
      if (search) query.name = { $regex: search, $options: 'i' };
      const lim = parseInt(limit) || 30;
      const schools = await schoolsCol.find(query).sort({ createdAt: -1 }).limit(lim).toArray();
      res.json({ success: true, count: schools.length, schools: schools.map(s => { const { _id, ...r } = s; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Update school
  app.post('/api/school/:schoolId/update', async (req, res) => {
    try {
      const { ownerId, ...updates } = req.body;
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const allowed = ['name', 'address', 'city', 'state', 'phone', 'email', 'logo', 'principalName', 'monthlyFee'];
      const update = {};
      for (const k of allowed) if (updates[k] !== undefined) update[k] = updates[k];
      await schoolsCol.updateOne({ id: req.params.schoolId }, { $set: update });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // CLASSES (Nursery / LKG / UKG with sections)
  // ============================================================
  app.post('/api/school/:schoolId/classes', async (req, res) => {
    try {
      const { ownerId, className, section, teacherId, teacherName } = req.body;
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const classId = school.id + '_' + className + (section || 'A');
      const cls = {
        _id: classId, id: classId, schoolId: school.id,
        className, section: section || 'A',
        teacherId: teacherId || null,
        teacherName: teacherName || '',
        studentCount: 0,
        createdAt: Date.now(),
      };
      await classesCol.insertOne(cls);
      const { _id, ...result } = cls;
      res.json({ success: true, class: result });
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ error: 'Class already exists' });
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/school/:schoolId/classes', async (req, res) => {
    try {
      const classes = await classesCol.find({ schoolId: req.params.schoolId }).sort({ className: 1, section: 1 }).toArray();
      res.json({ success: true, classes: classes.map(c => { const { _id, ...r } = c; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // STUDENTS - Admission
  // ============================================================
  app.post('/api/school/:schoolId/students/admit', async (req, res) => {
    try {
      const { ownerId, name, parentName, parentPhone, parentEmail, className, section, dob, address, photo, bloodGroup, allergies, pickupPerson, documents } = req.body;
      if (!name || !parentPhone || !className) {
        return res.status(400).json({ error: 'name, parentPhone, className required' });
      }
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });

      // Auto-generate roll number
      const studentCount = await studentsCol.countDocuments({ schoolId: school.id, className, section: section || 'A' });
      const rollNo = studentCount + 1;

      const studentId = 'stu_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const student = {
        _id: studentId, id: studentId,
        schoolId: school.id,
        className, section: section || 'A',
        rollNo,
        name: String(name).trim(),
        parentName: String(parentName || '').trim(),
        parentPhone: String(parentPhone).trim(),
        parentEmail: parentEmail || '',
        dob: dob || '',
        address: address || '',
        photo: photo || '',
        bloodGroup: bloodGroup || '',
        allergies: allergies || '',
        pickupPerson: pickupPerson || parentName,  // Default: parent
        documents: documents || [],
        status: 'active',
        admissionDate: Date.now(),
        academicYear: new Date().getFullYear(),
      };
      await studentsCol.insertOne(student);

      // Try to link parent (find by phone in users)
      let parentUser = await usersCol.findOne({ phone: parentPhone });
      if (parentUser) {
        await studentsCol.updateOne({ id: studentId }, { $set: { parentId: parentUser.id } });
        student.parentId = parentUser.id;
        // Update user role
        await usersCol.updateOne({ id: parentUser.id }, { $set: { schoolId: school.id, schoolRole: 'parent' } });
      }

      // Update school + class student count
      await schoolsCol.updateOne({ id: school.id }, { $inc: { studentCount: 1 } });
      await classesCol.updateOne({ schoolId: school.id, className, section: section || 'A' }, { $inc: { studentCount: 1 } });

      const { _id, ...result } = student;
      res.json({ success: true, student: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get students of a school (filtered by class optionally)
  app.get('/api/school/:schoolId/students', async (req, res) => {
    try {
      const { className, parentId, status } = req.query;
      const query = { schoolId: req.params.schoolId };
      if (className) query.className = className;
      if (parentId) query.parentId = parentId;
      if (status) query.status = status;
      else query.status = 'active';
      const students = await studentsCol.find(query).sort({ className: 1, section: 1, rollNo: 1 }).toArray();
      res.json({ success: true, count: students.length, students: students.map(s => { const { _id, ...r } = s; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get single student
  app.get('/api/school/student/:studentId', async (req, res) => {
    try {
      const student = await studentsCol.findOne({ id: req.params.studentId });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const { _id, ...result } = student;
      res.json({ success: true, student: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get students by parent phone (for parent login)
  app.get('/api/school/parent/:phone/students', async (req, res) => {
    try {
      const students = await studentsCol.find({ parentPhone: req.params.phone, status: 'active' }).toArray();
      // Also include school info
      const enriched = await Promise.all(students.map(async (s) => {
        const school = await schoolsCol.findOne({ id: s.schoolId });
        return { ...s, _id: undefined, school: school ? { id: school.id, name: school.name, slug: school.slug, logo: school.logo } : null };
      }));
      res.json({ success: true, count: enriched.length, students: enriched });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Update student
  app.post('/api/school/student/:studentId/update', async (req, res) => {
    try {
      const { ownerId, ...updates } = req.body;
      const student = await studentsCol.findOne({ id: req.params.studentId });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const school = await schoolsCol.findOne({ id: student.schoolId });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const allowed = ['name', 'parentName', 'parentPhone', 'parentEmail', 'className', 'section', 'dob', 'address', 'photo', 'bloodGroup', 'allergies', 'pickupPerson', 'status'];
      const update = {};
      for (const k of allowed) if (updates[k] !== undefined) update[k] = updates[k];
      await studentsCol.updateOne({ id: student.id }, { $set: update });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // DAILY DIARY - What child did today (mood, meals, naps, activities)
  // ============================================================
  app.post('/api/school/:schoolId/diary', async (req, res) => {
    try {
      const { ownerId, classId, date, entries } = req.body;
      // entries: [{ studentId, mood, meals, nap, activities, notes, photos }]
      if (!classId || !date || !entries) {
        return res.status(400).json({ error: 'classId, date, entries required' });
      }
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });

      let created = 0;
      for (const entry of entries) {
        const diaryId = 'diary_' + entry.studentId + '_' + date;
        const diary = {
          _id: diaryId, id: diaryId,
          schoolId: school.id, classId,
          studentId: entry.studentId,
          date,
          mood: entry.mood || 'happy',  // 'happy' | 'neutral' | 'sad' | 'crying' | 'sick'
          meals: entry.meals || { breakfast: false, snack: false, lunch: false },
          nap: entry.nap || { slept: false, duration: 0 },
          activities: entry.activities || [],  // ['drawing', 'music', 'play', 'reading']
          bottleCount: entry.bottleCount || 0,  // for nursery kids
          diaperCount: entry.diaperCount || 0,  // for nursery kids
          notes: entry.notes || '',
          photos: entry.photos || [],  // URLs
          postedBy: ownerId,
          createdAt: Date.now(),
        };
        await diaryCol.updateOne(
          { _id: diaryId },
          { $set: diary },
          { upsert: true }
        );
        created++;
      }
      res.json({ success: true, created });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get diary for a date
  app.get('/api/school/diary', async (req, res) => {
    try {
      const { classId, studentId, date, fromDate, toDate, limit } = req.query;
      const query = {};
      if (classId) query.classId = classId;
      if (studentId) query.studentId = studentId;
      if (date) query.date = date;
      if (fromDate) query.date = { $gte: fromDate };
      if (toDate) query.date = { ...(query.date || {}), $lte: toDate };
      const lim = parseInt(limit) || 50;
      const entries = await diaryCol.find(query).sort({ date: -1 }).limit(lim).toArray();
      res.json({ success: true, count: entries.length, entries: entries.map(e => { const { _id, ...r } = e; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // PHOTOS - Class photos, event photos
  // ============================================================
  app.post('/api/school/:schoolId/photos', async (req, res) => {
    try {
      const { ownerId, classId, title, description, photos, tags, eventType } = req.body;
      if (!photos || !Array.isArray(photos) || photos.length === 0) {
        return res.status(400).json({ error: 'photos array required' });
      }
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });

      const albumId = 'album_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const album = {
        _id: albumId, id: albumId,
        schoolId: school.id, classId: classId || null,
        title: title || 'Untitled Album',
        description: description || '',
        photos,  // array of URLs
        tags: tags || [],
        eventType: eventType || 'general',  // 'class' | 'event' | 'trip' | 'function' | 'general'
        postedBy: ownerId,
        createdAt: Date.now(),
      };
      await photosCol.insertOne(album);
      const { _id, ...result } = album;
      res.json({ success: true, album: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/photos', async (req, res) => {
    try {
      const { classId, limit } = req.query;
      const query = { schoolId: req.params.schoolId };
      if (classId) query.classId = classId;
      const lim = parseInt(limit) || 30;
      const albums = await photosCol.find(query).sort({ createdAt: -1 }).limit(lim).toArray();
      res.json({ success: true, count: albums.length, albums: albums.map(a => { const { _id, ...r } = a; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // HEALTH RECORDS
  // ============================================================
  app.post('/api/school/student/:studentId/health', async (req, res) => {
    try {
      const { type, date, height, weight, notes, vaccineName, vaccineDate } = req.body;
      // type: 'growth' | 'vaccination' | 'medical_incident' | 'checkup'
      if (!type) return res.status(400).json({ error: 'type required' });
      const recordId = 'hlth_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const record = {
        _id: recordId, id: recordId,
        studentId: req.params.studentId,
        type, date: date || new Date().toISOString().split('T')[0],
        height, weight, notes, vaccineName, vaccineDate,
        recordedAt: Date.now(),
      };
      await healthCol.insertOne(record);
      const { _id, ...result } = record;
      res.json({ success: true, record: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/student/:studentId/health', async (req, res) => {
    try {
      const records = await healthCol.find({ studentId: req.params.studentId }).sort({ recordedAt: -1 }).toArray();
      res.json({ success: true, records: records.map(r => { const { _id, ...x } = r; return x; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // PTM (Parent-Teacher Meeting) - schedule + booking
  // ============================================================
  app.post('/api/school/:schoolId/ptm', async (req, res) => {
    try {
      const { ownerId, classId, date, startTime, endTime, maxParents, notes } = req.body;
      if (!classId || !date || !startTime || !endTime) {
        return res.status(400).json({ error: 'classId, date, startTime, endTime required' });
      }
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });

      const ptmId = 'ptm_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const ptm = {
        _id: ptmId, id: ptmId,
        schoolId: school.id, classId, date, startTime, endTime,
        maxParents: maxParents || 15,
        notes: notes || '',
        bookings: [],  // { studentId, slot, bookedAt }
        createdAt: Date.now(),
      };
      await ptmCol.insertOne(ptm);
      const { _id, ...result } = ptm;
      res.json({ success: true, ptm: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/ptm', async (req, res) => {
    try {
      const { classId } = req.query;
      const query = { schoolId: req.params.schoolId };
      if (classId) query.classId = classId;
      const meetings = await ptmCol.find(query).sort({ date: 1 }).toArray();
      res.json({ success: true, meetings: meetings.map(m => { const { _id, ...r } = m; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Book a slot (parent)
  app.post('/api/school/ptm/:ptmId/book', async (req, res) => {
    try {
      const { studentId, parentPhone } = req.body;
      const ptm = await ptmCol.findOne({ id: req.params.ptmId });
      if (!ptm) return res.status(404).json({ error: 'PTM not found' });
      if (ptm.bookings.length >= ptm.maxParents) {
        return res.status(400).json({ error: 'PTM is fully booked' });
      }
      // Verify student belongs to this ptm's class
      const student = await studentsCol.findOne({ id: studentId });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      if (student.className !== ptm.className) {
        return res.status(400).json({ error: 'Student not in this class' });
      }
      const booking = { studentId, parentPhone, bookedAt: Date.now() };
      await ptmCol.updateOne({ id: ptm.id }, { $push: { bookings: booking } });
      res.json({ success: true, booking });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // HOLIDAY CALENDAR
  // ============================================================
  app.post('/api/school/:schoolId/holidays', async (req, res) => {
    try {
      const { ownerId, date, name, type, description } = req.body;
      // type: 'holiday' | 'event' | 'exam' | 'ptm' | 'function'
      if (!date || !name) return res.status(400).json({ error: 'date, name required' });
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });

      const id = 'holi_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const holiday = {
        _id: id, id, schoolId: school.id,
        date, name, type: type || 'holiday',
        description: description || '',
        createdAt: Date.now(),
      };
      await holidaysCol.insertOne(holiday);
      const { _id, ...result } = holiday;
      res.json({ success: true, holiday: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/holidays', async (req, res) => {
    try {
      const { fromDate, toDate, type } = req.query;
      const query = { schoolId: req.params.schoolId };
      if (type) query.type = type;
      if (fromDate) query.date = { $gte: fromDate };
      if (toDate) query.date = { ...(query.date || {}), $lte: toDate };
      const holidays = await holidaysCol.find(query).sort({ date: 1 }).toArray();
      res.json({ success: true, holidays: holidays.map(h => { const { _id, ...r } = h; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // PICKUP AUTHORIZATION (OTP-based secure pickup)
  // ============================================================
  app.post('/api/school/student/:studentId/pickup', async (req, res) => {
    try {
      const { authorizedPerson, relation, parentPhone } = req.body;
      const student = await studentsCol.findOne({ id: req.params.studentId });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const today = new Date().toISOString().split('T')[0];
      // Generate OTP
      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      const authId = 'pickup_' + student.id + '_' + today;
      const auth = {
        _id: authId, id: authId,
        studentId: student.id,
        schoolId: student.schoolId,
        date: today,
        authorizedPerson: authorizedPerson || student.pickupPerson,
        relation: relation || '',
        parentPhone: parentPhone || student.parentPhone,
        otp,
        used: false,
        createdAt: Date.now(),
      };
      await pickupAuthCol.updateOne(
        { _id: authId },
        { $set: auth },
        { upsert: true }
      );
      // Send OTP to parent's phone (in real app, send SMS)
      // For now, just return the OTP
      const { _id, ...result } = auth;
      res.json({ success: true, pickupAuth: result, message: 'OTP generated. Parent will receive via SMS.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Verify OTP for pickup
  app.post('/api/school/pickup/verify', async (req, res) => {
    try {
      const { studentId, otp, personName } = req.body;
      const today = new Date().toISOString().split('T')[0];
      const auth = await pickupAuthCol.findOne({ studentId, date: today });
      if (!auth) return res.status(404).json({ error: 'No pickup authorization for today' });
      if (auth.used) return res.status(400).json({ error: 'OTP already used' });
      if (auth.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
      // Mark as used
      await pickupAuthCol.updateOne(
        { _id: auth._id },
        { $set: { used: true, usedAt: Date.now(), usedBy: personName } }
      );
      res.json({ success: true, message: 'Pickup authorized!', studentName: '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // EMERGENCY ALERTS
  // ============================================================
  app.post('/api/school/:schoolId/alert', async (req, res) => {
    try {
      const { ownerId, type, message, classId, severity } = req.body;
      // type: 'emergency' | 'closure' | 'event' | 'pickup' | 'general'
      if (!type || !message) return res.status(400).json({ error: 'type, message required' });
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });

      // Send to all parents of school (or specific class)
      const query = { schoolId: school.id, status: 'active' };
      if (classId) query.className = classId;
      const students = await studentsCol.find(query).toArray();
      let sent = 0;
      for (const s of students) {
        const notifId = 'n_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        await notificationsCol.insertOne({
          _id: notifId, id: notifId,
          userId: s.parentId || s.parentPhone,
          type: 'school_alert',
          from: ownerId,
          targetType: 'school', targetId: school.id,
          message: `🚨 [${school.name}] ${message}`,
          severity: severity || 'normal',
          read: false,
          createdAt: Date.now(),
        });
        sent++;
      }
      res.json({ success: true, sent, total: students.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // SCHOOL STATS (for dashboard)
  // ============================================================
  app.get('/api/school/:schoolId/stats', async (req, res) => {
    try {
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });

      const [studentCount, classCount, diaryCount, photoCount, alertCount] = await Promise.all([
        studentsCol.countDocuments({ schoolId: school.id, status: 'active' }),
        classesCol.countDocuments({ schoolId: school.id }),
        diaryCol.countDocuments({ schoolId: school.id }),
        photosCol.countDocuments({ schoolId: school.id }),
        notificationsCol.countDocuments({ targetType: 'school', targetId: school.id }),
      ]);

      // Students by class
      const classBreakdown = await studentsCol.aggregate([
        { $match: { schoolId: school.id, status: 'active' } },
        { $group: { _id: { className: '$className', section: '$section' }, count: { $sum: 1 } } },
        { $sort: { '_id.className': 1, '_id.section': 1 } },
      ]).toArray();

      // Today's diary count
      const today = new Date().toISOString().split('T')[0];
      const todayDiaryCount = await diaryCol.countDocuments({ schoolId: school.id, date: today });

      res.json({
        success: true,
        stats: {
          studentCount, classCount, diaryCount, photoCount, alertCount,
          todayDiaryCount,
          classBreakdown,
        },
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  connectDB_school().catch(e => console.error('School init error:', e.message));
};
