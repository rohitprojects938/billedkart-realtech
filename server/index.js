'use strict';
/**
 * index.js — Billedkart Realtech Reviews API Server
 * Serves: GET /api/reviews, POST /api/reviews, GET /api/reviews/summary
 * Also serves uploaded profile avatars from /uploads/*
 */
const path        = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs          = require('fs');
const http        = require('http');
const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const multer      = require('multer');
const session     = require('express-session');
const MySQLStore  = require('express-mysql-session')(session);
const { v4: uuidv4 } = require('uuid');
const { pool, testConnection } = require('./db');
const authRouter  = require('./auth');
const dealersRouter = require('./dealers');
const buildersRouter = require('./builders');
const propertiesRouter = require('./properties');
const chatRouter = require('./chat');
const { initChatSocket } = require('./chat-socket');

const app  = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

/* ---------------------------------------------------------------
   Trust Proxy Configuration (for reverse proxies, HTTPS, etc.)
--------------------------------------------------------------- */
const trustProxySetting = process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? '1' : false);
if (trustProxySetting) {
  app.set('trust proxy', trustProxySetting === 'true' ? 1 : isNaN(trustProxySetting) ? trustProxySetting : parseInt(trustProxySetting, 10));
}

/* ---------------------------------------------------------------
   CORS
--------------------------------------------------------------- */
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Always allow localhost variants for development
const devOrigins = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:5501',
  'http://localhost:5501',
  'null',          // file:// opened pages send Origin: null
];

app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (e.g. curl, Postman, same-origin server calls)
    if (!origin) return cb(null, true);
    const allowed = [...allowedOrigins, ...devOrigins];
    if (allowed.includes(origin) || process.env.NODE_ENV === 'development') {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Requested-With', 'Accept', 'Origin', 'Pragma'],
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ---------------------------------------------------------------
   Session Management (MySQL Persistent Store)
   Long-lived 180-day persistent sessions by default
--------------------------------------------------------------- */
const SESSION_LIFETIME_DAYS = parseInt(process.env.SESSION_LIFETIME_DAYS || '180', 10);
const SESSION_LIFETIME_MS = SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 60 * 60 * 1000, // 1 hour cleanup
  expiration: SESSION_LIFETIME_MS,          // 180 days default
  createDatabaseTable: false,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, pool);

app.use(session({
  name: 'vastu_sid',
  secret: process.env.SESSION_SECRET || 'vastu-secure-session-secret-key-2026',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Renews session expiry and touches MySQL store on active return visits
  cookie: {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_LIFETIME_MS, // Persistent 180 days cookie
  }
}));

/* ---------------------------------------------------------------
   Authentication & Dealers Routers
--------------------------------------------------------------- */
const { getOfficialContact } = require('./contact-config');

app.get('/api/contact-info', (_req, res) => {
  res.json({
    success: true,
    ...getOfficialContact()
  });
});

app.use('/api/auth', authRouter);
app.use('/api/dealers', dealersRouter);
app.use('/api/builders', buildersRouter);
app.use('/api/properties', propertiesRouter);
app.use('/api/chat', chatRouter);

// Forward /api/admin/login-issues to authRouter's admin handler
app.use('/api/admin/login-issues', (req, res, next) => {
  req.url = `/admin/login-issues${req.url === '/' ? '' : req.url}`;
  authRouter(req, res, next);
});

/* ---------------------------------------------------------------
   Static uploads folder (Persistent Storage)
   Consolidates canonical root uploads/ and legacy server/uploads/
--------------------------------------------------------------- */
const CANONICAL_UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
const LEGACY_SERVER_UPLOAD_DIR = path.resolve(__dirname, 'uploads');
fs.mkdirSync(CANONICAL_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(LEGACY_SERVER_UPLOAD_DIR, { recursive: true });

// Ensure any existing avatar images in either folder are preserved and synced
try {
  const dirs = [LEGACY_SERVER_UPLOAD_DIR, CANONICAL_UPLOAD_DIR];
  for (const srcDir of dirs) {
    if (fs.existsSync(srcDir)) {
      const files = fs.readdirSync(srcDir);
      for (const file of files) {
        const srcFile = path.join(srcDir, file);
        const destFile = path.join(CANONICAL_UPLOAD_DIR, file);
        if (!fs.existsSync(destFile) && fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, destFile);
        }
      }
    }
  }
} catch (e) {
  console.warn('[uploads sync]', e.message);
}

