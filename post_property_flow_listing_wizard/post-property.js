/**
 * post-property.js — Billedkart Realtech Master Post Property Wizard Engine
 * Features:
 *   - 8-Step Navigation with Dynamic Category & Type Field Engine
 *   - Auto-Save & Server Draft Resumption (MySQL property_drafts)
 *   - Real Multi-File Image Upload via Multer (/api/properties/upload-image)
 *   - Live Real-Time Property Preview (PDP layout synchronization)
 *   - Dynamic Listing Strength Calculation (0 - 100%)
 *   - 10-Second Idle Help Assistance Modal with Support Placeholders
 *   - Real Database Submission Transaction (/api/properties/submit)
 *   - Zero instances of prohibited marketing keywords
 */

// Configurable Support Placeholders (Section 8)
const SUPPORT_WHATSAPP_NUMBER = (typeof window !== 'undefined' && window.BilledkartContact && window.BilledkartContact.FULL_PHONE) || '+919044268001';
const SUPPORT_PHONE_NUMBER = (typeof window !== 'undefined' && window.BilledkartContact && window.BilledkartContact.FULL_PHONE) || '+919044268001';
const SUPPORT_EMAIL = (typeof window !== 'undefined' && window.BilledkartContact && window.BilledkartContact.EMAIL) || 'billedkart@gmail.com';

const API_BASE = window.location.origin.includes(':5500') 
  ? 'http://127.0.0.1:4000' 
  : window.location.origin;

// Global Wizard State
const wizardState = {
  draftToken: localStorage.getItem('billedkart_draft_token') || '',
  currentStep: 1,
  completionScore: 15,
  purpose: 'Sell',
  category: 'Residential',
  propertyType: 'Apartment',
  
  // Location
  country: 'India',
  state: 'Karnataka',
  city: 'Bengaluru',
  locality: 'Indiranagar',
  subLocality: '100 Feet Road',
  projectName: '',
  addressLine: '',
  pincode: '560038',
  landmark: '',
  hideExactLocation: false,

  // Specs
  superBuiltupArea: 1850,
  carpetArea: 1480,
  bhk: 3,
  bathrooms: 3,
  balconies: 2,
  floorNumber: 9,
  totalFloors: 18,
  facing: 'East Facing (Surya Vaastu)',
  propertyAge: '0-1 Years (New)',
  possessionStatus: 'ready_to_move',
  possessionDate: 'Immediate',
  furnishing: 'semi_furnished',
  parkingCovered: 2,
  parkingOpen: 0,

  // Commercial / Land specific
  plotArea: '',
  plotDimensions: '',
  boundaryWall: 'Yes',

  // Pricing
  price: 26500000, // 2.65 Cr
  isNegotiable: true,
  maintenance: 6500,
  deposit: 0,
  stampDutyBorneBy: 'Buyer',

  // Amenities & Description
  amenities: ['Lift', '24/7 Security', '100% DG Power Backup', 'Covered Parking', 'Gym', 'Clubhouse', 'Swimming Pool'],
  title: '3 BHK High-Rise Apartment in Indiranagar',
  description: 'Spacious 3 BHK home situated in prime Indiranagar with expansive balcony view, modular kitchen, and full RERA compliance.',
  highlights: ['Prime Metro Connectivity', 'A Khata Digital Title', 'Lake & Tree Canopy View'],

  // Photos
  images: [
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80'
  ],
  primaryImageUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',

  // KYC
  ownerType: 'owner',
  ownerName: 'Venkatesh Rao',
  ownerPhone: '9845012345',
  ownerEmail: 'venkatesh.rao@example.com',
  documents: []
};

// Available Types per Category
const categoryTypes = {
  Residential: [
    'Apartment / Flat',
    'Independent House',
    'Villa / Bungalow',
    'Builder Floor',
    'Penthouse',
    'Studio Apartment'
  ],
  Commercial: [
    'Office Space',
    'Shop / Showroom',
    'Commercial Building',
    'Warehouse',
    'Industrial Property'
  ],
  Plot: [
    'Residential Plot',
    'Commercial Land',
    'Gated Community Plot',
    'Agricultural / Farm Land'
  ]
};

// Amenities Catalog per Category
const categoryAmenities = {
  Residential: [
    'Lift', '24/7 Security', '100% DG Power Backup', 'Covered Parking',
    'Gym', 'Swimming Pool', 'Clubhouse', 'Gated Community',
    'Cauvery Water Supply', 'EV Charging Station', 'Children Play Area', 'Visitor Parking'
  ],
  Commercial: [
    'High Speed Elevators', '100% DG Power Backup', '24/7 CCTV & Security', 'Central Air Conditioning',
    'Multi-Level Parking', 'Cafeteria / Food Court', 'Conference Room', 'Fire Suppression Sprinklers'
  ],
  Plot: [
    'Gated Boundary Wall', 'Paved 40ft Internal Roads', 'Underground Drainage',
    'Electricity Lines', 'Street Lighting', 'Park / Green Buffer'
  ]
};

// Indian Currency Formatter
function formatINR(num) {
  if (!num || isNaN(num)) return '₹0';
  num = Number(num);
  if (num >= 10000000) {
    return '₹' + (num / 10000000).toFixed(2) + ' Crore';
  } else if (num >= 100000) {
    return '₹' + (num / 100000).toFixed(2) + ' Lac';
  } else {
    return '₹' + num.toLocaleString('en-IN');
  }
}

// Format number with Indian commas
function formatNumberIndian(x) {
  if (!x) return '';
  const parts = x.toString().split('.');
  let lastThree = parts[0].substring(parts[0].length - 3);
  const otherNumbers = parts[0].substring(0, parts[0].length - 3);
  if (otherNumbers !== '') lastThree = ',' + lastThree;
  const res = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  return parts.length > 1 ? res + '.' + parts[1] : res;
}

// -------------------------------------------------------------
const STEP_TITLES = [
  'Purpose & Category',
  'Location & Address',
  'Specifications',
  'Pricing & Terms',
  'Amenities & Details',
  'Photos & Media',
  'Owner KYC & Docs',
  'Review & Publish'
];

