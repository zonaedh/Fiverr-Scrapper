// sidepanel.js

console.log("Fiverr Boss sidepanel.js loaded successfully.");

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://ihvncqcmnulirebdsxql.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WvgJ_-HqmUZds4Sl3HObYA_rFbIZEe6';

// --- Device ID Helper ---
async function getDeviceId() {
  return new Promise((resolve) => {
    chrome.storage.local.get('deviceId', (data) => {
      if (data.deviceId) {
        resolve(data.deviceId);
      } else {
        const newId = crypto.randomUUID();
        chrome.storage.local.set({ deviceId: newId }, () => resolve(newId));
      }
    });
  });
}

// --- Load Saved Data & Check License on Startup ---
window.addEventListener('DOMContentLoaded', () => {
  try {
    const gate = document.getElementById('license-gate');
    const app = document.getElementById('app-container');

    chrome.storage.local.get('license', (data) => {
      const license = data.license;
      let isValid = false;

      if (license && license.expires_at) {
        const expiryDate = new Date(license.expires_at);
        if (expiryDate > new Date()) {
          isValid = true;
        }
      }

      if (isValid) {
        gate.style.display = 'none';
        app.style.display = 'flex';
        updateLicenseStatusUI(license.expires_at, license.customer_name, license.key);
        silentValidateLicense(license.key);
      } else {
        gate.style.display = 'flex';
        app.style.display = 'none';
      }
    });
  } catch (e) {
    console.error("Startup Error:", e);
  }
});

function maskLicenseKey(key) {
  if (!key) return '—';
  const parts = key.split('-');
  if (parts.length === 4) {
    return `${parts[0]}-${'*'.repeat(5)}-${parts[2]}-${parts[3]}`;
  }
  return key;
}

function updateLicenseStatusUI(expires_at, customer_name, key) {
  const statusText  = document.getElementById('license-status-text');
  const statusSub   = document.getElementById('license-status-sub');
  const licensedToEl = document.getElementById('licensed-to-text');
  const keyDisplayEl = document.getElementById('license-key-display');
  const expiryEl    = document.getElementById('license-expiry-display');
  const remainingDaysEl = document.getElementById('remaining-days');

  const expiryDate = new Date(expires_at);
  const today = new Date();
  const diffTime = expiryDate - today;
  const diffDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  if (statusText) statusText.innerText = 'License Active';
  if (statusSub)  statusSub.innerText  = `Verified · Expires ${expiryDate.toLocaleDateString()}`;
  if (licensedToEl) licensedToEl.innerText = customer_name || '—';
  if (keyDisplayEl) keyDisplayEl.innerText = maskLicenseKey(key);
  if (expiryEl)   expiryEl.innerText   = expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  if (remainingDaysEl) remainingDaysEl.innerText = `${diffDays}`;
}

// --- Supabase Validation Function ---
async function validateLicense(key, feedbackEl, isGate = false) {
  if (!feedbackEl) return;

  const keyRegex = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
  if (!keyRegex.test(key)) {
    feedbackEl.innerText = 'Invalid format. Use XXXXX-XXXXX-XXXXX-XXXXX.';
    feedbackEl.style.color = '#f87171';
    return;
  }

  feedbackEl.innerText = 'Validating...';
  feedbackEl.style.color = '#94a3b8';

  try {
    const deviceId = await getDeviceId();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ p_key: key, p_device_id: deviceId })
    });

    const result = await response.json();
    console.log('[DEBUG] Supabase response:', JSON.stringify(result));

    if (result && result.status === 'success') {
      chrome.storage.local.set({ 
        license: { 
          key: key, 
          expires_at: result.expires_at,
          customer_name: result.customer_name,
          customer_phone: result.customer_phone
        } 
      }, () => {
        if (isGate) {
          window.location.reload();
        } else {
          feedbackEl.innerText = 'Activation successful!';
          feedbackEl.style.color = '#4ade80';
          updateLicenseStatusUI(result.expires_at, result.customer_name, key);
        }
      });
    } else if (result && result.status === 'expired') {
      feedbackEl.innerText = 'This key has expired.';
      feedbackEl.style.color = '#f87171';
    } else if (result && result.status === 'device_mismatch') {
      feedbackEl.innerText = 'License is already registered to another device.';
      feedbackEl.style.color = '#f87171';
    } else {
      feedbackEl.innerText = 'License isn\'t working. Contact the Developer.';
      feedbackEl.style.color = '#f87171';
    }
  } catch (error) {
    console.error('Supabase Fetch Error:', error);
    feedbackEl.innerText = 'Network error. Check connection.';
    feedbackEl.style.color = '#f87171';
  }
}

