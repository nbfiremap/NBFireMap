/**
 * NBFireMap Layer Management Utilities
 * 
 * This module provides utilities for managing map layers, including:
 * - Basemap switching
 * - Layer state management (add/remove/toggle)
 * - Crown land staged loading
 * - Fire clustering and filtering
 * - Layer group management
 * - Conditional layer loading
 */

window.NBFireMapLayerManager = {

  // ---- Basemap Management -----------------------------------------------
  basemaps: {
    setBasemap(map, basemaps, which) {
      if (which === 'osm') {
        if (map.hasLayer(basemaps.imagery)) map.removeLayer(basemaps.imagery);
        if (!map.hasLayer(basemaps.osm)) basemaps.osm.addTo(map);
      } else {
        if (map.hasLayer(basemaps.osm)) map.removeLayer(basemaps.osm);
        if (!map.hasLayer(basemaps.imagery)) basemaps.imagery.addTo(map);
      }
      localStorage.setItem('basemap', which);
    },

    createBasemaps(CONFIG) {
      return {
        imagery: L.esri.basemapLayer('Imagery'),
        osm: L.tileLayer(CONFIG.SERVICES.OSM_TILES, {
          maxZoom: CONFIG.MAP.MAX_ZOOM,
          attribution: '&copy; OpenStreetMap contributors'
        })
      };
    },

    initializeBasemap(map, basemaps) {
      const savedBase = localStorage.getItem('basemap') || 'imagery';
      (savedBase === 'osm' ? basemaps.osm : basemaps.imagery).addTo(map);
      return savedBase;
    }
  },

  // ---- Layer State Management -------------------------------------------
  layerState: {
    /**
     * Toggle a layer on/off the map
     */
    toggleLayer(map, layer) {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
        return false;
      } else {
        layer.addTo(map);
        return true;
      }
    },

    /**
     * Safely add layer to map if not already present
     */
    safeAddLayer(map, layer) {
      if (!map.hasLayer(layer)) {
        layer.addTo(map);
        return true;
      }
      return false;
    },

    /**
     * Safely remove layer from map if present
     */
    safeRemoveLayer(map, layer) {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
        return true;
      }
      return false;
    },

    /**
     * Check if layer is currently on the map
     */
    isLayerActive(map, layer) {
      return map.hasLayer(layer);
    },

    /**
     * Clear all layers from a layer group
     */
    clearLayerGroup(layerGroup) {
      if (layerGroup && layerGroup.clearLayers) {
        layerGroup.clearLayers();
      }
    }
  },

  // ---- Crown Land Staged Loading ----------------------------------------
  crownLand: {
    // Internal state
    _state: {
      crownImage: null,
      crownVector: null,
      crownImgAttached: false,
      crownVecAttached: false,
      crownProxy: null
    },

    /**
     * Initialize crown land proxy layer for legend control
     */
    initProxy() {
      this._state.crownProxy = L.layerGroup({ pane: 'crownPane' });
      return this._state.crownProxy;
    },

    /**
     * Get or create crown land image layer (raster)
     */
    getImageLayer(CONFIG) {
      if (this._state.crownImage) return this._state.crownImage;
      
      this._state.crownImage = L.esri.dynamicMapLayer({
        url: CONFIG.SERVICES.CROWN_LAND,
        layers: [3], 
        opacity: 0.45, 
        format: 'png32', 
        transparent: true, 
        pane: 'crownPane'
      });
      return this._state.crownImage;
    },

    /**
     * Setup crown land staging behavior based on zoom levels
     */
    setupStaging(map, crownProxy, CONFIG) {
      const updateCrownStages = () => {
        const proxyOn = map.hasLayer(crownProxy);
        if (!proxyOn) {
          if (this._state.crownImgAttached && this._state.crownImage) {
            crownProxy.removeLayer(this._state.crownImage);
            this._state.crownImgAttached = false;
          }
          if (this._state.crownVecAttached && this._state.crownVector) {
            crownProxy.removeLayer(this._state.crownVector);
            this._state.crownVecAttached = false;
          }
          return;
        }
        const z = map.getZoom();
        const needImage = z >= CONFIG.CROWN_IMG_MIN_ZOOM && z < CONFIG.CROWN_VECT_MIN_ZOOM;
        const needVector = z >= CONFIG.CROWN_VECT_MIN_ZOOM;

        if (needImage) {
          if (!this._state.crownImage) this._state.crownImage = this.getImageLayer(CONFIG);
          if (!this._state.crownImgAttached) {
            crownProxy.addLayer(this._state.crownImage);
            this._state.crownImgAttached = true;
          }
        } else if (this._state.crownImgAttached) {
          crownProxy.removeLayer(this._state.crownImage);
          this._state.crownImgAttached = false;
        }

        if (needVector) {
          if (!this._state.crownVector) this._state.crownVector = this.getVectorLayer(CONFIG);
          if (!this._state.crownVecAttached) {
            crownProxy.addLayer(this._state.crownVector);
            this._state.crownVecAttached = true;
          }
        } else if (this._state.crownVecAttached) {
          crownProxy.removeLayer(this._state.crownVector);
          this._state.crownVecAttached = false;
        }
      };

      let crownZoomRaf = null;
      const debouncedUpdateCrown = () => {
        if (crownZoomRaf) cancelAnimationFrame(crownZoomRaf);
        crownZoomRaf = requestAnimationFrame(updateCrownStages);
      };

      map.on('zoomend', debouncedUpdateCrown);
      map.on('moveend', debouncedUpdateCrown);
      map.on('overlayadd', (e) => { if (e.layer === crownProxy) debouncedUpdateCrown(); });
      map.on('overlayremove', (e) => { if (e.layer === crownProxy) debouncedUpdateCrown(); });
    },

    /**
     * Get or create crown land vector layer
     */
    getVectorLayer(CONFIG) {
      if (this._state.crownVector) return this._state.crownVector;
      
      this._state.crownVector = L.esri.featureLayer({
        url: CONFIG.SERVICES.CROWN_LAND_VECTOR,
        pane: 'crownPane',
        fields: ['OBJECTID'], 
        precision: 3, 
        simplifyFactor: 1.2,
        renderer: L.canvas(), 
        smoothFactor: 2,
        style: () => ({ 
          color: '#065f46', 
          weight: 1.8, 
          fillColor: '#86efac', 
          fillOpacity: 0.28 
        })
      });
      return this._state.crownVector;
    },

    /**
     * Update crown land layers based on zoom level
     */
    updateStages(map, CONFIG) {
      const proxyOn = map.hasLayer(this._state.crownProxy);
      if (!proxyOn) {
        // If proxy is off, ensure both layers are detached
        if (this._state.crownImgAttached && this._state.crownImage) {
          map.removeLayer(this._state.crownImage);
          this._state.crownImgAttached = false;
        }
        if (this._state.crownVecAttached && this._state.crownVector) {
          map.removeLayer(this._state.crownVector);
          this._state.crownVecAttached = false;
        }
        return;
      }

      const z = map.getZoom();
      const needImage = z >= CONFIG.CROWN_LAND.IMG_MIN_ZOOM && z < CONFIG.CROWN_LAND.VECTOR_MIN_ZOOM;
      const needVector = z >= CONFIG.CROWN_LAND.VECTOR_MIN_ZOOM;

      // Manage image layer
      if (needImage) {
        if (!this._state.crownImgAttached) {
          this.getImageLayer(CONFIG).addTo(map);
          this._state.crownImgAttached = true;
        }
      } else if (this._state.crownImgAttached && this._state.crownImage) {
        map.removeLayer(this._state.crownImage);
        this._state.crownImgAttached = false;
      }

      // Manage vector layer
      if (needVector) {
        if (!this._state.crownVecAttached) {
          this.getVectorLayer(CONFIG).addTo(map);
          this._state.crownVecAttached = true;
        }
      } else if (this._state.crownVecAttached && this._state.crownVector) {
        map.removeLayer(this._state.crownVector);
        this._state.crownVecAttached = false;
      }
    },

    /**
     * Set up crown land event handlers
     */
    setupEventHandlers(map, CONFIG) {
      let crownZoomRaf = null;
      const debouncedUpdate = () => {
        if (crownZoomRaf) cancelAnimationFrame(crownZoomRaf);
        crownZoomRaf = requestAnimationFrame(() => this.updateStages(map, CONFIG));
      };

      map.on('zoomend', debouncedUpdate);
      map.on('moveend', debouncedUpdate);
      map.on('overlayadd', (e) => {
        if (e.layer === this._state.crownProxy) debouncedUpdate();
      });
      map.on('overlayremove', (e) => {
        if (e.layer === this._state.crownProxy) debouncedUpdate();
      });
    }
  },

  // ---- Fire Clustering Management ---------------------------------------
  fireClustering: {
    /**
     * Create fire cluster group with configuration
     */
    createClusterGroup(CONFIG, statusColor1, severityRank) {
      return L.markerClusterGroup({
        disableClusteringAtZoom: CONFIG.CLUSTERING.DISABLE_AT_ZOOM,
        spiderfyOnMaxZoom: CONFIG.CLUSTERING.SPIDERFY_ON_MAX,
        zoomToBoundsOnClick: CONFIG.CLUSTERING.ZOOM_TO_BOUNDS_ON_CLICK,
        showCoverageOnHover: CONFIG.CLUSTERING.SHOW_COVERAGE_ON_HOVER,
        iconCreateFunction: (cluster) => {
          const markers = cluster.getAllChildMarkers();
          let worstSev = -2, worstKey = 'extinguished';
          
          for (const m of markers) {
            const k = m.options._statusKey || 'extinguished';
            const sev = Number.isFinite(m.options._severity) ? m.options._severity : severityRank(k);
            if (sev > worstSev) { 
              worstSev = sev; 
              worstKey = k; 
            }
          }
          
          const ring = statusColor1(worstKey);
          const count = cluster.getChildCount();
          
          return L.divIcon({
            className: 'fire-cluster-icon',
            html: `
              <div style="position:relative;display:inline-grid;place-items:center">
                <div class="marker-badge" style="--ring:${ring};width:42px;height:42px">
                  <i class="fa-solid fa-fire"></i>
                </div>
                <div style="position:absolute;bottom:-6px;right:-6px;background:var(--panel-strong);border:2px solid ${ring};border-radius:999px;font:800 12px/1.1 Inter,system-ui,Arial;padding:4px 7px;box-shadow:0 2px 8px rgba(0,0,0,.18)">
                  ${count}
                </div>
              </div>`,
            iconSize: [42, 42], 
            iconAnchor: [21, 28], 
            popupAnchor: [0, -24]
          });
        },
        pane: 'firesPane',
        clusterPane: 'firesPane'
      });
    },

    /**
     * Apply fire filters to cluster group
     */
    applyFireFilter(fireClusters, activeFireMarkers, outFireMarkers, normFunction = null) {
      const cbs = document.querySelectorAll('.fire-filter-block input[type="checkbox"]');
      const enabled = new Set();
      
      cbs.forEach(cb => {
        if (cb.checked) {
          const status = cb.getAttribute('data-status');
          const normalizedStatus = normFunction ? normFunction(status) : status?.toLowerCase?.()?.replace(/\s+/g, ' ')?.trim() || '';
          enabled.add(normalizedStatus);
        }
      });

      fireClusters.clearLayers();
      
      // Add active fire markers if their status is enabled
      for (const m of activeFireMarkers) {
        if (enabled.has(m.options._statusKey)) {
          fireClusters.addLayer(m);
        }
      }
      
      // Add extinguished fire markers if enabled
      if (enabled.has('extinguished')) {
        for (const m of outFireMarkers) {
          fireClusters.addLayer(m);
        }
      }
    }
  },

  // ---- Conditional Layer Loading ----------------------------------------
  conditionalLoading: {
    /**
     * Load layers based on map bounds/viewport
     */
    loadVisibleLayers(map, layers, loadFunction) {
      const bounds = map.getBounds();
      layers.forEach(layer => {
        if (map.hasLayer(layer)) {
          loadFunction(layer, bounds);
        }
      });
    },

    /**
     * Debounced layer refresh on map move
     */
    createDebouncedRefresh(refreshFunction, delay = 100) {
      let timer = null;
      return () => {
        if (timer) cancelAnimationFrame(timer);
        timer = requestAnimationFrame(refreshFunction);
      };
    },

    /**
     * Set up conditional loading event handlers
     */
    setupConditionalHandlers(map, refreshFunction) {
      const debouncedRefresh = this.createDebouncedRefresh(refreshFunction);
      
      map.on('moveend', debouncedRefresh);
      map.on('overlayadd', (e) => {
        // Refresh when specific layers are added
        debouncedRefresh();
      });
      
      map.whenReady(debouncedRefresh);
      return debouncedRefresh;
    }
  },

  // ---- Label Management --------------------------------------------------
  labels: {
    /**
     * Toggle layer labels based on zoom level
     */
    updateLayerLabels(labelLayers, shouldShow) {
      labelLayers.forEach(layer => {
        const tooltip = layer.getTooltip();
        if (tooltip) {
          tooltip.setOpacity(shouldShow ? 1 : 0);
        }
      });
    },

    /**
     * Create zoom-based label updater
     */
    createZoomLabelUpdater(map, labelLayers, minZoom) {
      const updateLabels = () => {
        const show = map.getZoom() >= minZoom;
        this.updateLayerLabels(labelLayers, show);
      };
      
      map.on('zoomend', updateLabels);
      return updateLabels;
    }
  },

  // ---- Layer Creation Helpers -------------------------------------------
  creation: {
    /**
     * Create a standard layer group
     */
    createLayerGroup(pane) {
      return L.layerGroup({ pane });
    },

    /**
     * Create WMS layer with standard options
     */
    createWMSLayer(url, options = {}) {
      const defaultOptions = {
        format: 'image/png',
        transparent: true,
        version: '1.1.1'
      };
      return L.tileLayer.wms(url, { ...defaultOptions, ...options });
    },

    /**
     * Create ESRI feature layer with standard options
     */
    createESRIFeatureLayer(url, options = {}) {
      return L.esri.featureLayer({
        url,
        ...options
      });
    },

    /**
     * Create ESRI dynamic map layer
     */
    createESRIDynamicLayer(url, options = {}) {
      return L.esri.dynamicMapLayer({
        url,
        ...options
      });
    },

    /**
     * Create ESRI image map layer
     */
    createESRIImageLayer(url, options = {}) {
      return L.esri.imageMapLayer({
        url,
        ...options
      });
    }
  },

  // ---- Utility Functions ------------------------------------------------
  utils: {
    /**
     * Get all layers of a specific type from map
     */
    getLayersByType(map, type) {
      const layers = [];
      map.eachLayer(layer => {
        if (layer instanceof type) {
          layers.push(layer);
        }
      });
      return layers;
    },

    /**
     * Remove all layers of a specific type from map
     */
    removeLayersByType(map, type) {
      const layers = this.getLayersByType(map, type);
      layers.forEach(layer => map.removeLayer(layer));
      return layers.length;
    },

    /**
     * Get layer opacity
     */
    getLayerOpacity(layer) {
      return layer.options.opacity || 1;
    },

    /**
     * Set layer opacity with bounds checking
     */
    setLayerOpacity(layer, opacity) {
      const clampedOpacity = Math.max(0, Math.min(1, opacity));
      if (layer.setOpacity) {
        layer.setOpacity(clampedOpacity);
      } else if (layer.options) {
        layer.options.opacity = clampedOpacity;
      }
      return clampedOpacity;
    },

    /**
     * Bring layer to front if supported
     */
    bringToFront(layer) {
      if (layer.bringToFront) {
        layer.bringToFront();
        return true;
      }
      return false;
    },

    /**
     * Send layer to back if supported
     */
    bringToBack(layer) {
      if (layer.bringToBack) {
        layer.bringToBack();
        return true;
      }
      return false;
    }
  }
};