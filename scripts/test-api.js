#!/usr/bin/env node

/**
 * Estou Bem — Full Integration Test Suite
 *
 * Covers: Elder flow, Family flow, Watch flow, Admin flow, Cleanup.
 * Uses AbortController for request timeouts.
 * Exit code 1 if ANY test fails.
 */

const BASE_URL = process.env.TEST_BASE_URL || 'https://estou-bem-web-production.up.railway.app';
const REQUEST_TIMEOUT_MS = 15000;

// ── Credentials ──────────────────────────────────────────
const ELDER_EMAIL    = 'test-automation@estoubem.app';
const ELDER_PASSWORD = 'TestAuto2026!';
const ELDER_NAME     = 'Test Automation';

const FAMILY_EMAIL    = 'test-family@estoubem.app';
const FAMILY_PASSWORD = 'TestFamily2026!';
const FAMILY_NAME     = 'Test Family';

const ADMIN_EMAIL    = 't@paired-minds.com';
const ADMIN_PASSWORD = 'EstouBem2026!';

// ── State ────────────────────────────────────────────────
let elderToken  = null;
let familyToken = null;
let adminToken  = null;
let elderProfile = null;  // { id, link_code, subscription, ... }
let familyProfile = null;
let createdMedicationId = null;
let createdContactId = null;
let createdHealthEntryId = null;

let passed = 0;
let failed = 0;

// ── Helpers ──────────────────────────────────────────────

async function request(method, path, body, authToken) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const opts = { method, headers, signal: controller.signal };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(url, opts);
    clearTimeout(timer);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

function ok(name) {
  console.log(`  \u2713 ${name}`);
  passed++;
}

function fail(name, reason) {
  console.log(`  \u2717 ${name}: ${reason}`);
  failed++;
}

async function test(name, fn) {
  try {
    await fn();
  } catch (err) {
    fail(name, err.message);
  }
}

// ── Phase 1: Elder Flow ──────────────────────────────────

