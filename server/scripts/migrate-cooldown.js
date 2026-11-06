'use strict';
/**
 * migrate-cooldown.js
 * Creates `review_cooldowns` table to enforce 30-day submission cooldown per account.
 * Even if a review is subsequently deleted, the cooldown record remains persistent.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool } = require('../db');

async function migrate() {
  console.log('[migrate-cooldown] Ensuring review_cooldowns table exists…');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_cooldowns (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_user_cooldown (user_id, submitted_at),
      CONSTRAINT fk_cooldown_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  console.log('[migrate-cooldown] Backfilling cooldown records from existing user reviews…');
  await pool.query(`
    INSERT INTO review_cooldowns (user_id, submitted_at)
    SELECT r.user_id, r.created_at
    FROM reviews r
    WHERE r.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM review_cooldowns rc WHERE rc.user_id = r.user_id
      );
  `);

  console.log('[migrate-cooldown] Migration completed successfully.');
  await pool.end();
}

migrate().catch(err => {
  console.error('[migrate-cooldown] Migration failed:', err);
  process.exit(1);
});
