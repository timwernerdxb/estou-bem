const express = require('express');
const { Pool, Client } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const path = require('path');
const http = require('http');

// Twilio — graceful fallback if not installed
let twilioValidateRequest;
try {
  const twilio = require('twilio');
  twilioValidateRequest = twilio.validateRequest;
} catch (e) {
  console.warn('[Twilio] twilio package not installed. Webhook signature validation disabled.');
}

const BCRYPT_ROUNDS = 12;

// WebSocket — graceful fallback if not installed
let WebSocket;
try { WebSocket = require('ws'); } catch (e) {
  console.warn('[WS] ws package not installed. WebSocket support disabled. Run: npm install ws');
}

const PORT = process.env.PORT || 3000;

// ── Configuration (env vars with secure defaults) ──────────
const SERVER_URL = process.env.SERVER_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : 'http://localhost:' + PORT);
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || '+12627472376';
const FROM_EMAIL = process.env.FROM_EMAIL || 'alertas@estoubem.com';
const SAMU_NUMBER = process.env.SAMU_NUMBER || '+55192';

// ── Security: Generate random secrets if not set ───────────
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const generated = crypto.randomBytes(32).toString('hex');
  console.log(`[SECURITY] No JWT_SECRET set. Generated temporary secret. Set JWT_SECRET env var for production.`);
  return generated;
})();

const ADMIN_KEY = (() => {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  const generated = crypto.randomBytes(24).toString('hex');
  console.log(`[ADMIN] No ADMIN_KEY set. Generated temporary key: ${generated}. Set ADMIN_KEY env var for production.`);
  return generated;
})();

// ── CORS whitelist ─────────────────────────────────────────
function isAllowedOrigin(origin) {
  if (!origin) return true; // Allow same-origin requests (no Origin header)
  const allowed = [
    'http://localhost:3333',
    'http://localhost:8081',
    SERVER_URL,
  ];
  // Add RAILWAY_PUBLIC_DOMAIN variants
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    allowed.push('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);
  }
  // Add SERVER_URL env var domain
  if (process.env.SERVER_URL) {
    allowed.push(process.env.SERVER_URL);
  }
  return allowed.includes(origin);
}

// ── Async route wrapper (catches unhandled promise rejections) ──
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const app = express();
const server = http.createServer(app);

// ── WebSocket Server ──────────────────────────────────────
const wsClients = new Map(); // userId (string) -> Set<WebSocket>
let wss = null;

if (WebSocket) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const userId = url.searchParams.get('userId');
    const role = url.searchParams.get('role');

    if (userId) {
      if (!wsClients.has(userId)) wsClients.set(userId, new Set());
      wsClients.get(userId).add(ws);
      console.log(`[WS] Client connected: userId=${userId} role=${role}`);
    }

    ws.on('close', () => {
      if (userId && wsClients.has(userId)) {
        wsClients.get(userId).delete(ws);
        if (wsClients.get(userId).size === 0) wsClients.delete(userId);
        console.log(`[WS] Client disconnected: userId=${userId}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client error userId=${userId}:`, err.message);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch (e) { /* ignore malformed */ }
    });
  });

  console.log('[WS] WebSocket server initialized on /ws');
}

// Send alert to a specific user via WebSocket
function sendWsAlert(userId, alert) {
  if (!WebSocket) return 0;
  const clients = wsClients.get(String(userId));
  if (!clients) return 0;
  let sent = 0;
  const payload = JSON.stringify(alert);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      sent++;
    }
  }
  return sent;
}

// Send alert to all family members of an elder via WebSocket
async function sendWsAlertToFamily(elderId, alert) {
  if (!WebSocket) return 0;
  const family = await pool.query('SELECT id FROM users WHERE linked_elder_id = $1', [elderId]);
  let total = 0;
  for (const f of family.rows) {
    total += sendWsAlert(f.id, alert);
  }
  return total;
}

// ── Email Notifications via Resend ────────────────────────
async function sendEmail(to, subject, html) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.RESEND_KEY;
  if (!RESEND_API_KEY) {
    console.log(`[Email] No RESEND_API_KEY/RESEND_KEY set. Would send to ${to}: ${subject}`);
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Estou Bem <${FROM_EMAIL}>`,
        to,
        subject,
        html,
      }),
    });
    const result = await res.json();
    if (res.ok) {
      console.log(`[Email] Sent to ${to}: ${subject} (id: ${result.id})`);
    } else {
      console.error(`[Email] Failed to ${to}: ${subject}`, result.error || result);
    }
    return res.ok;
  } catch (err) {
    console.error(`[Email] Error sending to ${to}:`, err.message);
    return false;
  }
}

// Build escalation email HTML
function buildEscalationEmailHtml(elderName, alertTitle, alertLevel) {
  return `
    <div style="font-family:'Inter',sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#F5F0EB;border-radius:8px">
      <div style="text-align:center;margin-bottom:20px">
        <span style="font-family:Georgia,serif;font-size:24px;color:#2D4A3E">Estou Bem</span>
      </div>
      <div style="background:white;padding:24px;border-radius:4px;border:1px solid #E5DDD3">
        <h2 style="color:${alertLevel >= 3 ? '#8B3A3A' : '#C9A96E'};margin:0 0 12px">${alertTitle}</h2>
        <p style="color:#5C5549;line-height:1.6">${elderName} nao respondeu ao check-in agendado. Por favor verifique se esta tudo bem.</p>
        <p style="color:#9A9189;font-size:13px;margin-top:16px">Nivel de alerta: ${alertLevel}/3</p>
      </div>
      <p style="text-align:center;color:#9A9189;font-size:12px;margin-top:16px">Estou Bem — Cuidado Senior</p>
    </div>
  `;
}

// Send escalation emails + log to email_alerts table
async function sendEscalationEmails(familyRows, elder, alertTitle, alertLevel) {
  for (const fm of familyRows) {
    if (fm.email) {
      const html = buildEscalationEmailHtml(elder.name, alertTitle, alertLevel);
      const sent = await sendEmail(fm.email, alertTitle, html);
      // Log to email_alerts table
      try {
        await pool.query(
          `INSERT INTO email_alerts (recipient_email, subject, related_user_id, alert_type) VALUES ($1, $2, $3, $4)`,
          [fm.email, alertTitle, elder.id, 'escalation']
        );
      } catch (logErr) {
        console.error('[Email] Failed to log email alert:', logErr.message);
      }
    }
  }
}

// ── PG LISTEN/NOTIFY — Escalation Check Scheduler ─────────
const pendingEscalationTimers = new Map(); // checkinId -> timeout handle

function scheduleEscalationCheck(checkinId, userId) {
  // If already scheduled, skip
  if (pendingEscalationTimers.has(checkinId)) return;

  // Check after 30 min (the grace period) — if still pending, the main
  // checkMissedCheckins logic handles escalation levels
  const timer = setTimeout(async () => {
    pendingEscalationTimers.delete(checkinId);
    try {
      const result = await pool.query(
        'SELECT id, status FROM checkins WHERE id = $1',
        [checkinId]
      );
      if (result.rows.length > 0 && result.rows[0].status === 'pending') {
        console.log(`[PG NOTIFY] Check-in ${checkinId} still pending after 30min — triggering escalation check`);
        await checkMissedCheckins();
      }
    } catch (err) {
      console.error(`[PG NOTIFY] Error checking escalation for checkin ${checkinId}:`, err.message);
    }
  }, 30 * 60 * 1000); // 30 minutes

  pendingEscalationTimers.set(checkinId, timer);
  console.log(`[PG NOTIFY] Scheduled escalation check for checkin ${checkinId} in 30 minutes`);
}

// Start PG LISTEN/NOTIFY listener (dedicated connection)
async function startPgListener() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) return;

  const listenerClient = new Client({
    connectionString: connStr,
    ssl: connStr.includes('railway') ? { rejectUnauthorized: false } : false,
  });

  try {
    await listenerClient.connect();
    await listenerClient.query('LISTEN checkin_events');

    listenerClient.on('notification', async (msg) => {
      try {
        const payload = JSON.parse(msg.payload);
        console.log('[PG NOTIFY] Check-in event:', payload.action, 'checkin_id:', payload.checkin_id, 'status:', payload.status);

        if (payload.status === 'pending') {
          scheduleEscalationCheck(payload.checkin_id, payload.user_id);
        } else if (payload.status === 'confirmed' || payload.status === 'missed') {
          // Cancel pending escalation timer if check-in was confirmed or already handled
          const timer = pendingEscalationTimers.get(payload.checkin_id);
          if (timer) {
            clearTimeout(timer);
            pendingEscalationTimers.delete(payload.checkin_id);
            console.log(`[PG NOTIFY] Cancelled escalation timer for checkin ${payload.checkin_id} (status: ${payload.status})`);
          }

          // Notify family via WebSocket that check-in was confirmed
          if (payload.status === 'confirmed') {
            await sendWsAlertToFamily(payload.user_id, {
              type: 'checkin_confirmed',
              userId: payload.user_id,
              checkinId: payload.checkin_id,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (parseErr) {
        console.error('[PG NOTIFY] Error parsing notification:', parseErr.message);
      }
    });

    listenerClient.on('error', (err) => {
      console.error('[PG Listener] Connection error:', err.message);
      // Reconnect after 5 seconds
      setTimeout(startPgListener, 5000);
    });

    console.log('[PG Listener] Listening for checkin_events');
  } catch (err) {
    console.error('[PG Listener] Failed to connect:', err.message);
    setTimeout(startPgListener, 5000);
  }
}

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
        confirmed_at TIMESTAMPTZ,
        escalation_level INTEGER DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS emergency_contacts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        relationship TEXT,
        priority INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS family_contacts (
        id SERIAL PRIMARY KEY,
        elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        relationship TEXT,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
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

      -- Flexible commission models
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS commission_model TEXT DEFAULT 'percentage' CHECK (commission_model IN ('percentage','fixed_fee','hybrid','ramp_up'));
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS fixed_fee REAL DEFAULT 0;
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS ramp_up_tiers JSONB DEFAULT '[]';
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS period_sales INTEGER DEFAULT 0;

      -- Referral rewards
      CREATE TABLE IF NOT EXISTS referral_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reward_type TEXT DEFAULT 'free_month',
        referral_count INTEGER DEFAULT 0,
        applied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- User referral codes
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_id INTEGER REFERENCES affiliates(id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_reward_count INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS free_months_earned INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_source TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_medium TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

      -- Auto-checkin settings
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_checkin_mode TEXT DEFAULT 'manual';

      -- Contact type unification (family, emergency, caregiver)
      ALTER TABLE emergency_contacts ADD COLUMN IF NOT EXISTS contact_type TEXT DEFAULT 'emergency';
      ALTER TABLE family_contacts ADD COLUMN IF NOT EXISTS contact_type TEXT DEFAULT 'family';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_type TEXT DEFAULT 'emergency';

      -- Medication low stock alert tracking (one alert per day per medication)
      CREATE TABLE IF NOT EXISTS medication_alerts (
        id SERIAL PRIMARY KEY,
        medication_id INTEGER REFERENCES medications(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        alert_date DATE NOT NULL DEFAULT CURRENT_DATE,
        alert_type TEXT DEFAULT 'low_stock',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(medication_id, alert_date, alert_type)
      );
      CREATE INDEX IF NOT EXISTS idx_medication_alerts_med ON medication_alerts(medication_id, alert_date);

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

      -- Payout requests (PIX)
      CREATE TABLE IF NOT EXISTS payout_requests (
        id SERIAL PRIMARY KEY,
        affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        pix_key TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
        admin_notes TEXT,
        requested_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_payout_requests_affiliate ON payout_requests(affiliate_id);

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

      -- Health readings (SpO2, heart rate, sleep, steps, movement from watch)
      CREATE TABLE IF NOT EXISTS health_readings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reading_type VARCHAR(20) NOT NULL,
        value DECIMAL NOT NULL,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_health_readings_user ON health_readings(user_id);
      CREATE INDEX IF NOT EXISTS idx_health_readings_type ON health_readings(user_id, reading_type);

      -- Activity logs for inactivity detection
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        last_movement_at TIMESTAMPTZ DEFAULT NOW(),
        movement_count_1h INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);

      -- Email alerts tracking
      CREATE TABLE IF NOT EXISTS email_alerts (
        id SERIAL PRIMARY KEY,
        recipient_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        related_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        alert_type TEXT DEFAULT 'escalation',
        sent_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_email_alerts_user ON email_alerts(related_user_id);

      -- Sessions table (DB-based token store)
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        ip_address VARCHAR(50)
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      -- Password reset tokens
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token);

      -- Fall detection events
      CREATE TABLE IF NOT EXISTS fall_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        detected_at TIMESTAMPTZ DEFAULT NOW(),
        confirmed_fall BOOLEAN DEFAULT true,
        cancelled_by_user BOOLEAN DEFAULT false,
        location_lat DECIMAL,
        location_lng DECIMAL,
        heart_rate INTEGER,
        escalation_level INTEGER DEFAULT 0,
        resolved_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_fall_events_user ON fall_events(user_id);

      -- Medical profiles for emergency info
      CREATE TABLE IF NOT EXISTS medical_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) UNIQUE,
        full_name VARCHAR(200),
        date_of_birth DATE,
        blood_type VARCHAR(10),
        allergies TEXT,
        chronic_conditions TEXT,
        current_medications TEXT,
        emergency_notes TEXT,
        cpf VARCHAR(14),
        health_plan VARCHAR(100),
        health_plan_number VARCHAR(50),
        primary_doctor VARCHAR(200),
        doctor_phone VARCHAR(20),
        address TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_medical_profiles_user ON medical_profiles(user_id);

      -- PG LISTEN/NOTIFY trigger for real-time check-in events
      CREATE OR REPLACE FUNCTION notify_checkin_change() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_notify('checkin_events', json_build_object(
          'action', TG_OP,
          'checkin_id', NEW.id,
          'user_id', NEW.user_id,
          'status', NEW.status,
          'time', NEW.time,
          'date', NEW.date
        )::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS checkin_change_trigger ON checkins;
      CREATE TRIGGER checkin_change_trigger
        AFTER INSERT OR UPDATE ON checkins
        FOR EACH ROW EXECUTE FUNCTION notify_checkin_change();

      -- Admin users (RBAC)
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(200) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'viewer',
        avatar_url VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        created_by INTEGER REFERENCES admin_users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

      -- Admin audit log
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id SERIAL PRIMARY KEY,
        admin_user_id INTEGER REFERENCES admin_users(id),
        action VARCHAR(100) NOT NULL,
        details JSONB,
        ip_address VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_user ON admin_audit_log(admin_user_id);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action);

      -- Admin sessions
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id SERIAL PRIMARY KEY,
        admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        ip_address VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token);
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

// ── Seed initial super_admin ─────────────────────────────
async function seedAdminUser() {
  try {
    const existing = await pool.query('SELECT COUNT(*) as cnt FROM admin_users');
    if (parseInt(existing.rows[0].cnt) > 0) return;

    const email = process.env.ADMIN_EMAIL || 'admin@estoubem.com';
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const hash = await hashPassword(password);

    await pool.query(
      `INSERT INTO admin_users (email, password_hash, name, role, is_active) VALUES ($1, $2, $3, $4, true)`,
      [email, hash, 'Super Admin', 'super_admin']
    );

    console.log(`[ADMIN] Created initial super admin. Email: ${email} Password: ${password}`);
  } catch (err) {
    // Table may not exist yet on first run, ignore
    if (err.code !== '42P01') console.error('[ADMIN] Seed error:', err.message);
  }
}

// ── Admin Audit Logger ────────────────────────────────────
async function logAdminAction(adminUserId, action, details, ipAddress) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)`,
      [adminUserId, action, details ? JSON.stringify(details) : null, ipAddress || null]
    );
  } catch (err) {
    console.error('[Audit] Failed to log action:', err.message);
  }
}

// ── Admin Token Management ────────────────────────────────
function generateAdminToken(adminUserId) {
  return 'adm_' + crypto.createHmac('sha256', JWT_SECRET)
    .update(String(adminUserId) + Date.now() + crypto.randomBytes(16).toString('hex'))
    .digest('hex');
}

async function storeAdminToken(token, adminUserId, ipAddress) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  try {
    await pool.query(
      `INSERT INTO admin_sessions (admin_user_id, token, expires_at, ip_address) VALUES ($1, $2, $3, $4)`,
      [adminUserId, token, expiresAt, ipAddress || null]
    );
  } catch (err) {
    console.error('[AdminSessions] Failed to store token:', err.message);
  }
}

async function getAdminByToken(token) {
  try {
    const result = await pool.query(
      `SELECT au.* FROM admin_users au
       JOIN admin_sessions s ON s.admin_user_id = au.id
       WHERE s.token = $1 AND s.expires_at > NOW() AND au.is_active = true`,
      [token]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('[AdminSessions] Token lookup error:', err.message);
    return null;
  }
}

async function deleteAdminToken(token) {
  try {
    await pool.query(`DELETE FROM admin_sessions WHERE token = $1`, [token]);
  } catch (err) {
    console.error('[AdminSessions] Delete token error:', err.message);
  }
}

// Clean up expired admin sessions every hour
setInterval(async () => {
  try {
    const result = await pool.query(`DELETE FROM admin_sessions WHERE expires_at < NOW()`);
    if (result.rowCount > 0) console.log(`[AdminSessions] Cleaned up ${result.rowCount} expired sessions`);
  } catch (err) { /* table may not exist yet */ }
}, 60 * 60 * 1000);

// ── Middleware ─────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Twilio webhooks send form-encoded data

// CORS — restricted to whitelist
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Auth helper — bcrypt for password hashing
async function hashPassword(pw) {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

async function verifyPassword(pw, hash) {
  // Support legacy SHA-256 hashes (64 hex chars) for migration
  if (hash && hash.length === 64 && /^[a-f0-9]+$/.test(hash)) {
    const sha256 = crypto.createHash('sha256').update(pw).digest('hex');
    return sha256 === hash;
  }
  return bcrypt.compare(pw, hash);
}

function generateToken(userId) {
  return crypto.createHmac('sha256', JWT_SECRET)
    .update(String(userId) + Date.now() + crypto.randomBytes(16).toString('hex'))
    .digest('hex');
}

// ── Rate Limiter (in-memory, IP-based) ───────────────────
const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // 5 attempts per minute

function rateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  next();
}

// Clean up rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ── DB-based session tokens ──────────────────────────────
// Legacy in-memory fallback removed — all tokens stored in sessions table
async function storeToken(token, userId, ipAddress) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  try {
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at, ip_address) VALUES ($1, $2, $3, $4)`,
      [String(userId), token, expiresAt, ipAddress || null]
    );
  } catch (err) {
    console.error('[Sessions] Failed to store token:', err.message);
  }
}

async function getTokenUserId(token) {
  try {
    const result = await pool.query(
      `SELECT user_id FROM sessions WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [token]
    );
    if (result.rows.length === 0) return null;
    const uid = result.rows[0].user_id;
    // Return as number if it's a numeric user ID, else as string (e.g. 'af_123')
    return /^\d+$/.test(uid) ? parseInt(uid, 10) : uid;
  } catch (err) {
    console.error('[Sessions] Failed to get token:', err.message);
    return null;
  }
}

