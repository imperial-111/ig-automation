const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_verify_123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "changeme123";

// Set to true to actually call Instagram's API, false to just log what would be sent
const LIVE_SENDING = false;

console.log('Token loaded, length:', PAGE_ACCESS_TOKEN ? PAGE_ACCESS_TOKEN.length : 'MISSING');

// ============ IN-MEMORY STORE ============
// NOTE: resets on server restart/redeploy. Replace with a real DB once this works.
let automations = [
  {
    id: crypto.randomUUID(),
    name: 'Example automation',
    mediaId: '',          // empty string = applies to ANY post
    keywords: ['info'],
    dmMessage: "Thanks for your comment! Here's the info you asked for: ...",
    active: true,
    triggeredCount: 0
  }
];

const repliedComments = new Set();

// ============ AUTH MIDDLEWARE FOR DASHBOARD/API ============
function checkAuth(req, res, next) {
  const pass = req.query.password || req.headers['x-dashboard-password'];
  if (pass !== DASHBOARD_PASSWORD) {
    return res.status(401).send('Unauthorized. Add ?password=YOUR_PASSWORD to the URL.');
  }
  next();
}

// ============ BASIC ROUTES ============

app.get('/', (req, res) => res.send('IG automation server is running. Visit /dashboard?password=YOUR_PASSWORD to manage automations.'));

app.get('/privacy-policy', (req, res) => {
  res.send(`
    <html><head><title>Privacy Policy</title></head>
    <body style="font-family: sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6;">
      <h1>Privacy Policy</h1>
      <p>This application uses the Instagram Graph API to read comments on connected Instagram accounts and send automated private replies based on rules configured by the account owner.</p>
      <p><strong>Data we access:</strong> Instagram comments, comment IDs, and basic profile info provided by Meta's API.</p>
      <p><strong>Data storage:</strong> Automation rules are stored to operate the service. We do not sell or share data with third parties.</p>
      <p><strong>Contact:</strong> your-email@example.com</p>
    </body></html>
  `);
});

app.get('/data-deletion', (req, res) => {
  res.send(`
    <html><head><title>Data Deletion</title></head>
    <body style="font-family: sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6;">
      <h1>Data Deletion Instructions</h1>
      <p>Email your-email@example.com with your Instagram username to request deletion. Processed within 7 days.</p>
    </body></html>
  `);
});

// ============ DASHBOARD UI ============

