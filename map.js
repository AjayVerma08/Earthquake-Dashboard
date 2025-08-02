// Initialize the map
const map = L.map('map', {
  minZoom: 1,
  maxBounds: L.latLngBounds(L.latLng(-130, -200), L.latLng(130, 200))
}).setView([26, 10], 2);

// Basemaps
const basemaps = {
  "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }),
  "Topographic": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenTopoMap'
  }),
  "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri'
  }),
  "Dark Mode": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB'
  })
};

basemaps["Dark Mode"].addTo(map);
L.control.layers(basemaps).addTo(map);

// Marker cluster group
const earthquakeCluster = L.markerClusterGroup({
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true
});
map.addLayer(earthquakeCluster);

const resetViewControl = L.control({ position: 'topleft' });

resetViewControl.onAdd = function (map) {
  const button = L.DomUtil.create('button', 'leaflet-bar reset-map-button');
  button.innerHTML = '⟳'; // Unicode symbol for "refresh" or use any text/icon
  button.title = 'Reset Map View';

  L.DomEvent.on(button, 'click', function (e) {
    L.DomEvent.stopPropagation(e);
    map.setView([26, 10], 2); // <-- Your default view
  });

  return button;
};

resetViewControl.addTo(map);

// Global variables
let currentFilters = {
  timePeriod: '15',
  customStart: null,
  customEnd: null,
  minMagnitude: 0.1,
  maxMagnitude: 10,
  maxDepth: 700
};
let SAFE_DAYS_PER_CHUNK = 20; // More conservative initial chunk size

// Create and style the global loading overlay
const loadingOverlay = document.createElement('div');
loadingOverlay.id = 'loading-overlay';
loadingOverlay.innerHTML = `
  <div class="loading-content">
    <div class="spinner-border text-primary" role="status">
      <span class="visually-hidden">Loading...</span>
    </div>
    <div class="progress mt-3" style="height: 20px; width: 300px;">
      <div id="global-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated" style="width: 0%"></div>
    </div>
    <p id="global-progress-text" class="mt-2">Preparing to load data...</p>
  </div>
`;
document.body.appendChild(loadingOverlay);

// Add CSS for the loading overlay
const style = document.createElement('style');
style.textContent = `
  #loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0,0,0,0.7);
    display: none;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    z-index: 9999;
    color: white;
  }
  .loading-content {
    text-align: center;
    background: rgba(0,0,0,0.8);
    padding: 2rem;
    border-radius: 10px;
  }
`;
document.head.appendChild(style);

