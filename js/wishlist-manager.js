/**
 * wishlist-manager.js — Billedkart Realtech Global Saved Properties & Wishlist Manager
 * 
 * Central source of truth for wishlist state, card heart synchronization,
 * navbar badges, authenticated persistence via MySQL, and optimistic UI.
 */
(function() {
  'use strict';

  function getApiBase() {
    if (window.BilledkartAuth && typeof window.BilledkartAuth.getApiBase === 'function') {
      return window.BilledkartAuth.getApiBase();
    }
    const port = window.location.port;
    if (port === '5500' || port === '5501' || port === '3000' || port === '8080') {
      return 'http://127.0.0.1:4000';
    }
    return '';
  }

  function showToast(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
      return;
    }
    let toast = document.getElementById('global-wishlist-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'global-wishlist-toast';
      toast.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#00236f] text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 pointer-events-none transition-all duration-300 opacity-0 translate-y-3';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="material-symbols-outlined text-[18px] text-[#ff6f3c]">favorite</span><span>${msg}</span>`;
    toast.classList.remove('opacity-0', 'translate-y-3');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', 'translate-y-3');
    }, 2800);
  }

  const state = {
    count: 0,
    savedIds: new Set(),
    initialized: false,
    loading: false
  };

  const listeners = new Set();

  function notifyListeners(detail) {
    listeners.forEach(fn => {
      try { fn(detail); } catch (e) { console.error('[BilledkartWishlist] Listener error:', e); }
    });
    try {
      window.dispatchEvent(new CustomEvent('billedkart:wishlist-change', { detail }));
    } catch (_) {}
  }

  /**
   * Update all wishlist badge counters in the DOM
   */
  function updateBadges(count) {
    state.count = Math.max(0, Number(count) || 0);
    const badgeIds = [
      'desktop-wishlist-count',
      'mobile-wishlist-count',
      'headerWishlistBadge',
      'navWishlistBadge'
    ];

    badgeIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = state.count;
        el.setAttribute('aria-label', `${state.count} saved properties`);
      }
    });

    // Also update any elements with class
    document.querySelectorAll('.wishlist-count-badge').forEach(el => {
      el.textContent = state.count;
    });

    // Update heading counters on Saved Properties page if present
    const headingEl = document.getElementById('savedPropertiesCountDisplay');
    if (headingEl) {
      headingEl.textContent = state.count === 1 ? '1 Property' : `${state.count} Properties`;
    }
  }

  /**
   * Synchronize all heart buttons on page with current savedIds
   */
  function syncCardIcons() {
    // 1. Property card buttons with data-wishlist-prop-id
    document.querySelectorAll('[data-wishlist-prop-id]').forEach(btn => {
      const propId = Number(btn.getAttribute('data-wishlist-prop-id'));
      if (!propId) return;
      const isSaved = state.savedIds.has(propId);
      const icon = btn.querySelector('.material-symbols-outlined') || btn.querySelector('span');
      
      if (icon) {
        icon.textContent = isSaved ? 'favorite' : 'favorite_border';
        if (isSaved) {
          icon.classList.add('filled', 'text-error');
          btn.classList.add('text-error', 'is-saved');
        } else {
          icon.classList.remove('filled', 'text-error');
          btn.classList.remove('text-error', 'is-saved');
        }
      }
    });

    // 2. Search results format (id="wishlist-icon-{id}")
    document.querySelectorAll('[id^="wishlist-icon-"]').forEach(icon => {
      const propId = Number(icon.id.replace('wishlist-icon-', ''));
      if (!propId) return;
      const isSaved = state.savedIds.has(propId);
      icon.textContent = isSaved ? 'favorite' : 'favorite_border';
      if (isSaved) {
        icon.className = 'material-symbols-outlined text-[19px] text-secondary heart-pop filled';
      } else {
        icon.className = 'material-symbols-outlined text-[19px] text-on-surface-variant heart-pop';
      }
    });

    // 3. Property detail page format
    const pdpIcon = document.getElementById('saveWishlistIcon');
    const pdpText = document.getElementById('saveWishlistText');
    const pdpBtn = document.getElementById('saveWishlistBtn');
    if (pdpIcon && window.currentProperty && window.currentProperty.id) {
      const isSaved = state.savedIds.has(Number(window.currentProperty.id));
      pdpIcon.textContent = isSaved ? 'favorite' : 'favorite_border';
      if (isSaved) {
        pdpIcon.classList.add('text-secondary', 'filled');
        if (pdpText) pdpText.textContent = 'Saved';
        if (pdpBtn) pdpBtn.classList.add('bg-secondary/10', 'text-secondary');
      } else {
        pdpIcon.classList.remove('text-secondary', 'filled');
        if (pdpText) pdpText.textContent = 'Save Listing';
        if (pdpBtn) pdpBtn.classList.remove('bg-secondary/10', 'text-secondary');
      }
    }
  }

  /**
   * Initialize wishlist data from server
   */
  async function init() {
    const apiBase = getApiBase();
    try {
      state.loading = true;
      // 1. Fetch count
      const countRes = await fetch(`${apiBase}/api/saved-properties/count`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      const countData = await countRes.json();
      
      if (countData && countData.success) {
        updateBadges(countData.count);

        // 2. If authenticated, fetch full list of saved IDs
        if (countData.authenticated) {
          const listRes = await fetch(`${apiBase}/api/saved-properties`, {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          });
          const listData = await listRes.json();
          if (listData && listData.success && Array.isArray(listData.properties)) {
            state.savedIds = new Set(listData.properties.map(p => Number(p.id)));
            updateBadges(listData.properties.length);
          }
        } else {
          state.savedIds.clear();
        }
      }
    } catch (err) {
      console.warn('[BilledkartWishlist] Initialization fetch failed:', err.message);
    } finally {
      state.loading = false;
      state.initialized = true;
      syncCardIcons();
    }
  }

  /**
   * Directly save a property (e.g. called after login resumption)
   */
  async function saveProperty(propertyId) {
    const propId = Number(propertyId);
    if (!propId) return false;
    const apiBase = getApiBase();

    try {
      // Optimistic update
      state.savedIds.add(propId);
      state.count++;
      updateBadges(state.count);
      syncCardIcons();

      const res = await fetch(`${apiBase}/api/saved-properties/${propId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
      });
      const data = await res.json();

      if (data && data.success) {
        state.savedIds.add(propId);
        if (typeof data.count === 'number') updateBadges(data.count);
        syncCardIcons();
        showToast(data.message || 'Saved to your Wishlist!');
        notifyListeners({ propertyId: propId, saved: true, count: state.count });
        return true;
      } else {
        throw new Error(data.error || 'Server error saving property');
      }
    } catch (err) {
      console.error('[BilledkartWishlist] saveProperty failed:', err);
      // Rollback
      state.savedIds.delete(propId);
      state.count = Math.max(0, state.count - 1);
      updateBadges(state.count);
      syncCardIcons();
      showToast('Could not save property. Please try again.');
      return false;
    }
  }

  /**
   * Directly remove a property from saved list
   */
  async function removeProperty(propertyId, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const propId = Number(propertyId);
    if (!propId) return false;
    const apiBase = getApiBase();

    // Check auth
    const user = window.BilledkartAuth ? window.BilledkartAuth.getUser() : null;
    if (!user) {
      showToast('Please sign in to manage your saved properties.');
      if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
      return false;
    }

    try {
      // Optimistic update
      state.savedIds.delete(propId);
      state.count = Math.max(0, state.count - 1);
      updateBadges(state.count);
      syncCardIcons();

      const res = await fetch(`${apiBase}/api/saved-properties/${propId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();

      if (data && data.success) {
        if (typeof data.count === 'number') updateBadges(data.count);
        syncCardIcons();
        showToast(data.message || 'Removed from Saved Properties.');
        notifyListeners({ propertyId: propId, saved: false, count: state.count });
        return true;
      } else {
        throw new Error(data.error || 'Server error removing property');
      }
    } catch (err) {
      console.error('[BilledkartWishlist] removeProperty failed:', err);
      state.savedIds.add(propId);
      state.count++;
      updateBadges(state.count);
      syncCardIcons();
      showToast('Could not remove property. Please try again.');
      return false;
    }
  }

  /**
   * Main Toggle function for heart buttons across all property cards
   */
  async function toggle(propertyId, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    const propId = Number(propertyId);
    if (!propId) {
      console.error('[BilledkartWishlist] Invalid property ID:', propertyId);
      return;
    }

    // 1. Authentication check
    let user = window.BilledkartAuth ? window.BilledkartAuth.getUser() : null;
    if (!user && window.BilledkartAuth && typeof window.BilledkartAuth.waitForAuth === 'function') {
      user = await window.BilledkartAuth.waitForAuth();
    }

    if (!user) {
      // Preserve pending action
      if (window.BilledkartAuth && typeof window.BilledkartAuth.setPendingAction === 'function') {
        window.BilledkartAuth.setPendingAction('save_property', { propertyId: propId });
      }
      showToast('Please sign in to save properties to your shortlist.');
      if (typeof window.openAuthModal === 'function') {
        window.openAuthModal('login');
      } else if (typeof window.openLoginModal === 'function') {
        window.openLoginModal();
      }
      return;
    }

    // 2. Authenticated Toggle with Optimistic UI
    const currentlySaved = state.savedIds.has(propId);
    const newSaved = !currentlySaved;

    // Optimistic mutation
    if (newSaved) {
      state.savedIds.add(propId);
      state.count++;
    } else {
      state.savedIds.delete(propId);
      state.count = Math.max(0, state.count - 1);
    }
    updateBadges(state.count);
    syncCardIcons();

    // Visual heart pop animation
    if (event && event.currentTarget) {
      const heartIcon = event.currentTarget.querySelector('.material-symbols-outlined') || event.currentTarget;
      if (heartIcon) {
        heartIcon.classList.add('scale-125');
        setTimeout(() => heartIcon.classList.remove('scale-125'), 200);
      }
    }

    // 3. Network Call
    const apiBase = getApiBase();
    try {
      const res = await fetch(`${apiBase}/api/saved-properties/toggle/${propId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
      });
      const data = await res.json();

      if (data && data.success) {
        // Reconcile with verified backend state
        if (data.saved) {
          state.savedIds.add(propId);
        } else {
          state.savedIds.delete(propId);
        }
        if (typeof data.count === 'number') {
          updateBadges(data.count);
        }
        syncCardIcons();
        showToast(data.message || (data.saved ? 'Saved to your Wishlist!' : 'Removed from Saved Properties.'));
        notifyListeners({ propertyId: propId, saved: data.saved, count: state.count });
      } else {
        throw new Error(data.error || 'Server error toggling wishlist');
      }
    } catch (err) {
      console.error('[BilledkartWishlist] Toggle error:', err);
      // Rollback optimistic state
      if (currentlySaved) {
        state.savedIds.add(propId);
        state.count++;
      } else {
        state.savedIds.delete(propId);
        state.count = Math.max(0, state.count - 1);
      }
      updateBadges(state.count);
      syncCardIcons();
      showToast('Failed to update wishlist. Please try again.');
    }
  }

  /**
   * Navigation handler for global navbar heart button
   */
  async function openWishlistPage() {
    let user = window.BilledkartAuth ? window.BilledkartAuth.getUser() : null;
    if (!user && window.BilledkartAuth && typeof window.BilledkartAuth.waitForAuth === 'function') {
      user = await window.BilledkartAuth.waitForAuth();
    }

    if (!user) {
      if (window.BilledkartAuth && typeof window.BilledkartAuth.setPendingAction === 'function') {
        window.BilledkartAuth.setPendingAction('open_wishlist', {});
      }
      showToast('Please sign in to view your saved properties.');
      if (typeof window.openAuthModal === 'function') {
        window.openAuthModal('login');
      } else if (typeof window.openLoginModal === 'function') {
        window.openLoginModal();
      } else {
        window.location.href = '/saved-properties/index.html';
      }
      return;
    }

    window.location.href = '/saved-properties/index.html';
  }

  // Subscribe to Auth state changes
  if (window.BilledkartAuth && typeof window.BilledkartAuth.onAuthChange === 'function') {
    window.BilledkartAuth.onAuthChange(({ user }) => {
      if (user) {
        init();
      } else {
        state.savedIds.clear();
        state.count = 0;
        updateBadges(0);
        syncCardIcons();
      }
    });
  }

  // Auto initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Global Wishlist Object
  const BilledkartWishlist = {
    getApiBase,
    init,
    isSaved: (id) => state.savedIds.has(Number(id)),
    getCount: () => state.count,
    getSavedIds: () => Array.from(state.savedIds),
    toggle,
    saveProperty,
    remove: removeProperty,
    openWishlistPage,
    updateBadges,
    syncCardIcons,
    onWishlistChange: (fn) => listeners.add(fn)
  };

  window.BilledkartWishlist = BilledkartWishlist;

  // Universal Global helper functions
  window.toggleSavedProperty = function(propertyId, event) {
    return BilledkartWishlist.toggle(propertyId, event);
  };

  window.togglePropertyWishlist = function(event, propertyId) {
    return BilledkartWishlist.toggle(propertyId, event);
  };

  // Backwards-compatible adapter for homepage template
  window.toggleWishlist = function(event, btnOrId) {
    if (typeof btnOrId === 'number' || (typeof btnOrId === 'string' && /^\d+$/.test(btnOrId))) {
      return BilledkartWishlist.toggle(Number(btnOrId), event);
    }
    // If element passed, look for data-wishlist-prop-id or closest card
    const el = btnOrId || (event && event.currentTarget);
    if (el) {
      const explicitId = el.getAttribute('data-wishlist-prop-id');
      if (explicitId) {
        return BilledkartWishlist.toggle(Number(explicitId), event);
      }
      const card = el.closest('article') || el.closest('[data-property-id]');
      if (card) {
        const cardId = card.getAttribute('data-property-id') || card.getAttribute('data-id');
        if (cardId) return BilledkartWishlist.toggle(Number(cardId), event);
      }
    }
    // Fallback: prompt to view wishlist
    return BilledkartWishlist.openWishlistPage();
  };

  window.openWishlistPage = openWishlistPage;

})();
