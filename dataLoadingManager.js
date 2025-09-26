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
    const fireFiles = ['active_fires', 'out_fires'];
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
   * Road event type colors
   */
  const POINT_COLORS = {
    closures: '#e11d48',       // red
    restrictions: '#f59e0b',   // amber
    incidents: '#f97316',      // orange
    construction: '#8e44ad',   // purple
    other: '#1f6feb',          // blue
    default: '#1f6feb'         // fallback
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
   * Get color for event/road type
   */
  function getColorForType(type) {
    if (!type) return POINT_COLORS.default;
    const t = type.toLowerCase();
    if (t.includes('closure') || t.includes('closed')) return POINT_COLORS.closures;
    if (t.includes('restriction') || t.includes('limit')) return POINT_COLORS.restrictions;
    if (t.includes('incident') || t.includes('accident')) return POINT_COLORS.incidents;
    if (t.includes('construction') || t.includes('maintenance')) return POINT_COLORS.construction;
    return POINT_COLORS.other;
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
      const [activeData, outData, sumsData] = await Promise.all([
        fetchLocalAny('active_fires'),
        fetchLocalAny('out_fires'),
        fetchLocalAny('sums_table')
      ]);

      return {
        active: activeData,
        out: outData,
        sums: sumsData
      };
    } catch (error) {
      console.warn('Failed to load local fire data:', error);
      return { active: null, out: null, sums: null };
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

    // Color utilities
    getStatusColor,
    getColorForType,
    getWinterRoadColor,
    POINT_COLORS,
    WINTER_COLORS,

    // Utility functions
    epochToLocal,
    fetchWithRetry
  };
})();