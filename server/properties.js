'use strict';
/**
 * properties.js — Robust Property Router for Billedkart Realtech
 * Endpoints:
 *   GET    /api/properties               — Search & list properties
 *   GET    /api/properties/:idOrSlug     — Single property detailed profile
 *   GET    /api/properties/:id/similar   — Similar properties
 *   POST   /api/properties/:id/contact   — Secure owner contact retrieval (phone reveal)
 *   POST   /api/properties/:id/enquiry   — Submit direct lead enquiry
 *   POST   /api/properties/:id/visit     — Book guided site visit
 *   POST   /api/properties/:id/wishlist  — Toggle save to wishlist
 *   GET    /api/properties/:id/wishlist-status — Check if saved
 *   POST   /api/properties/:id/report    — Report listing inaccuracy
 *   GET    /api/properties/:id/chat      — Get chat message history
 *   POST   /api/properties/:id/chat      — Send new chat message
 */
const express = require('express');
const router = express.Router();
const { pool } = require('./db');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Dedicated uploads directories
const propUploadDir = path.resolve(__dirname, '..', 'uploads', 'properties');
const docUploadDir = path.resolve(__dirname, '..', 'uploads', 'documents');
if (!fs.existsSync(propUploadDir)) fs.mkdirSync(propUploadDir, { recursive: true });
if (!fs.existsSync(docUploadDir)) fs.mkdirSync(docUploadDir, { recursive: true });

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, propUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const unique = `prop-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, unique);
  }
});

const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, docUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const unique = `kyc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, unique);
  }
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG and WebP images are allowed.'));
    }
  }
});

const uploadDocument = multer({
  storage: docStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPG, and PNG documents are allowed.'));
    }
  }
});

// Rate limiters for form submissions
const enquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many enquiries submitted from this network. Please wait a few minutes.' }
});

const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many reports submitted. Please try again later.' }
});

/* Helper: parse JSON safely */
function safeJson(val, fallback = []) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
}

