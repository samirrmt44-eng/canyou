// ============================================================
// DainikState - राज्य की आवाज़ + Groups + Stories + Chat
// WhatsApp killer with Public Groups, Stories, Channels
// ============================================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const xml2js = require('xml2js');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// MONGODB
// ============================================================
const MONGO_URI = process.env.MONGODB_URI;
let db, linksCol, commentsCol, usersCol, votesCol, channelsCol;
let groupsCol, groupPostsCol, storiesCol, reactionsCol, notificationsCol;

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
    channelsCol = db.collection('channels');
    groupsCol = db.collection('groups');
    groupPostsCol = db.collection('groupPosts');
    storiesCol = db.collection('stories');
    reactionsCol = db.collection('reactions');
    notificationsCol = db.collection('notifications');

    // Indexes
    await linksCol.createIndex({ addedAt: -1 });
    await linksCol.createIndex({ source: 1, addedAt: -1 });
    await commentsCol.createIndex({ linkId: 1, createdAt: -1 });
    await usersCol.createIndex({ id: 1 }, { unique: true });
    await usersCol.createIndex({ sessionId: 1 });
    await channelsCol.createIndex({ platform: 1, channelId: 1 }, { unique: true });
    await groupsCol.createIndex({ slug: 1 }, { unique: true });
    await groupsCol.createIndex({ createdAt: -1 });
    await groupPostsCol.createIndex({ groupId: 1, createdAt: -1 });
    await storiesCol.createIndex({ userId: 1, createdAt: -1 });
    await storiesCol.createIndex({ expiresAt: 1 });
    await reactionsCol.createIndex({ targetType: 1, targetId: 1 });
    await notificationsCol.createIndex({ userId: 1, createdAt: -1 });

    console.log('✅ MongoDB connected!');
  } catch (err) {
    console.error('❌ MongoDB failed:', err.message);
  }
}

// ============================================================
// CHANNELS - YouTube, Odysee, etc.
// ============================================================
const DEFAULT_CHANNELS = [
  {
    platform: 'youtube',
    channelId: 'UCIvx776Jt6gejhpiJ563VCQ',
    handle: '@DainikState',
    name: 'DainikState',
    autoSync: true,
    syncInterval: 60,
  },
  {
    platform: 'odysee',
    channelId: '@DainikState:1',
    name: 'DainikState (Odysee)',
    autoSync: true,
    syncInterval: 60,
  },
];

// ============================================================
// YOUTUBE & ODYSEE (same as before)
// ============================================================
async function fetchYouTubeRSS(channelId) {
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const response = await axios.get(rssUrl, { timeout: 10000 });
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);
    if (!result.feed || !result.feed.entry) return [];
    const entries = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];
    return entries.map(entry => ({
      platform: 'youtube',
      url: `https://www.youtube.com/watch?v=${entry['yt:videoId']}`,
      videoId: entry['yt:videoId'],
      title: entry.title,
      description: entry['media:group']?.['media:description']?._ || entry.title,
      thumbnail: entry['media:group']?.['media:thumbnail']?.$?.url || `https://img.youtube.com/vi/${entry['yt:videoId']}/maxresdefault.jpg`,
      author: entry['author']?.name || 'DainikState',
      publishedAt: new Date(entry.published).getTime(),
    }));
  } catch (err) { return []; }
}

async function fetchOdyseeVideos(claimId) {
  try {
    const payload = { method: 'claim_search', params: { claim_type: 'stream', channel_id: claimId, page: 1, page_size: 15, order_by: ['release_time'], no_totals: true } };
    const response = await axios.post('https://api.odysee.com/api/v1/proxy', payload, { timeout: 10000 });
    return (response.data?.result?.items || []).map(item => ({
      platform: 'odysee',
      url: `https://odysee.com/${item.name}#${item.claim_id}`,
      videoId: item.claim_id,
      title: item.value?.title || 'Untitled',
      description: item.value?.description || '',
      thumbnail: item.value?.thumbnail?.url ? `https://thumbnails.odycdn.com/600x400/${item.value.thumbnail.url.split('/').pop()}` : '',
      author: claimId,
      publishedAt: item.meta?.release_time ? item.meta.release_time * 1000 : Date.now(),
      views: item.meta?.views || 0,
    }));
  } catch (err) { return []; }
}

