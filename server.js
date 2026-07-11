
// ============================================================
// canyou - The #1 Comment Platform
// ============================================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const DB = {
  users: new Map(),
  links: new Map(),
  comments: new Map(),
  votes: new Map(),
  sessions: new Map(),
};

const SEED_LINKS = [
  { id: 'seed_1', url: 'https://www.bbc.com/news/world', title: 'BBC World News - Latest Global Stories', description: 'Breaking news, world news, US news, sport, business...', thumbnail: 'https://ui-avatars.com/api/?name=BBC&size=600&background=000000&color=fff&bold=true', platform: 'news', domain: 'bbc.com', author: 'BBC News', addedBy: 'canyou Official', addedAt: Date.now() - 86400000, commentCount: 0 },
  { id: 'seed_2', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '🎬 YouTube Video Discussion', description: 'Paste any YouTube video link to discuss it!', thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', platform: 'youtube', domain: 'youtube.com', author: 'Various', addedBy: 'canyou Official', addedAt: Date.now() - 7200000, commentCount: 0 },
  { id: 'seed_3', url: 'https://dainikstate.com', title: 'DainikState - Jharkhand Hindi News', description: 'झारखंड की ताज़ा खबरें, राजनीति, क्राइम', thumbnail: 'https://ui-avatars.com/api/?name=DainikState&size=600&background=b71c1c&color=fff&bold=true', platform: 'news', domain: 'dainikstate.com', author: 'DainikState', addedBy: 'canyou Official', addedAt: Date.now() - 3600000, commentCount: 0 },
  { id: 'seed_4', url: 'https://www.theverge.com/tech', title: 'The Verge - Tech, Science, Culture', description: 'Tech news, reviews, and more.', thumbnail: 'https://ui-avatars.com/api/?name=The+Verge&size=600&background=ff6b6b&color=fff&bold=true', platform: 'news', domain: 'theverge.com', author: 'The Verge', addedBy: 'canyou Official', addedAt: Date.now() - 1800000, commentCount: 0 },
  { id: 'seed_5', url: 'https://twitter.com/elonmusk', title: 'Twitter/X - Latest Tweets', description: 'Paste any Twitter/X link to discuss', thumbnail: 'https://ui-avatars.com/api/?name=Twitter&size=600&background=1da1f2&color=fff&bold=true', platform: 'twitter', domain: 'twitter.com', author: 'Twitter/X', addedBy: 'canyou Official', addedAt: Date.now() - 600000, commentCount: 0 },
];

const SEED_COMMENTS = [
  { id: 'seed_c1', linkId: 'seed_1', userId: 'seed_user_1', userName: 'NewsNinja', userLocation: 'Delhi, India', userReputation: 4.5, text: 'BBC has the most reliable news coverage worldwide. Their investigative journalism is top-notch! 💪', upvotes: 28, downvotes: 2, replyCount: 0, createdAt: Date.now() - 50000000, qualityScore: 8, acceptedChallenge: true },
  { id: 'seed_c2', linkId: 'seed_1', userId: 'seed_user_2', userName: 'TruthSeeker', userLocation: 'Mumbai, India', userReputation: 3.8, text: 'I trust BBC more than any other source. They maintain neutrality even in polarizing topics.', upvotes: 22, downvotes: 3, replyCount: 0, createdAt: Date.now() - 40000000, qualityScore: 7, acceptedChallenge: true },
  { id: 'seed_c3', linkId: 'seed_3', userId: 'seed_user_4', userName: 'JharkhandLover', userLocation: 'Jamshedpur, India', userReputation: 5.0, text: 'DainikState hamare area ki sabse authentic news site hai. Regular padhta hoon! 📰', upvotes: 35, downvotes: 0, replyCount: 0, createdAt: Date.now() - 20000000, qualityScore: 9, acceptedChallenge: true },
];

SEED_LINKS.forEach(link => DB.links.set(link.id, link));
SEED_COMMENTS.forEach(c => {
  DB.comments.set(c.id, c);
  if (DB.links.has(c.linkId)) DB.links.get(c.linkId).commentCount++;
});

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

app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'canyou #1rank', stats: { links: DB.links.size, comments: DB.comments.size } }));

