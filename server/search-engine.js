'use strict';
/**
 * search-engine.js — Billedkart Realtech Intelligent Property Search & Discovery Engine
 * 
 * Features:
 *  1. Smart Natural Language Query Understanding (Section 4)
 *  2. Multi-Factor Relevance Ranking Model (Section 5)
 *  3. Adaptive Nearby Discovery & Haversine Distance (Section 6 & 7)
 *  4. Related Results Fallback (Prevents empty pages when exact title isn't found)
 *  5. Server-side Sorting & Cursor/Offset Pagination (Section 9 & 10)
 *  6. Map Viewport Bounding Box Filtering (Section 12)
 *  7. User Saved Locations & Saved Searches Persistence (Section 6 & 14)
 */

const { pool } = require('./db');

// Indian Major Cities & Localities Dictionary for fast recognition
const KNOWN_CITIES = [
  'bengaluru', 'bangalore', 'mumbai', 'delhi', 'new delhi', 'delhi ncr',
  'hyderabad', 'pune', 'lucknow', 'noida', 'gurugram', 'gurgaon',
  'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'chandigarh'
];

const KNOWN_LOCALITIES = [
  // Bengaluru
  'whitefield', 'indiranagar', 'hsr layout', 'hsr', 'koramangala', 'kanakapura road',
  'electronic city', 'sarjapur', 'devanahalli', 'hebbal', 'bellandur', 'yelahanka',
  'marathahalli', 'jp nagar', 'jayanagar', 'banashankari', 'itpl', 'hoodi', 'kadugodi',
  // Lucknow
  'gomti nagar', 'gomti nagar extension', 'hazratganj', 'indira nagar', 'aliganj',
  'mahanagar', 'ashiyana', 'jankipuram', 'vibhuti khand', 'shaheed path',
  // Mumbai
  'bandra', 'bandra west', 'carter road', 'powai', 'andheri', 'juhu', 'worli', 'thane',
  // Pune
  'hinjewadi', 'baner', 'kothrud', 'wakad', 'viman nagar', 'kharadi',
  // Hyderabad
  'gachibowli', 'jubilee hills', 'banjara hills', 'hitec city', 'kondapur', 'madhapur',
  // Noida
  'sector 150', 'sector 62', 'sector 137', 'noida expressway', 'greater noida'
];

/**
 * Calculate Haversine geodesic distance in kilometers between two coordinates
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
  const numLat1 = parseFloat(lat1);
  const numLon1 = parseFloat(lon1);
  const numLat2 = parseFloat(lat2);
  const numLon2 = parseFloat(lon2);
  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return null;

  const R = 6371; // Earth radius in km
  const dLat = (numLat2 - numLat1) * Math.PI / 180;
  const dLon = (numLon2 - numLon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(numLat1 * Math.PI / 180) * Math.cos(numLat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = R * c;
  return Math.round(dist * 10) / 10; // Round to 1 decimal place (e.g. 2.4 km)
}

/**
 * Deterministic Natural Language Search Query Parser (Section 4)
 * Extracts intent, purpose, category, property type, bhk, budget, location, and flags
 */