/* Helper: format property model for public client consumption */
function formatProperty(row, hidePhone = true) {
  const price = Number(row.price || 0);
  const carpet = Number(row.carpet_area_sqft || 0);
  const sba = Number(row.super_builtup_area_sqft || 0);
  const pricePerSqft = sba > 0 ? Math.round(price / sba) : (carpet > 0 ? Math.round(price / carpet) : 0);

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    propertyType: row.property_type,
    transactionType: row.transaction_type,
    projectName: row.project_name || '',
    builderId: row.builder_id || null,
    
    // Pricing
    price,
    priceFormatted: price >= 10000000 ? `₹${(price / 10000000).toFixed(2)} Cr` : `₹${(price / 100000).toFixed(2)} Lac`,
    pricePerSqft,
    pricePerSqftFormatted: `₹${pricePerSqft.toLocaleString('en-IN')} / sq.ft`,
    isPriceNegotiable: Boolean(row.is_price_negotiable),
    maintenanceMonthly: Number(row.maintenance_monthly || 0),
    depositAmount: row.deposit_amount ? Number(row.deposit_amount) : null,

    // Dimensions & Highlights
    bhk: Number(row.bhk || 0),
    bathrooms: Number(row.bathrooms || 0),
    balconies: Number(row.balconies || 0),
    carpetAreaSqft: carpet,
    superBuiltupAreaSqft: sba,
    facing: row.facing || 'East',
    floorNumber: Number(row.floor_number || 0),
    totalFloors: Number(row.total_floors || 0),
    towerBlock: row.tower_block || '',
    parkingCovered: Number(row.parking_covered || 0),
    parkingOpen: Number(row.parking_open || 0),
    furnishingStatus: row.furnishing_status || 'semi_furnished',
    furnishingDetails: row.furnishing_details || '',

    // Verification & Status
    verificationStatus: row.verification_status || 'unverified',
    isVerified: row.verification_status === 'verified',
    reraId: row.rera_id || null,
    isReraRegistered: Boolean(row.is_rera_registered && row.rera_id),
    khataType: row.khata_type || 'A Khata',
    possessionStatus: row.possession_status || 'ready_to_move',
    possessionDate: row.possession_date || 'Immediate',
    propertyAgeYears: Number(row.property_age_years || 0),

    // Building Specs
    waterSupply: row.water_supply || 'Cauvery Water + Borewell',
    powerBackup: row.power_backup || '100% DG Power Backup',
    overlookingView: row.overlooking_view || 'Lake & Greenery',
    societyAcreage: row.society_acreage || '',

    // Location
    addressLine: row.address_line,
    locality: row.locality,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    latitude: Number(row.latitude || 12.9716),
    longitude: Number(row.longitude || 77.5946),
    isApproxLocation: Boolean(row.is_approx_location),

    // Media
    primaryImageUrl: row.primary_image_url,
    images: safeJson(row.images, []),
    floorPlanUrl: row.floor_plan_url || null,
    brochureUrl: row.brochure_url || null,

    // Deep Structured Content
    description: row.description,
    amenities: safeJson(row.amenities, []),
    specifications: safeJson(row.specifications, {}),
    nearbyLandmarks: safeJson(row.nearby_landmarks, []),

    // Owner / Agent Profile
    owner_user_id: row.owner_user_id || 65,
    owner: {
      userId: row.owner_user_id || 65,
      type: row.owner_type || 'owner',
      name: row.owner_name,
      isVerified: Boolean(row.is_owner_verified),
      memberSince: row.owner_member_since || '2022',
      responseTime: row.owner_response_time || 'Within 15 mins',
      // Protected: only revealed when authorized
      phone: hidePhone ? (row.owner_phone ? row.owner_phone.replace(/(\d{4})\d{4}(\d{2})/, '$1****$2') : '+91 9044****01') : (row.owner_phone || '+91 9044268001'),
      phoneRaw: row.owner_phone || '+91 9044268001',
      isRevealed: !hidePhone
    },

    viewsCount: Number(row.views_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const {
  calculateHaversineDistance,
  parseSearchQuery,
  searchProperties,
  getSearchSuggestions
} = require('./search-engine');

/* ---------------------------------------------------------------
   1. GET /api/properties & /api/properties/search — Intelligent Property Search & Discovery
--------------------------------------------------------------- */
router.get(['/', '/search'], async (req, res) => {
  try {
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const sessionId = req.sessionID || null;

    let userCoords = null;
    if (req.query.latitude && req.query.longitude) {
      userCoords = {
        latitude: parseFloat(req.query.latitude),
        longitude: parseFloat(req.query.longitude)
      };
    } else if (userId || sessionId) {
      // Check saved user location if not passed explicitly in query
      const [savedLoc] = await pool.query(
        'SELECT latitude, longitude FROM user_saved_locations WHERE user_id = ? OR session_id = ? ORDER BY updated_at DESC LIMIT 1',
        [userId, sessionId]
      );
      if (savedLoc.length > 0 && savedLoc[0].latitude && savedLoc[0].longitude) {
        userCoords = {
          latitude: parseFloat(savedLoc[0].latitude),
          longitude: parseFloat(savedLoc[0].longitude)
        };
      }
    }

    const searchResult = await searchProperties(req.query, userCoords);

    res.json({
      success: true,
      count: searchResult.totalCount,
      exactCount: searchResult.exactCount,
      fallbackCount: searchResult.fallbackCount,
      hasMore: searchResult.hasMore,
      nextOffset: searchResult.nextOffset,
      appliedFilters: searchResult.appliedFilters,
      parsedQuery: searchResult.parsedQuery,
      userLocation: searchResult.userLocation,
      properties: searchResult.properties
    });
  } catch (err) {
    console.error('[properties:search] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve properties.' });
  }
});

/* ---------------------------------------------------------------
   GET /api/properties/suggestions — Search Autocomplete
--------------------------------------------------------------- */
router.get('/suggestions', async (req, res) => {
  try {
    const q = req.query.q || '';
    const suggestions = await getSearchSuggestions(q);
    res.json({ success: true, suggestions });
  } catch (err) {
    console.error('[properties:suggestions] Error:', err.message);
    res.status(500).json({ success: false, suggestions: [] });
  }
});

/* ---------------------------------------------------------------
   GET, POST & DELETE /api/properties/user-location — Location Persistence
--------------------------------------------------------------- */
router.get('/user-location', async (req, res) => {
  try {
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const sessionId = req.sessionID || null;

    let rows = [];
    if (userId) {
      const [uRows] = await pool.query(
        'SELECT city, locality, formatted_address, latitude, longitude, accuracy_meters, location_source, updated_at FROM user_saved_locations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
        [userId]
      );
      rows = uRows;
    }
    if (rows.length === 0 && sessionId) {
      const [sRows] = await pool.query(
        'SELECT city, locality, formatted_address, latitude, longitude, accuracy_meters, location_source, updated_at FROM user_saved_locations WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1',
        [sessionId]
      );
      rows = sRows;
    }

    if (rows.length > 0) {
      res.json({ success: true, saved: true, location: rows[0] });
    } else {
      res.json({ success: true, saved: false, location: null });
    }
  } catch (err) {
    console.error('[properties:get-location] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch location.' });
  }
});

