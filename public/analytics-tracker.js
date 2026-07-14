// Lightweight client analytics tracker
// Include this on every page you want to track
// Tracks: time on page, clicks, form submits, scrolls, button presses

(function() {
  const API = 'https://canyou-uqkp.onrender.com';
  let sessionId = localStorage.getItem('ds_analytics_sid');
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 12);
    localStorage.setItem('ds_analytics_sid', sessionId);
  }

  const page = window.location.pathname;
  const startTime = Date.now();
  let maxScroll = 0;
  let lastHeartbeat = Date.now();

  // Helper to send events (non-blocking)
  function trackEvent(type, label, value, meta) {
    try {
      fetch(API + '/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          type,
          label: label || '',
          value: value || 0,
          page,
          meta: meta || {}
        })
      }).catch(() => {});  // Silent fail
    } catch (e) {}
  }

  // Auto-detect clicks on buttons + links
  document.addEventListener('click', (e) => {
    const target = e.target.closest('button, a, [role="button"], .action-btn, .nav-item, .tab');
    if (target) {
      const label = (target.textContent || target.getAttribute('aria-label') || target.id || '').trim().slice(0, 50);
      if (label && label.length > 1) {
        trackEvent('click', label, 0, { tag: target.tagName, href: target.href || '' });
      }
    }
  });

  // Form submits
  document.addEventListener('submit', (e) => {
    const form = e.target;
    trackEvent('form_submit', form.id || form.className || 'unnamed_form', 0);
  });

  // Track scroll depth
  window.addEventListener('scroll', () => {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrollPct = docHeight > 0 ? Math.round((window.scrollY / docHeight) * 100) : 0;
    if (scrollPct > maxScroll) {
      maxScroll = scrollPct;
      if (maxScroll % 25 === 0) {
        trackEvent('scroll', maxScroll + '%', maxScroll);
      }
    }
  });

  // Time on page (send on unload + every 30s)
  function sendTimeOnPage() {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    if (seconds > 0) {
      trackEvent('time_on_page', page, seconds, { maxScroll });
    }
  }
  setInterval(sendTimeOnPage, 30000);
  window.addEventListener('beforeunload', sendTimeOnPage);

  // Search/input detection
  document.addEventListener('input', (e) => {
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      const val = (target.value || '').trim();
      if (val.length > 3 && val.length % 10 === 0) {
        // Track every 10 chars typed (sampling)
        trackEvent('input_typing', target.id || target.placeholder || 'input', val.length);
      }
    }
  });

  // Custom events for dukandar (Local Bazar)
  // Track wizard start, product added, order placed, etc.
  window.dsAnalytics = {
    track: trackEvent,
    sessionId: sessionId,
    // Helpers for common events
    productView: (name) => trackEvent('product_view', name),
    productAdd: (name, category) => trackEvent('product_add', name, 0, { category }),
    wizardStart: () => trackEvent('wizard_start', ''),
    wizardComplete: () => trackEvent('wizard_complete', ''),
    wizardAbandon: (step) => trackEvent('wizard_abandon', 'step_' + step, step),
    orderPlaced: (total) => trackEvent('order_placed', '', total),
    orderAccept: (id) => trackEvent('order_accept', id),
    orderDeliver: (id) => trackEvent('order_deliver', id),
    signup: (method) => trackEvent('signup', method),
    login: (method) => trackEvent('login', method),
    search: (q) => trackEvent('search', q, 0, { length: q.length }),
  };

  // Set session ID in all future fetch headers
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const [url, opts = {}] = args;
    opts.headers = opts.headers || {};
    opts.headers['X-Session-Id'] = sessionId;
    return origFetch(url, opts);
  };

  console.log('📊 Analytics tracker loaded (sid: ' + sessionId + ')');
})();