async function syncChannel(channel) {
  let videos = [];
  if (channel.platform === 'youtube') videos = await fetchYouTubeRSS(channel.channelId);
  else if (channel.platform === 'odysee') videos = await fetchOdyseeVideos(channel.channelId);
  if (videos.length === 0) return 0;
  for (const video of videos) {
    const linkId = `${video.platform}_${video.videoId}`;
    const link = {
      _id: linkId, id: linkId, url: video.url, title: video.title,
      description: video.description?.slice(0, 500), thumbnail: video.thumbnail,
      platform: video.platform, domain: video.platform + '.com',
      author: video.author, addedBy: channel.name,
      addedById: `auto_${channel.platform}_${channel.channelId}`,
      addedAt: video.publishedAt, commentCount: 0, views: video.views || 0,
      autoImported: true, channelRef: channel.platform + ':' + channel.channelId,
    };
    try { await linksCol.updateOne({ _id: linkId }, { $set: link }, { upsert: true }); } catch (err) {}
  }
  await channelsCol.updateOne({ platform: channel.platform, channelId: channel.channelId }, { $set: { ...channel, lastSync: Date.now() } }, { upsert: true });
  return videos.length;
}

async function syncAllChannels() {
  try {
    const channels = await channelsCol.find({}).toArray();
    const allChannels = channels.length > 0 ? channels : DEFAULT_CHANNELS;
    let total = 0;
    for (const ch of allChannels) total += await syncChannel(ch);
    return total;
  } catch (err) { return 0; }
}

// ============================================================
// HELPERS
// ============================================================
function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('odysee.com')) return 'odysee';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com')) return 'facebook';
  if (u.includes('reddit.com')) return 'reddit';
  if (u.includes('tiktok.com')) return 'tiktok';
  return 'web';
}
function extractDomain(url) { try { return new URL(url).hostname.replace('www.', ''); } catch { return 'unknown'; } }
function extractYouTubeId(url) { const m = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i); return m ? m[1] : null; }
function calculateQualityScore(text) { if (!text) return 0; let s = 0; if (text.length > 50) s += 2; if (text.length > 150) s += 2; if (text.match(/[?.!]/)) s += 1; return Math.max(0, Math.min(s, 10)); }
function calculateCommentScore(c) { const ageHours = (Date.now() - c.createdAt) / 3600000; const votes = (c.upvotes || 0) - (c.downvotes || 0); return (votes + (c.qualityScore || 0) * 2 + Math.min((c.text?.length || 0) / 100, 5)) / Math.pow(ageHours + 2, 1.5); }
function rankComments(comments) { return comments.map(c => ({ ...c, score: calculateCommentScore(c) })).sort((a, b) => b.score - a.score); }

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .substring(0, 40);
}

// ============================================================
// ROUTES - HEALTH
// ============================================================
app.get('/api/health', (req, res) => res.json({ status: 'ok', database: db ? 'connected' : 'in-memory' }));

app.get('/api/sync', async (req, res) => {
  const count = await syncAllChannels();
  res.json({ success: true, synced: count });
});