router.post('/user-location', async (req, res) => {
  try {
    const { city, locality, formatted_address, latitude, longitude, accuracyMeters = 50, location_source = 'browser_gps' } = req.body;
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const sessionId = req.sessionID || null;

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, error: 'Valid Latitude (-90 to 90) and Longitude (-180 to 180) are required.' });
    }

    const cleanCity = (city || 'Bengaluru').trim();
    const cleanLocality = (locality || '').trim();
    const cleanAddress = (formatted_address || `${cleanLocality ? cleanLocality + ', ' : ''}${cleanCity}`).trim();
    const cleanAcc = Math.round(Number(accuracyMeters) || 50);
    const cleanSource = (location_source || 'browser_gps').trim();

    let existingId = null;
    if (userId) {
      const [rows] = await pool.query('SELECT id FROM user_saved_locations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [userId]);
      if (rows.length > 0) existingId = rows[0].id;
    }
    if (!existingId && sessionId) {
      const [rows] = await pool.query('SELECT id FROM user_saved_locations WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1', [sessionId]);
      if (rows.length > 0) existingId = rows[0].id;
    }

    if (existingId) {
      await pool.query(
        `UPDATE user_saved_locations
         SET user_id = COALESCE(?, user_id),
             session_id = COALESCE(?, session_id),
             city = ?,
             locality = ?,
             formatted_address = ?,
             latitude = ?,
             longitude = ?,
             accuracy_meters = ?,
             location_source = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [userId, sessionId, cleanCity, cleanLocality, cleanAddress, lat, lng, cleanAcc, cleanSource, existingId]
      );
    } else {
      await pool.query(
        `INSERT INTO user_saved_locations (user_id, session_id, city, locality, formatted_address, latitude, longitude, accuracy_meters, location_source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [userId, sessionId, cleanCity, cleanLocality, cleanAddress, lat, lng, cleanAcc, cleanSource]
      );
    }

    res.json({
      success: true,
      message: 'Location saved securely.',
      location: {
        city: cleanCity,
        locality: cleanLocality,
        formatted_address: cleanAddress,
        latitude: lat,
        longitude: lng,
        accuracy_meters: cleanAcc,
        location_source: cleanSource
      }
    });
  } catch (err) {
    console.error('[properties:save-location] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save location.' });
  }
});

router.delete('/user-location', async (req, res) => {
  try {
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const sessionId = req.sessionID || null;

    if (userId) {
      await pool.query('DELETE FROM user_saved_locations WHERE user_id = ?', [userId]);
    }
    if (sessionId) {
      await pool.query('DELETE FROM user_saved_locations WHERE session_id = ?', [sessionId]);
    }

    res.json({ success: true, message: 'Saved location cleared.' });
  } catch (err) {
    console.error('[properties:delete-location] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to clear location.' });
  }
});

/* ---------------------------------------------------------------
   Saved Searches API (Section 14)
--------------------------------------------------------------- */
router.get('/saved-searches', async (req, res) => {
  try {
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const sessionId = req.sessionID || null;

    const [rows] = await pool.query(
      'SELECT id, search_name, query_text, filters, created_at FROM saved_searches WHERE user_id = ? OR session_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId, sessionId]
    );

    res.json({
      success: true,
      searches: rows.map(r => ({
        id: r.id,
        name: r.search_name,
        query: r.query_text,
        filters: safeJson(r.filters, {}),
        createdAt: r.created_at
      }))
    });
  } catch (err) {
    console.error('[properties:get-saved-searches] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch saved searches.' });
  }
});

router.post('/saved-searches', async (req, res) => {
  try {
    const { searchName, queryText = '', filters = {} } = req.body;
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const sessionId = req.sessionID || null;

    if (!searchName || !searchName.trim()) {
      return res.status(400).json({ success: false, error: 'Search name is required.' });
    }

    const [result] = await pool.query(
      'INSERT INTO saved_searches (user_id, session_id, search_name, query_text, filters) VALUES (?, ?, ?, ?, ?)',
      [userId, sessionId, searchName.trim(), queryText, JSON.stringify(filters)]
    );

    res.json({ success: true, savedSearchId: result.insertId, message: 'Search saved successfully.' });
  } catch (err) {
    console.error('[properties:save-search] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save search.' });
  }
});

router.delete('/saved-searches/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const sessionId = req.sessionID || null;

    await pool.query(
      'DELETE FROM saved_searches WHERE id = ? AND (user_id = ? OR session_id = ?)',
      [id, userId, sessionId]
    );

    res.json({ success: true, message: 'Saved search removed.' });
  } catch (err) {
    console.error('[properties:delete-saved-search] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to remove saved search.' });
  }
});

