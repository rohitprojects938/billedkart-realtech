const http = require('http');

const API_HOST = '127.0.0.1';
const API_PORT = 4000;

function request(method, path, data = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, data: parsed, cookies: setCookie });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('=== Billedkart Realtech Phone Auth Backend Test Suite ===\n');

  // Test 1: Phone check for non-existent number
  const testPhone = '98765' + Math.floor(10000 + Math.random() * 90000);
  console.log(`[Test 1] POST /api/auth/phone/check for new number: ${testPhone}`);
  const chk1 = await request('POST', '/api/auth/phone/check', { phone: testPhone });
  console.log('Status:', chk1.status, 'Response:', chk1.data);
  if (chk1.status !== 200 || chk1.data.exists !== false) {
    throw new Error('Test 1 failed: Expected exists: false');
  }

  // Test 2: Register user with phone, NO email (optional email requirement)
  const testUser = `user_${Date.now().toString().slice(-6)}`;
  console.log(`\n[Test 2] POST /api/auth/register with phone and NO email (optional email)`);
  const reg1 = await request('POST', '/api/auth/register', {
    full_name: 'Test Mobile User',
    username: testUser,
    phone: testPhone,
    password: 'Password123!',
  });
  console.log('Status:', reg1.status, 'Response:', reg1.data);
  if (reg1.status !== 201 || !reg1.data.success || reg1.data.user.email !== null) {
    throw new Error('Test 2 failed: User registration without email should succeed with email: null');
  }
  const userCookie = reg1.cookies ? reg1.cookies[0] : null;

  // Test 3: Verify session works for user with no email
  console.log(`\n[Test 3] GET /api/auth/me using created session`);
  const me = await request('GET', '/api/auth/me', null, userCookie);
  console.log('Status:', me.status, 'Response:', me.data);
  if (me.status !== 200 || !me.data.authenticated || me.data.user.phone !== `+91${testPhone}`) {
    throw new Error('Test 3 failed: Session not authenticated with normalized phone');
  }

  // Test 4: Phone check now reports exists: true
  console.log(`\n[Test 4] POST /api/auth/phone/check for now-registered number`);
  const chk2 = await request('POST', '/api/auth/phone/check', { phone: testPhone });
  console.log('Status:', chk2.status, 'Response:', chk2.data);
  if (chk2.status !== 200 || chk2.data.exists !== true) {
    throw new Error('Test 4 failed: Expected exists: true');
  }

  // Test 5: Prevent duplicate registration with same phone
  console.log(`\n[Test 5] POST /api/auth/register with duplicate phone should fail`);
  const dupReg = await request('POST', '/api/auth/register', {
    full_name: 'Another User',
    username: `${testUser}_dup`,
    phone: testPhone,
    password: 'Password123!',
  });
  console.log('Status:', dupReg.status, 'Response:', dupReg.data);
  if (dupReg.status !== 409) {
    throw new Error('Test 5 failed: Duplicate phone registration must return 409 conflict');
  }

  // Test 6: Login using phone number as identifier
  console.log(`\n[Test 6] POST /api/auth/login using phone number + password`);
  const loginRes = await request('POST', '/api/auth/login', {
    identifier: testPhone,
    password: 'Password123!',
  });
  console.log('Status:', loginRes.status, 'Response:', loginRes.data);
  if (loginRes.status !== 200 || !loginRes.data.success) {
    throw new Error('Test 6 failed: Mobile number login failed');
  }

  // Test 7: Phone verify rejects fake or expired token securely
  console.log(`\n[Test 7] POST /api/auth/phone/verify rejects bogus token`);
  const fakeVerify = await request('POST', '/api/auth/phone/verify', {
    id_token: 'bogus.jwt.token'
  });
  console.log('Status:', fakeVerify.status, 'Response:', fakeVerify.data);
  if (fakeVerify.status !== 401) {
    throw new Error('Test 7 failed: Bogus token should be rejected with 401');
  }

  console.log('\n=== ALL 7 BACKEND PHONE AUTH TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('\n[TEST FAILED]', err);
  process.exit(1);
});
