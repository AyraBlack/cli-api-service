// login.js - Our Little Login Robot for YouTube

const puppeteer = require('puppeteer');

// Path to Chromium's profile, set via Docker ENV\ nconst CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR;
const YOUTUBE_URL      = 'https://www.youtube.com';
const GOOGLE_LOGIN_URL = 'https://accounts.google.com/signin/v2/identifier';

const YOUTUBE_EMAIL    = process.env.YOUTUBE_EMAIL;
const YOUTUBE_PASSWORD = process.env.YOUTUBE_PASSWORD;

async function tryToLogInToYouTube() {
  console.log('Login Robot: Hello! I will ensure Chromium is logged into YouTube.');

  if (!CHROME_USER_DATA_DIR) {
    console.error('Login Robot: Missing CHROME_USER_DATA_DIR. Check Docker ENV.');
    return;
  }
  console.log(`Login Robot: Chromium profile at ${CHROME_USER_DATA_DIR}`);

  // If no credentials, just warm up the profile and exit.
  if (!YOUTUBE_EMAIL || !YOUTUBE_PASSWORD) {
    console.warn('Login Robot: No YOUTUBE_EMAIL/YOUTUBE_PASSWORD set. Skipping login flow.');
    return;
  }

  let browser;
  try {
    console.log('Login Robot: Launching Chromium headless...');
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        `--user-data-dir=${CHROME_USER_DATA_DIR}`
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/115.0.0.0 Safari/537.36'
    );

    console.log('Login Robot: Navigating to YouTube...');
    await page.goto(YOUTUBE_URL, { waitUntil: 'networkidle2' });

    // Check for presence of "Sign in" button to detect logged-out state
    const signInSelector = 'ytd-button-renderer.style-scope.ytd-masthead.style-suggestive';
    const buttons = await page.$$eval(signInSelector, els => els.map(el => el.textContent.trim()));
    const signedOut = buttons.includes('Sign in');

    if (!signedOut) {
      console.log('Login Robot: Already signed in.');
      return;
    }

    console.log('Login Robot: Not signed in. Starting login flow...');
    await page.goto(GOOGLE_LOGIN_URL, { waitUntil: 'networkidle2' });

    // Email step
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.type('input[type="email"]', YOUTUBE_EMAIL, { delay: 100 });
    await page.click('#identifierNext');

    // Password step
    await page.waitForSelector('input[type="password"]', { visible: true, timeout: 20000 });
    await page.type('input[type="password"]', YOUTUBE_PASSWORD, { delay: 100 });
    await page.click('#passwordNext');

    // Final check
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 });
    const postButtons = await page.$$eval(signInSelector, els => els.map(el => el.textContent.trim()));
    const stillSignedOut = postButtons.includes('Sign in');

    if (stillSignedOut) {
      console.error('Login Robot: Login may have failed (still saw "Sign in").');
    } else {
      console.log('Login Robot: Login SUCCESS!');
    }
  } catch (err) {
    console.error('Login Robot: Error during login flow:', err);
  } finally {
    if (browser) await browser.close();
    console.log('Login Robot: Done.');
  }
}

if (require.main === module) {
  console.log('Login Robot: Running standalone test mode...');
  tryToLogInToYouTube()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { tryToLogInToYouTube };
