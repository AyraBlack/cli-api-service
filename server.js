// server.js
const express = require('express');
const { spawn } = require('child_process');
const app = express();

const YTDLP_BIN = '/usr/local/bin/yt-dlp';

// where Puppeteer stored Chromium’s profile
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

  // always let yt-dlp handle everything (it will fallback to plain HTTP if it sees an mp4 URL)
  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    // ask yt-dlp to pull cookies from the Chromium profile we just logged in
    '--cookies-from-browser', `chromium:${CHROME_USER_DATA_DIR}`,

    //--verbose, // uncomment if you want extra debugging from yt-dlp

    '--add-header',
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
     + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',

    '-f', format,
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o', '-', // stream to stdout
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
