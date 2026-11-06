'use strict';
/**
 * auth.js — Billedkart Realtech Authentication Router & Service
 * 
 * Implements:
 *   - Email/Username + Password Registration & Login
 *   - Google Sign-In (OAuth 2.0 / OpenID Connect + Google One Tap ID token verification)
 *   - Email OTP Login & Password Recovery
 *   - Server-side Session Management & Logout
 *   - Safe User Profiles (never exposing passwords, tokens, or hashes)
 */
require('dotenv').config();
const crypto        = require('crypto');
const express       = require('express');
const bcrypt        = require('bcryptjs');
const rateLimit     = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const { pool }      = require('./db');
const { sendOtpEmail } = require('./email');
const { verifyFirebaseToken, normalizePhoneNumber, isValidE164 } = require('./firebase');

const router = express.Router();

/* ---------------------------------------------------------------
   Environment & Configuration
--------------------------------------------------------------- */
function getGoogleConfig() {
  const clientId     = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const callbackUrl  = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/api/auth/google/callback';
  const frontendUrl  = process.env.FRONTEND_URL || 'http://127.0.0.1:5500/home_property_discovery/code.html';
  const client       = (clientId && clientSecret) ? new OAuth2Client(clientId, clientSecret, callbackUrl) : null;
  return { clientId, clientSecret, callbackUrl, frontendUrl, client };
}

const STATE_SECRET = process.env.SESSION_SECRET || 'vastu-oauth-state-secret-2026';

