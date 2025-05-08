// server.js - Using Proxy for yt-dlp to get Audio & Subtitles, Zipping Output

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const fs = require('fs').promises; 
const fssync = require('fs'); 
const path = require('path');
const archiver = require('archiver'); // For zipping files

const YTDLP_BIN = '/usr/local/bin/yt-dlp'; // Path to yt-dlp executable
const DOWNLOAD_DIR = path.join(__dirname, 'downloads'); // Directory to store temporary downloads

// Get proxy URL from environment variable (set this in Coolify)
const PROXY_URL = process.env.YTDLP_PROXY_URL; 

// --- Startup: Ensure download directory exists ---
if (!fssync.existsSync(DOWNLOAD_DIR)){
    console.log(`Creating download directory: ${DOWNLOAD_DIR}`);
    try {
        fssync.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    } catch (mkdirErr) {
        console.error(`FATAL: Could not create download directory ${DOWNLOAD_DIR}:`, mkdirErr);
        process.exit(1); // Exit if we can't create the download dir
    }
}

// --- Middleware ---
app.use((req, res, next) => {
  // Log incoming requests
  console.log(`[REQ] ${req.method} ${req.path} Query: ${JSON.stringify(req.query)}`);
  next();
});
app.use(express.json()); // Middleware to parse JSON bodies (if you add POST routes later)

// --- API Endpoints ---

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Endpoint to check yt-dlp version
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

