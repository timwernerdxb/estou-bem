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

      -- Affiliate password for dashboard login
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS password_hash TEXT;

      -- Affiliate self-registration fields
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS company TEXT;
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS website TEXT;
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS social_media TEXT;
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS pix_key TEXT;

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

      -- Calendar sync
      CREATE TABLE IF NOT EXISTS calendar_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT DEFAULT 'medication' CHECK (type IN ('medication','checkin','appointment','custom')),
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ,
        recurring TEXT, -- 'daily','weekly','monthly',null
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Monthly health reports
      CREATE TABLE IF NOT EXISTS health_reports (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        month TEXT NOT NULL, -- 'YYYY-MM'
        summary JSONB DEFAULT '{}',
        generated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_calendar_user ON calendar_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_health_reports_user ON health_reports(user_id, month);

      CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_medications_user ON medications(user_id);
      CREATE INDEX IF NOT EXISTS idx_health_entries_user ON health_entries(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversions_user ON conversions(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversions_affiliate ON conversions(affiliate_code);
      CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions(affiliate_id);
      CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_records(user_id);

      CREATE TABLE IF NOT EXISTS escalation_alerts (
        id SERIAL PRIMARY KEY,
        elder_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        checkin_id INTEGER REFERENCES checkins(id) ON DELETE CASCADE,
        level INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active' CHECK (status IN ('active','resolved','dismissed')),
        notified_contacts JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_escalation_elder ON escalation_alerts(elder_id);

      CREATE TABLE IF NOT EXISTS push_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        platform TEXT DEFAULT 'unknown',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, token)
      );
      CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO app_settings (key, value) VALUES ('default_commission_rates', '{"trial_started": 5, "subscription_familia": 15, "subscription_central": 25, "recurring_monthly": 0.10}') ON CONFLICT (key) DO NOTHING;
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
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
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

// ── Push Notification Helper ─────────────────────────────
async function sendPushNotifications(tokens, title, body, data = {}, critical = false) {
  if (!tokens.length) return;

  const messages = tokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: critical ? 'critical-alerts' : 'default',
    ...(critical ? { _contentAvailable: true } : {}),
  }));

  // Expo push API accepts up to 100 messages at once
  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      const result = await response.json();
      console.log(`[Push] Sent ${chunk.length} notifications:`, JSON.stringify(result.data?.map(d => d.status) || result));
    } catch (err) {
      console.error('[Push] Error sending notifications:', err.message);
    }
  }
}

// ── Push Token Routes ────────────────────────────────────
// Authenticated version (web app users)
app.post('/api/push-token', authMiddleware, async (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  await pool.query(
    `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, token) DO UPDATE SET platform = $3, created_at = NOW()`,
    [req.userId, token, platform || 'unknown']
  );
  res.json({ ok: true });
});

