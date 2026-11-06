/**
 * chat-badge.js — Global Billedkart Realtech Chat Notification & Unread Badge Helper
 * Synchronizes navbar chat unread badges across the marketplace without heavy overhead.
 */
(function() {
  const API_HOST = (window.location.port === '4000') ? '' : 'http://127.0.0.1:4000';

  async function checkUnreadChatCount() {
    try {
      const res = await fetch(`${API_HOST}/api/chat/unread-count`, {
        credentials: 'include',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.success && typeof data.unreadCount === 'number') {
        updateNavbarBadges(data.unreadCount);
      }
    } catch (e) {
      // User likely guest / unauthenticated
    }
  }

  function updateNavbarBadges(count) {
    const badges = document.querySelectorAll('.nav-chat-unread-badge, #navChatUnreadBadge, #mobileMenuChatBadge');
    badges.forEach(b => {
      if (count > 0) {
        b.textContent = count > 99 ? '99+' : count;
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    });
  }

  window.BilledkartChatBadge = {
    check: checkUnreadChatCount,
    update: updateNavbarBadges
  };

  document.addEventListener('DOMContentLoaded', () => {
    checkUnreadChatCount();
    // Periodic poll every 45s as lightweight fallback
    setInterval(checkUnreadChatCount, 45000);
  });
})();

