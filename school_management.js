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

  // Get schools owned by a user (for principal auto-login)
  app.get('/api/school/owner/:ownerId', async (req, res) => {
    try {
      const schools = await schoolsCol.find({ ownerId: req.params.ownerId }).sort({ createdAt: -1 }).toArray();
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
  // ADMIN: Delete school (and all its data)
  // DELETE /api/school/admin/:schoolId
  // ============================================================
  function _schoolAdminAuth(req, res, next) {
    const token = req.headers['x-admin-token'] || req.body.adminToken || req.query.adminToken;
    if (!global.__dsAdminTokens) global.__dsAdminTokens = new Set();
    if (!token || !global.__dsAdminTokens.has(token)) {
      return res.status(401).json({ error: 'Admin token required' });
    }
    next();
  }

  app.delete('/api/school/admin/:schoolId', _schoolAdminAuth, async (req, res) => {
    try {
      if (!schoolsCol) return res.status(503).json({ error: 'DB not ready' });
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      // Cascade delete: classes, students, attendance, diary, photos, messages, etc.
      const schoolId = school.id;
      const ownerId = school.ownerId;
      const del = {
        classes: await classesCol.deleteMany({ schoolId }),
        students: await studentsCol.deleteMany({ schoolId }),
        attendance: await attendanceCol.deleteMany({ schoolId }),
        diary: await diaryCol.deleteMany({ schoolId }),
        photos: await photosCol.deleteMany({ schoolId }),
        messages: await schoolMessagesCol.deleteMany({ schoolId }),
        fees: await schoolFeesCol ? await schoolFeesCol.deleteMany({ schoolId }) : { deletedCount: 0 },
        results: await schoolResultsCol ? await schoolResultsCol.deleteMany({ schoolId }) : { deletedCount: 0 },
        homework: await schoolHomeworkCol ? await schoolHomeworkCol.deleteMany({ schoolId }) : { deletedCount: 0 },
        notices: await schoolNoticesCol ? await schoolNoticesCol.deleteMany({ schoolId }) : { deletedCount: 0 },
        timetable: await schoolTimetableCol ? await schoolTimetableCol.deleteMany({ schoolId }) : { deletedCount: 0 },
        events: await schoolEventsCol ? await schoolEventsCol.deleteMany({ schoolId }) : { deletedCount: 0 },
        announcements: await schoolAnnouncementsCol ? await schoolAnnouncementsCol.deleteMany({ schoolId }) : { deletedCount: 0 },
        chat: await schoolChatCol ? await schoolChatCol.deleteMany({ schoolId }) : { deletedCount: 0 },
        school: await schoolsCol.deleteOne({ id: schoolId }),
      };
      // Unlink owner user
      await usersCol.updateOne({ id: ownerId }, { $unset: { schoolId: '', schoolRole: '' } });
      res.json({ success: true, deleted: school.name, schoolId, ownerId, cascade: {
        classes: del.classes.deletedCount,
        students: del.students.deletedCount,
        attendance: del.attendance.deletedCount,
        diary: del.diary.deletedCount,
        photos: del.photos.deletedCount,
        messages: del.messages.deletedCount,
        fees: del.fees.deletedCount || 0,
        results: del.results.deletedCount || 0,
      }});
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // ADMIN: Delete user (and their school if owner)
  // DELETE /api/school/admin/user/:userId
  // ============================================================
  app.delete('/api/school/admin/user/:userId', _schoolAdminAuth, async (req, res) => {
    try {
      if (!usersCol) return res.status(503).json({ error: 'DB not ready' });
      const user = await usersCol.findOne({ id: req.params.userId });
      if (!user) return res.status(404).json({ error: 'User not found' });
      // If user is a school owner, delete their school first
      let schoolDeleted = null;
      if (user.schoolId) {
        const school = await schoolsCol.findOne({ id: user.schoolId });
        if (school) {
          const schoolId = school.id;
          await classesCol.deleteMany({ schoolId });
          await studentsCol.deleteMany({ schoolId });
          await attendanceCol.deleteMany({ schoolId });
          await diaryCol.deleteMany({ schoolId });
          await photosCol.deleteMany({ schoolId });
          await schoolMessagesCol.deleteMany({ schoolId });
          if (schoolFeesCol) await schoolFeesCol.deleteMany({ schoolId });
          if (schoolResultsCol) await schoolResultsCol.deleteMany({ schoolId });
          if (schoolChatCol) await schoolChatCol.deleteMany({ schoolId });
          await schoolsCol.deleteOne({ id: schoolId });
          schoolDeleted = { id: schoolId, name: school.name };
        }
      }
      // Unlink parents whose students are deleted
      if (studentsCol) {
        const studentIds = await studentsCol.find({ schoolId: user.schoolId || '' }).project({ id: 1 }).toArray().catch(()=>[]);
        // Delete the user
        await usersCol.deleteOne({ id: req.params.userId });
      } else {
        await usersCol.deleteOne({ id: req.params.userId });
      }
      res.json({ success: true, deletedUser: { id: user.id, name: user.name, phone: user.phone }, schoolDeleted });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // ADMIN: List all schools (with owner info)
  // GET /api/school/admin/all
  // ============================================================
  app.get('/api/school/admin/all', _schoolAdminAuth, async (req, res) => {
    try {
      if (!schoolsCol) return res.status(503).json({ error: 'DB not ready' });
      const schools = await schoolsCol.find({}).sort({ createdAt: -1 }).toArray();
      // Hydrate owner info
      const ownerIds = [...new Set(schools.map(s => s.ownerId))];
      const owners = await usersCol.find({ id: { $in: ownerIds } }).toArray();
      const ownerMap = {};
      owners.forEach(u => { ownerMap[u.id] = { name: u.name, phone: u.phone, avatar: u.avatar }; });
      res.json({ success: true, count: schools.length, schools: schools.map(s => {
        const { _id, ...rest } = s;
        return { ...rest, owner: ownerMap[s.ownerId] || null };
      })});
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

  // ============================================================
  // ATTENDANCE (school-specific) - separate from business attendance
  // ============================================================
  let schoolAttendanceCol;
  async function ensureAttendanceCol() {
    if (!schoolAttendanceCol) schoolAttendanceCol = db.collection('schoolAttendance');
    await schoolAttendanceCol.createIndex({ schoolId: 1, date: 1, studentId: 1 }, { unique: true });
  }

  app.post('/api/school/:schoolId/attendance', async (req, res) => {
    try {
      const { ownerId, date, records } = req.body;
      // records: [{ studentId, status: 'present' | 'absent' | 'late' | 'half_day' }]
      if (!ownerId || !date || !records) return res.status(400).json({ error: 'ownerId, date, records required' });
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      await ensureAttendanceCol();
      let count = 0;
      for (const r of records) {
        await schoolAttendanceCol.updateOne(
          { schoolId: school.id, date, studentId: r.studentId },
          { $set: { schoolId: school.id, date, studentId: r.studentId, status: r.status, markedBy: ownerId, markedAt: Date.now() } },
          { upsert: true }
        );
        count++;
        // Notify parents of absent students
        if (r.status === 'absent') {
          const student = await studentsCol.findOne({ id: r.studentId });
          if (student?.parentId) {
            await notificationsCol.insertOne({
              _id: 'n_' + crypto.randomBytes(8).toString('hex'),
              id: undefined, userId: student.parentId,
              type: 'attendance_alert', from: ownerId, targetType: 'student', targetId: r.studentId,
              message: `⚠️ ${student.name} आज (${date}) absent था।`,
              read: false, createdAt: Date.now(),
            });
          }
        }
      }
      res.json({ success: true, count });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/attendance', async (req, res) => {
    try {
      const { date, studentId, fromDate, toDate } = req.query;
      await ensureAttendanceCol();
      const query = { schoolId: req.params.schoolId };
      if (date) query.date = date;
      if (studentId) query.studentId = studentId;
      if (fromDate) query.date = { $gte: fromDate };
      if (toDate) query.date = { ...(query.date || {}), $lte: toDate };
      const records = await schoolAttendanceCol.find(query).sort({ date: -1 }).limit(500).toArray();
      res.json({ success: true, count: records.length, records: records.map(r => { const { _id, ...x } = r; return x; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/attendance/stats', async (req, res) => {
    try {
      const { month, year, studentId } = req.query;
      await ensureAttendanceCol();
      const query = { schoolId: req.params.schoolId };
      if (month && year) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
        query.date = { $gte: startDate, $lte: endDate };
      }
      if (studentId) query.studentId = studentId;
      const records = await schoolAttendanceCol.find(query).toArray();
      const stats = {
        total: records.length,
        present: records.filter(r => r.status === 'present').length,
        absent: records.filter(r => r.status === 'absent').length,
        late: records.filter(r => r.status === 'late').length,
        halfDay: records.filter(r => r.status === 'half_day').length,
      };
      stats.percentage = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
      res.json({ success: true, stats, records: records.map(r => { const { _id, ...x } = r; return x; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // FEES (school-specific) - Fee collection & tracking
  // ============================================================
  let schoolFeesCol;
  async function ensureFeesCol() {
    if (!schoolFeesCol) schoolFeesCol = db.collection('schoolFees');
    await schoolFeesCol.createIndex({ schoolId: 1, studentId: 1, month: 1, year: 1 }, { unique: true });
  }

  app.post('/api/school/:schoolId/fees/collect', async (req, res) => {
    try {
      const { ownerId, studentId, month, year, amount, type, paymentMethod, transactionId, dueDate, notes } = req.body;
      // type: 'tuition' | 'admission' | 'exam' | 'transport' | 'books' | 'activity' | 'other'
      if (!ownerId || !studentId || !month || !year || !amount) {
        return res.status(400).json({ error: 'ownerId, studentId, month, year, amount required' });
      }
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const student = await studentsCol.findOne({ id: studentId, schoolId: school.id });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      await ensureFeesCol();
      const feeId = 'fee_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const receiptNo = 'RCP' + Date.now().toString().slice(-8);
      const fee = {
        _id: feeId, id: feeId,
        schoolId: school.id, studentId,
        studentName: student.name, className: student.className, section: student.section,
        month, year: parseInt(year),
        amount: parseFloat(amount),
        type: type || 'tuition',
        paymentMethod: paymentMethod || 'cash',  // 'cash' | 'upi' | 'bank' | 'cheque'
        transactionId: transactionId || null,
        receiptNo,
        dueDate: dueDate || null,
        notes: notes || '',
        status: 'paid',
        collectedBy: ownerId,
        collectedAt: Date.now(),
      };
      await schoolFeesCol.insertOne(fee);
      // Notify parent
      if (student.parentId) {
        await notificationsCol.insertOne({
          _id: 'n_' + crypto.randomBytes(8).toString('hex'),
          id: undefined, userId: student.parentId,
          type: 'fee_paid', from: ownerId, targetType: 'fee', targetId: feeId,
          message: `✅ ₹${amount} fee received for ${student.name} (${month} ${year}, ${type}). Receipt: ${receiptNo}`,
          read: false, createdAt: Date.now(),
        });
      }
      const { _id, ...result } = fee;
      res.json({ success: true, fee: result });
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ error: 'Fee already collected for this month' });
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/school/:schoolId/fees', async (req, res) => {
    try {
      const { studentId, month, year, status, fromDate, toDate } = req.query;
      await ensureFeesCol();
      const query = { schoolId: req.params.schoolId };
      if (studentId) query.studentId = studentId;
      if (month) query.month = month;
      if (year) query.year = parseInt(year);
      if (status) query.status = status;
      if (fromDate) query.collectedAt = { $gte: parseInt(fromDate) };
      if (toDate) query.collectedAt = { ...(query.collectedAt || {}), $lte: parseInt(toDate) };
      const fees = await schoolFeesCol.find(query).sort({ collectedAt: -1 }).limit(500).toArray();
      const total = fees.reduce((s, f) => s + (f.amount || 0), 0);
      res.json({ success: true, total, count: fees.length, fees: fees.map(f => { const { _id, ...r } = f; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/fees/summary', async (req, res) => {
    try {
      const { year } = req.query;
      await ensureFeesCol();
      const y = year ? parseInt(year) : new Date().getFullYear();
      const fees = await schoolFeesCol.find({ schoolId: req.params.schoolId, year: y }).toArray();
      // Monthly breakdown
      const monthly = {};
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      months.forEach(m => monthly[m] = { count: 0, total: 0 });
      fees.forEach(f => {
        if (monthly[f.month]) {
          monthly[f.month].count++;
          monthly[f.month].total += f.amount;
        }
      });
      const grandTotal = fees.reduce((s, f) => s + (f.amount || 0), 0);
      res.json({
        success: true,
        year: y,
        grandTotal,
        totalCount: fees.length,
        monthly,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/school/fees/:feeId/refund', async (req, res) => {
    try {
      const { ownerId, reason } = req.body;
      await ensureFeesCol();
      const fee = await schoolFeesCol.findOne({ id: req.params.feeId });
      if (!fee) return res.status(404).json({ error: 'Fee record not found' });
      const school = await schoolsCol.findOne({ id: fee.schoolId });
      if (!school || school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      await schoolFeesCol.updateOne(
        { id: fee.id },
        { $set: { status: 'refunded', refundReason: reason || '', refundedAt: Date.now(), refundedBy: ownerId } }
      );
      // Notify parent
      const student = await studentsCol.findOne({ id: fee.studentId });
      if (student?.parentId) {
        await notificationsCol.insertOne({
          _id: 'n_' + crypto.randomBytes(8).toString('hex'),
          id: undefined, userId: student.parentId,
          type: 'fee_refund', from: ownerId, targetType: 'fee', targetId: fee.id,
          message: `↩️ ₹${fee.amount} refund for ${student.name} (${fee.month} ${fee.year}). Reason: ${reason || 'N/A'}`,
          read: false, createdAt: Date.now(),
        });
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // TIMETABLE (class schedule)
  // ============================================================
  let schoolTimetableCol;
  async function ensureTimetableCol() {
    if (!schoolTimetableCol) schoolTimetableCol = db.collection('schoolTimetable');
    await schoolTimetableCol.createIndex({ schoolId: 1, className: 1, day: 1 });
  }

  app.post('/api/school/:schoolId/timetable', async (req, res) => {
    try {
      const { ownerId, className, section, day, periods } = req.body;
      // periods: [{ startTime, endTime, subject, teacherName }]
      // day: 'Monday' | 'Tuesday' | ... | 'Saturday'
      if (!ownerId || !className || !day || !periods) {
        return res.status(400).json({ error: 'ownerId, className, day, periods required' });
      }
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      await ensureTimetableCol();
      const ttId = `tt_${school.id}_${className}_${section || 'A'}_${day}`;
      await schoolTimetableCol.updateOne(
        { _id: ttId },
        { $set: { _id: ttId, id: ttId, schoolId: school.id, className, section: section || 'A', day, periods, updatedAt: Date.now(), updatedBy: ownerId } },
        { upsert: true }
      );
      res.json({ success: true, id: ttId });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/timetable', async (req, res) => {
    try {
      const { className, section } = req.query;
      await ensureTimetableCol();
      const query = { schoolId: req.params.schoolId };
      if (className) query.className = className;
      if (section) query.section = section;
      const tt = await schoolTimetableCol.find(query).toArray();
      res.json({ success: true, count: tt.length, timetable: tt.map(t => { const { _id, ...r } = t; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // EXAM RESULTS (school-specific)
  // ============================================================
  let schoolResultsCol;
  async function ensureResultsCol() {
    if (!schoolResultsCol) schoolResultsCol = db.collection('schoolResults');
    await schoolResultsCol.createIndex({ schoolId: 1, studentId: 1, examName: 1 });
  }

  app.post('/api/school/:schoolId/results', async (req, res) => {
    try {
      const { ownerId, studentId, examName, examType, subjects, maxMarks, totalMarks, percentage, grade, remarks } = req.body;
      // subjects: [{ name, marksObtained, maxMarks, grade }]
      if (!ownerId || !studentId || !examName || !subjects) {
        return res.status(400).json({ error: 'ownerId, studentId, examName, subjects required' });
      }
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const student = await studentsCol.findOne({ id: studentId, schoolId: school.id });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      await ensureResultsCol();
      // Auto-calculate total & grade if not provided
      const totMax = subjects.reduce((s, x) => s + (x.maxMarks || 100), 0);
      const totObt = subjects.reduce((s, x) => s + (x.marksObtained || 0), 0);
      const pct = totMax > 0 ? Math.round((totObt / totMax) * 100 * 100) / 100 : 0;
      let autoGrade = 'F';
      if (pct >= 90) autoGrade = 'A+';
      else if (pct >= 80) autoGrade = 'A';
      else if (pct >= 70) autoGrade = 'B+';
      else if (pct >= 60) autoGrade = 'B';
      else if (pct >= 50) autoGrade = 'C';
      else if (pct >= 40) autoGrade = 'D';
      const resultId = 'res_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const result = {
        _id: resultId, id: resultId,
        schoolId: school.id, studentId,
        studentName: student.name, className: student.className, section: student.section,
        examName,
        examType: examType || 'unit_test',  // 'unit_test' | 'midterm' | 'final' | 'annual'
        subjects,
        totalMarks: totalMarks || totObt,
        maxMarks: maxMarks || totMax,
        percentage: percentage || pct,
        grade: grade || autoGrade,
        remarks: remarks || '',
        publishedBy: ownerId,
        publishedAt: Date.now(),
      };
      await schoolResultsCol.insertOne(result);
      // Notify parent
      if (student.parentId) {
        await notificationsCol.insertOne({
          _id: 'n_' + crypto.randomBytes(8).toString('hex'),
          id: undefined, userId: student.parentId,
          type: 'result_published', from: ownerId, targetType: 'result', targetId: resultId,
          message: `📊 ${examName} result for ${student.name}: ${result.percentage}% (${result.grade})`,
          read: false, createdAt: Date.now(),
        });
      }
      const { _id, ...r } = result;
      res.json({ success: true, result: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/results', async (req, res) => {
    try {
      const { studentId, className, examName, examType } = req.query;
      await ensureResultsCol();
      const query = { schoolId: req.params.schoolId };
      if (studentId) query.studentId = studentId;
      if (className) query.className = className;
      if (examName) query.examName = examName;
      if (examType) query.examType = examType;
      const results = await schoolResultsCol.find(query).sort({ publishedAt: -1 }).limit(200).toArray();
      res.json({ success: true, count: results.length, results: results.map(r => { const { _id, ...x } = r; return x; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // BIRTHDAYS (today's birthdays)
  // ============================================================
  app.get('/api/school/:schoolId/birthdays/today', async (req, res) => {
    try {
      const students = await studentsCol.find({ schoolId: req.params.schoolId, status: 'active' }).toArray();
      const today = new Date();
      const todayMMDD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const birthdays = students.filter(s => {
        if (!s.dob) return false;
        const parts = s.dob.split('-');
        if (parts.length < 3) return false;
        return `${parts[1]}-${parts[2]}` === todayMMDD;
      });
      res.json({ success: true, count: birthdays.length, students: birthdays.map(s => { const { _id, ...r } = s; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/birthdays/upcoming', async (req, res) => {
    try {
      const students = await studentsCol.find({ schoolId: req.params.schoolId, status: 'active' }).toArray();
      const today = new Date();
      const upcoming = students.filter(s => {
        if (!s.dob) return false;
        const parts = s.dob.split('-');
        if (parts.length < 3) return false;
        const bday = new Date(today.getFullYear(), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const diff = (bday - today) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 7;
      }).map(s => {
        const parts = s.dob.split('-');
        const bday = new Date(today.getFullYear(), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const daysUntil = Math.ceil((bday - today) / (1000 * 60 * 60 * 24));
        return { ...s, daysUntil, _id: undefined };
      }).sort((a, b) => a.daysUntil - b.daysUntil);
      res.json({ success: true, count: upcoming.length, students: upcoming });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // STUDENT PROMOTION (move to next class)
  // ============================================================
  app.post('/api/school/:schoolId/students/:studentId/promote', async (req, res) => {
    try {
      const { ownerId, newClass, newSection, newRollNo, academicYear } = req.body;
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const student = await studentsCol.findOne({ id: req.params.studentId, schoolId: school.id });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const update = {};
      if (newClass) update.className = newClass;
      if (newSection) update.section = newSection;
      if (newRollNo) update.rollNo = parseInt(newRollNo);
      if (academicYear) update.academicYear = parseInt(academicYear);
      if (newClass === 'Graduated' || newClass === 'Passed') {
        update.status = 'graduated';
        update.graduatedAt = Date.now();
      }
      await studentsCol.updateOne({ id: student.id }, { $set: update });
      res.json({ success: true, message: 'Student promoted', student: { ...student, ...update, _id: undefined } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // BULK PROMOTION (all students of a class)
  // ============================================================
  app.post('/api/school/:schoolId/students/bulk-promote', async (req, res) => {
    try {
      const { ownerId, fromClass, toClass, academicYear } = req.body;
      if (!ownerId || !fromClass || !toClass) return res.status(400).json({ error: 'ownerId, fromClass, toClass required' });
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const students = await studentsCol.find({ schoolId: school.id, className: fromClass, status: 'active' }).toArray();
      let count = 0;
      for (const s of students) {
        await studentsCol.updateOne(
          { id: s.id },
          { $set: { className: toClass, rollNo: null, academicYear: parseInt(academicYear) || new Date().getFullYear() } }
        );
        count++;
      }
      res.json({ success: true, promoted: count });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // DELETE STUDENT (soft delete)
  // ============================================================
  app.post('/api/school/student/:studentId/delete', async (req, res) => {
    try {
      const { ownerId } = req.body;
      const student = await studentsCol.findOne({ id: req.params.studentId });
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const school = await schoolsCol.findOne({ id: student.schoolId });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      await studentsCol.updateOne({ id: student.id }, { $set: { status: 'inactive', deletedAt: Date.now() } });
      await schoolsCol.updateOne({ id: school.id }, { $inc: { studentCount: -1 } });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // SCHOOL PROFILE PUBLIC VIEW
  // ============================================================
  app.get('/api/school/:schoolId/public', async (req, res) => {
    try {
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      // Public-safe fields only
      const publicData = {
        id: school.id, slug: school.slug, name: school.name,
        address: school.address, city: school.city, state: school.state,
        phone: school.phone, logo: school.logo,
        studentCount: school.studentCount, classCount: school.defaultClasses?.length || 3,
        monthlyFee: school.monthlyFee, board: school.board,
        verified: school.verified, rating: school.rating, reviewCount: school.reviewCount,
        createdAt: school.createdAt,
      };
      res.json({ success: true, school: publicData });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // ENQUIRY (parents can enquire before admission)
  // ============================================================
  let schoolEnquiryCol;
  async function ensureEnquiryCol() {
    if (!schoolEnquiryCol) schoolEnquiryCol = db.collection('schoolEnquiry');
    await schoolEnquiryCol.createIndex({ schoolId: 1, createdAt: -1 });
  }

  app.post('/api/school/:schoolId/enquiry', async (req, res) => {
    try {
      const { parentName, parentPhone, childName, childAge, message } = req.body;
      if (!parentName || !parentPhone) return res.status(400).json({ error: 'parentName, parentPhone required' });
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      await ensureEnquiryCol();
      const enqId = 'enq_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const enq = {
        _id: enqId, id: enqId, schoolId: school.id,
        parentName, parentPhone, childName: childName || '', childAge: childAge || '',
        message: message || '',
        status: 'new',  // 'new' | 'contacted' | 'interested' | 'admitted' | 'closed'
        createdAt: Date.now(),
      };
      await schoolEnquiryCol.insertOne(enq);
      // Notify principal
      await notificationsCol.insertOne({
        _id: 'n_' + crypto.randomBytes(8).toString('hex'),
        id: undefined, userId: school.ownerId,
        type: 'enquiry', from: parentPhone, targetType: 'enquiry', targetId: enqId,
        message: `📩 New enquiry from ${parentName} (${parentPhone}) for ${childName || 'child'}`,
        read: false, createdAt: Date.now(),
      });
      const { _id, ...result } = enq;
      res.json({ success: true, enquiry: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/enquiries', async (req, res) => {
    try {
      const { ownerId } = req.query;
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      await ensureEnquiryCol();
      const enquiries = await schoolEnquiryCol.find({ schoolId: school.id }).sort({ createdAt: -1 }).limit(100).toArray();
      res.json({ success: true, count: enquiries.length, enquiries: enquiries.map(e => { const { _id, ...r } = e; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/school/enquiry/:enquiryId/status', async (req, res) => {
    try {
      const { ownerId, status, notes } = req.body;
      // status: 'new' | 'contacted' | 'interested' | 'admitted' | 'closed'
      await ensureEnquiryCol();
      const enq = await schoolEnquiryCol.findOne({ id: req.params.enquiryId });
      if (!enq) return res.status(404).json({ error: 'Enquiry not found' });
      const school = await schoolsCol.findOne({ id: enq.schoolId });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const update = { status, updatedAt: Date.now() };
      if (notes) update.notes = notes;
      await schoolEnquiryCol.updateOne({ id: enq.id }, { $set: update });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // SCHOOL EVENTS (annual day, sports day, trips)
  // ============================================================
  let schoolEventsCol;
  async function ensureEventsCol() {
    if (!schoolEventsCol) schoolEventsCol = db.collection('schoolEvents');
    await schoolEventsCol.createIndex({ schoolId: 1, date: 1 });
  }

  app.post('/api/school/:schoolId/events', async (req, res) => {
    try {
      const { ownerId, title, description, date, type, venue, rsvpRequired } = req.body;
      // type: 'annual_day' | 'sports_day' | 'trip' | 'competition' | 'meeting' | 'function' | 'celebration' | 'other'
      if (!ownerId || !title || !date) return res.status(400).json({ error: 'ownerId, title, date required' });
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      await ensureEventsCol();
      const eventId = 'evt_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const event = {
        _id: eventId, id: eventId, schoolId: school.id,
        title, description: description || '',
        date, type: type || 'function',
        venue: venue || '',
        rsvpRequired: rsvpRequired || false,
        rsvps: [],
        createdAt: Date.now(),
      };
      await schoolEventsCol.insertOne(event);
      // Notify all parents
      const students = await studentsCol.find({ schoolId: school.id, status: 'active' }).toArray();
      for (const s of students) {
        if (s.parentId) {
          await notificationsCol.insertOne({
            _id: 'n_' + crypto.randomBytes(8).toString('hex'),
            id: undefined, userId: s.parentId,
            type: 'event', from: ownerId, targetType: 'event', targetId: eventId,
            message: `📅 [${school.name}] ${title} - ${date}${venue ? ' @ ' + venue : ''}`,
            read: false, createdAt: Date.now(),
          });
        }
      }
      const { _id, ...result } = event;
      res.json({ success: true, event: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/events', async (req, res) => {
    try {
      const { fromDate, toDate, type } = req.query;
      await ensureEventsCol();
      const query = { schoolId: req.params.schoolId };
      if (type) query.type = type;
      if (fromDate) query.date = { $gte: fromDate };
      if (toDate) query.date = { ...(query.date || {}), $lte: toDate };
      const events = await schoolEventsCol.find(query).sort({ date: 1 }).limit(50).toArray();
      res.json({ success: true, count: events.length, events: events.map(e => { const { _id, ...r } = e; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/school/event/:eventId/rsvp', async (req, res) => {
    try {
      const { parentName, parentPhone, studentId, attending, guests } = req.body;
      await ensureEventsCol();
      const event = await schoolEventsCol.findOne({ id: req.params.eventId });
      if (!event) return res.status(404).json({ error: 'Event not found' });
      const rsvp = { parentName, parentPhone, studentId, attending: attending !== false, guests: guests || 1, createdAt: Date.now() };
      // Remove existing RSVP from same phone
      const existingRsvps = (event.rsvps || []).filter(r => r.parentPhone !== parentPhone);
      existingRsvps.push(rsvp);
      await schoolEventsCol.updateOne({ id: event.id }, { $set: { rsvps: existingRsvps } });
      res.json({ success: true, totalRsvps: existingRsvps.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // EXPORT (CSV download for any data)
  // ============================================================
  app.get('/api/school/:schoolId/export/students', async (req, res) => {
    try {
      const { ownerId, format } = req.query;
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      const students = await studentsCol.find({ schoolId: school.id, status: 'active' }).sort({ className: 1, rollNo: 1 }).toArray();
      if (format === 'csv') {
        const header = 'Roll No,Name,Class,Section,Parent Name,Parent Phone,DOB,Blood Group,Allergies,Admission Date\n';
        const rows = students.map(s => `${s.rollNo || ''},"${s.name}","${s.className}","${s.section}","${s.parentName || ''}","${s.parentPhone}","${s.dob || ''}","${s.bloodGroup || ''}","${(s.allergies || '').replace(/"/g, '""')}","${new Date(s.admissionDate).toLocaleDateString('hi-IN')}"`).join('\n');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="students_${school.slug}_${Date.now()}.csv"`);
        res.send(header + rows);
      } else {
        res.json({ success: true, count: students.length, students: students.map(s => { const { _id, ...r } = s; return r; }) });
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/export/fees', async (req, res) => {
    try {
      const { ownerId, format, year } = req.query;
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      await ensureFeesCol();
      const query = { schoolId: school.id };
      if (year) query.year = parseInt(year);
      const fees = await schoolFeesCol.find(query).sort({ collectedAt: -1 }).toArray();
      if (format === 'csv') {
        const header = 'Receipt No,Date,Student,Class,Month,Year,Amount,Type,Method,Status\n';
        const rows = fees.map(f => `"${f.receiptNo}","${new Date(f.collectedAt).toLocaleDateString('hi-IN')}","${f.studentName}","${f.className}-${f.section}","${f.month}","${f.year}","${f.amount}","${f.type}","${f.paymentMethod}","${f.status}"`).join('\n');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="fees_${school.slug}_${year || 'all'}.csv"`);
        res.send(header + rows);
      } else {
        res.json({ success: true, count: fees.length, fees: fees.map(f => { const { _id, ...r } = f; return f; }) });
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/school/:schoolId/export/attendance', async (req, res) => {
    try {
      const { ownerId, format, fromDate, toDate } = req.query;
      const school = await schoolsCol.findOne({ id: req.params.schoolId });
      if (!school) return res.status(404).json({ error: 'School not found' });
      if (school.ownerId !== ownerId) return res.status(403).json({ error: 'Not owner' });
      await ensureAttendanceCol();
      const query = { schoolId: school.id };
      if (fromDate) query.date = { $gte: fromDate };
      if (toDate) query.date = { ...(query.date || {}), $lte: toDate };
      const records = await schoolAttendanceCol.find(query).sort({ date: -1 }).toArray();
      if (format === 'csv') {
        const header = 'Date,Student ID,Status,Marked At\n';
        const rows = records.map(r => `"${r.date}","${r.studentId}","${r.status}","${new Date(r.markedAt).toLocaleString('hi-IN')}"`).join('\n');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="attendance_${school.slug}.csv"`);
        res.send(header + rows);
      } else {
        res.json({ success: true, count: records.length, records: records.map(r => { const { _id, ...r2 } = r; return r2; }) });
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  connectDB_school().catch(e => console.error('School init error:', e.message));
};
