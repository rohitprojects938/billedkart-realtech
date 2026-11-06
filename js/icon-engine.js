/**
 * ===================================================
 * Billedkart Realtech — Icon Engine & Reliable Fallback Strategy
 * window.BilledkartIcons
 * Ensures zero raw ligature text flashes and provides
 * instant SVG fallbacks if web font is delayed or blocked.
 * ===================================================
 */

(function () {
  'use strict';

  // SVG Path Dictionary for Material Symbols
  const ICON_PATHS = {
    'location_on': 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
    'my_location': 'M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
    'location_city': 'M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z',
    'home_work': 'M8.17 5.7L1 10.48V21h5v-8h4v8h5V10.25zM10 3v1.51l2 1.33L13.71 4H20v17h-3v-7h-4v7h-2v-9H7v9H3V11l7-4.67z',
    'search': 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    'manage_search': 'M7 9H2V7h5v2zm0 3H2v2h5v-2zm13.59 7-3.83-3.83c-.8.52-1.74.83-2.76.83-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5c0 1.02-.31 1.96-.83 2.75L22 17.59 20.59 19zM17 11c0-1.66-1.34-3-3-3s-3 1.34-3 3 1.34 3 3 3 3-1.34 3-3zM2 19h10v-2H2v2z',
    'expand_more': 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
    'arrow_drop_down': 'M7 10l5 5 5-5z',
    'arrow_forward': 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
    'arrow_back': 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    'close': 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    'chat': 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
    'chat_bubble': 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
    'forum': 'M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z',
    'favorite': 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    'call': 'M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z',
    'verified': 'M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82L8.6 22.5l3.4-1.47 3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z',
    'verified_user': 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
    'check_circle': 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    'check': 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    'lock': 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
    'star': 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    'tune': 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
    'near_me': 'M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z',
    'refresh': 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    'support_agent': 'M21 12.22C21 6.73 16.74 3 12 3c-4.69 0-9 3.65-9 9.28-.6.34-1 .98-1 1.72v2c0 1.1.9 2 2 2h1v-6.1c0-3.87 3.13-7 7-7s7 3.13 7 7V19h-8v2h8c1.1 0 2-.9 2-2v-1.22c.59-.31 1-.92 1-1.64v-2.3c0-.7-.41-1.31-1-1.62z',
    'security': 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
    'bolt': 'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.58 11 21 11 21z',
    'apartment': 'M17 11V3H7v4H3v14h8v-4h2v4h8V11h-4zM7 19H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm4 4H9v-2h2v2zm0-4H9V9h2v2zm0-4H9V5h2v2zm4 8h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm4 12h-2v-2h2v2zm0-4h-2v-2h2v2z',
    'photo_camera': 'M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
    'account_circle': 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z',
    'bed': 'M19 7h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4zm-9 5H5v-3h5v3z',
    'bathtub': 'M20 13V4.83C20 3.27 18.73 2 17.17 2c-.75 0-1.47.3-2 .83l-1.25 1.25c-.16-.05-.33-.08-.51-.08-.78 0-1.44.54-1.61 1.28l1.95 1.95c.53-.53.53-1.38 0-1.91l-.7-.7.9-.9c.39-.39 1.02-.39 1.41 0 .39.39.39 1.02 0 1.41L13.5 8.78c-.28.28-.66.44-1.06.44h-1.5c-.83 0-1.5.67-1.5 1.5V13H3c-.55 0-1 .45-1 1v2c0 2.21 1.79 4 4 4v2h2v-2h8v2h2v-2c2.21 0 4-1.79 4-4v-2c0-.55-.45-1-1-1h-1zm-1 3c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2v-1h14v1z',
    'square_foot': 'M17.66 17.66l-1.06 1.06-2.83-2.83 1.06-1.06 2.83 2.83zm-5.66-5.66l-1.06 1.06-2.83-2.83 1.06-1.06 2.83 2.83zm2.83 2.83l-1.06 1.06-2.83-2.83 1.06-1.06 2.83 2.83zm-8.49-8.49l-1.06 1.06-2.83-2.83 1.06-1.06 2.83 2.83zm13.43 14.15L7.05 4.76C6.66 4.37 6.15 4.15 5.6 4.15c-.55 0-1.06.22-1.45.61l-1.41 1.41c-.78.78-.78 2.05 0 2.83l12.72 12.72c.39.39.9.61 1.45.61s1.06-.22 1.45-.61l1.41-1.41c.79-.79.79-2.05 0-2.84z',
    'filter_list': 'M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z',
    'send': 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
    'done_all': 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z',
    'whatsapp': 'M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41a8.225 8.225 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.64c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.89 2.42 1.02 2.59.13.17 1.76 2.69 4.27 3.77.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.18-.47-.3'
  };

  /**
   * Generates inline SVG markup for a given icon name
   */
  function createSvg(iconName, classes) {
    classes = classes || '';
    const trimmed = (iconName || '').trim().toLowerCase();
    const path = ICON_PATHS[trimmed];
    if (!path) return null;
    return `<svg class="bk-icon-svg ${classes}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
  }

  /**
   * Replaces a DOM element's text ligature with SVG if font failed to render
   */
  function replaceWithSvg(el) {
    if (!el || el.dataset.bkSvgApplied) return;
    const name = el.textContent.trim().toLowerCase();
    const svgHtml = createSvg(name);
    if (svgHtml) {
      el.dataset.bkOriginalText = name;
      el.dataset.bkSvgApplied = 'true';
      el.innerHTML = svgHtml;
    }
  }

  function fallbackAllIcons() {
    document.querySelectorAll('.material-symbols-outlined, .material-icons, [class*="material-symbols"]').forEach(replaceWithSvg);
  }

  function markLoaded() {
    document.documentElement.classList.add('bk-icons-loaded');
  }

  /**
   * Check font loading and apply fallback if needed
   */
  function initIconGuard() {
    // If document.fonts API is supported
    if ('fonts' in document) {
      document.fonts.ready.then(() => {
        markLoaded();
      });

      document.fonts.load('20px "Material Symbols Outlined"').then((fonts) => {
        if (fonts && fonts.length > 0) {
          markLoaded();
        } else {
          // If no fonts returned, verify check
          if (document.fonts.check('20px "Material Symbols Outlined"')) {
            markLoaded();
          } else {
            fallbackAllIcons();
          }
        }
      }).catch(() => {
        fallbackAllIcons();
      });

      // Safety timeout: If font is taking more than 1000ms
      setTimeout(() => {
        if (!document.fonts.check('20px "Material Symbols Outlined"')) {
          fallbackAllIcons();
        } else {
          markLoaded();
        }
      }, 1000);
    } else {
      setTimeout(fallbackAllIcons, 800);
    }
  }

  // Auto-init on script load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIconGuard);
  } else {
    initIconGuard();
  }

  // Export to global window
  window.BilledkartIcons = {
    createSvg: createSvg,
    replaceWithSvg: replaceWithSvg,
    fallbackAllIcons: fallbackAllIcons,
    markLoaded: markLoaded,
    paths: ICON_PATHS
  };
})();