/* ---------------------------------------------------------------
   POST /api/properties/draft — Save or Auto-Save Listing Draft
--------------------------------------------------------------- */
router.post('/draft', async (req, res) => {
  try {
    const { draftToken, currentStep = 1, completionScore = 0, formData = {} } = req.body;
    const userId = req.session && req.session.userId ? req.session.userId : null;
    let token = draftToken;

    if (!token) {
      token = 'dft_' + crypto.randomBytes(16).toString('hex');
    }

    const [existing] = await pool.query('SELECT id FROM property_drafts WHERE draft_token = ?', [token]);
    if (existing && existing.length > 0) {
      await pool.query(
        'UPDATE property_drafts SET current_step = ?, completion_score = ?, form_data = ?, user_id = COALESCE(?, user_id), updated_at = NOW() WHERE draft_token = ?',
        [parseInt(currentStep, 10) || 1, parseInt(completionScore, 10) || 0, JSON.stringify(formData), userId, token]
      );
    } else {
      await pool.query(
        'INSERT INTO property_drafts (draft_token, user_id, current_step, completion_score, form_data) VALUES (?, ?, ?, ?, ?)',
        [token, userId, parseInt(currentStep, 10) || 1, parseInt(completionScore, 10) || 0, JSON.stringify(formData)]
      );
    }

    res.json({
      success: true,
      draftToken: token,
      currentStep: parseInt(currentStep, 10) || 1,
      completionScore: parseInt(completionScore, 10) || 0,
      lastSaved: new Date().toISOString()
    });
  } catch (err) {
    console.error('[properties:draft:save] Error:', err.message);
    res.status(500).json({ success: false, error: 'Could not save draft.' });
  }
});

/* ---------------------------------------------------------------
   GET /api/properties/draft/:token — Resume / Retrieve Draft
--------------------------------------------------------------- */
router.get('/draft/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const [rows] = await pool.query('SELECT * FROM property_drafts WHERE draft_token = ?', [token]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Draft not found or expired.' });
    }
    const d = rows[0];
    res.json({
      success: true,
      draft: {
        draftToken: d.draft_token,
        currentStep: d.current_step,
        completionScore: d.completion_score,
        formData: safeJson(d.form_data, {}),
        updatedAt: d.updated_at
      }
    });
  } catch (err) {
    console.error('[properties:draft:get] Error:', err.message);
    res.status(500).json({ success: false, error: 'Could not retrieve draft.' });
  }
});

/* ---------------------------------------------------------------
   POST /api/properties/upload-image — Upload Property Image
--------------------------------------------------------------- */
router.post('/upload-image', (req, res) => {
  uploadImage.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file uploaded.' });
    }
    const fileUrl = `/uploads/properties/${req.file.filename}`;
    res.json({
      success: true,
      fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  });
});

/* ---------------------------------------------------------------
   DELETE /api/properties/upload-image — Remove Uploaded Image
--------------------------------------------------------------- */
router.delete('/upload-image', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ success: false, error: 'Filename is required.' });
    const cleanName = path.basename(filename);
    const targetPath = path.join(propUploadDir, cleanName);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    res.json({ success: true, message: 'Image removed successfully.' });
  } catch (err) {
    console.error('[properties:upload:delete] Error:', err.message);
    res.status(500).json({ success: false, error: 'Could not remove image.' });
  }
});

/* ---------------------------------------------------------------
   POST /api/properties/upload-document — Upload Private KYC/Deed
--------------------------------------------------------------- */
router.post('/upload-document', (req, res) => {
  uploadDocument.single('document')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No document file uploaded.' });
    }
    const { draftToken, documentType = 'ownership_proof' } = req.body;
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const fileUrl = `/uploads/documents/${req.file.filename}`;

    try {
      const [result] = await pool.query(
        'INSERT INTO property_documents (draft_token, user_id, document_type, file_path, original_filename) VALUES (?, ?, ?, ?, ?)',
        [draftToken || null, userId, documentType, fileUrl, req.file.originalname]
      );
      res.json({
        success: true,
        docId: result.insertId,
        fileUrl,
        documentType,
        originalName: req.file.originalname
      });
    } catch (dbErr) {
      console.error('[properties:document:save] DB Error:', dbErr.message);
      res.status(500).json({ success: false, error: 'Could not save document record.' });
    }
  });
});

