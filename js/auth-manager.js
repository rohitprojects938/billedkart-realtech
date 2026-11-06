/**
 * ===================================================
 * Billedkart Realtech — Universal Client Authentication Manager
 * window.BilledkartAuth
 * Single Source of Truth for Authentication State Across the Platform.
 * ===================================================
 */

(function () {
  'use strict';

  const PENDING_STORAGE_KEY = 'billedkart_pending_action';
  const LEGACY_PENDING_CHAT_KEY = 'billedkart_pending_chat';

  function resolveApiBase() {
    if (typeof window === 'undefined') return 'http://127.0.0.1:4000';
    const port = window.location.port;
    if (port === '4000') return ''; // Direct Express server
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:4000`;
  }

  const API_BASE = resolveApiBase();

  const state = {
    status: 'loading', // 'loading' | 'authenticated' | 'unauthenticated'
    user: null,
    inFlightPromise: null,
    listeners: new Set()
  };

  function notifyListeners() {
    const detail = {
      status: state.status,
      user: state.user,
      authenticated: state.status === 'authenticated'
    };

    // Keep window.currentUser in sync
    window.currentUser = state.user;

    state.listeners.forEach(cb => {
      try {
        cb(detail);
      } catch (err) {
        console.error('[BilledkartAuth] Listener error:', err);
      }
    });

    try {
      window.dispatchEvent(new CustomEvent('billedkart:auth-changed', { detail }));
    } catch (_) {}
  }

  /**
   * Core checkAuth: Queries /api/auth/me with credentials
   * De-duplicates concurrent calls to prevent race conditions
   */
  async function checkAuth(forceRefresh = false) {
    if (!forceRefresh && state.inFlightPromise) {
      return state.inFlightPromise;
    }

    if (!forceRefresh && state.status !== 'loading' && state.user) {
      return Promise.resolve(state.user);
    }

    state.inFlightPromise = (async () => {
      try {
        // First check for OAuth exchange token in current URL
        const params = new URLSearchParams(window.location.search);
        const exchangeToken = params.get('exchange_token');
        const authParam = params.get('auth') || params.get('auth_success');

        if (exchangeToken && (authParam === 'google' || authParam === 'google_success')) {
          try {
            const exchRes = await fetch(`${API_BASE}/api/auth/exchange`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ token: exchangeToken }),
              credentials: 'include'
            });
            const exchData = await exchRes.json();
            if (exchData && exchData.success && exchData.user) {
              state.status = 'authenticated';
              state.user = exchData.user;
              notifyListeners();

              // Clean URL without refresh
              params.delete('exchange_token');
              params.delete('auth');
              params.delete('auth_success');
              const cleanQuery = params.toString() ? `?${params.toString()}` : '';
              const cleanUrl = `${window.location.pathname}${cleanQuery}${window.location.hash}`;
              window.history.replaceState({}, document.title, cleanUrl);

              // Auto-resume any pending protected action (e.g. Chat)
              setTimeout(resumePendingAction, 100);
              return state.user;
            }
          } catch (exchErr) {
            console.error('[BilledkartAuth] Exchange token error:', exchErr);
          }
        }

        // Fetch /api/auth/me
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });

        if (!res.ok) {
          state.status = 'unauthenticated';
          state.user = null;
          notifyListeners();
          return null;
        }

        const data = await res.json();
        if (data && data.authenticated && data.user) {
          state.status = 'authenticated';
          state.user = data.user;
          notifyListeners();
          // Check for pending action to resume
          setTimeout(resumePendingAction, 100);
          return state.user;
        } else {
          state.status = 'unauthenticated';
          state.user = null;
          notifyListeners();
          return null;
        }
      } catch (err) {
        console.warn('[BilledkartAuth] Session verification error:', err);
        // Only set unauthenticated if we weren't already authenticated
        if (state.status === 'loading') {
          state.status = 'unauthenticated';
          state.user = null;
          notifyListeners();
        }
        return state.user;
      } finally {
        state.inFlightPromise = null;
      }
    })();

    return state.inFlightPromise;
  }

  /**
   * Guarantees callers wait until initial auth check finishes
   */
  async function waitForAuth() {
    if (state.status !== 'loading') {
      return state.user;
    }
    if (state.inFlightPromise) {
      return state.inFlightPromise;
    }
    return checkAuth();
  }

  /**
   * Pending Action Storage for resuming actions after authentication
   */
  function setPendingAction(type, data) {
    try {
      sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ type, data, timestamp: Date.now() }));
    } catch (e) {
      console.warn('[BilledkartAuth] Unable to save pending action:', e);
    }
  }

  function getPendingAction() {
    try {
      const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      // Legacy fallback
      const legacyRaw = sessionStorage.getItem(LEGACY_PENDING_CHAT_KEY);
      if (legacyRaw) {
        return { type: 'chat', data: JSON.parse(legacyRaw) };
      }
    } catch (e) {
      console.warn('[BilledkartAuth] Unable to read pending action:', e);
    }
    return null;
  }

  function clearPendingAction() {
    try {
      sessionStorage.removeItem(PENDING_STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_PENDING_CHAT_KEY);
    } catch (_) {}
  }

  /**
   * Resumes the pending action if user is authenticated
   */
  async function resumePendingAction() {
    if (state.status !== 'authenticated' || !state.user) return;
    const pending = getPendingAction();
    if (!pending) return;

    clearPendingAction();

    if (pending.type === 'chat' && pending.data) {
      const { propertyId, sellerId, options } = pending.data;
      if (propertyId && window.BilledkartChat && typeof window.BilledkartChat.openSellerChat === 'function') {
        console.log('[BilledkartAuth] Resuming pending chat with seller for property:', propertyId);
        await window.BilledkartChat.openSellerChat(propertyId, sellerId, null, options || {});
      }
    }
  }

  /**
   * Manually sets authenticated user (e.g. after form login or OTP verify)
   */
  function setUser(user) {
    if (user && (user.id || user.userId)) {
      state.status = 'authenticated';
      state.user = user;
    } else {
      state.status = 'unauthenticated';
      state.user = null;
    }
    notifyListeners();
    if (state.status === 'authenticated') {
      setTimeout(resumePendingAction, 100);
    }
  }

  /**
   * Perform logout
   */
  async function logout() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
    } catch (e) {
      console.warn('[BilledkartAuth] Logout network error:', e);
    } finally {
      state.status = 'unauthenticated';
      state.user = null;
      notifyListeners();
    }
  }

  /**
   * Subscribe to auth changes
   */
  function onAuthChange(callback) {
    if (typeof callback !== 'function') return () => {};
    state.listeners.add(callback);
    // Immediately emit current state if already resolved
    if (state.status !== 'loading') {
      try {
        callback({
          status: state.status,
          user: state.user,
          authenticated: state.status === 'authenticated'
        });
      } catch (_) {}
    }
    return () => state.listeners.delete(callback);
  }

  // Initialize immediately
  checkAuth();

  // Export to global window
  window.BilledkartAuth = {
    getApiBase: () => API_BASE,
    getUser: () => state.user,
    getStatus: () => state.status,
    isLoading: () => state.status === 'loading',
    isAuthenticated: () => state.status === 'authenticated',
    checkAuth,
    waitForAuth,
    setUser,
    logout,
    onAuthChange,
    setPendingAction,
    getPendingAction,
    clearPendingAction,
    resumePendingAction
  };
})();

