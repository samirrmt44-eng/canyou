// ============================================================
// canyou #1rank - MongoDB Persistent Version
// ============================================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// MONGODB CONNECTION
// ============================================================
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/canyou';
let db = null;
let linksCol = null;
let commentsCol = null;
let usersCol = null;
let votesCol = null;

async function connectDB() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    db = client.db();
    linksCol = db.collection('links');
    commentsCol = db.collection('comments');
    usersCol = db.collection('users');
    votesCol = db.collection('votes');

    // Create indexes
    await linksCol.createIndex({ addedAt: -1 });
    await commentsCol.createIndex({ linkId: 1, createdAt: -1 });
    await usersCol.createIndex({ id: 1 }, { unique: true });
    await votesCol.createIndex({ commentId: 1, userId: 1 }, { unique: true });

    // Seed data if empty
    await seedIfEmpty();

    console.log('✅ MongoDB connected!');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.log('⚠️  Falling back to in-memory mode (data will be lost on restart)');
  }
}

async function seedIfEmpty() {
  const linkCount = await linksCol.countDocuments();
  if (linkCount > 0) return;

  console.log('🌱 Seeding initial data...');
  const SEED_LINKS = [
    { _id: 'seed_1', url: 'https://www.bbc.com/news/world', title: 'BBC World News - Latest Global Stories', description: 'Breaking news, world news, US news, sport, business...', thumbnail: 'https://ui-avatars.com/api/?name=BBC&size=600&background=000000&color=fff&bold=true', platform: 'news', domain: 'bbc.com', author: 'BBC News', addedBy: 'canyou Official', addedById: 'system', addedAt: Date.now() - 86400000, commentCount: 0 },
    { _id: 'seed_2', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '🎬 YouTube Video Discussion', description: 'Paste any YouTube video link to discuss it!', thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', platform: 'youtube', domain: 'youtube.com', author: 'Various', addedBy: 'canyou Official', addedById: 'system', addedAt: Date.now() - 7200000, commentCount: 0 },
    { _id: 'seed_3', url: 'https://dainikstate.com', title: 'DainikState - Jharkhand Hindi News', description: 'झारखंड की ताज़ा खबरें, राजनीति, क्राइम', thumbnail: 'https://ui-avatars.com/api/?name=DainikState&size=600&background=b71c1c&color=fff&bold=true', platform: 'news', domain: 'dainikstate.com', author: 'DainikState', addedBy: 'canyou Official', addedById: 'system', addedAt: Date.now() - 3600000, commentCount: 0 },
    { _id: 'seed_4', url: 'https://www.theverge.com/tech', title: 'The Verge - Tech, Science, Culture', description: 'Tech news, reviews, and more.', thumbnail: 'https://ui-avatars.com/api/?name=The+Verge&size=600&background=ff6b6b&color=fff&bold=true', platform: 'news', domain: 'theverge.com', author: 'The Verge', addedBy: 'canyou Official', addedById: 'system', addedAt: Date.now() - 1800000, commentCount: 0 },
    { _id: 'seed_5', url: 'https://twitter.com/elonmusk', title: 'Twitter/X - Latest Tweets', description: 'Paste any Twitter/X link to discuss', thumbnail: 'https://ui-avatars.com/api/?name=Twitter&size=600&background=1da1f2&color=fff&bold=true', platform: 'twitter', domain: 'twitter.com', author: 'Twitter/X', addedBy: 'canyou Official', addedById: 'system', addedAt: Date.now() - 600000, commentCount: 0 },
  ];

  const SEED_COMMENTS = [
    { _id: 'seed_c1', linkId: 'seed_1', userId: 'seed_user_1', userName: 'NewsNinja', userLocation: 'Delhi, India', userReputation: 4.5, text: 'BBC has the most reliable news coverage worldwide. Their investigative journalism is top-notch! 💪', upvotes: 28, downvotes: 2, replyCount: 0, createdAt: Date.now() - 50000000, qualityScore: 8, acceptedChallenge: true },
    { _id: 'seed_c2', linkId: 'seed_1', userId: 'seed_user_2', userName: 'TruthSeeker', userLocation: 'Mumbai, India', userReputation: 3.8, text: 'I trust BBC more than any other source. They maintain neutrality even in polarizing topics.', upvotes: 22, downvotes: 3, replyCount: 0, createdAt: Date.now() - 40000000, qualityScore: 7, acceptedChallenge: true },
    { _id: 'seed_c3', linkId: 'seed_3', userId: 'seed_user_4', userName: 'JharkhandLover', userLocation: 'Jamshedpur, India', userReputation: 5.0, text: 'DainikState hamare area ki sabse authentic news site hai. Regular padhta hoon! 📰', upvotes: 35, downvotes: 0, replyCount: 0, createdAt: Date.now() - 20000000, qualityScore: 9, acceptedChallenge: true },
  ];

  await linksCol.insertMany(SEED_LINKS);
  await commentsCol.insertMany(SEED_COMMENTS);
  for (const link of SEED_LINKS) {
    const count = SEED_COMMENTS.filter(c => c.linkId === link._id).length;
    if (count > 0) await linksCol.updateOne({ _id: link._id }, { $set: { commentCount: count } });
  }
  console.log(`✅ Seeded ${SEED_LINKS.length} links, ${SEED_COMMENTS.length} comments`);
}

// ============================================================
// HELPERS
// ============================================================
function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com')) return 'facebook';
  if (u.includes('reddit.com')) return 'reddit';
  return 'web';
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return 'unknown'; }
}

function extractYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  return m ? m[1] : null;
}

function calculateCommentScore(c) {
  const ageHours = (Date.now() - c.createdAt) / 3600000;
  const votes = (c.upvotes || 0) - (c.downvotes || 0);
  return (votes + (c.qualityScore || 0) * 2 + Math.min((c.text?.length || 0) / 100, 5)) / Math.pow(ageHours + 2, 1.5);
}

function calculateQualityScore(text) {
  if (!text) return 0;
  let s = 0;
  if (text.length > 50) s += 2;
  if (text.length > 150) s += 2;
  if (text.match(/[?.!]/)) s += 1;
  return Math.max(0, Math.min(s, 10));
}

function rankComments(comments) {
  return comments.map(c => ({ ...c, score: calculateCommentScore(c) })).sort((a, b) => b.score - a.score);
}

// ============================================================
// ROUTES
// ============================================================
app.get('/api/health', (req, res) => res.json({
  status: 'ok', message: 'canyou #1rank - MongoDB Persistent',
  database: db ? 'connected' : 'in-memory fallback',
  stats: { links: linksCol ? 'N/A (use /api/links)' : 0 }
}));

app.post('/api/auth/register', async (req, res) => {
  const { name, country, location } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!usersCol) return res.status(503).json({ error: 'Database not ready' });

  const userId = 'u_' + crypto.randomBytes(8).toString('hex');
  const sessionId = crypto.randomBytes(16).toString('hex');
  const user = {
    id: userId, sessionId, name, location: location || 'Unknown', country: country || 'India',
    reputation: 1, commentsPosted: 0, linksAdded: 0, joinedAt: Date.now()
  };
  try {
    await usersCol.insertOne({ ...user, _id: userId });
    res.json({ success: true, user, sessionId });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!usersCol) return res.status(503).json({ error: 'Database not ready' });
  const user = await usersCol.findOne({ sessionId: req.body.sessionId });
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  const { _id, ...userData } = user;
  res.json({ success: true, user: userData });
});

app.post('/api/links', async (req, res) => {
  const { url, userId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!linksCol) return res.status(503).json({ error: 'Database not ready' });

  const platform = detectPlatform(url);
  const domain = extractDomain(url);
  const linkId = 'lnk_' + crypto.randomBytes(6).toString('hex');
  let title = `${domain} - ${platform}`;
  let thumbnail = `https://ui-avatars.com/api/?name=${encodeURIComponent(domain)}&size=600&background=667eea&color=fff&bold=true`;

  if (platform === 'youtube') {
    const ytId = extractYouTubeId(url);
    if (ytId) {
      thumbnail = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
      try {
        const oembed = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { timeout: 5000 });
        title = oembed.data.title || title;
        if (oembed.data.thumbnail_url) thumbnail = oembed.data.thumbnail_url;
      } catch (e) {}
    }
  }

  let addedByName = 'User';
  if (userId) {
    const user = await usersCol.findOne({ id: userId });
    if (user) addedByName = user.name;
  }

  const link = { _id: linkId, id: linkId, url, title, description: `Discussion about ${domain}`, thumbnail, platform, domain, addedBy: addedByName, addedById: userId || 'anonymous', addedAt: Date.now(), commentCount: 0 };
  await linksCol.insertOne(link);
  if (userId) await usersCol.updateOne({ id: userId }, { $inc: { linksAdded: 1 } });
  res.json({ success: true, link });
});

