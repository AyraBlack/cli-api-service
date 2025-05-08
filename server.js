// server.js - Proxy Method - Simplest possible download test

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const fs = require('fs').promises; 
const fssync = require('fs'); 
const path = require('path');
// Archiver not needed for this simple test
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

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.get('/yt-dlp-version', (_req, res) => {
  // ... (yt-dlp-version code remains the same) ...
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

// Simple Download Endpoint - Just Best Audio, No Extraction/Subs/Zip
app.get('/download', (req, res) => {
  const url = req.query.url;

  console.log(`[SIMPLE DOWNLOAD] Request received - URL: ${url}`);
  if (!url) { return res.status(400).send('Missing query parameter: url'); }
  try { new URL(url); } catch (e) { return res.status(400).send('Invalid URL format provided.'); }
  if (!PROXY_URL) {
      console.error('[DOWNLOAD] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[DOWNLOAD] Using proxy configured via environment variable.');

  // Output directly into the downloads folder
  const outputTemplate = path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s');
  
  // --- SIMPLIFIED ARGUMENTS ---
  const args = [
    '--proxy', PROXY_URL, 
    '-f', 'bestaudio/best', // Select best audio format
    // NO --extract-audio
    // NO --audio-format
    // NO --write-auto-subs
    '-o', outputTemplate, // Save directly
    '--no-warnings', 
    // '--ignore-errors', // REMOVED - let's see if it errors now
    '--print', 'filename', // Print the final filename it *would* save
    '--verbose', // Keep verbose logging
    url
  ];
  // --- END SIMPLIFIED ARGUMENTS ---

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = ''; 
      let stdoutOutput = ''; // Capture filename printed by yt-dlp

      child.stdout.on('data', (data) => {
          const dataStr = data.toString().trim();
          console.log(`[yt-dlp stdout] ${dataStr}`); 
          stdoutOutput += dataStr + '\n'; // Append lines
      });
      child.stderr.on('data', (data) => {
        const line = data.toString(); 
        console.error('[yt-dlp stderr]', line.trim()); 
        stderrOutput += line; 
      });

      child.on('error', (err) => { 
          console.error('[yt-dlp spawn error]', err);
          if (!res.headersSent) { res.status(500).send(`Failed to start yt-dlp process: ${err.message}`); }
      });

      child.on('close', async (code) => { 
        console.log(`[yt-dlp exit code] ${code}`);
        
        // Get the filename yt-dlp intended to use from stdout
        const intendedFilename = stdoutOutput.trim().split('\n').pop(); // Get last line of stdout
        console.log(`[DOWNLOAD] yt-dlp intended to save: ${intendedFilename || '???'}`);

        // List directory contents AFTER yt-dlp finishes
        let filesInDir = [];
        try {
            filesInDir = await fs.readdir(DOWNLOAD_DIR);
            console.log(`[DEBUG] Files found in ${DOWNLOAD_DIR} after yt-dlp exit: [${filesInDir.join(', ')}]`);
        } catch (readErr) {
            console.error(`[DEBUG] Error listing files in ${DOWNLOAD_DIR}:`, readErr);
        }
       
        // Check exit code
        if (code !== 0) { 
            console.error(`[DOWNLOAD] yt-dlp failed for URL: ${url} (exit code ${code})`);
            if (!res.headersSent) { 
                // Send specific error for proxy issues
                 if (stderrOutput.includes('proxy') || stderrOutput.includes('Unsupported proxy type') || stderrOutput.includes('timed out')) {
                     res.status(502).send(`Proxy error occurred.\n\nStderr:\n${stderrOutput}`);
                 } else {
                     res.status(500).send(`yt-dlp process exited with error code ${code}.\n\nStderr:\n${stderrOutput}`); 
                 }
            }
        } else {
            // Exit code was 0, check if the intended file actually exists
            if (intendedFilename && filesInDir.includes(path.basename(intendedFilename))) {
                console.log(`[DOWNLOAD] Success! File ${intendedFilename} created.`);
                 if (!res.headersSent) { 
                     res.status(200).json({ success: true, message: `Download successful. File saved on server: ${intendedFilename}` });
                 }
            } else {
                 console.error(`[DOWNLOAD] yt-dlp exited successfully but file not found: ${intendedFilename || 'intended filename unknown'}`);
                 if (!res.headersSent) { 
                     res.status(500).send(`yt-dlp exited successfully but the expected file was not found. Check logs. Stderr:\n${stderrOutput}`);
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
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
