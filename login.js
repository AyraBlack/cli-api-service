// login.js - Our Little Login Robot for YouTube

const puppeteer = require('puppeteer'); // The tool to control the browser

// Get the path to Chromium's memory box from the Dockerfile's environment variable
const CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR;
const YOUTUBE_URL = 'https://www.youtube.com'; // Main YouTube page
const GOOGLE_LOGIN_URL = 'https://accounts.google.com/signin/v2/identifier'; // Google's login page

// These will come from Coolify's environment variable settings later
const YOUTUBE_EMAIL = process.env.YOUTUBE_EMAIL;
const YOUTUBE_PASSWORD = process.env.YOUTUBE_PASSWORD;

async function tryToLogInToYouTube() {
    console.log('Login Robot: Hello! I will try to make sure Chromium is logged into YouTube.');

    if (!CHROME_USER_DATA_DIR) {
        console.error('Login Robot: Uh oh! I don_t know where Chromium_s memory box is (CHROME_USER_DATA_DIR). Did we set it in the Dockerfile? I have to stop.');
        process.exit(1); // Stop if this critical path isn't set
    }
    console.log(`Login Robot: Chromium's memory box is at: ${CHROME_USER_DATA_DIR}`);

    if (!YOUTUBE_EMAIL || !YOUTUBE_PASSWORD) {
        console.warn('Login Robot: I don_t have a YOUTUBE_EMAIL or YOUTUBE_PASSWORD from the settings.');
        console.warn('Login Robot: I will still open Chromium. If it was logged in before and remembered, that_s great!');
    }

    let browser = null;
    try {
        console.log('Login Robot: Waking up the Chromium browser...');
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1280,720',
                `--user-data-dir=${CHROME_USER_DATA_DIR}`
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        console.log('Login Robot: Going to YouTube.com to see if we are already logged in...');
        await page.goto(YOUTUBE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        const avatarSelector = 'ytd-topbar-menu-button-renderer yt-icon-button#button, yt-img-shadow#avatar[width="32"]';
        const isLoggedIn = await page.$(avatarSelector);

        if (isLoggedIn) {
            console.log('Login Robot: Hooray! It looks like Chromium is ALREADY logged into YouTube in its memory box!');
        } else if (YOUTUBE_EMAIL && YOUTUBE_PASSWORD) {
            console.log('Login Robot: Okay, not logged in. I have an email and password, so I will TRY to log in.');
            console.log('Login Robot: Going to Google_s login page...');
            await page.goto(GOOGLE_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });

            try {
                console.log('Login Robot: Looking for the email input box...');
                await page.waitForSelector('input[type="email"]', { timeout: 15000 });
                console.log('Login Robot: Found email box! Typing your email.');
                await page.type('input[type="email"]', YOUTUBE_EMAIL, { delay: 120 });
                await page.click('#identifierNext button, div#identifierNext');
                console.log('Login Robot: Clicked "Next" after typing email.');
            } catch (e) {
                console.error('Login Robot: Trouble with the email step! Page might be different or Google is suspicious.');
                await page.screenshot({ path: `${CHROME_USER_DATA_DIR}/failure_email_step.png` });
                console.log(`Login Robot: Screenshot saved to ${CHROME_USER_DATA_DIR}/failure_email_step.png`);
                throw e;
            }

            try {
                console.log('Login Robot: Looking for the password input box...');
                await page.waitForSelector('input[type="password"]', { visible: true, timeout: 20000 });
                console.log('Login Robot: Found password box! Typing your password.');
                await page.type('input[type="password"]', YOUTUBE_PASSWORD, { delay: 120 });
                await page.click('#passwordNext button, div#passwordNext');
                console.log('Login Robot: Clicked "Next" after typing password.');
            } catch (e) {
                console.error('Login Robot: Trouble with the password step!');
                await page.screenshot({ path: `${CHROME_USER_DATA_DIR}/failure_password_step.png` });
                console.log(`Login Robot: Screenshot saved to ${CHROME_USER_DATA_DIR}/failure_password_step.png`);
                throw e;
            }

            console.log('Login Robot: Okay, I typed everything. Checking if it worked...');
            try {
                await page.goto(YOUTUBE_URL, { waitUntil: 'networkidle2', timeout: 45000 });
                await page.waitForSelector(avatarSelector, { timeout: 30000 });
                console.log('Login Robot: SUCCESS! I found the avatar on YouTube after trying to log in!');
            } catch (e) {
                console.error('Login Robot: Oh dear. I tried to log in, but I CANNOT confirm it worked. Google might be blocking me or asking for more info (CAPTCHA/2FA).');
                await page.screenshot({ path: `${CHROME_USER_DATA_DIR}/login_final_fail.png` });
                console.log(`Login Robot: Screenshot saved to ${CHROME_USER_DATA_DIR}/login_final_fail.png`);
            }
        } else {
            console.log('Login Robot: Not logged in, and no YOUTUBE_EMAIL/YOUTUBE_PASSWORD was given for me to try.');
        }
        console.log('Login Robot: My attempt to check/login is done. Closing the browser I opened.');
    } catch (error) {
        console.error('Login Robot: Oh no! A big error happened while I was trying to work with the browser!');
        console.error(error.message);
        if (browser && (await browser.pages()).length > 0) {
            const page = (await browser.pages())[0];
            if (page) {
                try {
                    await page.screenshot({ path: `${CHROME_USER_DATA_DIR}/login_BIG_ERROR.png` });
                    console.log(`Login Robot: Screenshot of big error saved to ${CHROME_USER_DATA_DIR}/login_BIG_ERROR.png`);
                } catch (screenshotError) { /* ignore */ }
            }
        }
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

if (require.main === module) {
    console.log("Login Robot: Test mode (running login.js directly).");
    if (!process.env.CHROME_USER_DATA_DIR || !process.env.YOUTUBE_EMAIL || !process.env.YOUTUBE_PASSWORD) {
        console.error("Login Robot Test: For direct testing, set env vars: CHROME_USER_DATA_DIR, YOUTUBE_EMAIL, YOUTUBE_PASSWORD");
        process.exit(1);
    }
    tryToLogInToYouTube().then(() => console.log("Login Robot Test: Finished."))
                       .catch(err => { console.error("Login Robot Test: FAILED:", err); process.exit(1); });
}

module.exports = { tryToLogInToYouTube };
