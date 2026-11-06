/**
 * ===================================================
 * Billedkart Realtech — Centralized Frontend Chat Utility
 * window.BilledkartChat
 * Handles:
 *  - Direct Buyer-to-Seller Internal Real-Time Chat
 *  - Direct Seller WhatsApp Contact (with seller phone + property context)
 *  - Unauthenticated Session Preservation & Auto-Resume
 * ===================================================
 */

(function () {
  'use strict';

  function resolveApiBase() {
    if (window.BilledkartAuth && typeof window.BilledkartAuth.getApiBase === 'function') {
      return window.BilledkartAuth.getApiBase();
    }
    if (typeof window === 'undefined') return 'http://127.0.0.1:4000';
    const port = window.location.port;
    if (port === '4000') return '';
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:4000`;
  }

  const API_BASE = resolveApiBase();

  /**
   * Universal Toast Notification
   */
  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    let toast = document.getElementById('billedkart-global-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'billedkart-global-toast';
      toast.className = 'fixed bottom-6 right-6 z-[9999] px-4 py-3 rounded-xl shadow-xl text-xs font-bold transition-all duration-300 flex items-center gap-2 transform translate-y-4 opacity-0 pointer-events-none';
      document.body.appendChild(toast);
    }
    toast.className = `fixed bottom-6 right-6 z-[9999] px-4 py-3 rounded-xl shadow-xl text-xs font-bold transition-all duration-300 flex items-center gap-2 transform translate-y-0 opacity-100 ${
      type === 'error'
        ? 'bg-rose-600 text-white'
        : type === 'warning'
        ? 'bg-amber-500 text-white'
        : 'bg-[#00236f] text-white'
    }`;
    toast.innerHTML = `
      <span class="material-symbols-outlined text-[18px]">${type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'}</span>
      <span>${message}</span>
    `;
    setTimeout(() => {
      toast.className = toast.className.replace('translate-y-0 opacity-100', 'translate-y-4 opacity-0 pointer-events-none');
    }, 3500);
  }

  /**
   * Check user authentication status via BilledkartAuth or session endpoint
   */
  async function checkAuth() {
    if (window.BilledkartAuth && typeof window.BilledkartAuth.waitForAuth === 'function') {
      return await window.BilledkartAuth.waitForAuth();
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.authenticated && data.user) {
        return data.user;
      }
      return null;
    } catch (e) {
      console.warn('[BilledkartChat] Auth check error:', e);
      return null;
    }
  }

  /**
   * Trigger Login Modal or Auth flow and preserve pending action
   */
  function promptLogin(intentContext) {
    if (intentContext) {
      try {
        sessionStorage.setItem('billedkart_pending_chat', JSON.stringify(intentContext));
        if (window.BilledkartAuth && typeof window.BilledkartAuth.setPendingAction === 'function') {
          window.BilledkartAuth.setPendingAction('chat', intentContext);
        }
      } catch (e) {
        console.warn('[BilledkartChat] Could not save pending chat session:', e);
      }
    }

    if (typeof window.openLoginModal === 'function') {
      window.openLoginModal();
      return;
    }
    if (typeof window.openAuthModal === 'function') {
      window.openAuthModal('login');
      return;
    }
    const modalTrigger = document.querySelector('[data-action="open-login"], [data-login-btn], #btnLogin');
    if (modalTrigger) {
      modalTrigger.click();
      return;
    }

    showToast('Please sign in to message the seller directly.', 'info');
    setTimeout(() => {
      window.location.href = `/home_property_discovery/code.html?action=login&returnUrl=${encodeURIComponent(window.location.href)}`;
    }, 1200);
  }

  /**
   * Format Indian Phone number to WhatsApp international digits
   */
  function formatWhatsAppPhone(phone) {
    if (!phone) return '919044268001';
    let digits = String(phone).replace(/\D/g, '');
    if (digits.length === 10) {
      digits = '91' + digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      digits = '91' + digits.substring(1);
    } else if (digits.length > 10 && !digits.startsWith('91')) {
      digits = '91' + digits.slice(-10);
    }
    return digits;
  }

  /**
   * Open Internal Buyer-Seller Chat
   * @param {string|number} propertyId Numeric ID or ref string (e.g. 'prop-201')
   * @param {number} [sellerId] Optional seller user ID
   * @param {Event} [event] Click event to prevent default
   * @param {Object} [options] Optional parameters (e.g. initialMessage)
   */
  async function openSellerChat(propertyId, sellerId, event, options = {}) {
    if (event) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }

    if (!propertyId) {
      showToast('Property reference is missing.', 'error');
      return;
    }

    const btn = event?.currentTarget || event?.target?.closest('button, a');
    let originalHtml = '';
    if (btn) {
      originalHtml = btn.innerHTML;
      btn.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span>`;
      btn.disabled = true;
    }

    const restoreBtn = () => {
      if (btn && originalHtml) {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    };

    try {
      // 1. Check whether auth is still initializing
      let user = null;
      if (window.BilledkartAuth) {
        if (window.BilledkartAuth.isLoading()) {
          showToast('Verifying session...', 'info');
          user = await window.BilledkartAuth.waitForAuth();
        } else {
          user = window.BilledkartAuth.getUser();
          if (!user) {
            // Re-verify in case session was established in background
            user = await window.BilledkartAuth.checkAuth(true);
          }
        }
      } else {
        user = await checkAuth();
      }

      // 2. If unauthenticated, save context and open login modal
      if (!user) {
        restoreBtn();
        promptLogin({
          propertyId,
          sellerId,
          initialMessage: options.initialMessage || ''
        });
        return;
      }

      // 3. User is authenticated -> directly create or retrieve conversation
      const res = await fetch(`${API_BASE}/api/chat/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          property_id: propertyId,
          initial_message: options.initialMessage || ''
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        restoreBtn();
        if (data && data.isSelf) {
          showToast('You are the owner of this listed property.', 'warning');
        } else if (res.status === 401) {
          // Session expired on server; update state and ask for re-login
          if (window.BilledkartAuth) window.BilledkartAuth.setUser(null);
          promptLogin({ propertyId, sellerId, initialMessage: options.initialMessage || '' });
        } else {
          showToast(data.error || 'Could not connect with seller.', 'error');
        }
        return;
      }

      // 4. Navigate to chat conversation
      const conversationId = data.conversationId;
      window.location.href = `/chat/index.html?conversationId=${conversationId}`;
    } catch (err) {
      console.error('[BilledkartChat.openSellerChat] Error:', err);
      restoreBtn();
      showToast('Unable to connect to chat service. Please try again.', 'error');
    }
  }

  /**
   * Open Seller Direct WhatsApp Chat
   * Prefilled with property title, location and link
   */
  function openSellerWhatsApp(propertyId, propertyTitle, location, sellerPhone, event) {
    if (event) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }

    const targetPhone = formatWhatsAppPhone(sellerPhone);
    const title = propertyTitle || 'Verified Property';
    const loc = location || 'Bengaluru';

    const msg = `Hi, I am interested in your property "${title}" located at ${loc} listed on Billedkart Realtech. Please share further details and pricing.`;
    const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`;

    window.open(waUrl, '_blank', 'noopener,noreferrer');
  }

  /**
   * Check and resume any pending chat after login
   */
  async function resumePendingChat() {
    try {
      const raw = sessionStorage.getItem('billedkart_pending_chat');
      if (!raw) return;
      sessionStorage.removeItem('billedkart_pending_chat');
      const pending = JSON.parse(raw);
      if (pending && pending.propertyId) {
        showToast('Resuming chat with seller...', 'info');
        await openSellerChat(pending.propertyId, pending.sellerId, null, {
          initialMessage: pending.initialMessage || ''
        });
      }
    } catch (e) {
      console.warn('[BilledkartChat] Failed to resume pending chat:', e);
    }
  }

  // Auto-listen to auth changes to auto-resume pending chat
  if (typeof window !== 'undefined') {
    window.addEventListener('billedkart:auth-changed', (e) => {
      if (e.detail && e.detail.authenticated) {
        resumePendingChat();
      }
    });

    document.addEventListener('DOMContentLoaded', () => {
      if (sessionStorage.getItem('billedkart_pending_chat')) {
        checkAuth().then(user => {
          if (user) {
            resumePendingChat();
          }
        });
      }
    });
  }

  // Export to global window
  window.BilledkartChat = {
    openSellerChat,
    openSellerWhatsApp,
    resumePendingChat,
    checkAuth,
    formatWhatsAppPhone,
    showToast
  };

})();
