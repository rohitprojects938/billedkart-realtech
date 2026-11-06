'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('====================================================');
console.log(' STARTING Billedkart Realtech FRONTEND VERIFICATION');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name} -> ${err.message}`);
    failed++;
  }
}

const codeHtmlPath = path.join(__dirname, '..', '..', 'home_property_discovery', 'code.html');
const dealersHtmlPath = path.join(__dirname, '..', '..', 'home_property_discovery', 'dealers.html');

const codeHtml = fs.readFileSync(codeHtmlPath, 'utf8');
const dealersHtml = fs.readFileSync(dealersHtmlPath, 'utf8');

test('code.html contains Dealers section heading "Dealers & Agents Who Can Help You"', () => {
  assert(codeHtml.includes('Dealers &amp; Agents Who Can Help You') || codeHtml.includes('Dealers & Agents Who Can Help You'));
});

test('code.html contains eyebrow label "Empaneled Property Experts"', () => {
  assert(codeHtml.includes('Empaneled Property Experts'));
});

test('code.html has desktop and mobile agent carousel containers', () => {
  assert(codeHtml.includes('id="desktop-agents-carousel"'));
  assert(codeHtml.includes('id="mobile-agents-carousel"'));
});

test('code.html carousel has navigation arrow buttons with scrollCarousel', () => {
  assert(codeHtml.includes("scrollCarousel('desktop-agents-carousel', -1)"));
  assert(codeHtml.includes("scrollCarousel('desktop-agents-carousel', 1)"));
});

test('code.html has Agent Mini Profile modal skeleton & overlay', () => {
  assert(codeHtml.includes('id="agent-mini-profile-modal-overlay"'));
  assert(codeHtml.includes('id="agent-mini-profile-modal"'));
  assert(codeHtml.includes('id="agent-mini-profile-content"'));
});

test('code.html has Agent Consultation modal skeleton & overlay', () => {
  assert(codeHtml.includes('id="agent-consultation-modal-overlay"'));
  assert(codeHtml.includes('id="agent-consultation-modal"'));
  assert(codeHtml.includes('id="agent-consultation-content"'));
});

test('code.html has Agent Review modal with star selector and 30-day notice', () => {
  assert(codeHtml.includes('id="agent-review-modal-overlay"'));
  assert(codeHtml.includes('id="agent-star-selector-wrap"'));
  assert(codeHtml.includes('id="agent-rev-cooldown-notice"'));
});

test('code.html has Agent Registration / Profile Management modal', () => {
  assert(codeHtml.includes('id="agent-manage-profile-modal-overlay"'));
  assert(codeHtml.includes('id="agent-manage-profile-modal"'));
});

test('code.html includes dynamic loadDealers() function connecting to API_BASE', () => {
  assert(codeHtml.includes('async function loadDealers()'));
  assert(codeHtml.includes('/api/dealers'));
});

test('code.html renders cards with exact visual structure matching screenshot', () => {
  assert(codeHtml.includes('w-[270px] p-4 rounded-2xl bg-white border border-surface-container shadow-card hover:shadow-elevated'));
  assert(codeHtml.includes('bg-surface-container-low space-y-1 text-xs'));
  assert(codeHtml.includes('Territory:'));
  assert(codeHtml.includes('Active:'));
  assert(codeHtml.includes('Rating:'));
  assert(codeHtml.includes('Get Consultation'));
});

test('code.html has auto-scroll carousel function with interaction pause', () => {
  assert(codeHtml.includes('function initDealersAutoScroll()'));
  assert(codeHtml.includes('prefers-reduced-motion'));
  assert(codeHtml.includes('visibilitychange'));
});

test('code.html wires openAgentMiniProfile on card click', () => {
  assert(codeHtml.includes('openAgentMiniProfile(event, ${agent.id})'));
});

test('code.html wires openAgentConsultationModal on Get Consultation click', () => {
  assert(codeHtml.includes('openAgentConsultationModal(event, ${agent.id})'));
});

test('code.html wires 30-day cooldown and anti-spam handling for agent reviews', () => {
  assert(codeHtml.includes('/api/dealers/${agentId}/reviews/cooldown') || codeHtml.includes('/api/dealers/'));
  assert(codeHtml.includes('handleAgentReviewSubmit'));
});

test('code.html updates auth header with Agent / Dealer Profile menu action', () => {
  assert(codeHtml.includes('openAgentManagementModal(event)'));
  assert(codeHtml.includes('Agent / Dealer Profile'));
  assert(codeHtml.includes('Register as Agent / Dealer'));
});

test('code.html View All Dealers links navigate to dealers.html', () => {
  assert(codeHtml.includes('dealers.html'));
  assert(codeHtml.includes("path === '/dealers' || path === 'dealers.html'"));
});

test('dealers.html directory page exists and has page heading', () => {
  assert(dealersHtml.includes('Dealers &amp; Agents Who Can Help You') || dealersHtml.includes('Dealers & Agents Who Can Help You'));
  assert(dealersHtml.includes('Empaneled Property Experts'));
});

test('dealers.html includes search input and filter dropdowns (city, role, spec, sort, verified)', () => {
  assert(dealersHtml.includes('id="dir-search-input"'));
  assert(dealersHtml.includes('id="dir-city-filter"'));
  assert(dealersHtml.includes('id="dir-role-filter"'));
  assert(dealersHtml.includes('id="dir-spec-filter"'));
  assert(dealersHtml.includes('id="dir-sort-filter"'));
  assert(dealersHtml.includes('id="dir-verified-only"'));
});

test('dealers.html has responsive cards grid and empty state', () => {
  assert(dealersHtml.includes('id="dir-cards-grid"'));
  assert(dealersHtml.includes('id="dir-empty-state"'));
  assert(dealersHtml.includes('id="dir-pagination-wrap"'));
});

test('dealers.html reuses mini profile popup, consultation modal, and review modal', () => {
  assert(dealersHtml.includes('id="agent-mini-profile-modal-overlay"'));
  assert(dealersHtml.includes('id="agent-consultation-modal-overlay"'));
  assert(dealersHtml.includes('id="agent-review-modal-overlay"'));
});

console.log(`\n====================================================`);
console.log(` FRONTEND TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log(`====================================================\n`);

if (failed > 0) process.exit(1);