async function deleteToken(token) {
  try {
    await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  } catch (err) {
    console.error('[Sessions] Failed to delete token:', err.message);
  }
}

// Clean up expired sessions every hour
setInterval(async () => {
  try {
    const result = await pool.query(`DELETE FROM sessions WHERE expires_at < NOW()`);
    if (result.rowCount > 0) console.log(`[Sessions] Cleaned up ${result.rowCount} expired sessions`);
  } catch (err) {
    // Ignore — table may not exist yet at startup
  }
}, 60 * 60 * 1000);

// ── Input Validation Helpers ─────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  // Allow empty, or digits with optional +, (), -, spaces — 7 to 20 chars
  if (!phone || phone.trim() === '') return true; // phone is optional
  const cleaned = phone.replace(/[\s()\-+]/g, '');
  return /^\d{7,20}$/.test(cleaned);
}

function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  // Strip null bytes and trim
  return str.replace(/\0/g, '').trim();
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const userId = await getTokenUserId(token);
  if (!userId) return res.status(401).json({ error: 'Invalid token' });
  req.userId = userId;
  next();
}

// ── Auth Routes ───────────────────────────────────────────
app.post('/api/register', rateLimiter, async (req, res) => {
  const { email, password, name, phone, role, referral_code, utm_source, utm_medium, utm_campaign } = req.body;
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'email, password, name, and role are required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Invalid phone number format' });
  }
  if (!['elder', 'family', 'caregiver'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const hash = await hashPassword(password);
  const linkCode = Math.random().toString().slice(2, 8);
  const sanitizedName = sanitizeString(name);

  try {
    // Check duplicate phone number
    if (phone) {
      const phoneCheck = await pool.query(`SELECT id, role, linked_elder_id FROM users WHERE phone = $1`, [phone]);
      if (phoneCheck.rows.length > 0) {
        const existingUser = phoneCheck.rows[0];
        if (existingUser.linked_elder_id || existingUser.role === 'elder') {
          return res.status(409).json({
            error: 'phone_exists',
            message: 'Este número já está cadastrado. Se você é familiar, peça o código de conexão ao responsável.',
            existing_role: existingUser.role
          });
        }
      }
    }

    // Check referral
    let referredBy = null;
    let referrerId = null;
    if (referral_code) {
      const referrer = await pool.query(`SELECT id FROM users WHERE referral_code = $1`, [referral_code]);
      if (referrer.rows[0]) {
        referredBy = referrer.rows[0].id;
        referrerId = referrer.rows[0].id;
      }
    }

    const userRefCode = 'EB' + Math.random().toString(36).toUpperCase().slice(2, 6);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, phone, role, link_code, trial_start, referral_code, referred_by, utm_source, utm_medium, utm_campaign)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11)
       RETURNING id, email, name, phone, role, link_code, subscription, trial_start, referral_code`,
      [email.toLowerCase().trim(), hash, sanitizedName, phone || '', role, linkCode, userRefCode, referredBy, utm_source, utm_medium, utm_campaign]
    );

    const user = result.rows[0];

    // Create default settings
    await pool.query(`INSERT INTO settings (user_id) VALUES ($1)`, [user.id]);

    // Check if referrer earned a free month (every 5 referrals)
    if (referrerId) {
      const referralCount = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [referrerId]);
      const count = parseInt(referralCount.rows[0].count);
      if (count > 0 && count % 5 === 0) {
        await pool.query('UPDATE users SET free_months_earned = free_months_earned + 1 WHERE id = $1', [referrerId]);
        await pool.query(
          'INSERT INTO referral_rewards (user_id, reward_type, referral_count) VALUES ($1, $2, $3)',
          [referrerId, 'free_month', count]
        );
      }
    }

    // Create initial pending checkin for elder
    if (role === 'elder') {
      await pool.query(
        `INSERT INTO checkins (user_id, time, status, date) VALUES ($1, '09:00', 'pending', $2)`,
        [user.id, new Date().toISOString().slice(0, 10)]
      );
    }

    const token = generateToken(user.id);
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    await storeToken(token, user.id, ipAddress);

    res.json({ ok: true, token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', rateLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  try {
    const result = await pool.query(
      `SELECT id, email, name, phone, role, link_code, subscription, trial_start, linked_elder_id, password_hash FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) return res.status(401).json({ error: 'Invalid email or password' });

    // If password was stored as legacy SHA-256, upgrade to bcrypt
    if (user.password_hash && user.password_hash.length === 64 && /^[a-f0-9]+$/.test(user.password_hash)) {
      const newHash = await hashPassword(password);
      await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, user.id]);
      console.log(`[Auth] Upgraded password hash for user ${user.id} from SHA-256 to bcrypt`);
    }

    const token = generateToken(user.id);
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    await storeToken(token, user.id, ipAddress);

    // Remove password_hash from response
    delete user.password_hash;
    res.json({ ok: true, token, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Logout ────────────────────────────────────────────────
app.post('/api/logout', async (req, res) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    await deleteToken(token);
  }
  res.json({ ok: true });
});

