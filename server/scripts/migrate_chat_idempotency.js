const { pool } = require('../db');

async function runMigration() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM messages LIKE 'client_message_id'");
    if (cols.length === 0) {
      console.log('[Migration] Adding client_message_id to messages...');
      await pool.query("ALTER TABLE messages ADD COLUMN client_message_id VARCHAR(64) DEFAULT NULL UNIQUE AFTER sender_id");
      console.log('[Migration] client_message_id column added successfully.');
    } else {
      console.log('[Migration] client_message_id column already exists.');
    }

    // Verify index on conversation_id and delivery_status
    const [indexes] = await pool.query("SHOW INDEX FROM messages WHERE Key_name = 'idx_conv_status'");
    if (indexes.length === 0) {
      console.log('[Migration] Adding idx_conv_status index...');
      await pool.query("CREATE INDEX idx_conv_status ON messages (conversation_id, delivery_status)");
      console.log('[Migration] idx_conv_status index added successfully.');
    } else {
      console.log('[Migration] idx_conv_status index already exists.');
    }
  } catch (err) {
    console.error('[Migration Error]', err);
  } finally {
    process.exit(0);
  }
}

runMigration();