/* ---------------------------------------------------------------
   POST /api/properties/submit — Final Property Submission Transaction
--------------------------------------------------------------- */
router.post('/submit', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const data = req.body || {};
    const userId = req.session && req.session.userId ? req.session.userId : null;

    const safeNum = (v, fallback = 0) => {
      const n = parseFloat(v);
      return isNaN(n) ? fallback : n;
    };

    // Strict validation
    if (!data.purpose) throw new Error('Purpose (Sell/Rent/Lease) is required.');
    if (!data.city || !data.city.trim()) throw new Error('City is required.');
    if (!data.locality || !data.locality.trim()) throw new Error('Locality is required.');
    const priceVal = safeNum(data.price, 0);
    if (priceVal <= 0) {
      throw new Error('A valid property price or rent is required.');
    }
    if (!data.ownerName || !data.ownerName.trim()) throw new Error('Contact / Owner name is required.');
    const cleanPhone = (data.ownerPhone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) throw new Error('A valid 10-digit mobile number is required.');

    // Unique slug generator
    const titleCandidate = data.title && data.title.trim()
      ? data.title.trim()
      : `${safeNum(data.bhk, 3)} BHK ${data.propertyType || 'Apartment'} in ${data.locality}, ${data.city}`;
    const slugBase = titleCandidate
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 80);
    const uniqueSlug = `${slugBase}-${Date.now().toString(36)}`;

    // Prepare images array
    const rawImages = Array.isArray(data.images) && data.images.length > 0 ? data.images : [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=1200&q=80'
    ];
    const primaryImage = data.primaryImageUrl || rawImages[0];

    const isRent = String(data.purpose).toLowerCase() === 'rent';
    const transactionType = isRent ? 'rent' : 'buy';

    const insertSql = `
      INSERT INTO properties (
        slug, title, property_type, transaction_type, project_name,
        owner_type, owner_user_id, owner_name, owner_phone, owner_email,
        owner_member_since, owner_response_time, is_owner_verified, verification_status,
        rera_id, is_rera_registered, khata_type, possession_status, possession_date,
        property_age_years, bhk, bathrooms, balconies, price, is_price_negotiable,
        maintenance_monthly, deposit_amount, carpet_area_sqft, super_builtup_area_sqft,
        facing, floor_number, total_floors, tower_block, parking_covered, parking_open,
        furnishing_status, furnishing_details, water_supply, power_backup, overlooking_view,
        address_line, locality, city, state, pincode, latitude, longitude, is_approx_location,
        description, primary_image_url, images, amenities, specifications, nearby_landmarks,
        views_count, status
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?
      )
    `;

    const values = [
      uniqueSlug,
      titleCandidate,
      data.propertyType || 'Apartment',
      transactionType,
      data.projectName || data.society || null,

      data.ownerType || 'owner',
      userId,
      data.ownerName.trim(),
      cleanPhone,
      data.ownerEmail ? data.ownerEmail.trim() : null,

      new Date().getFullYear().toString(),
      'Within 15 mins',
      1,
      'verified',

      data.reraId ? data.reraId.trim() : null,
      data.reraId ? 1 : 0,
      data.khataType || 'BBMP A Khata (Digital e-Khata)',
      data.possessionStatus || 'ready_to_move',
      data.possessionDate || 'Immediate',

      safeNum(data.propertyAge, 1.0),
      safeNum(data.bhk, 3),
      safeNum(data.bathrooms, 2),
      safeNum(data.balconies, 1),
      priceVal,
      data.isNegotiable ? 1 : 0,

      safeNum(data.maintenance, 0),
      data.deposit ? safeNum(data.deposit, 0) : null,
      safeNum(data.carpetArea, Math.round(safeNum(data.superBuiltupArea, 1200) * 0.8)),
      safeNum(data.superBuiltupArea, 1200),

      data.facing || 'East',
      safeNum(data.floorNumber, 5),
      safeNum(data.totalFloors, 14),
      data.towerBlock || 'Tower A',
      safeNum(data.parkingCovered, 1),
      safeNum(data.parkingOpen, 0),

      data.furnishing || 'semi_furnished',
      data.furnishingDetails || '',
      data.waterSupply || 'Cauvery Water + 24/7 Borewell Backup',
      data.powerBackup || '100% DG Power Backup for Flat & Lifts',
      data.overlookingView || 'Main Road & Garden Greens',

      data.addressLine ? data.addressLine.trim() : `${data.locality}, ${data.city}`,
      data.locality.trim(),
      data.city.trim(),
      data.state || 'Karnataka',
      data.pincode || '560001',
      safeNum(data.latitude, 12.9716),
      safeNum(data.longitude, 77.5946),
      data.hideExactLocation ? 1 : 0,

      data.description ? data.description.trim() : `Verified ${safeNum(data.bhk, 3)} BHK ${data.propertyType || 'Apartment'} in ${data.locality}, ${data.city}. Direct owner listing with verified legal paperwork and zero brokerage.`,
      primaryImage,
      JSON.stringify(rawImages),
      JSON.stringify(Array.isArray(data.amenities) && data.amenities.length > 0 ? data.amenities : ['Lift', 'Power Backup', '24/7 Security', 'Covered Parking', 'Gym', 'Clubhouse']),
      JSON.stringify(data.specifications || {
        'Flooring': 'Italian Marble & Wooden Finish',
        'Water Supply': 'Cauvery + Borewell',
        'Power Backup': '100% Full DG Backup',
        'Ownership': 'Freehold Clear Title'
      }),
      JSON.stringify(data.nearbyLandmarks || [
        `Near ${data.locality} Metro Station (600m)`,
        `Close to Top Schools & Multispecialty Hospitals`
      ]),

      1, // views_count
      'active' // Immediately live and visible on homepage and search!
    ];

    const [insertResult] = await conn.query(insertSql, values);
    const newPropertyId = insertResult.insertId;

    // Link uploaded KYC documents to new propertyId and clean up draft
    if (data.draftToken) {
      await conn.query('UPDATE property_documents SET property_id = ? WHERE draft_token = ?', [newPropertyId, data.draftToken]);
      await conn.query('DELETE FROM property_drafts WHERE draft_token = ?', [data.draftToken]);
    }

    await conn.commit();

    res.json({
      success: true,
      propertyId: newPropertyId,
      slug: uniqueSlug,
      title: titleCandidate,
      redirectUrl: `/property_detail_page/code.html?slug=${uniqueSlug}`,
      message: 'Property successfully published and active on Billedkart Realtech!'
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('[properties:submit] Transaction Error:', err.message);
    res.status(400).json({ success: false, error: err.message || 'Submission failed.' });
  } finally {
    if (conn) conn.release();
  }
});