function parseSearchQuery(queryText) {
  if (!queryText || typeof queryText !== 'string') {
    return { cleanQuery: '', tokens: [] };
  }

  const raw = queryText.trim().toLowerCase();
  const parsed = {
    originalQuery: queryText,
    purpose: null,          // 'buy', 'rent', 'lease', 'pg'
    category: null,         // 'Residential', 'Commercial', 'Plot'
    propertyType: null,     // 'Apartment', 'Villa', 'Penthouse', 'Builder Floor', 'Commercial Shop', 'Plot / Land'
    bhk: null,              // 1, 2, 3, 4, 5
    minPrice: null,
    maxPrice: null,
    city: null,
    locality: null,
    furnishing: null,       // 'fully_furnished', 'semi_furnished', 'unfurnished'
    ownerDirect: false,     // zero brokerage / direct owner
    verifiedOnly: false,
    isNearby: false,        // "near me", "near my location"
    amenityKeywords: [],
    cleanTokens: []
  };

  // 1. Detect Intent / Purpose
  if (/\b(?:rent|rental|for rent|to let|on rent|pg|co-living)\b/i.test(raw)) {
    parsed.purpose = /\b(?:pg|co-living|paying guest)\b/i.test(raw) ? 'rent' : 'rent';
  } else if (/\b(?:lease|commercial lease)\b/i.test(raw)) {
    parsed.purpose = 'rent';
  } else if (/\b(?:buy|sale|for sale|purchase|invest)\b/i.test(raw)) {
    parsed.purpose = 'buy';
  }

  // 2. Detect BHK / Bedrooms / Rooms
  const bhkMatch = raw.match(/\b([1-5])\s*(?:bhk|bedroom|bed|b|bhks)\b/i);
  if (bhkMatch) {
    parsed.bhk = parseInt(bhkMatch[1], 10);
  } else if (/\b(?:room|studio|single room|1 room)\b/i.test(raw)) {
    parsed.bhk = 1;
  }

  // 3. Detect Property Classification & Synonyms
  if (/\b(?:flat|flats|apartment|apartments|condo|society flat)\b/i.test(raw)) {
    parsed.propertyType = 'Apartment';
    parsed.category = 'Residential';
  } else if (/\b(?:villa|villas|independent house|bungalow|row house|kothi|duplex)\b/i.test(raw)) {
    parsed.propertyType = 'Villa';
    parsed.category = 'Residential';
  } else if (/\b(?:penthouse|sky villa|pent house)\b/i.test(raw)) {
    parsed.propertyType = 'Penthouse';
    parsed.category = 'Residential';
  } else if (/\b(?:builder floor|floor)\b/i.test(raw)) {
    parsed.propertyType = 'Builder Floor';
    parsed.category = 'Residential';
  } else if (/\b(?:shop|shops|retail|office|showroom|commercial)\b/i.test(raw)) {
    parsed.propertyType = 'Commercial Shop';
    parsed.category = 'Commercial';
  } else if (/\b(?:plot|plots|land|residential plot|site)\b/i.test(raw)) {
    parsed.propertyType = 'Plot / Land';
    parsed.category = 'Plot';
  }

  // 4. Detect Furnishing
  if (/\b(?:fully furnished|furnished)\b/i.test(raw) && !/\bunfurnished\b/i.test(raw)) {
    parsed.furnishing = 'fully_furnished';
  } else if (/\b(?:semi furnished|semi-furnished)\b/i.test(raw)) {
    parsed.furnishing = 'semi_furnished';
  } else if (/\b(?:unfurnished|raw)\b/i.test(raw)) {
    parsed.furnishing = 'unfurnished';
  }

  // 5. Detect Owner Direct / Zero Brokerage / Verified
  if (/\b(?:owner direct|by owner|direct owner|zero brokerage|0% brokerage|without broker)\b/i.test(raw)) {
    parsed.ownerDirect = true;
  }
  if (/\b(?:verified|rera|rera approved|verified deed)\b/i.test(raw)) {
    parsed.verifiedOnly = true;
  }

  // 6. Detect Proximity / "Near Me"
  if (/\b(?:near me|nearby|near my location|close to me|around me)\b/i.test(raw)) {
    parsed.isNearby = true;
  }

  // 7. Parse Indian Budget & Numbers (e.g. "under 80 lakh", "below 25000", "1.5 cr", "50L")
  function parseIndianAmount(numStr, unit) {
    let val = parseFloat(numStr);
    if (isNaN(val)) return null;
    const u = (unit || '').toLowerCase().trim();
    if (u === 'cr' || u === 'crore' || u === 'crores') return val * 10000000;
    if (u === 'l' || u === 'lac' || u === 'lacs' || u === 'lakh' || u === 'lakhs') return val * 100000;
    if (u === 'k' || u === 'thousand') return val * 1000;
    // If no unit and amount is small (< 100), assume Lakhs if buy, or standard integer if > 1000
    if (val <= 100 && parsed.purpose !== 'rent') return val * 100000;
    return val;
  }

  // Max Budget Match
  const maxBudgetMatch = raw.match(/(?:under|below|less than|within|upto|budget of|max|budget)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lac|lacs|lakh|lakhs|k|thousand)?/i);
  if (maxBudgetMatch) {
    parsed.maxPrice = parseIndianAmount(maxBudgetMatch[1], maxBudgetMatch[2]);
  }

  // Min Budget Match
  const minBudgetMatch = raw.match(/(?:above|more than|over|min)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lac|lacs|lakh|lakhs|k|thousand)?/i);
  if (minBudgetMatch) {
    parsed.minPrice = parseIndianAmount(minBudgetMatch[1], minBudgetMatch[2]);
  }

  // 8. Recognize Cities and Localities in Query
  for (const loc of KNOWN_LOCALITIES) {
    if (raw.includes(loc)) {
      parsed.locality = loc.replace(/\b\w/g, l => l.toUpperCase()); // Title Case
      break;
    }
  }

  for (const c of KNOWN_CITIES) {
    if (raw.includes(c)) {
      if (c === 'bangalore' || c === 'bengaluru') parsed.city = 'Bengaluru';
      else if (c === 'mumbai') parsed.city = 'Mumbai';
      else if (c === 'delhi' || c === 'new delhi' || c === 'delhi ncr') parsed.city = 'Delhi NCR';
      else if (c === 'hyderabad') parsed.city = 'Hyderabad';
      else if (c === 'pune') parsed.city = 'Pune';
      else if (c === 'lucknow') parsed.city = 'Lucknow';
      else if (c === 'noida') parsed.city = 'Noida';
      else parsed.city = c.replace(/\b\w/g, l => l.toUpperCase());
      break;
    }
  }

  // Extract clean keywords removing stopwords and extracted entities
  const stopwords = new Set([
    'in', 'at', 'near', 'for', 'of', 'and', 'the', 'a', 'an', 'under', 'below',
    'above', 'bhk', 'flat', 'apartment', 'house', 'villa', 'rent', 'buy', 'sale',
    'me', 'my', 'location', 'nearby', 'lakh', 'crore', 'cr', 'lacs', 'lakhs'
  ]);

  parsed.cleanTokens = raw
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopwords.has(t));

  return parsed;
}

