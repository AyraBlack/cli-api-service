// server.js - Proxy Method - Download Best Audio (No Extraction) & Subtitles, Zip Output

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const fs = require('fs').promises; 
const fssync = require('fs'); 
const path = require('path');
const archiver = require('archiver'); 

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

// Download Endpoint using Proxy - Best Audio (No Extract) + Subs, Zipping results
app.get('/download', (req, res) => {
  const url = req.query.url;
  const lang = req.query.lang || 'en'; 
  // audioFormat query param is ignored now, we take whatever yt-dlp gives

  console.log(`[DOWNLOAD - No Extract] Request received - URL: ${url}, Lang: ${lang}`);
  if (!url) { return res.status(400).send('Missing query parameter: url'); }
  try { new URL(url); } catch (e) { return res.status(400).send('Invalid URL format provided.'); }
  if (!PROXY_URL) {
      console.error('[DOWNLOAD] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[DOWNLOAD] Using proxy configured via environment variable.');

  const outputTemplate = path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s');
  let videoId = ''; 
  let determinedAudioExt = ''; // Store the actual audio extension

  // --- MODIFIED ARGUMENTS ---
  const args = [
    '--proxy', PROXY_URL, 
    // Select best audio format, DO NOT extract/convert
    '-f', 'bestaudio/best', 
    // NO --extract-audio
    // NO --audio-format
    // NO --audio-quality (not applicable without conversion)
    // Get subtitles
    '--write-auto-subs', 
    '--sub-lang', lang, 
    // Output
    '-o', outputTemplate, 
    // Behaviour
    '--no-warnings', 
    '--ignore-errors', // Keep ignoring errors for now (e.g., missing subs)
    '--print', 'id', // Get video ID
    '--print', 'filename', // Get the final audio filename including extension
    // '--verbose', // Can add back if needed
    url
  ];
  // --- END MODIFIED ARGUMENTS ---

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = ''; 
      let stdoutOutput = ''; // Capture ID and filename

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
        
        // Extract info from stdout (last line should be filename, second last should be ID)
        const stdoutLines = stdoutOutput.trim().split('\n');
        const actualAudioFilenameFull = stdoutLines.pop() || ''; // Last line is filename
        videoId = stdoutLines.pop() || ''; // Second last line is ID
        
        // Fallback for video ID extraction
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
        console.log(`[DOWNLOAD] yt-dlp reported filename: ${actualAudioFilenameFull || '???'}`);


        const significantErrorOccurred = code !== 0 && !stderrOutput.toLowerCase().includes('subtitles not found');
        if (significantErrorOccurred) { 
            // ... (error handling remains the same) ...
            if (stderrOutput.includes('proxy') || stderrOutput.includes('Unsupported proxy type') || stderrOutput.includes('timed out')) {
                 console.error(`[DOWNLOAD] Proxy error detected for URL: ${url} (exit code ${code})`);
                 if (!res.headersSent) { res.status(502).send(`Proxy error occurred.\n\nStderr:\n${stderrOutput}`); }
            } else {
                console.error(`[DOWNLOAD] yt-dlp failed for URL: ${url} (exit code ${code})`);
                if (!res.headersSent) { res.status(500).send(`yt-dlp process exited with error code ${code}.\n\nStderr:\n${stderrOutput}`); }
            }
            return; 
        }
        
        console.log(`[DOWNLOAD] yt-dlp finished for video: ${videoId}. Preparing ZIP file.`);
        
        // Define expected file paths based on yt-dlp output if possible
        const actualAudioFilename = actualAudioFilenameFull ? path.basename(actualAudioFilenameFull) : '';
        const audioFilePath = actualAudioFilename ? path.join(DOWNLOAD_DIR, actualAudioFilename) : '';
        const expectedSubsFilename = `${videoId}.${lang}.vtt`; // Still assume .vtt for subs
        const subsFilePath = path.join(DOWNLOAD_DIR, expectedSubsFilename);
        const zipFilename = `${videoId}_${lang}_audio_subs.zip`; // Generic zip name

        try {
            const filesToZip = [];
            // Check if audio file exists (using the name yt-dlp reported)
            if (audioFilePath) {
                try {
                    await fs.access(audioFilePath); 
                    filesToZip.push({ path: audioFilePath, name: actualAudioFilename });
                    console.log(`[ZIP] Found audio file: ${actualAudioFilename}`);
                } catch (audioErr) { console.warn(`[ZIP] Audio file not found (using reported name): ${actualAudioFilename}`); }
            } else {
                 console.warn(`[ZIP] Could not determine audio filename from yt-dlp output.`);
            }
            
            // Check if subtitle file exists
            try {
                await fs.access(subsFilePath); 
                filesToZip.push({ path: subsFilePath, name: expectedSubsFilename });
                 console.log(`[ZIP] Found subtitle file: ${expectedSubsFilename}`);
            } catch (subsErr) { console.warn(`[ZIP] Subtitle file not found: ${expectedSubsFilename}`); }

            if (filesToZip.length === 0) {
                console.error('[ZIP] No files found to zip!');
                 // List directory contents for debugging
                try {
                    const filesInDir = await fs.readdir(DOWNLOAD_DIR);
                    console.log(`[DEBUG] Files actually in ${DOWNLOAD_DIR}: [${filesInDir.join(', ')}]`);
                } catch (readErr) { console.error(`[DEBUG] Error listing files in ${DOWNLOAD_DIR}:`, readErr); }
                
                if (!res.headersSent) { res.status(404).send(`Neither audio nor subtitle file was successfully created for video ${videoId}. Check server logs and yt-dlp stderr:\n${stderrOutput}`); }
                return;
            }

            // --- Proceed with Zipping ---
            console.log(`[ZIP] Creating archive: ${zipFilename} with ${filesToZip.length} file(s).`);
            res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
            res.setHeader('Content-Type', 'application/zip');
            const archive = archiver('zip', { zlib: { level: 9 } }); 
            archive.on('warning', (err) => { /* ... zip warning handling ... */ if (err.code !== 'ENOENT') { console.error('[ZIP Error]', err); if (!res.headersSent) { res.status(500).send(`Error creating zip file: ${err.message}`); } } });
            archive.on('error', (err) => { /* ... zip error handling ... */ console.error('[ZIP Fatal Error]', err); if (!res.headersSent) { res.status(500).send(`Fatal error creating zip file: ${err.message}`); } });
            archive.pipe(res); 
            for (const file of filesToZip) { archive.file(file.path, { name: file.name }); }
            await archive.finalize(); 
            console.log(`[ZIP] Archive finalized and sent: ${zipFilename}`);

            // Optional: Clean up
            // setTimeout(async () => { /* ... cleanup ... */ }, 15000); 

        } catch (zipError) { 
            console.error('[ZIP] General error during zipping process:', zipError);
            if (!res.headersSent) {
                res.status(500).send(`Error during file zipping: ${zipError.message}`);
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
