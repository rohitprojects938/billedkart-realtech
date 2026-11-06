/**
 * Billedkart Realtech — Global Centralized Contact Configuration
 * 
 * Official Contact Details:
 *   Phone:    +91 9044268001
 *   WhatsApp: +91 9044268001 (https://wa.me/919044268001)
 *   Email:    billedkart@gmail.com (mailto:billedkart@gmail.com)
 * 
 * Available universally via window.BilledkartContact across all pages and modules.
 */

(function () {
  'use strict';

  const BilledkartContact = {
    // Core Official Numbers
    PHONE_RAW: '9044268001',
    COUNTRY_CODE: '+91',
    FULL_PHONE: '+919044268001',
    DISPLAY_PHONE: '+91 9044268001',
    DISPLAY_PHONE_COMPACT: '9044268001',

    // Official WhatsApp
    WHATSAPP_NUMBER: '919044268001',
    WHATSAPP_LINK: 'https://wa.me/919044268001',

    // Official Support Email
    EMAIL: 'billedkart@gmail.com',
    MAILTO_LINK: 'mailto:billedkart@gmail.com',

    // Official Hours & Advisory Desk Label
    SUPPORT_HOURS: '9:00 AM – 8:00 PM (Mon – Sun)',
    DESK_LABEL: 'Billedkart Realtech Verified Advisory Desk',

    /**
     * Resolves an agent/consultant phone number with priority:
     * 1. Verified individual phone (if consultant is verified and not demo)
     * 2. Official fallback (+91 9044268001)
     */
    resolveConsultantPhone: function (agent) {
      if (!agent) return this.DISPLAY_PHONE;
      if (!agent.isDemo && !agent.is_demo && agent.phone && !agent.phone.includes('*')) {
        return agent.phone;
      }
      return this.DISPLAY_PHONE;
    },

    /**
     * Resolves an agent/consultant WhatsApp number with priority
     */
    resolveConsultantWhatsApp: function (agent, message) {
      let num = this.WHATSAPP_NUMBER;
      if (agent && !agent.isDemo && !agent.is_demo && (agent.whatsappNumber || agent.whatsapp_number)) {
        const custom = (agent.whatsappNumber || agent.whatsapp_number).replace(/[^0-9]/g, '');
        if (custom && custom.length >= 10) num = custom;
      }
      const text = message ? `?text=${encodeURIComponent(message)}` : '';
      return `https://wa.me/${num}${text}`;
    },

    /**
     * Generate tel: link
     */
    getTelHref: function (customPhone) {
      const num = customPhone ? customPhone.replace(/[^0-9+]/g, '') : this.FULL_PHONE;
      return `tel:${num}`;
    },

    /**
     * Generate WhatsApp wa.me link
     */
    getWhatsAppHref: function (messageText = '', customWhatsApp) {
      const num = customWhatsApp ? customWhatsApp.replace(/[^0-9]/g, '') : this.WHATSAPP_NUMBER;
      const text = messageText ? `?text=${encodeURIComponent(messageText)}` : '';
      return `https://wa.me/${num}${text}`;
    },

    /**
     * Generate mailto: link
     */
    getMailtoHref: function (subject = '', body = '', customEmail) {
      const email = customEmail || this.EMAIL;
      const params = [];
      if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
      if (body) params.push(`body=${encodeURIComponent(body)}`);
      const query = params.length > 0 ? `?${params.join('&')}` : '';
      return `mailto:${email}${query}`;
    },

    /**
     * Directly trigger phone dialer
     */
    callSupport: function (customPhone) {
      window.location.href = this.getTelHref(customPhone);
    },

    /**
     * Directly trigger WhatsApp chat
     */
    openWhatsApp: function (messageText = 'Hi Billedkart Realtech, I need assistance.', customWhatsApp) {
      window.open(this.getWhatsAppHref(messageText, customWhatsApp), '_blank', 'noopener,noreferrer');
    },

    /**
     * Directly trigger email client
     */
    emailSupport: function (subject = 'Enquiry - Billedkart Realtech', body = '') {
      window.location.href = this.getMailtoHref(subject, body);
    },

    /**
     * Auto-sync any HTML elements configured with data attributes
     */
    syncDOM: function () {
      if (typeof document === 'undefined') return;

      // Sync phone text
      document.querySelectorAll('[data-contact-phone]').forEach(el => {
        el.textContent = this.DISPLAY_PHONE;
      });

      // Sync tel hrefs
      document.querySelectorAll('[data-contact-tel]').forEach(el => {
        el.setAttribute('href', this.getTelHref());
      });

      // Sync WhatsApp links
      document.querySelectorAll('[data-contact-whatsapp]').forEach(el => {
        const msg = el.getAttribute('data-whatsapp-msg') || 'Hi Billedkart Realtech, I need assistance.';
        el.setAttribute('href', this.getWhatsAppHref(msg));
      });

      // Sync email text
      document.querySelectorAll('[data-contact-email]').forEach(el => {
        el.textContent = this.EMAIL;
      });

      // Sync mailto hrefs
      document.querySelectorAll('[data-contact-mailto]').forEach(el => {
        const subj = el.getAttribute('data-email-subject') || 'Enquiry - Billedkart Realtech';
        el.setAttribute('href', this.getMailtoHref(subj));
      });
    }
  };

  // Expose globally
  if (typeof window !== 'undefined') {
    window.BilledkartContact = BilledkartContact;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BilledkartContact;
  }

  // Auto-init in browser
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => BilledkartContact.syncDOM());
    } else {
      BilledkartContact.syncDOM();
    }
  }
})();
