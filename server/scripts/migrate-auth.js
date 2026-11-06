'use strict';
/**
 * migrate-auth.js — Idempotent migration for Billedkart Realtech authentication system.
 * Run: node scripts/migrate-auth.js
 * Safely creates users, external_identities, otp_codes, and sessions tables.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migrateAuth() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  const dbName = process.env.DB_NAME || 'vastu_reviews';
  console.log(`[migrate-auth] Connecting to database '${dbName}'…`);
  await conn.query(`USE \`${dbName}\``);

  // 1. Users Table
  console.log('[migrate-auth] Ensuring `users` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                 INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      full_name          VARCHAR(120)     NOT NULL,
      username           VARCHAR(60)      NOT NULL,
      email              VARCHAR(191)     NOT NULL,
      password_hash      VARCHAR(255)     NULL COMMENT 'NULL for Google-only users',
      phone              VARCHAR(20)      NULL,
      is_email_verified  TINYINT(1)       NOT NULL DEFAULT 0,
      email_verified_at  DATETIME         NULL,
      profile_image_url  VARCHAR(512)     NULL,
      status             ENUM('active','suspended','deactivated') NOT NULL DEFAULT 'active',
      role               ENUM('user','admin') NOT NULL DEFAULT 'user',
      last_login_at      DATETIME         NULL,
      created_at         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_email (email),
      INDEX idx_users_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 2. External Identities Table (for Google OAuth and future OIDC providers)
  console.log('[migrate-auth] Ensuring `external_identities` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS external_identities (
      id                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      user_id           INT UNSIGNED     NOT NULL,
      provider          VARCHAR(50)      NOT NULL COMMENT 'e.g. google',
      provider_user_id  VARCHAR(255)     NOT NULL COMMENT 'Stable subject ID from provider',
      provider_email    VARCHAR(191)     NULL,
      created_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_provider_sub (provider, provider_user_id),
      INDEX idx_ext_user_id (user_id),
      CONSTRAINT fk_ext_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 3. OTP Codes Table (for email OTP login & password reset)
  console.log('[migrate-auth] Ensuring `otp_codes` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      email             VARCHAR(191)     NOT NULL,
      otp_hash          VARCHAR(64)      NOT NULL COMMENT 'SHA-256 hash of the 6-digit OTP',
      purpose           ENUM('login', 'password_reset', 'email_verify') NOT NULL,
      attempts          TINYINT UNSIGNED NOT NULL DEFAULT 0,
      expires_at        DATETIME         NOT NULL,
      consumed_at       DATETIME         NULL,
      created_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_otp_email_purpose (email, purpose, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 4. Sessions Table (for express-mysql-session persistent storage)
  console.log('[migrate-auth] Ensuring `sessions` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id        VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      expires           INT UNSIGNED     NOT NULL,
      data              MEDIUMTEXT COLLATE utf8mb4_bin,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
  `);

  // 5. Login Issues & Failure Reports Table
  console.log('[migrate-auth] Ensuring `login_issues` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS login_issues (
      id                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      error_category    VARCHAR(64)      NOT NULL COMMENT 'e.g. phone_quota_exceeded, rate_limited, network_error, google_oauth_failed',
      error_code        VARCHAR(64)      NULL,
      error_message     VARCHAR(255)     NULL,
      user_identifier   VARCHAR(120)     NULL COMMENT 'Sanitized phone or email (no credentials)',
      user_message      TEXT             NULL COMMENT 'Optional user feedback message',
      ip_address        VARCHAR(45)      NULL,
      user_agent        VARCHAR(255)     NULL,
      client_timestamp  VARCHAR(64)      NULL,
      status            ENUM('open', 'investigating', 'resolved') NOT NULL DEFAULT 'open',
      admin_notes       TEXT             NULL,
      created_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_category_created (error_category, created_at),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('[migrate-auth] Authentication migration completed successfully.');
  await conn.end();
}

migrateAuth().catch(err => {
  console.error('[migrate-auth] Migration failed:', err.message);
  process.exit(1);
});