async function silentValidateLicense(key) {
  try {
    const deviceId = await getDeviceId();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ p_key: key, p_device_id: deviceId })
    });
    const result = await response.json();

    if (result && result.status === 'success') {
      chrome.storage.local.set({ 
        license: { 
          key: key, 
          expires_at: result.expires_at,
          customer_name: result.customer_name,
          customer_phone: result.customer_phone
        } 
      });
      updateLicenseStatusUI(result.expires_at, result.customer_name, key);
    } else {
      chrome.storage.local.remove('license', () => {
        chrome.runtime.sendMessage({ type: 'FORCE_LOCK' });
      });
    }
  } catch (error) {
    console.error('Silent Supabase Fetch Error:', error);
  }
}

// --- Event Listeners ---

// License Gate Unlock Button
const gateBtn = document.getElementById('gate-activate-btn');
if (gateBtn) {
  gateBtn.addEventListener('click', () => {
    const key = document.getElementById('gate-license-input').value.trim();
    const feedbackEl = document.getElementById('gate-feedback');
    validateLicense(key, feedbackEl, true);
  });
}

// License Tab Sign Out Button
const signoutBtn = document.getElementById('signout-btn');
if (signoutBtn) {
  signoutBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to sign out? The extension will lock immediately.')) {
      chrome.storage.local.remove('license', () => {
        window.location.reload(); 
      });
    }
  });
}

// Tab Switching
document.querySelectorAll('.menu-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
  });
});

// --- Toggle Pause Helper ---
function togglePauseButtonUI(isPaused, source) {
  if (source === 'socials') {
    const btn = document.getElementById('pause-csv-btn');
    if (btn) {
      if (isPaused) { btn.innerText = 'Resume'; btn.classList.add('paused'); } 
      else { btn.innerText = 'Pause'; btn.classList.remove('paused'); }
    }
  } else {
    const btn = document.getElementById('pause-btn');
    if (btn) {
      if (isPaused) { btn.innerText = 'Resume'; btn.classList.add('paused'); } 
      else { btn.innerText = 'Pause'; btn.classList.remove('paused'); }
    }
  }
}

// Scraper Logic
const startBtn = document.getElementById('start-btn');
if (startBtn) {
  startBtn.addEventListener('click', () => {
    const url = document.getElementById('url-input').value.trim();
    if (!url) { alert('Please paste a Fiverr URL first.'); return; }
    startBtn.disabled = true;
    document.getElementById('status-section').classList.remove('hidden');
    document.getElementById('pause-btn').classList.remove('hidden');
    togglePauseButtonUI(false, 'fiverr');
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-text').innerText = 'Starting process...';
    addLog('Sending URL to background engine...', 'success', 'fiverr');
    chrome.runtime.sendMessage({ type: 'START_SCRAPE', url: url });
  });
}

const pauseBtn = document.getElementById('pause-btn');
if (pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_PAUSE', source: 'fiverr' }, (response) => {
      if (chrome.runtime.lastError) return;
      togglePauseButtonUI(response.isPaused, 'fiverr');
    });
  });
}

// Dashboard Export
const exportBtn = document.getElementById('export-btn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'EXPORT_DATA' });
  });
}

// Hard Reset
const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (confirm('Are you sure? This will permanently delete all scraped buyers, uploaded CSVs, and metrics.')) {
      chrome.storage.local.remove(['scrapedBuyers', 'csvBuyers', 'metrics'], () => {
        document.getElementById('metric-gigs').innerText = '0';
        document.getElementById('metric-buyers').innerText = '0';
        document.getElementById('metric-images').innerText = '0';
        document.getElementById('log-container').innerHTML = '';
        document.getElementById('csv-log-container').innerHTML = '';
        document.getElementById('csv-status').innerText = 'No file selected.';
        document.getElementById('start-csv-osint').disabled = true;
      });
    }
  });
}

// Socials Upload
const uploadBtn = document.getElementById('upload-btn');
if (uploadBtn) {
  uploadBtn.addEventListener('click', () => {
    document.getElementById('csv-upload').click();
  });
}