const UPLOAD_DIR = CANONICAL_UPLOAD_DIR;

// Security middleware for uploads
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

  const cleanPath = decodeURI(req.path).replace(/\\/g, '/');

  // Prevent directory listing
  if (cleanPath === '/' || cleanPath === '' || cleanPath.endsWith('/')) {
    return res.status(403).json({ success: false, error: 'Directory browsing is disabled.' });
  }

  // Prevent path traversal
  if (cleanPath.includes('..')) {
    return res.status(403).json({ success: false, error: 'Forbidden.' });
  }

  // Restrict private KYC deeds and legal documents to authenticated users
  if (cleanPath.startsWith('/documents/')) {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, error: 'Authentication required to access property documents.' });
    }
  }

  // Prevent execution of uploaded scripts or dangerous file types
  const ext = path.extname(cleanPath).toLowerCase();
  const dangerousExts = ['.html', '.htm', '.js', '.mjs', '.php', '.exe', '.sh', '.bat', '.cmd', '.py', '.rb', '.pl', '.env', '.sql'];
  if (dangerousExts.includes(ext)) {
    return res.status(403).json({ success: false, error: 'File type not permitted.' });
  }

  next();
});

// Serve uploads from canonical directory, with fallback to legacy server uploads
app.use('/uploads', express.static(CANONICAL_UPLOAD_DIR, { maxAge: '30d', index: false, dotfiles: 'deny' }));
app.use('/uploads', express.static(LEGACY_SERVER_UPLOAD_DIR, { maxAge: '30d', index: false, dotfiles: 'deny' }));

/* ---------------------------------------------------------------
   Avatar URL Helpers
--------------------------------------------------------------- */
function sanitizeImageUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('data:image/svg+xml;base64,PHN2Zy')) {
    return null;
  }
  return trimmed;
}

function formatAvatarUrl(req, url) {
  const clean = sanitizeImageUrl(url);
  if (!clean) return null;
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  const host = req ? (req.get('host') || '127.0.0.1:4000') : '127.0.0.1:4000';
  const protocol = req && req.protocol ? req.protocol : 'http';
  return `${protocol}://${host}${clean.startsWith('/') ? '' : '/'}${clean}`;
}

