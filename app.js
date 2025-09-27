/* =========================================================================
       NB Fire Map — refactored for clarity and maintainability.
       ========================================================================= */

    window.addEventListener('DOMContentLoaded', () => {
      'use strict';

      // ---- Utilities (imported from utils.js) --------------------------------
      const { degToCompass, toNum, fmtDateTime, fmtDateTimeTz, fmtDateTZ, ymdInTz, sameYMD, startOfTodayUTCfromTz, norm, escHTML, isMobile, ATLANTIC_TZ } = window.NBFireMapUtils;
      
      // ---- Constants (imported from constants.js) ----------------------------
      const CONFIG = window.NBFireMapConstants;
      
      // ---- Layer Manager (imported from layerManager.js) --------------------
      const LayerManager = window.NBFireMapLayerManager;
      
      // ---- UI Panel Manager (imported from uiPanelManager.js) ---------------
      const UIPanelManager = window.NBFireMapUIPanelManager;
      
      // ---- Data Loading Manager (imported from dataLoadingManager.js) -------
      const DataLoadingManager = window.NBFireMapDataLoadingManager;
      
      // ---- Fire Data Manager (imported from fireDataManager.js) -------------
      const FireDataManager = window.NBFireMapFireDataManager;

      // ---- Zoom settings & utilities ----------------------------------------
      const CONTROLLED_ZOOM_LEVEL = CONFIG.CONTROLLED_ZOOM_LEVEL;
      
      // Centralized zoom functions to ensure consistent behavior
      const zoomUtils = {
        // Smart zoom that respects controlled zoom level and current zoom (maintains current zoom if appropriate)
        flyToControlled: (latlng, options = {}) => {
          const minZoom = options.minZoom || 8;
          const targetZoom = Math.min(CONTROLLED_ZOOM_LEVEL, Math.max(map.getZoom(), minZoom));
          return map.flyTo(latlng, targetZoom, { duration: options.duration || 0.6 });
        },
        
        // Zoom to specific target (always zooms to controlled level for specific items)
        flyToTarget: (latlng, options = {}) => {
          const targetZoom = options.preferredZoom || CONTROLLED_ZOOM_LEVEL;
          return map.flyTo(latlng, targetZoom, { duration: options.duration || 0.6 });
        },
        
        // Fit bounds with controlled max zoom
        fitBoundsControlled: (bounds, options = {}) => {
          const defaultOptions = {
            animate: true,
            maxZoom: CONTROLLED_ZOOM_LEVEL,
            ...options
          };
          return map.fitBounds(bounds, defaultOptions);
        },
        
        // Override cluster zoom behavior to respect controlled zoom level
        setupClusterZoomControl: (clusterGroup) => {
          clusterGroup.on('clusterclick', (e) => {
            e.originalEvent.preventDefault?.();
            const cluster = e.layer;
            const bounds = cluster.getBounds();
            zoomUtils.fitBoundsControlled(bounds, { padding: [20, 20] });
          });
          return clusterGroup;
        }
      };

      // DOM helpers
      const D = document;
      const $  = (sel, root=D) => root.querySelector(sel);
      const $$ = (sel, root=D) => root.querySelectorAll(sel);

  // Initialize UI Panel Manager
  UIPanelManager.initialize();
  
  // Set up callback to clear proximity layer when nearby panel is closed
  UIPanelManager.setNearbyPanelCloseCallback(() => {
    cityProximityLayer.clearLayers();
  });

  // Helper function for nearby panel height
  function nearbyPanelHeight(){
    return UIPanelManager.getNearbyPanelHeight() + 12; // include gap to map edge
  }

  // Wrapper functions for backward compatibility
  function openNearbyPanel(title, html){
    UIPanelManager.openNearbyPanel(title || 'Nearby Fires', html || '');
  }
  function closeNearbyPanel(){
    UIPanelManager.closeNearbyPanel();
  }

      // ---- Constants --------------------------------------------------------
      const LS_KEY = CONFIG.LS_KEY;
      const NB_BOUNDS = CONFIG.NB_BOUNDS;
      const INITIAL_VIEW = CONFIG.INITIAL_VIEW;

      // External sources & timing
      const OPEN_SKY_URL = CONFIG.OPEN_SKY_URL;
      const PLANES_REFRESH_MS = CONFIG.PLANES_REFRESH_MS;

      // NEW: WMS endpoint + layer for surface smoke (direct WMS access)
      const NOAA_SMOKE_WMS = CONFIG.SERVICES.NOAA_SMOKE_WMS;
      const NOAA_SMOKE_WMS_BASE_URL = CONFIG.SERVICES.NOAA_SMOKE_WMS_BASE_URL;
      const NOAA_SMOKE_WMS_LAYER = CONFIG.SERVICES.NOAA_SMOKE_WMS_LAYER;
      const SMOKE_HOURS_FORWARD = CONFIG.SMOKE_HOURS_FORWARD;
      const SMOKE_FRAME_MS = CONFIG.SMOKE_FRAME_MS;

      const LIGHTNING_REFRESH_MS = CONFIG.LIGHTNING_REFRESH_MS;

      // Formatting helpers (most now imported from utils.js)

      // Date functions from FireDataManager
      const isToday = FireDataManager.isToday;
      const isYesterday = FireDataManager.isYesterday;

      // Property extraction helpers
      const firstProp = (p, keys) => { for (const k of keys) { const v = p?.[k]; if (v !== undefined && v !== null && v !== '') return [k, v]; } return [null, null]; };
      const clamp01 = (n) => Math.max(0, Math.min(100, n));
      const parseMaybeNumber = (v) => { if (v == null) return null; const n = Number(v); if (Number.isFinite(n)) return n; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
      const parseDateFlexible = (v) => {
        if (v == null || v === '') return null;
        const s = String(v).trim(); const ymd = s.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (ymd) { const y=+ymd[1], m=+ymd[2], d=+ymd[3]; if(m>=1 && m<=12 && d>=1 && d<=31) return Date.UTC(y, m-1, d); }
        const parsed = Date.parse(s); if (!Number.isNaN(parsed)) return parsed;
        const n = Number(s); if (!Number.isFinite(n) || n <= 0) return null; return n < 1e12 ? n * 1000 : n;
      };
      const getContainPct = (p) => {
        const [, v] = firstProp(p, ['PCT_CONTAINED','PERCENT_CONTAINED','CONTAINMENT_PCT','CONTAINED_PCT','PCTCONTAINED','CONTAINMENT','CONTAINMENT_PERCENT']);
        const num = parseMaybeNumber(v); return num == null ? null : clamp01(num);
      };
      const getDetectedMs = FireDataManager.getDetectedMs;
      const getExtinguishedMs = FireDataManager.getExtinguishedMs;
      const getRetrievedInfo = (p) => {
        const [, v] = firstProp(p, ['FETCHED_FROM_ERD','FETCHED_FROM_GNB','GNB_FETCHED','GNB_RETRIEVED_AT','RETRIEVED_FROM_GNB','FETCHED_AT','FETCH_TIMESTAMP','SOURCE_FETCHED_AT','ERD_FETCHED_AT']);
        if (v == null) return { ms:null, bool:null, raw:null };
        const ms = parseDateFlexible(v); if (ms != null) return { ms, bool:null, raw:v };
        const sv = String(v).trim().toLowerCase();
        if (typeof v === 'boolean' || ['true','yes','y','1'].includes(sv))  return { ms:null, bool:true,  raw:v };
        if (['false','no','n','0'].includes(sv))                           return { ms:null, bool:false, raw:v };
        return { ms:null, bool:null, raw:v };
      };

      // ---- Logo layout (no guards needed with new design) ------------------
      function layoutTitleBox(){
        // Logo is now centered and doesn't need dynamic layout
        // This function is kept for compatibility but does nothing
      }

      // ---- Map init & panes -------------------------------------------------
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      const map = L.map('map', { 
        center: saved?.center || INITIAL_VIEW.center, 
        zoom: saved?.zoom || INITIAL_VIEW.zoom,
        maxZoom: CONFIG.MAP.MAX_ZOOM,
        zoomControl: false,  // Disable default zoom controls since we have custom ones
        attributionControl: false  // Hide attribution control - credits moved to help
      });
      

      
      map.on('moveend', () => {
        const c = map.getCenter();
        localStorage.setItem(LS_KEY, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() }));
      });

      CONFIG.PANES.forEach(([name, z, pe]) => { const p = map.createPane(name); p.style.zIndex = z; if (pe) p.style.pointerEvents = 'auto'; });

      // Basemaps: Esri Imagery (current) and OpenStreetMap
      const basemaps = LayerManager.basemaps.createBasemaps(CONFIG);
      const savedBase = LayerManager.basemaps.initializeBasemap(map, basemaps);
      const setBasemap = (which) => LayerManager.basemaps.setBasemap(map, basemaps, which);

      // L.control.locate({
      //   position: 'topleft',
      //   flyTo: true,
      //   showPopup: false,
      //   keepCurrentZoomLevel: true,
      //   icon: 'fa-solid fa-location-crosshairs',
      //   strings: { title: 'Show me where I am' }
      // }).addTo(map);

      // ---- Quick location click-catcher → nearby fires ----------------------
      const userLocLayer = LayerManager.creation.createLayerGroup('planesPane').addTo(map);
      let userLocMarker = null;
      function gpsToFires(latlng) { cityToFires('Your Location', latlng); }
      function upsertUserLoc(latlng) {
        if (userLocMarker) { userLocMarker.setLatLng(latlng); return; }
        // Use blue dot location marker like standard GPS indicators
        userLocMarker = L.circleMarker(latlng, {
          radius: 8,
          fillColor: '#007bff',
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 1,
          pane: 'planesPane'
        })
          .bindTooltip('Your location — tap to see nearby fires', { direction: 'top', offset: [0, -10] })
          .on('click', () => gpsToFires(userLocMarker.getLatLng()))
          .addTo(userLocLayer);
      }
      map.on('locationfound', (e) => { if (e?.latlng) upsertUserLoc(e.latlng); });
      map.on('locationerror', () => { LayerManager.layerState.clearLayerGroup(userLocLayer); userLocMarker = null; });

      const fitProvinceToView = ({ animate=false } = {}) => {
        const padX = Math.round(innerWidth  * 0.04);
        const padY = Math.round(innerHeight * 0.04);
        map.fitBounds(NB_BOUNDS, { paddingTopLeft:[padX,padY], paddingBottomRight:[padX,padY], animate });
      };

      // ---- Local fires (GeoJSON) + clustering -------------------------------
      const fireStore = FireDataManager.getFireStore();
      let fireClusters = null;
      const activeFireMarkers = [];
      const outFireMarkers = [];

      const ensureFireClusters = () => {
        if (fireClusters) return;
        fireClusters = LayerManager.fireClustering.createClusterGroup(CONFIG, FireDataManager.getStatusColor, FireDataManager.getSeverityRank).addTo(map);
        zoomUtils.setupClusterZoomControl(fireClusters);
      };

      // Use popup utilities for hover/click behavior
      const bindHoverTogglePopup = window.NBFireMapPopupUtils.bindHoverTogglePopup;



      const makeFireMarker = FireDataManager.createFireMarker;

      // Initialize Data Loading Manager
      DataLoadingManager.initialize();
      
      // Wrapper for backward compatibility
      const fetchLocalAny = DataLoadingManager.fetchLocalAny;

      function applyFireFilter(){
        ensureFireClusters();
        LayerManager.fireClustering.applyFireFilter(fireClusters, activeFireMarkers, outFireMarkers, norm);
      }

      // Fire summary elements for backward compatibility
      const fsOverlay=$('#fireSummaryOverlay');
      const fsBody=$('#fs-body');
      const fsBtn=$('#fireSummaryBtn');
      const fsClose=$('#fs-close');
      const sizeOf = FireDataManager.getFireSize;
      const fireStoreMap = fireStore;

      const buildBenchmarksHTML = () => {
        if (!SUMS_BENCH) return '';
        return `
          <table class="pro-table compact" aria-label="Historic/season benchmarks">
            <thead><tr><th>Historic</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>10-year Avg YTD Fires</td><td>${toNum(SUMS_BENCH.avg10Fires,0)}</td></tr>
              <tr><td>10-year Avg YTD Area Burned</td><td>${toNum(SUMS_BENCH.avg10Burn,1)} ha</td></tr>
              <tr><td>Last Year YTD Fires</td><td>${toNum(SUMS_BENCH.lastCount,0)}</td></tr>
              <tr><td>Last Year YTD Area Burned</td><td>${toNum(SUMS_BENCH.lastBurn,1)} ha</td></tr>
              <tr><td>YTD Fires</td><td class="pro-kpi">${toNum(SUMS_BENCH.thisCount,0)}</td></tr>
              <tr><td>YTD Area Burned</td><td class="pro-kpi">${toNum(SUMS_BENCH.thisBurn,1)} ha</td></tr>
            </tbody>
          </table>`;
      };

      function wireSummaryClicks(){
        const cont = $('#fs-scroll'); if(!cont) return;
        cont.addEventListener('click', (e)=>{
          const a = e.target.closest('a[data-fireid]'); if(!a) return;
          e.preventDefault();
          const rec = fireStore.get(a.getAttribute('data-fireid')); if(!rec) return;
          const statusKey = rec.statusKey || norm(rec.props?.FIRE_STAT_DESC_E || '');
          if (statusKey) ensureStatusEnabled(statusKey);
          closeSummary();
          hideOverviewPanel();
          zoomUtils.flyToTarget(rec.latlng);
          map.once('moveend', ()=> rec.layer?.openPopup && rec.layer.openPopup());
        }, { passive: false });
      }

      function wirePieLegendClicks(){
        const legend = fsBody.querySelector('.pie-legend'); if(!legend) return;
        legend.querySelectorAll('.pie-legend-item').forEach(item => {
          item.addEventListener('click', () => {
            const status = item.dataset.status;
            const section = fsBody.querySelector(`h4:contains('${status}')`);
            if(section) section.scrollIntoView({behavior: 'smooth'});
          });
        });
      }

      function wireTrendHover(){
        const wrap = $('.fs-mini-chart');
        if(!wrap) return;
        const bars = wrap.querySelectorAll('.fs-bar');
        bars.forEach(bar => {
          bar.addEventListener('mouseenter', (e) => {
            const tooltip = document.createElement('div');
            tooltip.className = 'fs-tooltip';
            tooltip.textContent = `${e.target.dataset.date}: ${e.target.dataset.count} fires`;
            document.body.appendChild(tooltip);
            const rect = e.target.getBoundingClientRect();
            tooltip.style.left = rect.left + 'px';
            tooltip.style.top = (rect.top - 30) + 'px';
          });
          bar.addEventListener('mouseleave', () => {
            document.querySelectorAll('.fs-tooltip').forEach(t => t.remove());
          });
        });
      }

      async function loadLocalFires(){
        try {
          const [activeData, outData] = await Promise.all([ fetchLocalAny('active_fires'), fetchLocalAny('out_fires') ]);

          const activeMarkers = FireDataManager.processFireGeoJSON(activeData, null, false);
          const outMarkers = FireDataManager.processFireGeoJSON(outData, 'Extinguished', true);
          
          activeFireMarkers.push(...activeMarkers);
          outFireMarkers.push(...outMarkers);

          applyFireFilter();
          refreshSummary();
        } catch (e) { console.error('Loading local fires failed:', e); }
      }

      map.whenReady(() => { fitProvinceToView({ animate:false }); loadLocalFires(); });

      // ---- CWFIS Hotspots (WFS) ---------------------------------------------
      // CWFIS functions now handled by DataLoadingManager
      const cwfisWfsUrl = (typeName, bounds) => DataLoadingManager.buildCwfisWfsUrl(typeName, bounds, map);
      const cwfis24 = L.geoJSON(null, {
        pane: 'viirsPane',
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, { radius: 5, color: 'var(--modis)', fillColor: 'var(--modis)', fillOpacity: 0.9 }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const formatHotspotDate = (dateStr) => {
            if (!dateStr) return 'N/A';
            try {
              return new Date(dateStr).toLocaleString('en-CA', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
              });
            } catch {
              return dateStr;
            }
          };
          
          const popupContent = `
            <div class="popup-header">CWFIS Hotspot (24hr)</div>
            <div class="popup-body">
              <p><strong>Coordinates:</strong> ${props.lat || 'N/A'}, ${props.lon || 'N/A'}</p>
              <p><strong>Report Date:</strong> ${formatHotspotDate(props.rep_date)}</p>
              <p><strong>Source:</strong> ${props.source || 'N/A'}</p>
              <p><strong>Sensor:</strong> ${props.sensor || 'N/A'}</p>
              <p><strong>Satellite:</strong> ${props.satellite || 'N/A'}</p>
              <p><small>Source: CWFIS © Natural Resources Canada</small></p>
            </div>
          `;
          layer.bindPopup(popupContent);
        }
      }).addTo(map);

      const cwfis7 = L.geoJSON(null, {
        pane: 'viirsPane',
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, { radius: 4, color: 'var(--modis)', fillColor: 'var(--modis)', fillOpacity: 0.65 }),
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const formatHotspotDate = (dateStr) => {
            if (!dateStr) return 'N/A';
            try {
              return new Date(dateStr).toLocaleString('en-CA', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
              });
            } catch {
              return dateStr;
            }
          };
          
          const popupContent = `
            <div class="popup-header">CWFIS Hotspot (7-day)</div>
            <div class="popup-body">
              <p><strong>Coordinates:</strong> ${props.lat || 'N/A'}, ${props.lon || 'N/A'}</p>
              <p><strong>Report Date:</strong> ${formatHotspotDate(props.rep_date)}</p>
              <p><strong>Source:</strong> ${props.source || 'N/A'}</p>
              <p><strong>Sensor:</strong> ${props.sensor || 'N/A'}</p>
              <p><strong>Satellite:</strong> ${props.satellite || 'N/A'}</p>
              <p><small>Source: CWFIS © Natural Resources Canada</small></p>
            </div>
          `;
          layer.bindPopup(popupContent);
        }
      });

      // CWFIS loading functions now use DataLoadingManager
      const loadCwfis = (layer, typeName) => DataLoadingManager.loadCwfisData(layer, typeName, map);
      function refreshVisibleCwfis() {
        DataLoadingManager.refreshVisibleCwfis(cwfis24, cwfis7, map);
      }
      LayerManager.conditionalLoading.setupConditionalHandlers(map, refreshVisibleCwfis);

      // ---- Perimeters / Boundary -------------------------------------------
      const perimeterLabelLayers = new Set();
      const activePerimeters = L.esri.featureLayer({
        url: CONFIG.SERVICES.ACTIVE_PERIMETERS,
        pane:'perimetersPane',
        style:()=>({color:FireDataManager.getColorConfig().perimeter,weight:1.2,fillOpacity:.18}),
        onEachFeature:(feature,layer)=>{
          const ha = feature?.properties?.AREA;
          const props = feature.properties || {};
          
          // Add tooltip for area label
          layer.bindTooltip(`<span class="perimeter-label" style="color:${FireDataManager.getColorConfig().perimeter}">${toNum(ha,1)} ha</span>`,
            {permanent:true,className:'perimeter-label-tooltip',direction:'center',opacity:0});
          perimeterLabelLayers.add(layer);
          
          // Add popup with detailed information
          const formatDate = (timestamp) => {
            if (!timestamp) return 'N/A';
            try {
              // Convert from epoch milliseconds to readable date
              return new Date(parseInt(timestamp)).toLocaleDateString('en-CA', {
                year: 'numeric', month: 'short', day: 'numeric'
              });
            } catch {
              return 'N/A';
            }
          };
          
          const popupContent = `
            <div class="popup-header">Fire Perimeter</div>
            <div class="popup-body">
              <p><strong>Area:</strong> ${toNum(ha,1)} hectares</p>
              <p><strong>Object ID:</strong> ${props.OBJECTID || 'N/A'}</p>
              <p><strong>UID:</strong> ${props.UID || 'N/A'}</p>
              <p><strong>Province:</strong> ${props.Province || 'N/A'}</p>
              <p><strong>Hot Count:</strong> ${props.HCOUNT || 'N/A'}</p>
              <p><strong>First Date:</strong> ${formatDate(props.FIRSTDATE)}</p>
              <p><strong>Last Date:</strong> ${formatDate(props.LASTDATE)}</p>
              <p><small>Source: Natural Resources Canada</small></p>
            </div>
          `;
          layer.bindPopup(popupContent);
        }
      });
      const setPerimeterLabels = LayerManager.labels.createZoomLabelUpdater(map, perimeterLabelLayers, 11);
      activePerimeters.on('load', setPerimeterLabels);

      const nbBoundary = L.esri.featureLayer({
        url: CONFIG.SERVICES.CANADA_PROVINCES,
        where:"Name_EN = 'New Brunswick'",
        pane:'nbBoundaryPane',
        style:()=>({color: FireDataManager.getColorConfig().boundary, weight:5, fill:false}),
        interactive:false
      }).addTo(map);

      // ---- Crown Land staged loader ----------------------------------------
      const crownProxy = LayerManager.crownLand.initProxy();
      LayerManager.crownLand.setupStaging(map, crownProxy, CONFIG);

      // ---- Counties (off by default) ---------------------------------------
      const countyLabelLayers = new Set();
      const counties = L.esri.featureLayer({
        url: CONFIG.SERVICES.NB_COUNTIES,
        pane: 'countiesPane',
        smoothFactor: 3,
        style: () => ({ color: '#ffffff', weight: 3.5, fill: false }),
        onEachFeature: (feature, layer) => {
          const p = feature?.properties || feature?.attributes || {};
          const name = p.ENG_NAME;
          layer.bindTooltip(`<span class="county-label">${name}</span>`, { permanent: true, direction: 'center', className: 'county-label-tooltip', opacity: 0 });
          countyLabelLayers.add(layer);
        }
      });
      const setCountyLabels = LayerManager.labels.createZoomLabelUpdater(map, countyLabelLayers, 8);
      counties.on('load', setCountyLabels);

      // ---- Sentinel imagery & burn bans ------------------------------------
      const sentinel2 = L.esri.imageMapLayer({ url: CONFIG.SERVICES.SENTINEL2, opacity: CONFIG.OPACITY.SENTINEL, pane:'sentinelPane' });
      sentinel2.on('load', ()=> sentinel2.bringToFront());
      const nbBurnBans = L.esri.dynamicMapLayer({ url: CONFIG.SERVICES.NB_BURN_BANS, opacity: CONFIG.OPACITY.BURN_BANS, pane:'perimetersPane' });

      // ---- Weather stations / radar / lightning / AQHI ----------------------
      function stationPopupHTML(p) {
        const fromDeg = Number(p.WindDirection);
        const kmh = Number(p.WindSpeed_kmh);
        const temp = p.Temperature_C !== '' && p.Temperature_C != null ? Math.round(Number(p.Temperature_C)) : null;
        const hum  = p.Humidity_Percent !== '' && p.Humidity_Percent != null ? Math.round(Number(p.Humidity_Percent)) : null;
        const name = p.StationName || p.location_name_en || 'Weather station';
        const when = p.observation_datetime_text_en || '';
        return `
          <div style="min-width:240px">
            <div style="font-weight:800;margin-bottom:4px">${name}</div>
            <div><b>Wind:</b> ${Number.isFinite(kmh) ? kmh : '—'} km/h • From ${degToCompass(fromDeg)}${Number.isFinite(fromDeg) ? ' ('+Math.round(fromDeg)+'°)' : ''}</div>
            <div><b>Temp:</b> ${temp != null ? temp + '°C' : '—'}${hum != null ? ' • ' + hum + '%' : ''}</div>
            ${when ? `<div style="opacity:.8">${when}</div>` : ''}
          </div>`;
      }
      function stationSVG(p, size=84){
        const fromDeg = Number(p.WindDirection);
        const toDeg = Number.isFinite(fromDeg) ? (fromDeg + 180) % 360 : 0;
        const kmh = Number(p.WindSpeed_kmh);
        const temp = p.Temperature_C !== '' && p.Temperature_C != null ? Math.round(Number(p.Temperature_C)) : null;
        const hum  = p.Humidity_Percent !== '' && p.Humidity_Percent != null ? Math.round(Number(p.Humidity_Percent)) : null;
        const arrowPathD = "M42 14 Q52 30 58 58 Q42 48 42 48 Q42 48 26 58 Q32 30 42 14 Z";
        const scale = size/84;
        return `
          <svg class="ws-svg" width="${84*scale}" height="${92*scale}" viewBox="0 0 84 92" aria-hidden="true" role="img" style="position:relative; z-index:1; filter:drop-shadow(0 2px 2px rgba(0,0,0,.25))">
            <circle cx="42" cy="42" r="34" fill="#0b0f19" stroke="#ffffff" stroke-width="2.5"/>
            <g transform="rotate(${toDeg} 42 42)">
              <path d="${arrowPathD}" fill="#999999" stroke="#999999" stroke-width="1.8" stroke-linejoin="round"></path>
              <g transform="rotate(${-toDeg} 42 42)">
                <text x="42" y="26" text-anchor="middle" class="ws-small">From ${degToCompass(fromDeg)}</text>
                <text x="42" y="42" text-anchor="middle" class="ws-speed">${Number.isFinite(kmh) ? kmh : '—'} km/h</text>
                <text x="42" y="58" text-anchor="middle" class="ws-small">${temp != null ? temp + '°C' : '—'}${hum != null ? ' • ' + hum + '%' : ''}</text>
              </g>
            </g>
          </svg>`;
      }
      function makeStationMarker(feature, latlng) {
        const p = feature.properties || {};
        const icon = L.divIcon({ className: 'ws-div', html: stationSVG(p, 84), iconSize: [84, 92], iconAnchor: [42, 54], popupAnchor: [0, -44] });
        const m = L.marker(latlng, { icon, pane: 'weatherPane' });
        m.options._stationProps = p;
        const fromDeg = Number(p.WindDirection);
        const kmh = Number(p.WindSpeed_kmh);
        const temp = p.Temperature_C !== '' && p.Temperature_C != null ? Math.round(Number(p.Temperature_C)) : null;
        const hum  = p.Humidity_Percent !== '' && p.Humidity_Percent != null ? Math.round(Number(p.Humidity_Percent)) : null;
        m.bindTooltip(`Wind: ${Number.isFinite(kmh) ? kmh : '—'} km/h • From ${degToCompass(fromDeg)}${temp != null ? ' • ' + temp + '°C' : ''}${hum != null ? ' • ' + hum + '%' : ''}`, { direction: 'top', offset: [0, -36], opacity: 0 });
        m.bindPopup(stationPopupHTML(p), { pane: 'alwaysOnTopPopup' });
        return m;
      }
      const weatherStations = L.esri.Cluster.featureLayer({
        url: CONFIG.SERVICES.WEATHER_STATIONS,
        pane: 'weatherPane',
        clusterPane: 'weatherPane',
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 10,
        zoomToBoundsOnClick: false,
        showCoverageOnHover: false,
        pointToLayer: makeStationMarker,
        iconCreateFunction: (cluster) => {
          const center = cluster.getLatLng();
          const markers = cluster.getAllChildMarkers();
          let best = null, bestDist = Infinity;
          for (const m of markers) { const d = map.distance(center, m.getLatLng()); if (d < bestDist) { bestDist = d; best = m; } }
          const p = best?.options?._stationProps || {};
          return L.divIcon({
            className: 'ws-cluster-icon',
            html: `
              <div style="position:relative;display:inline-grid;place-items:center">
                ${stationSVG(p, 84)}
                <div style="position:absolute;bottom:8px;right:8px;z-index:2;background:var(--panel-strong);border:2px solid #111827;border-radius:999px;
                            font:800 12px/1.1 Inter,system-ui,Arial;padding:4px 7px;box-shadow:0 2px 8px rgba(0,0,0,.18);pointer-events:none">
                  ${cluster.getChildCount()}
                </div>
              </div>`,
            iconSize: [84, 92], iconAnchor: [42, 54], popupAnchor: [0, -44] });
        }
      });

      const noaaRadar = L.esri.imageMapLayer({ url: CONFIG.SERVICES.NOAA_RADAR, opacity: CONFIG.OPACITY.RADAR, pane:'radarPane' });

      const lightningLayer = L.tileLayer.wms(CONFIG.SERVICES.GEOMET_WMS,{
        layers:'Lightning_2.5km_Density',version:'1.3.0',format:'image/png',transparent:true,opacity:1,pane:'lightningPane'
      });

      let lightningTimer=null;
      const startLightningRefresh=()=>{ if(!lightningTimer){ lightningTimer=setInterval(()=>{ lightningLayer.setParams({_ :Date.now()}); }, LIGHTNING_REFRESH_MS); } };
      const stopLightningRefresh = ()=>{ if(lightningTimer){ clearInterval(lightningTimer); lightningTimer=null; } };
      map.on('overlayadd',(e)=>{ 
        if(e.layer===lightningLayer) startLightningRefresh(); 
        if(e.layer===sentinel2) sentinel2.bringToFront();
        if(e.layer===smokeLayer) {

          if (smokeTimesMs.length > 0) {
            smokeSetIndex(smokeIdx);
            if (smokePendingAutoplay || smokeShouldAutoplayNextOn) {
              smokePlay(); 
              smokePendingAutoplay = false; 
              smokeShouldAutoplayNextOn = false;
            }
          }
        }
      });
      map.on('overlayremove',(e)=>{ 
        if(e.layer===lightningLayer) stopLightningRefresh(); 
        if(e.layer===smokeLayer) {

          smokePause();
        }
      });

        /* ===================== CWFIS (Fire Risk / Weather / Behavior) ===================== */
  // Window for sliders: past 30 days … next 14 days (local midnight steps)
  const CWFIS_PAST = 30, CWFIS_FUT = 14;
  const zeroTime = (d)=>{const c=new Date(d); c.setHours(0,0,0,0); return c;};
  const T0 = zeroTime(new Date());
  const addDays = (base, n)=>{ const d=new Date(base); d.setDate(d.getDate()+n); d.setHours(0,0,0,0); return d; };
  const yyyymmdd = (d)=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const niceDate = (d)=> d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'2-digit'});
  const dayDelta = (d)=> Math.round((zeroTime(d)-T0)/86400000);
  const dates = []; for(let i=-CWFIS_PAST;i<=CWFIS_FUT;i++) dates.push(addDays(T0,i));
  const cwfisLayerName = (baseCode, d) => {
    const delta = dayDelta(d), ymd = yyyymmdd(d);
    if (delta === 0) return `public:${baseCode}_current`;
    if (delta < 0)   return `public:${baseCode}${ymd}`;
    return `public:${baseCode}${ymd}${delta <= 2 ? 'sf' : 'xf'}`;
  };
  const annotate = (d)=> dayDelta(d)===0 ? 'Today' : (dayDelta(d)<0 ? `${niceDate(d)} · history` : `${niceDate(d)} · forecast ${dayDelta(d)<=2?'sf':'xf'}`);
  const CWFIS_WMS = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms';
  const legendScaleForZoom = (z)=>{
    const mpp = 156543.03392804097/Math.pow(2,z);
    return Math.round(mpp*96*39.3701);
  };
  // pass the EXACT layer name (already includes 'public:' + date/suffix)
