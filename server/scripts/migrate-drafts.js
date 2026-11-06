const path = require('path');
const dbPath = 'C:\\Users\\offic\\Desktop\\WEBISTES  PROJECTS\\REALSTATE MARKETPLACE WEBSITE\\server\\db';
const { pool } = require(dbPath);

async function migrate() {
  try {
    console.log("Running migration for property_drafts and property_documents...");
    
    // Create property_drafts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_drafts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        draft_token VARCHAR(64) UNIQUE NOT NULL,
        user_id INT UNSIGNED NULL,
        current_step TINYINT UNSIGNED NOT NULL DEFAULT 1,
        completion_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
        form_data JSON NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_draft_token (draft_token),
        INDEX idx_draft_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✓ property_drafts table ready.");

    // Create property_documents
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_documents (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        property_id INT UNSIGNED NULL,
        draft_token VARCHAR(64) NULL,
        user_id INT UNSIGNED NULL,
        document_type VARCHAR(64) NOT NULL DEFAULT 'ownership_proof',
        file_path VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        verification_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_doc_prop (property_id),
        INDEX idx_doc_draft (draft_token),
        INDEX idx_doc_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✓ property_documents table ready.");

    // Check if properties status has 'under_review'
    // Let's modify enum on properties if needed or check existing
    const [col] = await pool.query("SHOW COLUMNS FROM properties LIKE 'status'");
    console.log("properties.status column:", col[0].Type);
    if (!col[0].Type.includes('under_review')) {
      await pool.query(`
        ALTER TABLE properties 
        MODIFY COLUMN status ENUM('active','sold','rented','inactive','under_review','draft') NOT NULL DEFAULT 'active'
      `);
      console.log("✓ properties.status updated to include 'under_review' and 'draft'");
    }

    console.log("Migration complete!");
    process.exit(0);
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  }
}

migrate();

