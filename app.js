/* =========================================================================
       NB Fire Map — refactored for clarity and maintainability.
       ========================================================================= */

    // ---- Utilities ----------------------------------------------------------
    const COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','S','SSW','SW','WSW','W','WNW','NW','NNW','N'];
    const degToCompass = (deg) => Number.isFinite(deg) ? COMPASS_16[Math.round((((deg % 360)+360)%360) / 22.5)] : '—';

    window.addEventListener('DOMContentLoaded', () => {
      'use strict';

      // DOM helpers
      const D = document;
      const $  = (sel, root=D) => root.querySelector(sel);
      const $$ = (sel, root=D) => root.querySelectorAll(sel);

        // Nearby panel elements
  const nearbyPanel = $('#nearbyPanel');
  const nearbyTitle = $('#nearbyTitle');
  const nearbyBody  = $('#nearbyBody');
  const nearbyCloseBtn = $('#nearbyClose');

  function nearbyPanelHeight(){
    if (!nearbyPanel || nearbyPanel.hidden) return 0;
    const r = nearbyPanel.getBoundingClientRect();
    return Math.ceil(r.height + 12); // include gap to map edge
  }

  function openNearbyPanel(title, html){
    nearbyTitle.textContent = title || 'Nearby Fires';
    nearbyBody.innerHTML = html || '';
    nearbyPanel.hidden = false;
    nearbyPanel.style.display = 'block';
  }
  function closeNearbyPanel(){
    nearbyPanel.style.display = 'none';
    nearbyPanel.hidden = true;
    // also clear any proximity lines/labels
    cityProximityLayer.clearLayers?.();
  }
  nearbyCloseBtn?.addEventListener('click', closeNearbyPanel);
  // Close on ESC
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !nearbyPanel.hidden){ closeNearbyPanel(); }});

      // ---- Constants --------------------------------------------------------
      const LS_KEY = 'nbMapView';
      const NB_BOUNDS = [[44.0, -69.5], [48.5, -62.0]];
      const INITIAL_VIEW = { center: [46.7, -66.2], zoom: 7 };
      const ATLANTIC_TZ = 'America/Moncton';

      // External sources & timing
      const OPEN_SKY_URL = 'https://opensky-network.org/api/states/all';
      const PLANES_REFRESH_MS = 250_000;

      // NEW: WMS endpoint + layer for surface smoke (direct WMS access)
      const NOAA_SMOKE_WMS = 'https://mapservices.weather.noaa.gov/raster/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer/WMSServer';
      const NOAA_SMOKE_WMS_LAYER = 'ndgd_smoke_sfc_1hr_avg_time';
      const SMOKE_HOURS_EACH_SIDE = 24;
      const SMOKE_FRAME_MS = 1_200;

      const LIGHTNING_REFRESH_MS = 120_000;

      // CSS vars → JS
      const cssVar = (name) => getComputedStyle(D.documentElement).getPropertyValue(name).trim();
      const COLORS = {
        oc: cssVar('--oc'), mon: cssVar('--mon'), cont: cssVar('--cont'),
        uc: cssVar('--uc'), pat: cssVar('--pat'),
        perimeter: cssVar('--perimeter'), boundary: cssVar('--boundary'),
        modis: cssVar('--modis'),
      };

      // Status map
      const STATUS = new Map([
        ['out of control', { color: COLORS.oc,  sev: 4 }],
        ['being monitored',{ color: COLORS.mon, sev: 3 }],
        ['contained',      { color: COLORS.cont, sev: 2 }],
        ['under control',  { color: COLORS.uc,   sev: 1 }],
        ['being patrolled',{ color: COLORS.pat,  sev: 0 }],
        ['extinguished',   { color: '#0000FF',   sev: -1 }],
      ]);
      const norm = (s) => (s || '').toString().trim().toLowerCase();
      const statusColor1   = (s) => STATUS.get(norm(s))?.color ?? '#0000FF';
      const severityRank  = (s) => STATUS.get(norm(s))?.sev   ?? -1;

      // Formatting helpers
      const isMobile = () => innerWidth < 768;
      const toNum = (v, d=1) => (v==null || Number.isNaN(Number(v))) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d });
      const fmtDateTime = (ms) => ms == null ? '—' : new Date(+ms).toLocaleString(undefined, { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });

      // Force Atlantic local time for UI stamps
      const fmtDateTimeTz = (ms, tz = ATLANTIC_TZ) =>
        ms == null ? '—' : new Date(+ms).toLocaleString(undefined, {
          year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', timeZone: tz
        });

      const fmtDateTZ = (ms, tz=ATLANTIC_TZ) => ms == null ? '—' : new Date(+ms).toLocaleDateString(undefined, { year:'numeric', month:'2-digit', day:'2-digit', timeZone: tz });

      // Date comparisons (in a TZ)
      const ymdInTz = (ms, tz = ATLANTIC_TZ) => {
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        const parts = fmt.formatToParts(new Date(ms));
        const get = (k) => +parts.find(p => p.type === k)?.value;
        return { y: get('year'), m: get('month'), d: get('day') };
      };
      const sameYMD = (a, b, tz = ATLANTIC_TZ) => {
        if (a == null || b == null) return false;
        const A = ymdInTz(a, tz), B = ymdInTz(b, tz);
        return A.y === B.y && A.m === B.m && A.d === B.d;
      };
      const startOfTodayUTCfromTz = (tz = ATLANTIC_TZ) => {
        const t = ymdInTz(Date.now(), tz);
        return Date.UTC(t.y, t.m - 1, t.d);
      };
      const isToday = (ms, tz = ATLANTIC_TZ) => sameYMD(ms, Date.now(), tz);
      const isYesterday = (ms, tz = ATLANTIC_TZ) => {
        if (ms == null) return false;
        const a = ymdInTz(ms, tz);
        const aUTC = Date.UTC(a.y, a.m - 1, a.d);
        const todayUTC = startOfTodayUTCfromTz(tz);
        return aUTC === (todayUTC - 86_400_000);
      };

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
      const getDetectedMs = (p) => {
        for (const k of ['TIME_DETECTED','DATE_DETECTED','DETECTED','FIRE_START_DATE','START_DATE']) {
          const ms = parseDateFlexible(p?.[k]);
          if (ms != null) return ms;
        }
        return null;
      };
      const getExtinguishedMs = (p) => {
        for (const k of ['FIRE_OUT_DATE','OUT_DATE','DATE_OUT','DATE_EXTINGUISHED','OUT_TIME','EXTINGUISHED','FIRE_STAT_DATE']) {
          const ms = parseDateFlexible(p?.[k]);
          if (ms != null) return ms;
        }
        return null;
      };
      const getRetrievedInfo = (p) => {
        const [, v] = firstProp(p, ['FETCHED_FROM_ERD','FETCHED_FROM_GNB','GNB_FETCHED','GNB_RETRIEVED_AT','RETRIEVED_FROM_GNB','FETCHED_AT','FETCH_TIMESTAMP','SOURCE_FETCHED_AT','ERD_FETCHED_AT']);
        if (v == null) return { ms:null, bool:null, raw:null };
        const ms = parseDateFlexible(v); if (ms != null) return { ms, bool:null, raw:v };
        const sv = String(v).trim().toLowerCase();
        if (typeof v === 'boolean' || ['true','yes','y','1'].includes(sv))  return { ms:null, bool:true,  raw:v };
        if (['false','no','n','0'].includes(sv))                           return { ms:null, bool:false, raw:v };
        return { ms:null, bool:null, raw:v };
      };

      // ---- Title layout guards (avoid overlap with buttons) -----------------
      const titleEl = $('#mapTitle');
      function layoutTitleBox(){
        const leftBtn  = $('#resetViewBtn');
        const rightBtn = $('#mapToggleBtn');
        const leftW  = leftBtn  ? Math.ceil(leftBtn.getBoundingClientRect().width)  : 0;
        const rightW = rightBtn ? Math.ceil(rightBtn.getBoundingClientRect().width) : 0;
        const GUTTER = 12;
        const LEFT_GUARD  = 12 + leftW  + GUTTER;
        const RIGHT_GUARD = 12 + rightW + GUTTER;
        const root = D.documentElement;
        root.style.setProperty('--left-guard',  LEFT_GUARD  + 'px');
        root.style.setProperty('--right-guard', RIGHT_GUARD + 'px');
        if (!titleEl) return;
        requestAnimationFrame(() => {
          const tooTight = titleEl.scrollWidth > titleEl.clientWidth;
          titleEl.classList.toggle('wrap', tooTight);
        });
      }

      // ---- Map init & panes -------------------------------------------------
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      const map = L.map('map', { center: saved?.center || INITIAL_VIEW.center, zoom: saved?.zoom || INITIAL_VIEW.zoom });
      map.on('moveend', () => {
        const c = map.getCenter();
        localStorage.setItem(LS_KEY, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() }));
      });

      [
        ['alwaysOnTopPopup',9999],
        ['sentinelPane',400],
        ['nbBoundaryPane',405],
        ['crownPane',406],
        ['countiesPane',407],
        ['smokePane',410],
        ['perimetersPane',412],
        ['radarPane',413],
        ['lightningPane',413],
        ['viirsPane',414],
        ['weatherPane',640],
        ['aqiPane',416],
        ['firesPane',650],
        ['planesPane',1000,true]
      ].forEach(([name, z, pe]) => { const p = map.createPane(name); p.style.zIndex = z; if (pe) p.style.pointerEvents = 'auto'; });

