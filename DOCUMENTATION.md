# Estou Bem -- Technical Documentation

Version 1.1.0 | Last updated: 2026-03-24

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Database Schema](#3-database-schema)
4. [API Endpoints](#4-api-endpoints)
5. [Escalation Chain](#5-escalation-chain-critical)
6. [WhatsApp Integration](#6-whatsapp-integration)
7. [Check-in System](#7-check-in-system)
8. [Mobile Apps (React Native)](#8-mobile-apps-react-native)
9. [Apple Watch App (watchOS)](#9-apple-watch-app-watchos)
10. [Galaxy Watch App (Wear OS)](#10-galaxy-watch-app-wear-os)
11. [Web App](#11-web-app)
12. [Admin Dashboard](#12-admin-dashboard)
13. [Affiliate System](#13-affiliate-system)
14. [Subscription & Payments](#14-subscription--payments)
15. [Landing Page](#15-landing-page)
16. [Notification System](#16-notification-system)
17. [Health Monitoring](#17-health-monitoring)
18. [Medical Profile](#18-medical-profile)
19. [Internationalization (i18n)](#19-internationalization-i18n)
20. [Build & Deployment](#20-build--deployment)
21. [Environment Variables](#21-environment-variables)
22. [Security](#22-security)
23. [What's Missing / TODO](#23-whats-missing--todo)

---

## 1. EXECUTIVE SUMMARY

**Estou Bem** ("I'm fine" in Portuguese) is an elderly care platform designed for the Brazilian market. It enables elderly individuals to perform scheduled "check-ins" confirming they are well, while their family members receive real-time monitoring and automatic escalation alerts if a check-in is missed.

### What it does

- Elderly users confirm they are well via app, web, Apple Watch, Galaxy Watch, SMS, or WhatsApp
- Family members monitor elder status in real time via web or mobile app
- If a check-in is missed, a multi-level escalation chain triggers: push notification, SMS, WhatsApp, voice call, and ultimately an automated call to SAMU (Brazil's 192 emergency service) with a conference bridge including family contacts
- Smartwatch integration provides fall detection, SpO2 monitoring, heart rate tracking, movement detection, and sleep analysis
- Medical profiles are stored and automatically shared with SAMU during emergencies

### Target market

- **Primary**: Brazil (Portuguese-speaking elderly and their families)
- **Secondary**: International expansion via i18n (English, Spanish, German)
- **Regulatory**: LGPD consent tracking built in

### Revenue model

1. **Subscriptions** (via RevenueCat):
   - Familia: R$49.90/month -- multi-elder support, unlimited contacts
   - Central de Cuidados: R$89.90/month -- health reports, calendar sync, marketplace access
2. **Affiliate program**: Commission-based referrals from influencers, B2B partners, ad networks
3. **Marketplace** (planned): Commission on service bookings (pharmacy, telemedicine, caregivers)
4. **B2B/Institutional**: Contracts with health insurers, ILPIs (nursing homes), hospitals

---

## 2. ARCHITECTURE OVERVIEW

### System Architecture

```
+-------------------+     +-------------------+     +-------------------+
|   Apple Watch     |     |  Galaxy Watch     |     |   WhatsApp        |
|   (watchOS/Swift) |     |  (Wear OS/Kotlin) |     |   (Twilio API)    |
+--------+----------+     +--------+----------+     +--------+----------+
         |                          |                         |
    WatchConnectivity          Wearable Data             Webhook POST
         |                      Layer API                     |
         v                          v                         v
+--------+----------+     +--------+----------+     +--------+----------+
|   iPhone App      |     |  Android App      |     |   Backend Server  |
|   (React Native   |<--->|  (React Native    |<--->|   (Node.js/       |
|    Expo SDK 55)   |     |   Expo SDK 55)    |     |    Express)       |
+--------+----------+     +--------+----------+     +--------+----------+
         |                          |                    |    |    |
         +----------+---------------+                    |    |    |
                    |                                    |    |    |
            Expo Push API                                |    |    |
                    |                                    |    |    |
                    v                                    v    v    v
           +--------+----------+               +---------+  +----+---+
           | Expo Push Service  |               |PostgreSQL|  |External|
           +-------------------+               |(Railway) |  |Services|
                                               +----------+  +--------+
                                                                  |
                                               +------------------+--------+
                                               |          |        |       |
                                            Twilio    Resend   RevenueCat  AppsFlyer
                                          (SMS/Voice/ (Email)  (Subs)     (Attribution)
                                           WhatsApp)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile App | React Native 0.83 + Expo SDK 55 |
| Apple Watch | Native SwiftUI (via @bacons/apple-targets) |
| Galaxy Watch | Native Kotlin Wear OS (via custom withWearOS plugin) |
| Backend | Node.js + Express.js |
| Database | PostgreSQL (hosted on Railway) |
| Real-time | WebSocket (ws library) + PG LISTEN/NOTIFY |
| Hosting | Railway (web server) |
| Push Notifications | Expo Push API |
| SMS / Voice / WhatsApp | Twilio |
| Email | Resend API |
| Subscriptions | RevenueCat |
| Attribution | AppsFlyer |
| Build | EAS Build (Expo Application Services) |

### External Services

| Service | Purpose |
|---------|---------|
| Twilio | SMS, voice calls, WhatsApp Business API |
| Resend | Transactional email (escalation alerts) |
| RevenueCat | In-app subscription management |
| AppsFlyer | Mobile attribution and deep linking |
| Expo Push | Push notification delivery (iOS + Android) |
| Railway | Backend hosting and PostgreSQL database |
| Apple HealthKit | Heart rate, SpO2, sleep, steps (via Apple Watch) |
| Android Health Services | Heart rate, SpO2 (via Wear OS) |
| Google Play Services Wearable | Watch-to-phone Data Layer API |

---

## 3. DATABASE SCHEMA

### Tables

All tables are created in `web/server.js` within the `initDB()` function.

#### users
```
id                SERIAL PRIMARY KEY
email             TEXT UNIQUE NOT NULL
password_hash     TEXT NOT NULL
name              TEXT NOT NULL
phone             TEXT
role              TEXT NOT NULL CHECK ('elder','family','caregiver')
link_code         TEXT UNIQUE              -- 6-digit code for family linking
linked_elder_id   INTEGER REFERENCES users(id)
subscription      TEXT DEFAULT 'free'      -- 'free','familia','central'
trial_start       TIMESTAMPTZ
referral_code     TEXT UNIQUE              -- e.g. 'EB1A3F'
referred_by       INTEGER REFERENCES users(id)
affiliate_id      INTEGER REFERENCES affiliates(id)
utm_source        TEXT
utm_medium        TEXT
utm_campaign      TEXT
streak_days       INTEGER DEFAULT 0
total_points      INTEGER DEFAULT 0
badges            JSONB DEFAULT '[]'
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### checkins
```
id                SERIAL PRIMARY KEY
user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
time              TEXT NOT NULL             -- e.g. '09:00'
status            TEXT NOT NULL DEFAULT 'pending'  -- pending/confirmed/missed/auto_confirmed
date              TEXT NOT NULL             -- 'YYYY-MM-DD'
confirmed_at      TIMESTAMPTZ
escalation_level  INTEGER DEFAULT 0
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### contacts (emergency contacts for elders)
```
id                SERIAL PRIMARY KEY
user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
name              TEXT NOT NULL
phone             TEXT NOT NULL
relationship      TEXT
priority          INTEGER DEFAULT 1
```

#### emergency_contacts
```
id                SERIAL PRIMARY KEY
user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
name              TEXT NOT NULL
phone             TEXT
email             TEXT
relationship      TEXT
priority          INTEGER DEFAULT 1
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### family_contacts
```
id                SERIAL PRIMARY KEY
elder_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
name              TEXT NOT NULL
phone             TEXT
email             TEXT
relationship      TEXT
user_id           INTEGER REFERENCES users(id)
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### medications
```
id                SERIAL PRIMARY KEY
user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
name              TEXT NOT NULL
dosage            TEXT
frequency         TEXT
time              TEXT
stock             INTEGER DEFAULT 30
unit              TEXT DEFAULT 'comprimidos'
low_threshold     INTEGER DEFAULT 5
```

#### health_entries (manual health logs)
```
id                SERIAL PRIMARY KEY
user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
type              TEXT NOT NULL
value             REAL
unit              TEXT
time              TEXT
date              TEXT
notes             TEXT
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### settings
```
user_id                 INTEGER PRIMARY KEY REFERENCES users(id)
checkin_times           TEXT[] DEFAULT ARRAY['09:00']
checkin_mode            TEXT DEFAULT 'scheduled'  -- 'scheduled' or 'interval'
checkin_interval_hours  INTEGER DEFAULT 2
checkin_window_start    TEXT DEFAULT '07:00'
checkin_window_end      TEXT DEFAULT '22:00'
auto_checkin_mode       TEXT DEFAULT 'manual'
```

#### health_readings (from smartwatch)
```
id                SERIAL PRIMARY KEY
user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE
reading_type      VARCHAR(20) NOT NULL     -- 'heart_rate','spo2','sleep','movement'
value             DECIMAL NOT NULL
recorded_at       TIMESTAMPTZ DEFAULT NOW()
```

#### activity_logs (inactivity detection)
```
id                   SERIAL PRIMARY KEY
user_id              INTEGER REFERENCES users(id) ON DELETE CASCADE (UNIQUE)
last_movement_at     TIMESTAMPTZ DEFAULT NOW()
movement_count_1h    INTEGER DEFAULT 0
updated_at           TIMESTAMPTZ DEFAULT NOW()
```

#### fall_events
```
id                SERIAL PRIMARY KEY
user_id           INTEGER REFERENCES users(id)
detected_at       TIMESTAMPTZ DEFAULT NOW()
confirmed_fall    BOOLEAN DEFAULT true
cancelled_by_user BOOLEAN DEFAULT false
location_lat      DECIMAL
location_lng      DECIMAL
heart_rate        INTEGER
escalation_level  INTEGER DEFAULT 0
resolved_at       TIMESTAMPTZ
```

#### escalation_alerts
```
id                SERIAL PRIMARY KEY
elder_id          INTEGER REFERENCES users(id) ON DELETE CASCADE
checkin_id        INTEGER REFERENCES checkins(id) ON DELETE CASCADE
level             INTEGER DEFAULT 1         -- 1, 2, or 3
status            TEXT DEFAULT 'active' CHECK ('active','resolved','dismissed')
notified_contacts JSONB DEFAULT '[]'
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### medical_profiles
```
id                   SERIAL PRIMARY KEY
user_id              INTEGER REFERENCES users(id) UNIQUE
full_name            VARCHAR(200)
date_of_birth        DATE
blood_type           VARCHAR(10)
allergies            TEXT
chronic_conditions   TEXT
current_medications  TEXT
emergency_notes      TEXT
cpf                  VARCHAR(14)           -- Brazilian ID number
health_plan          VARCHAR(100)
health_plan_number   VARCHAR(50)
primary_doctor       VARCHAR(200)
doctor_phone         VARCHAR(20)
address              TEXT
updated_at           TIMESTAMPTZ DEFAULT NOW()
```

#### affiliates
```
id                SERIAL PRIMARY KEY
code              TEXT UNIQUE NOT NULL
channel           TEXT NOT NULL CHECK ('influencer','paid_media','ad_network','organic','referral','b2b_partner')
name              TEXT NOT NULL
email             TEXT
phone             TEXT
password_hash     TEXT
company           TEXT
website           TEXT
social_media      TEXT
pix_key           TEXT
commission_rate   JSONB DEFAULT '{}'
total_earned      REAL DEFAULT 0
total_conversions INTEGER DEFAULT 0
is_active         BOOLEAN DEFAULT true
applied_at        TIMESTAMPTZ DEFAULT NOW()
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### commissions
```
id                SERIAL PRIMARY KEY
affiliate_id      INTEGER REFERENCES affiliates(id) ON DELETE CASCADE
conversion_id     INTEGER REFERENCES conversions(id) ON DELETE CASCADE
amount            REAL NOT NULL
currency          TEXT DEFAULT 'BRL'
status            TEXT DEFAULT 'pending' CHECK ('pending','approved','paid','rejected')
paid_at           TIMESTAMPTZ
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### conversions
```
id                SERIAL PRIMARY KEY
user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL
event             TEXT NOT NULL
revenue           REAL DEFAULT 0
currency          TEXT DEFAULT 'BRL'
affiliate_code    TEXT
affiliate_channel TEXT
partner_id        TEXT
campaign_id       TEXT
referrer_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL
metadata          JSONB DEFAULT '{}'
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### payout_requests
```
id                SERIAL PRIMARY KEY
affiliate_id      INTEGER REFERENCES affiliates(id) ON DELETE CASCADE
amount            REAL NOT NULL
pix_key           TEXT NOT NULL
status            TEXT DEFAULT 'pending' CHECK ('pending','processing','completed','rejected')
admin_notes       TEXT
requested_at      TIMESTAMPTZ DEFAULT NOW()
processed_at      TIMESTAMPTZ
```

#### push_tokens
```
id                SERIAL PRIMARY KEY
user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE
token             TEXT NOT NULL
platform          TEXT DEFAULT 'unknown'
created_at        TIMESTAMPTZ DEFAULT NOW()
UNIQUE(user_id, token)
```

#### email_alerts
```
id                SERIAL PRIMARY KEY
recipient_email   TEXT NOT NULL
subject           TEXT NOT NULL
related_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL
alert_type        TEXT DEFAULT 'escalation'
sent_at           TIMESTAMPTZ DEFAULT NOW()
```

#### service_providers (marketplace)
```
id                SERIAL PRIMARY KEY
type              TEXT NOT NULL CHECK ('pharmacy','telemedicine','caregiver','physiotherapist','nutritionist','transport','meals')
name              TEXT NOT NULL
description       TEXT
api_endpoint      TEXT
commission_rate   REAL DEFAULT 0.15
is_active         BOOLEAN DEFAULT true
metadata          JSONB DEFAULT '{}'
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### service_bookings (marketplace)
```
id                SERIAL PRIMARY KEY
user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL
provider_id       INTEGER REFERENCES service_providers(id) ON DELETE SET NULL
type              TEXT NOT NULL
status            TEXT DEFAULT 'pending' CHECK ('pending','confirmed','completed','cancelled')
amount            REAL DEFAULT 0
commission        REAL DEFAULT 0
scheduled_at      TIMESTAMPTZ
notes             TEXT
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### institutions (B2B)
```
id                SERIAL PRIMARY KEY
name              TEXT NOT NULL
type              TEXT CHECK ('health_insurer','ilpi','hospital','clinic')
contact_name      TEXT
contact_email     TEXT
contact_phone     TEXT
contract_value    REAL
max_users         INTEGER
is_active         BOOLEAN DEFAULT true
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### consent_records (LGPD)
```
id                SERIAL PRIMARY KEY
user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE
consent_type      TEXT NOT NULL CHECK ('terms','privacy','data_sharing','marketing','health_data')
granted           BOOLEAN NOT NULL
ip_address        TEXT
user_agent        TEXT
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### calendar_events (premium)
```
id                SERIAL PRIMARY KEY
user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE
title             TEXT NOT NULL
type              TEXT DEFAULT 'medication' CHECK ('medication','checkin','appointment','custom')
start_time        TIMESTAMPTZ NOT NULL
end_time          TIMESTAMPTZ
recurring         TEXT                    -- 'daily','weekly','monthly',null
notes             TEXT
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### health_reports (Central plan)
```
id                SERIAL PRIMARY KEY
user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE
month             TEXT NOT NULL            -- 'YYYY-MM'
summary           JSONB DEFAULT '{}'
generated_at      TIMESTAMPTZ DEFAULT NOW()
```

#### app_settings
```
key               TEXT PRIMARY KEY
value             JSONB NOT NULL
updated_at        TIMESTAMPTZ DEFAULT NOW()
```

### ER Diagram (ASCII)

```
                         +------------------+
                         |    app_settings   |
                         +------------------+

  +-------------+        +------------------+        +------------------+
  | affiliates  |<----+  |     users        |------->| medical_profiles |
  +------+------+     |  +--------+---------+        +------------------+
         |            |           |
         |            +-----------+-- affiliate_id
         |                        |
  +------+------+    +------------+----------+----------+---------+
  | commissions |    |            |          |          |         |
  +------+------+    v            v          v          v         v
         |     +----------+ +---------+ +--------+ +--------+ +-------+
         |     | checkins | |settings | |contacts| |  meds  | |health |
         |     +----+-----+ +---------+ +--------+ +--------+ |entries|
         |          |                                          +-------+
  +------+------+   |
  | conversions |   +----------> +-------------------+
  +-------------+   |            | escalation_alerts |
                    |            +-------------------+
  +-----------+     |
  | push_     |-----+
  | tokens    |     |
  +-----------+     v
                +-------------------+    +------------------+
                | health_readings   |    | activity_logs    |
                +-------------------+    +------------------+

  +-------------------+    +-------------------+    +-------------------+
  | fall_events       |    | email_alerts      |    | consent_records   |
  +-------------------+    +-------------------+    +-------------------+

  +-------------------+    +-------------------+    +-------------------+
  | service_providers |    | service_bookings  |    | institutions      |
  +-------------------+    +-------------------+    +-------------------+

  +-------------------+    +-------------------+    +-------------------+
  | calendar_events   |    | health_reports    |    | payout_requests   |
  +-------------------+    +-------------------+    +-------------------+

  +-------------------+    +-------------------+
  | family_contacts   |    | emergency_contacts|
  +-------------------+    +-------------------+
```

### Database Trigger

A PG trigger on the `checkins` table fires on INSERT or UPDATE, calling `pg_notify('checkin_events', ...)` with a JSON payload containing `action`, `checkin_id`, `user_id`, `status`, `time`, and `date`. The server listens on a dedicated PG connection for these events.

---

## 4. API ENDPOINTS

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/register` | No | Register new user. Body: `{email, password, name, phone, role, referral_code?, utm_*}` |
| POST | `/api/login` | No | Login. Body: `{email, password}`. Returns token + user |

### User

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/me` | Bearer | Get current user profile |
| POST | `/api/link-elder` | Bearer | Link family member to elder. Body: `{code}` |
| GET | `/api/referral-code` | Bearer | Get or generate referral code |
| POST | `/api/referral/apply` | Bearer | Apply referral code. Body: `{code}` |

### Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings` | Bearer | Get check-in settings |
| PUT | `/api/settings` | Bearer | Update settings. Body: `{checkin_times, checkin_mode, ...}` |

### Check-ins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/checkins` | Bearer | Get check-ins. Query: `?date=YYYY-MM-DD&limit=N` |
| GET | `/api/checkins/elder` | Bearer | Get linked elder's check-ins (family view) |
| GET | `/api/checkin-status/:userId` | No | Get 3-state status: pending/completed/waiting |
| POST | `/api/checkins` | Bearer | Create check-in. Body: `{time, status, date}` |
| PUT | `/api/checkins/:id` | Bearer | Update check-in status |

### Escalation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/escalation/trigger` | Bearer | Trigger manual escalation. Body: `{user_id, level, action}` |
| | | | Actions: `test_sms`, `resolved`, `sms_elder`, `sms_family`, `call_elder`, `samu` |

### Health & Activity

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | Bearer | Get health entries |
| GET | `/api/health/elder` | Bearer | Get linked elder's health entries |
| POST | `/api/health` | Bearer | Create health entry. Body: `{type, value, unit, time, date, notes}` |
| POST | `/api/activity-update` | No | Receive watch data. Body: `{user_id, movement_detected, heart_rate, spo2, sleep_hours}` |
| GET | `/api/activity-log/:userId` | Bearer | Get activity log |
| GET | `/api/health-readings/:userId` | Bearer | Get health readings. Query: `?type=spo2&limit=50` |
| GET | `/api/health-report/:month` | Bearer | Generate/get monthly health report (Central plan) |
| GET | `/api/health-report/elder/:month` | Bearer | Get elder's health report (family view) |

### Fall Detection

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/fall-detected` | No | Report fall. Body: `{user_id, timestamp, location, heart_rate}` |
| POST | `/api/fall-cancelled` | No | Cancel fall alert. Body: `{user_id}` |

### Medical Profile

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/medical-profile/:userId` | Bearer | Get medical profile |
| PUT | `/api/medical-profile/:userId` | Bearer | Update medical profile (upsert) |
| GET | `/api/medical-profile/:userId/emergency-card` | Bearer | Get emergency card data |

### Contacts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/contacts` | Bearer | List emergency contacts |
| POST | `/api/contacts` | Bearer | Add contact (plan-limited) |
| DELETE | `/api/contacts/:id` | Bearer | Remove contact |

### Medications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/medications` | Bearer | List medications |
| POST | `/api/medications` | Bearer | Add medication |
| PUT | `/api/medications/:id` | Bearer | Update medication stock |
| DELETE | `/api/medications/:id` | Bearer | Remove medication |

### Subscription

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | `/api/subscription` | Bearer | Update plan. Body: `{plan}` -- free/familia/central |

### Push Tokens

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/push-token` | Bearer | Register push token (web app) |
| POST | `/api/push-token/register` | No | Register push token (mobile app). Body: `{token, platform, email?, user_id?}` |
| DELETE | `/api/push-token` | Bearer | Remove push token |

### Twilio Webhooks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/twilio/gather` | No | Voice call gather callback (DTMF digits) |
| POST | `/api/twilio/sms` | No | Incoming SMS webhook |
| POST | `/api/twilio/whatsapp` | No | Incoming WhatsApp webhook |
| POST | `/api/twilio/status` | No | Call status callback |
| POST | `/api/twilio/test-whatsapp` | No | Test WhatsApp send |
| POST | `/api/whatsapp/webhook` | No | Alternative WhatsApp webhook path |
| POST | `/api/whatsapp/test` | No | Test WhatsApp with interactive buttons |

### Conversions & Affiliates

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/conversions/track` | No | Track conversion (public). Body: `{event, revenue, affiliate_code, ...}` |
| POST | `/api/conversions` | Bearer | Track conversion (authenticated) |
| GET | `/api/conversions` | Bearer | Get user conversions |
| GET | `/api/affiliates` | No | List active affiliates |
| POST | `/api/affiliates` | No | Create affiliate (admin) |
| POST | `/api/affiliates/register` | No | Self-register as affiliate |
| POST | `/api/affiliates/login` | No | Affiliate login |
| GET | `/api/affiliates/me/dashboard` | af_Bearer | Affiliate dashboard data |
| PUT | `/api/affiliates/me` | af_Bearer | Update affiliate profile |
| POST | `/api/affiliates/me/payout` | af_Bearer | Request PIX payout (min R$100) |
| GET | `/api/affiliates/me/payouts` | af_Bearer | Get payout history |
| GET | `/api/affiliates/:code/dashboard` | No | Public dashboard (legacy) |

### Gamification

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/gamification` | Bearer | Get streak, points, badges |
| POST | `/api/gamification/checkin-reward` | Bearer | Award check-in points |

### Calendar (Premium)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/calendar` | Bearer | Get calendar events. Query: `?month=YYYY-MM` |
| POST | `/api/calendar` | Bearer | Create calendar event |
| DELETE | `/api/calendar/:id` | Bearer | Delete calendar event |
| POST | `/api/calendar/sync` | Bearer | Auto-generate events from meds + check-in schedule |

### Marketplace

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/marketplace/providers` | No | List service providers. Query: `?type=pharmacy` |
| POST | `/api/marketplace/bookings` | Bearer | Create booking |
| GET | `/api/marketplace/bookings` | Bearer | List user bookings |

### B2B / Institutions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/institutions` | No | List active institutions |
| POST | `/api/institutions` | No | Create institution |

### LGPD Consent

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/consent` | Bearer | Record consent. Body: `{consent_type, granted}` |
| GET | `/api/consent` | Bearer | Get latest consent status per type |

### Postback (Ad Networks)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/postback/install` | No | Attribution install postback |
| GET | `/api/postback/event` | No | Attribution event postback |

### Elder Dashboard (Family)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/elder-dashboard` | Bearer | Aggregated elder data for family view |

### Admin API (all require X-Admin-Key header)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/stats` | Overview stats (users, check-ins, revenue, affiliates) |
| GET | `/api/admin/users` | List all users. Query: `?search=&role=` |
| GET | `/api/admin/users/:id` | Full user detail with consent, conversions, referrals |
| GET | `/api/admin/affiliates` | List all affiliates |
| PUT | `/api/admin/affiliates/:id` | Update affiliate (activate, commission rates, etc.) |
| POST | `/api/admin/affiliates/bulk` | Bulk actions: activate/deactivate/set_commission/apply_defaults |
| GET | `/api/admin/commissions` | List all commissions. Query: `?status=pending` |
| PUT | `/api/admin/commissions/:id` | Update commission status |
| GET | `/api/admin/settings` | Get app_settings |
| PUT | `/api/admin/settings` | Update app_settings |
| GET | `/api/admin/providers` | List service providers |
| POST | `/api/admin/providers` | Create provider |
| PUT | `/api/admin/providers/:id` | Update provider |
| DELETE | `/api/admin/providers/:id` | Delete provider |
| GET | `/api/admin/bookings` | List all bookings |
| GET | `/api/admin/institutions` | List institutions |
| PUT | `/api/admin/institutions/:id` | Update institution |
| DELETE | `/api/admin/institutions/:id` | Delete institution |
| GET | `/api/admin/conversions` | List all conversions |
| GET | `/api/admin/consent` | List all consent records |
| GET | `/api/admin/gamification/leaderboard` | Top 100 users by points |
| GET | `/api/admin/escalations` | List recent escalation alerts |
| PUT | `/api/admin/escalations/:id/resolve` | Resolve escalation |
| GET | `/api/admin/payouts` | List payout requests |
| PUT | `/api/admin/payouts/:id` | Update payout status (triggers commission marking on completion) |

### Static Routes

| Path | Serves |
|------|--------|
| `/admin` | admin.html |
| `/affiliate` or `/parceiro` | affiliate.html |
| `/invite` | index.html |
| `/landing` | landing.html |
| `*` | index.html (SPA fallback) |

### WebSocket

- **Path**: `/ws?userId=X&role=Y`
- **Messages**: `{type: 'ping'}` -> `{type: 'pong'}`
- **Server-sent alerts**: escalation, checkin_confirmed, fall_detected, spo2_critical, spo2_low, fall_samu_escalation, fall_cancelled

---

## 5. ESCALATION CHAIN (CRITICAL)

The escalation system is the core safety feature. It uses a dual mechanism: PG LISTEN/NOTIFY for event-driven triggers plus a 5-minute polling backup.

### Escalation Flow

```
  Elder misses scheduled check-in time
              |
              v
  +---[5 min overdue]---+
  |                      |
  v                      |
LEVEL 1:                 |
  - Push notification    |
    to family            |
  - WebSocket alert      |
  - Email to family      |
  - SMS/WhatsApp to      |
    elder: "Responda     |
    SIM se esta bem"     |
  - Push to elder:       |
    "Check-in pendente"  |
              |
              v
  +---[15 min overdue]--+
  |                      |
  v                      |
LEVEL 2:                 |
  - Push notification    |
    (CRITICAL)           |
  - Voice call to elder  |
    (Twilio, pt-BR)      |
    "Pressione 1 se      |
     esta bem"           |
  - SMS/WhatsApp to      |
    ALL family contacts  |
  - Email to family      |
  - If call NOT          |
    answered -> JUMP     |
    to LEVEL 3           |
              |
              v
  +---[30 min overdue / call unanswered]---+
  |                                         |
  v                                         |
LEVEL 3 (EMERGENCY):                        |
  - SAMU 192 conference call               |
    with ALL family contacts               |
  - AI voice provides medical              |
    profile info to SAMU                   |
  - Emergency SMS to ALL                   |
    contacts with medical info             |
  - Push "EMERGENCIA: SAMU                 |
    acionado"                              |
  - WebSocket alert level 3               |
  +----------------------------------------+
```

### Trigger Mechanisms

1. **PG LISTEN/NOTIFY (primary)**: When a check-in row is INSERT or UPDATE, a trigger fires `pg_notify('checkin_events', ...)`. The server schedules a 30-minute escalation check timer for each new pending check-in. If confirmed before the timer fires, the timer is cancelled.

2. **Interval Polling (backup)**: Every 5 minutes, `checkMissedCheckins()` scans all elders for overdue check-ins, supporting both `scheduled` and `interval` modes.

### Check-in Modes

- **Scheduled**: Check-ins at fixed times (e.g., 09:00, 14:00, 20:00). Escalation starts when a scheduled time + grace period passes without confirmation.
- **Interval**: Check-ins every N hours. Escalation starts when the gap since the last confirmed check-in exceeds the interval + 30 min grace.

### Escalation Resolution

Check-ins can be confirmed via:
- Tapping "Estou Bem" button in the app/web/watch
- Replying "SIM" to SMS
- Replying "SIM" or "ESTOU BEM" to WhatsApp
- Pressing "1" during a Twilio voice call
- Family member triggering `resolved` action via the escalation API

When confirmed, all active escalation_alerts for that elder are set to `resolved`, pending escalation timers are cancelled, and family receives confirmation via WebSocket + WhatsApp template.

### Fall Detection Escalation

```
  Watch detects fall
         |
         v
  30-second countdown on watch
  (user can press "Estou Bem" to cancel)
         |
    +----+----+
    |         |
  Cancel    Timeout
    |         |
    v         v
  Send       POST /api/fall-detected
  cancel     |
  to         +---> Level 2 IMMEDIATELY:
  server           - Push to family (CRITICAL)
                   - WebSocket alert
                   - Email to family
                   - SMS/WhatsApp to family + contacts
                   - Voice call to elder
                        |
                   +----+
                   |60 sec timer|
                   +----+
                        |
                   If not resolved:
                   Level 3: SAMU conference call
```

### SpO2 Alert Escalation

```
  Watch reads SpO2
         |
    +----+----+
    |         |
  >= 90%    < 90%
    |         |
  (normal)    v
           LEVEL 1 ALERT:
           - Push to family
           - WebSocket alert
           - SMS to family
           - Email to family
                |
           +----+
           |< 85%|
           +----+
                |
                v
           LEVEL 2 CRITICAL:
           - Push to family (CRITICAL)
           - Voice call to elder
           - SMS to elder + family + contacts
           - Email to family
           - Log escalation_alert
```

### Inactivity Detection

The server tracks `activity_logs.last_movement_at`. The watch sends movement updates every 60 seconds. When last movement exceeds 3 hours during waking window, the system can trigger an alert (handled client-side in the web app family dashboard).

---

## 6. WHATSAPP INTEGRATION

### Architecture

Twilio WhatsApp Business API is used via the `whatsapp:+12627472376` sender number.

### Template Messages (Content SIDs)

| Template | SID | Purpose |
|----------|-----|---------|
| checkin_buttons | HX12975dc4706173c775b50ee98d697ee5 | Check-in with "Estou Bem" / "Preciso de Ajuda" buttons |
| checkin_confirmed | HX36ede86655d6ae9f0051ca42de84ee5f | Confirmation sent to family |
| emergency_alert | HXfedb892e7284dbd087edd67b62509ff5 | Emergency alert to family |
| checkin_reminder | HXe92b1815ad963c134b65415c817e9324 | Check-in reminder text |

Templates are required for messages outside the 24-hour session window. If template delivery fails, the system falls back to a free-form message.

### Webhook Flow

```
  Elder's WhatsApp
       |
  Message sent to +12627472376
       |
       v
  Twilio forwards POST to:
  /api/twilio/whatsapp
  (or /api/whatsapp/webhook)
       |
       v
  Parse Body text (uppercase)
       |
  +----+----+----+----+
  |         |         |
"SIM"     "SOS"    "NAO"    Other
"ESTOU    "AJUDA"  "RUIM"
 BEM"     "HELP"
  |         |         |       |
  v         v         v       v
Confirm   Full L3   Notify  Reply:
check-in  escalation family  "Responda
+ notify  + SAMU     "NAO    SIM ou SOS"
family    call       esta
                     bem"
```

### Phone Number Matching

The system matches incoming WhatsApp/SMS numbers by taking the last 9 digits and using a LIKE query, which handles Brazilian numbers with or without country code prefix.

---

## 7. CHECK-IN SYSTEM

### Scheduling

- Default: one check-in at 09:00 daily
- Configurable via settings: multiple times per day (e.g., `['09:00', '14:00', '20:00']`)
- Two modes:
  - **Scheduled**: fixed daily times
  - **Interval**: every N hours within a time window (e.g., every 2 hours between 07:00-22:00)

### 3 Button States

The `/api/checkin-status/:userId` endpoint returns one of three states:

1. **PENDING**: A check-in exists for a scheduled time that has passed but not been confirmed. Shows the deadline (scheduled time + 60 min).
2. **COMPLETED**: The most recent check-in has been confirmed. Shows the next scheduled time.
3. **WAITING**: No check-in is due yet. Shows the next scheduled time.

### Confirmation Channels

| Channel | Mechanism |
|---------|-----------|
| Mobile App | Tap "Estou Bem" button -> PUT /api/checkins/:id |
| Web App | Tap button -> PUT /api/checkins/:id |
| Apple Watch | Tap circle -> WatchConnectivity -> iPhone -> server |
| Galaxy Watch | Tap circle (UI only -- server integration incomplete) |
| SMS | Reply "SIM" -> Twilio webhook -> server |
| WhatsApp | Reply "SIM"/"ESTOU BEM" -> Twilio webhook -> server |
| Voice Call | Press "1" during Twilio call -> gather callback -> server |

### Gamification

- **Points**: 10 points per check-in + 5 bonus if streak >= 7 + 10 bonus if streak >= 30
- **Streaks**: Consecutive days with at least one confirmed check-in. Resets to 1 if yesterday had no confirmed check-in.
- **Badges**: `streak_7` (7 days), `streak_30` (30 days), `streak_100` (100 days)

---

## 8. MOBILE APPS (React Native)

### Tech Stack

- React Native 0.83.2 with Expo SDK 55
- React Navigation (native-stack + bottom-tabs)
- AsyncStorage for local persistence
- expo-notifications, expo-sensors, expo-location, expo-background-fetch
- react-native-purchases (RevenueCat)
- react-native-appsflyer (attribution)

### Screens

| File | Screen | Description |
|------|--------|-------------|
| ElderHomeScreen.tsx | Elder Home | Main check-in button, streak display, health vitals, SOS button |
| FamilyDashboardScreen.tsx | Family Dashboard | Elder status cards, health stats, last check-in, alerts |
| OnboardingScreen.tsx | Onboarding | Multi-step: role selection, registration, elder linking, settings |
| SettingsScreen.tsx | Settings | Check-in times, mode, contacts, language, subscription, medical profile |
| PaywallScreen.tsx | Paywall | RevenueCat offerings, plan comparison, purchase flow |
| SOSScreen.tsx | SOS | Hold-to-activate emergency button, contacts list |
| MedicationsScreen.tsx | Medications | Add/edit medications, stock tracking, low-stock alerts |
| HealthLogScreen.tsx | Health Log | Manual health entry (blood pressure, glucose, weight, etc.) |
| EmergencyContactsScreen.tsx | Emergency Contacts | Manage emergency contacts with priority ordering |
| CheckInHistoryScreen.tsx | Check-in History | Calendar view of past check-ins |
| CustomerCenterScreen.tsx | Customer Center | RevenueCat customer center (manage subscription) |

### Services

| File | Purpose |
|------|---------|
| NotificationService.ts | Push notification registration, channels (checkin, emergency, critical-alerts, medication), interactive categories |
| RevenueCatService.ts | Subscription management: initialize, purchase, restore, status check |
| AffiliateService.ts | Deep link processing, attribution storage, conversion tracking |
| AnalyticsService.ts | AppsFlyer integration, event tracking, revenue attribution |
| HealthIntegrationService.ts | HealthKit/Health Connect data reading and server sync |
| CheckInService.ts | Check-in scheduling, confirmation, streak management |
| FallDetectionService.ts | Accelerometer-based fall detection (RN layer) |
| AutoCheckinService.ts | Background fetch for auto check-in |
| LocationService.ts | Location tracking for emergency sharing |

### i18n

Uses a React Context provider with JSON translation files. See section 19.

### Deep Linking

- URL scheme: `estoubem://`
- Handles: affiliate referral codes (`?ref=CODE`), check-in reminders, onboarding flows

---

## 9. APPLE WATCH APP (watchOS)

### Overview

A native SwiftUI watchOS app embedded via `@bacons/apple-targets`. Target config at `targets/watch/expo-target.config.js`.

**Bundle ID**: `com.twerner.estoubem.watchkitapp`
**Deployment Target**: watchOS 10.0
**Frameworks**: SwiftUI, WatchConnectivity, CoreMotion, HealthKit

### Files

#### EstouBemApp.swift
- Entry point (`@main`). Creates the SwiftUI App with `WindowGroup`.
- Initializes four `@StateObject` managers: `WatchConnectivityManager`, `MotionDetectionManager`, `HealthManager`, `FallDetectionManager`.
- Passes all managers as `@EnvironmentObject` to `ContentView`.

#### ContentView.swift
- **Main check-in view**: Large circular "ESTOU BEM" button with pulse animation. States: ready (green), pending (gold), confirmed (checkmark).
- **Status row**: Next check-in time + streak count.
- **Health card**: Heart rate (BPM) with "ALTO" indicator >100; SpO2 percentage with color coding (>95 green NORMAL, 90-95 gold BAIXO, <90 red CRITICO).
- **Sleep card**: Hours with quality labels (BOM >=7, POUCO >=5, ALERTA <5).
- **Movement card**: Real-time moving/resting indicator.
- **Fall detection status card**: Shows if fall detection is active.
- **Fall alert overlay**: Full-screen danger overlay with 30-second countdown circle. Cancel button "ESTOU BEM" dismisses it.
- **SOSView**: Emergency screen with 3-second long-press SOS button.
- **Color theme**: Soho House-inspired palette (houseGreen #2D4A3E, houseCream #F5F0EB, houseGold #C9A96E, houseDark #1A1A1A).

#### HealthManager.swift
- Manages HealthKit on Apple Watch.
- **Heart rate**: `HKAnchoredObjectQuery` for real-time updates. Sends to iPhone via `WatchConnectivityManager.sendHeartRate()`.
- **SpO2**: `HKAnchoredObjectQuery` for real-time blood oxygen. Converts from fraction (0-1) to percentage. Triggers `sendLowSpO2Alert()` if below 90%.
- **Sleep**: Queries last 24 hours of `HKCategoryValueSleepAnalysis`. Sums asleepCore, asleepDeep, asleepREM, and legacy asleep intervals.
- **Steps**: `HKStatisticsQuery` with cumulative sum for today.

#### FallDetectionManager.swift
- **Primary**: `CMFallDetectionManager` (watchOS 9+). Implements `CMFallDetectionDelegate`. When a fall is detected by the system, triggers the countdown.
- **Fallback**: Accelerometer-based detection at 20Hz. Detects high-g impact (>3.0g) followed by 3 seconds of stillness (<0.2g deviation from gravity). 10-second monitoring timeout after impact.
- **Countdown**: 30-second timer with haptic feedback every 5 seconds. If user presses "ESTOU BEM", sends `fall_cancelled` to iPhone. If countdown expires, sends `fall_detected` alert with timestamp and heart rate.

#### WatchConnectivityManager.swift
- Singleton managing `WCSession` for Watch <-> iPhone communication.
- **Outbound messages**: `sendCheckin()`, `sendSOS()`, `sendFallAlert()`, `sendFallCancelled()`, `sendMovementUpdate()`, `sendHeartRate()`, `sendHealthData()`, `sendLowSpO2Alert()`.
- **Delivery strategy**: Uses `sendMessage()` for instant delivery when iPhone is reachable; falls back to `transferUserInfo()` for guaranteed queued delivery. SOS and fall alerts use both channels simultaneously.
- **Inbound messages**: Handles `checkin_reminder`, `settings_update`, `escalation_started`, `escalation_resolved` from iPhone.
- **State**: Publishes `elderName`, `nextCheckinTime`, `hasPendingCheckin`, `streak`, `isPhoneReachable`.

#### MotionDetectionManager.swift
- Monitors accelerometer at 2Hz (battery-friendly).
- Movement threshold: 0.15g deviation from gravity (tuned for elderly gentle movements).
- Stillness timeout: 30 seconds of no movement before marking "not moving".
- Reports movement status to iPhone every 60 seconds via `updateApplicationContext`.

### Data Flow

```
Apple Watch                    iPhone App                    Server
  |                              |                            |
  | Heart rate/SpO2/Movement     |                            |
  | ---(WatchConnectivity)-----> |                            |
  |                              | POST /api/activity-update  |
  |                              | -------------------------> |
  |                              |                            |
  | Fall detected                |                            |
  | ---(sendFallAlert)---------> |                            |
  |                              | POST /api/fall-detected    |
  |                              | -------------------------> |
  |                              |                            |
  | Check-in tap                 |                            |
  | ---(sendCheckin)-----------> |                            |
  |                              | PUT /api/checkins/:id      |
  |                              | -------------------------> |
```

---

## 10. GALAXY WATCH APP (Wear OS)

### Overview

A native Kotlin Wear OS app embedded into the phone APK via the `withWearOS` Expo config plugin.

**Package**: `com.estoubem.watch` (same application ID as phone: `com.twerner.estoubem`)
**Min SDK**: 30 (Wear OS 3+)
**Target SDK**: 34

### Files

#### EstouBemWatchApp.kt (MainActivity)
- Single Activity that builds its UI programmatically (no XML layouts).
- Displays:
  - "Estou Bem" title text
  - Large circular check-in button (green #2D4A3E, gold text #C9A96E)
  - Status text ("Toque para confirmar" / "Check-in confirmado!")
- On tap: vibrates, changes button color to darker green, shows confirmation text.
- **Current limitation**: UI-only implementation. Does not yet communicate with the phone app via Wearable Data Layer API.

#### build.gradle.kts
- Dependencies: `androidx.wear:1.3.0`, `androidx.health:health-services-client:1.1.0-alpha02`, `play-services-wearable:18.1.0`, Kotlin coroutines.
- Health Services and Wearable Data Layer are included but not yet used in the app code.

#### AndroidManifest.xml
- Declares `android.hardware.type.watch` feature.
- Permissions: BODY_SENSORS, ACTIVITY_RECOGNITION, INTERNET, VIBRATE, WAKE_LOCK.
- Marked as standalone watch app (`com.google.android.wearable.standalone = true`).

### withWearOS Plugin (plugins/withWearOS.js)

This Expo config plugin embeds the Wear OS app into the Android build during prebuild:

1. Copies `android-watch/` directory into the Android project
2. Adds `include ':android-watch'` to `settings.gradle`
3. Adds `wearApp project(':android-watch')` to `app/build.gradle` dependencies

When the phone APK is uploaded to Google Play, the embedded Wear OS APK auto-installs on paired watches.

### withAsyncStorageRepo Plugin (plugins/withAsyncStorageRepo.js)

Adds a local Maven repository path for `@react-native-async-storage/async-storage` v3 KMP artifact to the Android project.

---

## 11. WEB APP

The web app is served from `web/index.html` and provides full functionality for both elders and family members.

### Login/Registration Flow

1. Landing shows login form with email/password
2. "Criar conta" switches to registration with fields: name, email, phone, password, role (elder/family/caregiver)
3. Supports referral code input during registration
4. After login, role determines which view is shown

### Elder View

- **Check-in button**: Large circular button with 3 states (pending/gold, completed/green, waiting/muted)
- **Streak display**: Current streak days + total points
- **Health data panel**: Latest heart rate, SpO2, sleep hours (from watch readings)
- **Medical profile**: Inline editable form with auto-save
- **SOS button**: Hold for 3 seconds to trigger Level 3 escalation
- **Settings**: Check-in times editor, interval mode toggle, emergency contacts management

### Family View

- **Elder status cards**: Real-time status via WebSocket (pending/confirmed/missed)
- **Health stats**: Heart rate, SpO2, sleep hours, last movement time
- **Alert timeline**: Recent escalation events
- **Escalation controls**: Manual trigger buttons for SMS/call/SAMU
- **Check-in history**: Table of recent check-ins with status

### Real-time Updates

WebSocket connection on `/ws?userId=X&role=Y` provides:
- Check-in confirmations
- Escalation alerts (level 1/2/3)
- Fall detection alerts
- SpO2 alerts
- Fall cancellations

### Settings (Elder)

- Check-in times: Add/remove scheduled times
- Check-in mode: Scheduled vs. interval
- Interval settings: Hours between check-ins, active window start/end
- Emergency contacts: Add name + phone with priority
- Medical profile: Blood type, allergies, conditions, medications, CPF, health plan, doctor, address
- Language selector (PT-BR, EN, ES, DE)

### Gamification

- Streak counter with badges display
- Points total
- Badge icons: streak_7, streak_30, streak_100

---

## 12. ADMIN DASHBOARD

Located at `web/admin.html`, accessible via `/admin`.

### Authentication

Uses the `X-Admin-Key` header. The admin password is read from `process.env.ADMIN_PASSWORD` with fallback to `'estoubem-admin-2024'`.

### Features

1. **Stats Overview**: Users by role, today's check-ins, subscriptions breakdown, total revenue, active affiliates, pending commissions, active service providers.

2. **User Management**: Search/filter users by name/email/role. View details including consent records, conversions, referrals. Shows gamification data (streak, points, badges).

3. **Affiliate Management**:
   - List all affiliates with status (active/pending)
   - Approve pending affiliates (toggle `is_active`)
   - Edit individual: name, email, phone, channel, commission rates, PIX key
   - Bulk actions: activate/deactivate/set commission rates/apply defaults
   - View commission history per affiliate

4. **Commission Management**: List commissions filtered by status. Update status (pending -> approved -> paid or rejected).

5. **PIX Payout System**:
   - View payout requests with affiliate details and PIX keys
   - Approve/reject payouts with admin notes
   - When a payout is marked "completed", all pending/approved commissions for that affiliate are marked "paid"

6. **Gamification Leaderboard**: Top 100 users by points with streak and badge data.

7. **Escalation Monitoring**: View recent escalation alerts with elder name/phone, level, and status. Resolve active escalations.

8. **Service Providers**: CRUD for marketplace providers (pharmacy, telemedicine, caregiver, etc.).

9. **Institutions**: CRUD for B2B institutional accounts.

10. **Conversions**: View all conversion events with user details.

11. **Consent Records**: LGPD audit trail of all consent grants/revocations.

---

## 13. AFFILIATE SYSTEM

### Registration Flow

```
  Affiliate visits /affiliate
         |
         v
  "Quero ser parceiro" -> Registration form
  (name, email, password, phone, channel, company, website, social_media)
         |
         v
  POST /api/affiliates/register
  - Generates unique code: channel_prefix + 4 random chars (e.g., INF3A2B)
  - Sets is_active = false (pending approval)
  - Assigns default commission rates from app_settings
         |
         v
  Admin approves via /admin -> sets is_active = true
         |
         v
  Affiliate logs in -> sees dashboard with referral link + stats
```

### Commission Structure

Default rates (stored in `app_settings.default_commission_rates`):

| Event | Amount (R$) |
|-------|-------------|
| trial_started | R$5.00 |
| subscription_familia | R$15.00 |
| subscription_central | R$25.00 |
| recurring_monthly | 10% of revenue |

Rates vary by channel (see `AffiliateService.ts`):

| Channel | Trial | Familia | Central | Recurring |
|---------|-------|---------|---------|-----------|
| influencer | R$5 | R$15 | R$25 | 10% |
| paid_media | R$3 | R$10 | R$18 | 5% |
| ad_network | R$4 (+ R$2 registration) | R$12 | R$20 | 8% |
| referral | R$0 | R$10 | R$15 | 5% |
| b2b_partner | R$0 | R$20 | R$35 | 15% |

### Referral Link

Format: `https://estoubem.com/invite?ref=AFFCODE`

The mobile app's `AffiliateService` processes the deep link, stores the affiliate info in AsyncStorage, and includes the code in conversion tracking calls.

### Conversion Tracking

When a user performs a tracked event (registration, trial start, subscription), the system:
1. Creates a `conversions` row
2. Looks up the affiliate by code
3. Calculates commission from the affiliate's `commission_rate` JSONB
4. Creates a `commissions` row
5. Updates `affiliates.total_earned` and `total_conversions`

### PIX Payout Flow

1. Affiliate sets PIX key in profile
2. Affiliate requests payout (minimum R$100)
3. System checks: sufficient balance, PIX key exists, no pending payout
4. Creates `payout_requests` row with status `pending`
5. Admin reviews in `/admin` -> approves/rejects
6. On completion: all pending/approved commissions are marked `paid`

---

## 14. SUBSCRIPTION & PAYMENTS

### RevenueCat Integration

**File**: `src/services/RevenueCatService.ts`

- Apple API Key: stored in `app.config.js` -> `extra.revenueCatAppleApiKey`
- Google API Key: stored in `app.config.js` -> `extra.revenueCatGoogleApiKey`
- Entitlement ID: defined in `src/constants/subscriptions.ts` (referenced as `ENTITLEMENT_ID`)

### Plans

| Plan | Price | Features |
|------|-------|----------|
| Free (30-day trial) | R$0 | 1 check-in/day, 1 emergency contact, basic health view |
| Familia | R$49.90/month | Multiple check-ins, unlimited contacts, health reports |
| Central de Cuidados | R$89.90/month | Everything in Familia + monthly health reports, calendar sync, marketplace |

### Trial Logic

During the first 30 days after registration (`trial_start`), users get `central` level access. After trial, they fall back to their `subscription` value. This is handled by `getEffectiveSub()` in the server.

### Paywall Flow

1. User hits a plan-gated feature (e.g., adding >1 contact on free plan)
2. Paywall screen shows via `PaywallScreen.tsx`
3. RevenueCat offerings are fetched
4. User selects a package and purchases
5. Server is updated via `PUT /api/subscription`

---

## 15. LANDING PAGE

Located at `web/landing.html`, served at `/landing`.

### Features

- **Interactive phone demo**: 4 swipeable screens showing the app (check-in, health monitoring, family dashboard, SOS). CSS-only animation with touch/swipe support.
- **"With or without smartwatch" comparison**: Side-by-side feature comparison showing what's available with just the phone vs. with a connected watch.
- **Pricing section**: Familia and Central plans with feature lists.
- **i18n**: 4 languages (PT-BR, EN, ES, DE) with IP-based auto-detection using `navigator.language`.
- **SEO**: Proper meta tags, Open Graph tags, structured data.
- **Affiliate link handling**: Reads `?ref=CODE` from URL and passes to registration.
- **CTA buttons**: "Baixe o App" linking to app stores and "Teste Gratis" for web registration.

---

## 16. NOTIFICATION SYSTEM

### Push Notifications (Expo Push API)

**Server-side** (`sendPushNotifications()`):
- Sends to Expo Push API (`https://exp.host/--/api/v2/push/send`)
- Supports up to 100 messages per batch
- Priority: `high` for all notifications
- Critical alerts use `channelId: 'critical-alerts'` with `_contentAvailable: true`

**Client-side** (`NotificationService.ts`):
- Android channels: `checkin`, `emergency`, `critical-alerts` (bypasses DND), `medication`
- Interactive categories: `checkin` (Estou Bem / Preciso de Ajuda), `fall_detected` (Estou Bem / Preciso de Ajuda)
- Foreground handling: always show alert + sound + badge

### WebSocket

- Server maintains `wsClients` Map of userId -> Set of WebSocket connections
- Alerts sent to specific users or broadcast to all family members of an elder
- Message types: escalation, checkin_confirmed, fall_detected, fall_cancelled, spo2_critical, spo2_low, fall_samu_escalation

### Email (Resend API)

- Used for escalation alerts to family members
- Branded HTML template with Estou Bem styling
- Logged in `email_alerts` table
- From address: `alertas@estoubem.com`

### SMS (Twilio)

- Outbound: check-in reminders, escalation alerts, SOS notifications
- Inbound webhook at `/api/twilio/sms` -- processes "SIM"/"YES"/"OK" replies

### Voice Calls (Twilio)

- TwiML with pt-BR voice (Polly.Camila)
- Interactive: "Pressione 1 se esta bem, 2 se precisa de ajuda"
- Gather callback at `/api/twilio/gather`
- Used in Level 2 escalation and SAMU conference calls

### WhatsApp (Twilio Business API)

- Template messages for outbound (works outside 24h window)
- Free-form replies within 24h session
- Webhook processes check-in confirmations, SOS, and "not OK" responses
- See section 6 for details

### Channel Usage Matrix

| Event | Push | WS | Email | SMS/WA | Voice |
|-------|------|----|-------|--------|-------|
| Check-in reminder | Elder | - | - | Elder | - |
| Level 1 escalation | Family | Family | Family | Elder | - |
| Level 2 escalation | Family (critical) | Family | Family | Family+Contacts | Elder |
| Level 3 SAMU | Family (critical) | Family | - | Family+Contacts | SAMU conference |
| Fall detected | Family (critical) | Family | Family | Family+Contacts | Elder |
| Fall SAMU escalation | Family (critical) | Family | - | - | SAMU conference |
| SpO2 < 90% | Family | Family | Family | Family | - |
| SpO2 < 85% | Family (critical) | Family | Family | Elder+Family+Contacts | Elder |
| Check-in confirmed | - | Family | - | - | - |
| Fall cancelled | Family | Family | - | - | - |

---

## 17. HEALTH MONITORING

### Heart Rate

- **Source**: Apple Watch HealthKit (`HKQuantityType.heartRate`) via `HKAnchoredObjectQuery`
- **Flow**: Watch -> WatchConnectivity -> iPhone -> POST `/api/activity-update` -> `health_readings` table
- **Alerts**: >100 BPM shown as "ALTO" on watch UI
- **Frequency**: Apple Watch samples every ~5 minutes (more during workouts)

### SpO2 (Blood Oxygen)

- **Source**: Apple Watch HealthKit (`HKQuantityType.oxygenSaturation`) via `HKAnchoredObjectQuery`
- **Storage**: `health_readings` table with `reading_type = 'spo2'`
- **Thresholds**:
  - \>95%: Normal (green)
  - 90-95%: Low/BAIXO (gold) -> Level 1 alert
  - <90%: Critical/CRITICO (red) -> Level 1 alert with push/WS/SMS/email
  - <85%: Emergency -> Level 2 alert with voice call + all channels
- **Watch UI**: Color-coded display with NORMAL/BAIXO/CRITICO labels

### Sleep Tracking

- **Source**: Apple Watch HealthKit (`HKCategoryType.sleepAnalysis`)
- **Processing**: Queries last 24 hours, sums asleepCore + asleepDeep + asleepREM + legacy asleep intervals
- **Storage**: `health_readings` with `reading_type = 'sleep'`
- **Display**: Hours with quality labels (BOM >=7h, POUCO >=5h, ALERTA <5h)

### Movement / Inactivity Detection

- **Source**: Apple Watch CoreMotion accelerometer at 2Hz
- **Threshold**: 0.15g deviation from gravity (tuned for elderly gentle movements)
- **Stillness**: 30 seconds without movement -> "not moving" status
- **Reporting**: Every 60 seconds to iPhone via `updateApplicationContext`
- **Server**: Stored in `activity_logs` table with `last_movement_at` and `movement_count_1h`
- **Alert threshold**: 3 hours of inactivity during waking hours (handled in family dashboard UI)

### Fall Detection

- **Primary (watchOS 9+)**: `CMFallDetectionManager` -- Apple's native fall detection algorithm
- **Fallback**: Accelerometer-based detection at 20Hz:
  - Phase 1: Detect high-g impact (>3.0g)
  - Phase 2: Monitor for sustained stillness (<0.2g for 3+ seconds)
  - Timeout: 10 seconds after impact if no confirmed fall
- **Countdown**: 30 seconds with haptic every 5 seconds
- **Cancellation**: User presses "ESTOU BEM" button
- **Escalation**: If not cancelled, sends alert to server -> Level 2 immediately -> Level 3 (SAMU) after 60 seconds if unresolved

### Wear OS Health (Planned)

The `build.gradle.kts` includes `androidx.health:health-services-client` but the current `EstouBemWatchApp.kt` does not implement health data collection. The dependencies are ready for future implementation.

---

## 18. MEDICAL PROFILE

### Data Stored

| Field | Type | Description |
|-------|------|-------------|
| full_name | VARCHAR(200) | Full legal name |
| date_of_birth | DATE | For age calculation |
| blood_type | VARCHAR(10) | e.g., A+, O-, AB+ |
| allergies | TEXT | Free text |
| chronic_conditions | TEXT | Free text |
| current_medications | TEXT | Free text |
| emergency_notes | TEXT | Additional notes for emergencies |
| cpf | VARCHAR(14) | Brazilian tax ID (XXX.XXX.XXX-XX) |
| health_plan | VARCHAR(100) | Insurance provider name |
| health_plan_number | VARCHAR(50) | Plan membership number |
| primary_doctor | VARCHAR(200) | Doctor's name |
| doctor_phone | VARCHAR(20) | Doctor's phone |
| address | TEXT | Full home address |

### SAMU Integration

During a Level 3 escalation or fall SAMU call, the `callSAMUWithConference()` function:

1. Fetches the elder's `medical_profiles` record
2. Calculates age from `date_of_birth`
3. Builds a TwiML voice message including: patient name, age, blood type, allergies, chronic conditions, current medications, and address
4. Reads this information to the SAMU operator via Polly.Camila (Brazilian Portuguese voice)
5. Conference-bridges all family contacts into the same call

### Emergency Card

The `/api/medical-profile/:userId/emergency-card` endpoint returns a consolidated view of medical info plus emergency contacts, formatted for display.

### Auto-Save

The web app implements debounced auto-save on the medical profile form. Each field change triggers a PUT request after a short delay.

---

## 19. INTERNATIONALIZATION (i18n)

### Supported Languages

| Code | Language | Coverage |
|------|----------|----------|
| pt-BR | Portuguese (Brazil) | Complete (primary) |
| en | English | Complete |
| es | Spanish | Complete |
| de | German | Complete |

### React Native Implementation

**File**: `src/i18n/index.ts`

- `I18nProvider` React context wrapping the app
- Language stored in AsyncStorage (`estoubem_lang`)
- `useI18n()` hook returns `{ t, lang, setLang }`
- `t()` function supports variable replacement: `t('greeting', { name: 'Maria' })`
- Falls back to pt-BR if key not found in selected language

**Translation files**: `src/i18n/locales/pt-BR.json`, `en.json`, `es.json`, `de.json`

### Web Implementation

The web apps (index.html, landing.html, admin.html, affiliate.html) use inline JavaScript translation objects. Language detection uses:
1. `navigator.language` (browser language)
2. URL parameter `?lang=en`
3. localStorage stored preference
4. Default: pt-BR

### Landing Page IP Detection

The landing page uses `navigator.language` to auto-detect the user's preferred language and sets the UI accordingly.

---

## 20. BUILD & DEPLOYMENT

### EAS Build Configuration (`eas.json`)

| Profile | iOS | Android | Distribution |
|---------|-----|---------|--------------|
| development | Simulator build | APK | Internal |
| preview | Release config | APK | Internal |
| production | Release + auto-increment | AAB (app bundle) | Store |

### Platform Details

- **Android**: APK for preview/testing, AAB for Play Store production
- **iOS**: Waiting for Apple Developer approval (placeholder values in `submit.production.ios`)
- **Wear OS**: Embedded in Android APK via `withWearOS` plugin -> auto-installs on paired watches via Play Store
- **watchOS**: Embedded in iOS app via `@bacons/apple-targets` plugin

### Web Deployment

- Backend (`web/server.js`) deployed on Railway
- Production URL: `https://estou-bem-web-production.up.railway.app`
- Static files served from the `web/` directory with no-cache headers

### Environment Variables Needed for Build

See section 21 for the complete list.

### Build Commands

```bash
# Development
eas build --profile development --platform android
eas build --profile development --platform ios

# Preview (internal testing)
eas build --profile preview --platform android

# Production
eas build --profile production --platform android
eas build --profile production --platform ios
```

---

## 21. ENVIRONMENT VARIABLES

| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | PostgreSQL connection string (Railway provides this) |
| JWT_SECRET | Yes | Secret for token generation (fallback: `estoubem-secret-key-change-in-prod`) |
| ADMIN_PASSWORD | Yes | Admin dashboard password (fallback: `estoubem-admin-2024`) |
| TWILIO_ACCOUNT_SID | Yes* | Twilio account SID for SMS/Voice/WhatsApp |
| TWILIO_AUTH_TOKEN | Yes* | Twilio auth token |
| TWILIO_PHONE_NUMBER | Yes* | Twilio phone number (for SMS/Voice) |
| TWILIO_WHATSAPP_NUMBER | No | WhatsApp sender (default: `whatsapp:+12627472376`) |
| RESEND_API_KEY | Yes* | Resend API key for email delivery |
| REVENUECAT_APPLE_API_KEY | No | RevenueCat iOS API key (fallback: test key) |
| REVENUECAT_GOOGLE_API_KEY | No | RevenueCat Android API key (fallback: `placeholder`) |
| APPSFLYER_DEV_KEY | No | AppsFlyer developer key (fallback: `placeholder`) |
| APPSFLYER_APP_ID | No | AppsFlyer app ID (fallback: `placeholder`) |
| PORT | No | Server port (default: 3000) |

\* Required for full functionality. Without Twilio/Resend, the system logs messages to console instead of sending them.

---

## 22. SECURITY

### Authentication

- **User auth**: HMAC-SHA256 token generated from userId + timestamp. Tokens stored in an in-memory `Map`.
- **Affiliate auth**: Same token system with `af_` prefix on the stored userId.
- **Admin auth**: Static `X-Admin-Key` header compared to `ADMIN_PASSWORD` env variable.

### Password Hashing

Passwords are hashed with SHA-256 via Node.js `crypto.createHash('sha256')`.

> **WARNING**: SHA-256 is NOT a proper password hashing algorithm. It should be replaced with bcrypt, scrypt, or argon2. See section 23.

### CORS

Permissive CORS on `/api` routes:
- `Access-Control-Allow-Origin: *`
- All methods and common headers allowed

### Input Validation

- Email/password required for registration and login
- Password minimum length: 6 characters
- Role validation against allowed values
- Subscription plan validation
- Consent type validation
- Some SQL injection protection via parameterized queries

### SSL

- Railway provides HTTPS by default
- PostgreSQL SSL enabled when DATABASE_URL contains "railway"

---

## 23. WHAT'S MISSING / TODO

### Critical Security Issues

1. **Password hashing uses SHA-256 instead of bcrypt/argon2**. SHA-256 is fast and not salted, making it vulnerable to rainbow table and brute force attacks. Must be replaced with bcrypt or argon2id.

2. **In-memory token store** (`const tokens = new Map()`). All tokens are lost on server restart, forcing all users to re-login. Should use JWT with proper expiration or a persistent session store (Redis).

3. **CORS is wide open** (`Access-Control-Allow-Origin: *`). Should be restricted to known domains in production.

4. **Admin password has a hardcoded fallback** (`estoubem-admin-2024`). If the environment variable is not set, anyone can access the admin dashboard.

5. **Several endpoints lack authentication**: `POST /api/fall-detected`, `POST /api/fall-cancelled`, `POST /api/activity-update` are unauthenticated. Any caller can send fake health data or fall alerts for any user_id.

6. **JWT_SECRET has a hardcoded fallback** (`estoubem-secret-key-change-in-prod`). Tokens are predictable if the env var is not set.

### Incomplete Features

7. **Wear OS app is UI-only**. The Galaxy Watch app displays a check-in button but does not communicate with the phone app via Wearable Data Layer API. Health Services integration is not implemented despite the dependencies being included.

8. **React Native source files are not in the expected locations**. The `src/screens/` and `src/services/` directories exist but may not be included in the Glob results due to path configuration. The `index.ts` main entry point should be verified.

9. **RevenueCat Google API key is `placeholder`**. Android subscriptions will not work until a real key is configured.

10. **AppsFlyer keys are `placeholder`**. Attribution tracking is non-functional.

11. **Apple Developer account not configured**. `eas.json` submit section has `YOUR_APPLE_ID@email.com`, `YOUR_ASC_APP_ID`, `YOUR_TEAM_ID` placeholders.

12. **Play Store service account key path is placeholder** (`./play-store-service-account.json`).

13. **Marketplace/service providers are schema-only**. No providers are seeded, no integration with external services exists.

14. **B2B institutional accounts are schema-only**. No contract management workflow implemented.

### Missing Error Handling

15. **No global error handler** in Express. Unhandled promise rejections in route handlers could crash the server.

16. **No request rate limiting**. All endpoints are vulnerable to brute force and DDoS.

17. **No input sanitization** beyond basic required-field checks. No XSS protection on user-submitted content.

18. **Twilio webhook verification is missing**. Incoming webhooks from Twilio are not verified with the request signature, meaning anyone could send fake webhook POSTs.

### Hardcoded Values

19. **Server URL hardcoded in TwiML**: `https://estou-bem-web-production.up.railway.app` is hardcoded in voice call TwiML and status callback URLs. Should be an environment variable.

20. **Twilio WhatsApp number hardcoded** in multiple places as `+12627472376`.

21. **From email hardcoded**: `alertas@estoubem.com` in the `sendEmail` function.

22. **SAMU number hardcoded**: `+55192` in `callSAMUWithConference`. In production this needs proper formatting per region.

### Missing Features Referenced But Not Implemented

23. **Auto check-in mode** (`auto_checkin_mode` column exists in settings but no server-side implementation for automatic confirmation).

24. **Health report PDF export** -- the health report is JSON-only, no PDF generation.

25. **Email alert for medication low stock** -- medications have `low_threshold` but no alert trigger when stock drops below it.

26. **Calendar integration with external calendars** (Google Calendar, Apple Calendar) -- only internal calendar events exist.

27. **Family contacts table vs. contacts table overlap** -- both `family_contacts` and `contacts` (and `emergency_contacts`) store similar data. The relationship between these tables is unclear and may cause notification duplication.

28. **WebSocket reconnection on client** -- no heartbeat or automatic reconnection logic documented for web clients.

29. **No database migrations system** -- all schema changes are done via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` in `initDB()`. This will become unmaintainable as the schema grows.

30. **No automated tests** -- no test files exist in the project.

31. **No CI/CD pipeline** -- no GitHub Actions or similar configured.

32. **`ws` package is optional** -- if not installed, WebSocket support silently degrades. This should be a required dependency.

---

*This documentation was generated from a thorough review of all source files in the estou-bem repository. For the latest code, always refer to the actual source files.*
