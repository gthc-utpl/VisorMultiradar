document.addEventListener('DOMContentLoaded', () => {

  // ============================================================================
  // CONFIGURACIÓN DE RADARES
  // ============================================================================

  const radarConfigs = [
    {
      id: 'guaxx',
      name: 'Radar GUAXX',
      center: [-4.035698, -79.871928],
      radiusKm: 100,
      dataBasePath: 'data/guaxx',
      color: 'rgba(255, 165, 0, 0.7)',
      iconColor: '#ffa500',
      zIndex: 201,
      // Factor de corrección de escala (Scale Factor). 
      scaleFactor: 0.95, 
      dimension: 1000 // Dimensión de la imagen PNG generada (píxeles)
    },
    {
      id: 'loxx',
      name: 'Radar LOXX',
      center: [-3.98687, -79.14434],
      radiusKm: 70,
      dataBasePath: 'data/loxx',
      color: 'rgba(30, 144, 255, 0.7)',
      iconColor: '#1e90ff',
      zIndex: 200,
      // Valor empírico encontrado para LOXX (70km).
      scaleFactor: 1.345, 
      dimension: 949 // Dimensión de la imagen PNG generada (píxeles)
    }
  ];

  // ============================================================================
  // VARIABLES GLOBALES
  // ============================================================================

  let allTimestamps = []; // Usada solo para animación (cargada bajo demanda)
  let latestTimestamps = {}; // Usada para la última captura en modo estático
  let radarTimestampRanges = {}; // Usada para el resumen de datos de animación
  let map;
  let currentImageLayers = {};
  let rangeCircles = {};
  let radarMarkers = {};
  let activeRadars = new Set(['guaxx', 'loxx']);
  let showMarkers = false;
  let isAnimationActive = false;
  let animationInterval = null;
  let currentFrame = 0;
  let opacity = 0.7;

  // ============================================================================
  // ELEMENTOS DEL DOM
  // ============================================================================

  const elements = {
    loader: document.getElementById('loader-overlay'),
    loaderText: document.getElementById('loader-text'),
    captureTime: document.getElementById('capture-time'),
    dataAge: document.getElementById('data-age'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    notification: document.getElementById('notification'),

    // Animación
    timeline: document.getElementById('animation-timeline'),
    controls: document.getElementById('animation-controls'),
    ticks: document.getElementById('timeline-ticks'),
    bar: document.getElementById('timeline-bar'),
    pointer: document.getElementById('timeline-pointer'),

    // Controles
    toggleAnim: document.getElementById('toggle-animation-btn'),
    periodSelect: document.getElementById('animation-period-select'),
    speedSelect: document.getElementById('animation-speed-select'),
    playBtn: document.getElementById('animation-play'),
    firstBtn: document.getElementById('animation-first'),
    prevBtn: document.getElementById('animation-prev'),
    nextBtn: document.getElementById('animation-next'),
    lastBtn: document.getElementById('animation-last'),
    refresh: document.getElementById('refresh-button'),
    refreshIcon: document.getElementById('refresh-icon'),

    // Sidebar
    opacitySlider: document.getElementById('overlay-opacity'),
    opacityValue: document.getElementById('opacity-value'),
    dataSummary: document.getElementById('data-summary'),
    toggleMarkers: document.getElementById('toggle-markers'),

    // Mobile
    mobileMenuBtn: document.getElementById('mobile-menu-toggle'),
    sidebar: document.querySelector('.sidebar')
  };

  // ============================================================================
  // UTILIDADES PARA DÍA JULIANO Y FECHAS
  // ============================================================================

  function getJulianDay(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    return dayOfYear.toString().padStart(3, '0');
  }

  function getJulianDaysForPeriod(hours) {
    // Returns the Julian days (including the current one) needed to cover the period
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - (hours * 60 * 60 * 1000));

    const days = [];
    const daysSet = new Set();
    let currentDate = new Date(cutoffTime);
    currentDate.setHours(0, 0, 0, 0); // Starts at the beginning of the cutoff day

    while (currentDate <= now) {
      const year = currentDate.getFullYear();
      const julianDay = getJulianDay(currentDate);
      const key = `${year}-${julianDay}`;

      if (!daysSet.has(key)) {
        daysSet.add(key);
        days.push({
          year: year.toString(),
          julianDay: julianDay,
          date: new Date(currentDate)
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return days;
  }

  function getImagePath(radarConfig, year, julianDay, filename) {
    // Path example: data/guaxx/2025/200/radar_guaxx_202510270910.png
    return `${radarConfig.dataBasePath}/${year}/${julianDay}/${filename}`;
  }

  function extractLocalTime(formattedTime) {
    // Extracts the LT part: 2025-10-29 08:30 LT
    const ltMatch = formattedTime.match(/\((.+?)\s+LT\)/);
    if (ltMatch) {
      return ltMatch[1];
    }
    return formattedTime;
  }

  function parseLocalTime(timeString) {
    // Parses YYYY-MM-DD HH:MM:SS or YYYY-MM-DD HH:MM
    const parts = timeString.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (parts) {
      const year = parseInt(parts[1]);
      const month = parseInt(parts[2]) - 1;
      const day = parseInt(parts[3]);
      const hour = parseInt(parts[4]);
      const minute = parseInt(parts[5]);
      const second = parts[6] ? parseInt(parts[6]) : 0;
      // Creates the date in the browser's local timezone
      return new Date(year, month, day, hour, minute, second);
    }
    // Fallback for other formats
    return new Date(timeString);
  }

  function removeSeconds(timeString) {
    // Removes the seconds part if it exists in the string
    return timeString.replace(/(\d{2}):(\d{2}):\d{2}/g, '$1:$2');
  }

  function formatTimeOnly(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // ============================================================================
  // INICIALIZACIÓN
  // ============================================================================

  function initializeApp() {
    console.log('Inicializando aplicación...');
    addCustomStyles();
    initializeMap();
    setupCollapsibleSections();
    setupMobileMenu();
    loadLatestImages(); // Optimized initial load: only the latest record
    setupEventListeners();
  }

  function addCustomStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .radar-marker {
        display: flex;
        justify-content: center;
        align-items: center;
        font-size: 20px;
        background: #fff;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.5);
        z-index: 1000;
        transition: all 0.3s ease;
      }
      
      .radar-marker.guaxx {
        color: #ffa500;
        border: 2px solid #ffa500;
      }
      
      .radar-marker.loxx {
        color: #1e90ff;
        border: 2px solid #1e90ff;
      }
      
      .radar-marker.inactive {
        opacity: 0.3;
        filter: grayscale(100%);
      }
      
      .radar-popup {
        font-size: 12px;
      }
      
      .radar-popup h4 {
        margin: 0 0 5px 0;
        font-size: 14px;
        color: #1e478e;
      }
      
      .radar-popup p {
        margin: 3px 0;
      }
      
      .mobile-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          // AUMENTAR Z-INDEX para que esté por encima del mapa
          z-index: 9998; 
          visibility: hidden;
          opacity: 0;
          transition: opacity 0.3s, visibility 0.3s;
      }

      .mobile-overlay.active {
          visibility: visible;
          opacity: 1;
      }
      
      /* Ensures the sidebar is correctly positioned on mobile */
      @media (max-width: 768px) {
        .sidebar {
            position: fixed;
            top: 0;
            right: 0;
            height: 100%;
            width: 80%; /* Mobile sidebar width */
            transform: translateX(100%);
            transition: transform 0.3s ease-out;
            // AUMENTAR Z-INDEX para que esté por encima del mapa
            z-index: 9999; 
            box-shadow: -5px 0 15px rgba(0,0,0,0.2);
        }

        .sidebar.mobile-visible {
            transform: translateX(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function initializeMap() {
    console.log('Inicializando mapa...');

    map = L.map('map', {
      center: [-4.01, -79.5],
      zoom: 8,
      minZoom: 7,
      maxZoom: 12,
      zoomControl: true
    });

    // 🚩 IMPLEMENTACIÓN DEL CONTROL DE CAPAS BASE (Base Layer Control)
    
    // 1. Base Layer Definitions
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    });

    // Dark Layer (CartoDB Dark Matter)
    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    });

    // Light Layer (CartoDB Positron)
    const lightLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    });

    // 2. Define Base Layers for Control
    const baseLayers = {
        "🗺️ OSM (Original)": osmLayer,
        "⚫️ Oscuro (Dark Matter)": darkLayer, 
        "⚪️ Claro (CartoDB)": lightLayer
    };

    // 3. Set OSM as the default layer and add it to the map
    osmLayer.addTo(map);

    // 4. Add the Layer Control
    L.control.layers(baseLayers, null, { collapsed: true }).addTo(map);


    radarConfigs.forEach(config => {
      createRadarElements(config);
    });

    const allCenters = radarConfigs.map(c => c.center);
    const bounds = L.latLngBounds(allCenters);
    map.fitBounds(bounds.pad(0.3));
  }

  function createRadarElements(config) {
    // Coverage radius
    const radiusMeters = config.radiusKm * 1000;
    rangeCircles[config.id] = L.circle(config.center, {
      radius: radiusMeters,
      color: config.iconColor,
      fillColor: config.color,
      fillOpacity: 0.05,
      opacity: 0.3,
      weight: 2
    }).addTo(map);

    // Marker
    const markerHtml = `<i class="fas fa-broadcast-tower" style="color: ${config.iconColor}; font-size: 16px;"></i>`;

    radarMarkers[config.id] = L.marker(config.center, {
      icon: L.divIcon({
        className: `radar-marker ${config.id}`,
        html: markerHtml,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      })
    });

    // Hide markers initially if the checkbox is not checked
    radarMarkers[config.id].on('add', function() {
      setTimeout(() => {
        const markerElement = radarMarkers[config.id].getElement();
        if (markerElement && !showMarkers) {
          markerElement.style.display = 'none';
        }
      }, 0);
    });

    radarMarkers[config.id].addTo(map);

    const popupContent = `
      <div class="radar-popup">
        <h4>${config.name}</h4>
        <p>Radio de cobertura: ${config.radiusKm} km</p>
        <p>Coordenadas: ${config.center[0].toFixed(5)}°, ${config.center[1].toFixed(5)}°</p>
      </div>
    `;
    radarMarkers[config.id].bindPopup(popupContent);
  }

  function setupCollapsibleSections() {
    const headers = document.querySelectorAll('.section-header');

    headers.forEach(header => {
      header.addEventListener('click', () => {
        const targetId = header.getAttribute('data-target');
        const content = document.getElementById(targetId);
        const icon = header.querySelector('.toggle-icon');

        if (content) {
          const isCollapsed = content.classList.contains('collapsed');

          if (isCollapsed) {
            content.classList.remove('collapsed');
            content.classList.add('expanded');
            if (icon) icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
          } else {
            content.classList.remove('expanded');
            content.classList.add('collapsed');
            if (icon) icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
          }
        }
      });
    });
    
    // Open the radar control section by default
    const radarConfigHeader = document.querySelector('.section-header[data-target="radar-config"]');
    if (radarConfigHeader) {
        radarConfigHeader.click();
    }
  }

  function setupMobileMenu() {
    // Create mobile overlay
    const overlay = document.createElement('div');
    overlay.className = 'mobile-overlay';
    document.body.appendChild(overlay);

    // Mobile menu toggle
    if (elements.mobileMenuBtn) {
      elements.mobileMenuBtn.addEventListener('click', () => {
        const isVisible = elements.sidebar.classList.contains('mobile-visible');

        if (isVisible) {
          elements.sidebar.classList.remove('mobile-visible');
          overlay.classList.remove('active');
          elements.mobileMenuBtn.classList.remove('active');
        } else {
          elements.sidebar.classList.add('mobile-visible');
          overlay.classList.add('active');
          elements.mobileMenuBtn.classList.add('active');
        }
      });
    }

    // Close when clicking on the overlay
    overlay.addEventListener('click', () => {
      elements.sidebar.classList.remove('mobile-visible');
      overlay.classList.remove('active');
      if (elements.mobileMenuBtn) {
        elements.mobileMenuBtn.classList.remove('active');
      }
    });

    // Close on orientation change or resizing to desktop
    const handleResize = () => {
        if (window.innerWidth > 768) {
            elements.sidebar.classList.remove('mobile-visible');
            overlay.classList.remove('active');
            if (elements.mobileMenuBtn) {
              elements.mobileMenuBtn.classList.remove('active');
            }
        }
    };
    
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
  }

  // ============================================================================
  // CARGA DE DATOS (Optimizada)
  // ============================================================================

  /**
   * Loads only the latest available record for each radar.
   * Used for initial load and refresh button in static mode.
   */
  async function loadLatestImages() {
    showLoader('Cargando la última captura de radares...');
    
    // We will collect the data for the current day and the previous day for all radars
    const hoursToSearch = 24;
    const daysToLoad = getJulianDaysForPeriod(hoursToSearch);
    
    let allLatestTimestamps = []; // Temporary array to hold all found timestamps
    let successfulLoads = 0;

    try {
        latestTimestamps = {}; // Reset static records

        for (const config of radarConfigs) {
            const radarTimestamps = await loadRadarDays(config, daysToLoad);
            
            if (radarTimestamps.length > 0) {
                // Find the absolute latest timestamp among the loaded ones for this radar
                radarTimestamps.sort((a, b) => {
                    const timeA = parseLocalTime(extractLocalTime(a.formatted_time || a.datetime_local));
                    const timeB = parseLocalTime(extractLocalTime(b.formatted_time || b.datetime_local));
                    return timeA - timeB;
                });
                
                const latestFile = radarTimestamps[radarTimestamps.length - 1];
                
                latestTimestamps[config.id] = latestFile;
                allLatestTimestamps.push(latestFile);
                successfulLoads++;
                
                // Update radar status (in static mode, we only know the latest one)
                updateRadarStatus(config.id, [latestFile], 0); 

            } else {
                latestTimestamps[config.id] = null;
                updateRadarStatus(config.id, [], 0);
            }
        }

        displayDataSummary(0); // Show initial data summary

        if (allLatestTimestamps.length > 0) {
            // Find the ABSOLUTE latest timestamp among ALL radars
            allLatestTimestamps.sort((a, b) => {
                const timeA = parseLocalTime(extractLocalTime(a.formatted_time || a.datetime_local));
                const timeB = parseLocalTime(extractLocalTime(b.formatted_time || b.datetime_local));
                return timeA - timeB;
            });
            const latestTimestampFound = allLatestTimestamps[allLatestTimestamps.length - 1];

            // Found at least one record.
            showStaticImages(latestTimestampFound); 
            updateCaptureTimes(latestTimestampFound); 
            
            // CORRECCIÓN: Simplificar el mensaje de notificación a solo la hora LT
            const ltTimeOnly = removeSeconds(extractLocalTime(latestTimestampFound.formatted_time || latestTimestampFound.datetime_local));
            showNotification(`Última captura cargada: ${ltTimeOnly} LT`);
        } else {
            // Case where successfulLoads is 0
            updateStatusInfo('Sin datos', false);
            showNotification('No hay registros recientes disponibles', true);
            
            // Ensure showStaticImages cleans layers if there is no data.
            showStaticImages(null); 
        }

    } catch (error) {
        console.error('Error cargando la última captura:', error);
        updateStatusInfo('Error', false);
        showNotification('Error al cargar la última captura de radares', true);
    } finally {
        hideLoader();
        // Return latest timestamp data object for the refresh button logic
        return allLatestTimestamps.length > 0 ? { data: allLatestTimestamps[allLatestTimestamps.length - 1] } : null;
    }
  }

  /**
   * Loads ALL records for the animation period.
   * (This function is only called from downloadAnimationData)
   */
  async function loadRadarData(hours) {
    allTimestamps = [];
    radarTimestampRanges = {};

    const daysToLoad = getJulianDaysForPeriod(hours);
    console.log(`Cargando datos de ${daysToLoad.length} día(s) juliano(s) - ${hours} horas`);

    for (const radarConfig of radarConfigs) {
      const radarTimestamps = await loadRadarDays(radarConfig, daysToLoad);
      allTimestamps.push(...radarTimestamps);

      if (radarTimestamps.length > 0) {
        const times = radarTimestamps.map(t => {
          const ltTime = extractLocalTime(t.formatted_time || t.datetime_local);
          return parseLocalTime(ltTime);
        });

        radarTimestampRanges[radarConfig.id] = {
          count: radarTimestamps.length,
          oldest: new Date(Math.min(...times)),
          newest: new Date(Math.max(...times)),
          timestamps: radarTimestamps
        };
      } else {
        radarTimestampRanges[radarConfig.id] = {
          count: 0,
          oldest: null,
          newest: null,
          timestamps: []
        };
      }

      updateRadarStatus(radarConfig.id, radarTimestamps, hours);
    }

    // Sort all timestamps by local time (LT) for animation
    allTimestamps.sort((a, b) => {
      const timeA = parseLocalTime(extractLocalTime(a.formatted_time || a.datetime_local));
      const timeB = parseLocalTime(extractLocalTime(b.formatted_time || b.datetime_local));
      return timeA - timeB;
    });

    return allTimestamps.length;
  }
  
  async function loadRadarDays(radarConfig, daysToLoad) {
    const timestamps = [];

    const promises = daysToLoad.map(day =>
      loadDayIndex(radarConfig, day.year, day.julianDay).then(index => ({index, day}))
    );

    const results = await Promise.allSettled(promises);

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value && result.value.index) {
        const dayInfo = result.value.day;
        // CORRECTION: Use radarConfig (function argument) instead of the undefined 'config'
        result.value.index.forEach(file => {
          timestamps.push({
            radarId: radarConfig.id,
            radarConfig: radarConfig, 
            year: dayInfo.year,
            julianDay: dayInfo.julianDay,
            ...file
          });
        });
      }
    });

    return timestamps;
  }

  async function loadDayIndex(radarConfig, year, julianDay) {
    // Builds the index path. Example: data/guaxx/2025/200/index.json
    const indexPath = `${radarConfig.dataBasePath}/${year}/${julianDay}/index.json`;

    try {
      const response = await fetch(indexPath);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.files && Array.isArray(data.files)) {
        return data.files;
      }

      return null;

    } catch (error) {
      console.error(`Error cargando índice de ${radarConfig.id}: ${indexPath}`, error);
      return null;
    }
  }


  function displayDataSummary(hours) {
    if (!elements.dataSummary) return;

    if (hours === 0) {
        // Initial static mode
        let summaryHTML = `<div><strong>Carga Inicial:</strong></div>`;
        radarConfigs.forEach(config => {
            const latest = latestTimestamps[config.id];
            const icon = config.id === 'guaxx' ? '🟠' : '🔵';
            if (latest) {
                const displayTime = removeSeconds(extractLocalTime(latest.formatted_time || latest.datetime_local));
                summaryHTML += `<div class="stats-row">${icon} <strong>${config.name}:</strong> 1 captura (${displayTime} LT)</div>`;
            } else {
                summaryHTML += `<div class="stats-row">${icon} <strong>${config.name}:</strong> <span style="color: #F44336;">Sin datos</span></div>`;
            }
        });
        summaryHTML += `<div style="margin-top: 10px; font-style: italic;">Active la animación para ver el historial de registros.</div>`;
        elements.dataSummary.innerHTML = summaryHTML;
        return;
    }

    // Animation mode
    let summaryHTML = `<div style="margin-bottom: 10px;"><strong>Últimas ${hours} hora${hours > 1 ? 's' : ''}:</strong></div>`;

    let totalFrames = 0;
    radarConfigs.forEach(config => {
      const range = radarTimestampRanges[config.id];
      const icon = config.id === 'guaxx' ? '🟠' : '🔵';
      totalFrames += range ? range.count : 0;

      if (range && range.count > 0) {
        const oldestTime = formatTimeOnly(range.oldest);
        const newestTime = formatTimeOnly(range.newest);
        summaryHTML += `<div class="stats-row">${icon} <strong>${config.name}:</strong> ${range.count} registros (${oldestTime} - ${newestTime} LT)</div>`;
      } else {
        summaryHTML += `<div class="stats-row">${icon} <strong>${config.name}:</strong> <span style="color: #F44336;">Sin datos</span></div>`;
      }
    });

    if (totalFrames > 0) {
      summaryHTML += `<div class="stats-total">Total: ${allTimestamps.length} frames disponibles</div>`;
    }

    elements.dataSummary.innerHTML = summaryHTML;
  }

  function updateRadarStatus(radarId, timestamps, hours) {
    const statusElement = document.getElementById(`${radarId}-status`);

    if (statusElement) {
      if (timestamps && timestamps.length > 0) {
        const countText = hours > 0 ? `${timestamps.length} regs` : '1 captura';
        statusElement.innerHTML = `<span style="color: #4CAF50;">✓ ${countText}</span>`;

        if (radarMarkers[radarId]) {
          const markerElement = radarMarkers[radarId].getElement();
          if (markerElement) {
            markerElement.classList.remove('inactive');
          }
        }
      } else {
        statusElement.innerHTML = `<span style="color: #F44336;">⚠️ Sin datos</span>`;

        if (radarMarkers[radarId]) {
          const markerElement = radarMarkers[radarId].getElement();
          if (markerElement) {
            markerElement.classList.add('inactive');
          }
        }
      }
    }
  }

  // ============================================================================
  // VISUALIZACIÓN DE REGISTROS
  // ============================================================================

  /**
   * Shows the latest captures in static mode (initial load or refresh).
   * @param {Object} mainTimestampData The most recent record of all (or null).
   */
  function showStaticImages(mainTimestampData) {
      // Handles case without data (mainTimestampData === null)
      if (!mainTimestampData) {
          console.log('No hay capturas disponibles para mostrar');
          // Remove layers if they exist
          Object.keys(currentImageLayers).forEach(radarId => {
              if (currentImageLayers[radarId]) {
                  map.removeLayer(currentImageLayers[radarId]);
                  delete currentImageLayers[radarId];
              }
          });
          // Clear time info if no data
          elements.captureTime.innerHTML = 'Sin datos';
          elements.dataAge.textContent = '-- min';
          elements.dataAge.style.color = '';
          return;
      }
      
      const latestLT = extractLocalTime(mainTimestampData.formatted_time || mainTimestampData.datetime_local);
      const latestTime = parseLocalTime(latestLT);

      console.log(`Mostrando capturas más recientes cercanas a: ${latestLT}`);

      // Tolerance to find nearby records between radars (10 minutes)
      const toleranceMs = 10 * 60 * 1000; 

      radarConfigs.forEach(config => {
          const timestampData = latestTimestamps[config.id]; // Use the already loaded record

          if (!timestampData) {
              // Hide layer if no data for this radar
              if (currentImageLayers[config.id]) {
                  map.removeLayer(currentImageLayers[config.id]);
                  delete currentImageLayers[config.id];
              }
              return;
          }
          
          const tsLT = extractLocalTime(timestampData.formatted_time || timestampData.datetime_local);
          const tsTime = parseLocalTime(tsLT);
          const diff = Math.abs(tsTime - latestTime);

          if (diff <= toleranceMs) {
              displayRadarImage(timestampData);
              updateMarkerPopup(config.id, timestampData);
              console.log(`Radar ${config.id}: Mostrando captura de ${tsLT} (diferencia: ${Math.round(diff/1000)}s)`);
          } else {
              console.log(`Radar ${config.id}: Captura demasiado antigua respecto al más reciente (${Math.round(diff/60000)} min)`);
              if (currentImageLayers[config.id]) {
                  map.removeLayer(currentImageLayers[config.id]);
                  delete currentImageLayers[config.id];
              }
          }
      });
  }

  function displayRadarImage(timestampData) {
    const radarId = timestampData.radarId;

    if (currentImageLayers[radarId]) {
      map.removeLayer(currentImageLayers[radarId]);
    }

    const config = radarConfigs.find(c => c.id === radarId);
    
    const imagePath = getImagePath(
      config,
      timestampData.year,
      timestampData.julianDay,
      timestampData.filename
    );

    // ========================================================================
    // CORRECTED BOUNDS CALCULATION LOGIC
    // ========================================================================
    let imageBounds;
    
    // 1. Try to use bounds from the JSON (ideal)
    if (timestampData.bounds && Array.isArray(timestampData.bounds) && timestampData.bounds.length === 2) {
        
        const lat1 = timestampData.bounds[0][0];
        const lon1 = timestampData.bounds[0][1];
        const lat2 = timestampData.bounds[1][0];
        const lon2 = timestampData.bounds[1][1];
        
        const lat_min = Math.min(lat1, lat2);
        const lat_max = Math.max(lat1, lat2);
        const lon_min = Math.min(lon1, lon2);
        const lon_max = Math.max(lon1, lon2);
        
        imageBounds = [[lat_min, lon_min], [lat_max, lon_max]];
        
        // 2. Apply correction if the radar requires it
        imageBounds = adjustBoundsByScale(imageBounds, config.center, config.scaleFactor);
        
    } else {
        // 3. Fallback: Calculate bounds based on radar radius and scale factor
        imageBounds = calculateTheoreticalBounds(config);
        console.warn(`Bounds para ${radarId} calculados teóricamente con factor de ${config.scaleFactor}`);
    }
    
    // Ensure Leaflet understands the limits
    const finalBounds = L.latLngBounds(imageBounds);
    
    const isVisible = activeRadars.has(radarId);

    currentImageLayers[radarId] = L.imageOverlay(imagePath, finalBounds, {
      opacity: isVisible ? opacity : 0,
      zIndex: config.zIndex,
      className: `radar-image-layer ${radarId}`
    });

    currentImageLayers[radarId].addTo(map);

    console.log(`Registro mostrado: ${radarId} - ${imagePath} (zIndex: ${config.zIndex})`);
  }
  
  function calculateTheoreticalBounds(config) {
    const lat = config.center[0];
    const lng = config.center[1];
    const radiusKm = config.radiusKm;
    const scaleFactor = config.scaleFactor;
    
    // 1 degree of latitud is ~111.32 km.
    const degPerKm = 1 / 111.32;
    
    // Adjust the radius to be the radius of the *image* (includes the correction factor)
    const adjustedRadiusDeg = radiusKm * degPerKm * scaleFactor;
    
    // Calculate longitude factor (cosine of latitude)
    const latRad = lat * Math.PI / 180;
    const lonFactor = Math.cos(latRad);
    
    // Calculate adjusted longitude displacement
    const adjustedRadiusLonDeg = adjustedRadiusDeg / lonFactor;
    
    // Define the rectangle
    const lat_min = lat - adjustedRadiusDeg;
    const lat_max = lat + adjustedRadiusDeg;
    const lon_min = lng - adjustedRadiusLonDeg;
    const lon_max = lng + adjustedRadiusLonDeg;
    
    return [
        [lat_min, lon_min], 
        [lat_max, lon_max]
    ];
  }
  
  function adjustBoundsByScale(bounds, center, scaleFactor) {
      if (scaleFactor === 1.0) {
          return bounds;
      }
      
      const centerLat = center[0];
      const centerLon = center[1];
      
      const [[lat_min, lon_min], [lat_max, lon_max]] = bounds;
      
      // Calculate the current distance of the limits to the center
      const latDiff = (lat_max - lat_min) / 2;
      const lonDiff = (lon_max - lon_min) / 2;
      
      // Apply the scale factor
      const newLatDiff = latDiff * scaleFactor;
      const newLonDiff = lonDiff * scaleFactor;
      
      // Calculate the new limits
      const new_lat_min = centerLat - newLatDiff;
      const new_lat_max = centerLat + newLatDiff;
      const new_lon_min = centerLon - newLonDiff;
      const new_lon_max = centerLon + newLonDiff;
      
      return [[new_lat_min, new_lon_min], [new_lat_max, new_lon_max]];
  }

  function updateMarkerPopup(radarId, timestampData) {
    if (!radarMarkers[radarId]) return;

    const config = radarConfigs.find(c => c.id === radarId);
    if (!config) return;

    const formattedTime = timestampData.formatted_time || timestampData.datetime_local;
    const displayTime = removeSeconds(formattedTime);

    const popupContent = `
      <div class="radar-popup">
        <h4>${config.name}</h4>
        <p>Última captura: ${displayTime}</p>
        <p>Radio: ${config.radiusKm} km</p>
      </div>
    `;

    radarMarkers[radarId].bindPopup(popupContent);
  }

  function updateCaptureTimes(timestampData) {
    const formattedTime = timestampData.formatted_time || timestampData.datetime_local;
    // La fecha en 'formattedTime' ya debería contener el LT o ser sólo la hora UTC/local. 
    let displayTime = removeSeconds(formattedTime);

    // Patrón para extraer UTC y LT: YYYY-MM-DD HH:MM UTC (YYYY-MM-DD HH:MM LT)
    // Este patrón es el que genera los datos JSON.
    const pattern = /^(.+?)\s+UTC\s+\((.+?)\s+LT\)$/;
    const match = displayTime.match(pattern);

    if (match) {
      const utcPart = match[1];
      const ltPart = match[2];

      const ltTime = parseLocalTime(ltPart);
      const ageMinutes = Math.floor((new Date() - ltTime) / (1000 * 60));
      const ageText = ageMinutes < 60 ? `hace ${ageMinutes} min` : `hace ${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}min`;

      // CORRECCIÓN 1: Aseguramos que la parte en negrita sea la hora LT y el UTC esté entre paréntesis.
      displayTime = `<strong>${ltPart} LT</strong> <span style="color: #aaa; font-size: 0.9em;">(${utcPart} UTC) • ${ageText}</span>`;
      elements.captureTime.innerHTML = displayTime;

      updateDataAge(ageMinutes);
    } else {
      // Si el formato es simple (sólo hora local o UTC sin distinción)
      const timeToParse = extractLocalTime(displayTime); // Intenta extraer por si acaso
      const ltTime = parseLocalTime(timeToParse);
      const ageMinutes = Math.floor((new Date() - ltTime) / (1000 * 60));
      const ageText = ageMinutes < 60 ? `hace ${ageMinutes} min` : `hace ${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}min`;
      
      // Muestra la hora base y asume que es LT, sin indicar UTC si no se parseó.
      displayTime = `<strong>${timeToParse} LT</strong> <span style="color: #aaa; font-size: 0.9em;">(Hora no especificada) • ${ageText}</span>`;
      elements.captureTime.innerHTML = displayTime;
      updateDataAge(ageMinutes);
    }
  }

  function updateDataAge(diffMinutes) {
    elements.dataAge.textContent = `${diffMinutes} min`;

    if (diffMinutes > 15) {
      elements.dataAge.style.color = '#F44336'; // Red
    } else if (diffMinutes > 10) {
      elements.dataAge.style.color = '#FFC107'; // Yellow
    } else {
      elements.dataAge.style.color = '#4CAF50'; // Green
    }
  }

  function updateStatusInfo(status, isActive) {
    elements.statusText.textContent = status;

    if (isActive) {
      elements.statusDot.classList.remove('error');
    } else {
      elements.statusDot.classList.add('error');
    }
  }

  // ============================================================================
  // ANIMACIÓN (On-Demand)
  // ============================================================================
  
  /**
   * Manages the download of all records for the selected period.
   */
  async function downloadAnimationData() {
      showLoader('Descargando historial de registros para la animación...');
      
      const hours = parseInt(elements.periodSelect.value, 10);
      const totalFrames = await loadRadarData(hours);

      hideLoader();
      
      if (totalFrames < 2) {
          // If not enough data to animate, disable animation mode
          isAnimationActive = false;
          elements.toggleAnim.innerHTML = '<i class="fas fa-film"></i><span>Activar animación</span>';
          elements.controls.classList.remove('active');
          elements.timeline.classList.remove('active');
          
          showNotification('Se necesitan al menos 2 registros para animar en el período seleccionado', true);
          return false;
      }
      
      return true;
  }

  async function toggleAnimation() {
    // When clicking, if the animation was not active, activate it.
    const willBeActive = !isAnimationActive;
    isAnimationActive = willBeActive;

    if (isAnimationActive) {
      // 1. Download data if necessary (if allTimestamps is empty)
      if (allTimestamps.length === 0) {
          const success = await downloadAnimationData();
          if (!success) {
              // If download failed or not enough data, exit.
              return; 
          }
      }
      
      // 2. Setup and start animation
      setupAnimation();
      elements.toggleAnim.innerHTML = '<i class="fas fa-stop"></i><span>Desactivar animación</span>';
      elements.controls.classList.add('active');
      elements.timeline.classList.add('active');
      toggleAnimationPlay(); // Start playing automatically (4x by default)

    } else {
      elements.toggleAnim.innerHTML = '<i class="fas fa-film"></i><span>Activar animación</span>';
      stopAnimation();
      elements.controls.classList.remove('active');
      elements.timeline.classList.remove('active');
      
      // Reload the latest capture in static mode
      loadLatestImages(); 
    }
  }

  function setupAnimation() {
    stopAnimation();

    const filteredTimestamps = getFilteredTimestamps();

    console.log(`Setup animación: ${filteredTimestamps.length} frames disponibles`);

    createTimelineTicks(filteredTimestamps);

    currentFrame = filteredTimestamps.length - 1;
    showFrame(currentFrame);

    const hours = parseInt(elements.periodSelect.value, 10);
    showNotification(`${filteredTimestamps.length} frames disponibles para las últimas ${hours} hora${hours > 1 ? 's' : ''}`);

    return true; 
  }

  function getFilteredTimestamps() {
    const hours = parseInt(elements.periodSelect.value, 10);

    if (allTimestamps.length === 0) return [];

    const newestTimestamp = allTimestamps[allTimestamps.length - 1];
    const newestLT = extractLocalTime(newestTimestamp.formatted_time || newestTimestamp.datetime_local);
    const newestTime = parseLocalTime(newestLT);
    const cutoffTime = new Date(newestTime.getTime() - (hours * 60 * 60 * 1000));

    return allTimestamps.filter(timestamp => {
      const ltTime = extractLocalTime(timestamp.formatted_time || timestamp.datetime_local);
      const timestampDate = parseLocalTime(ltTime);
      return timestampDate >= cutoffTime && timestampDate <= newestTime;
    });
  }

  function createTimelineTicks(timestamps) {
    elements.ticks.innerHTML = '';

    if (timestamps.length === 0) return;

    let numTicks = Math.min(6, timestamps.length);

    // Always include the first and last frame
    if (timestamps.length <= 6) {
      timestamps.forEach((timestamp, i) => {
        addTimelineTick(timestamp, i, timestamps.length);
      });
    } else {
      const indicesToShow = new Set([0, timestamps.length - 1]);
      const step = (timestamps.length - 1) / (numTicks - 1);

      for (let i = 1; i < numTicks - 1; i++) {
        const index = Math.round(i * step);
        indicesToShow.add(index);
      }
      
      Array.from(indicesToShow).sort((a, b) => a - b).forEach(index => {
          addTimelineTick(timestamps[index], index, timestamps.length);
      });
    }
  }

  /**
   * Adds a time mark (tick) to the animation timeline.
   */
  function addTimelineTick(timestamp, index, total) {
    const tick = document.createElement('div');
    const dateStr = timestamp.datetime_local || timestamp.formatted_time;

    const ltTime = extractLocalTime(dateStr);
    const timeMatch = ltTime.match(/(\d{2}):(\d{2})/);
    const timeStr = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : '--:--';

    tick.textContent = timeStr;
    tick.className = 'timeline-tick';
    // Position calculation
    const position = total > 1 ? (index / (total - 1)) * 100 : 0; 
    tick.style.left = `${position}%`;
    elements.ticks.appendChild(tick);
  }

  function toggleAnimationPlay() {
    const playIcon = elements.playBtn.querySelector('i');

    if (animationInterval) {
      clearInterval(animationInterval);
      animationInterval = null;
      playIcon.classList.remove('fa-pause');
      playIcon.classList.add('fa-play');
    } else {
      playAnimation();
      playIcon.classList.remove('fa-play');
      playIcon.classList.add('fa-pause');
    }
  }

  function playAnimation() {
    const timestamps = getFilteredTimestamps();
    if (timestamps.length < 2) return;

    const speed = parseFloat(elements.speedSelect.value);
    const frameDelay = 1000 / speed;
    
    // If animation was paused on the last frame, start from the beginning
    if (currentFrame === timestamps.length - 1) {
        currentFrame = 0; // Restart
    }

    animationInterval = setInterval(() => {
      nextFrame();
    }, frameDelay);
  }

  function stopAnimation() {
    if (animationInterval) {
      clearInterval(animationInterval);
      animationInterval = null;

      const playIcon = elements.playBtn.querySelector('i');
      playIcon.classList.remove('fa-pause');
      playIcon.classList.add('fa-play');
    }
  }

  function nextFrame() {
    const timestamps = getFilteredTimestamps();
    if (currentFrame < timestamps.length - 1) {
      currentFrame++;
    } else {
      currentFrame = 0; // Loop
    }
    showFrame(currentFrame);
  }

  function prevFrame() {
    const timestamps = getFilteredTimestamps();
    if (currentFrame > 0) {
      currentFrame--;
    } else {
      currentFrame = timestamps.length - 1; // Loop
    }
    showFrame(currentFrame);
  }

  function goToFrame(frameIndex) {
    const timestamps = getFilteredTimestamps();
    if (frameIndex >= 0 && frameIndex < timestamps.length) {
      stopAnimation();
      currentFrame = frameIndex;
      showFrame(currentFrame);
    }
  }

  function showFrame(frameIndex) {
    const timestamps = getFilteredTimestamps();
    if (timestamps.length === 0 || frameIndex >= timestamps.length) return;

    const currentTimestamp = timestamps[frameIndex];
    updateCaptureTimes(currentTimestamp);
    
    const targetLT = extractLocalTime(currentTimestamp.formatted_time || currentTimestamp.datetime_local);
    const targetTime = parseLocalTime(targetLT);

    const toleranceMs = 10 * 60 * 1000; // 10 minutes tolerance

    radarConfigs.forEach(config => {
      const radarTimestamps = radarTimestampRanges[config.id]?.timestamps || [];
      
      if (radarTimestamps.length === 0) {
        if (currentImageLayers[config.id]) {
          map.removeLayer(currentImageLayers[config.id]);
          delete currentImageLayers[config.id];
        }
        return;
      }
      
      // Find the closest timestamp from this radar to the current frame time (targetTime)
      let closest = null;
      let minDiff = Infinity;
      
      radarTimestamps.forEach(ts => {
        const tsTime = parseLocalTime(extractLocalTime(ts.formatted_time || ts.datetime_local));
        const diff = Math.abs(tsTime - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = ts;
        }
      });
      
      if (closest && minDiff <= toleranceMs) {
        // Show the closest record
        displayRadarImage(closest);
      } else {
        // Hide if there is no close record
        if (currentImageLayers[config.id]) {
          map.removeLayer(currentImageLayers[config.id]);
          delete currentImageLayers[config.id];
        }
      }
    });

    if (timestamps.length > 1) {
      const progress = (frameIndex / (timestamps.length - 1)) * 100;
      elements.bar.style.width = `${progress}%`;
      elements.pointer.style.left = `${progress}%`;
    } else {
      elements.bar.style.width = '100%';
      elements.pointer.style.left = '100%';
    }
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================

  function setupEventListeners() {

    // Opacity control
    elements.opacitySlider.addEventListener('input', () => {
      opacity = elements.opacitySlider.value / 100;
      elements.opacityValue.textContent = `${elements.opacitySlider.value}%`;

      Object.keys(currentImageLayers).forEach(radarId => {
        if (currentImageLayers[radarId] && activeRadars.has(radarId)) {
          currentImageLayers[radarId].setOpacity(opacity);
        }
      });
    });

    // Radar toggle
    document.querySelectorAll('.radar-toggle').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        const radarId = e.target.dataset.radar;

        if (e.target.checked) {
          activeRadars.add(radarId);
          // If animation is active, the image is shown in showFrame()
          if (!isAnimationActive) {
              // In static mode, try to show the latest capture for this radar
              if (latestTimestamps[radarId]) {
                  displayRadarImage(latestTimestamps[radarId]);
              }
          } else {
              // If animation is running, just update opacity
              if (currentImageLayers[radarId]) {
                 currentImageLayers[radarId].setOpacity(opacity);
              }
          }
        } else {
          activeRadars.delete(radarId);
          if (currentImageLayers[radarId]) {
            currentImageLayers[radarId].setOpacity(0);
          }
        }
      });
    });

    // Markers toggle
    if (elements.toggleMarkers) {
      elements.toggleMarkers.addEventListener('change', (e) => {
        showMarkers = e.target.checked;

        radarConfigs.forEach(config => {
          if (radarMarkers[config.id]) {
            const markerElement = radarMarkers[config.id].getElement();
            if (markerElement) {
              markerElement.style.display = showMarkers ? 'flex' : 'none';
            }
          }
        });
      });
    }

    // Animation toggle
    elements.toggleAnim.addEventListener('click', toggleAnimation);

    // Animation controls
    elements.playBtn.addEventListener('click', toggleAnimationPlay);
    elements.firstBtn.addEventListener('click', () => goToFrame(0));
    elements.lastBtn.addEventListener('click', () => {
      const timestamps = getFilteredTimestamps();
      goToFrame(timestamps.length - 1);
    });
    elements.prevBtn.addEventListener('click', prevFrame);
    elements.nextBtn.addEventListener('click', nextFrame);

    // 🌟 1. Efecto inmediato de cambio de velocidad
    elements.speedSelect.addEventListener('change', () => {
        if (isAnimationActive && animationInterval) {
            // Si la animación está activa y reproduciéndose, reinicia el intervalo
            const wasPlaying = animationInterval !== null;
            stopAnimation();
            if (wasPlaying) {
                // Pequeño retardo para asegurar que stopAnimation limpió el intervalo
                setTimeout(() => {
                    playAnimation();
                }, 50); 
            }
        }
    });

    // Animation period change
    elements.periodSelect.addEventListener('change', async () => {
      if (isAnimationActive) {
        const wasPlaying = animationInterval !== null;
        stopAnimation();

        // Force data reload for the new period
        const success = await downloadAnimationData();
        
        if (success) {
            setupAnimation();
            if (wasPlaying) {
              setTimeout(() => {
                playAnimation();
              }, 100);
            }
        } else {
            // If download fails, loadLatestImages() will have been called in toggleAnimation.
        }
      }
    });
    
    // Click on the timeline bar
    elements.timeline.addEventListener('click', (e) => {
        if (!isAnimationActive) return;
        
        const rect = elements.timeline.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const totalWidth = rect.width;
        
        const progress = x / totalWidth;
        const timestamps = getFilteredTimestamps();
        
        if (timestamps.length > 1) {
            const frameIndex = Math.round(progress * (timestamps.length - 1));
            goToFrame(frameIndex);
        }
    });


    // Refresh button
    elements.refresh.addEventListener('click', async () => {
      elements.refresh.disabled = true;
      elements.refreshIcon.classList.add('fa-spin');
      
      let wasPlaying = animationInterval !== null;

      if (isAnimationActive) {
          // Refresh Logic in Animation:
          // 1. Stop playback (but keep isAnimationActive = true)
          stopAnimation(); 
          
          // 2. Download new data
          const totalFramesBefore = allTimestamps.length;
          const success = await downloadAnimationData();
          
          if (success) {
              const totalFramesAfter = allTimestamps.length;
              const latestTimestamp = allTimestamps[allTimestamps.length - 1];
              const latestLT = removeSeconds(extractLocalTime(latestTimestamp.formatted_time || latestTimestamp.datetime_local));
              
              // 3. Reconfigure animation with new data
              setupAnimation();
              
              // 4. Determine where to continue
              if (wasPlaying && totalFramesAfter > totalFramesBefore) {
                  // If it was playing and there is new data, start from frame 0 to show the complete cycle
                  goToFrame(0);
                  playAnimation();
                  showNotification(`Actualización exitosa: ${latestLT} LT`); // Mensaje simplificado
              } else if (wasPlaying) {
                  // If it was playing but there is no new data, simply restart playback
                  playAnimation();
                  showNotification(`Actualización completada: ${latestLT} LT`); // Mensaje simplificado
              } else {
                  // If it was paused, simply update the view to the last frame
                  goToFrame(totalFramesAfter - 1);
                  showNotification(`Actualización completada: ${latestLT} LT`); // Mensaje simplificado
              }
          } else {
              // If download fails, downloadAnimationData will have already disabled the animation
              showNotification(`Error al actualizar el historial de registros.`, true);
          }
          
      } else {
          // Refresh in static mode 
          // Necesitamos obtener la última captura encontrada para el mensaje
          
          // La función loadLatestImages ya devuelve el último found.data si existe.
          const latestFound = await loadLatestImages(); 

          if (latestFound) {
              // CORRECCIÓN 2: Asegurar que el mensaje de notificación use la hora LT
              const latestLT = removeSeconds(extractLocalTime(latestFound.data.formatted_time || latestFound.data.datetime_local));
              showNotification(`Actualización exitosa: ${latestLT} LT`); 
          } else {
              showNotification(`No hay registros recientes disponibles.`, true);
          }
      }
      
      elements.refresh.disabled = false;
      elements.refreshIcon.classList.remove('fa-spin');
    });

    // Keyboard events for animation
    document.addEventListener('keydown', (e) => {
      if (isAnimationActive) {
        if (e.key === 'ArrowRight') {
          nextFrame();
        } else if (e.key === 'ArrowLeft') {
          prevFrame();
        } else if (e.key === ' ') {
          toggleAnimationPlay();
          e.preventDefault();
        }
      }
    });
  }

  // ============================================================================
  // UTILIDADES DE UI
  // ============================================================================

  function showLoader(message) {
    elements.loader.classList.add('active');
    elements.loaderText.textContent = message || 'Cargando...';
  }

  function hideLoader() {
    elements.loader.classList.remove('active');
  }

  function showNotification(message, isError = false) {
    elements.notification.textContent = message;
    elements.notification.className = 'notification';

    if (isError) {
      elements.notification.classList.add('error');
    }

    elements.notification.classList.add('show');

    setTimeout(() => {
      elements.notification.classList.remove('show');
    }, 5000);
  }

  // ============================================================================
  // INICIAR APLICACIÓN
  // ============================================================================

  initializeApp();

});
