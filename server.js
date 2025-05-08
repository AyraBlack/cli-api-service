// server.js - Minimal test to check routing

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`[MINIMAL REQ] ${req.method} ${req.originalUrl}`); // Log the original URL requested
  next();
});

// Simple root endpoint
app.get('/', (req, res) => {
  res.status(200).send('Minimal Server Root OK');
});

// The ONLY specific endpoint we define
app.get('/download-webpage', (req, res) => {
  console.log('[MINIMAL /download-webpage] Endpoint hit!');
  // Just send a success message, don't run yt-dlp yet
  res.status(200).json({ success: true, message: 'Reached /download-webpage endpoint successfully.' });
});

// Start the server
app.listen(port, () => console.log(`🚀 Minimal API listening on port ${port}`));

// Make sure NO other app.get('/download', ...) exists in this file!