// ── Password Reset Flow ──────────────────────────────────
app.post('/api/forgot-password', rateLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await pool.query(`SELECT id, name FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
    // Always return success to prevent email enumeration
    if (user.rows.length === 0) {
      return res.json({ ok: true, message: 'If an account with that email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.rows[0].id, resetToken, expiresAt]
    );

    // Send reset email
    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`;
    await sendEmail(email.toLowerCase().trim(), 'Estou Bem - Redefinir Senha', `
      <div style="font-family:'Inter',sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#F5F0EB;border-radius:8px">
        <div style="text-align:center;margin-bottom:20px">
          <span style="font-family:Georgia,serif;font-size:24px;color:#2D4A3E">Estou Bem</span>
        </div>
        <div style="background:white;padding:24px;border-radius:4px;border:1px solid #E5DDD3">
          <h2 style="color:#2D4A3E;margin:0 0 12px">Redefinir Senha</h2>
          <p style="color:#5C5549;line-height:1.6">Ola ${user.rows[0].name}, voce solicitou a redefinicao da sua senha.</p>
          <p style="color:#5C5549;line-height:1.6">Clique no link abaixo para redefinir:</p>
          <a href="${resetUrl}" style="display:inline-block;background:#2D4A3E;color:white;padding:12px 24px;border-radius:4px;text-decoration:none;margin:16px 0">Redefinir Senha</a>
          <p style="color:#9A9189;font-size:13px;margin-top:16px">Este link expira em 1 hora. Se voce nao solicitou isso, ignore este email.</p>
        </div>
      </div>
    `);

    res.json({ ok: true, message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

app.post('/api/reset-password', rateLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const result = await pool.query(
      `SELECT user_id FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW() AND used = false`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const userId = result.rows[0].user_id;
    const newHash = await hashPassword(password);

    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);
    await pool.query(`UPDATE password_reset_tokens SET used = true WHERE token = $1`, [token]);

    // Invalidate all existing sessions for this user
    await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [String(userId)]);

    res.json({ ok: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
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

// ── Twilio SMS & Voice ──────────────────────────────────
// ── WhatsApp Business API (via Twilio) ────────────────────
// Approved WhatsApp Business Template SIDs
const WA_TEMPLATES = {
  checkin_buttons: 'HX12975dc4706173c775b50ee98d697ee5',    // Check-in with Estou Bem / Preciso de Ajuda buttons
  checkin_confirmed: 'HX36ede86655d6ae9f0051ca42de84ee5f',  // Confirmation sent to family
  emergency_alert: 'HXfedb892e7284dbd087edd67b62509ff5',    // Emergency alert to family
  checkin_reminder: 'HXe92b1815ad963c134b65415c817e9324',   // Check-in reminder text
};

// Send WhatsApp using approved template (works outside 24h window)
async function sendWhatsAppTemplate(to, templateSid, variables = {}) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const waNumber = TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:') ? TWILIO_WHATSAPP_NUMBER : 'whatsapp:' + TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken) {
    console.log(`[WhatsApp Template] No credentials. Would send ${templateSid} to ${to}`);
    return false;
  }

  let cleanPhone = to.replace(/\D/g, '');
  if (/^[1-9]{2}9\d{8}$/.test(cleanPhone)) cleanPhone = '55' + cleanPhone;
  if (!cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone;

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const params = new URLSearchParams({
      To: `whatsapp:${cleanPhone}`,
      From: waNumber,
      ContentSid: templateSid,
      ContentVariables: JSON.stringify(variables),
    });

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    if (data.error_code) {
      console.log(`[WhatsApp Template] Error ${data.error_code}: ${data.error_message}. Falling back to free-form.`);
      return await sendWhatsAppBusiness(to, `Estou Bem: ${JSON.stringify(variables)}`);
    }
    console.log(`[WhatsApp Template] Sent ${templateSid} to ${cleanPhone}: ${data.sid}`);
    return true;
  } catch (e) {
    console.error(`[WhatsApp Template] Error:`, e.message);
    return false;
  }
}

async function sendWhatsAppBusiness(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const waNumber = TWILIO_WHATSAPP_NUMBER.startsWith('whatsapp:') ? TWILIO_WHATSAPP_NUMBER : 'whatsapp:' + TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken) {
    console.log(`[WhatsApp] No Twilio credentials. Would send to ${to}: ${body}`);
    return false;
  }

  // Normalize phone: ensure it starts with + and has country code
  let cleanPhone = to.replace(/\D/g, '');
  if (/^[1-9]{2}9\d{8}$/.test(cleanPhone)) cleanPhone = '55' + cleanPhone;
  if (!cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone;

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const params = new URLSearchParams({
      To: `whatsapp:${cleanPhone}`,
      From: waNumber,
      Body: body,
    });

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const result = await res.json();
    console.log(`[WhatsApp] Sent to ${cleanPhone}: ${result.sid || result.message}`);
    return res.ok;
  } catch (err) {
    console.error(`[WhatsApp] Error sending to ${to}:`, err.message);
    return false;
  }
}

// Send message via best available channel: WhatsApp first, SMS fallback
async function sendAlert(to, body) {
  // Try WhatsApp Business first (99% of Brazilians use it)
  const waSent = await sendWhatsAppBusiness(to, body);
  if (waSent) return true;
  // Fallback to SMS
  return await sendSMS(to, body);
}

async function sendSMS(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[SMS] No Twilio credentials. Would send to ${to}: ${body}`);
    return false;
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const params = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body,
    });

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const result = await res.json();
    console.log(`[SMS] Sent to ${to}: ${result.sid || result.message}`);
    return res.ok;
  } catch (err) {
    console.error(`[SMS] Error sending to ${to}:`, err.message);
    return false;
  }
}

async function makeVoiceCall(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[Voice] No Twilio credentials. Would call ${to}: ${message}`);
    return false;
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const twiml = `<Response><Say language="pt-BR" voice="Polly.Camila">${message}</Say><Pause length="2"/><Say language="pt-BR" voice="Polly.Camila">Pressione 1 se voce esta bem. Pressione 2 se precisa de ajuda.</Say><Gather numDigits="1" action="${SERVER_URL}/api/twilio/gather" method="POST"><Say language="pt-BR" voice="Polly.Camila">Aguardando sua resposta.</Say></Gather></Response>`;

    const params = new URLSearchParams({
      To: to,
      From: fromNumber,
      Twiml: twiml,
    });

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const result = await res.json();
    console.log(`[Voice] Called ${to}: ${result.sid || result.message}`);
    return res.ok;
  } catch (err) {
    console.error(`[Voice] Error calling ${to}:`, err.message);
    return false;
  }
}

// Build medical info string for emergency SMS
async function getMedicalInfoForSMS(elderId) {
  try {
    const result = await pool.query('SELECT * FROM medical_profiles WHERE user_id = $1', [elderId]);
    if (result.rows.length === 0) return '';
    const mp = result.rows[0];
    const parts = [];
    if (mp.blood_type) parts.push(`Sangue: ${mp.blood_type}`);
    if (mp.allergies) parts.push(`Alergias: ${mp.allergies}`);
    if (mp.chronic_conditions) parts.push(`Condicoes: ${mp.chronic_conditions}`);
    if (mp.address) parts.push(`Endereco: ${mp.address}`);
    return parts.length > 0 ? ' ' + parts.join('. ') + '.' : '';
  } catch (err) {
    return '';
  }
}

// ── Emergency SAMU Call with Conference ──────────────────
async function callSAMUWithConference(elder, familyPhones) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[SAMU] No Twilio credentials. Would call SAMU 192 for ${elder.name} and patch in ${familyPhones.length} contacts`);
    return false;
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const conferenceName = `samu-${elder.id}-${Date.now()}`;

    // Fetch medical profile for enhanced SAMU call
    let medInfo = '';
    try {
      const medProfile = await pool.query('SELECT * FROM medical_profiles WHERE user_id = $1', [elder.id]);
      if (medProfile.rows.length > 0) {
        const mp = medProfile.rows[0];
        const dob = mp.date_of_birth ? new Date(mp.date_of_birth) : null;
        const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
        const parts = [];
        if (mp.full_name || elder.name) parts.push(`Paciente: ${mp.full_name || elder.name}`);
        if (age) parts.push(`${age} anos`);
        if (mp.blood_type) parts.push(`Tipo sanguineo: ${mp.blood_type}`);
        if (mp.allergies) parts.push(`Alergias: ${mp.allergies}`);
        if (mp.chronic_conditions) parts.push(`Condicoes cronicas: ${mp.chronic_conditions}`);
        if (mp.current_medications) parts.push(`Medicamentos em uso: ${mp.current_medications}`);
        if (mp.address) parts.push(`Endereco: ${mp.address}`);
        if (parts.length > 0) medInfo = parts.join('. ') + '.';
      }
    } catch (medErr) {
      console.error('[SAMU] Error fetching medical profile:', medErr.message);
    }

    // Step 1: Call SAMU 192 with AI context about the emergency
    const samuTwiml = `<Response>
      <Say language="pt-BR" voice="Polly.Camila">
        Ola, aqui e o sistema automatico do Estou Bem, aplicativo de cuidado senior.
        Temos uma emergencia. O idoso ${elder.name} nao responde a check-ins ha mais de 2 horas.
        ${elder.phone ? 'O telefone do idoso e ' + elder.phone.split('').join(' ') + '.' : ''}
        ${medInfo ? medInfo : ''}
        Estamos conectando familiares a esta ligacao agora.
        Por favor aguarde.
      </Say>
      <Dial>
        <Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${conferenceName}</Conference>
      </Dial>
    </Response>`;

    const samuParams = new URLSearchParams({
      To: SAMU_NUMBER,
      From: fromNumber,
      Twiml: samuTwiml,
      StatusCallback: `${SERVER_URL}/api/twilio/status`,
      StatusCallbackEvent: 'completed',
    });

    const samuRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: samuParams.toString(),
    });
    const samuResult = await samuRes.json();
    console.log(`[SAMU] Called 192 for ${elder.name}: ${samuResult.sid || samuResult.message}`);

    // Step 2: Patch in each family contact to the same conference
    for (const phone of familyPhones) {
      const familyTwiml = `<Response>
        <Say language="pt-BR" voice="Polly.Camila">
          EMERGENCIA do Estou Bem. ${elder.name} nao responde ha 30 minutos.
          Voce esta sendo conectado a uma ligacao com o SAMU 192.
        </Say>
        <Dial>
          <Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="true">${conferenceName}</Conference>
        </Dial>
      </Response>`;

      const familyParams = new URLSearchParams({
        To: phone,
        From: fromNumber,
        Twiml: familyTwiml,
      });

      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: familyParams.toString(),
      }).then(r => r.json()).then(r => {
        console.log(`[SAMU Conference] Patched in ${phone}: ${r.sid || r.message}`);
      }).catch(e => {
        console.error(`[SAMU Conference] Failed to patch ${phone}:`, e.message);
      });
    }

    // Log the emergency call
    await pool.query(
      `INSERT INTO email_alerts (recipient_email, subject, related_user_id, alert_type)
       VALUES ($1, $2, $3, $4)`,
      ['SAMU-192', `EMERGENCY CALL: ${elder.name}`, elder.id, 'samu_call']
    ).catch(() => {});

    return true;
  } catch (err) {
    console.error(`[SAMU] Error calling SAMU for ${elder.name}:`, err.message);
    return false;
  }
}

// ── Twilio Webhook Signature Verification ────────────────
function twilioWebhookAuth(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !twilioValidateRequest) {
    // Dev mode: skip verification if no auth token or twilio not installed
    return next();
  }
  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    console.warn('[Twilio] Missing X-Twilio-Signature header');
    return res.status(403).send('Forbidden');
  }
  const url = SERVER_URL + req.originalUrl;
  const isValid = twilioValidateRequest(authToken, signature, url, req.body || {});
  if (!isValid) {
    console.warn('[Twilio] Invalid webhook signature for', req.originalUrl);
    return res.status(403).send('Forbidden');
  }
  next();
}

// Twilio call status callback
app.post('/api/twilio/status', express.urlencoded({ extended: false }), twilioWebhookAuth, (req, res) => {
  console.log(`[Twilio Status] Call ${req.body.CallSid}: ${req.body.CallStatus} (duration: ${req.body.CallDuration}s)`);
  res.sendStatus(200);
});

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

// ── Twilio Webhooks ──────────────────────────────────────

// Twilio voice call gather callback
app.post('/api/twilio/gather', express.urlencoded({ extended: false }), twilioWebhookAuth, asyncHandler(async (req, res) => {
  const digit = req.body.Digits;
  const callerPhone = req.body.To;

  console.log(`[Twilio Gather] Phone ${callerPhone} pressed ${digit}`);

  if (digit === '1') {
    // Elder confirmed they're OK
    const elder = await pool.query('SELECT id, name FROM users WHERE phone = $1 AND role = $2', [callerPhone, 'elder']).catch(() => ({ rows: [] }));
    if (elder.rows[0]) {
      await pool.query(
        "UPDATE escalation_alerts SET status = 'resolved' WHERE elder_id = $1 AND status = 'active'",
        [elder.rows[0].id]
      );
      const today = new Date().toISOString().slice(0, 10);
      await pool.query(
        "UPDATE checkins SET status = 'confirmed' WHERE user_id = $1 AND date = $2 AND status = 'pending'",
        [elder.rows[0].id, today]
      );
      console.log(`[Twilio] ${elder.rows[0].name} confirmed OK via phone`);
    }

    res.type('text/xml').send('<Response><Say language="pt-BR" voice="Polly.Camila">Obrigado! Seu check-in foi confirmado. Cuide-se bem!</Say></Response>');
  } else if (digit === '2') {
    // Elder needs help - escalate immediately
    res.type('text/xml').send('<Response><Say language="pt-BR" voice="Polly.Camila">Estamos avisando sua familia agora. Fique tranquilo, ajuda esta a caminho.</Say></Response>');
  } else {
    res.type('text/xml').send('<Response><Say language="pt-BR" voice="Polly.Camila">Nao entendi. Pressione 1 se esta bem, ou 2 se precisa de ajuda.</Say><Gather numDigits="1"><Say language="pt-BR">Aguardando.</Say></Gather></Response>');
  }
}));

// Twilio incoming SMS webhook (for elder replying "SIM" to SMS check-in)
app.post('/api/twilio/sms', express.urlencoded({ extended: false }), twilioWebhookAuth, asyncHandler(async (req, res) => {
  const body = (req.body.Body || '').trim().toUpperCase();
  const from = req.body.From;

  console.log(`[SMS Incoming] From ${from}: ${body}`);

  if (body === 'SIM' || body === 'SI' || body === 'YES' || body === 'OK' || body === '1') {
    // Find elder by phone number
    const elder = await pool.query(
      "SELECT id, name FROM users WHERE phone LIKE $1 AND role = 'elder'",
      ['%' + from.replace('+', '').slice(-9)]
    ).catch(() => ({ rows: [] }));

    if (elder.rows[0]) {
      const today = new Date().toISOString().slice(0, 10);
      await pool.query(
        "UPDATE checkins SET status = 'confirmed' WHERE user_id = $1 AND date = $2 AND status = 'pending'",
        [elder.rows[0].id, today]
      );
      await pool.query(
        "UPDATE escalation_alerts SET status = 'resolved' WHERE elder_id = $1 AND status = 'active'",
        [elder.rows[0].id]
      );
      console.log(`[SMS] ${elder.rows[0].name} confirmed check-in via SMS`);
      res.type('text/xml').send('<Response><Message>Check-in confirmado! Obrigado por responder. Cuide-se bem!</Message></Response>');
    } else {
      res.type('text/xml').send('<Response><Message>Estou Bem: Numero nao encontrado. Entre em contato com seu familiar.</Message></Response>');
    }
  } else {
    res.type('text/xml').send('<Response><Message>Estou Bem: Responda SIM para confirmar seu check-in.</Message></Response>');
  }
}));

// Test endpoint: send a WhatsApp check-in reminder to any number
app.post('/api/twilio/test-whatsapp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  // Use approved template with buttons (works outside 24h window)
  const sent = await sendWhatsAppTemplate(phone, WA_TEMPLATES.checkin_buttons, { '1': elderName || 'Amigo(a)' });
  res.json({ success: sent, channel: 'whatsapp', to: phone });
});

// Twilio WhatsApp incoming message webhook
// Set this URL in Twilio Console -> WhatsApp Senders -> Webhook URL:
// ${SERVER_URL}/api/twilio/whatsapp
app.post('/api/twilio/whatsapp', express.urlencoded({ extended: false }), twilioWebhookAuth, asyncHandler(async (req, res) => {
  const body = (req.body.Body || '').trim().toUpperCase();
  const from = (req.body.From || '').replace('whatsapp:', '');

  console.log(`[WhatsApp Incoming] From ${from}: ${body}`);

  if (body === 'SIM' || body === 'SI' || body === 'YES' || body === 'OK' || body === '1' || body === 'BEM' || body === 'ESTOU BEM') {
    // Find elder by phone number (last 9 digits match)
    const elder = await pool.query(
      "SELECT id, name FROM users WHERE phone LIKE $1 AND role = 'elder'",
      ['%' + from.replace('+', '').slice(-9)]
    ).catch(() => ({ rows: [] }));

    if (elder.rows[0]) {
      const today = new Date().toISOString().slice(0, 10);
      await pool.query(
        "UPDATE checkins SET status = 'confirmed' WHERE user_id = $1 AND date = $2 AND status = 'pending'",
        [elder.rows[0].id, today]
      );
      await pool.query(
        "UPDATE escalation_alerts SET status = 'resolved' WHERE elder_id = $1 AND status = 'active'",
        [elder.rows[0].id]
      );
      // Notify family that elder confirmed via WhatsApp
      const family = await pool.query('SELECT * FROM family_contacts WHERE elder_id = $1', [elder.rows[0].id]);
      const contacts = await pool.query('SELECT * FROM emergency_contacts WHERE user_id = $1', [elder.rows[0].id]);
      const allPhones = [
        ...family.rows.filter(f => f.phone).map(f => f.phone),
        ...contacts.rows.filter(c => c.phone).map(c => c.phone),
      ];
      for (const phone of allPhones) {
        await sendWhatsAppTemplate(phone, WA_TEMPLATES.checkin_confirmed, { '1': elder.rows[0].name });
      }
      console.log(`[WhatsApp] ${elder.rows[0].name} confirmed check-in via WhatsApp`);
      res.type('text/xml').send('<Response><Message>✅ Check-in confirmado! Obrigado por responder. Sua família foi notificada. Cuide-se bem! 💚</Message></Response>');
    } else {
      res.type('text/xml').send('<Response><Message>Estou Bem: Número não encontrado. Entre em contato com seu familiar para cadastrar seu telefone no app.</Message></Response>');
    }
  } else if (body === 'SOS' || body === 'AJUDA' || body === 'HELP' || body === 'SOCORRO') {
    // Elder sent SOS via WhatsApp
    const elder = await pool.query(
      "SELECT id, name, phone FROM users WHERE phone LIKE $1 AND role = 'elder'",
      ['%' + from.replace('+', '').slice(-9)]
    ).catch(() => ({ rows: [] }));

    if (elder.rows[0]) {
      const family = await pool.query('SELECT * FROM family_contacts WHERE elder_id = $1', [elder.rows[0].id]);
      const contacts = await pool.query('SELECT * FROM emergency_contacts WHERE user_id = $1', [elder.rows[0].id]);
      const medSMS = await getMedicalInfoForSMS(elder.rows[0].id);
      const allPhones = [
        ...family.rows.filter(f => f.phone).map(f => f.phone),
        ...contacts.rows.filter(c => c.phone).map(c => c.phone),
      ];
      for (const phone of allPhones) {
        await sendAlert(phone, `🆘 EMERGENCIA: ${elder.rows[0].name} pediu AJUDA via WhatsApp! Verifique IMEDIATAMENTE. SAMU: 192${medSMS}`);
      }
      // Also trigger voice call escalation
      await callSAMUWithConference(elder.rows[0], allPhones);
      console.log(`[WhatsApp] ${elder.rows[0].name} sent SOS via WhatsApp — SAMU activated`);
      res.type('text/xml').send('<Response><Message>🚨 SOS ATIVADO! Sua família e o SAMU foram notificados. Ajuda está a caminho. Aguente firme! 🚑</Message></Response>');
    } else {
      res.type('text/xml').send('<Response><Message>Estou Bem: Número não encontrado. Ligue 192 (SAMU) para emergências.</Message></Response>');
    }
  } else {
    res.type('text/xml').send('<Response><Message>Estou Bem: Responda *SIM* para confirmar seu check-in, ou *SOS* se precisar de ajuda urgente.</Message></Response>');
  }
}));

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

// ── Family Elder Status ──────────────────────────────────
app.get('/api/family/elder-status', authMiddleware, async (req, res) => {
  try {
    const user = await pool.query(`SELECT linked_elder_id FROM users WHERE id = $1`, [req.userId]);
    const elderId = user.rows[0]?.linked_elder_id;
    if (!elderId) return res.json({ linked: false });

    // Elder info
    const elder = await pool.query(`SELECT id, name, phone, email, created_at FROM users WHERE id = $1`, [elderId]);
    if (elder.rows.length === 0) return res.json({ linked: false });

    const elderName = elder.rows[0].name;

    // Today's check-ins
    const today = new Date().toISOString().slice(0, 10);
    const checkins = await pool.query(
      `SELECT id, time, status, date, confirmed_at, created_at FROM checkins WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [elderId]
    );

    // Medications
    const medications = await pool.query(
      `SELECT id, name, dosage, frequency, time, stock, unit, low_threshold FROM medications WHERE user_id = $1`,
      [elderId]
    );

    // Recent health entries (last 30)
    const health = await pool.query(
      `SELECT id, type, value, unit, time, date, notes, created_at FROM health_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [elderId]
    );

    // Last activity: most recent check-in confirmation or health entry
    const lastCheckin = checkins.rows.find(c => c.status === 'confirmed' || c.status === 'auto_confirmed');
    const lastHealth = health.rows[0];
    let lastActivity = null;
    if (lastCheckin?.confirmed_at) lastActivity = lastCheckin.confirmed_at;
    else if (lastCheckin?.created_at) lastActivity = lastCheckin.created_at;
    if (lastHealth?.created_at && (!lastActivity || new Date(lastHealth.created_at) > new Date(lastActivity))) {
      lastActivity = lastHealth.created_at;
    }

    res.json({
      linked: true,
      elderId,
      elderName,
      checkins: checkins.rows,
      medications: medications.rows,
      health: health.rows,
      lastActivity,
    });
  } catch (err) {
    console.error('[elder-status] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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

// ── Client-triggered escalation endpoint ──
app.post('/api/escalation/trigger', authMiddleware, async (req, res) => {
  const { user_id, level, action } = req.body;
  const uid = user_id || req.userId;
  try {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [uid]);
    if (!user.rows[0]) return res.status(404).json({ error: 'User not found' });
    const elder = user.rows[0];
    const family = await pool.query('SELECT * FROM family_contacts WHERE elder_id = $1', [uid]);
    const contacts = await pool.query('SELECT * FROM emergency_contacts WHERE user_id = $1', [uid]);

    let samuTriggered = false;

    if (action === 'test_sms') {
      if (elder.phone) await sendAlert(elder.phone, `Estou Bem: Este é um teste do sistema de notificação. Tudo funcionando!`);
      return res.json({ success: true, message: 'Test SMS sent' });
    }
    if (action === 'resolved') {
      // Notify family that elder confirmed OK
      const allPhones = [
        ...family.rows.filter(f => f.phone).map(f => f.phone),
        ...contacts.rows.filter(c => c.phone).map(c => c.phone),
      ];
      for (const phone of allPhones) {
        await sendAlert(phone, `✅ ESTOU BEM: ${elder.name} confirmou o check-in. Tudo OK!`);
      }
      return res.json({ success: true });
    }
    if (action === 'sms_elder' && elder.phone) {
      await sendAlert(elder.phone, `Estou Bem: Voce tem um check-in pendente. Responda SIM se esta tudo bem.`);
    }
    if (action === 'sms_family') {
      for (const fm of family.rows) {
        if (fm.phone) await sendAlert(fm.phone, `ALERTA: ${elder.name} nao respondeu ao check-in. Por favor verifique.`);
      }
      for (const ct of contacts.rows) {
        if (ct.phone) await sendAlert(ct.phone, `ALERTA: ${elder.name} nao respondeu ao check-in. Por favor verifique.`);
      }
    }
    if (action === 'call_elder' && elder.phone) {
      const answered = await makeVoiceCall(elder.phone, `Ola ${elder.name}. Voce tem um check-in pendente. Pressione 1 se esta bem.`);
      if (!answered) {
        // Immediate SAMU escalation
        const allPhones = [
          ...family.rows.filter(f => f.phone).map(f => f.phone),
          ...contacts.rows.filter(c => c.phone).map(c => c.phone),
        ];
        const medSMS = await getMedicalInfoForSMS(elder.id);
        for (const phone of allPhones) {
          await sendAlert(phone, `🆘 EMERGENCIA: ${elder.name} nao responde e nao atendeu ligacao. SAMU 192 sendo acionado AGORA.${medSMS}`);
        }
        await callSAMUWithConference(elder, allPhones);
        samuTriggered = true;
      }
    }
    if (action === 'samu') {
      const allPhones = [
        ...family.rows.filter(f => f.phone).map(f => f.phone),
        ...contacts.rows.filter(c => c.phone).map(c => c.phone),
      ];
      const medSMU = await getMedicalInfoForSMS(elder.id);
      for (const phone of allPhones) {
        await sendAlert(phone, `🆘 EMERGENCIA: ${elder.name} nao responde. SAMU 192 sendo acionado AGORA. Voce sera conectado.${medSMU}`);
      }
      await callSAMUWithConference(elder, allPhones);
      samuTriggered = true;
    }
    res.json({ success: true, samu_triggered: samuTriggered });
  } catch(err) {
    console.error('[Escalation Trigger]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Check-in Status (3-state: pending / completed / waiting) ──
app.get('/api/checkin-status/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid userId' });

  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    // Get user's checkin schedule
    const settingsResult = await pool.query('SELECT * FROM settings WHERE user_id = $1', [userId]);
    const settings = settingsResult.rows[0] || { checkin_times: ['09:00'], checkin_mode: 'scheduled' };
    const checkinTimes = settings.checkin_times || ['09:00'];

    // Get today's checkins
    const checkinsResult = await pool.query(
      'SELECT * FROM checkins WHERE user_id = $1 AND date = $2 ORDER BY time ASC',
      [userId, todayStr]
    );
    const todayCheckins = checkinsResult.rows;

    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // Check for a pending (unconfirmed) checkin
    const pendingCheckin = todayCheckins.find(c => c.status === 'pending');
    if (pendingCheckin) {
      // Find the deadline: next scheduled time, or end of day
      const scheduledMins = (() => {
        const [h, m] = (pendingCheckin.time || '09:00').split(':').map(Number);
        return h * 60 + m;
      })();
      // Deadline is 60 minutes after scheduled time
      const deadlineMins = scheduledMins + 60;
      const deadlineH = String(Math.floor(deadlineMins / 60)).padStart(2, '0');
      const deadlineM = String(deadlineMins % 60).padStart(2, '0');

      return res.json({
        status: 'pending',
        scheduled_at: pendingCheckin.time,
        deadline: `${deadlineH}:${deadlineM}`,
        checkin_id: pendingCheckin.id
      });
    }

    // Check if all scheduled checkins for past times are confirmed
    const pastTimes = checkinTimes.filter(t => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m <= nowMins;
    });

    // If there are past times, check if the latest one was confirmed
    if (pastTimes.length > 0) {
      const latestPastTime = pastTimes[pastTimes.length - 1];
      const confirmedForLatest = todayCheckins.find(
        c => (c.status === 'confirmed' || c.status === 'auto_confirmed') && c.time === latestPastTime
      );
      // Also check if there's any confirmed checkin at all for today
      const anyConfirmed = todayCheckins.find(
        c => c.status === 'confirmed' || c.status === 'auto_confirmed'
      );

      if (anyConfirmed) {
        // Find next scheduled time
        const nextTime = checkinTimes.find(t => {
          const [h, m] = t.split(':').map(Number);
          return h * 60 + m > nowMins;
        });

        return res.json({
          status: 'completed',
          confirmed_at: anyConfirmed.confirmed_at || anyConfirmed.time,
          next_at: nextTime || null
        });
      }
    }

    // Find next scheduled time
    const nextTime = checkinTimes.find(t => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m > nowMins;
    });

    if (nextTime) {
      return res.json({
        status: 'waiting',
        next_at: nextTime
      });
    }

    // All checkin times passed, no pending, no confirmed — treat as waiting for tomorrow
    return res.json({
      status: 'waiting',
      next_at: checkinTimes[0] || '09:00'
    });

  } catch (err) {
    console.error('[Checkin Status]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Nap mode — pause escalations for up to 1 hour ──
const napUsers = new Map(); // userId -> { until: Date }

app.post('/api/nap', authMiddleware, async (req, res) => {
  const minutes = Math.min(parseInt(req.body.minutes) || 60, 60); // max 1 hour
  const until = new Date(Date.now() + minutes * 60 * 1000);
  napUsers.set(req.userId, { until });
  console.log(`[Nap] User ${req.userId} napping until ${until.toISOString()} (${minutes} min)`);
  res.json({ success: true, nap_until: until.toISOString(), minutes });
});

app.delete('/api/nap', authMiddleware, async (req, res) => {
  napUsers.delete(req.userId);
  console.log(`[Nap] User ${req.userId} woke up (nap cancelled)`);
  res.json({ success: true });
});

app.get('/api/nap', authMiddleware, async (req, res) => {
  const nap = napUsers.get(req.userId);
  if (nap && nap.until > new Date()) {
    res.json({ napping: true, nap_until: nap.until.toISOString() });
  } else {
    napUsers.delete(req.userId);
    res.json({ napping: false });
  }
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
  const confirmedAt = (status === 'confirmed' || status === 'auto_confirmed') ? new Date().toISOString() : null;
  const result = await pool.query(
    `UPDATE checkins SET status = COALESCE($1, status), time = COALESCE($2, time), confirmed_at = COALESCE($3, confirmed_at) WHERE id = $4 AND user_id = $5 RETURNING *`,
    [status, time, confirmedAt, req.params.id, req.userId]
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

// ── Activity & Health Readings from Watch ─────────────────

// POST /api/activity-update — receives movement + health data from Apple Watch
app.post('/api/activity-update', authMiddleware, async (req, res) => {
  const { user_id, movement_detected, heart_rate, spo2, sleep_hours } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  try {
    // Update activity log (upsert)
    if (movement_detected) {
      await pool.query(`
        INSERT INTO activity_logs (user_id, last_movement_at, movement_count_1h, updated_at)
        VALUES ($1, NOW(), 1, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          last_movement_at = NOW(),
          movement_count_1h = activity_logs.movement_count_1h + 1,
          updated_at = NOW()
      `, [user_id]);
    } else {
      // Still update the timestamp so we know the watch is connected
      await pool.query(`
        INSERT INTO activity_logs (user_id, updated_at)
        VALUES ($1, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET updated_at = NOW()
      `, [user_id]);
    }

    // Log health readings
    if (heart_rate) {
      await pool.query(
        `INSERT INTO health_readings (user_id, reading_type, value) VALUES ($1, 'heart_rate', $2)`,
        [user_id, heart_rate]
      );
    }
    if (spo2) {
      await pool.query(
        `INSERT INTO health_readings (user_id, reading_type, value) VALUES ($1, 'spo2', $2)`,
        [user_id, spo2]
      );

      // SpO2 Alert Logic
      if (spo2 < 85) {
        // CRITICAL: SpO2 < 85% → Level 2 escalation (voice call)
        console.log(`[SpO2 CRITICAL] User ${user_id} SpO2=${spo2}% — triggering Level 2 escalation`);
        const elder = await pool.query(`SELECT id, name, phone FROM users WHERE id = $1`, [user_id]);
        if (elder.rows[0]) {
          const family = await pool.query(
            `SELECT id, name, phone, email FROM users WHERE linked_elder_id = $1`,
            [user_id]
          );
          const contacts = await pool.query(
            `SELECT name, phone FROM contacts WHERE user_id = $1 ORDER BY priority`,
            [user_id]
          );

          // Push notification to family
          const familyTokens = await pool.query(
            `SELECT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE u.linked_elder_id = $1`,
            [user_id]
          );
          if (familyTokens.rows.length > 0) {
            await sendPushNotifications(
              familyTokens.rows.map(r => r.token),
              'EMERGENCIA: Oxigenio CRITICO!',
              `${elder.rows[0].name} esta com oxigenio no sangue em ${spo2}%. Procure ajuda medica IMEDIATAMENTE.`,
              { type: 'spo2_critical', elderId: user_id, spo2 },
              true
            );
          }

          // WebSocket alert
          await sendWsAlertToFamily(user_id, {
            type: 'spo2_critical',
            level: 2,
            elder: { id: user_id, name: elder.rows[0].name },
            spo2,
            message: `EMERGENCIA: SpO2 em ${spo2}%`,
            timestamp: new Date().toISOString(),
          });

          // SMS + Voice call to elder
          if (elder.rows[0].phone) {
            await sendAlert(elder.rows[0].phone, `ALERTA Estou Bem: Seu nivel de oxigenio esta em ${spo2}%. Procure ajuda medica.`);
            await makeVoiceCall(elder.rows[0].phone, `Alerta de saude. Seu nivel de oxigenio esta muito baixo, em ${spo2} por cento. Procure ajuda medica imediatamente.`);
          }
          // SMS to family
          for (const fm of family.rows) {
            if (fm.phone) await sendAlert(fm.phone, `EMERGENCIA: ${elder.rows[0].name} esta com oxigenio no sangue em ${spo2}%. Procure ajuda medica IMEDIATAMENTE.`);
          }
          for (const ct of contacts.rows) {
            if (ct.phone) await sendAlert(ct.phone, `EMERGENCIA: ${elder.rows[0].name} esta com oxigenio no sangue em ${spo2}%. Procure ajuda medica IMEDIATAMENTE.`);
          }

          // Email to family
          await sendEscalationEmails(family.rows, elder.rows[0], `EMERGENCIA: Oxigenio CRITICO - ${elder.rows[0].name}`, 2);

          // Log escalation
          await pool.query(
            `INSERT INTO escalation_alerts (elder_id, level, status, notified_contacts)
             VALUES ($1, 2, 'active', $2)`,
            [user_id, JSON.stringify(family.rows.map(f => ({ name: f.name, phone: f.phone })))]
          );
        }
      } else if (spo2 < 90) {
        // WARNING: SpO2 < 90% → IMMEDIATE alert to family + push notification
        console.log(`[SpO2 LOW] User ${user_id} SpO2=${spo2}% — alerting family`);
        const elder = await pool.query(`SELECT id, name, phone FROM users WHERE id = $1`, [user_id]);
        if (elder.rows[0]) {
          const family = await pool.query(
            `SELECT id, name, phone, email FROM users WHERE linked_elder_id = $1`,
            [user_id]
          );

          // Push notification to family
          const familyTokens = await pool.query(
            `SELECT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE u.linked_elder_id = $1`,
            [user_id]
          );
          if (familyTokens.rows.length > 0) {
            await sendPushNotifications(
              familyTokens.rows.map(r => r.token),
              'ALERTA: Oxigenio baixo!',
              `${elder.rows[0].name} esta com oxigenio no sangue em ${spo2}%. Monitore de perto.`,
              { type: 'spo2_low', elderId: user_id, spo2 },
              true
            );
          }

          // WebSocket alert
          await sendWsAlertToFamily(user_id, {
            type: 'spo2_low',
            level: 1,
            elder: { id: user_id, name: elder.rows[0].name },
            spo2,
            message: `ALERTA: SpO2 em ${spo2}%`,
            timestamp: new Date().toISOString(),
          });

          // SMS to family
          for (const fm of family.rows) {
            if (fm.phone) await sendAlert(fm.phone, `ALERTA: ${elder.rows[0].name} esta com oxigenio no sangue em ${spo2}%. Monitore de perto.`);
          }

          // Email to family
          await sendEscalationEmails(family.rows, elder.rows[0], `ALERTA: Oxigenio baixo - ${elder.rows[0].name}`, 1);
        }
      }
    }

    if (sleep_hours !== undefined && sleep_hours !== null) {
      await pool.query(
        `INSERT INTO health_readings (user_id, reading_type, value) VALUES ($1, 'sleep', $2)`,
        [user_id, sleep_hours]
      );
    }

    if (movement_detected) {
      await pool.query(
        `INSERT INTO health_readings (user_id, reading_type, value) VALUES ($1, 'movement', 1)`,
        [user_id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Activity Update] Error:', err);
    res.status(500).json({ error: 'Failed to update activity' });
  }
});

// ── Fall Detection ────────────────────────────────────────

// POST /api/fall-detected — Apple Watch detected a fall
// Immediately escalates: Level 2 (voice call to elder), then Level 3 (SAMU) if no response in 60s
app.post('/api/fall-detected', authMiddleware, async (req, res) => {
  const { user_id, timestamp, location, heart_rate } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  try {
    console.log(`[FALL DETECTED] User ${user_id} — fall detected at ${timestamp || 'now'}`);

    // 1. Log fall event
    const fallResult = await pool.query(
      `INSERT INTO fall_events (user_id, detected_at, heart_rate, location_lat, location_lng, escalation_level)
       VALUES ($1, $2, $3, $4, $5, 2) RETURNING *`,
      [
        user_id,
        timestamp || new Date().toISOString(),
        heart_rate || null,
        location?.lat || null,
        location?.lng || null,
      ]
    );
    const fallEvent = fallResult.rows[0];

    // 2. Get elder info
    const elderResult = await pool.query(`SELECT id, name, phone FROM users WHERE id = $1`, [user_id]);
    if (!elderResult.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    const elder = elderResult.rows[0];

    // 3. Get family contacts
    const family = await pool.query(
      `SELECT id, name, phone, email FROM users WHERE linked_elder_id = $1`,
      [user_id]
    );
    const contactsResult = await pool.query(
      `SELECT name, phone FROM contacts WHERE user_id = $1 ORDER BY priority`,
      [user_id]
    );

    // 4. Push notification to ALL family contacts immediately
    const familyTokens = await pool.query(
      `SELECT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE u.linked_elder_id = $1`,
      [user_id]
    );
    if (familyTokens.rows.length > 0) {
      await sendPushNotifications(
        familyTokens.rows.map(r => r.token),
        'ALERTA: Queda detectada!',
        `ALERTA: ${elder.name} pode ter sofrido uma queda!`,
        { type: 'fall_detected', elderId: user_id, fallEventId: fallEvent.id, heart_rate },
        true
      );
    }

    // 5. WebSocket alert to connected family clients
    await sendWsAlertToFamily(user_id, {
      type: 'fall_detected',
      level: 2,
      elder: { id: user_id, name: elder.name },
      fallEventId: fallEvent.id,
      heart_rate,
      location,
      message: `ALERTA: ${elder.name} pode ter sofrido uma queda!`,
      timestamp: new Date().toISOString(),
    });

    // 6. Email to family
    for (const fm of family.rows) {
      if (fm.email) {
        const html = buildEscalationEmailHtml(elder.name, `QUEDA DETECTADA — ${elder.name}`, 2);
        await sendEmail(fm.email, `ALERTA: ${elder.name} pode ter sofrido uma queda!`, html);
        try {
          await pool.query(
            `INSERT INTO email_alerts (recipient_email, subject, related_user_id, alert_type) VALUES ($1, $2, $3, $4)`,
            [fm.email, `ALERTA: Queda detectada - ${elder.name}`, user_id, 'fall_detected']
          );
        } catch (logErr) {
          console.error('[Email] Failed to log fall email alert:', logErr.message);
        }
      }
    }

    // 7. SMS to family contacts
    for (const fm of family.rows) {
      if (fm.phone) await sendAlert(fm.phone, `ALERTA Estou Bem: ${elder.name} pode ter sofrido uma queda! Verifique imediatamente.`);
    }
    for (const ct of contactsResult.rows) {
      if (ct.phone) await sendAlert(ct.phone, `ALERTA Estou Bem: ${elder.name} pode ter sofrido uma queda! Verifique imediatamente.`);
    }

    // 8. IMMEDIATELY escalate to Level 2: Voice call to elder
    if (elder.phone) {
      console.log(`[FALL] Level 2: Calling ${elder.name} at ${elder.phone}`);
      await makeVoiceCall(
        elder.phone,
        `Alerta de queda detectada pelo seu relogio. Se voce esta bem, pressione 1. Se precisa de ajuda, pressione 2.`
      );

      // 9. If elder doesn't confirm OK within 60 seconds -> Level 3 SAMU
      setTimeout(async () => {
        try {
          const checkFall = await pool.query(
            `SELECT confirmed_fall, cancelled_by_user, resolved_at FROM fall_events WHERE id = $1`,
            [fallEvent.id]
          );
          const fall = checkFall.rows[0];

          if (fall && !fall.resolved_at && fall.confirmed_fall && !fall.cancelled_by_user) {
            console.log(`[FALL] Level 3: ${elder.name} did NOT respond in 60s — calling SAMU`);

            await pool.query(`UPDATE fall_events SET escalation_level = 3 WHERE id = $1`, [fallEvent.id]);

            const familyPhones = [
              ...family.rows.filter(f => f.phone).map(f => f.phone),
              ...contactsResult.rows.filter(c => c.phone).map(c => c.phone),
            ];
            await callSAMUWithConference(elder, familyPhones);

            if (familyTokens.rows.length > 0) {
              await sendPushNotifications(
                familyTokens.rows.map(r => r.token),
                'EMERGENCIA: SAMU acionado!',
                `${elder.name} nao respondeu apos queda detectada. SAMU (192) foi acionado automaticamente.`,
                { type: 'fall_samu_escalation', elderId: user_id, fallEventId: fallEvent.id },
                true
              );
            }

            await sendWsAlertToFamily(user_id, {
              type: 'fall_samu_escalation',
              level: 3,
              elder: { id: user_id, name: elder.name },
              fallEventId: fallEvent.id,
              message: `EMERGENCIA: SAMU acionado para ${elder.name}`,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.error(`[FALL] Error in SAMU escalation timeout:`, err.message);
        }
      }, 60 * 1000);
    }

    // Log escalation alert
    await pool.query(
      `INSERT INTO escalation_alerts (elder_id, level, status, notified_contacts) VALUES ($1, 2, 'active', $2)`,
      [user_id, JSON.stringify([
        ...family.rows.map(f => ({ name: f.name, phone: f.phone })),
        ...contactsResult.rows.map(c => ({ name: c.name, phone: c.phone })),
      ])]
    );

    res.json({ ok: true, fallEventId: fallEvent.id, escalation: 'level_2_voice_call' });
  } catch (err) {
    console.error('[Fall Detection] Error:', err);
    res.status(500).json({ error: 'Failed to process fall event' });
  }
});

// POST /api/fall-cancelled — Elder cancelled the fall alert (false alarm)
app.post('/api/fall-cancelled', authMiddleware, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  try {
    await pool.query(
      `UPDATE fall_events SET cancelled_by_user = true, confirmed_fall = false, resolved_at = NOW()
       WHERE user_id = $1 AND resolved_at IS NULL`,
      [user_id]
    );
    await pool.query(
      `UPDATE escalation_alerts SET status = 'resolved' WHERE elder_id = $1 AND status = 'active'`,
      [user_id]
    );

    const elder = await pool.query(`SELECT name FROM users WHERE id = $1`, [user_id]);
    if (elder.rows[0]) {
      const familyTokens = await pool.query(
        `SELECT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE u.linked_elder_id = $1`,
        [user_id]
      );
      if (familyTokens.rows.length > 0) {
        await sendPushNotifications(
          familyTokens.rows.map(r => r.token),
          'Queda cancelada',
          `${elder.rows[0].name} cancelou o alerta de queda. Falso alarme.`,
          { type: 'fall_cancelled', elderId: user_id },
          false
        );
      }
      await sendWsAlertToFamily(user_id, {
        type: 'fall_cancelled',
        elder: { id: user_id, name: elder.rows[0].name },
        message: `${elder.rows[0].name} cancelou o alerta de queda`,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[FALL] Alert cancelled by user ${user_id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Fall Cancelled] Error:', err);
    res.status(500).json({ error: 'Failed to cancel fall event' });
  }
});

// GET /api/activity-log/:userId — get activity log for an elder
app.get('/api/activity-log/:userId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM activity_logs WHERE user_id = $1`,
      [req.params.userId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('[Activity Log] Error:', err);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

// GET /api/health-readings/:userId — get recent health readings for an elder
app.get('/api/health-readings/:userId', authMiddleware, async (req, res) => {
  try {
    const { type, limit } = req.query;
    let query = `SELECT * FROM health_readings WHERE user_id = $1`;
    const params = [req.params.userId];
    if (type) {
      query += ` AND reading_type = $2`;
      params.push(type);
    }
    query += ` ORDER BY recorded_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit) || 50);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Health Readings] Error:', err);
    res.status(500).json({ error: 'Failed to fetch health readings' });
  }
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
  const [elder, checkins, meds, health, contacts, activityLog, latestSpo2, latestSleep] = await Promise.all([
    pool.query(`SELECT name, phone, subscription, trial_start FROM users WHERE id = $1`, [elderId]),
    pool.query(`SELECT * FROM checkins WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [elderId]),
    pool.query(`SELECT * FROM medications WHERE user_id = $1`, [elderId]),
    pool.query(`SELECT * FROM health_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [elderId]),
    pool.query(`SELECT * FROM contacts WHERE user_id = $1 ORDER BY priority`, [elderId]),
    pool.query(`SELECT * FROM activity_logs WHERE user_id = $1`, [elderId]),
    pool.query(`SELECT value, recorded_at FROM health_readings WHERE user_id = $1 AND reading_type = 'spo2' ORDER BY recorded_at DESC LIMIT 1`, [elderId]),
    pool.query(`SELECT value, recorded_at FROM health_readings WHERE user_id = $1 AND reading_type = 'sleep' ORDER BY recorded_at DESC LIMIT 1`, [elderId]),
  ]);

  res.json({
    elder: elder.rows[0],
    checkins: checkins.rows,
    medications: meds.rows,
    healthEntries: health.rows,
    contacts: contacts.rows,
    todayCheckins: checkins.rows.filter(c => c.date === today),
    activityLog: activityLog.rows[0] || null,
    latestSpo2: latestSpo2.rows[0] || null,
    latestSleep: latestSleep.rows[0] || null,
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

// ── Commission Calculation Helper ─────────────────────────
async function calculateCommission(pool, affiliate, event, revenue) {
  const model = affiliate.commission_model || 'percentage';
  const rates = affiliate.commission_rate || {};

  if (model === 'fixed_fee') {
    return affiliate.fixed_fee || 0;
  }

  if (model === 'hybrid') {
    // Fixed fee + percentage
    const percentage = rates[event] || 0;
    return (affiliate.fixed_fee || 0) + percentage;
  }

  if (model === 'ramp_up') {
    // Get current period sales count
    const tiers = affiliate.ramp_up_tiers || [];
    const periodSales = affiliate.period_sales || 0;

    // Find applicable tier
    let applicableRate = 0;
    for (const tier of tiers) {
      if (periodSales >= tier.min_sales && (!tier.max_sales || periodSales <= tier.max_sales)) {
        applicableRate = tier.rate || 0;
      }
    }

    // Increment period sales
    await pool.query('UPDATE affiliates SET period_sales = period_sales + 1 WHERE id = $1', [affiliate.id]);

    return revenue ? revenue * applicableRate : applicableRate;
  }

  // Default: percentage model
  return rates[event] || 0;
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
      const affiliate = await pool.query(`SELECT id, commission_rate, commission_model, fixed_fee, ramp_up_tiers, period_sales FROM affiliates WHERE code = $1 AND is_active = true`, [affiliate_code]);
      if (affiliate.rows[0]) {
        const commissionAmount = await calculateCommission(pool, affiliate.rows[0], event, revenue || 0);
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
    const affiliate = await pool.query(`SELECT id, commission_rate, commission_model, fixed_fee, ramp_up_tiers, period_sales FROM affiliates WHERE code = $1 AND is_active = true`, [affiliate_code]);
    if (affiliate.rows[0]) {
      const commissionAmount = await calculateCommission(pool, affiliate.rows[0], event, revenue || 0);
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

  const pwHash = password ? await hashPassword(password) : null;
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
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email format' });

  const validChannels = ['influencer', 'paid_media', 'ad_network', 'b2b_partner'];
  const ch = validChannels.includes(channel) ? channel : 'influencer';

  // Generate unique affiliate code: first 3 chars of channel uppercase + 4 random chars
  const prefix = ch.slice(0, 3).toUpperCase();
  const randomChars = crypto.randomBytes(3).toString('hex').slice(0, 4).toUpperCase();
  let code = prefix + randomChars;

  const pwHash = await hashPassword(password);

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
app.post('/api/affiliates/login', rateLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  try {
    const affiliate = await pool.query(
      `SELECT * FROM affiliates WHERE email = $1 AND is_active = true`,
      [email.toLowerCase().trim()]
    );
    if (affiliate.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const passwordValid = await verifyPassword(password, affiliate.rows[0].password_hash);
    if (!passwordValid) return res.status(401).json({ error: 'Invalid email or password' });

    // Upgrade legacy hash if needed
    if (affiliate.rows[0].password_hash && affiliate.rows[0].password_hash.length === 64 && /^[a-f0-9]+$/.test(affiliate.rows[0].password_hash)) {
      const newHash = await hashPassword(password);
      await pool.query(`UPDATE affiliates SET password_hash = $1 WHERE id = $2`, [newHash, affiliate.rows[0].id]);
    }

    const token = generateToken('af_' + affiliate.rows[0].id);
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    await storeToken(token, 'af_' + affiliate.rows[0].id, ipAddress);

    res.json({ ok: true, token, affiliate: { id: affiliate.rows[0].id, code: affiliate.rows[0].code, name: affiliate.rows[0].name, channel: affiliate.rows[0].channel } });
  } catch (err) {
    console.error('Affiliate login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Authenticated affiliate dashboard
app.get('/api/affiliates/me/dashboard', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const userId = await getTokenUserId(token);
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
  const userId = await getTokenUserId(token);
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

// Request payout (affiliate-authenticated)
app.post('/api/affiliates/me/payout', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const userId = await getTokenUserId(token);
  if (!userId || !String(userId).startsWith('af_')) return res.status(401).json({ error: 'Invalid token' });

  const affiliateId = String(userId).replace('af_', '');
  const MIN_PAYOUT = 100; // R$100 minimum

  try {
    // Check affiliate has enough pending/approved commissions
    const balance = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM commissions WHERE affiliate_id = $1 AND status IN ('pending', 'approved')`,
      [affiliateId]
    );
    const available = parseFloat(balance.rows[0].total);

    if (available < MIN_PAYOUT) {
      return res.status(400).json({ error: `Minimum payout is R$${MIN_PAYOUT}. Your balance is R$${available.toFixed(2)}` });
    }

    // Check affiliate has PIX key
    const affiliate = await pool.query('SELECT pix_key FROM affiliates WHERE id = $1', [affiliateId]);
    if (!affiliate.rows[0]?.pix_key) {
      return res.status(400).json({ error: 'Please set your PIX key first' });
    }

    // Check no pending payout request already exists
    const existing = await pool.query(
      'SELECT id FROM payout_requests WHERE affiliate_id = $1 AND status = $2',
      [affiliateId, 'pending']
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You already have a pending payout request' });
    }

    // Create payout request
    const result = await pool.query(
      'INSERT INTO payout_requests (affiliate_id, amount, pix_key) VALUES ($1, $2, $3) RETURNING *',
      [affiliateId, available, affiliate.rows[0].pix_key]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Payout request error:', err);
    res.status(500).json({ error: 'Failed to create payout request' });
  }
});

// Get payout history (affiliate-authenticated)
app.get('/api/affiliates/me/payouts', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const userId = await getTokenUserId(token);
  if (!userId || !String(userId).startsWith('af_')) return res.status(401).json({ error: 'Invalid token' });

  const affiliateId = String(userId).replace('af_', '');
  try {
    const result = await pool.query(
      'SELECT * FROM payout_requests WHERE affiliate_id = $1 ORDER BY requested_at DESC',
      [affiliateId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Payout history error:', err);
    res.status(500).json({ error: 'Failed to fetch payout history' });
  }
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
  let user = await pool.query(`SELECT referral_code, referral_reward_count, free_months_earned FROM users WHERE id = $1`, [req.userId]);
  if (!user.rows[0].referral_code) {
    const code = 'EB' + Math.random().toString(36).toUpperCase().slice(2, 6);
    await pool.query(`UPDATE users SET referral_code = $1 WHERE id = $2`, [code, req.userId]);
    const referralCount = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [req.userId]);
    return res.json({ code, referral_count: parseInt(referralCount.rows[0].count), free_months_earned: 0 });
  }
  const referralCount = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [req.userId]);
  res.json({
    code: user.rows[0].referral_code,
    referral_count: parseInt(referralCount.rows[0].count),
    free_months_earned: user.rows[0].free_months_earned || 0
  });
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

// ── Medical Profile Routes ────────────────────────────────
app.get('/api/medical-profile/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const result = await pool.query('SELECT * FROM medical_profiles WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.json({ user_id: userId });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Medical profile fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch medical profile' });
  }
});

app.put('/api/medical-profile/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { full_name, date_of_birth, blood_type, allergies, chronic_conditions, current_medications, emergency_notes, cpf, health_plan, health_plan_number, primary_doctor, doctor_phone, address } = req.body;
    const result = await pool.query(
      `INSERT INTO medical_profiles (user_id, full_name, date_of_birth, blood_type, allergies, chronic_conditions, current_medications, emergency_notes, cpf, health_plan, health_plan_number, primary_doctor, doctor_phone, address, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         date_of_birth = EXCLUDED.date_of_birth,
         blood_type = EXCLUDED.blood_type,
         allergies = EXCLUDED.allergies,
         chronic_conditions = EXCLUDED.chronic_conditions,
         current_medications = EXCLUDED.current_medications,
         emergency_notes = EXCLUDED.emergency_notes,
         cpf = EXCLUDED.cpf,
         health_plan = EXCLUDED.health_plan,
         health_plan_number = EXCLUDED.health_plan_number,
         primary_doctor = EXCLUDED.primary_doctor,
         doctor_phone = EXCLUDED.doctor_phone,
         address = EXCLUDED.address,
         updated_at = NOW()
       RETURNING *`,
      [userId, full_name || null, date_of_birth || null, blood_type || null, allergies || null, chronic_conditions || null, current_medications || null, emergency_notes || null, cpf || null, health_plan || null, health_plan_number || null, primary_doctor || null, doctor_phone || null, address || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Medical profile update error:', err);
    res.status(500).json({ error: 'Failed to update medical profile' });
  }
});

app.get('/api/medical-profile/:userId/emergency-card', authMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const [profile, user] = await Promise.all([
      pool.query('SELECT * FROM medical_profiles WHERE user_id = $1', [userId]),
      pool.query('SELECT name, phone FROM users WHERE id = $1', [userId]),
    ]);
    const p = profile.rows[0] || {};
    const u = user.rows[0] || {};
    const dob = p.date_of_birth ? new Date(p.date_of_birth) : null;
    const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
    const contacts = await pool.query('SELECT name, phone, relationship FROM contacts WHERE user_id = $1 ORDER BY priority', [userId]);
    res.json({
      name: p.full_name || u.name || 'N/A',
      age,
      date_of_birth: p.date_of_birth || null,
      phone: u.phone || null,
      blood_type: p.blood_type || null,
      allergies: p.allergies || null,
      chronic_conditions: p.chronic_conditions || null,
      current_medications: p.current_medications || null,
      emergency_notes: p.emergency_notes || null,
      cpf: p.cpf || null,
      health_plan: p.health_plan || null,
      health_plan_number: p.health_plan_number || null,
      primary_doctor: p.primary_doctor || null,
      doctor_phone: p.doctor_phone || null,
      address: p.address || null,
      emergency_contacts: contacts.rows,
    });
  } catch (err) {
    console.error('Emergency card fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch emergency card' });
  }
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

// ── Admin Auth Middleware (JWT + legacy X-Admin-Key fallback) ──
async function adminAuth(req, res, next) {
  // 1. Try Bearer token (new admin auth)
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer adm_')) {
    const token = auth.slice(7);
    const adminUser = await getAdminByToken(token);
    if (adminUser) {
      req.adminUser = adminUser;
      return next();
    }
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }

  // 2. Legacy fallback: X-Admin-Key header
  const key = req.headers['x-admin-key'];
  if (key && key === ADMIN_KEY) {
    req.adminUser = { id: null, email: 'legacy@admin', name: 'Legacy Admin', role: 'super_admin', is_active: true };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: missing or invalid credentials' });
}

// Role-based access control helper
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.adminUser) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.adminUser.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    next();
  };
}

function getAdminIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

// ── Admin Auth API Routes ─────────────────────────────────

// POST /api/admin/login — email + password login
app.post('/api/admin/login', rateLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const result = await pool.query(
    `SELECT id, email, password_hash, name, role, avatar_url, is_active FROM admin_users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

  const admin = result.rows[0];
  if (!admin.is_active) return res.status(401).json({ error: 'Account is deactivated' });

  const valid = await verifyPassword(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = generateAdminToken(admin.id);
  const ip = getAdminIp(req);
  await storeAdminToken(token, admin.id, ip);
  await pool.query(`UPDATE admin_users SET last_login = NOW() WHERE id = $1`, [admin.id]);
  await logAdminAction(admin.id, 'login', { email: admin.email }, ip);

  delete admin.password_hash;
  res.json({ ok: true, token, user: admin });
}));

// POST /api/admin/forgot-password
app.post('/api/admin/forgot-password', rateLimiter, asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = await pool.query(`SELECT id, name, email FROM admin_users WHERE email = $1 AND is_active = true`, [email.toLowerCase().trim()]);
  if (user.rows.length === 0) {
    return res.json({ ok: true, message: 'If an admin account with that email exists, a reset link has been sent.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`, [user.rows[0].id, resetToken, expiresAt]);

  const resetUrl = `${SERVER_URL}/admin-reset-password?token=${resetToken}`;
  await sendEmail(email.toLowerCase().trim(), 'Estou Bem Admin — Redefinir Senha', `
    <div style="font-family:'Inter',sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#F5F0EB;border-radius:8px">
      <div style="text-align:center;margin-bottom:20px"><span style="font-family:Georgia,serif;font-size:24px;color:#2D4A3E">Estou Bem — Admin</span></div>
      <div style="background:white;padding:24px;border-radius:4px;border:1px solid #E5DDD3">
        <h2 style="color:#2D4A3E;margin:0 0 12px">Redefinir Senha</h2>
        <p style="color:#5C5549;line-height:1.6">Olá ${user.rows[0].name}, você solicitou a redefinição da sua senha de administrador.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#2D4A3E;color:white;padding:12px 24px;border-radius:4px;text-decoration:none;margin:16px 0">Redefinir Senha</a>
        <p style="color:#9A9189;font-size:13px;margin-top:16px">Este link expira em 1 hora.</p>
      </div>
    </div>
  `);

  res.json({ ok: true, message: 'If an admin account with that email exists, a reset link has been sent.' });
}));

