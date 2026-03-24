import express from 'express';
import crypto from 'crypto';
import { readFileSync } from 'fs';

// Load .env manually (no dotenv dependency)
try {
  const envFile = readFileSync('.env', 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env file is optional if env vars set externally */ }

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = process.env.PORT || 3000;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY is required. Set it in .env or environment.');
  process.exit(1);
}
if (!APP_PASSWORD) {
  console.error('ERROR: APP_PASSWORD is required. Set it in .env or environment.');
  process.exit(1);
}

// Simple session store (in-memory)
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now() });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.created > SESSION_TTL) sessions.delete(token);
  }
}, 60 * 60 * 1000);

const app = express();
app.use(express.json({ limit: '1mb' }));

// Serve static files
app.use(express.static('.', {
  index: 'index.html',
  extensions: ['html'],
}));

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!isValidSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(APP_PASSWORD);
  const received = Buffer.from(String(password || ''));

  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const token = createSession();
  res.json({ token });
});

// Check auth status
app.get('/api/auth', (req, res) => {
  const token = req.headers['x-session-token'];
  res.json({ authenticated: isValidSession(token) });
});

// Logout
app.post('/api/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// Gemini proxy — the only place the API key is used
app.post('/api/gemini', requireAuth, async (req, res) => {
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const data = await response.text();
    res.status(response.status).set('Content-Type', 'application/json').send(data);
  } catch (err) {
    res.status(502).json({ error: `Gemini API error: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Magyar Kérdező server running on http://localhost:${PORT}`);
});
