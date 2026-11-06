'use strict';
/**
 * dealers.js — Billedkart Realtech Dealers & Empaneled Property Experts Router
 * Handles agent directory, profile registration/updates, agent-specific reviews,
 * 30-day anti-spam cooldown, and consultation requests.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('./db');
const { resolveConsultantContact, BILLEDKART_CONTACT } = require('./contact-config');

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, `agent-${unique}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP and PDF files are accepted.'));
    }
  }
});

/* ---------------------------------------------------------------
   Helper Functions
--------------------------------------------------------------- */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in to continue.'
    });
  }
  next();
}

function cleanText(val, maxLen = 255) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Recalculate agent statistics: average rating, total reviews, and Bayesian ranking score
 */
async function updateAgentMetrics(connOrPool, agentId) {
  const [stats] = await connOrPool.execute(
    `SELECT
       COUNT(*) AS total_reviews,
       COALESCE(AVG(rating), 0) AS avg_rating
     FROM agent_reviews
     WHERE agent_id = ? AND status = 'approved'`,
    [agentId]
  );

  const count = parseInt(stats[0].total_reviews, 10);
  const avg = parseFloat(stats[0].avg_rating);

  // Bayesian ranking formula: (v / (v + m)) * R + (m / (v + m)) * C
  // v = count, R = avg, m = 5 (prior count weight), C = 4.5 (prior mean rating)
  const m = 5;
  const C = 4.5;
  let bayesian = count === 0 ? 0 : ((count / (count + m)) * avg) + ((m / (count + m)) * C);

  // Scaled to 0-100 for easy sorting
  const rankingScore = parseFloat((bayesian * 20).toFixed(2));

  await connOrPool.execute(
    `UPDATE agents
     SET average_rating = ?,
         reviews_count = ?,
         ranking_score = ?
     WHERE id = ?`,
    [parseFloat(avg.toFixed(1)), count, rankingScore, agentId]
  );
}

function calculateAgentCooldown(submittedAtDate) {
  const submittedAt = new Date(submittedAtDate).getTime();
  const cooldownMs = 30 * 24 * 60 * 60 * 1000;
  const eligibleAt = new Date(submittedAt + cooldownMs);
  const now = Date.now();
  const msRemaining = eligibleAt.getTime() - now;

  if (msRemaining <= 0) {
    return { inCooldown: false, daysRemaining: 0, nextEligibleAt: eligibleAt.toISOString() };
  }

  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
  const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const formattedDate = eligibleAt.toLocaleDateString('en-IN', options);

  return {
    inCooldown: true,
    daysRemaining,
    nextEligibleAt: eligibleAt.toISOString(),
    message: `You've already submitted a review for this agent. You can submit another review after ${daysRemaining} day${daysRemaining > 1 ? 's' : ''} (on ${formattedDate}). You can edit or delete your existing review using the options below.`
  };
}

