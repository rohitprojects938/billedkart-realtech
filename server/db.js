'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'vastu_reviews',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  charset:            'utf8mb4',
  timezone:           '+00:00',
});

// Lightweight connection health-check
async function testConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  console.log('[DB] MySQL connection pool ready.');
}

module.exports = { pool, testConnection };
