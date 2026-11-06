'use strict';
/**
 * seed-dealers.js — Populates realistic initial verified agents and agent reviews.
 * Run: node server/scripts/seed-dealers.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function seedDealers() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'vastu_reviews',
    charset:  'utf8mb4',
  });

  console.log('[seed-dealers] Checking existing agents…');
  const [existing] = await conn.execute(`SELECT COUNT(*) AS c FROM agents`);
  if (existing[0].c > 0) {
    console.log(`[seed-dealers] Table already has ${existing[0].c} agents. Checking if primary screenshot agents exist…`);
  }

  const initialAgents = [
    {
      name: 'Rajesh Sharma',
      agency_name: 'Prime Acres Advisory',
      role: 'agent',
      phone: '+91 9044268001',
      email: 'billedkart@gmail.com',
      city: 'Bengaluru',
      locality: 'Indiranagar & HSR',
      specialization: 'Luxury Highrises & Plots',
      bio: 'Over 14 years advising senior tech executives and high-net-worth families across Bengaluru East. Deep expertise in Kaveri 2.0 e-Khata verification, BDA approvals, and A-Khata villa properties.',
      experience_years: 14,
      profile_image_url: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80',
      certification_name: 'CREDAI Certified Senior Realtor',
      verification_status: 'verified',
      status: 'approved',
      is_demo: 1,
      whatsapp_number: '+919044268001',
      active_listings_count: 42,
      completed_deals_count: 184,
      average_rating: 4.9,
      reviews_count: 128,
      ranking_score: 98.50
    },
    {
      name: 'Priya Deshmukh',
      agency_name: 'Coastal Realty Partners',
      role: 'broker',
      phone: '+91 9044268001',
      email: 'billedkart@gmail.com',
      city: 'Mumbai',
      locality: 'Bandra & Worli',
      specialization: 'Sea-View Rentals & Resale',
      bio: 'Specialized in prime sea-facing apartments and heritage bungalows along Western Mumbai coastline. Dedicated to broker-free transparency, RERA legal due diligence, and hassle-free registration.',
      experience_years: 11,
      profile_image_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
      certification_name: 'MahaRERA Certified Broker #A5190001892',
      verification_status: 'verified',
      status: 'approved',
      is_demo: 1,
      whatsapp_number: '+919044268001',
      active_listings_count: 38,
      completed_deals_count: 142,
      average_rating: 4.8,
      reviews_count: 95,
      ranking_score: 96.20
    },
    {
      name: 'Vikram Reddy',
      agency_name: 'Metro Landmark Infra',
      role: 'dealer',
      phone: '+91 9044268001',
      email: 'billedkart@gmail.com',
      city: 'Hyderabad',
      locality: 'Gachibowli & Financial Dist',
      specialization: 'Commercial & Villas',
      bio: 'Leading commercial advisory and gated villa specialist in Cyberabad and Gachibowli corridor. 30-year title encumbrance check expert with deep relationships across top tier builders and direct owners.',
      experience_years: 16,
      profile_image_url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
      certification_name: 'TSRERA Registered Realty Partner #A024000312',
      verification_status: 'verified',
      status: 'approved',
      is_demo: 1,
      whatsapp_number: '+919044268001',
      active_listings_count: 55,
      completed_deals_count: 220,
      average_rating: 5.0,
      reviews_count: 142,
      ranking_score: 99.10
    },
    {
      name: 'Amit Verma',
      agency_name: 'Capital Real Estate',
      role: 'agent',
      phone: '+91 9044268001',
      email: 'billedkart@gmail.com',
      city: 'Noida / Delhi NCR',
      locality: 'Noida Expressway',
      specialization: 'RERA Highrises & Plots',
      bio: 'Premier Noida Expressway and Greater Noida property consultant. Trusted advisor for over 500 NCR families seeking clear OC/CC documents and verified highrise luxury homes.',
      experience_years: 12,
      profile_image_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
      certification_name: 'UPRERA Certified Consultant #UPRERAAGT1294',
      verification_status: 'verified',
      status: 'approved',
      is_demo: 1,
      whatsapp_number: '+919044268001',
      active_listings_count: 61,
      completed_deals_count: 265,
      average_rating: 4.9,
      reviews_count: 110,
      ranking_score: 97.80
    },
    {
      name: 'Sunita Agarwal',
      agency_name: 'Heritage Living Consultants',
      role: 'broker',
      phone: '+91 9044268001',
      email: 'billedkart@gmail.com',
      city: 'Lucknow',
      locality: 'Gomti Nagar & Hazratganj',
      specialization: 'Independent Kothi & Resale',
      bio: 'Specialized in LDA approved duplex homes, independent bungalows, and prime commercial plots in Gomti Nagar Extension. Known for complete legal clarity and compassionate advisory.',
      experience_years: 15,
      profile_image_url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
      certification_name: 'UPRERA Empaneled Specialist',
      verification_status: 'verified',
      status: 'approved',
      is_demo: 1,
      whatsapp_number: '+919044268001',
      active_listings_count: 29,
      completed_deals_count: 98,
      average_rating: 4.9,
      reviews_count: 76,
      ranking_score: 95.00
    },
    {
      name: 'Ketan Kulkarni',
      agency_name: 'Sahyadri Prime Properties',
      role: 'dealer',
      phone: '+91 9044268001',
      email: 'billedkart@gmail.com',
      city: 'Pune',
      locality: 'Baner & Kothrud',
      specialization: 'Ready Metro Flats & Penthouses',
      bio: 'Pune West real estate veteran with 13 years focusing on Baner, Balewadi, and Kothrud corridor. Specialized in clear-title PMC / PMRDA sanctioned housing societies.',
      experience_years: 13,
      profile_image_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      certification_name: 'MahaRERA Registered Agent #A5210002931',
      verification_status: 'verified',
      status: 'approved',
      is_demo: 1,
      whatsapp_number: '+919044268001',
      active_listings_count: 34,
      completed_deals_count: 115,
      average_rating: 4.8,
      reviews_count: 88,
      ranking_score: 94.70
    },
    {
      name: 'Kavita Natarajan',
      agency_name: 'Madras Realty Advisors',
      role: 'agent',
      phone: '+91 9044268001',
      email: 'billedkart@gmail.com',
      city: 'Chennai',
      locality: 'Adyar & OMR IT Corridor',
      specialization: 'Gated Communities & Sea View Flats',
      bio: 'Specialist in South Chennai luxury residential apartments, CMDA approved plots, and high-yielding tech corridor rentals along OMR.',
      experience_years: 10,
      profile_image_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      certification_name: 'TNRERA Certified Agent #TN/AGT/0142/2021',
      verification_status: 'verified',
      status: 'approved',
      is_demo: 1,
      whatsapp_number: '+919044268001',
      active_listings_count: 26,
      completed_deals_count: 82,
      average_rating: 4.7,
      reviews_count: 64,
      ranking_score: 93.10
    },
    {
      name: 'Rohan Banerjee',
      agency_name: 'City of Joy Estates',
      role: 'seller',
      phone: '+91 9044268001',
      email: 'billedkart@gmail.com',
      city: 'Kolkata',
      locality: 'New Town & Salt Lake',
      specialization: 'IT Hub Condos & Resale',
      bio: 'Passionate property seller and consultant for Kolkata Action Area 1-3. Direct owner liaison with verified WBHIRA documentation and zero brokerage for buyers.',
      experience_years: 8,
      profile_image_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      certification_name: 'WBHIRA Registered Specialist',
      verification_status: 'verified',
      status: 'approved',
      is_demo: 1,
      whatsapp_number: '+919044268001',
      active_listings_count: 22,
      completed_deals_count: 65,
      average_rating: 4.8,
      reviews_count: 52,
      ranking_score: 92.40
    }
  ];

  for (const ag of initialAgents) {
    const [found] = await conn.execute(`SELECT id FROM agents WHERE email = ? LIMIT 1`, [ag.email]);
    if (found.length === 0) {
      const [ins] = await conn.execute(
        `INSERT INTO agents
          (name, agency_name, role, phone, email, city, locality,
           specialization, bio, experience_years, profile_image_url,
           certification_name, verification_status, status, whatsapp_number, is_demo,
           active_listings_count, completed_deals_count, average_rating,
           reviews_count, ranking_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ag.name, ag.agency_name, ag.role, ag.phone, ag.email, ag.city, ag.locality,
          ag.specialization, ag.bio, ag.experience_years, ag.profile_image_url,
          ag.certification_name, ag.verification_status, ag.status, ag.whatsapp_number, ag.is_demo || 1,
          ag.active_listings_count, ag.completed_deals_count, ag.average_rating,
          ag.reviews_count, ag.ranking_score
        ]
      );
      console.log(`[seed-dealers] Seeded agent: ${ag.name} (ID: ${ins.insertId})`);
    } else {
      console.log(`[seed-dealers] Agent ${ag.name} already exists.`);
    }
  }

  // Ensure initial verified reviews exist for Rajesh Sharma (Agent ID 1) to demonstrate the agent reviews popup
  const [rajesh] = await conn.execute(`SELECT id FROM agents WHERE email = 'rajesh.sharma@primeacres.in' LIMIT 1`);
  if (rajesh.length > 0) {
    const agentId = rajesh[0].id;
    // Check if test user exists
    let [userRow] = await conn.execute(`SELECT id FROM users LIMIT 1`);
    let userId = userRow.length > 0 ? userRow[0].id : null;

    if (!userId) {
      const [uRes] = await conn.execute(
        `INSERT INTO users (full_name, username, email, is_email_verified)
         VALUES ('Siddharth Rao', 'siddharth_rao', 'siddharth.rao@example.com', 1)`
      );
      userId = uRes.insertId;
    }

    const [revFound] = await conn.execute(`SELECT id FROM agent_reviews WHERE agent_id = ? LIMIT 1`, [agentId]);
    if (revFound.length === 0) {
      await conn.execute(
        `INSERT INTO agent_reviews (agent_id, user_id, reviewer_name, rating, review_text, property_context, status)
         VALUES
         (?, ?, 'Siddharth Rao', 5, 'Rajesh helped us purchase our 3 BHK in Whitefield within 12 days. Handled Kaveri 2.0 registration and Khata transfer with zero hassle.', 'Bought 3 BHK in Whitefield', 'approved'),
         (?, ?, 'Dr. Ananya Murthy', 5, 'Extremely knowledgeable about BDA layout approvals and clear title documentation in Indiranagar. Truly top-class guidance.', 'Villa in Indiranagar', 'approved')`,
        [agentId, userId, agentId, userId]
      );
      console.log(`[seed-dealers] Seeded sample approved reviews for ${rajesh[0].id}.`);
    }
  }

  console.log('[seed-dealers] Seeding completed successfully.');
  await conn.end();
}

seedDealers().catch(err => {
  console.error('[seed-dealers] ERROR:', err);
  process.exit(1);
});