/* ---------------------------------------------------------------
   1. GET /api/dealers
   List empaneled dealers & agents with search, filters, and fair ranking
--------------------------------------------------------------- */
router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const limit = Math.min(parseInt(req.query.limit || '12', 10), 50);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const city = cleanText(req.query.city);
    const role = cleanText(req.query.role);
    const specialization = cleanText(req.query.specialization);
    const verifiedOnly = req.query.verified_only === 'true' || req.query.verified_only === '1';
    const search = cleanText(req.query.search);
    const sort = cleanText(req.query.sort || 'ranking');

    const conditions = ["status = 'approved'"];
    const params = [];

    if (city && city.toLowerCase() !== 'all') {
      conditions.push('(city LIKE ? OR locality LIKE ?)');
      params.push(`%${city}%`, `%${city}%`);
    }

    if (role && ['agent', 'broker', 'dealer', 'seller'].includes(role.toLowerCase())) {
      conditions.push('role = ?');
      params.push(role.toLowerCase());
    }

    if (specialization && specialization.toLowerCase() !== 'all') {
      conditions.push('specialization LIKE ?');
      params.push(`%${specialization}%`);
    }

    if (verifiedOnly) {
      conditions.push("verification_status = 'verified'");
    }

    if (search) {
      conditions.push('(name LIKE ? OR agency_name LIKE ? OR locality LIKE ? OR specialization LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count for pagination
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM agents ${whereClause}`,
      params
    );
    const total = parseInt(countRows[0].total, 10);

    // Sorting strategies
    let orderBy = 'ranking_score DESC, reviews_count DESC';
    if (sort === 'rating') {
      orderBy = 'average_rating DESC, reviews_count DESC';
    } else if (sort === 'reviews') {
      orderBy = 'reviews_count DESC, average_rating DESC';
    } else if (sort === 'experience') {
      orderBy = 'experience_years DESC';
    } else if (sort === 'newest') {
      orderBy = 'created_at DESC';
    }

    const selectQuery = `
      SELECT
        id,
        user_id,
        name,
        agency_name,
        role,
        phone,
        email,
        city,
        locality,
        specialization,
        bio,
        experience_years,
        profile_image_url,
        certification_name,
        verification_status,
        whatsapp_number,
        is_demo,
        active_listings_count,
        completed_deals_count,
        average_rating,
        reviews_count,
        created_at
      FROM agents
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.execute(selectQuery, [...params, limit, offset]);

    const dealers = rows.map(a => {
      const contact = resolveConsultantContact(a);
      return {
        id: a.id,
        name: escapeHtml(a.name),
        agency: a.agency_name ? escapeHtml(a.agency_name) : 'Independent Consultant',
        role: a.role,
        city: escapeHtml(a.city),
        locality: escapeHtml(a.locality),
        expertise: escapeHtml(a.specialization),
        bio: a.bio ? escapeHtml(a.bio) : '',
        experienceYears: a.experience_years,
        image: a.profile_image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=eaedff&color=00236f&size=150`,
        certificationName: a.certification_name ? escapeHtml(a.certification_name) : null,
        isVerified: a.verification_status === 'verified',
        verificationStatus: a.verification_status,
        isDemo: contact.isDemo,
        phone: contact.phone,
        whatsappNumber: contact.whatsapp,
        hasWhatsapp: Boolean(contact.whatsapp),
        email: contact.email,
        activeListingsCount: a.active_listings_count,
        propertyCount: a.active_listings_count,
        completedDealsCount: a.completed_deals_count,
        rating: parseFloat(parseFloat(a.average_rating).toFixed(1)),
        reviewsCount: a.reviews_count,
        createdAt: a.created_at,
      };
    });

    res.json({
      success: true,
      total,
      limit,
      offset,
      dealers,
    });

  } catch (err) {
    console.error('[GET /api/dealers]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch dealers list.' });
  }
});

/* ---------------------------------------------------------------
   2. GET /api/dealers/me/profile
   Get authenticated user's own agent profile
--------------------------------------------------------------- */
router.get('/me/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const [rows] = await pool.execute(
      `SELECT * FROM agents WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ success: true, hasProfile: false, agent: null });
    }

    const a = rows[0];
    res.json({
      success: true,
      hasProfile: true,
      agent: {
        id: a.id,
        name: a.name,
        agencyName: a.agency_name,
        role: a.role,
        phone: a.phone,
        email: a.email,
        city: a.city,
        locality: a.locality,
        specialization: a.specialization,
        bio: a.bio,
        experienceYears: a.experience_years,
        profileImageUrl: a.profile_image_url,
        certificationName: a.certification_name,
        certificationDocUrl: a.certification_doc_url,
        verificationStatus: a.verification_status,
        status: a.status,
        contactPreference: a.contact_preference,
        whatsappNumber: a.whatsapp_number,
        activeListingsCount: a.active_listings_count,
        completedDealsCount: a.completed_deals_count,
        averageRating: parseFloat(a.average_rating),
        reviewsCount: a.reviews_count,
        createdAt: a.created_at,
      }
    });

  } catch (err) {
    console.error('[GET /api/dealers/me/profile]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch agent profile.' });
  }
});

