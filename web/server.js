const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();

// ── Database ──────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        role TEXT NOT NULL CHECK (role IN ('elder','family','caregiver')),
        link_code TEXT UNIQUE,
        linked_elder_id INTEGER REFERENCES users(id),
        subscription TEXT DEFAULT 'free',
        trial_start TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS checkins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        time TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        date TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        relationship TEXT,
        priority INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS medications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        dosage TEXT,
        frequency TEXT,
        time TEXT,
        stock INTEGER DEFAULT 30,
        unit TEXT DEFAULT 'comprimidos',
        low_threshold INTEGER DEFAULT 5
      );

      CREATE TABLE IF NOT EXISTS health_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        value REAL,
        unit TEXT,
        time TEXT,
        date TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        checkin_times TEXT[] DEFAULT ARRAY['09:00'],
        checkin_mode TEXT DEFAULT 'scheduled',
        checkin_interval_hours INTEGER DEFAULT 2,
        checkin_window_start TEXT DEFAULT '07:00',
        checkin_window_end TEXT DEFAULT '22:00'
      );

      CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_medications_user ON medications(user_id);
      CREATE INDEX IF NOT EXISTS idx_health_entries_user ON health_entries(user_id);
    `);
    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// ── Middleware ─────────────────────────────────────────────
app.use(express.json());

// CORS
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Auth helper
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateToken(userId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'estoubem-secret-key-change-in-prod')
    .update(String(userId) + Date.now())
    .digest('hex');
}

// Simple token store (in production, use JWT or sessions)
const tokens = new Map(); // token -> userId

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const userId = tokens.get(token);
  if (!userId) return res.status(401).json({ error: 'Invalid token' });
  req.userId = userId;
  next();
}

// ── Auth Routes ───────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { email, password, name, phone, role } = req.body;
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'email, password, name, and role are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!['elder', 'family', 'caregiver'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const hash = hashPassword(password);
  const linkCode = Math.random().toString().slice(2, 8);

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, phone, role, link_code, trial_start)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, email, name, phone, role, link_code, subscription, trial_start`,
      [email.toLowerCase(), hash, name, phone || '', role, linkCode]
    );

    const user = result.rows[0];

    // Create default settings
    await pool.query(`INSERT INTO settings (user_id) VALUES ($1)`, [user.id]);

    // Create initial pending checkin for elder
    if (role === 'elder') {
      await pool.query(
        `INSERT INTO checkins (user_id, time, status, date) VALUES ($1, '09:00', 'pending', $2)`,
        [user.id, new Date().toISOString().slice(0, 10)]
      );
    }

    const token = generateToken(user.id);
    tokens.set(token, user.id);

    res.json({ ok: true, token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const hash = hashPassword(password);
  const result = await pool.query(
    `SELECT id, email, name, phone, role, link_code, subscription, trial_start, linked_elder_id FROM users WHERE email = $1 AND password_hash = $2`,
    [email.toLowerCase(), hash]
  );

  if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

  const user = result.rows[0];
  const token = generateToken(user.id);
  tokens.set(token, user.id);

  res.json({ ok: true, token, user });
});