app.get('/api/cleanup', async (req, res) => {
  if (!linksCol) return res.status(503).json({ error: 'DB not ready' });
  try {
    const all = await linksCol.find({}).toArray();
    const seen = new Map();
    const toDelete = [];
    for (const link of all) {
      if (seen.has(link.url)) {
        const existing = seen.get(link.url);
        if (link.autoImported && !existing.autoImported) { toDelete.push(existing._id); seen.set(link.url, link); }
        else if (!link.autoImported && existing.autoImported) toDelete.push(link._id);
        else toDelete.push(link._id);
      } else seen.set(link.url, link);
    }
    if (toDelete.length > 0) await linksCol.deleteMany({ _id: { $in: toDelete } });
    res.json({ success: true, deleted: toDelete.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// AUTH
// ============================================================
app.post('/api/auth/register', async (req, res) => {
  const { name, country, location, phone, avatar } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!usersCol) return res.status(503).json({ error: 'DB not ready' });
  const userId = 'u_' + crypto.randomBytes(8).toString('hex');
  const sessionId = crypto.randomBytes(16).toString('hex');
  const user = {
    _id: userId, id: userId, sessionId, name,
    location: location || 'Unknown', country: country || 'India',
    phone: phone || '', avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=667eea&color=fff&bold=true&size=200`,
    bio: '', reputation: 1, commentsPosted: 0, linksAdded: 0, groupsJoined: 0,
    groupsCreated: 0, joinedAt: Date.now(), lastSeen: Date.now(),
    online: true,
  };
  await usersCol.insertOne(user);
  res.json({ success: true, user, sessionId });
});

app.post('/api/auth/login', async (req, res) => {
  const user = await usersCol.findOne({ sessionId: req.body.sessionId });
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  await usersCol.updateOne({ id: user.id }, { $set: { lastSeen: Date.now(), online: true } });
  const { _id, ...userData } = user;
  res.json({ success: true, user: userData });
});

app.post('/api/auth/update', async (req, res) => {
  const { userId, name, location, bio, avatar } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const update = {};
  if (name) update.name = name;
  if (location) update.location = location;
  if (bio !== undefined) update.bio = bio;
  if (avatar) update.avatar = avatar;
  await usersCol.updateOne({ id: userId }, { $set: update });
  const user = await usersCol.findOne({ id: userId });
  const { _id, ...userData } = user;
  res.json({ success: true, user: userData });
});

// ============================================================
// LINKS (kept from before)
// ============================================================
app.post('/api/links', async (req, res) => {
  const { url, userId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!linksCol) return res.status(503).json({ error: 'DB not ready' });

  const platform = detectPlatform(url);
  const domain = extractDomain(url);
  let linkId, title = domain, description = '', thumbnail;
  if (platform === 'youtube') {
    const ytId = extractYouTubeId(url);
    if (ytId) {
      linkId = `youtube_${ytId}`;
      thumbnail = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
      try {
        const oembed = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { timeout: 5000 });
        title = oembed.data.title || title;
        if (oembed.data.thumbnail_url) thumbnail = oembed.data.thumbnail_url;
        description = (oembed.data.author_name || '') + ' • YouTube';
      } catch (e) { title = `YouTube Video (${ytId})`; }
    } else linkId = 'user_' + crypto.randomBytes(6).toString('hex');
  } else linkId = 'user_' + crypto.randomBytes(6).toString('hex');

  if (platform === 'news' || platform === 'web') {
    try {
      const response = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = response.data;
      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      const twitterTitle = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i);
      const docTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (ogTitle) title = ogTitle[1];
      else if (twitterTitle) title = twitterTitle[1];
      else if (docTitle) title = docTitle[1].trim();
      const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
      if (ogDesc) description = ogDesc[1];
      const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      if (ogImage) thumbnail = ogImage[1];
    } catch (e) {}
  }
  if (!thumbnail) thumbnail = `https://ui-avatars.com/api/?name=${encodeURIComponent(domain)}&size=600&background=667eea&color=fff&bold=true`;
  let addedByName = 'User';
  if (userId) { const user = await usersCol.findOne({ id: userId }); if (user) addedByName = user.name; }
  const existing = await linksCol.findOne({ id: linkId });
  if (existing) return res.json({ success: true, link: { ...existing, _id: undefined }, message: 'Already exists' });
  const link = {
    _id: linkId, id: linkId, url, title,
    description: description || `Discussion about ${domain}`,
    thumbnail, platform, domain, addedBy: addedByName,
    addedById: userId || 'anonymous', addedAt: Date.now(), commentCount: 0,
    autoImported: false,
  };
  await linksCol.insertOne(link);
  res.json({ success: true, link });
});

app.get('/api/links', async (req, res) => {
  if (!linksCol) return res.status(503).json({ error: 'DB not ready' });
  const { source, platform, sort } = req.query;
  const query = {};
  if (platform) query.platform = platform;
  if (source === 'channel') query.autoImported = true;
  if (source === 'user') query.autoImported = false;
  const sortBy = sort === 'hot' ? { commentCount: -1, addedAt: -1 } : { addedAt: -1 };
  const links = await linksCol.find(query).sort(sortBy).limit(50).toArray();
  res.json({ success: true, count: links.length, links: links.map(l => { const { _id, ...r } = l; return r; }) });
});

// ============================================================
// COMMENTS
// ============================================================
app.post('/api/comments', async (req, res) => {
  const { linkId, userId, text, parentId, voiceUrl } = req.body;
  if (!linkId || !userId || !text) return res.status(400).json({ error: 'Missing fields' });
  if (!commentsCol) return res.status(503).json({ error: 'DB not ready' });
  const link = await linksCol.findOne({ id: linkId });
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const user = await usersCol.findOne({ id: userId });
  const commentId = 'c_' + crypto.randomBytes(8).toString('hex');
  const comment = {
    _id: commentId, id: commentId, linkId, parentId: parentId || null, userId,
    userName: user?.name || 'Guest', userLocation: user?.location || 'Unknown',
    userAvatar: user?.avatar, userReputation: user?.reputation || 1,
    text, voiceUrl: voiceUrl || null, upvotes: 0, downvotes: 0, replyCount: 0,
    qualityScore: calculateQualityScore(text), createdAt: Date.now(), acceptedChallenge: true,
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
  if (!commentsCol) return res.status(503).json({ error: 'DB not ready' });
  let comments = await commentsCol.find({ linkId }).toArray();
  if (sortBy === 'top') comments.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
  else if (sortBy === 'new') comments.sort((a, b) => b.createdAt - a.createdAt);
  else comments = rankComments(comments);
  res.json({ success: true, count: comments.length, comments: comments.map(c => { const { _id, ...r } = c; return r; }) });
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
    await votesCol.updateOne({ _id: voteId }, { $set: { commentId: comment.id, userId: req.body.userId, type: req.body.voteType } }, { upsert: true });
  }
  const updated = await commentsCol.findOne({ id: comment.id });
  const { _id, ...result } = updated;
  res.json({ success: true, comment: result });
});

// ============================================================
// GROUPS - WhatsApp killer feature!
// ============================================================
app.post('/api/groups', async (req, res) => {
  const { name, description, type, category, userId, icon, color } = req.body;
  if (!name || !userId) return res.status(400).json({ error: 'name and userId required' });
  if (!groupsCol) return res.status(503).json({ error: 'DB not ready' });
  const user = await usersCol.findOne({ id: userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const groupId = 'g_' + crypto.randomBytes(8).toString('hex');
  const slug = slugify(name) + '-' + crypto.randomBytes(2).toString('hex');
  const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  const group = {
    _id: groupId, id: groupId, slug, name, description: description || '',
    type: type || 'public', category: category || 'general', icon: icon || '💬',
    color: color || '#667eea', cover: '', admin: userId, admins: [userId],
    members: [userId], memberCount: 1, pendingMembers: [], blockedMembers: [],
    whoCanPost: 'everyone',  // 'admin_only' | 'everyone'
    whoCanInvite: 'everyone', // 'admin_only' | 'everyone'
    slowMode: 0,  // seconds between posts
    pinnedPostId: null,
    inviteCode, tags: [], rules: [], allowGifs: true, allowPolls: true,
    allowReactions: true, postCount: 0, memberCap: 0,  // 0 = unlimited
    createdAt: Date.now(), lastActivity: Date.now(), verified: false,
  };
  await groupsCol.insertOne(group);
  await usersCol.updateOne({ id: userId }, { $inc: { groupsCreated: 1, groupsJoined: 1 } });
  res.json({ success: true, group });
});

app.get('/api/groups', async (req, res) => {
  if (!groupsCol) return res.status(503).json({ error: 'DB not ready' });
  const { type, category, search, userId, sort, limit } = req.query;
  const query = {};
  if (type) query.type = type;
  if (category) query.category = category;
  if (search) query.name = { $regex: search, $options: 'i' };
  if (userId) {
    if (req.query.memberOnly === 'true') query.members = userId;
    else query.$or = [{ type: 'public' }, { members: userId }];
  } else query.type = 'public';
  const sortBy = sort === 'popular' ? { memberCount: -1, lastActivity: -1 } : { lastActivity: -1 };
  const lim = parseInt(limit) || 30;
  const groups = await groupsCol.find(query).sort(sortBy).limit(lim).toArray();
  res.json({ success: true, count: groups.length, groups: groups.map(g => { const { _id, ...r } = g; return r; }) });
});

app.get('/api/groups/:groupId', async (req, res) => {
  if (!groupsCol) return res.status(503).json({ error: 'DB not ready' });
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) {
    const groupBySlug = await groupsCol.findOne({ slug: req.params.groupId });
    if (!groupBySlug) return res.status(404).json({ error: 'Group not found' });
    const { _id, ...result } = groupBySlug;
    return res.json({ success: true, group: result });
  }
  const { _id, ...result } = group;
  res.json({ success: true, group: result });
});

app.post('/api/groups/:groupId/join', async (req, res) => {
  const { userId, inviteCode } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.type === 'private' && group.inviteCode !== inviteCode) return res.status(403).json({ error: 'Invalid invite code' });
  if (group.blockedMembers?.includes(userId)) return res.status(403).json({ error: 'You are blocked from this group' });
  if (group.members.includes(userId)) return res.json({ success: true, message: 'Already member' });
  if (group.type === 'private' && !group.members.includes(userId)) {
    // Add to pending
    if (!group.pendingMembers?.includes(userId)) {
      const pending = group.pendingMembers || [];
      pending.push(userId);
      await groupsCol.updateOne({ id: group.id }, { $set: { pendingMembers: pending } });
      return res.json({ success: true, message: 'Request sent to admin', pending: true });
    }
    return res.json({ success: true, message: 'Already requested' });
  }
  const members = [...group.members, userId];
  await groupsCol.updateOne({ id: group.id }, { $set: { members, memberCount: members.length, lastActivity: Date.now() } });
  await usersCol.updateOne({ id: userId }, { $inc: { groupsJoined: 1 } });
  res.json({ success: true });
});

app.post('/api/groups/:groupId/leave', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.admin === userId) return res.status(403).json({ error: 'Admin cannot leave, transfer admin first' });
  const members = group.members.filter(m => m !== userId);
  const admins = (group.admins || []).filter(a => a !== userId);
  await groupsCol.updateOne({ id: group.id }, { $set: { members, admins, memberCount: members.length } });
  res.json({ success: true });
});

app.post('/api/groups/:groupId/approve', async (req, res) => {
  const { userId, adminId } = req.body;
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins?.includes(adminId)) return res.status(403).json({ error: 'Only admin can approve' });
  const pending = (group.pendingMembers || []).filter(m => m !== userId);
  const members = group.members.includes(userId) ? group.members : [...group.members, userId];
  await groupsCol.updateOne({ id: group.id }, { $set: { pendingMembers: pending, members, memberCount: members.length } });
  res.json({ success: true });
});

app.post('/api/groups/:groupId/block', async (req, res) => {
  const { userId, adminId } = req.body;
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins?.includes(adminId)) return res.status(403).json({ error: 'Only admin can block' });
  if (group.admin === userId) return res.status(403).json({ error: 'Cannot block admin' });
  const members = group.members.filter(m => m !== userId);
  const admins = (group.admins || []).filter(a => a !== userId);
  const blocked = [...(group.blockedMembers || []), userId];
  await groupsCol.updateOne({ id: group.id }, { $set: { members, admins, blockedMembers: blocked, memberCount: members.length } });
  res.json({ success: true });
});

app.post('/api/groups/:groupId/promote', async (req, res) => {
  const { userId, adminId } = req.body;
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.admin !== adminId) return res.status(403).json({ error: 'Only owner can promote' });
  const admins = group.admins.includes(userId) ? group.admins : [...(group.admins || []), userId];
  await groupsCol.updateOne({ id: group.id }, { $set: { admins } });
  res.json({ success: true });
});

