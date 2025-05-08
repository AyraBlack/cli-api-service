// server.js
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const app = express();

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
// Puppeteer’s Chromium profile dir (from your Docker ENV)
const CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || '/home/node/chromium-profile';

app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

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

app.get('/download', (req, res) => {
  const url = req.query.url;
  console.log('[DOWNLOAD] URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  // ─── RAW‐FILE FALLBACK ───────────────────────────────────────────────────────
  if (/\.(mp4|m4a|mov|avi|mkv)(\?.*)?$/i.test(url)) {
    console.log('[DOWNLOAD] direct HTTP fetch for file:', url);
    // use the original filename (before any querystring) for Content‐Disposition
    const fname = path.basename(url.split('?')[0]);
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    const curl = spawn('curl', ['-L', url], { stdio: ['ignore','pipe','pipe'] });
    curl.stdout.pipe(res);
    curl.stderr.on('data', d => console.error('[curl stderr]', d.toString()));
    curl.on('error', e => {
      console.error('[curl error]', e);
      if (!res.headersSent) res.status(500).send('curl failed');
    });
    return;
  }

  // ─── ALL ELSE → yt-dlp + ffmpeg ─────────────────────────────────────────────
  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    // pull your logged-in cookies from the Puppeteer Chromium profile
    '--cookies-from-browser', `chromium:${CHROME_USER_DATA_DIR}`,

    '--add-header',
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',

    '-f', format,
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o','-',  // stream to stdout
    url
  ];

  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, args.join(' '));
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
