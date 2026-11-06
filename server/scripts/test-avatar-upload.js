'use strict';
/**
 * test-avatar-upload.js — Automated test for Profile Image Upload and Review Sync
 */
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

function makeMultipartRequest(url, fields, fileField, cookie) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2);
    const parsed = new URL(url);

    let body = Buffer.alloc(0);

    for (const [key, val] of Object.entries(fields)) {
      let part = `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`;
      body = Buffer.concat([body, Buffer.from(part, 'utf8')]);
    }

    if (fileField) {
      let fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType}\r\n\r\n`;
      body = Buffer.concat([body, Buffer.from(fileHeader, 'utf8'), fileField.buffer, Buffer.from('\r\n', 'utf8')]);
    }

    body = Buffer.concat([body, Buffer.from(`--${boundary}--\r\n`, 'utf8')]);

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    };
    if (cookie) headers['Cookie'] = cookie;

    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers,
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        let setCookie = res.headers['set-cookie'];
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resBody), setCookie });
        } catch (e) {
          resolve({ status: res.statusCode, body: resBody, setCookie });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function makeJsonRequest(url, method, data, cookie) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = JSON.stringify(data);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    };
    if (cookie) headers['Cookie'] = cookie;

    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers,
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        let setCookie = res.headers['set-cookie'];
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resBody), setCookie });
        } catch (e) {
          resolve({ status: res.statusCode, body: resBody, setCookie });
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function run() {
  console.log('--- Testing Profile Avatar Upload & Sync ---');

  // Test 1: Unauthenticated upload returns 401
  const unauthRes = await makeMultipartRequest('http://127.0.0.1:4000/api/auth/profile-image', {}, null, null);
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated upload should be 401');
  console.log('✓ Test 1 Passed: Unauthenticated upload blocked (401)');

  // Register test user
  const uniqueSuffix = Math.floor(Math.random() * 900000 + 100000);
  const testPhone = '9871' + Math.floor(100000 + Math.random() * 900000);
  const regRes = await makeJsonRequest('http://127.0.0.1:4000/api/auth/register', 'POST', {
    full_name: 'Avatar Tester',
    username: `av_user_${uniqueSuffix}`,
    email: `av_user_${uniqueSuffix}@vastutest.in`,
    phone: testPhone,
    password: 'Password123!',
  });
  assert.strictEqual(regRes.status, 201, 'Registration should succeed');
  const sessionCookie = regRes.setCookie ? regRes.setCookie[0].split(';')[0] : '';
  const userId = regRes.body.user.id;
  console.log('✓ Registered test user:', userId);

  // Test 2: Upload valid PNG image
  // Minimal valid 1x1 PNG
  const samplePng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d450000000049454e44ae426082', 'hex');

  const uploadRes = await makeMultipartRequest('http://127.0.0.1:4000/api/auth/profile-image', {}, {
    name: 'avatar',
    filename: 'test-avatar.png',
    contentType: 'image/png',
    buffer: samplePng,
  }, sessionCookie);

  assert.strictEqual(uploadRes.status, 200, 'Upload should succeed with 200');
  assert.strictEqual(uploadRes.body.success, true, 'Upload response should be success');
  assert.ok(uploadRes.body.profileImageUrl.includes('/uploads/avatar-'), 'Should return valid avatar URL');
  console.log('✓ Test 2 Passed: Profile image uploaded successfully, returned URL:', uploadRes.body.profileImageUrl);

  // Verify in DB
  const [rows] = await pool.execute('SELECT profile_image_url FROM users WHERE id = ?', [userId]);
  assert.strictEqual(rows[0].profile_image_url, uploadRes.body.profileImageUrl, 'Database record should match uploaded URL');
  console.log('✓ Test 3 Passed: Database verified with new avatar URL');

  console.log('--- ALL AVATAR UPLOAD TESTS PASSED ---');
  process.exit(0);
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
