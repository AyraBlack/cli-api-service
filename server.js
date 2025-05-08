const express = require('express');
const { spawn } = require('child_process');
const app = express();
app.use(express.json());

// log every request to see what hits the server
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});


// 1) Download with yt-dlp
app.get('/download', (req, res) => {
  const YTDLP = '/usr/local/bin/yt-dlp'; // absolute path to yt-dlp

app.get('/download', (req, res) => {
  const url = req.query.url;
  console.log('[DOWNLOAD] requested URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  const format = req.query.format
    || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  console.log('[DOWNLOAD] using format:', format);

  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const child = require('child_process').spawn(
    YTDLP,
    ['-f', format, '-o', '-', url],
    { stdio: ['ignore','pipe','pipe'] }
  );

  child.stdout.pipe(res);
  child.stderr.on('data', data => console.error('[yt-dlp stderr]', data.toString()));
  child.on('error', err => console.error('[yt-dlp spawn error]', err));
  child.on('close', code => console.log('[yt-dlp exit code]', code));
});


// 2) Render a webpage to PDF
app.post('/render-pdf', async (req, res) => {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const url = req.body.url;
  if (!url) { await browser.close(); return res.status(400).send('Missing JSON { "url": "..." }'); }
  await page.goto(url, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  res.contentType('application/pdf').send(pdf);
});

// 3) Transcode with FFmpeg
app.post('/transcode', (req, res) => {
  const { inputUrl, args = [] } = req.body;
  if (!inputUrl) return res.status(400).send('Missing JSON { "inputUrl": "..." }');
  res.setHeader('Content-Type', 'video/mp4');
  spawn('ffmpeg', ['-i', inputUrl, ...args, 'pipe:1'])
    .stdout.pipe(res)
    .on('error', err => res.status(500).send(err.toString()));
});

// … all your other routes …

// health-check endpoint for Coolify
// expose yt-dlp version
app.get('/yt-dlp-version', (_req, res) => {
  const { spawn } = require('child_process');
  const child = spawn('yt-dlp', ['--version']);
  let out = '';
  child.stdout.on('data', chunk => out += chunk);
  child.on('close', () => res.send(out || 'no output'));
});
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));


