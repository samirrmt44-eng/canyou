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
// Aggressive no-cache for static files (so users always get latest code)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// MONGODB
// ============================================================
const MONGO_URI = process.env.MONGODB_URI;
let db, linksCol, commentsCol, usersCol, votesCol, channelsCol;
let groupsCol, groupPostsCol, storiesCol, reactionsCol, notificationsCol;
let callsCol, callSignalsCol, invitesCol;

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
    callsCol = db.collection('calls');
    callSignalsCol = db.collection('callSignals');
    invitesCol = db.collection('invites');
    liveStreamsCol = db.collection('liveStreams');
    liveChatCol = db.collection('liveChat');
    liveSignalsCol = db.collection('liveSignals');
    odyseeChannelsCol = db.collection('odyseeChannels');

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
    await callsCol.createIndex({ callId: 1 }, { unique: true });
    await callsCol.createIndex({ 'participants.userId': 1 });
    await callSignalsCol.createIndex({ callId: 1, createdAt: 1 });
    await invitesCol.createIndex({ code: 1 }, { unique: true });
    await invitesCol.createIndex({ groupId: 1 });

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
    whoCanCall: 'everyone',  // 'everyone' | 'admins_only' | 'specific'
    allowedCallers: [],  // userIds allowed to call when whoCanCall='specific'
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
  const allowed = ['name', 'description', 'icon', 'color', 'cover', 'whoCanPost', 'whoCanInvite', 'whoCanCall', 'allowedCallers', 'slowMode', 'allowGifs', 'allowPolls', 'allowReactions', 'rules', 'tags', 'category', 'type', 'memberCap'];
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
// LIVE STREAMING (in group)
// ============================================================
let liveStreamsCol, liveChatCol;

async function connectDB_more() {
  liveStreamsCol = db.collection('liveStreams');
  liveChatCol = db.collection('liveChat');
  await liveStreamsCol.createIndex({ groupId: 1, status: 1 });
  await liveStreamsCol.createIndex({ streamId: 1 }, { unique: true });
  await liveChatCol.createIndex({ streamId: 1, createdAt: 1 });
}

// Start a live stream in a group
app.post('/api/groups/:groupId/live/start', async (req, res) => {
  const { userId, title, description } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (!liveStreamsCol) return res.status(503).json({ error: 'DB not ready' });
  if (!await connectDB_more()) {} // init if needed
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins?.includes(userId)) return res.status(403).json({ error: 'Only admin can start live stream' });
  // Check if there's already an active stream
  const existing = await liveStreamsCol.findOne({ groupId: group.id, status: 'live' });
  if (existing) return res.status(400).json({ error: 'A live stream is already active in this group' });
  const user = await usersCol.findOne({ id: userId });
  const streamId = 'live_' + crypto.randomBytes(6).toString('hex');
  const stream = {
    _id: streamId, streamId, groupId: group.id,
    streamerId: userId, streamerName: user?.name || 'Host',
    streamerAvatar: user?.avatar,
    title: title || `${user?.name} live!`,
    description: description || '',
    type: 'video',  // 'video' | 'audio' | 'screen'
    status: 'live',  // 'live' | 'ended'
    viewers: [], viewerCount: 0, peakViewers: 0,
    startedAt: Date.now(), endedAt: null, duration: 0,
  };
  await liveStreamsCol.insertOne(stream);
  // Post in group as a live post
  await groupPostsCol.insertOne({
    _id: 'gplive_' + streamId,
    id: 'gplive_' + streamId,
    groupId: group.id,
    userId,
    type: 'live',  // new type
    text: '🔴 LIVE: ' + (title || `${user?.name} is live now!`),
    mediaUrl: null, thumbnail: null,
    linkUrl: null, linkTitle: null, linkDescription: null, linkImage: null,
    pollOptions: null, voiceUrl: null, parentId: null,
    reactions: { like: [], love: [], laugh: [], wow: [], sad: [], angry: [] },
    reactionCount: 0, commentCount: 0, shareCount: 0, viewCount: 0,
    pinned: false, edited: false, deleted: false,
    liveStreamId: streamId,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  // Notify all group members
  for (const memberId of group.members) {
    if (memberId === userId) continue;
    await notificationsCol.insertOne({
      _id: 'n_' + crypto.randomBytes(8).toString('hex'),
      id: undefined, userId: memberId,
      type: 'live_stream', from: userId, targetType: 'liveStream', targetId: streamId,
      message: `🔴 ${user?.name} is live in ${group.name}!`,
      read: false, createdAt: Date.now(),
    });
    const notif = await notificationsCol.findOne({ _id: { $exists: true } }, { sort: { createdAt: -1 } });
  }
  res.json({ success: true, stream });
});

// Get active live streams for a group
app.get('/api/groups/:groupId/live/active', async (req, res) => {
  if (!liveStreamsCol) return res.status(503).json({ error: 'DB not ready' });
  const streams = await liveStreamsCol.find({ groupId: req.params.groupId, status: 'live' }).toArray();
  res.json({ success: true, streams: streams.map(s => { const { _id, ...r } = s; return r; }) });
});

// Get all live streams (across groups user is in)
app.get('/api/live/active', async (req, res) => {
  const { userId } = req.query;
  if (!liveStreamsCol) return res.status(503).json({ error: 'DB not ready' });
  let query = { status: 'live' };
  if (userId) {
    const userGroups = await groupsCol.find({ members: userId }).toArray();
    const groupIds = userGroups.map(g => g.id);
    query.groupId = { $in: groupIds };
  }
  const streams = await liveStreamsCol.find(query).sort({ startedAt: -1 }).limit(20).toArray();
  res.json({ success: true, count: streams.length, streams: streams.map(s => { const { _id, ...r } = s; return r; }) });
});

// Join a live stream (track viewer)
app.post('/api/live/:streamId/join', async (req, res) => {
  const { userId } = req.body;
  if (!liveStreamsCol) return res.status(503).json({ error: 'DB not ready' });
  const stream = await liveStreamsCol.findOne({ streamId: req.params.streamId });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });
  if (!stream.viewers?.includes(userId)) {
    const viewers = [...(stream.viewers || []), userId];
    const peakViewers = Math.max(viewers.length, stream.peakViewers || 0);
    await liveStreamsCol.updateOne({ streamId: stream.streamId }, { $set: { viewers, viewerCount: viewers.length, peakViewers } });
  }
  res.json({ success: true });
});

