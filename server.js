// server.js - Added /get-transcript endpoint using youtube-transcript library
//           - /download endpoint uses proxy for audio only and zips result

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const fs = require('fs').promises; 
const fssync = require('fs'); 
const path = require('path');
const archiver = require('archiver'); 
const { YoutubeTranscript } = require('youtube-transcript'); // For transcripts

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
const DOWNLOAD_DIR = path.join(__dirname, 'downloads'); 
const PROXY_URL = process.env.YTDLP_PROXY_URL; // Proxy for audio download

// Ensure download directory exists
if (!fssync.existsSync(DOWNLOAD_DIR)){
    console.log(`Creating download directory: ${DOWNLOAD_DIR}`);
    fssync.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.path);
  next();
});
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// yt-dlp version check endpoint
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

// Endpoint to get transcript using youtube-transcript library
app.get('/get-transcript', async (req, res) => {
  const url = req.query.url;
  const lang = req.query.lang || 'en'; // Default to English

  console.log(`[TRANSCRIPT] Request for URL: ${url}, Lang: ${lang}`);
  if (!url) {
    return res.status(400).json({ success: false, message: 'Missing query parameter: url' });
  }

  try {
    console.log(`[TRANSCRIPT] Calling YoutubeTranscript.fetchTranscript for ${url} (${lang})`);
    const transcript = await YoutubeTranscript.fetchTranscript(url, { lang: lang });
    
    console.log(`[TRANSCRIPT] Successfully fetched transcript for ${url}. Segments: ${transcript.length}`);
    
    // Send the transcript data as JSON
    res.status(200).json({ 
        success: true, 
        message: 'Transcript fetched successfully.',
        language: lang, 
        transcript: transcript 
    });

  } catch (err) {
    console.error(`[TRANSCRIPT] Error fetching transcript for ${url} (${lang}):`, err);
    if (err.message && err.message.toLowerCase().includes('transcript not found')) {
         res.status(404).json({ success: false, message: `Transcript not found for language '${lang}'.`, error: err.message });
    } else if (err.message && err.message.toLowerCase().includes('video id')) {
         res.status(400).json({ success: false, message: 'Invalid YouTube URL or Video ID.', error: err.message });
    }
     else {
        // Include specific error name if available
        const errorName = err.name || 'Error';
        res.status(500).json({ success: false, message: `Error fetching transcript (${errorName}).`, error: err.message });
    }
  }
});

// Endpoint to download AUDIO ONLY using Proxy and Zipping the result
app.get('/download', (req, res) => {
  const url = req.query.url;
  const audioFormat = req.query.audioformat || 'mp3'; 

  console.log(`[AUDIO DOWNLOAD] Request for URL: ${url}, AudioFormat: ${audioFormat}`);
  if (!url) { return res.status(400).send('Missing query parameter: url'); }
  
  // Check if proxy is configured
  if (!PROXY_URL) {
      console.error('[AUDIO DOWNLOAD] ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[AUDIO DOWNLOAD] Using proxy configured via environment variable.');

  const outputTemplate = path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s');
  let videoId = ''; 

  const args = [
    '--proxy', PROXY_URL, 
    '-f', 'bestaudio',
    '--extract-audio',
    '--audio-format', audioFormat,
    '--audio-quality', '0', 
    // REMOVED subtitle args - use /get-transcript endpoint instead
    '-o', outputTemplate,
    '--no-warnings',
    '--ignore-errors', 
    '--print', 'id', 
    url
  ];

  console.log('[AUDIO DOWNLOAD] Spawning:', YTDLP_BIN, args.slice(0, 3).join(' '), '...'); 
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = '';
      child.stdout.on('data', (data) => { videoId += data.toString().trim(); });
      child.stderr.on('data', (data) => {
        const line = data.toString(); 
        // Filter less important stderr messages if desired
        if (!line.includes('[download] Destination:')) {
            console.error('[yt-dlp stderr]', line.trim());
        }
        stderrOutput += line; 
      });

      child.on('error', (err) => { 
          console.error('[yt-dlp spawn error]', err);
          if (!res.headersSent) { res.status(500).send(`Failed to start yt-dlp process: ${err.message}`); }
      });

      child.on('close', async (code) => { 
        console.log('[yt-dlp exit code]', code);
        // Check for actual errors, ignoring cases where only non-critical issues occurred
        const hasRealError = code !== 0 && stderrOutput.toLowerCase().includes('error'); 
        
        if (hasRealError) { 
            if (stderrOutput.includes('proxy') || stderrOutput.includes('Unsupported proxy type') || stderrOutput.includes('timed out')) {
                 console.error(`[AUDIO DOWNLOAD] Proxy error for URL: ${url} (exit code ${code})`);
                 if (!res.headersSent) { res.status(502).send(`Proxy error occurred.\n\nStderr:\n${stderrOutput}`); }
            } else {
                console.error(`[AUDIO DOWNLOAD] Failed for URL: ${url} (exit code ${code})`);
                if (!res.headersSent) { res.status(500).send(`yt-dlp process exited with error code ${code}.\n\nStderr:\n${stderrOutput}`); }
            }
            return; 
        }
        
        // Fallback for video ID extraction
        if (!videoId) {
            try {
                 const urlObj = new URL(url);
                 if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
                     videoId = urlObj.searchParams.get('v') || urlObj.pathname.split('/').pop();
                 }
            } catch (e) { /* ignore */ }
            videoId = videoId || 'unknown_video'; 
            console.warn(`[AUDIO DOWNLOAD] Could not get video ID via --print id, using fallback: ${videoId}`);
        }

        console.log(`[AUDIO DOWNLOAD] yt-dlp finished for ${videoId}. Preparing audio file.`);
        const expectedAudioFilename = `${videoId}.${audioFormat}`;
        const audioFilePath = path.join(DOWNLOAD_DIR, expectedAudioFilename);
        const zipFilename = `${videoId}_${audioFormat}.zip`; // Zip just the audio

        try {
            await fs.access(audioFilePath); // Check if audio exists
            console.log(`[ZIP] Found audio file: ${expectedAudioFilename}`);

            res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
            res.setHeader('Content-Type', 'application/zip');
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.on('warning', (err) => { if (err.code !== 'ENOENT') { console.error('[ZIP Error]', err); if (!res.headersSent) { res.status(500).send(`Error creating zip file: ${err.message}`); } } });
            archive.on('error', (err) => { console.error('[ZIP Fatal Error]', err); if (!res.headersSent) { res.status(500).send(`Fatal error creating zip file: ${err.message}`); } });
            archive.pipe(res);
            archive.file(audioFilePath, { name: expectedAudioFilename }); // Add only audio to zip
            await archive.finalize();
            console.log(`[ZIP] Audio archive finalized and sent: ${zipFilename}`);

            // Optional cleanup
            // setTimeout(async () => { /* ... cleanup ... */ }, 5000);

        } catch (err) { // Catch specifically if fs.access fails (file not found)
            console.error(`[ZIP] Audio file not found or inaccessible after download: ${expectedAudioFilename}`, err);
            if (!res.headersSent) { res.status(404).send(`Audio file (${expectedAudioFilename}) not found on server after download process. yt-dlp stderr:\n${stderrOutput}`); }
        }
      }); // End of child.on('close')

  } catch (e) { // Catch errors from the initial spawn attempt
       console.error('[AUDIO DOWNLOAD] Critical error before spawning yt-dlp:', e);
       if (!res.headersSent) {
            res.status(500).send(`Server error before running download: ${e.message}`);
       }
  }
}); // End of app.get('/download')


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