// POST /api/admin/reset-password
app.post('/api/admin/reset-password', rateLimiter, asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const result = await pool.query(`SELECT user_id FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW() AND used = false`, [token]);
  if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset token' });

  const userId = result.rows[0].user_id;
  const hash = await hashPassword(password);
  await pool.query(`UPDATE admin_users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
  await pool.query(`UPDATE password_reset_tokens SET used = true WHERE token = $1`, [token]);
  await pool.query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [userId]);

  res.json({ ok: true, message: 'Password reset successfully' });
}));

// POST /api/admin/logout
app.post('/api/admin/logout', asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer adm_')) {
    await deleteAdminToken(auth.slice(7));
  }
  res.json({ ok: true });
}));

// GET /api/admin/me — current admin user info
app.get('/api/admin/me', adminAuth, asyncHandler(async (req, res) => {
  const { password_hash, ...user } = req.adminUser;
  res.json(user);
}));

// GET /api/admin/team — list admin users (super_admin only)
app.get('/api/admin/team', adminAuth, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, email, name, role, avatar_url, is_active, last_login, created_at, created_by
     FROM admin_users ORDER BY created_at DESC`
  );
  res.json(result.rows);
}));

// POST /api/admin/team — create admin user (super_admin only)
app.post('/api/admin/team', adminAuth, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'email, password, name, and role are required' });
  }
  if (!['super_admin', 'admin', 'support', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email format' });

  const hash = await hashPassword(password);
  try {
    const result = await pool.query(
      `INSERT INTO admin_users (email, password_hash, name, role, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, is_active, created_at, created_by`,
      [email.toLowerCase().trim(), hash, name.trim(), role, req.adminUser.id]
    );
    const ip = getAdminIp(req);
    await logAdminAction(req.adminUser.id, 'admin_user_create', { created_email: email, role }, ip);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
}));

// PUT /api/admin/team/:id — update admin user (super_admin only)
app.put('/api/admin/team/:id', adminAuth, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { name, email, role, is_active, password } = req.body;
  const targetId = parseInt(req.params.id);

  if (req.adminUser.id === targetId && is_active === false) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
  if (email !== undefined) { updates.push(`email = $${idx++}`); values.push(email.toLowerCase().trim()); }
  if (role !== undefined) {
    if (!['super_admin', 'admin', 'support', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    updates.push(`role = $${idx++}`); values.push(role);
  }
  if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(is_active); }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    updates.push(`password_hash = $${idx++}`); values.push(await hashPassword(password));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  values.push(targetId);
  const result = await pool.query(
    `UPDATE admin_users SET ${updates.join(', ')} WHERE id = $${idx}
     RETURNING id, email, name, role, is_active, last_login, created_at`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Admin user not found' });

  const ip = getAdminIp(req);
  await logAdminAction(req.adminUser.id, 'admin_user_update', { target_id: targetId, changes: req.body }, ip);

  if (is_active === false) {
    await pool.query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [targetId]);
  }

  res.json(result.rows[0]);
}));

// DELETE /api/admin/team/:id — deactivate admin user (super_admin only)
app.delete('/api/admin/team/:id', adminAuth, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.adminUser.id === targetId) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }
  const result = await pool.query(
    `UPDATE admin_users SET is_active = false WHERE id = $1 RETURNING id, email, name, role`,
    [targetId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Admin user not found' });
  await pool.query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [targetId]);

  const ip = getAdminIp(req);
  await logAdminAction(req.adminUser.id, 'admin_user_deactivate', { target: result.rows[0] }, ip);
  res.json({ ok: true, deactivated: result.rows[0] });
}));

// GET /api/admin/audit-log — view audit log (super_admin + admin)
app.get('/api/admin/audit-log', adminAuth, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const { admin_user_id, action, from_date, to_date, limit: lim } = req.query;
  let query = `SELECT al.*, au.name as admin_name, au.email as admin_email
    FROM admin_audit_log al
    LEFT JOIN admin_users au ON al.admin_user_id = au.id
    WHERE 1=1`;
  const values = [];
  let idx = 1;

  if (admin_user_id) { query += ` AND al.admin_user_id = $${idx++}`; values.push(parseInt(admin_user_id)); }
  if (action) { query += ` AND al.action = $${idx++}`; values.push(action); }
  if (from_date) { query += ` AND al.created_at >= $${idx++}`; values.push(from_date); }
  if (to_date) { query += ` AND al.created_at <= $${idx++}`; values.push(to_date + 'T23:59:59Z'); }

  query += ` ORDER BY al.created_at DESC LIMIT $${idx}`;
  values.push(parseInt(lim) || 200);

  const result = await pool.query(query, values);
  res.json(result.rows);
}));

// ── Admin Data API Routes ─────────────────────────────────

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

// PUT /api/admin/users/:id - edit regular user
app.put('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    if (!['super_admin', 'admin'].includes(req.adminUser.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { name, email, phone, role, subscription, linked_elder_id } = req.body;
    const linkedId = linked_elder_id === '' || linked_elder_id === undefined ? null : linked_elder_id;
    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        phone = COALESCE($3, phone),
        role = COALESCE($4, role),
        subscription = COALESCE($5, subscription),
        linked_elder_id = $6
      WHERE id = $7 RETURNING id, name, email, phone, role, subscription, linked_elder_id`,
      [name || null, email || null, phone || null, role || null, subscription || null, linkedId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    // Audit log
    if (req.adminUser) {
      await pool.query(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)`,
        [req.adminUser.id, 'update_user', 'user', req.params.id, JSON.stringify(req.body)]);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /api/admin/users/:id/reset-password - admin resets user password