const legendURLForLayer = (fullyQualifiedLayer)=>{
  const u = new URL(CWFIS_WMS);
  u.search = new URLSearchParams({
    service:'WMS', request:'GetLegendGraphic', format:'image/png', transparent:'true',
    layer: fullyQualifiedLayer, width:'12', height:'9', sld_version:'1.1.0',
    LEGEND_OPTIONS:'forceLabels:on;fontSize:11',
    scale: String(legendScaleForZoom(map.getZoom()))
  }).toString();
  return u.toString();
};

  // Create the three WMS layers (not added by default)
  const riskLayer = L.tileLayer.wms(CWFIS_WMS, {
    layers: cwfisLayerName('fdr', T0), format:'image/png', transparent:true, version:'1.3.0',
    opacity:.6, pane:'perimetersPane', attribution:'CWFIS © Natural Resources Canada'
  });
  const fwiLayer = L.tileLayer.wms(CWFIS_WMS, {
    layers: cwfisLayerName('fwi', T0), format:'image/png', transparent:true, version:'1.3.0',
    opacity:.65, pane:'perimetersPane', attribution:'CWFIS © Natural Resources Canada'
  });
  const fbpLayer = L.tileLayer.wms(CWFIS_WMS, {
    layers: cwfisLayerName('hfi', T0), format:'image/png', transparent:true, version:'1.3.0',
    opacity:.7, pane:'perimetersPane', attribution:'CWFIS © Natural Resources Canada'
  });

      // ---- NOAA Smoke timeline ----------------------------------------------
      // NOAA smoke service supports WMS capabilities via WMSServer endpoint
      const smokeWmsUrl = 'https://mapservices.weather.noaa.gov/raster/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer/WMSServer';
      const smokeLayer = L.tileLayer.wms(smokeWmsUrl, {
        layers: 'ndgd_smoke_sfc_1hr_avg_time:smoke_don_0921:massden@htgl',
        format: 'image/png',
        transparent: true,
        opacity: CONFIG.OPACITY.SMOKE,
        pane: 'smokePane',
        attribution: 'NOAA',
        version: '1.3.0',
        crs: L.CRS.EPSG3857
      }); // Removed .addTo(map) - smoke layer is now off by default

      const smokeControls   = $('#smokeControls');
      const smokePlayBtn    = $('#smokePlay');
      const smokeSlider     = $('#smokeTime');
      const smokeTsLabel    = $('#smokeTimestamp');
      let smokeTimesMs = [], smokeIdx = 0, smokeTimer = null;
      let smokeShouldAutoplayNextOn = false, smokePendingAutoplay = false;

      const smokeFmt = (ms) => {
        const d = new Date(ms);
        // Format in Atlantic time
        const atlanticOptions = { 
          timeZone: 'America/Halifax', // Atlantic timezone
          month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false 
        };
        const fullAtlanticOptions = { 
          timeZone: 'America/Halifax',
          year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false 
        };
        
        return isMobile()
          ? d.toLocaleString(undefined, atlanticOptions) + ' AT'
          : `${d.toLocaleString(undefined, fullAtlanticOptions)} (Atlantic)`;
      };

      function smokeSetIndex(i){
        if (!smokeTimesMs.length) {
          console.warn('No smoke times available');
          return;
        }
        smokeIdx = Math.max(0, Math.min(smokeTimesMs.length - 1, i));
        const t = smokeTimesMs[smokeIdx];
        const dt = new Date(t);
        const timeParam = dt.toISOString().split('.')[0]; // Remove milliseconds

        
        // Set the time parameter for the WMS layer (NOAA uses StdTime)
        smokeLayer.setParams({ 
          StdTime: timeParam,
          _: Date.now() // Cache busting parameter
        });
        
        smokeSlider.value = String(smokeIdx);
        smokeTsLabel.textContent = smokeFmt(t);
        
        // Force a refresh
        smokeLayer.redraw();
      }
      function smokePlay(){
        if (smokeTimer || !smokeTimesMs.length) return;
        smokePlayBtn.textContent = '⏸';
        smokeTimer = setInterval(() => smokeSetIndex((smokeIdx + 1) % smokeTimesMs.length), SMOKE_FRAME_MS);
      }
      function smokePause(){ smokePlayBtn.textContent = '▶'; if (smokeTimer){ clearInterval(smokeTimer); smokeTimer = null; } }
      smokePlayBtn.addEventListener('click', () => (smokeTimer ? smokePause() : smokePlay()));
      smokeSlider.addEventListener('input', (e) => { smokePause(); smokeSetIndex(parseInt(e.target.value, 10)); });

      const nearestIndex = (arr, target) => { let bestI = 0, bestD = Infinity; for (let i=0;i<arr.length;i++){ const d = Math.abs(arr[i]-target); if(d<bestD){ bestD=d; bestI=i; } } return bestI; };

      