app.post('/api/live/:streamId/leave', async (req, res) => {
  const { userId } = req.body;
  if (!liveStreamsCol) return res.status(503).json({ error: 'DB not ready' });
  const stream = await liveStreamsCol.findOne({ streamId: req.params.streamId });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });
  const viewers = (stream.viewers || []).filter(v => v !== userId);
  await liveStreamsCol.updateOne({ streamId: stream.streamId }, { $set: { viewers, viewerCount: viewers.length } });
  res.json({ success: true });
});

// End a live stream
app.post('/api/live/:streamId/end', async (req, res) => {
  const { userId } = req.body;
  if (!liveStreamsCol) return res.status(503).json({ error: 'DB not ready' });
  const stream = await liveStreamsCol.findOne({ streamId: req.params.streamId });
  if (!stream) return res.status(404).json({ error: 'Stream not found' });
  // Allow streamer OR group admin/owner to end the stream
  const group = await groupsCol.findOne({ id: stream.groupId });
  const isStreamer = stream.streamerId === userId;
  const isGroupAdmin = group && group.admins?.includes(userId);
  if (!isStreamer && !isGroupAdmin) return res.status(403).json({ error: 'Only streamer or group admin can end' });
  await liveStreamsCol.updateOne({ streamId: stream.streamId }, { $set: { status: 'ended', endedAt: Date.now(), duration: Math.floor((Date.now() - stream.startedAt) / 1000) } });
  // Remove the live post
  await groupPostsCol.deleteOne({ id: 'gplive_' + stream.streamId });
  res.json({ success: true });
});

// Force-end any active stream in a group (used when stuck)
app.post('/api/groups/:groupId/live/force-end', async (req, res) => {
  const { userId } = req.body;
  if (!liveStreamsCol) return res.status(503).json({ error: 'DB not ready' });
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins?.includes(userId)) return res.status(403).json({ error: 'Only admin can force-end' });
  const activeStreams = await liveStreamsCol.find({ groupId: group.id, status: 'live' }).toArray();
  for (const s of activeStreams) {
    await liveStreamsCol.updateOne({ streamId: s.streamId }, { $set: { status: 'ended', endedAt: Date.now(), duration: Math.floor((Date.now() - s.startedAt) / 1000), forceEnded: true } });
    await groupPostsCol.deleteOne({ id: 'gplive_' + s.streamId });
  }
  res.json({ success: true, ended: activeStreams.length });
});

// Live chat - send message
app.post('/api/live/:streamId/chat', async (req, res) => {
  const { userId, text } = req.body;
  if (!userId || !text) return res.status(400).json({ error: 'userId and text required' });
  if (!liveChatCol) return res.status(503).json({ error: 'DB not ready' });
  const user = await usersCol.findOne({ id: userId });
  const msg = {
    _id: 'lc_' + crypto.randomBytes(6).toString('hex'),
    streamId: req.params.streamId, userId,
    userName: user?.name || 'Guest', userAvatar: user?.avatar,
    text: text.slice(0, 500), createdAt: Date.now(),
  };
  await liveChatCol.insertOne(msg);
  const { _id, ...result } = msg;
  res.json({ success: true, message: result });
});

// Get live chat messages
app.get('/api/live/:streamId/chat', async (req, res) => {
  if (!liveChatCol) return res.status(503).json({ error: 'DB not ready' });
  const messages = await liveChatCol.find({ streamId: req.params.streamId }).sort({ createdAt: 1 }).limit(100).toArray();
  res.json({ success: true, count: messages.length, messages: messages.map(m => { const { _id, ...r } = m; return r; }) });
});

