'use strict';
/**
 * search.js — Billedkart Realtech Intelligent Search & Discovery Engine
 * Connects directly to backend API (port 4000) and MySQL properties database
 */

const API_BASE = window.location.port === '5500' ? 'http://127.0.0.1:4000/api' : '/api';

// Global Search State
const searchState = {
  featuredPropertyId: null,
  q: '',
  purpose: 'buy',
  category: '',
  city: 'Bengaluru',
  locality: '',
  bhk: null,
  propertyType: '',
  minPrice: null,
  maxPrice: null,
  furnishing: '',
  possession: '',
  verified: false,
  ownerDirect: false,
  amenities: [],
  sort: 'recommended',
  limit: 12,
  offset: 0,
  hasMore: true,
  isLoading: false,
  userCoords: null,
  mapBounds: null,
  isSearchThisAreaEnabled: false,
  savedLocationCity: null,
  loadedProperties: new Map(),
  activePropertyId: null
};

// Leaflet Map & Markers Cache
let leafletMap = null;
let mapMarkers = new Map();
let currentPopup = null;
let infiniteScrollObserver = null;
let autocompleteTimer = null;

/* ---------------------------------------------------------------
   1. INITIALIZATION ON DOM LOADED
--------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  readUrlParameters();
  initLeafletMap();
  initFilters();
  initAutocomplete();
  initInfiniteScroll();
  await checkSavedUserLocation();
  await executeSearch(false);
});

/* ---------------------------------------------------------------
   2. URL PARAMETERS SYNCHRONIZATION
--------------------------------------------------------------- */
function readUrlParameters() {
  const params = new URLSearchParams(window.location.search);

  // 1. Text Query or Location text
  if (params.get('q')) {
    searchState.q = params.get('q').trim();
  } else if (params.get('location')) {
    const loc = params.get('location').trim();
    if (loc && loc.toLowerCase() !== 'bengaluru' && loc.toLowerCase() !== 'india') {
      searchState.q = loc;
    }
  }

  // 2. Intent and Purpose
  const intent = (params.get('intent') || '').toLowerCase();
  const purpose = (params.get('purpose') || '').toLowerCase();
  if (intent === 'rent' || purpose === 'rent') {
    searchState.purpose = 'rent';
  } else if (intent === 'buy' || purpose === 'buy') {
    searchState.purpose = 'buy';
  } else if (intent === 'commercial') {
    searchState.category = 'Commercial';
    searchState.purpose = 'any';
  } else if (intent === 'plots') {
    searchState.category = 'Plot';
    searchState.propertyType = 'Plot / Land';
    searchState.purpose = 'buy';
  }

  // 3. Category
  if (params.get('category')) {
    searchState.category = params.get('category');
  }

  // 4. City and Locality
  if (params.get('city')) searchState.city = params.get('city');
  if (params.get('locality')) searchState.locality = params.get('locality');

  // 5. BHK / Bedrooms
  const bhkParam = params.get('bhk') || params.get('bedrooms');
  if (bhkParam && bhkParam !== 'any') {
    searchState.bhk = parseInt(bhkParam, 10);
  }

  // 6. Property Type
  const typeParam = params.get('type') || params.get('propertyType');
  if (typeParam && typeParam !== 'all') {
    searchState.propertyType = typeParam;
  }

  // 7. Budget & Prices
  const budgetParam = params.get('budget');
  if (budgetParam) {
    if (budgetParam === '20l') {
      searchState.maxPrice = 2000000;
    } else if (budgetParam === '50l') {
      searchState.minPrice = 2000000;
      searchState.maxPrice = 5000000;
    } else if (budgetParam === '1cr') {
      searchState.minPrice = 5000000;
      searchState.maxPrice = 15000000;
    } else if (budgetParam === '2.5cr' || budgetParam === '2cr') {
      searchState.minPrice = 15000000;
      searchState.maxPrice = 25000000;
    } else if (budgetParam === '5cr') {
      searchState.minPrice = 25000000;
      searchState.maxPrice = 50000000;
    } else if (budgetParam === '5cr_plus') {
      searchState.minPrice = 50000000;
    } else if (budgetParam === 'under_60l') {
      searchState.maxPrice = 6000000;
    }
  }
  if (params.get('minPrice')) searchState.minPrice = parseFloat(params.get('minPrice'));
  if (params.get('maxPrice')) searchState.maxPrice = parseFloat(params.get('maxPrice'));

  // 8. Filters List
  const filtersParam = params.get('filters');
  if (filtersParam) {
    const filterTokens = filtersParam.split(',').map(s => s.trim().toLowerCase());
    if (filterTokens.includes('ready_to_move')) searchState.possession = 'ready_to_move';
    if (filterTokens.includes('owner_direct')) searchState.ownerDirect = true;
    if (filterTokens.includes('rera_verified')) searchState.verified = true;
    if (filterTokens.includes('under_60l')) searchState.maxPrice = 6000000;
    if (filterTokens.includes('2bhk')) searchState.bhk = 2;
    if (filterTokens.includes('3bhk')) searchState.bhk = 3;
    if (filterTokens.includes('luxury_villas')) searchState.propertyType = 'Villa';
  }

  // 9. Specific Flags
  if (params.get('possession')) searchState.possession = params.get('possession');
  if (params.get('furnishing')) searchState.furnishing = params.get('furnishing');
  if (params.get('verified')) searchState.verified = params.get('verified') === 'true';
  if (params.get('ownerDirect')) searchState.ownerDirect = params.get('ownerDirect') === 'true';
  if (params.get('sort')) searchState.sort = params.get('sort');

  // 10. Geographic Coordinates & Saved Location Sync
  if (params.get('latitude') && params.get('longitude')) {
    const lat = parseFloat(params.get('latitude'));
    const lon = parseFloat(params.get('longitude'));
    if (!isNaN(lat) && !isNaN(lon)) {
      searchState.userCoords = { latitude: lat, longitude: lon };
    }
  } else {
    try {
      const saved = localStorage.getItem('billedkart_user_location');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.latitude && parsed.longitude) {
          searchState.userCoords = { latitude: parseFloat(parsed.latitude), longitude: parseFloat(parsed.longitude) };
          if (!searchState.city && parsed.city) searchState.city = parsed.city;
        }
      }
    } catch (e) {}
  }

  // Synchronize UI elements with initial parameters
  syncFiltersUIFromState();
}

function updateBrowserUrl() {
  const params = new URLSearchParams();
  if (searchState.q) params.set('q', searchState.q);
  if (searchState.purpose) params.set('purpose', searchState.purpose);
  if (searchState.category) params.set('category', searchState.category);
  if (searchState.city) params.set('city', searchState.city);
  if (searchState.locality) params.set('locality', searchState.locality);
  if (searchState.bhk) params.set('bhk', searchState.bhk);
  if (searchState.propertyType) params.set('propertyType', searchState.propertyType);
  if (searchState.minPrice) params.set('minPrice', searchState.minPrice);
  if (searchState.maxPrice) params.set('maxPrice', searchState.maxPrice);
  if (searchState.furnishing) params.set('furnishing', searchState.furnishing);
  if (searchState.possession) params.set('possession', searchState.possession);
  if (searchState.verified) params.set('verified', 'true');
  if (searchState.ownerDirect) params.set('ownerDirect', 'true');
  if (searchState.sort && searchState.sort !== 'recommended') params.set('sort', searchState.sort);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', newUrl);
}

