#!/usr/bin/env node

/**
 * API Integration Tests
 * Tests the real Estou Bem server endpoints.
 */

const BASE_URL = 'https://estou-bem-web-production.up.railway.app';
const TEST_EMAIL = 'test-automation@estoubem.app';
const TEST_PASSWORD = 'TestAuto2026!';
const TEST_NAME = 'Test Automation';

let token = null;
let passed = 0;
let failed = 0;

async function request(method, path, body, authToken) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function pass(name) {
  console.log(`  PASS  ${name}`);
  passed++;
}

function fail(name, reason) {
  console.log(`  FAIL  ${name} — ${reason}`);
  failed++;
}

async function test(name, fn) {
  try {
    await fn();
  } catch (err) {
    fail(name, err.message);
  }
}

async function run() {
  console.log('API Integration Tests');
  console.log(`Server: ${BASE_URL}\n`);

  // 1. Register
  await test('POST /api/register', async () => {
    const res = await request('POST', '/api/register', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: TEST_NAME,
    });
    if (res.status === 200 || res.status === 201 || res.status === 409) {
      pass(`POST /api/register → ${res.status}`);
    } else {
      fail(`POST /api/register`, `expected 200/201/409, got ${res.status}`);
    }
  });

  // 2. Login
  await test('POST /api/login', async () => {
    const res = await request('POST', '/api/login', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (res.status === 200 && res.data && (res.data.token || res.data.accessToken)) {
      token = res.data.token || res.data.accessToken;
      pass(`POST /api/login → token received`);
    } else {
      fail(`POST /api/login`, `expected 200 with token, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
  });

  if (!token) {
    console.log('\nCannot continue without auth token. Aborting remaining tests.');
    failed += 11;
    printSummary();
    return;
  }

  // 3. GET /api/profile
  await test('GET /api/profile', async () => {
    const res = await request('GET', '/api/profile', null, token);
    if (res.status === 200 && res.data) {
      pass(`GET /api/profile → user data received`);
    } else {
      fail(`GET /api/profile`, `expected 200 with data, got ${res.status}`);
    }
  });

  // 4. GET /api/family/elder-status
  await test('GET /api/family/elder-status', async () => {
    const res = await request('GET', '/api/family/elder-status', null, token);
    if (res.status === 200 && res.data !== undefined) {
      pass(`GET /api/family/elder-status → ${res.data.linked !== undefined ? 'linked data' : 'data received'}`);
    } else {
      fail(`GET /api/family/elder-status`, `expected 200, got ${res.status}`);
    }
  });

  // 5. GET /api/settings
  await test('GET /api/settings', async () => {
    const res = await request('GET', '/api/settings', null, token);
    if (res.status === 200 && res.data) {
      pass(`GET /api/settings → settings received`);
    } else {
      fail(`GET /api/settings`, `expected 200, got ${res.status}`);
    }
  });

  // 6. GET /api/checkins
  await test('GET /api/checkins', async () => {
    const res = await request('GET', '/api/checkins', null, token);
    if (res.status === 200 && Array.isArray(res.data)) {
      pass(`GET /api/checkins → ${res.data.length} checkins`);
    } else {
      fail(`GET /api/checkins`, `expected 200 with array, got ${res.status}`);
    }
  });

  // 7. GET /api/medications
  await test('GET /api/medications', async () => {
    const res = await request('GET', '/api/medications', null, token);
    if (res.status === 200 && Array.isArray(res.data)) {
      pass(`GET /api/medications → ${res.data.length} medications`);
    } else {
      fail(`GET /api/medications`, `expected 200 with array, got ${res.status}`);
    }
  });

  // 8. GET /api/contacts
  await test('GET /api/contacts', async () => {
    const res = await request('GET', '/api/contacts', null, token);
    if (res.status === 200 && Array.isArray(res.data)) {
      pass(`GET /api/contacts → ${res.data.length} contacts`);
    } else {
      fail(`GET /api/contacts`, `expected 200 with array, got ${res.status}`);
    }
  });

  // 9. GET /api/health
  await test('GET /api/health', async () => {
    const res = await request('GET', '/api/health', null, token);
    if (res.status === 200) {
      pass(`GET /api/health → ${Array.isArray(res.data) ? res.data.length + ' entries' : 'data received'}`);
    } else {
      fail(`GET /api/health`, `expected 200, got ${res.status}`);
    }
  });

  // 10. POST /api/checkins
  await test('POST /api/checkins', async () => {
    const res = await request('POST', '/api/checkins', {
      mood: 'good',
      note: 'Automated test check-in',
    }, token);
    if (res.status === 200 || res.status === 201) {
      pass(`POST /api/checkins → ${res.status}`);
    } else {
      fail(`POST /api/checkins`, `expected 200/201, got ${res.status}`);
    }
  });

  // 11. GET /api/gamification
  await test('GET /api/gamification', async () => {
    const res = await request('GET', '/api/gamification', null, token);
    if (res.status === 200 && res.data) {
      pass(`GET /api/gamification → data received`);
    } else {
      fail(`GET /api/gamification`, `expected 200, got ${res.status}`);
    }
  });

  // 12. POST /api/nap
  await test('POST /api/nap', async () => {
    const res = await request('POST', '/api/nap', {
      duration: 30,
      quality: 'good',
    }, token);
    if (res.status === 200 || res.status === 201) {
      pass(`POST /api/nap → ${res.status}`);
    } else {
      fail(`POST /api/nap`, `expected 200/201, got ${res.status}`);
    }
  });

  // 13. GET /api/profile — check subscription field
  await test('GET /api/profile (subscription check)', async () => {
    const res = await request('GET', '/api/profile', null, token);
    if (res.status === 200 && res.data && 'subscription' in res.data) {
      pass(`GET /api/profile → subscription field exists`);
    } else if (res.status === 200) {
      fail(`GET /api/profile (subscription check)`, `200 OK but no "subscription" field in response`);
    } else {
      fail(`GET /api/profile (subscription check)`, `expected 200, got ${res.status}`);
    }
  });

  printSummary();
}

function printSummary() {
  const total = passed + failed;
  console.log(`\n${passed}/${total} tests passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