// Live WebRTC signaling (similar to call but for streaming)
let liveSignalsCol;
async function connectDB_live() {
  liveSignalsCol = db.collection('liveSignals');
  await liveSignalsCol.createIndex({ streamId: 1, createdAt: 1 });
}
app.post('/api/live/:streamId/signal', async (req, res) => {
  const { fromUserId, toUserId, type, payload } = req.body;
  if (!liveSignalsCol) return res.status(503).json({ error: 'DB not ready' });
  const signal = {
    _id: 'lsig_' + crypto.randomBytes(8).toString('hex'),
    streamId: req.params.streamId, fromUserId, toUserId, type, payload,
    createdAt: Date.now(), read: false,
  };
  await liveSignalsCol.insertOne(signal);
  res.json({ success: true });
});
app.get('/api/live/:streamId/signals/:userId', async (req, res) => {
  if (!liveSignalsCol) return res.status(503).json({ error: 'DB not ready' });
  const signals = await liveSignalsCol.find({
    streamId: req.params.streamId, toUserId: req.params.userId, read: false,
  }).sort({ createdAt: 1 }).limit(50).toArray();
  await liveSignalsCol.updateMany({ _id: { $in: signals.map(s => s._id) } }, { $set: { read: true } });
  res.json({ success: true, signals: signals.map(s => { const { _id, ...r } = s; return r; }) });
});

// ============================================================
// WEBRTC TURN CREDENTIALS (Metered.ca)
// ============================================================
// In production, set METERED_API_KEY env var on Render
// Get free API key from https://dashboard.metered.ca/
async function getTurnCredentials() {
  const apiKey = process.env.METERED_API_KEY;
  if (!apiKey) {
    // Fallback: return only STUN servers (works for ~80% of cases)
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
      usingTurn: false,
    };
  }
  try {
    const response = await axios.get(
      `https://dainikstate.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
      { timeout: 5000 }
    );
    if (response.data && Array.isArray(response.data)) {
      return { iceServers: response.data, usingTurn: true };
    }
  } catch (err) {
    console.error('TURN credentials fetch failed:', err.message);
  }
  // Fallback
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
    usingTurn: false,
  };
}

app.get('/api/turn-credentials', async (req, res) => {
  const creds = await getTurnCredentials();
  res.json(creds);
});

// ============================================================
// INVITE LINKS - WhatsApp-style group invite
// ============================================================
app.post('/api/invites', async (req, res) => {
  const { groupId, userId, maxUses, expiresIn } = req.body;
  if (!groupId || !userId) return res.status(400).json({ error: 'groupId and userId required' });
  if (!groupsCol) return res.status(503).json({ error: 'DB not ready' });
  const group = await groupsCol.findOne({ id: groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins?.includes(userId)) return res.status(403).json({ error: 'Only admin can create invites' });
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const invite = {
    _id: code, code, groupId, createdBy: userId,
    maxUses: maxUses || 0,  // 0 = unlimited
    usedCount: 0, usedBy: [],
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : 0,  // 0 = never
    createdAt: Date.now(),
  };
  await invitesCol.insertOne(invite);
  res.json({ success: true, invite, url: `${req.protocol}://${req.get('host')}/i/${code}` });
});

app.get('/api/invites/:code', async (req, res) => {
  if (!invitesCol) return res.status(503).json({ error: 'DB not ready' });
  const invite = await invitesCol.findOne({ code: req.params.code });
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.expiresAt && invite.expiresAt < Date.now()) return res.status(410).json({ error: 'Invite expired' });
  if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses) return res.status(410).json({ error: 'Invite max uses reached' });
  const group = await groupsCol.findOne({ id: invite.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json({ success: true, invite, group: { id: group.id, name: group.name, icon: group.icon, color: group.color, description: group.description, type: group.type, memberCount: group.memberCount } });
});

app.get('/api/groups/:groupId/invites', async (req, res) => {
  if (!invitesCol) return res.status(503).json({ error: 'DB not ready' });
  const invites = await invitesCol.find({ groupId: req.params.groupId }).sort({ createdAt: -1 }).toArray();
  res.json({ success: true, invites: invites.map(i => { const { _id, ...r } = i; return r; }) });
});

app.delete('/api/invites/:code', async (req, res) => {
  const { userId } = req.body;
  const invite = await invitesCol.findOne({ code: req.params.code });
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.createdBy !== userId) return res.status(403).json({ error: 'Only creator can delete' });
  await invitesCol.deleteOne({ code: req.params.code });
  res.json({ success: true });
});

// Public landing page for invites (handled by SPA fallback below, but data via API)
app.get('/i/:code', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/groups/:groupId/allow-caller', async (req, res) => {
  const { userId, adminId, action } = req.body;  // action: 'add' | 'remove'
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.admins?.includes(adminId)) return res.status(403).json({ error: 'Only admin can manage call permissions' });
  let allowed = group.allowedCallers || [];
  if (action === 'add' && !allowed.includes(userId)) {
    allowed.push(userId);
  } else if (action === 'remove') {
    allowed = allowed.filter(u => u !== userId);
  }
  await groupsCol.updateOne({ id: group.id }, { $set: { allowedCallers: allowed, whoCanCall: 'specific' } });
  res.json({ success: true, allowedCallers: allowed });
});