app.get('/dashboard', checkAuth, (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>IG Automation Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 30px auto; padding: 0 16px; background: #f7f7f8; }
  h1 { font-size: 22px; }
  .card { background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 18px; margin-bottom: 16px; }
  .card.inactive { opacity: 0.55; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 10px 0 4px; color: #333; }
  input[type=text], textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-size: 14px; }
  textarea { min-height: 60px; }
  button { background: #0070f3; color: white; border: none; padding: 9px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; margin-top: 10px; margin-right: 8px; }
  button.danger { background: #e5484d; }
  button.secondary { background: #666; }
  .stat { font-size: 12px; color: #666; margin-top: 8px; }
  .toggle { font-size: 13px; }
  #newForm { background: white; border: 2px dashed #0070f3; border-radius: 10px; padding: 18px; margin-bottom: 24px; }
</style>
</head>
<body>
  <h1>📩 Instagram Auto-DM Dashboard</h1>
  <p style="color:#666; font-size:14px;">Live sending is currently <strong>${LIVE_SENDING ? 'ON' : 'OFF (mock mode)'}</strong>. Edit LIVE_SENDING in server.js to change.</p>

  <div id="newForm">
    <h3 style="margin-top:0;">+ New Automation</h3>
    <label>Name</label>
    <input type="text" id="n-name" placeholder="e.g. Reel - Free Guide">
    <label>Target Post/Reel Media ID (leave blank for ANY post)</label>
    <input type="text" id="n-mediaId" placeholder="e.g. 18117719795045634">
    <label>Trigger keywords (comma separated)</label>
    <input type="text" id="n-keywords" placeholder="info, price, link">
    <label>DM message to send</label>
    <textarea id="n-dm" placeholder="Thanks for commenting! Here's the link..."></textarea>
    <button onclick="createAutomation()">Create Automation</button>
  </div>

  <div id="list"></div>

<script>
const password = new URLSearchParams(window.location.search).get('password');

async function loadAutomations() {
  const res = await fetch('/api/automations?password=' + password);
  const data = await res.json();
  const list = document.getElementById('list');
  list.innerHTML = '';
  data.forEach(a => {
    const div = document.createElement('div');
    div.className = 'card' + (a.active ? '' : ' inactive');
    div.innerHTML = \`
      <strong>\${a.name}</strong>
      <div class="stat">Target: \${a.mediaId || 'ANY POST'} • Keywords: \${a.keywords.join(', ')} • Triggered \${a.triggeredCount} times</div>
      <div class="stat">Message: "\${a.dmMessage}"</div>
      <button class="secondary" onclick="toggleActive('\${a.id}', \${!a.active})">\${a.active ? 'Pause' : 'Activate'}</button>
      <button class="danger" onclick="deleteAutomation('\${a.id}')">Delete</button>
    \`;
    list.appendChild(div);
  });
}

async function createAutomation() {
  const body = {
    name: document.getElementById('n-name').value || 'Untitled',
    mediaId: document.getElementById('n-mediaId').value.trim(),
    keywords: document.getElementById('n-keywords').value.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
    dmMessage: document.getElementById('n-dm').value || 'Thanks for your comment!'
  };
  await fetch('/api/automations?password=' + password, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.getElementById('n-name').value = '';
  document.getElementById('n-mediaId').value = '';
  document.getElementById('n-keywords').value = '';
  document.getElementById('n-dm').value = '';
  loadAutomations();
}

async function toggleActive(id, active) {
  await fetch('/api/automations/' + id + '?password=' + password, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active })
  });
  loadAutomations();
}

async function deleteAutomation(id) {
  if (!confirm('Delete this automation?')) return;
  await fetch('/api/automations/' + id + '?password=' + password, { method: 'DELETE' });
  loadAutomations();
}

loadAutomations();
</script>
</body>
</html>
  `);
});

// ============ API: CRUD FOR AUTOMATIONS ============

app.get('/api/automations', checkAuth, (req, res) => {
  res.json(automations);
});

app.post('/api/automations', checkAuth, (req, res) => {
  const { name, mediaId, keywords, dmMessage } = req.body;
  const newAutomation = {
    id: crypto.randomUUID(),
    name: name || 'Untitled',
    mediaId: mediaId || '',
    keywords: Array.isArray(keywords) ? keywords : [],
    dmMessage: dmMessage || 'Thanks for your comment!',
    active: true,
    triggeredCount: 0
  };
  automations.push(newAutomation);
  res.json(newAutomation);
});

app.patch('/api/automations/:id', checkAuth, (req, res) => {
  const automation = automations.find(a => a.id === req.params.id);
  if (!automation) return res.sendStatus(404);
  Object.assign(automation, req.body);
  res.json(automation);
});

app.delete('/api/automations/:id', checkAuth, (req, res) => {
  automations = automations.filter(a => a.id !== req.params.id);
  res.sendStatus(200);
});

// ============ WEBHOOK VERIFICATION ============

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============ WEBHOOK EVENTS — matches against ALL active automations ============

app.post('/webhook', async (req, res) => {
  console.log('Incoming webhook:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    if (change?.field !== 'comments') return;

    const commentText = (change.value.text || '').toLowerCase();
    const commentId = change.value.id;
    const mediaId = change.value.media?.id;

    if (!commentId || repliedComments.has(commentId)) return;

    // Find the first active automation that matches this post and keyword
    const match = automations.find(a =>
      a.active &&
      (a.mediaId === '' || a.mediaId === mediaId) &&
      a.keywords.some(k => commentText.includes(k))
    );

    if (match) {
      await sendPrivateReply(commentId, match.dmMessage);
      match.triggeredCount += 1;
      repliedComments.add(commentId);
      console.log(\`Matched automation "\${match.name}" for comment \${commentId}\`);
    }
  } catch (err) {
    console.error('Error processing webhook:', err);
  }
});

// ============ SEND DM (mock or live) ============

async function sendPrivateReply(commentId, messageText) {
  if (!LIVE_SENDING) {
    console.log('[MOCK MODE] Would send DM for comment', commentId, '-> "' + messageText + '"');
    return;
  }

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
