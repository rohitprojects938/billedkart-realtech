'use strict';
/**
 * seed.js — Idempotent seed script.
 * Run: node scripts/seed.js
 * Inserts demo reviews only if no demo reviews exist yet (idempotent).
 * Demo reviews are clearly marked with is_demo = 1.
 * They are approved so they appear in the carousel immediately.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const DEMO_REVIEWS = [
  {
    reviewer_name:    'Siddharth Rao',
    profile_image_url:'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
    designation:      'Tech Lead',
    city:             'Bengaluru',
    rating:           5,
    review_text:      'Closed our Whitefield 3 BHK in 11 days. The Billedkart Realtech advisor handled the Kaveri 2.0 registration and Khata transfer seamlessly. Zero spam!',
    property_context: 'Bought 3 BHK in Whitefield',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Meera Merchant',
    profile_image_url:'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
    designation:      'Creative Director',
    city:             'Mumbai',
    rating:           5,
    review_text:      'Finding a verified sea-view flat in Bandra West without broker harassment was seamless with Billedkart Realtech. Genuine direct owner chat.',
    property_context: 'Rented 2.5 BHK in Bandra',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Rohit Singhania',
    profile_image_url:'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
    designation:      'Senior Consultant',
    city:             'Hyderabad',
    rating:           5,
    review_text:      'Bought a 4 BHK Villa in Gachibowli. 30-year title encumbrance check gave us 100% peace of mind. Truly transparent pricing.',
    property_context: 'Bought 4 BHK Villa',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Anjali Krishnan',
    profile_image_url:'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&auto=format&fit=crop&q=80',
    designation:      'HR Manager',
    city:             'Chennai',
    rating:           5,
    review_text:      'Used Billedkart Realtech for relocating to Chennai. Found a verified 2 BHK in Velachery within 5 days. The RERA verification saved us from a fraudulent listing. Highly recommend!',
    property_context: 'Rented 2 BHK in Velachery',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Karan Mehta',
    profile_image_url:'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&auto=format&fit=crop&q=80',
    designation:      'Financial Analyst',
    city:             'Pune',
    rating:           4,
    review_text:      'Great platform for finding properties in Pune. The direct owner connect feature saved me 2 lakhs in brokerage. Documentation support was excellent.',
    property_context: 'Bought 3 BHK in Wakad',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Priya Sharma',
    profile_image_url:'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80',
    designation:      'Architect',
    city:             'Delhi NCR',
    rating:           5,
    review_text:      'Sold my Gurgaon apartment through Billedkart Realtech in 3 weeks. Zero hassle, maximum transparency. The legal verification team caught an issue in the buyer agreement before signing. Lifesaver!',
    property_context: 'Sold 3 BHK in Gurgaon',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Vikram Nair',
    profile_image_url:'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&auto=format&fit=crop&q=80',
    designation:      'Startup Founder',
    city:             'Bengaluru',
    rating:           5,
    review_text:      'Found our office space in Koramangala in just 2 days! The commercial property listings with verified ownership documents made the due diligence so much easier. Will use again.',
    property_context: 'Leased Office in Koramangala',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Sunita Agarwal',
    profile_image_url:'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=200&auto=format&fit=crop&q=80',
    designation:      'School Principal',
    city:             'Lucknow',
    rating:           4,
    review_text:      'Billedkart Realtech helped us find a beautiful independent house in Gomti Nagar. The advisor was patient throughout the process and explained all the legal documents clearly. Very satisfied.',
    property_context: 'Bought Independent House in Gomti Nagar',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Aditya Patel',
    profile_image_url:'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&auto=format&fit=crop&q=80',
    designation:      'Software Engineer',
    city:             'Ahmedabad',
    rating:           5,
    review_text:      'The best real estate platform I have ever used. Transparent pricing, verified owners, and zero broker interference. Moved into my new flat in Satellite within a week of finding it here.',
    property_context: 'Rented 1 BHK in Satellite',
    is_guest:         0,
    status:           'approved',
  },
  {
    reviewer_name:    'Deepika Joshi',
    profile_image_url:'https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=200&auto=format&fit=crop&q=80',
    designation:      'Marketing Manager',
    city:             'Mumbai',
    rating:           5,
    review_text:      'Rented a sea-facing studio in Andheri West for a great price. The Billedkart Realtech team verified the owner\'s identity and property documents before I even took a site visit. Pure peace of mind.',
    property_context: 'Rented Studio in Andheri West',
    is_guest:         0,
    status:           'approved',
  },
];

async function seed() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'vastu_reviews',
    charset:  'utf8mb4',
  });

  // Idempotent: skip if demo reviews already exist
  const [rows] = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM reviews WHERE is_demo = 1'
  );
  if (rows[0].cnt > 0) {
    console.log(`[seed] ${rows[0].cnt} demo review(s) already exist. Skipping seed.`);
    await conn.end();
    return;
  }

  console.log(`[seed] Inserting ${DEMO_REVIEWS.length} demo reviews…`);
  for (const rev of DEMO_REVIEWS) {
    await conn.execute(
      `INSERT INTO reviews
         (reviewer_name, profile_image_url, designation, city, rating,
          review_text, property_context, is_guest, is_demo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        rev.reviewer_name,
        rev.profile_image_url || null,
        rev.designation       || null,
        rev.city              || null,
        rev.rating,
        rev.review_text,
        rev.property_context  || null,
        rev.is_guest,
        rev.status,
      ]
    );
    console.log(`  ✓ ${rev.reviewer_name}`);
  }

  console.log('[seed] Seed complete.');
  await conn.end();
}

seed().catch(err => {
  console.error('[seed] ERROR:', err.message);
  process.exit(1);
});