app.post('/api/auth/register', (req, res) => {
  const { name, country, location } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const userId = 'u_' + crypto.randomBytes(8).toString('hex');
  const sessionId = crypto.randomBytes(16).toString('hex');
  const user = { id: userId, sessionId, name, location: location || 'Unknown', country: country || 'India', reputation: 1, commentsPosted: 0, linksAdded: 0, joinedAt: Date.now() };
  DB.users.set(userId, user);
  DB.sessions.set(sessionId, userId);
  res.json({ success: true, user, sessionId });
});

app.post('/api/auth/login', (req, res) => {
  const userId = DB.sessions.get(req.body.sessionId);
  if (!userId) return res.status(401).json({ error: 'Invalid session' });
  res.json({ success: true, user: DB.users.get(userId) });
});

app.post('/api/links', async (req, res) => {
  const { url, userId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  const platform = detectPlatform(url);
  const domain = extractDomain(url);
  const linkId = 'lnk_' + crypto.randomBytes(6).toString('hex');
  let title = `${domain} - ${platform}`;
  let thumbnail = `https://ui-avatars.com/api/?name=${encodeURIComponent(domain)}&size=600&background=667eea&color=fff&bold=true`;
  if (platform === 'youtube') {
    const ytId = extractYouTubeId(url);
    if (ytId) {
      thumbnail = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
      title = `YouTube Video`;
      try {
        const oembed = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { timeout: 5000 });
        title = oembed.data.title || title;
        if (oembed.data.thumbnail_url) thumbnail = oembed.data.thumbnail_url;
      } catch (e) {}
    }
  }
  const link = { id: linkId, url, title, description: `Discussion about ${domain}`, thumbnail, platform, domain, addedBy: DB.users.get(userId)?.name || 'User', addedById: userId, addedAt: Date.now(), commentCount: 0 };
  DB.links.set(linkId, link);
  if (DB.users.has(userId)) DB.users.get(userId).linksAdded = (DB.users.get(userId).linksAdded || 0) + 1;
  res.json({ success: true, link });
});

app.get('/api/links', (req, res) => {
  let links = Array.from(DB.links.values()).sort((a, b) => b.addedAt - a.addedAt);
  res.json({ success: true, count: links.length, links: links.slice(0, 20) });
});

app.post('/api/comments', (req, res) => {
  const { linkId, userId, text, parentId } = req.body;
  if (!linkId || !userId || !text) return res.status(400).json({ error: 'Missing fields' });
  const user = DB.users.get(userId);
  const link = DB.links.get(linkId);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const commentId = 'c_' + crypto.randomBytes(8).toString('hex');
  const comment = { id: commentId, linkId, parentId: parentId || null, userId, userName: user?.name || 'Guest', userLocation: user?.location || 'Unknown', userReputation: user?.reputation || 1, text, upvotes: 0, downvotes: 0, replyCount: 0, qualityScore: calculateQualityScore(text), createdAt: Date.now(), acceptedChallenge: true };
  DB.comments.set(commentId, comment);
  link.commentCount = (link.commentCount || 0) + 1;
  if (user) { user.commentsPosted = (user.commentsPosted || 0) + 1; user.reputation = Math.min(user.reputation + 0.1, 100); }
  res.json({ success: true, comment });
});

app.get('/api/comments', (req, res) => {
  const { linkId, sortBy } = req.query;
  if (!linkId) return res.status(400).json({ error: 'linkId required' });
  let comments = Array.from(DB.comments.values()).filter(c => c.linkId === linkId);
  if (sortBy === 'top') comments.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
  else if (sortBy === 'new') comments.sort((a, b) => b.createdAt - a.createdAt);
  else comments = rankComments(comments);
  res.json({ success: true, count: comments.length, comments });
});

app.post('/api/comments/:commentId/vote', (req, res) => {
  const comment = DB.comments.get(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (req.body.voteType === 'up') comment.upvotes = (comment.upvotes || 0) + 1;
  else comment.downvotes = (comment.downvotes || 0) + 1;
  res.json({ success: true, comment });
});

app.get(/(.*)/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏆 canyou #1rank running on port ${PORT}`);
  console.log(`📊 Seed: ${DB.links.size} links, ${DB.comments.size} comments`);
});