// Helper functions
function getFormattedDate(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

function dateDiffInDays(start, end) {
  const diffTime = new Date(end) - new Date(start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getColor(magnitude) {
  return magnitude >= 6 ? '#d73027' :
         magnitude >= 5 ? '#fc8d59' :
         magnitude >= 4 ? '#fee08b' :
         magnitude >= 3 ? '#d9ef8b' :
         '#1a9850';
}

// Data fetching functions
async function fetchEarthquakesWithFilters() {
  let startDate, endDate;
  const today = new Date().toISOString().split('T')[0];

  if (currentFilters.timePeriod === 'custom' && currentFilters.customStart && currentFilters.customEnd) {
    startDate = currentFilters.customStart;
    endDate = currentFilters.customEnd;
  } else {
    const days = parseInt(currentFilters.timePeriod);
    startDate = getFormattedDate(days);
    endDate = today;
  }

  const daysDifference = dateDiffInDays(startDate, endDate);
  const showLoading = daysDifference > 35;
  
  if (daysDifference > 400) {
  alert("Please select a time period less than or equal to 1 year.");
  return;
  } 


  if (showLoading) {
    loadingOverlay.style.display = 'flex';
    document.getElementById('global-progress-text').textContent = 'Preparing to load earthquake data...';
  }

  try {
    if (daysDifference > 35) {
      await fetchWithChunking(startDate, endDate);
    } else {
      // Only show loading if it takes more than 500ms
      const timeout = setTimeout(() => {
        loadingOverlay.style.display = 'flex';
        document.getElementById('global-progress-text').textContent = 'Loading earthquake data...';
      }, 500);
      
      await fetchSingleRequest(startDate, endDate);
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error('Error fetching earthquakes:', error);
    document.getElementById('global-progress-text').textContent = 'Error loading data. Please try again.';
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    loadingOverlay.style.display = 'none';
  }
}

async function fetchWithChunking(startDate, endDate) {
  let allQuakes = [];
  let currentStart = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = dateDiffInDays(startDate, endDate);

  let processedDays = 0;
  let safeChunkSize = 20; // Local copy (avoid global mutation)

  try {
    while (currentStart <= end) {
      let chunkEnd = new Date(currentStart);
      chunkEnd.setDate(chunkEnd.getDate() + safeChunkSize);

      if (chunkEnd > end) chunkEnd = new Date(end); // Prevent overshoot

      const chunkStartStr = currentStart.toISOString().split('T')[0];
      const chunkEndStr = chunkEnd.toISOString().split('T')[0];

      document.getElementById('global-progress-text').textContent =
        `Loading data from ${chunkStartStr} to ${chunkEndStr}`;

      try {
        const chunkData = await fetchChunk(chunkStartStr, chunkEndStr, safeChunkSize);
        allQuakes = [...allQuakes, ...chunkData];

        processedDays += dateDiffInDays(chunkStartStr, chunkEndStr);
        const progress = Math.min(100, Math.round((processedDays / totalDays) * 100));
        document.getElementById('global-progress-bar').style.width = `${progress}%`;

        currentStart = new Date(chunkEnd);
        currentStart.setDate(currentStart.getDate() + 1);

        await new Promise(resolve => setTimeout(resolve, 500)); // Throttle between chunks
      } catch (err) {
        console.warn(`Error fetching chunk ${chunkStartStr} – ${chunkEndStr}:`, err.message);
        safeChunkSize = Math.max(3, Math.floor(safeChunkSize * 0.7)); // Reduce chunk size
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    renderEarthquakes(allQuakes);
    updateStats(allQuakes);
  } catch (error) {
    console.error('Fatal error during chunked loading:', error);
    throw error;
  }
}


async function fetchChunk(start, end, chunkSize) {
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&endtime=${end}&minmagnitude=${currentFilters.minMagnitude}&maxmagnitude=${currentFilters.maxMagnitude}&maxdepth=${currentFilters.maxDepth}`;

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limited: Too many requests');
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

  if (data.metadata?.count >= 15000) {
    throw new Error('Too many records in this chunk. Consider reducing chunk size.');
  }

  return data.features || [];
}

async function fetchSingleRequest(start, end) {
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&endtime=${end}&minmagnitude=${currentFilters.minMagnitude}&maxmagnitude=${currentFilters.maxMagnitude}&maxdepth=${currentFilters.maxDepth}`;
  
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  
  const data = await response.json();
  renderEarthquakes(data.features || []);
  updateStats(data.features || []);
}

function renderStrongestEarthquake(eq) {
  const container = document.getElementById('recent-strongest');
  if (!container || !eq) return;

  const props = eq.properties;
  const coords = eq.geometry.coordinates;

  const place = props.place || "Unknown location";
  const magnitude = props.mag || "N/A";
  const depth = coords[2] ? `${coords[2].toFixed(1)} km` : "N/A";
  const tsunami = props.tsunami === 1 ? "Yes" : "No";

  const datetime = new Date(props.time);
  const localDateTime = datetime.toLocaleString();

  container.innerHTML = `
    <div class="recent-highlight">
      <h4>Recent 🔴</h4>
      <p><strong>Location:</strong> ${place}</p>
      <p><strong>Magnitude:</strong> ${magnitude}</p>
      <p><strong>Depth:</strong> ${depth}</p>
      <p><strong>Date & Time:</strong> ${localDateTime}</p>
      <p><strong>Tsunami:</strong> ${tsunami}</p>
    </div>
  `;
}

// Rendering functions
let maxMagnitudeEq = null;
function renderEarthquakes(earthquakes) {
  earthquakeCluster.clearLayers();
  maxMagnitudeEq = null;

  if (!earthquakes || earthquakes.length === 0) {
    console.log('No earthquakes to render');
    return;
  }

  earthquakes.forEach(quake => {
    const [lng, lat, depth] = quake.geometry.coordinates;
    const { mag, place, time } = quake.properties;

    if (!maxMagnitudeEq || mag > maxMagnitudeEq.properties.mag) {
      maxMagnitudeEq = quake;
    }

    const marker = L.circleMarker([lat, lng], {
      radius: Math.min(5 + mag, 10),
      fillColor: getColor(mag),
      color: "#000",
      weight: Math.min(mag / 2, 3),
      fillOpacity: 0.8
    });

    marker.bindPopup(`
      <strong>${place}</strong><br>
      Magnitude: ${mag}<br>
      Depth: ${depth} km<br>
      Time: ${new Date(time).toLocaleString()}
    `);

    earthquakeCluster.addLayer(marker);
  });
}

// Filter functions
function initFilters() {
  document.getElementById('time-period').addEventListener('change', function() {
    currentFilters.timePeriod = this.value;
    if (this.value === 'custom') {
      document.getElementById('custom-date-range').style.display = 'block';
    } else {
      document.getElementById('custom-date-range').style.display = 'none';
      fetchEarthquakesWithFilters();
    }
  });

  document.getElementById('apply-custom-date').addEventListener('click', function() {
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    
    if (!startDate || !endDate) {
      alert('Please select both start and end dates');
      return;
    }
    
    currentFilters.customStart = startDate;
    currentFilters.customEnd = endDate;
    fetchEarthquakesWithFilters();
  });

  document.getElementById('mag-range').addEventListener('input', function() {
    currentFilters.minMagnitude = parseFloat(this.value);
    document.getElementById('mag-value').textContent = currentFilters.minMagnitude === 0.1 ? 'All' : `${currentFilters.minMagnitude}+`;
    fetchEarthquakesWithFilters();
  });

  document.getElementById('max-mag-range').addEventListener('input', function() {
    currentFilters.maxMagnitude = parseFloat(this.value);
    document.getElementById('max-mag-value').textContent = currentFilters.maxMagnitude === 10 ? 'All' : `${currentFilters.maxMagnitude}↓`;  
    fetchEarthquakesWithFilters();
  });

  document.getElementById('depth-range').addEventListener('input', function() {
    currentFilters.maxDepth = parseInt(this.value);
    document.getElementById('depth-display').textContent = 
      currentFilters.maxDepth === 700 ? 'All' : `0-${currentFilters.maxDepth} km`;
    fetchEarthquakesWithFilters();
  });

  document.getElementById('reset-filters').addEventListener('click', resetFilters);
}

function resetFilters() {
  currentFilters = {
    timePeriod: '15',
    customStart: null,
    customEnd: null,
    minMagnitude: 0.1,
    maxMagnitude: 10,
    maxDepth: 700
  };

  document.getElementById('time-period').value = '15';
  document.getElementById('custom-date-range').style.display = 'none';
  document.getElementById('start-date').value = '';
  document.getElementById('end-date').value = '';

  document.getElementById('mag-range').value = '0.1';
  document.getElementById('max-mag-range').value = '10';

  document.getElementById('mag-value').textContent = 'All';
  document.getElementById('max-mag-value').textContent = 'All';

  document.getElementById('depth-range').value = '700';
  document.getElementById('depth-display').textContent = 'All';

  fetchEarthquakesWithFilters();
}


// Stats function
function updateStats(earthquakes) {
  const statsElement = document.querySelector('.stats');
  if (!statsElement) return;

  if (!earthquakes || earthquakes.length === 0) {
    statsElement.innerHTML = '<p>No earthquake data available for current filters</p>';
    return;
  }

  const count = earthquakes.length;
  const maxMag = Math.max(...earthquakes.map(q => q.properties.mag));
  const minDepth = Math.min(...earthquakes.map(q => q.geometry.coordinates[2]));
  const maxDepth = Math.max(...earthquakes.map(q => q.geometry.coordinates[2]));

  statsElement.innerHTML = `
    <div id="recent-strongest"></div>
    <p style="margin: 2px 0px 2px 0px; font-weight: bold;">Total Earthquakes: ${count}</p>
    <p style="margin: 2px 0px 2px 0px; font-weight: bold;">Maximum Magnitude: ${maxMag.toFixed(1)}</p>
    <p style="margin: 2px 0px 2px 0px; font-weight: bold;">Depth Range: ${minDepth.toFixed(1)}km - ${maxDepth.toFixed(1)}km</p>
    <div class="mag-legend-container">
      <label class="mag-title">Magnitude Scale</label>
      <div class="mag-gradient-bar"></div>
      <div class="mag-scale">
        <span> < 3 </span>
        <span>3</span>
        <span>4</span>
        <span>5</span>
        <span>6+</span>
      </div>
    </div>
  `;

  if (maxMagnitudeEq) {
    renderStrongestEarthquake(maxMagnitudeEq);
  }
}


// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  // Set default dates for custom range
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
  document.addEventListener('click', function (e) {
  const popup = document.getElementById('custom-date-range');
  const timeSelect = document.getElementById('time-period');

  if (!popup.contains(e.target) && e.target !== timeSelect) {
    popup.style.display = 'none';
    }
  });

  document.getElementById('start-date').value = thirtyDaysAgoStr;
  document.getElementById('end-date').value = today;

  initFilters();
  
  // Load initial data without showing loading for default filters
  (async function loadInitialData() {
    try {
      await fetchSingleRequest(
        getFormattedDate(parseInt(currentFilters.timePeriod)),
        today
      );
    } catch (error) {
      console.error('Initial data load failed:', error);
    }
  })();
  
  map.on('zoomend', function() {
    const currentZoom = map.getZoom();
    earthquakeCluster.eachLayer(layer => {
      layer.setStyle({
        radius: currentZoom > 5 ? 8 : 6,
        fillOpacity: currentZoom > 5 ? 0.9 : 0.7
      });
    });
  });

  const searchInput = document.getElementById('search-input');
  const searchButton = document.getElementById('search-button');
  const suggestionsList = document.getElementById('search-suggestions');

  let selectedPlace = null;

  // 1. Fetch suggestions on input
  searchInput.addEventListener('input', async () => {
    const query = searchInput.value.trim();
    if (query.length < 3) {
      suggestionsList.innerHTML = '';
      return;
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`;
    
    const res = await fetch(url);
    const data = await res.json();

    suggestionsList.innerHTML = '';
    selectedPlace = null;

    if (data.length > 0) {
      suggestionsList.style.display = 'block';
      data.forEach((place) => {
        const li = document.createElement('li');
        suggestionsList.appendChild(li);
      });
    } else {
      suggestionsList.style.display = 'none';
    }
    
    data.forEach((place, index) => {
      const li = document.createElement('li');
      li.textContent = place.display_name;
      li.dataset.lat = place.lat;
      li.dataset.lon = place.lon;

      li.addEventListener('click', () => {
        searchInput.value = place.display_name;
        selectedPlace = place;
        suggestionsList.innerHTML = '';
        suggestionsList.style.display = 'none';
      });

      suggestionsList.appendChild(li);
    });
  });

  // 2. On Search Button click
  searchButton.addEventListener('click', async () => {
  if (selectedPlace) {
    const lat = parseFloat(selectedPlace.lat);
    const lon = parseFloat(selectedPlace.lon);
    map.setView([lat, lon], 8);
  } else {
    // If no suggestion was selected, fetch the first match
    const query = searchInput.value.trim();
    if (!query) return;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      map.setView([lat, lon], 8);
    } else {
      alert('Location not found.');
      }
    }
  });

  document.addEventListener('click', (e) => {
  if (!e.target.closest('.search_form')) {
    suggestionsList.innerHTML = '';
    suggestionsList.style.display = 'none';
    suggestionsList.style.height = '0%';
    }
  });


});