app.post('/api/groups/:groupId/settings', async (req, res) => {
  const { adminId, ...settings } = req.body;
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins?.includes(adminId)) return res.status(403).json({ error: 'Only admin can change settings' });
  const allowed = ['name', 'description', 'icon', 'color', 'cover', 'whoCanPost', 'whoCanInvite', 'slowMode', 'allowGifs', 'allowPolls', 'allowReactions', 'rules', 'tags', 'category', 'type', 'memberCap'];
  const update = {};
  for (const key of allowed) if (settings[key] !== undefined) update[key] = settings[key];
  await groupsCol.updateOne({ id: group.id }, { $set: update });
  res.json({ success: true });
});

app.post('/api/groups/:groupId/pin', async (req, res) => {
  const { postId, adminId } = req.body;
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins?.includes(adminId)) return res.status(403).json({ error: 'Only admin can pin' });
  await groupsCol.updateOne({ id: group.id }, { $set: { pinnedPostId: postId } });
  res.json({ success: true });
});

// ============================================================
// GROUP POSTS (text, image, video, gif, poll, link, voice)
// ============================================================
app.post('/api/groups/:groupId/posts', async (req, res) => {
  const { userId, type, text, mediaUrl, thumbnail, linkUrl, linkTitle, linkDescription, linkImage, pollOptions, voiceUrl, parentId } = req.body;
  if (!userId || !text && !mediaUrl && !linkUrl) return res.status(400).json({ error: 'userId and content required' });
  if (!groupPostsCol) return res.status(503).json({ error: 'DB not ready' });
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.members.includes(userId)) return res.status(403).json({ error: 'Join group first' });
  if (group.whoCanPost === 'admin_only' && !group.admins?.includes(userId)) return res.status(403).json({ error: 'Only admin can post' });
  if (group.blockedMembers?.includes(userId)) return res.status(403).json({ error: 'You are blocked' });
  if (group.memberCap > 0 && group.members.length >= group.memberCap) return res.status(403).json({ error: 'Group is full' });
  // Slow mode
  if (group.slowMode > 0) {
    const last = await groupPostsCol.findOne({ groupId: group.id, userId }, { sort: { createdAt: -1 } });
    if (last && (Date.now() - last.createdAt) < group.slowMode * 1000) {
      return res.status(429).json({ error: `Slow mode: wait ${group.slowMode}s` });
    }
  }
  const postId = 'gp_' + crypto.randomBytes(8).toString('hex');
  const post = {
    _id: postId, id: postId, groupId: group.id, userId,
    type: type || 'text',  // 'text' | 'image' | 'video' | 'gif' | 'link' | 'poll' | 'voice' | 'mixed'
    text: text || '', mediaUrl: mediaUrl || null, thumbnail: thumbnail || null,
    linkUrl: linkUrl || null, linkTitle: linkTitle || null,
    linkDescription: linkDescription || null, linkImage: linkImage || null,
    pollOptions: pollOptions || null,  // [{id, text, votes: []}]
    voiceUrl: voiceUrl || null, parentId: parentId || null,
    reactions: { like: [], love: [], laugh: [], wow: [], sad: [], angry: [] },
    reactionCount: 0, commentCount: 0, shareCount: 0, viewCount: 0,
    pinned: false, edited: false, deleted: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await groupPostsCol.insertOne(post);
  await groupsCol.updateOne({ id: group.id }, { $inc: { postCount: 1 }, $set: { lastActivity: Date.now() } });
  res.json({ success: true, post });
});

