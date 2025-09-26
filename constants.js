/**
 * NBFireMap Constants and Configuration
 * 
 * This module contains all the configuration values, URLs, and constants
 * used throughout the NBFireMap application.
 */

// Export configuration object to global namespace
window.NBFireMapConstants = {
  
  // ---- Map Configuration ------------------------------------------------
  MAP: {
    // Zoom settings
    CONTROLLED_ZOOM_LEVEL: 14,    // Max zoom for programmatic navigation
    MAX_ZOOM: 18,                 // Absolute maximum zoom level
    DEFAULT_MIN_ZOOM: 8,          // Default minimum zoom for flyTo operations
    
    // View bounds and initial settings
    NB_BOUNDS: [[44.0, -69.5], [48.5, -62.0]],
    INITIAL_VIEW: { center: [46.7, -66.2], zoom: 7 },
    
    // Local storage key for map view persistence
    LS_KEY: 'nbMapView'
  },

  // ---- Time Zone Configuration ------------------------------------------
  TIMEZONE: {
    ATLANTIC_TZ: 'America/Halifax'
  },

  // ---- External Service URLs --------------------------------------------
  SERVICES: {
    // Aviation data
    OPEN_SKY_URL: 'https://opensky-network.org/api/states/all',
    
    // NOAA smoke forecasts
    NOAA_SMOKE_WMS: 'https://mapservices.weather.noaa.gov/raster/rest/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer/WMSServer',
    NOAA_SMOKE_WMS_BASE_URL: 'https://mapservices.weather.noaa.gov/raster/rest/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer/WMSServer',
    NOAA_SMOKE_WMS_LAYER: 'ndgd_smoke_sfc_1hr_avg_time',
    NOAA_RADAR: 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer',
    
    // Canadian weather and fire services
    CWFIS_WFS: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows',
    GEOMET_WMS: 'https://geo.weather.gc.ca/geomet',
    
    // ESRI ArcGIS services
    ACTIVE_PERIMETERS: 'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/Active_Wildfire_Perimeters_in_Canada_View/FeatureServer/0',
    CANADA_PROVINCES: 'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/Provinces_and_Territories_of_Canada/FeatureServer/0',
    WEATHER_STATIONS: 'https://services.arcgis.com/zmLUiqh7X11gGV2d/ArcGIS/rest/services/EnvironmentCanada/FeatureServer/0',
    
    // GeoNB services (New Brunswick government)
    CROWN_LAND: 'https://geonb.snb.ca/arcgis/rest/services/GeoNB_DNR_Crown_Land/MapServer',
    CROWN_LAND_VECTOR: 'https://geonb.snb.ca/arcgis/rest/services/GeoNB_DNR_Crown_Land/MapServer/3',
    NB_COUNTIES: 'https://geonb.snb.ca/arcgis/rest/services/GeoNB_SNB_Counties/MapServer/0',
    NB_BURN_BANS: 'https://gis-erd-der.gnb.ca/gisserver/rest/services/FireWeather/BurnCategories/MapServer',
    
    // Imagery services
    SENTINEL2: 'https://sentinel.arcgis.com/arcgis/rest/services/Sentinel2/ImageServer',
    OSM_TILES: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  },

  // ---- Refresh Intervals (milliseconds) --------------------------------
  REFRESH: {
    PLANES: 250_000,              // 4.17 minutes - aircraft positions
    LIGHTNING: 120_000,           // 2 minutes - lightning strikes
    SMOKE_FRAME: 1_200            // 1.2 seconds - smoke timeline animation
  },

  // ---- Smoke Configuration ----------------------------------------------
  SMOKE: {
    HOURS_FORWARD: 24,            // Hours of forecast to show ahead
    FRAME_MS: 1_200,              // Animation frame duration
    OPACITY: 0.72                 // Layer opacity
  },

  // ---- Crown Land Layer Settings ---------------------------------------
  CROWN_LAND: {
    IMG_MIN_ZOOM: 5,              // Minimum zoom for raster crown land
    VECTOR_MIN_ZOOM: 18           // Minimum zoom for vector crown land
  },

  // ---- Fire Status Colors and Configuration ----------------------------
  FIRE_STATUS: {
    // CSS color variables (read from CSS custom properties)
    COLORS: {
      oc: 'var(--oc)',           // Out of control
      mon: 'var(--mon)',         // Being monitored  
      cont: 'var(--cont)',       // Contained
      uc: 'var(--uc)',           // Under control
      pat: 'var(--pat)',         // Being patrolled
      perimeter: 'var(--perimeter)',
      boundary: 'var(--boundary)',
      modis: 'var(--modis)'
    },

    // Status mapping with colors and severity rankings
    STATUS_MAP: new Map([
      ['out of control', { color: 'var(--oc)', sev: 4 }],
      ['being monitored', { color: 'var(--mon)', sev: 3 }],
      ['contained', { color: 'var(--cont)', sev: 2 }],
      ['under control', { color: 'var(--uc)', sev: 1 }],
      ['being patrolled', { color: 'var(--pat)', sev: 0 }],
      ['extinguished', { color: '#0000FF', sev: -1 }]
    ])
  },

  // ---- Layer Z-Index Configuration --------------------------------------
  PANES: [
    ['alwaysOnTopPopup', 9999],
    ['sentinelPane', 400],
    ['nbBoundaryPane', 405],
    ['crownPane', 406],
    ['countiesPane', 407],
    ['smokePane', 410],
    ['perimetersPane', 412],
    ['radarPane', 413],
    ['lightningPane', 413],
    ['viirsPane', 414],
    ['weatherPane', 640],
    ['aqiPane', 416],
    ['firesPane', 650],
    ['planesPane', 1000, true] // third element indicates pointer-events: auto
  ],

  // ---- Basemap Configuration -------------------------------------------
  BASEMAPS: {
    IMAGERY: 'Imagery',           // ESRI basemap name
    OSM: 'osm',                   // Custom OSM basemap key
    DEFAULT: 'imagery'            // Default basemap selection
  },

  // ---- Layer Opacity Defaults ------------------------------------------
  OPACITY: {
    SMOKE: 0.72,
    RADAR: 0.8,
    SENTINEL: 0.75,
    BURN_BANS: 0.7
  },

  // ---- Cluster Configuration -------------------------------------------
  CLUSTERING: {
    DISABLE_AT_ZOOM: 11,          // Zoom level to disable fire clustering
    SPIDERFY_ON_MAX: true,
    ZOOM_TO_BOUNDS_ON_CLICK: false,
    SHOW_COVERAGE_ON_HOVER: false
  }
};

