'use strict';
const { pool } = require('../db');

async function migrate() {
  console.log('[Migration] Creating search-related tables...');
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_saved_locations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      session_id VARCHAR(128) NULL,
      city VARCHAR(100),
      locality VARCHAR(150),
      latitude DECIMAL(10, 8),
      longitude DECIMAL(11, 8),
      accuracy_meters INT DEFAULT 50,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('✔ Table user_saved_locations ready');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      session_id VARCHAR(128) NULL,
      search_name VARCHAR(150) NOT NULL,
      query_text VARCHAR(255),
      filters JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('✔ Table saved_searches ready');

  // Add indexes to properties table for high performance searching
  try {
    await pool.query('ALTER TABLE properties ADD INDEX idx_city_locality (city, locality)');
    console.log('✔ Added idx_city_locality');
  } catch (e) {
    if (!e.message.includes('Duplicate key')) console.log('Index note:', e.message);
  }

  try {
    await pool.query('ALTER TABLE properties ADD INDEX idx_trans_prop_type (transaction_type, property_type)');
    console.log('✔ Added idx_trans_prop_type');
  } catch (e) {
    if (!e.message.includes('Duplicate key')) console.log('Index note:', e.message);
  }

  try {
    await pool.query('ALTER TABLE properties ADD INDEX idx_price_bhk (price, bhk)');
    console.log('✔ Added idx_price_bhk');
  } catch (e) {
    if (!e.message.includes('Duplicate key')) console.log('Index note:', e.message);
  }

  console.log('[Migration] Complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[Migration Error]:', err);
  process.exit(1);
});