// Basemaps: Esri Imagery (current) and OpenStreetMap
 const basemaps = {
   imagery: L.esri.basemapLayer('Imagery'),
   osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
     maxZoom: 19,
     attribution: '&copy; OpenStreetMap contributors'
   })
 };
 // Restore preference or default to imagery
 const savedBase = (localStorage.getItem('basemap') || 'imagery');
 (savedBase === 'osm' ? basemaps.osm : basemaps.imagery).addTo(map);

 function setBasemap(which){
   if(which === 'osm'){
     if(map.hasLayer(basemaps.imagery)) map.removeLayer(basemaps.imagery);
     if(!map.hasLayer(basemaps.osm)) basemaps.osm.addTo(map);
   }else{
     if(map.hasLayer(basemaps.osm)) map.removeLayer(basemaps.osm);
     if(!map.hasLayer(basemaps.imagery)) basemaps.imagery.addTo(map);
   }
   localStorage.setItem('basemap', which);
 }

      L.control.locate({
        position: 'topleft',
        flyTo: true,
        showPopup: false,
        keepCurrentZoomLevel: true,
        icon: 'fa-solid fa-location-crosshairs',
        strings: { title: 'Show me where I am' }
      }).addTo(map);

      // ---- Quick location click-catcher → nearby fires ----------------------
      const userLocLayer = L.layerGroup({ pane: 'planesPane' }).addTo(map);
      let userLocMarker = null;
      function gpsToFires(latlng) { cityToFires('Your Location', latlng); }
      function upsertUserLoc(latlng) {
        if (userLocMarker) { userLocMarker.setLatLng(latlng); return; }
        const icon = L.divIcon({ className: 'user-loc-click-catcher', html: '', iconSize: [44,44], iconAnchor: [22,22] });
        userLocMarker = L.marker(latlng, { icon, pane: 'planesPane', keyboard:false, title:'Your location — tap to see nearby fires' })
          .on('click', () => gpsToFires(userLocMarker.getLatLng()))
          .addTo(userLocLayer);
      }
      map.on('locationfound', (e) => { if (e?.latlng) upsertUserLoc(e.latlng); });
      map.on('locationerror', () => { userLocLayer.clearLayers(); userLocMarker = null; });

      const fitProvinceToView = ({ animate=false } = {}) => {
        const padX = Math.round(innerWidth  * 0.04);
        const padY = Math.round(innerHeight * 0.04);
        map.fitBounds(NB_BOUNDS, { paddingTopLeft:[padX,padY], paddingBottomRight:[padX,padY], animate });
      };

      // ---- Local fires (GeoJSON) + clustering -------------------------------
      const fireStore = new Map();
      let fireClusters = null;
      const activeFireMarkers = [];
      const outFireMarkers = [];

      const ensureFireClusters = () => {
        if (fireClusters) return;
        fireClusters = L.markerClusterGroup({
          disableClusteringAtZoom: 11,
          spiderfyOnMaxZoom: true,
          zoomToBoundsOnClick: true,
          showCoverageOnHover: false,
          iconCreateFunction:(cluster)=>{
            const markers = cluster.getAllChildMarkers();
            let worstSev = -2, worstKey = 'extinguished';
            for(const m of markers){
              const k = m.options._statusKey || 'extinguished';
              const sev = Number.isFinite(m.options._severity) ? m.options._severity : severityRank(k);
              if(sev > worstSev){ worstSev = sev; worstKey = k; }
            }
            const ring = statusColor1(worstKey);
            const count = cluster.getChildCount();
            return L.divIcon({
              className:'fire-cluster-icon',
              html: `
                <div style="position:relative;display:inline-grid;place-items:center">
                  <div class="marker-badge" style="--ring:${ring};width:42px;height:42px"><i class="fa-solid fa-fire"></i></div>
                  <div style="position:absolute;bottom:-6px;right:-6px;background:var(--panel-strong);border:2px solid ${ring};border-radius:999px;
                              font:800 12px/1.1 Inter,system-ui,Arial;padding:4px 7px;box-shadow:0 2px 8px rgba(0,0,0,.18)">${count}</div>
                </div>`,
              iconSize:[42,42], iconAnchor:[21,28], popupAnchor:[0,-24]
            });
          },
          pane: 'firesPane',
          clusterPane: 'firesPane'
        }).addTo(map);
      };

      // Friendly popup hover/click behavior
      function bindHoverTogglePopup(layer){
        let clicked=false, openT=null, closeT=null;
        const OPEN_MS=150, CLOSE_MS=60;
        const clear=()=>{ if(openT){clearTimeout(openT);openT=null} if(closeT){clearTimeout(closeT);closeT=null} };
        layer.on('mouseover',function(){ if(clicked) return; if(closeT) clearTimeout(closeT);
          if(!openT){ openT=setTimeout(()=>{ openT=null; this.openPopup?.(); },OPEN_MS); }});
        layer.on('mouseout',function(){ if(clicked) return; if(openT) clearTimeout(openT);
          if(!closeT){ closeT=setTimeout(()=>{ closeT=null; this.closePopup?.(); },CLOSE_MS); }});
        layer.on('click',function(){ clicked=!clicked; clear(); clicked?this.openPopup?.():this.closePopup?.(); });
        layer.on('remove', clear);
      }

      function bindFirePopup(props, layer, explicitStatus) {
        const status = explicitStatus || props.FIRE_STAT_DESC_E || '—';
        const pct = getContainPct(props);
        const pctStr = pct != null ? `${toNum(pct,0)}%` : '—';
        const retrieved = getRetrievedInfo(props);
        const retrievedStr = (retrieved.ms != null)
          ? fmtDateTime(retrieved.ms)
          : (retrieved.bool != null ? (retrieved.bool ? 'Yes' : 'No') : (retrieved.raw ?? '—'));

        const html = `
          <div style="font:14px/1.45 Inter,system-ui,Segoe UI,Arial;min-width:240px;color:var(--text)">
            <div style="font-weight:800;font-size:16px;margin-bottom:6px;letter-spacing:.2px">#${props.FIRE_NUMBER_SHORT} ${props.FIRE_NAME || props.FIRE_ID || 'Unnamed Fire'}</div>
            <div style="margin:6px 0 10px">
              <span style="display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border-radius:999px;background:var(--panel);border:1px solid var(--border);font-weight:800;box-shadow:0 2px 8px rgba(0,0,0,.12)">
                <span class="dot" style="background:${statusColor1(status)}"></span>${status}
              </span>
            </div>
            <div><b>Area:</b> ${toNum(props.FIRE_SIZE ?? props.SIZE_HA ?? props.AREA,1)} ha</div>
            <div><b>Contained:</b> ${pctStr}</div>
            <div><b>Detected:</b> ${fmtDateTime(getDetectedMs(props))}</div>
            ${norm(status)==='extinguished'
              ? `<div><b>Extinguished:</b> ${fmtDateTime(getExtinguishedMs(props))}</div>`
              : `<div><b>Status updated:</b> ${fmtDateTime(props.FIRE_STAT_DATE)}</div>`}
            <div><b>Retrieved from GNB:</b> ${retrievedStr}</div>
          </div>`;
        layer.bindPopup(html,{maxWidth:340,pane:'alwaysOnTopPopup'});

        const rawId = props.GlobalID || props.OBJECTID || props.FIRE_ID || Math.random().toString(36).slice(2)+Date.now().toString(36);
        const id = String(rawId);
        fireStore.set(id,{ id, props, latlng: layer.getLatLng(), layer, statusKey: layer.options._statusKey });
        bindHoverTogglePopup(layer);
      }

      function makeFireMarker(props, coords, explicitStatus){
        const [lng, lat] = coords; // GeoJSON order
        const statusKey = norm(explicitStatus || props.FIRE_STAT_DESC_E || '—');
        const marker = L.marker([lat, lng], {
          pane: 'firesPane',
          icon: L.divIcon({
            className:'fire-badge-icon',
            html:`<div class="marker-badge" style="--ring:${statusColor1(statusKey)}"><i class="fa-solid fa-fire"></i></div>`,
            iconSize:[38,38],iconAnchor:[19,26],popupAnchor:[0,-22]
          }),
          keyboard:false
        });
        marker.options._statusKey = statusKey;
        marker.options._severity  = severityRank(statusKey);
        bindFirePopup(props, marker, explicitStatus);
        return marker;
      }

      async function fetchLocalAny(base){
        const attempts = [
          `${base}.json`, `${base}.geojson`, `./${base}.json`, `./${base}.geojson`,
          `data/${base}.json`, `data/${base}.geojson`, `./data/${base}.json`, `./data/${base}.geojson`,
        ];
        for (const url of attempts) {
          try { const r = await fetch(url, { cache:'no-store' }); if (r.ok) return await r.json(); } catch {}
        }
      }

      function applyFireFilter(){
        ensureFireClusters();
        const cbs = $$('.fire-filter-block input[type="checkbox"]');
        const enabled = new Set(); cbs.forEach(cb => { if (cb.checked) enabled.add(norm(cb.getAttribute('data-status'))); });
        fireClusters.clearLayers();
        for (const m of activeFireMarkers) if (enabled.has(m.options._statusKey)) fireClusters.addLayer(m);
        if (enabled.has('extinguished')) for (const m of outFireMarkers) fireClusters.addLayer(m);
      }

      async function loadLocalFires(){
        try {
          const [activeData, outData] = await Promise.all([ fetchLocalAny('active_fires'), fetchLocalAny('out_fires') ]);

          (activeData?.features||[]).forEach((f)=>{
            if (!f || f.geometry?.type !== 'Point') return;
            const m = makeFireMarker(f.properties||{}, f.geometry.coordinates, f.properties?.FIRE_STAT_DESC_E);
            activeFireMarkers.push(m);
          });

          (outData?.features||[]).forEach((f)=>{
            if (!f || f.geometry?.type !== 'Point') return;
            const m = makeFireMarker(f.properties||{}, f.geometry.coordinates, 'Extinguished');
            outFireMarkers.push(m);
          });

          applyFireFilter();
          refreshSummary();
        } catch (e) { console.error('Loading local fires failed:', e); }
      }

      map.whenReady(() => { fitProvinceToView({ animate:false }); loadLocalFires(); });

      // ---- CWFIS Hotspots (WFS) ---------------------------------------------
      const CWFIS_WFS = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows';
      function cwfisWfsUrl(typeName, bounds) {
        const b = bounds || map.getBounds();
        const minx = b.getWest(), miny = b.getSouth(), maxx = b.getEast(), maxy = b.getNorth();
        const params = new URLSearchParams({
          service: 'WFS', version: '1.0.0', request: 'GetFeature',
          typeName, srsName: 'EPSG:4326',
          bbox: `${minx},${miny},${maxx},${maxy},EPSG:4326`,
          outputFormat: 'application/json'
        });
        return `${CWFIS_WFS}?${params.toString()}`;
      }
      const cwfis24 = L.geoJSON(null, {
        pane: 'viirsPane',
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, { radius: 5, color: 'var(--modis)', fillColor: 'var(--modis)', fillOpacity: 0.9 })
      }).addTo(map);

      const cwfis7 = L.geoJSON(null, {
        pane: 'viirsPane',
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, { radius: 4, color: 'var(--modis)', fillColor: 'var(--modis)', fillOpacity: 0.65 })
      });

      async function loadCwfis(layer, typeName) {
        try {
          const url = cwfisWfsUrl(typeName, map.getBounds());
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) throw new Error(r.statusText);
          const gj = await r.json();
          layer.clearLayers();
          layer.addData(gj);
        } catch (err) {
          console.warn('CWFIS WFS load failed:', err);
        }
      }
      let cwfisPanTimer = null;
      function refreshVisibleCwfis() {
        if (cwfisPanTimer) cancelAnimationFrame(cwfisPanTimer);
        cwfisPanTimer = requestAnimationFrame(() => {
          if (map.hasLayer(cwfis24)) loadCwfis(cwfis24, 'public:hotspots_last24hrs');
          if (map.hasLayer(cwfis7))  loadCwfis(cwfis7,  'public:hotspots_last7days');
        });
      }
      map.whenReady(() => refreshVisibleCwfis());
      map.on('moveend', refreshVisibleCwfis);
      map.on('overlayadd',   (e) => { if (e.layer === cwfis24 || e.layer === cwfis7) refreshVisibleCwfis(); });

      // ---- Perimeters / Boundary -------------------------------------------
      const perimeterLabelLayers = new Set();
      const activePerimeters = L.esri.featureLayer({
        url:'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/Active_Wildfire_Perimeters_in_Canada_View/FeatureServer/0',
        pane:'perimetersPane',
        style:()=>({color:COLORS.perimeter,weight:1.2,fillOpacity:.18}),
        onEachFeature:(feature,layer)=>{
          const ha = feature?.properties?.AREA;
          layer.bindTooltip(`<span class="perimeter-label" style="color:${COLORS.perimeter}">${toNum(ha,1)} ha</span>`,
            {permanent:true,className:'perimeter-label-tooltip',direction:'center',opacity:0});
          perimeterLabelLayers.add(layer);
        }
      }).addTo(map);
      const setPerimeterLabels = ()=> {
        const show = map.getZoom() >= 11;
        perimeterLabelLayers.forEach((l)=>l.getTooltip()?.setOpacity(show?1:0));
      };
      activePerimeters.on('load', setPerimeterLabels);
      map.on('zoomend', setPerimeterLabels);

      const nbBoundary = L.esri.featureLayer({
        url:'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/Provinces_and_Territories_of_Canada/FeatureServer/0',
        where:"Name_EN = 'New Brunswick'",
        pane:'nbBoundaryPane',
        style:()=>({color: COLORS.boundary, weight:5, fill:false}),
        interactive:false
      }).addTo(map);

      // ---- Crown Land staged loader ----------------------------------------
      const CROWN_IMG_MIN_ZOOM = 5;
      const CROWN_VECT_MIN_ZOOM = 18;

      const crownProxy = L.layerGroup({ pane: 'crownPane' }); // for legend toggling
      let crownImage = null, crownVector = null;
      let crownImgAttached = false, crownVecAttached = false;

      function getCrownImageLayer() {
        if (crownImage) return crownImage;
        crownImage = L.esri.dynamicMapLayer({
          url: 'https://geonb.snb.ca/arcgis/rest/services/GeoNB_DNR_Crown_Land/MapServer',
          layers: [3], opacity: 0.45, format: 'png32', transparent: true, pane: 'crownPane'
        });
        return crownImage;
      }
      function getCrownVectorLayer() {
        if (crownVector) return crownVector;
        crownVector = L.esri.featureLayer({
          url: 'https://geonb.snb.ca/arcgis/rest/services/GeoNB_DNR_Crown_Land/MapServer/3',
          pane: 'crownPane',
          fields: ['OBJECTID'], precision: 3, simplifyFactor: 1.2,
          renderer: L.canvas(), smoothFactor: 2,
          style: () => ({ color: '#065f46', weight: 1.8, fillColor: '#86efac', fillOpacity: 0.28 })
        });
        return crownVector;
      }
      function updateCrownStages() {
        const proxyOn = map.hasLayer(crownProxy);
        if (!proxyOn) {
          if (crownImgAttached && crownImage) { crownProxy.removeLayer(crownImage); crownImgAttached = false; }
          if (crownVecAttached && crownVector){ crownProxy.removeLayer(crownVector); crownVecAttached = false; }
          return;
        }
        const z = map.getZoom();
        const needImage = z >= CROWN_IMG_MIN_ZOOM && z < CROWN_VECT_MIN_ZOOM;
        const needVector = z >= CROWN_VECT_MIN_ZOOM;

        if (needImage) {
          if (!crownImage) getCrownImageLayer();
          if (!crownImgAttached) { crownProxy.addLayer(crownImage); crownImgAttached = true; }
        } else if (crownImgAttached) { crownProxy.removeLayer(crownImage); crownImgAttached = false; }

        if (needVector) {
          if (!crownVector) getCrownVectorLayer();
          if (!crownVecAttached) { crownProxy.addLayer(crownVector); crownVecAttached = true; }
        } else if (crownVecAttached) { crownProxy.removeLayer(crownVector); crownVecAttached = false; }
      }
      let crownZoomRaf = null;
      const debouncedUpdateCrown = () => { if (crownZoomRaf) cancelAnimationFrame(crownZoomRaf); crownZoomRaf = requestAnimationFrame(updateCrownStages); };
      map.on('zoomend', debouncedUpdateCrown);
      map.on('moveend', debouncedUpdateCrown);
      map.on('overlayadd',   (e) => { if (e.layer === crownProxy) debouncedUpdateCrown(); });
      map.on('overlayremove',(e) => { if (e.layer === crownProxy) debouncedUpdateCrown(); });

      // ---- Counties (off by default) ---------------------------------------
      const countyLabelLayers = new Set();
      const counties = L.esri.featureLayer({
        url: 'https://geonb.snb.ca/arcgis/rest/services/GeoNB_SNB_Counties/MapServer/0',
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
      const setCountyLabels = () => {
        const show = map.getZoom() >= 8;
        countyLabelLayers.forEach((l) => l.getTooltip()?.setOpacity(show ? 1 : 0));
      };
      counties.on('load', setCountyLabels);
      map.on('zoomend', setCountyLabels);

      // ---- Sentinel imagery & burn bans ------------------------------------
      const sentinel2 = L.esri.imageMapLayer({ url:'https://sentinel.arcgis.com/arcgis/rest/services/Sentinel2/ImageServer', opacity:0.75, pane:'sentinelPane' });
      sentinel2.on('load', ()=> sentinel2.bringToFront());
      const nbBurnBans = L.esri.dynamicMapLayer({ url:'https://gis-erd-der.gnb.ca/gisserver/rest/services/FireWeather/BurnCategories/MapServer', opacity:.7, pane:'perimetersPane' });

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
        url: 'https://services.arcgis.com/zmLUiqh7X11gGV2d/ArcGIS/rest/services/EnvironmentCanada/FeatureServer/0',
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

      const noaaRadar = L.esri.imageMapLayer({ url:'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer', opacity:.8, pane:'radarPane' });

      const lightningLayer = L.tileLayer.wms('https://geo.weather.gc.ca/geomet',{
        layers:'Lightning_2.5km_Density',version:'1.3.0',format:'image/png',transparent:true,opacity:1,pane:'lightningPane'
      });

      let lightningTimer=null;
      const startLightningRefresh=()=>{ if(!lightningTimer){ lightningTimer=setInterval(()=>{ lightningLayer.setParams({_ :Date.now()}); }, LIGHTNING_REFRESH_MS); } };
      const stopLightningRefresh = ()=>{ if(lightningTimer){ clearInterval(lightningTimer); lightningTimer=null; } };
      map.on('overlayadd',(e)=>{ if(e.layer===lightningLayer) startLightningRefresh(); if(e.layer===sentinel2) sentinel2.bringToFront(); });
      map.on('overlayremove',(e)=>{ if(e.layer===lightningLayer) stopLightningRefresh(); });

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
      const smokeLayer = L.tileLayer.wms(NOAA_SMOKE_WMS, { layers: NOAA_SMOKE_WMS_LAYER, format:'image/png', transparent:true, version:'1.3.0', opacity:0.72, pane:'smokePane'}).addTo(map);

      const smokeControls   = $('#smokeControls');
      const smokePlayBtn    = $('#smokePlay');
      const smokeSlider     = $('#smokeTime');
      const smokeTsLabel    = $('#smokeTimestamp');
      let smokeTimesMs = [], smokeIdx = 0, smokeTimer = null;
      let smokeShouldAutoplayNextOn = false, smokePendingAutoplay = false;

      const smokeFmt = (ms) => {
        const d = new Date(ms);
        return isMobile()
          ? d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false })
          : `${d.toLocaleString(undefined, { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false })} (local)`;
      };

      function smokeSetIndex(i){
        if (!smokeTimesMs.length) return;
        smokeIdx = Math.max(0, Math.min(smokeTimesMs.length - 1, i));
        const t = smokeTimesMs[smokeIdx];
        const dt = new Date(t);
        smokeLayer.setParams({ time: dt.toISOString() });
        smokeSlider.value = String(smokeIdx);
        smokeTsLabel.textContent = smokeFmt(t);
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
  // Prefer WMS GetCapabilities (TIME dimension). Fallback to ImageServer /slices JSON if needed.
  const setLabel = (txt)=> smokeTsLabel.textContent = txt;
  try{
    setLabel('Loading…');
    // 1) Try WMS GetCapabilities
    const capUrl = NOAA_SMOKE_WMS + '?service=WMS&request=GetCapabilities';
    let times = [];
    try {
      const r = await fetch(capUrl, { cache: 'no-store' });
      if (r.ok) {
        const xml = await r.text();
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        // Support WMS 1.1/1.3: Dimension or Extent element with name="time"
        const dimNode = doc.querySelector('Dimension[name="time"], Extent[name="time"]');
        if (dimNode && dimNode.textContent) {
          const raw = dimNode.textContent.trim();
          // Cases:
          // - comma-separated ISO times
          // - start/end/period: 2025-09-19T03:00:00Z/2025-09-21T06:00:00Z/PT1H
          if (raw.includes('/')){
            const parts = raw.split('/');
            if (parts.length >= 3){
              const start = Date.parse(parts[0]);
              const end   = Date.parse(parts[1]);
              const step  = parts[2]; // e.g., PT1H
              // parse ISO8601 duration PTnH , PTnM, PTnS (we expect hours)
              let stepMs = 3600000; // default 1h
              const m = step.match(/^P(T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/i);
              if (m){
                const h = parseInt(m[2] || '0', 10);
                const mm= parseInt(m[3] || '0', 10);
                const s = parseInt(m[4] || '0', 10);
                stepMs = (h*3600 + mm*60 + s) * 1000;
              }
              if (Number.isFinite(start) && Number.isFinite(end) && stepMs > 0){
                for (let t=start; t<=end+1; t+=stepMs){ times.push(t); }
              }
            }
          } else {
            times = raw.split(',').map(s => Date.parse(s.trim())).filter(Number.isFinite).sort((a,b)=>a-b);
          }
        }
      }
    } catch (e){ /* ignore; will try fallback */ }

    // 2) Fallback to ImageServer slices JSON (works cross-domain and is reliable)
    if (!times.length){
      const r = await fetch(NOAA_SMOKE_URL + '/slices?f=json', { cache: 'no-store' });
      if(!r.ok) throw new Error('Failed to load time slices');
      const json = await r.json();
      times = (json.slices || [])
        .map(s => s.multidimensionalDefinition?.[0]?.values?.[0])
        .filter(v => typeof v === 'number')
        .sort((a,b)=>a-b);
    }

    if(!times.length){ setLabel('No time frames available'); return; }

    const now = Date.now();
    const windowMs = SMOKE_HOURS_EACH_SIDE * 3600 * 1000;
    let within = times.filter(t => t >= (now - windowMs) && t <= (now + windowMs));

    if(within.length === 0){
      // choose a centered window around the nearest time
      let lo=0, hi=times.length-1, best=0, bestDiff=Infinity;
      while(lo<=hi){ const mid=(lo+hi)>>1, diff=Math.abs(times[mid]-now);
        if(diff<bestDiff){ bestDiff=diff; best=mid; }
        if(times[mid] < now) lo=mid+1; else hi=mid-1;
      }
      const start = Math.max(0, best - SMOKE_HOURS_EACH_SIDE);
      const end   = Math.min(times.length - 1, best + SMOKE_HOURS_EACH_SIDE);
      within = times.slice(start, end+1);
    }

    smokeTimesMs = within;
    smokeSlider.max = String(within.length - 1);
    smokeIdx = nearestIndex(within, now);
    smokeSlider.value = String(smokeIdx);

    if (map.hasLayer(smokeLayer)) {
      smokeSetIndex(smokeIdx);
      if (smokePendingAutoplay || smokeShouldAutoplayNextOn) {
        smokePlay(); smokePendingAutoplay = false; smokeShouldAutoplayNextOn = false;
      }
    } else {
      setLabel(smokeFmt(within[smokeIdx]));
    }
  } catch (e){
    console.error('Smoke timeline load failed:', e);
    smokeTsLabel.textContent = 'Error loading smoke timeline';
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

      // ---- City labels ------------------------------------------------------
      const CITY_DATA = [
        ['Moncton',46.0878,-64.7782,79000],['Saint John',45.2733,-66.0633,69000],['Fredericton',45.9636,-66.6431,63000],
        ['Dieppe',46.0842,-64.6877,28500],['Riverview',46.0617,-64.8052,20500],['Miramichi',47.0281,-65.5019,17500],
        ['Edmundston',47.3730,-68.3251,16000],['Rothesay',45.3830,-65.9965,12000],['Bathurst',47.6186,-65.6517,12000],
        ['Quispamsis',45.4319,-65.9469,19500],['Oromocto',45.8491,-66.4828,9500],['Campbellton',48.0075,-66.6731,6700],
        ['Sackville',45.8960,-64.3688,5500],['Grand Bay-Westfield',45.3629,-66.2306,5200],['Woodstock',46.1527,-67.6016,5200],
        ['Grand Falls',47.0469,-67.7394,5200],['Shediac',46.2197,-64.5403,7000],['Tracadie',47.5081,-64.9117,16000],
        ['Caraquet',47.7943,-64.9386,4200],['Shippagan',47.7400,-64.7078,2700],['Bouctouche',46.4711,-64.7400,2400],
        ['Sussex',45.7221,-65.5060,4300],['St. Stephen',45.1942,-67.2756,4500],['St. Andrews',45.0730,-67.0530,2100],
        ['Hampton',45.5322,-65.8332,4400],['Dalhousie',48.0658,-66.3737,2900],['Florenceville-Bristol',46.4448,-67.6170,1600],
        ['Saint-Quentin',47.5120,-67.3920,2100],['Kedgwick',47.6450,-67.3430,950],['Plaster Rock',46.9108,-67.3949,1100],
        ['Perth-Andover',46.7372,-67.7089,1600],['Saint-Léonard',47.1640,-67.9250,1300],['Neguac',47.2420,-65.0580,1500],
        ['Petit-Rocher',47.7900,-65.7130,1400],['Bas-Caraquet',47.7860,-64.9730,1400],['Richibucto',46.6770,-64.8710,1300],
        ['Rexton',46.6490,-64.8750,830],['Rogersville',46.7370,-65.4380,1200],['Hillsborough',45.9190,-64.7630,1300],
        ['St. George',45.1290,-66.8270,1500],['Blacks Harbour',45.0520,-66.7880,900],['McAdam',45.5940,-67.3250,1100],
        ['Minto',46.1480,-66.0840,2400],['Chipman',46.1680,-65.8820,1200],['Doaktown',46.5550,-66.1180,800],
        ['Nackawic',45.9960,-67.2510,950],['Hartland',46.2990,-67.5150,950],['Cap-Pelé',46.2260,-64.2750,2400],
        ['Memramcook',46.0020,-64.5480,5000],
      ];
      function makeCityMarker(name, lat, lng, pop){
        const m = L.marker([lat, lng], { icon: L.divIcon({ html:'', iconSize:[0,0] }), interactive: true, zIndexOffset: 1000 })
          .bindTooltip(`<span class="city-label">${name}</span>`, { permanent: true, direction: 'top', className: 'city-label-tooltip', interactive: true });
        m.options._name = name; m.options._pop  = Number.isFinite(pop) ? pop : 0;
        const handler = () => cityToFires(name, m.getLatLng());
        m.on('click', handler);
        m.getTooltip()?.on('click', handler);
        return m;
      }
      const cityClusters = L.markerClusterGroup({
        disableClusteringAtZoom: 9, spiderfyOnMaxZoom: false, zoomToBoundsOnClick: true, showCoverageOnHover: false,
        iconCreateFunction: (cluster) => {
          const markers = cluster.getAllChildMarkers();
          let top = null, best = -1;
          for (const m of markers){ const p = m.options?._pop ?? 0; if (p > best){ best = p; top = m; } }
          const label = top?.options?._name || `×${markers.length}`;
          return L.divIcon({ className: 'city-cluster-icon', html: `<span class="city-label">${label}</span>`, iconSize: [0,0], popupAnchor: [0,0] });
        }
      });
      CITY_DATA.forEach(([name,lat,lng,pop]) => { cityClusters.addLayer(makeCityMarker(name, lat, lng, pop)); });
      cityClusters.addTo(map);

      // ---- Overlays & control ----------------------------------------------
      
// ==== NB External Layers (OFF by default; lazy-loaded) ====
const ferriesLayer = L.markerClusterGroup({ pane: 'firesPane',
  disableClusteringAtZoom: 10,
  spiderfyOnMaxZoom: true,
  zoomToBoundsOnClick: true,
  showCoverageOnHover: false,
  iconCreateFunction: (cluster) => {
    const markers = cluster.getAllChildMarkers();
    // Compute worst status among children: red > orange > green
    let worst = -1, color = '#27ae60'; // default green
    for (const m of markers) {
      const sev = Number.isFinite(m.options._fSeverity) ? m.options._fSeverity : 0;
      if (sev > worst) worst = sev;
    }
    if (worst >= 2) color = '#e74c3c'; else if (worst === 1) color = '#f39c12';
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
  zoomToBoundsOnClick: true,
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
const eventsPointLayer = L.layerGroup({ pane: 'firesPane' });
const eventsLineLayer = L.layerGroup({ pane: 'firesPane' });
const eventsDetourLayer = L.layerGroup({ pane: 'firesPane' });
const eventsCombined = L.layerGroup({ pane: 'firesPane' });
const winterRoadsLayer = L.layerGroup({ pane: 'radarPane' });

function statusColor(status){
  if (!status) return '#666';
  const s = status.toLowerCase();
  if (s.includes('reduced') || s.includes('delayed')) return '#f39c12';
  if (s.includes('out of service') || s.includes('closed')) return '#e74c3c';
  return '#27ae60';
}

function ferryIcon(color = '#27ae60') {
  // Font Awesome ferry inside our circular badge; color controlled by --ring CSS var
  return L.divIcon({
    className: 'ferry-badge-icon',
    html: `<div class="marker-badge" style="--ring:${color}"><i class="fa-solid fa-ferry"></i></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 26],
    popupAnchor: [0, -22]
  });
}




function makeWebcamIcon(color = '#1f6feb') {
  // Font Awesome camera inside our circular badge; color controlled by --ring CSS var
  return L.divIcon({
    className: 'webcam-badge-icon',
    html: `<div class="marker-badge" style="--ring:${color}"><i class="fa-solid fa-camera"></i></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 26],
    popupAnchor: [0, -22]
  });
}
const webcamIcon = makeWebcamIcon();
const POINT_COLORS = {
  closures: '#e11d48',       // red
  restrictions: '#f59e0b',   // amber
  incidents: '#f97316',      // orange
  construction: '#8e44ad',   // purple
  other: '#1f6feb',          // blue
  default: '#1f6feb'         // fallback
};
const WINTER_COLORS = {
  'Bare Dry':'#2ecc71','Bare Wet':'#3498db','Slushy':'#8e44ad','Snow Covered':'#e67e22',
  'Compacted Snow':'#d35400','Ice Covered':'#e74c3c','Partly Covered':'#f1c40f','Closed':'#7f8c8d','Unknown':'#95a5a6'
};
function colorForType(t){
  const k = (t||'').toString().trim().toLowerCase();
  if (POINT_COLORS[k]) return POINT_COLORS[k];
  if (k.includes('clos')) return POINT_COLORS.closures;
  if (k.includes('restrict') || k.includes('delay') || k.includes('reduc')) return POINT_COLORS.restrictions;
  if (k.includes('incident') || k.includes('accident')) return POINT_COLORS.incidents;
  if (k.includes('construct') || k.includes('mainten') || k.includes('work')) return POINT_COLORS.construction;
  return POINT_COLORS.default;
}
let _ferriesLoaded=false, _webcamsLoaded=false, _eventsLoaded=false, _winterLoaded=false;

function escHTML(s){ return (s??'').toString().replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function epochToLocal(sec){ if(sec==null) return '—'; const d=new Date(sec*1000); return isNaN(d)?'—':d.toLocaleString(); }

async function loadFerries(){

  if (_ferriesLoaded) return;
  try {
    const r = await fetch('ferries.json',{cache:'no-store'});
    const ferries = await r.json();
    (ferries||[]).forEach(f => {
      const color = statusColor(f.Status);
      const sev = (()=>{ const s=(f.Status||'').toLowerCase(); if (s.includes('out of service')||s.includes('closed')) return 2; if (s.includes('reduced')||s.includes('delayed')) return 1; return 0; })();
      const marker = L.marker([f.Latitude, f.Longitude], { icon: ferryIcon(color), title: f.Name, _fSeverity: sev });
      const html = [
        '<div class="popup">',
        '<h3>'+escHTML(f.Name||'Ferry')+'</h3>',
        '<div class="meta"><span class="badge">'+escHTML(f.Area||'')+'</span></div>',
        '<div><strong>Status:</strong> '+escHTML(f.Status||'—')+'</div>',
        '<div><strong>Delays:</strong> '+escHTML(f.Delays||'—')+'</div>',
        '<div><strong>Service Disruption:</strong> '+escHTML(f.ServiceDisruption||'—')+'</div>',
        '<div style="margin-top:6px;color:#555;font-size:12px"><em>Last updated:</em> '+epochToLocal(f.LastUpdated)+'</div>',
        '</div>'
      ].join('');
      marker.bindPopup(html).addTo(ferriesLayer);
    });
    _ferriesLoaded = true;
  } catch(e) { console.error('Ferries layer load failed', e); }

}
async function loadWebcams(){

  if (_webcamsLoaded) return;
  try {
    const r = await fetch('webcams.json',{cache:'no-store'});
    const cams = await r.json();
    const withCB = (u) => { const hasQ=(u||'').includes('?'); const ts=Date.now(); return (u||'')+(hasQ?'&':'?')+'_ts='+ts; };
    
function buildViewHTML(v){
  const enabled = (v.Status || '').toLowerCase() === 'enabled';
  const badge = '<span class="badge ' + (enabled ? '' : 'disabled') + '">' + (enabled ? 'Enabled' : 'Disabled') + '</span>';
  const id    = (v.Id ?? '').toString();
  const imgId = 'img_' + Math.random().toString(36).slice(2);
  const errId = 'err_' + Math.random().toString(36).slice(2);

  return [
    '<div class="view" data-viewid="'+id+'" data-url="'+encodeURIComponent(v.Url || '')+'" data-imgid="'+imgId+'" data-errid="'+errId+'">',
      '<div class="meta"><strong>View '+id+'</strong> '+badge+' · <a href="'+(v.Url||'#')+'" target="_blank" rel="noopener">Open live feed</a></div>',
      (enabled ? '<img id="'+imgId+'" alt="Webcam view '+id+'" referrerpolicy="no-referrer" loading="lazy" />' : ''),
      (v.Description && v.Description !== 'N/A' ? '<div class="meta">'+escHTML(v.Description)+'</div>' : ''),
      '<div id="'+errId+'" class="error" style="display:none"></div>',
    '</div>'
  ].join('');
}
    function initPopupImages(container){
      const views = container.querySelectorAll('.view');
      views.forEach(v => {
        const original = decodeURIComponent(v.dataset.url || '');
        const img = document.getElementById(v.dataset.imgid);
        const err = document.getElementById(v.dataset.errid);
        if (!original || !img) return;
        const finalURL = withCB(original);
        err.style.display='none'; img.style.display='block';
        img.onload = () => { err.style.display='none'; };
        img.onerror = () => { img.style.display='none'; err.textContent='Could not load inline image (host may block embedding). Use the link above.'; err.style.display='block'; };
        img.src = finalURL;
      });
    }
    (cams||[]).forEach(cam => {
      const m = L.marker([cam.Latitude, cam.Longitude], { icon: (typeof webcamIcon !== 'undefined' ? webcamIcon : makeWebcamIcon()), title: cam.Name||'Webcam' });
      const title = cam.Name || 'Webcam';
      const road = cam.Road ? ' · '+cam.Road : '';
      const src = cam.Source ? ('Source: '+cam.Source) : '';
      const dir = cam.Direction && cam.Direction!=='Unknown' ? ' • '+cam.Direction : '';
      const viewsHTML = (cam.Views||[]).map(buildViewHTML).join('');
      const html = [
        '<div class="popup">',
        '<h3>'+escHTML(title)+road+dir+'</h3>',
        '<div class="meta">'+escHTML(src)+'</div>',
        '<div class="views">'+(viewsHTML || '<em>No views listed.</em>')+'</div>',
        '</div>'
      ].join('');
      m.bindPopup(html).on('popupopen', (e)=>{ initPopupImages(e.popup.getElement()); }).addTo(webcamsLayer);
    });
    _webcamsLoaded = true;
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
  try {
    const r = await fetch('events.json',{cache:'no-store'});
    const data = await r.json();

    function buildPopup(e){
      const restrictions = e.Restrictions || {};
      const parts = [
        '<div class="popup">',
        '<h3>'+escHTML(e.Description || 'Event')+'</h3>',
        '<div class="muted">'+escHTML(e.RoadwayName || '')+' · '+escHTML(e.DirectionOfTravel || '')+'</div>',
        '<table>',
        '<tr><td class="label">Type</td><td>'+escHTML(e.EventType)+(e.EventSubType? ' · '+escHTML(e.EventSubType):'')+'</td></tr>',
        '<tr><td class="label">Closure?</td><td>'+(e.IsFullClosure? 'Yes':'No')+'</td></tr>',
        '<tr><td class="label">Severity</td><td>'+escHTML(e.Severity || '—')+'</td></tr>',
        '<tr><td class="label">Reported</td><td>'+epochToLocal(e.Reported)+'</td></tr>',
        '<tr><td class="label">Updated</td><td>'+epochToLocal(e.LastUpdated)+'</td></tr>',
        '<tr><td class="label">Starts</td><td>'+epochToLocal(e.StartDate)+'</td></tr>',
        '<tr><td class="label">Planned End</td><td>'+epochToLocal(e.PlannedEndDate)+'</td></tr>',
        (e.DetourInstructions && e.DetourInstructions.length ? '<tr><td class="label">Detour</td><td>'+escHTML(Array.isArray(e.DetourInstructions)? e.DetourInstructions.join(' ') : e.DetourInstructions)+'</td></tr>' : ''),
        `<tr><td class="label">Restrictions</td><td>${
          [
            restrictions.Lanes ? ("Lanes: " + restrictions.Lanes) : "",
            restrictions.AllowedVehicles ? ("Allowed: " + restrictions.AllowedVehicles) : "",
            restrictions.HeavyVehicles ? ("Heavy: " + restrictions.HeavyVehicles) : "",
            restrictions.Width ? ("Width: " + restrictions.Width) : "",
            restrictions.Height ? ("Height: " + restrictions.Height) : "",
            restrictions.Length ? ("Length: " + restrictions.Length) : "",
            restrictions.Weight ? ("Weight: " + restrictions.Weight) : "",
            restrictions.Speed != null ? ("Speed: " + restrictions.Speed + " km/h") : ""
          ].filter(Boolean).join(" · ") || "—"
        }</td></tr>`,
        '</table>' +
        (e.Comment ? '<div style="margin-top:6px">' + escHTML(e.Comment) + '</div>' : '') +
        '</div>'];
      return parts.join('');
    }

    function addPoint(e){
      if (typeof e.Latitude !== 'number' || typeof e.Longitude !== 'number') return;
      const marker = L.circleMarker([e.Latitude, e.Longitude], {
        radius: 6, color: '#111827', weight: 1,
        fillColor: colorForType(e.EventType), fillOpacity: 0.9
      }).bindPopup(buildPopup(e));
      marker.addTo(eventsPointLayer).addTo(eventsCombined);
      if (typeof e.LatitudeSecondary==='number' && typeof e.LongitudeSecondary==='number'){
        const sec = L.circleMarker([e.LatitudeSecondary, e.LongitudeSecondary], {
          radius:5, color:'#6b7280', fillColor:'#9ca3af', fillOpacity: 0.7
        }).bindPopup('<b>Secondary location</b>');
        sec.addTo(eventsPointLayer).addTo(eventsCombined);
        L.polyline([[e.Latitude,e.Longitude],[e.LatitudeSecondary,e.LongitudeSecondary]],{color:'#6b7280', dashArray:'4,4', weight:2, opacity: .8}).addTo(eventsLineLayer).addTo(eventsCombined);
      }
    }

    
const LINE_STYLES = {
  encoded: { color: '#111827', weight: 4, opacity: 0.8 },      // event geometry (matches events.html)
  detour:  { color: '#8b5cf6', weight: 3, dashArray: '6,6', opacity: 0.9 } // detours (matches events.html)
};
function addEncodedLine(encoded, bindPopupHtml){
      try{
        const coords = polyline.decode(encoded).map(([lat, lng]) => [lat, lng]);
        if (coords && coords.length){
          const pl = L.polyline(coords, LINE_STYLES.encoded);
          if (bindPopupHtml) pl.bindPopup(bindPopupHtml);
          pl.addTo(eventsLineLayer).addTo(eventsCombined);
        }
      }catch(e){}
    }

    function addDetourLine(encoded, bindPopupHtml){
      try{
        const coords = polyline.decode(encoded).map(([lat, lng]) => [lat, lng]);
        if (coords && coords.length){
          const pl = L.polyline(coords, LINE_STYLES.detour);
          if (bindPopupHtml) pl.bindPopup('<b>Detour</b><br/>' + bindPopupHtml);
          pl.addTo(eventsDetourLayer).addTo(eventsCombined);
        }
      }catch(e){}
    }

    (data||[]).forEach(e => {
      addPoint(e);
      if (e.EncodedPolyline && e.EncodedPolyline.trim()) addEncodedLine(e.EncodedPolyline.trim(), buildPopup(e));
      if (e.DetourPolyline && e.DetourPolyline.trim()) addDetourLine(e.DetourPolyline.trim(), buildPopup(e));
    });
    _eventsLoaded = true;
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
      const secondary = (row['Secondary Conditions'] || row.secondaryConditions || []).join(', ') || '—';
      const road = row.RoadwayName || row.roadwayName || '—';
      const area = row.AreaName || row.areaName || '—';
      const vis = row.Visibility || row.visibility || '—';
      const desc = row.LocationDescription || row.locationDescription || '';
      const time = row.LastUpdated ? new Date(row.LastUpdated*1000).toLocaleString() : '—';
      const html = [
        '<div style="min-width:220px">',
        '<div class="cond">'+escHTML(cond)+'</div>',
        '<div>'+escHTML(road)+'</div>',
        '<div style="color:#555">'+escHTML(area)+'</div>',
        (desc ? '<div style="margin-top:6px">'+escHTML(desc)+'</div>' : ''),
        '<hr style="border:none;border-top:1px solid #0001;margin:8px 0" />',
        '<div><b>Secondary:</b> '+escHTML(secondary)+'</div>',
        '<div><b>Visibility:</b> '+escHTML(vis)+'</div>',
        '<div><b>Updated:</b> '+escHTML(time)+'</div>',
        '</div>'
      ].join('');
      line.bindPopup(html);
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
const overlays = {
        Smoke: smokeLayer,
            'Fire Risk': riskLayer,
    'Fire Weather': fwiLayer,
    'Fire Behavior': fbpLayer,
        'CWFIS Hotspots — Last 24 hours': cwfis24,
        'CWFIS Hotspots — Last 7 days': cwfis7,
        'Fire Perimeters': activePerimeters,
        'Cities & Towns': cityClusters,
        // ——— External NB layers ———
        'Ferries': ferriesLayer,
        'Road Webcams': webcamsLayer,
        'Road Events': eventsCombined,
        'Road Conditions': winterRoadsLayer,
        Aircraft: planesLayer,
        'Weather Stations': weatherStations,
        'AQHI Risk': aqhiLayer,
        'Weather Radar': noaaRadar,
        'Lightning Density': lightningLayer,
        'NB Burn Bans': nbBurnBans,
        'Crown Land': crownProxy,
        'Counties': counties,
        'Sentinel-2 Imagery': sentinel2
      };
      L.control.layers(null, overlays, { collapsed: false }).addTo(map);

      // ---- Fire-status filter checkboxes in legend --------------------------
      const FIRE_STATUS = [
        ['Out of Control',  COLORS.oc,  true],
        ['Being Monitored', COLORS.mon, true],
        ['Contained',       COLORS.cont,true],
        ['Under Control',   COLORS.uc,  true],
        ['Being Patrolled', COLORS.pat, true],
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
      injectFireStatusPanel();

      // ---- Move Summary & Help buttons into legend --------------------------
      function mountSummaryInLegend(){
        const layersBox = D.querySelector('.leaflet-control-layers');
        const fsBtn = $('#fireSummaryBtn');
        if (!layersBox || !fsBtn) return;
        const topbar = D.createElement('div');
        topbar.className = 'overview-topbar';
        fsBtn.classList.add('in-legend');
        topbar.append(fsBtn);
        
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
      function mountHelpInLegend(){
        const layersBox = D.querySelector('.leaflet-control-layers');
        if (!layersBox || layersBox.querySelector('.overview-footbar')) return;
        const footbar = D.createElement('div');
        footbar.className = 'overview-footbar';
        const helpBtn = D.createElement('button');
        helpBtn.type = 'button';
        helpBtn.className = 'legend-help-btn';
        helpBtn.innerHTML = '<span class="icon"><i class="fa-solid fa-circle-info"></i></span><span>Map Info &amp; How to Use</span>';
        helpBtn.addEventListener('click', openHelp);
        footbar.append(helpBtn);
        layersBox.append(footbar);
        requestAnimationFrame(sizeLegend);
      }
      mountSummaryInLegend();
      mountHelpInLegend();

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

      const fsOverlay=$('#fireSummaryOverlay');
      const fsBody=$('#fs-body');
      const fsBtn=$('#fireSummaryBtn');
      const fsClose=$('#fs-close');
      const sizeOf=(p)=> Number((p?.FIRE_SIZE ?? p?.SIZE_HA ?? p?.AREA) ?? 0) || 0;
      const fireStoreMap = fireStore;

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
          const color = statusColor1(k);
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
        fsBody.innerHTML = buildSummaryHTML();
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
          map.flyTo(rec.latlng, Math.max(map.getZoom(), 12), { duration:.6 });
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
          map.flyTo(matches[0].getLatLng(), Math.max(map.getZoom(), 11), { duration: 0.6 });
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
      'out of control': statusColor1('out of control'),
      'being monitored': statusColor1('being monitored'),
      'contained': statusColor1('contained'),
      'under control': statusColor1('under control'),
      'being patrolled': statusColor1('being patrolled')
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


      const openSummary = () => { refreshSummary(); fsOverlay.hidden=false; fsOverlay.style.display='flex'; fsClose.focus(); };
      const closeSummary = () => { fsOverlay.style.display='none'; fsOverlay.hidden=true; fsBtn.focus(); };
      fsBtn.addEventListener('click', openSummary);
      fsClose.addEventListener('click', closeSummary);
      fsOverlay.addEventListener('click',(e)=>{ if(e.target===fsOverlay) closeSummary(); });
      window.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && !fsOverlay.hidden) closeSummary(); });

      // ---- Help modal -------------------------------------------------------
      const mhOverlay = $('#mapHelpOverlay');
      const mhBody = $('#mh-body');
      const mhClose = $('#mh-close');

      function buildHelpHTML(){
  // Helper to render an NB status row using the same colors as the Overview
  const st = (label, key, text, abbr='') => `
    <li style="margin:6px 0; display:flex; gap:10px; align-items:flex-start;">
      <span class="legend-swatch" style="background:${statusColor1(key)}; flex:0 0 12px; margin-top:4px"></span>
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
    <h2>How to Use This Map</h2>
    <p>Drag to move, scroll or use <b>+</b>/<b>−</b> to zoom. The <b>Overview</b> panel lets you toggle layers. Time-series layers (Smoke, Fire Risk, Fire Weather, Fire Behavior) show inline controls under their row: use ▶ play, the slider, or drag the handle to change the date.</p>
    <p><b>Nearby Fires:</b> Click a city/town label or your location to list active fires within 30&nbsp;km, with distance lines; click any entry to zoom to that fire.</p>
    <h3>Layers Available</h3>
    ${layersHTML}
    <h3>Fire States</h3>
    ${fireStatesHTML}
    ${glossaryHTML}
    <h3>Sources</h3>
    <p>Data: <a href="https://cwfis.cfs.nrcan.gc.ca" target="_blank" rel="noopener">CWFIS (NRCan)</a>, <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a>, <a href="https://weather.gc.ca/" target="_blank" rel="noopener">ECCC</a>, <a href="https://www.weather.gov/" target="_blank" rel="noopener">NOAA</a>, <a href="https://opensky-network.org/" target="_blank" rel="noopener">OpenSky</a>, GNB ERD, and Esri services. This is an unofficial viewer.</p>
  `;
}

      function openHelp(){ mhBody.innerHTML = buildHelpHTML(); mhOverlay.hidden=false; mhOverlay.style.display='flex'; mhClose.focus(); }
      function closeHelp(){ mhOverlay.style.display='none'; mhOverlay.hidden=true; }
      mhClose.addEventListener('click', closeHelp);
      mhOverlay.addEventListener('click', (e)=>{ if(e.target === mhOverlay) closeHelp(); });
      window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !mhOverlay.hidden) closeHelp(); });

      // ---- Overview toggle & reset -----------------------------------------
      const mapToggleBtn = $('#mapToggleBtn');
      const mtbText = $('#mtb-text');
      const updateOverviewButton=()=>{
        const hidden = D.body.classList.contains('map-ui-hidden');
        const label = hidden ? 'Show Overview' : 'Hide Overview';
        mapToggleBtn.setAttribute('aria-pressed', String(!hidden));
        mapToggleBtn.title = label;
        mtbText.textContent = label;
        layoutTitleBox();
      };
      D.body.classList.add('map-ui-hidden');
      updateOverviewButton();

      mapToggleBtn.addEventListener('click', () => { D.body.classList.toggle('map-ui-hidden'); updateOverviewButton(); requestAnimationFrame(sizeLegend); });
      $('#resetViewBtn').addEventListener('click', () => { localStorage.removeItem(LS_KEY); fitProvinceToView({ animate:true }); });

      function hideOverviewPanel(){
        if (!D.body.classList.contains('map-ui-hidden')){
          D.body.classList.add('map-ui-hidden'); updateOverviewButton(); requestAnimationFrame(sizeLegend);
        }
      }

      // ---- City → Fires proximity ------------------------------------------
      const CITY_RADIUS_M = 30_000;
      const cityProximityLayer = L.layerGroup({ pane: 'firesPane' }).addTo(map);
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
          map.flyTo(cityLatLng, Math.max(map.getZoom(), 9), { duration:.6 });
          map.once('moveend', () => {
            map.fitBounds(L.latLngBounds([cityLatLng]), {
              paddingTopLeft: [pad, pad],
              paddingBottomRight: [pad, pad + pb],
              animate: true
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
          const color = statusColor1(statusKey);
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
          map.flyTo(rec.latlng, Math.max(map.getZoom(), 12), { duration: 0.6 });
          map.once('moveend', () => {
            rec.layer?.openPopup?.();
          });
        }, { passive: false, once: true });

                // Fit all lines above the panel
        const pad = Math.round(Math.min(innerWidth, innerHeight) * 0.08);
        const pb = nearbyPanelHeight();
        hideOverviewPanel();
        map.fitBounds(bounds, {
          paddingTopLeft: [pad, pad],
          paddingBottomRight: [pad, pad + pb],
          animate: true
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

      
  
      // === Inline legend for "Road Conditions" ==============================
      const WINTER_LABEL = 'Road Conditions';
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
          <div style="font-weight:800;margin:6px 0 4px">Road Conditions</div>
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
          'display:none;margin:6px 0 0 0;padding:6px 8px;',
          'border:1px solid var(--btn-border);border-radius:8px;background:var(--btn-bg);',
          'font-size:12px;line-height:1.25'
        ].join('');
        el.innerHTML = [
          '<div style="font-weight:800;margin-bottom:4px">Legend</div>',
          '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;"><span style="width:12px;height:12px;border-radius:50%;border:1px solid #0003;background:#e11d48;display:inline-block"></span> Closures</div>',
          '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;"><span style="width:12px;height:12px;border-radius:50%;border:1px solid #0003;background:#f59e0b;display:inline-block"></span> Roadwork</div>',
          '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;"><span style="width:12px;height:12px;border-radius:50%;border:1px solid #0003;background:#3b82f6;display:inline-block"></span> Incidents</div>',
          '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;"><span style="width:12px;height:12px;border-radius:50%;border:1px solid #0003;background:#10b981;display:inline-block"></span> Other</div>',
          '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;"><span style="width:12px;height:12px;border-radius:2px;border:1px solid #0003;background:#111827;display:inline-block"></span> Event geometry</div>',
          '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;"><span style="width:12px;height:12px;border-radius:2px;border:1px solid #0003;background:#8b5cf6;display:inline-block"></span> Detour</div>'
        ].join('');
        return el;
      }

      function mountEventsLegendInline(){
        const row = findOverlayLabelRow(EVENTS_LABEL);
        if (!row) return;
        if (!document.getElementById('eventsLegend')){
          const el = buildEventsLegendEl();
          row.insertAdjacentElement('afterend', el);
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
