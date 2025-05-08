// server.js - Proxy Method - Simplest possible download test v2
// - Save to current dir with fixed name
// - Print traffic size

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const fs = require('fs').promises; 
const fssync = require('fs'); 
const path = require('path');
// Archiver not needed for this simple test
// const archiver = require('archiver'); 

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
// Saving directly to current directory for this test
const PROXY_URL = process.env.YTDLP_PROXY_URL; 

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

// Simple Download Endpoint v2 - Just Best Audio, Save to current dir as test_audio.ext
app.get('/download', (req, res) => {
  const url = req.query.url;

  console.log(`[SIMPLE DOWNLOAD TEST v2] Request received - URL: ${url}`);
  if (!url) { return res.status(400).send('Missing query parameter: url'); }
  try { new URL(url); } catch (e) { return res.status(400).send('Invalid URL format provided.'); }
  if (!PROXY_URL) {
      console.error('[DOWNLOAD] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[DOWNLOAD] Using proxy configured via environment variable.');

  // --- MODIFIED: Output to current directory with fixed name ---
  const outputTemplate = 'test_audio.%(ext)s'; // Save directly in /usr/src/app
  const expectedFilename = 'test_audio.webm'; // Since format 251 is webm

  // --- MODIFIED ARGUMENTS ---
  const args = [
    '--proxy', PROXY_URL, 
    '-f', 'bestaudio/best', // Select best audio format
    // NO --extract-audio
    // NO --audio-format
    // NO --write-auto-subs
    '-o', outputTemplate, // Save directly with fixed name
    '--no-warnings', 
    // '--ignore-errors', // Still removed
    // '--print', 'filename', // Removed
    '--print', 'traffic', // ADDED: Print downloaded bytes
    '--verbose', // Keep verbose logging
    url
  ];
  // --- END MODIFIED ARGUMENTS ---

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = ''; 
      let stdoutOutput = ''; // Capture traffic size printed by yt-dlp

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
        
        // Log the captured traffic size
        const trafficLine = stdoutOutput.trim().split('\n').pop(); // Get last line (should be traffic)
        console.log(`[DOWNLOAD] yt-dlp reported traffic: ${trafficLine || '???'}`);

        // List directory contents AFTER yt-dlp finishes
        let filesInDir = [];
        let fileExists = false;
        try {
            filesInDir = await fs.readdir(__dirname); // List current directory
            console.log(`[DEBUG] Files found in ${__dirname} after yt-dlp exit: [${filesInDir.join(', ')}]`);
            // Check specifically for the expected file
            fileExists = filesInDir.includes(expectedFilename); 
        } catch (readErr) {
            console.error(`[DEBUG] Error listing files in ${__dirname}:`, readErr);
        }
       
        // Check exit code
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
            if (fileExists) {
                console.log(`[DOWNLOAD] Success! File ${expectedFilename} created.`);
                 if (!res.headersSent) { 
                     res.status(200).json({ success: true, message: `Download successful. File saved on server: ${expectedFilename}` });
                 }
            } else {
                 console.error(`[DOWNLOAD] yt-dlp exited successfully but file not found: ${expectedFilename}`);
                 if (!res.headersSent) { 
                     // Include traffic info in the error message
                     res.status(500).send(`yt-dlp exited successfully but the expected file was not found. Traffic: ${trafficLine || '???'}. Check logs. Stderr:\n${stderrOutput}`);
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