app.get('/api/groups/:groupId/members', async (req, res) => {
  if (!groupsCol) return res.status(503).json({ error: 'DB not ready' });
  const group = await groupsCol.findOne({ id: req.params.groupId });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const memberIds = group.members || [];
  const users = await usersCol.find({ id: { $in: memberIds } }).toArray();
  res.json({
    success: true,
    members: users.map(u => {
      const { _id, sessionId, ...rest } = u;
      return {
        ...rest,
        isAdmin: group.admins?.includes(u.id),
        isOwner: group.admin === u.id,
        isBlocked: group.blockedMembers?.includes(u.id),
        canCall: group.whoCanCall === 'everyone' ||
                 (group.whoCanCall === 'admins_only' && group.admins?.includes(u.id)) ||
                 (group.whoCanCall === 'specific' && (group.allowedCallers || []).includes(u.id)),
      };
    }),
  });
});

// ============================================================
// JITSI CALL INTEGRATION
// ============================================================
// Uses public Jitsi Meet (https://meet.jit.si) for reliable
// voice/video calls with ring notifications
// ============================================================

// Initiate a call (caller side) - creates a Jitsi room
app.post('/api/calls/initiate', async (req, res) => {
  const { fromUserId, toUserId, groupId, type } = req.body;
  if (!fromUserId || !type) return res.status(400).json({ error: 'fromUserId and type required' });
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });

  const user = await usersCol.findOne({ id: fromUserId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Group call permissions check
  if (groupId) {
    const group = await groupsCol.findOne({ id: groupId });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.includes(fromUserId)) {
      return res.status(403).json({ error: 'You must be a member to call' });
    }
    const whoCanCall = group.whoCanCall || 'everyone';
    const isAdmin = group.admins?.includes(fromUserId);
    if (whoCanCall === 'admins_only' && !isAdmin) {
      return res.status(403).json({ error: 'Only admins/owner can start calls' });
    }
    if (whoCanCall === 'specific' && !(group.allowedCallers || []).includes(fromUserId) && !isAdmin) {
      return res.status(403).json({ error: 'Not allowed to call' });
    }
    if (group.blockedMembers?.includes(fromUserId)) {
      return res.status(403).json({ error: 'You are blocked from this group' });
    }
  }

  // Create unique room ID
  const callId = 'ds-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const jitsiRoom = `dainikstate-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  // Use 8x8.vc (no login popup, free public Jitsi instance) instead of meet.jit.si
  const jitsiUrl = `https://8x8.vc/${jitsiRoom}`;

  // Get callee info (for 1-on-1 calls)
  let calleeName = 'User';
  if (toUserId) {
    const callee = await usersCol.findOne({ id: toUserId });
    if (callee) calleeName = callee.name;
  }

  const call = {
    _id: callId, callId, type, // 'voice' | 'video'
    groupId: groupId || null,
    toUserId: toUserId || null,
    fromUserId,
    callerName: user.name,
    callerAvatar: user.avatar,
    calleeName,
    jitsiRoom,
    jitsiUrl,
    status: 'ringing', // 'ringing' | 'active' | 'ended' | 'declined' | 'missed'
    startedAt: Date.now(),
    acceptedAt: null,
    endedAt: null,
    duration: 0,
  };
  await callsCol.insertOne(call);
  const { _id, ...result } = call;

  // Send notification to receiver(s)
  if (toUserId) {
    // 1-on-1 call
    await notificationsCol.insertOne({
      _id: 'n_' + crypto.randomBytes(8).toString('hex'),
      id: undefined, userId: toUserId,
      type: 'incoming_call', from: fromUserId, targetType: 'call', targetId: callId,
      message: `📞 ${user.name} is ${type === 'video' ? 'video' : 'voice'} calling you`,
      read: false, createdAt: Date.now(),
    });
  } else if (groupId) {
    // Group call - notify all members
    const group = await groupsCol.findOne({ id: groupId });
    if (group) {
      for (const memberId of group.members) {
        if (memberId === fromUserId) continue;
        await notificationsCol.insertOne({
          _id: 'n_' + crypto.randomBytes(8).toString('hex'),
          id: undefined, userId: memberId,
          type: 'group_call', from: fromUserId, targetType: 'call', targetId: callId,
          message: `📞 ${user.name} started a ${type} call in ${group.name}`,
          read: false, createdAt: Date.now(),
        });
      }
    }
  }

  res.json({ success: true, call: result });
});