app.get('/api/groups/:groupId/posts', async (req, res) => {
  if (!groupPostsCol) return res.status(503).json({ error: 'DB not ready' });
  const { userId, sort, limit, before } = req.query;
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.type === 'private' && userId && !group.members.includes(userId)) return res.status(403).json({ error: 'Join group first' });
  const query = { groupId: group.id, deleted: { $ne: true } };
  if (before) query.createdAt = { $lt: parseInt(before) };
  const sortBy = sort === 'top' ? { reactionCount: -1, createdAt: -1 } : { pinned: -1, createdAt: -1 };
  const lim = parseInt(limit) || 30;
  const posts = await groupPostsCol.find(query).sort(sortBy).limit(lim).toArray();
  // Hydrate with user info
  const userIds = [...new Set(posts.map(p => p.userId))];
  const users = await usersCol.find({ id: { $in: userIds } }).toArray();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = { name: u.name, avatar: u.avatar, location: u.location, reputation: u.reputation }; });
  res.json({ success: true, count: posts.length, posts: posts.map(p => { const { _id, ...r } = p; return { ...r, user: userMap[p.userId] }; }) });
});

app.delete('/api/groups/posts/:postId', async (req, res) => {
  const { userId } = req.body;
  const post = await groupPostsCol.findOne({ id: req.params.postId });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const group = await groupsCol.findOne({ id: post.groupId });
  if (post.userId !== userId && !group.admins?.includes(userId)) return res.status(403).json({ error: 'Not allowed' });
  await groupPostsCol.updateOne({ id: post.id }, { $set: { deleted: true, text: '[Deleted]' } });
  res.json({ success: true });
});