/* ---------------------------------------------------------------
   Rate limiting (POST /api/reviews only)
--------------------------------------------------------------- */
const reviewLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max:      parseInt(process.env.RATE_LIMIT_MAX        || '10',    10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many review submissions. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

/* ---------------------------------------------------------------
   Multer — profile picture upload
   - Stores to persistent disk with unique UUID filename
   - Validates MIME type and magic bytes
--------------------------------------------------------------- */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES    = parseInt(process.env.UPLOAD_MAX_BYTES || '2097152', 10); // 2 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CANONICAL_UPLOAD_DIR),
  filename:    (_req,  file, cb) => {
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.bin';
    cb(null, `avatar-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, or WebP images are accepted.'));
  },
});

/* ---------------------------------------------------------------
   POST /api/auth/profile-image
   Upload / update profile avatar for authenticated user
--------------------------------------------------------------- */
app.post('/api/auth/profile-image', (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'File size exceeds 2 MB limit.' });
      }
      return res.status(400).json({ success: false, error: err.message || 'File upload error.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const userId = req.session ? req.session.userId : null;
    if (!userId) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(401).json({ success: false, error: 'Please sign in to update your profile photo.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please select an image file to upload.' });
    }

    // Verify magic bytes
    try {
      const fileTypeModule = await import('file-type');
      const fileBuffer = await fs.promises.readFile(req.file.path);
      const detected = await fileTypeModule.fileTypeFromBuffer(fileBuffer);
      if (!detected || !ALLOWED_MIME.has(detected.mime)) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ success: false, error: 'Invalid image file. Only JPEG, PNG, or WebP allowed.' });
      }
    } catch (e) {
      // Continue if detection unavailable
    }

    const host = req.get('host') || '127.0.0.1:4000';
    const protocol = req.protocol || 'http';
    const profileImageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

    await pool.execute(
      `UPDATE users SET profile_image_url = ?, updated_at = NOW() WHERE id = ?`,
      [profileImageUrl, userId]
    );

    // Keep user's published reviews in sync with their latest verified avatar
    await pool.execute(
      `UPDATE reviews SET profile_image_url = ? WHERE user_id = ?`,
      [profileImageUrl, userId]
    );

    const [users] = await pool.execute(`SELECT * FROM users WHERE id = ? LIMIT 1`, [userId]);
    const user = users[0];

    res.json({
      success: true,
      message: 'Profile photo updated successfully!',
      profileImageUrl,
      user: {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        email: user.email,
        profileImageUrl: user.profile_image_url,
      }
    });

  } catch (err) {
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
    console.error('[POST /api/auth/profile-image]', err);
    res.status(500).json({ success: false, error: 'Failed to update profile photo.' });
  }
});

/* ---------------------------------------------------------------
   Helpers
--------------------------------------------------------------- */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(val, maxLen) {
  if (typeof val !== 'string') return null;
  return val.trim().slice(0, maxLen) || null;
}

/* ---------------------------------------------------------------
   Helper: Calculate 30-Day Cooldown Details
--------------------------------------------------------------- */
function calculateCooldown(submittedAtDate) {
  const COOLDOWN_DAYS = 30;
  const submittedAt = new Date(submittedAtDate);
  const nextEligible = new Date(submittedAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const diffMs = nextEligible.getTime() - Date.now();
  const inCooldown = diffMs > 0;
  const daysRemaining = inCooldown ? Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24))) : 0;
  const hoursRemaining = inCooldown ? Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60))) : 0;

  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const formattedDate = nextEligible.toLocaleDateString('en-US', options);
  const remainingStr = daysRemaining > 1 ? `in ${daysRemaining} days` : `in ${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}`;
  const timeStr = `${formattedDate} (${remainingStr})`;

  return {
    inCooldown,
    submittedAt: submittedAt.toISOString(),
    nextEligibleAt: nextEligible.toISOString(),
    daysRemaining,
    hoursRemaining,
    formattedDate,
    formattedTimeString: timeStr,
    message: `You've already submitted a review. You can submit another review after ${timeStr}. You can edit or delete your existing review using the three-dot menu on your review.`
  };
}

/* ---------------------------------------------------------------
   GET /api/reviews/cooldown
   Returns current user's review submission cooldown status
--------------------------------------------------------------- */
app.get('/api/reviews/cooldown', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const currentUserId = req.session && req.session.userId ? req.session.userId : null;
    if (!currentUserId) {
      return res.json({ success: true, authenticated: false, inCooldown: false });
    }

    // Check last submission in review_cooldowns
    const [cdRows] = await pool.execute(
      `SELECT submitted_at FROM review_cooldowns
       WHERE user_id = ?
       ORDER BY submitted_at DESC LIMIT 1`,
      [currentUserId]
    );

    if (cdRows.length === 0) {
      return res.json({ success: true, authenticated: true, inCooldown: false });
    }

    const cdInfo = calculateCooldown(cdRows[0].submitted_at);

    // Also check if user has an active review in reviews table
    // Also check if user has an active review in reviews table
    const [existingRev] = await pool.execute(
      `SELECT id, reviewer_name, rating, review_text, designation, city, profile_image_url, status
       FROM reviews WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [currentUserId]
    );

    res.json({
      success: true,
      authenticated: true,
      ...cdInfo,
      existingReview: existingRev.length > 0 ? {
        ...existingRev[0],
        avatar: formatAvatarUrl(req, existingRev[0].profile_image_url),
        profile_image_url: formatAvatarUrl(req, existingRev[0].profile_image_url),
      } : null,
    });
  } catch (err) {
    console.error('[GET /api/reviews/cooldown]', err);
    res.status(500).json({ success: false, error: 'Unable to check cooldown status.' });
  }
});

/* ---------------------------------------------------------------
   GET /api/reviews
   Returns approved reviews (demo + real) + authenticated owner's reviews.
   Supports: ?limit=N (default 50, max 100) &offset=N (default 0)
--------------------------------------------------------------- */
app.get('/api/reviews', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50',  10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0',   10), 0);
    const currentUserId = req.session && req.session.userId ? req.session.userId : 0;

    const [rows] = await pool.execute(
      `SELECT
         id,
         user_id,
         reviewer_name,
         profile_image_url,
         designation,
         city,
         rating,
         review_text,
         property_context,
         is_guest,
         is_demo,
         status,
         created_at
       FROM reviews
       WHERE status = 'approved' OR (user_id IS NOT NULL AND user_id = ?)
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [currentUserId, limit, offset]
    );

    const reviews = rows.map(r => ({
      id:              r.id,
      name:            escapeHtml(r.reviewer_name),
      avatar:          formatAvatarUrl(req, r.profile_image_url),
      profileImageUrl: formatAvatarUrl(req, r.profile_image_url),
      designation:     r.designation ? escapeHtml(r.designation) : null,
      city:            r.city        ? escapeHtml(r.city)        : null,
      rating:          r.rating,
      text:            escapeHtml(r.review_text),
      tag:             r.property_context ? escapeHtml(r.property_context) : null,
      isGuest:         Boolean(r.is_guest),
      isDemo:          Boolean(r.is_demo),
      isOwner:         Boolean(currentUserId && r.user_id && r.user_id === currentUserId),
      status:          r.status,
      createdAt:       r.created_at,
    }));

    res.json({ success: true, reviews });
  } catch (err) {
    console.error('[GET /api/reviews]', err);
    res.status(500).json({ success: false, error: 'Unable to fetch reviews.' });
  }
});

