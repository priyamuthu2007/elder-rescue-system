const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { spawn } = require('node:child_process');

const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

function request(path, options) {
  return fetch(`${baseUrl}${path}`, options);
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname + '/..',
    env: { ...process.env, PORT: String(port), ADMIN_TOKEN: 'test-admin-token', OTP_DEV_MODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 5000);
    server.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('Server running at')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.once('error', reject);
    server.stderr.on('data', (chunk) => { output += chunk.toString(); });
  });
});

after(() => {
  if (server) server.kill();
});

test('report list requires an organization session', async () => {
  const response = await request('/reports');
  assert.equal(response.status, 401);
});

test('photos require an organization session', async () => {
  const response = await request('/uploads/example.jpg');
  assert.equal(response.status, 401);
});

test('reports require reporter phone verification', async () => {
  const form = new FormData();
  form.set('reporter_phone', '+919999999999');
  form.set('latitude', '0');
  form.set('longitude', '0');
  const response = await request('/reports', { method: 'POST', body: form });
  assert.equal(response.status, 403);
});

test('unsupported uploaded files are rejected', async () => {
  const form = new FormData();
  form.set('reporter_phone', '+919999999999');
  form.set('latitude', '0');
  form.set('longitude', '0');
  form.set('reporter_verification_token', 'invalid');
  form.set('photo', new Blob(['not an image'], { type: 'text/plain' }), 'note.txt');
  const response = await request('/reports', { method: 'POST', body: form });
  assert.equal(response.status, 400);
});

test('invalid coordinates are rejected', async () => {
  const response = await request('/nearby-organizations?latitude=91&longitude=0');
  assert.equal(response.status, 400);
});

test('organization verification requires the admin token', async () => {
  const response = await request('/admin/organizations/1/verify', { method: 'POST' });
  assert.equal(response.status, 403);
});

test('unmatched reports are visible in the protected fallback queue', async () => {
  const phone = '+919999999999';
  const otpRequest = await request('/report-verifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const otpRequestBody = await otpRequest.json();
  const otpConfirm = await request('/report-verifications/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: otpRequestBody.development_code }),
  });
  const otpConfirmBody = await otpConfirm.json();

  const form = new FormData();
  form.set('reporter_phone', phone);
  form.set('reporter_verification_token', otpConfirmBody.verification_token);
  form.set('latitude', '0');
  form.set('longitude', '0');
  form.set('description', 'Fallback queue test');

  const created = await request('/reports', { method: 'POST', body: form });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.fallback.status, 'queued_for_manual_follow_up');

  const queue = await request('/admin/fallback-reports', { headers: { 'x-admin-token': 'test-admin-token' } });
  assert.equal(queue.status, 200);
  const queueBody = await queue.json();
  assert.ok(queueBody.some((report) => report.id === createdBody.report.id));
});

test('login attempts are rate limited', async () => {
  let response;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await request('/organizations/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 999999, password: 'wrong-password' }),
    });
  }
  assert.equal(response.status, 429);
});
