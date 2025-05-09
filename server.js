// server.js - Stream Best Audio Directly to Client via Proxy
// Includes root / and /health endpoints for platform health checks

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const path = require('path'); 

// fs and archiver are not strictly needed for this direct streaming test
// const fs = require('fs').promises; 
const fssync = require('fs'); // For initial directory check if needed
// const archiver = require('archiver'); 

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
const PROXY_URL = process.env.YTDLP_PROXY_URL; 

// Minimal download directory creation, though not used in this direct stream
const DOWNLOAD_DIR = path.join(__dirname, 'downloads'); 
if (!fssync.existsSync(DOWNLOAD_DIR)){
    console.log(`Creating download directory: ${DOWNLOAD_DIR}`);
    try { fssync.mkdirSync(DOWNLOAD_DIR, { recursive: true }); }
    catch (mkdirErr) { console.error(`Error creating download directory ${DOWNLOAD_DIR}:`, mkdirErr); }
}


app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path} Query: ${JSON.stringify(req.query)}`);
  next();
});
app.use(express.json()); 

// --- ADDED ROOT ENDPOINT for Railway health checks ---
app.get('/', (_req, res) => {
  res.status(200).send('API Server is running. Use /health or /stream-audio endpoints.');
});
// --- END ADDED ROOT ENDPOINT ---

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.get('/yt-dlp-version', (_req, res) => {
   try {
    const child = spawn(YTDLP_BIN, ['--version'], { stdio: ['ignore','pipe','pipe'] });
    let out = '';
    let errorOutput = '';
    child.stdout.on('data', c => out += c);
    child.stderr.on('data', e => errorOutput += e.toString()); 
    child.on('error', (spawnError) => { 
         console.error('[yt-dlp version spawn error]', spawnError);
         if (!res.headersSent) {
             res.status(500).send(`Failed to run yt-dlp version check: ${spawnError.message}`);
         }
    });
    child.on('close', code => {
      console.log('[yt-dlp version exit code]', code);
      if (code !== 0 && !res.headersSent) {
         res.status(500).send(`yt-dlp version check failed with code ${code}. Stderr: ${errorOutput}`);
      } else if (!res.headersSent) {
         res.send(out.trim() || 'no output');
      }
    });
  } catch (e) {
      console.error('[yt-dlp version critical error]', e);
      if (!res.headersSent) {
           res.status(500).send(`Server error during version check: ${e.message}`);
      }
  }
});

// Endpoint to Stream Audio Directly
app.get('/stream-audio', (req, res) => {
  const url = req.query.url;
  const suggestedExt = req.query.format || 'webm'; 

  console.log(`[STREAM AUDIO] Request received - URL: ${url}`);
  if (!url) { 
    console.log('[STREAM AUDIO] Error: Missing URL parameter.');
    return res.status(400).send('Missing query parameter: url'); 
  }
  try { new URL(url); } catch (e) { 
    console.log(`[STREAM AUDIO] Error: Invalid URL format: ${url}`);
    return res.status(400).send('Invalid URL format provided.'); 
  }
  
  if (!PROXY_URL) {
      console.error('[STREAM AUDIO] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[STREAM AUDIO] Using proxy configured via environment variable.');

  const args = [
    '--proxy', PROXY_URL, 
    '-f', 'bestaudio/best', 
    '-o', '-', 
    // '--no-warnings', // Let's see warnings for this test
    // '--ignore-errors', // REMOVED - let errors propagate
    '--force-overwrites', 
    '--no-cache-dir',     
    '--verbose', 
    url
  ];

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[STREAM AUDIO] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let contentType = 'application/octet-stream'; 
      if (suggestedExt === 'webm') contentType = 'audio/webm';
      else if (suggestedExt === 'm4a') contentType = 'audio/mp4';
      else if (suggestedExt === 'mp3') contentType = 'audio/mpeg'; 

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="downloaded_audio.${suggestedExt}"`); 

      child.stdout.pipe(res);

      let stderrOutput = ''; 
      child.stderr.on('data', (data) => {
        const line = data.toString(); 
        console.error('[yt-dlp stderr - stream]', line.trim()); 
        stderrOutput += line; 
      });

      child.on('error', (err) => { 
          console.error('[yt-dlp spawn error - stream]', err);
          if (!res.headersSent) { res.status(500).send(`Failed to start yt-dlp process: ${err.message}`); }
          else { res.end(); } 
      });

      child.on('close', (code) => { 
        console.log(`[yt-dlp exit code for stream] ${code}`);
        if (code !== 0) { 
            console.error(`[STREAM AUDIO] yt-dlp stream failed for URL: ${url} (exit code ${code})`);
            if (!res.headersSent) { 
                 if (stderrOutput.includes('proxy') || stderrOutput.includes('Unsupported proxy type') || stderrOutput.includes('timed out')) {
                     res.status(502).send(`Proxy error occurred during stream.\n\nStderr:\n${stderrOutput}`);
                 } else {
                     res.status(500).send(`yt-dlp stream process exited with error code ${code}.\n\nStderr:\n${stderrOutput}`); 
                 }
            } else {
                console.log('[STREAM AUDIO] yt-dlp exited with error after stream started. Ending response.');
                res.end();
            }
        } else {
            console.log(`[STREAM AUDIO] yt-dlp stream finished successfully for URL: ${url}. Response should have ended.`);
        }
      }); 

  } catch (e) { 
       console.error('[STREAM AUDIO] Critical error before spawning yt-dlp:', e);
       if (!res.headersSent) {
            res.status(500).send(`Server error before running stream: ${e.message}`);
       }
  }
}); 

const port = process.env.PORT || 3000; 
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