/* ---------------------------------------------------------------
   3. POST /api/dealers/register
   Register an agent / dealer / seller profile for the logged in user
--------------------------------------------------------------- */
router.post('/register', requireAuth, upload.fields([
  { name: 'profile_image', maxCount: 1 },
  { name: 'certification_doc', maxCount: 1 }
]), async (req, res) => {
  try {
    const userId = req.session.userId;

    // Check if user already has an agent profile
    const [existing] = await pool.execute(
      `SELECT id FROM agents WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'You already have an agent profile. You can edit your existing profile from the dashboard.'
      });
    }

    const body = req.body || {};
    const name = cleanText(body.name, 120);
    const agencyName = cleanText(body.agency_name, 120);
    const role = cleanText(body.role, 20).toLowerCase();
    const phone = cleanText(body.phone, 20);
    const email = cleanText(body.email, 191);
    const city = cleanText(body.city, 80);
    const locality = cleanText(body.locality, 160);
    const specialization = cleanText(body.specialization, 255);
    const bio = cleanText(body.bio, 2000);
    const experienceYears = Math.max(0, parseInt(body.experience_years || '1', 10));
    const certificationName = cleanText(body.certification_name, 160);
    const whatsappNumber = cleanText(body.whatsapp_number, 20);
    const contactPreference = cleanText(body.contact_preference || 'all', 20);

    if (!name || name.length < 2) {
      return res.status(400).json({ success: false, error: 'Full name is required (at least 2 characters).' });
    }
    if (!phone || phone.length < 8) {
      return res.status(400).json({ success: false, error: 'A valid phone number is required.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }
    if (!city) {
      return res.status(400).json({ success: false, error: 'Primary city is required.' });
    }
    if (!locality) {
      return res.status(400).json({ success: false, error: 'Service areas or locality is required.' });
    }
    if (!specialization) {
      return res.status(400).json({ success: false, error: 'At least one specialization is required.' });
    }

    const validRoles = ['agent', 'broker', 'dealer', 'seller'];
    const chosenRole = validRoles.includes(role) ? role : 'agent';

    const origin = `${req.protocol}://${req.get('host')}`;
    let profileImageUrl = null;
    let certificationDocUrl = null;

    if (req.files && req.files['profile_image'] && req.files['profile_image'][0]) {
      profileImageUrl = `${origin}/uploads/${req.files['profile_image'][0].filename}`;
    }
    if (req.files && req.files['certification_doc'] && req.files['certification_doc'][0]) {
      certificationDocUrl = `${origin}/uploads/${req.files['certification_doc'][0].filename}`;
    }

    // Honest verification status: submitted certificates go to 'pending' verification
    const verificationStatus = certificationDocUrl ? 'pending' : 'unverified';

    const [ins] = await pool.execute(
      `INSERT INTO agents
        (user_id, name, agency_name, role, phone, email, city, locality,
         specialization, bio, experience_years, profile_image_url,
         certification_name, certification_doc_url, verification_status,
         status, contact_preference, whatsapp_number, active_listings_count,
         completed_deals_count, average_rating, reviews_count, ranking_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, 0, 0, 0.0, 0, 10.00)`,
      [
        userId, name, agencyName, chosenRole, phone, email, city, locality,
        specialization, bio, experienceYears, profileImageUrl,
        certificationName, certificationDocUrl, verificationStatus,
        contactPreference, whatsappNumber
      ]
    );

    res.status(201).json({
      success: true,
      id: ins.insertId,
      message: 'Agent profile registered successfully and is now active in the directory.',
    });

  } catch (err) {
    console.error('[POST /api/dealers/register]', err);
    res.status(500).json({ success: false, error: 'Failed to register agent profile.' });
  }
});

/* ---------------------------------------------------------------
   4. PUT /api/dealers/me/profile
   Update authenticated user's own agent profile
--------------------------------------------------------------- */
router.put('/me/profile', requireAuth, upload.fields([
  { name: 'profile_image', maxCount: 1 },
  { name: 'certification_doc', maxCount: 1 }
]), async (req, res) => {
  try {
    const userId = req.session.userId;

    const [existing] = await pool.execute(
      `SELECT id, profile_image_url, certification_doc_url, verification_status
       FROM agents WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'No agent profile found for your account.' });
    }

    const agent = existing[0];
    const body = req.body || {};

    const name = cleanText(body.name, 120);
    const agencyName = cleanText(body.agency_name, 120);
    const role = cleanText(body.role, 20).toLowerCase();
    const phone = cleanText(body.phone, 20);
    const email = cleanText(body.email, 191);
    const city = cleanText(body.city, 80);
    const locality = cleanText(body.locality, 160);
    const specialization = cleanText(body.specialization, 255);
    const bio = cleanText(body.bio, 2000);
    const experienceYears = parseInt(body.experience_years || '1', 10);
    const certificationName = cleanText(body.certification_name, 160);
    const whatsappNumber = cleanText(body.whatsapp_number, 20);
    const contactPreference = cleanText(body.contact_preference || 'all', 20);

    const origin = `${req.protocol}://${req.get('host')}`;
    let profileImageUrl = agent.profile_image_url;
    let certificationDocUrl = agent.certification_doc_url;
    let verificationStatus = agent.verification_status;

    if (req.files && req.files['profile_image'] && req.files['profile_image'][0]) {
      profileImageUrl = `${origin}/uploads/${req.files['profile_image'][0].filename}`;
    }

    if (req.files && req.files['certification_doc'] && req.files['certification_doc'][0]) {
      certificationDocUrl = `${origin}/uploads/${req.files['certification_doc'][0].filename}`;
      // Changes to certificate require re-verification
      verificationStatus = 'pending';
    }

    await pool.execute(
      `UPDATE agents
       SET name = COALESCE(NULLIF(?, ''), name),
           agency_name = ?,
           role = COALESCE(NULLIF(?, ''), role),
           phone = COALESCE(NULLIF(?, ''), phone),
           email = COALESCE(NULLIF(?, ''), email),
           city = COALESCE(NULLIF(?, ''), city),
           locality = COALESCE(NULLIF(?, ''), locality),
           specialization = COALESCE(NULLIF(?, ''), specialization),
           bio = ?,
           experience_years = ?,
           profile_image_url = ?,
           certification_name = ?,
           certification_doc_url = ?,
           verification_status = ?,
           contact_preference = ?,
           whatsapp_number = ?
       WHERE id = ?`,
      [
        name, agencyName, role, phone, email, city, locality,
        specialization, bio, experienceYears, profileImageUrl,
        certificationName, certificationDocUrl, verificationStatus,
        contactPreference, whatsappNumber, agent.id
      ]
    );

    res.json({
      success: true,
      message: 'Agent profile updated successfully.',
    });

  } catch (err) {
    console.error('[PUT /api/dealers/me/profile]', err);
    res.status(500).json({ success: false, error: 'Failed to update agent profile.' });
  }
});

/* ---------------------------------------------------------------
   5. GET /api/dealers/:id
   Get single agent details
--------------------------------------------------------------- */
router.get('/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid dealer ID.' });

    const [rows] = await pool.execute(
      `SELECT
        id, user_id, name, agency_name, role, phone, email, city, locality,
        specialization, bio, experience_years, profile_image_url,
        certification_name, verification_status, status, contact_preference,
        whatsapp_number, is_demo, active_listings_count, completed_deals_count,
        average_rating, reviews_count, created_at
       FROM agents WHERE id = ? LIMIT 1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Dealer not found.' });
    }

    const a = rows[0];
    const contact = resolveConsultantContact(a);
    res.json({
      success: true,
      dealer: {
        id: a.id,
        name: escapeHtml(a.name),
        agency: a.agency_name ? escapeHtml(a.agency_name) : 'Independent Consultant',
        role: a.role,
        isDemo: contact.isDemo,
        phone: contact.phone,
        email: contact.email,
        city: escapeHtml(a.city),
        locality: escapeHtml(a.locality),
        expertise: escapeHtml(a.specialization),
        bio: a.bio ? escapeHtml(a.bio) : 'Empaneled real estate advisor specializing in verified property acquisitions and neighborhood site visits.',
        experienceYears: a.experience_years,
        image: a.profile_image_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=eaedff&color=00236f&size=150`,
        certificationName: a.certification_name ? escapeHtml(a.certification_name) : null,
        isVerified: a.verification_status === 'verified',
        verificationStatus: a.verification_status,
        contactPreference: a.contact_preference,
        whatsappNumber: contact.whatsapp,
        hasWhatsapp: Boolean(contact.whatsapp),
        activeListingsCount: a.active_listings_count,
        propertyCount: a.active_listings_count,
        completedDealsCount: a.completed_deals_count,
        rating: parseFloat(parseFloat(a.average_rating).toFixed(1)),
        reviewsCount: a.reviews_count,
        createdAt: a.created_at,
      }
    });

  } catch (err) {
    console.error('[GET /api/dealers/:id]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch dealer details.' });
  }
});