// Accept a call (callee side) - returns Jitsi URL
app.post('/api/calls/:callId/accept', async (req, res) => {
  const { userId } = req.body;
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const call = await callsCol.findOne({ callId: req.params.callId });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (call.status !== 'ringing') return res.status(400).json({ error: 'Call is not ringing' });
  // For 1-on-1, only the callee can accept
  if (call.toUserId && call.toUserId !== userId) {
    return res.status(403).json({ error: 'Not the callee' });
  }
  // For group calls, any member can accept (joins existing Jitsi room)
  await callsCol.updateOne(
    { callId: req.params.callId },
    { $set: { status: 'active', acceptedAt: Date.now(), acceptedBy: userId } }
  );
  // Notify caller that call was accepted
  await notificationsCol.insertOne({
    _id: 'n_' + crypto.randomBytes(8).toString('hex'),
    id: undefined, userId: call.fromUserId,
    type: 'call_accepted', from: userId, targetType: 'call', targetId: req.params.callId,
    message: `✅ Your call was accepted`,
    read: false, createdAt: Date.now(),
  });
  res.json({ success: true, jitsiUrl: call.jitsiUrl, jitsiRoom: call.jitsiRoom });
});

// Decline a call
app.post('/api/calls/:callId/decline', async (req, res) => {
  const { userId } = req.body;
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const call = await callsCol.findOne({ callId: req.params.callId });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (call.status !== 'ringing') return res.status(400).json({ error: 'Call is not ringing' });
  await callsCol.updateOne(
    { callId: req.params.callId },
    { $set: { status: 'declined', endedAt: Date.now(), declinedBy: userId } }
  );
  // Notify caller
  await notificationsCol.insertOne({
    _id: 'n_' + crypto.randomBytes(8).toString('hex'),
    id: undefined, userId: call.fromUserId,
    type: 'call_declined', from: userId, targetType: 'call', targetId: req.params.callId,
    message: `❌ Call declined`,
    read: false, createdAt: Date.now(),
  });
  res.json({ success: true });
});

// Get call status (for polling)
app.get('/api/calls/:callId/status', async (req, res) => {
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const call = await callsCol.findOne({ callId: req.params.callId });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  const { _id, ...result } = call;
  res.json({ success: true, call: result });
});

// End a call
app.post('/api/calls/:callId/end', async (req, res) => {
  const { userId } = req.body;
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const call = await callsCol.findOne({ callId: req.params.callId });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  const endedAt = Date.now();
  const duration = call.acceptedAt ? Math.floor((endedAt - call.acceptedAt) / 1000) : 0;
  await callsCol.updateOne(
    { callId: req.params.callId },
    { $set: { status: 'ended', endedAt, duration, endedBy: userId } }
  );
  res.json({ success: true });
});

// Start or join a call
app.post('/api/calls', async (req, res) => {
  const { type, fromUserId, toUserId, groupId } = req.body;
  if (!fromUserId || !type) return res.status(400).json({ error: 'type and fromUserId required' });
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });

  const user = await usersCol.findOne({ id: fromUserId });
  if (!user) return res.status(404).json({ error: 'User not found' });

  // GROUP CALL PERMISSIONS: Check if group has call restrictions
  if (groupId) {
    const group = await groupsCol.findOne({ id: groupId });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.includes(fromUserId)) {
      return res.status(403).json({ error: 'You must be a member to call' });
    }
    // whoCanCall: 'everyone' | 'admins_only' | 'specific' (allowedCallers list)
    const whoCanCall = group.whoCanCall || 'everyone';
    if (whoCanCall === 'admins_only' && !group.admins?.includes(fromUserId)) {
      return res.status(403).json({ error: 'Only admins/owner can start calls in this group' });
    }
    if (whoCanCall === 'specific' && !(group.allowedCallers || []).includes(fromUserId) && !group.admins?.includes(fromUserId)) {
      return res.status(403).json({ error: 'You are not allowed to call in this group' });
    }
    // Blocked users can't call
    if (group.blockedMembers?.includes(fromUserId)) {
      return res.status(403).json({ error: 'You are blocked from this group' });
    }
  }

  const callId = 'call_' + crypto.randomBytes(8).toString('hex');
  const call = {
    _id: callId, callId, type,  // 'voice' | 'video'
    groupId: groupId || null, toUserId: toUserId || null,
    fromUserId, status: 'ringing',  // 'ringing' | 'active' | 'ended'
    participants: [{ userId: fromUserId, name: user.name, avatar: user.avatar, joinedAt: Date.now() }],
    createdAt: Date.now(), startedAt: null, endedAt: null, duration: 0,
  };
  await callsCol.insertOne(call);

  // Notify other party
  if (toUserId) {
    const notifId = 'n_' + crypto.randomBytes(8).toString('hex');
    await notificationsCol.insertOne({
      _id: notifId,
      id: notifId, userId: toUserId,
      type: 'incoming_call', from: fromUserId, targetType: 'call', targetId: callId,
      message: `📞 ${user.name} is calling you (${type})`,
      read: false, createdAt: Date.now(),
    });
  } else if (groupId) {
    // Group call: notify all group members
    const group = await groupsCol.findOne({ id: groupId });
    if (group) {
      for (const memberId of group.members) {
        if (memberId === fromUserId) continue;
        await notificationsCol.insertOne({
          _id: 'n_' + crypto.randomBytes(8).toString('hex'),
          id: undefined, userId: memberId,
          type: 'group_call', from: fromUserId, targetType: 'call', targetId: callId,
          message: `📞 ${user.name} started a ${type} call in ${group.name}`,
          read: false, createdAt: Date.now(),
        });
      }
    }
  }
  res.json({ success: true, call });
});