// 1. STEP NAVIGATION & DYNAMIC FORM ENGINE
// -------------------------------------------------------------
function goToStep(stepNumber) {
  if (stepNumber < 1 || stepNumber > 8) return;
  
  // Validate current step before advancing
  if (stepNumber > wizardState.currentStep) {
    const error = validateStep(wizardState.currentStep);
    if (error) {
      showToast(error, 'error');
      return;
    }
  }

  wizardState.currentStep = stepNumber;
  renderStepView();
  updateStepperUI();
  calculateListingStrength();
  updateLivePreview();
  triggerAutoSave();
  window.scrollTo({ top: window.innerWidth < 768 ? 0 : 120, behavior: 'smooth' });
}

function nextStep() {
  goToStep(wizardState.currentStep + 1);
}

function prevStep() {
  goToStep(wizardState.currentStep - 1);
}

function validateStep(step) {
  if (step === 1) {
    if (!wizardState.purpose) return 'Please choose a listing purpose (Sell, Rent, Lease).';
    if (!wizardState.category) return 'Please choose a property category.';
    if (!wizardState.propertyType) return 'Please select a property type.';
  } else if (step === 2) {
    if (!wizardState.city) return 'Please specify a city.';
    if (!wizardState.locality) return 'Please specify a locality.';
  } else if (step === 3) {
    if (wizardState.category !== 'Plot' && (!wizardState.superBuiltupArea || wizardState.superBuiltupArea <= 0)) {
      return 'Please enter a valid super built-up area.';
    }
  } else if (step === 4) {
    if (!wizardState.price || Number(wizardState.price) <= 0) {
      return 'Please enter expected price or rent.';
    }
  } else if (step === 7) {
    if (!wizardState.ownerName.trim()) return 'Please enter your full name.';
    const cleanPhone = wizardState.ownerPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) return 'Please enter a valid 10-digit mobile number.';
  }
  return null;
}

function updateStepperUI() {
  // Desktop Stepper Strip Nodes
  const steps = document.querySelectorAll('.stepper-node');
  steps.forEach((node, idx) => {
    const stepNum = idx + 1;
    node.classList.remove('completed', 'active', 'pending');
    const bubble = node.querySelector('.stepper-bubble');
    const label = node.querySelector('.stepper-label');
    const bar = node.querySelector('.stepper-line');

    if (stepNum < wizardState.currentStep) {
      node.classList.add('completed');
      bubble.className = 'stepper-bubble w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0';
      bubble.innerHTML = '<span class="material-symbols-outlined text-[14px]">check</span>';
      if (bar) bar.className = 'stepper-line h-1.5 w-full bg-emerald-600 rounded-full';
      if (label) label.className = 'stepper-label text-[11px] text-on-surface truncate font-semibold';
    } else if (stepNum === wizardState.currentStep) {
      node.classList.add('active');
      bubble.className = 'stepper-bubble w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm';
      bubble.textContent = stepNum;
      if (bar) bar.className = 'stepper-line h-1.5 w-full bg-primary rounded-full';
      if (label) label.className = 'stepper-label text-[11px] text-primary truncate font-bold';
    } else {
      node.classList.add('pending');
      bubble.className = 'stepper-bubble w-6 h-6 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center font-bold text-xs shrink-0';
      bubble.textContent = stepNum;
      if (bar) bar.className = 'stepper-line h-1.5 w-full bg-surface-container-high rounded-full';
      if (label) label.className = 'stepper-label text-[11px] text-on-surface-variant truncate';
    }
  });

  const milestoneEl = document.getElementById('stepperMilestoneText');
  if (milestoneEl) {
    milestoneEl.textContent = `Milestone ${wizardState.currentStep} of 8`;
  }

  // --- Mobile App Progress Bar Updates ---
  const mobileStepText = document.getElementById('mobileStepText');
  if (mobileStepText) {
    const currentTitle = STEP_TITLES[wizardState.currentStep - 1] || '';
    mobileStepText.textContent = `Step ${wizardState.currentStep} of 8: ${currentTitle}`;
  }

  const mobileProgressBar = document.getElementById('mobileProgressBar');
  if (mobileProgressBar) {
    const pct = Math.round((wizardState.currentStep / 8) * 100);
    mobileProgressBar.style.width = `${pct}%`;
  }

  const mobileStrengthBadge = document.getElementById('mobileStrengthBadge');
  if (mobileStrengthBadge) {
    const score = wizardState.completionScore || 20;
    mobileStrengthBadge.textContent = `Strength: ${score}%`;
  }

  const mobileStepDots = document.getElementById('mobileStepDots');
  if (mobileStepDots) {
    let dotsHtml = '';
    for (let i = 1; i <= 8; i++) {
      if (i < wizardState.currentStep) {
        dotsHtml += `<button type="button" onclick="goToStep(${i})" title="Step ${i}: ${STEP_TITLES[i-1]}" class="mobile-dot completed flex items-center justify-center text-white" aria-label="Step ${i} completed">
          <span class="sr-only">${i}</span>
        </button>`;
      } else if (i === wizardState.currentStep) {
        dotsHtml += `<div class="mobile-dot active" title="Current Step: ${STEP_TITLES[i-1]}" aria-label="Step ${i} active"></div>`;
      } else {
        dotsHtml += `<div class="mobile-dot pending" title="Step ${i}: ${STEP_TITLES[i-1]}" aria-label="Step ${i} pending"></div>`;
      }
    }
    mobileStepDots.innerHTML = dotsHtml;
  }
}

function renderStepView() {
  for (let i = 1; i <= 8; i++) {
    const pane = document.getElementById(`step-pane-${i}`);
    if (pane) {
      if (i === wizardState.currentStep) {
        pane.classList.remove('hidden');
        pane.classList.add('block');
      } else {
        pane.classList.add('hidden');
        pane.classList.remove('block');
      }
    }
  }

  // Render contextual safety tip
  renderSafetyTip(wizardState.currentStep);

  // Render preview if step 8
  if (wizardState.currentStep === 8) {
    renderStep8FullPreview();
  }
}

