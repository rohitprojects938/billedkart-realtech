'use strict';
/**
 * test-login-failure-handling.js
 * End-to-end verification of login failure handling, error reporting,
 * duplicate protection, sanitization, and admin management.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const API_BASE = 'http://127.0.0.1:4000';

class TestClient {
  constructor() {
    this.cookie = null;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = { ...(options.headers || {}) };
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }
    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const res = await fetch(url, { ...options, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';')[0];
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { status: res.status, headers: res.headers, data };
  }
}

async function runTests() {
  console.log('--- Starting Billedkart Realtech Login Failure Handling Tests ---');

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vastu_reviews',
    charset: 'utf8mb4'
  });

  const rand = Math.floor(Math.random() * 900000 + 100000);

  // 1. FRONTEND VERIFICATION
  console.log('\n[TEST 1] Verifying frontend modals & error handling in code.html');
  const codeHtml = fs.readFileSync(path.join(__dirname, '../../home_property_discovery/code.html'), 'utf8');

  assert(codeHtml.includes('id="login-failure-modal-overlay"'), 'login-failure-modal-overlay exists in code.html');
  assert(codeHtml.includes('id="login-feedback-modal-overlay"'), 'login-feedback-modal-overlay exists in code.html');
  assert(codeHtml.includes('id="admin-login-issues-modal-overlay"'), 'admin-login-issues-modal-overlay exists in code.html');

  assert(codeHtml.includes("We're experiencing high login traffic. Please try again later or sign in with Google."), 'Accurate high traffic quota message exists');
  assert(codeHtml.includes('Try Again Later'), 'Try Again Later button exists');
  assert(codeHtml.includes('Login with Google'), 'Login with Google button exists');
  assert(codeHtml.includes("We couldn't complete your login. Please try again later or send us feedback."), 'Google login failure message exists');
  assert(codeHtml.includes('Send Feedback / Report'), 'Send Feedback button exists');
  console.log('✓ TEST 1 PASSED: Frontend modals, buttons, and accurate error copy verified.');

  // 2. REPORT ISSUE ENDPOINT - VALIDATION
  console.log('\n[TEST 2] Testing POST /api/auth/report-issue input validation');
  const anon = new TestClient();

  const noCatRes = await anon.request('/api/auth/report-issue', {
    method: 'POST',
    body: { error_category: '' }
  });
  assert.strictEqual(noCatRes.status, 400, 'Rejects missing error category with 400');
  assert(noCatRes.data && !noCatRes.data.success, 'Returns success: false on missing category');
  console.log('✓ TEST 2 PASSED: Missing category properly rejected with 400.');

  // 3. REPORT ISSUE ENDPOINT - SUCCESSFUL SUBMISSION & SANITIZATION
  console.log('\n[TEST 3] Testing POST /api/auth/report-issue submission and token redaction');
  const cat = `phone_quota_exceeded_${rand}`;
  const sensitiveCode = 'Bearer secret-token-12345';
  const sensitiveMsg = 'id_token=eyJh.sensitive.token password=supersecret';
  const userMsg = 'SMS did not arrive after multiple attempts <script>alert(1)</script>';

  const submitRes = await anon.request('/api/auth/report-issue', {
    method: 'POST',
    body: {
      error_category: cat,
      error_code: sensitiveCode,
      error_message: sensitiveMsg,
      user_identifier: '9876543210',
      user_message: userMsg,
      client_timestamp: new Date().toISOString()
    }
  });

  assert.strictEqual(submitRes.status, 201, 'Returns 201 Created on valid report');
  assert(submitRes.data && submitRes.data.success, 'Returns success: true');
  const reportId = submitRes.data.reportId;
  assert(reportId, 'Returns reportId');

  // Verify in MySQL
  const [rows] = await pool.execute('SELECT * FROM login_issues WHERE id = ?', [reportId]);
  assert.strictEqual(rows.length, 1, 'Record found in MySQL');
  const row = rows[0];
  assert.strictEqual(row.error_category, cat.toLowerCase(), 'Category matches');
  assert(!row.error_code.includes('secret-token-12345'), 'Token is redacted in error_code');
  assert(!row.error_message.includes('supersecret'), 'Password is redacted in error_message');
  assert(!row.user_message.includes('<script>'), 'HTML script tags stripped from user_message');
  assert.strictEqual(row.status, 'open', 'Initial status is open');
  console.log('✓ TEST 3 PASSED: Issue report saved in MySQL with secrets redacted and scripts sanitized.');

  // 4. DUPLICATE SUBMISSION PROTECTION
  console.log('\n[TEST 4] Testing duplicate submission protection');
  const dupeRes = await anon.request('/api/auth/report-issue', {
    method: 'POST',
    body: {
      error_category: cat,
      error_code: sensitiveCode,
      user_identifier: '9876543210'
    }
  });

  assert.strictEqual(dupeRes.status, 200, 'Duplicate submission handled gracefully with 200');
  assert(dupeRes.data.duplicate === true, 'Response marks duplicate: true');

  const [dupeCheck] = await pool.execute('SELECT COUNT(*) as cnt FROM login_issues WHERE error_category = ?', [cat.toLowerCase()]);
  assert.strictEqual(dupeCheck[0].cnt, 1, 'Duplicate row was NOT inserted into MySQL');
  console.log('✓ TEST 4 PASSED: Duplicate report within 60s detected and duplicate DB insert prevented.');

  // 5. ADMIN ACCESS CONTROL
  console.log('\n[TEST 5] Testing Admin authentication and authorization for login issues');

  // 5A: Unauthenticated access
  const unauthRes = await anon.request('/api/admin/login-issues');
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated access returns 401');

  // 5B: Standard user access (role: 'user')
  const userPassword = 'TestUser123!';
  const userPassHash = await bcrypt.hash(userPassword, 10);
  const normalUserEmail = `normal_${rand}@vastu.test`;
  const [insUser] = await pool.execute(
    `INSERT INTO users (full_name, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'user', 'active')`,
    ['Normal User', `user_${rand}`, normalUserEmail, userPassHash]
  );
  const normalUserId = insUser.insertId;

  const normalClient = new TestClient();
  const loginNormalRes = await normalClient.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: normalUserEmail, password: userPassword }
  });
  assert(loginNormalRes.data && loginNormalRes.data.success, 'Normal user logged in');

  const forbiddenRes = await normalClient.request('/api/admin/login-issues');
  assert.strictEqual(forbiddenRes.status, 403, 'Normal user receives 403 Forbidden for admin endpoint');

  // 5C: Admin user access (role: 'admin')
  const adminPassword = 'AdminPass123!';
  const adminPassHash = await bcrypt.hash(adminPassword, 10);
  const adminEmail = `admin_${rand}@vastu.test`;
  const [insAdmin] = await pool.execute(
    `INSERT INTO users (full_name, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'admin', 'active')`,
    ['Admin Officer', `admin_${rand}`, adminEmail, adminPassHash]
  );
  const adminUserId = insAdmin.insertId;

  const adminClient = new TestClient();
  const loginAdminRes = await adminClient.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: adminEmail, password: adminPassword }
  });
  assert(loginAdminRes.data && loginAdminRes.data.success, 'Admin user logged in');
  assert.strictEqual(loginAdminRes.data.user.role, 'admin', 'User has admin role');

  const adminIssuesRes = await adminClient.request('/api/admin/login-issues');
  assert.strictEqual(adminIssuesRes.status, 200, 'Admin receives 200 OK');
  assert(adminIssuesRes.data && Array.isArray(adminIssuesRes.data.issues), 'Admin receives list of issues');
  const found = adminIssuesRes.data.issues.find(i => i.id === reportId);
  assert(found, 'Created issue report is present in admin view list');
  console.log('✓ TEST 5 PASSED: Admin authorization verified: 401 unauth, 403 standard user, 200 admin.');

  // 6. ADMIN STATUS UPDATE (PATCH)
  console.log('\n[TEST 6] Testing Admin issue status update (PATCH /api/admin/login-issues/:id)');
  const patchRes = await adminClient.request(`/api/admin/login-issues/${reportId}`, {
    method: 'PATCH',
    body: {
      status: 'investigating',
      admin_notes: 'Engineering team is checking Firebase SMS gateway.'
    }
  });

  assert.strictEqual(patchRes.status, 200, 'Status update returns 200');
  assert(patchRes.data && patchRes.data.success, 'Status update successful');

  const [updatedRows] = await pool.execute('SELECT status, admin_notes FROM login_issues WHERE id = ?', [reportId]);
  assert.strictEqual(updatedRows[0].status, 'investigating', 'Status updated to investigating in DB');
  assert.strictEqual(updatedRows[0].admin_notes, 'Engineering team is checking Firebase SMS gateway.', 'Admin notes saved');

  // Mark resolved
  const resolveRes = await adminClient.request(`/api/admin/login-issues/${reportId}`, {
    method: 'PATCH',
    body: { status: 'resolved' }
  });
  assert.strictEqual(resolveRes.status, 200, 'Resolve update returns 200');

  const [resolvedRows] = await pool.execute('SELECT status FROM login_issues WHERE id = ?', [reportId]);
  assert.strictEqual(resolvedRows[0].status, 'resolved', 'Status updated to resolved in DB');
  console.log('✓ TEST 6 PASSED: Admin issue update workflow verified (open -> investigating -> resolved).');

  // Cleanup test users
  await pool.execute('DELETE FROM users WHERE id IN (?, ?)', [normalUserId, adminUserId]);
  await pool.end();

  console.log('\n======================================================');
  console.log('ALL LOGIN FAILURE HANDLING TESTS PASSED SUCCESSFULLY! (6/6)');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
