/**
 * Popup Creation Utilities Module
 * Handles all popup content generation and interaction logic
 */

window.NBFireMapPopupUtils = (() => {
  'use strict';

  // Import required utilities
  const { escHTML, fmtDateTimeTz } = window.NBFireMapUtils;

  // ---- Generic Popup Creation Functions ---------------------------------

  /**
   * Create a styled popup container with header and body
   */
  function createPopupContainer(title, content, options = {}) {
    const { className = 'popup', headerIcon = '', maxWidth = 300, escapeTitle = true } = options;
    
    return `
      <div class="${className}" style="min-width:240px;max-width:${maxWidth}px">
        <div class="popup-header">
          ${headerIcon} ${escapeTitle ? escHTML(title) : title}
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
    // Don't escape if label contains HTML tags (like Font Awesome icons)
    const labelContent = label.includes('<') ? label : escHTML(label);
    return `<tr><td class="${className}">${labelContent}</td><td>${displayValue}</td></tr>`;
  }

  // ---- Events Popup Functions -------------------------------------------

  /**
   * Build popup content for road events
   */
  function buildEventPopup(event) {
    if (!event) return 'No event data';

    // Get event type icon and better display names
    const getEventIcon = (type, subType, isFullClosure) => {
      if (isFullClosure) return '<i class="fas fa-ban" style="color: #dc2626;"></i>';
      if (type === 'accidentsAndIncidents') return '<i class="fas fa-exclamation-triangle" style="color: #ea580c;"></i>';
      if (type === 'closures') {
        if (subType && subType.includes('Bridge Out')) return '<i class="fas fa-water" style="color: #0891b2;"></i>';
        if (subType && subType.includes('Washout')) return '<i class="fas fa-tint" style="color: #0284c7;"></i>';
        return '<i class="fas fa-road" style="color: #dc2626;"></i>';
      }
      if (type === 'roadwork') {
        if (subType && subType.includes('Bridge')) return '<i class="fas fa-wrench" style="color: #0891b2;"></i>';
        return '<i class="fas fa-hard-hat" style="color: #0891b2;"></i>';
      }
      return '<i class="fas fa-route" style="color: #6b7280;"></i>';
    };

    const getSeverityBadge = (severity) => {
      if (!severity || severity === 'None') return '';
      const color = severity === 'Major' ? '#dc2626' : severity === 'Minor' ? '#f59e0b' : '#6b7280';
      return `<span style="background: ${color}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; margin-left: 6px;">${severity.toUpperCase()}</span>`;
    };

    const getClosureStatus = (isFullClosure, lanesAffected) => {
      if (isFullClosure) return '<strong style="color: #dc2626;"><i class="fas fa-ban"></i> FULL CLOSURE</strong>';
      if (lanesAffected && lanesAffected !== 'No Data') return `<span style="color: #f59e0b;"><i class="fas fa-exclamation-triangle"></i> ${lanesAffected}</span>`;
      return '<span style="color: #059669;"><i class="fas fa-check-circle"></i> Partial/Restrictions Only</span>';
    };

    // Format restrictions with better presentation
    const restrictions = event.Restrictions || {};
    const restrictionItems = [
      restrictions.Width ? `Width: ${restrictions.Width}m` : "",
      restrictions.Height ? `Height: ${restrictions.Height}m` : "",
      restrictions.Length ? `Length: ${restrictions.Length}m` : "",
      restrictions.Weight ? `Weight: ${restrictions.Weight}kg` : "",
      restrictions.Speed ? `Speed: ${restrictions.Speed} km/h` : ""
    ].filter(Boolean);

    const restrictionsHTML = restrictionItems.length > 0 ? 
      `<div style="margin: 6px 0; padding: 6px; background: #fef3c7; border-left: 3px solid #f59e0b; border-radius: 3px;">
        <strong><i class="fas fa-hand" style="color: #f59e0b;"></i> Vehicle Restrictions:</strong><br/>
        ${restrictionItems.join(' • ')}
      </div>` : '';

    // Format detour information
    const detourHTML = (event.DetourInstructions && event.DetourInstructions.length) ? 
      `<div style="margin: 6px 0; padding: 6px; background: #ede9fe; border-left: 3px solid #7c3aed; border-radius: 3px;">
        <strong><i class="fas fa-route" style="color: #7c3aed;"></i> Detour:</strong><br/>
        ${escHTML(Array.isArray(event.DetourInstructions) ? 
          event.DetourInstructions.join(' ') : event.DetourInstructions)}
      </div>` : '';

    const tableContent = `
      <div style="margin: 8px 0;">
        ${getClosureStatus(event.IsFullClosure, event.LanesAffected)}
      </div>
      <table>
        ${createTableRow('<i class="fas fa-map-marker-alt" style="color: #dc2626;"></i> Location', `${escHTML(event.RoadwayName || '—')} · ${escHTML(event.DirectionOfTravel || '—')}`)}
        ${createTableRow('<i class="fas fa-calendar-plus" style="color: #059669;"></i> Reported', event.Reported ? fmtDateTimeTz(event.Reported * 1000) : '—')}
        ${createTableRow('<i class="fas fa-sync-alt" style="color: #0284c7;"></i> Updated', event.LastUpdated ? fmtDateTimeTz(event.LastUpdated * 1000) : '—')}
        ${event.StartDate ? createTableRow('<i class="fas fa-play-circle" style="color: #059669;"></i> Starts', fmtDateTimeTz(event.StartDate * 1000)) : ''}
        ${event.PlannedEndDate ? createTableRow('<i class="fas fa-flag-checkered" style="color: #7c3aed;"></i> Planned End', fmtDateTimeTz(event.PlannedEndDate * 1000)) : ''}
        ${event.Organization ? createTableRow('<i class="fas fa-building" style="color: #6b7280;"></i> Reported By', escHTML(event.Organization)) : ''}
      </table>
      ${restrictionsHTML}
      ${detourHTML}
      ${event.Comment ? `<div style="margin-top: 8px; padding: 6px; background: #f0f9ff; border-left: 3px solid #0284c7; border-radius: 3px;"><strong><i class="fas fa-comment" style="color: #0284c7;"></i> Notes:</strong><br/>${escHTML(event.Comment)}</div>` : ''}
    `;

    const icon = getEventIcon(event.EventType, event.EventSubType, event.IsFullClosure);
    const displayType = escHTML(event.EventSubType || event.EventType);
    const severityBadge = getSeverityBadge(event.Severity);
    
    const title = `${icon} ${displayType}${severityBadge}`;
    const subtitle = `<div class="muted" style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">${escHTML(event.Description || 'Road Event')}</div>`;
    
    return createPopupContainer(title, subtitle + tableContent, { escapeTitle: false });
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