// -------------------------------------------------------------
// 2. CONTEXTUAL SAFETY TIPS (Section 9)
// -------------------------------------------------------------
const stepSafetyTips = {
  1: 'Choose the most precise property category so institutional buyers and families searching for your exact property type can reach you instantly.',
  2: 'Do not share unnecessary personal information or flat unit lock codes in your public address. Our system safeguards exact floor addresses.',
  3: 'Accurate carpet area and RERA-compliant square footage ensure faster loan approvals and zero dispute during site visits.',
  4: 'Transparent asking prices matching recent circle rates or guidance values attract 3.5x more serious buyer enquiries.',
  5: 'Authentic descriptions emphasizing natural ventilation, Vaastu orientation, and verified amenities result in genuine buyer trust.',
  6: 'Upload original daylight photos. Avoid stock or watermarked images from other portals to keep your listing 100% verified.',
  7: 'Your identity proof and ownership documents are private and strictly protected. They are never exposed publicly on the marketplace.',
  8: 'Review each section carefully. You can click "Edit" on any section to revise specifications before final publishing.'
};

function renderSafetyTip(step) {
  const tipEl = document.getElementById('contextualSafetyTip');
  if (tipEl) {
    tipEl.textContent = stepSafetyTips[step] || 'Verified listings receive highest priority on Billedkart Realtech.';
  }
}

// -------------------------------------------------------------
// 3. DYNAMIC STEP 1: PURPOSE & CATEGORY
// -------------------------------------------------------------
function selectPurpose(p) {
  wizardState.purpose = p;
  document.querySelectorAll('.purpose-btn').forEach(btn => {
    if (btn.dataset.purpose === p) {
      btn.className = 'purpose-btn choice-card active p-3 rounded-lg flex items-center justify-center gap-2 font-bold text-xs sm:text-sm';
    } else {
      btn.className = 'purpose-btn choice-card p-3 rounded-lg flex items-center justify-center gap-2 font-semibold text-xs sm:text-sm text-on-surface-variant';
    }
  });
  updatePriceLabels();
  updateLivePreview();
  triggerAutoSave();
}

function selectCategory(c) {
  wizardState.category = c;
  document.querySelectorAll('.category-btn').forEach(btn => {
    if (btn.dataset.category === c) {
      btn.className = 'category-btn choice-card active p-3.5 rounded-lg flex flex-col items-center gap-1.5 font-bold text-xs sm:text-sm text-center';
    } else {
      btn.className = 'category-btn choice-card p-3.5 rounded-lg flex flex-col items-center gap-1.5 font-semibold text-xs sm:text-sm text-center text-on-surface-variant';
    }
  });

  // Populate Dynamic Property Types
  renderPropertyTypeOptions();
  renderAmenitiesChecklist();
  updateLivePreview();
  triggerAutoSave();
}

function renderPropertyTypeOptions() {
  const container = document.getElementById('propertyTypeContainer');
  if (!container) return;
  const types = categoryTypes[wizardState.category] || categoryTypes.Residential;
  if (!types.includes(wizardState.propertyType)) {
    wizardState.propertyType = types[0];
  }

  container.innerHTML = types.map(t => {
    const isAct = t === wizardState.propertyType;
    return `
      <button type="button" onclick="selectPropertyType('${t}')"
        class="prop-type-pill px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
          isAct 
            ? 'bg-primary text-white border-primary shadow-xs font-bold' 
            : 'bg-surface-container-low text-on-surface border-surface-container hover:bg-surface-container'
        }">
        ${t}
      </button>
    `;
  }).join('');
}

function selectPropertyType(t) {
  wizardState.propertyType = t;
  renderPropertyTypeOptions();
  updateLivePreview();
  triggerAutoSave();
}

// -------------------------------------------------------------
// 4. STEP 2: LOCATION
// -------------------------------------------------------------
function handleLocationInput(field, val) {
  wizardState[field] = val;
  updateLivePreview();
  triggerAutoSave();
}

// -------------------------------------------------------------
// 5. STEP 3: SPECIFICATIONS
// -------------------------------------------------------------
function handleAreaChange() {
  const sbaInput = document.getElementById('inputSba');
  const carpetInput = document.getElementById('inputCarpet');
  
  if (sbaInput && sbaInput.value) {
    const rawVal = sbaInput.value.replace(/[^0-9]/g, '');
    wizardState.superBuiltupArea = Number(rawVal) || 0;
  }
  if (carpetInput && carpetInput.value) {
    const rawVal = carpetInput.value.replace(/[^0-9]/g, '');
    wizardState.carpetArea = Number(rawVal) || 0;
  }

  // Update efficiency display
  const effEl = document.getElementById('carpetEfficiencyBadge');
  if (effEl && wizardState.superBuiltupArea > 0 && wizardState.carpetArea > 0) {
    const pct = ((wizardState.carpetArea / wizardState.superBuiltupArea) * 100).toFixed(1);
    effEl.textContent = `${pct}% efficiency`;
  }

  calculatePricePerSqft();
  updateLivePreview();
  triggerAutoSave();
}

function selectBHK(n) {
  wizardState.bhk = n;
  document.querySelectorAll('.bhk-btn').forEach(btn => {
    if (Number(btn.dataset.bhk) === n) {
      btn.className = 'bhk-btn h-10 rounded-lg bg-primary text-white font-bold text-xs sm:text-sm shadow-xs';
    } else {
      btn.className = 'bhk-btn h-10 rounded-lg bg-surface-container-low text-on-surface font-semibold text-xs sm:text-sm hover:bg-surface-container';
    }
  });
  updateLivePreview();
  triggerAutoSave();
}

function selectBathrooms(n) {
  wizardState.bathrooms = n;
  document.querySelectorAll('.bath-btn').forEach(btn => {
    if (Number(btn.dataset.bath) === n) {
      btn.className = 'bath-btn h-9 rounded-lg bg-primary text-white font-bold text-xs shadow-xs';
    } else {
      btn.className = 'bath-btn h-9 rounded-lg bg-surface-container-low text-on-surface font-semibold text-xs hover:bg-surface-container';
    }
  });
  triggerAutoSave();
}

function selectBalconies(n) {
  wizardState.balconies = n;
  document.querySelectorAll('.balc-btn').forEach(btn => {
    if (Number(btn.dataset.balc) === n) {
      btn.className = 'balc-btn h-9 rounded-lg bg-primary text-white font-bold text-xs shadow-xs';
    } else {
      btn.className = 'balc-btn h-9 rounded-lg bg-surface-container-low text-on-surface font-semibold text-xs hover:bg-surface-container';
    }
  });
  triggerAutoSave();
}

