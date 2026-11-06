/**
 * Billedkart Realtech — Automatic Location Detection & Nearby Property Discovery Engine
 * 
 * Provides:
 *   - Sleek Location Permission Modal on first visit
 *   - Real browser Geolocation API integration with high accuracy
 *   - OpenStreetMap Nominatim Reverse Geocoding with coordinate clustering fallback
 *   - MySQL Database persistence via /api/properties/user-location
 *   - Cross-page Navbar synchronization (#desktop-current-city & #mobile-current-city)
 *   - Manual City Selector with verified Indian municipal coordinates
 *   - Real-time custom event dispatching ('billedkart:location-changed', 'locationChanged')
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'billedkart_user_location';
  const DISMISSED_KEY = 'billedkart_location_prompt_dismissed';

  const INDIAN_CITIES = [
    { name: 'Bengaluru', state: 'Karnataka', lat: 12.9715987, lon: 77.5945627, count: '18.2k Listings' },
    { name: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467088, lon: 80.9461592, count: '9.4k Listings' },
    { name: 'Mumbai', state: 'Maharashtra', lat: 19.076090, lon: 72.877426, count: '24.1k Listings' },
    { name: 'Delhi NCR', state: 'Delhi', lat: 28.613939, lon: 77.209021, count: '28.5k Listings' },
    { name: 'Hyderabad', state: 'Telangana', lat: 17.385044, lon: 78.486671, count: '14.8k Listings' },
    { name: 'Pune', state: 'Maharashtra', lat: 18.520430, lon: 73.856744, count: '16.3k Listings' },
    { name: 'Noida', state: 'Uttar Pradesh', lat: 28.535516, lon: 77.391026, count: '11.7k Listings' },
    { name: 'Gurgaon', state: 'Haryana', lat: 28.459497, lon: 77.026638, count: '12.4k Listings' },
    { name: 'Chennai', state: 'Tamil Nadu', lat: 13.082680, lon: 80.270718, count: '10.9k Listings' },
    { name: 'Kolkata', state: 'West Bengal', lat: 22.572646, lon: 88.363895, count: '8.2k Listings' },
    { name: 'Ahmedabad', state: 'Gujarat', lat: 23.022505, lon: 72.571362, count: '7.5k Listings' },
    { name: 'Jaipur', state: 'Rajasthan', lat: 26.912434, lon: 75.787271, count: '5.8k Listings' }
  ];

  function getApiBase() {
    if (typeof window !== 'undefined' && window.location.port === '5500') {
      return 'http://127.0.0.1:4000/api';
    }
    return '/api';
  }

  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(1));
  }

  function findNearestKnownCity(lat, lon) {
    let nearest = INDIAN_CITIES[0];
    let minDistance = Infinity;
    for (const city of INDIAN_CITIES) {
      const d = calculateDistanceKm(lat, lon, city.lat, city.lon);
      if (d < minDistance) {
        minDistance = d;
        nearest = city;
      }
    }
    return { city: nearest, distance: minDistance };
  }

  const BilledkartLocationManager = {
    currentLocation: null,
    isDetecting: false,
    modalEl: null,

    init: async function () {
      this.attachNavbarListeners();
      this.loadSavedLocation();
      await this.syncWithServer();

      // If user hasn't chosen location yet and hasn't dismissed in current session, show prompt smoothly
      if (!this.currentLocation && !sessionStorage.getItem(DISMISSED_KEY)) {
        setTimeout(() => {
          if (!this.currentLocation && !sessionStorage.getItem(DISMISSED_KEY)) {
            this.showPermissionModal();
          }
        }, 1200);
      }
    },

    loadSavedLocation: function () {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.city && parsed.latitude && parsed.longitude) {
            this.currentLocation = parsed;
            this.updateNavbarUI(parsed.city, parsed.locality);
          }
        }
      } catch (e) {
        console.warn('[LocationManager] Error reading local storage:', e);
      }
    },

    syncWithServer: async function () {
      try {
        const res = await fetch(`${getApiBase()}/properties/user-location`, {
          credentials: 'include'
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.location && data.location.latitude && data.location.longitude) {
          const loc = {
            city: data.location.city,
            locality: data.location.locality || '',
            formatted_address: data.location.formatted_address || '',
            latitude: parseFloat(data.location.latitude),
            longitude: parseFloat(data.location.longitude),
            accuracy_meters: data.location.accuracy_meters || 50,
            location_source: data.location.location_source || 'database'
          };
          this.currentLocation = loc;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
          this.updateNavbarUI(loc.city, loc.locality);
        }
      } catch (err) {
        // Silent server sync fail
      }
    },

    updateNavbarUI: function (city, locality) {
      if (!city) return;
      const displayCity = (city === 'Bengaluru' || city === 'Bangalore') ? 'Bengaluru' : city;

      const desktopEl = document.getElementById('desktop-current-city');
      if (desktopEl) {
        desktopEl.textContent = displayCity;
      }

      const mobileEl = document.getElementById('mobile-current-city');
      if (mobileEl) {
        mobileEl.textContent = displayCity;
      }

      // Update any generic elements with data-sync-city
      document.querySelectorAll('[data-sync-city]').forEach(el => {
        el.textContent = displayCity;
      });

      // Update placeholder in discovery search bar if present
      const stickyLocality = document.getElementById('desktop-sticky-locality');
      if (stickyLocality && !stickyLocality.value) {
        stickyLocality.placeholder = `Search locality, landmark or project in ${displayCity}...`;
      }

      // Update popular titles if present on homepage
      const popularTitle = document.getElementById('popular-properties-heading');
      if (popularTitle) {
        popularTitle.textContent = `Popular Properties in ${displayCity}`;
      }
      const mobilePopularTitle = document.getElementById('mobile-popular-title');
      if (mobilePopularTitle) {
        mobilePopularTitle.textContent = `Popular in ${displayCity}`;
      }
    },

    saveLocation: async function (locData) {
      this.currentLocation = locData;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(locData));
      } catch (e) {}

      this.updateNavbarUI(locData.city, locData.locality);

      // Save to backend database
      try {
        await fetch(`${getApiBase()}/properties/user-location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(locData)
        });
      } catch (err) {
        console.warn('[LocationManager] Error posting location to server:', err);
      }

      // Broadcast custom events across application
      const customEvent = new CustomEvent('billedkart:location-changed', {
        detail: locData,
        bubbles: true
      });
      window.dispatchEvent(customEvent);

      // Backwards-compatible legacy event
      window.dispatchEvent(new CustomEvent('locationChanged', { detail: locData }));
    },

    detectLocation: function (onSuccess, onError) {
      if (!navigator.geolocation) {
        this.showToast('Geolocation is not supported by your browser.', 'error');
        if (onError) onError(new Error('Geolocation unsupported'));
        return;
      }

      this.isDetecting = true;
      this.setDetectingUI(true);

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          const accuracy = Math.round(position.coords.accuracy || 40);

          let detectedCity = 'Bengaluru';
          let detectedLocality = '';
          let formattedAddress = '';

          try {
            // OpenStreetMap Nominatim reverse geocode with 4-second timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`,
              { signal: controller.signal }
            );
            clearTimeout(timeoutId);

            if (res.ok) {
              const geo = await res.json();
              if (geo && geo.address) {
                const a = geo.address;
                const rawCity = a.city || a.town || a.municipality || a.state_district || a.state || '';
                if (rawCity.toLowerCase().includes('bangalore') || rawCity.toLowerCase().includes('bengaluru')) {
                  detectedCity = 'Bengaluru';
                } else if (rawCity.toLowerCase().includes('lucknow')) {
                  detectedCity = 'Lucknow';
                } else if (rawCity.toLowerCase().includes('mumbai')) {
                  detectedCity = 'Mumbai';
                } else if (rawCity.toLowerCase().includes('delhi')) {
                  detectedCity = 'Delhi NCR';
                } else if (rawCity.toLowerCase().includes('hyderabad')) {
                  detectedCity = 'Hyderabad';
                } else if (rawCity.toLowerCase().includes('pune')) {
                  detectedCity = 'Pune';
                } else if (rawCity.toLowerCase().includes('noida')) {
                  detectedCity = 'Noida';
                } else if (rawCity.toLowerCase().includes('gurgaon') || rawCity.toLowerCase().includes('gurugram')) {
                  detectedCity = 'Gurgaon';
                } else if (rawCity.toLowerCase().includes('chennai')) {
                  detectedCity = 'Chennai';
                } else if (rawCity.toLowerCase().includes('kolkata')) {
                  detectedCity = 'Kolkata';
                } else if (rawCity) {
                  detectedCity = rawCity;
                }

                detectedLocality = a.suburb || a.neighbourhood || a.residential || a.road || '';
                formattedAddress = geo.display_name || `${detectedLocality ? detectedLocality + ', ' : ''}${detectedCity}`;
              }
            }
          } catch (e) {
            console.warn('[LocationManager] Nominatim reverse lookup fallback:', e.message);
            // Haversine fallback to nearest Indian metro
            const nearestInfo = findNearestKnownCity(lat, lon);
            detectedCity = nearestInfo.city.name;
          }

          if (!formattedAddress) {
            formattedAddress = detectedLocality ? `${detectedLocality}, ${detectedCity}` : detectedCity;
          }

          const locationResult = {
            city: detectedCity,
            locality: detectedLocality,
            formatted_address: formattedAddress,
            latitude: lat,
            longitude: lon,
            accuracy_meters: accuracy,
            location_source: 'browser_gps'
          };

          await this.saveLocation(locationResult);
          this.setDetectingUI(false);
          this.closeModal();

          const label = detectedLocality ? `${detectedLocality}, ${detectedCity}` : detectedCity;
          this.showToast(`Location detected: ${label}`, 'success');

          if (onSuccess) onSuccess(locationResult);
        },
        (error) => {
          this.setDetectingUI(false);
          let userMsg = 'Location access was not granted. Please select your city manually.';
          if (error.code === error.TIMEOUT) {
            userMsg = 'Location request timed out. Please select your city manually.';
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            userMsg = 'GPS location unavailable. Please select your city manually.';
          }

          this.showToast(userMsg, 'info');
          this.renderManualCitySelector();
          if (onError) onError(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    },

    selectCityManually: async function (cityName) {
      const matched = INDIAN_CITIES.find(c => c.name.toLowerCase() === cityName.toLowerCase()) || {
        name: cityName,
        state: 'India',
        lat: 12.9715987,
        lon: 77.5945627
      };

      const locationResult = {
        city: matched.name,
        locality: '',
        formatted_address: `${matched.name}, ${matched.state}`,
        latitude: matched.lat,
        longitude: matched.lon,
        accuracy_meters: 500,
        location_source: 'manual_selection'
      };

      await this.saveLocation(locationResult);
      this.closeModal();
      this.showToast(`Selected city: ${matched.name}`, 'success');
    },

    setDetectingUI: function (isDetecting) {
      this.isDetecting = isDetecting;
      const btn = document.getElementById('bk-loc-detect-btn');
      if (btn) {
        if (isDetecting) {
          btn.disabled = true;
          btn.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Detecting Location...</span>
          `;
          btn.classList.add('opacity-75', 'cursor-wait');
        } else {
          btn.disabled = false;
          btn.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">my_location</span>
            <span>Use My Current Location</span>
          `;
          btn.classList.remove('opacity-75', 'cursor-wait');
        }
      }
    },

    showPermissionModal: function () {
      if (!this.modalEl) {
        this.createModalDOM();
      }
      this.renderPermissionContent();
      this.modalEl.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
    },

    renderPermissionContent: function () {
      const container = document.getElementById('bk-loc-modal-content');
      if (!container) return;

      container.innerHTML = `
        <div class="text-center">
          <!-- Location Icon with pulse indicator -->
          <div class="relative w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-2xl bg-orange-50 border border-orange-100 text-[#e05638] shadow-sm">
            <span class="material-symbols-outlined text-3xl">location_on</span>
            <span class="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#e05638]"></span>
            </span>
          </div>

          <span class="inline-block text-[10px] font-black uppercase tracking-wider text-[#e05638] bg-orange-50 px-2.5 py-0.5 rounded-full mb-2">Billedkart Realtech Discovery</span>
          <h3 class="text-xl font-black text-slate-900 tracking-tight mb-2">Discover Properties Near You</h3>
          <p class="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto mb-6">
            Allow location access to find verified properties, flats, houses and plots near your current location with zero brokerage and clear titles.
          </p>

          <!-- Primary Actions -->
          <div class="space-y-2.5">
            <button id="bk-loc-detect-btn" type="button" class="w-full py-3 px-4 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-[#e05638] to-[#c8462b] hover:from-[#c8462b] hover:to-[#a93a23] shadow-md shadow-orange-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              <span class="material-symbols-outlined text-[18px]">my_location</span>
              <span>Use My Current Location</span>
            </button>

            <button id="bk-loc-manual-btn" type="button" class="w-full py-2.5 px-4 rounded-xl font-bold text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              <span class="material-symbols-outlined text-[16px] text-slate-500">location_city</span>
              <span>Select Location Manually</span>
            </button>
          </div>

          <!-- Privacy Notice -->
          <div class="mt-5 pt-4 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
            <span class="material-symbols-outlined text-[14px] text-slate-400">lock</span>
            <span>Your location is private and used only for nearby recommendations.</span>
          </div>
        </div>
      `;

      // Bind buttons
      document.getElementById('bk-loc-detect-btn')?.addEventListener('click', () => {
        this.detectLocation();
      });

      document.getElementById('bk-loc-manual-btn')?.addEventListener('click', () => {
        this.renderManualCitySelector();
      });

      if (window.BilledkartIcons && !document.documentElement.classList.contains('bk-icons-loaded')) {
        window.BilledkartIcons.fallbackAllIcons();
      }
    },

    renderManualCitySelector: function () {
      const container = document.getElementById('bk-loc-modal-content');
      if (!container) return;

      const currentCity = this.currentLocation ? this.currentLocation.city : 'Bengaluru';

      const citiesGridHtml = INDIAN_CITIES.map(c => {
        const isSelected = c.name.toLowerCase() === currentCity.toLowerCase();
        return `
          <button type="button" data-city-name="${c.name}" class="bk-city-item p-3 rounded-xl border text-left transition-all ${
            isSelected
              ? 'border-[#e05638] bg-orange-50/50 text-[#e05638]'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-800'
          }">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold">${c.name}</span>
              ${isSelected ? '<span class="material-symbols-outlined text-[16px] text-[#e05638]">check_circle</span>' : ''}
            </div>
            <div class="text-[10px] text-slate-400 mt-0.5">${c.state} • <span class="font-semibold text-slate-500">${c.count}</span></div>
          </button>
        `;
      }).join('');

      container.innerHTML = `
        <div>
          <!-- Header with back button -->
          <div class="flex items-center justify-between mb-3">
            <button id="bk-loc-back-btn" type="button" class="p-1 -ml-1 text-slate-400 hover:text-slate-700 flex items-center gap-1 text-xs font-bold transition-colors">
              <span class="material-symbols-outlined text-[18px]">arrow_back</span>
              <span>Back</span>
            </button>
            <span class="text-xs font-extrabold text-slate-900">Select Operating City</span>
            <div class="w-12"></div>
          </div>

          <!-- Quick GPS trigger inside manual view -->
          <button id="bk-loc-quick-gps" type="button" class="w-full mb-3.5 py-2.5 px-3 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-[#e05638] text-xs font-bold flex items-center justify-center gap-2 transition-colors">
            <span class="material-symbols-outlined text-[16px]">my_location</span>
            <span>Detect via GPS instead</span>
          </button>

          <!-- Search city input -->
          <div class="relative mb-3.5">
            <span class="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-[18px]">search</span>
            <input id="bk-city-search-input" type="text" placeholder="Search major Indian city..." class="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-[#e05638] focus:bg-white text-slate-900 transition-colors" />
          </div>

          <!-- Cities Grid -->
          <div id="bk-cities-grid" class="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
            ${citiesGridHtml}
          </div>

          <div class="mt-4 pt-3 border-t border-slate-100 text-[11px] text-center text-slate-400">
            More cities are added automatically with verified local titles.
          </div>
        </div>
      `;

      // Event bindings
      document.getElementById('bk-loc-back-btn')?.addEventListener('click', () => {
        this.renderPermissionContent();
      });

      document.getElementById('bk-loc-quick-gps')?.addEventListener('click', () => {
        this.detectLocation();
      });

      const searchInput = document.getElementById('bk-city-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          const q = e.target.value.toLowerCase().trim();
          document.querySelectorAll('.bk-city-item').forEach(btn => {
            const cityName = (btn.getAttribute('data-city-name') || '').toLowerCase();
            if (!q || cityName.includes(q)) {
              btn.classList.remove('hidden');
            } else {
              btn.classList.add('hidden');
            }
          });
        });
      }

      document.querySelectorAll('.bk-city-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const cityName = btn.getAttribute('data-city-name');
          if (cityName) {
            this.selectCityManually(cityName);
          }
        });
      });

      if (window.BilledkartIcons && !document.documentElement.classList.contains('bk-icons-loaded')) {
        window.BilledkartIcons.fallbackAllIcons();
      }
    },

    createModalDOM: function () {
      const modal = document.createElement('div');
      modal.id = 'bk-location-modal';
      modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all hidden';
      modal.innerHTML = `
        <div class="relative w-full max-w-md bg-white rounded-3xl p-6 sm:p-7 shadow-2xl border border-slate-100 transform transition-all animate-fadeIn">
          <!-- Close button -->
          <button id="bk-loc-modal-close" type="button" class="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" aria-label="Dismiss">
            <span class="material-symbols-outlined text-[20px]">close</span>
          </button>

          <div id="bk-loc-modal-content"></div>
        </div>
      `;

      document.body.appendChild(modal);
      this.modalEl = modal;

      // Close handlers
      document.getElementById('bk-loc-modal-close')?.addEventListener('click', () => {
        this.dismissModal();
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.dismissModal();
        }
      });
    },

    dismissModal: function () {
      sessionStorage.setItem(DISMISSED_KEY, '1');
      this.closeModal();
    },

    closeModal: function () {
      if (this.modalEl) {
        this.modalEl.classList.add('hidden');
      }
      document.body.classList.remove('overflow-hidden');
    },

    attachNavbarListeners: function () {
      // Whenever user clicks on the desktop or mobile location badge, open selector
      const bindClick = (id) => {
        const el = document.getElementById(id);
        if (el) {
          const clickableParent = el.closest('button') || el;
          clickableParent.addEventListener('click', (e) => {
            // Prevent other navbar toggles if applicable
            e.stopPropagation();
            if (!this.modalEl) this.createModalDOM();
            this.renderManualCitySelector();
            this.modalEl.classList.remove('hidden');
            document.body.classList.add('overflow-hidden');
          });
        }
      };

      bindClick('desktop-current-city');
      bindClick('mobile-current-city');

      // Bind any custom trigger buttons
      document.querySelectorAll('[data-open-location-modal]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (!this.modalEl) this.createModalDOM();
          this.renderPermissionContent();
          this.modalEl.classList.remove('hidden');
          document.body.classList.add('overflow-hidden');
        });
      });
    },

    showToast: function (msg, type = 'info') {
      if (typeof window.showToast === 'function') {
        window.showToast(msg, type);
        return;
      }
      let toast = document.getElementById('bk-loc-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'bk-loc-toast';
        toast.className = 'fixed bottom-5 right-5 z-[10000] px-4 py-3 rounded-2xl shadow-xl text-xs font-bold text-white transition-all transform duration-200 pointer-events-none opacity-0 translate-y-3';
        document.body.appendChild(toast);
      }
      toast.style.backgroundColor = type === 'success' ? '#10b981' : (type === 'error' ? '#ef4444' : '#1e293b');
      toast.textContent = msg;
      toast.classList.remove('opacity-0', 'translate-y-3');
      toast.classList.add('opacity-100', 'translate-y-0');

      clearTimeout(this._toastTimeout);
      this._toastTimeout = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-3');
      }, 3500);
    }
  };

  // Expose to window
  window.BilledkartLocation = BilledkartLocationManager;

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => BilledkartLocationManager.init());
  } else {
    BilledkartLocationManager.init();
  }
})();

