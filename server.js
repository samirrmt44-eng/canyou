// ============================================================
// canyou - DainikState Channel + User Links + Multi-Source
// Auto-loads YouTube videos from DainikState channel
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

    await linksCol.createIndex({ addedAt: -1 });
    await linksCol.createIndex({ source: 1, addedAt: -1 });
    await commentsCol.createIndex({ linkId: 1, createdAt: -1 });
    await usersCol.createIndex({ id: 1 }, { unique: true });
    await channelsCol.createIndex({ platform: 1, channelId: 1 }, { unique: true });

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
    name: 'DainikState YouTube',
    autoSync: true,
    syncInterval: 30,
  },
  {
    platform: 'odysee',
    channelId: '@DainikState:1',
    name: 'DainikState Odysee',
    autoSync: true,
    syncInterval: 30,
  },
  {
    platform: 'rss',
    channelId: 'dainikstate.com',
    feedUrl: 'https://dainikstate.com/feed/',
    name: 'DainikState News',
    autoSync: true,
    syncInterval: 30,
  },
];


// RSS Feed Fetcher (for news sites like dainikstate.com)
async function fetchRSSFeed(feedUrl) {
  try {
    const response = await axios.get(feedUrl, { timeout: 15000 });
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);
    if (!result.rss || !result.rss.channel || !result.rss.channel.item) return [];

    const items = Array.isArray(result.rss.channel.item) ? result.rss.channel.item : [result.rss.channel.item];
    return items.map(item => {
      const title = typeof item.title === 'object' ? item.title._ : item.title;
      const desc = item.description ? (typeof item.description === 'object' ? item.description._ : item.description) : '';
      const link = typeof item.link === 'object' ? item.link._ : item.link;
      const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();

      // Extract first image from description
      const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
      const thumbnail = imgMatch ? imgMatch[1] : `https://ui-avatars.com/api/?name=DainikState+News&size=600&background=b71c1c&color=fff&bold=true`;

      // Clean description (remove HTML)
      const cleanDesc = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

      return {
        platform: 'news',
        url: link,
        videoId: link,
        title: title,
        description: cleanDesc,
        thumbnail,
        author: 'DainikState Desk',
        publishedAt: pubDate,
      };
    });
  } catch (err) {
    console.error('RSS fetch failed:', err.message);
    return [];
  }
}

// ============================================================
// YOUTUBE RSS FEED PARSER (No API key needed!)
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
  } catch (err) {
    console.error('YouTube RSS fetch failed:', err.message);
    return [];
  }
}