// ── User Routes ───────────────────────────────────────────
app.get('/api/me', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT id, email, name, phone, role, link_code, subscription, trial_start, linked_elder_id FROM users WHERE id = $1`,
    [req.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json(result.rows[0]);
});

app.post('/api/link-elder', authMiddleware, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Link code required' });

  const elder = await pool.query(`SELECT id, name FROM users WHERE link_code = $1 AND role = 'elder'`, [code]);
  if (elder.rows.length === 0) return res.status(404).json({ error: 'Invalid code' });

  await pool.query(`UPDATE users SET linked_elder_id = $1 WHERE id = $2`, [elder.rows[0].id, req.userId]);
  res.json({ ok: true, elderName: elder.rows[0].name, elderId: elder.rows[0].id });
});

// ── Settings Routes ───────────────────────────────────────
app.get('/api/settings', authMiddleware, async (req, res) => {
  const result = await pool.query(`SELECT * FROM settings WHERE user_id = $1`, [req.userId]);
  res.json(result.rows[0] || { checkin_times: ['09:00'], checkin_mode: 'scheduled', checkin_interval_hours: 2, checkin_window_start: '07:00', checkin_window_end: '22:00' });
});

app.put('/api/settings', authMiddleware, async (req, res) => {
  const { checkin_times, checkin_mode, checkin_interval_hours, checkin_window_start, checkin_window_end } = req.body;
  await pool.query(
    `INSERT INTO settings (user_id, checkin_times, checkin_mode, checkin_interval_hours, checkin_window_start, checkin_window_end)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       checkin_times = COALESCE($2, settings.checkin_times),
       checkin_mode = COALESCE($3, settings.checkin_mode),
       checkin_interval_hours = COALESCE($4, settings.checkin_interval_hours),
       checkin_window_start = COALESCE($5, settings.checkin_window_start),
       checkin_window_end = COALESCE($6, settings.checkin_window_end)`,
    [req.userId, checkin_times, checkin_mode, checkin_interval_hours, checkin_window_start, checkin_window_end]
  );
  res.json({ ok: true });
});

// ── Check-in Routes ───────────────────────────────────────
app.get('/api/checkins', authMiddleware, async (req, res) => {
  const { date, limit } = req.query;
  let query = `SELECT * FROM checkins WHERE user_id = $1`;
  const params = [req.userId];

  if (date) { query += ` AND date = $2`; params.push(date); }
  query += ` ORDER BY created_at DESC`;
  if (limit) { query += ` LIMIT $${params.length + 1}`; params.push(parseInt(limit)); }

  const result = await pool.query(query, params);
  res.json(result.rows);
});

// Get checkins for linked elder (family view)
app.get('/api/checkins/elder', authMiddleware, async (req, res) => {
  const user = await pool.query(`SELECT linked_elder_id FROM users WHERE id = $1`, [req.userId]);
  const elderId = user.rows[0]?.linked_elder_id;
  if (!elderId) return res.status(404).json({ error: 'No linked elder' });

  const { date, limit } = req.query;
  let query = `SELECT * FROM checkins WHERE user_id = $1`;
  const params = [elderId];
  if (date) { query += ` AND date = $2`; params.push(date); }
  query += ` ORDER BY created_at DESC`;
  if (limit) { query += ` LIMIT $${params.length + 1}`; params.push(parseInt(limit)); }

  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.post('/api/checkins', authMiddleware, async (req, res) => {
  const { time, status, date } = req.body;
  const result = await pool.query(
    `INSERT INTO checkins (user_id, time, status, date) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.userId, time, status || 'pending', date || new Date().toISOString().slice(0, 10)]
  );
  res.json(result.rows[0]);
});

