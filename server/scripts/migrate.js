'use strict';
/**
 * migrate.js — Idempotent database & table creation script.
 * Run: node scripts/migrate.js
 * Safe to run multiple times; uses IF NOT EXISTS everywhere.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migrate() {
  // Connect without specifying a database first so we can CREATE DATABASE
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  const dbName = process.env.DB_NAME || 'vastu_reviews';

  console.log(`[migrate] Ensuring database '${dbName}' exists…`);
  // CREATE DATABASE / USE do not support prepared statement protocol — use query()
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${dbName}\``);

  console.log('[migrate] Ensuring reviews table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,
      user_id          INT UNSIGNED    NULL COMMENT 'NULL = guest submission',
      reviewer_name    VARCHAR(120)    NOT NULL,
      profile_image_url VARCHAR(512)   NULL,
      designation      VARCHAR(120)    NULL,
      city             VARCHAR(80)     NULL,
      rating           TINYINT UNSIGNED NOT NULL COMMENT '1–5',
      review_text      TEXT            NOT NULL,
      property_context VARCHAR(200)    NULL COMMENT 'e.g. Bought 3 BHK in Whitefield',
      is_guest         TINYINT(1)      NOT NULL DEFAULT 1,
      is_demo          TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1 = seed/demo record',
      status           ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_status_created (status, created_at DESC),
      INDEX idx_is_demo (is_demo),
      CONSTRAINT chk_rating CHECK (rating BETWEEN 1 AND 5)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('[migrate] Migration complete.');
  await conn.end();
}

migrate().catch(err => {
  console.error('[migrate] ERROR:', err.message);
  process.exit(1);
});
