// content-script.js

// Helper: Check if paused (checks storage every 500ms)
function checkPause() {
  return new Promise((resolve) => {
    const check = () => {
      chrome.storage.local.get('isPaused', (data) => {
        if (data.isPaused) {
          setTimeout(check, 500); 
        } else {
          resolve(); 
        }
      });
    };
    check();
  });
}

// Listen for commands from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCRAPE_GIGS') {
    const gigLinks = [];
    document.querySelectorAll('a[aria-label="Go to gig"]').forEach(link => {
      let href = link.href.split('?')[0];
      if (href.includes('fiverr.com') && !href.includes('/categories/') && gigLinks.indexOf(href) === -1) {
        gigLinks.push(href);
      }
    });
    sendResponse({ gigs: gigLinks });
  }
  
  if (message.type === 'SCRAPE_REVIEWS') {
    scrapeReviews().then(buyers => {
      sendResponse({ buyers: buyers });
    });
    return true; 
  }
});

// Function to click reviews and continuously click "Show More"
async function scrapeReviews() {
  return new Promise(async (resolve) => {
    
    // 1. Open initial reviews section
    const reviewBtn = Array.from(document.querySelectorAll('span, button, a, p')).find(el => {
      const text = el.textContent.trim().toLowerCase();
      return text.match(/^\d+ reviews$/) && el.offsetParent !== null; 
    });

    if (reviewBtn) {
      reviewBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 1000)); 
      reviewBtn.click();
      await new Promise(r => setTimeout(r, 2000)); 
    }

    // 2. Click "Show More" continuously
    let clickAttempts = 0;
    const maxClickAttempts = 50; 
    let previousReviewCount = 0;
    let stagnantClicks = 0; 

    while (clickAttempts < maxClickAttempts) {
      
      // PAUSE CHECK: Halt everything if user clicked pause
      await checkPause();

      const showMoreBtn = Array.from(document.querySelectorAll('button')).find(btn => {
        const text = btn.textContent.trim().toLowerCase();
        return text.includes('show more') && text.includes('review') && btn.offsetParent !== null;
      });

      if (!showMoreBtn) break; 

      let currentReviewCount = document.querySelectorAll('li.review-item-component').length;
      if (currentReviewCount === previousReviewCount) {
        stagnantClicks++;
        if (stagnantClicks >= 3) break;
      } else {
        stagnantClicks = 0; 
      }
      previousReviewCount = currentReviewCount;

      showMoreBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 500)); 
      showMoreBtn.click();
      await new Promise(r => setTimeout(r, 2500)); 
      
      clickAttempts++;
    }

    resolve(extractBuyerData());
  });
}

// Extract data from loaded reviews
function extractBuyerData() {
  const buyers = [];
  const reviewItems = document.querySelectorAll('li.review-item-component');

  reviewItems.forEach(item => {
    const figure = item.querySelector('figure[title]');
    if (!figure) return; 
    
    const username = figure.getAttribute('title');
    
    let country = 'Unknown';
    const countryElement = item.querySelector('.country p');
    if (countryElement) country = countryElement.textContent.trim();

    let imgUrl = '';
    const imgElement = figure.querySelector('img');
    if (imgElement) imgUrl = imgElement.src;

    if (username && !buyers.some(b => b.username === username)) {
      buyers.push({ username, country, imageUrl: imgUrl });
    }
  });

  return buyers;
}