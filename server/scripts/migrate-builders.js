'use strict';
/**
 * migrate-builders.js — Idempotent migration for Popular Builders system.
 * Run: node server/scripts/migrate-builders.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const BUILDER_LOGOS = {
  'prestige-group': `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" fill="none"><rect width="160" height="48" rx="8" fill="#ffffff"/><g transform="translate(8, 6)"><path d="M18 2L32 10V26L18 34L4 26V10L18 2Z" fill="#00236f" stroke="#b8860b" stroke-width="1.5"/><path d="M12 11H20C22.2 11 24 12.8 24 15C24 17.2 22.2 19 20 19H16V25H12V11Z" fill="#b8860b"/><circle cx="18" cy="15" r="1.5" fill="#ffffff"/></g><text x="46" y="23" font-family="Cinzel, Georgia, serif" font-size="14" font-weight="800" fill="#00236f" letter-spacing="1.5">PRESTIGE</text><text x="47" y="35" font-family="'Plus Jakarta Sans', sans-serif" font-size="8" font-weight="700" fill="#b8860b" letter-spacing="3">GROUP</text></svg>`)}`,

  'sobha-limited': `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" fill="none"><rect width="160" height="48" rx="8" fill="#ffffff"/><g transform="translate(8, 8)"><rect x="2" y="2" width="28" height="28" rx="4" fill="#0f172a"/><path d="M8 8H24V14H14V20H24V26H8V8Z" fill="#d97706"/><polygon points="18,14 24,14 24,20" fill="#f59e0b"/></g><text x="46" y="24" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="15" font-weight="900" fill="#0f172a" letter-spacing="1">SOBHA</text><text x="47" y="35" font-family="'Plus Jakarta Sans', sans-serif" font-size="7.5" font-weight="600" fill="#d97706" letter-spacing="1.2">PASSION AT WORK</text></svg>`)}`,

  'godrej-properties': `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" fill="none"><rect width="160" height="48" rx="8" fill="#ffffff"/><g transform="translate(8, 7)"><path d="M4 18C4 10 10 4 18 4C23 4 27 7 29 11L24 14C23 11 20 9 17 9C13 9 9 13 9 18C9 23 13 27 18 27C21 27 24 25 26 23V19H18V15H30V25C27 29 23 31 18 31C10 31 4 25 4 18Z" fill="#dc2626"/><path d="M30 6L33 10L27 12Z" fill="#16a34a"/></g><text x="46" y="21" font-family="'Plus Jakarta Sans', sans-serif" font-size="13" font-weight="800" fill="#dc2626" letter-spacing="0.5">Godrej</text><text x="46" y="34" font-family="'Plus Jakarta Sans', sans-serif" font-size="8.5" font-weight="700" fill="#1e293b" letter-spacing="2">PROPERTIES</text></svg>`)}`,

  'brigade-group': `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" fill="none"><rect width="160" height="48" rx="8" fill="#ffffff"/><g transform="translate(10, 8)"><path d="M6 26L16 6L26 26H6Z" fill="#ea580c"/><path d="M16 6L26 26L20 26L16 16L12 26L6 26L16 6Z" fill="#c2410c"/><circle cx="16" cy="18" r="3" fill="#ffffff"/></g><text x="46" y="24" font-family="'Plus Jakarta Sans', sans-serif" font-size="14" font-weight="900" fill="#0f172a" letter-spacing="1">BRIGADE</text><text x="47" y="35" font-family="'Plus Jakarta Sans', sans-serif" font-size="7" font-weight="600" fill="#ea580c" letter-spacing="1">BUILDING POSITIVE</text></svg>`)}`,

  'dlf-limited': `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" fill="none"><rect width="160" height="48" rx="8" fill="#ffffff"/><g transform="translate(10, 10)"><polygon points="0,28 14,0 28,28" fill="#1e3a8a"/>Polygon points="14,6 24,25 4,25" fill="#ffffff"/><polygon points="14,10 20,23 8,23" fill="#1e3a8a"/></g><text x="46" y="24" font-family="Cinzel, Georgia, serif" font-size="16" font-weight="900" fill="#1e3a8a" letter-spacing="2">DLF</text><text x="47" y="35" font-family="'Plus Jakarta Sans', sans-serif" font-size="7.5" font-weight="700" fill="#64748b" letter-spacing="2">BUILDING INDIA</text></svg>`)}`,

  'lodha-group': `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" fill="none"><rect width="160" height="48" rx="8" fill="#ffffff"/><g transform="translate(10, 8)"><circle cx="16" cy="16" r="14" fill="#18181b"/><path d="M12 9H16V20H22V23H12V9Z" fill="#eab308"/><path d="M16 6L18 8H14L16 6Z" fill="#eab308"/></g><text x="46" y="23" font-family="Cinzel, Georgia, serif" font-size="14" font-weight="800" fill="#18181b" letter-spacing="1.5">LODHA</text><text x="47" y="34" font-family="'Plus Jakarta Sans', sans-serif" font-size="7" font-weight="600" fill="#ca8a04" letter-spacing="1.5">BUILDING A BETTER LIFE</text></svg>`)}`,

  'puravankara': `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" fill="none"><rect width="160" height="48" rx="8" fill="#ffffff"/><g transform="translate(8, 8)"><path d="M6 28V12C6 6 12 2 18 2C24 2 30 6 30 12V28H24V14C24 10 21 8 18 8C15 8 12 10 12 14V28H6Z" fill="#0369a1"/><rect x="14" y="16" width="8" height="12" fill="#0284c7"/></g><text x="44" y="23" font-family="'Plus Jakarta Sans', sans-serif" font-size="11.5" font-weight="900" fill="#0f172a" letter-spacing="1">PURAVANKARA</text><text x="45" y="34" font-family="'Plus Jakarta Sans', sans-serif" font-size="7.5" font-weight="600" fill="#0284c7" letter-spacing="1">HOMES FOR LIFETIME</text></svg>`)}`,

  'mahindra-lifespaces': `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" fill="none"><rect width="160" height="48" rx="8" fill="#ffffff"/><g transform="translate(8, 9)"><path d="M4 22L12 6L20 22L16 22L12 13L8 22H4Z" fill="#e11d48"/><path d="M16 22L24 6L32 22L28 22L24 13L20 22H16Z" fill="#0f172a"/></g><text x="44" y="20" font-family="'Plus Jakarta Sans', sans-serif" font-size="11.5" font-weight="800" fill="#e11d48">Mahindra</text><text x="44" y="33" font-family="'Plus Jakarta Sans', sans-serif" font-size="8" font-weight="700" fill="#334155" letter-spacing="1">LIFESPACES</text></svg>`)}`
};

async function migrateBuilders() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  const dbName = process.env.DB_NAME || 'vastu_reviews';
  console.log(`[migrate-builders] Connecting to database '${dbName}'…`);
  await conn.query(`USE \`${dbName}\``);

  console.log('[migrate-builders] Checking and adding profile columns to `builders` table…');
  const [existingCols] = await conn.query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'builders'
  `, [dbName]);

  const colSet = new Set(existingCols.map(c => c.COLUMN_NAME));

  if (!colSet.has('tagline')) {
    await conn.query('ALTER TABLE builders ADD COLUMN tagline VARCHAR(200) NULL AFTER brand_name');
  }
  if (!colSet.has('founded_year')) {
    await conn.query('ALTER TABLE builders ADD COLUMN founded_year INT UNSIGNED NOT NULL DEFAULT 1990 AFTER operating_cities');
  }
  if (!colSet.has('ongoing_projects_count')) {
    await conn.query('ALTER TABLE builders ADD COLUMN ongoing_projects_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER total_projects_count');
  }
  if (!colSet.has('flagship_projects')) {
    await conn.query('ALTER TABLE builders ADD COLUMN flagship_projects TEXT NULL AFTER verification_status');
  }
  if (!colSet.has('specialization')) {
    await conn.query('ALTER TABLE builders ADD COLUMN specialization VARCHAR(255) NULL AFTER flagship_projects');
  }
  await conn.query('ALTER TABLE builders MODIFY COLUMN logo_url TEXT NULL');

  console.log('[migrate-builders] Updating/seeding professional builder profiles & vector logos...');
  const detailedBuilders = [
    {
      name: 'Prestige Group',
      slug: 'prestige-group',
      brand_name: 'Prestige Group',
      tagline: 'Add Prestige to Your Life',
      logo_url: BUILDER_LOGOS['prestige-group'],
      headquarters_city: 'Bengaluru',
      operating_cities: 'Bengaluru, Hyderabad, Chennai, Kochi, Mumbai, Goa',
      founded_year: 1986,
      experience_years: 38,
      total_projects_count: 285,
      ongoing_projects_count: 54,
      active_listings_count: 0,
      verification_status: 'unverified',
      flagship_projects: 'Prestige Falcon City, Prestige Golfshire, Prestige Shantiniketan, Prestige Lakeside Habitat',
      specialization: 'Integrated Luxury Townships, High-Rise Towers & Forum Malls',
      website_url: 'https://www.prestigeconstructions.com',
      about_text: 'Founded in 1986 by Irfan Razack, Prestige Group is one of South India\'s leading real estate developers with over 285+ landmark residential, commercial, and retail developments spanning over 170+ million sq.ft.'
    },
    {
      name: 'Sobha Limited',
      slug: 'sobha-limited',
      brand_name: 'Sobha',
      tagline: 'Passion at Work',
      logo_url: BUILDER_LOGOS['sobha-limited'],
      headquarters_city: 'Bengaluru',
      operating_cities: 'Bengaluru, Pune, Chennai, Coimbatore, Delhi NCR, Mysuru',
      founded_year: 1995,
      experience_years: 29,
      total_projects_count: 130,
      ongoing_projects_count: 32,
      active_listings_count: 0,
      verification_status: 'unverified',
      flagship_projects: 'Sobha Dream Acres, Sobha City (Gurugram), Sobha Royal Pavilion, Sobha Forest Edge',
      specialization: 'In-House German Precision Engineering, Luxury Gated Villas & Condos',
      website_url: 'https://www.sobha.com',
      about_text: 'Founded by PNC Menon in 1995, Sobha is India\'s premier backward-integrated real estate developer, famed for exemplary German construction standards, self-manufactured interiors, and strict timeline adherence.'
    },
    {
      name: 'Godrej Properties',
      slug: 'godrej-properties',
      brand_name: 'Godrej Properties',
      tagline: 'Brighter Living by Design',
      logo_url: BUILDER_LOGOS['godrej-properties'],
      headquarters_city: 'Mumbai',
      operating_cities: 'Mumbai, Pune, Bengaluru, Delhi NCR, Kolkata',
      founded_year: 1990,
      experience_years: 34,
      total_projects_count: 190,
      ongoing_projects_count: 48,
      active_listings_count: 0,
      verification_status: 'unverified',
      flagship_projects: 'Godrej Woods, Godrej Air, Godrej Eternity, The Trees Vikhroli, Godrej Platinum',
      specialization: 'Sustainable Green Enclaves, IGBC Platinum Townships & Urban Highrises',
      website_url: 'https://www.godrejproperties.com',
      about_text: 'The real estate arm of the 127-year-old Godrej Group, Godrej Properties blends a nationwide legacy of trust and sustainability with award-winning contemporary architecture and environmentally conscious designs.'
    },
    {
      name: 'Brigade Group',
      slug: 'brigade-group',
      brand_name: 'Brigade Group',
      tagline: 'Building Positive Experiences',
      logo_url: BUILDER_LOGOS['brigade-group'],
      headquarters_city: 'Bengaluru',
      operating_cities: 'Bengaluru, Hyderabad, Chennai, Mysuru, GIFT City',
      founded_year: 1986,
      experience_years: 38,
      total_projects_count: 250,
      ongoing_projects_count: 38,
      active_listings_count: 0,
      verification_status: 'unverified',
      flagship_projects: 'Brigade Gateway, Brigade Cornerstone Utopia, Brigade Orchards, World Trade Center Bengaluru',
      specialization: 'Integrated Smart Townships, Grade-A Tech Campuses & High-End Enclaves',
      website_url: 'https://www.brigadegroup.com',
      about_text: 'Founded in 1986 by M.R. Jaishankar, Brigade Group is one of India\'s most trusted developers, holding exclusive licenses for World Trade Centers across South India and creating integrated smart township benchmarks.'
    },
    {
      name: 'DLF Limited',
      slug: 'dlf-limited',
      brand_name: 'DLF',
      tagline: 'Building India with Distinction',
      logo_url: BUILDER_LOGOS['dlf-limited'],
      headquarters_city: 'Delhi NCR',
      operating_cities: 'Gurugram, Delhi NCR, Chandigarh, Chennai, Kolkata',
      founded_year: 1946,
      experience_years: 78,
      total_projects_count: 158,
      ongoing_projects_count: 24,
      active_listings_count: 0,
      verification_status: 'unverified',
      flagship_projects: 'DLF The Camellias, DLF CyberCity, DLF Phase 5 Gurugram, DLF Aralias, DLF Magnolias',
      specialization: 'Ultra-Luxury Super-Condominiums, Cyber Hubs & Masterplanned Cities',
      website_url: 'https://www.dlf.in',
      about_text: 'With a 78-year heritage, DLF is India\'s largest publicly listed real estate firm. DLF built modern Gurugram and continues to define the pinnacle of Indian luxury residential living with iconic developments like The Camellias.'
    },
    {
      name: 'Lodha Group (Macrotech)',
      slug: 'lodha-group',
      brand_name: 'Lodha',
      tagline: 'Building a Better Life',
      logo_url: BUILDER_LOGOS['lodha-group'],
      headquarters_city: 'Mumbai',
      operating_cities: 'Mumbai, Pune, Bengaluru, London',
      founded_year: 1980,
      experience_years: 44,
      total_projects_count: 110,
      ongoing_projects_count: 35,
      active_listings_count: 0,
      verification_status: 'unverified',
      flagship_projects: 'Lodha World Towers, Lodha Altamount, Palava City (4,500 Acres), Lodha Park',
      specialization: 'Landmark Super-Luxury Towers, Private Smart Cities & Green Logistics',
      website_url: 'https://www.lodhagroup.in',
      about_text: 'Macrotech Developers (Lodha) is India\'s leading residential real estate developer by sales, known for global architectural collaborations, Mumbai\'s tallest residential towers, and India\'s largest integrated smart city.'
    },
    {
      name: 'Puravankara Limited',
      slug: 'puravankara',
      brand_name: 'Puravankara',
      tagline: 'Homes for a Lifetime',
      logo_url: BUILDER_LOGOS['puravankara'],
      headquarters_city: 'Bengaluru',
      operating_cities: 'Bengaluru, Hyderabad, Chennai, Pune, Mumbai, Kochi, Goa',
      founded_year: 1975,
      experience_years: 49,
      total_projects_count: 80,
      ongoing_projects_count: 29,
      active_listings_count: 0,
      verification_status: 'unverified',
      flagship_projects: 'Purva Atmosphere, Purva Promenade, Provident Sunworth, Purva Zenium',
      specialization: 'Theme-Based Luxury Residences & Next-Gen Precast Building Technology',
      website_url: 'https://www.puravankara.com',
      about_text: 'Over nearly five decades, Puravankara has delivered over 45 million sq.ft of themed residences across major metro corridors, blending transparent governance, customer focus, and innovative German precast construction.'
    },
    {
      name: 'Mahindra Lifespaces',
      slug: 'mahindra-lifespaces',
      brand_name: 'Mahindra Lifespaces',
      tagline: 'Joyful Homecomings',
      logo_url: BUILDER_LOGOS['mahindra-lifespaces'],
      headquarters_city: 'Mumbai',
      operating_cities: 'Mumbai, Pune, Bengaluru, Chennai, Jaipur, Delhi NCR',
      founded_year: 1994,
      experience_years: 30,
      total_projects_count: 45,
      ongoing_projects_count: 16,
      active_listings_count: 0,
      verification_status: 'unverified',
      flagship_projects: 'Mahindra Eden, Mahindra Luminare, Mahindra Alcove, Mahindra World City (Chennai & Jaipur)',
      specialization: '100% Green Certified Net-Zero Homes & Integrated Industrial Cities',
      website_url: 'https://www.mahindralifespaces.com',
      about_text: 'The real estate and infrastructure development arm of the Mahindra Group, Mahindra Lifespaces is a pioneer of sustainable urbanisation with 100% green certified residential developments and integrated industrial hubs.'
    }
  ];

  for (const b of detailedBuilders) {
    const [existing] = await conn.query('SELECT id FROM builders WHERE slug = ?', [b.slug]);
    if (existing && existing.length > 0) {
      await conn.query(`
        UPDATE builders SET
          name = ?, brand_name = ?, tagline = ?, logo_url = ?, headquarters_city = ?,
          operating_cities = ?, founded_year = ?, experience_years = ?, total_projects_count = ?,
          ongoing_projects_count = ?, active_listings_count = ?, flagship_projects = ?,
          specialization = ?, website_url = ?, about_text = ?
        WHERE slug = ?
      `, [
        b.name, b.brand_name, b.tagline, b.logo_url, b.headquarters_city,
        b.operating_cities, b.founded_year, b.experience_years, b.total_projects_count,
        b.ongoing_projects_count, b.active_listings_count, b.flagship_projects,
        b.specialization, b.website_url, b.about_text, b.slug
      ]);
    } else {
      await conn.query(`
        INSERT INTO builders 
        (name, slug, brand_name, tagline, logo_url, headquarters_city, operating_cities, founded_year, experience_years, total_projects_count, ongoing_projects_count, active_listings_count, verification_status, flagship_projects, specialization, website_url, about_text, is_sample, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')
      `, [
        b.name, b.slug, b.brand_name, b.tagline, b.logo_url, b.headquarters_city,
        b.operating_cities, b.founded_year, b.experience_years, b.total_projects_count,
        b.ongoing_projects_count, b.active_listings_count, b.verification_status,
        b.flagship_projects, b.specialization, b.website_url, b.about_text
      ]);
    }
  }

  console.log(`[migrate-builders] Successfully updated all ${detailedBuilders.length} builder profiles and vector logos!`);
  await conn.end();
}

migrateBuilders().catch(err => {
  console.error('[migrate-builders] ERROR:', err.message);
  process.exit(1);
});
