'use strict';
/**
 * migrate-phone-auth.js — Idempotent migration for Firebase Phone Authentication
 * Updates users table to support optional email and verified phone numbers.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migratePhoneAuth() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  const dbName = process.env.DB_NAME || 'vastu_reviews';
  console.log(`[migrate-phone-auth] Connecting to '${dbName}'…`);
  await conn.query(`USE \`${dbName}\``);

  // 1. Modify users.email to allow NULL (since email is now optional)
  console.log('[migrate-phone-auth] Modifying users.email to allow NULL…');
  try {
    await conn.query(`ALTER TABLE users MODIFY COLUMN email VARCHAR(191) NULL`);
    console.log('✓ users.email modified to NULL');
  } catch (err) {
    console.warn('[migrate-phone-auth] Warning on modifying email:', err.message);
  }

  // 2. Add is_phone_verified and phone_verified_at if not present
  const [cols] = await conn.query(`SHOW COLUMNS FROM users`);
  const colNames = cols.map(c => c.Field);

  if (!colNames.includes('is_phone_verified')) {
    console.log('[migrate-phone-auth] Adding is_phone_verified column…');
    await conn.query(`ALTER TABLE users ADD COLUMN is_phone_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER phone`);
    console.log('✓ is_phone_verified column added');
  }

  if (!colNames.includes('phone_verified_at')) {
    console.log('[migrate-phone-auth] Adding phone_verified_at column…');
    await conn.query(`ALTER TABLE users ADD COLUMN phone_verified_at DATETIME NULL AFTER is_phone_verified`);
    console.log('✓ phone_verified_at column added');
  }

  // 3. Ensure unique index on phone
  const [indexes] = await conn.query(`SHOW INDEX FROM users WHERE Key_name = 'uq_users_phone'`);
  if (indexes.length === 0) {
    console.log('[migrate-phone-auth] Adding UNIQUE KEY uq_users_phone on users(phone)…');
    try {
      await conn.query(`ALTER TABLE users ADD UNIQUE KEY uq_users_phone (phone)`);
      console.log('✓ uq_users_phone added');
    } catch (e) {
      console.warn('[migrate-phone-auth] Unique key add note:', e.message);
    }
  }

  console.log('[migrate-phone-auth] Migration completed successfully.');
  await conn.end();
}

migratePhoneAuth().catch(err => {
  console.error('[migrate-phone-auth] ERROR:', err.message);
  process.exit(1);
});
