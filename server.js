// server.js
const express = require('express');
const { spawn } = require('child_process');
const app = express();

const YTDLP_BIN = '/usr/local/bin/yt-dlp';

// where Puppeteer stored Chromium’s profile
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
  child.stdout.on('data', chunk => out += chunk);
  child.stderr.on('data', err => console.error('[yt-dlp version stderr]', err.toString()));
  child.on('close', code => {
    console.log('[yt-dlp version exit code]', code);
    res.send(out.trim() || 'no output');
  });
});

// download endpoint — everything via yt-dlp now
app.get('/download', (req, res) => {
  const url = req.query.url;
  console.log('[DOWNLOAD] URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  // tell yt-dlp to pick the best MP4+M4A combo (or fallback itself)
  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    // pull logged-in cookies from our Puppeteer profile
    '--cookies-from-browser', `chromium:${CHROME_USER_DATA_DIR}`,

    // spoof a modern Chrome UA
    '--add-header',
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',

    '-f', format,
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o', '-',    // stream output to stdout
    url
  ];

  console.log('[DOWNLOAD] Spawning yt-dlp:', YTDLP_BIN, args.join(' '));
  const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] });

  child.stdout.pipe(res);
  child.stderr.on('data', d => console.error('[yt-dlp stderr]', d.toString()));

  child.on('error', err => {
    console.error('[yt-dlp spawn error]', err);
    if (!res.headersSent) res.status(500).send('Failed to start yt-dlp');
  });

  child.on('close', code => {
    console.log('[yt-dlp exit code]', code);
    if (code !== 0 && !res.headersSent) {
      res.status(500).send(`yt-dlp exited with ${code}. Check logs.`);
    }
  });
});

// start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
