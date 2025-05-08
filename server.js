// server.js - Proxy Method - Download Webpage Test

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const fs = require('fs').promises; 
const fssync = require('fs'); 
const path = require('path');

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
const PROXY_URL = process.env.YTDLP_PROXY_URL; 
const WEBPAGE_TEST_FILE = path.join(__dirname, 'webpage_test.html'); // File for webpage test

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

// Test Endpoint - Download Webpage via Proxy
app.get('/download-webpage', (req, res) => {
  const url = req.query.url;

  console.log(`[WEBPAGE TEST] Request received - URL: ${url}`);
  if (!url) { return res.status(400).send('Missing query parameter: url'); }
  try { new URL(url); } catch (e) { return res.status(400).send('Invalid URL format provided.'); }
  if (!PROXY_URL) {
      console.error('[WEBPAGE TEST] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[WEBPAGE TEST] Using proxy configured via environment variable.');

  // --- ARGUMENTS TO DOWNLOAD WEBPAGE ---
  const args = [
    '--proxy', PROXY_URL, 
    '--skip-download', // Don't download video/audio
    '--write-html-pages', // Tell it to save the webpage
    '-o', path.join(__dirname, '%(id)s_webpage.%(ext)s'), // Save webpage to current dir
    '--no-warnings', 
    '--force-overwrites', 
    '--no-cache-dir',     
    '--print', 'id', // Still print ID to know expected filename part
    '--verbose', 
    url
  ];
  // --- END ARGUMENTS ---

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[WEBPAGE TEST] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = ''; 
      let stdoutOutput = ''; // Capture ID

      child.stdout.on('data', (data) => {
          const dataStr = data.toString().trim();
          console.log(`[yt-dlp stdout] ${dataStr}`); 
          stdoutOutput += dataStr + '\n'; 
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
        
        // Extract video ID
        const videoIdMatch = stdoutOutput.match(/([a-zA-Z0-9_-]{11})$/);
        const videoId = videoIdMatch ? videoIdMatch[1] : 'unknown_video';
        const expectedFilename = `${videoId}_webpage.html`;
        const expectedFilePath = path.join(__dirname, expectedFilename);
        console.log(`[WEBPAGE TEST] yt-dlp finished. Expecting file: ${expectedFilePath}`);


        // List directory contents AFTER yt-dlp finishes
        let filesInDir = [];
        let fileExists = false;
        try {
            filesInDir = await fs.readdir(__dirname); // List current directory
            console.log(`[DEBUG] Files found in ${__dirname} after yt-dlp exit: [${filesInDir.join(', ')}]`);
            fileExists = filesInDir.includes(expectedFilename); 
        } catch (readErr) {
            console.error(`[DEBUG] Error listing files in ${__dirname}:`, readErr);
        }
       
        if (code !== 0) { 
            console.error(`[WEBPAGE TEST] yt-dlp failed for URL: ${url} (exit code ${code})`);
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
                console.log(`[WEBPAGE TEST] Success! File ${expectedFilename} created.`);
                 if (!res.headersSent) { 
                     res.status(200).json({ success: true, message: `Webpage download successful. File saved on server: ${expectedFilename}` });
                 }
            } else {
                 console.error(`[WEBPAGE TEST] yt-dlp exited successfully but webpage file not found: ${expectedFilename}`);
                 if (!res.headersSent) { 
                     res.status(500).send(`yt-dlp exited successfully but the expected webpage file was not found. Check logs. Stderr:\n${stderrOutput}`);
                 }
            }
        }
      }); // End of child.on('close')

  } catch (e) { 
       console.error('[WEBPAGE TEST] Critical error before spawning yt-dlp:', e);
       if (!res.headersSent) {
            res.status(500).send(`Server error before running download: ${e.message}`);
       }
  }
}); // End of app.get('/download-webpage')

// --- Start the Server ---
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
