const express = require('express');
const { spawn } = require('child_process');
const path = require('path'); // You had this, it's fine to keep, though not strictly used in the modified part
const app = express();

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
// const COOKIES_FILE_PATH = '/usr/src/app/cookies.txt'; // We are REMOVING THIS LINE - no more direct cookies.txt for yt-dlp

// --- ADD THIS LINE ---
// Get the path to Chromium's memory box from the environment variable we set in the Dockerfile.
// If it's not set for some reason, it defaults to the path we plan to use.
const CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || '/home/node/chromium-profile';

// log every request
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});

app.use(express.json());

// health-check endpoint
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// expose yt-dlp version
app.get('/yt-dlp-version', (_req, res) => {
  const child = spawn(YTDLP_BIN, ['--version'], { stdio: ['ignore','pipe','pipe'] });
  let out = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', err => console.error('[yt-dlp version stderr]', err.toString())); // Added stderr logging here too
  child.on('close', (code) => { // Added exit code logging
    console.log(`[yt-dlp version exit code] ${code}`);
    res.send(out.trim() || 'no output');
  });
});

// download endpoint (yt-dlp for ALL URLs)
app.get('/download', (req, res) => {
  const url = req.query.url;
  console.log('[DOWNLOAD] URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  // yt-dlp always handles both raw and streaming sources
  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    // --- REMOVE THIS LINE ---
    // '--cookies', COOKIES_FILE_PATH, 

    // --- ADD THESE TWO LINES instead of the cookies.txt line ---
    '--cookies-from-browser', 'chromium',            // "yt-dlp, ask the Chromium browser for cookies!"
    `--user-data-dir=${CHROME_USER_DATA_DIR}`,      // "And Chromium's memories are in this specific box."

    // '--verbose', // Optional: Uncomment this later if we need more detailed logs from yt-dlp for debugging

    '--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36', // Your User-Agent was slightly different, made it match our Puppeteer one.
    '-f', format,
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o', '-', // Output to stdout (to pipe to the response)
    url
  ];

  console.log(`[DOWNLOAD] Spawning: ${YTDLP_BIN} ${args.join(' ')}`);
  const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] });

  child.stdout.pipe(res); // Send video data directly to the user

  child.stderr.on('data', d => {
    // Log anything yt-dlp says on its error stream
    console.error('[yt-dlp stderr]', d.toString());
  });

  child.on('error', e => {
    console.error('[yt-dlp spawn error]', e);
    if (!res.headersSent) { // Only send error if we haven't started sending video
      res.status(500).send('Error starting yt-dlp process');
    }
  });

  child.on('close', code => {
    console.log('[yt-dlp exit code]', code);
    if (code !== 0 && !res.headersSent) {
      // If yt-dlp fails and we haven't sent any video data
      res.status(500).send(`yt-dlp failed with exit code ${code}. Check server logs.`);
    } else if (code !== 0) {
      // If it failed after sending some data, the client might get a partial file.
      // The connection will just close.
      console.warn(`[yt-dlp] Exited with code ${code} after streaming some data or headersSent was true.`);
    }
    // If code is 0, it means yt-dlp thinks it finished successfully.
  });
});

// start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
