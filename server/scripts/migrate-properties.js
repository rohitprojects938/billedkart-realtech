'use strict';
/**
 * migrate-properties.js — Database Migration & Seed for Properties, Enquiries, Wishlist, Visits & Reports
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function migrateProperties() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
    multipleStatements: true
  });

  const dbName = process.env.DB_NAME || 'vastu_reviews';
  console.log(`[migrate-properties] Using database '${dbName}'...`);
  await conn.query(`USE \`${dbName}\``);

  console.log('[migrate-properties] Creating tables if not exist...');

  await conn.query(`
    -- 1. Main Properties Table
    CREATE TABLE IF NOT EXISTS \`properties\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`slug\` VARCHAR(191) NOT NULL UNIQUE,
      \`title\` VARCHAR(255) NOT NULL,
      \`property_type\` VARCHAR(64) NOT NULL DEFAULT 'Apartment', -- Apartment, Villa, Penthouse, Plot, Row House
      \`transaction_type\` ENUM('buy', 'rent') NOT NULL DEFAULT 'buy',
      \`project_name\` VARCHAR(191) NULL,
      \`builder_id\` INT UNSIGNED NULL,
      \`owner_type\` ENUM('owner', 'agent', 'builder') NOT NULL DEFAULT 'owner',
      \`owner_user_id\` INT UNSIGNED NULL,
      \`owner_name\` VARCHAR(128) NOT NULL,
      \`owner_phone\` VARCHAR(32) NOT NULL,
      \`owner_email\` VARCHAR(128) NULL,
      \`owner_member_since\` VARCHAR(32) DEFAULT '2022',
      \`owner_response_time\` VARCHAR(64) DEFAULT 'Within 15 mins',
      \`is_owner_verified\` TINYINT(1) NOT NULL DEFAULT 1,
      \`verification_status\` ENUM('verified', 'under_review', 'unverified') NOT NULL DEFAULT 'verified',
      \`rera_id\` VARCHAR(128) NULL,
      \`is_rera_registered\` TINYINT(1) NOT NULL DEFAULT 1,
      \`khata_type\` VARCHAR(64) DEFAULT 'BBMP A Khata (Digital e-Khata)',
      \`possession_status\` ENUM('ready_to_move', 'under_construction') NOT NULL DEFAULT 'ready_to_move',
      \`possession_date\` VARCHAR(64) DEFAULT 'Immediate',
      \`property_age_years\` DECIMAL(3,1) DEFAULT 1.5,
      \`bhk\` TINYINT UNSIGNED NOT NULL DEFAULT 3,
      \`bathrooms\` TINYINT UNSIGNED NOT NULL DEFAULT 3,
      \`balconies\` TINYINT UNSIGNED NOT NULL DEFAULT 2,
      \`price\` DECIMAL(14,2) NOT NULL, -- in INR
      \`is_price_negotiable\` TINYINT(1) NOT NULL DEFAULT 1,
      \`maintenance_monthly\` DECIMAL(10,2) DEFAULT 5800.00,
      \`deposit_amount\` DECIMAL(14,2) NULL,
      \`carpet_area_sqft\` INT UNSIGNED NOT NULL,
      \`super_builtup_area_sqft\` INT UNSIGNED NOT NULL,
      \`facing\` VARCHAR(32) DEFAULT 'East',
      \`floor_number\` SMALLINT NOT NULL DEFAULT 14,
      \`total_floors\` SMALLINT NOT NULL DEFAULT 27,
      \`tower_block\` VARCHAR(64) DEFAULT 'Tower 4',
      \`parking_covered\` TINYINT UNSIGNED NOT NULL DEFAULT 2,
      \`parking_open\` TINYINT UNSIGNED NOT NULL DEFAULT 0,
      \`furnishing_status\` ENUM('unfurnished', 'semi_furnished', 'fully_furnished') NOT NULL DEFAULT 'semi_furnished',
      \`furnishing_details\` TEXT NULL,
      \`water_supply\` VARCHAR(128) DEFAULT 'Cauvery Water + 24/7 Borewell Backup',
      \`power_backup\` VARCHAR(128) DEFAULT '100% DG Power Backup for Flat & Lifts',
      \`overlooking_view\` VARCHAR(191) DEFAULT 'Unobstructed Lake & Club Greens',
      \`society_acreage\` VARCHAR(64) DEFAULT '18 Acres / 9 Towers Master Township',
      \`address_line\` VARCHAR(255) NOT NULL,
      \`locality\` VARCHAR(128) NOT NULL,
      \`city\` VARCHAR(64) NOT NULL DEFAULT 'Bengaluru',
      \`state\` VARCHAR(64) NOT NULL DEFAULT 'Karnataka',
      \`pincode\` VARCHAR(16) NOT NULL DEFAULT '560067',
      \`latitude\` DECIMAL(10,8) NOT NULL DEFAULT 12.9984000,
      \`longitude\` DECIMAL(11,8) NOT NULL DEFAULT 77.7499000,
      \`is_approx_location\` TINYINT(1) NOT NULL DEFAULT 0,
      \`description\` TEXT NOT NULL,
      \`primary_image_url\` TEXT NOT NULL,
      \`images\` JSON NOT NULL, -- Array of { url, caption, category }
      \`floor_plan_url\` TEXT NULL,
      \`brochure_url\` TEXT NULL,
      \`amenities\` JSON NOT NULL, -- Array of amenity keys or objects
      \`specifications\` JSON NULL, -- Detailed nested specs object
      \`nearby_landmarks\` JSON NULL, -- Array of { name, category, distance_km, time_mins }
      \`views_count\` INT UNSIGNED NOT NULL DEFAULT 142,
      \`status\` ENUM('active', 'sold', 'rented', 'inactive') NOT NULL DEFAULT 'active',
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_city_locality (city, locality),
      INDEX idx_status_trans (status, transaction_type),
      INDEX idx_bhk_price (bhk, price)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 2. Property Enquiries / Direct Leads Table
    CREATE TABLE IF NOT EXISTS \`property_enquiries\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`property_id\` INT UNSIGNED NOT NULL,
      \`user_id\` INT UNSIGNED NULL,
      \`full_name\` VARCHAR(128) NOT NULL,
      \`phone\` VARCHAR(32) NOT NULL,
      \`email\` VARCHAR(128) NOT NULL,
      \`preferred_visit_date\` DATE NULL,
      \`message\` TEXT NULL,
      \`whatsapp_consent\` TINYINT(1) NOT NULL DEFAULT 1,
      \`source\` VARCHAR(32) DEFAULT 'detail_page',
      \`status\` ENUM('new', 'contacted', 'closed') NOT NULL DEFAULT 'new',
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_prop_created (property_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 3. Site Visit Bookings Table
    CREATE TABLE IF NOT EXISTS \`property_site_visits\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`property_id\` INT UNSIGNED NOT NULL,
      \`user_id\` INT UNSIGNED NULL,
      \`visitor_name\` VARCHAR(128) NOT NULL,
      \`phone\` VARCHAR(32) NOT NULL,
      \`email\` VARCHAR(128) NOT NULL,
      \`visit_date\` DATE NOT NULL,
      \`time_slot\` VARCHAR(64) NOT NULL,
      \`visitors_count\` TINYINT UNSIGNED NOT NULL DEFAULT 1,
      \`message\` TEXT NULL,
      \`status\` ENUM('pending', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_visit_date (property_id, visit_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 4. User Wishlist Table
    CREATE TABLE IF NOT EXISTS \`property_wishlist\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`property_id\` INT UNSIGNED NOT NULL,
      \`user_id\` INT UNSIGNED NULL,
      \`guest_token\` VARCHAR(128) NULL,
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_property (property_id, user_id),
      INDEX idx_guest_prop (guest_token, property_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 5. Property Reports Table
    CREATE TABLE IF NOT EXISTS \`property_reports\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`property_id\` INT UNSIGNED NOT NULL,
      \`user_id\` INT UNSIGNED NULL,
      \`reason\` VARCHAR(128) NOT NULL,
      \`details\` TEXT NULL,
      \`reporter_ip\` VARCHAR(45) NULL,
      \`status\` ENUM('pending', 'reviewed', 'dismissed') NOT NULL DEFAULT 'pending',
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 6. Direct Property Chat Messages Table
    CREATE TABLE IF NOT EXISTS \`property_chat_messages\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`property_id\` INT UNSIGNED NOT NULL,
      \`user_id\` INT UNSIGNED NULL,
      \`guest_token\` VARCHAR(128) NULL,
      \`sender_role\` ENUM('buyer', 'owner', 'concierge') NOT NULL DEFAULT 'buyer',
      \`sender_name\` VARCHAR(128) NOT NULL,
      \`message\` TEXT NOT NULL,
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_chat_prop (property_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  console.log('[migrate-properties] Seeding initial verified properties...');

  // Check if main property exists
  const [existing] = await conn.query('SELECT id FROM properties WHERE slug = ?', ['godrej-splendour-whitefield-101']);
  
  const imagesGodrej = JSON.stringify([
    {
      url: "https://lh3.googleusercontent.com/aida-public/AB6AXuDfHZOGw0GkllwfjlH6hJm9BfQbWKQZ113cw3kUaLyexHTlaGoxy9zdLdcKSCKYTf8kUmB8-giKMyXVzpfTq5K0kFOT_cvix_kc5Adxmin7a2MAGhepKZ0JqGkMsYb2Pa5fA1ISKhkZjKeR24Ts4wE4MqDA6gVltw8WpGX_nirG5cEjyuLcw8mkn4JifEiNesDtyuTABPPP1dFNN6KmzkAh-icZCp5KzejUekqcUAt7tDhoQAXK0HOu",
      caption: "Master Living & Sky Balcony with unobstructed lake panoramas",
      category: "Living Room"
    },
    {
      url: "https://lh3.googleusercontent.com/aida-public/AB6AXuCStoB876NzAl7Q6tIOeRn7taOJ-vtJ3LIF8rhs6o2coyheLTmsXvR_Y06I6723g9mrc8LLKmhHBOUXKsQzhs3qzeaPL4RP_sQUZC_40KmezdSWnjk-d26AVvbnmktjqCXpmKA8GaCVCUnCS0Mim03jt8N5F6xDGOtZDToUdRUH_aJjSRgn5ttWg6jwqETyqjxNpYlio2oi0yHmeADtHvNieuX3qetZeWNzlI-6Du5sZdpXxcnla9Og",
      caption: "Spacious master bedroom with floor-to-ceiling wooden wardrobes",
      category: "Bedroom"
    },
    {
      url: "https://lh3.googleusercontent.com/aida-public/AB6AXuASUsTPdyhW2aetaEKyIKr8xJ066ujxsrKPJuaE4yJeLxNAAqFNoGRDRUS9eBrPpPllwY40hZLGFVyGkZnWUuRbk1sXb8q-FuJ8wi9Ji61TlvbtxwYCd8CvdfbfpDyNKzQPzLSEhZfQRhdR_wJauZdUPeIWYNbAhegTbjtl6_KyFaeyuX8G8LnbIpbvCfJNq2DUrvTE31bQZWiK9aZSk3KFh7_ns5vTkNPbqNPJyvLw-j1qEIfQvsPz",
      caption: "Acrylic finish modular kitchen with built-in Faber chimney & quartz counter",
      category: "Kitchen"
    },
    {
      url: "https://lh3.googleusercontent.com/aida-public/AB6AXuBdcCsVKIkRn0eXdDuuYAokiZWIx-M_Jx5LGwNhdByIFHGjqK0KKAHCcPt-WPybbi2K5aQBCExvY1vC-LzDueCNYlgzzubinxn3m8kOdyJW-UxgY1GY3EjT8okIHXH_DDPvhaBeS4pN191wZJPDmK4eCVI7tUC3BFbuNuKa79ZQSrtFkiBfEA4R3YzVBqxmxmc-G8scbJsscgx6QO63Cne-Gf2hpc9JZA6iO6a6F_MDeXb0x5LfaKlT",
      caption: "Infinity swimming pool and 39,000 sq.ft clubhouse enclave at dusk",
      category: "Amenities"
    },
    {
      url: "https://lh3.googleusercontent.com/aida-public/AB6AXuBKxF-mNngeZ1SkdQc-aY8gbpI6N66Y4q2MXvLcvpKYvQ9cRTojSO26f1zvE40kYq4X7P7iECMl402h9JUi3qq2vdcsLHFm_ZMLYxt05AmlJrPM2bvUkoGamhxWz9iKwPC-zrVaExsM7WEfmMP60wGaFtSEqJI2EQ3qbfI8htRGb5egwFJD-Uv0A7wEtH1tPS8aHEPAWTlDY9Fq0dKLLHICIi3qHvL3FNQN8l17bVSyIMt0jpVeVJrH",
      caption: "Architectural 2D blueprint layout rendering (3 BHK, 1,900 sq.ft SBA)",
      category: "Floor Plan"
    }
  ]);

  const amenitiesGodrej = JSON.stringify([
    { name: "Grand Clubhouse", category: "Recreation", icon: "domain", description: "39,000 sq.ft space" },
    { name: "Infinity Swimming Pool", category: "Sports and Fitness", icon: "pool", description: "Adult & kids pool" },
    { name: "Badminton Courts", category: "Sports and Fitness", icon: "sports_tennis", description: "2 indoor wooden courts" },
    { name: "100% DG Power Backup", category: "Power and Utilities", icon: "bolt", description: "Uninterrupted flat & lifts" },
    { name: "EV Car Charging Bays", category: "Convenience", icon: "ev_station", description: "Basement fast chargers" },
    { name: "Kids Play Arena", category: "Outdoor Spaces", icon: "child_care", description: "Sand pit & rubber turf" },
    { name: "24/7 Security & CCTV", category: "Security", icon: "shield", description: "Smart visitor app entry" },
    { name: "Piped Gas Line (GAIL)", category: "Convenience", icon: "propane_tank", description: "Direct kitchen metered line" },
    { name: "1.2 km Jogging Track", category: "Outdoor Spaces", icon: "directions_run", description: "Tree-lined greenery perimeter" },
    { name: "Gymnasium & Yoga Studio", category: "Sports and Fitness", icon: "fitness_center", description: "High-tech cardio & weights" },
    { name: "Rooftop Party Lounge", category: "Community", icon: "deck", description: "Open skyline sky-deck" },
    { name: "Multi-Tier Smart Access", category: "Security", icon: "fingerprint", description: "Biometric & RFID doors" }
  ]);

  const specsGodrej = JSON.stringify({
    basic: {
      property_type: "Multi-Storey Apartment",
      transaction_type: "Resale (Direct Owner)",
      bhk: "3 BHK",
      bathrooms: "3 Attached Bathrooms",
      balconies: "2 Deck Balconies",
      carpet_area: "1,520 sq.ft",
      super_builtup_area: "1,900 sq.ft",
      facing: "East Facing (100% Vaastu Compliant)",
      floor_position: "14th Floor (Out of 27 Floors)",
      tower: "Tower 4 (Corner Tower)"
    },
    interior: {
      furnishing: "Semi-Furnished (Modular Kitchen + Wardrobes in all 3 Bedrooms)",
      flooring: "Imported Glazed Vitrified Tiles (800x800mm) in Living/Dining; Anti-skid ceramic in balconies",
      kitchen: "Custom High-Gloss Acrylic Finish, Quartz Countertop, Built-in Faber Chimney",
      bathrooms: "Jaquar Artize Chrome Diverters & High-End Ceramic Sanitaryware",
      doors: "Teakwood Frame Main Door with Smart Biometric Fingerprint Lock; Flush doors for bedrooms"
    },
    building: {
      total_towers: "9 Master Towers",
      total_floors: "27 Floors per Tower",
      construction_technology: "Advanced Mivan Aluminum Formwork Technology",
      property_age: "1.5 Years (Handed over late 2024)",
      lifts: "3 High-Speed Automatic Elevators per Tower",
      power_backup: "100% DG Generator Backup for Flat, Common Lighting & Lifts"
    },
    ownership: {
      khata: "BBMP 'A' Khata (Digital e-Khata Completed)",
      rera_approval: "PRM/KA/RERA/1251/446/PR/220509/004886",
      occupancy_certificate: "OC & CC Received from Authorities",
      bank_approvals: "Pre-Approved by SBI, HDFC Bank, ICICI Bank & Axis Bank"
    },
    financial: {
      listed_price: "₹1,95,00,000 (₹1.95 Crore)",
      price_per_sqft: "₹10,263 / sq.ft (Super Built-up)",
      monthly_maintenance: "₹5,800 / month",
      price_negotiability: "Open for slight negotiation with immediate token ready buyer",
      parking_cost: "Included in listed price (2 Covered Slots)"
    }
  });

  const landmarksGodrej = JSON.stringify([
    { name: "Kadugodi Tree Park Metro Station (Purple Line)", category: "Metro", distance_km: 1.2, time_mins: 4, icon: "subway" },
    { name: "International Tech Park Bangalore (ITPL)", category: "Offices", distance_km: 3.4, time_mins: 10, icon: "apartment" },
    { name: "Manipal Hospital Whitefield", category: "Hospitals", distance_km: 2.1, time_mins: 6, icon: "local_hospital" },
    { name: "Nexus Shantiniketan Mall", category: "Shopping", distance_km: 4.0, time_mins: 12, icon: "shopping_bag" },
    { name: "Delhi Public School Whitefield", category: "Schools", distance_km: 2.8, time_mins: 8, icon: "school" },
    { name: "Kempegowda International Airport", category: "Airports", distance_km: 36.5, time_mins: 45, icon: "flight" }
  ]);

  if (!existing || existing.length === 0) {
    await conn.query(`
      INSERT INTO properties (
        slug, title, property_type, transaction_type, project_name, builder_id,
        owner_type, owner_name, owner_phone, owner_email, owner_member_since, owner_response_time,
        is_owner_verified, verification_status, rera_id, is_rera_registered, khata_type,
        possession_status, possession_date, property_age_years, bhk, bathrooms, balconies,
        price, is_price_negotiable, maintenance_monthly, carpet_area_sqft, super_builtup_area_sqft,
        facing, floor_number, total_floors, tower_block, parking_covered, parking_open,
        furnishing_status, furnishing_details, water_supply, power_backup, overlooking_view, society_acreage,
        address_line, locality, city, state, pincode, latitude, longitude,
        description, primary_image_url, images, floor_plan_url, amenities, specifications, nearby_landmarks
      ) VALUES (
        'godrej-splendour-whitefield-101',
        '3 BHK High-Rise Apartment in Godrej Splendour',
        'Apartment', 'buy', 'Godrej Splendour', 3,
        'owner', 'Anand Kumar', '+91 98452 83910', 'anand.kumar@example.com', '2022', 'Within 15 mins',
        1, 'verified', 'PRM/KA/RERA/1251/446/PR/220509/004886', 1, 'BBMP A Khata (Digital e-Khata)',
        'ready_to_move', 'Immediate', 1.5, 3, 3, 2,
        19500000.00, 1, 5800.00, 1520, 1900,
        'East', 14, 27, 'Tower 4', 2, 0,
        'semi_furnished', 'Custom modular kitchen with Faber chimney & sleek wardrobes in 3 bedrooms',
        'Cauvery Water + 24/7 Borewell', '100% DG Power Backup for Flat & Lifts', 'Unobstructed Lake & Club Greens', '18 Acres / 9 Towers Master Township',
        'Tower 4, 14th Floor, Belathur Main Road, Whitefield', 'Whitefield', 'Bengaluru', 'Karnataka', '560067', 12.99840000, 77.74990000,
        'Welcome to this immaculate 3 BHK luxury residence located on the 14th floor of Godrej Splendour, Belathur Road, Whitefield. Positioned in prime front-facing Tower 4, this unit enjoys unobstructed sunrise panoramas over the scenic Belathur lake basin with continuous morning cross-ventilation and zero window-to-window sightlines from adjacent towers.\\n\\nConstructed with Godrej advanced aluminum formwork (Mivan construction), the unit guarantees zero seepage, acoustic dampening, and high structural thermal insulation. The interior features a thoughtfully customized semi-furnished layout with high-gloss acrylic modular kitchen drawers, Faber high-suction chimney, branded soft-close wardrobes in all three bedrooms, and upgraded teakwood main doorway with smart biometric fingerprint lock.',
        'https://lh3.googleusercontent.com/aida-public/AB6AXuDfHZOGw0GkllwfjlH6hJm9BfQbWKQZ113cw3kUaLyexHTlaGoxy9zdLdcKSCKYTf8kUmB8-giKMyXVzpfTq5K0kFOT_cvix_kc5Adxmin7a2MAGhepKZ0JqGkMsYb2Pa5fA1ISKhkZjKeR24Ts4wE4MqDA6gVltw8WpGX_nirG5cEjyuLcw8mkn4JifEiNesDtyuTABPPP1dFNN6KmzkAh-icZCp5KzejUekqcUAt7tDhoQAXK0HOu',
        ?, 'https://lh3.googleusercontent.com/aida-public/AB6AXuBKxF-mNngeZ1SkdQc-aY8gbpI6N66Y4q2MXvLcvpKYvQ9cRTojSO26f1zvE40kYq4X7P7iECMl402h9JUi3qq2vdcsLHFm_ZMLYxt05AmlJrPM2bvUkoGamhxWz9iKwPC-zrVaExsM7WEfmMP60wGaFtSEqJI2EQ3qbfI8htRGb5egwFJD-Uv0A7wEtH1tPS8aHEPAWTlDY9Fq0dKLLHICIi3qHvL3FNQN8l17bVSyIMt0jpVeVJrH',
        ?, ?, ?
      )
    `, [imagesGodrej, amenitiesGodrej, specsGodrej, landmarksGodrej]);
  }

  // Also seed 3 similar properties for recommendation carousel
  const similarSlugs = ['prestige-boulevard-whitefield-102', 'brigade-woods-whitefield-103', 'sobha-rose-residency-104'];
  const [simExisting] = await conn.query('SELECT slug FROM properties WHERE slug IN (?)', [similarSlugs]);
  const simSet = new Set(simExisting.map(s => s.slug));

  if (!simSet.has('prestige-boulevard-whitefield-102')) {
    await conn.query(`
      INSERT INTO properties (
        slug, title, property_type, transaction_type, project_name, builder_id,
        owner_type, owner_name, owner_phone, is_owner_verified, verification_status,
        bhk, bathrooms, balconies, price, carpet_area_sqft, super_builtup_area_sqft,
        address_line, locality, city, latitude, longitude,
        description, primary_image_url, images, amenities
      ) VALUES (
        'prestige-boulevard-whitefield-102',
        '3 BHK Spacious Flat in Prestige Boulevard', 'Apartment', 'buy', 'Prestige Boulevard', 1,
        'owner', 'Ramesh Rao', '+91 98860 12345', 1, 'verified',
        3, 3, 2, 18800000.00, 1420, 1780,
        'ECC Road, Whitefield', 'Whitefield', 'Bengaluru', 12.97800000, 77.74000000,
        'Well maintained 3 BHK apartment in Prestige Boulevard with close proximity to reputed schools and IT hubs.',
        'https://lh3.googleusercontent.com/aida-public/AB6AXuCfG85rFrKvW5zlR66syCgephBA2UGTnApT7avZQzHEnYXywONnXNFmNDC9YVpG80aaDtiqkEY-yS3xbS9Nt0rH5GwO7fHFu7RToHC6wiL3ELpwPsTi43olf9BGuSFuem9F51WKUq3a7oeA6mISxDBz6mplZBZTYXgJya4VGKEfVSF2P6BrZDNqOxbwXP4q0kjgayTgQ5AeqZTO4YMR4PDVJfIiIkpBo3ZxpAKgHbaH8nC0Gw8NR71y',
        '[]', '[]'
      )
    `);
  }

  if (!simSet.has('brigade-woods-whitefield-103')) {
    await conn.query(`
      INSERT INTO properties (
        slug, title, property_type, transaction_type, project_name, builder_id,
        owner_type, owner_name, owner_phone, is_owner_verified, verification_status,
        bhk, bathrooms, balconies, price, carpet_area_sqft, super_builtup_area_sqft,
        address_line, locality, city, latitude, longitude,
        description, primary_image_url, images, amenities
      ) VALUES (
        'brigade-woods-whitefield-103',
        '3 BHK Luxury Condominium in Brigade Woods', 'Apartment', 'buy', 'Brigade Woods', 4,
        'agent', 'Apex Realty Advisors', '+91 99001 98765', 1, 'verified',
        3, 3, 2, 21000000.00, 1550, 1940,
        'EPIP Zone, Whitefield', 'Whitefield', 'Bengaluru', 12.98100000, 77.72800000,
        'Sprawling high-rise 3 BHK home inside Brigade Woods near ITPL. Low density community surrounded by over 350 mature trees.',
        'https://lh3.googleusercontent.com/aida-public/AB6AXuCT3Dmaekmzi-dIeCTzn_pniBnZbwumHzEAzumua7Z7HSM0u6SdYGpqMdCmirTp3VVF9DJRpuBDYd82zNMeabR82Axag6jxbfq-65tvE4RfCcEh_YliI15Sn0BEv9NhWlt3kansoF3KVp8o3vBiEwDduZgL2AcSsOtOYnnwSsjSgy580xfye21TojWRG3rilcnYS8kgSoJ5lAtppzt3iWfy3l9UUZn4ofe3inXRwMZRWNYv1oaXz5XY',
        '[]', '[]'
      )
    `);
  }

  if (!simSet.has('sobha-rose-residency-104')) {
    await conn.query(`
      INSERT INTO properties (
        slug, title, property_type, transaction_type, project_name, builder_id,
        owner_type, owner_name, owner_phone, is_owner_verified, verification_status,
        bhk, bathrooms, balconies, price, carpet_area_sqft, super_builtup_area_sqft,
        address_line, locality, city, latitude, longitude,
        description, primary_image_url, images, amenities
      ) VALUES (
        'sobha-rose-residency-104',
        '3 BHK Sunlit Flat in Sobha Rose Residency', 'Apartment', 'buy', 'Sobha Rose Residency', 2,
        'owner', 'Suresh Nambiar', '+91 97401 54321', 1, 'verified',
        3, 3, 2, 19200000.00, 1480, 1850,
        'Hope Farm Junction, Whitefield', 'Whitefield', 'Bengaluru', 12.98400000, 77.75200000,
        'German engineering precision by Sobha. Beautiful 3 BHK apartment with unobstructed central park view.',
        'https://lh3.googleusercontent.com/aida-public/AB6AXuBxhM0C7tere8cgYGu_XfxI7o9pDs_cqEOBFdfIJrmqP_kWMLm4iT9mWUfSLeqyJzcUqSyIcntGNJ0-rJ1xJ-bmChFqi9z6I6GxyMNhUsvEBRS1tkvyxlPCrWh63WR-xrJUwxakNZGjdpsrphE2akpNOaXdiqTxlp3ZlYaDJK95A1qpCqPqwWaENVdqKRqQ9rmgV8PQTUO2dlsckI3UzwjcmkoNnWpOh_PTe3HAupuIKXU3kuEiKDHf',
        '[]', '[]'
      )
    `);
  }

  console.log('[migrate-properties] Migration and seed completed successfully!');
  await conn.end();
}

migrateProperties().catch(err => {
  console.error('[migrate-properties] Fatal Error:', err);
  process.exit(1);
});