async function phaseElderFlow() {
  console.log('\nPhase 1: Elder Flow');

  // 1. Ensure elder user exists (register, tolerate 409)
  await test('Register elder (idempotent)', async () => {
    const res = await request('POST', '/api/register', {
      email: ELDER_EMAIL,
      password: ELDER_PASSWORD,
      name: ELDER_NAME,
      phone: '+5511999990000',
      role: 'elder',
    });
    if (![200, 201, 409].includes(res.status)) {
      throw new Error(`expected 200/201/409, got ${res.status}`);
    }
  });

  // 2. Login as elder
  await test('Login as elder', async () => {
    const res = await request('POST', '/api/login', {
      email: ELDER_EMAIL,
      password: ELDER_PASSWORD,
    });
    if (res.status !== 200 || !(res.data?.token || res.data?.accessToken)) {
      throw new Error(`expected 200 + token, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
    elderToken = res.data.token || res.data.accessToken;
    ok('Login as elder');
  });

  if (!elderToken) {
    fail('Login as elder', 'No token — skipping remaining elder tests');
    failed += 13;
    return;
  }

  // 3. GET /api/profile — verify subscription, link_code
  await test('Profile has subscription & link_code', async () => {
    const res = await request('GET', '/api/profile', null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!('subscription' in res.data)) throw new Error('missing subscription field');
    if (!('link_code' in res.data)) throw new Error('missing link_code field');
    elderProfile = res.data;
    ok('Profile has subscription & link_code');
  });

  // 4. PUT /api/settings — set check-in times
  await test('Settings save check-in times', async () => {
    const res = await request('PUT', '/api/settings', {
      checkin_times: ['09:00', '14:00'],
    }, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!res.data?.ok) throw new Error('response not ok');
    ok('Settings save check-in times');
  });

  // 5. GET /api/settings — verify times saved
  await test('Settings verify saved times', async () => {
    const res = await request('GET', '/api/settings', null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const times = res.data?.checkin_times;
    if (!Array.isArray(times) || !times.includes('09:00') || !times.includes('14:00')) {
      throw new Error(`expected ["09:00","14:00"], got ${JSON.stringify(times)}`);
    }
    ok('Settings verify saved times');
  });

  // 6. POST /api/checkins — create check-in
  await test('Create check-in', async () => {
    const res = await request('POST', '/api/checkins', {
      time: '09:00',
      status: 'confirmed',
    }, elderToken);
    if (![200, 201].includes(res.status)) throw new Error(`status ${res.status}`);
    if (!res.data?.id) throw new Error('no id returned');
    ok('Create check-in');
  });

  // 7. GET /api/checkins — verify check-in exists
  await test('Verify check-in exists', async () => {
    const res = await request('GET', '/api/checkins', null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!Array.isArray(res.data) || res.data.length === 0) throw new Error('no checkins found');
    ok('Verify check-in exists');
  });

  // 8. POST /api/medications — add medication
  await test('Add medication', async () => {
    const res = await request('POST', '/api/medications', {
      name: 'Test Aspirin',
      dosage: '100mg',
      frequency: 'daily',
    }, elderToken);
    if (![200, 201].includes(res.status)) throw new Error(`status ${res.status}`);
    if (!res.data?.id) throw new Error('no id returned');
    createdMedicationId = res.data.id;
    ok('Add medication');
  });

  // 9. GET /api/medications — verify medication exists
  await test('Verify medication exists', async () => {
    const res = await request('GET', '/api/medications', null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const found = Array.isArray(res.data) && res.data.some(m => m.name === 'Test Aspirin');
    if (!found) throw new Error('Test Aspirin not found in medications');
    ok('Verify medication exists');
  });

  // 10. POST /api/contacts — add emergency contact
  await test('Add emergency contact', async () => {
    const res = await request('POST', '/api/contacts', {
      name: 'Test Contact',
      phone: '+5511999990001',
      relationship: 'friend',
    }, elderToken);
    if (![200, 201].includes(res.status)) throw new Error(`status ${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.id) throw new Error('no id returned');
    createdContactId = res.data.id;
    ok('Add emergency contact');
  });

  // 11. GET /api/contacts — verify contact exists
  await test('Verify contact exists', async () => {
    const res = await request('GET', '/api/contacts', null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const found = Array.isArray(res.data) && res.data.some(c => c.name === 'Test Contact');
    if (!found) throw new Error('Test Contact not found');
    ok('Verify contact exists');
  });

  // 12. POST /api/health — add health entry
  await test('Add health entry', async () => {
    const res = await request('POST', '/api/health', {
      type: 'heart_rate',
      value: 72,
      unit: 'bpm',
    }, elderToken);
    if (![200, 201].includes(res.status)) throw new Error(`status ${res.status}`);
    if (!res.data?.id) throw new Error('no id returned');
    createdHealthEntryId = res.data.id;
    ok('Add health entry');
  });

  // 13. GET /api/health — verify health entry exists
  await test('Verify health entry exists', async () => {
    const res = await request('GET', '/api/health', null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!Array.isArray(res.data) || res.data.length === 0) throw new Error('no health entries');
    const found = res.data.some(h => h.type === 'heart_rate' && Number(h.value) === 72);
    if (!found) throw new Error('heart_rate=72 not found');
    ok('Verify health entry exists');
  });

  // 14. POST /api/activity-update — send movement + heart_rate data
  await test('Activity update (watch data)', async () => {
    const res = await request('POST', '/api/activity-update', {
      user_id: elderProfile?.id,
      movement_detected: true,
      heart_rate: 75,
      spo2: 98,
    }, elderToken);
    if (![200, 201].includes(res.status)) throw new Error(`status ${res.status}`);
    ok('Activity update (watch data)');
  });

  // 15. POST /api/gamification/checkin-reward — verify streak
  await test('Gamification checkin-reward', async () => {
    const res = await request('POST', '/api/gamification/checkin-reward', {}, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (typeof res.data?.streak !== 'number') throw new Error('no streak in response');
    ok('Gamification checkin-reward');
  });

  // 16. GET /api/gamification — verify streak and points
  await test('Gamification stats', async () => {
    const res = await request('GET', '/api/gamification', null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (typeof res.data?.streak_days !== 'number') throw new Error('no streak_days');
    if (typeof res.data?.total_points !== 'number') throw new Error('no total_points');
    ok('Gamification stats');
  });
}

// ── Phase 2: Family Flow ─────────────────────────────────

async function phaseFamilyFlow() {
  console.log('\nPhase 2: Family Flow');

  if (!elderProfile?.link_code) {
    fail('Family flow', 'No elder link_code — skipping');
    failed += 3;
    return;
  }

  // 17. Register family user (idempotent)
  await test('Register family user (idempotent)', async () => {
    const res = await request('POST', '/api/register', {
      email: FAMILY_EMAIL,
      password: FAMILY_PASSWORD,
      name: FAMILY_NAME,
      phone: '+5511999990002',
      role: 'family',
    });
    if (![200, 201, 409].includes(res.status)) {
      throw new Error(`expected 200/201/409, got ${res.status}`);
    }
  });

  // Login as family
  await test('Login as family', async () => {
    const res = await request('POST', '/api/login', {
      email: FAMILY_EMAIL,
      password: FAMILY_PASSWORD,
    });
    if (res.status !== 200 || !(res.data?.token || res.data?.accessToken)) {
      throw new Error(`expected 200 + token, got ${res.status}`);
    }
    familyToken = res.data.token || res.data.accessToken;
    ok('Login as family');
  });

  if (!familyToken) {
    fail('Login as family', 'No token — skipping remaining family tests');
    failed += 2;
    return;
  }

  // 18. POST /api/link-elder — link family to elder
  await test('Link family to elder', async () => {
    const res = await request('POST', '/api/link-elder', {
      code: elderProfile.link_code,
    }, familyToken);
    // 200 = newly linked, or already linked (server may return ok either way)
    if (res.status !== 200) throw new Error(`status ${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.ok && !res.data?.elderName) throw new Error('unexpected response');
    ok('Link family to elder');
  });

  // 19. GET /api/family/elder-status — verify linked
  await test('Family elder-status shows linked', async () => {
    const res = await request('GET', '/api/family/elder-status', null, familyToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (res.data?.linked !== true) throw new Error(`linked=${res.data?.linked}, expected true`);
    if (!res.data?.elderName) throw new Error('no elderName');
    // Verify sub-data arrays exist
    if (!Array.isArray(res.data?.checkins)) throw new Error('no checkins array');
    if (!Array.isArray(res.data?.medications)) throw new Error('no medications array');
    if (!Array.isArray(res.data?.health)) throw new Error('no health array');
    ok('Family elder-status shows linked');
  });

  // 20. GET /api/profile — verify linked_elder_id set
  await test('Family profile has linked_elder_id', async () => {
    const res = await request('GET', '/api/profile', null, familyToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!res.data?.linked_elder_id) throw new Error('linked_elder_id not set');
    familyProfile = res.data;
    ok('Family profile has linked_elder_id');
  });
}

// ── Phase 3: Watch Flow ──────────────────────────────────

async function phaseWatchFlow() {
  console.log('\nPhase 3: Watch Flow');

  if (!elderProfile?.link_code) {
    fail('Watch flow', 'No elder link_code — skipping');
    failed += 1;
    return;
  }

  // 21. POST /api/watch/checkin — watch check-in (no auth, uses link_code)
  await test('Watch check-in via link_code', async () => {
    const res = await request('POST', '/api/watch/checkin', {
      link_code: elderProfile.link_code,
      timestamp: new Date().toISOString(),
    });
    if (res.status !== 200) throw new Error(`status ${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.ok) throw new Error('response not ok');
    ok('Watch check-in via link_code');
  });

  // 22. GET /api/watch/schedule — verify schedule returned
  await test('Watch schedule returns times', async () => {
    const res = await request('GET', `/api/watch/schedule?link_code=${elderProfile.link_code}`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    // Should have checkin_times or checkin_mode
    if (!res.data?.checkin_times && !res.data?.checkin_mode) {
      throw new Error('no schedule data returned');
    }
    ok('Watch schedule returns times');
  });
}

// ── Phase 4: Admin Flow ──────────────────────────────────

async function phaseAdminFlow() {
  console.log('\nPhase 4: Admin Flow');

  // 23. POST /api/admin/login
  await test('Admin login', async () => {
    const res = await request('POST', '/api/admin/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    if (res.status !== 200 || !res.data?.token) {
      throw new Error(`expected 200 + token, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
    adminToken = res.data.token;
    ok('Admin login');
  });

  if (!adminToken) {
    fail('Admin login', 'No token — skipping remaining admin tests');
    failed += 4;
    return;
  }

  // 24. GET /api/admin/users — verify test users appear
  let elderUserId = elderProfile?.id;
  await test('Admin list users (test users present)', async () => {
    const res = await request('GET', '/api/admin/users', null, adminToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!Array.isArray(res.data)) throw new Error('expected array');
    const elderUser = res.data.find(u => u.email === ELDER_EMAIL);
    if (!elderUser) throw new Error('elder test user not found');
    if (!elderUserId) elderUserId = elderUser.id;
    ok('Admin list users (test users present)');
  });

  if (!elderUserId) {
    fail('Admin flow', 'No elder user ID — skipping user-specific tests');
    failed += 3;
    return;
  }

  // 25. PUT /api/admin/users/:id — change subscription to premium
  await test('Admin set user to premium', async () => {
    const res = await request('PUT', `/api/admin/users/${elderUserId}`, {
      subscription: 'premium',
    }, adminToken);
    if (res.status !== 200) throw new Error(`status ${res.status}: ${JSON.stringify(res.data)}`);
    ok('Admin set user to premium');
  });

  // 26. GET /api/admin/users/:id — verify subscription changed
  await test('Admin verify premium subscription', async () => {
    const res = await request('GET', `/api/admin/users/${elderUserId}`, null, adminToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (res.data?.subscription !== 'premium') {
      throw new Error(`expected premium, got ${res.data?.subscription}`);
    }
    ok('Admin verify premium subscription');
  });

  // 27. GET /api/debug/user/:id — verify debug data returns
  await test('Debug user data', async () => {
    const res = await request('GET', `/api/debug/user/${elderUserId}`, null, adminToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!('checkins' in res.data) && !('health_readings' in res.data)) {
      throw new Error('expected checkins or health_readings in debug data');
    }
    ok('Debug user data');
  });
}

// ── Phase 5: Cleanup ─────────────────────────────────────

async function phaseCleanup() {
  console.log('\nPhase 5: Cleanup');

  // 28. DELETE /api/medications/:id — remove test medication
  await test('Delete test medication', async () => {
    if (!createdMedicationId) throw new Error('no medication id to delete');
    const res = await request('DELETE', `/api/medications/${createdMedicationId}`, null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!res.data?.ok) throw new Error('delete not ok');
    ok('Delete test medication');
  });

  // 29. DELETE /api/contacts/:id — remove test contact
  await test('Delete test contact', async () => {
    if (!createdContactId) throw new Error('no contact id to delete');
    const res = await request('DELETE', `/api/contacts/${createdContactId}`, null, elderToken);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!res.data?.ok) throw new Error('delete not ok');
    ok('Delete test contact');
  });
}

// ── Runner ───────────────────────────────────────────────

async function run() {
  console.log('=== Estou Bem Full Integration Test ===');
  console.log(`Server: ${BASE_URL}`);
  console.log(`Date:   ${new Date().toISOString()}`);

  await phaseElderFlow();
  await phaseFamilyFlow();
  await phaseWatchFlow();
  await phaseAdminFlow();
  await phaseCleanup();

  const total = passed + failed;
  console.log(`\nResults: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