function createOAuthState(returnTo) {
  const { frontendUrl } = getGoogleConfig();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({
    nonce,
    returnTo: returnTo || frontendUrl,
    ts: Date.now()
  });
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

function verifyOAuthState(state) {
  if (!state || typeof state !== 'string' || !state.includes('.')) return null;
  const [b64, sig] = state.split('.');
  try {
    const payload = Buffer.from(b64, 'base64url').toString('utf8');
    const expectedSig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('base64url');
    if (sig !== expectedSig) return null;
    const data = JSON.parse(payload);
    if (Date.now() - data.ts > 15 * 60 * 1000) return null; // 15 min expiry
    return data;
  } catch (e) {
    return null;
  }
}

// In-memory exchange tickets for cross-origin / cross-host session sync
const authExchangeTickets = new Map(); // token -> { userId, expiresAt }
setInterval(() => {
  const now = Date.now();
  for (const [t, d] of authExchangeTickets.entries()) {
    if (d.expiresAt < now) authExchangeTickets.delete(t);
  }
}, 5 * 60 * 1000);

async function syncSessionLocation(userId, oldSessionId) {
  if (!userId || !oldSessionId) return;
  try {
    await pool.query(
      'UPDATE user_saved_locations SET user_id = ? WHERE session_id = ? AND user_id IS NULL',
      [userId, oldSessionId]
    );
  } catch (err) {
    console.error('[auth:syncSessionLocation]', err.message);
  }
}

/* ---------------------------------------------------------------
   Rate Limiters
--------------------------------------------------------------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 failed login attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many sign-in attempts. Please try again after 15 minutes.' },
  skipSuccessfulRequests: true,
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // max 5 OTP requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
});

const reportIssueLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // max 10 failure reports per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many failure reports. Please wait a few minutes before trying again.' },
});

/* ---------------------------------------------------------------
   Helpers
--------------------------------------------------------------- */
function sanitizeErrorDetail(str, maxLen = 255) {
  if (typeof str !== 'string') return null;
  const clean = str.trim()
    .replace(/[<>]/g, '')
    .replace(/(password|secret|bearer\s+[a-zA-Z0-9._-]+|id_token=[^\s&]+|code=[^\s&]+)/gi, '[REDACTED]');
  return clean.slice(0, maxLen);
}

function sanitizeIdentifier(str) {
  if (typeof str !== 'string') return null;
  const clean = str.trim().replace(/[^\w@.+ -]/g, '').slice(0, 120);
  return clean || null;
}

function sanitizeUserMessage(str) {
  if (typeof str !== 'string') return null;
  const clean = str.trim().replace(/[<>]/g, '').slice(0, 1000);
  return clean || null;
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function normalizeUsername(username) {
  if (typeof username !== 'string') return '';
  return username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[a-zA-Z]/.test(password)) {
    return 'Password must contain at least one letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number.';
  }
  return null;
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function safeUser(u) {
  return {
    id: u.id,
    fullName: u.full_name,
    username: u.username,
    email: u.email || null,
    isEmailVerified: Boolean(u.is_email_verified),
    phone: u.phone || null,
    isPhoneVerified: Boolean(u.is_phone_verified),
    profileImageUrl: u.profile_image_url || null,
    role: u.role || 'user',
    status: u.status || 'active',
    createdAt: u.created_at,
  };
}

/* ---------------------------------------------------------------
   1. POST /api/auth/register
   Full Name, Unique Username, Phone (Compulsory), Optional Email, Password
--------------------------------------------------------------- */
router.post('/register', async (req, res) => {
  try {
    const { full_name, username, email, phone, password, confirm_password } = req.body || {};

    const fullName = (typeof full_name === 'string' ? full_name.trim() : '');
    const cleanUser = normalizeUsername(username);
    const cleanPhone = normalizePhoneNumber(phone || '');
    const cleanMail = (typeof email === 'string' && email.trim()) ? normalizeEmail(email) : null;

    if (!fullName || fullName.length < 2) {
      return res.status(400).json({ success: false, error: 'Please enter your full name (at least 2 characters).' });
    }
    if (!cleanUser || cleanUser.length < 3 || cleanUser.length > 30) {
      return res.status(400).json({ success: false, error: 'Username must be between 3 and 30 characters (letters, numbers, underscores, dots).' });
    }
    if (!cleanPhone || !isValidE164(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number (e.g. 9876543210).' });
    }
    if (cleanMail && !isValidEmail(cleanMail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address or leave it blank.' });
    }

    const pwdErr = validatePasswordStrength(password);
    if (pwdErr) {
      return res.status(400).json({ success: false, error: pwdErr });
    }
    if (confirm_password !== undefined && password !== confirm_password) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }

    // Check uniqueness of username and phone
    const [existing] = await pool.execute(
      `SELECT id, username, email, phone FROM users WHERE username = ? OR phone = ? OR (email IS NOT NULL AND email = ?) LIMIT 1`,
      [cleanUser, cleanPhone, cleanMail || '']
    );

    if (existing.length > 0) {
      const match = existing[0];
      if (match.username.toLowerCase() === cleanUser) {
        return res.status(409).json({ success: false, error: 'This username is already taken. Please choose another.' });
      }
      if (match.phone && match.phone === cleanPhone) {
        return res.status(409).json({ success: false, error: 'An account with this mobile number already exists. Please sign in.' });
      }
      if (cleanMail && match.email && match.email.toLowerCase() === cleanMail) {
        return res.status(409).json({ success: false, error: 'An account with this email already exists. Please sign in or use another email.' });
      }
    }

    // Hash password with bcrypt cost factor 12
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert user with optional email and mandatory phone
    const [result] = await pool.execute(
      `INSERT INTO users (full_name, username, email, phone, password_hash, is_email_verified, is_phone_verified)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [fullName, cleanUser, cleanMail, cleanPhone, passwordHash]
    );

    const [newUsers] = await pool.execute(`SELECT * FROM users WHERE id = ?`, [result.insertId]);
    const user = newUsers[0];

    const oldSessionId = req.sessionID;
    // Session regeneration to prevent session fixation
    req.session.regenerate((err) => {
      if (err) console.error('[session regenerate]', err);
      req.session.userId = user.id;
      if (oldSessionId) syncSessionLocation(user.id, oldSessionId);
      req.session.save((saveErr) => {
        if (saveErr) console.error('[session save error]', saveErr);
        res.status(201).json({
          success: true,
          message: 'Account created successfully!',
          user: safeUser(user),
        });
      });
    });

  } catch (err) {
    console.error('[POST /api/auth/register]', err);
    res.status(500).json({ success: false, error: 'Failed to create account. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   2. POST /api/auth/login
   Login with Mobile Number, Username or Email + Password
--------------------------------------------------------------- */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body || {};
    const rawLogin = req.body?.identifier || req.body?.login || req.body?.username || req.body?.email || req.body?.phone;

    if (!rawLogin || typeof rawLogin !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Please enter your mobile number/username/email and password.' });
    }

    const cleanLogin = rawLogin.trim().toLowerCase();
    const phoneCandidate = normalizePhoneNumber(cleanLogin);

    // Query user by phone, email or username
    const [users] = await pool.execute(
      `SELECT * FROM users WHERE phone = ? OR email = ? OR username = ? LIMIT 1`,
      [phoneCandidate || cleanLogin, cleanLogin, cleanLogin]
    );

    // Generic error to prevent account enumeration
    if (users.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid mobile number/username or password.' });
    }

    const user = users[0];

    // Check if account has a password or was OAuth-only
    if (!user.password_hash) {
      return res.status(400).json({
        success: false,
        error: 'This account was registered using Phone OTP or Google Sign-In. Please sign in with OTP or Google.'
      });
    }

    // Verify password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid mobile number/username or password.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Your account has been deactivated or suspended. Please contact support.' });
    }

    // Update last login timestamp
    await pool.execute(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);

    const oldSessionId = req.sessionID;
    // Regenerate session to prevent fixation
    req.session.regenerate((err) => {
      if (err) console.error('[session regenerate]', err);
      req.session.userId = user.id;
      if (oldSessionId) syncSessionLocation(user.id, oldSessionId);
      req.session.save((saveErr) => {
        if (saveErr) console.error('[session save error]', saveErr);
        res.json({
          success: true,
          message: 'Signed in successfully!',
          user: safeUser(user),
        });
      });
    });

  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    res.status(500).json({ success: false, error: 'Unable to sign in. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   POST /api/auth/phone/check
   Checks if a mobile number is already registered in Billedkart Realtech
--------------------------------------------------------------- */
router.post('/phone/check', async (req, res) => {
  try {
    const { phone } = req.body || {};
    const cleanPhone = normalizePhoneNumber(phone || '');
    if (!cleanPhone || !isValidE164(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number.' });
    }

    const [rows] = await pool.execute(
      `SELECT id, full_name, username FROM users WHERE phone = ? LIMIT 1`,
      [cleanPhone]
    );

    res.json({
      success: true,
      exists: rows.length > 0,
      phone: cleanPhone,
    });
  } catch (err) {
    console.error('[POST /api/auth/phone/check]', err);
    res.status(500).json({ success: false, error: 'Failed to verify phone number status.' });
  }
});

/* ---------------------------------------------------------------
   POST /api/auth/phone/verify
   Verifies Firebase Phone Auth ID token and establishes safe session
--------------------------------------------------------------- */
router.post('/phone/verify', loginLimiter, async (req, res) => {
  try {
    const { id_token, idToken, full_name, username, email } = req.body || {};
    const token = id_token || idToken;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'Firebase authentication token is required.' });
    }

    // Cryptographically verify Firebase ID token
    let decoded;
    try {
      decoded = await verifyFirebaseToken(token);
    } catch (verErr) {
      console.warn('[Firebase Auth Verification Error]', verErr.message);
      return res.status(401).json({ success: false, error: 'Phone verification token is invalid or has expired. Please request a new OTP.' });
    }

    const firebaseUid = decoded.uid;
    const verifiedPhone = decoded.phone_number;

    if (!verifiedPhone) {
      return res.status(400).json({ success: false, error: 'Firebase token does not contain a verified phone number.' });
    }

    const cleanPhone = normalizePhoneNumber(verifiedPhone);

    // 1. Look up by external identity (provider = 'firebase_phone', provider_user_id = firebaseUid)
    const [extRows] = await pool.execute(
      `SELECT user_id FROM external_identities WHERE provider = 'firebase_phone' AND provider_user_id = ? LIMIT 1`,
      [firebaseUid]
    );

    let user;

    if (extRows.length > 0) {
      const [u] = await pool.execute(`SELECT * FROM users WHERE id = ? LIMIT 1`, [extRows[0].user_id]);
      if (u.length === 0) {
        return res.status(404).json({ success: false, error: 'User account not found.' });
      }
      user = u[0];

      if (user.status !== 'active') {
        return res.status(403).json({ success: false, error: 'Your account has been deactivated or suspended.' });
      }

      await pool.execute(
        `UPDATE users SET last_login_at = NOW(), is_phone_verified = 1, phone_verified_at = IFNULL(phone_verified_at, NOW()) WHERE id = ?`,
        [user.id]
      );
    } else {
      // 2. Check if user exists with matching phone number
      const [userRows] = await pool.execute(
        `SELECT * FROM users WHERE phone = ? LIMIT 1`,
        [cleanPhone]
      );

      if (userRows.length > 0) {
        user = userRows[0];
        if (user.status !== 'active') {
          return res.status(403).json({ success: false, error: 'Your account has been deactivated or suspended.' });
        }

        // Link Firebase Phone external identity
        await pool.execute(
          `INSERT INTO external_identities (user_id, provider, provider_user_id, provider_email)
           VALUES (?, 'firebase_phone', ?, ?)`,
          [user.id, firebaseUid, cleanPhone]
        );

        await pool.execute(
          `UPDATE users SET is_phone_verified = 1, phone_verified_at = IFNULL(phone_verified_at, NOW()), last_login_at = NOW() WHERE id = ?`,
          [user.id]
        );
      } else {
        // 3. New user registration from verified phone number
        const cleanMail = (typeof email === 'string' && email.trim()) ? normalizeEmail(email) : null;
        if (cleanMail) {
          if (!isValidEmail(cleanMail)) {
            return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
          }
          const [existMail] = await pool.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [cleanMail]);
          if (existMail.length > 0) {
            return res.status(409).json({ success: false, error: 'An account with this email already exists. Please sign in.' });
          }
        }

        let cleanUser = (typeof username === 'string' && username.trim()) ? normalizeUsername(username) : '';
        if (cleanUser) {
          const [existUser] = await pool.execute(`SELECT id FROM users WHERE username = ? LIMIT 1`, [cleanUser]);
          if (existUser.length > 0) {
            cleanUser = `${cleanUser}_${crypto.randomInt(100, 999)}`.slice(0, 30);
          }
        } else {
          const phoneSuffix = cleanPhone.replace(/[^0-9]/g, '').slice(-6);
          cleanUser = `user_${phoneSuffix}`;
          const [existUser] = await pool.execute(`SELECT id FROM users WHERE username = ? LIMIT 1`, [cleanUser]);
          if (existUser.length > 0) {
            cleanUser = `user_${phoneSuffix}_${crypto.randomInt(10, 99)}`.slice(0, 30);
          }
        }

        const fullName = (typeof full_name === 'string' && full_name.trim()) 
          ? full_name.trim().slice(0, 120) 
          : `User ${cleanPhone.slice(-4)}`;

        let pwdHash = null;
        if (typeof req.body?.password === 'string' && req.body.password.length >= 8) {
          pwdHash = await bcrypt.hash(req.body.password, 12);
        }

        const [insertRes] = await pool.execute(
          `INSERT INTO users (full_name, username, email, phone, password_hash, is_phone_verified, phone_verified_at, is_email_verified)
           VALUES (?, ?, ?, ?, ?, 1, NOW(), ?)`,
          [fullName, cleanUser, cleanMail, cleanPhone, pwdHash, cleanMail ? 0 : 0]
        );

        const newUserId = insertRes.insertId;

        await pool.execute(
          `INSERT INTO external_identities (user_id, provider, provider_user_id, provider_email)
           VALUES (?, 'firebase_phone', ?, ?)`,
          [newUserId, firebaseUid, cleanPhone]
        );

        const [created] = await pool.execute(`SELECT * FROM users WHERE id = ?`, [newUserId]);
        user = created[0];
      }
    }

    // Regenerate session to prevent session fixation and establish authenticated state
    req.session.regenerate((err) => {
      if (err) console.error('[session regenerate]', err);
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) console.error('[session save error]', saveErr);
        res.json({
          success: true,
          message: 'Signed in successfully via mobile verification!',
          user: safeUser(user),
        });
      });
    });

  } catch (err) {
    console.error('[POST /api/auth/phone/verify]', err);
    res.status(500).json({ success: false, error: 'Phone verification failed. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   3. POST /api/auth/logout
   Invalidates server-side session and clears cookie
--------------------------------------------------------------- */
router.post('/logout', (req, res) => {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  };
  if (req.session) {
    req.session.destroy((err) => {
      if (err) console.error('[logout session destroy]', err);
      res.clearCookie('vastu_sid', cookieOptions);
      res.json({ success: true, message: 'Logged out successfully.' });
    });
  } else {
    res.clearCookie('vastu_sid', cookieOptions);
    res.json({ success: true, message: 'Logged out successfully.' });
  }
});

/* ---------------------------------------------------------------
   4. GET /api/auth/me
   Retrieves currently authenticated session user
--------------------------------------------------------------- */
router.get('/me', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const userId = req.session ? req.session.userId : null;
    if (!userId) {
      return res.json({ success: true, authenticated: false, user: null });
    }

    const [users] = await pool.execute(`SELECT * FROM users WHERE id = ? LIMIT 1`, [userId]);
    if (users.length === 0 || users[0].status !== 'active') {
      if (req.session) req.session.destroy(() => {});
      res.clearCookie('vastu_sid', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
      return res.json({ success: true, authenticated: false, user: null });
    }

    res.json({
      success: true,
      authenticated: true,
      user: safeUser(users[0]),
    });
  } catch (err) {
    console.error('[GET /api/auth/me]', err);
    res.status(500).json({ success: false, error: 'Failed to verify session.' });
  }
});

/* ---------------------------------------------------------------
   5. POST /api/auth/otp/request
   Generate and send single-use 6-digit OTP
--------------------------------------------------------------- */
router.post('/otp/request', otpLimiter, async (req, res) => {
  try {
    const { email, purpose } = req.body || {};
    const cleanMail = normalizeEmail(email);
    const validPurposes = ['login', 'password_reset', 'email_verify'];

    if (!isValidEmail(cleanMail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }
    const cleanPurpose = validPurposes.includes(purpose) ? purpose : 'login';

    // If password_reset, verify user exists (silently succeed if not to prevent enumeration)
    if (cleanPurpose === 'password_reset') {
      const [users] = await pool.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [cleanMail]);
      if (users.length === 0) {
        // Return generic success to avoid email enumeration
        return res.json({
          success: true,
          message: 'If an account is associated with this email, a 6-digit verification code has been sent.',
        });
      }
    }

    // Generate cryptographically secure 6-digit OTP
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const hashed = hashOtp(rawOtp);

    // Invalidate previous active OTPs for this email and purpose
    await pool.execute(
      `UPDATE otp_codes SET consumed_at = NOW() WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
      [cleanMail, cleanPurpose]
    );

    // Insert new OTP with 5-minute expiry
    await pool.execute(
      `INSERT INTO otp_codes (email, otp_hash, purpose, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
      [cleanMail, hashed, cleanPurpose]
    );

    // Send email
    await sendOtpEmail(cleanMail, rawOtp, cleanPurpose);

    res.json({
      success: true,
      message: 'A 6-digit verification code has been sent to your email. It will expire in 5 minutes.',
    });
  } catch (err) {
    console.error('[POST /api/auth/otp/request]', err);
    res.status(500).json({ success: false, error: 'Unable to send verification code. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   6. POST /api/auth/otp/verify
   Verify single-use OTP for login or password reset
--------------------------------------------------------------- */
router.post('/otp/verify', async (req, res) => {
  try {
    const { email, otp, purpose } = req.body || {};
    const cleanMail = normalizeEmail(email);
    const cleanOtp  = String(otp || '').trim();
    const cleanPurpose = ['login', 'password_reset', 'email_verify'].includes(purpose) ? purpose : 'login';

    if (!isValidEmail(cleanMail) || !/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 6-digit verification code.' });
    }

    // Query active unconsumed OTP
    const [rows] = await pool.execute(
      `SELECT * FROM otp_codes
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [cleanMail, cleanPurpose]
    );

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Verification code has expired or is invalid. Please request a new one.' });
    }

    const otpRecord = rows[0];

    // Check attempts limit (max 5)
    if (otpRecord.attempts >= 5) {
      await pool.execute(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?`, [otpRecord.id]);
      return res.status(400).json({ success: false, error: 'Too many incorrect attempts. This code is now invalid. Please request a new code.' });
    }

    // Compare hash
    const submittedHash = hashOtp(cleanOtp);
    if (submittedHash !== otpRecord.otp_hash) {
      await pool.execute(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`, [otpRecord.id]);
      const remaining = 4 - otpRecord.attempts;
      return res.status(400).json({
        success: false,
        error: `Incorrect code. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'Code invalidated.'}`
      });
    }

    // Consume OTP (single use)
    await pool.execute(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?`, [otpRecord.id]);

    // PURPOSE: LOGIN
    if (cleanPurpose === 'login') {
      let [users] = await pool.execute(`SELECT * FROM users WHERE email = ? LIMIT 1`, [cleanMail]);
      let user;

      if (users.length === 0) {
        // Create user from email OTP
        const usernameBase = cleanMail.split('@')[0].replace(/[^a-z0-9_.-]/g, '');
        const randomSuffix = crypto.randomInt(100, 999);
        const username = `${usernameBase}${randomSuffix}`.slice(0, 30);
        const fullName = usernameBase.charAt(0).toUpperCase() + usernameBase.slice(1);

        const [insertRes] = await pool.execute(
          `INSERT INTO users (full_name, username, email, is_email_verified, email_verified_at)
           VALUES (?, ?, ?, 1, NOW())`,
          [fullName, username, cleanMail]
        );
        const [created] = await pool.execute(`SELECT * FROM users WHERE id = ?`, [insertRes.insertId]);
        user = created[0];
      } else {
        user = users[0];
        await pool.execute(
          `UPDATE users SET is_email_verified = 1, email_verified_at = IFNULL(email_verified_at, NOW()), last_login_at = NOW() WHERE id = ?`,
          [user.id]
        );
      }

      req.session.regenerate((err) => {
        if (err) console.error('[session regenerate]', err);
        req.session.userId = user.id;
        req.session.save((saveErr) => {
          if (saveErr) console.error('[session save error]', saveErr);
          res.json({
            success: true,
            message: 'Signed in successfully via email verification!',
            user: safeUser(user),
          });
        });
      });
      return;
    }

    // PURPOSE: PASSWORD_RESET
    if (cleanPurpose === 'password_reset') {
      // Issue a cryptographically secure 15-minute reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      req.session.passwordReset = {
        email: cleanMail,
        token: resetToken,
        expiresAt: Date.now() + 15 * 60 * 1000,
      };

      return res.json({
        success: true,
        verified: true,
        resetToken,
        message: 'Code verified. Please set your new password.',
      });
    }

    res.json({ success: true, message: 'Verification successful.' });

  } catch (err) {
    console.error('[POST /api/auth/otp/verify]', err);
    res.status(500).json({ success: false, error: 'Verification failed. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   POST /api/auth/password/forgot
   Convenience endpoint: sends password reset OTP to registered email
--------------------------------------------------------------- */
router.post('/password/forgot', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    const cleanMail = normalizeEmail(email);
    if (!isValidEmail(cleanMail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    const [users] = await pool.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [cleanMail]);
    if (users.length === 0) {
      return res.json({
        success: true,
        message: 'If an account is associated with this email, a 6-digit verification code has been sent.',
      });
    }

    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const hashed = hashOtp(rawOtp);

    await pool.execute(
      `UPDATE otp_codes SET consumed_at = NOW() WHERE email = ? AND purpose = 'password_reset' AND consumed_at IS NULL`,
      [cleanMail]
    );

    await pool.execute(
      `INSERT INTO otp_codes (email, otp_hash, purpose, expires_at)
       VALUES (?, ?, 'password_reset', DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
      [cleanMail, hashed]
    );

    await sendOtpEmail(cleanMail, rawOtp, 'password_reset');

    res.json({
      success: true,
      message: 'A 6-digit recovery code has been sent to your email. It will expire in 5 minutes.',
    });
  } catch (err) {
    console.error('[POST /api/auth/password/forgot]', err);
    res.status(500).json({ success: false, error: 'Unable to process request. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   7. POST /api/auth/password/reset
   Reset password using verified recovery session/token
--------------------------------------------------------------- */
router.post('/password/reset', async (req, res) => {
  try {
    const { email, reset_token, new_password, confirm_password } = req.body || {};
    const cleanMail = normalizeEmail(email);

    const sessionReset = req.session ? req.session.passwordReset : null;
    if (
      !sessionReset ||
      sessionReset.email !== cleanMail ||
      sessionReset.token !== reset_token ||
      sessionReset.expiresAt < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        error: 'Password reset session has expired or is invalid. Please request a new recovery code.'
      });
    }

    const pwdErr = validatePasswordStrength(new_password);
    if (pwdErr) {
      return res.status(400).json({ success: false, error: pwdErr });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }

    // Update password hash
    const passwordHash = await bcrypt.hash(new_password, 12);
    const [result] = await pool.execute(
      `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE email = ?`,
      [passwordHash, cleanMail]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Account not found.' });
    }

    // Invalidate the reset token
    delete req.session.passwordReset;

    // Invalidate existing sessions in sessions table for security
    // Fetch user id
    const [users] = await pool.execute(`SELECT id FROM users WHERE email = ?`, [cleanMail]);
    if (users.length > 0) {
      // Invalidate other sessions
      const targetUserId = users[0].id;
      // Search sessions data column containing userId
      await pool.execute(
        `DELETE FROM sessions WHERE data LIKE ?`,
        [`%"userId":${targetUserId}%`]
      );
    }

    res.json({
      success: true,
      message: 'Password reset successfully! Please sign in with your new password.',
    });
  } catch (err) {
    console.error('[POST /api/auth/password/reset]', err);
    res.status(500).json({ success: false, error: 'Failed to reset password. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   8. GET /api/auth/google
   Initiate Google OAuth 2.0 / OpenID Connect flow
--------------------------------------------------------------- */
router.get('/google', (req, res) => {
  const { clientId, clientSecret, client } = getGoogleConfig();
  if (!clientId || !clientSecret || !client) {
    return res.status(503).json({
      success: false,
      error: 'Google Sign-In is not configured on this server. Please check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env.',
    });
  }

  // Preserve originating URL so user returns directly to the exact page they came from
  const returnTo = req.query.return_to || req.headers.referer;
  const state = createOAuthState(returnTo);

  if (req.session) {
    req.session.oauthState = state;
  }

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  });

  res.redirect(authUrl);
});

/* ---------------------------------------------------------------
   9. GET /api/auth/google/callback
   Handle OAuth 2.0 authorization code exchange and token validation
--------------------------------------------------------------- */
router.get('/google/callback', async (req, res) => {
  const { clientId, client, frontendUrl } = getGoogleConfig();
  const { code, state, error } = req.query;

  // Determine return target early if possible
  const verifiedState = verifyOAuthState(state);
  const returnTarget = verifiedState?.returnTo || frontendUrl;

  // Helper to construct frontend redirect URL with query params
  const buildRedirect = (params) => {
    try {
      const u = new URL(returnTarget, frontendUrl);
      Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
      return u.toString();
    } catch (e) {
      const sep = returnTarget.includes('?') ? '&' : '?';
      const q = new URLSearchParams(params).toString();
      return `${returnTarget}${sep}${q}`;
    }
  };

  try {
    if (error) {
      console.warn('[Google OAuth] User cancelled or error:', error);
      return res.redirect(buildRedirect({ auth_error: 'Google sign-in cancelled.' }));
    }

    if (!code || !state) {
      return res.redirect(buildRedirect({ auth_error: 'Missing authorization parameters.' }));
    }

    // Verify state token either via HMAC signature or session
    const sessionMatch = req.session && req.session.oauthState && req.session.oauthState === state;
    if (!verifiedState && !sessionMatch) {
      return res.redirect(buildRedirect({ auth_error: 'Security check failed (invalid or expired state token).' }));
    }
    if (req.session) delete req.session.oauthState;

    if (!client) {
      return res.redirect(buildRedirect({ auth_error: 'Google client not initialized.' }));
    }

    // Exchange authorization code for tokens
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Verify OpenID Connect ID token
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    const googleSub = payload['sub']; // Stable, immutable Google account ID
    const googleEmail = normalizeEmail(payload['email']);
    const googleName = payload['name'] || 'Google User';
    const googlePicture = payload['picture'] || null;

    if (!googleSub || !googleEmail) {
      return res.redirect(buildRedirect({ auth_error: 'Unable to read Google profile data.' }));
    }

    // 1. Check if external identity is already linked
    const [extRows] = await pool.execute(
      `SELECT user_id FROM external_identities WHERE provider = 'google' AND provider_user_id = ? LIMIT 1`,
      [googleSub]
    );

    let userId;

    if (extRows.length > 0) {
      userId = extRows[0].user_id;
      // Update profile picture if user doesn't have one and touch last login
      await pool.execute(
        `UPDATE users SET last_login_at = NOW(), profile_image_url = IFNULL(profile_image_url, ?) WHERE id = ?`,
        [googlePicture, userId]
      );
    } else {
      // 2. Check if user already exists with matching email
      const [userRows] = await pool.execute(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        [googleEmail]
      );

      if (userRows.length > 0) {
        userId = userRows[0].id;
        // Securely link Google identity
        await pool.execute(
          `INSERT INTO external_identities (user_id, provider, provider_user_id, provider_email)
           VALUES (?, 'google', ?, ?)`,
          [userId, googleSub, googleEmail]
        );
        await pool.execute(
          `UPDATE users SET is_email_verified = 1, last_login_at = NOW(), profile_image_url = IFNULL(profile_image_url, ?) WHERE id = ?`,
          [googlePicture, userId]
        );
      } else {
        // 3. Create new user account from Google profile
        const usernameBase = googleEmail.split('@')[0].replace(/[^a-z0-9_.-]/g, '');
        const randomSuffix = crypto.randomInt(100, 999);
        const username = `${usernameBase}${randomSuffix}`.slice(0, 30);

        const [insertRes] = await pool.execute(
          `INSERT INTO users (full_name, username, email, is_email_verified, email_verified_at, profile_image_url)
           VALUES (?, ?, ?, 1, NOW(), ?)`,
          [googleName, username, googleEmail, googlePicture]
        );

        userId = insertRes.insertId;

        await pool.execute(
          `INSERT INTO external_identities (user_id, provider, provider_user_id, provider_email)
           VALUES (?, 'google', ?, ?)`,
          [userId, googleSub, googleEmail]
        );
      }
    }

    // Generate single-use cross-origin exchange token valid for 2 minutes
    const exchangeToken = crypto.randomBytes(32).toString('hex');
    authExchangeTickets.set(exchangeToken, {
      userId,
      expiresAt: Date.now() + 2 * 60 * 1000
    });

    // Populate session on this server host (e.g. localhost:4000)
    req.session.regenerate((err) => {
      if (err) console.error('[session regenerate]', err);
      req.session.userId = userId;
      req.session.save((saveErr) => {
        if (saveErr) console.error('[session save error]', saveErr);
        res.redirect(buildRedirect({ auth_success: 'google', exchange_token: exchangeToken }));
      });
    });

  } catch (err) {
    console.error('[GET /api/auth/google/callback]', err);
    res.redirect(buildRedirect({ auth_error: 'Google sign-in encountered an error. Please try again.' }));
  }
});

/* ---------------------------------------------------------------
   10. POST /api/auth/google/token
   Google One Tap / Client ID Token direct verification
--------------------------------------------------------------- */
router.post('/google/token', async (req, res) => {
  try {
    const { clientId, client } = getGoogleConfig();
    const { credential } = req.body || {};
    if (!credential || !clientId || !client) {
      return res.status(400).json({
        success: false,
        error: clientId ? 'Credential token is required.' : 'Google Sign-In is not configured in server/.env.'
      });
    }

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    const googleSub = payload['sub'];
    const googleEmail = normalizeEmail(payload['email']);
    const googleName = payload['name'] || 'Google User';
    const googlePicture = payload['picture'] || null;

    if (!googleSub || !googleEmail) {
      return res.status(400).json({ success: false, error: 'Invalid Google identity payload.' });
    }

    // Look up or create identity
    const [extRows] = await pool.execute(
      `SELECT user_id FROM external_identities WHERE provider = 'google' AND provider_user_id = ? LIMIT 1`,
      [googleSub]
    );

    let user;

    if (extRows.length > 0) {
      const [u] = await pool.execute(`SELECT * FROM users WHERE id = ? LIMIT 1`, [extRows[0].user_id]);
      user = u[0];
      await pool.execute(
        `UPDATE users SET last_login_at = NOW(), profile_image_url = IFNULL(profile_image_url, ?) WHERE id = ?`,
        [googlePicture, user.id]
      );
    } else {
      const [u] = await pool.execute(`SELECT * FROM users WHERE email = ? LIMIT 1`, [googleEmail]);
      if (u.length > 0) {
        user = u[0];
        await pool.execute(
          `INSERT INTO external_identities (user_id, provider, provider_user_id, provider_email)
           VALUES (?, 'google', ?, ?)`,
          [user.id, googleSub, googleEmail]
        );
        await pool.execute(
          `UPDATE users SET is_email_verified = 1, last_login_at = NOW(), profile_image_url = IFNULL(profile_image_url, ?) WHERE id = ?`,
          [googlePicture, user.id]
        );
      } else {
        const usernameBase = googleEmail.split('@')[0].replace(/[^a-z0-9_.-]/g, '');
        const randomSuffix = crypto.randomInt(100, 999);
        const username = `${usernameBase}${randomSuffix}`.slice(0, 30);

        const [insertRes] = await pool.execute(
          `INSERT INTO users (full_name, username, email, is_email_verified, email_verified_at, profile_image_url)
           VALUES (?, ?, ?, 1, NOW(), ?)`,
          [googleName, username, googleEmail, googlePicture]
        );

        await pool.execute(
          `INSERT INTO external_identities (user_id, provider, provider_user_id, provider_email)
           VALUES (?, 'google', ?, ?)`,
          [insertRes.insertId, googleSub, googleEmail]
        );

        const [created] = await pool.execute(`SELECT * FROM users WHERE id = ?`, [insertRes.insertId]);
        user = created[0];
      }
    }

    req.session.regenerate((err) => {
      if (err) console.error('[session regenerate]', err);
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) console.error('[session save error]', saveErr);
        res.json({
          success: true,
          message: 'Signed in with Google!',
          user: safeUser(user),
        });
      });
    });

  } catch (err) {
    console.error('[POST /api/auth/google/token]', err);
    res.status(401).json({ success: false, error: 'Google authentication failed. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   11. POST /api/auth/exchange
   Exchanges single-use token for a valid session on the current domain
--------------------------------------------------------------- */
if (process.env.NODE_ENV === 'development') {
  router.post('/dev-exchange-token', async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const exchangeToken = crypto.randomBytes(32).toString('hex');
    authExchangeTickets.set(exchangeToken, {
      userId: Number(userId),
      expiresAt: Date.now() + 2 * 60 * 1000
    });
    res.json({ success: true, exchangeToken });
  });
}

router.post('/exchange', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'Exchange token required.' });
    }

    const ticket = authExchangeTickets.get(token);
    if (!ticket || ticket.expiresAt < Date.now()) {
      if (ticket) authExchangeTickets.delete(token);
      return res.status(400).json({ success: false, error: 'Exchange token has expired or is invalid.' });
    }

    // Single-use token: remove immediately
    authExchangeTickets.delete(token);

    const [users] = await pool.execute(`SELECT * FROM users WHERE id = ? LIMIT 1`, [ticket.userId]);
    if (users.length === 0 || users[0].status !== 'active') {
      return res.status(401).json({ success: false, error: 'User account not active.' });
    }

    const user = users[0];
    req.session.regenerate((err) => {
      if (err) console.error('[session regenerate]', err);
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) console.error('[session save error]', saveErr);
        res.json({
          success: true,
          message: 'Session established successfully!',
          user: safeUser(user)
        });
      });
    });
  } catch (err) {
    console.error('[POST /api/auth/exchange]', err);
    res.status(500).json({ success: false, error: 'Session exchange failed.' });
  }
});

/* ---------------------------------------------------------------
   12. POST /api/auth/report-issue
   Securely records user/client login failure feedback in MySQL
   Input validation, rate limiting, deduplication, and safe logging
--------------------------------------------------------------- */
router.post('/report-issue', reportIssueLimiter, async (req, res) => {
  try {
    const {
      error_category,
      error_code,
      error_message,
      user_identifier,
      user_message,
      client_timestamp
    } = req.body || {};

    if (!error_category || typeof error_category !== 'string' || !error_category.trim()) {
      return res.status(400).json({ success: false, error: 'A valid error category is required.' });
    }

    const cleanCategory = error_category.trim().toLowerCase().slice(0, 64);
    const cleanCode = error_code && typeof error_code === 'string' ? sanitizeErrorDetail(error_code, 64) : null;
    const cleanMsg = error_message && typeof error_message === 'string' ? sanitizeErrorDetail(error_message, 255) : null;
    const cleanIdentifier = user_identifier ? sanitizeIdentifier(user_identifier) : null;
    const cleanUserMsg = user_message ? sanitizeUserMessage(user_message) : null;
    const cleanTs = client_timestamp && typeof client_timestamp === 'string' ? client_timestamp.slice(0, 64) : new Date().toISOString();

    const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'unknown')
      .toString()
      .split(',')[0]
      .trim()
      .slice(0, 45);
    const userAgent = (req.get('user-agent') || 'unknown').slice(0, 255);

    // Duplicate submission protection: within 60 seconds from same IP and category
    const [existingDupes] = await pool.execute(
      `SELECT id FROM login_issues
       WHERE ip_address = ? AND error_category = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 60 SECOND)
       LIMIT 1`,
      [clientIp, cleanCategory]
    );

    if (existingDupes.length > 0) {
      return res.json({
        success: true,
        message: 'Your report has already been received. Thank you for your feedback.',
        duplicate: true
      });
    }

    // Insert record safely (no secrets, passwords, or raw tokens)
    const [result] = await pool.execute(
      `INSERT INTO login_issues
        (error_category, error_code, error_message, user_identifier, user_message, ip_address, user_agent, client_timestamp, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      [cleanCategory, cleanCode, cleanMsg, cleanIdentifier, cleanUserMsg, clientIp, userAgent, cleanTs]
    );

    console.info(`[LOGIN_ISSUE_REPORTED] id=${result.insertId} category=${cleanCategory} ip=${clientIp}`);

    return res.status(201).json({
      success: true,
      message: 'Feedback report submitted successfully. Thank you for your feedback.',
      reportId: result.insertId
    });
  } catch (err) {
    console.error('[POST /api/auth/report-issue error]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to record login issue report.' });
  }
});

/* ---------------------------------------------------------------
   Admin Middleware & Endpoints for Login Failure Reports
--------------------------------------------------------------- */
async function requireAdminAuth(req, res, next) {
  try {
    const userId = req.session ? req.session.userId : null;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required. Please sign in as admin.' });
    }
    const [rows] = await pool.execute('SELECT id, role, status FROM users WHERE id = ? LIMIT 1', [userId]);
    if (rows.length === 0 || rows[0].status !== 'active') {
      return res.status(401).json({ success: false, error: 'Account inactive or invalid.' });
    }
    if (rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Administrator privileges required.' });
    }
    req.adminUser = rows[0];
    next();
  } catch (err) {
    console.error('[requireAdminAuth error]', err.message);
    res.status(500).json({ success: false, error: 'Server authorization check failed.' });
  }
}

// 13. GET /api/auth/admin/login-issues
router.get('/admin/login-issues', requireAdminAuth, async (req, res) => {
  try {
    const { status, limit } = req.query || {};
    const maxLimit = Math.min(Math.max(parseInt(limit || '50', 10), 1), 200);

    let query = 'SELECT id, error_category, error_code, error_message, user_identifier, user_message, ip_address, user_agent, client_timestamp, status, admin_notes, created_at, updated_at FROM login_issues';
    const params = [];

    if (status && ['open', 'investigating', 'resolved'].includes(status)) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(maxLimit);

    const [rows] = await pool.query(query, params);
    res.json({
      success: true,
      count: rows.length,
      issues: rows
    });
  } catch (err) {
    console.error('[GET /api/auth/admin/login-issues error]', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch login issue reports.' });
  }
});

// 14. PATCH /api/auth/admin/login-issues/:id
router.patch('/admin/login-issues/:id', requireAdminAuth, async (req, res) => {
  try {
    const issueId = parseInt(req.params.id, 10);
    if (!issueId || isNaN(issueId)) {
      return res.status(400).json({ success: false, error: 'Invalid issue ID.' });
    }

    const { status, admin_notes } = req.body || {};
    const updates = [];
    const params = [];

    if (status) {
      if (!['open', 'investigating', 'resolved'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status. Must be open, investigating, or resolved.' });
      }
      updates.push('status = ?');
      params.push(status);
    }

    if (admin_notes !== undefined) {
      const notes = typeof admin_notes === 'string' ? admin_notes.trim().slice(0, 1000) : null;
      updates.push('admin_notes = ?');
      params.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update.' });
    }

    params.push(issueId);
    const [result] = await pool.execute(
      `UPDATE login_issues SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Issue record not found.' });
    }

    res.json({ success: true, message: 'Issue report updated successfully.' });
  } catch (err) {
    console.error('[PATCH /api/auth/admin/login-issues/:id error]', err.message);
    res.status(500).json({ success: false, error: 'Failed to update issue report.' });
  }
});

module.exports = router;