/* ---------------------------------------------------------------
   3. CORE SEARCH EXECUTION & API INTEGRATION (Section 5)
--------------------------------------------------------------- */
async function executeSearch(isAppend = false) {
  if (searchState.isLoading) return;
  searchState.isLoading = true;

  if (!isAppend) {
    searchState.offset = 0;
    searchState.loadedProperties.clear();
    showLoadingSkeletons();
  } else {
    showLoadMoreSpinner(true);
  }

  try {
    const queryParams = new URLSearchParams({
      limit: searchState.limit,
      offset: searchState.offset,
      sort: searchState.sort
    });

    if (searchState.purpose && searchState.purpose !== 'any') queryParams.set('purpose', searchState.purpose);
    if (searchState.category) queryParams.set('category', searchState.category);
    if (searchState.q) queryParams.set('q', searchState.q);
    if (searchState.city) queryParams.set('city', searchState.city);
    if (searchState.locality) queryParams.set('locality', searchState.locality);
    if (searchState.bhk) queryParams.set('bhk', searchState.bhk);
    if (searchState.propertyType) queryParams.set('propertyType', searchState.propertyType);
    if (searchState.minPrice) queryParams.set('minPrice', searchState.minPrice);
    if (searchState.maxPrice) queryParams.set('maxPrice', searchState.maxPrice);
    if (searchState.furnishing) queryParams.set('furnishing', searchState.furnishing);
    if (searchState.possession) queryParams.set('possession', searchState.possession);
    if (searchState.verified) queryParams.set('verified', 'true');
    if (searchState.ownerDirect) queryParams.set('ownerDirect', 'true');
    if (searchState.amenities && searchState.amenities.length > 0) queryParams.set('amenities', searchState.amenities.join(','));
    if (searchState.mapBounds && searchState.isSearchThisAreaEnabled) queryParams.set('mapBounds', searchState.mapBounds);

    if (searchState.userCoords) {
      queryParams.set('latitude', searchState.userCoords.latitude);
      queryParams.set('longitude', searchState.userCoords.longitude);
    }

    const response = await fetch(`${API_BASE}/properties?${queryParams.toString()}`, {
      credentials: 'include'
    });
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to retrieve listings');
    }

    searchState.hasMore = data.hasMore;
    searchState.offset = data.nextOffset || (searchState.offset + data.properties.length);

    // Cache properties
    data.properties.forEach(p => searchState.loadedProperties.set(p.id, p));

    // Update Header Counts & Text
    updateQueryHeaderUI(data.count, data.exactCount, data.fallbackCount, data.parsedQuery);

    // Render Cards
    renderPropertyCards(data.properties, isAppend);

    // Update Map
    updateMapPins(Array.from(searchState.loadedProperties.values()), !isAppend);

    // Update URL
    updateBrowserUrl();

  } catch (err) {
    console.error('[Search] Execution failed:', err);
    if (!isAppend) {
      renderErrorState(err.message);
    }
  } finally {
    searchState.isLoading = false;
    showLoadMoreSpinner(false);
  }
}

/* ---------------------------------------------------------------
   4. RENDER PROPERTY CARDS FEED (Dynamic from Database)
--------------------------------------------------------------- */
function renderPropertyCards(properties, isAppend = false) {
  console.log('DEBUG: renderPropertyCards CALLED! count=', properties ? properties.length : 0, 'isAppend=', isAppend);
  const featuredContainer = document.getElementById('featuredPropertyContainer');
  const gridContainer = document.getElementById('propertyCardsContainer');
  if (!gridContainer) return;

  if (!isAppend) {
    if (featuredContainer) featuredContainer.innerHTML = '';
    gridContainer.innerHTML = '';
    searchState.featuredPropertyId = null;
  }

  if (properties.length === 0 && searchState.loadedProperties.size === 0) {
    if (featuredContainer) featuredContainer.innerHTML = '';
    gridContainer.innerHTML = `
      <div class="col-span-full bg-white rounded-xl p-8 text-center space-y-3 border border-surface-container shadow-sm max-w-xl mx-auto my-6">
        <div class="w-14 h-14 rounded-full bg-surface-container-low text-primary flex items-center justify-center mx-auto">
          <span class="material-symbols-outlined text-[28px]">travel_explore</span>
        </div>
        <h3 class="font-headline-sm text-lg font-bold text-primary">No Matching Properties Found</h3>
        <p class="text-xs text-on-surface-variant max-w-md mx-auto leading-relaxed">
          We couldn't find any listings matching all your selected filters. Try broadening your budget, clearing some filters, or exploring nearby localities.
        </p>
        <div class="pt-2">
          <button type="button" onclick="clearAllFilters()" class="px-4 py-2 rounded-lg bg-secondary text-white font-bold text-xs hover:bg-secondary-dark transition-colors">
            Clear All Filters
          </button>
        </div>
      </div>
    `;
    return;
  }

  // Populate Featured Property (Center Column) if not already populated
  if (!searchState.featuredPropertyId && properties.length > 0) {
    const featuredProp = properties[0];
    searchState.featuredPropertyId = featuredProp.id;
    if (featuredContainer) {
      featuredContainer.innerHTML = '';
      featuredContainer.appendChild(createFeaturedPropertyCardElement(featuredProp));
    }

    // Remaining properties go to the 3-column grid below (ZERO DUPLICATION)
    const gridProps = properties.slice(1);
    gridProps.forEach(prop => {
      const cardEl = createPropertyCardElement(prop);
      gridContainer.appendChild(cardEl);
    });
  } else {
    // Append subsequent properties to grid, strictly excluding featured property ID
    properties.forEach(prop => {
      if (searchState.featuredPropertyId && prop.id === searchState.featuredPropertyId) {
        return; // Zero duplication
      }
      const cardEl = createPropertyCardElement(prop);
      gridContainer.appendChild(cardEl);
    });
  }
}