/* ---------------------------------------------------------------
   6. GET /api/dealers/:id/reviews
   Get approved reviews for an agent + summary metrics
--------------------------------------------------------------- */
router.get('/:id/reviews', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const agentId = parseInt(req.params.id, 10);
    if (!agentId) return res.status(400).json({ success: false, error: 'Invalid agent ID.' });

    const currentUserId = req.session && req.session.userId ? req.session.userId : null;

    const [rows] = await pool.execute(
      `SELECT
         id,
         agent_id,
         user_id,
         reviewer_name,
         rating,
         review_text,
         property_context,
         status,
         created_at
       FROM agent_reviews
       WHERE agent_id = ? AND (status = 'approved' OR user_id = ?)
       ORDER BY created_at DESC`,
      [agentId, currentUserId || 0]
    );

    const reviews = rows.map(r => ({
      id: r.id,
      name: escapeHtml(r.reviewer_name),
      rating: r.rating,
      text: escapeHtml(r.review_text),
      tag: r.property_context ? escapeHtml(r.property_context) : '',
      isOwner: Boolean(currentUserId && r.user_id === currentUserId),
      status: r.status,
      createdAt: r.created_at,
    }));

    // Rating summary
    const [summaryRows] = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(AVG(rating), 0) AS average,
         SUM(rating = 5) AS star_5,
         SUM(rating = 4) AS star_4,
         SUM(rating = 3) AS star_3,
         SUM(rating = 2) AS star_2,
         SUM(rating = 1) AS star_1
       FROM agent_reviews
       WHERE agent_id = ? AND status = 'approved'`,
      [agentId]
    );

    const s = summaryRows[0];
    res.json({
      success: true,
      reviews,
      summary: {
        total: parseInt(s.total, 10),
        average: parseFloat(parseFloat(s.average).toFixed(1)),
        distribution: {
          5: parseInt(s.star_5 || 0, 10),
          4: parseInt(s.star_4 || 0, 10),
          3: parseInt(s.star_3 || 0, 10),
          2: parseInt(s.star_2 || 0, 10),
          1: parseInt(s.star_1 || 0, 10),
        }
      }
    });

  } catch (err) {
    console.error('[GET /api/dealers/:id/reviews]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch agent reviews.' });
  }
});

/* ---------------------------------------------------------------
   7. GET /api/dealers/:id/reviews/cooldown
   Check 30-day cooldown status for authenticated user on this specific agent
--------------------------------------------------------------- */
router.get('/:id/reviews/cooldown', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const currentUserId = req.session && req.session.userId ? req.session.userId : null;
    if (!currentUserId) {
      return res.json({ success: true, authenticated: false, inCooldown: false });
    }

    const agentId = parseInt(req.params.id, 10);
    if (!agentId) return res.status(400).json({ success: false, error: 'Invalid agent ID.' });

    const [cdRows] = await pool.execute(
      `SELECT submitted_at FROM agent_review_cooldowns
       WHERE user_id = ? AND agent_id = ?
       ORDER BY submitted_at DESC LIMIT 1`,
      [currentUserId, agentId]
    );

    if (cdRows.length === 0) {
      return res.json({ success: true, authenticated: true, inCooldown: false });
    }

    const cdInfo = calculateAgentCooldown(cdRows[0].submitted_at);

    // Also fetch user's existing review for this agent
    const [existingRev] = await pool.execute(
      `SELECT id, reviewer_name, rating, review_text, property_context, status
       FROM agent_reviews WHERE user_id = ? AND agent_id = ?
       ORDER BY id DESC LIMIT 1`,
      [currentUserId, agentId]
    );

    res.json({
      success: true,
      authenticated: true,
      ...cdInfo,
      existingReview: existingRev.length > 0 ? existingRev[0] : null,
    });

  } catch (err) {
    console.error('[GET /api/dealers/:id/reviews/cooldown]', err);
    res.status(500).json({ success: false, error: 'Failed to check cooldown.' });
  }
});

/* ---------------------------------------------------------------
   8. POST /api/dealers/:id/reviews
   Submit a review for a specific agent with 30-day cooldown and concurrency protection
--------------------------------------------------------------- */
router.post('/:id/reviews', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const currentUserId = req.session.userId;
    const agentId = parseInt(req.params.id, 10);

    if (!agentId) {
      conn.release();
      return res.status(400).json({ success: false, error: 'Invalid agent ID.' });
    }

    // Verify agent exists
    const [agentRows] = await conn.execute(`SELECT id, user_id FROM agents WHERE id = ? LIMIT 1`, [agentId]);
    if (agentRows.length === 0) {
      conn.release();
      return res.status(404).json({ success: false, error: 'Agent not found.' });
    }

    // Agents cannot review themselves
    if (agentRows[0].user_id && agentRows[0].user_id === currentUserId) {
      conn.release();
      return res.status(400).json({ success: false, error: 'You cannot write a review for your own profile.' });
    }

    const body = req.body || {};
    const reviewerName = cleanText(body.reviewer_name || req.session.userName || 'Verified Client', 120);
    const rating = parseInt(body.rating, 10);
    const reviewText = cleanText(body.review_text, 1000);
    const propertyContext = cleanText(body.property_context, 200);

    if (!rating || rating < 1 || rating > 5) {
      conn.release();
      return res.status(400).json({ success: false, error: 'Please select a rating between 1 and 5 stars.' });
    }

    if (!reviewText || reviewText.length < 10) {
      conn.release();
      return res.status(400).json({ success: false, error: 'Review text must be at least 10 characters long.' });
    }

    await conn.beginTransaction();

    // Check 30-day cooldown with row-lock to prevent concurrent bypass
    const [cdRows] = await conn.execute(
      `SELECT submitted_at FROM agent_review_cooldowns
       WHERE user_id = ? AND agent_id = ? AND submitted_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
       ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE`,
      [currentUserId, agentId]
    );

    if (cdRows.length > 0) {
      await conn.rollback();
      conn.release();
      const cdInfo = calculateAgentCooldown(cdRows[0].submitted_at);
      return res.status(429).json({
        success: false,
        cooldown: true,
        nextEligibleAt: cdInfo.nextEligibleAt,
        daysRemaining: cdInfo.daysRemaining,
        error: cdInfo.message
      });
    }

    // Insert review
    const [ins] = await conn.execute(
      `INSERT INTO agent_reviews
        (agent_id, user_id, reviewer_name, rating, review_text, property_context, status)
       VALUES (?, ?, ?, ?, ?, ?, 'approved')`,
      [agentId, currentUserId, reviewerName, rating, reviewText, propertyContext]
    );

    // Record submission timestamp in cooldown table
    await conn.execute(
      `INSERT INTO agent_review_cooldowns (agent_id, user_id, submitted_at)
       VALUES (?, ?, NOW())`,
      [agentId, currentUserId]
    );

    // Update agent metrics within same transaction
    await updateAgentMetrics(conn, agentId);

    await conn.commit();
    conn.release();

    res.status(201).json({
      success: true,
      id: ins.insertId,
      message: 'Thank you! Your review for this agent has been published.',
    });

  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('[POST /api/dealers/:id/reviews]', err);
    res.status(500).json({ success: false, error: 'Failed to submit review. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   9. PATCH /api/dealers/:id/reviews/:reviewId
   Edit existing review for an agent by its owner
--------------------------------------------------------------- */
router.patch('/:id/reviews/:reviewId', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const agentId = parseInt(req.params.id, 10);
    const reviewId = parseInt(req.params.reviewId, 10);

    if (!agentId || !reviewId) {
      return res.status(400).json({ success: false, error: 'Invalid parameters.' });
    }

    const [existing] = await pool.execute(
      `SELECT id, user_id FROM agent_reviews WHERE id = ? AND agent_id = ? LIMIT 1`,
      [reviewId, agentId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    if (existing[0].user_id !== currentUserId) {
      return res.status(403).json({ success: false, error: 'You do not have permission to edit this review.' });
    }

    const body = req.body || {};
    const rating = parseInt(body.rating, 10);
    const reviewText = cleanText(body.review_text, 1000);
    const propertyContext = cleanText(body.property_context, 200);

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5.' });
    }
    if (!reviewText || reviewText.length < 10) {
      return res.status(400).json({ success: false, error: 'Review text must be at least 10 characters.' });
    }

    await pool.execute(
      `UPDATE agent_reviews
       SET rating = ?,
           review_text = ?,
           property_context = ?,
           updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [rating, reviewText, propertyContext, reviewId, currentUserId]
    );

    // Recalculate agent rating summary
    await updateAgentMetrics(pool, agentId);

    res.json({
      success: true,
      message: 'Your review has been updated successfully.',
    });

  } catch (err) {
    console.error('[PATCH /api/dealers/:id/reviews/:reviewId]', err);
    res.status(500).json({ success: false, error: 'Failed to update review.' });
  }
});

