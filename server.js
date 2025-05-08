// server.js
const express = require('express');
const { spawn } = require('child_process');
const app = express();

// Ensure these are at the top
const fs = require('fs');
const path = require('path');

const YTDLP_BIN = '/usr/local/bin/yt-dlp';

app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// ++++++++++++++++ MODIFIED TEMPORARY ENDPOINT ++++++++++++++++
app.get('/get-debug-screenshot', (req, res) => {
  const fileName = req.query.name; // Get filename from query parameter
  if (!fileName || !fileName.endsWith('.png')) {
    return res.status(400).send('Please provide a valid .png filename in the ?name= parameter.');
  }

  // Assumes server.js is in /usr/src/app, so screenshots are in the same directory
  const filePath = path.join(__dirname, fileName); 
  console.log('[DEBUG] Attempting to send screenshot:', filePath);

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('[DEBUG] Error sending screenshot:', err);
        if (!res.headersSent) {
          res.status(500).send('Error sending screenshot file.');
        }
      } else {
        console.log('[DEBUG] Screenshot sent successfully:', fileName);
      }
    });
  } else {
    console.log('[DEBUG] Screenshot NOT FOUND at path:', filePath);
    res.status(404).send(`Screenshot file '${fileName}' not found.`);
  }
});
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

app.get('/yt-dlp-version', (_req, res) => {
  // ... (your yt-dlp-version code) ...
  const child = spawn(YTDLP_BIN, ['--version'], { stdio: ['ignore','pipe','pipe'] });
  let out = '';
  child.stdout.on('data', c => out += c);
  child.stderr.on('data', e => console.error('[yt-dlp version stderr]', e.toString()));
  child.on('close', code => {
    console.log('[yt-dlp version exit code]', code);
    res.send(out.trim() || 'no output');
  });
});

app.get('/download', (req, res) => {
  // ... (your download code) ...
  const url = req.query.url;
  console.log('[DOWNLOAD] URL:', url);
  if (!url) return res.status(400).send('Missing ?url=');

  const format = req.query.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4';
  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

  const args = [
    '--cookies', '/usr/src/app/cookies.txt',
    '-f', format,
    '--add-header',
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
     + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    '--external-downloader', 'ffmpeg',
    '--external-downloader-args', '-c:v libx264 -c:a aac -movflags +faststart',
    '-o', '-',
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
