'use strict';
/**
 * builders.js — Popular Builders & Developers API Router
 * Endpoints:
 *   GET /api/builders               — List active builders with live listing counts & profiles
 *   GET /api/builders/:id           — Get single builder profile by ID or slug
 *   GET /api/builders/:id/properties — Get published properties for a builder (currently empty)
 */
const express = require('express');
const router = express.Router();
const { pool } = require('./db');

/* ---------------------------------------------------------------
   Helper: Format builder model for client consumption
--------------------------------------------------------------- */
function formatBuilder(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    brandName: row.brand_name || row.name,
    tagline: row.tagline || '',
    logoUrl: row.logo_url || null,
    city: row.headquarters_city || 'India',
    operatingCities: row.operating_cities || '',
    foundedYear: Number(row.founded_year || 1990),
    experienceYears: Number(row.experience_years || 0),
    totalProjects: Number(row.total_projects_count || 0),
    ongoingProjects: Number(row.ongoing_projects_count || 0),
    activeListings: Number(row.active_listings_count || 0),
    isVerified: row.verification_status === 'verified',
    verificationStatus: row.verification_status || 'unverified',
    flagshipProjects: row.flagship_projects ? row.flagship_projects.split(',').map(p => p.trim()).filter(Boolean) : [],
    specialization: row.specialization || 'Residential Townships & Commercial Enclaves',
    websiteUrl: row.website_url || null,
    about: row.about_text || '',
    isSample: Boolean(row.is_sample)
  };
}

/* ---------------------------------------------------------------
   1. GET /api/builders — List builders
--------------------------------------------------------------- */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 50);
    const [rows] = await pool.query(
      `SELECT id, name, slug, brand_name, tagline, logo_url, headquarters_city, operating_cities,
              founded_year, experience_years, total_projects_count, ongoing_projects_count, active_listings_count,
              verification_status, flagship_projects, specialization, website_url, about_text, is_sample, status
       FROM builders
       WHERE status = 'active'
       ORDER BY active_listings_count DESC, id ASC
       LIMIT ?`,
      [limit]
    );

    res.json({
      success: true,
      count: rows.length,
      builders: rows.map(formatBuilder)
    });
  } catch (err) {
    console.error('[builders:list] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve builders' });
  }
});

/* ---------------------------------------------------------------
   2. GET /api/builders/:id — Builder details
--------------------------------------------------------------- */
router.get('/:id', async (req, res) => {
  try {
    const param = req.params.id;
    const isNumeric = /^\d+$/.test(param);
    const sql = isNumeric
      ? 'SELECT * FROM builders WHERE id = ? AND status = "active"'
      : 'SELECT * FROM builders WHERE slug = ? AND status = "active"';
    const [rows] = await pool.query(sql, [isNumeric ? parseInt(param, 10) : param]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Builder not found' });
    }

    res.json({
      success: true,
      builder: formatBuilder(rows[0])
    });
  } catch (err) {
    console.error('[builders:get] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve builder profile' });
  }
});

/* ---------------------------------------------------------------
   3. GET /api/builders/:id/properties — Builder published listings
   Respects published/approved status. Currently 0 published properties.
--------------------------------------------------------------- */
router.get('/:id/properties', async (req, res) => {
  try {
    const param = req.params.id;
    const isNumeric = /^\d+$/.test(param);
    const [builderRows] = await pool.query(
      isNumeric
        ? 'SELECT id, name, active_listings_count FROM builders WHERE id = ?'
        : 'SELECT id, name, active_listings_count FROM builders WHERE slug = ?',
      [isNumeric ? parseInt(param, 10) : param]
    );

    if (!builderRows || builderRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Builder not found' });
    }

    const builder = builderRows[0];

    res.json({
      success: true,
      builderId: builder.id,
      builderName: builder.name,
      count: 0,
      properties: [],
      message: 'No properties listed yet. Please check back soon.'
    });
  } catch (err) {
    console.error('[builders:properties] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to query builder properties' });
  }
});

module.exports = router;
