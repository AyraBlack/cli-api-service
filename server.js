const express = require('express');
const { spawn } = require('child_process');
const app = express();

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
// Chromium user data dir comes from the Docker ENV we set
const CHROME_USER_DATA_DIR = process.env.CHROME_USER_DATA_DIR || '/home/node/chromium-profile';

// Log every request
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});

app.use(express.json());

// Health-check endpoint
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Expose yt-dlp version
app.get('/yt-dlp-version', (_req, res) => {
  const child = spawn(YTDLP_BIN, ['--version'], { stdio: ['ignore','pipe','pipe'] });
  let out = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', err => console.error('[yt-dlp version stderr]', err.toString()));
  child.on('close', code => {
    console.log(`[yt-dlp version exit code] ${code}`);
    res.send(out.trim() || 'no output');
  });
});

// Download endpoint (yt-dlp handling all URLs)
app.get('/download', (req, res) => {
  const url = req.query.url;
  console.log('[DOWNLOAD] URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    '--cookies-from-browser', 'chromium',
    `--user-data-dir=${CHROME_USER_DATA_DIR}`,
    '--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  + 'AppleWebKit/537.36 (KHTML, like Gecko) '
                  + 'Chrome/115.0.0.0 Safari/537.36',
    '-f', format,
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o', '-',
    url
  ];

  console.log(`[DOWNLOAD] Spawning: ${YTDLP_BIN} ${args.join(' ')}`);
  const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] });

  // Pipe video data straight to the response
  child.stdout.pipe(res);

  // Log any yt-dlp stderr messages
  child.stderr.on('data', d => console.error('[yt-dlp stderr]', d.toString()));

  child.on('error', e => {
    console.error('[yt-dlp spawn error]', e);
    if (!res.headersSent) {
      res.status(500).send('Error starting yt-dlp process');
    }
  });

  child.on('close', code => {
    console.log('[yt-dlp exit code]', code);
    if (code !== 0 && !res.headersSent) {
      res.status(500).send(`yt-dlp failed with exit code ${code}. Check server logs.`);
    } else if (code !== 0) {
      console.warn(`[yt-dlp] Exited with code ${code} after streaming data or headersSent was true.`);
    }
  });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