/* ---------------------------------------------------------------
   PROMINENT FEATURED PROPERTY CARD (Center Discovery Column)
--------------------------------------------------------------- */
function createFeaturedPropertyCardElement(prop) {
  const article = document.createElement('article');
  article.className = 'property-card bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 group border border-surface-container relative flex flex-col justify-between h-full w-full min-w-0';
  article.id = `property-card-${prop.id}`;
  article.setAttribute('data-id', prop.id);
  article.setAttribute('data-slug', prop.slug);

  // Floating Badges on Image
  let badgesHtml = `
    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-white font-bold text-[11px] uppercase tracking-wide shadow-sm">
      <span class="material-symbols-outlined text-[14px] text-tertiary-fixed">star</span> Top Match
    </span>
  `;
  if (prop.isVerified) {
    badgesHtml += `
      <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-700/95 backdrop-blur-sm text-white font-bold text-[10px] uppercase tracking-wide shadow-sm">
        <span class="material-symbols-outlined text-[12px]">verified</span> Verified
      </span>
    `;
  }
  if (prop.owner && prop.owner.type === 'owner') {
    badgesHtml += `
      <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary/95 backdrop-blur-sm text-white font-bold text-[10px] uppercase tracking-wide shadow-sm">
        Owner Direct
      </span>
    `;
  }
  if (prop.distanceKm !== null && prop.distanceKm !== undefined) {
    badgesHtml += `
      <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-primary text-white font-bold text-[10px] shadow-sm">
        📍 ${prop.distanceKm} km away
      </span>
    `;
  }

  // Formatted Values
  const priceText = prop.priceFormatted || (prop.price ? `₹ ${Number(prop.price).toLocaleString('en-IN')}` : 'Price on Request');
  const sqftText = prop.pricePerSqft > 0 ? `₹${Number(prop.pricePerSqft).toLocaleString('en-IN')}/sq.ft` : '';
  const areaVal = prop.superBuiltupAreaSqft || prop.carpetAreaSqft || 0;
  const areaLabel = prop.superBuiltupAreaSqft ? 'Super Area' : (prop.carpetAreaSqft ? 'Carpet Area' : 'Area');
  const areaText = areaVal > 0 ? `${Number(areaVal).toLocaleString('en-IN')} sq.ft` : 'Plot / Open';
  const bhkText = prop.bhk > 0 ? `${prop.bhk} BHK` : (prop.propertyType || 'Apartment');

  // Furnishing status normalization
  let furnishingText = 'Unfurnished';
  if (prop.furnishingStatus) {
    const fLower = prop.furnishingStatus.toLowerCase();
    if (fLower.includes('semi')) furnishingText = 'Semi-Furnished';
    else if (fLower.includes('fully') || fLower.includes('full')) furnishingText = 'Furnished';
    else if (fLower.includes('un')) furnishingText = 'Unfurnished';
    else furnishingText = prop.furnishingStatus;
  }

  const imgUrl = prop.primaryImageUrl || (prop.images && prop.images[0]) || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80';
  const photoCount = (prop.images && Array.isArray(prop.images) && prop.images.length > 0) ? prop.images.length : 1;
  const ownerName = prop.owner && prop.owner.name ? prop.owner.name : 'Realtech Verified';
  const ownerInitials = ownerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'BK';
  const ownerTypeLabel = prop.owner && prop.owner.type === 'owner' ? 'Direct Owner' : 'Verified Partner';

  article.innerHTML = `
    <div class="flex-1 flex flex-col">
      <!-- Media Aspect 16/10 Container -->
      <div class="relative w-full aspect-[16/10] overflow-hidden bg-surface-container-low cursor-pointer" onclick="navigateToProperty('${prop.slug}')">
        <img src="${imgUrl}" alt="${escapeHtml(prop.title)}" loading="lazy" 
             onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80';" 
             class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        
        <!-- Floating Badges Top-Left -->
        <div class="absolute top-2.5 left-2.5 flex flex-wrap gap-1 z-10 max-w-[85%]">
          ${badgesHtml}
        </div>

        <!-- Wishlist Button Top-Right -->
        <button type="button" aria-label="Add to Wishlist" onclick="togglePropertyWishlist(event, ${prop.id})"
          class="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/90 hover:bg-white backdrop-blur-md text-on-surface-variant hover:text-secondary flex items-center justify-center shadow-sm transition-colors z-10">
          <span class="material-symbols-outlined text-[17px] wishlist-heart-icon" id="wishlist-icon-${prop.id}">favorite_border</span>
        </button>

        <!-- Photos Count Badge Bottom-Right -->
        <div class="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-0.5 rounded flex items-center gap-1 pointer-events-none">
          <span class="material-symbols-outlined text-[11px]">photo_camera</span>
          <span>${photoCount} Photos</span>
        </div>
      </div>

      <!-- Card Content Body -->
      <div class="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
        
        <div class="space-y-2">
          <!-- Price & Brokerage Badge -->
          <div class="flex items-baseline justify-between gap-1.5">
            <div class="flex items-baseline gap-1.5 min-w-0 truncate">
              <span class="font-black text-xl text-primary tracking-tight leading-none">${priceText}</span>
              ${sqftText ? `<span class="text-xs text-on-surface-variant font-medium truncate">| ${sqftText}</span>` : ''}
            </div>
            <span class="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-full shrink-0">
              Zero Brokerage
            </span>
          </div>

          <!-- Title -->
          <div>
            <h3 class="font-bold text-sm leading-snug text-primary hover:text-secondary transition-colors cursor-pointer card-title-clamp line-clamp-2 min-h-[2.5rem]" 
                onclick="navigateToProperty('${prop.slug}')" title="${escapeHtml(prop.title)}">
              ${escapeHtml(prop.title)}
            </h3>
            <p class="text-xs text-on-surface-variant flex items-center gap-1 mt-1 truncate">
              <span class="material-symbols-outlined text-secondary text-[14px] shrink-0">location_on</span>
              <span class="truncate">${escapeHtml(prop.locality || '')}${prop.locality && prop.city ? ', ' : ''}${escapeHtml(prop.city || '')}</span>
            </p>
          </div>

          <!-- Compact 3-Cell Specs Grid (Area | Config | Furnishing) -->
          <div class="grid grid-cols-3 gap-1 py-1.5 px-2 bg-surface-container-low rounded-lg text-center text-xs">
            <div class="min-w-0">
              <span class="block text-[9.5px] uppercase font-bold text-outline tracking-wider truncate">${areaLabel}</span>
              <span class="font-extrabold text-[11.5px] text-on-surface truncate block" title="${areaText}">${areaText}</span>
            </div>
            <div class="min-w-0 border-x border-surface-container px-1">
              <span class="block text-[9.5px] uppercase font-bold text-outline tracking-wider truncate">Config</span>
              <span class="font-extrabold text-[11.5px] text-on-surface truncate block" title="${bhkText}">${bhkText}</span>
            </div>
            <div class="min-w-0">
              <span class="block text-[9.5px] uppercase font-bold text-outline tracking-wider truncate">Furnishing</span>
              <span class="font-extrabold text-[11.5px] text-on-surface truncate block" title="${furnishingText}">${furnishingText}</span>
            </div>
          </div>
        </div>

        <!-- Owner & Action Buttons Footer -->
        <div class="pt-2.5 border-t border-surface-container flex items-center justify-between gap-2 mt-auto">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-7 h-7 rounded-full bg-secondary/10 text-secondary border border-secondary/20 flex items-center justify-center font-extrabold text-[11px] shrink-0">
              ${ownerInitials}
            </div>
            <div class="min-w-0">
              <span class="block text-xs font-bold text-primary truncate leading-tight">${escapeHtml(ownerName)}</span>
              <span class="block text-[10px] text-on-surface-variant font-semibold truncate leading-tight">${ownerTypeLabel}</span>
            </div>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <!-- Button A: Internal Real-Time Chat with Seller -->
            <button type="button" onclick="if(window.BilledkartChat){window.BilledkartChat.openSellerChat(${prop.id}, ${prop.owner ? prop.owner.userId || 'null' : 'null'}, event);}else{window.location.href='/chat/index.html?propertyId=${prop.id}';}" title="Chat with Seller" 
              class="p-1.5 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-white transition-colors">
              <span class="material-symbols-outlined text-[15px]">forum</span>
            </button>
            <!-- Button B: Direct WhatsApp with Seller -->
            <button type="button" onclick="if(window.BilledkartChat){window.BilledkartChat.openSellerWhatsApp(${prop.id}, '${escapeHtml(prop.title)}', '${escapeHtml(prop.locality || prop.city || '')}', '${prop.owner && prop.owner.phone ? prop.owner.phone : ''}', event);}else{window.open('https://wa.me/919044268001','_blank');}" title="WhatsApp Seller" 
              class="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white transition-colors flex items-center justify-center">
              <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41a8.225 8.225 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.64c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.89 2.42 1.02 2.59.13.17 1.76 2.69 4.27 3.77.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.18-.47-.3"/></svg>
            </button>
            <button type="button" onclick="contactOwnerPhone(event, ${prop.id})" title="Contact Owner" 
              class="px-2 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-bold text-xs flex items-center gap-1 transition-colors border border-surface-container">
              <span class="material-symbols-outlined text-[14px] text-primary">call</span>
              <span class="hidden sm:inline">Call</span>
            </button>
            <a href="/property_detail_page/code.html?slug=${encodeURIComponent(prop.slug)}" 
              class="px-3 py-1.5 rounded-lg bg-secondary text-white hover:bg-secondary-dark font-bold text-xs flex items-center gap-1 transition-colors shadow-xs">
              <span>Details</span>
              <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
            </a>
          </div>
        </div>

      </div>
    </div>
  `;

  // Map Hover Synchronization
  article.addEventListener('mouseenter', () => highlightMapPin(prop.id, true));
  article.addEventListener('mouseleave', () => highlightMapPin(prop.id, false));

  return article;
}