// Backwards compatibility - expose individual constants
Object.assign(window.NBFireMapConstants, {
  // Legacy constant names for backwards compatibility
  CONTROLLED_ZOOM_LEVEL: window.NBFireMapConstants.MAP.CONTROLLED_ZOOM_LEVEL,
  NB_BOUNDS: window.NBFireMapConstants.MAP.NB_BOUNDS,
  INITIAL_VIEW: window.NBFireMapConstants.MAP.INITIAL_VIEW,
  LS_KEY: window.NBFireMapConstants.MAP.LS_KEY,
  ATLANTIC_TZ: window.NBFireMapConstants.TIMEZONE.ATLANTIC_TZ,
  OPEN_SKY_URL: window.NBFireMapConstants.SERVICES.OPEN_SKY_URL,
  PLANES_REFRESH_MS: window.NBFireMapConstants.REFRESH.PLANES,
  NOAA_SMOKE_WMS: window.NBFireMapConstants.SERVICES.NOAA_SMOKE_WMS,
  NOAA_SMOKE_WMS_BASE_URL: window.NBFireMapConstants.SERVICES.NOAA_SMOKE_WMS_BASE_URL,
  NOAA_SMOKE_WMS_LAYER: window.NBFireMapConstants.SERVICES.NOAA_SMOKE_WMS_LAYER,
  SMOKE_HOURS_FORWARD: window.NBFireMapConstants.SMOKE.HOURS_FORWARD,
  SMOKE_FRAME_MS: window.NBFireMapConstants.SMOKE.FRAME_MS,
  LIGHTNING_REFRESH_MS: window.NBFireMapConstants.REFRESH.LIGHTNING,
  CWFIS_WFS: window.NBFireMapConstants.SERVICES.CWFIS_WFS,
  CROWN_IMG_MIN_ZOOM: window.NBFireMapConstants.CROWN_LAND.IMG_MIN_ZOOM,
  CROWN_VECT_MIN_ZOOM: window.NBFireMapConstants.CROWN_LAND.VECTOR_MIN_ZOOM
});