// Public version for mobile app (accepts email to identify user)
app.post('/api/push-token/register', async (req, res) => {
  const { token, platform, email, user_id } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  let userId = user_id;
  if (!userId && email) {
    const user = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (user.rows[0]) userId = user.rows[0].id;
  }

  if (userId) {
    await pool.query(
      `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO UPDATE SET platform = $3, created_at = NOW()`,
      [userId, token, platform || 'unknown']
    );
  } else {
    // Store token without user_id (can be linked later)
    await pool.query(
      `INSERT INTO push_tokens (token, platform) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [token, platform || 'unknown']
    ).catch(() => {});
  }
  res.json({ ok: true });
});

app.delete('/api/push-token', authMiddleware, async (req, res) => {
  const { token } = req.body;
  if (token) {
    await pool.query('DELETE FROM push_tokens WHERE user_id = $1 AND token = $2', [req.userId, token]);
  }
  res.json({ ok: true });
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
// Public conversion endpoint (for mobile app affiliate tracking without auth)
app.post('/api/conversions/track', async (req, res) => {
  const { event, revenue, affiliate_code, affiliate_channel, partner_id, campaign_id, referrer_user_id, metadata } = req.body;
  if (!event) return res.status(400).json({ error: 'event is required' });
  if (!affiliate_code && !referrer_user_id) return res.status(400).json({ error: 'affiliate_code or referrer_user_id is required' });

  try {
    const result = await pool.query(
      `INSERT INTO conversions (event, revenue, affiliate_code, affiliate_channel, partner_id, campaign_id, referrer_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [event, revenue || 0, affiliate_code, affiliate_channel, partner_id, campaign_id, referrer_user_id, JSON.stringify(metadata || {})]
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
  } catch (err) {
    console.error('Public conversion track error:', err);
    res.status(500).json({ error: 'Failed to track conversion' });
  }
});

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
  const { code, channel, name, email, phone, password, commission_rate } = req.body;
  if (!code || !channel || !name) return res.status(400).json({ error: 'code, channel, and name are required' });

  const pwHash = password ? hashPassword(password) : null;
  try {
    const result = await pool.query(
      `INSERT INTO affiliates (code, channel, name, email, phone, password_hash, commission_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [code, channel, name, email, phone, pwHash, JSON.stringify(commission_rate || {})]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: 'Failed to create affiliate' });
  }
});

// Affiliate self-registration
app.post('/api/affiliates/register', async (req, res) => {
  const { name, email, password, phone, channel = 'influencer', company, website, social_media } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const validChannels = ['influencer', 'paid_media', 'ad_network', 'b2b_partner'];
  const ch = validChannels.includes(channel) ? channel : 'influencer';

  // Generate unique affiliate code: first 3 chars of channel uppercase + 4 random chars
  const prefix = ch.slice(0, 3).toUpperCase();
  const randomChars = crypto.randomBytes(3).toString('hex').slice(0, 4).toUpperCase();
  let code = prefix + randomChars;

  const pwHash = hashPassword(password);

  try {
    // Ensure code uniqueness (retry once if collision)
    const existing = await pool.query(`SELECT id FROM affiliates WHERE code = $1`, [code]);
    if (existing.rows.length > 0) {
      const retry = crypto.randomBytes(3).toString('hex').slice(0, 4).toUpperCase();
      code = prefix + retry;
    }

    const defaultRates = await pool.query("SELECT value FROM app_settings WHERE key = 'default_commission_rates'");
    const commissionRate = defaultRates.rows[0]?.value || {};

    const result = await pool.query(
      `INSERT INTO affiliates (code, channel, name, email, phone, password_hash, is_active, company, website, social_media, commission_rate)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, $10) RETURNING *`,
      [code, ch, name, email.toLowerCase(), phone || null, pwHash, company || null, website || null, social_media || null, JSON.stringify(commissionRate)]
    );

    const affiliate = result.rows[0];
    delete affiliate.password_hash;
    res.json({ ok: true, affiliate });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email or code already exists' });
    console.error('Affiliate registration error:', err);
    res.status(500).json({ error: 'Failed to register affiliate' });
  }
});

// Affiliate login with email + password
app.post('/api/affiliates/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const hash = hashPassword(password);
  const affiliate = await pool.query(
    `SELECT * FROM affiliates WHERE email = $1 AND password_hash = $2 AND is_active = true`,
    [email.toLowerCase(), hash]
  );
  if (affiliate.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

  const token = generateToken('af_' + affiliate.rows[0].id);
  tokens.set(token, 'af_' + affiliate.rows[0].id);

  res.json({ ok: true, token, affiliate: { id: affiliate.rows[0].id, code: affiliate.rows[0].code, name: affiliate.rows[0].name, channel: affiliate.rows[0].channel } });
});

// Authenticated affiliate dashboard
app.get('/api/affiliates/me/dashboard', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const userId = tokens.get(token);
  if (!userId || !String(userId).startsWith('af_')) return res.status(401).json({ error: 'Invalid token' });

  const affiliateId = String(userId).replace('af_', '');
  const affiliate = await pool.query(`SELECT * FROM affiliates WHERE id = $1`, [affiliateId]);
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

// Update affiliate profile (PIX key, phone, etc)
app.put('/api/affiliates/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const userId = tokens.get(token);
  if (!userId || !String(userId).startsWith('af_')) return res.status(401).json({ error: 'Invalid token' });

  const affiliateId = String(userId).replace('af_', '');
  const { pix_key, phone, company, website, social_media } = req.body;

  const result = await pool.query(
    `UPDATE affiliates SET
      pix_key = COALESCE($1, pix_key),
      phone = COALESCE($2, phone),
      company = COALESCE($3, company),
      website = COALESCE($4, website),
      social_media = COALESCE($5, social_media)
    WHERE id = $6 RETURNING id, name, email, phone, pix_key, company, website, social_media`,
    [pix_key, phone, company, website, social_media, affiliateId]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Affiliate not found' });
  res.json(result.rows[0]);
});

// Keep public dashboard for backward compat (admin use only)
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

// ── Calendar Sync Routes (Premium) ───────────────────────
app.get('/api/calendar', authMiddleware, async (req, res) => {
  const sub = await getEffectiveSub(req.userId);
  if (sub === 'free') return res.status(403).json({ error: 'Premium feature — upgrade to Família or Central' });

  const { month } = req.query; // YYYY-MM
  let query = `SELECT * FROM calendar_events WHERE user_id = $1`;
  const params = [req.userId];
  if (month) {
    query += ` AND start_time >= $2 AND start_time < ($2::date + interval '1 month')`;
    params.push(`${month}-01`);
  }
  query += ` ORDER BY start_time`;
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.post('/api/calendar', authMiddleware, async (req, res) => {
  const sub = await getEffectiveSub(req.userId);
  if (sub === 'free') return res.status(403).json({ error: 'Premium feature' });

  const { title, type, start_time, end_time, recurring, notes } = req.body;
  if (!title || !start_time) return res.status(400).json({ error: 'title and start_time are required' });

  const result = await pool.query(
    `INSERT INTO calendar_events (user_id, title, type, start_time, end_time, recurring, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.userId, title, type || 'custom', start_time, end_time, recurring, notes]
  );
  res.json(result.rows[0]);
});