/* ---------------------------------------------------------------
   4. RENDER EXTENDED PROPERTY CARDS FEED (3-Column Desktop Grid)
--------------------------------------------------------------- */
function createPropertyCardElement(prop) {
  const article = document.createElement('article');
  article.className = 'property-card bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 group border border-surface-container relative flex flex-col justify-between h-full w-full min-w-0';
  article.id = `property-card-${prop.id}`;
  article.setAttribute('data-id', prop.id);
  article.setAttribute('data-slug', prop.slug);

  // Floating Badges on Image
  let badgesHtml = '';
  if (prop.isVerified) {
    badgesHtml += `
      <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-700/95 backdrop-blur-sm text-white font-bold text-[10px] uppercase tracking-wide shadow-sm">
        <span class="material-symbols-outlined text-[12px]">verified</span> Verified
      </span>
    `;
  }
  if (prop.owner && prop.owner.type === 'owner') {
    badgesHtml += `
      <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary/95 backdrop-blur-sm text-white font-bold text-[10px] uppercase tracking-wide shadow-sm">
        Owner Direct
      </span>
    `;
  }
  if (prop.distanceKm !== null && prop.distanceKm !== undefined) {
    badgesHtml += `
      <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-primary text-white font-bold text-[10px] shadow-sm">
        📍 ${prop.distanceKm} km away
      </span>
    `;
  }

  // Fallback / Recommendation Tag (if applicable)
  let recommendationBadge = '';
  if (prop.recommendationType !== 'exact' && prop.recommendationReason) {
    recommendationBadge = `
      <div class="px-3 py-1 bg-amber-50 border-b border-amber-200 text-amber-900 text-[10.5px] font-bold flex items-center gap-1">
        <span class="material-symbols-outlined text-[13px] text-amber-600 shrink-0">lightbulb</span>
        <span class="truncate">${escapeHtml(prop.recommendationReason)}</span>
      </div>
    `;
  }

  // Formatted Values
  const priceText = prop.priceFormatted || (prop.price ? `₹ ${Number(prop.price).toLocaleString('en-IN')}` : 'Price on Request');
  const sqftText = prop.pricePerSqft > 0 ? `₹${Number(prop.pricePerSqft).toLocaleString('en-IN')}/sq.ft` : '';
  const areaVal = prop.superBuiltupAreaSqft || prop.carpetAreaSqft || 0;
  const areaLabel = prop.superBuiltupAreaSqft ? 'Super Area' : (prop.carpetAreaSqft ? 'Carpet Area' : 'Area');
  const areaText = areaVal > 0 ? `${Number(areaVal).toLocaleString('en-IN')} sq.ft` : 'Plot / Open';
  const bhkText = prop.bhk > 0 ? `${prop.bhk} BHK` : (prop.propertyType || 'Apartment');

  // Furnishing status normalization
  let furnishingText = 'Unfurnished';
  if (prop.furnishingStatus) {
    const fLower = prop.furnishingStatus.toLowerCase();
    if (fLower.includes('semi')) furnishingText = 'Semi-Furnished';
    else if (fLower.includes('fully') || fLower.includes('full')) furnishingText = 'Furnished';
    else if (fLower.includes('un')) furnishingText = 'Unfurnished';
    else furnishingText = prop.furnishingStatus;
  }

  const imgUrl = prop.primaryImageUrl || (prop.images && prop.images[0]) || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80';
  const photoCount = (prop.images && Array.isArray(prop.images) && prop.images.length > 0) ? prop.images.length : 1;
  const ownerName = prop.owner && prop.owner.name ? prop.owner.name : 'Realtech Verified';
  const ownerInitials = ownerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'BK';
  const ownerTypeLabel = prop.owner && prop.owner.type === 'owner' ? 'Direct Owner' : 'Verified Partner';

  article.innerHTML = `
    ${recommendationBadge}
    <div class="flex-1 flex flex-col">
      <!-- Media Aspect 16:10 Container -->
      <div class="relative w-full aspect-[16/10] overflow-hidden bg-surface-container-low cursor-pointer" onclick="navigateToProperty('${prop.slug}')">
        <img src="${imgUrl}" alt="${escapeHtml(prop.title)}" loading="lazy" 
             onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80';" 
             class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        
        <!-- Floating Badges Top-Left -->
        <div class="absolute top-2.5 left-2.5 flex flex-wrap gap-1 z-10 max-w-[80%]">
          ${badgesHtml}
        </div>

        <!-- Wishlist Button Top-Right -->
        <button type="button" aria-label="Add to Wishlist" onclick="togglePropertyWishlist(event, ${prop.id})"
          class="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/90 hover:bg-white backdrop-blur-md text-on-surface-variant hover:text-secondary flex items-center justify-center shadow-sm transition-colors z-10">
          <span class="material-symbols-outlined text-[17px] wishlist-heart-icon" id="wishlist-icon-${prop.id}">favorite_border</span>
        </button>

        <!-- Photos Count Badge Bottom-Right -->
        <div class="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-0.5 rounded flex items-center gap-1 pointer-events-none">
          <span class="material-symbols-outlined text-[11px]">photo_camera</span>
          <span>${photoCount} Photos</span>
        </div>
      </div>

      <!-- Card Content Body -->
      <div class="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
        
        <div class="space-y-2">
          <!-- Price & Brokerage Badge -->
          <div class="flex items-baseline justify-between gap-1.5">
            <div class="flex items-baseline gap-1.5 min-w-0 truncate">
              <span class="font-black text-lg text-primary tracking-tight leading-none">${priceText}</span>
              ${sqftText ? `<span class="text-[11px] text-on-surface-variant font-medium truncate">| ${sqftText}</span>` : ''}
            </div>
            <span class="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-full shrink-0">
              Zero Brokerage
            </span>
          </div>

          <!-- Title (2-Line Clamp with Enforced 2.5rem Min Height) -->
          <div>
            <h3 class="font-bold text-[13px] leading-snug text-primary hover:text-secondary transition-colors cursor-pointer card-title-clamp line-clamp-2 min-h-[2.5rem]" 
                onclick="navigateToProperty('${prop.slug}')" title="${escapeHtml(prop.title)}">
              ${escapeHtml(prop.title)}
            </h3>
            <p class="text-xs text-on-surface-variant flex items-center gap-1 mt-1 truncate">
              <span class="material-symbols-outlined text-secondary text-[14px] shrink-0">location_on</span>
              <span class="truncate">${escapeHtml(prop.locality || '')}${prop.locality && prop.city ? ', ' : ''}${escapeHtml(prop.city || '')}</span>
            </p>
          </div>

          <!-- Compact 3-Cell Specs Grid (Area | Config | Furnishing) -->
          <div class="grid grid-cols-3 gap-1 py-1.5 px-2 bg-surface-container-low rounded-lg text-center text-xs">
            <div class="min-w-0">
              <span class="block text-[9.5px] uppercase font-bold text-outline tracking-wider truncate">${areaLabel}</span>
              <span class="font-extrabold text-[11px] text-on-surface truncate block" title="${areaText}">${areaText}</span>
            </div>
            <div class="min-w-0 border-x border-surface-container px-1">
              <span class="block text-[9.5px] uppercase font-bold text-outline tracking-wider truncate">Config</span>
              <span class="font-extrabold text-[11px] text-on-surface truncate block" title="${bhkText}">${bhkText}</span>
            </div>
            <div class="min-w-0">
              <span class="block text-[9.5px] uppercase font-bold text-outline tracking-wider truncate">Furnishing</span>
              <span class="font-extrabold text-[11px] text-on-surface truncate block" title="${furnishingText}">${furnishingText}</span>
            </div>
          </div>
        </div>

        <!-- Owner & Action Buttons Footer -->
        <div class="pt-2.5 border-t border-surface-container flex items-center justify-between gap-2 mt-auto">
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-7 h-7 rounded-full bg-secondary/10 text-secondary border border-secondary/20 flex items-center justify-center font-extrabold text-[11px] shrink-0">
              ${ownerInitials}
            </div>
            <div class="min-w-0">
              <span class="block text-xs font-bold text-primary truncate leading-tight">${escapeHtml(ownerName)}</span>
              <span class="block text-[10px] text-on-surface-variant font-semibold truncate leading-tight">${ownerTypeLabel}</span>
            </div>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <!-- Button A: Internal Real-Time Chat with Seller -->
            <button type="button" onclick="if(window.BilledkartChat){window.BilledkartChat.openSellerChat(${prop.id}, ${prop.owner ? prop.owner.userId || 'null' : 'null'}, event);}else{window.location.href='/chat/index.html?propertyId=${prop.id}';}" title="Chat with Seller" 
              class="p-1.5 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-white transition-colors">
              <span class="material-symbols-outlined text-[15px]">forum</span>
            </button>
            <!-- Button B: Direct WhatsApp with Seller -->
            <button type="button" onclick="if(window.BilledkartChat){window.BilledkartChat.openSellerWhatsApp(${prop.id}, '${escapeHtml(prop.title)}', '${escapeHtml(prop.locality || prop.city || '')}', '${prop.owner && prop.owner.phone ? prop.owner.phone : ''}', event);}else{window.open('https://wa.me/919044268001','_blank');}" title="WhatsApp Seller" 
              class="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white transition-colors flex items-center justify-center">
              <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41a8.225 8.225 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.64c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.89 2.42 1.02 2.59.13.17 1.76 2.69 4.27 3.77.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.18-.47-.3"/></svg>
            </button>
            <button type="button" onclick="contactOwnerPhone(event, ${prop.id})" title="Contact Owner" 
              class="px-2 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-bold text-xs flex items-center gap-1 transition-colors border border-surface-container">
              <span class="material-symbols-outlined text-[14px] text-primary">call</span>
              <span class="hidden sm:inline">Call</span>
            </button>
            <a href="/property_detail_page/code.html?slug=${encodeURIComponent(prop.slug)}" 
              class="px-3 py-1.5 rounded-lg bg-secondary text-white hover:bg-secondary-dark font-bold text-xs flex items-center gap-1 transition-colors shadow-xs">
              <span>Details</span>
              <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
            </a>
          </div>
        </div>

      </div>
    </div>
  `;

  // Map Hover Synchronization
  article.addEventListener('mouseenter', () => highlightMapPin(prop.id, true));
  article.addEventListener('mouseleave', () => highlightMapPin(prop.id, false));

  return article;
}

