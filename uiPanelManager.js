/**
 * UI Panel Management Module
 * Handles all user interface panels, overlays, and modal interactions
 */

window.NBFireMapUIPanelManager = (() => {
  'use strict';

  // ---- Internal State ---------------------------------------------------
  let elements = {};
  let eventListeners = [];
  let nearbyPanelCloseCallback = null;

  // ---- Element References -----------------------------------------------
  
  /**
   * Initialize UI element references
   */
  function initializeElements() {
    const $ = (sel) => document.querySelector(sel);
    
    elements = {
      // Fire Summary Panel
      fireSummary: {
        overlay: $('#fireSummaryOverlay'),
        body: $('#fs-body'),
        button: $('#fireSummaryBtn'),
        closeButton: $('#fs-close')
      },
      
      // Nearby Panel
      nearby: {
        panel: $('#nearbyPanel'),
        title: $('#nearbyTitle'),
        content: $('#nearbyBody'),
        closeButton: $('#nearbyClose')
      },
      
      // General selectors
      document: document,
      window: window
    };
  }

  // ---- Fire Summary Panel Management ------------------------------------

  /**
   * Open the fire summary panel
   */
  function openFireSummary(refreshCallback) {
    if (!elements.fireSummary.overlay) return;
    
    if (refreshCallback) refreshCallback();
    
    elements.fireSummary.overlay.hidden = false;
    elements.fireSummary.overlay.style.display = 'flex';
    
    // Focus management for accessibility
    if (elements.fireSummary.closeButton) {
      elements.fireSummary.closeButton.focus();
    }
  }

  /**
   * Close the fire summary panel
   */
  function closeFireSummary() {
    if (!elements.fireSummary.overlay) return;
    
    elements.fireSummary.overlay.style.display = 'none';
    elements.fireSummary.overlay.hidden = true;
    
    // Return focus to the button
    if (elements.fireSummary.button) {
      elements.fireSummary.button.focus();
    }
  }

  /**
   * Toggle fire summary panel
   */
  function toggleFireSummary(refreshCallback) {
    if (!elements.fireSummary.overlay) return;
    
    if (elements.fireSummary.overlay.hidden) {
      openFireSummary(refreshCallback);
    } else {
      closeFireSummary();
    }
  }

  /**
   * Update fire summary content
   */
  function updateFireSummaryContent(htmlContent) {
    if (!elements.fireSummary.body) return;
    elements.fireSummary.body.innerHTML = htmlContent;
  }

  // ---- Nearby Panel Management ------------------------------------------

  /**
   * Get the height of the nearby panel (for map padding calculations)
   */
  function getNearbyPanelHeight() {
    if (!elements.nearby.panel || elements.nearby.panel.hidden) return 0;
    
    const rect = elements.nearby.panel.getBoundingClientRect();
    return rect.height || 0;
  }

  /**
   * Open the nearby panel with title and content
   */
  function openNearbyPanel(title, htmlContent) {
    if (!elements.nearby.panel) return;
    
    // Set content
    if (elements.nearby.title) {
      elements.nearby.title.textContent = title;
    }
    if (elements.nearby.content) {
      elements.nearby.content.innerHTML = htmlContent;
    }
    
    // Show panel
    elements.nearby.panel.hidden = false;
    elements.nearby.panel.style.display = 'block';
  }

  /**
   * Close the nearby panel
   */
  function closeNearbyPanel() {
    if (!elements.nearby.panel) return;
    
    elements.nearby.panel.style.display = 'none';
    elements.nearby.panel.hidden = true;
    
    // Call the close callback if registered
    if (nearbyPanelCloseCallback) {
      nearbyPanelCloseCallback();
    }
  }

  /**
   * Toggle nearby panel
   */
  function toggleNearbyPanel(title, htmlContent) {
    if (!elements.nearby.panel) return;
    
    if (elements.nearby.panel.hidden) {
      openNearbyPanel(title, htmlContent);
    } else {
      closeNearbyPanel();
    }
  }

  // ---- Overview Panel Management ----------------------------------------

  /**
   * Hide overview panel (placeholder for overview panel functionality)
   */
  function hideOverviewPanel() {
    // This function is referenced in the code but the actual overview panel
    // implementation may be in a different part of the application
    console.log('hideOverviewPanel called - implement if overview panel exists');
  }

  /**
   * Show overview panel (placeholder for overview panel functionality)
   */
  function showOverviewPanel() {
    console.log('showOverviewPanel called - implement if overview panel exists');
  }

  // ---- Event Management -------------------------------------------------

  /**
   * Add event listener and track it for cleanup
   */
  function addTrackedEventListener(element, event, handler, options = {}) {
    if (!element) return;
    
    element.addEventListener(event, handler, options);
    eventListeners.push({ element, event, handler, options });
  }

  /**
   * Remove all tracked event listeners
   */
  function removeAllEventListeners() {
    eventListeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
    eventListeners = [];
  }

  /**
   * Setup panel event handlers
   */
  function setupEventHandlers() {
    // Fire Summary Panel Events
    if (elements.fireSummary.button) {
      addTrackedEventListener(elements.fireSummary.button, 'click', () => {
        toggleFireSummary();
      });
    }

    if (elements.fireSummary.closeButton) {
      addTrackedEventListener(elements.fireSummary.closeButton, 'click', closeFireSummary);
    }

    // Click outside to close fire summary
    if (elements.fireSummary.overlay) {
      addTrackedEventListener(elements.fireSummary.overlay, 'click', (e) => {
        if (e.target === elements.fireSummary.overlay) {
          closeFireSummary();
        }
      });
    }

    // Nearby Panel Events
    if (elements.nearby.closeButton) {
      addTrackedEventListener(elements.nearby.closeButton, 'click', closeNearbyPanel);
    }

    // Global Escape key handler
    addTrackedEventListener(window, 'keydown', (e) => {
      if (e.key === 'Escape') {
        // Close fire summary if open
        if (elements.fireSummary.overlay && !elements.fireSummary.overlay.hidden) {
          closeFireSummary();
        }
        // Close nearby panel if open  
        else if (elements.nearby.panel && !elements.nearby.panel.hidden) {
          closeNearbyPanel();
        }
      }
    });
  }

  // ---- Panel State Management -------------------------------------------

  /**
   * Get current panel states
   */
  function getPanelStates() {
    return {
      fireSummary: {
        isOpen: elements.fireSummary.overlay && !elements.fireSummary.overlay.hidden,
        display: elements.fireSummary.overlay?.style.display || 'none'
      },
      nearby: {
        isOpen: elements.nearby.panel && !elements.nearby.panel.hidden,
        display: elements.nearby.panel?.style.display || 'none',
        height: getNearbyPanelHeight()
      }
    };
  }

  /**
   * Close all panels
   */
  function closeAllPanels() {
    closeFireSummary();
    closeNearbyPanel();
    hideOverviewPanel();
  }

  /**
   * Check if any panel is open
   */
  function isAnyPanelOpen() {
    const states = getPanelStates();
    return states.fireSummary.isOpen || states.nearby.isOpen;
  }

  // ---- Initialization ---------------------------------------------------

  /**
   * Initialize the UI Panel Manager
   */
  function initialize() {
    initializeElements();
    setupEventHandlers();
  }

  /**
   * Cleanup function to remove event listeners
   */
  function cleanup() {
    removeAllEventListeners();
  }

  // ---- Utility Functions ------------------------------------------------

  /**
   * Create a generic modal/panel structure
   */
  function createPanel(options = {}) {
    const {
      id = 'generic-panel',
      className = 'panel',
      title = 'Panel',
      content = '',
      closable = true,
      modal = false
    } = options;

    const panel = document.createElement('div');
    panel.id = id;
    panel.className = className;
    panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'panel-header';
    
    const titleElement = document.createElement('h2');
    titleElement.textContent = title;
    header.appendChild(titleElement);

    if (closable) {
      const closeButton = document.createElement('button');
      closeButton.className = 'panel-close';
      closeButton.innerHTML = '&times;';
      closeButton.setAttribute('aria-label', 'Close panel');
      header.appendChild(closeButton);
    }

    const body = document.createElement('div');
    body.className = 'panel-body';
    body.innerHTML = content;

    panel.appendChild(header);
    panel.appendChild(body);

    if (modal) {
      panel.style.position = 'fixed';
      panel.style.top = '0';
      panel.style.left = '0';
      panel.style.width = '100%';
      panel.style.height = '100%';
      panel.style.backgroundColor = 'rgba(0,0,0,0.5)';
      panel.style.zIndex = '9999';
    }

    return {
      element: panel,
      show: () => {
        panel.hidden = false;
        panel.style.display = modal ? 'flex' : 'block';
      },
      hide: () => {
        panel.style.display = 'none';
        panel.hidden = true;
      },
      setContent: (html) => {
        body.innerHTML = html;
      },
      setTitle: (newTitle) => {
        titleElement.textContent = newTitle;
      }
    };
  }

  // ---- Callback Management ----------------------------------------------
  
  /**
   * Set callback to be called when nearby panel is closed
   */
  function setNearbyPanelCloseCallback(callback) {
    nearbyPanelCloseCallback = callback;
  }

  // ---- Public API -------------------------------------------------------

  return {
    // Initialization
    initialize,
    cleanup,
    
    // Fire Summary Panel
    openFireSummary,
    closeFireSummary,
    toggleFireSummary,
    updateFireSummaryContent,
    
    // Nearby Panel  
    openNearbyPanel,
    closeNearbyPanel,
    toggleNearbyPanel,
    getNearbyPanelHeight,
    setNearbyPanelCloseCallback,
    
    // Overview Panel
    hideOverviewPanel,
    showOverviewPanel,
    
    // General Panel Management
    closeAllPanels,
    isAnyPanelOpen,
    getPanelStates,
    
    // Utilities
    createPanel,
    
    // Element access (for backward compatibility)
    getElements: () => elements,
    
    // Event management
    addTrackedEventListener,
    removeAllEventListeners
  };
})();