async function initSmokeTimes(){
  const setLabel = (txt)=> smokeTsLabel.textContent = txt;
  try{
    setLabel('Loading…');
    let times = [];
    

    
    try {
      // Fetch WMS capabilities to get actual available times
      const capabilitiesUrl = `${NOAA_SMOKE_WMS_BASE_URL}?request=GetCapabilities&service=WMS`;
      const response = await fetch(capabilitiesUrl);
      const xmlText = await response.text();
      
      // Parse the XML to extract time dimension values
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      
      // Find the Dimension element with name="StdTime"
      const timeDimensions = xmlDoc.querySelectorAll('Dimension[name="StdTime"]');
      
      if (timeDimensions.length > 0) {
        const timeValues = timeDimensions[0].textContent.trim();
        // Split by comma and parse each time
        times = timeValues.split(',').map(timeStr => {
          return new Date(timeStr.trim()).getTime();
        }).filter(time => !isNaN(time)).sort((a, b) => a - b);
        

      } else {
        throw new Error('No StdTime dimension found in capabilities');
      }
    } catch (capError) {
      console.warn('Failed to fetch WMS capabilities, falling back to known time range:', capError.message);
      
      // Fallback: Use known NOAA service time range 

      
      // Create times based on known service range but limit to recent times
      const serviceStart = new Date('2025-07-22T03:00:00Z');
      const serviceEnd = new Date('2025-09-27T06:00:00Z');
      const currentTime = new Date();
      
      // Find a reasonable recent time range within the service bounds
      let startTime = new Date(Math.max(
        serviceStart.getTime(),
        currentTime.getTime() - (48 * 3600000) // 48 hours ago
      ));
      let endTime = new Date(Math.min(
        serviceEnd.getTime(),
        currentTime.getTime() + (48 * 3600000) // 48 hours ahead
      ));
      
      // Round start time to nearest hour
      startTime = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate(), startTime.getHours(), 0, 0, 0);
      
      // Generate hourly timestamps
      for (let time = new Date(startTime); time <= endTime; time.setHours(time.getHours() + 1)) {
        times.push(time.getTime());
      }
      

    }

    if(!times.length){ setLabel('No time frames available'); return; }

    // Use available times
    smokeTimesMs = times;
    smokeSlider.max = String(times.length - 1);
    
    // Find the closest time to current hour or use most recent
    const currentTime = new Date();
    let closestIdx = 0;
    let minDiff = Math.abs(times[0] - currentTime.getTime());
    
    for (let i = 1; i < times.length; i++) {
      const diff = Math.abs(times[i] - currentTime.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    
    // Start with the closest time to current, but prefer recent past over future
    smokeIdx = closestIdx;
    smokeSlider.value = String(smokeIdx);


    
    // If layer is already active, set the time immediately
    if (map.hasLayer(smokeLayer)) {
      smokeSetIndex(smokeIdx);
      if (smokePendingAutoplay || smokeShouldAutoplayNextOn) {
        smokePlay(); 
        smokePendingAutoplay = false; 
        smokeShouldAutoplayNextOn = false;
      }
    } else {
      // Just update the label for inactive layer
      setLabel(smokeFmt(times[smokeIdx]));
    }
  } catch (e){
    console.error('Smoke timeline load failed:', e);
    smokeTsLabel.textContent = 'Error loading smoke timeline - using fallback';
    
    // Emergency fallback if everything else fails
    if (!smokeTimesMs.length) {
      console.warn('Emergency fallback: creating basic time slots');
      const now = new Date();
      const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
      const startTime = new Date(currentHour.getTime() - (24 * 3600000));
      
      const emergencyTimes = [];
      for (let i = 0; i < 48; i++) {
        const time = new Date(startTime.getTime() + (i * 3600000));
        emergencyTimes.push(time.getTime());
      }
      
      smokeTimesMs = emergencyTimes;
      smokeSlider.max = String(emergencyTimes.length - 1);
      smokeIdx = Math.floor(emergencyTimes.length / 2); // Start in middle
      smokeSlider.value = String(smokeIdx);
      smokeTsLabel.textContent = smokeFmt(emergencyTimes[smokeIdx]);
    }
  }
}
initSmokeTimes();


      // ---- Mobile stacking & legend sizing ---------------------------------
      const safeProbe = $('#sai-probe');
      const getSafeBottom = () => (safeProbe?.offsetHeight || 0);
      const BASE_GAP = 10, LEGEND_SMOKE_GAP = 16, FOOTER_SMOKE_GAP = 10;

      function sizeLegendWidth(){
        const legend = D.querySelector('.leaflet-control-layers');
        if (!legend) return;
        const vvW = (window.visualViewport && window.visualViewport.width) || window.innerWidth || D.documentElement.clientWidth || 0;
        const cap = Math.max(240, Math.floor(vvW - 24));
        legend.style.maxWidth = cap + 'px';
        legend.style.width = 'fit-content';
        const desired = Math.min(legend.scrollWidth, cap);
        legend.style.width = desired + 'px';
        legend.style.overflowX = (legend.scrollWidth > desired) ? 'auto' : 'hidden';
        return desired;
      }

      function sizeLegendHeight(){
        const legend = D.querySelector('.leaflet-control-layers');
        if (!legend) return;

        const vvH = (window.visualViewport && window.visualViewport.height) || window.innerHeight || D.documentElement.clientHeight || 0;
        const rect = legend.getBoundingClientRect();
        const topY = Math.max(0, rect.top);

        const footer = $('.nb-footer');
        const footerH = footer?.getBoundingClientRect().height || 0;

        // OPTIONAL #4: treat smoke as "external" only if not inline
        const smokeVisible = (getComputedStyle(smokeControls).display !== 'none') && !smokeControls.classList.contains('inline');
        const smokeH = smokeVisible ? (smokeControls.getBoundingClientRect().height || 0) : 0;

        const safeB = getSafeBottom();
        const reserve = footerH + (smokeVisible ? (smokeH + LEGEND_SMOKE_GAP) : 0) + (BASE_GAP * 2) + safeB + 8;
        const maxH = Math.max(120, Math.floor(vvH - topY - reserve));

        legend.style.maxHeight = maxH + 'px';
        legend.style.overflowY = 'auto';
        legend.style.webkitOverflowScrolling = 'touch';
      }

      const sizeLegend = () => { sizeLegendWidth(); sizeLegendHeight(); };
      const rAF = (fn)=>requestAnimationFrame(()=>requestAnimationFrame(fn));

      function onGlobalReflow(){
        requestAnimationFrame(() => {
          sizeLegend();
          layoutTitleBox();
          const t = smokeTimesMs[smokeIdx];
          if (smokeTimesMs.length && t != null) smokeTsLabel.textContent = smokeFmt(t);
        });
      }
      const updateBottomStackAndLegend = ()=>{
        const mobile = isMobile();
        const root = D.documentElement;
        if (!mobile){
          root.style.setProperty('--fs-bottom', '86px');
          root.style.setProperty('--smoke-bottom', '28px');
          root.style.setProperty('--legend-bottom-reserve', '180px');
          sizeLegend(); return;
        }
        const footer = $('.nb-footer');
        const footerH = footer?.getBoundingClientRect().height || 0;

        // OPTIONAL #4: ignore inline smoke when reserving bottom
        const smokeVisible = (getComputedStyle(smokeControls).display !== 'none') && !smokeControls.classList.contains('inline');
        const smokeH = smokeVisible ? (smokeControls.getBoundingClientRect().height || 0) : 0;
        const safeB = getSafeBottom();

        const smokeBottom = footerH + FOOTER_SMOKE_GAP + safeB + FOOTER_SMOKE_GAP;
        root.style.setProperty('--smoke-bottom', smokeBottom + 'px');
        root.style.setProperty('--fs-bottom', (footerH + FOOTER_SMOKE_GAP + safeB + FOOTER_SMOKE_GAP) + 'px');

        const reserve = footerH + (smokeVisible ? (smokeH + LEGEND_SMOKE_GAP) : 0) + (BASE_GAP * 2) + safeB + 8;
        root.style.setProperty('--legend-bottom-reserve', Math.max(140, Math.round(reserve)) + 'px');

        sizeLegend();
      };

      updateBottomStackAndLegend();
      layoutTitleBox();

      window.addEventListener('resize', onGlobalReflow, { passive:true });
      window.addEventListener('orientationchange', () => rAF(onGlobalReflow), { passive:true });
      if (window.visualViewport){
        const onVV = () => rAF(onGlobalReflow);
        visualViewport.addEventListener('resize', onVV, { passive:true });
        visualViewport.addEventListener('scroll', onVV, { passive:true });
      }
      if (document.fonts && document.fonts.ready) { document.fonts.ready.then(() => rAF(onGlobalReflow)); }

      // NOTE: We will replace the original smoke overlayadd/overlayremove handlers
      // with inline-mount versions AFTER the Layers control is built.

      const ro = ('ResizeObserver' in window) ? new ResizeObserver(() => rAF(onGlobalReflow)) : null;
      ro?.observe(smokeControls);
      const footerEl = $('.nb-footer'); footerEl && ro?.observe(footerEl);

      // AQHI
      const aqhiLayer = L.esri.featureLayer({
        url:'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/aqhi_stations_observations_realtime/FeatureServer/1',
        pane:'aqiPane',
        pointToLayer:(feature,latlng)=> {
          const p=feature.properties||{};
          const raw=p.aqhi??p.aqhi_round; const val=(raw==null||Number.isNaN(Number(raw)))?null:Number(raw);
          const label=val==null?'—':val>=10?'Very High Risk':val>=7?'High Risk':val>=4?'Moderate Risk':'Low Risk';
          const color=val==null?'#6b7280':val>=10?'#8b5cf6':val>=7?'#ef4444':val>=4?'#eab308':'#22c55e';
          const icon=L.divIcon({className:'aqi-badge-icon',html:`
            <div style="display:flex;flex-direction:column;align-items:center;">
              <svg width="26" height="26" viewBox="0 0 26 26" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.25));">
                <circle cx="13" cy="13" r="11" stroke="#111827" stroke-width="2" fill="${color}" />
              </svg>
              <div style="margin-top:2px;font-size:12px;font-weight:800;color:var(--text);background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:4px 8px;line-height:1.15;text-align:center;box-shadow:var(--shadow-soft)">
                AQHI ${val ?? '—'} <span style="opacity:.8">${label}</span>
              </div>
            </div>`, iconSize:[28,48], iconAnchor:[14,24], popupAnchor:[0,-22]});
          const m=L.marker(latlng,{icon});
          const loc=p.location_name_en||''; const when=p.observation_datetime_text_en||'';
          m.bindTooltip(`${loc?loc+' — ':''}AQHI ${val ?? '—'} • ${label}${when?' • '+when:''}`,{direction:'top',offset:[0,-20],opacity:0});
          return m;
        }
      });

      // ---- Aircraft ---------------------------------------------------------
      const planesLayer = L.layerGroup();
      const planeMarkers=new Map();
      const planeIcon=(heading)=> L.divIcon({
        className:'plane-div-icon',
        html:`<div style="transform:rotate(-45deg);transform-origin:center;display:inline-block;">
                <div style="transform:rotate(${Number.isFinite(heading)?heading:0}deg);font-size:26px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.25))">✈️</div>
              </div>`,
        iconSize:[30,46],iconAnchor:[15,23]
      });
      const upsertPlane=(id,lat,lon,hdg,callsign,vel)=> {
        const html = `<b>${callsign||'Unknown'}</b><br>Heading: ${Number.isFinite(hdg)?Math.round(hdg):'—'}°<br>Speed: ${vel!=null?Math.round(vel*1.94384):'—'} kt`;
        let m=planeMarkers.get(id);
        if(!m){
          m=L.marker([lat,lon],{icon:planeIcon(hdg),pane:'planesPane',keyboard:false,zIndexOffset:10000}).bindPopup(html,{pane:'alwaysOnTopPopup'});
          bindHoverTogglePopup(m);
          m.addTo(planesLayer); planeMarkers.set(id,m);
        } else {
          m.setLatLng([lat,lon]); m.setIcon(planeIcon(hdg)); m.setPopupContent(html);
        }
      };
      const pruneMissing=(seen)=>{ for(const [k,m] of planeMarkers.entries()){ if(!seen.has(k)){ planesLayer.removeLayer(m); planeMarkers.delete(k); } } };
      async function fetchOpenSky(){ try{
        const [[lamin,lomin],[lamax,lomax]] = NB_BOUNDS;
        const r=await fetch(`${OPEN_SKY_URL}?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`, { cache:'no-store' });
        if(!r.ok) throw new Error(r.statusText);
        const data=await r.json(); const states=Array.isArray(data.states)?data.states:[]; const seen=new Set();
        for(const s of states){
          const icao24=s[0], callsign=(s[1]||'').trim().toUpperCase(), lon=s[5], lat=s[6], vel=s[9], hdg=s[10];
          if(!icao24||lat==null||lon==null) continue; seen.add(icao24); upsertPlane(icao24,lat,lon,hdg,callsign,vel);
        }
        pruneMissing(seen);
      } catch(e){ console.warn('OpenSky fetch failed:', e); } }
      let planesTimer=null;
      planesLayer.on('add',()=>{ fetchOpenSky(); if(!planesTimer) planesTimer=setInterval(fetchOpenSky, PLANES_REFRESH_MS); });
      planesLayer.on('remove',()=>{ if(planesTimer){ clearInterval(planesTimer); planesTimer=null; } });

      // ---- City labels with zoom-based visibility ------------------------------------------------------
      const CITY_DATA = [
        // Major cities (50,000+)
        ['Moncton',46.0878,-64.7782,79000],['Saint John',45.2733,-66.0633,69000],['Fredericton',45.9636,-66.6431,63000],
        
        // Large cities (15,000+)
        ['Dieppe',46.0842,-64.6877,28500],['Riverview',46.0617,-64.8052,20500],['Miramichi',47.0281,-65.5019,17500],
        ['Quispamsis',45.4319,-65.9469,19500],['Edmundston',47.3730,-68.3251,16000],
        
        // Medium cities (5,000-15,000)
        ['Rothesay',45.3830,-65.9965,12000],['Bathurst',47.6186,-65.6517,12000],['Oromocto',45.8491,-66.4828,9500],
        ['Shediac',46.2197,-64.5403,7000],['Campbellton',48.0075,-66.6731,6700],['Sackville',45.8960,-64.3688,5500],
        ['Grand Bay-Westfield',45.3629,-66.2306,5200],['Woodstock',46.1527,-67.6016,5200],['Grand Falls',47.0469,-67.7394,5200],
        ['Memramcook',46.0020,-64.5480,5000],
        
        // Small cities (2,000-5,000)
        ['Tracadie',47.5081,-64.9117,4800],['St. Stephen',45.1942,-67.2756,4500],['Hampton',45.5322,-65.8332,4400],
        ['Sussex',45.7221,-65.5060,4300],['Caraquet',47.7943,-64.9386,4200],['Dalhousie',48.0658,-66.3737,2900],
        ['Shippagan',47.7400,-64.7078,2700],['Bouctouche',46.4711,-64.7400,2400],['Minto',46.1480,-66.0840,2400],
        ['Cap-Pelé',46.2260,-64.2750,2400],['Saint-Quentin',47.5120,-67.3920,2100],['St. Andrews',45.0730,-67.0530,2100],
        
        // Towns (1,000-2,000)
        ['Perth-Andover',46.7372,-67.7089,1600],['Florenceville-Bristol',46.4448,-67.6170,1600],['Neguac',47.2420,-65.0580,1500],
        ['St. George',45.1290,-66.8270,1500],['Petit-Rocher',47.7900,-65.7130,1400],['Bas-Caraquet',47.7860,-64.9730,1400],
        ['Richibucto',46.6770,-64.8710,1300],['Saint-Léonard',47.1640,-67.9250,1300],['Hillsborough',45.9190,-64.7630,1300],
        ['Rogersville',46.7370,-65.4380,1200],['Chipman',46.1680,-65.8820,1200],['McAdam',45.5940,-67.3250,1100],
        ['Plaster Rock',46.9108,-67.3949,1100],
        
        // Villages & small towns (under 1,000)
        ['Nackawic',45.9960,-67.2510,950],['Hartland',46.2990,-67.5150,950],['Kedgwick',47.6450,-67.3430,950],
        ['Blacks Harbour',45.0520,-66.7880,900],['Rexton',46.6490,-64.8750,830],['Doaktown',46.5550,-66.1180,800]
      ];

      // City zoom thresholds based on population
      const getCityZoomThreshold = (pop) => {
        if (pop >= 50000) return 6;  // Major cities (Moncton, Saint John, Fredericton)
        if (pop >= 15000) return 7;  // Large cities (Dieppe, Riverview, Miramichi, etc.)
        if (pop >= 5000) return 8;   // Medium cities
        if (pop >= 2000) return 9;   // Small cities
        return 10;                   // Towns and villages
      };

      let cityMarkers = [];
      let cityClusters = null;

      function makeCityMarker(name, lat, lng, pop) {
        const marker = L.marker([lat, lng], { 
          icon: L.divIcon({ html:'', iconSize:[0,0] }), 
          interactive: true, 
          zIndexOffset: 1000 
        }).bindTooltip(`<span class="city-label">${name}</span>`, { 
          permanent: true, 
          direction: 'top', 
          className: 'city-label-tooltip', 
          interactive: true 
        });
        
        marker.options._name = name;
        marker.options._pop = Number.isFinite(pop) ? pop : 0;
        marker.options._zoomThreshold = getCityZoomThreshold(pop);
        
        const handler = () => cityToFires(name, marker.getLatLng());
        marker.on('click', handler);
        marker.getTooltip()?.on('click', handler);
        return marker;
      }

      // Create all city markers
      CITY_DATA.forEach(([name, lat, lng, pop]) => {
        cityMarkers.push(makeCityMarker(name, lat, lng, pop));
      });

      // Create a layer group for cities with zoom-based visibility
      const cityLayer = L.layerGroup();
      
      function updateCityVisibility() {
        const zoom = map.getZoom();
        const bounds = map.getBounds();
        
        // Clear current cities
        cityLayer.clearLayers();
        
        // Filter cities that should be visible at current zoom
        const visibleCities = cityMarkers.filter(marker => 
          zoom >= marker.options._zoomThreshold
        );

        // Always check for clustering at all zoom levels
        const clusteredCities = clusterNearbyCities(visibleCities, zoom);
        clusteredCities.forEach(item => cityLayer.addLayer(item));
      }

      function clusterNearbyCities(cities, zoom) {
        const result = [];
        const processed = new Set();
        
        // Adjust clustering distance based on zoom level (in screen pixels)
        const pixelThreshold = 80; // pixels - cities closer than this will cluster
        
        cities.forEach(city => {
          if (processed.has(city)) return;
          
          const cityPoint = map.latLngToContainerPoint(city.getLatLng());
          
          const nearbyCities = cities.filter(other => {
            if (processed.has(other) || other === city) return false;
            
            const otherPoint = map.latLngToContainerPoint(other.getLatLng());
            const pixelDistance = Math.sqrt(
              Math.pow(cityPoint.x - otherPoint.x, 2) + 
              Math.pow(cityPoint.y - otherPoint.y, 2)
            );
            
            return pixelDistance < pixelThreshold;
          });

          if (nearbyCities.length > 0) {
            // Create cluster with largest city name and position
            const allCities = [city, ...nearbyCities];
            const largestCity = allCities.reduce((max, current) => 
              current.options._pop > max.options._pop ? current : max
            );
            
            // Sort cities by population for display order
            const sortedCities = allCities.sort((a, b) => b.options._pop - a.options._pop);
            const otherCitiesCount = sortedCities.length - 1;
            
            // Create cluster marker at largest city position
            const clusterMarker = L.marker(largestCity.getLatLng(), {
              icon: L.divIcon({ html:'', iconSize:[0,0] }), 
              interactive: true, 
              zIndexOffset: 1000 
            }).bindTooltip(`<span class="city-label">${largestCity.options._name}</span>`, { 
              permanent: true, 
              direction: 'top', 
              className: 'city-label-tooltip', 
              interactive: true 
            });

            const handler = () => cityToFires(largestCity.options._name, largestCity.getLatLng());
            clusterMarker.on('click', handler);
            clusterMarker.getTooltip()?.on('click', handler);
            
            result.push(clusterMarker);
            allCities.forEach(c => processed.add(c));
          } else {
            result.push(city);
            processed.add(city);
          }
        });

        return result;
      }

      // Set up zoom event listener
      map.on('zoomend moveend', updateCityVisibility);
      
      // Initial city visibility setup
      updateCityVisibility();
      cityLayer.addTo(map);

      // ---- Overlays & control ----------------------------------------------
      
// ==== NB External Layers (OFF by default; lazy-loaded) ====
const ferriesLayer = L.markerClusterGroup({ pane: 'firesPane',
  disableClusteringAtZoom: 10,
  spiderfyOnMaxZoom: true,
  zoomToBoundsOnClick: false,
  showCoverageOnHover: false,
  iconCreateFunction: (cluster) => {
    const markers = cluster.getAllChildMarkers();
    // Compute worst status among children: red > yellow > green
    let worst = -1, color = '#27ae60'; // default green
    for (const m of markers) {
      const sev = Number.isFinite(m.options._fSeverity) ? m.options._fSeverity : 0;
      if (sev > worst) worst = sev;
    }
    if (worst >= 2) color = '#e74c3c'; else if (worst === 1) color = '#f1c40f';
    const count = markers.length;
    return L.divIcon({
      className: 'ferry-cluster-icon',
      html: `<div class="marker-badge" style="--ring:${color};position:relative"><i class="fa-solid fa-ferry"></i><b style="position:absolute;right:-6px;bottom:-6px;font:700 12px/1 Inter,system-ui,sans-serif;background:#fff;border:2px solid var(--ring);padding:2px 5px;border-radius:999px;min-width:20px;text-align:center">${count}</b></div>`,
      iconSize: [38, 38],
      iconAnchor: [22, 28]
    });
  }
});
const webcamsLayer = L.markerClusterGroup({
  pane: 'firesPane',
  disableClusteringAtZoom: 11,
  spiderfyOnMaxZoom: true,
  zoomToBoundsOnClick: false,
  showCoverageOnHover: false,
  iconCreateFunction: (cluster) => {
    const count = cluster.getChildCount();
    const color = '#1f6feb';
    return L.divIcon({
      className: 'webcam-cluster-icon',
      html: `<div class="marker-badge" style="--ring:${color};position:relative"><i class="fa-solid fa-camera"></i><b style="position:absolute;right:-6px;bottom:-6px;font:700 12px/1 Inter,system-ui,sans-serif;background:#fff;border:2px solid var(--ring);padding:2px 5px;border-radius:999px;min-width:20px;text-align:center">${count}</b></div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 26]
    });
  }
});
const eventsPointLayer = L.markerClusterGroup({
  pane: 'firesPane',
  disableClusteringAtZoom: 15,
  spiderfyOnMaxZoom: true,
  zoomToBoundsOnClick: false,
  showCoverageOnHover: false,
  maxClusterRadius: 80,
  iconCreateFunction: (cluster) => {
    const markers = cluster.getAllChildMarkers();
    const count = markers.length;
    
    // Find the most severe event for the cluster icon
    let mostSevere = null;
    let highestRank = -1;
    
    for (const marker of markers) {
      const event = marker.options._eventData;
      if (event) {
        try {
          const rank = getEventSeverityRank(event);
          if (rank > highestRank) {
            highestRank = rank;
            mostSevere = event;
          }
        } catch (e) {
          console.warn('Error getting severity rank:', e);
        }
      }
    }
    
    // Use the most severe event for styling, or default
    let color = '#6b7280';
    let iconClass = 'fa-solid fa-road';
    
    if (mostSevere) {
      try {
        const startDate = mostSevere.StartDate ? mostSevere.StartDate * 1000 : null;
        color = getColorForType(mostSevere.EventType, mostSevere.EventSubType, mostSevere.IsFullClosure, startDate);
        
        // Choose icon based on category (same logic as individual markers)
        const category = getEventCategory(mostSevere.EventType, mostSevere.EventSubType, startDate);
        
        if (category === 'closures' || category === 'futureClosures') {
          iconClass = 'fa-solid fa-ban';
        } else if (category === 'incidents') {
          iconClass = 'fa-solid fa-triangle-exclamation';
        } else if (category === 'construction' || category === 'futureConstruction') {
          iconClass = 'fa-solid fa-person-digging';
        } else if (category === 'flooding') {
          iconClass = 'fa-solid fa-water';
        } else {
          iconClass = 'fa-solid fa-road';
        }
      } catch (e) {
        console.warn('Error creating cluster icon:', e);
      }
    }
    
    return L.divIcon({
      className: 'event-cluster-icon',
      html: `<div class="cluster-square" style="--color:${color};--size:28px;width:28px;height:28px;background:${color};border:2px solid white;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;position:relative;">
               <i class="${iconClass}" style="font-size:14px;color:white;text-shadow:0 1px 2px rgba(0,0,0,0.3);"></i>
               <b style="position:absolute;right:-6px;bottom:-6px;font:700 12px/1 Inter,system-ui,sans-serif;background:#fff;border:2px solid ${color};padding:2px 5px;border-radius:999px;min-width:20px;text-align:center">${count}</b>
             </div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 26]
    });
  }
});
const eventsLineLayer = L.layerGroup({ pane: 'firesPane' });
const eventsDetourLayer = L.layerGroup({ pane: 'firesPane' });
const eventsCombined = L.layerGroup({ pane: 'firesPane' });
const winterRoadsLayer = L.layerGroup({ pane: 'radarPane' });
const cityProximityLayer = L.layerGroup({ pane: 'firesPane' });

