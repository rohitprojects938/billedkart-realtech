'use strict';
/**
 * email.js — Email delivery service for Billedkart Realtech
 * Handles transactional OTP emails for login, verification, and password resets.
 */
require('dotenv').config();
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || 'Billedkart Realtech Support <billedkart@gmail.com>';

let transporter = null;
const isConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  console.log(`[email] SMTP transporter initialized with host: ${SMTP_HOST}:${SMTP_PORT}`);
} else {
  console.log('[email] SMTP credentials not provided in .env. Operating in development fallback mode.');
}

/**
 * Send a 6-digit OTP email
 * @param {string} to - Recipient email
 * @param {string} otp - Plain 6-digit OTP
 * @param {'login'|'password_reset'|'email_verify'} purpose
 * @returns {Promise<{ delivered: boolean, message: string }>}
 */
async function sendOtpEmail(to, otp, purpose) {
  const titles = {
    login: 'Sign In to Your Billedkart Realtech Account',
    password_reset: 'Reset Your Billedkart Realtech Password',
    email_verify: 'Verify Your Billedkart Realtech Email Address',
  };

  const subject = titles[purpose] || 'Your Billedkart Realtech Verification Code';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #faf8ff; margin: 0; padding: 24px; color: #131b2e; }
        .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #eaedff; padding: 32px; box-shadow: 0 4px 20px rgba(0,35,111,0.06); }
        .logo { font-size: 24px; font-weight: 800; color: #00236f; margin-bottom: 20px; }
        .logo span { color: #fd651e; }
        .title { font-size: 18px; font-weight: 800; color: #00236f; margin-bottom: 8px; }
        .subtitle { font-size: 13px; color: #444651; line-height: 1.5; margin-bottom: 24px; }
        .otp-box { background: #f2f3ff; border: 1.5px dashed #00236f; border-radius: 12px; padding: 16px; text-align: center; margin: 24px 0; }
        .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #00236f; }
        .expiry { font-size: 11px; color: #757682; margin-top: 6px; }
        .warning { font-size: 11px; color: #ba1a1a; margin-top: 16px; line-height: 1.4; }
        .footer { font-size: 10px; color: #757682; margin-top: 32px; border-top: 1px solid #eaedff; padding-top: 16px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">Billedkart<span> Realtech</span></div>
        <div class="title">${subject}</div>
        <div class="subtitle">Use the verification code below to complete your request. Never share this code with anyone.</div>
        <div class="otp-box">
          <div class="otp-code">${otp}</div>
          <div class="expiry">Valid for 5 minutes • Single-use only</div>
        </div>
        <div class="warning">
          If you did not request this verification code, please ignore this email or review your account security.
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} Billedkart Realtech • India's Verified Real Estate Marketplace
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Billedkart Realtech Verification Code: ${otp}\n\nUse this code to ${subject.toLowerCase()}.\nThis code is valid for 5 minutes and can only be used once.\n\nIf you did not request this, please ignore this email.`;

  if (isConfigured && transporter) {
    try {
      await transporter.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text,
        html,
      });
      console.log(`[email] Verification code successfully sent to ${to} for ${purpose}`);
      return { delivered: true, message: 'Verification code sent.' };
    } catch (err) {
      console.error(`[email] SMTP delivery failed to ${to}:`, err.message);
      // Fallback log for development
      console.log(`[DEV OTP FALLBACK] Code for ${to} (${purpose}): [ ${otp} ]`);
      return { delivered: false, message: 'Email delivery encountered an error. Check server logs in dev.' };
    }
  } else {
    // Development mode fallback
    console.log(`\n======================================================`);
    console.log(`[DEV EMAIL OTP] To: ${to}`);
    console.log(`[DEV EMAIL OTP] Purpose: ${purpose}`);
    console.log(`[DEV EMAIL OTP] Verification Code: [ ${otp} ] (Valid 5 mins)`);
    console.log(`======================================================\n`);
    return { delivered: false, simulated: true, message: 'Verification code generated.' };
  }
}

module.exports = {
  sendOtpEmail,
  isConfigured,
};
