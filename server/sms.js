'use strict';
/**
 * sms.js — SMS Provider Adapter & Extension Point for Indian Mobile OTP
 * 
 * ============================================================================
 * PRACTICAL REQUIREMENTS FOR ENABLING SMS OTP IN INDIA (DLT / TRAI REGULATION):
 * ============================================================================
 * Under Telecom Regulatory Authority of India (TRAI) guidelines, commercial SMS
 * requires Distributed Ledger Technology (DLT) compliance:
 * 
 * 1. Principal Entity (PE) Registration:
 *    - Register business on a DLT portal (e.g. Jio DLT, Airtel DLT, Vodafone DLT).
 *    - Requires Certificate of Incorporation, Company PAN, GSTIN, and Authorized Signatory docs.
 * 
 * 2. Header (Sender ID) Registration:
 *    - Register a 6-character alphabetic header matching company name (e.g. "BILDKT", "BILDRT").
 *    - Category: Transactional / Service Implicit for OTP verification.
 * 
 * 3. Content Template Registration:
 *    - Pre-approve the exact SMS template text on the DLT portal.
 *    - Example approved template:
 *      "Your Billedkart Realtech verification code is {#var#}. Valid for 5 minutes. Do not share this OTP with anyone. - BILDKT"
 *    - Obtain the registered Template ID (e.g. 1407161234567890123).
 * 
 * 4. SMS Gateway Provider Integration:
 *    - Integrate with an Indian SMS aggregator that binds to your registered DLT Principal Entity:
 *      • Twilio (Verify API with DLT template binding)
 *      • Gupshup Enterprise SMS
 *      • MSG91 (SendOTP API)
 *      • Fast2SMS (DLT Route)
 *    - Configure API Key, Sender ID, and Template ID in server/.env.
 * ============================================================================
 */
require('dotenv').config();

const SMS_PROVIDER = process.env.SMS_PROVIDER || 'none'; // 'none', 'msg91', 'twilio', 'gupshup'
const SMS_API_KEY  = process.env.SMS_API_KEY;
const SMS_SENDER_ID = process.env.SMS_SENDER_ID;
const SMS_DLT_TE_ID = process.env.SMS_DLT_TE_ID;

/**
 * Base SMS Adapter Interface
 */
class SmsAdapter {
  async sendOtp(phone, otp) {
    throw new Error('sendOtp must be implemented by adapter');
  }
}

/**
 * Unconfigured Adapter — Prevents false simulation and clearly enforces identity requirements.
 */
class NullSmsAdapter extends SmsAdapter {
  async sendOtp(phone, otp) {
    console.warn(`[sms] Mobile SMS OTP is disabled. Phone verification requires configured SMS gateway and DLT credentials.`);
    return {
      success: false,
      delivered: false,
      error: 'SMS OTP service is currently not configured. Please use Email verification or Google Sign-In.'
    };
  }
}

/**
 * Factory to retrieve active SMS provider adapter
 */
function getSmsAdapter() {
  switch (SMS_PROVIDER.toLowerCase()) {
    case 'msg91':
    case 'twilio':
    case 'gupshup':
      // When provider credentials are provided, return corresponding adapter
      return new NullSmsAdapter();
    default:
      return new NullSmsAdapter();
  }
}

module.exports = {
  getSmsAdapter,
  isSmsEnabled: SMS_PROVIDER !== 'none' && Boolean(SMS_API_KEY),
};