app.delete('/api/calendar/:id', authMiddleware, async (req, res) => {
  await pool.query(`DELETE FROM calendar_events WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  res.json({ ok: true });
});

// Auto-generate calendar events from medications + check-in schedule
app.post('/api/calendar/sync', authMiddleware, async (req, res) => {
  const sub = await getEffectiveSub(req.userId);
  if (sub === 'free') return res.status(403).json({ error: 'Premium feature' });

  // Get meds and settings
  const [meds, settings] = await Promise.all([
    pool.query(`SELECT * FROM medications WHERE user_id = $1`, [req.userId]),
    pool.query(`SELECT * FROM settings WHERE user_id = $1`, [req.userId]),
  ]);

  const today = new Date();
  let created = 0;

  // Create events for next 7 days
  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);

    // Medication events
    for (const med of meds.rows) {
      if (!med.time) continue;
      const [h, m] = med.time.split(':');
      const start = new Date(date);
      start.setHours(parseInt(h), parseInt(m), 0, 0);

      // Check if already exists
      const exists = await pool.query(
        `SELECT id FROM calendar_events WHERE user_id = $1 AND title = $2 AND start_time::date = $3::date`,
        [req.userId, `💊 ${med.name} (${med.dosage || ''})`, dateStr]
      );
      if (exists.rows.length === 0) {
        await pool.query(
          `INSERT INTO calendar_events (user_id, title, type, start_time, recurring)
           VALUES ($1, $2, 'medication', $3, 'daily')`,
          [req.userId, `💊 ${med.name} (${med.dosage || ''})`, start.toISOString()]
        );
        created++;
      }
    }

    // Check-in events
    const checkinTimes = settings.rows[0]?.checkin_times || ['09:00'];
    for (const t of checkinTimes) {
      const [h, m] = t.split(':');
      const start = new Date(date);
      start.setHours(parseInt(h), parseInt(m), 0, 0);

      const exists = await pool.query(
        `SELECT id FROM calendar_events WHERE user_id = $1 AND type = 'checkin' AND start_time::date = $2::date AND title = $3`,
        [req.userId, dateStr, `✅ Check-in ${t}`]
      );
      if (exists.rows.length === 0) {
        await pool.query(
          `INSERT INTO calendar_events (user_id, title, type, start_time, recurring)
           VALUES ($1, $2, 'checkin', $3, 'daily')`,
          [req.userId, `✅ Check-in ${t}`, start.toISOString()]
        );
        created++;
      }
    }
  }

  res.json({ ok: true, created });
});

// ── Monthly Health Report (Central plan) ─────────────────
app.get('/api/health-report/:month', authMiddleware, async (req, res) => {
  const sub = await getEffectiveSub(req.userId);
  if (sub !== 'central') return res.status(403).json({ error: 'Central plan feature' });

  const { month } = req.params; // YYYY-MM

  // Check for existing report
  const existing = await pool.query(
    `SELECT * FROM health_reports WHERE user_id = $1 AND month = $2`,
    [req.userId, month]
  );
  if (existing.rows[0]) return res.json(existing.rows[0]);

  // Generate report
  const startDate = `${month}-01`;
  const [checkins, health, meds] = await Promise.all([
    pool.query(
      `SELECT date, time, status FROM checkins WHERE user_id = $1 AND date >= $2 AND date < ($2::date + interval '1 month')::text ORDER BY date, time`,
      [req.userId, startDate]
    ),
    pool.query(
      `SELECT type, value, unit, date, time FROM health_entries WHERE user_id = $1 AND date >= $2 AND date < ($2::date + interval '1 month')::text ORDER BY date, time`,
      [req.userId, startDate]
    ),
    pool.query(`SELECT name, dosage, frequency FROM medications WHERE user_id = $1`, [req.userId]),
  ]);

  const user = await pool.query(`SELECT name, phone FROM users WHERE id = $1`, [req.userId]);

  // Aggregate stats
  const totalCheckins = checkins.rows.length;
  const confirmedCheckins = checkins.rows.filter(c => c.status === 'confirmed').length;
  const missedCheckins = checkins.rows.filter(c => c.status === 'missed').length;

  // Group health data by type
  const healthByType = {};
  for (const h of health.rows) {
    if (!healthByType[h.type]) healthByType[h.type] = [];
    healthByType[h.type].push({ value: h.value, unit: h.unit, date: h.date, time: h.time });
  }

  // Calculate averages for each health metric
  const healthSummary = {};
  for (const [type, entries] of Object.entries(healthByType)) {
    const values = entries.map(e => e.value).filter(v => v != null);
    healthSummary[type] = {
      count: entries.length,
      avg: values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      unit: entries[0]?.unit,
      entries,
    };
  }

  const summary = {
    patient: user.rows[0]?.name,
    month,
    generated: new Date().toISOString(),
    checkins: { total: totalCheckins, confirmed: confirmedCheckins, missed: missedCheckins, rate: totalCheckins ? ((confirmedCheckins / totalCheckins) * 100).toFixed(0) + '%' : 'N/A' },
    health: healthSummary,
    medications: meds.rows,
    daily_log: checkins.rows,
  };

  // Save report
  await pool.query(
    `INSERT INTO health_reports (user_id, month, summary) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, month) DO UPDATE SET summary = $3, generated_at = NOW()`,
    [req.userId, month, JSON.stringify(summary)]
  ).catch(() => {
    // unique constraint might not exist yet, just insert
    pool.query(
      `INSERT INTO health_reports (user_id, month, summary) VALUES ($1, $2, $3)`,
      [req.userId, month, JSON.stringify(summary)]
    ).catch(() => {});
  });

  res.json({ id: null, user_id: req.userId, month, summary, generated_at: new Date().toISOString() });
});

// Get health report for elder (family view)
app.get('/api/health-report/elder/:month', authMiddleware, async (req, res) => {
  const user = await pool.query(`SELECT linked_elder_id FROM users WHERE id = $1`, [req.userId]);
  const elderId = user.rows[0]?.linked_elder_id;
  if (!elderId) return res.status(404).json({ error: 'No linked elder' });

  // Redirect to elder's report generation
  req.userId = elderId;
  const sub = await getEffectiveSub(elderId);
  if (sub !== 'central') return res.status(403).json({ error: 'Elder needs Central plan' });

  // Reuse same logic - generate for elder
  const { month } = req.params;
  const existing = await pool.query(
    `SELECT * FROM health_reports WHERE user_id = $1 AND month = $2`,
    [elderId, month]
  );
  if (existing.rows[0]) return res.json(existing.rows[0]);

  res.status(404).json({ error: 'Report not yet generated. Ask elder to generate it first.' });
});

// ── Admin Auth Middleware ──────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'estoubem-admin-2024';

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-Admin-Key' });
  }
  next();
}

// ── Admin API Routes ──────────────────────────────────────

// GET /api/admin/stats - overview stats
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const [
      usersByRole,
      todayCheckins,
      subscriptions,
      totalRevenue,
      activeAffiliates,
      pendingCommissions,
      activeProviders
    ] = await Promise.all([
      pool.query(`SELECT role, COUNT(*)::int as count FROM users GROUP BY role`),
      pool.query(`SELECT COUNT(*)::int as count FROM checkins WHERE date = $1`, [new Date().toISOString().slice(0, 10)]),
      pool.query(`SELECT subscription, COUNT(*)::int as count FROM users GROUP BY subscription`),
      pool.query(`SELECT COALESCE(SUM(revenue), 0) as total FROM conversions`),
      pool.query(`SELECT COUNT(*)::int as count FROM affiliates WHERE is_active = true`),
      pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM commissions WHERE status = 'pending'`),
      pool.query(`SELECT COUNT(*)::int as count FROM service_providers WHERE is_active = true`)
    ]);

    res.json({
      users_by_role: usersByRole.rows,
      today_checkins: todayCheckins.rows[0].count,
      subscriptions: subscriptions.rows,
      total_revenue: parseFloat(totalRevenue.rows[0].total),
      active_affiliates: activeAffiliates.rows[0].count,
      pending_commissions: parseFloat(pendingCommissions.rows[0].total),
      active_providers: activeProviders.rows[0].count
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/users - all users with gamification data
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const { search, role } = req.query;
    let query = `SELECT id, email, name, phone, role, subscription, trial_start, streak_days, total_points, badges, referral_code, referred_by, created_at FROM users WHERE 1=1`;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    if (role) {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/admin/users/:id - full user detail
app.get('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const [user, consent, conversions, referrals] = await Promise.all([
      pool.query(`SELECT id, email, name, phone, role, subscription, trial_start, streak_days, total_points, badges, referral_code, referred_by, linked_elder_id, link_code, utm_source, utm_medium, utm_campaign, created_at FROM users WHERE id = $1`, [userId]),
      pool.query(`SELECT * FROM consent_records WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT * FROM conversions WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      pool.query(`SELECT id, name, email FROM users WHERE referred_by = $1`, [userId])
    ]);

    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    res.json({
      ...user.rows[0],
      consent_records: consent.rows,
      conversions: conversions.rows,
      referrals: referrals.rows
    });
  } catch (err) {
    console.error('Admin user detail error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// GET /api/admin/affiliates - all affiliates
app.get('/api/admin/affiliates', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM affiliates ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin affiliates error:', err);
    res.status(500).json({ error: 'Failed to fetch affiliates' });
  }
});

// PUT /api/admin/affiliates/:id - update affiliate
app.put('/api/admin/affiliates/:id', adminAuth, async (req, res) => {
  try {
    const { is_active, name, email, phone, channel, commission_rate, pix_key } = req.body;
    const result = await pool.query(
      `UPDATE affiliates SET
        is_active = COALESCE($1, is_active),
        name = COALESCE($2, name),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        channel = COALESCE($5, channel),
        commission_rate = COALESCE($6, commission_rate),
        pix_key = COALESCE($7, pix_key)
      WHERE id = $8 RETURNING *`,
      [is_active, name, email, phone, channel, commission_rate ? JSON.stringify(commission_rate) : null, pix_key !== undefined ? pix_key : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Affiliate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update affiliate error:', err);
    res.status(500).json({ error: 'Failed to update affiliate' });
  }
});

// GET /api/admin/settings - get app-wide settings
app.get('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM app_settings');
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    console.error('Admin settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/admin/settings - update app-wide settings
app.put('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const { key, value } = req.body;
    await pool.query(
      'INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      [key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// POST /api/admin/affiliates/bulk - bulk action on affiliates
app.post('/api/admin/affiliates/bulk', adminAuth, async (req, res) => {
  try {
    const { ids, action, commission_rate } = req.body;
    if (!ids || !Array.isArray(ids) || !action) return res.status(400).json({ error: 'ids array and action required' });

    if (action === 'activate') {
      await pool.query('UPDATE affiliates SET is_active = true WHERE id = ANY($1)', [ids]);
    } else if (action === 'deactivate') {
      await pool.query('UPDATE affiliates SET is_active = false WHERE id = ANY($1)', [ids]);
    } else if (action === 'set_commission' && commission_rate) {
      await pool.query('UPDATE affiliates SET commission_rate = $1 WHERE id = ANY($2)', [JSON.stringify(commission_rate), ids]);
    } else if (action === 'apply_defaults') {
      const defaults = await pool.query("SELECT value FROM app_settings WHERE key = 'default_commission_rates'");
      if (defaults.rows[0]) {
        await pool.query('UPDATE affiliates SET commission_rate = $1 WHERE id = ANY($2)', [JSON.stringify(defaults.rows[0].value), ids]);
      }
    }

    res.json({ ok: true, affected: ids.length });
  } catch (err) {
    console.error('Admin bulk affiliates error:', err);
    res.status(500).json({ error: 'Failed to perform bulk action' });
  }
});

// GET /api/admin/commissions - all commissions with affiliate and conversion details
app.get('/api/admin/commissions', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT c.*, a.name as affiliate_name, a.code as affiliate_code, cv.event, cv.revenue as conversion_revenue, cv.user_id as conversion_user_id
      FROM commissions c
      LEFT JOIN affiliates a ON c.affiliate_id = a.id
      LEFT JOIN conversions cv ON c.conversion_id = cv.id
      WHERE 1=1`;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }

    query += ` ORDER BY c.created_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin commissions error:', err);
    res.status(500).json({ error: 'Failed to fetch commissions' });
  }
});

// PUT /api/admin/commissions/:id - update commission status
app.put('/api/admin/commissions/:id', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !['pending', 'approved', 'paid', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: pending, approved, paid, or rejected' });
    }

    const updates = [status, req.params.id];
    let query = `UPDATE commissions SET status = $1`;
    if (status === 'paid') {
      query += `, paid_at = NOW()`;
    }
    query += ` WHERE id = $2 RETURNING *`;

    const result = await pool.query(query, updates);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Commission not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update commission error:', err);
    res.status(500).json({ error: 'Failed to update commission' });
  }
});

// GET /api/admin/providers - all service providers
app.get('/api/admin/providers', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM service_providers ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin providers error:', err);
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

// POST /api/admin/providers - create provider
app.post('/api/admin/providers', adminAuth, async (req, res) => {
  try {
    const { type, name, description, api_endpoint, commission_rate, is_active, metadata } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'type and name are required' });

    const result = await pool.query(
      `INSERT INTO service_providers (type, name, description, api_endpoint, commission_rate, is_active, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [type, name, description, api_endpoint, commission_rate || 0.15, is_active !== false, JSON.stringify(metadata || {})]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin create provider error:', err);
    res.status(500).json({ error: 'Failed to create provider' });
  }
});

// PUT /api/admin/providers/:id - update provider
app.put('/api/admin/providers/:id', adminAuth, async (req, res) => {
  try {
    const { type, name, description, api_endpoint, commission_rate, is_active, metadata } = req.body;
    const result = await pool.query(
      `UPDATE service_providers SET
        type = COALESCE($1, type),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        api_endpoint = COALESCE($4, api_endpoint),
        commission_rate = COALESCE($5, commission_rate),
        is_active = COALESCE($6, is_active),
        metadata = COALESCE($7, metadata)
      WHERE id = $8 RETURNING *`,
      [type, name, description, api_endpoint, commission_rate, is_active, metadata ? JSON.stringify(metadata) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update provider error:', err);
    res.status(500).json({ error: 'Failed to update provider' });
  }
});

// DELETE /api/admin/providers/:id - delete provider
app.delete('/api/admin/providers/:id', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM service_providers WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete provider error:', err);
    res.status(500).json({ error: 'Failed to delete provider' });
  }
});

// GET /api/admin/bookings - all bookings with user and provider names
app.get('/api/admin/bookings', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT b.*, u.name as user_name, u.email as user_email, sp.name as provider_name
      FROM service_bookings b
      LEFT JOIN users u ON b.user_id = u.id
      LEFT JOIN service_providers sp ON b.provider_id = sp.id
      WHERE 1=1`;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND b.status = $${params.length}`;
    }

    query += ` ORDER BY b.created_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// GET /api/admin/institutions - all institutions
app.get('/api/admin/institutions', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM institutions ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin institutions error:', err);
    res.status(500).json({ error: 'Failed to fetch institutions' });
  }
});

// PUT /api/admin/institutions/:id - update institution
app.put('/api/admin/institutions/:id', adminAuth, async (req, res) => {
  try {
    const { name, type, contact_name, contact_email, contact_phone, contract_value, max_users, is_active } = req.body;
    const result = await pool.query(
      `UPDATE institutions SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        contact_name = COALESCE($3, contact_name),
        contact_email = COALESCE($4, contact_email),
        contact_phone = COALESCE($5, contact_phone),
        contract_value = COALESCE($6, contract_value),
        max_users = COALESCE($7, max_users),
        is_active = COALESCE($8, is_active)
      WHERE id = $9 RETURNING *`,
      [name, type, contact_name, contact_email, contact_phone, contract_value, max_users, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Institution not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update institution error:', err);
    res.status(500).json({ error: 'Failed to update institution' });
  }
});

// DELETE /api/admin/institutions/:id - delete institution
app.delete('/api/admin/institutions/:id', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM institutions WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Institution not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete institution error:', err);
    res.status(500).json({ error: 'Failed to delete institution' });
  }
});

// GET /api/admin/conversions - all conversions with user name
app.get('/api/admin/conversions', adminAuth, async (req, res) => {
  try {
    const { event } = req.query;
    let query = `SELECT cv.*, u.name as user_name, u.email as user_email
      FROM conversions cv
      LEFT JOIN users u ON cv.user_id = u.id
      WHERE 1=1`;
    const params = [];

    if (event) {
      params.push(event);
      query += ` AND cv.event = $${params.length}`;
    }

    query += ` ORDER BY cv.created_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin conversions error:', err);
    res.status(500).json({ error: 'Failed to fetch conversions' });
  }
});

