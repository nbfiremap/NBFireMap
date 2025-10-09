/**
 * Fire Data Management Module
 * Handles all fire-related data processing, status management, and marker creation
 */

window.NBFireMapFireDataManager = (() => {
  'use strict';

  // Import utilities
  const { norm, fmtDateTime, escHTML, ATLANTIC_TZ, sameYMD, ymdInTz } = window.NBFireMapUtils;

  // ---- Internal State & Storage ----------------------------------------
  const fireStore = new Map();
  
  // GNB Fire Activity Summary data store
  let gnbFireActivityData = null;
  
  // Store the full GNB data including metadata
  let gnbFullData = null;
  
  // ERD Fire Locations data store for fire cause information
  let erdFireLocationsData = null;
  
  // Load GNB fire activity data
  async function loadGNBFireActivityData() {
    if (gnbFireActivityData !== null) return gnbFireActivityData;
    try {
      const response = await fetch('GNBfireActSum.json', { cache: 'no-store' });
      const data = await response.json();
      gnbFullData = data; // Store full data for timestamp access
      gnbFireActivityData = data?.tables?.[0]?.rows || [];
      console.log(`Loaded ${gnbFireActivityData.length} GNB fire activity records`);
      return gnbFireActivityData;
    } catch (error) {
      console.warn('Failed to load GNB fire activity data:', error);
      gnbFireActivityData = [];
      gnbFullData = null;
      return [];
    }
  }
  
  // Load ERD fire locations data for fire cause information
  async function loadERDFireLocationsData() {
    if (erdFireLocationsData !== null) return erdFireLocationsData;
    try {
      const response = await fetch('erd_fire_locations.geojson', { cache: 'no-store' });
      const data = await response.json();
      // Create a map for quick lookups by FIELD_AGENCY_FIRE_ID
      erdFireLocationsData = new Map();
      if (data?.features && Array.isArray(data.features)) {
        data.features.forEach(feature => {
          const props = feature.properties;
          if (props?.FIELD_AGENCY_FIRE_ID) {
            erdFireLocationsData.set(props.FIELD_AGENCY_FIRE_ID, props);
          }
        });
      }
      console.log(`Loaded ${erdFireLocationsData.size} ERD fire location records`);
      return erdFireLocationsData;
    } catch (error) {
      console.warn('Failed to load ERD fire locations data:', error);
      erdFireLocationsData = new Map();
      return erdFireLocationsData;
    }
  }
  
  // Match fire with GNB activity data
  function findGNBFireActivity(fireProps) {
    if (!gnbFireActivityData || !Array.isArray(gnbFireActivityData)) return null;
    
    const fireNumber = fireProps?.FIRE_NUMBER_SHORT || fireProps?.FIRE_NUMBER || fireProps?.FIRE_ID || fireProps?.ID;
    const fireName = fireProps?.FIRE_NAME || fireProps?.NAME;
    
    if (!fireNumber && !fireName) return null;
    
    // Try to match by fire number first (most reliable)
    if (fireNumber) {
      const match = gnbFireActivityData.find(row => 
        row.Number && row.Number.toString() === fireNumber.toString()
      );
      if (match) return match;
    }
    
    // Try to match by fire name if no number match
    if (fireName && fireName !== 'Unnamed Fire') {
      const match = gnbFireActivityData.find(row => 
        row['Fire Name'] && row['Fire Name'].toLowerCase().includes(fireName.toLowerCase())
      );
      if (match) return match;
    }
    
    return null;
  }
  
  // Match fire with ERD fire locations data to get fire cause
  function findERDFireLocation(fireProps) {
    if (!erdFireLocationsData || erdFireLocationsData.size === 0) return null;
    
    const objectId = fireProps?.OBJECTID || fireProps?.ID;
    
    if (!objectId) return null;
    
    // Try to match by OBJECTID = FIELD_AGENCY_FIRE_ID
    return erdFireLocationsData.get(objectId) || null;
  }
  
  // Remove French translation and (Final) designations for clean display
  function cleanFireCause(cause) {
    if (!cause || typeof cause !== 'string') return null;
    
    // Remove leading/trailing whitespace
    const cleaned = cause.trim();
    
    // Return null if empty or just contains "/"
    if (!cleaned || cleaned === '/' || cleaned === ' / ') return null;
    
    // Remove French translation (everything after and including " / ")
    let englishOnly = cleaned.split(' / ')[0].trim();
    
    // Remove (Final) designation from the cause
    englishOnly = englishOnly.replace(/\s*\(Final\)\s*$/i, '').trim();
    
    return englishOnly || null;
  }
  
  // ---- Fire Status & Color Management -----------------------------------
  
  /**
   * Get CSS custom property value
   */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /**
   * Fire status colors mapped from CSS variables
   */
  const COLORS = {
    oc: cssVar('--oc'), 
    mon: cssVar('--mon'), 
    cont: cssVar('--cont'),
    uc: cssVar('--uc'), 
    pat: cssVar('--pat'),
    perimeter: cssVar('--perimeter'), 
    boundary: cssVar('--boundary'),
    modis: cssVar('--modis'),
  };

  /**
   * Fire status configuration with colors and severity rankings
   */
  const STATUS = new Map([
    ['out of control', { color: COLORS.oc,  sev: 4 }],
    ['being monitored',{ color: COLORS.mon, sev: 3 }],
    ['contained',      { color: COLORS.cont, sev: 2 }],
    ['under control',  { color: COLORS.uc,   sev: 1 }],
    ['being patrolled',{ color: COLORS.pat,  sev: 0 }],
    ['extinguished',   { color: '#0000FF',   sev: -1 }],
  ]);

  /**
   * Get status color for a fire status
   */
  const getStatusColor = (status) => STATUS.get(norm(status))?.color ?? '#0000FF';
  
  /**
   * Get severity ranking for a fire status (higher = more severe)
   */
  const getSeverityRank = (status) => STATUS.get(norm(status))?.sev ?? -1;

  // ---- Property Extraction Helpers --------------------------------------



  /**
   * Clamp number to 0-100 range for percentages
   */
  const clamp01 = (n) => Math.max(0, Math.min(100, n));

  /**
   * Parse maybe number from string or number
   */
  const parseMaybeNumber = (v) => { 
    if (v == null) return null; 
    const n = Number(v); 
    if (Number.isFinite(n)) return n; 
    const m = String(v).match(/-?\d+(\.\d+)?/); 
    return m ? Number(m[0]) : null; 
  };

  /**
   * Get containment percentage from fire properties
   */
  const getContainPct = (p) => {
    const [, v] = firstProp(p, ['PCT_CONTAINED','PERCENT_CONTAINED','CONTAINMENT_PCT','CONTAINED_PCT','PCTCONTAINED','CONTAINMENT','CONTAINMENT_PERCENT']);
    const num = parseMaybeNumber(v); 
    return num == null ? null : clamp01(num);
  };

  /**
   * Get retrieved/fetched information from fire properties
   */
  const getRetrievedInfo = (p) => {
    const [, v] = firstProp(p, ['FETCHED_FROM_ERD','FETCHED_FROM_GNB','GNB_FETCHED','GNB_RETRIEVED_AT','RETRIEVED_FROM_GNB','FETCHED_AT','FETCH_TIMESTAMP','SOURCE_FETCHED_AT','ERD_FETCHED_AT']);
    if (v == null) return { ms:null, bool:null, raw:null };
    const ms = parseDateFlexible(v); 
    if (ms != null) return { ms, bool:null, raw:v };
    const sv = String(v).trim().toLowerCase();
    if (typeof v === 'boolean' || ['true','yes','y','1'].includes(sv))  return { ms:null, bool:true,  raw:v };
    if (['false','no','n','0'].includes(sv))                           return { ms:null, bool:false, raw:v };
    return { ms:null, bool:null, raw:v };
  };

  // ---- Date & Time Parsing ----------------------------------------------

  /**
   * Parse flexible date format (imported from existing logic)
   */
  function parseDateFlexible(val) {
    if (!val) return null;
    if (val instanceof Date) return val.getTime();
    
    if (typeof val === 'number') {
      // If the number is less than a reasonable threshold, assume it's in seconds and convert to milliseconds
      // Timestamps after year 2000 in milliseconds are > 946684800000, in seconds are > 946684800
      return val < 1e12 ? val * 1000 : val;
    }
    
    const str = String(val).trim();
    if (!str || str.toLowerCase() === 'null') return null;
    
    // Try parsing as ISO date or timestamp
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  /**
   * Get first available property from an object
   */
  function firstProp(obj, keys) {
    for (const key of keys) {
      if (obj && obj.hasOwnProperty(key)) {
        return [key, obj[key]];
      }
    }
    return [null, null];
  }

  /**
   * Extract fire detection timestamp from properties
   */
  const getDetectedMs = (props) => {
    const dateKeys = ['TIME_DETECTED','DATE_DETECTED','DETECTED','FIRE_START_DATE','START_DATE'];
    for (const key of dateKeys) {
      const ms = parseDateFlexible(props?.[key]);
      if (ms != null) return ms;
    }
    return null;
  };

  /**
   * Extract fire extinguished timestamp from properties
   */
  const getExtinguishedMs = (props) => {
    const dateKeys = ['FIRE_OUT_DATE','OUT_DATE','DATE_OUT','DATE_EXTINGUISHED','OUT_TIME','EXTINGUISHED','FIRE_STAT_DATE'];
    for (const key of dateKeys) {
      const ms = parseDateFlexible(props?.[key]);
      if (ms != null) return ms;
    }
    return null;
  };

  /**
   * Check if timestamp is today
   */
  const isToday = (ms, tz = ATLANTIC_TZ) => sameYMD(ms, Date.now(), tz);
  
  /**
   * Check if timestamp is yesterday
   */
  const isYesterday = (ms, tz = ATLANTIC_TZ) => {
    if (ms == null) return false;
    const a = ymdInTz(ms, tz);
    const aUTC = Date.UTC(a.y, a.m - 1, a.d);
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const b = ymdInTz(yesterday, tz);
    const bUTC = Date.UTC(b.y, b.m - 1, b.d);
    return aUTC === bUTC;
  };

  // ---- Fire Property Extraction ----------------------------------------

  /**
   * Get fire size/area from properties (handles multiple field names)
   */
  const getFireSize = (props) => Number((props?.FIRE_SIZE ?? props?.SIZE_HA ?? props?.AREA) ?? 0) || 0;

  /**
   * Get fire ID from properties (handles multiple field names)
   */
  const getFireId = (props) => {
    return props?.FIRE_ID || props?.FIRE_NUMBER || props?.ID || props?.OBJECTID || 'unknown';
  };

  /**
   * Get fire name from properties
   */
  const getFireName = (props) => {
    return props?.FIRE_NAME || props?.NAME || 'Unnamed Fire';
  };

  /**
   * Get fire location from properties
   */
  const getFireLocation = (props) => {
    return props?.FIRE_LOCTN || props?.LOCATION || props?.PLACE || 'Unknown Location';
  };

  // ---- Fire Marker Creation & Management --------------------------------

  /**
   * Create fire popup content HTML
   */
  async function createFirePopupContent(props, explicitStatus, isOutFire = false) {
    // Ensure both GNB data and ERD fire locations data are loaded
    await Promise.all([loadGNBFireActivityData(), loadERDFireLocationsData()]);
    const status = explicitStatus || props.FIRE_STAT_DESC_E || 'Unknown';
    const name = getFireName(props);
    const id = getFireId(props);
    const shortId = props.FIRE_NUMBER_SHORT || id;
    const size = getFireSize(props);
    
    // Calculate contained percentage - show for active fires, hide for out fires
    const pct = getContainPct(props);
    const pctStr = pct != null ? `${Math.round(pct)}%` : '—';
    const showContained = !isOutFire; // Show containment for active fires only
    
    // Try to match with GNB fire activity data
    const gnbActivity = findGNBFireActivity(props);
    
    // Try to match with ERD fire locations data for fire cause
    const erdLocation = findERDFireLocation(props);
    
    // Get retrieved information - use GNB timestamp when there's a match, otherwise ERD
    let retrievedStr;
    if (gnbActivity && gnbFullData?.fetched_utc) {
      // Use GNB fetched timestamp when we have activity data for this fire
      retrievedStr = fmtDateTime(gnbFullData.fetched_utc * 1000); // Convert Unix timestamp to milliseconds
      console.log('Using GNB timestamp:', gnbFullData.fetched_utc, 'formatted:', retrievedStr);
    } else {
      // Fall back to ERD retrieved info
      const retrieved = getRetrievedInfo(props);
      retrievedStr = (retrieved.ms != null)
        ? fmtDateTime(retrieved.ms)
        : (retrieved.bool != null ? (retrieved.bool ? 'Yes' : 'No') : (retrieved.raw ?? '—'));
      console.log('Using ERD timestamp:', retrievedStr);
    }
    
    // Determine appropriate date field and label
    const extinguishedMs = getExtinguishedMs(props);
    const detectedMs = getDetectedMs(props);
    const statusDate = props.FIRE_STAT_DATE ? parseDateFlexible(props.FIRE_STAT_DATE) : null;
    
    let dateLabel = isOutFire ? 'Extinguished' : 'Updated by ERD';
    let dateValue = statusDate;
    
    // For out fires, prefer extinguished date if available, otherwise fall back to status date
    if (isOutFire && extinguishedMs) {
      dateValue = extinguishedMs;
    }
    
    // Build GNB activity section if available
    let gnbActivityHTML = '';
    if (gnbActivity) {
      const resources = [];
      const pers = parseInt(gnbActivity.Pers);
      const eng = parseInt(gnbActivity.Eng);
      const tend = parseInt(gnbActivity.Tend);
      const trac = parseInt(gnbActivity.Trac);
      const air = parseInt(gnbActivity.Air);
      const heli = parseInt(gnbActivity.Heli);
      const ovr = parseInt(gnbActivity.Ovr);
      
      if (pers > 0) resources.push(`${pers} Firefighter${pers > 1 ? 's' : ''}`);
      if (eng > 0) resources.push(`${eng} Engine${eng > 1 ? 's' : ''}`);
      if (tend > 0) resources.push(`${tend} Tender${tend > 1 ? 's' : ''}`);
      if (trac > 0) resources.push(`${trac} Tractor${trac > 1 ? 's' : ''}`);
      if (air > 0) resources.push(`${air} Air Tanker${air > 1 ? 's' : ''}`);
      if (heli > 0) resources.push(`${heli} Helicopter${heli > 1 ? 's' : ''}`);
      if (ovr > 0) resources.push(`${ovr} Overhead`);
      
      if (resources.length > 0) {
        gnbActivityHTML = `
          <div style="margin-top:4px;padding:4px 6px;background-color:#fff3cd;border:1px solid #ffeaa7;border-radius:3px">
            <div style="font-size:10px;line-height:1.2;color:#333">
              <strong style="color:#856404">Resources:</strong> ${resources.join(' • ')}
            </div>
          </div>
        `;
      }
    }
    
    return `
      <div class="fire-popup">
        <div class="popup-header" style="font-size:16px;font-weight:700;color:#333;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #eee">
          #${escHTML(shortId)} ${escHTML(name)}
        </div>
        <div class="popup-body" style="font-size:13px;line-height:1.4">
          <div style="margin-bottom:6px">
            <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:12px;background:#f8f9fa;border:1px solid #dee2e6;font-weight:600;font-size:12px">
              <span class="dot" style="background:${getStatusColor(status)};width:8px;height:8px;border-radius:50%;display:inline-block"></span>${escHTML(status)}
            </span>
          </div>
          <div style="margin-bottom:4px"><b>Area:</b> ${size.toFixed(1)} ha</div>
          ${showContained ? `<div style="margin-bottom:4px"><b>Contained:</b> ${pctStr}</div>` : ''}
          ${(() => {
            const cleanedCause = cleanFireCause(erdLocation?.FIELD_AGENCY_FIRE_CAUSE);
            return cleanedCause ? `<div style="margin-bottom:4px"><b>Cause:</b> ${escHTML(cleanedCause)}</div>` : '';
          })()}
          ${detectedMs ? `<div style="margin-bottom:4px"><b>Detected:</b> ${fmtDateTime(detectedMs)}</div>` : ''}
          ${dateValue ? `<div style="margin-bottom:4px"><b>${dateLabel}:</b> ${fmtDateTime(dateValue)}</div>` : ''}
          ${gnbActivityHTML}
          <div style="margin-top:8px;padding:6px 8px;background-color:#f8f9fa;border-radius:4px;font-size:11px;color:#6c757d;text-align:center;font-style:italic">
            Downloaded from ERD • ${retrievedStr}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Bind popup to fire marker and store in fire registry
   */
  function bindFirePopup(props, layer, explicitStatus, isOutFire = false) {
    // Create popup with loading placeholder and async update
    layer.bindPopup('Loading...', { 
      maxWidth: 240, 
      minWidth: 200,
      maxHeight: 350,
      className: 'fire-popup-container',
      autoPan: true,
      autoPanPaddingTopLeft: [80, 80], // Account for left controls and header
      autoPanPaddingBottomRight: [80, 70], // Account for right edge and bottom controls
      keepInView: true
    });
    
    // Update popup content when opened
    layer.on('popupopen', async () => {
      const content = await createFirePopupContent(props, explicitStatus, isOutFire);
      layer.setPopupContent(content);
    });
    
    // Store fire data in registry
    const id = getFireId(props);
    fireStore.set(id, { 
      id, 
      props, 
      latlng: layer.getLatLng(), 
      layer, 
      statusKey: layer.options._statusKey 
    });
  }

  /**
   * Create a fire marker with proper styling and popup
   */
  function createFireMarker(props, coords, explicitStatus, isOutFire = false) {
    const [lng, lat] = coords; // GeoJSON coordinate order
    const statusKey = norm(explicitStatus || props.FIRE_STAT_DESC_E || '—');
    
    const marker = L.marker([lat, lng], {
      pane: 'firesPane',
      icon: L.divIcon({
        className: 'fire-badge-icon',
        html: `<div class="marker-badge" style="--ring:${getStatusColor(statusKey)}"><i class="fa-solid fa-fire"></i></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 19],
        popupAnchor: [0, -15]
      }),
      keyboard: false
    });
    
    // Store metadata on marker for filtering and clustering
    marker.options._statusKey = statusKey;
    marker.options._severity = getSeverityRank(statusKey);
    marker.options._area = getFireSize(props);  // Store fire area for cluster positioning
    
    // Bind popup and register fire
    bindFirePopup(props, marker, explicitStatus, isOutFire);
    
    return marker;
  }

  // ---- Fire Data Processing & Analysis ----------------------------------

  /**
   * Process GeoJSON fire data into markers
   */
  function processFireGeoJSON(geoJsonData, defaultStatus = null, isOutFire = false) {
    const markers = [];
    
    if (!geoJsonData?.features) return markers;
    
    geoJsonData.features.forEach(feature => {
      if (!feature || feature.geometry?.type !== 'Point') return;
      
      const props = feature.properties || {};
      const coords = feature.geometry.coordinates;
      const status = defaultStatus || props.FIRE_STAT_DESC_E;
      
      const marker = createFireMarker(props, coords, status, isOutFire);
      markers.push(marker);
    });
    
    return markers;
  }

  /**
   * Get fire statistics from current fire store
   */
  function getFireStatistics() {
    const items = [...fireStore.values()];
    const stats = {
      total: items.length,
      totalArea: 0,
      byStatus: {
        'out of control': 0,
        'being monitored': 0,
        'contained': 0,
        'under control': 0,
        'being patrolled': 0,
        'extinguished': 0,
        'other': 0
      },
      today: { detected: 0, extinguished: 0 },
      yesterday: { detected: 0, extinguished: 0 },
      active: 0,
      extinguished: 0
    };

    items.forEach(item => {
      const props = item.props || {};
      const statusKey = norm(item.statusKey || props.FIRE_STAT_DESC_E || '');
      
      // Size
      stats.totalArea += getFireSize(props);
      
      // Status counts
      if (statusKey in stats.byStatus) {
        stats.byStatus[statusKey]++;
      } else {
        stats.byStatus.other++;
      }
      
      // Active vs extinguished
      if (statusKey === 'extinguished') {
        stats.extinguished++;
      } else {
        stats.active++;
      }
      
      // Date-based counts
      const detectedMs = getDetectedMs(props);
      const extinguishedMs = getExtinguishedMs(props);
      
      if (detectedMs) {
        if (isToday(detectedMs)) stats.today.detected++;
        else if (isYesterday(detectedMs)) stats.yesterday.detected++;
      }
      
      if (extinguishedMs && statusKey === 'extinguished') {
        if (isToday(extinguishedMs)) stats.today.extinguished++;
        else if (isYesterday(extinguishedMs)) stats.yesterday.extinguished++;
      }
    });

    return stats;
  }

  /**
   * Filter fires by status
   */
  function filterFiresByStatus(statusList) {
    const normalizedStatuses = statusList.map(norm);
    
    return [...fireStore.values()].filter(item => {
      const statusKey = norm(item.statusKey || item.props?.FIRE_STAT_DESC_E || '');
      return normalizedStatuses.includes(statusKey);
    });
  }

  /**
   * Find fires within radius of a point
   */
  function findFiresNearPoint(lat, lng, radiusKm = 50) {
    const center = L.latLng(lat, lng);
    const results = [];
    
    fireStore.forEach(fire => {
      const distance = center.distanceTo(fire.latlng) / 1000; // Convert to km
      if (distance <= radiusKm) {
        results.push({
          ...fire,
          distance: distance
        });
      }
    });
    
    return results.sort((a, b) => a.distance - b.distance);
  }

  // ---- Fire Cause Statistics -----------------------------------------------
  
  /**
   * Get fire cause statistics for all fires
   */
  async function getFireCauseStatistics() {
    // Ensure ERD data is loaded
    await loadERDFireLocationsData();
    
    const causeStats = new Map();
    let totalWithCause = 0;
    let totalFires = 0;
    
    for (const fire of fireStore.values()) {
      totalFires++;
      const erdLocation = findERDFireLocation(fire.props);
      const cleanedCause = cleanFireCause(erdLocation?.FIELD_AGENCY_FIRE_CAUSE);
      
      // Show actual cause data as-is, or indicate when no data is available
      let cause;
      if (cleanedCause) {
        cause = cleanedCause;
        // Only count as "with cause" if it's not Unknown - treat Unknown as no meaningful data
        if (!cause.toLowerCase().includes('unknown')) {
          totalWithCause++;
        }
      } else {
        // No cause data available
        cause = 'No cause data';
      }
      
      causeStats.set(cause, (causeStats.get(cause) || 0) + 1);
    }
    
    return {
      causeStats,
      totalWithCause,
      totalFires,
      coveragePercent: totalFires > 0 ? (totalWithCause / totalFires) * 100 : 0
    };
  }

  // ---- Public API -------------------------------------------------------

  return {
    // Core fire store
    getFireStore: () => fireStore,
    clearFireStore: () => fireStore.clear(),
    
    // Status and color functions
    getStatusColor,
    getSeverityRank,
    
    // Property extraction
    getFireSize,
    getFireId, 
    getFireName,
    getFireLocation,
    getDetectedMs,
    getExtinguishedMs,
    
    // Date helpers
    isToday,
    isYesterday,
    
    // Marker creation
    createFireMarker,
    bindFirePopup,
    processFireGeoJSON,
    
    // Data analysis
    getFireStatistics,
    filterFiresByStatus,
    findFiresNearPoint,
    
    // GNB activity data
    loadGNBFireActivityData,
    findGNBFireActivity,
    
    // ERD fire locations data
    loadERDFireLocationsData,
    findERDFireLocation,
    cleanFireCause,
    
    // Fire cause analysis
    getFireCauseStatistics,
    
    // Status configuration
    getStatusConfig: () => STATUS,
    getColorConfig: () => COLORS
  };
  
  // Initialize GNB fire activity data loading and ERD fire locations data loading
  loadGNBFireActivityData();
  loadERDFireLocationsData();
})();