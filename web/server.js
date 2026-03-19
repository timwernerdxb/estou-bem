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

      -- Conversion tracking
      CREATE TABLE IF NOT EXISTS conversions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        event TEXT NOT NULL,
        revenue REAL DEFAULT 0,
        currency TEXT DEFAULT 'BRL',
        affiliate_code TEXT,
        affiliate_channel TEXT,
        partner_id TEXT,
        campaign_id TEXT,
        referrer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Affiliates / partners
      CREATE TABLE IF NOT EXISTS affiliates (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('influencer','paid_media','ad_network','organic','referral','b2b_partner')),
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        commission_rate JSONB DEFAULT '{}',
        total_earned REAL DEFAULT 0,
        total_conversions INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Commission ledger
      CREATE TABLE IF NOT EXISTS commissions (
        id SERIAL PRIMARY KEY,
        affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
        conversion_id INTEGER REFERENCES conversions(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'BRL',
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- User referral codes
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_id INTEGER REFERENCES affiliates(id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_source TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_medium TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

      -- Auto-checkin settings
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_checkin_mode TEXT DEFAULT 'manual';

      -- Marketplace: service providers
      CREATE TABLE IF NOT EXISTS service_providers (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('pharmacy','telemedicine','caregiver','physiotherapist','nutritionist','transport','meals')),
        name TEXT NOT NULL,
        description TEXT,
        api_endpoint TEXT,
        commission_rate REAL DEFAULT 0.15,
        is_active BOOLEAN DEFAULT true,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Marketplace: service bookings
      CREATE TABLE IF NOT EXISTS service_bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        provider_id INTEGER REFERENCES service_providers(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
        amount REAL DEFAULT 0,
        commission REAL DEFAULT 0,
        scheduled_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- B2B institutional accounts
      CREATE TABLE IF NOT EXISTS institutions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT CHECK (type IN ('health_insurer','ilpi','hospital','clinic')),
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        contract_value REAL,
        max_users INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- LGPD consent tracking
      CREATE TABLE IF NOT EXISTS consent_records (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        consent_type TEXT NOT NULL CHECK (consent_type IN ('terms','privacy','data_sharing','marketing','health_data')),
        granted BOOLEAN NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Gamification
      ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_days INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS total_points INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]';

      CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_medications_user ON medications(user_id);
      CREATE INDEX IF NOT EXISTS idx_health_entries_user ON health_entries(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversions_user ON conversions(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversions_affiliate ON conversions(affiliate_code);
      CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions(affiliate_id);
      CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_records(user_id);
    `);
    console.log('Database initialized');

    // Backfill: create contacts for all existing family→elder links
    const linked = await client.query(`
      SELECT f.id as family_id, f.name as family_name, f.phone as family_phone, f.linked_elder_id
      FROM users f
      WHERE f.linked_elder_id IS NOT NULL AND f.phone IS NOT NULL AND f.phone != ''
    `);
    for (const row of linked.rows) {
      const exists = await client.query(
        `SELECT id FROM contacts WHERE user_id = $1 AND phone = $2`,
        [row.linked_elder_id, row.family_phone]
      );
      if (exists.rows.length === 0) {
        const nextP = await client.query(`SELECT COALESCE(MAX(priority),0)+1 as p FROM contacts WHERE user_id = $1`, [row.linked_elder_id]);
        await client.query(
          `INSERT INTO contacts (user_id, name, phone, relationship, priority) VALUES ($1, $2, $3, $4, $5)`,
          [row.linked_elder_id, row.family_name, row.family_phone, 'Familiar (vinculado)', nextP.rows[0].p]
        );
        console.log(`Backfilled contact: ${row.family_name} → elder ${row.linked_elder_id}`);
      }
    }
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
  const { email, password, name, phone, role, referral_code, utm_source, utm_medium, utm_campaign } = req.body;
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
    // Check referral
    let referredBy = null;
    if (referral_code) {
      const referrer = await pool.query(`SELECT id FROM users WHERE referral_code = $1`, [referral_code]);
      if (referrer.rows[0]) referredBy = referrer.rows[0].id;
    }

    const userRefCode = 'EB' + Math.random().toString(36).toUpperCase().slice(2, 6);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, phone, role, link_code, trial_start, referral_code, referred_by, utm_source, utm_medium, utm_campaign)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11)
       RETURNING id, email, name, phone, role, link_code, subscription, trial_start, referral_code`,
      [email.toLowerCase(), hash, name, phone || '', role, linkCode, userRefCode, referredBy, utm_source, utm_medium, utm_campaign]
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

  // Auto-add family member as emergency contact on the elder's account
  const familyUser = await pool.query(`SELECT name, phone FROM users WHERE id = $1`, [req.userId]);
  if (familyUser.rows[0]?.phone) {
    // Check if this phone isn't already a contact for the elder
    const existing = await pool.query(
      `SELECT id FROM contacts WHERE user_id = $1 AND phone = $2`,
      [elder.rows[0].id, familyUser.rows[0].phone]
    );
    if (existing.rows.length === 0) {
      const nextPriority = await pool.query(`SELECT COALESCE(MAX(priority),0)+1 as p FROM contacts WHERE user_id = $1`, [elder.rows[0].id]);
      await pool.query(
        `INSERT INTO contacts (user_id, name, phone, relationship, priority) VALUES ($1, $2, $3, $4, $5)`,
        [elder.rows[0].id, familyUser.rows[0].name, familyUser.rows[0].phone, 'Familiar (vinculado)', nextPriority.rows[0].p]
      );
    }
  }

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
  // Check if this contact is a linked family member — if so, unlink them too
  const contact = await pool.query(`SELECT phone FROM contacts WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  if (contact.rows[0]) {
    await pool.query(
      `UPDATE users SET linked_elder_id = NULL WHERE linked_elder_id = $1 AND phone = $2`,
      [req.userId, contact.rows[0].phone]
    );
  }
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

// ── Conversion Tracking Routes ────────────────────────────
app.post('/api/conversions', authMiddleware, async (req, res) => {
  const { event, revenue, affiliate_code, affiliate_channel, partner_id, campaign_id, referrer_user_id, metadata } = req.body;
  if (!event) return res.status(400).json({ error: 'event is required' });

  const result = await pool.query(
    `INSERT INTO conversions (user_id, event, revenue, affiliate_code, affiliate_channel, partner_id, campaign_id, referrer_user_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [req.userId, event, revenue || 0, affiliate_code, affiliate_channel, partner_id, campaign_id, referrer_user_id, JSON.stringify(metadata || {})]
  );

  // Auto-create commission if affiliate exists
  if (affiliate_code) {
    const affiliate = await pool.query(`SELECT id, commission_rate FROM affiliates WHERE code = $1 AND is_active = true`, [affiliate_code]);
    if (affiliate.rows[0]) {
      const rates = affiliate.rows[0].commission_rate || {};
      const commissionAmount = rates[event] || 0;
      if (commissionAmount > 0) {
        await pool.query(
          `INSERT INTO commissions (affiliate_id, conversion_id, amount) VALUES ($1, $2, $3)`,
          [affiliate.rows[0].id, result.rows[0].id, commissionAmount]
        );
        await pool.query(
          `UPDATE affiliates SET total_earned = total_earned + $1, total_conversions = total_conversions + 1 WHERE id = $2`,
          [commissionAmount, affiliate.rows[0].id]
        );
      }
    }
  }

  res.json(result.rows[0]);
});

app.get('/api/conversions', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM conversions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.userId]
  );
  res.json(result.rows);
});

// ── Affiliate Routes ─────────────────────────────────────
app.get('/api/affiliates', async (req, res) => {
  const result = await pool.query(`SELECT id, code, channel, name, is_active FROM affiliates WHERE is_active = true`);
  res.json(result.rows);
});

app.post('/api/affiliates', async (req, res) => {
  const { code, channel, name, email, phone, commission_rate } = req.body;
  if (!code || !channel || !name) return res.status(400).json({ error: 'code, channel, and name are required' });

  try {
    const result = await pool.query(
      `INSERT INTO affiliates (code, channel, name, email, phone, commission_rate)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [code, channel, name, email, phone, JSON.stringify(commission_rate || {})]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: 'Failed to create affiliate' });
  }
});

app.get('/api/affiliates/:code/dashboard', async (req, res) => {
  const affiliate = await pool.query(`SELECT * FROM affiliates WHERE code = $1`, [req.params.code]);
  if (affiliate.rows.length === 0) return res.status(404).json({ error: 'Affiliate not found' });

  const commissions = await pool.query(
    `SELECT c.*, cv.event, cv.revenue, cv.created_at as conversion_date
     FROM commissions c JOIN conversions cv ON c.conversion_id = cv.id
     WHERE c.affiliate_id = $1 ORDER BY c.created_at DESC LIMIT 100`,
    [affiliate.rows[0].id]
  );

  const stats = await pool.query(
    `SELECT COUNT(*) as total_conversions, SUM(amount) as total_earned,
     SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount,
     SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as paid_amount
     FROM commissions WHERE affiliate_id = $1`,
    [affiliate.rows[0].id]
  );

  res.json({
    affiliate: affiliate.rows[0],
    commissions: commissions.rows,
    stats: stats.rows[0],
  });
});

// ── Referral Routes ──────────────────────────────────────
app.get('/api/referral-code', authMiddleware, async (req, res) => {
  let user = await pool.query(`SELECT referral_code FROM users WHERE id = $1`, [req.userId]);
  if (!user.rows[0].referral_code) {
    const code = 'EB' + Math.random().toString(36).toUpperCase().slice(2, 6);
    await pool.query(`UPDATE users SET referral_code = $1 WHERE id = $2`, [code, req.userId]);
    return res.json({ code });
  }
  res.json({ code: user.rows[0].referral_code });
});

app.post('/api/referral/apply', authMiddleware, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Referral code required' });

  const referrer = await pool.query(`SELECT id, name FROM users WHERE referral_code = $1`, [code]);
  if (referrer.rows.length === 0) return res.status(404).json({ error: 'Invalid referral code' });
  if (referrer.rows[0].id === req.userId) return res.status(400).json({ error: 'Cannot refer yourself' });

  await pool.query(`UPDATE users SET referred_by = $1 WHERE id = $2`, [referrer.rows[0].id, req.userId]);
  res.json({ ok: true, referrerName: referrer.rows[0].name });
});

// ── Service Provider / Marketplace Routes ────────────────
app.get('/api/marketplace/providers', async (req, res) => {
  const { type } = req.query;
  let query = `SELECT * FROM service_providers WHERE is_active = true`;
  const params = [];
  if (type) { query += ` AND type = $1`; params.push(type); }
  query += ` ORDER BY name`;
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.post('/api/marketplace/bookings', authMiddleware, async (req, res) => {
  const { provider_id, type, amount, scheduled_at, notes } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });

  let commission = 0;
  if (provider_id && amount) {
    const provider = await pool.query(`SELECT commission_rate FROM service_providers WHERE id = $1`, [provider_id]);
    commission = (provider.rows[0]?.commission_rate || 0.15) * amount;
  }

  const result = await pool.query(
    `INSERT INTO service_bookings (user_id, provider_id, type, amount, commission, scheduled_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.userId, provider_id, type, amount || 0, commission, scheduled_at, notes]
  );
  res.json(result.rows[0]);
});

app.get('/api/marketplace/bookings', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT b.*, sp.name as provider_name FROM service_bookings b
     LEFT JOIN service_providers sp ON b.provider_id = sp.id
     WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
    [req.userId]
  );
  res.json(result.rows);
});

// ── B2B / Institutional Routes ───────────────────────────
app.get('/api/institutions', async (req, res) => {
  const result = await pool.query(`SELECT * FROM institutions WHERE is_active = true ORDER BY name`);
  res.json(result.rows);
});

app.post('/api/institutions', async (req, res) => {
  const { name, type, contact_name, contact_email, contact_phone, contract_value, max_users } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  const result = await pool.query(
    `INSERT INTO institutions (name, type, contact_name, contact_email, contact_phone, contract_value, max_users)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [name, type, contact_name, contact_email, contact_phone, contract_value, max_users]
  );
  res.json(result.rows[0]);
});

// ── LGPD Consent Routes ─────────────────────────────────
app.post('/api/consent', authMiddleware, async (req, res) => {
  const { consent_type, granted } = req.body;
  if (!consent_type || granted === undefined) return res.status(400).json({ error: 'consent_type and granted are required' });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ua = req.headers['user-agent'];

  await pool.query(
    `INSERT INTO consent_records (user_id, consent_type, granted, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)`,
    [req.userId, consent_type, granted, ip, ua]
  );
  res.json({ ok: true });
});

app.get('/api/consent', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT ON (consent_type) consent_type, granted, created_at
     FROM consent_records WHERE user_id = $1 ORDER BY consent_type, created_at DESC`,
    [req.userId]
  );
  res.json(result.rows);
});

// ── Gamification Routes ──────────────────────────────────
app.get('/api/gamification', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT streak_days, total_points, badges FROM users WHERE id = $1`,
    [req.userId]
  );
  res.json(result.rows[0] || { streak_days: 0, total_points: 0, badges: [] });
});

app.post('/api/gamification/checkin-reward', authMiddleware, async (req, res) => {
  // Award points for check-in, update streak
  const user = await pool.query(`SELECT streak_days, total_points, badges FROM users WHERE id = $1`, [req.userId]);
  const u = user.rows[0];
  const today = new Date().toISOString().slice(0, 10);

  // Check if checked in yesterday for streak
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const yesterdayCheckin = await pool.query(
    `SELECT id FROM checkins WHERE user_id = $1 AND date = $2 AND status = 'confirmed'`,
    [req.userId, yesterday]
  );

  const newStreak = yesterdayCheckin.rows.length > 0 ? (u.streak_days || 0) + 1 : 1;
  const points = 10 + (newStreak >= 7 ? 5 : 0) + (newStreak >= 30 ? 10 : 0);

  // Check for new badges
  const badges = u.badges || [];
  if (newStreak >= 7 && !badges.includes('streak_7')) badges.push('streak_7');
  if (newStreak >= 30 && !badges.includes('streak_30')) badges.push('streak_30');
  if (newStreak >= 100 && !badges.includes('streak_100')) badges.push('streak_100');

  await pool.query(
    `UPDATE users SET streak_days = $1, total_points = total_points + $2, badges = $3 WHERE id = $4`,
    [newStreak, points, JSON.stringify(badges), req.userId]
  );

  res.json({ streak: newStreak, pointsEarned: points, totalPoints: (u.total_points || 0) + points, badges });
});

// ── Postback endpoint for ad networks ────────────────────
app.get('/api/postback/install', async (req, res) => {
  const { clickid, af_siteid, af_sub1 } = req.query;
  console.log(`[Postback] Install: clickid=${clickid} siteid=${af_siteid} sub1=${af_sub1}`);
  // Log for attribution
  if (af_siteid || af_sub1) {
    await pool.query(
      `INSERT INTO conversions (event, affiliate_code, partner_id, metadata)
       VALUES ('app_install', $1, $2, $3)`,
      [af_sub1 || af_siteid, af_siteid, JSON.stringify({ clickid, ...req.query })]
    ).catch(() => {});
  }
  res.status(200).send('OK');
});

app.get('/api/postback/event', async (req, res) => {
  const { clickid, event_name, revenue } = req.query;
  console.log(`[Postback] Event: ${event_name} clickid=${clickid} revenue=${revenue}`);
  res.status(200).send('OK');
});

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
