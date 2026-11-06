'use strict';
/**
 * test-auth-e2e.js
 * End-to-end automated test suite for Billedkart Realtech Authentication System
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../db');

const API_BASE = 'http://127.0.0.1:4000';

async function runTests() {
  console.log('=====================================================');
  console.log('🚀 Starting Billedkart Realtech Auth System E2E Automated Tests');
  console.log('=====================================================\n');

  let cookieHeader = '';

  function saveCookie(res) {
    const raw = res.headers.get('set-cookie');
    if (raw) {
      const match = raw.match(/vastu_sid=[^;]+/);
      if (match) cookieHeader = match[0];
    }
  }

  const randSuffix = Math.floor(100000 + Math.random() * 900000).toString();
  const testUser = {
    full_name: 'Aditya Sharma',
    username: 'aditya_' + randSuffix,
    email: `aditya_${randSuffix}@vastutest.in`,
    password: 'SecurePassword123!',
    phone: '98' + Math.floor(10000000 + Math.random() * 90000000).toString()
  };

  try {
    // -------------------------------------------------------------
    // Test 1: Check initial unauthenticated session
    // -------------------------------------------------------------
    console.log('Test 1: GET /api/auth/me (initial guest state)');
    let res = await fetch(`${API_BASE}/api/auth/me`);
    let data = await res.json();
    console.log('Status:', res.status, 'Body:', data);
    if (data.authenticated !== false) throw new Error('Expected unauthenticated guest state');
    console.log('✅ PASS: Guest state verified\n');

    // -------------------------------------------------------------
    // Test 2: Register a new account
    // -------------------------------------------------------------
    console.log(`Test 2: POST /api/auth/register (${testUser.email})`);
    res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    });
    saveCookie(res);
    data = await res.json();
    console.log('Status:', res.status, 'Body:', data);
    if (!data.success || !data.user || data.user.email !== testUser.email) {
      throw new Error('Registration failed: ' + JSON.stringify(data));
    }
    console.log('✅ PASS: Registration succeeded with session cookie:', cookieHeader, '\n');

    // -------------------------------------------------------------
    // Test 3: Verify authenticated session after register
    // -------------------------------------------------------------
    console.log('Test 3: GET /api/auth/me with session cookie');
    res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Cookie: cookieHeader }
    });
    data = await res.json();
    console.log('Status:', res.status, 'Authenticated user:', data.user ? data.user.username : null);
    if (!data.authenticated || data.user.username !== testUser.username) {
      throw new Error('Session persistence check failed');
    }
    console.log('✅ PASS: Active session verified in MySQL store\n');

    // -------------------------------------------------------------
    // Test 4: Duplicate registration should be rejected
    // -------------------------------------------------------------
    console.log('Test 4: POST /api/auth/register (duplicate email & username)');
    res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    });
    data = await res.json();
    console.log('Status:', res.status, 'Error message:', data.error);
    if (res.status !== 409 || data.success) {
      throw new Error('Expected 409 Conflict for duplicate user');
    }
    console.log('✅ PASS: Duplicate registration properly blocked\n');

    // -------------------------------------------------------------
    // Test 5: Logout
    // -------------------------------------------------------------
    console.log('Test 5: POST /api/auth/logout');
    res = await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieHeader }
    });
    saveCookie(res);
    data = await res.json();
    console.log('Status:', res.status, 'Body:', data);

    // Verify session terminated
    res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Cookie: cookieHeader }
    });
    data = await res.json();
    if (data.authenticated !== false) throw new Error('Expected session to be destroyed');
    console.log('✅ PASS: Logout successfully cleared session\n');

    // -------------------------------------------------------------
    // Test 6: Password Login (via Username)
    // -------------------------------------------------------------
    console.log('Test 6: POST /api/auth/login via username');
    res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testUser.username, password: testUser.password }),
    });
    saveCookie(res);
    data = await res.json();
    console.log('Status:', res.status, 'Logged in as:', data.user ? data.user.full_name : null);
    if (!data.success || !data.user) throw new Error('Login via username failed');
    console.log('✅ PASS: Login via username succeeded\n');

    // -------------------------------------------------------------
    // Test 7: Password Login with wrong password
    // -------------------------------------------------------------
    console.log('Test 7: POST /api/auth/login with wrong password');
    res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testUser.email, password: 'WrongPassword999' }),
    });
    data = await res.json();
    console.log('Status:', res.status, 'Error:', data.error);
    if (res.status !== 401 || data.success) throw new Error('Expected 401 for bad password');
    console.log('✅ PASS: Invalid credentials securely rejected\n');

    // -------------------------------------------------------------
    // Test 8: Email OTP Flow (Request & Verify)
    // -------------------------------------------------------------
    console.log('Test 8: POST /api/auth/otp/request for login');
    const otpEmail = `otp_user_${Date.now().toString().slice(-5)}@vastutest.in`;
    res = await fetch(`${API_BASE}/api/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otpEmail, purpose: 'login' }),
    });
    data = await res.json();
    console.log('Status:', res.status, 'Body:', data);
    if (!data.success) throw new Error('OTP request failed');

    // Find the latest OTP from MySQL to verify hashing and match
    const [otpRows] = await pool.execute(
      `SELECT * FROM otp_codes WHERE email = ? AND purpose = 'login' ORDER BY id DESC LIMIT 1`,
      [otpEmail]
    );
    if (otpRows.length === 0) throw new Error('OTP code record not found in database');
    console.log('OTP Record found in MySQL (Hashed):', otpRows[0].otp_hash);

    // Let's test wrong OTP first
    res = await fetch(`${API_BASE}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otpEmail, otp: '000000', purpose: 'login' }),
    });
    data = await res.json();
    console.log('Wrong OTP response:', data);
    if (data.success !== false) throw new Error('Expected wrong OTP to fail');

    // Now test with the dev OTP: in development fallback, the email service logged the OTP.
    // Let's request a known OTP or test by generating a test OTP directly:
    const crypto = require('crypto');
    const knownOtp = '742918';
    const knownHash = crypto.createHash('sha256').update(knownOtp).digest('hex');
    await pool.execute(
      `INSERT INTO otp_codes (email, otp_hash, purpose, attempts, expires_at)
       VALUES (?, ?, 'login', 0, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
      [otpEmail, knownHash]
    );

    res = await fetch(`${API_BASE}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otpEmail, otp: knownOtp, purpose: 'login' }),
    });
    saveCookie(res);
    data = await res.json();
    console.log('Verify OTP response:', data);
    if (!data.success || !data.user) throw new Error('OTP verify failed');
    console.log('✅ PASS: Email OTP verified, new user created & session established\n');

    // -------------------------------------------------------------
    // Test 9: Password Recovery / Forgot Password Flow
    // -------------------------------------------------------------
    console.log('Test 9: Forgot Password & Reset Flow');
    res = await fetch(`${API_BASE}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email }),
    });
    data = await res.json();
    console.log('Forgot password request:', data);
    if (!data.success) throw new Error('Forgot password request failed');

    // Set known reset OTP
    const resetOtp = '819203';
    const resetHash = crypto.createHash('sha256').update(resetOtp).digest('hex');
    await pool.execute(
      `INSERT INTO otp_codes (email, otp_hash, purpose, attempts, expires_at)
       VALUES (?, ?, 'password_reset', 0, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
      [testUser.email, resetHash]
    );

    // Verify recovery code
    let resetCookie = '';
    res = await fetch(`${API_BASE}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, otp: resetOtp, purpose: 'password_reset' }),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/vastu_sid=[^;]+/);
      if (match) resetCookie = match[0];
    }
    data = await res.json();
    console.log('Verify recovery code response:', data);
    if (!data.success || !data.resetToken) throw new Error('Recovery code verification failed');

    // Reset password
    const newPassword = 'BrandNewPassword2026!';
    res = await fetch(`${API_BASE}/api/auth/password/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: resetCookie,
      },
      body: JSON.stringify({
        email: testUser.email,
        reset_token: data.resetToken,
        new_password: newPassword,
        confirm_password: newPassword,
      }),
    });
    data = await res.json();
    console.log('Password reset response:', data);
    if (!data.success) throw new Error('Password reset failed: ' + JSON.stringify(data));

    // Sign in with new password
    res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testUser.email, password: newPassword }),
    });
    data = await res.json();
    console.log('Login with new password response:', data.success, data.user ? data.user.full_name : null);
    if (!data.success) throw new Error('Login with new password failed');
    console.log('✅ PASS: Password reset and new login succeeded\n');

    console.log('=====================================================');
    console.log('🎉 ALL 9 E2E AUTHENTICATION TESTS PASSED SUCCESSFULLY!');
    console.log('=====================================================');

  } catch (err) {
    console.error('❌ E2E TEST FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