// ============================================================
// REACTIONS (like/love/laugh/wow/sad/angry)
// ============================================================
app.post('/api/reactions', async (req, res) => {
  const { userId, targetType, targetId, reaction } = req.body;
  // targetType: 'post' | 'comment' | 'groupPost'
  if (!userId || !targetType || !targetId || !reaction) return res.status(400).json({ error: 'Missing fields' });
  if (!reactionsCol) return res.status(503).json({ error: 'DB not ready' });
  const reactionId = `${userId}_${targetType}_${targetId}`;
  const existing = await reactionsCol.findOne({ _id: reactionId });
  if (existing) {
    if (existing.reaction === reaction) {
      // Toggle off
      await reactionsCol.deleteOne({ _id: reactionId });
    } else {
      // Change reaction
      await reactionsCol.updateOne({ _id: reactionId }, { $set: { reaction, createdAt: Date.now() } });
    }
  } else {
    await reactionsCol.insertOne({ _id: reactionId, userId, targetType, targetId, reaction, createdAt: Date.now() });
  }
  // Get all reactions for this target
  const all = await reactionsCol.find({ targetType, targetId }).toArray();
  const summary = { like: 0, love: 0, laugh: 0, wow: 0, sad: 0, angry: 0, total: all.length };
  const userReactions = {};
  all.forEach(r => { summary[r.reaction] = (summary[r.reaction] || 0) + 1; userReactions[r.userId] = r.reaction; });
  // Update post count
  if (targetType === 'groupPost') {
    await groupPostsCol.updateOne({ id: targetId }, { $set: { reactions: summary, reactionCount: summary.total } });
  }
  res.json({ success: true, summary, userReactions });
});