/* ---------------------------------------------------------------
   GET /api/reviews/summary
   Returns average rating and count of approved reviews.
--------------------------------------------------------------- */
app.get('/api/reviews/summary', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const [rows] = await pool.execute(
      `SELECT
         COUNT(*)          AS total,
         AVG(rating)       AS average,
         SUM(rating = 5)   AS five_star,
         SUM(rating = 4)   AS four_star,
         SUM(rating = 3)   AS three_star,
         SUM(rating = 2)   AS two_star,
         SUM(rating = 1)   AS one_star
       FROM reviews
       WHERE status = 'approved'`
    );

    const row = rows[0];
    res.json({
      success: true,
      total:   parseInt(row.total, 10),
      average: row.average ? parseFloat(parseFloat(row.average).toFixed(1)) : 0,
      distribution: {
        5: parseInt(row.five_star,  10),
        4: parseInt(row.four_star,  10),
        3: parseInt(row.three_star, 10),
        2: parseInt(row.two_star,   10),
        1: parseInt(row.one_star,   10),
      }
    });
  } catch (err) {
    console.error('[GET /api/reviews/summary]', err);
    res.status(500).json({ success: false, error: 'Unable to fetch summary.' });
  }
});

/* ---------------------------------------------------------------
   POST /api/reviews
   Requires authentication. Enforces 30-day cooldown with row lock.
--------------------------------------------------------------- */
app.post('/api/reviews', reviewLimiter, upload.single('profile_image'), async (req, res) => {
  const uploadedFile = req.file;

  function cleanup() {
    if (uploadedFile) {
      fs.unlink(uploadedFile.path, () => {});
    }
  }

  try {
    const currentUserId = req.session && req.session.userId ? req.session.userId : null;
    if (!currentUserId) {
      cleanup();
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in to submit a review.'
      });
    }

    const body = req.body;

    // Validate reviewer_name
    const reviewerName = cleanText(body.reviewer_name, 120);
    if (!reviewerName || reviewerName.length < 2) {
      cleanup();
      return res.status(400).json({ error: 'Reviewer name must be at least 2 characters.' });
    }
    if (/[<>&"']/.test(reviewerName)) {
      cleanup();
      return res.status(400).json({ error: 'Reviewer name contains invalid characters.' });
    }

    // Validate rating
    const rating = parseInt(body.rating, 10);
    if (!rating || rating < 1 || rating > 5) {
      cleanup();
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    // Validate review_text
    const reviewText = cleanText(body.review_text, 1000);
    if (!reviewText || reviewText.length < 10) {
      cleanup();
      return res.status(400).json({ error: 'Review text must be at least 10 characters.' });
    }

    const designation     = cleanText(body.designation,     120);
    const city            = cleanText(body.city,             80);
    const propertyContext = cleanText(body.property_context, 200);

    // Profile image URL
    let profileImageUrl = null;
    if (uploadedFile) {
      const buf = Buffer.alloc(12);
      const fd  = fs.openSync(uploadedFile.path, 'r');
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);

      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const isWebP = buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;

      if (!isJpeg && !isPng && !isWebP) {
        cleanup();
        return res.status(400).json({ error: 'Uploaded file is not a valid image.' });
      }

      const host = req.get('host') || '127.0.0.1:4000';
      const protocol = req.protocol || 'http';
      profileImageUrl = `${protocol}://${host}/uploads/${uploadedFile.filename}`;
    } else if (currentUserId) {
      // Requirement 9: Reuse user's account profile photo if no new image was uploaded
      const [uRows] = await pool.execute(`SELECT profile_image_url FROM users WHERE id = ? LIMIT 1`, [currentUserId]);
      if (uRows.length > 0 && uRows[0].profile_image_url) {
        profileImageUrl = sanitizeImageUrl(uRows[0].profile_image_url);
      }
    }

    // Requirement 4: Never store temporary blob: URLs
    profileImageUrl = sanitizeImageUrl(profileImageUrl);

    // Transaction to safely handle concurrent requests and enforce 30-day cooldown
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Check 30-day cooldown with row lock
      const [cdRows] = await conn.execute(
        `SELECT submitted_at FROM review_cooldowns
         WHERE user_id = ? AND submitted_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE`,
        [currentUserId]
      );

      if (cdRows.length > 0) {
        await conn.rollback();
        cleanup();
        const cdInfo = calculateCooldown(cdRows[0].submitted_at);
        return res.status(429).json({
          success: false,
          cooldown: true,
          nextEligibleAt: cdInfo.nextEligibleAt,
          daysRemaining: cdInfo.daysRemaining,
          error: cdInfo.message
        });
      }

      // Insert review
      const [result] = await conn.execute(
        `INSERT INTO reviews
           (user_id, reviewer_name, profile_image_url, designation, city,
            rating, review_text, property_context, is_guest, is_demo, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending')`,
        [
          currentUserId, reviewerName, profileImageUrl, designation, city,
          rating, reviewText, propertyContext,
        ]
      );

      // Record submission in review_cooldowns
      await conn.execute(
        `INSERT INTO review_cooldowns (user_id, submitted_at) VALUES (?, NOW())`,
        [currentUserId]
      );

      // If review included an avatar and user profile has none, sync it as user avatar
      if (profileImageUrl && currentUserId) {
        await conn.execute(
          `UPDATE users SET profile_image_url = IFNULL(profile_image_url, ?) WHERE id = ?`,
          [profileImageUrl, currentUserId]
        );
      }

      await conn.commit();

      res.status(201).json({
        success: true,
        id:      result.insertId,
        status:  'pending',
        profileImageUrl: formatAvatarUrl(req, profileImageUrl),
        avatar: formatAvatarUrl(req, profileImageUrl),
        message: 'Thank you! Your review has been submitted and is awaiting approval.',
      });

    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

  } catch (err) {
    cleanup();
    console.error('[POST /api/reviews]', err);
    res.status(500).json({ error: 'Unable to save your review. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   PATCH /api/reviews/:id  &  PUT /api/reviews/:id
   Update an existing review by its authenticated owner.
   Preserves original created_at timestamp and 30-day cooldown.
--------------------------------------------------------------- */
const handleReviewUpdate = async (req, res) => {
  const uploadedFile = req.file;

  function cleanup() {
    if (uploadedFile) {
      fs.unlink(uploadedFile.path, () => {});
    }
  }

  try {
    const currentUserId = req.session && req.session.userId ? req.session.userId : null;
    if (!currentUserId) {
      cleanup();
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in to edit your review.'
      });
    }

    const reviewId = parseInt(req.params.id, 10);
    if (!reviewId) {
      cleanup();
      return res.status(400).json({ success: false, error: 'Invalid review ID.' });
    }

    // Verify review exists
    const [existing] = await pool.execute(
      `SELECT id, user_id, profile_image_url, status, created_at FROM reviews WHERE id = ? LIMIT 1`,
      [reviewId]
    );

    if (existing.length === 0) {
      cleanup();
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    const review = existing[0];

    // Verify ownership
    if (review.user_id !== currentUserId) {
      cleanup();
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to edit this review.'
      });
    }

    const body = req.body;
    const reviewerName = cleanText(body.reviewer_name, 120);
    if (!reviewerName || reviewerName.length < 2) {
      cleanup();
      return res.status(400).json({ success: false, error: 'Reviewer name must be at least 2 characters.' });
    }

    const rating = parseInt(body.rating, 10);
    if (!rating || rating < 1 || rating > 5) {
      cleanup();
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5.' });
    }

    const reviewText = cleanText(body.review_text, 1000);
    if (!reviewText || reviewText.length < 10) {
      cleanup();
      return res.status(400).json({ success: false, error: 'Review text must be at least 10 characters.' });
    }

    const designation = cleanText(body.designation, 120);
    const city        = cleanText(body.city,         80);

    let profileImageUrl = null;
    if (uploadedFile) {
      const buf = Buffer.alloc(12);
      const fd  = fs.openSync(uploadedFile.path, 'r');
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);

      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const isWebP = buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;

      if (!isJpeg && !isPng && !isWebP) {
        cleanup();
        return res.status(400).json({ success: false, error: 'Uploaded file is not a valid image.' });
      }

      const host = req.get('host') || '127.0.0.1:4000';
      const protocol = req.protocol || 'http';
      profileImageUrl = `${protocol}://${host}/uploads/${uploadedFile.filename}`;
    }

    // Requirement 5: Preserve the permanent image reference when editing review text or rating
    let finalProfileImageUrl = profileImageUrl;
    if (!finalProfileImageUrl) {
      finalProfileImageUrl = sanitizeImageUrl(review.profile_image_url);
      if (!finalProfileImageUrl && currentUserId) {
        const [uRows] = await pool.execute(`SELECT profile_image_url FROM users WHERE id = ? LIMIT 1`, [currentUserId]);
        if (uRows.length > 0 && uRows[0].profile_image_url) {
          finalProfileImageUrl = sanitizeImageUrl(uRows[0].profile_image_url);
        }
      }
    }
    finalProfileImageUrl = sanitizeImageUrl(finalProfileImageUrl);

    // Preserve original created_at; status remains pending for moderation
    await pool.execute(
      `UPDATE reviews
       SET reviewer_name = ?,
           rating = ?,
           review_text = ?,
           designation = ?,
           city = ?,
           profile_image_url = ?,
           status = 'pending',
           updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [
        reviewerName,
        rating,
        reviewText,
        designation,
        city,
        finalProfileImageUrl,
        reviewId,
        currentUserId,
      ]
    );

    // If review update included an avatar and user profile has none, sync it as user avatar
    if (finalProfileImageUrl && currentUserId) {
      await pool.execute(
        `UPDATE users SET profile_image_url = IFNULL(profile_image_url, ?) WHERE id = ?`,
        [finalProfileImageUrl, currentUserId]
      );
    }

    res.json({
      success: true,
      id: reviewId,
      profileImageUrl: formatAvatarUrl(req, finalProfileImageUrl),
      avatar: formatAvatarUrl(req, finalProfileImageUrl),
      status: 'pending',
      message: 'Your review has been updated and submitted for moderation.',
    });

  } catch (err) {
    cleanup();
    console.error('[UPDATE /api/reviews/:id]', err);
    res.status(500).json({ success: false, error: 'Unable to update review. Please try again.' });
  }
};

app.patch('/api/reviews/:id', upload.single('profile_image'), handleReviewUpdate);
app.put('/api/reviews/:id', upload.single('profile_image'), handleReviewUpdate);

/* ---------------------------------------------------------------
   DELETE /api/reviews/:id
   Delete a review after strict ownership verification.
   Preserves review_cooldowns so the 30-day cooldown is NOT bypassed.
--------------------------------------------------------------- */
app.delete('/api/reviews/:id', async (req, res) => {
  try {
    const currentUserId = req.session && req.session.userId ? req.session.userId : null;
    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in to delete your review.'
      });
    }

    const reviewId = parseInt(req.params.id, 10);
    if (!reviewId) {
      return res.status(400).json({ success: false, error: 'Invalid review ID.' });
    }

    // Verify existence
    const [existing] = await pool.execute(
      `SELECT id, user_id FROM reviews WHERE id = ? LIMIT 1`,
      [reviewId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    // Verify ownership
    if (existing[0].user_id !== currentUserId) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to delete this review.'
      });
    }

    // Delete review record
    await pool.execute(
      `DELETE FROM reviews WHERE id = ? AND user_id = ?`,
      [reviewId, currentUserId]
    );

    // Note: review_cooldowns is NOT deleted, preserving the 30-day cooldown!
    res.json({
      success: true,
      id: reviewId,
      message: 'Review deleted successfully.'
    });

  } catch (err) {
    console.error('[DELETE /api/reviews/:id]', err);
    res.status(500).json({ success: false, error: 'Unable to delete review. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   Moderation Endpoints
   GET   /api/reviews/moderation      (list all/pending reviews)
   PATCH /api/reviews/:id/status      (update status to approved/rejected/pending)
   POST  /api/reviews/:id/approve     (convenience approve endpoint)
--------------------------------------------------------------- */
app.get('/api/reviews/moderation', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const statusFilter = req.query.status;
    let query = `
      SELECT
        id, user_id, reviewer_name, profile_image_url, designation, city,
        rating, review_text, property_context, is_guest, is_demo, status,
        created_at, updated_at
      FROM reviews
    `;
    const params = [];
    if (['pending', 'approved', 'rejected'].includes(statusFilter)) {
      query += ` WHERE status = ?`;
      params.push(statusFilter);
    }
    query += ` ORDER BY created_at DESC LIMIT 100`;

    const [rows] = await pool.execute(query, params);
    res.json({ success: true, reviews: rows });
  } catch (err) {
    console.error('[GET /api/reviews/moderation]', err);
    res.status(500).json({ success: false, error: 'Unable to fetch reviews for moderation.' });
  }
});

app.patch('/api/reviews/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    if (!id || !['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: "Invalid review ID or status. Status must be 'pending', 'approved', or 'rejected'."
      });
    }

    const [result] = await pool.execute(
      `UPDATE reviews SET status = ? WHERE id = ?`,
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    res.json({
      success: true,
      id,
      status,
      message: `Review #${id} status updated to '${status}'.`
    });
  } catch (err) {
    console.error('[PATCH /api/reviews/:id/status]', err);
    res.status(500).json({ error: 'Unable to update review status.' });
  }
});

