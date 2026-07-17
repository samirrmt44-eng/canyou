// ============================================================
// AUTO VIDEO NEWS ADD SYSTEM (DainikState only)
// Run: node auto_video_news.js
// ============================================================
// This script adds video news to the DainikState ecosystem.
// All videos must be relevant to Jharkhand / Hindi news / DainikState.

const https = require('https');

const API_BASE = 'canyou-uqkp.onrender.com';

// DainikState-related video sources
// NOTE: Only DainikState news channels, official Jharkhand sources, and Hindi news sources
const VIDEO_SOURCES = [
  // Official DainikState YouTube (if exists)
  // Add here when DainikState has official YT channel
  // {
  //   title: '📺 DainikState Official - [video title]',
  //   videoUrl: 'https://youtube.com/watch?v=XXX',
  //   category: 'news',
  //   source: 'DainikState'
  // }
  // Empty for now - only real DainikState content should be auto-added
];

function addVideoNews(video) {
  return new Promise((resolve, reject) => {
    const uniqueUrl = (video.url || video.videoUrl) + '#' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const data = JSON.stringify({
      ...video,
      url: uniqueUrl,
      groupId: 'dainikstate',
      isPublic: true
    });

    const options = {
      hostname: API_BASE,
      path: '/api/news/group-channel/add',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Invalid JSON: ' + body.slice(0, 100)));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 100)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function autoAddAll() {
  console.log('🚀 DainikState Auto Video News Add');
  console.log('=====================================');
  console.log(`📺 Total videos configured: ${VIDEO_SOURCES.length}\n`);

  if (VIDEO_SOURCES.length === 0) {
    console.log('ℹ️  No DainikState video sources configured.');
    console.log('   Add official DainikState YouTube videos to VIDEO_SOURCES array.');
    console.log('   Only DainikState-related content should be auto-added.');
    return;
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < VIDEO_SOURCES.length; i++) {
    const video = VIDEO_SOURCES[i];
    process.stdout.write(`[${i + 1}/${VIDEO_SOURCES.length}] ${video.title.slice(0, 50)}... `);

    try {
      const result = await addVideoNews(video);
      if (result.success) {
        console.log('✅ Added');
        success++;
      } else {
        console.log(`❌ ${result.error || 'Failed'}`);
        failed++;
      }
    } catch (e) {
      console.log(`❌ ${e.message.slice(0, 50)}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=====================================');
  console.log(`✅ Success: ${success}/${VIDEO_SOURCES.length}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('=====================================');
}

if (require.main === module) {
  autoAddAll().catch(console.error);
}

module.exports = { autoAddAll, VIDEO_SOURCES, addVideoNews };
