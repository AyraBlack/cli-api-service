const express = require('express');
const { spawn } = require('child_process');
const ytdl = require('ytdl-core');
const path = require('path');
const app = express();

const YTDLP_BIN = '/usr/local/bin/yt-dlp';

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

// download endpoint
app.get('/download', async (req, res) => {
  const url = req.query.url;
  console.log('[DOWNLOAD] URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  // 1) Raw-file fallback
  if (/\.(mp4|m4a|mov|avi|mkv)(\?.*)?$/i.test(url)) {
    console.log('[DOWNLOAD] direct HTTP fetch for file:', url);
    const curlProc = spawn('curl', ['-L', url], { stdio: ['ignore','pipe','pipe'] });
    curlProc.stdout.pipe(res);
    curlProc.stderr.on('data', d => console.error('[curl stderr]', d.toString()));
    return;
  }

  // 2) YouTube via ytdl-core with User-Agent override
  if (ytdl.validateURL(url)) {
    console.log('[DOWNLOAD] YouTube stream via ytdl-core');
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    return ytdl(url, {
      filter: f => f.container === 'mp4' && f.hasVideo && f.hasAudio,
      quality: 'highestvideo',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            + 'AppleWebKit/537.36 (KHTML, like Gecko) '
            + 'Chrome/115.0.0.0 Safari/537.36'
        }
      }
    })
    .on('error', err => {
      console.error('[ytdl-core error]', err);
      if (!res.headersSent) res.status(500).send('YouTube download failed');
    })
    .pipe(res);
  }

  // 3) Other sites via yt-dlp
  console.log('[DOWNLOAD] fallback yt-dlp');
  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    '--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    '-f', format,
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o', '-',
    url
  ];

  const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] });
  child.stdout.pipe(res);
  child.stderr.on('data', d => console.error('[yt-dlp stderr]', d.toString()));
  child.on('error', e => console.error('[yt-dlp spawn error]', e));
  child.on('close', code => console.log('[yt-dlp exit code]', code));
});

// start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