const csvUpload = document.getElementById('csv-upload');
if (csvUpload) {
  csvUpload.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      const text = e.target.result;
      const lines = text.split('\n');
      const buyers = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const matches = line.match(/^"([^"]+)","([^"]+)","([^"]+)","([^"]*)"/);
        if (matches && matches[1]) {
          buyers.push({ username: matches[1], country: matches[2] || 'Unknown', imageUrl: matches[4] || '', socials: { linkedin: [], facebook: [], instagram: [], twitter: [], pinterest: [], other: [] } });
        }
      }
      if (buyers.length > 0) {
        chrome.storage.local.set({ csvBuyers: buyers }, () => {
          document.getElementById('csv-status').innerText = `Loaded: ${file.name}`;
          document.getElementById('start-csv-osint').disabled = false;
        });
      }
    };
    reader.readAsText(file);
  });
}

const startCsvOsint = document.getElementById('start-csv-osint');
if (startCsvOsint) {
  startCsvOsint.addEventListener('click', () => {
    startCsvOsint.disabled = true;
    document.getElementById('pause-csv-btn').classList.remove('hidden');
    togglePauseButtonUI(false, 'socials');
    chrome.runtime.sendMessage({ type: 'START_CSV_OSINT' });
  });
}

const pauseCsvBtn = document.getElementById('pause-csv-btn');
if (pauseCsvBtn) {
  pauseCsvBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_PAUSE', source: 'socials' }, (response) => {
      if (chrome.runtime.lastError) return;
      togglePauseButtonUI(response.isPaused, 'socials');
    });
  });
}

const exportCsvOsint = document.getElementById('export-csv-osint');
if (exportCsvOsint) {
  exportCsvOsint.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'EXPORT_CSV_OSINT' });
  });
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'FORCE_LOCK') {
    const gate = document.getElementById('license-gate');
    const app = document.getElementById('app-container');
    const feedbackEl = document.getElementById('gate-feedback');
    
    if (gate) gate.style.display = 'flex';
    if (app) app.style.display = 'none';
    if (feedbackEl) {
      feedbackEl.innerText = 'License revoked or invalid. Contact the Developer.';
      feedbackEl.style.color = '#f87171';
    }
    return;
  }

  if (message.type === 'UI_UPDATE') {
    const source = message.source || 'fiverr';
    if (source === 'socials') {
      const pBar = document.getElementById('csv-progress-bar');
      const pText = document.getElementById('csv-progress-text');
      if (pBar) pBar.style.width = message.progress + '%';
      if (pText) pText.innerText = message.statusText;
      addLog(message.logText, message.logType || 'info', 'socials');
      if (message.forcePauseUI) togglePauseButtonUI(true, 'socials');
      if (message.progress === 100) {
        const btn = document.getElementById('start-csv-osint');
        const pBtn = document.getElementById('pause-csv-btn');
        if (btn) btn.disabled = false;
        if (pBtn) pBtn.classList.add('hidden');
      }
    } else {
      const pBar = document.getElementById('progress-bar');
      const pText = document.getElementById('progress-text');
      if (pBar) pBar.style.width = message.progress + '%';
      if (pText) pText.innerText = message.statusText;
      addLog(message.logText, message.logType || 'info', 'fiverr');
      if (message.forcePauseUI) togglePauseButtonUI(true, 'fiverr');
      if (message.progress === 100) {
        const btn = document.getElementById('start-btn');
        const pBtn = document.getElementById('pause-btn');
        if (btn) btn.disabled = false;
        if (pBtn) pBtn.classList.add('hidden');
      }
    }
  }
  if (message.type === 'METRICS_UPDATE') {
    const gigEl = document.getElementById('metric-gigs');
    const buyerEl = document.getElementById('metric-buyers');
    const imgEl = document.getElementById('metric-images');
    if (gigEl) gigEl.innerText = message.metrics.gigsFound || 0;
    if (buyerEl) buyerEl.innerText = message.metrics.buyersFound || 0;
    if (imgEl) imgEl.innerText = message.metrics.imagesFound || 0;
  }
});

// --- Utility ---
function addLog(text, type = 'info', source = 'fiverr') {
  const containerId = source === 'socials' ? 'csv-log-container' : 'log-container';
  const logContainer = document.getElementById(containerId);
  if (!logContainer) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}