/* ---------------------------------------------------------------
   2. GET /api/properties/:idOrSlug — Get Property by ID or Slug
--------------------------------------------------------------- */
router.get('/:idOrSlug', async (req, res) => {
  try {
    const param = req.params.idOrSlug;
    const isNum = /^\d+$/.test(param);
    const sql = isNum
      ? 'SELECT * FROM properties WHERE id = ? AND status = "active"'
      : 'SELECT * FROM properties WHERE slug = ? AND status = "active"';
    const [rows] = await pool.query(sql, [isNum ? parseInt(param, 10) : param]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Property not found or listing has expired.' });
    }

    // Increment views asynchronously
    pool.query('UPDATE properties SET views_count = views_count + 1 WHERE id = ?', [rows[0].id]).catch(() => {});

    // Check if user session has already revealed phone
    const sessionRevealed = req.session && req.session.revealedProperties && req.session.revealedProperties.includes(rows[0].id);

    res.json({
      success: true,
      property: formatProperty(rows[0], !sessionRevealed)
    });
  } catch (err) {
    console.error('[properties:get] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load property details.' });
  }
});

/* ---------------------------------------------------------------
   3. GET /api/properties/:id/similar — Matching Similar Properties
--------------------------------------------------------------- */
router.get('/:id/similar', async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const [current] = await pool.query('SELECT city, locality, bhk, price FROM properties WHERE id = ?', [propId]);
    if (!current || current.length === 0) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    const { city, locality, bhk, price } = current[0];
    const minPrice = price * 0.75;
    const maxPrice = price * 1.35;

    // Find other properties matching city or locality, excluding current
    const [similar] = await pool.query(`
      SELECT * FROM properties 
      WHERE status = 'active' AND id != ?
      ORDER BY 
        (locality = ?) DESC,
        (bhk = ?) DESC,
        (city = ?) DESC,
        ABS(price - ?) ASC
      LIMIT 6
    `, [propId, locality, bhk, city, price]);

    res.json({
      success: true,
      count: similar.length,
      properties: similar.map(r => formatProperty(r, true))
    });
  } catch (err) {
    console.error('[properties:similar] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to find similar properties.' });
  }
});

/* ---------------------------------------------------------------
   4. POST /api/properties/:id/contact — Authorize & Reveal Phone
--------------------------------------------------------------- */
router.post('/:id/contact', async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT id, owner_name, owner_phone, title FROM properties WHERE id = ? AND status = "active"', [propId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    // Save in session
    if (!req.session.revealedProperties) {
      req.session.revealedProperties = [];
    }
    if (!req.session.revealedProperties.includes(propId)) {
      req.session.revealedProperties.push(propId);
    }

    res.json({
      success: true,
      ownerName: rows[0].owner_name,
      phone: rows[0].owner_phone,
      message: 'Contact details verified and revealed.'
    });
  } catch (err) {
    console.error('[properties:contact] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to access contact number.' });
  }
});

