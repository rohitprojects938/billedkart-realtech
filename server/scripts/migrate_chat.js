'use strict';
/**
 * migrate_chat.js
 * Creates conversations and messages tables for real-time buyer-seller chat.
 * Ensures properties have valid owner accounts for real-time test flows.
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

async function migrateChat() {
  console.log('[migrate_chat] Starting Chat schema migration...');

  // 1. Create conversations table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      property_id INT UNSIGNED NOT NULL,
      buyer_id INT UNSIGNED NOT NULL,
      seller_id INT UNSIGNED NOT NULL,
      last_message_id INT UNSIGNED NULL,
      buyer_archived TINYINT(1) NOT NULL DEFAULT 0,
      seller_archived TINYINT(1) NOT NULL DEFAULT 0,
      buyer_muted TINYINT(1) NOT NULL DEFAULT 0,
      seller_muted TINYINT(1) NOT NULL DEFAULT 0,
      buyer_last_read_at TIMESTAMP NULL DEFAULT NULL,
      seller_last_read_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_property_buyer_seller (property_id, buyer_id, seller_id),
      INDEX idx_buyer (buyer_id, buyer_archived, updated_at),
      INDEX idx_seller (seller_id, seller_archived, updated_at),
      INDEX idx_property (property_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('[migrate_chat] Table conversations verified.');

  // 2. Create messages table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT UNSIGNED NOT NULL,
      sender_id INT UNSIGNED NOT NULL,
      message_type ENUM('text', 'image', 'system') NOT NULL DEFAULT 'text',
      message_text TEXT NULL,
      attachment_url VARCHAR(500) NULL,
      delivery_status ENUM('sending', 'sent', 'delivered', 'read') NOT NULL DEFAULT 'sent',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at TIMESTAMP NULL DEFAULT NULL,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_conversation_created (conversation_id, created_at),
      INDEX idx_sender (sender_id),
      INDEX idx_conv_delivery (conversation_id, delivery_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('[migrate_chat] Table messages verified.');

  // 3. Create chat_user_settings table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_user_settings (
      user_id INT UNSIGNED PRIMARY KEY,
      sound_enabled TINYINT(1) NOT NULL DEFAULT 1,
      notifications_enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('[migrate_chat] Table chat_user_settings verified.');

  // 4. Ensure dedicated demo test accounts exist with known credentials for buyer & seller
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Billedkart@2026', salt);

  // Check / create seller account
  let [sellerRows] = await pool.query('SELECT id, full_name, email, phone FROM users WHERE email = ?', ['seller_demo@billedkart.com']);
  let sellerId;
  if (sellerRows.length === 0) {
    const [res] = await pool.query(`
      INSERT INTO users (full_name, username, email, password_hash, phone, is_phone_verified, is_email_verified, role, status)
      VALUES (?, ?, ?, ?, ?, 1, 1, 'user', 'active')
    `, ['Rohan Verma (Owner)', 'rohan_seller', 'seller_demo@billedkart.com', passwordHash, '+919044268001']);
    sellerId = res.insertId;
    console.log('[migrate_chat] Created demo seller user ID:', sellerId);
  } else {
    sellerId = sellerRows[0].id;
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, sellerId]);
    console.log('[migrate_chat] Demo seller user exists, ID:', sellerId);
  }

  // Check / create buyer account
  let [buyerRows] = await pool.query('SELECT id, full_name, email, phone FROM users WHERE email = ?', ['buyer_demo@billedkart.com']);
  let buyerId;
  if (buyerRows.length === 0) {
    const [res] = await pool.query(`
      INSERT INTO users (full_name, username, email, password_hash, phone, is_phone_verified, is_email_verified, role, status)
      VALUES (?, ?, ?, ?, ?, 1, 1, 'user', 'active')
    `, ['Aditya Buyer', 'aditya_buyer', 'buyer_demo@billedkart.com', passwordHash, '+919876543299']);
    buyerId = res.insertId;
    console.log('[migrate_chat] Created demo buyer user ID:', buyerId);
  } else {
    buyerId = buyerRows[0].id;
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, buyerId]);
    console.log('[migrate_chat] Demo buyer user exists, ID:', buyerId);
  }

  // 5. Update existing properties that have owner_user_id IS NULL to link to sellerId
  const [propUpdateRes] = await pool.query('UPDATE properties SET owner_user_id = ? WHERE owner_user_id IS NULL', [sellerId]);
  console.log('[migrate_chat] Properties updated with owner_user_id:', propUpdateRes.affectedRows);

  console.log('[migrate_chat] Chat schema migration completed successfully!');
}

if (require.main === module) {
  migrateChat()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate_chat] Error during migration:', err);
      process.exit(1);
    });
}

module.exports = { migrateChat };