/* ---------------------------------------------------------------
   10. DELETE /api/dealers/:id/reviews/:reviewId
   Delete existing review for an agent by its owner (preserves 30-day cooldown)
--------------------------------------------------------------- */
router.delete('/:id/reviews/:reviewId', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const agentId = parseInt(req.params.id, 10);
    const reviewId = parseInt(req.params.reviewId, 10);

    if (!agentId || !reviewId) {
      return res.status(400).json({ success: false, error: 'Invalid parameters.' });
    }

    const [existing] = await pool.execute(
      `SELECT id, user_id FROM agent_reviews WHERE id = ? AND agent_id = ? LIMIT 1`,
      [reviewId, agentId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    if (existing[0].user_id !== currentUserId) {
      return res.status(403).json({ success: false, error: 'You do not have permission to delete this review.' });
    }

    // Delete review
    await pool.execute(
      `DELETE FROM agent_reviews WHERE id = ? AND user_id = ?`,
      [reviewId, currentUserId]
    );

    // Note: agent_review_cooldowns is PRESERVED, so deleting does NOT bypass the 30-day rule!

    // Recalculate agent metrics
    await updateAgentMetrics(pool, agentId);

    res.json({
      success: true,
      message: 'Review deleted successfully.',
    });

  } catch (err) {
    console.error('[DELETE /api/dealers/:id/reviews/:reviewId]', err);
    res.status(500).json({ success: false, error: 'Failed to delete review.' });
  }
});