app.get('/api/calls/:callId', async (req, res) => {
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const call = await callsCol.findOne({ callId: req.params.callId });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  const { _id, ...result } = call;
  res.json({ success: true, call: result });
});

app.post('/api/calls/:callId/answer', async (req, res) => {
  const { userId } = req.body;
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const call = await callsCol.findOne({ callId: req.params.callId });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  const user = await usersCol.findOne({ id: userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (call.participants.find(p => p.userId === userId)) return res.json({ success: true, message: 'Already in call' });
  const participants = [...call.participants, { userId, name: user.name, avatar: user.avatar, joinedAt: Date.now() }];
  await callsCol.updateOne({ callId: call.callId }, { $set: { status: 'active', startedAt: call.startedAt || Date.now(), participants } });
  // Notify other participants
  call.participants.forEach(p => {
    notificationsCol.insertOne({
      _id: 'n_' + crypto.randomBytes(8).toString('hex'),
      id: undefined, userId: p.userId,
      type: 'call_joined', from: userId, targetType: 'call', targetId: call.callId,
      message: `${user.name} joined the call`,
      read: false, createdAt: Date.now(),
    });
  });
  res.json({ success: true });
});

app.post('/api/calls/:callId/leave', async (req, res) => {
  const { userId } = req.body;
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const call = await callsCol.findOne({ callId: req.params.callId });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  const participants = call.participants.filter(p => p.userId !== userId);
  if (participants.length === 0) {
    await callsCol.updateOne({ callId: call.callId }, { $set: { status: 'ended', endedAt: Date.now(), duration: call.startedAt ? Math.floor((Date.now() - call.startedAt) / 1000) : 0, participants } });
  } else {
    await callsCol.updateOne({ callId: call.callId }, { $set: { participants } });
  }
  res.json({ success: true });
});

app.post('/api/calls/:callId/end', async (req, res) => {
  const { userId } = req.body;
  const call = await callsCol.findOne({ callId: req.params.callId });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (call.fromUserId !== userId && !call.participants.find(p => p.userId === userId)) return res.status(403).json({ error: 'Not in call' });
  await callsCol.updateOne({ callId: call.callId }, { $set: { status: 'ended', endedAt: Date.now(), duration: call.startedAt ? Math.floor((Date.now() - call.startedAt) / 1000) : 0 } });
  res.json({ success: true });
});

app.get('/api/calls/active/:userId', async (req, res) => {
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const calls = await callsCol.find({
    $or: [{ 'participants.userId': req.params.userId }, { toUserId: req.params.userId, status: 'ringing' }],
    status: { $in: ['ringing', 'active'] },
  }).sort({ createdAt: -1 }).limit(5).toArray();
  res.json({ success: true, calls: calls.map(c => { const { _id, ...r } = c; return r; }) });
});

app.get('/api/calls/history/:userId', async (req, res) => {
  if (!callsCol) return res.status(503).json({ error: 'DB not ready' });
  const calls = await callsCol.find({
    $or: [{ fromUserId: req.params.userId }, { toUserId: req.params.userId }, { 'participants.userId': req.params.userId }],
    status: 'ended',
  }).sort({ endedAt: -1 }).limit(30).toArray();
  res.json({ success: true, calls: calls.map(c => { const { _id, ...r } = c; return r; }) });
});

// WebRTC signaling (offer/answer/ice-candidate relay)
app.post('/api/calls/:callId/signal', async (req, res) => {
  const { fromUserId, toUserId, type, payload } = req.body;
  if (!fromUserId || !toUserId || !type) return res.status(400).json({ error: 'Missing fields' });
  if (!callSignalsCol) return res.status(503).json({ error: 'DB not ready' });
  const signal = {
    _id: 'sig_' + crypto.randomBytes(8).toString('hex'),
    callId: req.params.callId, fromUserId, toUserId, type, payload,
    createdAt: Date.now(), read: false,
  };
  await callSignalsCol.insertOne(signal);
  res.json({ success: true });
});

app.get('/api/calls/:callId/signals/:userId', async (req, res) => {
  if (!callSignalsCol) return res.status(503).json({ error: 'DB not ready' });
  const signals = await callSignalsCol.find({
    callId: req.params.callId, toUserId: req.params.userId, read: false,
  }).sort({ createdAt: 1 }).limit(50).toArray();
  // Mark as read
  await callSignalsCol.updateMany({ _id: { $in: signals.map(s => s._id) } }, { $set: { read: true } });
  res.json({ success: true, signals: signals.map(s => { const { _id, ...r } = s; return r; }) });
});

// ============================================================
// ODYSEE LIVE STREAM INTEGRATION
// ============================================================
// Fetch live streams from an Odysee channel
// Channel format: "@ChannelName:N" e.g. "@DainikState:1"
const ODYSEE_API = 'https://api.na-backend.odysee.com/api/v1/proxy';
let odyseeChannelsCol;

async function connectDB_odysee() {
  odyseeChannelsCol = db.collection('odyseeChannels');
  await odyseeChannelsCol.createIndex({ handle: 1 }, { unique: true });
}

app.post('/api/odysee/channels', async (req, res) => {
  const { handle, name, userId } = req.body;
  if (!handle || !userId) return res.status(400).json({ error: 'handle and userId required' });
  if (!odyseeChannelsCol) return res.status(503).json({ error: 'DB not ready' });
  // Verify channel exists
  try {
    const res2 = await axios.post(ODYSEE_API, {
      method: 'claim_search',
      params: { channel_id: handle, page: 1, page_size: 1, no_totals: true },
    }, { timeout: 10000 });
    const items = res2.data?.result?.items || [];
    const ch = await odyseeChannelsCol.findOne({ handle });
    await odyseeChannelsCol.updateOne(
      { handle },
      { $set: { handle, name: name || handle, addedBy: userId, addedAt: Date.now(), claimCount: items.length > 0 } },
      { upsert: true }
    );
    res.json({ success: true, channel: { handle, name: name || handle, claimCount: items.length > 0 } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to verify channel: ' + e.message });
  }
});

app.get('/api/odysee/channels', async (req, res) => {
  if (!odyseeChannelsCol) return res.status(503).json({ error: 'DB not ready' });
  const channels = await odyseeChannelsCol.find({}).sort({ addedAt: -1 }).toArray();
  res.json({ success: true, channels: channels.map(c => { const { _id, ...r } = c; return r; }) });
});

app.delete('/api/odysee/channels/:handle', async (req, res) => {
  const { userId } = req.body;
  if (!odyseeChannelsCol) return res.status(503).json({ error: 'DB not ready' });
  await odyseeChannelsCol.deleteOne({ handle: req.params.handle });
  res.json({ success: true });
});

// Get live streams + recent streams from an Odysee channel
app.get('/api/odysee/streams/:handle', async (req, res) => {
  try {
    // Get channel info + recent videos
    const res2 = await axios.post(ODYSEE_API, {
      method: 'claim_search',
      params: {
        channel_id: req.params.handle,
        claim_type: 'stream',
        page: 1,
        page_size: 10,
        order_by: ['release_time'],
        no_totals: true,
      },
    }, { timeout: 10000 });
    const items = (res2.data?.result?.items || []).map(item => {
      const val = item.value || {};
      const meta = item.meta || {};
      return {
        claimId: item.claim_id,
        name: item.name,
        title: val.title || 'Untitled',
        description: val.description || '',
        thumbnail: val.thumbnail?.url ? `https://thumbnails.odycdn.com/600x400/${val.thumbnail.url.split('/').pop()}` : '',
        url: `https://odysee.com/${item.name}#${item.claim_id}`,
        embedUrl: `https://odysee.com/embed/${item.claim_id}`,
        duration: val.duration || 0,
        releaseTime: meta.release_time || 0,
        views: meta.views || 0,
        isLive: val.livestream || false,  // Odysee sets this for live streams
      };
    });
    res.json({ success: true, count: items.length, streams: items });
  } catch (e) {
    console.error('Odysee fetch error:', e.message);
    res.status(500).json({ error: 'Failed to fetch Odysee streams: ' + e.message });
  }
});

// Get all live streams across all added Odysee channels
app.get('/api/odysee/live', async (req, res) => {
  if (!odyseeChannelsCol) return res.status(503).json({ error: 'DB not ready' });
  try {
    const channels = await odyseeChannelsCol.find({}).toArray();
    const liveStreams = [];
    for (const ch of channels) {
      try {
        // Method 1: claim_search
        let items = [];
        try {
          const res2 = await axios.post(ODYSEE_API, {
            method: 'claim_search',
            params: {
              channel_id: ch.handle,
              claim_type: 'stream',
              page: 1,
              page_size: 10,
              order_by: ['release_time'],
              no_totals: true,
            },
          }, { timeout: 8000 });
          items = res2.data?.result?.items || [];
        } catch (e) { /* try next method */ }

        // Method 2: If no items, try fetching channel's claim_list
        if (items.length === 0) {
          try {
            // Try with shorter timeout and different params
            const res2 = await axios.post(ODYSEE_API, {
              method: 'claim_search',
              params: {
                channel_id: ch.handle,
                page: 1,
                page_size: 10,
                order_by: ['release_time'],
              },
            }, { timeout: 8000 });
            items = (res2.data?.result?.items || []).filter(it => it.value?.claim_type === 'stream');
          } catch (e) {}
        }

        for (const item of items) {
          const val = item.value || {};
          const meta = item.meta || {};
          // Odysee uses different fields to indicate live
          const isLive = val.livestream === true ||
                         val.live === true ||
                         meta?.live === true ||
                         item.name?.includes('cripto-panda');  // fallback
          // We only want LIVE streams
          if (!isLive) continue;
          // Build the CORRECT embed URL: https://odysee.com/$/embed/<name>:<claimid>
          const correctEmbedUrl = `https://odysee.com/$/embed/${item.name}:${item.claim_id}`;
          liveStreams.push({
            claimId: item.claim_id,
            name: item.name,
            title: val.title || item.name || 'Live Stream',
            thumbnail: val.thumbnail?.url ? `https://thumbnails.odycdn.com/600x400/${val.thumbnail.url.split('/').pop()}` : '',
            url: `https://odysee.com/${item.name}#${item.claim_id}`,
            embedUrl: correctEmbedUrl,  // Use the correct embed URL
            channelHandle: ch.handle,
            channelName: ch.name,
            views: meta.views || 0,
          });
        }
      } catch (e) { console.error(`Odysee fetch ${ch.handle} failed:`, e.message); }
    }
    res.json({ success: true, count: liveStreams.length, streams: liveStreams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Track Odysee view (called after 5+ sec watch)
app.post('/api/odysee/view', async (req, res) => {
  try {
    const { userId, streamName, watchSeconds } = req.body;
    if (!userId || !streamName) return res.status(400).json({ error: 'userId and streamName required' });
    // Store view in odyseeViews collection
    const viewsCol = db.collection('odyseeViews');
    await viewsCol.insertOne({
      _id: 'ov_' + Date.now() + '_' + crypto.randomBytes(2).toString('hex'),
      userId, streamName, watchSeconds: watchSeconds || 0,
      createdAt: Date.now(),
    });
    // Update user's total views
    await usersCol.updateOne({ id: userId }, { $inc: { odyseeViews: 1 } });
    res.json({ success: true, message: 'View tracked' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get Odysee analytics
app.get('/api/odysee/analytics/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const viewsCol = db.collection('odyseeViews');
    const totalViews = await viewsCol.countDocuments({ userId });
    const recentViews = await viewsCol.find({ userId }).sort({ createdAt: -1 }).limit(20).toArray();
    const { _id, ...result } = { totalViews, recentViews };
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/odysee/streams/add', async (req, res) => {
  const { url, name, userId } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  // Parse URL: https://odysee.com/@Channel:1/stream-name:claimid
  // or https://odysee.com/@Channel:1/stream-name
  const match = url.match(/odysee\.com\/(@[^/]+\/[^/:]+)(?::([a-z0-9]+))?/i);
  if (!match) return res.status(400).json({ error: 'Invalid Odysee URL. Format: https://odysee.com/@Channel:1/stream-name' });
  const name1 = match[1];  // e.g. @DainikState:1/cripto-panda
  const claimId = match[2] || 'a';  // claim ID, defaults to 'a' for latest
  // CORRECT Odysee embed URL format: https://odysee.com/$/embed/<name>:<claimid>
  const embedUrl = `https://odysee.com/$/embed/${name1}:${claimId}`;
  const fullUrl = `https://odysee.com/${name1}:${claimId}`;
  // Try to get metadata
  let title = name || name1;
  let thumbnail = '';
  try {
    const res2 = await axios.post(ODYSEE_API, {
      method: 'get', params: { uri: `${name1}:${claimId}` }
    }, { timeout: 8000 });
    const val = res2.data?.result?.value || {};
    title = val.title || name1;
    if (val.thumbnail?.url) {
      thumbnail = `https://thumbnails.odycdn.com/600x400/${val.thumbnail.url.split('/').pop()}`;
    }
  } catch (e) { /* ignore */ }
  res.json({
    success: true,
    stream: {
      claimId, name: name1, title, thumbnail,
      url: fullUrl, embedUrl,
      channelHandle: name1.split('/')[0],
      channelName: name1.split('/')[0],
      views: 0, manuallyAdded: true,
    }
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
  // Auto-end stale live streams (older than 2 hours) to prevent stuck streams
  setInterval(async () => {
    if (liveStreamsCol) {
      const staleStreams = await liveStreamsCol.find({
        status: 'live',
        startedAt: { $lt: Date.now() - 2 * 60 * 60 * 1000 }
      }).toArray();
      for (const s of staleStreams) {
        await liveStreamsCol.updateOne(
          { streamId: s.streamId },
          { $set: { status: 'ended', endedAt: Date.now(), duration: Math.floor((Date.now() - s.startedAt) / 1000), autoEnded: true } }
        );
        // Remove the live post
        if (groupPostsCol) await groupPostsCol.deleteOne({ id: 'gplive_' + s.streamId });
        console.log('🛑 Auto-ended stale stream:', s.streamId);
      }
    }
  }, 5 * 60 * 1000);  // Check every 5 minutes
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏆 DainikState running on port ${PORT}`);
    console.log(`📺 Groups, Stories, Posts, Channels all live!`);
  });
});
