// ============================================================
// SCHOOL CHAT - In-site messaging for schools
// Group chat for: Principal, Teachers, Parents
// Private 1-on-1 chat support
// Hindi-first
// ============================================================

module.exports = function(app, db, usersCol, notificationsCol) {
  const crypto = require('crypto');

  let schoolChatsCol, schoolMessagesCol, schoolFeedbackCol, schoolReactionsCol;

  async function connectDB_school_chat() {
    schoolChatsCol = db.collection('schoolChats');     // Chat rooms
    schoolMessagesCol = db.collection('schoolMessages');  // Messages
    schoolFeedbackCol = db.collection('schoolFeedback');  // Feedback from anyone
    schoolReactionsCol = db.collection('schoolReactions');  // Message reactions

    await schoolChatsCol.createIndex({ schoolId: 1, type: 1 });
    await schoolChatsCol.createIndex({ participants: 1 });
    await schoolMessagesCol.createIndex({ chatId: 1, createdAt: 1 });
    await schoolFeedbackCol.createIndex({ schoolId: 1, createdAt: -1 });
    await schoolReactionsCol.createIndex({ messageId: 1, userId: 1 }, { unique: true });

    console.log('💬 School Chat module loaded!');
  }

  // ============================================================
  // GET OR CREATE A CHAT (group or 1-on-1)
  // ============================================================
  app.post('/api/school/:schoolId/chat/get-or-create', async (req, res) => {
    try {
      const { userId, userName, userRole, type, otherUserId, otherUserName, classId } = req.body;
      if (!userId || !type) return res.status(400).json({ error: 'userId, type required' });
      let query = { schoolId: req.params.schoolId, type };
      if (type === 'direct') {
        if (!otherUserId) return res.status(400).json({ error: 'otherUserId required' });
        // Direct chats are unique per pair
        const sortedIds = [userId, otherUserId].sort();
        query.participants = { $all: sortedIds, $size: 2 };
      } else if (type === 'class') {
        if (!classId) return res.status(400).json({ error: 'classId required' });
        query.classId = classId;
        query.participants = { $all: [userId], $size: 0 };  // open chat
      } else if (type === 'school') {
        // School-wide chat (everyone)
        query.participants = { $all: [userId], $size: 0 };
      } else if (type === 'teachers') {
        query.participants = { $all: [userId], $size: 0 };
      } else if (type === 'parents') {
        query.participants = { $all: [userId], $size: 0 };
      }
      let chat = await schoolChatsCol.findOne(query);
      if (chat) {
        const { _id, ...result } = chat;
        return res.json({ success: true, chat: result, isNew: false });
      }
      // Create new chat
      const chatId = 'chat_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
      const newChat = {
        _id: chatId, id: chatId,
        schoolId: req.params.schoolId,
        type, classId: classId || null,
        participants: type === 'direct' ? [userId, otherUserId].sort() : [userId],
        participantNames: { [userId]: userName || 'User' },
        participantRoles: { [userId]: userRole || 'parent' },
        lastMessage: null,
        lastMessageAt: null,
        createdAt: Date.now(),
      };
      if (type === 'direct' && otherUserId && otherUserName) {
        newChat.participantNames[otherUserId] = otherUserName;
      }
      await schoolChatsCol.insertOne(newChat);
      const { _id, ...result } = newChat;
      res.json({ success: true, chat: result, isNew: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // List all chats for a user
  app.get('/api/school/:schoolId/chats', async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const chats = await schoolChatsCol.find({
        schoolId: req.params.schoolId,
        participants: userId,
      }).sort({ lastMessageAt: -1, createdAt: -1 }).toArray();
      res.json({ success: true, chats: chats.map(c => { const { _id, ...r } = c; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Send a message
  app.post('/api/school/chat/:chatId/message', async (req, res) => {
    try {
      const { senderId, senderName, senderRole, text, attachments, replyTo } = req.body;
      if (!senderId || !text) return res.status(400).json({ error: 'senderId, text required' });
      const chat = await schoolChatsCol.findOne({ id: req.params.chatId });
      if (!chat) return res.status(404).json({ error: 'Chat not found' });
      if (!chat.participants.includes(senderId)) return res.status(403).json({ error: 'Not a participant' });
      const msgId = 'msg_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
      const msg = {
        _id: msgId, id: msgId,
        chatId: chat.id,
        schoolId: chat.schoolId,
        senderId, senderName: senderName || 'User', senderRole: senderRole || 'parent',
        text: String(text).trim().slice(0, 2000),
        attachments: attachments || [],
        replyTo: replyTo || null,  // { messageId, text, senderName }
        reactions: {},  // { emoji: [userId, userId] }
        readBy: [senderId],
        createdAt: Date.now(),
        edited: false,
      };
      await schoolMessagesCol.insertOne(msg);
      // Update chat last message
      await schoolChatsCol.updateOne(
        { _id: chat._id },
        { $set: { lastMessage: text, lastMessageAt: Date.now() } }
      );
      // Send notification to other participants
      for (const uid of chat.participants) {
        if (uid === senderId) continue;
        await notificationsCol.insertOne({
          _id: 'n_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
          id: undefined,
          userId: uid,
          type: 'school_chat',
          from: senderId,
          targetType: 'school_chat', targetId: chat.id,
          message: `💬 ${senderName}: ${text.slice(0, 60)}`,
          read: false,
          createdAt: Date.now(),
        });
        const notif = await notificationsCol.findOne({ _id: { $exists: true } }, { sort: { createdAt: -1 } });
      }
      const { _id, ...result } = msg;
      res.json({ success: true, message: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get messages for a chat
  app.get('/api/school/chat/:chatId/messages', async (req, res) => {
    try {
      const { limit, before } = req.query;
      const query = { chatId: req.params.chatId };
      if (before) query.createdAt = { $lt: parseInt(before) };
      const lim = parseInt(limit) || 50;
      const messages = await schoolMessagesCol.find(query).sort({ createdAt: -1 }).limit(lim).toArray();
      res.json({ success: true, count: messages.length, messages: messages.reverse().map(m => { const { _id, ...r } = m; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Mark messages as read
  app.post('/api/school/chat/:chatId/read', async (req, res) => {
    try {
      const { userId } = req.body;
      await schoolMessagesCol.updateMany(
        { chatId: req.params.chatId, readBy: { $ne: userId } },
        { $addToSet: { readBy: userId } }
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // React to a message
  app.post('/api/school/message/:messageId/react', async (req, res) => {
    try {
      const { userId, emoji } = req.body;
      if (!userId || !emoji) return res.status(400).json({ error: 'userId, emoji required' });
      const existing = await schoolReactionsCol.findOne({ messageId: req.params.messageId, userId });
      if (existing) {
        // Toggle off
        await schoolReactionsCol.deleteOne({ _id: existing._id });
        await schoolMessagesCol.updateOne(
          { id: req.params.messageId },
          { $pull: { ['reactions.' + emoji]: userId } }
        );
      } else {
        await schoolReactionsCol.insertOne({
          _id: 'r_' + Date.now() + '_' + crypto.randomBytes(2).toString('hex'),
          messageId: req.params.messageId, userId, emoji,
          createdAt: Date.now(),
        });
        await schoolMessagesCol.updateOne(
          { id: req.params.messageId },
          { $addToSet: { ['reactions.' + emoji]: userId } }
        );
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // FEEDBACK (anyone - Principal, Teacher, Parent)
  // ============================================================
  app.post('/api/school/:schoolId/feedback', async (req, res) => {
    try {
      const { fromUserId, fromName, fromRole, type, subject, message, rating, screenshot } = req.body;
      if (!message) return res.status(400).json({ error: 'Message required' });
      const fbId = 'fb_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const feedback = {
        _id: fbId, id: fbId,
        schoolId: req.params.schoolId,
        fromUserId: fromUserId || 'anonymous',
        fromName: fromName || 'Anonymous',
        fromRole: fromRole || 'user',  // 'principal' | 'teacher' | 'parent' | 'user'
        type: type || 'general',  // 'bug' | 'feature' | 'praise' | 'complaint' | 'general'
        subject: subject || '',
        message: String(message).trim().slice(0, 2000),
        rating: rating || null,  // 1-5 stars
        screenshot: screenshot || null,
        status: 'new',  // 'new' | 'read' | 'replied' | 'resolved'
        reply: '',
        createdAt: Date.now(),
      };
      await schoolFeedbackCol.insertOne(feedback);
      // Notify school owner (principal)
      const school = await db.collection('schools').findOne({ id: req.params.schoolId });
      if (school && school.ownerId) {
        await notificationsCol.insertOne({
          _id: 'n_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
          id: undefined,
          userId: school.ownerId,
          type: 'feedback',
          from: fromUserId || 'anonymous',
          targetType: 'feedback', targetId: fbId,
          message: `📝 New feedback from ${fromName} (${fromRole}): ${message.slice(0, 80)}`,
          read: false,
          createdAt: Date.now(),
        });
        const notif = await notificationsCol.findOne({ _id: { $exists: true } }, { sort: { createdAt: -1 } });
      }
      const { _id, ...result } = feedback;
      res.json({ success: true, feedback: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get feedback (for school owner)
  app.get('/api/school/:schoolId/feedback', async (req, res) => {
    try {
      const { status, limit } = req.query;
      const query = { schoolId: req.params.schoolId };
      if (status) query.status = status;
      const lim = parseInt(limit) || 50;
      const feedbacks = await schoolFeedbackCol.find(query).sort({ createdAt: -1 }).limit(lim).toArray();
      res.json({ success: true, count: feedbacks.length, feedbacks: feedbacks.map(f => { const { _id, ...r } = f; return r; }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Reply to feedback
  app.post('/api/school/feedback/:feedbackId/reply', async (req, res) => {
    try {
      const { reply, status } = req.body;
      const update = {};
      if (reply) update.reply = reply;
      if (status) update.status = status;
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });
      await schoolFeedbackCol.updateOne({ id: req.params.feedbackId }, { $set: update });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  connectDB_school_chat().catch(e => console.error('School chat init error:', e.message));
};
