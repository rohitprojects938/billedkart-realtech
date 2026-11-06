'use strict';
/**
 * migrate-dealers.js — Idempotent migration for Dealers & Agents system.
 * Run: node server/scripts/migrate-dealers.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function migrateDealers() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  const dbName = process.env.DB_NAME || 'vastu_reviews';
  console.log(`[migrate-dealers] Connecting to database '${dbName}'…`);
  await conn.query(`USE \`${dbName}\``);

  // 1. Agents Table
  console.log('[migrate-dealers] Ensuring `agents` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id                     INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      user_id                INT UNSIGNED     NULL UNIQUE,
      name                   VARCHAR(120)     NOT NULL,
      agency_name            VARCHAR(120)     NULL,
      role                   ENUM('agent', 'broker', 'dealer', 'seller') NOT NULL DEFAULT 'agent',
      phone                  VARCHAR(20)      NOT NULL,
      email                  VARCHAR(191)     NOT NULL,
      city                   VARCHAR(80)      NOT NULL,
      locality               VARCHAR(160)     NOT NULL,
      specialization         VARCHAR(255)     NOT NULL,
      bio                    TEXT             NULL,
      experience_years       TINYINT UNSIGNED NOT NULL DEFAULT 1,
      profile_image_url      VARCHAR(512)     NULL,
      certification_name     VARCHAR(160)     NULL,
      certification_doc_url  VARCHAR(512)     NULL,
      verification_status    ENUM('verified', 'pending', 'rejected', 'unverified') NOT NULL DEFAULT 'unverified',
      status                 ENUM('approved', 'pending', 'suspended') NOT NULL DEFAULT 'approved',
      contact_preference     ENUM('all', 'phone', 'whatsapp', 'email', 'form') NOT NULL DEFAULT 'all',
      whatsapp_number        VARCHAR(20)      NULL,
      active_listings_count  INT UNSIGNED     NOT NULL DEFAULT 0,
      completed_deals_count  INT UNSIGNED     NOT NULL DEFAULT 0,
      average_rating         DECIMAL(3, 1)    NOT NULL DEFAULT 0.0,
      reviews_count          INT UNSIGNED     NOT NULL DEFAULT 0,
      ranking_score          DECIMAL(5, 2)    NOT NULL DEFAULT 0.00,
      created_at             DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at             DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_city_status (city, status),
      INDEX idx_role (role),
      INDEX idx_verification (verification_status),
      INDEX idx_ranking (ranking_score DESC, reviews_count DESC),
      CONSTRAINT fk_agents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 2. Agent Reviews Table
  console.log('[migrate-dealers] Ensuring `agent_reviews` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS agent_reviews (
      id                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      agent_id          INT UNSIGNED     NOT NULL,
      user_id           INT UNSIGNED     NOT NULL,
      reviewer_name     VARCHAR(120)     NOT NULL,
      rating            TINYINT UNSIGNED NOT NULL COMMENT '1-5',
      review_text       TEXT             NOT NULL,
      property_context  VARCHAR(200)     NULL COMMENT 'e.g. Bought 3 BHK Villa in Whitefield',
      status            ENUM('approved', 'pending', 'rejected') NOT NULL DEFAULT 'approved',
      created_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_agent_reviews (agent_id, status, created_at DESC),
      INDEX idx_user_reviews (user_id),
      CONSTRAINT fk_agent_rev_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      CONSTRAINT fk_agent_rev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT chk_agent_rating CHECK (rating BETWEEN 1 AND 5)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 3. Agent Review Cooldowns Table (enforces 30-day anti-spam cooldown per user per agent)
  console.log('[migrate-dealers] Ensuring `agent_review_cooldowns` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS agent_review_cooldowns (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      agent_id     INT UNSIGNED NOT NULL,
      user_id      INT UNSIGNED NOT NULL,
      submitted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_agent_user_cooldown (user_id, agent_id, submitted_at DESC),
      CONSTRAINT fk_cd_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      CONSTRAINT fk_cd_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 4. Agent Consultations Table
  console.log('[migrate-dealers] Ensuring `agent_consultations` table exists…');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS agent_consultations (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
      agent_id        INT UNSIGNED NOT NULL,
      user_id         INT UNSIGNED NULL,
      client_name     VARCHAR(120) NOT NULL,
      client_phone    VARCHAR(20)  NOT NULL,
      client_email    VARCHAR(191) NOT NULL,
      contact_method  ENUM('form', 'call', 'whatsapp', 'email') NOT NULL DEFAULT 'form',
      preferred_time  VARCHAR(80)  NULL,
      message         TEXT         NULL,
      status          ENUM('new', 'contacted', 'closed') NOT NULL DEFAULT 'new',
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_agent_consult (agent_id, created_at DESC),
      CONSTRAINT fk_consult_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      CONSTRAINT fk_consult_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('[migrate-dealers] Migration completed successfully.');
  await conn.end();
}

migrateDealers().catch(err => {
  console.error('[migrate-dealers] ERROR:', err);
  process.exit(1);
});
