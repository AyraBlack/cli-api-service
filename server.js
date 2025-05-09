// server.js - Stream Best Audio Directly to Client via Proxy

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const path = require('path'); // path is still useful

// fs and archiver are not needed for this direct streaming test
// const fs = require('fs').promises; 
// const fssync = require('fs'); 
// const archiver = require('archiver'); 

const YTDLP_BIN = '/usr/local/bin/yt-dlp';
const PROXY_URL = process.env.YTDLP_PROXY_URL; 

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path} Query: ${JSON.stringify(req.query)}`);
  next();
});
app.use(express.json()); 

app.get('/', (_req, res) => {
  res.status(200).send('API Server is running. Use /health or /stream-audio endpoints.');
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

// Endpoint to Stream Audio Directly
app.get('/stream-audio', (req, res) => {
  const url = req.query.url;
  // Suggest an extension based on common bestaudio formats, client can override filename
  const suggestedExt = req.query.format || 'webm'; // .webm (opus) or .m4a are common for bestaudio

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

  // --- ARGUMENTS FOR STREAMING BEST AUDIO ---
  const args = [
    '--proxy', PROXY_URL, 
    '-f', 'bestaudio/best', // Select best audio format, download as is
    // NO --extract-audio or --audio-format, stream raw container
    '-o', '-', // Output to STDOUT
    // '--no-warnings', // Let's see warnings for this test
    // '--ignore-errors', // REMOVED - let errors propagate
    '--force-overwrites', 
    '--no-cache-dir',     
    '--verbose', // Keep verbose logging for now
    url
  ];
  // --- END ARGUMENTS ---

  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[STREAM AUDIO] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      // Set headers for streaming audio
      // The actual extension will be whatever yt-dlp's bestaudio is (e.g. .webm, .m4a)
      let contentType = 'application/octet-stream'; // Generic fallback
      if (suggestedExt === 'webm') contentType = 'audio/webm';
      else if (suggestedExt === 'm4a') contentType = 'audio/mp4';
      else if (suggestedExt === 'mp3') contentType = 'audio/mpeg'; // If you were converting

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="downloaded_audio.${suggestedExt}"`); 

      // Pipe yt-dlp's stdout (the audio data) directly to the HTTP response
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
                // If headers were sent, the stream might have started then failed.
                // We can't send another status code, but we should end the response.
                console.log('[STREAM AUDIO] yt-dlp exited with error after stream started. Ending response.');
                res.end();
            }
        } else {
            console.log(`[STREAM AUDIO] yt-dlp stream finished successfully for URL: ${url}. Response should have ended.`);
            // res.end() is called implicitly when the piped stdout stream ends.
        }
      }); 

  } catch (e) { 
       console.error('[STREAM AUDIO] Critical error before spawning yt-dlp:', e);
       if (!res.headersSent) {
            res.status(500).send(`Server error before running stream: ${e.message}`);
       }
  }
}); 

// --- Start the Server ---
const port = process.env.PORT || 3000; 
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