// ============================================================
// ODYSEE SYNC
// ============================================================
async function fetchOdyseeVideos(claimId) {
  try {
    const payload = {
      method: 'claim_search',
      params: {
        claim_type: 'stream',
        channel_id: claimId,
        page: 1,
        page_size: 15,
        order_by: ['release_time'],
        no_totals: true,
      },
    };
    const response = await axios.post('https://api.odysee.com/api/v1/proxy', payload, { timeout: 10000 });
    const items = (response.data?.result?.items || []).map(item => ({
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
    return items;
  } catch (err) {
    console.error('Odysee fetch failed:', err.message);
    return [];
  }
}

// ============================================================
// CHANNEL SYNC
// ============================================================
async function syncChannel(channel) {
  console.log(`🔄 Syncing ${channel.platform}: ${channel.name}...`);
  let videos = [];

  if (channel.platform === 'youtube') {
    videos = await fetchYouTubeRSS(channel.channelId);
  } else if (channel.platform === 'odysee') {
    videos = await fetchOdyseeVideos(channel.channelId);
  } else if (channel.platform === 'rss' && channel.feedUrl) {
    videos = await fetchRSSFeed(channel.feedUrl);
  }

  if (videos.length === 0) {
    console.log(`  ⚠️  No videos from ${channel.name}`);
    return 0;
  }

  // Save to MongoDB
  for (const video of videos) {
    const linkId = `${video.platform}_${video.videoId}`;
    const link = {
      _id: linkId,
      id: linkId,
      url: video.url,
      title: video.title,
      description: video.description?.slice(0, 500),
      thumbnail: video.thumbnail,
      platform: video.platform,
      domain: video.platform === 'youtube' ? 'youtube.com' : video.platform === 'odysee' ? 'odysee.com' : '',
      author: video.author,
      addedBy: channel.name,
      addedById: `auto_${channel.platform}_${channel.channelId}`,
      addedAt: video.publishedAt,
      commentCount: 0,
      views: video.views || 0,
      autoImported: true,
      channelRef: channel.platform + ':' + channel.channelId,
    };

    try {
      await linksCol.updateOne(
        { _id: linkId },
        { $set: link },
        { upsert: true }
      );
    } catch (err) {
      // Skip duplicates
    }
  }

  // Update channel last sync
  await channelsCol.updateOne(
    { platform: channel.platform, channelId: channel.channelId },
    { $set: { ...channel, lastSync: Date.now() } },
    { upsert: true }
  );

  console.log(`  ✅ Synced ${videos.length} videos from ${channel.name}`);
  return videos.length;
}

async function syncAllChannels() {
  try {
    const channels = await channelsCol.find({}).toArray();
    const allChannels = channels.length > 0 ? channels : DEFAULT_CHANNELS;
    let total = 0;
    for (const ch of allChannels) {
      total += await syncChannel(ch);
    }
    return total;
  } catch (err) {
    console.error('Sync error:', err.message);
    return 0;
  }
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
  if (u.includes('news') || u.includes('bbc') || u.includes('cnn')) return 'news';
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
  status: 'ok',
  message: 'canyou #1rank - DainikState Channel Edition',
  database: db ? 'connected' : 'in-memory',
}));

app.get('/api/sync', async (req, res) => {
  const count = await syncAllChannels();
  res.json({ success: true, synced: count });
});

// CLEANUP: Remove duplicates (keep newest per URL)
app.get('/api/cleanup', async (req, res) => {
  if (!linksCol) return res.status(503).json({ error: 'DB not ready' });
  try {
    const all = await linksCol.find({}).toArray();
    const seen = new Map();
    const toDelete = [];
    for (const link of all) {
      if (seen.has(link.url)) {
        // Keep the auto-imported one (or the older one)
        const existing = seen.get(link.url);
        if (link.autoImported && !existing.autoImported) {
          toDelete.push(existing._id);
          seen.set(link.url, link);
        } else if (!link.autoImported && existing.autoImported) {
          toDelete.push(link._id);
        } else {
          toDelete.push(link._id);
        }
      } else {
        seen.set(link.url, link);
      }
    }
    if (toDelete.length > 0) {
      await linksCol.deleteMany({ _id: { $in: toDelete } });
    }
    res.json({ success: true, deleted: toDelete.length, remaining: all.length - toDelete.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { name, country, location } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!usersCol) return res.status(503).json({ error: 'DB not ready' });

  const userId = 'u_' + crypto.randomBytes(8).toString('hex');
  const sessionId = crypto.randomBytes(16).toString('hex');
  const user = {
    _id: userId, id: userId, sessionId, name,
    location: location || 'Unknown', country: country || 'India',
    reputation: 1, commentsPosted: 0, linksAdded: 0, joinedAt: Date.now()
  };
  await usersCol.insertOne(user);
  res.json({ success: true, user, sessionId });
});

app.post('/api/auth/login', async (req, res) => {
  const user = await usersCol.findOne({ sessionId: req.body.sessionId });
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  const { _id, ...userData } = user;
  res.json({ success: true, user: userData });
});

app.post('/api/links', async (req, res) => {
  const { url, userId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!linksCol) return res.status(503).json({ error: 'DB not ready' });

  const platform = detectPlatform(url);
  const domain = extractDomain(url);
  let linkId, title = domain, description = '', thumbnail;

  // YouTube - use videoId as unique ID (prevents duplicates)
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
      } catch (e) {
        title = `YouTube Video (${ytId})`;
      }
    } else {
      linkId = 'user_' + crypto.randomBytes(6).toString('hex');
    }
  } else if (platform === 'odysee') {
    // Odysee URL
    linkId = 'user_' + crypto.randomBytes(6).toString('hex');
  } else {
    // News / Twitter / Instagram / etc - user-added
    linkId = 'user_' + crypto.randomBytes(6).toString('hex');
  }

  // Try to fetch better title for news sites
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
    } catch (e) {
      // Fallback to domain name
    }
  }

  if (!thumbnail) {
    thumbnail = `https://ui-avatars.com/api/?name=${encodeURIComponent(domain)}&size=600&background=667eea&color=fff&bold=true`;
  }

  let addedByName = 'User';
  if (userId) {
    const user = await usersCol.findOne({ id: userId });
    if (user) addedByName = user.name;
  }

  // Check if link already exists (prevent duplicates)
  const existing = await linksCol.findOne({ id: linkId });
  if (existing) {
    return res.json({ success: true, link: { ...existing, _id: undefined }, message: 'Already exists' });
  }

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
  const result = links.map(l => { const { _id, ...rest } = l; return rest; });
  res.json({ success: true, count: result.length, links: result });
});

app.get('/api/channels', async (req, res) => {
  if (!channelsCol) return res.json({ channels: DEFAULT_CHANNELS });
  const channels = await channelsCol.find({}).toArray();
  res.json({ success: true, channels: channels.length > 0 ? channels : DEFAULT_CHANNELS });
});

app.post('/api/channels', async (req, res) => {
  const { platform, channelId, handle, name } = req.body;
  if (!platform || !channelId) return res.status(400).json({ error: 'Missing fields' });
  if (!channelsCol) return res.status(503).json({ error: 'DB not ready' });
  await channelsCol.updateOne(
    { platform, channelId },
    { $set: { platform, channelId, handle, name, autoSync: true, syncInterval: 60, addedAt: Date.now() } },
    { upsert: true }
  );
  res.json({ success: true });
});

app.post('/api/comments', async (req, res) => {
  const { linkId, userId, text, parentId } = req.body;
  if (!linkId || !userId || !text) return res.status(400).json({ error: 'Missing fields' });
  if (!commentsCol) return res.status(503).json({ error: 'DB not ready' });

  const link = await linksCol.findOne({ id: linkId });
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const user = await usersCol.findOne({ id: userId });
  const commentId = 'c_' + crypto.randomBytes(8).toString('hex');
  const comment = {
    _id: commentId, id: commentId, linkId, parentId: parentId || null, userId,
    userName: user?.name || 'Guest', userLocation: user?.location || 'Unknown',
    userReputation: user?.reputation || 1, text, upvotes: 0, downvotes: 0,
    replyCount: 0, qualityScore: calculateQualityScore(text),
    createdAt: Date.now(), acceptedChallenge: true,
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
connectDB().then(async () => {
  // Initial sync
  console.log('🚀 Initial channel sync...');
  await syncAllChannels();

  // Periodic sync every 30 minutes
  setInterval(async () => {
    console.log('🔄 Periodic channel sync...');
    await syncAllChannels();
  }, 30 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏆 canyou #1rank running on port ${PORT}`);
    console.log(`📺 DainikState channel auto-syncing...`);
  });
});
