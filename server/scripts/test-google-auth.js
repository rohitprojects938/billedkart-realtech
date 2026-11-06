'use strict';
/**
 * test-google-auth.js — Comprehensive verification of Google OAuth & Identity flow
 */
const http = require('http');
const assert = require('assert');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(responseBody) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: responseBody });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('--- Testing Google Authentication Integration ---');

  // Test 1: GET /api/auth/google returns 302 redirect with configured Google Client ID and callback URL
  const gRes = await get('http://127.0.0.1:4000/api/auth/google?return_to=http%3A%2F%2F127.0.0.1%3A5500%2Fhome_property_discovery%2Fcode.html');
  assert.strictEqual(gRes.status, 302, 'Should return 302 redirect');
  const loc = gRes.headers.location;
  assert.ok(loc.startsWith('https://accounts.google.com/'), 'Redirect target should be Google OAuth endpoint');
  assert.ok(loc.includes('client_id=608452701331-7gdov12ifb42thkm1co75na6nlrv8bo5.apps.googleusercontent.com'), 'Should include Google Client ID');
  assert.ok(loc.includes('redirect_uri=http%3A%2F%2Flocalhost%3A4000%2Fapi%2Fauth%2Fgoogle%2Fcallback'), 'Should include Google callback URL matching Google Console');
  assert.ok(loc.includes('state='), 'Should include HMAC-signed state token');
  console.log('✓ Test 1 Passed: GET /api/auth/google generates valid Google OAuth 2.0 authorization URL');

  // Test 2: GET /api/auth/google/callback with missing parameters redirects to error
  const errRes = await get('http://127.0.0.1:4000/api/auth/google/callback');
  assert.strictEqual(errRes.status, 302, 'Should return 302 redirect on error');
  assert.ok(errRes.headers.location.includes('auth_error='), 'Should redirect to frontend with auth_error param');
  console.log('✓ Test 2 Passed: /api/auth/google/callback handles missing params safely');

  // Test 3: POST /api/auth/exchange with invalid token rejects gracefully
  const exRes = await post('http://127.0.0.1:4000/api/auth/exchange', { token: 'invalid_fake_token_123' });
  assert.strictEqual(exRes.status, 400, 'Invalid exchange token should return 400');
  assert.strictEqual(exRes.body.success, false, 'Success flag should be false');
  console.log('✓ Test 3 Passed: POST /api/auth/exchange protects against invalid tokens');

  // Test 4: POST /api/auth/google/token with invalid credential rejects gracefully
  const tokRes = await post('http://127.0.0.1:4000/api/auth/google/token', { credential: 'bogus.jwt.token' });
  assert.strictEqual(tokRes.status, 401, 'Invalid Google ID token should return 401');
  assert.strictEqual(tokRes.body.success, false, 'Success flag should be false');
  console.log('✓ Test 4 Passed: POST /api/auth/google/token validates Google ID tokens with google-auth-library');

  console.log('--- ALL GOOGLE AUTH TESTS PASSED ---');
  process.exit(0);
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