app.post('/api/reviews/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid review ID.' });

    const [result] = await pool.execute(
      `UPDATE reviews SET status = 'approved' WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    res.json({
      success: true,
      id,
      status: 'approved',
      message: `Review #${id} approved successfully.`
    });
  } catch (err) {
    console.error('[POST /api/reviews/:id/approve]', err);
    res.status(500).json({ error: 'Unable to approve review.' });
  }
});

/* ---------------------------------------------------------------
   Static frontend & Dealers directory route
--------------------------------------------------------------- */
app.use(express.static(path.join(__dirname, '..', 'home_property_discovery')));
app.use(express.static(path.join(__dirname, '..')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'home_property_discovery', 'code.html'));
});
app.get('/dealers', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'home_property_discovery', 'dealers.html'));
});
app.get(['/property/:slug', '/property'], (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'property_detail_page', 'code.html'));
});
app.get(['/search', '/search_results_with_map_view'], (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'search_results_with_map_view', 'code.html'));
});
app.get(['/post-property', '/post_property', '/post_property_flow_listing_wizard'], (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'post_property_flow_listing_wizard', 'code.html'));
});
app.get(['/chat', '/messages', '/chat/index.html', '/chat/code.html'], (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'chat', 'index.html'));
});

/* ---------------------------------------------------------------
   Health check
--------------------------------------------------------------- */
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

/* ---------------------------------------------------------------
   Global error handler
--------------------------------------------------------------- */
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `File too large. Maximum allowed size is ${MAX_BYTES / 1024 / 1024} MB.` });
  }
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error.' });
});

/* ---------------------------------------------------------------
   Boot & HTTP + Socket.IO Server Initialization
--------------------------------------------------------------- */
(async () => {
  try {
    await testConnection();
    const server = http.createServer(app);
    initChatSocket(server, sessionStore, pool);

    server.listen(PORT, () => {
      console.log(`[server] Billedkart Realtech API + Socket.IO listening on http://127.0.0.1:${PORT}`);
      console.log(`[server] Endpoints:`);
      console.log(`         GET  http://127.0.0.1:${PORT}/api/chat/conversations`);
      console.log(`         GET  http://127.0.0.1:${PORT}/api/chat/unread-count`);
      console.log(`         WS   http://127.0.0.1:${PORT}/socket.io`);
    });
  } catch (err) {
    console.error('[boot] Failed to connect to database:', err.message);
    process.exit(1);
  }
})();
