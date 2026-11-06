'use strict';
/**
 * firebase.js — Firebase Admin SDK Integration & Fallback Token Verifier
 * 
 * Verifies Firebase Phone Authentication ID tokens securely on the server.
 * Never trusts client claims without cryptographic verification.
 */
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
let admin = null;

try {
  admin = require('firebase-admin');
} catch (e) {
  console.warn('[firebase] firebase-admin package not available, using cryptographic fallback.');
}

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'realstate-342f7';
let firebaseApp = null;

function initFirebase() {
  if (!admin) return null;
  if (admin.apps && admin.apps.length > 0) {
    return admin.apps[0];
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    try {
      let certObj;
      if (fs.existsSync(serviceAccountKey)) {
        certObj = JSON.parse(fs.readFileSync(serviceAccountKey, 'utf8'));
      } else {
        certObj = JSON.parse(serviceAccountKey);
      }
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(certObj),
        projectId: FIREBASE_PROJECT_ID,
      });
      console.log('[firebase] Initialized with Service Account Key for project:', FIREBASE_PROJECT_ID);
      return firebaseApp;
    } catch (err) {
      console.warn('[firebase] Could not parse FIREBASE_SERVICE_ACCOUNT_KEY:', err.message);
    }
  }

  try {
    firebaseApp = admin.initializeApp({
      projectId: FIREBASE_PROJECT_ID,
    });
    console.log('[firebase] Initialized Firebase Admin for project:', FIREBASE_PROJECT_ID);
    return firebaseApp;
  } catch (err) {
    console.warn('[firebase] Admin initialize fallback:', err.message);
    return null;
  }
}

initFirebase();

// Cache for Google's public x509 certs for securetoken
let certsCache = null;
let certsCacheExpiry = 0;

function fetchGooglePublicKeys() {
  return new Promise((resolve, reject) => {
    if (certsCache && Date.now() < certsCacheExpiry) {
      return resolve(certsCache);
    }

    https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const certs = JSON.parse(data);
          const cacheControl = res.headers['cache-control'] || '';
          const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
          const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
          certsCache = certs;
          certsCacheExpiry = Date.now() + (maxAge * 1000);
          resolve(certs);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Normalizes input phone to standard E.164 format.
 * Defaults 10-digit Indian numbers to +91.
 */
function normalizePhoneNumber(rawPhone) {
  if (typeof rawPhone !== 'string') return '';
  let cleaned = rawPhone.trim().replace(/[\s\-\(\)]/g, '');
  if (!cleaned) return '';

  // 10 digits starting with 6, 7, 8, 9 -> Indian mobile
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  // 0 followed by 10 digits
  if (/^0[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned.slice(1)}`;
  }
  // 91 followed by 10 digits
  if (/^91[6-9]\d{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  // Already in E.164 format
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return cleaned;
  }

  return cleaned;
}

/**
 * Validates E.164 format
 */
function isValidE164(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

/**
 * Verifies a Firebase ID token using Firebase Admin SDK with cryptographic public-key fallback.
 * @param {string} idToken 
 * @returns {Promise<{ uid: string, phone_number: string, email?: string, name?: string }>}
 */
async function verifyFirebaseToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Firebase ID token is required.');
  }

  // Method 1: Firebase Admin SDK
  if (admin && admin.apps && admin.apps.length > 0) {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        phone_number: decoded.phone_number || null,
        email: decoded.email || null,
        name: decoded.name || null,
        firebase: decoded.firebase || null,
      };
    } catch (adminErr) {
      // If service account is missing or credential error, fall through to public cert verifier
      if (!adminErr.message.includes('credential') && !adminErr.message.includes('auth/')) {
        throw adminErr;
      }
    }
  }

  // Method 2: Native Google Public x509 Cert Verification (RFC 7519 / OIDC)
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT token.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported token algorithm: ${header.alg}`);
  }

  const expectedIss = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
  if (payload.iss !== expectedIss) {
    throw new Error(`Invalid token issuer: ${payload.iss} (expected ${expectedIss})`);
  }

  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new Error(`Invalid token audience: ${payload.aud} (expected ${FIREBASE_PROJECT_ID})`);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSeconds) {
    throw new Error('Firebase ID token has expired.');
  }

  if (payload.auth_time && payload.auth_time > nowSeconds + 300) {
    throw new Error('Invalid token auth_time in the future.');
  }

  const kid = header.kid;
  const publicCerts = await fetchGooglePublicKeys();
  const cert = publicCerts[kid];

  if (!cert) {
    throw new Error('Unknown signing key ID (kid) in Firebase token.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const isSigValid = verifier.verify(cert, Buffer.from(signatureB64, 'base64url'));

  if (!isSigValid) {
    throw new Error('Firebase ID token signature verification failed.');
  }

  return {
    uid: payload.sub,
    phone_number: payload.phone_number || null,
    email: payload.email || null,
    name: payload.name || null,
    firebase: payload.firebase || null,
  };
}

module.exports = {
  verifyFirebaseToken,
  normalizePhoneNumber,
  isValidE164,
  FIREBASE_PROJECT_ID,
};
