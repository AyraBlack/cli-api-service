// server.js - Modified for Audio & Auto-Subtitles

const express = require('express');
const { spawn } = require('child_process');
const app = express();

// Assuming fs and path might be needed later if we serve files
const fs = require('fs'); 
const path = require('path');

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
// Define where downloads should go (relative to server.js location)
const DOWNLOAD_DIR = path.join(__dirname, 'downloads'); 
// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)){
    console.log(`Creating download directory: ${DOWNLOAD_DIR}`);
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}


app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// REMOVED TEMPORARY /get-debug-screenshot endpoint for clarity
// You can add it back if needed for debugging login.js later

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

// Modified Download Endpoint for Audio & Subtitles
app.get('/download', (req, res) => {
  const url = req.query.url;
  const lang = req.query.lang || 'en'; // Default subtitle language to English
  const audioFormat = req.query.audioformat || 'mp3'; // Default audio format

  console.log(`[DOWNLOAD] URL: ${url}, Lang: ${lang}, AudioFormat: ${audioFormat}`);
  if (!url) {
    return res.status(400).send('Missing query parameter: url');
  }

  // Define output template using the video ID and placing in DOWNLOAD_DIR
  // Example: downloads/dQw4w9WgXcQ.mp3, downloads/dQw4w9WgXcQ.en.vtt
  const outputTemplate = path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s');

  const args = [
    // --- Cookie Argument (Important!) ---
    '--cookies', '/usr/src/app/cookies.txt', // Use the manually provided cookie file

    // --- Audio Arguments ---
    '-f', 'bestaudio',            // Select best audio stream
    '--extract-audio',            // Extract audio track
    '--audio-format', audioFormat,// Convert to specified format (requires ffmpeg)
    '--audio-quality', '0',        // Optional: Set audio quality (0=best for variable bitrate)

    // --- Subtitle Arguments ---
    '--write-auto-subs',          // Download auto-generated subtitles
    '--sub-lang', lang,           // Specify subtitle language
    // '--convert-subs', 'srt',   // Optional: Convert subtitle format (e.g., to srt)

    // --- Output Arguments ---
    '-o', outputTemplate,         // Define output filename template and location

    // --- Other Options ---
    '--no-warnings',              // Optional: Suppress warnings like the ffmpeg args one
    '--ignore-errors',            // Optional: Continue on download errors (e.g., if subs don't exist)
    
    // --- URL Argument ---
    url                           // The video URL to download
  ];

  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, args.join(' '));
  const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); // Keep stderr piped

  let stderrOutput = ''; // Collect stderr output
  child.stderr.on('data', (data) => {
    const line = data.toString();
    console.error('[yt-dlp stderr]', line.trim());
    stderrOutput += line; // Append to collected stderr
  });

  child.on('error', (err) => {
    console.error('[yt-dlp spawn error]', err);
    // Send error response only if headers haven't already been sent
    if (!res.headersSent) {
      res.status(500).json({ 
          success: false, 
          message: 'Failed to start yt-dlp process.',
          error: err.message 
      });
    }
  });

  child.on('close', (code) => {
    console.log('[yt-dlp exit code]', code);
    // Send response only if headers haven't already been sent
    if (!res.headersSent) {
      if (code === 0) {
        // Success! Respond with info about expected files
        // Note: yt-dlp might exit 0 even if subs weren't found if --ignore-errors is used
        console.log(`[DOWNLOAD] Success for URL: ${url}. Check ${DOWNLOAD_DIR} for files.`);
        res.status(200).json({ 
            success: true, 
            message: `Download process completed successfully (exit code ${code}). Check server directory for files.`,
            // You might want to parse the outputTemplate to predict filenames, 
            // but yt-dlp determines the actual extensions.
            // Example prediction (might be inaccurate):
            // expectedAudioFile: `${videoId}.${audioFormat}`, 
            // expectedSubsFile: `${videoId}.${lang}.vtt` 
            downloadDir: DOWNLOAD_DIR // Inform client where files are relative to the server app
        });
      } else {
        // Failure
        console.error(`[DOWNLOAD] Failed for URL: ${url} (exit code ${code})`);
        res.status(500).json({ 
            success: false, 
            message: `yt-dlp process exited with error code ${code}.`,
            stderr: stderrOutput // Include stderr for debugging
        });
      }
    }
  });

  // DO NOT pipe stdout to res anymore, as we expect files, not a stream
  // child.stdout.pipe(res); 
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