app.post('/api/admin/users/:id/reset-password', adminAuth, async (req, res) => {
  try {
    if (!['super_admin', 'admin'].includes(req.adminUser.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(new_password, 12);
    const result = await pool.query(
      `UPDATE users SET password = $1 WHERE id = $2 RETURNING id, name, email`,
      [hashed, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    // Audit log
    if (req.adminUser) {
      await pool.query(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)`,
        [req.adminUser.id, 'reset_user_password', 'user', req.params.id, JSON.stringify({ user_email: result.rows[0].email })]);
    }

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('Admin reset user password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
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
    const { is_active, name, email, phone, channel, commission_rate, pix_key, commission_model, fixed_fee, ramp_up_tiers } = req.body;
    const result = await pool.query(
      `UPDATE affiliates SET
        is_active = COALESCE($1, is_active),
        name = COALESCE($2, name),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        channel = COALESCE($5, channel),
        commission_rate = COALESCE($6, commission_rate),
        pix_key = COALESCE($7, pix_key),
        commission_model = COALESCE($8, commission_model),
        fixed_fee = COALESCE($9, fixed_fee),
        ramp_up_tiers = COALESCE($10, ramp_up_tiers)
      WHERE id = $11 RETURNING *`,
      [is_active, name, email, phone, channel, commission_rate ? JSON.stringify(commission_rate) : null, pix_key !== undefined ? pix_key : null, commission_model || null, fixed_fee !== undefined ? fixed_fee : null, ramp_up_tiers ? JSON.stringify(ramp_up_tiers) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Affiliate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update affiliate error:', err);
    res.status(500).json({ error: 'Failed to update affiliate' });
  }
});

// PUT /api/admin/affiliates/:id/commission-model - update commission model
app.put('/api/admin/affiliates/:id/commission-model', adminAuth, async (req, res) => {
  const { commission_model, fixed_fee, commission_rate, ramp_up_tiers } = req.body;
  try {
    const result = await pool.query(
      `UPDATE affiliates SET
        commission_model = COALESCE($1, commission_model),
        fixed_fee = COALESCE($2, fixed_fee),
        commission_rate = COALESCE($3, commission_rate),
        ramp_up_tiers = COALESCE($4, ramp_up_tiers)
      WHERE id = $5 RETURNING *`,
      [commission_model, fixed_fee, commission_rate ? JSON.stringify(commission_rate) : null, ramp_up_tiers ? JSON.stringify(ramp_up_tiers) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Affiliate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update commission model error:', err);
    res.status(500).json({ error: 'Failed to update commission model' });
  }
});

// GET /api/admin/referral-rewards - see users who earned free months
app.get('/api/admin/referral-rewards', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rr.*, u.name, u.email, u.free_months_earned
       FROM referral_rewards rr
       JOIN users u ON rr.user_id = u.id
       ORDER BY rr.created_at DESC LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Admin referral rewards error:', err);
    res.status(500).json({ error: 'Failed to fetch referral rewards' });
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

// ── Admin Payout Endpoints ────────────────────────────────
app.get('/api/admin/payouts', adminAuth, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT pr.*, a.name as affiliate_name, a.code as affiliate_code, a.email as affiliate_email, a.pix_key as current_pix_key
      FROM payout_requests pr
      JOIN affiliates a ON pr.affiliate_id = a.id`;
    const params = [];
    if (status) { params.push(status); query += ` WHERE pr.status = $1`; }
    query += ' ORDER BY pr.requested_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin payouts error:', err);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

app.put('/api/admin/payouts/:id', adminAuth, async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    if (!['pending', 'processing', 'completed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    let query = 'UPDATE payout_requests SET status = $1, admin_notes = COALESCE($2, admin_notes)';
    if (status === 'completed') query += ', processed_at = NOW()';
    if (status === 'rejected') query += ', processed_at = NOW()';
    query += ' WHERE id = $3 RETURNING *';

    const result = await pool.query(query, [status, admin_notes, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payout request not found' });
    }

    // If completed, mark the commissions as paid
    if (status === 'completed' && result.rows[0]) {
      await pool.query(
        `UPDATE commissions SET status = 'paid', paid_at = NOW() WHERE affiliate_id = $1 AND status IN ('pending', 'approved')`,
        [result.rows[0].affiliate_id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin payout update error:', err);
    res.status(500).json({ error: 'Failed to update payout' });
  }
});

// ── Admin Analytics / BI Endpoints ────────────────────────

// 1. Overview KPIs
app.get('/api/admin/analytics/overview', adminAuth, requireRole('super_admin', 'admin', 'support'), asyncHandler(async (req, res) => {
  const [
    totalUsers, roleBreakdown, active7d, active30d, newThisWeek, newThisMonth,
    checkinsToday, checkinsWeek, checkinsMonth, confirmedToday, confirmedWeek, confirmedMonth,
    avgStreak, totalSos, totalEscalations, avgResponseTime
  ] = await Promise.all([
    pool.query(`SELECT COUNT(*) as cnt FROM users`),
    pool.query(`SELECT role, COUNT(*) as cnt FROM users GROUP BY role`),
    pool.query(`SELECT COUNT(DISTINCT user_id) as cnt FROM checkins WHERE created_at > NOW() - INTERVAL '7 days'`),
    pool.query(`SELECT COUNT(DISTINCT user_id) as cnt FROM checkins WHERE created_at > NOW() - INTERVAL '30 days'`),
    pool.query(`SELECT COUNT(*) as cnt FROM users WHERE created_at > NOW() - INTERVAL '7 days'`),
    pool.query(`SELECT COUNT(*) as cnt FROM users WHERE created_at > NOW() - INTERVAL '30 days'`),
    pool.query(`SELECT COUNT(*) as cnt FROM checkins WHERE date = TO_CHAR(NOW(), 'YYYY-MM-DD')`),
    pool.query(`SELECT COUNT(*) as cnt FROM checkins WHERE created_at > NOW() - INTERVAL '7 days'`),
    pool.query(`SELECT COUNT(*) as cnt FROM checkins WHERE created_at > NOW() - INTERVAL '30 days'`),
    pool.query(`SELECT COUNT(*) as cnt FROM checkins WHERE date = TO_CHAR(NOW(), 'YYYY-MM-DD') AND status = 'confirmed'`),
    pool.query(`SELECT COUNT(*) as cnt FROM checkins WHERE created_at > NOW() - INTERVAL '7 days' AND status = 'confirmed'`),
    pool.query(`SELECT COUNT(*) as cnt FROM checkins WHERE created_at > NOW() - INTERVAL '30 days' AND status = 'confirmed'`),
    pool.query(`SELECT COALESCE(AVG(streak_days), 0) as avg FROM users WHERE role = 'elder'`),
    pool.query(`SELECT COUNT(*) as cnt FROM fall_events`),
    pool.query(`SELECT COUNT(*) as cnt FROM escalation_alerts`),
    pool.query(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (confirmed_at - created_at))), 0) as avg_seconds FROM checkins WHERE confirmed_at IS NOT NULL AND created_at > NOW() - INTERVAL '30 days'`),
  ]);

  const roles = {};
  roleBreakdown.rows.forEach(r => { roles[r.role] = parseInt(r.cnt); });

  const totalCheckinsToday = parseInt(checkinsToday.rows[0].cnt) || 1;
  const totalCheckinsWeek = parseInt(checkinsWeek.rows[0].cnt) || 1;
  const totalCheckinsMonth = parseInt(checkinsMonth.rows[0].cnt) || 1;

  res.json({
    totalUsers: parseInt(totalUsers.rows[0].cnt),
    roleBreakdown: roles,
    activeUsers7d: parseInt(active7d.rows[0].cnt),
    activeUsers30d: parseInt(active30d.rows[0].cnt),
    newUsersThisWeek: parseInt(newThisWeek.rows[0].cnt),
    newUsersThisMonth: parseInt(newThisMonth.rows[0].cnt),
    checkinsToday: parseInt(checkinsToday.rows[0].cnt),
    checkinsWeek: parseInt(checkinsWeek.rows[0].cnt),
    checkinsMonth: parseInt(checkinsMonth.rows[0].cnt),
    checkinRateToday: (parseInt(confirmedToday.rows[0].cnt) / totalCheckinsToday * 100).toFixed(1),
    checkinRateWeek: (parseInt(confirmedWeek.rows[0].cnt) / totalCheckinsWeek * 100).toFixed(1),
    checkinRateMonth: (parseInt(confirmedMonth.rows[0].cnt) / totalCheckinsMonth * 100).toFixed(1),
    avgStreak: parseFloat(parseFloat(avgStreak.rows[0].avg).toFixed(1)),
    totalSos: parseInt(totalSos.rows[0].cnt),
    totalEscalations: parseInt(totalEscalations.rows[0].cnt),
    samuCalls: 0, // tracked separately if SAMU integration logs exist
    avgResponseTimeSeconds: parseFloat(parseFloat(avgResponseTime.rows[0].avg_seconds).toFixed(0)),
  });
}));

// 2. Growth Metrics
app.get('/api/admin/analytics/growth', adminAuth, requireRole('super_admin', 'admin', 'support'), asyncHandler(async (req, res) => {
  const [dailySignups, dailyActive, cumulativeGrowth] = await Promise.all([
    pool.query(`SELECT DATE(created_at) as day, COUNT(*) as cnt FROM users WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day`),
    pool.query(`SELECT date, COUNT(DISTINCT user_id) as cnt FROM checkins WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY date ORDER BY date`),
    pool.query(`SELECT DATE(created_at) as day, COUNT(*) as cnt FROM users GROUP BY DATE(created_at) ORDER BY day`),
  ]);

  // Weekly retention: users active this week who were also active last week
  const retentionResult = await pool.query(`
    SELECT
      COUNT(DISTINCT CASE WHEN tw.user_id IS NOT NULL AND lw.user_id IS NOT NULL THEN tw.user_id END) as retained,
      COUNT(DISTINCT lw.user_id) as last_week_total
    FROM (SELECT DISTINCT user_id FROM checkins WHERE created_at > NOW() - INTERVAL '7 days') tw
    FULL OUTER JOIN (SELECT DISTINCT user_id FROM checkins WHERE created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days') lw ON tw.user_id = lw.user_id
  `);
  const retained = parseInt(retentionResult.rows[0].retained) || 0;
  const lastWeekTotal = parseInt(retentionResult.rows[0].last_week_total) || 1;

  // Monthly churn: elders active last month but not this month
  const churnResult = await pool.query(`
    SELECT
      COUNT(DISTINCT lm.user_id) as last_month,
      COUNT(DISTINCT CASE WHEN tm.user_id IS NULL THEN lm.user_id END) as churned
    FROM (SELECT DISTINCT user_id FROM checkins WHERE created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days') lm
    LEFT JOIN (SELECT DISTINCT user_id FROM checkins WHERE created_at > NOW() - INTERVAL '30 days') tm ON lm.user_id = tm.user_id
  `);
  const lastMonth = parseInt(churnResult.rows[0].last_month) || 1;
  const churned = parseInt(churnResult.rows[0].churned) || 0;

  // Build cumulative growth
  let cumulative = 0;
  const cumulativeData = cumulativeGrowth.rows.map(r => {
    cumulative += parseInt(r.cnt);
    return { day: r.day, total: cumulative };
  });

  res.json({
    dailySignups: dailySignups.rows.map(r => ({ day: r.day, count: parseInt(r.cnt) })),
    dailyActiveUsers: dailyActive.rows.map(r => ({ day: r.day, count: parseInt(r.cnt) })),
    weeklyRetentionRate: (retained / lastWeekTotal * 100).toFixed(1),
    monthlyChurnRate: (churned / lastMonth * 100).toFixed(1),
    cumulativeGrowth: cumulativeData,
  });
}));

// 3. Engagement Metrics
app.get('/api/admin/analytics/engagement', adminAuth, requireRole('super_admin', 'admin', 'support'), asyncHandler(async (req, res) => {
  const [byDow, byHour, streakDist, topStreaks, notCheckedIn] = await Promise.all([
    pool.query(`
      SELECT EXTRACT(DOW FROM created_at) as dow,
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed
      FROM checkins WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY dow ORDER BY dow
    `),
    pool.query(`
      SELECT EXTRACT(HOUR FROM confirmed_at) as hr,
             COUNT(*) as cnt
      FROM checkins WHERE confirmed_at IS NOT NULL AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY hr ORDER BY hr
    `),
    pool.query(`
      SELECT
        CASE
          WHEN streak_days BETWEEN 0 AND 7 THEN '0-7'
          WHEN streak_days BETWEEN 8 AND 14 THEN '8-14'
          WHEN streak_days BETWEEN 15 AND 30 THEN '15-30'
          ELSE '30+'
        END as bracket,
        COUNT(*) as cnt
      FROM users WHERE role = 'elder'
      GROUP BY bracket ORDER BY bracket
    `),
    pool.query(`SELECT id, name, streak_days FROM users WHERE role = 'elder' ORDER BY streak_days DESC LIMIT 10`),
    pool.query(`
      SELECT u.id, u.name, u.email, MAX(c.created_at) as last_checkin
      FROM users u LEFT JOIN checkins c ON c.user_id = u.id AND c.date = TO_CHAR(NOW(), 'YYYY-MM-DD')
      WHERE u.role = 'elder' AND c.id IS NULL
      LIMIT 20
    `),
  ]);

  res.json({
    checkinByDow: byDow.rows.map(r => ({
      dow: parseInt(r.dow),
      total: parseInt(r.total),
      confirmed: parseInt(r.confirmed),
      rate: (parseInt(r.total) > 0 ? (parseInt(r.confirmed) / parseInt(r.total) * 100).toFixed(1) : '0.0'),
    })),
    checkinByHour: byHour.rows.map(r => ({ hour: parseInt(r.hr), count: parseInt(r.cnt) })),
    streakDistribution: streakDist.rows.map(r => ({ bracket: r.bracket, count: parseInt(r.cnt) })),
    topStreaks: topStreaks.rows.map(r => ({ id: r.id, name: r.name, streak: r.streak_days })),
    notCheckedInToday: notCheckedIn.rows.map(r => ({ id: r.id, name: r.name, email: r.email })),
  });
}));

// 4. Health Data (anonymized)
app.get('/api/admin/analytics/health', adminAuth, requireRole('super_admin', 'admin', 'support'), asyncHandler(async (req, res) => {
  const [avgHr, spo2Dist, falls, inactivity, medAdherence, sleepQuality, hrTrend] = await Promise.all([
    pool.query(`SELECT COALESCE(AVG(value), 0) as avg FROM health_readings WHERE reading_type = 'heart_rate' AND recorded_at > NOW() - INTERVAL '30 days'`),
    pool.query(`
      SELECT
        CASE
          WHEN value >= 98 THEN '98-100'
          WHEN value >= 95 THEN '95-97'
          WHEN value >= 90 THEN '90-94'
          ELSE '<90'
        END as range,
        COUNT(*) as cnt
      FROM health_readings WHERE reading_type = 'spo2' AND recorded_at > NOW() - INTERVAL '30 days'
      GROUP BY range ORDER BY range DESC
    `),
    pool.query(`SELECT COUNT(*) as cnt FROM fall_events WHERE detected_at > NOW() - INTERVAL '30 days'`),
    pool.query(`SELECT COUNT(*) as cnt FROM activity_logs WHERE last_movement_at < NOW() - INTERVAL '2 hours'`),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE value > 0) as taken,
        COUNT(*) as total
      FROM health_entries WHERE type = 'medication' AND created_at > NOW() - INTERVAL '30 days'
    `),
    pool.query(`SELECT COALESCE(AVG(value), 0) as avg FROM health_readings WHERE reading_type = 'sleep' AND recorded_at > NOW() - INTERVAL '30 days'`),
    pool.query(`
      SELECT DATE(recorded_at) as day, AVG(value) as avg
      FROM health_readings WHERE reading_type = 'heart_rate' AND recorded_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(recorded_at) ORDER BY day
    `),
  ]);

  const medTotal = parseInt(medAdherence.rows[0]?.total) || 1;
  const medTaken = parseInt(medAdherence.rows[0]?.taken) || 0;

  res.json({
    avgHeartRate: parseFloat(parseFloat(avgHr.rows[0].avg).toFixed(1)),
    spo2Distribution: spo2Dist.rows.map(r => ({ range: r.range, count: parseInt(r.cnt) })),
    fallEvents30d: parseInt(falls.rows[0].cnt),
    inactivityAlerts: parseInt(inactivity.rows[0].cnt),
    medicationAdherenceRate: (medTaken / medTotal * 100).toFixed(1),
    avgSleepQuality: parseFloat(parseFloat(sleepQuality.rows[0].avg).toFixed(1)),
    heartRateTrend: hrTrend.rows.map(r => ({ day: r.day, avg: parseFloat(parseFloat(r.avg).toFixed(1)) })),
  });
}));

// 5. Revenue Metrics
app.get('/api/admin/analytics/revenue', adminAuth, requireRole('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const [subBreakdown, conversions, affiliateRev, revenueByMonth, churnByPlan] = await Promise.all([
    pool.query(`SELECT subscription, COUNT(*) as cnt FROM users GROUP BY subscription`),
    pool.query(`SELECT SUM(revenue) as total, COUNT(*) as cnt FROM conversions WHERE created_at > NOW() - INTERVAL '30 days'`),
    pool.query(`
      SELECT
        SUM(CASE WHEN affiliate_code IS NOT NULL AND affiliate_code != '' THEN revenue ELSE 0 END) as affiliate_rev,
        SUM(CASE WHEN affiliate_code IS NULL OR affiliate_code = '' THEN revenue ELSE 0 END) as organic_rev
      FROM conversions WHERE created_at > NOW() - INTERVAL '30 days'
    `),
    pool.query(`
      SELECT TO_CHAR(created_at, 'YYYY-MM') as month, SUM(revenue) as total
      FROM conversions
      GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY month
    `),
    pool.query(`
      SELECT u.subscription, COUNT(DISTINCT lm.user_id) as last_month, COUNT(DISTINCT CASE WHEN tm.user_id IS NULL THEN lm.user_id END) as churned
      FROM (SELECT DISTINCT user_id FROM checkins WHERE created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days') lm
      LEFT JOIN (SELECT DISTINCT user_id FROM checkins WHERE created_at > NOW() - INTERVAL '30 days') tm ON lm.user_id = tm.user_id
      JOIN users u ON u.id = lm.user_id
      GROUP BY u.subscription
    `),
  ]);

  const subs = {};
  subBreakdown.rows.forEach(r => { subs[r.subscription || 'free'] = parseInt(r.cnt); });
  const totalUsers = Object.values(subs).reduce((a, b) => a + b, 0) || 1;
  const paidUsers = (subs.familia || 0) + (subs.central || 0);
  const freeUsers = subs.free || 0;

  // MRR estimation: familia = R$29.90, central = R$49.90
  const mrr = (subs.familia || 0) * 29.90 + (subs.central || 0) * 49.90;
  const arpu = totalUsers > 0 ? mrr / totalUsers : 0;

  // Top affiliates
  const topAffiliates = await pool.query(`
    SELECT a.name, a.code, SUM(c.revenue) as total_revenue, COUNT(*) as conversions
    FROM conversions c JOIN affiliates a ON a.code = c.affiliate_code
    WHERE c.created_at > NOW() - INTERVAL '30 days'
    GROUP BY a.name, a.code ORDER BY total_revenue DESC LIMIT 10
  `);

  res.json({
    mrr: parseFloat(mrr.toFixed(2)),
    subscriptionBreakdown: subs,
    conversionRate: freeUsers > 0 ? (paidUsers / (freeUsers + paidUsers) * 100).toFixed(1) : '0.0',
    arpu: parseFloat(arpu.toFixed(2)),
    affiliateRevenue: parseFloat(affiliateRev.rows[0]?.affiliate_rev || 0),
    organicRevenue: parseFloat(affiliateRev.rows[0]?.organic_rev || 0),
    revenueByMonth: revenueByMonth.rows.map(r => ({ month: r.month, total: parseFloat(r.total) })),
    churnByPlan: churnByPlan.rows.map(r => ({
      plan: r.subscription,
      lastMonth: parseInt(r.last_month),
      churned: parseInt(r.churned),
      rate: parseInt(r.last_month) > 0 ? (parseInt(r.churned) / parseInt(r.last_month) * 100).toFixed(1) : '0.0',
    })),
    topAffiliates: topAffiliates.rows.map(r => ({
      name: r.name, code: r.code,
      revenue: parseFloat(r.total_revenue), conversions: parseInt(r.conversions),
    })),
    ltv: parseFloat((arpu * 12 * 0.7).toFixed(2)), // Simple LTV: ARPU * 12 months * 70% retention
  });
}));

// 6. Escalation Metrics
app.get('/api/admin/analytics/escalation', adminAuth, requireRole('super_admin', 'admin', 'support'), asyncHandler(async (req, res) => {
  const [byLevel, avgResolution, totalCheckins30d, samuCalls, byHour, falseAlarms] = await Promise.all([
    pool.query(`SELECT level, COUNT(*) as cnt FROM escalation_alerts WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY level ORDER BY level`),
    pool.query(`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (
        CASE WHEN status IN ('resolved','dismissed') THEN
          COALESCE(
            (SELECT MAX(created_at) FROM admin_audit_log WHERE details->>'escalation_id' = escalation_alerts.id::text),
            created_at + INTERVAL '30 minutes'
          )
        ELSE NULL END - created_at
      ))), 0) as avg_seconds
      FROM escalation_alerts WHERE created_at > NOW() - INTERVAL '30 days' AND status IN ('resolved','dismissed')
    `),
    pool.query(`SELECT COUNT(*) as cnt FROM checkins WHERE created_at > NOW() - INTERVAL '30 days'`),
    pool.query(`SELECT COUNT(*) as cnt FROM escalation_alerts WHERE level >= 3 AND created_at > NOW() - INTERVAL '30 days'`),
    pool.query(`
      SELECT EXTRACT(HOUR FROM created_at) as hr, COUNT(*) as cnt
      FROM escalation_alerts WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY hr ORDER BY hr
    `),
    pool.query(`SELECT COUNT(*) as cnt FROM escalation_alerts WHERE status = 'dismissed' AND created_at > NOW() - INTERVAL '30 days'`),
  ]);

  const totalEsc = byLevel.rows.reduce((sum, r) => sum + parseInt(r.cnt), 0);
  const totalCI = parseInt(totalCheckins30d.rows[0].cnt) || 1;

  res.json({
    byLevel: byLevel.rows.map(r => ({ level: r.level, count: parseInt(r.cnt) })),
    avgResolutionSeconds: parseFloat(parseFloat(avgResolution.rows[0].avg_seconds).toFixed(0)),
    escalationRate: (totalEsc / totalCI * 100).toFixed(2),
    samuCalls: parseInt(samuCalls.rows[0].cnt),
    falseAlarmRate: totalEsc > 0 ? (parseInt(falseAlarms.rows[0].cnt) / totalEsc * 100).toFixed(1) : '0.0',
    byHour: byHour.rows.map(r => ({ hour: parseInt(r.hr), count: parseInt(r.cnt) })),
    totalEscalations: totalEsc,
  });
}));

// 7. Individual User Analytics
app.get('/api/admin/analytics/users/:id', adminAuth, requireRole('super_admin', 'admin', 'support'), asyncHandler(async (req, res) => {
  const uid = req.params.id;
  const [user, checkins, healthReadings, escalations, family, streak] = await Promise.all([
    pool.query(`SELECT id, name, email, phone, role, subscription, trial_start, created_at, streak_days, total_points, badges FROM users WHERE id = $1`, [uid]),
    pool.query(`SELECT id, time, status, date, confirmed_at, escalation_level, created_at FROM checkins WHERE user_id = $1 ORDER BY created_at DESC LIMIT 90`, [uid]),
    pool.query(`SELECT reading_type, value, recorded_at FROM health_readings WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 200`, [uid]),
    pool.query(`SELECT id, level, status, created_at FROM escalation_alerts WHERE elder_id = $1 ORDER BY created_at DESC LIMIT 20`, [uid]),
    pool.query(`SELECT id, name, email, phone, relationship FROM family_contacts WHERE elder_id = $1`, [uid]),
    pool.query(`SELECT streak_days FROM users WHERE id = $1`, [uid]),
  ]);

  if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

  // Build calendar heatmap data (last 90 days)
  const calendarData = {};
  checkins.rows.forEach(c => {
    if (!calendarData[c.date]) calendarData[c.date] = { total: 0, confirmed: 0 };
    calendarData[c.date].total++;
    if (c.status === 'confirmed') calendarData[c.date].confirmed++;
  });

  // Group health readings by type
  const healthByType = {};
  healthReadings.rows.forEach(r => {
    if (!healthByType[r.reading_type]) healthByType[r.reading_type] = [];
    healthByType[r.reading_type].push({ value: parseFloat(r.value), date: r.recorded_at });
  });

  res.json({
    user: user.rows[0],
    checkinCalendar: calendarData,
    checkins: checkins.rows,
    healthData: healthByType,
    escalations: escalations.rows,
    familyMembers: family.rows,
    currentStreak: streak.rows[0]?.streak_days || 0,
  });
}));

// ── Static Files (no-cache for development) ──────────────
app.use(express.static(__dirname, {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => res.set('Cache-Control', 'no-cache, no-store, must-revalidate'),
}));

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

// Password reset page
app.get('/reset-password', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Estou Bem — Redefinir Senha</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#F5F0EB;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border:1px solid #E5DDD3;border-radius:4px;padding:40px;max-width:400px;width:100%;text-align:center}
h1{font-family:'Playfair Display',serif;color:#2D4A3E;font-size:24px;margin-bottom:8px}
p{color:#5C5549;font-size:14px;margin-bottom:24px;line-height:1.5}
label{display:block;text-align:left;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#9A9189;margin-bottom:6px}
input{width:100%;padding:12px;border:none;border-bottom:2px solid #E5DDD3;font-size:16px;background:transparent;outline:none;margin-bottom:16px;transition:border-color .2s}
input:focus{border-color:#C9A96E}
button{width:100%;padding:14px;background:#2D4A3E;color:#F5F0EB;border:none;border-radius:4px;font-size:13px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;font-weight:500}
button:hover{background:#1E352B}
.msg{margin-top:16px;padding:12px;border-radius:4px;font-size:13px}
.msg.ok{background:#E8F0EC;color:#2D4A3E}.msg.err{background:#F5E8E8;color:#8B3A3A}
.logo{font-family:'Playfair Display',serif;color:#2D4A3E;font-size:28px;margin-bottom:24px}
.divider{width:40px;height:2px;background:#C9A96E;margin:0 auto 24px}
</style></head><body>
<div class="card">
  <div class="logo">Estou Bem</div>
  <h1>Redefinir Senha</h1>
  <div class="divider"></div>
  <p>Digite sua nova senha abaixo.</p>
  <div id="form">
    <label>NOVA SENHA</label>
    <input type="password" id="pw1" placeholder="Mínimo 8 caracteres" minlength="8">
    <label>CONFIRMAR SENHA</label>
    <input type="password" id="pw2" placeholder="Repita a senha" minlength="8">
    <button onclick="doReset()">REDEFINIR SENHA</button>
  </div>
  <div id="msg" class="msg" style="display:none"></div>
</div>
<script>
async function doReset(){
  const pw1=document.getElementById('pw1').value;
  const pw2=document.getElementById('pw2').value;
  const msg=document.getElementById('msg');
  if(pw1.length<8){msg.className='msg err';msg.textContent='A senha deve ter no mínimo 8 caracteres.';msg.style.display='block';return}
  if(pw1!==pw2){msg.className='msg err';msg.textContent='As senhas não coincidem.';msg.style.display='block';return}
  const token=new URLSearchParams(window.location.search).get('token');
  if(!token){msg.className='msg err';msg.textContent='Token inválido.';msg.style.display='block';return}
  try{
    const r=await fetch('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:pw1})});
    const d=await r.json();
    if(r.ok){
      document.getElementById('form').style.display='none';
      msg.className='msg ok';msg.innerHTML='Senha redefinida com sucesso!<br><br><a href="/" style="color:#2D4A3E;font-weight:600">Fazer login →</a>';msg.style.display='block';
    } else {
      msg.className='msg err';msg.textContent=d.error||'Erro ao redefinir senha.';msg.style.display='block';
    }
  }catch(e){msg.className='msg err';msg.textContent='Erro de conexão.';msg.style.display='block'}
}
</script></body></html>`);
});

// Admin password reset page
app.get('/admin-reset-password', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Estou Bem Admin — Redefinir Senha</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#1A1A2E;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:8px;padding:40px;max-width:400px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
h1{font-family:'Playfair Display',serif;color:#2D4A3E;font-size:24px;margin-bottom:8px}
p{color:#5C5549;font-size:14px;margin-bottom:24px;line-height:1.5}
.badge{display:inline-block;background:#2D4A3E;color:#fff;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;margin-bottom:16px}
label{display:block;text-align:left;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#9A9189;margin-bottom:6px}
input{width:100%;padding:12px;border:none;border-bottom:2px solid #E5DDD3;font-size:16px;background:transparent;outline:none;margin-bottom:16px;transition:border-color .2s}
input:focus{border-color:#C9A96E}
button{width:100%;padding:14px;background:#2D4A3E;color:#F5F0EB;border:none;border-radius:4px;font-size:13px;letter-spacing:2px;text-transform:uppercase;cursor:pointer}
button:hover{background:#1E352B}
.msg{margin-top:16px;padding:12px;border-radius:4px;font-size:13px}
.msg.ok{background:#E8F0EC;color:#2D4A3E}.msg.err{background:#F5E8E8;color:#8B3A3A}
</style></head><body>
<div class="card">
  <div class="badge">Painel Administrativo</div>
  <h1>Redefinir Senha</h1>
  <p>Digite sua nova senha de administrador.</p>
  <div id="form">
    <label>NOVA SENHA</label>
    <input type="password" id="pw1" placeholder="Mínimo 8 caracteres">
    <label>CONFIRMAR SENHA</label>
    <input type="password" id="pw2" placeholder="Repita a senha">
    <button onclick="doReset()">REDEFINIR SENHA</button>
  </div>
  <div id="msg" class="msg" style="display:none"></div>
</div>
<script>
async function doReset(){
  const pw1=document.getElementById('pw1').value,pw2=document.getElementById('pw2').value,msg=document.getElementById('msg');
  if(pw1.length<8){msg.className='msg err';msg.textContent='A senha deve ter no mínimo 8 caracteres.';msg.style.display='block';return}
  if(pw1!==pw2){msg.className='msg err';msg.textContent='As senhas não coincidem.';msg.style.display='block';return}
  const token=new URLSearchParams(window.location.search).get('token');
  if(!token){msg.className='msg err';msg.textContent='Token inválido.';msg.style.display='block';return}
  try{
    const r=await fetch('/api/admin/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:pw1})});
    const d=await r.json();
    if(r.ok){document.getElementById('form').style.display='none';msg.className='msg ok';msg.innerHTML='Senha redefinida!<br><br><a href="/admin" style="color:#2D4A3E;font-weight:600">Ir para o painel →</a>';msg.style.display='block'}
    else{msg.className='msg err';msg.textContent=d.error||'Erro ao redefinir.';msg.style.display='block'}
  }catch(e){msg.className='msg err';msg.textContent='Erro de conexão.';msg.style.display='block'}
}
</script></body></html>`);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Global Express Error Handler ──────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────
async function start() {
  if (process.env.DATABASE_URL) {
    await initDB();
    console.log('PostgreSQL connected');

    // Seed initial super admin if no admin users exist
    await seedAdminUser();

    // Start PG LISTEN/NOTIFY for real-time event-driven escalation
    startPgListener().catch(err => console.error('[PG Listener] Startup error:', err.message));

    // Backup safety net: poll every 5 min in case PG notifications are missed
    setInterval(checkMissedCheckins, 5 * 60 * 1000);
    // Run immediately on startup to catch any missed during downtime
    setTimeout(checkMissedCheckins, 5000);
    console.log('Check-in escalation monitor started (PG NOTIFY primary + 5-min backup)');
  } else {
    console.log('No DATABASE_URL — running without database (localStorage only)');
  }
  // ── Twilio WhatsApp Webhook (incoming messages) ──────────
  // Support both URL paths
  const whatsappWebhook = async (req, res) => {
    try {
      const { Body, From, To, MessageSid } = req.body;
      const phone = From ? From.replace('whatsapp:', '') : '';
      const msg = (Body || '').trim().toUpperCase();
      console.log(`[WhatsApp IN] From: ${phone} | Body: "${Body}" | SID: ${MessageSid}`);

      // Find user by phone
      const userResult = await pool.query('SELECT id, name, role FROM users WHERE phone = $1', [phone]);
      const user = userResult.rows[0];

      let replyBody = '';

      if (msg === 'SIM' || msg === 'ESTOU BEM' || msg === 'YES' || msg === 'OK' || msg === 'BEM') {
        // ── CHECK-IN CONFIRMED ──
        if (user) {
          const now = new Date();
          const timeStr = now.toTimeString().slice(0,5);
          const dateStr = now.toISOString().slice(0,10);
          // Cancel any pending escalation first
          await pool.query(
            `UPDATE checkins SET status = 'confirmed', confirmed_at = NOW() WHERE user_id = $1 AND status = 'pending'`,
            [user.id]
          );
          // Insert confirmed check-in
          await pool.query(
            `INSERT INTO checkins (user_id, status, time, date, confirmed_at) VALUES ($1, 'confirmed', $2, $3, NOW())`,
            [user.id, timeStr, dateStr]
          );
          console.log(`[WhatsApp] Check-in confirmed for ${user.name} (${phone})`);
          replyBody = `✅ Check-in confirmado! Obrigado, ${user.name}. Ate o proximo check-in. 💚`;

          // Notify family via WebSocket
          if (wss) {
            wss.clients.forEach(c => {
              if (c.readyState === 1) c.send(JSON.stringify({ type: 'checkin_confirmed', userId: user.id, name: user.name, timestamp: new Date().toISOString() }));
            });
          }
        } else {
          replyBody = '✅ Recebemos sua confirmacao. Obrigado!';
        }

      } else if (msg === 'SOS' || msg === 'SOCORRO' || msg === 'AJUDA' || msg === 'HELP' || msg === 'EMERGENCIA') {
        // ── SOS TRIGGERED ──
        if (user) {
          console.log(`[WhatsApp] 🆘 SOS triggered by ${user.name} (${phone})`);
          // Trigger full Level 3 escalation
          const family = await pool.query('SELECT * FROM family_contacts WHERE elder_id = $1', [user.id]);
          const contacts = await pool.query('SELECT * FROM emergency_contacts WHERE user_id = $1', [user.id]);
          const allPhones = [
            ...family.rows.filter(f => f.phone).map(f => f.phone),
            ...contacts.rows.filter(c => c.phone).map(c => c.phone),
          ];
          // SMS all contacts
          for (const p of allPhones) {
            await sendWhatsApp(p, `🆘 EMERGENCIA: ${user.name} enviou SOS via WhatsApp. Verifique IMEDIATAMENTE. Ligue 192 se necessario.`);
          }
          replyBody = `🆘 SOS acionado! Seus contatos de emergencia estao sendo notificados agora. Aguarde.`;
        } else {
          replyBody = '🆘 SOS recebido. Ligue 192 (SAMU) para emergencias.';
        }

      } else if (msg === 'NAO' || msg === 'NÃO' || msg === 'NO' || msg === 'MAL' || msg === 'RUIM') {
        // ── NOT OK ──
        if (user) {
          console.log(`[WhatsApp] ⚠️ Elder ${user.name} reported NOT OK`);
          const family = await pool.query('SELECT * FROM family_contacts WHERE elder_id = $1', [user.id]);
          for (const fm of family.rows) {
            if (fm.phone) await sendWhatsApp(fm.phone, `⚠️ ATENCAO: ${user.name} respondeu que NAO esta bem. Por favor entre em contato imediatamente.`);
          }
          replyBody = `Obrigado por avisar, ${user.name}. Sua familia esta sendo notificada agora. Alguem entrara em contato em breve. 💛`;
        } else {
          replyBody = 'Recebemos sua mensagem. Se precisa de ajuda urgente, ligue 192 (SAMU).';
        }

      } else {
        // ── UNKNOWN MESSAGE ──
        replyBody = 'Estou Bem: Responda *SIM* para confirmar seu check-in, ou *SOS* se precisar de ajuda urgente.';
      }

      // Reply via TwiML
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${replyBody}</Message></Response>`;
      res.type('text/xml').send(twiml);

    } catch (err) {
      console.error('[WhatsApp Webhook Error]', err);
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Estou Bem: Ocorreu um erro. Ligue 192 para emergencias.</Message></Response>`;
      res.type('text/xml').send(twiml);
    }
  };
  app.post('/api/whatsapp/webhook', whatsappWebhook);
  app.post('/api/twilio/whatsapp', whatsappWebhook);

  // Helper: send WhatsApp via Twilio
  async function sendWhatsApp(to, body) {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log(`[WhatsApp] No Twilio creds. Would send to ${to}: ${body}`);
      return;
    }
    try {
      const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const waNumber = TWILIO_WHATSAPP_NUMBER;
      await twilioClient.messages.create({
        from: `whatsapp:${waNumber}`,
        to: `whatsapp:${to.replace('whatsapp:', '')}`,
        body
      });
      console.log(`[WhatsApp] Sent to ${to}: ${body.substring(0, 50)}...`);
    } catch (err) {
      console.error(`[WhatsApp] Failed to send to ${to}:`, err.message);
    }
  }

  // ── WhatsApp Test Endpoint ──
  app.post('/api/whatsapp/test', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    try {
      const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const waNumber = TWILIO_WHATSAPP_NUMBER;
      // Send with interactive buttons
      const msg = await twilioClient.messages.create({
        from: `whatsapp:${waNumber}`,
        to: `whatsapp:${phone}`,
        contentSid: 'HXd0e2ef84c49ec4fc79cc48ba7d3e0759',
        contentVariables: JSON.stringify({ '1': 'Tim' }),
      });
      res.json({ success: true, sid: msg.sid });
    } catch (err) {
      console.error('[WhatsApp Test]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  server.listen(PORT, () => console.log(`Estou Bem server running on port ${PORT}`));
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
      // Skip if user is napping
      const nap = napUsers.get(elder.id);
      if (nap && nap.until > now) {
        continue;
      } else if (nap) {
        napUsers.delete(elder.id); // expired
      }

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
          if (overdueMin >= 30) {
            targetLevel = 3;
            pushTitle = 'EMERGENCIA!';
            pushBody = `EMERGENCIA: ${elder.name} nao responde ha 30 minutos! SAMU sendo acionado.`;
          } else if (overdueMin >= 15) {
            targetLevel = 2;
            pushTitle = 'Check-in urgente perdido!';
            pushBody = `${elder.name} nao respondeu ao check-in ha 15 minutos. Verifique agora!`;
          } else if (overdueMin >= 5) {
            targetLevel = 1;
            pushTitle = 'Check-in perdido!';
            pushBody = `${elder.name} nao respondeu ao check-in. Verifique se esta tudo bem.`;
          } else {
            continue; // Not yet overdue (within 5 min grace)
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

          // Send real-time WebSocket alert to family
          const wsSent = await sendWsAlertToFamily(elder.id, {
            type: 'escalation',
            level: targetLevel,
            elder: { id: elder.id, name: elder.name },
            message: pushTitle,
            body: pushBody,
            checkinId: checkin.id,
            timestamp: new Date().toISOString(),
          });
          if (wsSent > 0) console.log(`[WS] Sent ${wsSent} real-time alerts for ${elder.name}`);

          // Send email notifications to family members
          await sendEscalationEmails(family.rows, elder, pushTitle, targetLevel);

          // ── Twilio SMS & Voice escalation (scheduled mode) ──
          if (targetLevel >= 1 && elder.phone) {
            // Level 1+: SMS reminder to elder
            await sendAlert(elder.phone, `Estou Bem: Voce tem um check-in pendente. Responda SIM se esta tudo bem.`);
          }
          if (targetLevel >= 2) {
            // Level 2: Voice call to elder — if no answer, IMMEDIATELY escalate to SAMU
            let elderAnswered = false;
            if (elder.phone) {
              elderAnswered = await makeVoiceCall(elder.phone, `Ola ${elder.name}. Voce tem um check-in pendente no Estou Bem. Sua familia esta preocupada. Pressione 1 se esta bem.`);
            }
            // SMS to family contacts
            for (const fm of family.rows) {
              if (fm.phone) await sendAlert(fm.phone, `ALERTA: ${elder.name} nao respondeu ao check-in ha 15 minutos. Por favor verifique.`);
            }
            for (const ct of contacts.rows) {
              if (ct.phone) await sendAlert(ct.phone, `ALERTA: ${elder.name} nao respondeu ao check-in ha 15 minutos. Por favor verifique.`);
            }
            // If call failed or not answered → IMMEDIATE SAMU escalation
            if (!elderAnswered && targetLevel < 3) {
              console.log(`[ESCALATION] ${elder.name} did NOT answer voice call — escalating to SAMU NOW`);
              targetLevel = 3;
            }
          }
          if (targetLevel >= 3) {
            // Level 3 EMERGENCY: Call SAMU 192 + conference ALL contacts — NO MORE WAITING
            const allPhones = [
              ...family.rows.filter(f => f.phone).map(f => f.phone),
              ...contacts.rows.filter(c => c.phone).map(c => c.phone),
            ];
            const medEmergSMS = await getMedicalInfoForSMS(elder.id);
            for (const phone of allPhones) {
              await sendAlert(phone, `🆘 EMERGENCIA: ${elder.name} nao responde e nao atendeu ligacao. SAMU 192 sendo acionado AGORA. Voce sera conectado.${medEmergSMS}`);
            }
            await callSAMUWithConference(elder, allPhones);
            console.log(`[SAMU] Emergency conference call initiated for ${elder.name} with ${allPhones.length} contacts`);
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
            const overdueMin = overdueMs / (60 * 1000);
            let targetLevel;
            let pushTitle;
            let pushBody;
            if (overdueMin >= (intervalHours * 60) + 30 || !lastTime) {
              targetLevel = 3;
              pushTitle = 'EMERGENCIA!';
              pushBody = `EMERGENCIA: ${elder.name} nao responde ha 30 minutos alem do intervalo! SAMU sendo acionado.`;
            } else if (overdueMin >= (intervalHours * 60) + 15) {
              targetLevel = 2;
              pushTitle = 'Check-in urgente perdido!';
              pushBody = `${elder.name} nao respondeu ao check-in ha 15 minutos. Verifique agora!`;
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

            // Send real-time WebSocket alert to family
            const wsSentInterval = await sendWsAlertToFamily(elder.id, {
              type: 'escalation',
              level: targetLevel,
              elder: { id: elder.id, name: elder.name },
              message: pushTitle,
              body: pushBody,
              checkinId: checkinId,
              timestamp: new Date().toISOString(),
            });
            if (wsSentInterval > 0) console.log(`[WS] Sent ${wsSentInterval} real-time alerts for ${elder.name} (interval)`);

            // Send email notifications to family members
            await sendEscalationEmails(family.rows, elder, pushTitle, targetLevel);

            // ── Twilio SMS & Voice escalation (interval mode) ──
            if (targetLevel >= 1 && elder.phone) {
              // Level 1+: SMS reminder to elder
              await sendAlert(elder.phone, `Estou Bem: Voce tem um check-in pendente. Responda SIM se esta tudo bem.`);
            }
            if (targetLevel >= 2) {
              // Level 2: Voice call — if no answer, IMMEDIATELY call SAMU
              let elderAnswered = false;
              if (elder.phone) {
                elderAnswered = await makeVoiceCall(elder.phone, `Ola ${elder.name}. Voce tem um check-in pendente no Estou Bem. Sua familia esta preocupada. Pressione 1 se esta bem.`);
              }
              for (const fm of family.rows) {
                if (fm.phone) await sendAlert(fm.phone, `ALERTA: ${elder.name} nao respondeu ao check-in ha 15 minutos. Por favor verifique.`);
              }
              for (const ct of contacts.rows) {
                if (ct.phone) await sendAlert(ct.phone, `ALERTA: ${elder.name} nao respondeu ao check-in ha 15 minutos. Por favor verifique.`);
              }
              if (!elderAnswered && targetLevel < 3) {
                console.log(`[ESCALATION] ${elder.name} did NOT answer voice call — escalating to SAMU NOW`);
                targetLevel = 3;
              }
            }
            if (targetLevel >= 3) {
              const allPhones = [
                ...family.rows.filter(f => f.phone).map(f => f.phone),
                ...contacts.rows.filter(c => c.phone).map(c => c.phone),
              ];
              const medIntSMS = await getMedicalInfoForSMS(elder.id);
              for (const phone of allPhones) {
                await sendAlert(phone, `🆘 EMERGENCIA: ${elder.name} nao responde e nao atendeu ligacao. SAMU 192 sendo acionado AGORA. Voce sera conectado.${medIntSMS}`);
              }
              await callSAMUWithConference(elder, allPhones);
              console.log(`[SAMU] Emergency conference call initiated for ${elder.name} with ${allPhones.length} contacts`);
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
    // ── Inactivity Alert System ──────────────────────────────
    // Check for elders with no movement detected in 3+ hours during daytime
    const nowHour = now.getHours();
    const isDaytime = nowHour >= 7 && nowHour < 22;

    if (isDaytime) {
      const inactiveElders = await pool.query(`
        SELECT al.user_id, al.last_movement_at, u.name, u.phone
        FROM activity_logs al
        JOIN users u ON u.id = al.user_id
        WHERE u.role = 'elder'
          AND al.last_movement_at < NOW() - INTERVAL '3 hours'
          AND al.updated_at > NOW() - INTERVAL '24 hours'
      `);

      for (const inactive of inactiveElders.rows) {
        const inactiveHours = Math.round((now - new Date(inactive.last_movement_at)) / (1000 * 60 * 60) * 10) / 10;
        console.log(`[Inactivity] ${inactive.name} inactive for ${inactiveHours}h`);

        // Check if we already sent an inactivity alert recently (within last hour)
        const recentAlert = await pool.query(
          `SELECT id FROM escalation_alerts
           WHERE elder_id = $1 AND status = 'active'
             AND created_at > NOW() - INTERVAL '1 hour'
             AND notified_contacts::text LIKE '%inactivity%'`,
          [inactive.user_id]
        );
        if (recentAlert.rows.length > 0) continue; // Already alerted recently

        // Step 1: Push notification to elder
        const elderTokens = await pool.query(
          `SELECT token FROM push_tokens WHERE user_id = $1`,
          [inactive.user_id]
        );
        if (elderTokens.rows.length > 0) {
          await sendPushNotifications(
            elderTokens.rows.map(r => r.token),
            'Voce esta bem?',
            'Nao detectamos movimento ha 3 horas. Toque para confirmar que esta tudo bem.',
            { type: 'inactivity_check', screen: 'Home' },
            false
          );
          console.log(`[Inactivity] Sent push to ${inactive.name}`);
        }

        // Step 2: SMS to elder
        if (inactive.phone) {
          await sendAlert(inactive.phone, `Estou Bem: Voce esta bem? Nao detectamos movimento ha 3 horas. Responda SIM se esta tudo bem.`);
          console.log(`[Inactivity] Sent SMS to ${inactive.name}`);
        }

        // Step 3: Alert family contacts
        const inactFamily = await pool.query(
          `SELECT id, name, phone, email FROM users WHERE linked_elder_id = $1`,
          [inactive.user_id]
        );
        const inactContacts = await pool.query(
          `SELECT name, phone FROM contacts WHERE user_id = $1 ORDER BY priority`,
          [inactive.user_id]
        );

        // Push to family
        const inactFamilyTokens = await pool.query(
          `SELECT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE u.linked_elder_id = $1`,
          [inactive.user_id]
        );
        if (inactFamilyTokens.rows.length > 0) {
          await sendPushNotifications(
            inactFamilyTokens.rows.map(r => r.token),
            'Alerta de inatividade',
            `${inactive.name} nao apresenta movimento ha ${inactiveHours} horas. Verifique se esta tudo bem.`,
            { type: 'inactivity_alert', elderId: inactive.user_id },
            true
          );
        }

        // WebSocket alert to family
        await sendWsAlertToFamily(inactive.user_id, {
          type: 'inactivity_alert',
          elder: { id: inactive.user_id, name: inactive.name },
          inactiveHours,
          lastMovement: inactive.last_movement_at,
          message: `${inactive.name} sem movimento ha ${inactiveHours}h`,
          timestamp: new Date().toISOString(),
        });

        // SMS to family
        for (const fm of inactFamily.rows) {
          if (fm.phone) await sendAlert(fm.phone, `ALERTA: ${inactive.name} nao apresenta movimento ha ${inactiveHours} horas. Verifique se esta tudo bem.`);
        }
        for (const ct of inactContacts.rows) {
          if (ct.phone) await sendAlert(ct.phone, `ALERTA: ${inactive.name} nao apresenta movimento ha ${inactiveHours} horas. Verifique se esta tudo bem.`);
        }

        // Email to family
        await sendEscalationEmails(inactFamily.rows, inactive, `Alerta de Inatividade - ${inactive.name}`, 1);

        // Log the inactivity alert
        await pool.query(
          `INSERT INTO escalation_alerts (elder_id, level, status, notified_contacts)
           VALUES ($1, 1, 'active', $2)`,
          [inactive.user_id, JSON.stringify({ type: 'inactivity', inactiveHours, contacts: inactFamily.rows.map(f => f.name) })]
        );
      }
    }

    // ── Medication Low Stock Alerts ───────────────────────────
    try {
      const lowStockMeds = await pool.query(`
        SELECT m.id, m.name, m.stock, m.low_threshold, m.user_id, u.name as elder_name
        FROM medications m
        JOIN users u ON m.user_id = u.id
        WHERE m.stock <= m.low_threshold AND m.stock > 0
      `);

      const todayDate = new Date().toISOString().slice(0, 10);

      for (const med of lowStockMeds.rows) {
        // Check if already alerted today for this medication
        const alreadyAlerted = await pool.query(
          `SELECT id FROM medication_alerts WHERE medication_id = $1 AND alert_date = $2 AND alert_type = 'low_stock'`,
          [med.id, todayDate]
        );
        if (alreadyAlerted.rows.length > 0) continue;

        // Record the alert
        await pool.query(
          `INSERT INTO medication_alerts (medication_id, user_id, alert_date, alert_type) VALUES ($1, $2, $3, 'low_stock') ON CONFLICT DO NOTHING`,
          [med.id, med.user_id, todayDate]
        );

        // Push notification to elder
        const elderTokens = await pool.query(
          `SELECT token FROM push_tokens WHERE user_id = $1`, [med.user_id]
        );
        if (elderTokens.rows.length > 0) {
          await sendPushNotifications(
            elderTokens.rows.map(r => r.token),
            'Medicamento acabando',
            `Seu medicamento ${med.name} esta acabando. Restam ${med.stock} unidades.`,
            { type: 'low_stock', medicationId: med.id },
            false
          );
        }

        // Push notification to family
        const familyTokens = await pool.query(
          `SELECT pt.token FROM push_tokens pt JOIN users u ON pt.user_id = u.id WHERE u.linked_elder_id = $1`,
          [med.user_id]
        );
        if (familyTokens.rows.length > 0) {
          await sendPushNotifications(
            familyTokens.rows.map(r => r.token),
            'Medicamento acabando',
            `${med.elder_name} esta com estoque baixo de ${med.name}. Restam ${med.stock} unidades.`,
            { type: 'low_stock', elderId: med.user_id, medicationId: med.id },
            false
          );
        }

        // WebSocket alert to family
        await sendWsAlertToFamily(med.user_id, {
          type: 'medication_low_stock',
          elder: { id: med.user_id, name: med.elder_name },
          medication: { id: med.id, name: med.name, stock: med.stock },
          message: `${med.elder_name} esta com estoque baixo de ${med.name}`,
          timestamp: new Date().toISOString(),
        });

        console.log(`[Medication] Low stock alert: ${med.elder_name} - ${med.name} (${med.stock} remaining)`);
      }
    } catch (medErr) {
      console.error('[Medication] Error checking low stock:', medErr.message);
    }

    // ── Auto Check-in Mode ──────────────────────────────────
    try {
      const autoCheckinElders = await pool.query(`
        SELECT u.id, u.name, s.auto_checkin_mode
        FROM users u
        JOIN settings s ON s.user_id = u.id
        WHERE u.role = 'elder' AND s.auto_checkin_mode = 'auto'
      `);

      for (const elder of autoCheckinElders.rows) {
        const pendingCheckins = await pool.query(
          `SELECT id, time FROM checkins WHERE user_id = $1 AND date = $2 AND status = 'pending'`,
          [elder.id, today]
        );

        for (const checkin of pendingCheckins.rows) {
          // Auto-confirm after the checkin is at least 5 minutes old
          const [h, m] = checkin.time.split(':').map(Number);
          const scheduledMin = h * 60 + m;
          if (nowMinutes - scheduledMin >= 5) {
            await pool.query(
              `UPDATE checkins SET status = 'auto_confirmed', confirmed_at = NOW() WHERE id = $1`,
              [checkin.id]
            );
            console.log(`[Auto Check-in] Auto-confirmed check-in ${checkin.id} for ${elder.name} (passive monitoring mode)`);

            // Notify family via WebSocket
            await sendWsAlertToFamily(elder.id, {
              type: 'checkin_auto_confirmed',
              userId: elder.id,
              checkinId: checkin.id,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } catch (autoErr) {
      console.error('[Auto Check-in] Error:', autoErr.message);
    }

    // Reset hourly movement counts
    await pool.query(`
      UPDATE activity_logs
      SET movement_count_1h = GREATEST(0, movement_count_1h - 1)
      WHERE updated_at < NOW() - INTERVAL '1 hour'
    `);

  } catch (err) {
    console.error('[Escalation] Error checking missed check-ins:', err);
  }
}

start().catch(err => {
  console.error('Failed to start:', err);
  // Start without DB if connection fails
  server.listen(PORT, () => console.log(`Estou Bem server running on port ${PORT} (no DB)`));
});