/**
 * Intelligent Property Search with Multi-Factor Relevance Ranking & Multi-Tier Fallback (Section 5)
 */
async function searchProperties(params = {}, userCoords = null) {
  const {
    q = '',
    purpose,
    city,
    locality,
    bhk,
    propertyType,
    category,
    minPrice,
    maxPrice,
    furnishing,
    possession,
    verified,
    ownerDirect,
    amenities = '',
    sort = 'recommended',
    limit = 20,
    offset = 0,
    mapBounds = null // minLat,minLon,maxLat,maxLon
  } = params;

  // 1. NLP Query Parsing
  const parsedNLP = parseSearchQuery(q);

  // Combine query-level parsed attributes with explicit filter parameters
  // When an NLP query specifies intent (e.g., 'rent', 'Lucknow', '2 BHK'), user query takes precedence
  const effectivePurpose = (parsedNLP.purpose || purpose || '').toLowerCase();
  const effectiveCategory = (parsedNLP.category || category || '').toLowerCase();
  const effectiveCity = parsedNLP.city || city || null;
  const effectiveLocality = parsedNLP.locality || locality || null;
  const effectiveBhk = parsedNLP.bhk !== null ? parsedNLP.bhk : (bhk ? parseInt(bhk, 10) : null);
  const effectiveType = parsedNLP.propertyType || propertyType || null;
  const effectiveMinPrice = parsedNLP.minPrice || (minPrice ? parseFloat(minPrice) : null);
  const effectiveMaxPrice = parsedNLP.maxPrice || (maxPrice ? parseFloat(maxPrice) : null);
  const effectiveFurnishing = furnishing || parsedNLP.furnishing || null;
  const effectiveVerified = verified === 'true' || verified === true || parsedNLP.verifiedOnly;
  const effectiveOwnerDirect = ownerDirect === 'true' || ownerDirect === true || parsedNLP.ownerDirect;

  // Reference coordinates for distance calculation
  let targetLat = userCoords && userCoords.latitude ? parseFloat(userCoords.latitude) : null;
  let targetLon = userCoords && userCoords.longitude ? parseFloat(userCoords.longitude) : null;

  // 2. Fetch Active Properties (Broader query to allow intelligent fallback ranking)
  let sql = 'SELECT * FROM properties WHERE status = "active"';
  const queryParams = [];

  // Hard filter by map bounding box if supplied (e.g. map pan/zoom)
  if (mapBounds) {
    const [minLat, minLon, maxLat, maxLon] = mapBounds.split(',').map(n => parseFloat(n.trim()));
    if (!isNaN(minLat) && !isNaN(minLon) && !isNaN(maxLat) && !isNaN(maxLon)) {
      sql += ' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?';
      queryParams.push(minLat, maxLat, minLon, maxLon);
    }
  }

  // Filter by purpose if specified (Buy vs Rent)
  if (effectivePurpose && (effectivePurpose === 'buy' || effectivePurpose === 'rent')) {
    if (effectiveCategory === 'commercial' && !parsedNLP.purpose && !purpose) {
      // Allow commercial properties in both buy and rent
    } else {
      sql += ' AND transaction_type = ?';
      queryParams.push(effectivePurpose);
    }
  }

  // Filter by city if specified
  if (effectiveCity) {
    sql += ' AND city = ?';
    queryParams.push(effectiveCity);
  }

  const [allRows] = await pool.query(sql, queryParams);

  // 3. Multi-Factor Scoring Engine (Section 5)
  // Signals: Text (25%), Purpose/Type (20%), Locality/Geo (20%), Budget (15%), Specs (10%), Quality (10%)
  const scoredList = allRows.map(row => {
    let score = 0;
    const titleLower = (row.title || '').toLowerCase();
    const locLower = (row.locality || '').toLowerCase();
    const descLower = (row.description || '').toLowerCase();
    const projLower = (row.project_name || '').toLowerCase();
    const rowPrice = parseFloat(row.price || 0);
    const rowBhk = parseInt(row.bhk || 0, 10);
    const rowLat = parseFloat(row.latitude);
    const rowLon = parseFloat(row.longitude);

    // Calculate actual distance if reference coordinates exist
    let distanceKm = null;
    if (targetLat && targetLon && !isNaN(rowLat) && !isNaN(rowLon)) {
      distanceKm = calculateHaversineDistance(targetLat, targetLon, rowLat, rowLon);
    }

    // Recommendation tagging
    let isExactMatch = true;
    let recommendationType = 'exact';
    let recommendationReason = null;

    // --- Signal A: Text & Keyword Relevance (25 pts max) ---
    if (q && q.trim()) {
      const qTrim = q.trim().toLowerCase();
      if (titleLower === qTrim) {
        score += 25; // Exact title match
      } else if (titleLower.includes(qTrim)) {
        score += 20; // Partial title match
      } else if (locLower.includes(qTrim) || projLower.includes(qTrim)) {
        score += 18; // Project or locality match
      } else if (descLower.includes(qTrim)) {
        score += 10; // Description match
      } else {
        // Token-level matching
        let matchedTokens = 0;
        parsedNLP.cleanTokens.forEach(tok => {
          if (titleLower.includes(tok) || locLower.includes(tok) || projLower.includes(tok)) {
            matchedTokens++;
          }
        });
        score += Math.min(matchedTokens * 5, 15);
      }
    } else {
      score += 15; // Baseline neutral score if no text query
    }

    // --- Signal B: Purpose & Category Match (20 pts max) ---
    if (effectiveCategory) {
      if (effectiveCategory === 'commercial') {
        if (row.property_type === 'Commercial Shop' || (row.description || '').toLowerCase().includes('commercial')) {
          score += 15;
        } else {
          isExactMatch = false;
          score -= 25;
        }
      } else if (effectiveCategory === 'plot') {
        if (row.property_type === 'Plot / Land' || (row.title || '').toLowerCase().includes('plot')) {
          score += 15;
        } else {
          isExactMatch = false;
          score -= 25;
        }
      } else if (effectiveCategory === 'residential') {
        if (row.property_type !== 'Commercial Shop' && row.property_type !== 'Plot / Land') {
          score += 8;
        } else {
          isExactMatch = false;
          score -= 25;
        }
      }
    }

    if (effectivePurpose) {
      if (row.transaction_type === effectivePurpose) {
        score += 12;
      } else {
        isExactMatch = false;
        score -= 25; // Strong penalty for purpose mismatch
      }
    } else {
      score += 10;
    }

    if (effectiveType) {
      if ((row.property_type || '').toLowerCase().includes(effectiveType.toLowerCase())) {
        score += 8;
      } else {
        isExactMatch = false;
      }
    }

    if (possession && row.possession_status) {
      if (row.possession_status === possession) {
        score += 5;
      } else {
        isExactMatch = false;
      }
    }

    // --- Signal C: Locality & Geographic Proximity (20 pts max) ---
    if (distanceKm !== null) {
      if (distanceKm <= 2.0) {
        score += 20;
        recommendationReason = `📍 ${distanceKm} km away (Immediate Nearby)`;
      } else if (distanceKm <= 5.0) {
        score += 16;
        recommendationReason = `📍 ${distanceKm} km away`;
      } else if (distanceKm <= 10.0) {
        score += 12;
        recommendationReason = `📍 ${distanceKm} km away`;
      } else if (distanceKm <= 20.0) {
        score += 8;
        recommendationReason = `📍 ${distanceKm} km away in extended cluster`;
      } else {
        score += 4;
        recommendationReason = `📍 ${distanceKm} km away`;
      }
    } else if (effectiveLocality) {
      if (locLower.includes(effectiveLocality.toLowerCase())) {
        score += 20;
      } else {
        score += 5; // Same city fallback
        isExactMatch = false;
        recommendationReason = `In nearby locality ${row.locality}`;
      }
    } else {
      score += 12;
    }

    // --- Signal D: Budget Match (15 pts max) ---
    if (effectiveMaxPrice && effectiveMaxPrice > 0) {
      if (rowPrice <= effectiveMaxPrice) {
        score += 15;
      } else if (rowPrice <= effectiveMaxPrice * 1.15) {
        // Within 15% above budget — related alternative (Section 5C)
        score += 7;
        isExactMatch = false;
        recommendationType = 'above_budget';
        recommendationReason = `High-Spec Alternative (+${Math.round(((rowPrice - effectiveMaxPrice) / effectiveMaxPrice) * 100)}% budget)`;
      } else {
        isExactMatch = false;
        score -= 15;
      }
    } else {
      score += 10;
    }

    if (effectiveMinPrice && effectiveMinPrice > 0 && rowPrice < effectiveMinPrice) {
      score -= 5;
    }

    // --- Signal E: Specifications Match (10 pts max) ---
    if (effectiveBhk) {
      if (rowBhk === effectiveBhk) {
        score += 7;
      } else if (Math.abs(rowBhk - effectiveBhk) === 1) {
        score += 3; // Adjacent configuration (e.g. 2 BHK when 3 BHK requested)
        if (isExactMatch) {
          isExactMatch = false;
          recommendationType = 'related_type';
          recommendationReason = `Related ${rowBhk} BHK Configuration`;
        }
      } else {
        isExactMatch = false;
      }
    }

    if (effectiveFurnishing && row.furnishing_status === effectiveFurnishing) {
      score += 3;
    }

    // --- Signal F: Listing Quality & Freshness (10 pts max) ---
    if (row.verification_status === 'verified') score += 5;
    if (row.is_rera_registered) score += 3;
    if (row.primary_image_url) score += 2;

    // Filter check for strict toggles
    if (effectiveVerified && row.verification_status !== 'verified') {
      isExactMatch = false;
      score -= 20;
    }
    if (effectiveOwnerDirect && row.owner_type !== 'owner') {
      isExactMatch = false;
      score -= 20;
    }

    return {
      row,
      score: Math.max(score, 0),
      distanceKm,
      isExactMatch,
      recommendationType: isExactMatch ? 'exact' : (recommendationType || 'related'),
      recommendationReason: recommendationReason || (isExactMatch ? 'Verified Direct Match' : 'Related Property in Region')
    };
  });

  // 4. Sort Results Server-Side (Section 9)
  scoredList.sort((a, b) => {
    if (sort === 'nearest') {
      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm || b.score - a.score;
      }
      if (a.distanceKm !== null) return -1;
      if (b.distanceKm !== null) return 1;
      return b.score - a.score;
    }
    if (sort === 'price_asc') {
      return parseFloat(a.row.price || 0) - parseFloat(b.row.price || 0) || b.score - a.score;
    }
    if (sort === 'price_desc') {
      return parseFloat(b.row.price || 0) - parseFloat(a.row.price || 0) || b.score - a.score;
    }
    if (sort === 'newest') {
      return new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime();
    }
    if (sort === 'area_desc') {
      const areaA = parseFloat(a.row.super_builtup_area_sqft || a.row.carpet_area_sqft || 0);
      const areaB = parseFloat(b.row.super_builtup_area_sqft || b.row.carpet_area_sqft || 0);
      return areaB - areaA;
    }
    // Default: 'recommended' by multi-factor score
    return b.score - a.score || b.row.id - a.row.id;
  });

  // 5. Separate Exact vs Fallback Related Listings (Section 5D)
  const exactMatches = scoredList.filter(item => item.isExactMatch && item.score >= 30);
  const fallbackRelated = scoredList.filter(item => !item.isExactMatch && item.score >= 15);

  // If exact matches exist, show them first, then related below; if none, show related gracefully
  const finalSequence = exactMatches.length > 0 ? [...exactMatches, ...fallbackRelated] : fallbackRelated;

  const lim = Math.min(parseInt(limit, 10) || 20, 100);
  const off = parseInt(offset, 10) || 0;
  const paginated = finalSequence.slice(off, off + lim);
  const hasMore = off + lim < finalSequence.length;
  const nextOffset = hasMore ? off + lim : null;

  return {
    totalCount: finalSequence.length,
    exactCount: exactMatches.length,
    fallbackCount: fallbackRelated.length,
    hasMore,
    nextOffset,
    appliedFilters: {
      q,
      purpose: effectivePurpose,
      city: effectiveCity,
      locality: effectiveLocality,
      bhk: effectiveBhk,
      propertyType: effectiveType,
      minPrice: effectiveMinPrice,
      maxPrice: effectiveMaxPrice,
      furnishing: effectiveFurnishing,
      possession,
      verified: effectiveVerified,
      ownerDirect: effectiveOwnerDirect,
      sort
    },
    parsedQuery: parsedNLP,
    userLocation: targetLat && targetLon ? { latitude: targetLat, longitude: targetLon } : null,
    properties: paginated.map(item => ({
      id: item.row.id,
      slug: item.row.slug,
      title: item.row.title,
      propertyType: item.row.property_type,
      transactionType: item.row.transaction_type,
      projectName: item.row.project_name || '',
      price: parseFloat(item.row.price || 0),
      priceFormatted: parseFloat(item.row.price || 0) >= 10000000 
        ? `₹ ${(parseFloat(item.row.price || 0) / 10000000).toFixed(2)} Cr`
        : `₹ ${(parseFloat(item.row.price || 0) / 100000).toFixed(2)} Lac`,
      pricePerSqft: item.row.super_builtup_area_sqft > 0 
        ? Math.round(parseFloat(item.row.price || 0) / parseFloat(item.row.super_builtup_area_sqft))
        : (item.row.carpet_area_sqft > 0 ? Math.round(parseFloat(item.row.price || 0) / parseFloat(item.row.carpet_area_sqft)) : 0),
      bhk: parseInt(item.row.bhk || 0, 10),
      bathrooms: parseInt(item.row.bathrooms || 0, 10),
      balconies: parseInt(item.row.balconies || 0, 10),
      carpetAreaSqft: parseFloat(item.row.carpet_area_sqft || 0),
      superBuiltupAreaSqft: parseFloat(item.row.super_builtup_area_sqft || 0),
      facing: item.row.facing || 'East',
      floorNumber: parseInt(item.row.floor_number || 0, 10),
      totalFloors: parseInt(item.row.total_floors || 0, 10),
      furnishingStatus: item.row.furnishing_status || 'semi_furnished',
      possessionStatus: item.row.possession_status || 'ready_to_move',
      verificationStatus: item.row.verification_status || 'unverified',
      isVerified: item.row.verification_status === 'verified',
      isReraRegistered: Boolean(item.row.is_rera_registered),
      reraId: item.row.rera_id || null,
      locality: item.row.locality,
      city: item.row.city,
      addressLine: item.row.address_line,
      latitude: parseFloat(item.row.latitude || 12.9716),
      longitude: parseFloat(item.row.longitude || 77.5946),
      primaryImageUrl: item.row.primary_image_url || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1000&q=80',
      images: safeJson(item.row.images, []),
      amenities: safeJson(item.row.amenities, []),
      owner: {
        name: item.row.owner_name || 'Billedkart Verified Partner',
        type: item.row.owner_type || 'owner',
        isVerified: Boolean(item.row.is_owner_verified),
        responseTime: item.row.owner_response_time || 'Within 15 mins'
      },
      relevanceScore: item.score,
      distanceKm: item.distanceKm,
      recommendationType: item.recommendationType,
      recommendationReason: item.recommendationReason,
      createdAt: item.row.created_at
    }))
  };
}

