'use strict';
/**
 * test-review-ownership.js
 * End-to-end test suite for Review Ownership, Edit/Delete, and 30-Day Cooldown.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

const BASE_URL = 'http://127.0.0.1:4000';

async function runTests() {
  console.log('====================================================');
  console.log(' STARTING Billedkart Realtech REVIEW OWNERSHIP & COOLDOWN TESTS');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${message}`);
      failedCount++;
    }
  }

  // Helper for requests with cookie jar
  class SessionClient {
    constructor() {
      this.cookies = '';
    }

    async request(endpoint, options = {}) {
      const headers = options.headers || {};
      if (this.cookies) {
        headers['Cookie'] = this.cookies;
      }
      options.headers = headers;

      const res = await fetch(`${BASE_URL}${endpoint}`, options);
      if (typeof res.headers.getSetCookie === 'function') {
        const cookies = res.headers.getSetCookie();
        if (cookies && cookies.length > 0) {
          this.cookies = cookies.map(c => c.split(';')[0]).join('; ');
        }
      } else {
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) {
          this.cookies = setCookie.split(';')[0];
        }
      }
      let json = null;
      try {
        json = await res.json();
      } catch (e) {
        // ignore
      }
      return { status: res.status, headers: res.headers, data: json };
    }
  }

  const timestamp = Date.now();
  const userA_email = `owner_test_a_${timestamp}@example.com`;
  const userA_user = `owner_a_${timestamp}`;
  const userB_email = `owner_test_b_${timestamp}@example.com`;
  const userB_user = `owner_b_${timestamp}`;
  const password = 'Password123!';

  const clientA = new SessionClient();
  const clientB = new SessionClient();
  const anonymousClient = new SessionClient();

  try {
    const userA_phone = '9876' + Math.floor(100000 + Math.random() * 900000);
    const userB_phone = '9875' + Math.floor(100000 + Math.random() * 900000);

    // 1. Register User A
    const regA = await clientA.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Arun Kumar',
        email: userA_email,
        username: userA_user,
        phone: userA_phone,
        password: password,
      }),
    });
    assert(regA.status === 201 && regA.data.success, 'User A registered and authenticated');

    // 2. Register User B
    const regB = await clientB.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Bhavesh Shah',
        email: userB_email,
        username: userB_user,
        phone: userB_phone,
        password: password,
      }),
    });
    assert(regB.status === 201 && regB.data.success, 'User B registered and authenticated');

    // SCENARIO 9: Logged-out visitors cannot submit, edit, or delete reviews
    const anonPost = await anonymousClient.request('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Anon',
        rating: 5,
        review_text: 'This is an unauthenticated submission test.',
      }),
    });
    assert(anonPost.status === 401, 'Logged-out visitor cannot submit review (401 Unauthorized)');

    const anonEdit = await anonymousClient.request('/api/reviews/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Anon',
        rating: 4,
        review_text: 'Attempting to edit without auth.',
      }),
    });
    assert(anonEdit.status === 401, 'Logged-out visitor cannot edit review (401 Unauthorized)');

    const anonDelete = await anonymousClient.request('/api/reviews/1', {
      method: 'DELETE',
    });
    assert(anonDelete.status === 401, 'Logged-out visitor cannot delete review (401 Unauthorized)');

    // SCENARIO 1: A new authenticated user can submit a review
    const postResA = await clientA.request('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Arun Kumar',
        rating: 5,
        review_text: 'Outstanding experience buying in Indiranagar through Billedkart Realtech. Highly recommended verified listings!',
        designation: 'Architect',
        city: 'Bengaluru',
      }),
    });
    assert(postResA.status === 201 && postResA.data.success, 'Scenario 1: Authenticated User A submitted first review');
    const reviewA_id = postResA.data.id;

    // SCENARIO 2 & 3: The same user cannot submit another review within 30 days & correct cooldown message displayed
    const postResA_duplicate = await clientA.request('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Arun Kumar',
        rating: 4,
        review_text: 'Trying to submit a second review immediately during cooldown window.',
        city: 'Bengaluru',
      }),
    });
    assert(postResA_duplicate.status === 429, 'Scenario 2: User A rejected with 429 Too Many Requests when submitting again');
    assert(postResA_duplicate.data.cooldown === true, 'Cooldown flag present in response');
    assert(
      typeof postResA_duplicate.data.error === 'string' &&
      postResA_duplicate.data.error.includes("You've already submitted a review.") &&
      postResA_duplicate.data.error.includes("You can submit another review after") &&
      postResA_duplicate.data.error.includes("You can edit or delete your existing review using the three-dot menu"),
      'Scenario 3: Correct cooldown message with dynamic remaining time / date displayed'
    );

    // Also test GET /api/reviews/cooldown endpoint for User A
    const cdStatusRes = await clientA.request('/api/reviews/cooldown');
    assert(cdStatusRes.status === 200 && cdStatusRes.data.inCooldown === true, 'GET /api/reviews/cooldown confirms inCooldown = true');
    assert(cdStatusRes.data.daysRemaining >= 29, `Cooldown daysRemaining is realistic (calculated: ${cdStatusRes.data.daysRemaining} days)`);

    // Verify GET /api/reviews shows isOwner = true for User A and isOwner = false for User B
    const listForA = await clientA.request('/api/reviews?limit=20');
    const userAReviewInList = listForA.data.reviews.find(r => r.id === reviewA_id);
    assert(userAReviewInList && userAReviewInList.isOwner === true, 'Review shows isOwner: true for its owner');

    const listForB = await clientB.request('/api/reviews?limit=20');
    const reviewSeenByB = listForB.data.reviews.find(r => r.id === reviewA_id);
    assert(!reviewSeenByB || reviewSeenByB.isOwner === false, 'Review shows isOwner: false for another user');

    // SCENARIO 8 & 10: Another account cannot edit or delete the review / changing review ID rejected
    const tamperEdit = await clientB.request(`/api/reviews/${reviewA_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Bhavesh Hacker',
        rating: 1,
        review_text: 'I am tampering with another user review!',
      }),
    });
    assert(tamperEdit.status === 403, 'Scenario 8: Another account cannot edit review (403 Forbidden)');

    const tamperDelete = await clientB.request(`/api/reviews/${reviewA_id}`, {
      method: 'DELETE',
    });
    assert(tamperDelete.status === 403, 'Scenario 8: Another account cannot delete review (403 Forbidden)');

    const nonExistentEdit = await clientA.request('/api/reviews/99999999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Test',
        rating: 5,
        review_text: 'Editing non-existent review.',
      }),
    });
    assert(nonExistentEdit.status === 404, 'Scenario 10: Editing nonexistent review ID returns 404');

    // SCENARIO 4 & 5: Owner can edit their review during cooldown; no duplicate created, cooldown preserved
    // Get original creation time
    const [origRow] = await pool.execute(`SELECT created_at FROM reviews WHERE id = ?`, [reviewA_id]);
    const origCreatedAt = new Date(origRow[0].created_at).getTime();

    const editRes = await clientA.request(`/api/reviews/${reviewA_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Arun Kumar',
        rating: 5,
        review_text: 'UPDATED: Even better after 2 weeks in our new home! Kaveri 2.0 registration was fully handled.',
        designation: 'Senior Architect',
        city: 'Bengaluru',
      }),
    });
    assert(editRes.status === 200 && editRes.data.success, 'Scenario 4: Owner successfully edited review during cooldown');

    const [afterEditRow] = await pool.execute(`SELECT review_text, created_at FROM reviews WHERE id = ?`, [reviewA_id]);
    assert(afterEditRow[0].review_text.includes('UPDATED: Even better'), 'Database record updated with new text');
    const newCreatedAt = new Date(afterEditRow[0].created_at).getTime();
    assert(Math.abs(newCreatedAt - origCreatedAt) < 2000, 'Scenario 5: Original created_at timestamp preserved (cooldown not reset)');

    // Ensure total count in reviews table did not duplicate
    const [revCount] = await pool.execute(`SELECT COUNT(*) AS c FROM reviews WHERE user_id = (SELECT id FROM users WHERE email = ?)`, [userA_email]);
    assert(revCount[0].c === 1, 'Scenario 5: Exactly 1 review exists for user (no duplicates created)');

    // Verify cooldown is STILL active after edit
    const cdAfterEdit = await clientA.request('/api/reviews/cooldown');
    assert(cdAfterEdit.data.inCooldown === true, 'Cooldown is STILL active after edit');

    // SCENARIO 6 & 7: Owner can delete their review; deleting DOES NOT bypass the 30-day cooldown
    const deleteRes = await clientA.request(`/api/reviews/${reviewA_id}`, {
      method: 'DELETE',
    });
    assert(deleteRes.status === 200 && deleteRes.data.success, 'Scenario 6: Owner successfully deleted review');

    // Verify review was removed from reviews table
    const [deletedRow] = await pool.execute(`SELECT id FROM reviews WHERE id = ?`, [reviewA_id]);
    assert(deletedRow.length === 0, 'Review record successfully deleted from reviews table');

    // SCENARIO 7: Deleting does not bypass cooldown! Attempt to submit new review must STILL be rejected!
    const postAfterDelete = await clientA.request('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Arun Kumar',
        rating: 5,
        review_text: 'Attempting to bypass 30-day cooldown after deleting previous review.',
        city: 'Bengaluru',
      }),
    });
    assert(postAfterDelete.status === 429, 'Scenario 7: Submission rejected with 429 after deletion (30-day cooldown NOT bypassed)');
    assert(postAfterDelete.data.cooldown === true, 'Cooldown preserved in review_cooldowns');

    // SCENARIO 11: Summary ratings and review counts update correctly
    const summaryRes = await clientA.request('/api/reviews/summary');
    assert(summaryRes.status === 200 && summaryRes.data.success, 'Scenario 11: Summary endpoint returns valid metrics');
    assert(typeof summaryRes.data.total === 'number' && typeof summaryRes.data.average === 'number', 'Summary metrics are properly numeric');

    // Clean up test records
    await pool.execute(`DELETE FROM review_cooldowns WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))`, [userA_email, userB_email]);
    await pool.execute(`DELETE FROM reviews WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))`, [userA_email, userB_email]);
    await pool.execute(`DELETE FROM users WHERE email IN (?, ?)`, [userA_email, userB_email]);

    console.log('\n====================================================');
    console.log(` RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('====================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