// XSS Sanitizer Utility Helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function navigateToProperty(slug) {
  if (!slug) return;
  window.location.href = `/property_detail_page/code.html?slug=${encodeURIComponent(slug)}`;
}

/* ---------------------------------------------------------------
   5. REAL LEAFLET INTERACTIVE SPLIT MAP (Section 12)
--------------------------------------------------------------- */
function initLeafletMap() {
  const mapContainer = document.getElementById('leafletMapContainer');
  if (!mapContainer || typeof L === 'undefined') return;

  // Initialize Map centered around Bengaluru (Default)
  leafletMap = L.map('leafletMapContainer', {
    center: [12.9716, 77.5946],
    zoom: 12,
    zoomControl: true,
    scrollWheelZoom: true
  });

  // High performance OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors | Billedkart Realtech'
  }).addTo(leafletMap);

  // Map Bounds change listener for "Search this area"
  leafletMap.on('moveend', () => {
    if (!searchState.isSearchThisAreaEnabled) return;
    const bounds = leafletMap.getBounds();
    searchState.mapBounds = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
    executeSearch(false);
  });
}

function updateMapPins(properties, shouldFitBounds = true) {
  if (!leafletMap || typeof L === 'undefined') return;

  // Clear previous markers
  mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers.clear();

  const validLatLngs = [];

  properties.forEach(prop => {
    if (!prop.latitude || !prop.longitude) return;
    const lat = parseFloat(prop.latitude);
    const lon = parseFloat(prop.longitude);
    if (isNaN(lat) || isNaN(lon)) return;

    validLatLngs.push([lat, lon]);

    // Create interactive price pill HTML icon
    const pricePill = prop.priceFormatted || `₹ ${prop.price}`;
    const verifiedClass = prop.isVerified ? 'verified-pin' : '';
    
    const icon = L.divIcon({
      className: 'custom-map-icon',
      html: `<div class="map-price-marker ${verifiedClass}" id="map-pin-${prop.id}">
               <span>${pricePill}</span>
             </div>`,
      iconSize: [80, 28],
      iconAnchor: [40, 14]
    });

    const marker = L.marker([lat, lon], { icon }).addTo(leafletMap);

    // Rich card popup on click
    const popupContent = `
      <div class="w-60 overflow-hidden font-sans">
        <div class="relative h-24 bg-surface-container">
          <img src="${prop.primaryImageUrl}" alt="${prop.title}" class="w-full h-full object-cover" />
          <span class="absolute top-1.5 left-1.5 bg-emerald-700 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
            ${prop.isVerified ? 'Verified Deed' : 'Active'}
          </span>
          <span class="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[9px] font-bold px-1.5 rounded">
            ${prop.bhk > 0 ? prop.bhk + ' BHK' : prop.propertyType}
          </span>
        </div>
        <div class="p-2.5 space-y-1">
          <h4 class="font-bold text-xs text-primary truncate">${prop.title}</h4>
          <p class="text-[11px] text-on-surface-variant truncate">${prop.locality}, ${prop.city}</p>
          <div class="flex items-center justify-between pt-1">
            <span class="font-extrabold text-sm text-primary">${pricePill}</span>
            <a href="/property_detail_page/code.html?slug=${prop.slug}" class="text-secondary font-bold text-xs hover:underline flex items-center">
              View <span class="material-symbols-outlined text-[13px]">chevron_right</span>
            </a>
          </div>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent, {
      className: 'custom-leaflet-popup',
      closeButton: false,
      offset: [0, -10]
    });

    // Pin click: scroll to corresponding card in feed
    marker.on('click', () => {
      scrollToPropertyCard(prop.id);
    });

    mapMarkers.set(prop.id, marker);
  });

  // Fit map viewport to visible listings
  if (shouldFitBounds && validLatLngs.length > 0) {
    const bounds = L.latLngBounds(validLatLngs);
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  // Update map bottom metrics strip
  const mapCountEl = document.getElementById('mapVisibleCountText');
  if (mapCountEl) {
    mapCountEl.textContent = `Showing ${validLatLngs.length} verified pins on map`;
  }
}

function highlightMapPin(propertyId, isHighlighted) {
  const pinEl = document.getElementById(`map-pin-${propertyId}`);
  if (pinEl) {
    if (isHighlighted) pinEl.classList.add('active-pin');
    else pinEl.classList.remove('active-pin');
  }
}

function scrollToPropertyCard(propertyId) {
  const card = document.getElementById(`property-card-${propertyId}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('property-card-highlight');
    setTimeout(() => card.classList.remove('property-card-highlight'), 2000);
  }
}

/* ---------------------------------------------------------------
   6. LOCATION-BASED DISCOVERY & GEOLOCATION (Section 6 & 7)
--------------------------------------------------------------- */
async function checkSavedUserLocation() {
  try {
    // 1. Check client-side location manager first
    if (window.BilledkartLocation && window.BilledkartLocation.currentLocation) {
      const loc = window.BilledkartLocation.currentLocation;
      searchState.userCoords = { latitude: loc.latitude, longitude: loc.longitude };
      searchState.savedLocationCity = loc.city;
      updateLocationBadgeUI(loc.city, loc.locality);
      return;
    }

    // 2. Fallback to API check
    const res = await fetch(`${API_BASE}/properties/user-location`, { credentials: 'include' });
    const data = await res.json();
    if (data.success && data.location && data.location.latitude && data.location.longitude) {
      searchState.userCoords = {
        latitude: parseFloat(data.location.latitude),
        longitude: parseFloat(data.location.longitude)
      };
      searchState.savedLocationCity = data.location.city;
      updateLocationBadgeUI(data.location.city, data.location.locality);
    }
  } catch (e) {
    console.warn('[Location] Could not check saved location:', e.message);
  }
}

function triggerBrowserGeolocation() {
  if (window.BilledkartLocation) {
    window.BilledkartLocation.detectLocation(
      (loc) => {
        if (leafletMap && loc.latitude && loc.longitude) {
          leafletMap.setView([loc.latitude, loc.longitude], 13);
        }
      },
      () => {
        // Error already gracefully handled by manager
      }
    );
    return;
  }

  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.', 'error');
    return;
  }

  showToast('Detecting your location...');

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      searchState.userCoords = { latitude: lat, longitude: lon };

      let detectedCity = searchState.city;
      let detectedLocality = '';
      try {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const geoData = await geoRes.json();
        if (geoData && geoData.address) {
          detectedCity = geoData.address.city || geoData.address.state_district || geoData.address.state || searchState.city;
          detectedLocality = geoData.address.suburb || geoData.address.neighbourhood || '';
        }
      } catch (e) {
        console.warn('Reverse geocoding error:', e);
      }

      try {
        await fetch(`${API_BASE}/properties/user-location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            city: detectedCity,
            locality: detectedLocality,
            latitude: lat,
            longitude: lon
          })
        });
      } catch (e) {}

      updateLocationBadgeUI(detectedCity, detectedLocality);
      showToast(`Location detected: ${detectedLocality || detectedCity}`);

      if (leafletMap) {
        leafletMap.setView([lat, lon], 13);
      }

      searchState.sort = 'nearest';
      executeSearch(false);
    },
    (err) => {
      console.warn('Geolocation permission error:', err.message);
      showToast('Location access denied. You can select your city manually.', 'info');
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Global listener for Billedkart location change
window.addEventListener('billedkart:location-changed', (e) => {
  if (e.detail && e.detail.latitude && e.detail.longitude) {
    searchState.userCoords = {
      latitude: parseFloat(e.detail.latitude),
      longitude: parseFloat(e.detail.longitude)
    };
    if (e.detail.city) {
      searchState.city = e.detail.city;
      const cityFilter = document.getElementById('cityFilter');
      if (cityFilter) cityFilter.value = e.detail.city;
    }
    updateLocationBadgeUI(e.detail.city, e.detail.locality);
    if (leafletMap) {
      leafletMap.setView([e.detail.latitude, e.detail.longitude], 13);
    }
    searchState.sort = 'nearest';
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) sortSelect.value = 'nearest';
    executeSearch(false);
  }
});

function updateLocationBadgeUI(city, locality) {
  const badge = document.getElementById('detectedLocationBadge');
  if (badge) {
    badge.innerHTML = `
      <span class="material-symbols-outlined text-secondary text-[16px]">my_location</span>
      <span>${locality ? locality + ', ' + city : city}</span>
    `;
    badge.classList.remove('hidden');
  }
}

/* ---------------------------------------------------------------
   7. INFINITE SCROLL OBSERVER (Section 10)
--------------------------------------------------------------- */
function initInfiniteScroll() {
  const sentinel = document.getElementById('infiniteScrollSentinel');
  if (!sentinel) return;

  infiniteScrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && searchState.hasMore && !searchState.isLoading && searchState.loadedProperties.size > 0) {
        executeSearch(true);
      }
    });
  }, { rootMargin: '200px' });

  infiniteScrollObserver.observe(sentinel);
}

/* ---------------------------------------------------------------
   8. AUTOCOMPLETE SEARCH SUGGESTIONS (Section 17)
--------------------------------------------------------------- */
function initAutocomplete() {
  const searchInput = document.getElementById('mainSearchInput');
  const suggestionsBox = document.getElementById('searchSuggestionsBox');
  if (!searchInput || !suggestionsBox) return;

  searchInput.addEventListener('input', () => {
    clearTimeout(autocompleteTimer);
    const val = searchInput.value.trim();

    if (val.length < 2) {
      suggestionsBox.classList.add('hidden');
      return;
    }

    autocompleteTimer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/properties/suggestions?q=${encodeURIComponent(val)}`);
        const data = await res.json();
        if (data.success && data.suggestions && data.suggestions.length > 0) {
          renderSuggestions(data.suggestions);
          suggestionsBox.classList.remove('hidden');
        } else {
          suggestionsBox.classList.add('hidden');
        }
      } catch (e) {
        suggestionsBox.classList.add('hidden');
      }
    }, 200);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      suggestionsBox.classList.add('hidden');
      searchState.q = searchInput.value.trim();
      executeSearch(false);
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add('hidden');
    }
  });
}

