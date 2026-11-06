'use strict';
/**
 * saved-properties.js — Billedkart Realtech Saved Properties / Wishlist API
 * 
 * Endpoints:
 *   GET    /api/saved-properties            — Get authenticated user's saved properties with full card models
 *   POST   /api/saved-properties/:propertyId — Add property to wishlist
 *   DELETE /api/saved-properties/:propertyId — Remove property from wishlist
 *   POST   /api/saved-properties/toggle/:propertyId — Toggle save / unsave
 *   GET    /api/saved-properties/status/:propertyId — Check if property is saved by current user
 *   GET    /api/saved-properties/count      — Get total saved count for authenticated user
 */

const express = require('express');
const router = express.Router();
const { pool } = require('./db');
const propertiesRouter = require('./properties');
const formatProperty = propertiesRouter.formatProperty || ((row) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  price: Number(row.price || 0),
  priceFormatted: Number(row.price || 0) >= 10000000 ? `₹${(Number(row.price || 0) / 10000000).toFixed(2)} Cr` : `₹${(Number(row.price || 0) / 100000).toFixed(2)} Lac`,
  bhk: Number(row.bhk || 0),
  locality: row.locality,
  city: row.city,
  propertyType: row.property_type,
  primaryImageUrl: row.primary_image_url
}));

/**
 * Authentication Middleware for Saved Properties
 */
function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId ? req.session.userId : null;
  if (!userId) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      count: 0,
      properties: [],
      error: 'Authentication required. Please sign in to access your saved properties.'
    });
  }
  req.userId = userId;
  next();
}

/**
 * Helper to fetch total saved properties count for a user
 */
async function getUserSavedCount(userId) {
  if (!userId) return 0;
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS total FROM property_wishlist WHERE user_id = ?', [userId]);
    return rows && rows[0] ? Number(rows[0].total) : 0;
  } catch (err) {
    console.error('[saved-properties:count] Error:', err.message);
    return 0;
  }
}

/* ---------------------------------------------------------------
   1. GET /api/saved-properties — Fetch Authenticated User's Saved Properties
--------------------------------------------------------------- */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;

    const [rows] = await pool.query(`
      SELECT 
        p.*,
        pw.created_at AS saved_at
      FROM property_wishlist pw
      JOIN properties p ON pw.property_id = p.id
      WHERE pw.user_id = ?
      ORDER BY pw.created_at DESC
    `, [userId]);

    const formatted = rows.map(row => {
      const formattedProp = formatProperty(row, true);
      formattedProp.savedAt = row.saved_at;
      return formattedProp;
    });

    res.json({
      success: true,
      authenticated: true,
      count: formatted.length,
      properties: formatted
    });
  } catch (err) {
    console.error('[saved-properties:list] Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve saved properties. Please try again.'
    });
  }
});

/* ---------------------------------------------------------------
   2. GET /api/saved-properties/count — Get Total Saved Count
--------------------------------------------------------------- */
router.get('/count', async (req, res) => {
  try {
    const userId = req.session && req.session.userId ? req.session.userId : null;
    if (!userId) {
      return res.json({
        success: true,
        authenticated: false,
        count: 0
      });
    }

    const count = await getUserSavedCount(userId);
    res.json({
      success: true,
      authenticated: true,
      count
    });
  } catch (err) {
    console.error('[saved-properties:count] Error:', err.message);
    res.json({ success: true, count: 0, authenticated: false });
  }
});

/* ---------------------------------------------------------------
   3. GET /api/saved-properties/status/:propertyId — Check if Saved
--------------------------------------------------------------- */
router.get('/status/:propertyId', async (req, res) => {
  try {
    const propId = parseInt(req.params.propertyId, 10);
    if (isNaN(propId) || propId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid property ID.' });
    }

    const userId = req.session && req.session.userId ? req.session.userId : null;
    if (!userId) {
      return res.json({
        success: true,
        authenticated: false,
        saved: false
      });
    }

    const [rows] = await pool.query(
      'SELECT id FROM property_wishlist WHERE property_id = ? AND user_id = ? LIMIT 1',
      [propId, userId]
    );

    res.json({
      success: true,
      authenticated: true,
      saved: rows.length > 0
    });
  } catch (err) {
    console.error('[saved-properties:status] Error:', err.message);
    res.json({ success: true, saved: false, authenticated: false });
  }
});

