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

  // Variables para ubicación del usuario
  let userLocationMarker = null;
  let userAccuracyCircle = null;
  let showUserLocation = false;
  let watchId = null;
  let userPosition = null;

  // Sistema de precarga y cache
  let preloadedImages = new Map(); // Mapa de URL -> HTMLImageElement
  let imageCache = null; // Cache API
  const CACHE_NAME = 'radar-images-v1';
  const MAX_CACHE_SIZE = 100; // Máximo de imágenes en cache

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

    // Precarga
    preloadProgress: document.getElementById('preload-progress'),
    preloadBar: document.getElementById('preload-bar'),
    preloadStatus: document.getElementById('preload-status'),
    preloadPercentage: document.getElementById('preload-percentage'),
    preloadDetails: document.getElementById('preload-details'),

    // Sidebar
    opacitySlider: document.getElementById('overlay-opacity'),
    opacityValue: document.getElementById('opacity-value'),
    dataSummary: document.getElementById('data-summary'),
    toggleMarkers: document.getElementById('toggle-markers'),

    // User location
    toggleUserLocation: document.getElementById('toggle-user-location'),
    locationStatus: document.getElementById('location-status'),

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
  // SISTEMA DE CACHE Y PRECARGA
  // ============================================================================

  /**
   * Inicializa el sistema de cache usando Cache API
   */
  async function initializeCache() {
    try {
      if ('caches' in window) {
        imageCache = await caches.open(CACHE_NAME);
        console.log('Sistema de cache inicializado');
      } else {
        console.warn('Cache API no disponible en este navegador');
      }
    } catch (error) {
      console.error('Error inicializando cache:', error);
    }
  }

  /**
   * Obtiene una imagen del cache o la descarga si no existe
   */
  async function getCachedImage(url) {
    if (!imageCache) return null;

    try {
      const cachedResponse = await imageCache.match(url);
      if (cachedResponse) {
        console.log(`Imagen cargada desde cache: ${url}`);
        return cachedResponse;
      }
    } catch (error) {
      console.error('Error obteniendo imagen del cache:', error);
    }
    return null;
  }

  /**
   * Guarda una imagen en el cache
   */
  async function cacheImage(url, response) {
    if (!imageCache) return;

    try {
      await imageCache.put(url, response.clone());
      await manageCacheSize();
    } catch (error) {
      console.error('Error guardando imagen en cache:', error);
    }
  }

  /**
   * Gestión de tamaño del cache - elimina imágenes antiguas si excede el límite
   */
  async function manageCacheSize() {
    if (!imageCache) return;

    try {
      const keys = await imageCache.keys();
      if (keys.length > MAX_CACHE_SIZE) {
        const deleteCount = keys.length - MAX_CACHE_SIZE;
        console.log(`Limpiando cache: eliminando ${deleteCount} imágenes antiguas`);

        for (let i = 0; i < deleteCount; i++) {
          await imageCache.delete(keys[i]);
        }
      }
    } catch (error) {
      console.error('Error gestionando tamaño del cache:', error);
    }
  }

  /**
   * Precarga todas las imágenes para la animación
   */
  async function preloadAnimationImages(timestamps) {
    return new Promise(async (resolve, reject) => {
      try {
        const totalImages = timestamps.length;
        let loadedCount = 0;
        let errorCount = 0;

        // Mostrar barra de progreso
        showPreloadProgress();

        // Limpiar precarga anterior
        clearPreloadedImages();

        // Array de promesas para cargar todas las imágenes
        const loadPromises = timestamps.map(async (timestamp, index) => {
          const config = timestamp.radarConfig;
          const imagePath = getImagePath(
            config,
            timestamp.year,
            timestamp.julianDay,
            timestamp.filename
          );

          const fullUrl = new URL(imagePath, window.location.origin).href;

          try {
            // Intentar obtener del cache primero
            let response = await getCachedImage(fullUrl);

            if (!response) {
              // Si no está en cache, descargar
              response = await fetch(fullUrl);
              if (response.ok) {
                await cacheImage(fullUrl, response);
              } else {
                throw new Error(`HTTP ${response.status}`);
              }
            }

            // Crear objeto Image para precarga real en memoria
            const img = new Image();
            img.crossOrigin = 'anonymous';

            await new Promise((resolveImg, rejectImg) => {
              img.onload = () => {
                preloadedImages.set(fullUrl, img);
                loadedCount++;
                updatePreloadProgress(loadedCount, totalImages, errorCount);
                resolveImg();
              };
              img.onerror = () => {
                errorCount++;
                console.warn(`Error cargando imagen ${index + 1}/${totalImages}: ${imagePath}`);
                updatePreloadProgress(loadedCount, totalImages, errorCount);
                resolveImg(); // Continuar aunque falle
              };
              img.src = fullUrl;
            });

          } catch (error) {
            errorCount++;
            console.warn(`Error descargando imagen ${index + 1}/${totalImages}:`, error);
            updatePreloadProgress(loadedCount, totalImages, errorCount);
          }
        });

        // Esperar a que todas las imágenes se carguen
        await Promise.all(loadPromises);

        hidePreloadProgress();

        if (loadedCount === 0) {
          reject(new Error('No se pudo cargar ninguna imagen'));
        } else {
          console.log(`Precarga completa: ${loadedCount}/${totalImages} imágenes cargadas`);
          if (errorCount > 0) {
            showNotification(`Precarga completa: ${loadedCount} imágenes (${errorCount} errores)`, false);
          } else {
            showNotification(`${loadedCount} imágenes precargadas con éxito`);
          }
          resolve(loadedCount);
        }

      } catch (error) {
        hidePreloadProgress();
        reject(error);
      }
    });
  }

  /**
   * Muestra la barra de progreso de precarga
   */
  function showPreloadProgress() {
    elements.preloadProgress.classList.add('active');
    elements.preloadBar.style.width = '0%';
    elements.preloadPercentage.textContent = '0%';
    elements.preloadStatus.textContent = 'Precargando imágenes...';
    elements.preloadDetails.textContent = '';
  }

  /**
   * Actualiza la barra de progreso de precarga
   */
  function updatePreloadProgress(loaded, total, errors) {
    const percentage = Math.round((loaded / total) * 100);
    elements.preloadBar.style.width = `${percentage}%`;
    elements.preloadPercentage.textContent = `${percentage}%`;
    elements.preloadDetails.textContent = `${loaded}/${total} imágenes cargadas`;

    if (errors > 0) {
      elements.preloadDetails.textContent += ` (${errors} errores)`;
    }
  }

  /**
   * Oculta la barra de progreso de precarga
   */
  function hidePreloadProgress() {
    setTimeout(() => {
      elements.preloadProgress.classList.remove('active');
    }, 1000);
  }

  /**
   * Limpia las imágenes precargadas de la memoria
   */
  function clearPreloadedImages() {
    console.log(`Limpiando ${preloadedImages.size} imágenes de la memoria`);
    preloadedImages.clear();
  }

  /**
   * Limpia el cache completo
   */
  async function clearCache() {
    try {
      if ('caches' in window) {
        await caches.delete(CACHE_NAME);
        imageCache = await caches.open(CACHE_NAME);
        console.log('Cache limpiado y reiniciado');
        showNotification('Cache limpiado exitosamente');
      }
    } catch (error) {
      console.error('Error limpiando cache:', error);
      showNotification('Error al limpiar el cache', true);
    }
  }

  /**
   * Obtiene estadísticas del cache
   */
  async function getCacheStats() {
    if (!imageCache) return { count: 0, size: 0 };

    try {
      const keys = await imageCache.keys();
      let totalSize = 0;

      for (const request of keys) {
        const response = await imageCache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      }

      return {
        count: keys.length,
        size: (totalSize / (1024 * 1024)).toFixed(2) // MB
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas del cache:', error);
      return { count: 0, size: 0 };
    }
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
    initUserLocation(); // Initialize user location status
    initializeCache(); // Inicializar sistema de cache
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
   * Note: Caller should manage loader display
   */
  async function downloadAnimationData() {
      const hours = parseInt(elements.periodSelect.value, 10);
      const totalFrames = await loadRadarData(hours);

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
      // Mostrar feedback inmediato al usuario
      showLoader('Preparando animación...');
      elements.toggleAnim.disabled = true; // Deshabilitar botón mientras carga

      try {
        // 1. Download data if necessary (if allTimestamps is empty)
        if (allTimestamps.length === 0) {
          elements.loaderText.textContent = 'Descargando historial de registros...';
          const success = await downloadAnimationData();
          if (!success) {
            // If download failed or not enough data, exit.
            elements.toggleAnim.disabled = false;
            hideLoader();
            return;
          }
        }

        // 2. Precargar todas las imágenes antes de iniciar animación
        const filteredTimestamps = getFilteredTimestamps();
        elements.loaderText.textContent = `Precargando ${filteredTimestamps.length} imágenes...`;

        try {
          await preloadAnimationImages(filteredTimestamps);
        } catch (error) {
          console.error('Error en precarga de imágenes:', error);
          showNotification('Error al precargar algunas imágenes. La animación continuará.', true);
        }

        // 3. Setup and start animation
        elements.loaderText.textContent = 'Iniciando animación...';
        setupAnimation();
        elements.toggleAnim.innerHTML = '<i class="fas fa-stop"></i><span>Desactivar animación</span>';
        document.getElementById('animation-panel').classList.add('active');
        elements.timeline.classList.add('active');

        hideLoader();
        elements.toggleAnim.disabled = false;

        toggleAnimationPlay(); // Start playing automatically (4x by default)
      } catch (error) {
        console.error('Error al activar animación:', error);
        showNotification('Error al activar la animación', true);
        elements.toggleAnim.disabled = false;
        hideLoader();
        isAnimationActive = false;
      }

    } else {
      elements.toggleAnim.innerHTML = '<i class="fas fa-film"></i><span>Activar animación</span>';
      stopAnimation();
      document.getElementById('animation-panel').classList.remove('active');
      elements.timeline.classList.remove('active');

      // Limpiar imágenes precargadas para liberar memoria
      clearPreloadedImages();

      // Reload the latest capture in static mode
      showLoader('Cargando vista estática...');
      await loadLatestImages();
      hideLoader();
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
  // GEOLOCALIZACIÓN DEL USUARIO
  // ============================================================================

  function initUserLocation() {
    if (!navigator.geolocation) {
      console.warn('Geolocalización no soportada por este navegador');
      elements.locationStatus.innerHTML = '<span style="color: #F44336;">No disponible</span>';
      elements.toggleUserLocation.disabled = true;
      return;
    }

    elements.locationStatus.innerHTML = '<span style="color: #666;">Inactivo</span>';

    // Solicitar automáticamente la ubicación al usuario después de cargar el mapa
    setTimeout(() => {
      promptUserForLocation();
    }, 2000); // Esperar 2 segundos después de cargar para no ser intrusivo
  }

  /**
   * Solicita permiso al usuario para activar la geolocalización
   */
  function promptUserForLocation() {
    // Verificar si ya se negó el permiso previamente
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        if (result.state === 'granted') {
          // Si ya está autorizado, activar automáticamente
          elements.toggleUserLocation.checked = true;
          showUserLocation = true;
          requestUserLocation();
        } else if (result.state === 'prompt') {
          // Si no se ha decidido, mostrar un mensaje amigable
          showLocationPrompt();
        }
        // Si es 'denied', no hacer nada para respetar la decisión del usuario
      }).catch(() => {
        // Si la API de permisos no está disponible, mostrar el prompt directamente
        showLocationPrompt();
      });
    } else {
      // Fallback para navegadores sin soporte de permissions API
      showLocationPrompt();
    }
  }

  /**
   * Muestra un diálogo personalizado para solicitar la ubicación
   */
  function showLocationPrompt() {
    // Crear un diálogo personalizado
    const dialog = document.createElement('div');
    dialog.className = 'location-prompt-dialog';
    dialog.innerHTML = `
      <div class="location-prompt-content">
        <div class="location-prompt-icon">📍</div>
        <h3>¿Activar tu ubicación?</h3>
        <p>Esto nos permitirá mostrarte tu posición en el mapa y verificar si estás dentro del área de cobertura de los radares.</p>
        <div class="location-prompt-buttons">
          <button class="btn-prompt-accept">Sí, activar</button>
          <button class="btn-prompt-decline">No, gracias</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // Mostrar el diálogo con animación
    setTimeout(() => {
      dialog.classList.add('show');
    }, 100);

    // Manejar respuesta del usuario
    const acceptBtn = dialog.querySelector('.btn-prompt-accept');
    const declineBtn = dialog.querySelector('.btn-prompt-decline');

    acceptBtn.addEventListener('click', () => {
      elements.toggleUserLocation.checked = true;
      showUserLocation = true;
      requestUserLocation();
      closePromptDialog(dialog);
    });

    declineBtn.addEventListener('click', () => {
      closePromptDialog(dialog);
    });

    // Cerrar al hacer clic fuera del diálogo
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closePromptDialog(dialog);
      }
    });
  }

  /**
   * Cierra el diálogo de solicitud de ubicación
   */
  function closePromptDialog(dialog) {
    dialog.classList.remove('show');
    setTimeout(() => {
      document.body.removeChild(dialog);
    }, 300);
  }

  function requestUserLocation() {
    if (!navigator.geolocation) {
      showNotification('Tu navegador no soporta geolocalización', true);
      return;
    }

    elements.locationStatus.innerHTML = '<span style="color: #2196F3;">Obteniendo ubicación...</span>';

    // Watch position para actualizaciones en tiempo real
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        userPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        };

        updateUserLocationMarker(userPosition);
        checkIfUserInRadarZone(userPosition);

        elements.locationStatus.innerHTML = '<span style="color: #4CAF50;">✓ Activo</span>';
      },
      (error) => {
        console.error('Error obteniendo ubicación:', error);
        let errorMessage = 'Error al obtener ubicación';

        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Permiso denegado';
            showNotification('Por favor, permite el acceso a tu ubicación en la configuración del navegador', true);
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Ubicación no disponible';
            showNotification('No se pudo determinar tu ubicación', true);
            break;
          case error.TIMEOUT:
            errorMessage = 'Tiempo agotado';
            showNotification('Tiempo de espera agotado al obtener ubicación', true);
            break;
        }

        elements.locationStatus.innerHTML = `<span style="color: #F44336;">⚠️ ${errorMessage}</span>`;
        elements.toggleUserLocation.checked = false;
        showUserLocation = false;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 27000
      }
    );
  }

  function stopUserLocation() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    if (userLocationMarker) {
      map.removeLayer(userLocationMarker);
      userLocationMarker = null;
    }

    if (userAccuracyCircle) {
      map.removeLayer(userAccuracyCircle);
      userAccuracyCircle = null;
    }

    userPosition = null;
    elements.locationStatus.innerHTML = '<span style="color: #666;">Inactivo</span>';
  }

  function updateUserLocationMarker(position) {
    // Crear o actualizar círculo de precisión
    if (userAccuracyCircle) {
      map.removeLayer(userAccuracyCircle);
    }

    userAccuracyCircle = L.circle([position.lat, position.lng], {
      radius: position.accuracy,
      className: 'user-accuracy-circle',
      fillColor: '#2196F3',
      fillOpacity: 0.15,
      color: '#2196F3',
      opacity: 0.5,
      weight: 2
    }).addTo(map);

    // Crear popup content
    const popupContent = `
      <div class="radar-popup">
        <h4>📍 Tu ubicación</h4>
        <p><strong>Latitud:</strong> ${position.lat.toFixed(5)}°</p>
        <p><strong>Longitud:</strong> ${position.lng.toFixed(5)}°</p>
        <p><strong>Precisión:</strong> ±${Math.round(position.accuracy)}m</p>
      </div>
    `;

    // Crear o actualizar marcador con SVG personalizado
    if (userLocationMarker) {
      userLocationMarker.setLatLng([position.lat, position.lng]);
      userLocationMarker.setPopupContent(popupContent);
    } else {
      // Icono SVG personalizado mejorado con mayor tamaño
      const markerHtml = `
        <div class="user-location-marker-wrapper">
          <div class="user-location-pulse"></div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="90" height="90">
            <defs>
              <linearGradient id="userLocationGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#2196F3;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#1565C0;stop-opacity:1" />
              </linearGradient>
              <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.5"/>
              </filter>
            </defs>
            <circle cx="12" cy="12" r="11" fill="url(#userLocationGradient)" filter="url(#shadow)"/>
            <circle cx="12" cy="12" r="8" fill="white" opacity="0.3"/>
            <circle cx="12" cy="12" r="4" fill="white"/>
            <path d="M12 2 L12 6 M12 18 L12 22 M2 12 L6 12 M18 12 L22 12"
                  stroke="white" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </div>
      `;

      userLocationMarker = L.marker([position.lat, position.lng], {
        icon: L.divIcon({
          className: 'user-location-marker',
          html: markerHtml,
          iconSize: [90, 90],
          iconAnchor: [45, 45]
        }),
        zIndexOffset: 1000
      }).addTo(map);

      userLocationMarker.bindPopup(popupContent);
    }
  }

  function checkIfUserInRadarZone(position) {
    const userLatLng = L.latLng(position.lat, position.lng);
    let isInZone = false;
    let nearestRadar = null;
    let minDistance = Infinity;

    radarConfigs.forEach(config => {
      const radarCenter = L.latLng(config.center[0], config.center[1]);
      const distance = userLatLng.distanceTo(radarCenter);
      const radiusMeters = config.radiusKm * 1000;

      if (distance <= radiusMeters) {
        isInZone = true;
        if (distance < minDistance) {
          minDistance = distance;
          nearestRadar = config;
        }
      }
    });

    if (isInZone && nearestRadar) {
      const distanceKm = (minDistance / 1000).toFixed(1);
      console.log(`Usuario en zona de cobertura de ${nearestRadar.name} (${distanceKm} km)`);

      // Centrar mapa en la ubicación del usuario si está en zona de radar
      if (showUserLocation && userPosition) {
        map.setView([position.lat, position.lng], 10, { animate: true });
      }
    } else {
      console.log('Usuario fuera de zonas de cobertura de radares');
      // Si no está en zona de radar, solo actualizar el marcador sin centrar
    }
  }

  // ============================================================================
  // EXPORTACIÓN A GIF
  // ============================================================================

  /**
   * Exporta la animación actual a un archivo GIF
   */
  async function exportAnimationToGIF() {
    if (!isAnimationActive || allTimestamps.length === 0) {
      showNotification('Debe activar la animación primero', true);
      return;
    }

    try {
      // Verificar que gif.js esté disponible
      if (typeof GIF === 'undefined') {
        showNotification('Error: Librería GIF.js no disponible. Recargue la página.', true);
        return;
      }

      // Detener la animación si está reproduciéndose
      const wasPlaying = animationInterval !== null;
      if (wasPlaying) {
        stopAnimation();
      }

      showLoader('Preparando exportación de GIF...');

      const filteredTimestamps = getFilteredTimestamps();
      const frameDelay = 500; // 500ms por frame (2 fps)

      // Configurar gif.js con el worker local
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width: 800,
        height: 600,
        workerScript: 'gif.worker.js',
        background: '#f5f7fa',
        transparent: null
      });

      // Capturar cada frame del mapa
      for (let i = 0; i < filteredTimestamps.length; i++) {
        const timestamp = filteredTimestamps[i];

        // Mostrar el frame
        currentFrame = i;
        showFrame(currentFrame);

        // Esperar a que se renderice
        await new Promise(resolve => setTimeout(resolve, 100));

        // Capturar el canvas del mapa
        try {
          const canvas = await captureMapCanvas();
          gif.addFrame(canvas, { delay: frameDelay });

          // Actualizar progreso
          elements.loaderText.textContent = `Generando GIF... Frame ${i + 1}/${filteredTimestamps.length}`;
        } catch (error) {
          console.error(`Error capturando frame ${i + 1}:`, error);
        }
      }

      // Renderizar el GIF
      gif.on('finished', function(blob) {
        hideLoader();

        // Crear URL de descarga
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Nombre del archivo con fecha
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
        a.download = `radar-animation-${dateStr}_${timeStr}.gif`;

        // Descargar
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification(`GIF descargado exitosamente (${filteredTimestamps.length} frames)`);

        // Reanudar animación si estaba reproduciéndose
        if (wasPlaying) {
          setTimeout(() => playAnimation(), 1000);
        }
      });

      gif.on('progress', function(progress) {
        const percentage = Math.round(progress * 100);
        elements.loaderText.textContent = `Renderizando GIF... ${percentage}%`;
      });

      gif.on('error', function(error) {
        hideLoader();
        console.error('Error en gif.js:', error);
        showNotification('Error al generar el GIF. Intente con menos frames.', true);
      });

      gif.render();

    } catch (error) {
      hideLoader();
      console.error('Error exportando a GIF:', error);
      showNotification('Error al generar el GIF', true);
    }
  }

  /**
   * Captura el canvas del mapa actual
   */
  async function captureMapCanvas() {
    return new Promise((resolve, reject) => {
      try {
        // Obtener el contenedor del mapa
        const mapContainer = document.getElementById('map');

        // Crear un canvas temporal
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');

        // Fondo blanco
        ctx.fillStyle = '#f5f7fa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Capturar tiles del mapa
        const tiles = mapContainer.querySelectorAll('.leaflet-tile');
        const overlays = mapContainer.querySelectorAll('.radar-image-layer img');

        // Obtener bounds del mapa para calcular posiciones
        const mapBounds = map.getBounds();
        const mapSize = map.getSize();

        // Dibujar tiles base
        tiles.forEach(tile => {
          if (tile.complete && tile.naturalHeight !== 0) {
            const rect = tile.getBoundingClientRect();
            const mapRect = mapContainer.getBoundingClientRect();

            const x = (rect.left - mapRect.left) * (canvas.width / mapRect.width);
            const y = (rect.top - mapRect.top) * (canvas.height / mapRect.height);
            const w = rect.width * (canvas.width / mapRect.width);
            const h = rect.height * (canvas.height / mapRect.height);

            try {
              ctx.drawImage(tile, x, y, w, h);
            } catch (e) {
              // Ignorar errores de CORS
            }
          }
        });

        // Dibujar overlays de radar
        overlays.forEach(overlay => {
          if (overlay.complete && overlay.naturalHeight !== 0) {
            const rect = overlay.getBoundingClientRect();
            const mapRect = mapContainer.getBoundingClientRect();

            const x = (rect.left - mapRect.left) * (canvas.width / mapRect.width);
            const y = (rect.top - mapRect.top) * (canvas.height / mapRect.height);
            const w = rect.width * (canvas.width / mapRect.width);
            const h = rect.height * (canvas.height / mapRect.height);

            const parentOpacity = overlay.style.opacity || 1;
            ctx.globalAlpha = parseFloat(parentOpacity);

            try {
              ctx.drawImage(overlay, x, y, w, h);
            } catch (e) {
              // Ignorar errores de CORS
            }

            ctx.globalAlpha = 1;
          }
        });

        // ========================================
        // MARCA DE AGUA MEJORADA
        // ========================================

        // Obtener timestamp actual
        const currentTimestamp = getFilteredTimestamps()[currentFrame];
        if (currentTimestamp) {
          const timeStr = extractLocalTime(currentTimestamp.formatted_time || currentTimestamp.datetime_local);
          const ltTimeOnly = removeSeconds(timeStr);

          // Fondo semitransparente para la marca de agua (esquina inferior izquierda)
          const watermarkHeight = 70;
          const watermarkWidth = 380;
          const padding = 15;

          // Rectángulo con gradiente
          const gradient = ctx.createLinearGradient(0, canvas.height - watermarkHeight, 0, canvas.height);
          gradient.addColorStop(0, 'rgba(30, 72, 142, 0.85)'); // Azul UTPL
          gradient.addColorStop(1, 'rgba(20, 52, 102, 0.9)');

          ctx.fillStyle = gradient;
          ctx.fillRect(10, canvas.height - watermarkHeight - 10, watermarkWidth, watermarkHeight);

          // Borde sutil
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 2;
          ctx.strokeRect(10, canvas.height - watermarkHeight - 10, watermarkWidth, watermarkHeight);

          // Texto principal: "Observatorio de Clima - UTPL"
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 18px Arial, sans-serif';
          ctx.fillText('Observatorio de Clima - UTPL', 25, canvas.height - watermarkHeight + 15);

          // Línea separadora
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(25, canvas.height - watermarkHeight + 25);
          ctx.lineTo(watermarkWidth - 15, canvas.height - watermarkHeight + 25);
          ctx.stroke();

          // Fecha y hora en LT
          ctx.font = 'bold 16px Arial, sans-serif';
          ctx.fillStyle = '#FFD700'; // Dorado para destacar
          ctx.fillText(`📅 ${ltTimeOnly} LT`, 25, canvas.height - watermarkHeight + 45);

          // Etiqueta de radares activos
          const activeRadarsList = Array.from(activeRadars).map(id =>
            id.toUpperCase()
          ).join(' + ');

          ctx.font = '12px Arial, sans-serif';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillText(`Radares: ${activeRadarsList}`, 25, canvas.height - 20);
        }

        resolve(canvas);

      } catch (error) {
        reject(error);
      }
    });
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

    // User location toggle
    if (elements.toggleUserLocation) {
      elements.toggleUserLocation.addEventListener('change', (e) => {
        showUserLocation = e.target.checked;

        if (showUserLocation) {
          requestUserLocation();
        } else {
          stopUserLocation();
        }
      });
    }

    // Animation toggle
    elements.toggleAnim.addEventListener('click', toggleAnimation);

    // Info panel toggle
    const infoPanelToggle = document.getElementById('info-panel-toggle');
    const infoPanel = document.getElementById('info-panel');
    if (infoPanelToggle && infoPanel) {
      infoPanelToggle.addEventListener('click', () => {
        infoPanel.classList.toggle('visible');
        infoPanelToggle.classList.toggle('active');
      });
    }

    // Close animation panel
    const closeAnimationBtn = document.getElementById('close-animation-btn');
    if (closeAnimationBtn) {
      closeAnimationBtn.addEventListener('click', () => {
        if (isAnimationActive) {
          toggleAnimation();
        }
      });
    }

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

        // Mostrar loader mientras carga nuevo período
        showLoader('Descargando datos para el nuevo período...');
        elements.periodSelect.disabled = true;

        // Force data reload for the new period
        const success = await downloadAnimationData();

        if (success) {
            // Precargar imágenes del nuevo período
            const filteredTimestamps = getFilteredTimestamps();
            elements.loaderText.textContent = `Precargando ${filteredTimestamps.length} imágenes...`;

            try {
              await preloadAnimationImages(filteredTimestamps);
            } catch (error) {
              console.error('Error precargando imágenes:', error);
            }

            setupAnimation();
            hideLoader();
            elements.periodSelect.disabled = false;

            if (wasPlaying) {
              setTimeout(() => {
                playAnimation();
              }, 100);
            }
        } else {
            hideLoader();
            elements.periodSelect.disabled = false;
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

          // 2. Mostrar loader
          showLoader('Actualizando datos...');

          // 3. Download new data
          const totalFramesBefore = allTimestamps.length;
          const success = await downloadAnimationData();
          
          if (success) {
              const totalFramesAfter = allTimestamps.length;
              const latestTimestamp = allTimestamps[allTimestamps.length - 1];
              const latestLT = removeSeconds(extractLocalTime(latestTimestamp.formatted_time || latestTimestamp.datetime_local));

              // 4. Precargar nuevas imágenes
              const filteredTimestamps = getFilteredTimestamps();
              elements.loaderText.textContent = `Precargando ${filteredTimestamps.length} imágenes...`;

              try {
                await preloadAnimationImages(filteredTimestamps);
              } catch (error) {
                console.error('Error precargando imágenes:', error);
              }

              // 5. Reconfigure animation with new data
              setupAnimation();

              hideLoader();

              // 6. Determine where to continue
              if (wasPlaying && totalFramesAfter > totalFramesBefore) {
                  // If it was playing and there is new data, start from frame 0 to show the complete cycle
                  goToFrame(0);
                  playAnimation();
                  showNotification(`Actualización exitosa: ${latestLT} LT`);
              } else if (wasPlaying) {
                  // If it was playing but there is no new data, simply restart playback
                  playAnimation();
                  showNotification(`Actualización completada: ${latestLT} LT`);
              } else {
                  // If it was paused, simply update the view to the last frame
                  goToFrame(totalFramesAfter - 1);
                  showNotification(`Actualización completada: ${latestLT} LT`);
              }
          } else {
              // If download fails, downloadAnimationData will have already disabled the animation
              hideLoader();
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
