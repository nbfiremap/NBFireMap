/**
 * Data Loading Services Module
 * Handles all external API data fetching and local file loading
 */

window.NBFireMapDataLoadingManager = (() => {
  'use strict';

  // ---- Internal State ---------------------------------------------------
  let isInitialized = false;
  let loadingStates = {
    ferries: false,
    webcams: false,
    events: false,
    winterRoads: false,
    openSky: false
  };

  // ---- Utility Functions ------------------------------------------------

  /**
   * Smart local file fetcher with fallback attempts
   */
  async function fetchLocalAny(base) {
    // Smart extension selection - fires are .geojson, other data is .json
    const fireFiles = ['active_fires', 'out_fires', 'erd_fire_locations'];
    const isFireFile = fireFiles.includes(base);
    
    const attempts = isFireFile ? [
      `${base}.geojson`, `./${base}.geojson`,
      `data/${base}.geojson`, `./data/${base}.geojson`,
      `${base}.json`, `./${base}.json`,
      `data/${base}.json`, `./data/${base}.json`,
    ] : [
      `${base}.json`, `./${base}.json`,
      `data/${base}.json`, `./data/${base}.json`,
      `${base}.geojson`, `./${base}.geojson`,
      `data/${base}.geojson`, `./data/${base}.geojson`,
    ];
    
    for (const url of attempts) {
      try { 
        const r = await fetch(url, { cache: 'no-store' }); 
        if (r.ok) return await r.json(); 
      } catch {}
    }
    return null;
  }

  /**
   * Generic API fetch with error handling
   */
  async function fetchWithRetry(url, options = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url, { cache: 'no-store', ...options });
        if (response.ok) {
          return await response.json();
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        if (i === retries) {
          console.warn(`Failed to fetch ${url} after ${retries + 1} attempts:`, error);
          throw error;
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  // ---- Icon Creation Functions ------------------------------------------

  /**
   * Create ferry terminal icon using Font Awesome styling
   */
  function createFerryIcon(color = '#27ae60') {
    return L.divIcon({
      className: 'ferry-badge-icon',
      html: `<div class="marker-badge" style="--ring:${color}"><i class="fa-solid fa-ferry"></i></div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 26],
      popupAnchor: [0, -22]
    });
  }

  /**
   * Create webcam icon using Font Awesome styling
   */
  function createWebcamIcon(color = '#1f6feb') {
    return L.divIcon({
      className: 'webcam-badge-icon',
      html: `<div class="marker-badge" style="--ring:${color}"><i class="fa-solid fa-camera"></i></div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 26],
      popupAnchor: [0, -22]
    });
  }

  /**
   * Create Font Awesome icon for road events using square markers
   */
  function createEventIcon(event) {
    const startDate = event.StartDate ? event.StartDate * 1000 : null; // Convert to milliseconds
    const color = getColorForType(event.EventType, event.EventSubType, event.IsFullClosure, startDate);
    const severity = event.Severity || 'None';
    const severityStyle = SEVERITY_STYLES[severity] || SEVERITY_STYLES.default;
    
    // Choose appropriate Font Awesome icon based on event category
    const getIconClass = () => {
      const category = getEventCategory(event.EventType, event.EventSubType, startDate);
      
      // All closures (current and future) use prohibition sign
      if (category === 'closures' || category === 'futureClosures') {
        return 'fa-solid fa-ban';
      }
      
      // Incidents use exclamation mark
      if (category === 'incidents') {
        return 'fa-solid fa-triangle-exclamation';
      }
      
      // Construction (current and future) uses construction pylon
      if (category === 'construction' || category === 'futureConstruction') {
        return 'fa-solid fa-person-digging';
      }
      
      // Flooding uses water/wave icon
      if (category === 'flooding') {
        return 'fa-solid fa-water';
      }
      
      // Default road icon
      return 'fa-solid fa-road';
    };
    
    const iconClass = getIconClass();
    const size = 28; // Match fire marker size for consistency
    const weight = event.IsFullClosure ? 3 : 2; // Only full closures get thicker border
    
    return L.divIcon({
      className: 'event-badge-icon',
      html: `<div class="event-marker-square" style="--color:${color}; --size:${size}px; --weight:${weight}px;"><i class="${iconClass}"></i></div>`,
      iconSize: [size + 10, size + 10], // Add padding like fire markers
      iconAnchor: [(size + 10) / 2, (size + 10) / 2],
      popupAnchor: [0, -(size / 2 + 5)]
    });
  }

  /**
   * Get severity ranking for clustering (higher = more severe)
   */
  function getEventSeverityRank(event) {
    // Full closures are always most severe
    if (event.IsFullClosure) return 100;
    
    // Then by event type severity
    if (event.EventType === 'accidentsAndIncidents') return 90;
    if (event.EventType === 'closures') return 80;
    if (event.Severity === 'Major') return 70;
    if (event.Severity === 'Minor') return 60;
    if (event.EventType === 'roadwork' || event.EventType === 'construction') return 50;
    
    return 40; // Default for restrictions and other
  }

  // ---- Color Mapping Functions ------------------------------------------

  /**
   * Get status color for ferry/transport services
   */
  function getStatusColor(status) {
    if (!status) return '#27ae60'; // default green
    
    const statusLower = status.toLowerCase();
    
    // Red for out of service conditions
    if (statusLower.includes('cancelled') || 
        statusLower.includes('suspended') || 
        statusLower.includes('out of service') ||
        statusLower.includes('closed') ||
        statusLower.includes('not operating') ||
        statusLower.includes('terminated')) {
      return '#e74c3c'; // red
    }
    
    // Green for in service conditions
    if (statusLower.includes('operational') || 
        statusLower.includes('running') || 
        statusLower.includes('in service') ||
        statusLower.includes('active') ||
        statusLower.includes('normal') ||
        statusLower.includes('on schedule')) {
      return '#27ae60'; // green
    }
    
    // Yellow for everything else (delays, maintenance, limited service, etc.)
    return '#f1c40f'; // yellow
  }

  /**
   * Road event type colors - updated for consistent red/blue scheme
   */
  const POINT_COLORS = {
    // Current/Active Events
    closures: '#dc2626',           // red - current road closures
    futureClosures: '#2563eb',     // blue - future road closures
    incidents: '#dc2626',          // red - accidents & incidents
    accidentsAndIncidents: '#dc2626', // red - active incidents (exact match)
    emergency: '#dc2626',          // red - emergency situations
    
    // Construction & Work
    construction: '#ea580c',       // orange - current construction
    futureConstruction: '#2563eb', // blue - future construction
    roadwork: '#ea580c',           // orange - current roadwork (alias)
    maintenance: '#0369a1',        // dark blue - maintenance work
    
    // Flooding
    flooding: '#0891b2',           // cyan - flooding/washouts
    
    // Restrictions & Traffic (amber/yellow family)
    restrictions: '#d97706',       // dark amber - vehicle restrictions
    traffic: '#f59e0b',           // amber - traffic issues
    
    // Weather & Conditions (purple family)
    weather: '#7c3aed',           // violet - weather related
    seasonal: '#8b5cf6',          // purple - seasonal conditions
    
    // Events & Advisories (green/teal family)
    event: '#0d9488',             // teal - special events
    advisory: '#059669',          // emerald - advisories
    
    // Detours & Routes (brown family)
    detour: '#7c2d12',           // brown - detour routes
    alternateRoute: '#a16207',    // yellow-brown - alternate routes
    
    // Default
    other: '#1f6feb',            // blue - other/info
    default: '#6b7280'           // gray - fallback
  };

  /**
   * Severity-based styling adjustments
   */
  const SEVERITY_STYLES = {
    'Major': { radius: 8, weight: 3, opacity: 1.0 },
    'Minor': { radius: 6, weight: 2, opacity: 0.9 },
    'None': { radius: 5, weight: 1, opacity: 0.8 },
    'default': { radius: 5, weight: 1, opacity: 0.8 }
  };

  /**
   * Winter road condition colors
   */
  const WINTER_COLORS = {
    'Bare Dry': '#2ecc71',
    'Bare Wet': '#3498db',
    'Slushy': '#8e44ad',
    'Snow Covered': '#e67e22',
    'Compacted Snow': '#d35400',
    'Ice Covered': '#e74c3c',
    'Partly Covered': '#f1c40f',
    'Closed': '#7f8c8d',
    'Unknown': '#95a5a6'
  };

  /**
   * Categorize event by type for the 5 specific subcategories
   */
  function getEventCategory(type, subType = '', startDate = null) {
    if (!type) return 'incidents';
    
    const t = type.toLowerCase();
    const st = (subType || '').toLowerCase();
    
    // Determine if this is a future event - check if start date is in the future
    // Convert startDate to milliseconds if it's in seconds
    const startTime = startDate ? (startDate < 9999999999 ? startDate * 1000 : startDate) : null;
    const isFuture = startTime && startTime > Date.now();
    
    // Flooding - washouts and flood-related events
    if (t.includes('flood') || st.includes('flood') || 
        st.includes('washout') || t.includes('washout') ||
        st.includes('bridge out')) {
      return 'flooding';
    }
    
    // Closures - road closures, bridge closures, breakups, etc.
    if (t === 'closures' || t.includes('closure') || t.includes('closed') ||
        st.includes('bridge repair') || st.includes('road breakup') ||
        st.includes('breakup') || st.includes('bridge restrictions') ||
        st.includes('traffic flow restriction')) {
      return isFuture ? 'futureClosures' : 'closures';
    }
    
    // Construction & Roadwork - repairs, paving, construction, etc.
    if (t === 'roadwork' || t.includes('construction') || t.includes('roadwork') ||
        st.includes('construction') || st.includes('paving') || 
        st.includes('repair') || st.includes('restrictions') ||
        st.includes('grading') || st.includes('patching') ||
        st.includes('inspection') || st.includes('maintenance') ||
        st.includes('gathering') || st.includes('parade') ||
        st.includes('festival') || st.includes('weight restrictions')) {
      return isFuture ? 'futureConstruction' : 'construction';
    }
    
    // Incidents - accidents, emergencies, traffic incidents
    if (t === 'accidentsandincidents' || t.includes('incident') || 
        t.includes('accident') || t.includes('emergency') ||
        st.includes('traffic flow restriction')) {
      return 'incidents';
    }
    
    // Default to construction for unknown roadwork-related events
    if (t.includes('road') || t.includes('bridge') || t.includes('highway')) {
      return isFuture ? 'futureConstruction' : 'construction';
    }
    
    // Final fallback
    return 'incidents';
  }

  /**
   * Get color for event/road type with enhanced logic
   */
  function getColorForType(type, subType = '', isFullClosure = false, startDate = null) {
    if (!type) return POINT_COLORS.default;
    
    // Use category-based logic for consistent colors
    const category = getEventCategory(type, subType, startDate);
    
    // Map categories to colors
    if (category === 'closures') return POINT_COLORS.closures;
    if (category === 'futureClosures') return POINT_COLORS.futureClosures;
    if (category === 'incidents') return POINT_COLORS.incidents;
    if (category === 'construction') return POINT_COLORS.construction;
    if (category === 'futureConstruction') return POINT_COLORS.futureConstruction;
    if (category === 'flooding') return POINT_COLORS.flooding;
    
    // Fallback to old logic for any unmapped types
    const t = type.toLowerCase();
    const st = (subType || '').toLowerCase();
    
    if (t.includes('restriction') || st.includes('restriction')) return POINT_COLORS.restrictions;
    if (t.includes('maintenance') || st.includes('maintenance')) return POINT_COLORS.maintenance;
    if (t.includes('weather') || st.includes('weather')) return POINT_COLORS.weather;
    if (t.includes('seasonal') || st.includes('seasonal')) return POINT_COLORS.seasonal;
    if (t.includes('emergency') || st.includes('emergency')) return POINT_COLORS.emergency;
    if (t.includes('event') || st.includes('event')) return POINT_COLORS.event;
    if (t.includes('advisory') || st.includes('advisory')) return POINT_COLORS.advisory;
    if (t.includes('detour') || st.includes('detour')) return POINT_COLORS.detour;
    if (t.includes('alternate') || st.includes('alternate')) return POINT_COLORS.alternateRoute;
    if (t.includes('traffic') || st.includes('traffic')) return POINT_COLORS.traffic;
    
    return POINT_COLORS.other;
  }

  /**
   * Get styling based on severity and closure type
   */
  function getEventStyle(event) {
    const baseColor = getColorForType(event.EventType, event.EventSubType, event.IsFullClosure);
    const severity = event.Severity || 'None';
    const severityStyle = SEVERITY_STYLES[severity] || SEVERITY_STYLES.default;
    
    return {
      radius: severityStyle.radius,
      color: '#374151', // dark gray border
      weight: severityStyle.weight,
      fillColor: baseColor,
      fillOpacity: severityStyle.opacity
    };
  }

  /**
   * Get color for winter road condition
   */
  function getWinterRoadColor(condition) {
    return WINTER_COLORS[condition] || WINTER_COLORS.Unknown;
  }

  // ---- Data Processing Helpers ------------------------------------------

  /**
   * Convert epoch timestamp to local time string
   */
  function epochToLocal(sec) {
    if (!sec) return 'Unknown';
    try {
      return new Date(sec * 1000).toLocaleString();
    } catch {
      return 'Invalid Date';
    }
  }

  // ---- CWFIS Services ---------------------------------------------------

  /**
   * Build CWFIS WFS URL for hotspot data
   */
  function buildCwfisWfsUrl(typeName, bounds, mapInstance) {
    const CONFIG = window.NBFireMapConstants;
    const b = bounds || (mapInstance ? mapInstance.getBounds() : null);
    if (!b) {
      console.warn('No bounds provided and no map instance available for CWFIS URL');
      return null;
    }
    const minx = b.getWest(), miny = b.getSouth(), maxx = b.getEast(), maxy = b.getNorth();
    const params = new URLSearchParams({
      service: 'WFS', 
      version: '1.0.0', 
      request: 'GetFeature',
      typeName, 
      srsName: 'EPSG:4326',
      bbox: `${minx},${miny},${maxx},${maxy},EPSG:4326`,
      outputFormat: 'application/json'
    });
    return `${CONFIG.SERVICES.CWFIS_WFS}?${params.toString()}`;
  }

  /**
   * Load CWFIS hotspot data
   */
  async function loadCwfisData(layer, typeName, mapInstance) {
    try {
      const url = buildCwfisWfsUrl(typeName, null, mapInstance);
      if (!url) return null;
      const data = await fetchWithRetry(url);
      if (data && layer) {
        layer.clearLayers();
        layer.addData(data);
      }
      return data;
    } catch (err) {
      console.warn('CWFIS WFS load failed:', err);
      return null;
    }
  }

  /**
   * Refresh visible CWFIS layers
   */
  function refreshVisibleCwfis(cwfis24Layer, cwfis7Layer, mapInstance) {
    if (!mapInstance) return;
    if (mapInstance.hasLayer(cwfis24Layer)) loadCwfisData(cwfis24Layer, 'public:hotspots_last24hrs', mapInstance);
    if (mapInstance.hasLayer(cwfis7Layer)) loadCwfisData(cwfis7Layer, 'public:hotspots_last7days', mapInstance);
  }

  // ---- Local File Loading -----------------------------------------------

  /**
   * Load local fire data
   */
  async function loadLocalFires() {
    try {
      const [activeData, outData, sumsData, locationsData] = await Promise.all([
        fetchLocalAny('active_fires'),
        fetchLocalAny('out_fires'),
        fetchLocalAny('sums_table'),
        fetchLocalAny('erd_fire_locations')
      ]);

      return {
        active: activeData,
        out: outData,
        sums: sumsData,
        locations: locationsData
      };
    } catch (error) {
      console.warn('Failed to load local fire data:', error);
      return { active: null, out: null, sums: null, locations: null };
    }
  }

  /**
   * Load benchmarks data
   */
  async function loadSumsBenchmarks() {
    try {
      const data = await fetchLocalAny('GNBfireActSum');
      return data;
    } catch (error) {
      console.warn('Failed to load benchmarks data:', error);
      return null;
    }
  }

  // ---- New Brunswick 511 Services ---------------------------------------

  /**
   * Load ferry terminal data
   */
  async function loadFerries(ferriesLayer) {
    if (loadingStates.ferries) return;
    loadingStates.ferries = true;

    try {
      const data = await fetchLocalAny('ferries');
      if (!data || !Array.isArray(data) || !ferriesLayer) return;

      ferriesLayer.clearLayers();
      
      data.forEach(ferry => {
        if (!ferry.Latitude || !ferry.Longitude) return;
        
        const status = ferry.Status || 'Unknown';
        const color = getStatusColor(status);
        
        // Get severity for clustering (0=green, 1=yellow, 2=red)
        let severity = 0; // default green
        const statusLower = status.toLowerCase();
        
        if (statusLower.includes('cancelled') || 
            statusLower.includes('suspended') || 
            statusLower.includes('out of service') ||
            statusLower.includes('closed') ||
            statusLower.includes('not operating') ||
            statusLower.includes('terminated')) {
          severity = 2; // red
        } else if (!(statusLower.includes('operational') || 
                    statusLower.includes('running') || 
                    statusLower.includes('in service') ||
                    statusLower.includes('active') ||
                    statusLower.includes('normal') ||
                    statusLower.includes('on schedule'))) {
          severity = 1; // yellow for anything else (delays, maintenance, etc.)
        }
        
        // Use the standardized ferry icon function
        const icon = createFerryIcon(color);
        
        const popupContent = `
          <div class="popup-header" style="font-size:16px;font-weight:700;color:#333;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #eee">${ferry.Name || 'Ferry Terminal'}</div>
          <div class="popup-body" style="font-size:13px;line-height:1.4">
            <div style="margin-bottom:4px"><b>Status:</b> ${status}</div>
            ${ferry.Route ? `<div style="margin-bottom:4px"><b>Route:</b> ${ferry.Route}</div>` : ''}
            ${ferry.Location ? `<div style="margin-bottom:4px"><b>Location:</b> ${ferry.Location}</div>` : ''}
            ${ferry.Area ? `<div style="margin-bottom:4px"><b>Area:</b> ${ferry.Area}</div>` : ''}
            ${ferry.Delays && ferry.Delays !== 'None' ? `<div style="margin-bottom:4px"><b>Delays:</b> ${ferry.Delays}</div>` : ''}
            ${ferry.ServiceDisruption && ferry.ServiceDisruption !== 'None' ? `<div style="margin-bottom:4px"><b>Service:</b> ${ferry.ServiceDisruption}</div>` : ''}
            ${ferry.Schedule ? `<div style="margin-bottom:4px"><b>Schedule:</b> ${ferry.Schedule}</div>` : ''}
            ${ferry.LastUpdated ? `<div style="margin-bottom:8px;font-size:12px;color:#555;font-weight:600">Updated by DTI: ${epochToLocal(ferry.LastUpdated)}</div>` : ''}
            ${ferry.downloaded_at ? `<div style="font-size:9px;color:#aaa;font-style:italic">Downloaded from DTI: ${new Date(ferry.downloaded_at).toLocaleString()}</div>` : ''}
          </div>
        `;
        
        const marker = L.marker([ferry.Latitude, ferry.Longitude], { 
          icon,
          _fSeverity: severity
        })
          .bindPopup(popupContent);
          
        ferriesLayer.addLayer(marker);
      });

      console.log(`Loaded ${data.length} ferry terminals`);
    } catch (error) {
      console.warn('Failed to load ferries:', error);
    } finally {
      loadingStates.ferries = false;
    }
  }



  /**
   * Load road events data
   */
  async function loadEvents(eventsPointLayer, eventsLineLayer, eventsDetourLayer) {
    if (loadingStates.events) return;
    loadingStates.events = true;

    try {
      const data = await fetchLocalAny('events');
      if (!data || !Array.isArray(data)) return;

      // Clear all event layers
      if (eventsPointLayer) eventsPointLayer.clearLayers();
      if (eventsLineLayer) eventsLineLayer.clearLayers();
      if (eventsDetourLayer) eventsDetourLayer.clearLayers();
      
      data.forEach(event => {
        const eventType = event.EventType || 'other';
        const color = getColorForType(eventType);
        
        const popupContent = `
          <div class="popup-header">🚧 ${event.EventType || 'Road Event'}</div>
          <div class="popup-body">
            <p><strong>Description:</strong> ${event.Description || 'N/A'}</p>
            <p><strong>Location:</strong> ${event.LocationDescription || 'N/A'}</p>
            <p><strong>Roadway:</strong> ${event.RoadwayName || 'N/A'}</p>
            ${event.StartDate ? `<p><strong>Start:</strong> ${epochToLocal(event.StartDate)}</p>` : ''}
            ${event.EndDate ? `<p><strong>End:</strong> ${epochToLocal(event.EndDate)}</p>` : ''}
            ${event.LastUpdated ? `<p><small>Updated: ${epochToLocal(event.LastUpdated)}</small></p>` : ''}
          </div>
        `;

        // Handle different geometry types
        if (event.Latitude && event.Longitude && eventsPointLayer) {
          // Point event
          const icon = L.divIcon({
            html: `<div style="background:${color};width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          });
          
          L.marker([event.Latitude, event.Longitude], { icon })
            .bindPopup(popupContent)
            .addTo(eventsPointLayer);
        } else if (event.EncodedPolyline && eventsLineLayer) {
          // Line event (using polyline encoding)
          try {
            const decoded = polyline.decode(event.EncodedPolyline);
            L.polyline(decoded, { color, weight: 4, opacity: 0.8 })
              .bindPopup(popupContent)
              .addTo(eventsLineLayer);
          } catch (err) {
            console.warn('Failed to decode polyline for event:', event.Id, err);
          }
        }
      });

      console.log(`Loaded ${data.length} road events`);
    } catch (error) {
      console.warn('Failed to load events:', error);
    } finally {
      loadingStates.events = false;
    }
  }

  /**
   * Load winter road conditions data
   */
  async function loadWinterRoads(winterLayer) {
    if (loadingStates.winterRoads) return;
    loadingStates.winterRoads = true;

    try {
      const data = await fetchLocalAny('winterroads');
      if (!data || !Array.isArray(data) || !winterLayer) return;

      winterLayer.clearLayers();
      
      data.forEach(road => {
        if (!road.EncodedPolyline) return;
        
        const condition = road['Primary Condition'] || 'Unknown';
        const color = getWinterRoadColor(condition);
        
        const popupContent = `
          <div class="popup-header">🛣️ ${road.RoadwayName || 'Highway'}</div>
          <div class="popup-body">
            <p><strong>Condition:</strong> ${condition}</p>
            <p><strong>Location:</strong> ${road.LocationDescription || 'N/A'}</p>
            <p><strong>Visibility:</strong> ${road.Visibility || 'N/A'}</p>
            <p><strong>Area:</strong> ${road.AreaName || 'N/A'}</p>
            ${road.LastUpdated ? `<p><small>Updated: ${epochToLocal(road.LastUpdated)}</small></p>` : ''}
          </div>
        `;

        try {
          const decoded = polyline.decode(road.EncodedPolyline);
          L.polyline(decoded, { 
            color, 
            weight: 4, 
            opacity: 0.8,
            className: 'winter-road-segment'
          })
            .bindPopup(popupContent)
            .addTo(winterLayer);
        } catch (err) {
          console.warn('Failed to decode polyline for winter road:', road.Id, err);
        }
      });

      console.log(`Loaded ${data.length} winter road segments`);
    } catch (error) {
      console.warn('Failed to load winter roads:', error);
    } finally {
      loadingStates.winterRoads = false;
    }
  }

  // ---- Aviation Services ------------------------------------------------

  /**
   * Load OpenSky aircraft data
   */
  async function loadOpenSkyData(aircraftLayer) {
    if (loadingStates.openSky) return;
    loadingStates.openSky = true;

    try {
      const CONFIG = window.NBFireMapConstants;
      const bounds = CONFIG.NB_BOUNDS;
      const url = `${CONFIG.SERVICES.OPEN_SKY_URL}?lamin=${bounds[0][0]}&lomin=${bounds[0][1]}&lamax=${bounds[1][0]}&lomax=${bounds[1][1]}`;
      
      const data = await fetchWithRetry(url);
      if (!data || !data.states || !aircraftLayer) return;

      aircraftLayer.clearLayers();

      data.states.forEach(state => {
        const [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source] = state;
        
        if (!latitude || !longitude || on_ground) return;

        const icon = L.divIcon({
          html: `<div style="background:#ff6b35;width:8px;height:8px;border-radius:50%;border:1px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>`,
          className: '',
          iconSize: [10, 10],
          iconAnchor: [5, 5]
        });

        const popupContent = `
          <div class="popup-header">✈️ ${callsign?.trim() || 'Aircraft'}</div>
          <div class="popup-body">
            <p><strong>ICAO24:</strong> ${icao24}</p>
            <p><strong>Country:</strong> ${origin_country}</p>
            <p><strong>Altitude:</strong> ${baro_altitude ? Math.round(baro_altitude * 3.28084) + ' ft' : 'N/A'}</p>
            <p><strong>Speed:</strong> ${velocity ? Math.round(velocity * 1.94384) + ' kts' : 'N/A'}</p>
            <p><strong>Heading:</strong> ${true_track ? Math.round(true_track) + '°' : 'N/A'}</p>
            <p><small>Last Contact: ${last_contact ? new Date(last_contact * 1000).toLocaleTimeString() : 'N/A'}</small></p>
          </div>
        `;

        L.marker([latitude, longitude], { icon })
          .bindPopup(popupContent)
          .addTo(aircraftLayer);
      });

      console.log(`Loaded ${data.states.length} aircraft`);
    } catch (error) {
      console.warn('Failed to load aircraft data:', error);
    } finally {
      loadingStates.openSky = false;
    }
  }

  // ---- Initialization ---------------------------------------------------

  /**
   * Initialize the Data Loading Manager
   */
  function initialize() {
    if (isInitialized) return;
    isInitialized = true;
    console.log('Data Loading Manager initialized');
  }

  /**
   * Get current loading states
   */
  function getLoadingStates() {
    return { ...loadingStates };
  }

  /**
   * Reset loading state for a specific service
   */
  function resetLoadingState(service) {
    if (service in loadingStates) {
      loadingStates[service] = false;
    }
  }

  // ---- Public API -------------------------------------------------------

  return {
    // Initialization
    initialize,
    getLoadingStates,
    resetLoadingState,

    // Local file loading
    fetchLocalAny,
    loadLocalFires,
    loadSumsBenchmarks,

    // CWFIS services
    buildCwfisWfsUrl,
    loadCwfisData,
    refreshVisibleCwfis,

    // New Brunswick 511 services
    loadFerries,
    loadEvents,
    loadWinterRoads,

    // Aviation services
    loadOpenSkyData,

    // Icon creation
    createFerryIcon,
    createWebcamIcon,
    createEventIcon,
    getEventSeverityRank,

    // Color utilities
    getStatusColor,
    getColorForType,
    getEventCategory,
    getEventStyle,
    getWinterRoadColor,
    POINT_COLORS,
    WINTER_COLORS,

    // Utility functions
    epochToLocal,
    fetchWithRetry
  };
})();