function renderSuggestions(suggestions) {
  const box = document.getElementById('searchSuggestionsBox');
  if (!box) return;

  box.innerHTML = suggestions.map(s => `
    <div class="search-suggestion-item" onclick="applySuggestion('${s.query}')">
      <span class="material-symbols-outlined text-outline text-[18px]">
        ${s.type === 'location' ? 'location_on' : (s.type === 'project' ? 'apartment' : 'search')}
      </span>
      <div>
        <div class="text-xs font-bold text-primary">${s.title}</div>
        <div class="text-[10px] text-outline">${s.subtitle}</div>
      </div>
    </div>
  `).join('');
}

function applySuggestion(query) {
  const searchInput = document.getElementById('mainSearchInput');
  if (searchInput) searchInput.value = query;
  const box = document.getElementById('searchSuggestionsBox');
  if (box) box.classList.add('hidden');
  searchState.q = query;
  executeSearch(false);
}

/* ---------------------------------------------------------------
   9. FILTERS & EVENT LISTENERS (Section 8)
--------------------------------------------------------------- */
function initFilters() {
  // Purpose Switch (Buy / Rent)
  document.querySelectorAll('.purpose-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-purpose');
      searchState.purpose = p;
      document.querySelectorAll('.purpose-tab-btn').forEach(b => {
        b.classList.remove('bg-primary', 'text-white');
        b.classList.add('text-on-surface-variant');
      });
      btn.classList.add('bg-primary', 'text-white');
      btn.classList.remove('text-on-surface-variant');
      executeSearch(false);
    });
  });

  // BHK Selector Buttons
  document.querySelectorAll('.bhk-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bhkVal = parseInt(btn.getAttribute('data-bhk'), 10);
      if (searchState.bhk === bhkVal) {
        searchState.bhk = null;
        btn.classList.remove('bg-primary', 'text-white', 'font-bold');
        btn.classList.add('bg-surface-container-low', 'text-on-surface-variant');
      } else {
        searchState.bhk = bhkVal;
        document.querySelectorAll('.bhk-filter-btn').forEach(b => {
          b.classList.remove('bg-primary', 'text-white', 'font-bold');
          b.classList.add('bg-surface-container-low', 'text-on-surface-variant');
        });
        btn.classList.add('bg-primary', 'text-white', 'font-bold');
        btn.classList.remove('bg-surface-container-low', 'text-on-surface-variant');
      }
      executeSearch(false);
    });
  });

  // Verified & Zero Brokerage Toggles
  const verifiedToggle = document.getElementById('filterVerifiedToggle');
  if (verifiedToggle) {
    verifiedToggle.addEventListener('change', (e) => {
      searchState.verified = e.target.checked;
      executeSearch(false);
    });
  }

  const ownerDirectToggle = document.getElementById('filterOwnerDirectToggle');
  if (ownerDirectToggle) {
    ownerDirectToggle.addEventListener('change', (e) => {
      searchState.ownerDirect = e.target.checked;
      executeSearch(false);
    });
  }

  // Sort Dropdown
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      searchState.sort = e.target.value;
      executeSearch(false);
    });
  }

  // Budget Range Slider
  const maxPriceSlider = document.getElementById('budgetMaxSlider');
  const maxPriceLabel = document.getElementById('budgetMaxLabel');
  if (maxPriceSlider && maxPriceLabel) {
    maxPriceSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      searchState.maxPrice = val;
      maxPriceLabel.textContent = val >= 10000000 ? `₹ ${(val / 10000000).toFixed(2)} Cr` : `₹ ${(val / 100000).toFixed(0)} Lac`;
    });
    maxPriceSlider.addEventListener('change', () => {
      executeSearch(false);
    });
  }
}

