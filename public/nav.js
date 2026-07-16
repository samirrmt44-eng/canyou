/* ============================================================
   DAINIKSTATE SUPER APP - Master Navigation
   Inject unified header + service tabs on every page
   ============================================================ */

(function() {
  'use strict';

  // Detect current page
  const path = window.location.pathname.replace(/\/$/, '');
  const current = path.split('/').pop() || 'index.html';

  // All service pages
  const services = [
    { id: 'home', name: 'होम', icon: '🏠', url: '/index.html', file: 'index.html' },
    { id: 'toto', name: 'TOTO', icon: '🛺', url: '/toto.html', file: 'toto.html' },
    { id: 'school', name: 'स्कूल', icon: '🏫', url: '/school-portal.html', file: 'school-portal.html' },
    { id: 'news', name: 'न्यूज़', icon: '📰', url: '/news.html', file: 'news.html' },
    { id: 'kirana', name: 'किराना', icon: '🛒', url: '/kirana.html', file: 'kirana.html' },
    { id: 'sabji', name: 'सब्जी', icon: '🥬', url: '/sabji.html', file: 'sabji.html' },
    { id: 'bazar', name: 'बाज़ार', icon: '💼', url: '/localbazar.html', file: 'localbazar.html' },
    { id: 'trade', name: 'ट्रेडिंग', icon: '📈', url: '/trading.html', file: 'trading.html' },
  ];

  // Get current service theme
  const currentService = services.find(s => s.file === current) || services[0];

  // Get logged in user from localStorage
  const user = JSON.parse(localStorage.getItem('dsUser') || 'null');

  // Nav HTML template
  function buildNav() {
    const tabs = services.map(s => {
      const isActive = s.id === currentService.id;
      return `<a href="${s.url}" class="ds-nav-tab ${isActive ? 'active' : ''}">
        <span>${s.icon}</span><span>${s.name}</span>
      </a>`;
    }).join('');

    return `
      <nav class="ds-nav">
        <div class="ds-nav-top">
          <a href="/index.html" class="ds-nav-brand">
            <div class="ds-nav-icon">🛺</div>
            <div class="ds-nav-text">
              <h1>DainikState</h1>
              <small>${currentService.icon} ${currentService.name} • हाजारीबाग़</small>
            </div>
          </a>
          <div class="ds-nav-actions">
            <button class="ds-nav-btn" onclick="DS.openSOS()" title="SOS">🆘</button>
            <button class="ds-nav-btn" onclick="DS.openProfile()" title="Profile">
              ${user ? (user.name ? user.name.charAt(0).toUpperCase() : '👤') : '👤'}
            </button>
          </div>
        </div>
        <div class="ds-nav-tabs">${tabs}</div>
      </nav>
    `;
  }

  // SOS Modal
  function buildSOS() {
    return `
      <div id="dsSosBg" class="ds-modal-bg" onclick="if(event.target===this)DS.closeSOS()">
        <div class="ds-modal">
          <div class="ds-modal-handle"></div>
          <h3>🆘 आपातकालीन सहायता</h3>
          <p class="ds-text-3 ds-mb-2">तुरंत संपर्क करें - 24/7 उपलब्ध</p>
          <a href="tel:112" class="ds-btn ds-btn-danger ds-btn-lg ds-btn-block ds-mb-1">📞 112 - पुलिस</a>
          <a href="tel:108" class="ds-btn ds-btn-danger ds-btn-lg ds-btn-block ds-mb-1">🚑 108 - एम्बुलेंस</a>
          <a href="tel:100" class="ds-btn ds-btn-warn ds-btn-lg ds-btn-block ds-mb-2">🔥 100 - दमकल</a>
          <a href="tel:+919876500001" class="ds-btn ds-btn-primary ds-btn-lg ds-btn-block ds-mb-1">📞 DainikState हेल्पलाइन</a>
          <button class="ds-btn ds-btn-outline ds-btn-block" onclick="DS.closeSOS()">बंद करें</button>
        </div>
      </div>
    `;
  }

  // Profile Modal
  function buildProfile() {
    if (!user) {
      return `
        <div id="dsProfileBg" class="ds-modal-bg" onclick="if(event.target===this)DS.closeProfile()">
          <div class="ds-modal">
            <div class="ds-modal-handle"></div>
            <h3>👤 लॉगिन / साइन अप</h3>
            <p class="ds-text-3 ds-mb-2">फ़ोन नंबर से मुफ्त लॉगिन करें</p>
            <div class="ds-form-group">
              <label class="ds-form-label">फ़ोन नंबर</label>
              <input type="tel" id="dsLoginPhone" class="ds-form-input" placeholder="+91 98765 00000" maxlength="13">
            </div>
            <div class="ds-form-group">
              <label class="ds-form-label">आपका नाम (वैकल्पिक)</label>
              <input type="text" id="dsLoginName" class="ds-form-input" placeholder="राम कुमार">
            </div>
            <button class="ds-btn ds-btn-primary ds-btn-lg ds-btn-block ds-mb-2" onclick="DS.login()">
              📲 WhatsApp पर OTP भेजें
            </button>
            <p class="ds-text-3 ds-text-sm ds-text-center">
              WhatsApp पर OTP मिलेगा (100% मुफ्त)
            </p>
            <button class="ds-btn ds-btn-outline ds-btn-block ds-mt-2" onclick="DS.closeProfile()">बंद करें</button>
          </div>
        </div>
      `;
    }

    const roles = [
      { id: 'parent', icon: '👨‍👩‍👧', name: 'अभिभावक' },
      { id: 'driver', icon: '🛺', name: 'चालक' },
      { id: 'shopkeeper', icon: '🛒', name: 'दुकानदार' },
      { id: 'farmer', icon: '🥬', name: 'किसान' },
      { id: 'teacher', icon: '👩‍🏫', name: 'शिक्षक' },
      { id: 'admin', icon: '⚙️', name: 'एडमिन' },
    ];

    return `
      <div id="dsProfileBg" class="ds-modal-bg" onclick="if(event.target===this)DS.closeProfile()">
        <div class="ds-modal">
          <div class="ds-modal-handle"></div>
          <div class="ds-text-center ds-mb-2">
            <div style="width:80px;height:80px;border-radius:50%;background:var(--ds-gradient-main);display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 12px;">
              ${user.name ? user.name.charAt(0).toUpperCase() : '👤'}
            </div>
            <h3>${user.name || 'अभिभावक'}</h3>
            <p class="ds-text-3">📱 ${user.phone}</p>
          </div>
          <div class="ds-form-group">
            <label class="ds-form-label">मेरा रोल (बदलें)</label>
            <div class="ds-grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px;">
              ${roles.map(r => `
                <button class="ds-grid-card" style="padding:12px 8px;${user.role === r.id ? 'border-color:var(--ds-primary);background:rgba(102,126,234,0.1);' : ''}" onclick="DS.setRole('${r.id}')">
                  <div style="font-size:24px;margin-bottom:4px;">${r.icon}</div>
                  <div style="font-size:11px;font-weight:700;">${r.name}</div>
                </button>
              `).join('')}
            </div>
          </div>
          <button class="ds-btn ds-btn-outline ds-btn-block ds-mb-1" onclick="DS.openSettings()">⚙️ सेटिंग्स</button>
          <button class="ds-btn ds-btn-danger ds-btn-block ds-mb-2" onclick="DS.logout()">🚪 लॉगआउट</button>
          <button class="ds-btn ds-btn-outline ds-btn-block" onclick="DS.closeProfile()">बंद करें</button>
        </div>
      </div>
    `;
  }

  // Settings Modal
  function buildSettings() {
    return `
      <div id="dsSettingsBg" class="ds-modal-bg" onclick="if(event.target===this)DS.closeSettings()">
        <div class="ds-modal">
          <div class="ds-modal-handle"></div>
          <h3>⚙️ सेटिंग्स</h3>
          <div class="ds-form-group">
            <label class="ds-form-label">भाषा / Language</label>
            <select class="ds-form-select">
              <option>हिंदी (Hindi)</option>
              <option>English</option>
              <option>हिंदी + English</option>
            </select>
          </div>
          <div class="ds-form-group">
            <label class="ds-form-label">नोटिफिकेशन</label>
            <label class="ds-flex ds-gap-1" style="margin-bottom:8px;">
              <input type="checkbox" checked> SMS / WhatsApp नोटिफिकेशन
            </label>
            <label class="ds-flex ds-gap-1">
              <input type="checkbox" checked> बुकिंग अपडेट
            </label>
          </div>
          <div class="ds-form-group">
            <label class="ds-form-label">🌙 थीम</label>
            <select class="ds-form-select" onchange="DS.setTheme(this.value)">
              <option value="dark">Dark (default)</option>
              <option value="light">Light</option>
            </select>
          </div>
          <button class="ds-btn ds-btn-primary ds-btn-block ds-mb-1" onclick="DS.saveSettings()">💾 सेव करें</button>
          <button class="ds-btn ds-btn-outline ds-btn-block" onclick="DS.closeSettings()">बंद करें</button>
        </div>
      </div>
    `;
  }

  // Toast
  function toast(msg, type = '') {
    let t = document.getElementById('dsToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dsToast';
      t.className = 'ds-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'ds-toast show ' + type;
    clearTimeout(window._dsToastTimer);
    window._dsToastTimer = setTimeout(() => {
      t.className = 'ds-toast ' + type;
    }, 3000);
  }

  // Global API
  window.DS = {
    // Open/close modals
    openSOS: () => {
      const m = document.getElementById('dsSosBg');
      if (!m) { document.body.insertAdjacentHTML('beforeend', buildSOS()); }
      document.getElementById('dsSosBg').classList.add('show');
    },
    closeSOS: () => {
      const m = document.getElementById('dsSosBg');
      if (m) m.classList.remove('show');
    },
    openProfile: () => {
      const m = document.getElementById('dsProfileBg');
      if (m) m.remove();
      document.body.insertAdjacentHTML('beforeend', buildProfile());
      document.getElementById('dsProfileBg').classList.add('show');
    },
    closeProfile: () => {
      const m = document.getElementById('dsProfileBg');
      if (m) m.classList.remove('show');
    },
    openSettings: () => {
      const m = document.getElementById('dsSettingsBg');
      if (m) m.remove();
      document.body.insertAdjacentHTML('beforeend', buildSettings());
      document.getElementById('dsSettingsBg').classList.add('show');
    },
    closeSettings: () => {
      const m = document.getElementById('dsSettingsBg');
      if (m) m.classList.remove('show');
    },

    // Login
    login: () => {
      const phone = document.getElementById('dsLoginPhone').value.trim();
      const name = document.getElementById('dsLoginName').value.trim();
      if (!phone || phone.length < 10) {
        toast('⚠️ सही फ़ोन नंबर डालें', 'error');
        return;
      }
      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000);
      sessionStorage.setItem('dsOtp', otp);
      sessionStorage.setItem('dsOtpPhone', phone);
      // Send via WhatsApp
      const msg = `🔐 DainikState OTP\n\nआपका OTP है: ${otp}\n\n(OTP किसी को न बताएं)`;
      const waUrl = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank');
      // Show OTP input
      DS._showOTPInput(phone, name);
    },

    _showOTPInput: (phone, name) => {
      const modal = document.getElementById('dsProfileBg');
      if (!modal) return;
      const m = modal.querySelector('.ds-modal');
      m.innerHTML = `
        <div class="ds-modal-handle"></div>
        <h3>🔐 OTP वेरिफाई करें</h3>
        <p class="ds-text-3 ds-mb-2">📱 ${phone} पर WhatsApp पर भेजा गया</p>
        <div class="ds-form-group">
          <label class="ds-form-label">6 अंकों का OTP</label>
          <input type="number" id="dsOtpInput" class="ds-form-input" placeholder="123456" maxlength="6" style="font-size:24px;text-align:center;letter-spacing:8px;">
        </div>
        <p class="ds-text-3 ds-text-sm ds-mb-2">💡 डेमो: कोई भी 6 अंक डालें (testing mode)</p>
        <button class="ds-btn ds-btn-primary ds-btn-lg ds-btn-block ds-mb-2" onclick="DS.verifyOTP('${phone}','${name}')">✅ वेरिफाई करें</button>
        <button class="ds-btn ds-btn-outline ds-btn-block" onclick="DS.openProfile()">← वापस</button>
      `;
    },

    verifyOTP: (phone, name) => {
      const otp = document.getElementById('dsOtpInput').value.trim();
      if (!otp || otp.length !== 6) {
        toast('⚠️ 6 अंकों का OTP डालें', 'error');
        return;
      }
      // Save user
      const userData = { phone, name: name || '', role: 'parent', loginAt: Date.now() };
      localStorage.setItem('dsUser', JSON.stringify(userData));
      // Register on server
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      }).catch(() => {});

      toast('✅ लॉगिन सफल! स्वागत है', 'success');
      setTimeout(() => location.reload(), 800);
    },

    setRole: (role) => {
      const u = JSON.parse(localStorage.getItem('dsUser') || '{}');
      u.role = role;
      localStorage.setItem('dsUser', JSON.stringify(u));
      toast(`✅ रोल बदला: ${role}`, 'success');
      setTimeout(() => location.reload(), 500);
    },

    logout: () => {
      if (confirm('क्या आप लॉगआउट करना चाहते हैं?')) {
        localStorage.removeItem('dsUser');
        toast('👋 लॉगआउट हो गया');
        setTimeout(() => location.href = '/index.html', 600);
      }
    },

    setTheme: (theme) => {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('dsTheme', theme);
    },

    saveSettings: () => {
      toast('💾 सेटिंग्स सेव हो गईं', 'success');
      DS.closeSettings();
    },

    toast: toast,

    // Get current user
    user: () => JSON.parse(localStorage.getItem('dsUser') || 'null'),

    // Get current service
    service: () => currentService,
  };

  // Auto-inject nav
  function init() {
    // Check if page already has .ds-nav
    if (document.querySelector('.ds-nav')) return;

    // Inject design system CSS if not present
    if (!document.querySelector('link[href*="design-system.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/design-system.css';
      document.head.appendChild(link);
    }

    // Insert nav at top of body
    const navHTML = buildNav();
    const firstChild = document.body.firstChild;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = navHTML;
    if (firstChild) {
      document.body.insertBefore(wrapper.firstChild, firstChild);
    } else {
      document.body.appendChild(wrapper.firstChild);
    }
  }

  // Wait for body
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