// GET /api/admin/consent - all consent records with user name
app.get('/api/admin/consent', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cr.*, u.name as user_name, u.email as user_email
       FROM consent_records cr
       LEFT JOIN users u ON cr.user_id = u.id
       ORDER BY cr.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Admin consent error:', err);
    res.status(500).json({ error: 'Failed to fetch consent records' });
  }
});

// GET /api/admin/gamification/leaderboard - top users by points
app.get('/api/admin/gamification/leaderboard', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, streak_days, total_points, badges
       FROM users
       WHERE total_points > 0
       ORDER BY total_points DESC, streak_days DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Admin leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ── Escalation Admin Endpoints ────────────────────────────
app.get('/api/admin/escalations', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ea.*, u.name as elder_name, u.phone as elder_phone
      FROM escalation_alerts ea
      JOIN users u ON ea.elder_id = u.id
      ORDER BY ea.created_at DESC LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin escalations error:', err);
    res.status(500).json({ error: 'Failed to fetch escalations' });
  }
});

app.put('/api/admin/escalations/:id/resolve', adminAuth, async (req, res) => {
  try {
    await pool.query(`UPDATE escalation_alerts SET status = 'resolved' WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Resolve escalation error:', err);
    res.status(500).json({ error: 'Failed to resolve escalation' });
  }
});

// ── Static Files ──────────────────────────────────────────
app.use(express.static(__dirname));

// Admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Affiliate partner dashboard
app.get('/affiliate', (req, res) => {
  res.sendFile(path.join(__dirname, 'affiliate.html'));
});
app.get('/parceiro', (req, res) => {
  res.sendFile(path.join(__dirname, 'affiliate.html'));
});

// Invite landing page (redirect to app or show download)
app.get('/invite', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Marketing landing page
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────
async function start() {
  if (process.env.DATABASE_URL) {
    await initDB();
    console.log('PostgreSQL connected');
    // Start check-in monitoring cron (every 2 minutes)
    setInterval(checkMissedCheckins, 2 * 60 * 1000);
    // Run immediately on startup to catch any missed during downtime
    setTimeout(checkMissedCheckins, 5000);
    console.log('Check-in escalation monitor started (every 2 min)');
  } else {
    console.log('No DATABASE_URL — running without database (localStorage only)');
  }
  app.listen(PORT, () => console.log(`Estou Bem server running on port ${PORT}`));
}

// ── Check-in Escalation Monitor ──────────────────────────
async function checkMissedCheckins() {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    // Get all elder users with their settings
    const elders = await pool.query(`
      SELECT u.id, u.name, u.phone,
             s.checkin_mode, s.checkin_times, s.checkin_interval_hours,
             s.checkin_window_start, s.checkin_window_end
      FROM users u
      LEFT JOIN settings s ON s.user_id = u.id
      WHERE u.role = 'elder'
    `);

    for (const elder of elders.rows) {
      const mode = elder.checkin_mode || 'scheduled';
      const windowStart = elder.checkin_window_start || '07:00';
      const windowEnd = elder.checkin_window_end || '22:00';
      const intervalHours = elder.checkin_interval_hours || 2;
      const checkinTimes = elder.checkin_times || ['09:00'];

      const windowStartMin = parseInt(windowStart.split(':')[0]) * 60 + parseInt(windowStart.split(':')[1]);
      const windowEndMin = parseInt(windowEnd.split(':')[0]) * 60 + parseInt(windowEnd.split(':')[1]);

      // Skip if outside active window
      if (nowMinutes < windowStartMin || nowMinutes > windowEndMin) continue;

      if (mode === 'scheduled') {
        // Auto-create pending check-ins for today if they don't exist yet
        for (const time of checkinTimes) {
          const existing = await pool.query(
            `SELECT id FROM checkins WHERE user_id = $1 AND date = $2 AND time = $3`,
            [elder.id, today, time]
          );
          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO checkins (user_id, date, time, status) VALUES ($1, $2, $3, 'pending')`,
              [elder.id, today, time]
            );
            console.log(`[Escalation] Auto-created pending check-in for ${elder.name} at ${time}`);
          }
        }

        // Check for overdue check-ins (scheduled time + 30 min grace)
        const pendingCheckins = await pool.query(
          `SELECT id, time FROM checkins WHERE user_id = $1 AND date = $2 AND status = 'pending'`,
          [elder.id, today]
        );

        for (const checkin of pendingCheckins.rows) {
          const [h, m] = checkin.time.split(':').map(Number);
          const scheduledMin = h * 60 + m;
          const overdueMin = nowMinutes - scheduledMin;

          if (overdueMin <= 0) continue;

          // Determine escalation level based on how overdue
          let targetLevel;
          let pushTitle;
          let pushBody;
          if (overdueMin >= 120) {
            targetLevel = 3;
            pushTitle = 'EMERGENCIA!';
            pushBody = `EMERGENCIA: ${elder.name} nao responde ha 2 horas! Acao imediata necessaria.`;
          } else if (overdueMin >= 60) {
            targetLevel = 2;
            pushTitle = 'Check-in urgente perdido!';
            pushBody = `${elder.name} nao respondeu ao check-in ha mais de 1 hora. Por favor verifique.`;
          } else if (overdueMin >= 30) {
            targetLevel = 1;
            pushTitle = 'Check-in perdido!';
            pushBody = `${elder.name} nao respondeu ao check-in. Verifique se esta tudo bem.`;
          } else {
            continue; // Not yet overdue (within 30 min grace)
          }

          // Mark as missed
          await pool.query(`UPDATE checkins SET status = 'missed' WHERE id = $1`, [checkin.id]);

          // Check if alert already exists for this check-in
          const existingAlert = await pool.query(
            'SELECT id, level FROM escalation_alerts WHERE checkin_id = $1 AND status = $2',
            [checkin.id, 'active']
          );

          const family = await pool.query(
            `SELECT id, name, phone, email FROM users WHERE linked_elder_id = $1`,
            [elder.id]
          );
          const contacts = await pool.query(
            `SELECT id, name, phone, relationship, priority FROM contacts WHERE user_id = $1 ORDER BY priority`,
            [elder.id]
          );

          const notifiedContacts = [
            ...family.rows.map(f => ({ type: 'family', name: f.name, phone: f.phone })),
            ...contacts.rows.map(c => ({ type: 'emergency', name: c.name, phone: c.phone, relationship: c.relationship }))
          ];

          if (existingAlert.rows.length > 0) {
            const currentLevel = existingAlert.rows[0].level;
            if (targetLevel <= currentLevel) continue; // Already at this level or higher

            // Escalate: upgrade level
            await pool.query(
              `UPDATE escalation_alerts SET level = $1, notified_contacts = $2 WHERE id = $3`,
              [targetLevel, JSON.stringify(notifiedContacts), existingAlert.rows[0].id]
            );
            console.log(`[Escalation] UPGRADED to level ${targetLevel} for elder ${elder.name} (ID: ${elder.id}) scheduled at ${checkin.time}`);
          } else {
            // Create new alert at level 1 (or higher if already very overdue)
            await pool.query(
              `INSERT INTO escalation_alerts (elder_id, checkin_id, level, status, notified_contacts)
               VALUES ($1, $2, $3, 'active', $4)`,
              [elder.id, checkin.id, targetLevel, JSON.stringify(notifiedContacts)]
            );
            console.log(`[Escalation] MISSED check-in for elder ${elder.name} (ID: ${elder.id}) scheduled at ${checkin.time} — level ${targetLevel}`);
          }

          console.log(`[Escalation]   Family to notify: ${family.rows.map(f => f.name).join(', ') || 'none'}`);
          console.log(`[Escalation]   Emergency contacts: ${contacts.rows.map(c => `${c.name} (${c.phone})`).join(', ') || 'none'}`);

          // Send push notifications to family members
          const familyTokens = await pool.query(
            `SELECT pt.token FROM push_tokens pt
             JOIN users u ON pt.user_id = u.id
             WHERE u.linked_elder_id = $1`,
            [elder.id]
          );

          if (familyTokens.rows.length > 0) {
            const tokens = familyTokens.rows.map(r => r.token);
            await sendPushNotifications(
              tokens,
              pushTitle,
              pushBody,
              { type: 'missed_checkin', elderId: elder.id, checkinId: checkin.id, level: targetLevel },
              targetLevel >= 2 // critical for level 2+
            );
            console.log(`[Push] Sent ${tokens.length} level-${targetLevel} alerts for ${elder.name}`);
          }

          // Send reminder to the elder themselves
          const elderTokens = await pool.query(
            `SELECT token FROM push_tokens WHERE user_id = $1`,
            [elder.id]
          );
          if (elderTokens.rows.length > 0) {
            await sendPushNotifications(
              elderTokens.rows.map(r => r.token),
              'Voce tem um check-in pendente!',
              'Toque para confirmar que esta tudo bem.',
              { type: 'checkin_reminder', screen: 'Home' },
              false
            );
          }
        }

      } else if (mode === 'interval') {
        // Interval mode: check if last confirmed check-in is too old
        const lastConfirmed = await pool.query(
          `SELECT id, created_at FROM checkins
           WHERE user_id = $1 AND status = 'confirmed'
           ORDER BY created_at DESC LIMIT 1`,
          [elder.id]
        );

        const graceHours = 0.5;
        const maxGapMs = (intervalHours + graceHours) * 60 * 60 * 1000;
        const lastTime = lastConfirmed.rows.length > 0
          ? new Date(lastConfirmed.rows[0].created_at)
          : null;

        const isOverdue = !lastTime || (now - lastTime > maxGapMs);

        // Ensure a pending check-in exists for interval mode
        const pendingExists = await pool.query(
          `SELECT id FROM checkins WHERE user_id = $1 AND date = $2 AND status = 'pending'`,
          [elder.id, today]
        );

        if (pendingExists.rows.length === 0) {
          // Create a pending check-in for interval mode
          const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          await pool.query(
            `INSERT INTO checkins (user_id, date, time, status) VALUES ($1, $2, $3, 'pending')`,
            [elder.id, today, timeStr]
          );
          console.log(`[Escalation] Auto-created interval check-in for ${elder.name} at ${timeStr}`);
        }

        if (isOverdue) {
          // Find the pending check-in to associate with the alert
          const pendingCheckin = await pool.query(
            `SELECT id FROM checkins WHERE user_id = $1 AND date = $2 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
            [elder.id, today]
          );

          if (pendingCheckin.rows.length > 0) {
            const checkinId = pendingCheckin.rows[0].id;

            // Mark as missed
            await pool.query(`UPDATE checkins SET status = 'missed' WHERE id = $1`, [checkinId]);

            // Determine escalation level based on how long overdue
            const overdueMs = lastTime ? (now - lastTime) : Infinity;
            const overdueHours = overdueMs / (60 * 60 * 1000);
            let targetLevel;
            let pushTitle;
            let pushBody;
            if (overdueHours >= 2 + intervalHours || !lastTime) {
              targetLevel = 3;
              pushTitle = 'EMERGENCIA!';
              pushBody = `EMERGENCIA: ${elder.name} nao responde ha muito tempo! Acao imediata necessaria.`;
            } else if (overdueHours >= 1 + intervalHours) {
              targetLevel = 2;
              pushTitle = 'Check-in urgente perdido!';
              pushBody = `${elder.name} nao respondeu ao check-in ha mais de 1 hora. Por favor verifique.`;
            } else {
              targetLevel = 1;
              pushTitle = 'Check-in perdido!';
              pushBody = `${elder.name} nao respondeu ao check-in. Verifique se esta tudo bem.`;
            }

            // Check if alert already exists
            const existingAlert = await pool.query(
              'SELECT id, level FROM escalation_alerts WHERE checkin_id = $1 AND status = $2',
              [checkinId, 'active']
            );

            const family = await pool.query(
              `SELECT id, name, phone, email FROM users WHERE linked_elder_id = $1`,
              [elder.id]
            );
            const contacts = await pool.query(
              `SELECT id, name, phone, relationship, priority FROM contacts WHERE user_id = $1 ORDER BY priority`,
              [elder.id]
            );

            const notifiedContacts = [
              ...family.rows.map(f => ({ type: 'family', name: f.name, phone: f.phone })),
              ...contacts.rows.map(c => ({ type: 'emergency', name: c.name, phone: c.phone, relationship: c.relationship }))
            ];

            if (existingAlert.rows.length > 0) {
              const currentLevel = existingAlert.rows[0].level;
              if (targetLevel <= currentLevel) continue; // Already at this level or higher

              await pool.query(
                `UPDATE escalation_alerts SET level = $1, notified_contacts = $2 WHERE id = $3`,
                [targetLevel, JSON.stringify(notifiedContacts), existingAlert.rows[0].id]
              );
              console.log(`[Escalation] UPGRADED to level ${targetLevel} for elder ${elder.name} (ID: ${elder.id}) — interval mode`);
            } else {
              await pool.query(
                `INSERT INTO escalation_alerts (elder_id, checkin_id, level, status, notified_contacts)
                 VALUES ($1, $2, $3, 'active', $4)`,
                [elder.id, checkinId, targetLevel, JSON.stringify(notifiedContacts)]
              );
              console.log(`[Escalation] MISSED check-in for elder ${elder.name} (ID: ${elder.id}) — interval mode, last confirmed: ${lastTime ? lastTime.toISOString() : 'never'} — level ${targetLevel}`);
            }

            console.log(`[Escalation]   Family to notify: ${family.rows.map(f => f.name).join(', ') || 'none'}`);
            console.log(`[Escalation]   Emergency contacts: ${contacts.rows.map(c => `${c.name} (${c.phone})`).join(', ') || 'none'}`);

            // Send push notifications to family members
            const familyTokens = await pool.query(
              `SELECT pt.token FROM push_tokens pt
               JOIN users u ON pt.user_id = u.id
               WHERE u.linked_elder_id = $1`,
              [elder.id]
            );

            if (familyTokens.rows.length > 0) {
              const tokens = familyTokens.rows.map(r => r.token);
              await sendPushNotifications(
                tokens,
                pushTitle,
                pushBody,
                { type: 'missed_checkin', elderId: elder.id, checkinId: checkinId, level: targetLevel },
                targetLevel >= 2
              );
              console.log(`[Push] Sent ${tokens.length} level-${targetLevel} alerts for ${elder.name}`);
            }

            // Send reminder to the elder themselves
            const elderTokens = await pool.query(
              `SELECT token FROM push_tokens WHERE user_id = $1`,
              [elder.id]
            );
            if (elderTokens.rows.length > 0) {
              await sendPushNotifications(
                elderTokens.rows.map(r => r.token),
                'Voce tem um check-in pendente!',
                'Toque para confirmar que esta tudo bem.',
                { type: 'checkin_reminder', screen: 'Home' },
                false
              );
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[Escalation] Error checking missed check-ins:', err);
  }
}

start().catch(err => {
  console.error('Failed to start:', err);
  // Start without DB if connection fails
  app.listen(PORT, () => console.log(`Estou Bem server running on port ${PORT} (no DB)`));
});