/* ---------------------------------------------------------------
   11. POST /api/dealers/:id/consult
   Submit a consultation request for an agent
--------------------------------------------------------------- */
router.post('/:id/consult', async (req, res) => {
  try {
    const agentId = parseInt(req.params.id, 10);
    if (!agentId) return res.status(400).json({ success: false, error: 'Invalid dealer ID.' });

    const [agentRows] = await pool.execute(
      `SELECT id, user_id, name, phone, email, whatsapp_number, is_demo, contact_preference
       FROM agents WHERE id = ? AND status = 'approved' LIMIT 1`,
      [agentId]
    );

    if (agentRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Dealer not found or inactive.' });
    }

    const agent = agentRows[0];
    const body = req.body || {};
    const clientName = cleanText(body.client_name, 120);
    const clientPhone = cleanText(body.client_phone, 20);
    const clientEmail = cleanText(body.client_email, 191);
    const contactMethod = cleanText(body.contact_method || 'form', 20);
    const preferredTime = cleanText(body.preferred_time, 80);
    const message = cleanText(body.message, 1000);
    const userId = req.session && req.session.userId ? req.session.userId : null;

    if (!clientName || clientName.length < 2) {
      return res.status(400).json({ success: false, error: 'Please enter your name.' });
    }
    if (!clientPhone || clientPhone.length < 8) {
      return res.status(400).json({ success: false, error: 'Please enter a valid phone number.' });
    }

    // Check duplicate submission in last 10 minutes
    const [dup] = await pool.execute(
      `SELECT id FROM agent_consultations
       WHERE agent_id = ? AND client_phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
       LIMIT 1`,
      [agentId, clientPhone]
    );

    if (dup.length > 0) {
      return res.status(429).json({
        success: false,
        error: 'We have already recorded your request for this advisor. They will reach out shortly!'
      });
    }

    await pool.execute(
      `INSERT INTO agent_consultations
        (agent_id, user_id, client_name, client_phone, client_email, contact_method, preferred_time, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [agentId, userId, clientName, clientPhone, clientEmail || '', contactMethod, preferredTime, message]
    );

    const contact = resolveConsultantContact(agent);
    res.json({
      success: true,
      message: `Consultation booked with ${agent.name}! They will contact you via ${contactMethod.toUpperCase()}.`,
      contactOptions: {
        phone: contact.phone,
        whatsapp: contact.whatsapp,
        email: contact.email,
        preference: agent.contact_preference,
      }
    });

  } catch (err) {
    console.error('[POST /api/dealers/:id/consult]', err);
    res.status(500).json({ success: false, error: 'Failed to submit consultation request.' });
  }
});

/* ---------------------------------------------------------------
   12. GET /api/dealers/me/consultations
   Get consultations received by the authenticated agent
--------------------------------------------------------------- */
router.get('/me/consultations', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const [agentRows] = await pool.execute(
      `SELECT id FROM agents WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (agentRows.length === 0) {
      return res.status(404).json({ success: false, error: 'No agent profile found for your account.' });
    }

    const agentId = agentRows[0].id;
    const [rows] = await pool.execute(
      `SELECT id, client_name, client_phone, client_email, contact_method, preferred_time, message, status, created_at
       FROM agent_consultations
       WHERE agent_id = ?
       ORDER BY created_at DESC`,
      [agentId]
    );

    res.json({
      success: true,
      consultations: rows,
    });

  } catch (err) {
    console.error('[GET /api/dealers/me/consultations]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch consultations.' });
  }
});

module.exports = router;