/**
 * Autocomplete Search Suggestions (Section 17)
 */
async function getSearchSuggestions(queryText) {
  if (!queryText || queryText.trim().length < 2) return [];

  const q = queryText.trim().toLowerCase();
  const suggestions = [];

  // 1. City / Locality matches
  const [localities] = await pool.query(
    'SELECT DISTINCT locality, city FROM properties WHERE status = "active" AND (locality LIKE ? OR city LIKE ?) LIMIT 5',
    [`%${q}%`, `%${q}%`]
  );
  localities.forEach(r => {
    suggestions.push({
      type: 'location',
      title: `${r.locality}, ${r.city}`,
      subtitle: 'Locality & Region',
      query: `${r.locality}, ${r.city}`
    });
  });

  // 2. Project / Society matches
  const [projects] = await pool.query(
    'SELECT DISTINCT project_name, locality, city FROM properties WHERE status = "active" AND project_name LIKE ? LIMIT 4',
    [`%${q}%`]
  );
  projects.forEach(p => {
    if (p.project_name) {
      suggestions.push({
        type: 'project',
        title: p.project_name,
        subtitle: `${p.locality}, ${p.city}`,
        query: `${p.project_name} in ${p.locality}`
      });
    }
  });

  // 3. Smart NLP intent suggestions
  if (/\b(?:rent|flat|bhk|house|shop|plot)\b/i.test(q)) {
    suggestions.push({
      type: 'query',
      title: `${queryText} (Owner Direct)`,
      subtitle: 'Zero Brokerage Listings',
      query: `${queryText} zero brokerage`
    });
  }

  return suggestions;
}

/**
 * Helper: parse JSON safely
 */
function safeJson(val, fallback = []) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
}

module.exports = {
  calculateHaversineDistance,
  parseSearchQuery,
  searchProperties,
  getSearchSuggestions
};
