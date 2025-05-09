// server.js - Using Proxy for yt-dlp, Zipping Output, Added Root Endpoint

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

// ++++++++++++++++ ADDED ROOT ENDPOINT ++++++++++++++++
app.get('/', (_req, res) => {
  res.status(200).send('API Server is running. Use /health, /yt-dlp-version, or /download endpoints.');
});
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++

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

// Download Endpoint using Proxy and Zipping results
app.get('/download', (req, res) => {
  const url = req.query.url;
  const lang = req.query.lang || 'en'; 
  const audioFormat = req.query.audioformat || 'mp3'; 

  console.log(`[DOWNLOAD] Request received - URL: ${url}, Lang: ${lang}, AudioFormat: ${audioFormat}`);
  if (!url) {
    return res.status(400).send('Missing query parameter: url');
  }
  try { new URL(url); } catch (e) { return res.status(400).send('Invalid URL format provided.'); }

  if (!PROXY_URL) {
      console.error('[DOWNLOAD] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[DOWNLOAD] Using proxy configured via environment variable.');


  const outputTemplate = path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s');
  let videoId = ''; 

  const args = [
    '--proxy', PROXY_URL, 
    '-f', 'bestaudio/best', 
    '--extract-audio', 
    '--audio-format', audioFormat,
    '--audio-quality', '0', 
    '--write-auto-subs', 
    '--sub-lang', lang, 
    '-o', outputTemplate, 
    '--no-warnings', 
    '--ignore-errors', // Keeping this for now to ensure we get some result for zipping
    '--print', 'id', 
    url
  ];

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = '';
      child.stdout.on('data', (data) => { // This will capture the video ID
          videoId += data.toString().trim(); 
          console.log(`[yt-dlp stdout - ID] ${data.toString().trim()}`);
      });
      child.stderr.on('data', (data) => {
        const line = data.toString(); 
        if (!line.includes('[download] Destination:')) { 
           console.error('[yt-dlp stderr]', line.trim());
        }
        stderrOutput += line; 
      });

      child.on('error', (err) => { 
          console.error('[yt-dlp spawn error]', err);
          if (!res.headersSent) {
            res.status(500).send(`Failed to start yt-dlp process: ${err.message}`);
          }
      });

      child.on('close', async (code) => { 
        console.log(`[yt-dlp exit code] ${code}`);
        videoId = videoId.trim();
        
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
        
        // Check for errors even if --ignore-errors is used, based on stderr
        const significantErrorOccurred = code !== 0 || (stderrOutput.toLowerCase().includes('error') && !stderrOutput.toLowerCase().includes('subtitles not found'));

        if (significantErrorOccurred) { 
            if (stderrOutput.includes('proxy') || stderrOutput.includes('Unsupported proxy type') || stderrOutput.includes('timed out')) {
                 console.error(`[DOWNLOAD] Proxy error detected for URL: ${url} (exit code ${code})`);
                 if (!res.headersSent) {
                     res.status(502).send(`Proxy error occurred. Check proxy configuration and server logs.\n\nStderr:\n${stderrOutput}`);
                 }
            } else {
                console.error(`[DOWNLOAD] Failed for URL: ${url} (exit code ${code})`);
                if (!res.headersSent) {
                     res.status(500).send(`yt-dlp process exited with error code ${code}.\n\nStderr:\n${stderrOutput}`);
                }
            }
            return; 
        }
        
        console.log(`[DOWNLOAD] yt-dlp finished for video: ${videoId}. Preparing ZIP file.`);
        const expectedAudioFilename = `${videoId}.${audioFormat}`;
        const expectedSubsFilename = `${videoId}.${lang}.vtt`; 
        const audioFilePath = path.join(DOWNLOAD_DIR, expectedAudioFilename);
        const subsFilePath = path.join(DOWNLOAD_DIR, expectedSubsFilename);
        const zipFilename = `${videoId}_${lang}_${audioFormat}.zip`;

        try {
            const filesToZip = [];
            try {
                await fs.access(audioFilePath);
                filesToZip.push({ path: audioFilePath, name: expectedAudioFilename });
                console.log(`[ZIP] Found audio file: ${expectedAudioFilename}`);
            } catch (audioErr) { console.warn(`[ZIP] Audio file not found: ${expectedAudioFilename}`); }
            try {
                await fs.access(subsFilePath);
                filesToZip.push({ path: subsFilePath, name: expectedSubsFilename });
                 console.log(`[ZIP] Found subtitle file: ${expectedSubsFilename}`);
            } catch (subsErr) { console.warn(`[ZIP] Subtitle file not found: ${expectedSubsFilename}`); }

            if (filesToZip.length === 0) {
                console.error('[ZIP] No files found to zip!');
                if (!res.headersSent) { res.status(404).send(`Neither audio nor subtitle file was successfully created for video ${videoId}. Check server logs and yt-dlp stderr:\n${stderrOutput}`); }
                return;
            }

            console.log(`[ZIP] Creating archive: ${zipFilename} with ${filesToZip.length} file(s).`);
            res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
            res.setHeader('Content-Type', 'application/zip');
            const archive = archiver('zip', { zlib: { level: 9 } }); 
            archive.on('warning', (err) => { if (err.code !== 'ENOENT') { console.error('[ZIP Error]', err); if (!res.headersSent) { res.status(500).send(`Error creating zip file: ${err.message}`); } } });
            archive.on('error', (err) => { console.error('[ZIP Fatal Error]', err); if (!res.headersSent) { res.status(500).send(`Fatal error creating zip file: ${err.message}`); } });
            archive.pipe(res); 
            for (const file of filesToZip) { archive.file(file.path, { name: file.name }); }
            await archive.finalize(); 
            console.log(`[ZIP] Archive finalized and sent: ${zipFilename}`);

        } catch (zipError) { 
            console.error('[ZIP] General error during zipping process:', zipError);
            if (!res.headersSent) {
                res.status(500).send(`Error during file zipping: ${zipError.message}`);
            }
        }
      }); 

  } catch (e) { 
       console.error('[DOWNLOAD] Critical error before spawning yt-dlp:', e);
       if (!res.headersSent) {
            res.status(500).send(`Server error before running download: ${e.message}`);
       }
  }
}); 

const port = process.env.PORT || 3000; // Railway will set PORT
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