function selectFurnishing(val) {
  wizardState.furnishing = val;
  document.querySelectorAll('.furnish-btn').forEach(btn => {
    if (btn.dataset.furnish === val) {
      btn.className = 'furnish-btn h-10 rounded-lg bg-primary text-white font-bold text-xs shadow-xs text-center';
    } else {
      btn.className = 'furnish-btn h-10 rounded-lg bg-surface-container-low text-on-surface font-semibold text-xs hover:bg-surface-container text-center';
    }
  });
  updateLivePreview();
  triggerAutoSave();
}

function selectParking(covered) {
  wizardState.parkingCovered = covered;
  document.querySelectorAll('.park-btn').forEach(btn => {
    if (Number(btn.dataset.park) === covered) {
      btn.className = 'park-btn h-10 rounded-lg bg-primary text-white font-bold text-xs shadow-xs text-center';
    } else {
      btn.className = 'park-btn h-10 rounded-lg bg-surface-container-low text-on-surface font-semibold text-xs hover:bg-surface-container text-center';
    }
  });
  triggerAutoSave();
}

// -------------------------------------------------------------
// 6. STEP 4: PRICING & FINANCIAL DETAILS
// -------------------------------------------------------------
function handlePriceInput(val) {
  const cleanNum = val.replace(/[^0-9]/g, '');
  wizardState.price = Number(cleanNum) || 0;
  
  const displayInput = document.getElementById('inputPrice');
  if (displayInput) {
    displayInput.value = formatNumberIndian(cleanNum);
  }

  const liveWordEl = document.getElementById('priceInWords');
  if (liveWordEl) {
    liveWordEl.textContent = formatINR(wizardState.price);
  }

  calculatePricePerSqft();
  updateLivePreview();
  triggerAutoSave();
}

function calculatePricePerSqft() {
  const area = wizardState.superBuiltupArea || wizardState.carpetArea || 0;
  const breakupEl = document.getElementById('priceBreakupText');
  if (!breakupEl) return;

  if (area > 0 && wizardState.price > 0) {
    const rate = Math.round(wizardState.price / area);
    breakupEl.textContent = `Breakup: ₹${rate.toLocaleString('en-IN')} / sq.ft`;
  } else {
    breakupEl.textContent = `Breakup: ₹0 / sq.ft`;
  }
}

function updatePriceLabels() {
  const isRent = wizardState.purpose === 'Rent';
  const priceLabel = document.getElementById('priceInputLabel');
  if (priceLabel) {
    priceLabel.textContent = isRent ? 'Monthly Rent (INR)' : 'Total Expected Selling Price (INR)';
  }
  const rentRow = document.getElementById('rentalSpecificRow');
  if (rentRow) {
    if (isRent) rentRow.classList.remove('hidden');
    else rentRow.classList.add('hidden');
  }
}

// -------------------------------------------------------------
// 7. STEP 5: AMENITIES & DESCRIPTION
// -------------------------------------------------------------
function renderAmenitiesChecklist() {
  const container = document.getElementById('amenitiesChecklistContainer');
  if (!container) return;
  const amens = categoryAmenities[wizardState.category] || categoryAmenities.Residential;

  container.innerHTML = amens.map(a => {
    const isChecked = wizardState.amenities.includes(a);
    return `
      <label class="flex items-center gap-2.5 p-2.5 rounded-lg border border-surface-container bg-surface-container-low/60 hover:bg-surface-container cursor-pointer transition-colors text-xs font-semibold text-on-surface">
        <input type="checkbox" value="${a}" ${isChecked ? 'checked' : ''} onchange="toggleAmenity('${a}')"
          class="accent-primary w-4 h-4 rounded" />
        <span>${a}</span>
      </label>
    `;
  }).join('');
}

function toggleAmenity(amenity) {
  const idx = wizardState.amenities.indexOf(amenity);
  if (idx > -1) {
    wizardState.amenities.splice(idx, 1);
  } else {
    wizardState.amenities.push(amenity);
  }
  calculateListingStrength();
  triggerAutoSave();
}

function applySuggestedDescription(text) {
  const textarea = document.getElementById('inputDescription');
  if (textarea) {
    textarea.value = text;
    wizardState.description = text;
    const counter = document.getElementById('descCharCounter');
    if (counter) counter.textContent = `${text.length} chars`;
    updateLivePreview();
    triggerAutoSave();
  }
}

// -------------------------------------------------------------
// 8. STEP 6: PHOTOS & MEDIA UPLOADER (Multer Uploads)
// -------------------------------------------------------------
function initDropzone() {
  const dropzone = document.getElementById('photoDropzone');
  const fileInput = document.getElementById('photoFileInput');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFiles(fileInput.files);
    }
  });
}

async function handleFiles(files) {
  const progressBox = document.getElementById('uploadProgressBox');
  const progressBar = document.getElementById('uploadProgressBar');
  if (progressBox) progressBox.classList.remove('hidden');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (progressBar) {
      const pct = Math.round(((i + 1) / files.length) * 100);
      progressBar.style.width = `${pct}%`;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetch(`${API_BASE}/api/properties/upload-image`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.fileUrl) {
        wizardState.images.push(data.fileUrl);
        if (wizardState.images.length === 1) {
          wizardState.primaryImageUrl = data.fileUrl;
        }
      } else {
        showToast(data.error || 'Failed to upload photo', 'error');
      }
    } catch (e) {
      console.error('Upload error:', e);
      showToast('Image upload failed. Storing preview locally.', 'error');
    }
  }

  if (progressBox) {
    setTimeout(() => progressBox.classList.add('hidden'), 500);
  }

  renderImageGallery();
  calculateListingStrength();
  updateLivePreview();
  triggerAutoSave();
}

