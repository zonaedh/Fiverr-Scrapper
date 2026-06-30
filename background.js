// background.js

const SUPABASE_URL = 'https://ihvncqcmnulirebdsxql.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WvgJ_-HqmUZds4Sl3HObYA_rFbIZEe6';

let isPaused = false;
let activeJob = null; // 'fiverr', 'socials', or null (LOCK SYSTEM)
let metrics = { gigsFound: 0, buyersFound: 0, imagesFound: 0 };

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

// --- License Syncing ---
async function syncLicense() {
  chrome.storage.local.get('license', async (data) => {
    if (!data.license || !data.license.key) return;

    try {
      const deviceId = await getDeviceId();
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ p_key: data.license.key, p_device_id: deviceId })
      });
      const result = await response.json();
      
      if (result && result.status === 'success') {
        chrome.storage.local.set({ 
          license: { 
            key: data.license.key, 
            expires_at: result.expires_at,
            customer_name: result.customer_name,
            customer_phone: result.customer_phone
          } 
        });
      } else {
        // Expired or invalid
        chrome.storage.local.remove('license', () => {
          chrome.runtime.sendMessage({ type: 'FORCE_LOCK' });
        });
      }
    } catch (e) {
      console.error("License background sync failed:", e);
    }
  });
}

chrome.runtime.onStartup.addListener(syncLicense);
chrome.runtime.onInstalled.addListener(() => {
  syncLicense();
  chrome.alarms.create("licenseSync", { periodInMinutes: 10 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "licenseSync") syncLicense();
});

// Configure the side panel to open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SCRAPE') {
    if (activeJob && activeJob !== 'fiverr') {
      updateUI(0, 'Busy', `Cannot start. ${activeJob} is already running.`, 'error', 'fiverr');
      return;
    }
    activeJob = 'fiverr';
    isPaused = false;
    chrome.storage.local.set({ isPaused: false });
    metrics = { gigsFound: 0, buyersFound: 0, imagesFound: 0 };
    sendMetrics();
    startScrapingProcess(message.url);
  }
  
  if (message.type === 'START_CSV_OSINT') {
    if (activeJob && activeJob !== 'socials') {
      updateUI(0, 'Busy', `Cannot start. ${activeJob} is already running.`, 'error', 'socials');
      return;
    }
    activeJob = 'socials';
    isPaused = false;
    chrome.storage.local.set({ isPaused: false });
    metrics = { gigsFound: 0, buyersFound: 0, imagesFound: 0 };
    sendMetrics();
    startCsvOsintProcess();
  }

  if (message.type === 'TOGGLE_PAUSE') {
    isPaused = !isPaused;
    chrome.storage.local.set({ isPaused: isPaused });
    sendResponse({ isPaused: isPaused });
    return true;
  }
});

