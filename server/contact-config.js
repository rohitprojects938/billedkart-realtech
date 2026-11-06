'use strict';
/**
 * Billedkart Realtech — Server Contact Configuration
 * 
 * Official Contact Details:
 *   Phone:    +91 9044268001 (Raw: 9044268001)
 *   WhatsApp: +91 9044268001 (https://wa.me/919044268001)
 *   Email:    billedkart@gmail.com (mailto:billedkart@gmail.com)
 */

const BILLEDKART_CONTACT = Object.freeze({
  PHONE_RAW: '9044268001',
  COUNTRY_CODE: '+91',
  FULL_PHONE: '+919044268001',
  DISPLAY_PHONE: '+91 9044268001',
  WHATSAPP_NUMBER: '919044268001',
  WHATSAPP_URL: 'https://wa.me/919044268001',
  EMAIL: 'billedkart@gmail.com',
  MAILTO_URL: 'mailto:billedkart@gmail.com',
  DESK_LABEL: 'Billedkart Realtech Verified Advisory Desk'
});

module.exports = {
  BILLEDKART_CONTACT,

  getOfficialContact: () => ({ ...BILLEDKART_CONTACT }),

  /**
   * Resolves consultant contact with configurable fallback:
   * Real, verified individual consultants retain their personal details.
   * Demo / seeded / unverified consultants fallback to the official Billedkart desk.
   */
  resolveConsultantContact: (agent) => {
    const isDemo = Boolean(!agent || agent.is_demo || !agent.user_id);
    return {
      phone: (!isDemo && agent.phone) ? agent.phone : BILLEDKART_CONTACT.DISPLAY_PHONE,
      whatsapp: (!isDemo && agent.whatsapp_number) ? agent.whatsapp_number : BILLEDKART_CONTACT.FULL_PHONE,
      whatsappUrl: (!isDemo && agent.whatsapp_number) 
        ? `https://wa.me/${agent.whatsapp_number.replace(/[^0-9]/g, '')}` 
        : BILLEDKART_CONTACT.WHATSAPP_URL,
      email: (!isDemo && agent.email) ? agent.email : BILLEDKART_CONTACT.EMAIL,
      isDemo
    };
  }
};

