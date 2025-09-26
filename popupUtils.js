/**
 * Popup Creation Utilities Module
 * Handles all popup content generation and interaction logic
 */

window.NBFireMapPopupUtils = (() => {
  'use strict';

  // Import required utilities
  const { escHTML, epochToLocal } = window.NBFireMapUtils;

  // ---- Generic Popup Creation Functions ---------------------------------

  /**
   * Create a styled popup container with header and body
   */
  function createPopupContainer(title, content, options = {}) {
    const { className = 'popup', headerIcon = '', maxWidth = 300 } = options;
    
    return `
      <div class="${className}" style="min-width:240px;max-width:${maxWidth}px">
        <div class="popup-header">
          ${headerIcon} ${escHTML(title)}
        </div>
        <div class="popup-body">
          ${content}
        </div>
      </div>
    `;
  }

  /**
   * Create a table row for popup content
   */
  function createTableRow(label, value, options = {}) {
    const { className = 'label' } = options;
    const displayValue = value != null ? escHTML(String(value)) : '—';
    return `<tr><td class="${className}">${escHTML(label)}</td><td>${displayValue}</td></tr>`;
  }

  // ---- Events Popup Functions -------------------------------------------

  /**
   * Build popup content for road events
   */
  function buildEventPopup(event) {
    const restrictions = event.Restrictions || {};
    
    const restrictionsText = [
      restrictions.Lanes ? ("Lanes: " + restrictions.Lanes) : "",
      restrictions.AllowedVehicles ? ("Allowed: " + restrictions.AllowedVehicles) : "",
      restrictions.HeavyVehicles ? ("Heavy: " + restrictions.HeavyVehicles) : "",
      restrictions.Width ? ("Width: " + restrictions.Width) : "",
      restrictions.Height ? ("Height: " + restrictions.Height) : "",
      restrictions.Length ? ("Length: " + restrictions.Length) : "",
      restrictions.Weight ? ("Weight: " + restrictions.Weight) : "",
      restrictions.Speed != null ? ("Speed: " + restrictions.Speed + " km/h") : ""
    ].filter(Boolean).join(" · ") || "—";

    const tableContent = `
      <table>
        ${createTableRow('Type', event.EventType + (event.EventSubType ? ' · ' + event.EventSubType : ''))}
        ${createTableRow('Closure?', event.IsFullClosure ? 'Yes' : 'No')}
        ${createTableRow('Severity', event.Severity || '—')}
        ${createTableRow('Reported', epochToLocal(event.Reported))}
        ${createTableRow('Updated', epochToLocal(event.LastUpdated))}
        ${createTableRow('Starts', epochToLocal(event.StartDate))}
        ${createTableRow('Planned End', epochToLocal(event.PlannedEndDate))}
        ${event.DetourInstructions && event.DetourInstructions.length ? 
          createTableRow('Detour', Array.isArray(event.DetourInstructions) ? 
            event.DetourInstructions.join(' ') : event.DetourInstructions) : ''}
        ${createTableRow('Restrictions', restrictionsText)}
      </table>
      ${event.Comment ? '<div style="margin-top:6px">' + escHTML(event.Comment) + '</div>' : ''}
    `;

    const title = event.Description || 'Event';
    const subtitle = `<div class="muted">${escHTML(event.RoadwayName || '')} · ${escHTML(event.DirectionOfTravel || '')}</div>`;
    
    return createPopupContainer(title, subtitle + tableContent);
  }

  // ---- Webcam Popup Functions -------------------------------------------

  /**
   * Build HTML for a single webcam view
   */
  function buildWebcamViewHTML(view) {
    const enabled = (view.Status || '').toLowerCase() === 'enabled';
    const badge = '<span class="badge ' + (enabled ? '' : 'disabled') + '">' + 
                  (enabled ? 'Enabled' : 'Disabled') + '</span>';
    const id = (view.Id ?? '').toString();
    const imgId = 'img_' + Math.random().toString(36).slice(2);
    const errId = 'err_' + Math.random().toString(36).slice(2);

    return [
      '<div class="view" data-viewid="' + id + '" data-url="' + encodeURIComponent(view.Url || '') + 
      '" data-imgid="' + imgId + '" data-errid="' + errId + '">',
        '<div class="meta"><strong>View ' + id + '</strong> ' + badge + 
        ' · <a href="' + (view.Url || '#') + '" target="_blank" rel="noopener">Open live feed</a></div>',
        (enabled ? '<img id="' + imgId + '" alt="Webcam view ' + id + 
        '" referrerpolicy="no-referrer" loading="lazy" />' : ''),
        (view.Description && view.Description !== 'N/A' ? 
        '<div class="meta">' + escHTML(view.Description) + '</div>' : ''),
        '<div id="' + errId + '" class="error" style="display:none"></div>',
      '</div>'
    ].join('');
  }

  /**
   * Build complete webcam popup content
   */
  function buildWebcamPopup(webcam) {
    const title = webcam.Name || 'Webcam';
    const road = webcam.Road ? ' · ' + webcam.Road : '';
    const src = webcam.Source ? ('Source: ' + webcam.Source) : '';
    const dir = webcam.Direction && webcam.Direction !== 'Unknown' ? 
                ' • ' + webcam.Direction : '';
    
    const viewsHTML = (webcam.Views || []).map(buildWebcamViewHTML).join('');
    const content = `
      <div class="meta">${escHTML(src)}</div>
      <div class="views">${viewsHTML || '<em>No views listed.</em>'}</div>
    `;
    
    return createPopupContainer(title + road + dir, content, { maxWidth: 400 });
  }

  /**
   * Initialize webcam popup images with cache-busting and error handling
   */
  function initWebcamPopupImages(container) {
    const withCacheBust = (url) => {
      const hasQuery = (url || '').includes('?');
      const timestamp = Date.now();
      return (url || '') + (hasQuery ? '&' : '?') + '_ts=' + timestamp;
    };

    const views = container.querySelectorAll('.view');
    views.forEach(view => {
      const originalUrl = decodeURIComponent(view.dataset.url || '');
      const img = document.getElementById(view.dataset.imgid);
      const err = document.getElementById(view.dataset.errid);
      
      if (!originalUrl || !img) return;
      
      const finalURL = withCacheBust(originalUrl);
      err.style.display = 'none';
      img.style.display = 'block';
      
      img.onload = () => { 
        err.style.display = 'none'; 
      };
      
      img.onerror = () => { 
        img.style.display = 'none'; 
        err.textContent = 'Could not load inline image (host may block embedding). Use the link above.'; 
        err.style.display = 'block'; 
      };
      
      img.src = finalURL;
    });
  }

  // ---- Winter Roads Popup Functions -------------------------------------

  /**
   * Build winter road condition popup
   */
  function buildWinterRoadPopup(roadData) {
    const condition = roadData['Primary Condition'] || roadData.primaryCondition || 'Unknown';
    const secondary = (roadData['Secondary Conditions'] || roadData.secondaryConditions || []).join(', ') || '—';
    const road = roadData.RoadwayName || roadData.roadwayName || '—';
    const area = roadData.AreaName || roadData.areaName || '—';
    const visibility = roadData.Visibility || roadData.visibility || '—';
    const description = roadData.LocationDescription || roadData.locationDescription || '';
    const lastUpdated = roadData.LastUpdated ? 
      new Date(roadData.LastUpdated * 1000).toLocaleString() : '—';

    const content = `
      <div class="cond">${escHTML(condition)}</div>
      <div>${escHTML(road)}</div>
      <div style="color:#555">${escHTML(area)}</div>
      ${description ? '<div style="margin-top:6px">' + escHTML(description) + '</div>' : ''}
      <hr style="border:none;border-top:1px solid #0001;margin:8px 0" />
      <div><b>Secondary:</b> ${escHTML(secondary)}</div>
      <div><b>Visibility:</b> ${escHTML(visibility)}</div>
      <div><b>Updated:</b> ${escHTML(lastUpdated)}</div>
    `;

    return `<div style="min-width:220px">${content}</div>`;
  }

  // ---- Hover/Click Behavior Functions -----------------------------------

  /**
   * Bind hover-to-show popup behavior to a layer
   */
  function bindHoverTogglePopup(layer) {
    let clicked = false;
    let openTimer = null;
    let closeTimer = null;
    const OPEN_DELAY_MS = 150;
    const CLOSE_DELAY_MS = 60;
    
    const clearTimers = () => {
      if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
      }
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };

    layer.on('mouseover', function() {
      if (clicked) return;
      if (closeTimer) clearTimeout(closeTimer);
      if (!openTimer) {
        openTimer = setTimeout(() => {
          openTimer = null;
          this.openPopup?.();
        }, OPEN_DELAY_MS);
      }
    });

    layer.on('mouseout', function() {
      if (clicked) return;
      if (openTimer) clearTimeout(openTimer);
      if (!closeTimer) {
        closeTimer = setTimeout(() => {
          closeTimer = null;
          this.closePopup?.();
        }, CLOSE_DELAY_MS);
      }
    });

    layer.on('click', function() {
      clicked = !clicked;
      clearTimers();
      clicked ? this.openPopup?.() : this.closePopup?.();
    });

    layer.on('remove', clearTimers);
  }

  // ---- Export Functions ------------------------------------------------

  return {
    // Generic popup utilities
    createPopupContainer,
    createTableRow,
    bindHoverTogglePopup,
    
    // Specific popup builders
    buildEventPopup,
    buildWebcamPopup,
    buildWebcamViewHTML,
    initWebcamPopupImages,
    buildWinterRoadPopup,
    
    // Legacy function names for backward compatibility
    buildPopup: buildEventPopup,
    buildViewHTML: buildWebcamViewHTML,
    initPopupImages: initWebcamPopupImages
  };
})();