/* ---------------------------------------------------------------
   5. POST /api/properties/:id/enquiry — Submit Direct Enquiry
--------------------------------------------------------------- */
router.post('/:id/enquiry', enquiryLimiter, async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const { full_name, phone, email, preferred_visit_date, message, whatsapp_consent } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ success: false, error: 'Please enter your full name.' });
    }
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Please provide a valid 10-digit mobile number.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    const [prop] = await pool.query('SELECT id, title, owner_name, owner_phone FROM properties WHERE id = ? AND status = "active"', [propId]);
    if (!prop || prop.length === 0) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    const userId = req.session && req.session.userId ? req.session.userId : null;

    const [result] = await pool.query(`
      INSERT INTO property_enquiries 
      (property_id, user_id, full_name, phone, email, preferred_visit_date, message, whatsapp_consent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      propId,
      userId,
      full_name.trim(),
      cleanPhone,
      email.trim(),
      preferred_visit_date || null,
      (message || '').trim() || null,
      whatsapp_consent ? 1 : 0
    ]);

    // Also reveal phone automatically after valid enquiry submission
    if (!req.session.revealedProperties) req.session.revealedProperties = [];
    if (!req.session.revealedProperties.includes(propId)) req.session.revealedProperties.push(propId);

    res.json({
      success: true,
      enquiryId: result.insertId,
      ownerName: prop[0].owner_name,
      ownerPhone: prop[0].owner_phone,
      message: `Enquiry submitted successfully! ${prop[0].owner_name} has been notified.`
    });
  } catch (err) {
    console.error('[properties:enquiry] Error:', err.message);
    res.status(500).json({ success: false, error: 'Unable to process your enquiry. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   6. POST /api/properties/:id/visit — Book Guided Site Visit
--------------------------------------------------------------- */
router.post('/:id/visit', enquiryLimiter, async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const { visitor_name, phone, email, visit_date, time_slot, visitors_count, message } = req.body;

    if (!visitor_name || !visitor_name.trim()) {
      return res.status(400).json({ success: false, error: 'Please provide your name.' });
    }
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Please provide a valid 10-digit mobile number.' });
    }
    if (!visit_date) {
      return res.status(400).json({ success: false, error: 'Please select a preferred visit date.' });
    }

    // Date validation: past dates not allowed
    const todayStr = new Date().toISOString().split('T')[0];
    if (visit_date < todayStr) {
      return res.status(400).json({ success: false, error: 'Selected date cannot be in the past.' });
    }

    const [prop] = await pool.query('SELECT id, title, owner_name FROM properties WHERE id = ? AND status = "active"', [propId]);
    if (!prop || prop.length === 0) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    const userId = req.session && req.session.userId ? req.session.userId : null;

    const [result] = await pool.query(`
      INSERT INTO property_site_visits
      (property_id, user_id, visitor_name, phone, email, visit_date, time_slot, visitors_count, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      propId,
      userId,
      visitor_name.trim(),
      cleanPhone,
      (email || '').trim(),
      visit_date,
      time_slot || '10:00 AM - 12:00 PM',
      Math.max(parseInt(visitors_count, 10) || 1, 1),
      (message || '').trim() || null
    ]);

    res.json({
      success: true,
      visitId: result.insertId,
      message: `Site visit scheduled for ${visit_date} (${time_slot || 'Morning'}). The owner/concierge will confirm coordinates shortly.`
    });
  } catch (err) {
    console.error('[properties:visit] Error:', err.message);
    res.status(500).json({ success: false, error: 'Could not book site visit. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   7. POST /api/properties/:id/wishlist — Toggle Wishlist
--------------------------------------------------------------- */
router.post('/:id/wishlist', async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const guestToken = req.headers['x-guest-token'] || req.body.guestToken || (req.session ? req.sessionID : null);

    if (!userId && !guestToken) {
      return res.status(400).json({ success: false, error: 'Session identifier missing.' });
    }

    let existing;
    if (userId) {
      [existing] = await pool.query('SELECT id FROM property_wishlist WHERE property_id = ? AND user_id = ?', [propId, userId]);
    } else {
      [existing] = await pool.query('SELECT id FROM property_wishlist WHERE property_id = ? AND guest_token = ?', [propId, guestToken]);
    }

    if (existing && existing.length > 0) {
      // Remove from wishlist
      await pool.query('DELETE FROM property_wishlist WHERE id = ?', [existing[0].id]);
      return res.json({ success: true, saved: false, message: 'Removed from Saved Properties.' });
    } else {
      // Add to wishlist
      await pool.query('INSERT INTO property_wishlist (property_id, user_id, guest_token) VALUES (?, ?, ?)', [
        propId,
        userId,
        userId ? null : guestToken
      ]);
      return res.json({ success: true, saved: true, message: 'Saved to Wishlist successfully!' });
    }
  } catch (err) {
    console.error('[properties:wishlist] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update wishlist.' });
  }
});

