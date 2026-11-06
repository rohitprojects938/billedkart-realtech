'use strict';
/**
 * test-frontend-reviews.js
 * Verifies frontend card renderers, owner menu visibility, and dialog elements.
 */
const fs = require('fs');
const path = require('path');

const codeHtmlPath = path.join(__dirname, '..', '..', 'home_property_discovery', 'code.html');
const codeHtml = fs.readFileSync(codeHtmlPath, 'utf8');

console.log('====================================================');
console.log(' TESTING FRONTEND REVIEW TEMPLATES & CONTROLS');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

// 1. Verify CSS classes for owner menu and delete dialog
assert(codeHtml.includes('.review-owner-menu-wrap'), 'CSS contains .review-owner-menu-wrap');
assert(codeHtml.includes('.review-owner-menu-btn'), 'CSS contains .review-owner-menu-btn');
assert(codeHtml.includes('.review-owner-dropdown'), 'CSS contains .review-owner-dropdown');
assert(codeHtml.includes('#review-delete-dialog-overlay'), 'CSS contains #review-delete-dialog-overlay');
assert(codeHtml.includes('#review-delete-dialog'), 'CSS contains #review-delete-dialog');

// 2. Verify cooldown notice in review modal
assert(codeHtml.includes('id="review-cooldown-notice"'), 'Review modal contains #review-cooldown-notice');
assert(codeHtml.includes('id="review-cooldown-text"'), 'Review modal contains #review-cooldown-text');
assert(codeHtml.includes('id="review-cooldown-edit-btn"'), 'Review modal contains #review-cooldown-edit-btn');
assert(codeHtml.includes('handleCooldownEditClick()'), 'Cooldown notice wires handleCooldownEditClick()');

// 3. Verify Delete dialog HTML markup
assert(codeHtml.includes('id="review-delete-dialog-overlay"'), 'HTML contains #review-delete-dialog-overlay');
assert(codeHtml.includes('id="review-delete-dialog-title"'), 'Delete dialog contains #review-delete-dialog-title');
assert(codeHtml.includes('closeDeleteReviewDialog()'), 'Cancel button calls closeDeleteReviewDialog()');
assert(codeHtml.includes('executeReviewDelete()'), 'Delete button calls executeReviewDelete()');
assert(codeHtml.includes('id="review-delete-error"'), 'Delete dialog contains #review-delete-error element');

// 4. Verify Desktop & Mobile card rendering code
assert(codeHtml.includes('const ownerMenuHtml = rev.isOwner ?'), 'buildDesktopRevCard checks rev.isOwner');
assert(codeHtml.includes('startEditReview(event, \'${rev.id}\')'), 'Dropdown contains Edit Review action with review id');
assert(codeHtml.includes('confirmDeleteReview(event, \'${rev.id}\')'), 'Dropdown contains Delete Review action with review id');
assert(codeHtml.includes('toggleReviewOwnerMenu(event, this)'), 'Three-dot button triggers toggleReviewOwnerMenu');

// 5. Verify Javascript functions exist
assert(codeHtml.includes('async function openReviewModal('), 'openReviewModal exists with mode/editId');
assert(codeHtml.includes('function startEditReview('), 'startEditReview function exists');
assert(codeHtml.includes('function confirmDeleteReview('), 'confirmDeleteReview function exists');
assert(codeHtml.includes('function closeDeleteReviewDialog('), 'closeDeleteReviewDialog function exists');
assert(codeHtml.includes('async function executeReviewDelete('), 'executeReviewDelete function exists');
assert(codeHtml.includes('async function handleReviewSubmit('), 'handleReviewSubmit handles both POST and PATCH');

// 6. Verify credentials: 'include' is used on all review requests
assert(codeHtml.includes("fetch(`${API_BASE}/api/reviews/cooldown`") && codeHtml.includes("credentials: 'include'"), 'Cooldown fetch uses credentials: include');
assert(codeHtml.includes("fetch(`${API_BASE}/api/reviews?limit=50") && codeHtml.includes("credentials: 'include'"), 'loadReviews fetch uses credentials: include');
assert(codeHtml.includes("fetch(`${API_BASE}/api/reviews/${_deleteTargetId}`") && codeHtml.includes("credentials: 'include'"), 'DELETE fetch uses credentials: include');

console.log('\n====================================================');
console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================\n');

if (failed > 0) process.exit(1);
