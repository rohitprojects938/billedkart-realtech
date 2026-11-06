'use strict';
/**
 * approve.js — CLI Review Moderation Tool
 * Usage:
 *   node scripts/approve.js list        # List all pending reviews
 *   node scripts/approve.js <id>        # Approve review by ID (e.g. node scripts/approve.js 13)
 *   node scripts/approve.js all         # Approve all pending reviews
 *   node scripts/approve.js reject <id> # Reject review by ID
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || 'list';

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'vastu_reviews',
    charset:  'utf8mb4',
  });

  try {
    if (action === 'list') {
      const [rows] = await conn.execute(
        `SELECT id, reviewer_name, rating, status, city, review_text, created_at
         FROM reviews
         WHERE status = 'pending'
         ORDER BY id DESC`
      );
      if (rows.length === 0) {
        console.log('[moderation] No pending reviews found.');
      } else {
        console.log(`[moderation] Found ${rows.length} pending review(s):`);
        rows.forEach(r => {
          console.log(`  [ID: ${r.id}] ${r.reviewer_name} (${r.rating}★, ${r.city || 'No city'}) - "${r.review_text.slice(0, 60)}..." [${r.status}]`);
        });
      }
    } else if (action === 'all') {
      const [res] = await conn.execute(
        `UPDATE reviews SET status = 'approved' WHERE status = 'pending'`
      );
      console.log(`[moderation] Approved all pending reviews (${res.affectedRows} review(s) updated).`);
    } else if (action === 'reject') {
      const id = parseInt(args[1], 10);
      if (!id) throw new Error('Please provide a valid review ID to reject. E.g. node scripts/approve.js reject 12');
      const [res] = await conn.execute(
        `UPDATE reviews SET status = 'rejected' WHERE id = ?`,
        [id]
      );
      if (res.affectedRows === 0) console.log(`[moderation] Review #${id} not found.`);
      else console.log(`[moderation] Review #${id} rejected.`);
    } else {
      const id = parseInt(action, 10);
      if (!id) throw new Error(`Unknown command or invalid review ID: "${action}". Use 'list', 'all', or an integer ID.`);
      const [res] = await conn.execute(
        `UPDATE reviews SET status = 'approved' WHERE id = ?`,
        [id]
      );
      if (res.affectedRows === 0) {
        console.log(`[moderation] Review #${id} not found.`);
      } else {
        console.log(`[moderation] Review #${id} approved successfully! It is now live in public reviews.`);
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('[moderation] Error:', err.message);
  process.exit(1);
});
