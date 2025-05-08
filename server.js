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

// health endpoint
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// version endpoint
app.get('/yt-dlp-version', (_req, res) => {
  const child = spawn(YTDLP_BIN, ['--version'], { stdio: ['ignore','pipe','pipe'] });
  let out = '';
  child.stdout.on('data', c => out += c);
  child.stderr.on('data', e => console.error('[yt-dlp version stderr]', e.toString()));
  child.on('close', code => {
    console.log('[yt-dlp version exit code]', code);
    res.send(out.trim() || 'no output');
  });
});

// download endpoint
app.get('/download', (req, res) => {
  const url = req.query.url;
  console.log('[DOWNLOAD] URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  // 1) Raw‐file fallback for direct links
  if (/\.(mp4|m4a|mov|avi|mkv)(\?.*)?$/i.test(url)) {
    console.log('[DOWNLOAD] direct HTTP fetch for file:', url);
    res.setHeader('Content-Disposition', 'attachment; filename="' + url.split('/').pop().split('?')[0] + '"');
    const curlProc = spawn('curl', ['-L', url], { stdio: ['ignore','pipe','pipe'] });
    curlProc.stdout.pipe(res);
    curlProc.stderr.on('data', d => console.error('[curl stderr]', d.toString()));
    curlProc.on('error', e => console.error('[curl error]', e));
    curlProc.on('close', code => console.log('[curl exit code]', code));
    return;
  }

  // 2) Everything else via yt-dlp (+ cookies from Chromium, + ffmpeg for MP4)
  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    '--cookies-from-browser', `chromium:${CHROME_USER_DATA_DIR}`,
    '--add-header',
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    '-f', format,
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o', '-',
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