// --- Fiverr Scraper Process ---
async function startScrapingProcess(url) {
  updateUI(0, 'Opening Fiverr search page...', 'Navigating to URL...', 'info', 'fiverr');

  const searchTab = await chrome.tabs.create({ url: url, active: false });
  await waitForTabLoad(searchTab.id);

  updateUI(5, 'Finding gig links...', 'Scanning page for gigs...', 'info', 'fiverr');
  const response = await chrome.tabs.sendMessage(searchTab.id, { type: 'SCRAPE_GIGS' });
  const gigs = response?.gigs || [];

  metrics.gigsFound = gigs.length;
  sendMetrics();

  if (gigs.length === 0) {
    updateUI(100, 'No gigs found.', 'No gigs found on this page.', 'error', 'fiverr');
    await chrome.tabs.remove(searchTab.id);
    activeJob = null;
    return;
  }

  updateUI(10, `Found ${gigs.length} gigs. Starting...`, `Found ${gigs.length} gigs.`, 'success', 'fiverr');
  await chrome.tabs.remove(searchTab.id); 

  let allBuyers = [];
  await chrome.storage.local.set({ scrapedBuyers: allBuyers });

  for (let i = 0; i < gigs.length; i++) {
    await waitWhilePaused(); 
    let progress = 10 + Math.floor(((i) / gigs.length) * 40);
    updateUI(progress, `Scraping Gig ${i + 1} of ${gigs.length}...`, `Opening: ${gigs[i]}`, 'info', 'fiverr');

    const gigTab = await chrome.tabs.create({ url: gigs[i], active: false });
    await waitForTabLoad(gigTab.id);
    await delay(3000);

    try {
      const res = await chrome.tabs.sendMessage(gigTab.id, { type: 'SCRAPE_REVIEWS' });
      if (res?.buyers?.length > 0) {
        allBuyers.push(...res.buyers);
        const uniqueBuyers = Array.from(new Set(allBuyers.map(b => b.username)))
          .map(username => allBuyers.find(b => b.username === username));
        await chrome.storage.local.set({ scrapedBuyers: uniqueBuyers });
        
        metrics.buyersFound = uniqueBuyers.length;
        metrics.imagesFound = uniqueBuyers.filter(b => b.imageUrl && b.imageUrl.startsWith('http')).length;
        sendMetrics();
        updateUI(progress, `Scraping Gig ${i + 1}...`, `Found ${res.buyers.length} buyers. Saved.`, 'success', 'fiverr');
      }
    } catch (e) {
      updateUI(progress, `Scraping Gig ${i + 1}...`, `Error scraping gig.`, 'error', 'fiverr');
    }

    await chrome.tabs.remove(gigTab.id);
    await delay(1500); 
  }

  const uniqueBuyers = Array.from(new Set(allBuyers.map(b => b.username)))
    .map(username => allBuyers.find(b => b.username === username));

  await chrome.storage.local.set({ scrapedBuyers: uniqueBuyers });
  
  await runOsintPhase(uniqueBuyers, 'scrapedBuyers', 'fiverr');
}

// --- CSV OSINT Process ---
async function startCsvOsintProcess() {
  updateUI(0, 'Loading CSV data...', 'Reading uploaded CSV buyers...', 'info', 'socials');
  
  const data = await chrome.storage.local.get('csvBuyers');
  const buyers = data.csvBuyers || [];

  if (buyers.length === 0) {
    updateUI(100, 'No Data', 'No CSV data found. Please upload a valid file.', 'error', 'socials');
    activeJob = null;
    return;
  }

  metrics.buyersFound = buyers.length;
  metrics.imagesFound = buyers.filter(b => b.imageUrl && b.imageUrl.startsWith('http')).length;
  sendMetrics();

  await runOsintPhase(buyers, 'csvBuyers', 'socials');
}

// --- Unified OSINT Phase ---
async function runOsintPhase(buyersArray, storageKey, source) {
  updateUI(50, `Starting Deep OSINT for ${buyersArray.length} buyers...`, `Starting OSINT...`, 'success', source);

  for (let i = 0; i < buyersArray.length; i++) {
    await waitWhilePaused(); 
    let buyer = buyersArray[i];
    let progress = 50 + Math.floor(((i) / buyersArray.length) * 50);

    if(!buyer.socials) {
      buyer.socials = { linkedin: [], facebook: [], instagram: [], twitter: [], pinterest: [], other: [] };
    }

    updateUI(progress, `OSINT ${i + 1} of ${buyersArray.length}: ${buyer.username}`, `Running Google Username Search...`, 'info', source);
    
    const gSearchUrl = `https://www.google.com/search?q="${buyer.username}" (site:linkedin.com/in OR site:facebook.com OR site:instagram.com OR site:twitter.com OR site:pinterest.com)`;
    await executeSearchScrape(gSearchUrl, buyer, 5000, source);

    await waitWhilePaused();
    updateUI(progress, `OSINT ${i + 1}: ${buyer.username}`, `Running Bing Username Search...`, 'info', source);

    const bSearchUrl = `https://www.bing.com/search?q="${buyer.username}" (site:linkedin.com/in OR site:facebook.com OR site:instagram.com OR site:twitter.com OR site:pinterest.com)`;
    await executeSearchScrape(bSearchUrl, buyer, 5000, source);

    if (buyer.imageUrl && buyer.imageUrl.startsWith('http')) {
      await waitWhilePaused();
      updateUI(progress, `OSINT ${i + 1}: ${buyer.username}`, `Running Google Lens...`, 'info', source);

      const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(buyer.imageUrl)}`;
      await executeSearchScrape(lensUrl, buyer, 8000, source);

      await waitWhilePaused();
      updateUI(progress, `OSINT ${i + 1}: ${buyer.username}`, `Running Bing Visual Search...`, 'info', source);

      const bingImgUrl = `https://www.bing.com/images/searchbyimage?cbir=ssbi&imgurl=${encodeURIComponent(buyer.imageUrl)}`;
      await executeSearchScrape(bingImgUrl, buyer, 8000, source);
    }

    let storageData = {};
    storageData[storageKey] = buyersArray;
    await chrome.storage.local.set(storageData);
    
    updateUI(progress, `OSINT ${i + 1} Complete.`, `Data saved. Moving to next buyer.`, 'success', source);
    await delay(2000); 
  }

  updateUI(100, 'Process Complete!', 'All OSINT completed. Check Dashboard or Socials tab.', 'success', source);
  activeJob = null; // Unlock
}