app.put('/api/checkins/:id', authMiddleware, async (req, res) => {
  const { status, time } = req.body;
  const result = await pool.query(
    `UPDATE checkins SET status = COALESCE($1, status), time = COALESCE($2, time) WHERE id = $3 AND user_id = $4 RETURNING *`,
    [status, time, req.params.id, req.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Check-in not found' });
  res.json(result.rows[0]);
});

// ── Contact Routes ────────────────────────────────────────
app.get('/api/contacts', authMiddleware, async (req, res) => {
  const result = await pool.query(`SELECT * FROM contacts WHERE user_id = $1 ORDER BY priority`, [req.userId]);
  res.json(result.rows);
});

app.post('/api/contacts', authMiddleware, async (req, res) => {
  // Check limit
  const sub = await getEffectiveSub(req.userId);
  const count = await pool.query(`SELECT COUNT(*) FROM contacts WHERE user_id = $1`, [req.userId]);
  const maxC = sub === 'free' ? 1 : Infinity;
  if (parseInt(count.rows[0].count) >= maxC) {
    return res.status(403).json({ error: 'Contact limit reached. Upgrade your plan.' });
  }

  const { name, phone, relationship, priority } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });

  const result = await pool.query(
    `INSERT INTO contacts (user_id, name, phone, relationship, priority) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.userId, name, phone, relationship || '', priority || 1]
  );
  res.json(result.rows[0]);
});

app.delete('/api/contacts/:id', authMiddleware, async (req, res) => {
  await pool.query(`DELETE FROM contacts WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  res.json({ ok: true });
});

// ── Medication Routes ─────────────────────────────────────
app.get('/api/medications', authMiddleware, async (req, res) => {
  const result = await pool.query(`SELECT * FROM medications WHERE user_id = $1`, [req.userId]);
  res.json(result.rows);
});

app.post('/api/medications', authMiddleware, async (req, res) => {
  const { name, dosage, frequency, time, stock, unit, low_threshold } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = await pool.query(
    `INSERT INTO medications (user_id, name, dosage, frequency, time, stock, unit, low_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.userId, name, dosage || '', frequency || '', time || '08:00', stock || 30, unit || 'comprimidos', low_threshold || 5]
  );
  res.json(result.rows[0]);
});

app.put('/api/medications/:id', authMiddleware, async (req, res) => {
  const { stock } = req.body;
  const result = await pool.query(
    `UPDATE medications SET stock = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [stock, req.params.id, req.userId]
  );
  res.json(result.rows[0]);
});

app.delete('/api/medications/:id', authMiddleware, async (req, res) => {
  await pool.query(`DELETE FROM medications WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  res.json({ ok: true });
});

// ── Health Entries Routes ─────────────────────────────────
app.get('/api/health', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM health_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [req.userId, parseInt(req.query.limit) || 50]
  );
  res.json(result.rows);
});

// Get health entries for linked elder
app.get('/api/health/elder', authMiddleware, async (req, res) => {
  const user = await pool.query(`SELECT linked_elder_id FROM users WHERE id = $1`, [req.userId]);
  const elderId = user.rows[0]?.linked_elder_id;
  if (!elderId) return res.status(404).json({ error: 'No linked elder' });

  const result = await pool.query(
    `SELECT * FROM health_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [elderId, parseInt(req.query.limit) || 50]
  );
  res.json(result.rows);
});

app.post('/api/health', authMiddleware, async (req, res) => {
  const { type, value, unit, time, date, notes } = req.body;
  const result = await pool.query(
    `INSERT INTO health_entries (user_id, type, value, unit, time, date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.userId, type, value, unit, time, date || new Date().toISOString().slice(0, 10), notes]
  );
  res.json(result.rows[0]);
});

// ── Subscription Routes ───────────────────────────────────
app.put('/api/subscription', authMiddleware, async (req, res) => {
  const { plan } = req.body;
  if (!['free', 'familia', 'central'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  await pool.query(`UPDATE users SET subscription = $1 WHERE id = $2`, [plan, req.userId]);
  res.json({ ok: true });
});

// ── Elder data for family ─────────────────────────────────
app.get('/api/elder-dashboard', authMiddleware, async (req, res) => {
  const user = await pool.query(`SELECT linked_elder_id FROM users WHERE id = $1`, [req.userId]);
  const elderId = user.rows[0]?.linked_elder_id;
  if (!elderId) return res.status(404).json({ error: 'No linked elder' });

  const today = new Date().toISOString().slice(0, 10);
  const [elder, checkins, meds, health, contacts] = await Promise.all([
    pool.query(`SELECT name, phone, subscription, trial_start FROM users WHERE id = $1`, [elderId]),
    pool.query(`SELECT * FROM checkins WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [elderId]),
    pool.query(`SELECT * FROM medications WHERE user_id = $1`, [elderId]),
    pool.query(`SELECT * FROM health_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [elderId]),
    pool.query(`SELECT * FROM contacts WHERE user_id = $1 ORDER BY priority`, [elderId]),
  ]);

  res.json({
    elder: elder.rows[0],
    checkins: checkins.rows,
    medications: meds.rows,
    healthEntries: health.rows,
    contacts: contacts.rows,
    todayCheckins: checkins.rows.filter(c => c.date === today),
  });
});

// ── Helper ────────────────────────────────────────────────
async function getEffectiveSub(userId) {
  const result = await pool.query(`SELECT subscription, trial_start FROM users WHERE id = $1`, [userId]);
  const user = result.rows[0];
  if (!user) return 'free';
  if (user.trial_start && Date.now() - new Date(user.trial_start).getTime() < 30 * 86400000) {
    return 'central';
  }
  return user.subscription;
}

// ── Static Files ──────────────────────────────────────────
app.use(express.static(__dirname));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────
async function start() {
  if (process.env.DATABASE_URL) {
    await initDB();
    console.log('PostgreSQL connected');
  } else {
    console.log('No DATABASE_URL — running without database (localStorage only)');
  }
  app.listen(PORT, () => console.log(`Estou Bem server running on port ${PORT}`));
}

start().catch(err => {
  console.error('Failed to start:', err);
  // Start without DB if connection fails
  app.listen(PORT, () => console.log(`Estou Bem server running on port ${PORT} (no DB)`));
});