function syncFiltersUIFromState() {
  const searchInput = document.getElementById('mainSearchInput');
  if (searchInput) searchInput.value = searchState.q || '';

  // Purpose buttons
  document.querySelectorAll('.purpose-tab-btn').forEach(btn => {
    const p = btn.getAttribute('data-purpose');
    if (p === searchState.purpose) {
      btn.classList.add('bg-primary', 'text-white');
      btn.classList.remove('text-on-surface-variant');
    } else {
      btn.classList.remove('bg-primary', 'text-white');
      btn.classList.add('text-on-surface-variant');
    }
  });

  // BHK buttons
  document.querySelectorAll('.bhk-filter-btn').forEach(b => {
    const val = parseInt(b.getAttribute('data-bhk'), 10);
    if (searchState.bhk && val === searchState.bhk) {
      b.classList.add('bg-primary', 'text-white', 'font-bold');
      b.classList.remove('bg-surface-container-low', 'text-on-surface-variant');
    } else {
      b.classList.remove('bg-primary', 'text-white', 'font-bold');
      b.classList.add('bg-surface-container-low', 'text-on-surface-variant');
    }
  });

  // Toggles
  const verifiedToggle = document.getElementById('filterVerifiedToggle');
  if (verifiedToggle) verifiedToggle.checked = !!searchState.verified;

  const ownerDirectToggle = document.getElementById('filterOwnerDirectToggle');
  if (ownerDirectToggle) ownerDirectToggle.checked = !!searchState.ownerDirect;

  // Budget slider & label
  const maxPriceSlider = document.getElementById('budgetMaxSlider');
  const maxPriceLabel = document.getElementById('budgetMaxLabel');
  if (maxPriceSlider && searchState.maxPrice) {
    maxPriceSlider.value = searchState.maxPrice;
    if (maxPriceLabel) {
      maxPriceLabel.textContent = searchState.maxPrice >= 10000000 
        ? `₹ ${(searchState.maxPrice / 10000000).toFixed(2)} Cr` 
        : `₹ ${(searchState.maxPrice / 100000).toFixed(0)} Lac`;
    }
  }

  // Header City
  const headerCity = document.getElementById('headerCurrentCity');
  if (headerCity && searchState.city) {
    headerCity.textContent = searchState.city;
  }
}

function clearAllFilters() {
  searchState.q = '';
  searchState.locality = '';
  searchState.bhk = null;
  searchState.propertyType = '';
  searchState.minPrice = null;
  searchState.maxPrice = null;
  searchState.furnishing = '';
  searchState.possession = '';
  searchState.verified = false;
  searchState.ownerDirect = false;
  searchState.amenities = [];
  searchState.mapBounds = null;
  searchState.isSearchThisAreaEnabled = false;

  const searchInput = document.getElementById('mainSearchInput');
  if (searchInput) searchInput.value = '';

  syncFiltersUIFromState();
  executeSearch(false);
  showToast('All filters cleared');
}

/* ---------------------------------------------------------------
   10. WISHLIST & OWNER CONTACT
--------------------------------------------------------------- */
async function togglePropertyWishlist(event, propertyId) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  if (window.BilledkartWishlist) {
    return window.BilledkartWishlist.toggle(propertyId, event);
  }
}