app.get('/api/reactions', async (req, res) => {
  const { targetType, targetId, userId } = req.query;
  const all = await reactionsCol.find({ targetType, targetId }).toArray();
  const summary = { like: 0, love: 0, laugh: 0, wow: 0, sad: 0, angry: 0, total: all.length };
  const userReactions = {};
  all.forEach(r => { summary[r.reaction] = (summary[r.reaction] || 0) + 1; userReactions[r.userId] = r.reaction; });
  res.json({ success: true, summary, myReaction: userId ? userReactions[userId] : null });
});

// ============================================================
// STORIES (24h ephemeral content)
// ============================================================
app.post('/api/stories', async (req, res) => {
  const { userId, type, content, background, fontStyle, duration } = req.body;
  if (!userId || !content) return res.status(400).json({ error: 'userId and content required' });
  if (!storiesCol) return res.status(503).json({ error: 'DB not ready' });
  const storyId = 's_' + crypto.randomBytes(8).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;  // 24 hours
  const story = {
    _id: storyId, id: storyId, userId, type: type || 'text',  // 'text' | 'image' | 'video'
    content, background: background || '#667eea', fontStyle: fontStyle || 'normal',
    duration: duration || 5,  // seconds
    viewers: [], viewCount: 0, reactions: {},
    createdAt: Date.now(), expiresAt,
  };
  await storiesCol.insertOne(story);
  res.json({ success: true, story });
});

app.get('/api/stories', async (req, res) => {
  if (!storiesCol) return res.status(503).json({ error: 'DB not ready' });
  // Clean up expired
  await storiesCol.deleteMany({ expiresAt: { $lt: Date.now() } });
  const { userId } = req.query;
  // Get stories from user's groups + own + public
  let userGroupIds = [];
  if (userId) {
    const userGroups = await groupsCol.find({ members: userId }).toArray();
    userGroupIds = userGroups.map(g => g.id);
  }
  const query = { expiresAt: { $gt: Date.now() } };
  const stories = await storiesCol.find(query).sort({ createdAt: -1 }).limit(100).toArray();
  // Group by user
  const grouped = {};
  stories.forEach(s => {
    if (!grouped[s.userId]) grouped[s.userId] = { userId: s.userId, stories: [], latestAt: 0 };
    grouped[s.userId].stories.push(s);
    if (s.createdAt > grouped[s.userId].latestAt) grouped[s.userId].latestAt = s.createdAt;
  });
  const userIds = Object.keys(grouped);
  const users = await usersCol.find({ id: { $in: userIds } }).toArray();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = { name: u.name, avatar: u.avatar }; });
  const result = Object.values(grouped).map(g => ({ ...g, user: userMap[g.userId] }));
  res.json({ success: true, count: result.length, groups: result });
});

app.post('/api/stories/:storyId/view', async (req, res) => {
  const { userId } = req.body;
  const story = await storiesCol.findOne({ id: req.params.storyId });
  if (!story) return res.status(404).json({ error: 'Story not found' });
  if (!story.viewers?.includes(userId)) {
    const viewers = [...(story.viewers || []), userId];
    await storiesCol.updateOne({ id: story.id }, { $set: { viewers, viewCount: viewers.length } });
  }
  res.json({ success: true });
});