// Helper: Open tab, inject parser, check for CAPTCHA, wait for manual solve, close tab
async function executeSearchScrape(url, buyer, waitTime, source) {
  const tab = await chrome.tabs.create({ url: url, active: false });
  await waitForTabLoad(tab.id);
  await delay(waitTime); 

  let attempts = 0;
  let data;

  while (attempts < 2) {
    attempts++;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: parseSearchEngineResults
      });
      data = results[0]?.result;
    } catch (e) {
      console.error("Injection failed:", e);
      data = { captcha: false, links: [] };
      break; 
    }

    if (data && data.captcha) {
      await chrome.tabs.update(tab.id, { active: true });
      isPaused = true;
      chrome.storage.local.set({ isPaused: true });
      
      chrome.runtime.sendMessage({
        type: 'UI_UPDATE',
        progress: 0,
        statusText: 'CAPTCHA DETECTED!',
        logText: 'CAPTCHA detected! Please solve it in the browser, then click Resume.',
        logType: 'error',
        source: source,
        forcePauseUI: true
      });
      
      await waitWhilePaused();
      await delay(5000);
    } else {
      break; 
    }
  }

  if (data && data.links) {
    data.links.forEach(link => {
      if (link.includes('linkedin.com/in')) buyer.socials.linkedin.push(link);
      else if (link.includes('facebook.com')) buyer.socials.facebook.push(link);
      else if (link.includes('instagram.com')) buyer.socials.instagram.push(link);
      else if (link.includes('twitter.com') || link.includes('x.com')) buyer.socials.twitter.push(link);
      else if (link.includes('pinterest.com')) buyer.socials.pinterest.push(link);
      else if (!link.includes('google.com') && !link.includes('bing.com') && !link.includes('gstatic') && !link.includes('fiverr.com')) {
        buyer.socials.other.push(link);
      }
    });
  }

  await chrome.tabs.remove(tab.id);
}

// Injected into Google/Bing tabs
function parseSearchEngineResults() {
  if (document.body.innerText.includes("unusual traffic") || 
      document.body.innerText.includes("verify you are human") || 
      document.getElementById('captcha-form') ||
      document.querySelector('.g-recaptcha')) {
    return { captcha: true };
  }

  const links = [];
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href;
    if (href && !href.startsWith('https://www.google.com') && !href.startsWith('https://www.bing.com') && !href.startsWith('chrome://')) {
      links.push(href);
    }
  });

  return { captcha: false, links: [...new Set(links)] };
}

// --- Utility Functions ---
function waitWhilePaused() {
  return new Promise(resolve => {
    const check = () => {
      if (!isPaused) resolve();
      else setTimeout(check, 500);
    };
    check();
  });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function updateUI(progress, statusText, logText, logType, source) {
  chrome.runtime.sendMessage({ type: 'UI_UPDATE', progress, statusText, logText, logType, source });
}

function sendMetrics() {
  // SAVE TO STORAGE so it persists forever
  chrome.storage.local.set({ metrics: metrics });
  // SEND TO UI
  chrome.runtime.sendMessage({ type: 'METRICS_UPDATE', metrics });
}