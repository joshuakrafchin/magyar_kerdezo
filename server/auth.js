const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { queryOne, run, SEED_EMAIL } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

function getGoogleClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/callback`
  );
}

function getAuthUrl() {
  const client = getGoogleClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
  });
}

async function handleCallback(code) {
  const client = getGoogleClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Verify the ID token
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  const email = payload.email.toLowerCase();
  const name = payload.name;
  const picture = payload.picture;

  // Check if user is invited
  const invited = await queryOne('SELECT 1 FROM invitations WHERE LOWER(email) = LOWER(?)', [email]);
  if (!invited) {
    return { error: 'not_invited', email };
  }

  // Find or create user
  let user = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    const id = uuidv4();
    const isSeed = email === SEED_EMAIL.toLowerCase();
    const role = isSeed ? 'admin' : 'user';

    // Find who invited them - use null if invited by SYSTEM (no real user)
    const invitation = await queryOne('SELECT invited_by FROM invitations WHERE LOWER(email) = LOWER(?)', [email]);
    const invitedBy = invitation && invitation.invited_by !== 'SYSTEM' ? invitation.invited_by : null;
    await run('INSERT INTO users (id, email, name, picture, role, invited_by) VALUES (?, ?, ?, ?, ?, ?)',
      [id, email, name, picture, role, invitedBy]);
    user = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
  }

  // Create JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  return { token, user };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Attach user info to request
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [decoded.userId]);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { getAuthUrl, handleCallback, verifyToken, requireAuth, requireAdmin, TOKEN_MAX_AGE };