// All icon functions, color constants, and utilities now handled by DataLoadingManager
const statusColor = DataLoadingManager.getStatusColor;
const POINT_COLORS = DataLoadingManager.POINT_COLORS;
const WINTER_COLORS = DataLoadingManager.WINTER_COLORS;
const { getColorForType, getEventStyle, createEventIcon, getEventSeverityRank, getEventCategory } = DataLoadingManager;
const epochToLocal = DataLoadingManager.epochToLocal;
const webcamIcon = DataLoadingManager.createWebcamIcon();

let _ferriesLoaded=false, _webcamsLoaded=false, _eventsLoaded=false, _winterLoaded=false;

async function loadFerries(){
  if (_ferriesLoaded) return;
  try {
    // Use DataLoadingManager but maintain custom styling
    await DataLoadingManager.loadFerries(ferriesLayer);
    _ferriesLoaded = true;
    zoomUtils.setupClusterZoomControl(ferriesLayer);
  } catch(e) { 
    console.error('Ferries layer load failed', e); 
  }

}
async function loadWebcams(){

  if (_webcamsLoaded) return;
  try {
    const r = await fetch('webcams.json',{cache:'no-store'});
    const cams = await r.json();
    
    (cams||[]).forEach(cam => {
      const m = L.marker([cam.Latitude, cam.Longitude], { icon: webcamIcon, title: cam.Name||'Webcam' });
      const popupHTML = window.NBFireMapPopupUtils.buildWebcamPopup(cam);
      m.bindPopup(popupHTML).on('popupopen', (e) => {
        window.NBFireMapPopupUtils.initWebcamPopupImages(e.popup.getElement());
      }).addTo(webcamsLayer);
    });
    _webcamsLoaded = true;
    zoomUtils.setupClusterZoomControl(webcamsLayer);
    if (!window._webcamRefreshTimer) {
      window._webcamRefreshTimer = setInterval(() => {
        const openPopup = document.querySelector('.leaflet-popup-content');
        if (openPopup) initPopupImages(openPopup);
      }, 30_000);
    }
  } catch(e) { console.error('Webcams layer load failed', e); }

}
async function loadEvents(){

  if (_eventsLoaded) return;
  
  // Initialize storage arrays for category filtering BEFORE processing events
  if (!window._eventMarkersByCategory) {
    window._eventMarkersByCategory = {
      closures: [],
      futureClosures: [],
      incidents: [],
      construction: [],
      futureConstruction: [],
      flooding: []
    };
  }
  
  if (!window._eventLinesByCategory) {
    window._eventLinesByCategory = {
      closures: [],
      futureClosures: [],
      incidents: [],  
      construction: [],
      futureConstruction: [],
      flooding: []
    };
  }
  
  try {
    const r = await fetch('events.json',{cache:'no-store'});
    const data = await r.json();
    console.log(`Loaded ${data.length} events from events.json`);

    function addPoint(e){
      if (typeof e.Latitude !== 'number' || typeof e.Longitude !== 'number') return;
      const icon = createEventIcon(e);
      const marker = L.marker([e.Latitude, e.Longitude], { icon })
        .bindPopup(window.NBFireMapPopupUtils.buildEventPopup(e));
      
      // Store event data for clustering and filtering
      marker.options._eventData = e;
      const category = window.NBFireMapDataLoadingManager.getEventCategory(e.EventType, e.EventSubType, e.StartDate);
      marker._eventCategory = category;
      
      console.log(`Adding marker for event: ${e.EventType}/${e.EventSubType} -> category: ${category}`);
      
      // Add to category tracking
      if (window._eventMarkersByCategory && window._eventMarkersByCategory[category]) {
        window._eventMarkersByCategory[category].push(marker);
        console.log(`Stored marker in ${category} category, now has ${window._eventMarkersByCategory[category].length} markers`);
      } else {
        console.warn(`Could not store marker - category ${category} not found in storage`, Object.keys(window._eventMarkersByCategory || {}));
      }
      
      marker.addTo(eventsPointLayer);
      // Removed secondary points and connecting lines for cleaner display
    }

    
const LINE_STYLES = {
  fullClosure: { color: '#dc2626', weight: 6, opacity: 1.0 },      // bright red for full closures
  partialClosure: { color: '#f59e0b', weight: 4, opacity: 0.9 },   // amber for partial closures  
  detour: { color: '#0891b2', weight: 4, dashArray: '12,8', opacity: 1.0 } // bright cyan for detours
};
function addEncodedLine(encoded, event){
      try{
        const coords = polyline.decode(encoded).map(([lat, lng]) => [lat, lng]);
        if (coords && coords.length){
          const lineStyle = event.IsFullClosure ? LINE_STYLES.fullClosure : LINE_STYLES.partialClosure;
          const pl = L.polyline(coords, lineStyle);
          pl.bindPopup(window.NBFireMapPopupUtils.buildEventPopup(event));
          
          // Store event data for category filtering
          const category = window.NBFireMapDataLoadingManager.getEventCategory(event.EventType, event.EventSubType, event.StartDate);
          pl._eventCategory = category;
          pl._isDetour = false;
          
          // Add to category tracking
          if (window._eventLinesByCategory && window._eventLinesByCategory[category]) {
            window._eventLinesByCategory[category].push(pl);
          }
          
          // Add only to individual line layer - zoom control will manage combined layer
          pl.addTo(eventsLineLayer);
        }
      }catch(e){}
    }

    function addDetourLine(encoded, event){
      try{
        const coords = polyline.decode(encoded).map(([lat, lng]) => [lat, lng]);
        if (coords && coords.length){
          const pl = L.polyline(coords, LINE_STYLES.detour);
          const detourPopup = '<b><i class="fas fa-route" style="color: #0891b2;"></i> Detour</b><br/>' + window.NBFireMapPopupUtils.buildEventPopup(event);
          pl.bindPopup(detourPopup);
          
          // Store event data for category filtering
          const category = window.NBFireMapDataLoadingManager.getEventCategory(event.EventType, event.EventSubType, event.StartDate);
          pl._eventCategory = category;
          pl._isDetour = true;
          
          // Add to category tracking
          if (window._eventLinesByCategory && window._eventLinesByCategory[category]) {
            window._eventLinesByCategory[category].push(pl);
          }
          
          // Add only to individual detour layer - zoom control will manage combined layer
          pl.addTo(eventsDetourLayer);
        }
      }catch(e){}
    }

    (data||[]).forEach(e => {
      addPoint(e);
      if (e.EncodedPolyline && e.EncodedPolyline.trim()) addEncodedLine(e.EncodedPolyline.trim(), e);
      if (e.DetourPolyline && e.DetourPolyline.trim()) addDetourLine(e.DetourPolyline.trim(), e);
    });
    
    // Add the clustering layer to the combined layer
    eventsCombined.addLayer(eventsPointLayer);
    
    // Initialize line layer control states
    if (typeof window._eventsLinesEnabled === 'undefined') window._eventsLinesEnabled = true;
    if (typeof window._eventsDetoursEnabled === 'undefined') window._eventsDetoursEnabled = true;
    
    // Set up zoom-based line visibility control
    window.updateLineVisibility = () => {
      const currentZoom = map.getZoom();
      const showLines = currentZoom >= 11;
      
      // Show/hide line layers based on zoom level
      if (showLines) {
        if (!eventsCombined.hasLayer(eventsLineLayer)) {
          eventsCombined.addLayer(eventsLineLayer);
        }
        if (!eventsCombined.hasLayer(eventsDetourLayer)) {
          eventsCombined.addLayer(eventsDetourLayer);
        }
      } else {
        if (eventsCombined.hasLayer(eventsLineLayer)) {
          eventsCombined.removeLayer(eventsLineLayer);
        }
        if (eventsCombined.hasLayer(eventsDetourLayer)) {
          eventsCombined.removeLayer(eventsDetourLayer);
        }
      }
    };
    
    // Set up zoom event listener and initial visibility
    map.off('zoomend', window.updateLineVisibility); // Remove any existing listeners
    map.on('zoomend', window.updateLineVisibility);
    window.updateLineVisibility(); // Set initial state
    
    _eventsLoaded = true;
    zoomUtils.setupClusterZoomControl(eventsPointLayer);
    
    // Apply initial filtering based on legend toggle states if filtering function exists
    setTimeout(() => {
      if (window.filterMarkersAndLinesByCategory) {
        console.log('Applying initial event filtering...');
        window.filterMarkersAndLinesByCategory();
      }
    }, 500); // Wait for legend to be mounted
    
  } catch(e) { console.error('Events layer load failed', e); }

}
async function loadWinterRoads(){

  if (_winterLoaded) return;
  try{
    const r = await fetch('winterroads.json',{cache:'no-store'});
    const rows = await r.json();
    const list = Array.isArray(rows?.features) ? rows.features.map(f => f.properties||f) :
                 Array.isArray(rows) ? rows : [];
    list.forEach(row => {
      const enc = row.EncodedPolyline || row.encodedPolyline || row.polyline;
      if (!enc || !window.polyline) return;
      let coords; try{ coords = polyline.decode(enc).map(([lat,lng]) => [lat,lng]); } catch { return; }
      const cond = row['Primary Condition'] || row.primaryCondition || 'Unknown';
      const line = L.polyline(coords, { color: (WINTER_COLORS[cond] || WINTER_COLORS['Unknown']), weight: 4, opacity: 0.9 }).addTo(winterRoadsLayer);
      const popupHTML = window.NBFireMapPopupUtils.buildWinterRoadPopup(row);
      line.bindPopup(popupHTML);
    });
    _winterLoaded = true;
  }catch(e){ console.error('Winter roads layer load failed', e); }

}
// Lazy-load on first enable
if (typeof map !== 'undefined' && map && map.on){
  map.on('overlayadd', (e)=>{
    if (e.layer === ferriesLayer) loadFerries();
    if (e.layer === webcamsLayer) loadWebcams();
    if (e.layer === eventsCombined || e.layer === eventsPointLayer || e.layer === eventsLineLayer || e.layer === eventsDetourLayer) loadEvents();
    if (e.layer === winterRoadsLayer) loadWinterRoads();
  });
}
      // Create grouped overlays for better organization
      const overlays = {
        // Fire & Emergency
        'Fire Perimeters': activePerimeters,
        'CWFIS Hotspots (24h)': cwfis24,
        'CWFIS Hotspots (7d)': cwfis7,
        'NB Burn Bans': nbBurnBans,
        
        // Fire Weather
        'Fire Risk': riskLayer,
        'Fire Weather': fwiLayer,
        'Fire Behavior': fbpLayer,
        'Smoke': smokeLayer,
        
        // Weather & Environment
        'Weather Stations': weatherStations,
        'Weather Radar': noaaRadar,
        'Lightning': lightningLayer,
        'AQHI Risk': aqhiLayer,
        
        // Transportation
        'Road Events': eventsCombined,
        'Winter Roads': winterRoadsLayer,
        'Ferries': ferriesLayer,
        'Road Webcams': webcamsLayer,
        'Aircraft': planesLayer,
        
        // Geographic
        'Cities & Towns': cityLayer,
        'Crown Land': crownProxy,
        'Counties': counties,
        'Satellite Imagery': sentinel2
      };
      
      const layerControl = L.control.layers(null, overlays, { 
        collapsed: false,
        sortLayers: false // Preserve our grouping order
      }).addTo(map);

      // Style and organize the legend after creation
      function styleLegend() {
        const overlaysList = D.querySelector('.leaflet-control-layers-overlays');
        if (!overlaysList) return;
        
        // Preserve fire status panel if it exists
        const fireStatusPanel = overlaysList.querySelector('.fire-filter-block');
        
        // Collect all original layer labels (preserve event listeners)
        const allLayers = Array.from(overlaysList.querySelectorAll('label')).filter(label => 
          !label.closest('.fire-filter-block')
        );
        
        const groups = [
          { title: 'Fire & Emergency', items: ['Fire Perimeters', 'CWFIS Hotspots (24h)', 'CWFIS Hotspots (7d)', 'NB Burn Bans'] },
          { title: 'Fire Weather', items: ['Fire Risk', 'Fire Weather', 'Fire Behavior', 'Smoke'] },
          { title: 'Weather & Environment', items: ['Weather Stations', 'Weather Radar', 'Lightning', 'AQHI Risk'] },
          { title: 'Transportation', items: ['Road Events', 'Winter Roads', 'Ferries', 'Road Webcams', 'Aircraft'] },
          { title: 'Geographic', items: ['Cities & Towns', 'Crown Land', 'Counties', 'Satellite Imagery'] }
        ];
        
        // Create a map of layer name to original element
        const layerMap = new Map();
        allLayers.forEach(label => {
          const text = label.querySelector('.text') || label.querySelector('span:last-child');
          if (text) {
            layerMap.set(text.textContent.trim(), label);
          }
        });
        
        // Clear and rebuild with groups (but preserve original elements)
        overlaysList.innerHTML = '';
        
        // Re-add fire status panel at the top if it existed
        if (fireStatusPanel) {
          overlaysList.appendChild(fireStatusPanel);
        }
        
        groups.forEach((group, groupIndex) => {
          // Add group header
          const header = D.createElement('div');
          header.className = 'legend-group-header';
          header.textContent = group.title;
          overlaysList.appendChild(header);
          
          // Add group container
          const container = D.createElement('div');
          container.className = 'legend-group';
          
          // Find and move original layers for this group (preserves event listeners)
          group.items.forEach(itemName => {
            const originalLabel = layerMap.get(itemName);
            if (originalLabel) {
              container.appendChild(originalLabel);
            }
          });
          
          overlaysList.appendChild(container);
        });
      }
      
      // ---- Fire-status filter checkboxes in legend --------------------------
      const FIRE_STATUS = [
        ['Out of Control',  FireDataManager.getColorConfig().oc,  true],
        ['Being Monitored', FireDataManager.getColorConfig().mon, true],
        ['Contained',       FireDataManager.getColorConfig().cont,true],
        ['Under Control',   FireDataManager.getColorConfig().uc,  true],
        ['Being Patrolled', FireDataManager.getColorConfig().pat, true],
        ['Extinguished',    '#0000FF',  false]
      ];
      function injectFireStatusPanel(){
        const overlaysList = D.querySelector('.leaflet-control-layers-overlays');
        if(!overlaysList || overlaysList.querySelector('.fire-filter-block')) return;
        const block = D.createElement('div');
        block.className = 'fire-filter-block';
        block.innerHTML = `
          <div class="fire-filter-title">Fire Status</div>
          ${FIRE_STATUS.map(([label, ring, checked]) => `
            <label class="fire-filter-row" style="display:grid;grid-template-columns:18px 26px 1fr;align-items:center;gap:8px;margin:4px 0;">
              <input type="checkbox" data-status="${label}" ${checked ? 'checked' : ''} />
              <span class="legend-badge" style="--ring:${ring}">
                <i class="fa-solid fa-fire"></i>
              </span>
              <span class="text">${label}</span>
            </label>
          `).join('')}
        `;
        overlaysList.prepend(block);
        block.addEventListener('change', () => { ensureFireClusters(); applyFireFilter(); });
        requestAnimationFrame(sizeLegend);
      }
      
      // Inject fire status panel first, then apply styling
      injectFireStatusPanel();
      setTimeout(styleLegend, 100);

      // ---- Move basemap toggle into legend (but keep summary in bottom panel) ----
      function mountBasemapInLegend(){
        const layersBox = D.querySelector('.leaflet-control-layers');
        if (!layersBox) return;
        const topbar = D.createElement('div');
        topbar.className = 'overview-topbar';
        
        // Basemap toggle (Imagery / OSM) lives in the Overview topbar
        const baseCtl = D.createElement('div');
        baseCtl.className = 'basemap-toggle';
        const currentBase = localStorage.getItem('basemap') || 'imagery';
        baseCtl.innerHTML = `
          <fieldset class="basemap-seg" role="radiogroup" aria-label="Basemap">
            <label><input type="radio" name="basemap" value="imagery" ${currentBase!=='osm'?'checked':''}> Imagery</label>
            <label><input type="radio" name="basemap" value="osm" ${currentBase==='osm'?'checked':''}> Street Map</label>
          </fieldset>
        `;
        baseCtl.addEventListener('change', (e)=>{
          const v = e.target?.value;
          if(v==='imagery' || v==='osm') setBasemap(v);
        });
        topbar.append(baseCtl);

        layersBox.prepend(topbar);
        requestAnimationFrame(sizeLegend);
      }
      mountBasemapInLegend();

      // ---- New UI Button Handlers -------------------------------------------
      function setupNewUIButtons() {
        // Fire Watch button - opens the GNB fire watch page
        const fireWatchBtn = $('#fireWatchBtn');
        if (fireWatchBtn) {
          fireWatchBtn.addEventListener('click', () => {
            window.open('https://www.gnb.ca/en/topic/laws-safety/emergency-preparedness-alerts/fire-watch.html', '_blank', 'noopener');
          });
        }

        // Help button in bottom panel
        const helpBtn = $('#helpBtn');
        if (helpBtn) {
          helpBtn.addEventListener('click', openHelp);
        }

        // Zoom buttons
        const zoomInBtn = D.querySelector('.control-btn i.fa-plus')?.parentElement;
        const zoomOutBtn = D.querySelector('.control-btn i.fa-minus')?.parentElement;
        if (zoomInBtn) {
          zoomInBtn.addEventListener('click', () => map.zoomIn());
        }
        if (zoomOutBtn) {
          zoomOutBtn.addEventListener('click', () => map.zoomOut());
        }

        // Location button
        const locationBtn = D.querySelector('.control-btn i.fa-location-crosshairs')?.parentElement;
        if (locationBtn) {
          locationBtn.addEventListener('click', () => {
            // If location marker exists, remove it
            if (userLocMarker) {
              LayerManager.layerState.clearLayerGroup(userLocLayer);
              userLocMarker = null;
              return;
            }
            
            // Otherwise, get location and show marker
            if (navigator.geolocation) {
              // Use Leaflet's locate method which will trigger locationfound event and show marker
              map.locate({
                setView: true,
                maxZoom: 12,
                enableHighAccuracy: true,
                maximumAge: 30000,
                timeout: 15000
              });
            } else {
              alert('Geolocation is not supported by this browser.');
            }
          });
        }
      }
      setupNewUIButtons();

      // ---- Summary (benchmarks + current) -----------------------------------
      let SUMS_BENCH = null;
      async function loadSumsBenchmarks(){
        try{
          const data = await fetchLocalAny('sums_table');
          const attrs = data?.features?.[0]?.attributes || null;
          if (!attrs) return;
          SUMS_BENCH = {
            avg10Burn: attrs.AVG_10Y_BURN,
            avg10Fires: attrs.AVG_10Y_FIRES,
            lastCount: attrs.LAST_YEARS_COUNT,
            lastBurn: attrs.LAST_YEARS_BURN,
            thisCount: attrs.THIS_YEARS_COUNT,
            thisBurn: attrs.THIS_YEARS_BURN,
            fetchedAt: attrs.FETCHED_FROM_ERD ?? null
          };
          refreshSummary();
        } catch (e){ console.warn('sums_table load failed:', e); }
      }
      loadSumsBenchmarks();

            // --- field getters aligned to your GeoJSONs ---
      // active & out files both carry TIME_DETECTED
      function getDetectedMss(props){
        const v = props?.TIME_DETECTED;
        return Number.isFinite(v) ? Number(v) : (v!=null ? Number(v) : null);
      }
      // out fires carry FIRE_STAT_DATE when FIRE_STAT_DESC_E === 'Out'
      function getExtinguishedMss(props){
        if (props?.FIRE_STAT_DESC_E !== 'Out') return null;
        const v = props?.FIRE_STAT_DATE;
        return Number.isFinite(v) ? Number(v) : (v!=null ? Number(v) : null);
      }


      
      // ---- Weekly trend (new/out/active) -----------------------------------
      // Helpers: start of week (Mon) in UTC; week label (mm/dd)
      function startOfWeekUTC(ms){
                // normalize to 00:00 UTC of that date, then shift to Monday
        const d = new Date(ms);
        const z = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        const day = new Date(z).getUTCDay();             // 0..6 (Sun..Sat)
        const diff = (day === 0 ? -6 : 1 - day);         // to Monday
        return z + diff * 86400000;
      }
      function weekLabel(ms){
        const d = new Date(ms);
        return d.toLocaleDateString(undefined,{month:'short',day:'2-digit'});
      }
      function sameWeek(a,b){ return startOfWeekUTC(a)===startOfWeekUTC(b); }
          function computeWeeklyTrend(){
        // Combine: detections from active + out; extinctions from out only
        const all = Array.from(fireStoreMap.values());
        const dets = all.map(it=>getDetectedMss(it.props||{})).filter(v=>v!=null);
        const outs = all.map(it=>getExtinguishedMss(it.props||{})).filter(v=>v!=null);
        if (!dets.length && !outs.length) return {weeks:[], newBy:[], outBy:[], actBy:[]};
        const minMs = Math.min(...dets, ...(outs.length ? [Math.min(...outs)] : [Infinity]));
        const maxMs = Math.max(Date.now(),
                               ...(dets.length ? [Math.max(...dets)] : [-Infinity]),
                               ...(outs.length ? [Math.max(...outs)] : [-Infinity]));
        // ✅ Start at the Monday of the earliest event (not the raw min timestamp)
        let w = startOfWeekUTC(minMs);
        const lastW = startOfWeekUTC(maxMs);
        const weeks=[]; const newBy=[]; const outBy=[]; const actBy=[];
        // Pre-bucket detections/extinctions by week start
        const nMap=new Map(), oMap=new Map();
        for(const ms of dets){ const k=startOfWeekUTC(ms); nMap.set(k,(nMap.get(k)||0)+1); }
        for(const ms of outs){ const k=startOfWeekUTC(ms); oMap.set(k,(oMap.get(k)||0)+1); }
        let active=0;
        while(w<=lastW){
          const n = nMap.get(w)||0;
          const o = oMap.get(w)||0;
          active = Math.max(0, active + n - o);
          weeks.push(w); newBy.push(n); outBy.push(o); actBy.push(active);
          w += 7*86400000;
        }
        return {weeks,newBy,outBy,actBy};
      }
      function buildWeeklyChartSVG(){
        const {weeks,newBy,outBy,actBy} = computeWeeklyTrend();
        if(!weeks.length) return '';
        const W = 640, H = 100, padL=10, padR=10, padT=8, padB=14;
        const innerW = W - padL - padR, innerH = H - padT - padB;
        const maxBar = Math.max(1, ...newBy, ...outBy);
        const maxAct = Math.max(1, ...actBy);
        const xStep = innerW / weeks.length;
        const cx = i => Math.round(padL + i*xStep + xStep/2);
        const y0 = Math.round(padT + innerH/2);                              // baseline
        const yUp = v => Math.round(y0 - (v/maxBar) * (innerH/2 - 4));       // bars up
        const yDn = v => Math.round(y0 + (v/maxBar) * (innerH/2 - 4));       // bars down
        const yAct = v => yUp(v); // line aligned to same 0 baseline as bars
        // Bars
        const bw = Math.max(2, Math.floor(xStep*0.55));
        let bars='';
        for(let i=0;i<weeks.length;i++){
          const x = cx(i) - Math.floor(bw/2);
          const n = newBy[i], o = outBy[i];
          if(n>0) bars += `<rect class="bar-new" x="${x}" width="${bw}" y="${yUp(n)}" height="${y0 - yUp(n)}" rx="1"/>`;
          if(o>0) bars += `<rect class="bar-out" x="${x}" width="${bw}" y="${y0}" height="${yDn(o) - y0}" rx="1"/>`;
        }
        // Active line
        const path = actBy.map((v,i)=>`${i?'L':'M'}${cx(i)},${yAct(v)}`).join('');
        // Baseline + end caps
        const caps = `<line class="axis" x1="${padL}" y1="${y0}" x2="${W-padR}" y2="${y0}"/>`;
                // Sparse labels at ~every 4th tick + last
        let labels=''; const last=weeks.length-1;
        for(let i=0;i<weeks.length;i++){
          if(i%4===0 || i===last){
            labels += `<text x="${cx(i)}" y="${H-4}" font-size="10" text-anchor="middle" fill="#6b7280">${weekLabel(weeks[i])}</text>`;
          }
        }
        
        // Left-side numeric axis + faint grid lines
        let axisLabels = '';
        let gridLines = '';
        const step = Math.max(1, Math.ceil(maxBar/4));
        for (let v=0; v<=maxBar; v+=step){
          const y = y0 - (v/maxBar) * (innerH/2 - 4);
          axisLabels += `<text x="0" y="${y+4}" font-size="10" text-anchor="start" fill="#6b7280">${v}</text>`;
          gridLines += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5" />`;
        }
        for (let v=step; v<=maxBar; v+=step){
          const y = y0 + (v/maxBar) * (innerH/2 - 4);
          axisLabels += `<text x="0" y="${y+4}" font-size="10" text-anchor="start" fill="#6b7280">-${v}</text>`;
          gridLines += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5" />`;
        }
        // Transparent hover bands with SVG-native <title> tooltips
        let hovers='';
        for(let i=0;i<weeks.length;i++){
          const x = padL + i*xStep;
          const lbl = weekLabel(weeks[i]);
          const tip = `Week: ${lbl}\nNew: ${newBy[i]}\nOut: ${outBy[i]}\nActive: ${actBy[i]}`;
          hovers += `
            <g class="hover-zone" aria-label="${lbl}">
              <rect x="${x}" y="0" width="${xStep}" height="${H}" fill="transparent"/>
              <desc class="tip">${tip}</desc>
            </g>`;
        }
                return `
          <div class="fs-mini-chart" aria-label="Weekly new/out and active fires">
            <div style="font-size:12px;font-weight:600;padding:4px 8px 0;color:#374151">
              Weekly Fires (New / Out / Active)
            </div>
            <svg viewBox="0 0 ${W} ${H}" role="img">
              ${caps}
              ${gridLines}
              ${bars}
              <path class="line-active" d="${path}"/>
              ${axisLabels}
              ${labels}
              ${hovers}
            </svg>
            <div class="fs-tip" style="position:absolute;display:none;left:0;top:0;transform:translate(0,0);font-size:12px;background:#fff;border:1px solid var(--border);box-shadow:var(--shadow-soft);border-radius:6px;padding:6px 8px;pointer-events:none;z-index:3;max-width:220px;white-space:pre-line"></div>
          </div>`;
      }

      function pieCSSSegments(counts){
        const order = [
          ['out of control', 'Out of Control'],
          ['being monitored','Being Monitored'],
          ['contained', 'Contained'],
          ['under control', 'Under Control'],
          ['being patrolled', 'Being Patrolled']
        ];
        const total = order.reduce((sum,[k]) => sum + (counts[k]||0), 0);
        if (total === 0) return { css:'conic-gradient(#e5e7eb 0 360deg)', legendHTML:'<div class="legend-item"><span class="legend-swatch" style="background:#e5e7eb"></span><span>No active statuses</span></div>' };

        let acc = 0;
        const segs = [];
        const legend = [];
        for (const [k, label] of order){
          const val = counts[k] || 0;
          if (val <= 0) continue;
          const start = acc / total * 360;
          const end   = (acc + val) / total * 360;
          acc += val;
          const color = FireDataManager.getStatusColor(k);
          segs.push(`${color} ${start}deg ${end}deg`);
          legend.push(`
            <div class="legend-item" role="button" tabindex="0" data-status-key="${k}">
              <span class="legend-swatch" style="background:${color}"></span>
              <span>${label}</span>
              <span class="legend-count">${val}</span>
            </div>`);
        }
        return { css:`conic-gradient(${segs.join(',')})`, legendHTML:legend.join('') };
      }



      function buildSummaryHTML(){
        const items=[...fireStoreMap.values()]; const year = new Date().getFullYear();
        let totalArea=0, counts={'out of control':0,'being monitored':0,contained:0,'under control':0,'being patrolled':0,extinguished:0,other:0};
        let newToday=0, newYesterday=0, extToday=0, extYesterday=0, totalActive=0, totalExt=0;

        for(const it of items){
          const p=it.props||{};
          totalArea += sizeOf(p);
          const key=norm(it.statusKey || p.FIRE_STAT_DESC_E);
          if (key in counts) counts[key]++; else counts.other++;
          if (key === 'extinguished') totalExt++; else totalActive++;

          const det = getDetectedMs(p);
          if(det!=null){ if(isToday(det)) newToday++; else if(isYesterday(det)) newYesterday++; }

          if (key === 'extinguished') {
            const outMs = getExtinguishedMs(p);
            if (outMs!=null){ if (isToday(outMs)) extToday++; else if (isYesterday(outMs)) extYesterday++; }
          }
        }

        const { css:pieCSS, legendHTML } = pieCSSSegments(counts);
        const totalFiresYear = totalActive + totalExt;

        const tableHTML = `
          <table class="pro-table compact" aria-label="Fire summary table">
            <thead><tr><th>Current</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Total (${year})</td><td class="pro-kpi">${toNum(totalFiresYear,0)}</td></tr>
              <tr><td>Active</td><td class="pro-kpi">${toNum(totalActive,0)}</td></tr>
              <tr><td>Out</td><td class="pro-kpi">${toNum(totalExt,0)}</td></tr>
              <tr><td>New Today</td><td>${toNum(newToday,0)}</td></tr>
              <tr><td>New Yesterday</td><td>${toNum(newYesterday,0)}</td></tr>
              <tr><td>Out Today</td><td>${toNum(extToday,0)}</td></tr>
              <tr><td>Out Yesterday</td><td>${toNum(extYesterday,0)}</td></tr>
              <tr><td>Area Burned</td><td>${toNum(totalArea,1)} ha</td></tr>
            </tbody>
          </table>`;

        const byStatus = new Map();
        for (const it of items) {
          const st = norm(it.statusKey || it.props?.FIRE_STAT_DESC_E || 'other');
          if (!byStatus.has(st)) byStatus.set(st, []);
          byStatus.get(st).push(it);
        }
        for (const [k, arr] of byStatus.entries()){
          if (k === 'extinguished'){ arr.sort((a,b) => (getExtinguishedMs(b.props)??-Infinity) - (getExtinguishedMs(a.props)??-Infinity)); }
          else { arr.sort((a,b)=> sizeOf(b.props) - sizeOf(a.props)); }
        }
        const statusOrder = ['out of control','being monitored','contained','under control','being patrolled','extinguished','other'];
        const detailSections = statusOrder
          .filter(k => byStatus.has(k))
          .map(k => {
            const label = k==='other' ? 'Other' : k.replace(/\b\w/g, c=>c.toUpperCase());
            const list = byStatus.get(k).map((it) => {
              const p=it.props||{};
              const fireNumShort = p.FIRE_NUMBER_SHORT || '';
              const name = p.FIRE_NAME || p.FIRE_ID || 'Unnamed Fire';
              const size = toNum(sizeOf(p),1);
              const det  = fmtDateTZ(getDetectedMs(p));
              const extra = (k==='extinguished') ? ` • Out: ${fmtDateTZ(getExtinguishedMs(p))}` : '';
              return `<li style="margin:4px 0;">
                <a href="#" data-fireid="${it.id}">
                  <span style="font-weight:700">${fireNumShort} • ${name}</span>&nbsp; • &nbsp;${size} ha
                  <span style="opacity:.8">• ${label}</span>
                  <span style="opacity:.8">• Detected: ${det}${extra}</span>
                </a>
              </li>`;
            }).join('') || '<li>None</li>';

            const openAttr = (k === 'extinguished') ? '' : ' open';
            return `
              <details class="fs-section"${openAttr} style="margin:10px 0">
                <summary style="cursor:pointer;font-weight:800">${label}</summary>
                <ol class="summary-list">${list}</ol>
              </details>`;
          }).join('');

                const trendSVG = buildWeeklyChartSVG();
        return `
          ${trendSVG}
          <div style="margin:10px 0"><b>Status (Active Only)</b></div>
          <div class="pie-wrap" aria-label="Fires by status pie chart">
            <div class="pie" style="background:${pieCSS}"></div>
            <div class="pie-legend">${legendHTML}</div>
          </div>

          <div style="margin:10px 0 2px"><b>Overview</b></div>
          ${tableHTML}

          ${buildBenchmarksHTML()}

          <div style="margin-top:10px"><b>Fires by status</b> <span style="opacity:.8">(active: largest first; extinguished: most recent first)</span></div>
          <div class="fs-scroll" id="fs-scroll">
            ${detailSections}
          </div>`;
      }

                  function refreshSummary(){
        const htmlContent = buildSummaryHTML();
        UIPanelManager.updateFireSummaryContent(htmlContent);
        wireSummaryClicks();
        wirePieLegendClicks();
        wireTrendHover();
      }

      
      function wireTrendHover(){
        const wrap = $('.fs-mini-chart');
        if(!wrap) return;
        const tip = wrap.querySelector('.fs-tip');
        if(!tip) return;
        const zones = wrap.querySelectorAll('.hover-zone rect');
        zones.forEach((r) => {
          const g = r.parentElement;
          const desc = g.querySelector('desc.tip');
          const text = desc ? desc.textContent : '';
          const show = (ev) => {
            const b = wrap.getBoundingClientRect();
            const clientX = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX);
            const clientY = (ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY);
            tip.style.display = 'block';
            tip.textContent = text;
            let x = clientX - b.left + 10;
            let y = clientY - b.top + 10;
            if (x + tip.offsetWidth > b.width - 8) x = b.width - tip.offsetWidth - 8;
            if (y + tip.offsetHeight > b.height - 8) y = b.height - tip.offsetHeight - 8;
            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
          };
          const hide = () => { tip.style.display = 'none'; };
          r.addEventListener('mouseenter', show);
          r.addEventListener('mousemove', show);
          r.addEventListener('mouseleave', hide);
          r.addEventListener('touchstart', show, {passive:true});
          r.addEventListener('touchmove', show, {passive:true});
          r.addEventListener('touchend', hide);
          r.addEventListener('touchcancel', hide);
        });
      }
    function ensureStatusEnabled(statusKey){
        const target = norm(statusKey);
        const cbs = $$('.fire-filter-block input[type="checkbox"]'); if (!cbs.length) return;
        let changed = false;
        cbs.forEach(cb => {
          const k = norm(cb.getAttribute('data-status'));
          if (k === target && !cb.checked) { cb.checked = true; changed = true; }
        });
        if (changed) applyFireFilter();
      }
      function enableAllActiveStatuses(){
        const set = new Set(['out of control','being monitored','contained','under control','being patrolled']);
        const cbs = $$('.fire-filter-block input[type="checkbox"]');
        let changed=false;
        cbs.forEach(cb=>{ const k = norm(cb.getAttribute('data-status')); if (set.has(k) && !cb.checked){ cb.checked = true; changed = true; } });
        if (changed) applyFireFilter();
      }

      function wireSummaryClicks(){
        const cont = $('#fs-scroll'); if(!cont) return;
        cont.addEventListener('click', (e)=>{
          const a = e.target.closest('a[data-fireid]'); if(!a) return;
          e.preventDefault();
          const rec = fireStore.get(a.getAttribute('data-fireid')); if(!rec) return;
          const statusKey = rec.statusKey || norm(rec.props?.FIRE_STAT_DESC_E || '');
          if (statusKey) ensureStatusEnabled(statusKey);
          closeSummary();
          hideOverviewPanel();
          zoomUtils.flyToTarget(rec.latlng);
          map.once('moveend', ()=> rec.layer?.openPopup && rec.layer.openPopup());
        }, { passive: false });
      }

      function setExclusiveStatusAndZoom(statusKey){
        const target = norm(statusKey);
        const cbs = $$('.fire-filter-block input[type="checkbox"]');
        if (!cbs.length) return;
        cbs.forEach(cb => { cb.checked = (norm(cb.getAttribute('data-status')) === target); });
        applyFireFilter();
        closeSummary();
        hideOverviewPanel();
        const matches = [];
        for (const m of activeFireMarkers) if (m.options._statusKey === target) matches.push(m);
        if (!matches.length) return;
        if (matches.length === 1){
          zoomUtils.flyToControlled(matches[0].getLatLng(), { minZoom: 9, duration: 0.6 });
          return;
        }
        const latlngs = matches.map(m => m.getLatLng());
        const bounds = L.latLngBounds(latlngs);
        const padX = Math.round(innerWidth * 0.06);
        const padY = Math.round(innerHeight * 0.06);
        map.fitBounds(bounds, { paddingTopLeft: [padX,padY], paddingBottomRight: [padX,padY], animate:true });
      }

      function wirePieLegendClicks(){
        const legend = fsBody.querySelector('.pie-legend'); if(!legend) return;
        const handler = (el) => {
          const key = el.getAttribute('data-status-key');
          if (!key) return;
          setExclusiveStatusAndZoom(key);
        };
        legend.addEventListener('click', (e)=>{ const item = e.target.closest('.legend-item[data-status-key]'); if(item) handler(item); });
        legend.addEventListener('keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' ') { const item = e.target.closest('.legend-item[data-status-key]'); if(item){ e.preventDefault(); handler(item); } } });
      }

            // ==== Export helpers (Excel & PDF) ====================================
      // Gather full dataset: all fires (active+extinguished), with XY and derived fields.
      function collectFireRows() {
        const rows = [];
        for (const rec of fireStore.values()) {
          const p = rec.props || {};
          const lat = rec.latlng?.lat ?? null;
          const lng = rec.latlng?.lng ?? null;
          const statusKey = norm(rec.statusKey || p.FIRE_STAT_DESC_E || '—');
          const sizeHa = (p.FIRE_SIZE ?? p.SIZE_HA ?? p.AREA);
          const containPct = getContainPct(p);
          const detMs = getDetectedMs(p);
          const outMs = getExtinguishedMs(p);

          // Flatten a subset of "nice" columns first, then spread all original props for completeness.
          const base = {
            FireNumberShort: p.FIRE_NUMBER_SHORT ?? null,
            FireName: p.FIRE_NAME || p.FIRE_ID || 'Unnamed Fire',
            FireID: p.FIRE_ID ?? p.GlobalID ?? p.OBJECTID ?? null,
            Status: statusKey.replace(/\b\w/g, c => c.toUpperCase()),
            Size_ha: Number.isFinite(Number(sizeHa)) ? Number(sizeHa) : null,
            Contained_pct: containPct != null ? containPct : null,
            Detected_at: detMs != null ? new Date(detMs).toISOString() : null,
            Extinguished_at: (statusKey !== 'extinguished') ? null : (outMs != null ? new Date(outMs).toISOString() : null),
            X: lng,  // "X" then "Y" (typical GIS order)
            Y: lat
          };
          rows.push({ ...base, ...p });
        }
        return rows;
      }

      // Compute the key stats (keep it aligned with your summary UI)
      function collectSummaryStats() {
        // Rebuild the same "items" list that buildSummaryHTML uses
        const items = Array.from(fireStore.values()).map(rec => ({
          id: rec.id, props: rec.props || {}, statusKey: norm(rec.statusKey || rec.props?.FIRE_STAT_DESC_E || '—')
        }));
        const sizeOf = (p) => Number(p.FIRE_SIZE ?? p.SIZE_HA ?? p.AREA) || 0;
        const active = items.filter(i => i.statusKey !== 'extinguished');
        const extinct = items.filter(i => i.statusKey === 'extinguished');
        const totalArea = items.reduce((s,i)=> s + sizeOf(i.props), 0);

        const today = new Date();
        const wasToday = (ms) => isToday(ms, ATLANTIC_TZ);
        const wasYesterday = (ms) => isYesterday(ms, ATLANTIC_TZ);

        const detToday = items.filter(i => wasToday(getDetectedMs(i.props))).length;
        const detYesterday = items.filter(i => wasYesterday(getDetectedMs(i.props))).length;
        const extToday = extinct.filter(i => wasToday(getExtinguishedMs(i.props))).length;
        const extYesterday = extinct.filter(i => wasYesterday(getExtinguishedMs(i.props))).length;

        const byStatus = {};
        for (const it of items) {
          const k = it.statusKey || 'other';
          byStatus[k] = (byStatus[k] || 0) + 1;
        }
        return {
          generatedAt: new Date().toISOString(),
          totalFires: items.length,
          activeFires: active.length,
          extinguishedFires: extinct.length,
          detectedToday: detToday,
          detectedYesterday: detYesterday,
          outToday: extToday,
          outYesterday: extYesterday,
          areaHaTotal: totalArea,
          byStatus
        };
      }

      // ---- Excel (.xlsx) export via SheetJS ----
      async function exportSummaryExcel() {
        const rows = collectFireRows();
        const stats = collectSummaryStats();
        // Sheet 1: Stats (K/V)
        const statsRows = Object.entries({
          'Generated At (UTC)': stats.generatedAt,
          'Total Fires': stats.totalFires,
          'Active Fires': stats.activeFires,
          'Extinguished Fires': stats.extinguishedFires,
          'Detected Today': stats.detectedToday,
          'Detected Yesterday': stats.detectedYesterday,
          'Out Today': stats.outToday,
          'Out Yesterday': stats.outYesterday,
          'Area Burned (ha)': stats.areaHaTotal
        }).map(([k,v]) => ({ Metric: k, Value: v }));
        // Add status breakdown
        for (const [k,v] of Object.entries(stats.byStatus)) {
          statsRows.push({ Metric: `Status — ${k}`, Value: v });
        }

        const wb = XLSX.utils.book_new();
        const wsStats = XLSX.utils.json_to_sheet(statsRows);
        const wsFires = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, wsStats, 'Stats');
        XLSX.utils.book_append_sheet(wb, wsFires, 'Fires');
        const filename = `NB_Fire_Summary_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(wb, filename);
      }

      // ---- PDF export via jsPDF + AutoTable ----
      async function exportSummaryPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  let y = 42;

  // ---------- Data ----------
  const stats = collectSummaryStats();
  const rows  = collectFireRows();

  // ---------- Helpers ----------
  function cssVar(name, fallback) {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
    catch(e){ return fallback; }
  }

  function _drawTrendCanvasPDF(scale=2){
    const {weeks,newBy,outBy,actBy} = computeWeeklyTrend();
    if (!weeks.length) return null;
    const W=640*scale, H=200*scale, padL=56*scale, padR=16*scale, padT=12*scale, padB=24*scale;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const maxBar = Math.max(1, ...newBy, ...outBy);
    const xStep = innerW / weeks.length;
    const cx = i => Math.round(padL + i*xStep + xStep/2);
    const y0 = Math.round(padT + innerH/2);
    const yUp = v => Math.round(y0 - (v/maxBar) * (innerH/2 - 4*scale));
    const yDn = v => Math.round(y0 + (v/maxBar) * (innerH/2 - 4*scale));

    const canvas = document.createElement('canvas');
    canvas.width=W; canvas.height=H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,W,H);

    // Grid
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1*scale;
    ctx.fillStyle = '#6b7280'; ctx.font = `${10*scale}px Inter, Arial`;
    const step = Math.max(1, Math.ceil(maxBar/4));
    for(let v=0; v<=maxBar; v+=step){
      const yv = y0 - (v/maxBar) * (innerH/2 - 4*scale);
      ctx.beginPath(); ctx.moveTo(padL, yv); ctx.lineTo(W-padR, yv); ctx.stroke();
          // X-axis week labels (every 4th + last)
          ctx.fillStyle = '#6b7280'; ctx.font = `${10*scale}px Inter, Arial`;
          for(let i=0;i<weeks.length;i++){
            if(i%4===0 || i===weeks.length-1){
              const lbl = weekLabel(weeks[i]);
              const tx = cx(i);
              const ty = padT + innerH + 14*scale;
              const tw = ctx.measureText(lbl).width;
              ctx.fillText(lbl, tx - tw/2, ty);
            }
          }
      ctx.fillText(String(v), 8*scale, yv+4*scale);
    }
    for(let v=step; v<=maxBar; v+=step){
      const yv = y0 + (v/maxBar) * (innerH/2 - 4*scale);
      ctx.beginPath(); ctx.moveTo(padL, yv); ctx.lineTo(W-padR, yv); ctx.stroke();
      ctx.fillText('-'+String(v), 8*scale, yv+4*scale);
    }
    // Baseline
    ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(W-padR, y0); ctx.stroke();

    // Bars
    const colNew = cssVar('--oc', '#ef4444');
    const colOut = cssVar('--pat', '#10b981');
    const bw = Math.max(2*scale, Math.floor(xStep*0.55));
    for(let i=0;i<weeks.length;i++){
      const x = cx(i) - Math.floor(bw/2);
      const n = newBy[i], o = outBy[i];
      if(n>0){ ctx.fillStyle = colNew; ctx.fillRect(x, yUp(n), bw, y0 - yUp(n)); }
      if(o>0){ ctx.fillStyle = colOut; ctx.fillRect(x, y0, bw, yDn(o) - y0); }
    }

    // Active line (aligned to baseline scale)
    ctx.strokeStyle = 'orange'; ctx.lineWidth = 2*scale; ctx.beginPath();
    for(let i=0;i<weeks.length;i++){
      const v = actBy[i];
      const yv = yUp(v); const x = cx(i);
      if(i===0) ctx.moveTo(x,yv); else ctx.lineTo(x,yv);
    }
    ctx.stroke();

    // Legend (top-left, not overlapping title)
    const legendX = padL, legendY = padT + 16*scale;
    const sw = 16*scale, sh = 8*scale, gap = 8*scale, lh = 16*scale;
    ctx.font = `${11*scale}px Inter, Arial`;
    ctx.fillStyle = colNew; ctx.fillRect(legendX, legendY, sw, sh);
    ctx.fillStyle = '#374151'; ctx.fillText('New', legendX + sw + gap, legendY + sh);
    const y2 = legendY + lh; ctx.fillStyle = colOut; ctx.fillRect(legendX, y2, sw, sh);
    ctx.fillStyle = '#374151'; ctx.fillText('Extinguished', legendX + sw + gap, y2 + sh);
    const y3 = legendY + 2*lh + sh/2; ctx.strokeStyle='orange'; ctx.lineWidth = 2*scale;
    ctx.beginPath(); ctx.moveTo(legendX, y3); ctx.lineTo(legendX + sw, y3); ctx.stroke();
    ctx.fillStyle = '#374151'; ctx.fillText('Active', legendX + sw + gap, y3 + sh/2);

    return canvas;
  }

  function _drawPieCanvasPDF(scale=2){
    const counts = {'out of control':0,'being monitored':0,'contained':0,'under control':0,'being patrolled':0};
    for(const rec of fireStore.values()){
      const st = norm(rec.statusKey || rec.props?.FIRE_STAT_DESC_E || ''); 
      if(counts.hasOwnProperty(st)) counts[st]++;
    }
    const total = Object.values(counts).reduce((a,b)=>a+b,0);
    if (!total) return null;

    const order = [
      ['out of control','Out of Control'],
      ['being monitored','Being Monitored'],
      ['contained','Contained'],
      ['under control','Under Control'],
      ['being patrolled','Being Patrolled']
    ];

    const W=520*scale, H=300*scale, R=110*scale, CX=W - (R + 36*scale), CY=H/2;
    const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
    const ctx = canvas.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);

    const statusColorMap = {
      'out of control': FireDataManager.getStatusColor('out of control'),
      'being monitored': FireDataManager.getStatusColor('being monitored'),
      'contained': FireDataManager.getStatusColor('contained'),
      'under control': FireDataManager.getStatusColor('under control'),
      'being patrolled': FireDataManager.getStatusColor('being patrolled')
    };

    // Draw pie (true circle)
    let startA = -Math.PI/2;
    order.forEach(([k,label])=>{
      const val = counts[k]||0; if(!val) return;
      const ang = (val/total)*Math.PI*2; const endA = startA+ang;
      ctx.beginPath(); ctx.moveTo(CX,CY); ctx.arc(CX,CY,R,startA,endA); ctx.closePath();
      ctx.fillStyle = statusColorMap[k] || '#ddd'; ctx.fill();
      startA=endA;
    });

    // Legend (left side)
    ctx.font = `${12*scale}px Inter, Arial`; ctx.fillStyle='#374151';
    let ly = 28*scale, lx = 20*scale;
    order.forEach(([k,label])=>{
      const val = counts[k]||0; if(!val) return;
      ctx.fillStyle = statusColorMap[k] || '#ddd';
      ctx.fillRect(lx, ly-10*scale, 14*scale, 10*scale);
      ctx.fillStyle = '#374151';
      ctx.fillText(`${label}: ${val}`, lx + 22*scale, ly);
      ly += 18*scale;
    });

    return canvas;
  }

  // ---------- Charts (titles: bold & slightly larger, extra gap above images) ----------

  // ---------- Show "Generated At" at top in Atlantic time ----------
  const atlanticDate = new Date(stats.generatedAt).toLocaleString('en-CA', {
    timeZone: 'America/Moncton',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Generated At: ${atlanticDate}`, marginX, y);
  y += 18;

  const titleFont = 14;
  const titleGap  = 16; // space between title and image

  doc.setFont('helvetica','bold'); doc.setFontSize(titleFont);
  doc.text('Weekly Fires (New / Out / Active)', marginX, y);
  const tCan = _drawTrendCanvasPDF(2);
  if (tCan){ const tImg = tCan.toDataURL('image/png'); doc.addImage(tImg, 'PNG', marginX, y + titleGap, 520, 200); }
  y += titleGap + 200 + 28;

  doc.setFont('helvetica','bold'); doc.setFontSize(titleFont);
  doc.text('Active Fires by Status', marginX, y);
  const pCan = _drawPieCanvasPDF(2);
  if (pCan){ const pImg = pCan.toDataURL('image/png'); doc.addImage(pImg, 'PNG', marginX, y + titleGap, 520, 300); }
  y += titleGap + 300 + 28;

  // ---------- Stats table ----------
  const statEntries = [];
  const baseStats = {
    'Total Fires': stats.totalFires,
    'Active Fires': stats.activeFires,
    'Extinguished Fires': stats.extinguishedFires,
    'Detected Today': stats.detectedToday,
    'Detected Yesterday': stats.detectedYesterday,
    'Out Today': stats.outToday,
    'Out Yesterday': stats.outYesterday,
    'Area Burned (ha)': stats.areaHaTotal.toFixed(1)
  };
  for(const [k,v] of Object.entries(baseStats)){ statEntries.push([k, String(v ?? '')]); }
  doc.autoTable({
    head: [['Metric', 'Value']],
    body: statEntries,
    startY: y,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fontStyle: 'bold' }
  });
  y = doc.lastAutoTable.finalY + 16;

  // ---------- Sums Table ----------
  if (typeof SUMS_BENCH === 'object' && SUMS_BENCH !== null) {
    const sumsEntries = [
      ['10-year Avg YTD Fires', SUMS_BENCH.avg10Fires ?? ''],
      ['10-year Avg YTD Area Burned', SUMS_BENCH.avg10Burn != null ? SUMS_BENCH.avg10Burn + ' ha' : ''],
      ['Last Year YTD Fires', SUMS_BENCH.lastCount ?? ''],
      ['Last Year YTD Area Burned', SUMS_BENCH.lastBurn != null ? SUMS_BENCH.lastBurn + ' ha' : ''],
      ['YTD Fires', SUMS_BENCH.thisCount ?? ''],
      ['YTD Area Burned', SUMS_BENCH.thisBurn != null ? SUMS_BENCH.thisBurn + ' ha' : '']
    ];
    doc.autoTable({
      head: [['Historic/Season Benchmarks', 'Value']],
      body: sumsEntries,
      startY: y,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fontStyle: 'bold' }
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  // ---------- Fires table ----------
  const fireBody = rows.map(r => {
  const shortNum = r.FireNumberShort ?? r.FIRE_NUMBER_SHORT ?? '';
  const fireName = r.FireName ?? r.FIRE_NAME ?? (r.FireID ?? '');
  const containedPct = r.PERCENT_CONTAINED != null ? r.PERCENT_CONTAINED : (r.Contained_pct != null ? r.Contained_pct : '');
  return [
    shortNum,
    fireName,
    r.Status,
    Number.isFinite(r.Size_ha) ? r.Size_ha : '',
    containedPct !== '' ? `${containedPct}%` : '',
    r.Detected_at ? r.Detected_at.slice(0,10) : '',
    r.Extinguished_at ? r.Extinguished_at.slice(0,10) : '',
    r.X ?? '',
    r.Y ?? ''
  ];
});
doc.autoTable({
  startY: y,
  head: [['Fire Number', 'Fire Name', 'Status', 'Size (ha)', 'Contained (%)', 'Detected', 'Out', 'X', 'Y']],
  body: fireBody,
  styles: { fontSize: 8, cellPadding: 3 },
  headStyles: { fontStyle:'bold' },
  columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
  didDrawPage: (data) => {
    const pageSize = doc.internal.pageSize;
    const str = `Page ${doc.internal.getNumberOfPages()}`;
    doc.setFontSize(8);
    doc.text(str, pageSize.getWidth() - marginX, pageSize.getHeight() - 14, { align: 'right' });
  }
});

  // ---------- Save ----------
  const filename = `NB_Fire_Summary_${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(filename);
}

      // Wire up buttons when modal exists
      const fsExportExcelBtn = D.getElementById('fs-export-excel');
      const fsExportPdfBtn   = D.getElementById('fs-export-pdf');
      fsExportExcelBtn?.addEventListener('click', exportSummaryExcel);
      fsExportPdfBtn?.addEventListener('click', exportSummaryPDF);


      // Fire summary functions using UI Panel Manager
      const openSummary = () => UIPanelManager.openFireSummary(refreshSummary);
      const closeSummary = () => UIPanelManager.closeFireSummary();

      // ---- Help modal -------------------------------------------------------
      const mhOverlay = $('#mapHelpOverlay');
      const mhBody = $('#mh-body');
      const mhClose = $('#mh-close');

      function buildHelpHTML(){
  // Helper to render an NB status row using the same colors as the Overview
  const st = (label, key, text, abbr='') => `
    <li style="margin:6px 0; display:flex; gap:10px; align-items:flex-start;">
      <span class="legend-swatch" style="background:${FireDataManager.getStatusColor(key)}; flex:0 0 12px; margin-top:4px"></span>
      <div><b>${label}${abbr ? ` (${abbr})` : ''}</b> — ${text}</div>
    </li>`;

  // Layers list (match your actual overlays + source links)
  const layersHTML = `
    <ul>
      <li><b>Smoke (Surface)</b> — NOAA surface smoke forecast. When enabled, a timeline appears under the layer to scrub/play. Source:
        <a href="https://www.arl.noaa.gov/hysplit/smoke-forecasting/" target="_blank" rel="noopener">NOAA</a>.
      </li>
      <li><b>CWFIS Hotspots — Last 24 hours</b> — Thermal anomalies (VIIRS/MODIS). Source:
        <a href="https://cwfis.cfs.nrcan.gc.ca/ha/hotspots" target="_blank" rel="noopener">CWFIS</a>,
        <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a>.
      </li>
      <li><b>CWFIS Hotspots — Last 7 days</b> — Same as above but a longer window.</li>
      <li><b>Fire Perimeters</b> — Current wildfire polygons with area labels at higher zooms. Source:
        <a href="https://cwfis.cfs.nrcan.gc.ca/maps/fires" target="_blank" rel="noopener">CWFIS</a>.
      </li>
      <li><b>Fire Risk (FDR)</b> — Daily Fire Danger Rating (history & forecast). Source:
        <a href="https://cwfis.cfs.nrcan.gc.ca/maps/fdr" target="_blank" rel="noopener">CWFIS</a>.
      </li>
      <li><b>Fire Weather</b> — FWI components (choose component + date). Source:
        <a href="https://cwfis.cfs.nrcan.gc.ca/background/summary/fwi" target="_blank" rel="noopener">FWI @ CWFIS</a>.
      </li>
      <li><b>Fire Behavior</b> — FBP metrics (choose metric + date). Source:
        <a href="https://cwfis.cfs.nrcan.gc.ca/background/summary/fbp" target="_blank" rel="noopener">FBP @ CWFIS</a>.
      </li>
      <li><b>Cities &amp; Towns</b> — Click a name to see <i>Nearby Fires</i> within 30 km with distance lines.</li>
      <li><b>Aircraft</b> — Aircraft positions from the OpenSky network. Source:
        <a href="https://opensky-network.org/" target="_blank" rel="noopener">OpenSky</a>.
      </li>
      <li><b>Weather Stations</b> — Environment Canada stations (wind/temp/humidity). Source:
        <a href="https://weather.gc.ca/" target="_blank" rel="noopener">ECCC</a>.
      </li>
      <li><b>AQHI Risk</b> — Air Quality Health Index observations. Source:
        <a href="https://www.canada.ca/en/environment-climate-change/services/air-quality-health-index.html" target="_blank" rel="noopener">ECCC</a>.
      </li>
      <li><b>Weather Radar</b> — Base reflectivity mosaic. Source:
        <a href="https://www.weather.gov/radar" target="_blank" rel="noopener">NOAA</a>.
      </li>
      <li><b>Lightning Density</b> — Recent lightning strike density. Source:
        <a href="https://weather.gc.ca/lighting/index_e.html" target="_blank" rel="noopener">ECCC</a>.
      </li>
      <li><b>NB Burn Bans</b> — Official burn restriction map. Source:
        <a href="https://www.gnb.ca/en/topic/laws-safety/emergency-preparedness-alerts/fire-watch.html" target="_blank" rel="noopener">GNB ERD</a>.
      </li>
      <li><b>Crown Land</b> — Provincial Crown land parcels. Source:
        <a href="https://www2.gnb.ca/content/gnb/en/departments/erd.html" target="_blank" rel="noopener">GNB ERD</a>.
      </li>
      <li><b>Counties</b> — County boundaries (large labels when zoomed in).</li>
      <li><b>Sentinel-2 Imagery</b> — Recent hi-res satellite imagery. Source:
        <a href="https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/imagery/sentinel-2-landsat/" target="_blank" rel="noopener">Esri Living Atlas</a>.
      </li>
    </ul>`;

  // NB Fire States (exactly what your Overview uses)
  const fireStatesHTML = `
    <ul style="list-style:none; padding-left:0; margin:6px 0;">
      ${st('Out of Control',   'out of control',  'Not contained and still growing.')}
      ${st('Being Monitored',  'being monitored', 'Known fire being watched; not immediately threatening.')}
      ${st('Contained',        'contained',       'Within a break/wet line that should restrict growth.')}
      ${st('Under Control',    'under control',   'Control line established; not spreading.')}
      ${st('Being Patrolled',  'being patrolled', 'Secured within breaks; minimal activity.')}
      ${st('Extinguished',     'extinguished',    'Fire is out.')}
    </ul>`;

  // FDR / FWI / FBP glossary with links
  const glossaryHTML = `
    <h3>Fire Risk (FDR)</h3>
    <p>A general daily danger rating based on expected fire behaviour. See
      <a href="https://cwfis.cfs.nrcan.gc.ca/maps/fdr" target="_blank" rel="noopener">CWFIS Fire Danger Rating</a>.
    </p>
    <h3><a href="https://cwfis.cfs.nrcan.gc.ca/background/summary/fwi" target="_blank" rel="noopener">Fire Weather Index (FWI) Components</a></h3>
    <ul>
      <li><b>FWI</b> — Fire Weather Index (overall intensity)</li>
      <li><b>FFMC</b> — Fine Fuel Moisture Code</li>
      <li><b>DMC</b> — Duff Moisture Code</li>
      <li><b>DC</b> — Drought Code</li>
      <li><b>ISI</b> — Initial Spread Index</li>
      <li><b>BUI</b> — Buildup Index</li>
      <li><b>DSR</b> — Daily Severity Rating</li>
    </ul>
    <h3><a href="https://cwfis.cfs.nrcan.gc.ca/background/summary/fbp" target="_blank" rel="noopener">Fire Behaviour Prediction (FBP) Metrics</a></h3>
    <ul>
      <li><b>HFI</b> — Head Fire Intensity</li>
      <li><b>ROS</b> — Rate of Spread</li>
      <li><b>SFC</b> — Surface Fuel Consumption</li>
      <li><b>TFC</b> — Total Fuel Consumption</li>
      <li><b>CFB</b> — Crown Fraction Burned</li>
      <li><b>FMC</b> — Fine Fuel Moisture Content</li>
      <li><b>FT</b> — Fire Type</li>
    </ul>`;

  // Final composed help HTML
  return `
    <h2>🗺️ How to Use This Map</h2>
    
    <p><strong>⚠️ Important:</strong> <em>This is an unofficial viewer created for educational and informational purposes. For official emergency information, always consult <a href="https://www.gnb.ca/en/topic/laws-safety/emergency-preparedness-alerts/fire-watch.html" target="_blank" rel="noopener">GNB Fire Watch</a>.</em></p>
    
    <p>🖱️ <strong>Navigation:</strong> Drag to move, scroll or use <b>+</b>/<b>−</b> to zoom. The <b>🔗 Overview</b> panel lets you toggle layers.</p>
    <p>⏰ <strong>Time Controls:</strong> Time-series layers (Smoke, Fire Risk, Fire Weather, Fire Behavior) show inline controls under their row: use ▶ play, the slider, or drag the handle to change the date.</p>
    <p>📍 <strong>Nearby Fires:</strong> Click a city/town label or your location to list active fires within 30&nbsp;km, with distance lines; click any entry to zoom to that fire.</p>
    <p>📊 <strong>Fire Summary:</strong> Use the <b>🔥 Summary</b> button in the bottom panel to view current fire statistics for New Brunswick, including total active fires, area burned, and fires by status. The summary updates automatically with the latest data.</p>
    
    <h3>📊 Available Layers</h3>
    ${layersHTML}
    
    <h3>🔥 Fire Status Guide</h3>
    ${fireStatesHTML}
    
    ${glossaryHTML}
    
    <h3>📚 Map Credits & Data Sources</h3>
    <p><strong>🗺️ Base Maps:</strong></p>
    <ul>
      <li><strong>🛰️ Satellite Imagery:</strong> Esri World Imagery © Esri, DigitalGlobe, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community</li>
      <li><strong>🛣️ Street Map:</strong> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></li>
    </ul>
    
    <p><strong>🔗 Data Sources:</strong></p>
    <ul>
      <li><strong>🔥 Fire Data:</strong> <a href="https://cwfis.cfs.nrcan.gc.ca/interactive-map" target="_blank" rel="noopener">CWFIS Interactive Map</a> & <a href="https://cwfis.cfs.nrcan.gc.ca/datamart" target="_blank" rel="noopener">Data Services</a></li>
      <li><strong>🌡️ Thermal Hotspots:</strong> <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA Fire Information for Resource Management System (FIRMS)</a></li>
      <li><strong>🌤️ Weather Data:</strong> <a href="https://weather.gc.ca/" target="_blank" rel="noopener">Environment and Climate Change Canada (ECCC)</a></li>
      <li><strong>💨 Smoke Forecasts:</strong> <a href="https://firesmoke.ca/" target="_blank" rel="noopener">Canadian Smoke Forecast</a> & <a href="https://www.arl.noaa.gov/hysplit/smoke-forecasting/" target="_blank" rel="noopener">NOAA HYSPLIT</a></li>
      <li><strong>📡 Weather Radar:</strong> <a href="https://weather.gc.ca/satellite/index_e.html" target="_blank" rel="noopener">ECCC Weather Radar & Satellite</a></li>
      <li><strong>✈️ Aircraft Tracking:</strong> <a href="https://opensky-network.org/" target="_blank" rel="noopener">OpenSky Network</a></li>
      <li><strong>🏛️ Provincial Data:</strong> <a href="https://www.gnb.ca/en/topic/laws-safety/emergency-preparedness-alerts" target="_blank" rel="noopener">GNB Emergency Management</a></li>
      <li><strong>🛰️ High-Res Imagery:</strong> <a href="https://livingatlas.arcgis.com/en/browse/" target="_blank" rel="noopener">Esri Living Atlas</a> (Sentinel-2 & Landsat)</li>
      <li><strong>⚡ Lightning Data:</strong> <a href="https://weather.gc.ca/" target="_blank" rel="noopener">ECCC Weather & Lightning</a></li>
    </ul>
    
    <p><strong>⚙️ Technology:</strong> Powered by <a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a> open-source mapping library</p>
  `;
}

      function openHelp(){ mhBody.innerHTML = buildHelpHTML(); mhOverlay.hidden=false; mhOverlay.style.display='flex'; mhClose.focus(); }
      function closeHelp(){ mhOverlay.style.display='none'; mhOverlay.hidden=true; }
      mhClose.addEventListener('click', closeHelp);
      mhOverlay.addEventListener('click', (e)=>{ if(e.target === mhOverlay) closeHelp(); });
      window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !mhOverlay.hidden) closeHelp(); });

      // ---- Overview toggle & reset -----------------------------------------
      const mapToggleBtn = $('#mapToggleBtn');
      const updateOverviewButton=()=>{
        const hidden = D.body.classList.contains('map-ui-hidden');
        const label = hidden ? 'Show layers' : 'Hide layers';
        mapToggleBtn.setAttribute('aria-pressed', String(!hidden));
        mapToggleBtn.title = label;
        layoutTitleBox();
      };
      D.body.classList.add('map-ui-hidden');
      updateOverviewButton();

      mapToggleBtn.addEventListener('click', () => { D.body.classList.toggle('map-ui-hidden'); updateOverviewButton(); requestAnimationFrame(sizeLegend); });
      $('#resetViewBtn').addEventListener('click', () => { localStorage.removeItem(LS_KEY); fitProvinceToView({ animate:true }); });

      function hideOverviewPanel(){
        UIPanelManager.hideOverviewPanel();
        if (!D.body.classList.contains('map-ui-hidden')){
          D.body.classList.add('map-ui-hidden'); updateOverviewButton(); requestAnimationFrame(sizeLegend);
        }
      }

      // ---- City → Fires proximity ------------------------------------------
      const CITY_RADIUS_M = 30_000;
      // Ensure cityProximityLayer is added to map
      if (!map.hasLayer(cityProximityLayer)) {
        cityProximityLayer.addTo(map);
      }
      let cityProximityPopup = null;

      const kmStr = (meters) => (meters / 1000).toFixed(1);

      function cityToFires(name, cityLatLng) {
        enableAllActiveStatuses();
        cityProximityLayer.clearLayers();
        cityProximityPopup = null;

        const nearby = [];
        for (const rec of fireStore.values()) {
          const statusKey = norm(rec.statusKey || rec.props?.FIRE_STAT_DESC_E || '');
          if (statusKey === 'extinguished') continue;
          const d = map.distance(cityLatLng, rec.latlng);
          if (Number.isFinite(d) && d <= CITY_RADIUS_M) nearby.push({ rec, d });
        }

        // Build the list (or empty state) for the bottom sheet
        const listItems = [];
        const bounds = L.latLngBounds([cityLatLng]);
        if (!nearby.length) {
          openNearbyPanel(name, `<div><b>${name}</b><br>No active fires within 30&nbsp;km.</div>`);
          hideOverviewPanel();
          // Keep the city above the panel
          const pad = Math.round(Math.min(innerWidth, innerHeight) * 0.08);
          const pb = nearbyPanelHeight();
          zoomUtils.flyToControlled(cityLatLng, { minZoom: 8 });
          map.once('moveend', () => {
            zoomUtils.fitBoundsControlled(L.latLngBounds([cityLatLng]), {
              paddingTopLeft: [pad, pad],
              paddingBottomRight: [pad, pad + pb]
            });
          });
          return;
        }

        nearby.sort((a, b) => a.d - b.d);
        const listHTML = nearby.map(({ rec, d }) => {
          const km = kmStr(d);

          L.polyline([cityLatLng, rec.latlng], { color: '#000000', weight: 6, opacity: 0.55 }).addTo(cityProximityLayer);
          L.polyline([cityLatLng, rec.latlng], { color: '#ffffff', weight: 3, opacity: 0.95, dashArray: '6,8' }).addTo(cityProximityLayer);

          const mid = L.latLng((cityLatLng.lat + rec.latlng.lat) / 2, (cityLatLng.lng + rec.latlng.lng) / 2);
          L.tooltip({ permanent: true, direction: 'center', className: 'distance-label-tooltip', opacity: 1 })
            .setLatLng(mid)
            .setContent(`<span class="distance-label">${km} km</span>`)
            .addTo(cityProximityLayer);

          bounds.extend(rec.latlng);

          const fname = rec.props.FIRE_NAME || rec.props.FIRE_ID || 'Fire';
          const statusKey = norm(rec.statusKey || rec.props?.FIRE_STAT_DESC_E || '—');
          const statusLabel = statusKey.replace(/\b\w/g, c => c.toUpperCase());
          const color = FireDataManager.getStatusColor(statusKey);
          return `<li>
            <a href="#" data-fireid="${rec.id}">
              <span class="dot" style="background:${color}; margin-right:6px"></span>
              <b>${fname}</b>
              <span style="opacity:.85">• ${statusLabel}</span>
              <span style="opacity:.85">• ${km} km</span>
            </a>
          </li>`;
        }).join('');

                const html = `
          <div><b>${name}</b></div>
          <div><b>Active fires within 30&nbsp;km:</b></div>
          <ol class="nearby-list">${listHTML}</ol>`;
        openNearbyPanel('Nearby Fires', html);
        // Click handling for list items (delegate)
                nearbyBody.addEventListener('click', (evt) => {
          const a = evt.target.closest('a[data-fireid]'); 
          if (!a) return;
          evt.preventDefault();
          const rec = fireStore.get(a.getAttribute('data-fireid')); 
          if (!rec) return;
          ensureStatusEnabled(rec.statusKey || norm(rec.props?.FIRE_STAT_DESC_E || ''));
          hideOverviewPanel();
          // close the sheet + clear the lines immediately
          closeNearbyPanel();
          zoomUtils.flyToTarget(rec.latlng, { duration: 0.6 });
          map.once('moveend', () => {
            rec.layer?.openPopup?.();
          });
        }, { passive: false, once: true });

                // Fit all lines above the panel
        const pad = Math.round(Math.min(innerWidth, innerHeight) * 0.08);
        const pb = nearbyPanelHeight();
        hideOverviewPanel();
        zoomUtils.fitBoundsControlled(bounds, {
          paddingTopLeft: [pad, pad],
          paddingBottomRight: [pad, pad + pb]
        });
      }

      // ---- Inline smoke controls mount (NEW) --------------------------------
      function findOverlayLabelRow(name){
        const rows = document.querySelectorAll('.leaflet-control-layers-overlays label');
        for (const row of rows){
          const t = row.querySelector('.text') || row;
          if (t && t.textContent.trim() === name) return row;
        }
        return null;
      }
      function mountSmokeControlsInline(){
        const row = findOverlayLabelRow('Smoke');
        if (!row) return;
        smokeControls.classList.add('inline');
        if (smokeControls.parentElement !== row.parentElement || smokeControls.previousElementSibling !== row){
          row.after(smokeControls);
        }
      }

      // NEW handlers that show/hide the inline controls under the layer row
      map.on('overlayadd', (e) => {
        if (e.layer === smokeLayer) {
          mountSmokeControlsInline();
          smokeControls.style.display = 'flex';
          smokeTimesMs.length ? smokeSetIndex(smokeIdx) : (smokeTsLabel.textContent = 'Loading…');
          smokeLayer.bringToBack();
          if (smokeShouldAutoplayNextOn) {
            if (smokeTimesMs.length) { smokePlay(); smokeShouldAutoplayNextOn = false; }
            else { smokePendingAutoplay = true; }
          }
          requestAnimationFrame(sizeLegend);
        }
      });
      map.on('overlayremove', (e) => {
        if (e.layer === smokeLayer) {
          smokePause();
          smokeControls.style.display = 'none';
          smokeShouldAutoplayNextOn = true;
          smokePendingAutoplay = false;
          requestAnimationFrame(sizeLegend);
        }
      });

      // If Smoke starts enabled, mount & show inline now
      if (map.hasLayer(smokeLayer)) {
        mountSmokeControlsInline();
        smokeControls.style.display = 'flex';
        smokeTsLabel.textContent = smokeTimesMs.length ? smokeFmt(smokeTimesMs[smokeIdx]) : 'Loading…';
        requestAnimationFrame(sizeLegend);
      }

      
  
      // === Inline legend for "Winter Road Conditions" ==============================
      const WINTER_LABEL = 'Winter Road Conditions';
      let winterLegendEl = null;

      function buildWinterLegendEl(){
        if (winterLegendEl) return winterLegendEl;
        const wrap = document.createElement('div');
        wrap.className = 'winter-legend inline';
        wrap.setAttribute('aria-live','polite');
        wrap.style.display = 'none';

        const rowsHtml = Object.entries(WINTER_COLORS).map(([label, col]) => `
          <div class="wl-row" style="display:flex;align-items:center;gap:8px;margin:2px 0">
            <span class="wl-swatch" style="width:12px;height:12px;border-radius:3px;border:1px solid var(--border);background:${col}"></span>
            <span>${label}</span>
          </div>
        `).join('');

        wrap.innerHTML = `
          <div style="font-weight:800;margin:6px 0 4px">Winter Road Conditions</div>
          ${rowsHtml}
        `;
        winterLegendEl = wrap;
        return wrap;
      }

      function mountWinterLegendInline(){
        const row = findOverlayLabelRow(WINTER_LABEL);
        if (!row) return;
        const el = buildWinterLegendEl();
        if (el.parentElement !== row.parentElement || el.previousElementSibling !== row){
          row.after(el);
        }
      }

      map.on('overlayadd',   (e) => {
        if (e.layer === winterRoadsLayer){
          mountWinterLegendInline();
          buildWinterLegendEl().style.display = 'block';
          requestAnimationFrame(sizeLegend);
        }
      });
      map.on('overlayremove',(e) => {
        if (e.layer === winterRoadsLayer){
          if (winterLegendEl) winterLegendEl.style.display = 'none';
          requestAnimationFrame(sizeLegend);
        }
      });
      if (map.hasLayer(winterRoadsLayer)){
        mountWinterLegendInline();
        buildWinterLegendEl().style.display = 'block';
        requestAnimationFrame(sizeLegend);
      }

      // ----- Inline legend for Road Events (matches events.html) -----
      const EVENTS_LABEL = 'Road Events';

      function buildEventsLegendEl(){
        const el = document.createElement('div');
        el.id = 'eventsLegend';
        el.className = 'inline-legend';
        el.style.cssText = [
          'display:none;margin:6px 0 0 0;padding:8px;',
          'border:1px solid var(--btn-border);border-radius:8px;background:var(--btn-bg);',
          'font-size:11px;line-height:1.2'
        ].join('');
        el.innerHTML = [
          '<div style="font-weight:800;margin-bottom:8px;display:flex;align-items:center;gap:6px;">',
          '<i class="fas fa-road" style="color:#fd7e14;"></i> Road Events Legend</div>',
          
          // 5 Simple Subcategories - Square markers to match map icons
          '<label style="display:flex;align-items:center;gap:4px;margin:4px 0;cursor:pointer;">',
          '<input type="checkbox" id="closuresToggle" checked style="margin:0;">',
          '<div style="width:16px;height:16px;background:#dc2626;border:2px solid white;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:bold;"><i class="fa-solid fa-ban"></i></div>',
          'Closures</label>',
          
          '<label style="display:flex;align-items:center;gap:4px;margin:4px 0;cursor:pointer;">',
          '<input type="checkbox" id="futureClosuresToggle" style="margin:0;">',
          '<div style="width:16px;height:16px;background:#2563eb;border:2px solid white;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:bold;"><i class="fa-solid fa-ban"></i></div>',
          'Future Closures</label>',
          
          '<label style="display:flex;align-items:center;gap:4px;margin:4px 0;cursor:pointer;">',
          '<input type="checkbox" id="incidentsToggle" checked style="margin:0;">',
          '<div style="width:16px;height:16px;background:#dc2626;border:2px solid white;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:7px;font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i></div>',
          'Incidents</label>',
          
          '<label style="display:flex;align-items:center;gap:4px;margin:4px 0;cursor:pointer;">',
          '<input type="checkbox" id="constructionToggle" checked style="margin:0;">',
          '<div style="width:16px;height:16px;background:#ea580c;border:2px solid white;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:7px;font-weight:bold;"><i class="fa-solid fa-person-digging"></i></div>',
          'Construction</label>',
          
          '<label style="display:flex;align-items:center;gap:4px;margin:4px 0;cursor:pointer;">',
          '<input type="checkbox" id="futureConstructionToggle" style="margin:0;">',
          '<div style="width:16px;height:16px;background:#2563eb;border:2px solid white;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:7px;font-weight:bold;"><i class="fa-solid fa-person-digging"></i></div>',
          'Future Construction</label>',
          
          '<label style="display:flex;align-items:center;gap:4px;margin:4px 0;cursor:pointer;">',
          '<input type="checkbox" id="floodingToggle" checked style="margin:0;">',
          '<div style="width:16px;height:16px;background:#0891b2;border:2px solid white;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:7px;font-weight:bold;"><i class="fa-solid fa-water"></i></div>',
          'Flooding</label>'
        ].join('');
        return el;
      }

      function mountEventsLegendInline(){
        const row = findOverlayLabelRow(EVENTS_LABEL);
        if (!row) return;
        if (!document.getElementById('eventsLegend')){
          const el = buildEventsLegendEl();
          row.insertAdjacentElement('afterend', el);
          
          // Add event listeners for layer controls
          setTimeout(() => {
            
            // Storage arrays are already initialized in loadEvents() function
            // Don't reinitialize them here or we'll lose all the stored markers!
            
            // Simple category toggles - each controls both points and lines
            const categoryMappings = [
              { id: 'closuresToggle', category: 'closures' },
              { id: 'futureClosuresToggle', category: 'futureClosures' },
              { id: 'incidentsToggle', category: 'incidents' },
              { id: 'constructionToggle', category: 'construction' },
              { id: 'futureConstructionToggle', category: 'futureConstruction' },
              { id: 'floodingToggle', category: 'flooding' }
            ];
            
            // Use setTimeout to ensure DOM elements are ready and use event delegation
            setTimeout(() => {
              const eventsLegend = document.getElementById('eventsLegend');
              if (eventsLegend && !window._eventsLegendDelegationSetup) {
                eventsLegend.addEventListener('change', (e) => {
                  console.log('Checkbox changed in events legend:', e.target.id, 'type:', e.target.type, 'checked:', e.target.checked);
                  if (e.target.type === 'checkbox' && e.target.id.endsWith('Toggle')) {
                    console.log(`PROCESSING Toggle changed: ${e.target.id}, checked:`, e.target.checked);
                    console.log('Current storage state:', Object.keys(window._eventMarkersByCategory || {}));
                    setTimeout(() => {
                      console.log('About to call filterMarkersAndLinesByCategory');
                      filterMarkersAndLinesByCategory();
                    }, 10);
                  } else {
                    console.log('IGNORING checkbox change - does not end with Toggle or not a checkbox');
                  }
                });
                window._eventsLegendDelegationSetup = true;
                console.log('Event delegation setup for events legend');
              }
            }, 100);
            
            // Combined marker and line filtering function
            window.filterMarkersAndLinesByCategory = function() {
              if (!window._eventMarkersByCategory || !window._eventLinesByCategory) {
                console.warn('Event storage objects not initialized yet');
                return;
              }
              
              console.log('Filtering markers and lines by category...');
              
              // Clear all markers and lines
              eventsPointLayer.clearLayers();
              eventsLineLayer.clearLayers();
              eventsDetourLayer.clearLayers();
              
              // Re-add markers and lines based on category settings
              Object.keys(window._eventMarkersByCategory).forEach(category => {
                const toggle = document.getElementById(category + 'Toggle');
                const shouldShow = toggle?.checked === true;
                console.log(`Category: ${category}, toggle found:`, !!toggle, 'checked:', toggle?.checked, 'shouldShow:', shouldShow);
                
                if (shouldShow && window._eventMarkersByCategory[category]) {
                  console.log(`Adding ${category}: ${window._eventMarkersByCategory[category].length} markers, ${window._eventLinesByCategory[category]?.length || 0} lines`);
                  
                  // Add markers
                  let addedMarkers = 0;
                  window._eventMarkersByCategory[category].forEach(marker => {
                    if (marker && eventsPointLayer) {
                      eventsPointLayer.addLayer(marker);
                      addedMarkers++;
                    }
                  });
                  console.log(`Actually added ${addedMarkers} markers for ${category}`);
                  
                  // Add lines
                  let addedLines = 0;
                  if (window._eventLinesByCategory[category]) {
                    window._eventLinesByCategory[category].forEach(line => {
                      if (line) {
                        if (line._isDetour && eventsDetourLayer) {
                          eventsDetourLayer.addLayer(line);
                          addedLines++;
                        } else if (!line._isDetour && eventsLineLayer) {
                          eventsLineLayer.addLayer(line);
                          addedLines++;
                        }
                      }
                    });
                  }
                  console.log(`Actually added ${addedLines} lines for ${category}`);
                } else if (shouldShow) {
                  console.log(`Category ${category} shouldShow but no markers in storage`);
                }
              });
              
              // Update line visibility based on zoom
              if (window.updateLineVisibility) {
                window.updateLineVisibility();
              }
            };
          }, 100);
        }
      }

      function setEventsLegendVisible(show){
        const el = document.getElementById('eventsLegend');
        if (el) el.style.display = show ? 'block' : 'none';
      }

      map.on('overlayadd', (e) => {
        if (e.layer === eventsCombined){
          mountEventsLegendInline();
          setEventsLegendVisible(true);
          requestAnimationFrame(sizeLegend);
        }
      });
      map.on('overlayremove', (e) => {
        if (e.layer === eventsCombined){
          setEventsLegendVisible(false);
          requestAnimationFrame(sizeLegend);
          // Reset delegation flag to allow re-initialization if layer is re-added
          window._eventsLegendDelegationSetup = false;
        }
      });
      if (map.hasLayer(eventsCombined)){
        mountEventsLegendInline();
        setEventsLegendVisible(true);
        requestAnimationFrame(sizeLegend);
      }
/* ===================== Inline mount + logic for CWFIS controls ===================== */
  const riskControls = $('#riskControls'), riskTime = $('#riskTime'), riskStamp = $('#riskStamp'), riskLegend = $('#riskLegend'), riskErr = $('#riskErr');
  const fwiControls  = $('#fwiControls'),  fwiTime  = $('#fwiTime'),  fwiStamp  = $('#fwiStamp'),  fwiLegend  = $('#fwiLegend'), fwiErr  = $('#fwiErr'),  fwiComp = $('#fwiComp');
  const fbpControls  = $('#fbpControls'),  fbpTime  = $('#fbpTime'),  fbpStamp  = $('#fbpStamp'),  fbpLegend  = $('#fbpLegend'), fbpErr  = $('#fbpErr'),  fbpMetric = $('#fbpMetric');


// === Responsive option labels: full names on desktop, codes on mobile ===
function setSelectOptionLabels(selectEl, useShort){
  if (!selectEl) return;
  for (const opt of selectEl.options){
    const longTxt = opt.dataset.long || opt.textContent;
    const shortTxt = opt.dataset.short || (opt.value || '').toUpperCase();
    opt.textContent = useShort ? shortTxt : longTxt;
    // Keep full name as tooltip even when short is shown
    opt.title = longTxt;
  }
}
function applyResponsiveOptionLabels(){
  const isMobile = window.matchMedia('(max-width: 480px)').matches;
  setSelectOptionLabels(fwiComp,  isMobile);
  setSelectOptionLabels(fbpMetric, isMobile);
}
// Run now and on viewport changes
applyResponsiveOptionLabels();
window.addEventListener('resize', applyResponsiveOptionLabels, { passive:true });
window.addEventListener('orientationchange', applyResponsiveOptionLabels, { passive:true });
if (window.visualViewport){
  visualViewport.addEventListener('resize', applyResponsiveOptionLabels, { passive:true });
  visualViewport.addEventListener('scroll', applyResponsiveOptionLabels, { passive:true });
}

  // Initialize slider ranges
  [riskTime, fwiTime, fbpTime].forEach(sl => { sl.min = 0; sl.max = String(dates.length - 1); sl.value = String(CWFIS_PAST); });

  function findOverlayLabelRow(name){
    const rows = document.querySelectorAll('.leaflet-control-layers-overlays label');
    for (const row of rows){ const t=row.querySelector('.text')||row; if (t && t.textContent.trim()===name) return row; }
    return null;
  }
  function mountControlsInline(layerName, el){
    const row = findOverlayLabelRow(layerName);
    if (!row || !el) return;
    if (el.parentElement !== row.parentElement || el.previousElementSibling !== row) row.after(el);
  }
  // Update on zoom (legend SCALE)
  map.on('zoomend', ()=>{
    riskLegend.src = legendURLForLayer( cwfisLayerName('fdr', dates[+riskTime.value]) );
fwiLegend.src  = legendURLForLayer( cwfisLayerName(fwiComp.value, dates[+fwiTime.value]) );
fbpLegend.src  = legendURLForLayer( cwfisLayerName(fbpMetric.value, dates[+fbpTime.value]) );

  });

  // --- Fire Risk handlers ---
  function updateRisk(){
    const d = dates[parseInt(riskTime.value,10)];
    riskStamp.textContent = annotate(d);
    try{
      riskLayer.setParams({ layers: cwfisLayerName('fdr', d) });
      riskLegend.src = legendURLForLayer( cwfisLayerName('fdr', d) );
      riskErr.style.display = 'none';
    }catch{ riskErr.style.display = 'block'; }
  }
  riskTime.addEventListener('input', ()=>{ updateRisk(); });

  // --- FWI handlers ---
  function updateFWI(){
    const d = dates[parseInt(fwiTime.value,10)], comp = fwiComp.value;
    fwiStamp.textContent = annotate(d);
    try{
      fwiLayer.setParams({ layers: cwfisLayerName(comp, d) });
      fwiLegend.src = legendURLForLayer( cwfisLayerName(comp, d) );
      fwiErr.style.display = 'none';
    }catch{ fwiErr.style.display = 'block'; }
  }
  fwiTime.addEventListener('input', updateFWI);
  fwiComp.addEventListener('change', updateFWI);

  // --- FBP handlers ---
  function updateFBP(){
    const d = dates[parseInt(fbpTime.value,10)], metric = fbpMetric.value;
    fbpStamp.textContent = annotate(d);
    try{
      fbpLayer.setParams({ layers: cwfisLayerName(metric, d) });
      fbpLegend.src = legendURLForLayer( cwfisLayerName(metric, d) );

      fbpErr.style.display = 'none';
    }catch{ fbpErr.style.display = 'block'; }
  }
  fbpTime.addEventListener('input', updateFBP);
  fbpMetric.addEventListener('change', updateFBP);

  
// ---------- Simple player helper (mirrors smoke play/pause) ----------
const CWFIS_FRAME_MS = 3000;
function setupCwfisPlayer(playBtn, slider, onTick){
  let timer=null;
  const play = () => {
    if (timer) return;
    playBtn.textContent='⏸';
    timer = setInterval(() => {
      const max = parseInt(slider.max,10);
      let i = parseInt(slider.value,10);
      i = (i + 1) % (max + 1);
      slider.value = String(i);
      onTick();
    }, CWFIS_FRAME_MS);
  };
  const pause = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    playBtn.textContent='▶';
  };
  playBtn.addEventListener('click', () => (timer ? pause() : play()));
  slider.addEventListener('input', pause); // scrubbing pauses playback
  return { play, pause, isPlaying:()=>!!timer };
}

// Grab play buttons & create players
const riskPlay = $('#riskPlay');
const fwiPlay  = $('#fwiPlay');
const fbpPlay  = $('#fbpPlay');
const riskPlayer = setupCwfisPlayer(riskPlay, riskTime, updateRisk);
const fwiPlayer  = setupCwfisPlayer(fwiPlay,  fwiTime, updateFWI);
const fbpPlayer  = setupCwfisPlayer(fbpPlay,  fbpTime, updateFBP);

  // Mount + show/hide just like Smoke
  map.on('overlayadd', (e)=>{
    if (e.layer === riskLayer){
      mountControlsInline('Fire Risk', riskControls);
      riskControls.style.display = 'block';
      updateRisk();
      requestAnimationFrame(sizeLegend);
    }
    if (e.layer === fwiLayer){
      mountControlsInline('Fire Weather', fwiControls);
      fwiControls.style.display = 'block';
      updateFWI();
      requestAnimationFrame(sizeLegend);
    }
    if (e.layer === fbpLayer){
      mountControlsInline('Fire Behavior', fbpControls);
      fbpControls.style.display = 'block';
      updateFBP();
      requestAnimationFrame(sizeLegend);
    }
  });
  map.on('overlayremove', (e)=>{
    if (e.layer === riskLayer){ riskControls.style.display = 'none'; riskPlayer.pause(); requestAnimationFrame(sizeLegend); }
    if (e.layer === fwiLayer){  fwiControls.style.display  = 'none'; fwiPlayer.pause(); requestAnimationFrame(sizeLegend); }
    if (e.layer === fbpLayer){  fbpControls.style.display  = 'none'; fbpPlayer.pause(); requestAnimationFrame(sizeLegend); }
  });

  // If any start enabled (unlikely), show inline immediately
  if (map.hasLayer(riskLayer)){ mountControlsInline('Fire Risk', riskControls); riskControls.style.display='block'; updateRisk(); }
  if (map.hasLayer(fwiLayer)){  mountControlsInline('Fire Weather', fwiControls); fwiControls.style.display='block'; updateFWI(); }
  if (map.hasLayer(fbpLayer)){  mountControlsInline('Fire Behavior', fbpControls); fbpControls.style.display='block'; updateFBP(); }

  // Let ResizeObserver size the Overview when legends change
  ro?.observe(riskControls); ro?.observe(fwiControls); ro?.observe(fbpControls);

      // Final sizing after legend mount
      requestAnimationFrame(() => { sizeLegend(); layoutTitleBox(); });
});