// ============================================================
// NOTIFICATIONS
// ============================================================
app.post('/api/notifications', async (req, res) => {
  const { userId, type, from, targetType, targetId, message } = req.body;
  if (!userId || !type) return res.status(400).json({ error: 'userId and type required' });
  const notif = {
    _id: 'n_' + crypto.randomBytes(8).toString('hex'),
    id: undefined, userId, type, from, targetType, targetId, message,
    read: false, createdAt: Date.now(),
  };
  notif.id = notif._id;
  await notificationsCol.insertOne(notif);
  res.json({ success: true, notification: notif });
});

app.get('/api/notifications', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const notifs = await notificationsCol.find({ userId }).sort({ createdAt: -1 }).limit(50).toArray();
  // Hydrate from users
  const fromIds = [...new Set(notifs.map(n => n.from).filter(Boolean))];
  const users = await usersCol.find({ id: { $in: fromIds } }).toArray();
  const userMap = {};
  users.forEach(u => { userMap[u.id] = { name: u.name, avatar: u.avatar }; });
  res.json({ success: true, count: notifs.length, notifications: notifs.map(n => { const { _id, ...r } = n; return { ...r, fromUser: userMap[n.from] }; }) });
});

app.post('/api/notifications/read', async (req, res) => {
  const { userId, notifId } = req.body;
  if (notifId) {
    await notificationsCol.updateOne({ id: notifId }, { $set: { read: true } });
  } else {
    await notificationsCol.updateMany({ userId }, { $set: { read: true } });
  }
  res.json({ success: true });
});

// ============================================================
// USERS & DISCOVERY
// ============================================================
app.get('/api/users/:userId', async (req, res) => {
  const user = await usersCol.findOne({ id: req.params.userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { _id, sessionId, ...result } = user;
  res.json({ success: true, user: result });
});

app.get('/api/users', async (req, res) => {
  const { search, location, limit } = req.query;
  const query = {};
  if (search) query.name = { $regex: search, $options: 'i' };
  if (location) query.location = { $regex: location, $options: 'i' };
  const users = await usersCol.find(query).sort({ reputation: -1 }).limit(parseInt(limit) || 30).toArray();
  res.json({ success: true, count: users.length, users: users.map(u => { const { _id, sessionId, ...r } = u; return r; }) });
});

app.get('/api/leaderboard', async (req, res) => {
  const { location } = req.query;
  const query = {};
  if (location && location !== 'all') query.location = { $regex: location, $options: 'i' };
  const users = await usersCol.find(query).sort({ reputation: -1 }).limit(20).toArray();
  res.json({ success: true, top: users.map(u => { const { _id, sessionId, ...r } = u; return r; }) });
});

app.get('/api/channels', async (req, res) => {
  if (!channelsCol) return res.json({ channels: DEFAULT_CHANNELS });
  const channels = await channelsCol.find({}).toArray();
  res.json({ success: true, channels: channels.length > 0 ? channels : DEFAULT_CHANNELS });
});

// ============================================================
// EXPLORE / DISCOVERY (trending, recommended)
// ============================================================
app.get('/api/explore', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB not ready' });
  const [topGroups, topPosts, popularUsers] = await Promise.all([
    groupsCol.find({ type: 'public' }).sort({ memberCount: -1, lastActivity: -1 }).limit(6).toArray(),
    groupPostsCol.find({ deleted: { $ne: true } }).sort({ reactionCount: -1, createdAt: -1 }).limit(10).toArray(),
    usersCol.find({}).sort({ reputation: -1 }).limit(10).toArray(),
  ]);
  res.json({
    success: true,
    trendingGroups: topGroups.map(g => { const { _id, ...r } = g; return r; }),
    topPosts: topPosts.map(p => { const { _id, ...r } = p; return r; }),
    popularUsers: popularUsers.map(u => { const { _id, sessionId, ...r } = u; return r; }),
  });
});

// ============================================================
// FALLBACK
// ============================================================
app.get(/(.*)/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ============================================================
// START
// ============================================================
connectDB().then(async () => {
  console.log('🚀 Initial channel sync...');
  await syncAllChannels();
  setInterval(async () => {
    console.log('🔄 Periodic channel sync...');
    await syncAllChannels();
  }, 30 * 60 * 1000);
  // Clean up expired stories every hour
  setInterval(async () => {
    if (storiesCol) await storiesCol.deleteMany({ expiresAt: { $lt: Date.now() } });
  }, 60 * 60 * 1000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏆 DainikState running on port ${PORT}`);
    console.log(`📺 Groups, Stories, Posts, Channels all live!`);
  });
});
