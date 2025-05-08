const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const app = express();

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
const COOKIES_FILE_PATH = '/usr/src/app/cookies.txt';

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
  child.on('close', () => res.send(out.trim() || 'no output'));
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
    '--cookies', COOKIES_FILE_PATH,
    '--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    '-f', format,
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o', '-',
    url
  ];

  console.log(`[DOWNLOAD] Spawning: ${YTDLP_BIN} ${args.join(' ')}`);
  const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] });
  child.stdout.pipe(res);
  child.stderr.on('data', d => console.error('[yt-dlp stderr]', d.toString()));
  child.on('error', e => {
    console.error('[yt-dlp spawn error]', e);
    if (!res.headersSent) res.status(500).send('Error starting yt-dlp');
  });
  child.on('close', code => console.log('[yt-dlp exit code]', code));
});

// start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