// Main download endpoint (Audio + Subtitles via Proxy, Zipped)
app.get('/download', (req, res) => {
  const url = req.query.url;
  const lang = req.query.lang || 'en'; // Default language
  const audioFormat = req.query.audioformat || 'mp3'; // Default format

  console.log(`[DOWNLOAD] Request received - URL: ${url}, Lang: ${lang}, AudioFormat: ${audioFormat}`);
  
  // Validate input
  if (!url) {
    console.log('[DOWNLOAD] Error: Missing URL parameter.');
    return res.status(400).send('Missing query parameter: url');
  }
  // Basic URL validation (optional but recommended)
  try {
      new URL(url); 
  } catch (e) {
      console.log(`[DOWNLOAD] Error: Invalid URL format: ${url}`);
      return res.status(400).send('Invalid URL format provided.');
  }

  // Check if proxy environment variable is set
  if (!PROXY_URL) {
      console.error('[DOWNLOAD] FATAL ERROR: YTDLP_PROXY_URL environment variable is not set.');
      return res.status(500).send('Server configuration error: Proxy URL not set.');
  }
  console.log('[DOWNLOAD] Using proxy configured via environment variable.');

  // Define output template for files saved on the server
  const outputTemplate = path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s');
  let videoId = ''; // To store the extracted video ID

  // Construct yt-dlp arguments
  const args = [
    // --- Proxy ---
    '--proxy', PROXY_URL, 

    // --- Format Selection & Extraction ---
    '-f', 'bestaudio/best', // Select best audio, fallback to best overall if no separate audio
    '--extract-audio', 
    '--audio-format', audioFormat,
    '--audio-quality', '0', // Best VBR quality for ffmpeg conversion

    // --- Subtitles ---
    '--write-auto-subs', // Get auto-generated subs
    '--sub-lang', lang, // For the specified language
    // '--convert-subs', 'vtt', // Ensure VTT format (usually default for auto-subs)

    // --- Output ---
    '-o', outputTemplate, // Save files to downloads dir with ID.ext name

    // --- Behaviour ---
    '--no-warnings', // Suppress yt-dlp warnings
    '--ignore-errors', // Continue processing even if, e.g., subtitles are not found
    '--print', 'id', // Print video ID to stdout for use in naming zip file
    
    // --- Input ---
    url // The target video URL
  ];

  // Log the command safely (mask proxy credentials if present)
  let safeArgsLog = args.map(arg => arg.includes('@') && arg.includes(':') ? '--proxy ***HIDDEN***' : arg);
  console.log('[DOWNLOAD] Spawning:', YTDLP_BIN, safeArgsLog.join(' '));
  
  try {
      // Spawn the yt-dlp process
      const child = spawn(YTDLP_BIN, args, { stdio: ['ignore','pipe','pipe'] }); 

      let stderrOutput = '';
      // Capture video ID from stdout
      child.stdout.on('data', (data) => {
          videoId += data.toString().trim(); 
          console.log(`[yt-dlp stdout] Captured Video ID fragment: ${data.toString().trim()}`);
      });
      // Capture stderr output for logging and error checking
      child.stderr.on('data', (data) => {
        const line = data.toString(); 
        // Filter verbose download progress to keep logs cleaner
        if (!line.startsWith('[download]')) { 
           console.error('[yt-dlp stderr]', line.trim());
        }
        stderrOutput += line; 
      });

      // Handle errors during process spawning (e.g., command not found)
      child.on('error', (err) => { 
          console.error('[yt-dlp spawn error]', err);
          if (!res.headersSent) {
            res.status(500).send(`Failed to start yt-dlp process: ${err.message}`);
          }
      });

      // Handle process exit
      child.on('close', async (code) => { 
        console.log(`[yt-dlp exit code] ${code}`);
        
        // Determine if a significant error occurred
        // Allow exit code 0, or exit code non-zero ONLY IF the error was just missing subtitles
        const significantErrorOccurred = code !== 0 && !stderrOutput.toLowerCase().includes('subtitles not found');

        if (significantErrorOccurred) { 
            // Handle specific proxy errors first
            if (stderrOutput.includes('proxy') || stderrOutput.includes('Unsupported proxy type') || stderrOutput.includes('timed out')) {
                 console.error(`[DOWNLOAD] Proxy error detected for URL: ${url} (exit code ${code})`);
                 if (!res.headersSent) {
                     res.status(502).send(`Proxy error occurred. Check proxy configuration and server logs.\n\nStderr:\n${stderrOutput}`);
                 }
            } else { // Handle other yt-dlp errors
                console.error(`[DOWNLOAD] yt-dlp failed for URL: ${url} (exit code ${code})`);
                if (!res.headersSent) {
                     res.status(500).send(`yt-dlp process exited with error code ${code}.\n\nStderr:\n${stderrOutput}`);
                }
            }
            return; // Stop processing on significant error
        }
        
        // --- If yt-dlp finished without critical errors, proceed to ZIP ---

        // Finalize video ID capture
        videoId = videoId.trim(); 
        // Fallback for video ID extraction if --print id failed
        if (!videoId) {
            try {
                 const urlObj = new URL(url);
                 if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
                     videoId = urlObj.searchParams.get('v') || urlObj.pathname.split('/').pop();
                 }
            } catch (e) { /* ignore */ }
            videoId = videoId || 'unknown_video'; 
            console.warn(`[DOWNLOAD] Could not get video ID via --print id, using fallback: ${videoId}`);
        }

        console.log(`[DOWNLOAD] yt-dlp finished for video: ${videoId}. Preparing ZIP file.`);
        
        // Define expected file paths
        const expectedAudioFilename = `${videoId}.${audioFormat}`;
        const expectedSubsFilename = `${videoId}.${lang}.vtt`; // yt-dlp typically saves auto-subs as .vtt
        const audioFilePath = path.join(DOWNLOAD_DIR, expectedAudioFilename);
        const subsFilePath = path.join(DOWNLOAD_DIR, expectedSubsFilename);
        const zipFilename = `${videoId}_${lang}_${audioFormat}.zip`; // Name for the final zip

        try {
            const filesToZip = [];
            // Check if audio file exists and add to list
            try {
                await fs.access(audioFilePath); // Check file existence
                filesToZip.push({ path: audioFilePath, name: expectedAudioFilename });
                console.log(`[ZIP] Found audio file: ${expectedAudioFilename}`);
            } catch (audioErr) { 
                console.warn(`[ZIP] Audio file not found, likely failed download or conversion: ${expectedAudioFilename}`); 
            }
            
            // Check if subtitle file exists and add to list
            try {
                await fs.access(subsFilePath); // Check file existence
                filesToZip.push({ path: subsFilePath, name: expectedSubsFilename });
                 console.log(`[ZIP] Found subtitle file: ${expectedSubsFilename}`);
            } catch (subsErr) { 
                // This is expected if --ignore-errors was used and subs didn't exist
                console.warn(`[ZIP] Subtitle file not found: ${expectedSubsFilename}`); 
            }

            // If no files were actually created, send an error
            if (filesToZip.length === 0) {
                console.error('[ZIP] No files found to zip! yt-dlp might have failed silently.');
                if (!res.headersSent) { 
                    res.status(404).send(`Neither audio nor subtitle file was successfully created for video ${videoId}. Check server logs and yt-dlp stderr:\n${stderrOutput}`); 
                }
                return;
            }

            // --- Proceed with Zipping ---
            console.log(`[ZIP] Creating archive: ${zipFilename} with ${filesToZip.length} file(s).`);
            
            // Set headers for the client to download the zip file
            res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
            res.setHeader('Content-Type', 'application/zip');
            
            // Create the zip archive stream
            const archive = archiver('zip', { zlib: { level: 9 } }); // Set compression level

            // --- Pipe archive output directly to the HTTP response ---
            archive.pipe(res); 

            // --- Add files to the archive ---
            for (const file of filesToZip) { 
                console.log(`[ZIP] Adding file to archive: ${file.name}`);
                archive.file(file.path, { name: file.name }); 
            }
            
            // --- Finalize the archive (important!) ---
            // This writes the central directory and ends the archive stream.
            // The 'close' event on the response stream will be triggered after this.
            await archive.finalize(); 
            console.log(`[ZIP] Archive finalized. Streaming response complete.`);

            // Optional: Clean up the original files after sending the zip
            // Use a slight delay or handle this carefully to ensure the stream has finished
            setTimeout(async () => { 
               console.log('[CLEANUP] Attempting to delete source files...');
               for (const file of filesToZip) {
                  try { 
                      await fs.unlink(file.path); 
                      console.log(`[CLEANUP] Deleted ${file.name}`);
                  } catch (delErr) { 
                      // Log error but don't fail the request if cleanup fails
                      console.error(`[CLEANUP] Error deleting ${file.name}:`, delErr);
                  }
               }
            }, 15000); // Wait 15 seconds before cleanup

        } catch (zipError) { // Catch errors during the zipping process
            console.error('[ZIP] General error during zipping process:', zipError);
            if (!res.headersSent) {
                res.status(500).send(`Error during file zipping: ${zipError.message}`);
            }
        }
      }); // End of child.on('close')

  } catch (e) { // Catch errors from the initial spawn attempt
       console.error('[DOWNLOAD] Critical error before spawning yt-dlp:', e);
       if (!res.headersSent) {
            res.status(500).send(`Server error before running download: ${e.message}`);
       }
  }
}); // End of app.get('/download')

// --- Start the Server ---
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 API listening on port ${port}`));
