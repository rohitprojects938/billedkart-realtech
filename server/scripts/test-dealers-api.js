'use strict';
/**
 * test-dealers-api.js — Comprehensive automated test suite for Dealers & Agents system.
 * Run: node server/scripts/test-dealers-api.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

const BASE_URL = 'http://127.0.0.1:4000';

async function runTests() {
  console.log('====================================================');
  console.log(' STARTING Billedkart Realtech DEALERS & AGENTS API TEST SUITE');
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
      } catch (e) {}

      return { status: res.status, headers: res.headers, data: json };
    }
  }

  const clientA = new SessionClient();
  const clientB = new SessionClient();
  const anon = new SessionClient();

  const timestamp = Date.now();
  const emailA = `dealer_client_a_${timestamp}@example.com`;
  const userA = `d_client_a_${timestamp}`;
  const emailB = `dealer_client_b_${timestamp}@example.com`;
  const userB = `d_client_b_${timestamp}`;
  const password = 'Password123!';

  try {
    const phoneA = '9873' + Math.floor(100000 + Math.random() * 900000);
    const phoneB = '9872' + Math.floor(100000 + Math.random() * 900000);

    // 1. Register User A
    const regA = await clientA.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Aditya Birla',
        email: emailA,
        username: userA,
        phone: phoneA,
        password: password,
      }),
    });
    assert(regA.status === 201 && regA.data.success, 'User A registered and authenticated');

    // 2. Register User B
    const regB = await clientB.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Bina Mehra',
        email: emailB,
        username: userB,
        phone: phoneB,
        password: password,
      }),
    });
    assert(regB.status === 201 && regB.data.success, 'User B registered and authenticated');

    // TEST 1: GET /api/dealers returns list with ranking
    const dealersList = await anon.request('/api/dealers?limit=10');
    assert(dealersList.status === 200 && dealersList.data.success, 'GET /api/dealers returns 200 OK');
    assert(dealersList.data.dealers.length >= 4, `At least 4 dealers returned (got ${dealersList.data.dealers.length})`);
    const firstAgent = dealersList.data.dealers[0];
    assert(firstAgent.name && firstAgent.locality && typeof firstAgent.rating === 'number', 'Dealer card fields properly mapped');

    // TEST 2: Filter by city
    const blrList = await anon.request('/api/dealers?city=Bengaluru');
    assert(blrList.status === 200 && blrList.data.dealers.every(d => d.city.includes('Bengaluru') || d.locality.includes('Bengaluru')), 'City filter works correctly');

    // TEST 3: Filter by role
    const brokerList = await anon.request('/api/dealers?role=broker');
    assert(brokerList.status === 200 && brokerList.data.dealers.every(d => d.role === 'broker'), 'Role filter works correctly');

    // TEST 4: Filter by verified_only
    const verList = await anon.request('/api/dealers?verified_only=true');
    assert(verList.status === 200 && verList.data.dealers.every(d => d.isVerified), 'Verified filter works correctly');

    // TEST 5: GET /api/dealers/:id returns single agent details
    const targetAgentId = firstAgent.id;
    const singleAgent = await anon.request(`/api/dealers/${targetAgentId}`);
    assert(singleAgent.status === 200 && singleAgent.data.dealer.id === targetAgentId, 'GET /api/dealers/:id returns single agent profile');
    assert(typeof singleAgent.data.dealer.bio === 'string', 'Single agent includes full biography');

    // TEST 6: Unauthenticated user cannot review an agent
    const anonRev = await anon.request(`/api/dealers/${targetAgentId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5, review_text: 'Unauthenticated review attempt.' }),
    });
    assert(anonRev.status === 401, 'Unauthenticated review submission returns 401 Unauthorized');

    // TEST 7: User A submits first review for Agent
    const revA = await clientA.request(`/api/dealers/${targetAgentId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Aditya Birla',
        rating: 5,
        review_text: 'Excellent neighborhood consultation for Indiranagar 100ft road! Extremely polite and knowledgeable.',
        property_context: 'Bought 3 BHK in Indiranagar',
      }),
    });
    assert(revA.status === 201 && revA.data.success, 'User A successfully submitted review for agent');
    const createdReviewId = revA.data.id;

    // TEST 8: 30-day cooldown rejects immediate second review for SAME agent
    const revDup = await clientA.request(`/api/dealers/${targetAgentId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: 'Aditya Birla',
        rating: 4,
        review_text: 'Attempting to bypass 30-day cooldown on same agent.',
      }),
    });
    assert(revDup.status === 429 && revDup.data.cooldown === true, 'Duplicate review within 30 days rejected with 429 and cooldown: true');
    assert(revDup.data.error.includes("You've already submitted a review for this agent"), 'Correct agent-specific cooldown message');

    // TEST 9: Cooldown check endpoint confirms inCooldown = true
    const cdCheck = await clientA.request(`/api/dealers/${targetAgentId}/reviews/cooldown`);
    assert(cdCheck.status === 200 && cdCheck.data.inCooldown === true, 'GET /api/dealers/:id/reviews/cooldown returns inCooldown: true');
    assert(cdCheck.data.existingReview && cdCheck.data.existingReview.id === createdReviewId, 'Cooldown endpoint includes user existingReview info');

    // TEST 10: Owner can edit review during cooldown
    const editRev = await clientA.request(`/api/dealers/${targetAgentId}/reviews/${createdReviewId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        review_text: 'UPDATED: Even more pleased after the final sale deed Kaveri 2.0 registration! Outstanding agent.',
        property_context: 'Bought 3 BHK in Indiranagar',
      }),
    });
    assert(editRev.status === 200 && editRev.data.success, 'Owner successfully edited agent review during cooldown');

    // TEST 11: Another user (User B) cannot edit or delete User A's review
    const tamperEdit = await clientB.request(`/api/dealers/${targetAgentId}/reviews/${createdReviewId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 1, review_text: 'Tampering with another user review.' }),
    });
    assert(tamperEdit.status === 403, 'Another user cannot edit review (403 Forbidden)');

    const tamperDel = await clientB.request(`/api/dealers/${targetAgentId}/reviews/${createdReviewId}`, {
      method: 'DELETE',
    });
    assert(tamperDel.status === 403, 'Another user cannot delete review (403 Forbidden)');

    // TEST 12: Owner deletes review; cooldown remains enforced
    const delRev = await clientA.request(`/api/dealers/${targetAgentId}/reviews/${createdReviewId}`, {
      method: 'DELETE',
    });
    assert(delRev.status === 200 && delRev.data.success, 'Owner successfully deleted review');

    const revAfterDel = await clientA.request(`/api/dealers/${targetAgentId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5, review_text: 'Attempting to submit new review after deleting previous one.' }),
    });
    assert(revAfterDel.status === 429, 'Submission rejected with 429 after deletion (30-day cooldown NOT bypassed)');

    // TEST 13: Consultation request submission
    const consultEmail = `pooja_${Date.now()}@example.com`;
    const consultPhone = `+91 987${Math.floor(1000000 + Math.random() * 9000000)}`;
    const consultRes = await anon.request(`/api/dealers/${targetAgentId}/consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Pooja Hegde',
        client_phone: consultPhone,
        client_email: consultEmail,
        contact_method: 'whatsapp',
        preferred_time: 'Evening 5 PM',
        message: 'Interested in seeing 3 BHK luxury villas in your territory.',
      }),
    });
    assert(consultRes.status === 200 && consultRes.data.success, 'Consultation request submitted successfully');

    // Duplicate consultation within 10 mins returns 429
    const dupConsult = await anon.request(`/api/dealers/${targetAgentId}/consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Pooja Hegde',
        client_phone: consultPhone,
        client_email: consultEmail,
        contact_method: 'whatsapp',
      }),
    });
    assert(dupConsult.status === 429, 'Duplicate consultation request within 10 mins throttled (429)');

    // TEST 14: User B registers as a new agent
    const regAgentRes = await clientB.request('/api/dealers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bina Mehra',
        agency_name: 'Mehra Prime Realty',
        role: 'agent',
        phone: '+91 98200 11223',
        email: emailB,
        city: 'Mumbai',
        locality: 'Powai & Hiranandani',
        specialization: 'Luxury Highrises & Penthouse Resale',
        bio: 'Over 9 years advisory experience in Powai and Kanjurmarg.',
        experience_years: 9,
      }),
    });
    assert(regAgentRes.status === 201 && regAgentRes.data.success, 'User B successfully registered as an Agent');
    const newAgentId = regAgentRes.data.id;

    // Duplicate registration for same user account rejected
    const dupReg = await clientB.request('/api/dealers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bina Mehra',
        role: 'agent',
        phone: '+91 98200 11223',
        email: emailB,
        city: 'Mumbai',
        locality: 'Powai',
        specialization: 'Plots',
      }),
    });
    assert(dupReg.status === 409, 'Duplicate agent registration for same account rejected with 409 Conflict');

    // TEST 15: Agent profile management: User B fetches and updates own profile
    const myProfile = await clientB.request('/api/dealers/me/profile');
    assert(myProfile.status === 200 && myProfile.data.hasProfile === true && myProfile.data.agent.id === newAgentId, 'GET /api/dealers/me/profile returns own profile');

    const updateProfile = await clientB.request('/api/dealers/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locality: 'Powai, Hiranandani & Chandivali',
        bio: 'Updated bio with 10 years experience.',
        experience_years: 10,
      }),
    });
    assert(updateProfile.status === 200 && updateProfile.data.success, 'PUT /api/dealers/me/profile successfully updates profile');

    // Clean up test data
    await pool.execute(`DELETE FROM agent_review_cooldowns WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))`, [emailA, emailB]);
    await pool.execute(`DELETE FROM agent_reviews WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))`, [emailA, emailB]);
    await pool.execute(`DELETE FROM agent_consultations WHERE agent_id = ? OR client_phone = '+91 98765 43210'`, [newAgentId]);
    await pool.execute(`DELETE FROM agents WHERE id = ?`, [newAgentId]);
    await pool.execute(`DELETE FROM users WHERE email IN (?, ?)`, [emailA, emailB]);

    console.log('\n====================================================');
    console.log(` RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('====================================================\n');

    if (failedCount > 0) process.exit(1);

  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