app.get('/api/links', async (req, res) => {
  if (!linksCol) return res.status(503).json({ error: 'Database not ready' });
  const links = await linksCol.find({}).sort({ addedAt: -1 }).limit(50).toArray();
  const result = links.map(l => { const { _id, ...rest } = l; return rest; });
  res.json({ success: true, count: result.length, links: result });
});

app.post('/api/comments', async (req, res) => {
  const { linkId, userId, text, parentId } = req.body;
  if (!linkId || !userId || !text) return res.status(400).json({ error: 'Missing fields' });
  if (!commentsCol) return res.status(503).json({ error: 'Database not ready' });

  const link = await linksCol.findOne({ id: linkId });
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const user = await usersCol.findOne({ id: userId });
  const commentId = 'c_' + crypto.randomBytes(8).toString('hex');
  const comment = {
    _id: commentId, id: commentId, linkId, parentId: parentId || null, userId,
    userName: user?.name || 'Guest', userLocation: user?.location || 'Unknown', userReputation: user?.reputation || 1,
    text, upvotes: 0, downvotes: 0, replyCount: 0, qualityScore: calculateQualityScore(text),
    createdAt: Date.now(), acceptedChallenge: true
  };
  await commentsCol.insertOne(comment);
  await linksCol.updateOne({ id: linkId }, { $inc: { commentCount: 1 } });
  if (user) await usersCol.updateOne({ id: userId }, { $inc: { commentsPosted: 1, reputation: 0.1 } });
  const { _id, ...result } = comment;
  res.json({ success: true, comment: result });
});

app.get('/api/comments', async (req, res) => {
  const { linkId, sortBy } = req.query;
  if (!linkId) return res.status(400).json({ error: 'linkId required' });
  if (!commentsCol) return res.status(503).json({ error: 'Database not ready' });

  let comments = await commentsCol.find({ linkId }).toArray();
  if (sortBy === 'top') comments.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
  else if (sortBy === 'new') comments.sort((a, b) => b.createdAt - a.createdAt);
  else comments = rankComments(comments);
  const result = comments.map(c => { const { _id, ...rest } = c; return rest; });
  res.json({ success: true, count: result.length, comments: result });
});

app.post('/api/comments/:commentId/vote', async (req, res) => {
  const comment = await commentsCol.findOne({ id: req.params.commentId });
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const voteId = `${req.body.userId}_${req.params.commentId}`;
  const existingVote = await votesCol.findOne({ _id: voteId });

  if (existingVote?.type === req.body.voteType) {
    if (req.body.voteType === 'up') await commentsCol.updateOne({ id: comment.id }, { $inc: { upvotes: -1 } });
    else await commentsCol.updateOne({ id: comment.id }, { $inc: { downvotes: -1 } });
    await votesCol.deleteOne({ _id: voteId });
  } else {
    if (existingVote) {
      if (existingVote.type === 'up') await commentsCol.updateOne({ id: comment.id }, { $inc: { upvotes: -1 } });
      else await commentsCol.updateOne({ id: comment.id }, { $inc: { downvotes: -1 } });
    }
    if (req.body.voteType === 'up') await commentsCol.updateOne({ id: comment.id }, { $inc: { upvotes: 1 } });
    else await commentsCol.updateOne({ id: comment.id }, { $inc: { downvotes: 1 } });
    await votesCol.updateOne(
      { _id: voteId },
      { $set: { commentId: comment.id, userId: req.body.userId, type: req.body.voteType } },
      { upsert: true }
    );
  }
  const updated = await commentsCol.findOne({ id: comment.id });
  const { _id, ...result } = updated;
  res.json({ success: true, comment: result });
});

app.get(/(.*)/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ============================================================
// START
// ============================================================
connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏆 canyou #1rank running on port ${PORT}`);
    console.log(`💾 Database: ${db ? 'MongoDB (Persistent ✅)' : 'In-Memory (Temporary ⚠️)'}`);
  });
});
