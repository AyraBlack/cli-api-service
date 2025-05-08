// server.js - Proxy Method - Corrected Write Test & Default Download
// - Fixes fssync require statement
// - Added Write Test endpoint
// - Simplified Download to Default Format

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const fs_promises = require('fs').promises; // Use promises for async operations later if needed
const fs = require('fs'); // Use standard fs for sync operations like existsSync/mkdirSync
const path = require('path');
// Archiver not needed for these tests
// const archiver = require('archiver'); 

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
const PROXY_URL = process.env.YTDLP_PROXY_URL; 
const TEST_WRITE_FILE = path.join(__dirname, 'version_test.txt'); // File for write test
const DOWNLOAD_DIR = path.join(__dirname, 'downloads'); // Keep downloads separate

// --- Startup: Ensure download directory exists ---
// Use the correctly required 'fs' module here
if (!fs.existsSync(DOWNLOAD_DIR)){
    console.log(`Creating download directory: ${DOWNLOAD_DIR}`);
    try {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    } catch (mkdirErr) {
        console.error(`FATAL: Could not create download directory ${DOWNLOAD_DIR}:`, mkdirErr);
        process.exit(1); // Exit if we can't create the download dir
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

// ++++++++++++++++ NEW ENDPOINT: Test yt-dlp Write Permission ++++++++++++++++
app.get('/test-write', (_req, res) => {
  console.log('[WRITE TEST] Attempting to write yt-dlp version to file...');
  // Command: yt-dlp --version > /usr/src/app/version_test.txt
  // Use spawn with shell=true to handle the redirection '>' easily
  try {
      const command = `${YTDLP_BIN} --version > ${TEST_WRITE_FILE}`;
      console.log(`[WRITE TEST] Running command: ${command}`);
      const child = spawn(command, { shell: true, stdio: 'pipe' }); // Use shell, capture stdio

      let stderrOutput = '';
      child.stderr.on('data', (data) => {
          stderrOutput += data.toString();
          console.error('[WRITE TEST stderr]', data.toString().trim());
      });
       child.on('error', (spawnError) => { 
           console.error('[WRITE TEST spawn error]', spawnError);
           if (!res.headersSent) {
               res.status(500).send(`Failed to run write test command: ${spawnError.message}`);
           }
      });

      child.on('close', async (code) => {
          console.log(`[WRITE TEST yt-dlp exit code] ${code}`);
          if (code !== 0) {
              if (!res.headersSent) {
                  res.status(500).send(`Write test command failed with code ${code}. Stderr: ${stderrOutput}`);
              }
              return;
          }
          // Check if file was created
          try {
              await fs_promises.access(TEST_WRITE_FILE); // Use promises version for async check
              const content = await fs_promises.readFile(TEST_WRITE_FILE, 'utf8');
              console.log(`[WRITE TEST] Success! File ${TEST_WRITE_FILE} created with content: ${content.trim()}`);
               if (!res.headersSent) {
                  res.status(200).json({ success: true, message: `File created successfully. Content: ${content.trim()}` });
               }
               // Optionally delete the test file
               // await fs_promises.unlink(TEST_WRITE_FILE); 
          } catch (fileErr) {
              console.error(`[WRITE TEST] Command exited successfully but file ${TEST_WRITE_FILE} not found or unreadable.`, fileErr);
               if (!res.headersSent) {
                  res.status(500).send(`Write test command finished but file check failed. Error: ${fileErr.message}`);
               }
          }
      });
  } catch (e) {
       console.error('[WRITE TEST critical error]', e);
       if (!res.headersSent) {
            res.status(500).send(`Server error during write test: ${e.message}`);
       }
  }
});
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// Simplified Download Endpoint v4 - Default Format (Video+Audio), Proxy
app.get('/download', (req, res) => {
  const url = req.query.url;

  console.log(`[DEFAULT DOWNLOAD TEST] Request received - URL: ${url}`);
  if (!url) { return res.status(400).send('Missing query parameter: url'); }
  try { new URL(url); } catch (e) { return res.status(400).send('Invalid URL format provided.'); }
  if (!PROXY_URL) {
      console.error('[DOWNLOAD] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[DOWNLOAD] Using proxy configured via environment variable.');

  // Output to downloads directory
  const outputTemplate = path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s'); 

  // --- MODIFIED ARGUMENTS ---
  const args = [
    '--proxy', PROXY_URL, 
    // NO -f (let yt-dlp choose default best video+audio format)
    // NO --extract-audio
    // NO --audio-format
    // NO --write-auto-subs (focus on media download first)
    '-o', outputTemplate, // Save directly to downloads dir
    '--no-warnings', 
    // '--ignore-errors', // Removed
    '--force-overwrites', 
    '--no-cache-dir',     
    '--print', 'filename', // Print the final filename it saves
    '--verbose', // Keep verbose logging
    url
  ];
  // --- END MODIFIED ARGUMENTS ---

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = ''; 
      let stdoutOutput = ''; // Capture filename printed by yt-dlp

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
        
        const intendedFilename = stdoutOutput.trim().split('\n').pop(); // Get last line of stdout
        console.log(`[DOWNLOAD] yt-dlp intended to save: ${intendedFilename || '???'}`);

        let filesInDir = [];
        let fileExists = false;
        // Construct the full path using DOWNLOAD_DIR and the base filename
        let actualFilePath = intendedFilename ? path.join(DOWNLOAD_DIR, path.basename(intendedFilename)) : null; 

        try {
            filesInDir = await fs_promises.readdir(DOWNLOAD_DIR); // List downloads directory using promises fs
            console.log(`[DEBUG] Files found in ${DOWNLOAD_DIR} after yt-dlp exit: [${filesInDir.join(', ')}]`);
            if(actualFilePath) {
               // Check if the base filename exists in the list
               fileExists = filesInDir.includes(path.basename(actualFilePath)); 
            }
        } catch (readErr) {
            // Log error if reading directory fails, but continue to check exit code
            console.error(`[DEBUG] Error listing files in ${DOWNLOAD_DIR}:`, readErr);
        }
       
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
                     // Send success JSON, file is on server
                     res.status(200).json({ success: true, message: `Download successful. File saved on server: ${actualFilePath}` });
                 }
            } else {
                 console.error(`[DOWNLOAD] yt-dlp exited successfully but file not found: ${actualFilePath || 'intended filename unknown'}`);
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
