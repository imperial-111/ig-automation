const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_verify_123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

console.log('Token loaded, length:', PAGE_ACCESS_TOKEN ? PAGE_ACCESS_TOKEN.length : 'MISSING');
console.log('Token preview:', PAGE_ACCESS_TOKEN ? PAGE_ACCESS_TOKEN.substring(0, 15) + '...' : 'N/A');

// Your trigger keyword — change this to whatever word you want people to comment
const TRIGGER_KEYWORD = 'info';

// Simple in-memory store to avoid double-replying to the same comment
// (resets if the server restarts — fine for low/medium volume testing)
const repliedComments = new Set();

// Home route
app.get('/', (req, res) => res.send('IG automation server is running.'));

// Privacy Policy page (required by Meta before going Live)
app.get('/privacy-policy', (req, res) => {
  res.send(`
    <html>
      <head><title>Privacy Policy</title></head>
      <body style="font-family: sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6;">
        <h1>Privacy Policy</h1>
        <p>This application ("ig-automation") uses the Instagram Graph API to read comments on connected Instagram accounts and send automated private replies in response to specific triggers.</p>
        <p><strong>Data we access:</strong> Instagram comments, comment IDs, and basic profile info provided by Meta's API for the purpose of sending automated replies.</p>
        <p><strong>Data storage:</strong> We do not store personal data beyond what is required to process and respond to the comment in real time.</p>
        <p><strong>Data sharing:</strong> We do not sell or share data with third parties.</p>
        <p><strong>Contact:</strong> For questions about this policy, contact your-email@example.com.</p>
      </body>
    </html>
  `);
});

// Data Deletion page (also often required by Meta)
app.get('/data-deletion', (req, res) => {
  res.send(`
    <html>
      <head><title>Data Deletion</title></head>
      <body style="font-family: sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6;">
        <h1>Data Deletion Instructions</h1>
        <p>To request deletion of your data associated with this app, email your-email@example.com with your Instagram username and request. We will process deletion requests within 7 days.</p>
      </body>
    </html>
  `);
});

// Webhook verification (Meta calls this GET request when you click "Verify and save")
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook events (Meta POSTs here on every comment)
app.post('/webhook', async (req, res) => {
  console.log('Incoming webhook:', JSON.stringify(req.body, null, 2));

  // Acknowledge immediately so Meta doesn't retry/timeout
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];

    if (change?.field === 'comments') {
      const commentText = change.value.text || '';
      const commentId = change.value.id;

      if (!commentId) return;

      // Avoid double-replying to the same comment
      if (repliedComments.has(commentId)) {
        console.log('Already replied to this comment, skipping:', commentId);
        return;
      }

      if (commentText.toLowerCase().includes(TRIGGER_KEYWORD)) {
        await sendPrivateReply(commentId, "Thanks for your comment! Here's the info you asked for: ...");
        repliedComments.add(commentId);
      }
    }
  } catch (err) {
    console.error('Error processing webhook:', err);
  }
});

// Sends a DM via Instagram's Private Reply API — replies to the comment itself,
// bypassing the normal 24-hour messaging window restriction.
async function sendPrivateReply(commentId, messageText) {
  const url = `https://graph.instagram.com/v21.0/${commentId}/private_replies?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: messageText })
    });
    const data = await response.json();
    console.log('DM send result:', data);
  } catch (err) {
    console.error('Error sending private reply:', err);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