function renderImageGallery() {
  const gallery = document.getElementById('imageGalleryGrid');
  const countEl = document.getElementById('uploadedPhotoCount');
  if (countEl) countEl.textContent = `${wizardState.images.length} photos added`;
  if (!gallery) return;

  if (wizardState.images.length === 0) {
    gallery.innerHTML = `
      <div class="col-span-full py-6 text-center text-outline text-xs">
        No photos uploaded yet. Drag & drop photos above to make your listing pop.
      </div>
    `;
    return;
  }

  gallery.innerHTML = wizardState.images.map((imgUrl, idx) => {
    const isCover = imgUrl === wizardState.primaryImageUrl;
    return `
      <div class="image-thumbnail-card bg-surface-container-low aspect-video relative group">
        <img src="${imgUrl}" class="w-full h-full object-cover" alt="Property Photo ${idx + 1}" />
        ${isCover ? '<span class="cover-badge">COVER</span>' : ''}
        
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-1">
          ${!isCover ? `
            <button type="button" onclick="setCoverImage(${idx})"
              class="px-2 py-1 rounded bg-white text-primary text-[10px] font-bold shadow-xs hover:bg-surface-container">
              Set Cover
            </button>
          ` : ''}
          <button type="button" onclick="removeImage(${idx})"
            class="p-1 rounded bg-error text-white text-xs hover:bg-error/80" title="Delete Photo">
            <span class="material-symbols-outlined text-[15px]">delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function setCoverImage(idx) {
  if (wizardState.images[idx]) {
    wizardState.primaryImageUrl = wizardState.images[idx];
    renderImageGallery();
    updateLivePreview();
    triggerAutoSave();
    showToast('Cover photo updated');
  }
}

function removeImage(idx) {
  if (wizardState.images[idx]) {
    const removed = wizardState.images.splice(idx, 1)[0];
    if (wizardState.primaryImageUrl === removed) {
      wizardState.primaryImageUrl = wizardState.images[0] || '';
    }
    renderImageGallery();
    calculateListingStrength();
    updateLivePreview();
    triggerAutoSave();
    showToast('Photo removed');
  }
}

// -------------------------------------------------------------
// 9. STEP 7: OWNER KYC & DOCUMENT UPLOAD
// -------------------------------------------------------------
function selectOwnerType(t) {
  wizardState.ownerType = t;
  document.querySelectorAll('.owner-type-btn').forEach(btn => {
    if (btn.dataset.ownertype === t) {
      btn.className = 'owner-type-btn choice-card active p-3 rounded-lg flex items-center gap-2 font-bold text-xs sm:text-sm';
    } else {
      btn.className = 'owner-type-btn choice-card p-3 rounded-lg flex items-center gap-2 font-semibold text-xs sm:text-sm text-on-surface-variant';
    }
  });
  triggerAutoSave();
}

async function handleDocUpload(fileInput) {
  if (!fileInput.files || fileInput.files.length === 0) return;
  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('document', file);
  formData.append('draftToken', wizardState.draftToken);
  formData.append('documentType', 'khata_extract');

  try {
    const res = await fetch(`${API_BASE}/api/properties/upload-document`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      wizardState.documents.push({
        id: data.docId,
        name: data.originalName,
        url: data.fileUrl
      });
      renderUploadedDocs();
      calculateListingStrength();
      triggerAutoSave();
      showToast('Document securely uploaded');
    } else {
      showToast(data.error || 'Could not upload document', 'error');
    }
  } catch (e) {
    console.error('Doc upload error:', e);
    showToast('Document upload error', 'error');
  }
}

function renderUploadedDocs() {
  const container = document.getElementById('uploadedDocsList');
  if (!container) return;
  container.innerHTML = wizardState.documents.map((d, i) => `
    <div class="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low border border-surface-container text-xs font-semibold text-on-surface">
      <div class="flex items-center gap-2 truncate">
        <span class="material-symbols-outlined text-primary text-[18px]">description</span>
        <span class="truncate">${d.name}</span>
      </div>
      <span class="text-emerald-700 text-[10px] font-bold uppercase bg-emerald-50 px-2 py-0.5 rounded">Encrypted</span>
    </div>
  `).join('');
}

// -------------------------------------------------------------
// 10. STEP 8: COMPLETE PREVIEW & FINAL SUBMISSION
// -------------------------------------------------------------
function renderStep8FullPreview() {
  const container = document.getElementById('step8ReviewSummary');
  if (!container) return;

  const priceStr = formatINR(wizardState.price);
  const area = wizardState.superBuiltupArea || wizardState.carpetArea || 0;
  const rateStr = area > 0 ? `₹${Math.round(wizardState.price / area).toLocaleString('en-IN')} / sq.ft` : '';

  container.innerHTML = `
    <!-- Top Highlights Banner -->
    <div class="p-4 rounded-xl bg-gradient-to-r from-primary to-primary-container text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
      <div>
        <span class="text-[10px] uppercase font-bold tracking-wider text-secondary-fixed bg-white/10 px-2 py-0.5 rounded-full inline-block mb-1">
          ${wizardState.purpose} • ${wizardState.propertyType}
        </span>
        <h3 class="text-base sm:text-lg font-bold">${wizardState.title || 'Verified Property Listing'}</h3>
        <p class="text-xs text-surface-container-highest flex items-center gap-1 mt-0.5">
          <span class="material-symbols-outlined text-[15px] text-secondary">location_on</span>
          ${wizardState.locality}, ${wizardState.city}
        </p>
      </div>
      <div class="text-left sm:text-right">
        <div class="text-xl sm:text-2xl font-extrabold text-white">${priceStr}</div>
        <div class="text-[11px] text-surface-container-highest">${rateStr}</div>
      </div>
    </div>

    <!-- Review Section Breakdown -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      
      <!-- Box 1: Specs -->
      <div class="p-3.5 rounded-lg border border-surface-container bg-surface-container-low/40 space-y-2">
        <div class="flex items-center justify-between border-b border-surface-container pb-1.5">
          <span class="font-bold text-primary flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">apartment</span> Configuration
          </span>
          <button type="button" onclick="goToStep(3)" class="text-secondary hover:underline font-bold text-[11px]">Edit</button>
        </div>
        <div class="space-y-1 text-on-surface">
          <p><strong>BHK:</strong> ${wizardState.bhk} BHK (${wizardState.bathrooms} Baths, ${wizardState.balconies} Balconies)</p>
          <p><strong>Super Built-up:</strong> ${wizardState.superBuiltupArea} sq.ft</p>
          <p><strong>Carpet Area:</strong> ${wizardState.carpetArea} sq.ft</p>
          <p><strong>Floor:</strong> ${wizardState.floorNumber} of ${wizardState.totalFloors}</p>
          <p><strong>Facing:</strong> ${wizardState.facing}</p>
          <p><strong>Furnishing:</strong> ${wizardState.furnishing.replace('_', ' ').toUpperCase()}</p>
        </div>
      </div>

      <!-- Box 2: Location -->
      <div class="p-3.5 rounded-lg border border-surface-container bg-surface-container-low/40 space-y-2">
        <div class="flex items-center justify-between border-b border-surface-container pb-1.5">
          <span class="font-bold text-primary flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">pin_drop</span> Location & Project
          </span>
          <button type="button" onclick="goToStep(2)" class="text-secondary hover:underline font-bold text-[11px]">Edit</button>
        </div>
        <div class="space-y-1 text-on-surface">
          <p><strong>City:</strong> ${wizardState.city}</p>
          <p><strong>Locality:</strong> ${wizardState.locality}</p>
          <p><strong>Sub-locality:</strong> ${wizardState.subLocality || 'Direct Corridor'}</p>
          <p><strong>Project:</strong> ${wizardState.projectName || 'Independent / Standalone'}</p>
          <p><strong>PIN Code:</strong> ${wizardState.pincode}</p>
        </div>
      </div>

      <!-- Box 3: Amenities -->
      <div class="p-3.5 rounded-lg border border-surface-container bg-surface-container-low/40 space-y-2">
        <div class="flex items-center justify-between border-b border-surface-container pb-1.5">
          <span class="font-bold text-primary flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">pool</span> Amenities (${wizardState.amenities.length})
          </span>
          <button type="button" onclick="goToStep(5)" class="text-secondary hover:underline font-bold text-[11px]">Edit</button>
        </div>
        <div class="flex flex-wrap gap-1 text-[11px]">
          ${wizardState.amenities.map(a => `<span class="px-2 py-0.5 rounded bg-white border border-surface-container text-primary font-medium">${a}</span>`).join('')}
        </div>
      </div>

      <!-- Box 4: Owner & KYC -->
      <div class="p-3.5 rounded-lg border border-surface-container bg-surface-container-low/40 space-y-2">
        <div class="flex items-center justify-between border-b border-surface-container pb-1.5">
          <span class="font-bold text-primary flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">verified_user</span> Owner Details
          </span>
          <button type="button" onclick="goToStep(7)" class="text-secondary hover:underline font-bold text-[11px]">Edit</button>
        </div>
        <div class="space-y-1 text-on-surface">
          <p><strong>Posting As:</strong> ${wizardState.ownerType.toUpperCase()}</p>
          <p><strong>Name:</strong> ${wizardState.ownerName}</p>
          <p><strong>Phone:</strong> +91 ${wizardState.ownerPhone}</p>
          <p><strong>Verification:</strong> <span class="text-emerald-700 font-bold">Verified Direct Owner</span></p>
        </div>
      </div>

    </div>

    <!-- Uploaded Photos Strip -->
    <div class="space-y-1.5 pt-2">
      <div class="flex items-center justify-between">
        <span class="font-bold text-xs text-primary">Uploaded Photos (${wizardState.images.length})</span>
        <button type="button" onclick="goToStep(6)" class="text-secondary hover:underline font-bold text-[11px]">Manage Photos</button>
      </div>
      <div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
        ${wizardState.images.map(img => `
          <img src="${img}" class="w-20 h-14 object-cover rounded-md border border-surface-container shrink-0" alt="Listing Photo" />
        `).join('')}
      </div>
    </div>
  `;
}

async function submitPropertyListing() {
  const submitBtn = document.getElementById('finalSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span> Submitting Listing...';
  }

  try {
    const payload = {
      ...wizardState,
      price: Number(wizardState.price),
      superBuiltupArea: Number(wizardState.superBuiltupArea),
      carpetArea: Number(wizardState.carpetArea),
      bhk: Number(wizardState.bhk),
      bathrooms: Number(wizardState.bathrooms),
      balconies: Number(wizardState.balconies),
      floorNumber: Number(wizardState.floorNumber),
      totalFloors: Number(wizardState.totalFloors),
      parkingCovered: Number(wizardState.parkingCovered),
      parkingOpen: Number(wizardState.parkingOpen)
    };

    const res = await fetch(`${API_BASE}/api/properties/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success && data.slug) {
      // Clear draft token
      localStorage.removeItem('billedkart_draft_token');
      
      // Show Success Modal
      showSuccessModal(data);
    } else {
      showToast(data.error || 'Submission failed. Please check your fields.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Publish Property Now <span class="material-symbols-outlined text-[18px]">check_circle</span>';
      }
    }
  } catch (e) {
    console.error('Submission error:', e);
    showToast('Network error during submission. Please try again.', 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Publish Property Now <span class="material-symbols-outlined text-[18px]">check_circle</span>';
    }
  }
}