/* ---------------------------------------------------------------
   4. POST /api/saved-properties/:propertyId — Save Property (Idempotent)
--------------------------------------------------------------- */
router.post('/:propertyId', requireAuth, async (req, res) => {
  try {
    const propId = parseInt(req.params.propertyId, 10);
    if (isNaN(propId) || propId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid property ID.' });
    }

    const userId = req.userId;

    // Verify property exists
    const [propCheck] = await pool.query('SELECT id, title FROM properties WHERE id = ?', [propId]);
    if (propCheck.length === 0) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    // Check if already saved
    const [existing] = await pool.query(
      'SELECT id FROM property_wishlist WHERE property_id = ? AND user_id = ? LIMIT 1',
      [propId, userId]
    );

    if (existing.length > 0) {
      const count = await getUserSavedCount(userId);
      return res.json({
        success: true,
        saved: true,
        alreadySaved: true,
        count,
        message: 'Property is already in your Saved Properties.'
      });
    }

    // Insert into wishlist
    await pool.query(
      'INSERT INTO property_wishlist (property_id, user_id) VALUES (?, ?)',
      [propId, userId]
    );

    const count = await getUserSavedCount(userId);
    res.status(201).json({
      success: true,
      saved: true,
      count,
      message: 'Saved to your Wishlist!'
    });
  } catch (err) {
    console.error('[saved-properties:save] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save property. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   5. DELETE /api/saved-properties/:propertyId — Remove Saved Property
--------------------------------------------------------------- */
router.delete('/:propertyId', requireAuth, async (req, res) => {
  try {
    const propId = parseInt(req.params.propertyId, 10);
    if (isNaN(propId) || propId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid property ID.' });
    }

    const userId = req.userId;

    await pool.query(
      'DELETE FROM property_wishlist WHERE property_id = ? AND user_id = ?',
      [propId, userId]
    );

    const count = await getUserSavedCount(userId);
    res.json({
      success: true,
      saved: false,
      count,
      message: 'Removed from Saved Properties.'
    });
  } catch (err) {
    console.error('[saved-properties:remove] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to remove saved property. Please try again.' });
  }
});

/* ---------------------------------------------------------------
   6. POST /api/saved-properties/toggle/:propertyId — Toggle Save / Unsave
--------------------------------------------------------------- */
router.post('/toggle/:propertyId', requireAuth, async (req, res) => {
  try {
    const propId = parseInt(req.params.propertyId, 10);
    if (isNaN(propId) || propId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid property ID.' });
    }

    const userId = req.userId;

    // Verify property exists
    const [propCheck] = await pool.query('SELECT id, title FROM properties WHERE id = ?', [propId]);
    if (propCheck.length === 0) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM property_wishlist WHERE property_id = ? AND user_id = ? LIMIT 1',
      [propId, userId]
    );

    if (existing.length > 0) {
      // Remove
      await pool.query('DELETE FROM property_wishlist WHERE id = ?', [existing[0].id]);
      const count = await getUserSavedCount(userId);
      return res.json({
        success: true,
        saved: false,
        count,
        message: 'Removed from Saved Properties.'
      });
    } else {
      // Add
      await pool.query('INSERT INTO property_wishlist (property_id, user_id) VALUES (?, ?)', [propId, userId]);
      const count = await getUserSavedCount(userId);
      return res.json({
        success: true,
        saved: true,
        count,
        message: 'Saved to your Wishlist!'
      });
    }
  } catch (err) {
    console.error('[saved-properties:toggle] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update saved status.' });
  }
});

module.exports = router;