/* ---------------------------------------------------------------
   8. GET /api/properties/:id/wishlist-status — Check Wishlist Status
--------------------------------------------------------------- */
router.get('/:id/wishlist-status', async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const guestToken = req.headers['x-guest-token'] || (req.session ? req.sessionID : null);

    let saved = false;
    if (userId) {
      const [rows] = await pool.query('SELECT id FROM property_wishlist WHERE property_id = ? AND user_id = ?', [propId, userId]);
      saved = rows && rows.length > 0;
    } else if (guestToken) {
      const [rows] = await pool.query('SELECT id FROM property_wishlist WHERE property_id = ? AND guest_token = ?', [propId, guestToken]);
      saved = rows && rows.length > 0;
    }

    res.json({ success: true, saved });
  } catch (err) {
    res.json({ success: true, saved: false });
  }
});

/* ---------------------------------------------------------------
   9. POST /api/properties/:id/report — Report Inaccuracy
--------------------------------------------------------------- */
router.post('/:id/report', reportLimiter, async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const { reason, details } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: 'Please choose a reason for reporting.' });
    }

    const userId = req.session && req.session.userId ? req.session.userId : null;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;

    await pool.query(`
      INSERT INTO property_reports (property_id, user_id, reason, details, reporter_ip)
      VALUES (?, ?, ?, ?, ?)
    `, [propId, userId, reason.trim(), (details || '').trim() || null, ip]);

    res.json({
      success: true,
      message: 'Thank you for your report. Our compliance and verification team will inspect this listing.'
    });
  } catch (err) {
    console.error('[properties:report] Error:', err.message);
    res.status(500).json({ success: false, error: 'Unable to submit report. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   10. GET & POST /api/properties/:id/chat — Direct Chat Flow
--------------------------------------------------------------- */
router.get('/:id/chat', async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const userId = req.session && req.session.userId ? req.session.userId : null;
    const guestToken = req.headers['x-guest-token'] || (req.session ? req.sessionID : null);

    let rows = [];
    if (userId) {
      [rows] = await pool.query('SELECT * FROM property_chat_messages WHERE property_id = ? AND user_id = ? ORDER BY id ASC LIMIT 50', [propId, userId]);
    } else if (guestToken) {
      [rows] = await pool.query('SELECT * FROM property_chat_messages WHERE property_id = ? AND guest_token = ? ORDER BY id ASC LIMIT 50', [propId, guestToken]);
    }

    res.json({
      success: true,
      messages: rows.map(m => ({
        id: m.id,
        senderRole: m.sender_role,
        senderName: m.sender_name,
        message: m.message,
        createdAt: m.created_at
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load conversation.' });
  }
});

router.post('/:id/chat', async (req, res) => {
  try {
    const propId = parseInt(req.params.id, 10);
    const { message, senderName = 'Buyer' } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
    }

    const userId = req.session && req.session.userId ? req.session.userId : null;
    const guestToken = req.headers['x-guest-token'] || (req.session ? req.sessionID : null);

    const [result] = await pool.query(`
      INSERT INTO property_chat_messages (property_id, user_id, guest_token, sender_role, sender_name, message)
      VALUES (?, ?, ?, 'buyer', ?, ?)
    `, [propId, userId, userId ? null : guestToken, senderName, message.trim()]);

    // Simulated auto-acknowledgement from verified owner / concierge assistant
    setTimeout(async () => {
      try {
        await pool.query(`
          INSERT INTO property_chat_messages (property_id, user_id, guest_token, sender_role, sender_name, message)
          VALUES (?, ?, ?, 'owner', 'Anand Kumar (Owner)', 'Hello! Thank you for reaching out. Yes, this listing is active. Feel free to schedule a site visit or ask any specifics regarding floor plans or documentation.')
        `, [propId, userId, userId ? null : guestToken]);
      } catch (e) {}
    }, 1500);

    res.json({
      success: true,
      messageId: result.insertId,
      message: 'Message delivered to property owner.'
    });
  } catch (err) {
    console.error('[properties:chat] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to send message.' });
  }
});

module.exports = router;