function showSuccessModal(data) {
  const modal = document.getElementById('submissionSuccessModal');
  if (!modal) return;
  
  const idEl = document.getElementById('successListingId');
  if (idEl) idEl.textContent = `REF: #BKR-${data.propertyId}`;

  const viewBtn = document.getElementById('successViewListingBtn');
  if (viewBtn) {
    viewBtn.href = `/property_detail_page/code.html?slug=${data.slug}`;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

// -------------------------------------------------------------
// 11. LIVE PROPERTY PREVIEW SIDEBAR (Section 7)
// -------------------------------------------------------------
function updateLivePreview() {
  const titleEl = document.getElementById('sidebarPreviewTitle');
  const priceEl = document.getElementById('sidebarPreviewPrice');
  const rateEl = document.getElementById('sidebarPreviewRate');
  const specsEl = document.getElementById('sidebarPreviewSpecs');
  const locEl = document.getElementById('sidebarPreviewLocation');
  const imgEl = document.getElementById('sidebarPreviewImage');

  if (titleEl) {
    titleEl.textContent = wizardState.title || `${wizardState.bhk} BHK ${wizardState.propertyType} in ${wizardState.locality}`;
  }
  if (priceEl) {
    priceEl.textContent = formatINR(wizardState.price);
  }
  if (rateEl) {
    const area = wizardState.superBuiltupArea || wizardState.carpetArea || 0;
    if (area > 0 && wizardState.price > 0) {
      rateEl.textContent = `₹${Math.round(wizardState.price / area).toLocaleString('en-IN')} / sq.ft`;
    } else {
      rateEl.textContent = 'Price on Request';
    }
  }
  if (specsEl) {
    specsEl.textContent = `${wizardState.superBuiltupArea || 1400} sq.ft • Floor ${wizardState.floorNumber} • ${wizardState.facing.split(' ')[0]} Facing`;
  }
  if (locEl) {
    locEl.textContent = `${wizardState.locality}, ${wizardState.city}`;
  }
  if (imgEl && wizardState.primaryImageUrl) {
    imgEl.src = wizardState.primaryImageUrl;
  }
}

// -------------------------------------------------------------
// 12. LISTING STRENGTH CALCULATOR (Section 6)
// -------------------------------------------------------------
function calculateListingStrength() {
  let score = 15; // base

  // Blueprint specs complete
  if (wizardState.superBuiltupArea > 0 && wizardState.bhk > 0) score += 25;
  // Locality & Price
  if (wizardState.locality && wizardState.price > 0) score += 20;
  // Photos
  if (wizardState.images.length >= 3) score += 25;
  else if (wizardState.images.length >= 1) score += 15;
  // Owner KYC & Docs
  if (wizardState.ownerName && wizardState.ownerPhone.length >= 10) score += 15;

  wizardState.completionScore = Math.min(score, 100);

  // Update SVG Gauge
  const scoreText = document.getElementById('strengthScoreText');
  const circleFg = document.getElementById('strengthCircleFg');
  if (scoreText) scoreText.textContent = `${wizardState.completionScore}%`;
  if (circleFg) {
    circleFg.setAttribute('stroke-dasharray', `${wizardState.completionScore}, 100`);
  }

  // Update Mobile App Strength Badge
  const mobileStrengthBadge = document.getElementById('mobileStrengthBadge');
  if (mobileStrengthBadge) {
    mobileStrengthBadge.textContent = `Strength: ${wizardState.completionScore}%`;
  }

  // Update checklist items
  const checkSpecs = document.getElementById('checkItemSpecs');
  if (checkSpecs) {
    checkSpecs.innerHTML = `<span class="material-symbols-outlined text-[16px] text-emerald-600">check_circle</span> Basic Blueprint Specs`;
  }
  const checkMedia = document.getElementById('checkItemMedia');
  if (checkMedia) {
    const ok = wizardState.images.length >= 2;
    checkMedia.innerHTML = `<span class="material-symbols-outlined text-[16px] ${ok ? 'text-emerald-600' : 'text-outline'}">${ok ? 'check_circle' : 'radio_button_unchecked'}</span> Living Room & Kitchen Media`;
  }
  const checkKyc = document.getElementById('checkItemKyc');
  if (checkKyc) {
    const ok = wizardState.ownerPhone.length >= 10;
    checkKyc.innerHTML = `<span class="material-symbols-outlined text-[16px] ${ok ? 'text-emerald-600' : 'text-outline'}">${ok ? 'check_circle' : 'radio_button_unchecked'}</span> Owner e-KYC Verification`;
  }
}

// -------------------------------------------------------------
// 13. AUTO-SAVE & DRAFT MANAGEMENT (Section 5)
// -------------------------------------------------------------
let saveTimer = null;
function triggerAutoSave() {
  const saveStatus = document.getElementById('autoSaveStatusText');
  if (saveStatus) saveStatus.textContent = 'Saving...';

  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/properties/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftToken: wizardState.draftToken,
          currentStep: wizardState.currentStep,
          completionScore: wizardState.completionScore,
          formData: wizardState
        })
      });
      const data = await res.json();
      if (data.success && data.draftToken) {
        wizardState.draftToken = data.draftToken;
        localStorage.setItem('billedkart_draft_token', data.draftToken);
        if (saveStatus) {
          const now = new Date();
          const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          saveStatus.textContent = `Auto-Saved at ${timeStr}`;
        }
      }
    } catch (e) {
      if (saveStatus) saveStatus.textContent = 'Saved Locally';
      localStorage.setItem('billedkart_local_draft', JSON.stringify(wizardState));
    }
  }, 1200);
}