function contactOwnerPhone(event, propertyId) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const prop = searchState.loadedProperties.get(propertyId);
  if (!prop) return;

  const officialPhone = (window.BilledkartContact && window.BilledkartContact.DISPLAY_PHONE) || '+91 9044268001';
  const phone = (prop.owner && prop.owner.phone && !prop.owner.phone.includes('*')) ? prop.owner.phone : officialPhone;

  if (confirm(`Billedkart Realtech Verified Connect:\n\nProperty: ${prop.title}\nContact: ${phone}\n\nWould you like to call now?`)) {
    window.location.href = `tel:${phone.replace(/[^0-9+]/g, '')}`;
  }
}

/* ---------------------------------------------------------------
   11. UI SKELETONS & HELPERS
--------------------------------------------------------------- */
function showLoadingSkeletons() {
  const container = document.getElementById('propertyCardsContainer');
  if (!container) return;

  let skeletonHtml = '';
  for (let i = 0; i < 3; i++) {
    skeletonHtml += `
      <div class="bg-white rounded-xl overflow-hidden border border-surface-container p-4 space-y-3">
        <div class="skeleton-box w-full aspect-[16/10]"></div>
        <div class="skeleton-box h-5 w-1/3"></div>
        <div class="skeleton-box h-4 w-3/4"></div>
        <div class="skeleton-box h-12 w-full"></div>
      </div>
    `;
  }
  container.innerHTML = skeletonHtml;
}

function showLoadMoreSpinner(show) {
  const spinner = document.getElementById('infiniteScrollSpinner');
  if (spinner) {
    if (show) spinner.classList.remove('hidden');
    else spinner.classList.add('hidden');
  }
}

function updateQueryHeaderUI(totalCount, exactCount, fallbackCount, parsedNLP) {
  const titleEl = document.getElementById('queryMainTitle');
  const countEl = document.getElementById('queryCountBadge');
  const subtitleEl = document.getElementById('querySubtitleText');

  const effectiveCity = (parsedNLP && parsedNLP.city) || searchState.city || 'India';
  const effectiveLocality = (parsedNLP && parsedNLP.locality) || searchState.locality || '';
  const effectiveCategory = (parsedNLP && parsedNLP.category) || searchState.category || '';
  const effectiveBhk = (parsedNLP && parsedNLP.bhk) !== undefined && (parsedNLP && parsedNLP.bhk) !== null ? parsedNLP.bhk : searchState.bhk;
  const effectivePurpose = (parsedNLP && parsedNLP.purpose) || searchState.purpose || 'buy';

  if (titleEl) {
    let titleStr = '';
    if (effectiveCategory.toLowerCase() === 'commercial') {
      titleStr = 'Commercial Properties ';
    } else if (effectiveCategory.toLowerCase() === 'plot') {
      titleStr = 'Plots & Land ';
    } else {
      if (effectiveBhk) titleStr += `${effectiveBhk} BHK `;
      if (searchState.propertyType) titleStr += `${searchState.propertyType} `;
      else titleStr += 'Properties ';
    }

    if (effectivePurpose === 'rent') titleStr += 'for Rent ';
    else if (effectivePurpose === 'buy') titleStr += 'for Sale ';

    if (effectiveLocality) titleStr += `in ${effectiveLocality}, `;
    else titleStr += 'in ';
    titleStr += `${effectiveCity}`;

    titleEl.textContent = titleStr;
  }

  if (countEl) {
    countEl.textContent = `(${totalCount} Found)`;
  }

  if (subtitleEl) {
    if (fallbackCount > 0 && exactCount === 0) {
      subtitleEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-secondary inline-block mr-1"></span> Showing verified related properties in ${searchState.city}`;
    } else {
      subtitleEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-600 inline-block mr-1"></span> 100% verified titles and RERA registered units`;
    }
  }
}

function renderErrorState(errMsg) {
  const container = document.getElementById('propertyCardsContainer');
  if (container) {
    container.innerHTML = `
      <div class="bg-white rounded-xl p-8 text-center space-y-3 border border-red-200">
        <span class="material-symbols-outlined text-[32px] text-error">error</span>
        <h4 class="font-bold text-sm text-error">Search Temporarily Unavailable</h4>
        <p class="text-xs text-outline">${errMsg}</p>
        <button type="button" onclick="executeSearch(false)" class="px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg">Retry Search</button>
      </div>
    `;
  }
}

function showToast(msg, type = 'info') {
  let toast = document.getElementById('searchToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'searchToast';
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg shadow-xl text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-12 opacity-0 pointer-events-none';
    document.body.appendChild(toast);
  }

  if (type === 'error') {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg shadow-xl bg-red-600 text-white text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-0 opacity-100';
  } else {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg shadow-xl bg-primary text-white text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-0 opacity-100';
  }

  toast.textContent = msg;

  setTimeout(() => {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg shadow-xl text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-12 opacity-0 pointer-events-none';
  }, 3000);
}

/* ---------------------------------------------------------------
   12. MOBILE VIEW SWITCHER (List vs Full Map)
--------------------------------------------------------------- */
function toggleMobileMapView() {
  const mapCol = document.getElementById('desktopMapColumn');
  const featuredCol = document.getElementById('featuredPropertyColumn');
  const feedSection = document.getElementById('propertyFeedSection');
  const btn = document.getElementById('mobileMapToggleBtn');
  if (!mapCol || !feedSection) return;

  const isMapVisible = !mapCol.classList.contains('hidden');
  if (isMapVisible) {
    // Switch to List
    mapCol.classList.add('hidden');
    if (featuredCol) featuredCol.classList.remove('hidden');
    feedSection.classList.remove('hidden');
    if (btn) btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">map</span><span>Map View</span>`;
  } else {
    // Switch to Map
    mapCol.classList.remove('hidden');
    if (featuredCol) featuredCol.classList.add('hidden');
    feedSection.classList.add('hidden');
    if (btn) btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">view_agenda</span><span>List View</span>`;
    if (leafletMapInstance) {
      setTimeout(() => leafletMapInstance.invalidateSize(), 300);
    }
  }
}

function toggleMobileFiltersDrawer() {
  const drawer = document.getElementById('mobileFiltersDrawer');
  const backdrop = document.getElementById('mobileFiltersDrawerBackdrop');
  if (!drawer || !backdrop) return;

  const isHidden = drawer.classList.contains('hidden');
  if (isHidden) {
    drawer.classList.remove('hidden');
    backdrop.classList.remove('hidden');
  } else {
    drawer.classList.add('hidden');
    backdrop.classList.add('hidden');
  }
}

// Global exports for inline HTML handlers
window.executeSearch = executeSearch;
window.clearAllFilters = clearAllFilters;
window.togglePropertyWishlist = togglePropertyWishlist;
window.contactOwnerPhone = contactOwnerPhone;
window.triggerBrowserGeolocation = triggerBrowserGeolocation;
window.applySuggestion = applySuggestion;
window.navigateToProperty = navigateToProperty;
window.toggleMobileMapView = toggleMobileMapView;
window.toggleMobileFiltersDrawer = toggleMobileFiltersDrawer;
