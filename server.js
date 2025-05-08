const express = require('express');
const { spawn } = require('child_process');
const ytdl = require('ytdl-core');
const path = require('path');
const app = express();

const YTDLP_BIN = '/usr/local/bin/yt-dlp'; // yt-dlp binary
const COOKIES_FILE_PATH = '/usr/src/app/cookies.txt'; // if still needed for non-YouTube

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
  const child = spawn(YTDLP_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => out += chunk);
  child.stderr.on('data', err => console.error('[yt-dlp version stderr]', err.toString()));
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
    const curlProc = spawn('curl', ['-L', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    curlProc.stdout.pipe(res);
    curlProc.stderr.on('data', d => console.error('[curl stderr]', d.toString()));
    curlProc.on('error', e => console.error('[curl error]', e));
    curlProc.on('close', code => console.log('[curl exit code]', code));
    return;
  }

  // 2) YouTube via ytdl-core
  if (ytdl.validateURL(url)) {
    console.log('[DOWNLOAD] YouTube stream via ytdl-core');
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    return ytdl(url, {
      filter: format => format.container === 'mp4' && format.hasVideo && format.hasAudio,
      quality: 'highestvideo',
      dlChunkSize: 0 // stream fully
    })
    .on('error', err => {
      console.error('[ytdl-core error]', err);
      if (!res.headersSent) res.status(500).send('YouTube download failed');
    })
    .pipe(res);
  }

  // 3) Other sites via yt-dlp
  console.log('[DOWNLOAD] fallback yt-dlp for other URLs');
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

  console.log(`[DOWNLOAD] Spawning yt-dlp with args: ${YTDLP_BIN} ${args.join(' ')}`);
  const child = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(res);
  child.stderr.on('data', d => console.error('[yt-dlp stderr]', d.toString()));
  child.on('error', e => {
    console.error('[yt-dlp spawn error]', e);
    if (!res.headersSent) res.status(500).send('Error during video processing: Could not start yt-dlp.');
  });
  child.on('close', code => console.log('[yt-dlp exit code]', code));
});

// transcode endpoint (optional)
app.post('/transcode', (req, res) => {
  const { inputUrl, args: ffArgs = [] } = req.body;
  console.log('[TRANSCODE] URL:', inputUrl, 'Args:', ffArgs);
  if (!inputUrl) return res.status(400).send('Missing JSON { "inputUrl": "..." }');

  res.setHeader('Content-Type', 'video/mp4');
  const ff = spawn('ffmpeg', ['-i', inputUrl, ...ffArgs, '-f', 'mp4', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  ff.stdout.pipe(res);
  ff.stderr.on('data', d => console.error('[ffmpeg stderr]', d.toString()));
  ff.on('error', e => console.error('[ffmpeg error]', e));
  ff.on('close', code => console.log('[ffmpeg exit code]', code));
});

// start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