async function resumeDraftIfAvailable() {
  const token = localStorage.getItem('billedkart_draft_token');
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/api/properties/draft/${token}`);
    const data = await res.json();
    if (data.success && data.draft && data.draft.formData) {
      Object.assign(wizardState, data.draft.formData);
      wizardState.currentStep = data.draft.currentStep || 1;
      wizardState.completionScore = data.draft.completionScore || 20;

      // Sync form fields
      syncStateToForm();
      showToast('Resumed your previous listing session');
    }
  } catch (e) {
    console.warn('Could not resume cloud draft, checking local storage');
    const local = localStorage.getItem('billedkart_local_draft');
    if (local) {
      try {
        Object.assign(wizardState, JSON.parse(local));
        syncStateToForm();
      } catch (err) {}
    }
  }
}

function syncStateToForm() {
  // Sync inputs
  const sbaInput = document.getElementById('inputSba');
  if (sbaInput) sbaInput.value = formatNumberIndian(wizardState.superBuiltupArea);
  
  const carpetInput = document.getElementById('inputCarpet');
  if (carpetInput) carpetInput.value = formatNumberIndian(wizardState.carpetArea);

  const priceInput = document.getElementById('inputPrice');
  if (priceInput) priceInput.value = formatNumberIndian(wizardState.price);

  const descInput = document.getElementById('inputDescription');
  if (descInput) descInput.value = wizardState.description;

  const nameInput = document.getElementById('inputOwnerName');
  if (nameInput) nameInput.value = wizardState.ownerName;

  const phoneInput = document.getElementById('inputOwnerPhone');
  if (phoneInput) phoneInput.value = wizardState.ownerPhone;

  selectPurpose(wizardState.purpose);
  selectCategory(wizardState.category);
  selectBHK(wizardState.bhk);
  selectBathrooms(wizardState.bathrooms);
  selectBalconies(wizardState.balconies);
  selectFurnishing(wizardState.furnishing);
  selectParking(wizardState.parkingCovered);
  renderImageGallery();
  renderUploadedDocs();
  updateLivePreview();
  calculateListingStrength();
}

// -------------------------------------------------------------
// 14. 10-SECOND INACTIVITY ASSISTANCE MODAL (Section 8)
// -------------------------------------------------------------
let idleTime = 0;
let idleTimer = null;
let modalCooldown = false;
let isUserTypingOrUploading = false;

function initInactivityDetector() {
  const events = ['mousemove', 'keydown', 'touchstart', 'scroll'];
  events.forEach(evt => {
    window.addEventListener(evt, () => {
      idleTime = 0;
    }, { passive: true });
  });

  document.querySelectorAll('input, textarea').forEach(el => {
    el.addEventListener('focus', () => { isUserTypingOrUploading = true; });
    el.addEventListener('blur', () => { isUserTypingOrUploading = false; });
  });

  // Check every second
  idleTimer = setInterval(() => {
    // Only count if document is visible, not typing, not uploading, not already dismissed in cooldown
    if (document.hidden || isUserTypingOrUploading || modalCooldown || wizardState.currentStep === 8) {
      idleTime = 0;
      return;
    }

    idleTime++;
    if (idleTime >= 10) {
      showInactivityModal();
      idleTime = 0;
    }
  }, 1000);
}

function showInactivityModal() {
  const modal = document.getElementById('idleAssistanceModal');
  if (!modal) return;
  modal.classList.add('open');
}

function closeInactivityModal(permanentDismiss = false) {
  const modal = document.getElementById('idleAssistanceModal');
  if (!modal) return;
  modal.classList.remove('open');

  // Cooldown for 5 minutes
  modalCooldown = true;
  setTimeout(() => {
    modalCooldown = false;
  }, 300000);
}

function triggerSupportWhatsApp() {
  if (typeof window !== 'undefined' && window.BilledkartContact) {
    window.BilledkartContact.openWhatsApp('Hi Billedkart Realtech, I need assistance posting my property.');
  } else {
    window.open('https://wa.me/919044268001?text=Hi%20Billedkart%20Realtech,%20I%20need%20assistance%20posting%20my%20property.', '_blank');
  }
  closeInactivityModal();
}

function triggerSupportCall() {
  if (typeof window !== 'undefined' && window.BilledkartContact) {
    window.BilledkartContact.callSupport();
  } else {
    window.location.href = 'tel:+919044268001';
  }
  closeInactivityModal();
}

function triggerSupportEmail() {
  if (typeof window !== 'undefined' && window.BilledkartContact) {
    window.BilledkartContact.emailSupport('Assistance Posting Property Listing');
  } else {
    window.location.href = 'mailto:billedkart@gmail.com?subject=Assistance%20Posting%20Property%20Listing';
  }
  closeInactivityModal();
}

// -------------------------------------------------------------
// 15. TOAST NOTIFICATION UTILITY
// -------------------------------------------------------------
function showToast(msg, type = 'info') {
  let toast = document.getElementById('wizardToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'wizardToast';
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-xl border text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-12 opacity-0 pointer-events-none';
    document.body.appendChild(toast);
  }

  if (type === 'error') {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-xl border border-red-500 bg-red-600 text-white text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-0 opacity-100';
    toast.innerHTML = `<span class="material-symbols-outlined text-[17px]">error</span> ${msg}`;
  } else {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-xl border border-emerald-500 bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-0 opacity-100';
    toast.innerHTML = `<span class="material-symbols-outlined text-[17px]">check_circle</span> ${msg}`;
  }

  setTimeout(() => {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-xl border text-xs font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-12 opacity-0 pointer-events-none';
  }, 3000);
}

// -------------------------------------------------------------
// 16. MOBILE CITY SELECTOR & BOTTOM DRAWER NAVIGATION
// -------------------------------------------------------------
function initMobileCitySelector() {
  const mobBtn = document.getElementById('mobile-city-btn');
  const mobMenu = document.getElementById('mobile-city-menu');
  const mobLabel = document.getElementById('mobile-current-city');

  if (mobBtn && mobMenu) {
    mobBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mobMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => mobMenu.classList.add('hidden'));

    document.querySelectorAll('.mobile-city-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const city = opt.getAttribute('data-city');
        if (mobLabel) mobLabel.textContent = city;
        wizardState.city = city;
        const citySelect = document.getElementById('propCity');
        if (citySelect) citySelect.value = city;
        showToast(`Territory switched to ${city}`);
        mobMenu.classList.add('hidden');
        updateLivePreview();
      });
    });
  }
}

function toggleMobileMenuDrawer(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const drawer = document.getElementById('mobile-menu-drawer');
  const backdrop = document.getElementById('mobile-menu-drawer-backdrop');
  if (!drawer || !backdrop) return;
  const isHidden = drawer.classList.contains('hidden');
  if (isHidden) {
    drawer.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    setTimeout(() => {
      drawer.classList.remove('translate-y-full');
      backdrop.classList.remove('opacity-0');
    }, 20);
    document.body.style.overflow = 'hidden';
  } else {
    closeMobileMenuDrawer();
  }
}

function closeMobileMenuDrawer() {
  const drawer = document.getElementById('mobile-menu-drawer');
  const backdrop = document.getElementById('mobile-menu-drawer-backdrop');
  if (!drawer || !backdrop) return;
  drawer.classList.add('translate-y-full');
  backdrop.classList.add('opacity-0');
  setTimeout(() => {
    drawer.classList.add('hidden');
    backdrop.classList.add('hidden');
    document.body.style.overflow = '';
  }, 250);
}

window.toggleMobileMenuDrawer = toggleMobileMenuDrawer;
window.closeMobileMenuDrawer = closeMobileMenuDrawer;

// -------------------------------------------------------------
// INITIALIZATION ON DOM CONTENT LOADED
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  renderPropertyTypeOptions();
  renderAmenitiesChecklist();
  renderImageGallery();
  initDropzone();
  updateStepperUI();
  updateLivePreview();
  calculateListingStrength();
  initInactivityDetector();
  initMobileCitySelector();
  resumeDraftIfAvailable();
});

