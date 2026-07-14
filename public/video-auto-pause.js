// ============================================================
// SMART VIDEO AUTO-PAUSE (YouTube/Odysee style)
// - Auto-plays when video enters viewport
// - Pauses when scrolled out of view
// - Tracks real views (30+ sec = +1 view to backend)
// - One video plays at a time (sound management)
// - Manual play/pause override respected
// - Click-to-play overlay supported
// ============================================================

(function() {
  if (window.__smartVideoLoaded) return;
  window.__smartVideoLoaded = true;

  const API = (typeof DS_API !== 'undefined' ? DS_API : 'https://canyou-uqkp.onrender.com');
  const SESSION_KEY = 'ds_session_id';
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  // === STATE ===
  const trackedVideos = new Map();  // el -> { type, videoId, postId, watchTime, hasCountedView }
  const manuallyPaused = new WeakSet();  // user manually paused these
  const manuallyPlayed = new WeakSet();  // user manually played
  const viewCounted = new WeakSet();  // already counted as a view
  const watchTimers = new WeakMap();  // tracks how long each video has been watched
  let currentPlayingVideo = null;  // only one video can play sound at a time

  // === INTERSECTION OBSERVER ===
  // Pauses videos < 30% visible, plays if > 60% visible
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const el = entry.target;
      const meta = trackedVideos.get(el);
      if (!meta) return;

      if (entry.intersectionRatio >= 0.6) {
        // Video is mostly visible - try to play (if not manually paused)
        if (!manuallyPaused.has(el) && (entry.intersectionRatio >= 0.6)) {
          // Only play the most visible one to avoid sound overlap
          if (!currentPlayingVideo || currentPlayingVideo === el || shouldSwitchTo(el)) {
            smartPlay(el, meta);
            currentPlayingVideo = el;
            // Pause all others
            trackedVideos.forEach((m, otherEl) => {
              if (otherEl !== el && otherEl !== currentPlayingVideo) {
                if (!manuallyPlayed.has(otherEl)) {
                  smartPause(otherEl, m, true);  // silent = no UI indicator
                }
              }
            });
          }
        }
      } else if (entry.intersectionRatio < 0.3) {
        // Video is mostly out of view - pause it
        if (!manuallyPlayed.has(el)) {
          smartPause(el, meta, true);
          if (currentPlayingVideo === el) currentPlayingVideo = null;
        }
      }
    });
  }, {
    threshold: [0, 0.3, 0.5, 0.6, 0.8, 1.0],
    rootMargin: '0px'
  });

  // === PLAY / PAUSE FUNCTIONS ===
  function smartPlay(el, meta) {
    if (meta.type === 'native') {
      // HTML5 <video>
      if (el.paused) {
        el.muted = false;  // unmute when playing
        el.play().catch(e => {
          // Autoplay blocked, fall back to muted
          el.muted = true;
          el.play().catch(() => {});
        });
      }
    } else if (meta.type === 'youtube') {
      sendYouTubeCommand(el, 'playVideo');
    } else if (meta.type === 'odysee') {
      sendOdyseeCommand(el, 'play');
    }
    // Start watch timer
    if (!watchTimers.has(el)) {
      watchTimers.set(el, { start: Date.now(), total: 0 });
    } else {
      watchTimers.get(el).start = Date.now();
    }
  }

  function smartPause(el, meta, silent) {
    if (meta.type === 'native') {
      if (!el.paused) {
        el.pause();
        // Update watch time
        const timer = watchTimers.get(el);
        if (timer) {
          timer.total += Date.now() - timer.start;
          timer.start = null;
          // Count as view if watched 30+ sec
          if (!viewCounted.has(el) && timer.total >= 30000) {
            viewCounted.add(el);
            countView(meta);
          }
        }
      }
    } else if (meta.type === 'youtube') {
      sendYouTubeCommand(el, 'pauseVideo');
      // Update watch time
      const timer = watchTimers.get(el);
      if (timer && timer.start) {
        timer.total += Date.now() - timer.start;
        timer.start = null;
        if (!viewCounted.has(el) && timer.total >= 30000) {
          viewCounted.add(el);
          countView(meta);
        }
      }
    } else if (meta.type === 'odysee') {
      sendOdyseeCommand(el, 'pause');
      const timer = watchTimers.get(el);
      if (timer && timer.start) {
        timer.total += Date.now() - timer.start;
        timer.start = null;
        if (!viewCounted.has(el) && timer.total >= 30000) {
          viewCounted.add(el);
          countView(meta);
        }
      }
    }
    if (!silent) {
      showPauseUI(el);
    }
  }

  // Decide if we should switch playing video to a more visible one
  function shouldSwitchTo(newEl) {
    if (!currentPlayingVideo) return true;
    const newRect = newEl.getBoundingClientRect();
    const currentRect = currentPlayingVideo.getBoundingClientRect();
    const newArea = newRect.width * newRect.height * getVisibleRatio(newEl);
    const currentArea = currentRect.width * currentRect.height * getVisibleRatio(currentPlayingVideo);
    return newArea > currentArea * 1.5;  // 50% more visible = switch
  }

  function getVisibleRatio(el) {
    const rect = el.getBoundingClientRect();
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    return rect.height > 0 ? visibleHeight / rect.height : 0;
  }

  // === YOUTUBE / ODYSEE COMMANDS ===
  function sendYouTubeCommand(iframe, command) {
    try {
      iframe.contentWindow?.postMessage(JSON.stringify({
        event: 'command',
        func: command,
        args: ''
      }), '*');
    } catch (e) { /* ignore cross-origin */ }
  }

  function sendOdyseeCommand(iframe, method) {
    try {
      iframe.contentWindow?.postMessage(JSON.stringify({
        method: method,
        value: method === 'play' || method === 'pause' ? method === 'play' : null
      }), '*');
    } catch (e) { /* ignore */ }
  }

  // === VIEW COUNTING ===
  function countView(meta) {
    // Send view event to backend
    fetch(API + '/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        type: 'video_view',
        label: meta.videoId || 'unknown',
        value: 30,
        page: location.pathname,
        meta: { videoType: meta.type, postId: meta.postId }
      })
    }).catch(() => {});
  }

  // === PAUSE UI (overlay) ===
  function showPauseUI(el) {
    const wrapper = el.closest('.post-media, .odysee-embed-container, [data-video-wrapper]');
    if (!wrapper) return;
    let overlay = wrapper.querySelector('.smart-pause-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'smart-pause-overlay';
      overlay.innerHTML = `
        <div class="smart-pause-play-btn">▶</div>
        <div class="smart-pause-text">Tap to play</div>
      `;
      overlay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const meta = trackedVideos.get(el);
        if (meta) {
          manuallyPlayed.add(el);
          smartPlay(el, meta);
          currentPlayingVideo = el;
        }
        hidePauseUI(el);
      });
      wrapper.appendChild(overlay);
    }
    // Small delay to avoid flash
    setTimeout(() => overlay.classList.add('show'), 100);
  }

  function hidePauseUI(el) {
    const wrapper = el.closest('.post-media, .odysee-embed-container, [data-video-wrapper]');
    if (!wrapper) return;
    const overlay = wrapper.querySelector('.smart-pause-overlay');
    if (overlay) overlay.classList.remove('show');
  }

  // === TRACK NEW VIDEO ELEMENT ===
  function trackVideo(el, options = {}) {
    if (trackedVideos.has(el)) return;
    let type = 'native';
    let videoId = options.videoId || '';
    if (el.tagName === 'VIDEO') {
      type = 'native';
    } else if (el.tagName === 'IFRAME') {
      const src = el.src || el.getAttribute('data-src') || '';
      if (src.includes('youtube') || src.includes('youtu.be')) {
        type = 'youtube';
        const m = src.match(/(?:embed\/|v=|\/)([a-zA-Z0-9_-]{11})/);
        if (m) videoId = m[1];
      } else if (src.includes('odysee') || src.includes('lbry')) {
        type = 'odysee';
        // Extract claim id from URL
        const m = src.match(/:([a-z0-9]+)/i);
        if (m) videoId = m[1];
      } else {
        return;  // Unknown iframe type
      }
    } else {
      return;
    }
    const meta = { type, videoId, postId: options.postId, watchTime: 0, hasCountedView: false };
    trackedVideos.set(el, meta);
    observer.observe(el);
    // Listen for user interactions (manual play/pause)
    if (type === 'native') {
      el.addEventListener('play', () => {
        manuallyPlayed.add(el);
        currentPlayingVideo = el;
        hidePauseUI(el);
      });
      el.addEventListener('pause', () => {
        if (currentPlayingVideo === el) currentPlayingVideo = null;
        // Check if pause came from us (auto) or user
        // If user clicked, mark as manual
        // Heuristic: if intersection ratio is still high, it's manual
        if (getVisibleRatio(el) >= 0.6) {
          manuallyPaused.add(el);
          showPauseUI(el);
        }
      });
    }
  }

  // === SCAN DOM FOR VIDEOS ===
  function scanForVideos() {
    // Scan for <video> elements
    document.querySelectorAll('video').forEach(el => {
      if (!trackedVideos.has(el)) trackVideo(el);
    });
    // Scan for YouTube/Odysee iframes
    document.querySelectorAll('iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="odysee"]').forEach(el => {
      if (!trackedVideos.has(el)) trackVideo(el);
    });
    // Scan for click-to-play placeholders (data-video-id)
    document.querySelectorAll('[data-video-id], [data-youtube-id], [data-odysee-id]').forEach(el => {
      if (!el._videoTracked) {
        el._videoTracked = true;
        el.addEventListener('click', () => {
          setTimeout(scanForVideos, 500);  // Re-scan after iframe is added
        }, { once: true });
      }
    });
  }

  // === OBSERVE DOM CHANGES ===
  const domObserver = new MutationObserver(() => {
    scanForVideos();
  });
  domObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // === INITIALIZE ===
  // Add CSS for pause overlay
  if (!document.getElementById('smart-video-css')) {
    const style = document.createElement('style');
    style.id = 'smart-video-css';
    style.textContent = `
      .smart-pause-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.7);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10;
        opacity: 0;
        transition: opacity 0.2s;
        pointer-events: auto;
      }
      .smart-pause-overlay.show {
        opacity: 1;
      }
      .smart-pause-play-btn {
        width: 70px;
        height: 70px;
        border-radius: 50%;
        background: rgba(255,255,255,0.95);
        color: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        font-weight: 800;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        transition: transform 0.15s;
      }
      .smart-pause-overlay:hover .smart-pause-play-btn {
        transform: scale(1.1);
      }
      .smart-pause-text {
        color: #fff;
        font-size: 12px;
        margin-top: 10px;
        opacity: 0.9;
        text-shadow: 0 1px 3px rgba(0,0,0,0.5);
      }
    `;
    document.head.appendChild(style);
  }

  // === PUBLIC API ===
  window.SmartVideo = {
    track: trackVideo,
    scan: scanForVideos,
    pauseAll: () => {
      trackedVideos.forEach((m, el) => smartPause(el, m, true));
      currentPlayingVideo = null;
    },
    playOnly: (el) => {
      trackedVideos.forEach((m, other) => {
        if (other !== el) smartPause(other, m, true);
      });
      const meta = trackedVideos.get(el);
      if (meta) {
        manuallyPlayed.add(el);
        smartPlay(el, meta);
        currentPlayingVideo = el;
      }
    },
    countView,  // expose for manual counting
    getStats: () => ({
      totalTracked: trackedVideos.size,
      currentPlaying: !!currentPlayingVideo,
      viewsCounted: trackedVideos.size,  // approximate
    })
  };

  // Auto-scan on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanForVideos);
  } else {
    setTimeout(scanForVideos, 100);
  }

  // Also scan on scroll (for lazy-loaded content)
  let scrollScanTimeout = null;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollScanTimeout);
    scrollScanTimeout = setTimeout(scanForVideos, 500);
  }, { passive: true });

  console.log('🎬 Smart video auto-pause loaded');
})();
