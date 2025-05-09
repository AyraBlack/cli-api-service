// server.js - Proxy Method - Basic Video Download Test (Default Format)

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const fs = require('fs').promises; 
const fssync = require('fs'); 
const path = require('path');
// Archiver not needed for this test
// const archiver = require('archiver'); 

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
const DOWNLOAD_DIR = path.join(__dirname, 'downloads'); 
const PROXY_URL = process.env.YTDLP_PROXY_URL; 

// Ensure download directory exists
if (!fssync.existsSync(DOWNLOAD_DIR)){
    console.log(`Creating download directory: ${DOWNLOAD_DIR}`);
    try {
        fssync.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    } catch (mkdirErr) {
        console.error(`FATAL: Could not create download directory ${DOWNLOAD_DIR}:`, mkdirErr);
        process.exit(1); 
    }
}

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path} Query: ${JSON.stringify(req.query)}`);
  next();
});
app.use(express.json()); 

app.get('/', (_req, res) => {
  res.status(200).send('API Server is running. Use /health, /yt-dlp-version, or /download endpoints.');
});

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

// Basic Download Endpoint - Default best format (video+audio)
app.get('/download', (req, res) => {
  const url = req.query.url;

  console.log(`[BASIC DOWNLOAD TEST] Request received - URL: ${url}`);
  if (!url) { return res.status(400).send('Missing query parameter: url'); }
  try { new URL(url); } catch (e) { return res.status(400).send('Invalid URL format provided.'); }
  
  if (!PROXY_URL) {
      console.error('[DOWNLOAD] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[DOWNLOAD] Using proxy configured via environment variable.');

  const outputTemplate = path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s'); 
  let videoId = ''; 

  // --- VERY BASIC yt-dlp ARGUMENTS ---
  const args = [
    '--proxy', PROXY_URL, 
    // NO -f (let yt-dlp choose default best video+audio format)
    // NO --extract-audio
    // NO --audio-format
    // NO --write-auto-subs
    '-o', outputTemplate, // Save directly to downloads dir
    // NO --no-warnings
    // NO --ignore-errors
    '--force-overwrites', 
    '--no-cache-dir',     
    '--print', 'id',        // Print video ID
    '--print', 'filename',  // Print the final filename it saves
    '--print', 'traffic',   // Print downloaded bytes
    '--verbose',            // Maximum debug output
    url
  ];
  // --- END BASIC ARGUMENTS ---

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = ''; 
      let stdoutOutput = ''; // Capture ID, filename, and traffic

      child.stdout.on('data', (data) => {
          const dataStr = data.toString().trim();
          console.log(`[yt-dlp stdout] ${dataStr}`); 
          stdoutOutput += dataStr + '\n'; 
      });
      child.stderr.on('data', (data) => {
        const line = data.toString(); 
        console.error('[yt-dlp stderr]', line.trim()); // Log ALL stderr
        stderrOutput += line; 
      });

      child.on('error', (err) => { 
          console.error('[yt-dlp spawn error]', err);
          if (!res.headersSent) { res.status(500).send(`Failed to start yt-dlp process: ${err.message}`); }
      });

      child.on('close', async (code) => { 
        console.log(`[yt-dlp exit code] ${code}`);
        
        // Extract info from stdout
        const stdoutLines = stdoutOutput.trim().split('\n');
        const trafficLine = stdoutLines.pop() || 'NA'; 
        const intendedFilenameFull = stdoutLines.pop() || ''; 
        videoId = stdoutLines.pop() || ''; 
        
        if (!videoId) {
             try {
                 const urlObj = new URL(url);
                 if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
                     videoId = urlObj.searchParams.get('v') || urlObj.pathname.split('/').pop();
                 }
            } catch (e) { /* ignore */ }
            videoId = videoId || 'unknown_video'; 
            console.warn(`[DOWNLOAD] Could not get video ID via --print id, using fallback: ${videoId}`);
        } else {
            console.log(`[DOWNLOAD] Determined Video ID: ${videoId}`);
        }
        console.log(`[DOWNLOAD] yt-dlp intended to save as: ${intendedFilenameFull || '???'}`);
        console.log(`[DOWNLOAD] yt-dlp reported traffic: ${trafficLine}`);

        // List directory contents AFTER yt-dlp finishes
        let filesInDir = [];
        let fileExists = false;
        let actualFilePath = intendedFilenameFull ? path.join(DOWNLOAD_DIR, path.basename(intendedFilenameFull)) : null;

        try {
            filesInDir = await fs.readdir(DOWNLOAD_DIR); 
            console.log(`[DEBUG] Files found in ${DOWNLOAD_DIR} after yt-dlp exit: [${filesInDir.join(', ')}]`);
            if(actualFilePath) {
               fileExists = filesInDir.includes(path.basename(actualFilePath)); 
            }
        } catch (readErr) {
            console.error(`[DEBUG] Error listing files in ${DOWNLOAD_DIR}:`, readErr);
        }
       
        // Check exit code - non-zero IS an error
        if (code !== 0) { 
            console.error(`[DOWNLOAD] yt-dlp failed for URL: ${url} (exit code ${code})`);
            if (!res.headersSent) { 
                 if (stderrOutput.includes('proxy') || stderrOutput.includes('Unsupported proxy type') || stderrOutput.includes('timed out')) {
                     res.status(502).send(`Proxy error occurred.\n\nStderr:\n${stderrOutput}`);
                 } else {
                     res.status(500).send(`yt-dlp process exited with error code ${code}.\n\nStderr:\n${stderrOutput}`); 
                 }
            }
        } else {
            // Exit code was 0, check if the file actually exists
            if (fileExists && actualFilePath) {
                console.log(`[DOWNLOAD] Success! File ${actualFilePath} created.`);
                 if (!res.headersSent) { 
                     res.status(200).json({ success: true, message: `Download successful. File saved on server: ${actualFilePath}` });
                 }
            } else {
                 console.error(`[DOWNLOAD] yt-dlp exited successfully (code 0) but file not found: ${actualFilePath || 'intended filename unknown'}`);
                 if (!res.headersSent) { 
                     res.status(500).send(`yt-dlp exited successfully but the expected file was not found. Traffic: ${trafficLine}. Check logs. Stderr:\n${stderrOutput}`);
                 }
            }
        }
      }); // End of child.on('close')

  } catch (e) { 
       console.error('[DOWNLOAD] Critical error before spawning yt-dlp:', e);
       if (!res.headersSent) {
            res.status(500).send(`Server error before running download: ${e.message}`);
       }
  }
}); // End of app.get('/download')

// --- Start the Server ---
const port = process.env.PORT || 3000; // Railway will set PORT
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
