const express = require('express');
const { spawn } = require('child_process');
const app = express();

const YTDLP_BIN    = '/usr/local/bin/yt-dlp'; // yt-dlp binary
const COOKIE_FILE  = 'cookies.txt';           // must be present in /usr/src/app

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
  child.stdout.on('data', c => out += c);
  child.stderr.on('data', e => console.error('[yt-dlp version stderr]', e.toString()));
  child.on('close', () => res.send(out.trim() || 'no output'));
});

// download endpoint (raw-file fallback & yt-dlp with cookies + ffmpeg)
app.get('/download', (req, res) => {
  const url = req.query.url;
  console.log('[DOWNLOAD] URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  // 1) Raw-file fallback
  if (/\.(mp4|m4a|mov|avi|mkv)(\?.*)?$/i.test(url)) {
    console.log('[DOWNLOAD] direct HTTP fetch for file:', url);
    const curlProc = spawn('curl', ['-L', url], { stdio: ['ignore','pipe','pipe'] });
    curlProc.stdout.pipe(res);
    curlProc.stderr.on('data', d => console.error('[curl stderr]', d.toString()));
    curlProc.on('error', e => console.error('[curl error]', e));
    curlProc.on('close', code => console.log('[curl exit code]', code));
    return;
  }

  // 2) YouTube & others via yt-dlp + ffmpeg for QuickTime
  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  console.log('[DOWNLOAD] yt-dlp format:', format);

  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    '--cookies', COOKIE_FILE,
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

// transcode endpoint (optional)
app.post('/transcode', (req, res) => {
  const { inputUrl, args = [] } = req.body;
  console.log('[TRANSCODE] URL:', inputUrl, 'Args:', args);
  if (!inputUrl) return res.status(400).send('Missing JSON { "inputUrl": "..." }');

  res.setHeader('Content-Type', 'video/mp4');
  const ff = spawn('ffmpeg', ['-i', inputUrl, ...args, '-f', 'mp4', 'pipe:1'], { stdio: ['ignore','pipe','pipe'] });
  ff.stdout.pipe(res);
  ff.stderr.on('data', d => console.error('[ffmpeg stderr]', d.toString()));
  ff.on('error', e => console.error('[ffmpeg error]', e));
  ff.on('close', code => console.log('[ffmpeg exit code]', code));
});

// start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
