// Funciones adicionales para el mapa
function addMarkersImmediately(locations) {
  // Limpiar marcadores existentes
  markersLayer.clearLayers();
  
  console.log('[Map] ⚡ EJECUTANDO addMarkersImmediately con', locations.length, 'ubicaciones');
  console.log('[Map] ⚡ Primeras 3 ubicaciones:', locations.slice(0, 3));
  
  // Coordenadas de respaldo por estado
  const stateCoordinates = {
    'Alabama': [32.318, -86.902], 'Alaska': [64.0685, -152.2782], 'Arizona': [34.2744, -111.2847], 
    'Arkansas': [35.2010, -92.4426], 'California': [36.7783, -119.4179], 'Colorado': [39.5501, -105.7821],
    'Connecticut': [41.6032, -73.0877], 'Delaware': [38.9108, -75.5277], 'Florida': [27.7663, -81.6868],
    'Georgia': [32.1656, -82.9001], 'Hawaii': [19.8968, -155.5828], 'Idaho': [44.0682, -114.7420],
    'Illinois': [40.6331, -89.3985], 'Indiana': [40.2732, -86.1349], 'Iowa': [41.8780, -93.0977],
    'Kansas': [38.5266, -96.7265], 'Kentucky': [37.8393, -84.2700], 'Louisiana': [30.9843, -91.9623],
    'Maine': [45.2538, -69.4455], 'Maryland': [39.0458, -76.6413], 'Massachusetts': [42.4072, -71.3824],
    'Michigan': [44.3467, -85.4102], 'Minnesota': [46.7296, -94.6859], 'Mississippi': [32.3547, -89.3985],
    'Missouri': [37.9643, -91.8318], 'Montana': [47.0527, -109.6333], 'Nebraska': [41.4925, -99.9018],
    'Nevada': [38.8026, -116.4194], 'New Hampshire': [43.1939, -71.5724], 'New Jersey': [40.0583, -74.4057],
    'New Mexico': [34.5199, -105.8701], 'New York': [43.2994, -74.2179], 'North Carolina': [35.7596, -79.0193],
    'North Dakota': [47.6201, -100.5407], 'Ohio': [40.4173, -82.9071], 'Oklahoma': [35.0078, -97.0929],
    'Oregon': [43.8041, -120.5542], 'Pennsylvania': [41.2033, -77.1945], 'Rhode Island': [41.5801, -71.4774],
    'South Carolina': [33.8361, -81.1637], 'South Dakota': [43.9695, -99.9018], 'Tennessee': [35.5175, -86.5804],
    'Texas': [31.9686, -99.9018], 'Utah': [39.3210, -111.0937], 'Vermont': [44.2601, -72.5806],
    'Virginia': [37.4316, -78.6569], 'Washington': [47.2529, -120.7401], 'West Virginia': [38.6409, -80.6227],
    'Wisconsin': [43.7844, -88.7879], 'Wyoming': [43.0759, -107.2903],
    'Otros/Internacional': [39.8283, -98.5795]
  };
  
  // Agrupar ubicaciones por estado
  const locationsByState = {};
  locations.forEach(location => {
    if (!locationsByState[location.state]) {
      locationsByState[location.state] = [];
    }
    locationsByState[location.state].push(location);
  });
  
  console.log('[Map] 📊 Estados detectados:', Object.keys(locationsByState));
  console.log('[Map] 📊 Distribución por estado:', Object.entries(locationsByState).map(([state, locs]) => `${state}: ${locs.length}`));
  
  let totalMarkers = 0;
  
  // Agregar TODOS los marcadores inmediatamente usando coordenadas base del estado
  Object.entries(locationsByState).forEach(([stateName, stateLocations]) => {
    const baseCoords = stateCoordinates[stateName];
    console.log(`[Map] 🎯 Procesando ${stateName}: ${stateLocations.length} ubicaciones, coordenadas:`, baseCoords);
    
    if (baseCoords) {
      stateLocations.forEach((location, index) => {
        // Distribuir marcadores alrededor del centro del estado
        const offsetRadius = 0.3; // Radio para mantener marcadores dentro del estado
        const angle = (index / stateLocations.length) * 2 * Math.PI;
        const radiusVariation = Math.random() * offsetRadius;
        
        const lat = baseCoords[0] + Math.cos(angle) * radiusVariation;
        const lng = baseCoords[1] + Math.sin(angle) * radiusVariation;
        
        const marker = L.marker([lat, lng])
          .bindPopup(`
            <div style="font-family: 'Roboto', sans-serif; max-width: 250px;">
              <h4 style="margin: 0 0 8px 0; color: #1e293b; font-size: 1rem;">
                ${location.record.nombre_cliente || location.record.name || 'Cliente'}
              </h4>
              <p style="margin: 0 0 4px 0; color: #64748b; font-size: 0.85rem;">
                <i class="fas fa-map-marker-alt" style="color: #3b82f6; margin-right: 6px;"></i>
                ${location.address}
              </p>
              <p style="margin: 0 0 4px 0; color: #64748b; font-size: 0.85rem;">
                <i class="fas fa-phone" style="color: #10b981; margin-right: 6px;"></i>
                ${location.record.telefono || location.record.phone || 'N/A'}
              </p>
              <p style="margin: 0; color: #64748b; font-size: 0.8rem;">
                <i class="fas fa-map" style="color: #f59e0b; margin-right: 6px;"></i>
                ${location.city ? location.city + ', ' : ''}${location.state}
              </p>
            </div>
          `);
        
        markersLayer.addLayer(marker);
        totalMarkers++;
      });
    } else {
      // Si no hay coordenadas para este estado, usar coordenadas por defecto (centro de EE.UU.)
      console.log(`[Map] ⚠️ No hay coordenadas para ${stateName}, usando coordenadas por defecto`);
      const defaultCoords = [39.8283, -98.5795]; // Centro de EE.UU.
      
      stateLocations.forEach((location, index) => {
        const offsetRadius = 2.0; // Radio más grande para estados desconocidos
        const angle = (index / stateLocations.length) * 2 * Math.PI;
        const radiusVariation = Math.random() * offsetRadius;
        
        const lat = defaultCoords[0] + Math.cos(angle) * radiusVariation;
        const lng = defaultCoords[1] + Math.sin(angle) * radiusVariation;
        
        const marker = L.marker([lat, lng])
          .bindPopup(`
            <div style="font-family: 'Roboto', sans-serif; max-width: 250px;">
              <h4 style="margin: 0 0 8px 0; color: #1e293b; font-size: 1rem;">
                ${location.record.nombre_cliente || location.record.name || 'Cliente'}
              </h4>
              <p style="margin: 0 0 4px 0; color: #64748b; font-size: 0.85rem;">
                <i class="fas fa-map-marker-alt" style="color: #3b82f6; margin-right: 6px;"></i>
                ${location.address}
              </p>
              <p style="margin: 0 0 4px 0; color: #64748b; font-size: 0.85rem;">
                <i class="fas fa-phone" style="color: #10b981; margin-right: 6px;"></i>
                ${location.record.telefono || location.record.phone || 'N/A'}
              </p>
              <p style="margin: 0; color: #64748b; font-size: 0.8rem;">
                <i class="fas fa-map" style="color: #f59e0b; margin-right: 6px;"></i>
                ${location.city ? location.city + ', ' : ''}${location.state}
              </p>
            </div>
          `);
        
        markersLayer.addLayer(marker);
        totalMarkers++;
      });
    }
  });
  
  console.log(`[Map] ✅ ${totalMarkers} marcadores mostrados inmediatamente en ${Object.keys(locationsByState).length} estados`);
  console.log(`[Map] ✅ Total de ubicaciones procesadas: ${locations.length}, Total de marcadores creados: ${totalMarkers}`);
}

async function geocodifyInBackground(locations) {
  console.log('[Map] 🔍 Iniciando geocodificación en segundo plano para', locations.length, 'ubicaciones...');
  
  let geocodedCount = 0;
  let errorCount = 0;
  
  // Procesar solo direcciones que no están en cache
  const uncachedLocations = locations.filter(location => !geocodeCache.has(location.address));
  console.log('[Map] 📍 Direcciones por geocodificar:', uncachedLocations.length);
  
  if (uncachedLocations.length === 0) {
    console.log('[Map] ✅ Todas las direcciones ya están en cache');
    return;
  }
  
  // Procesar en lotes muy pequeños para evitar rate limiting
  const batchSize = 2;
  const delay = 2000; // 2 segundos entre lotes
  
  for (let i = 0; i < uncachedLocations.length; i += batchSize) {
    const batch = uncachedLocations.slice(i, i + batchSize);
    
    for (const location of batch) {
      try {
        const coordinates = await geocodeAddressWithRetry(location.address);
        if (coordinates) {
          geocodeCache.set(location.address, coordinates);
          geocodedCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        console.warn('[Map] Error geocodificando:', location.address, error);
        errorCount++;
      }
      
      // Pausa entre direcciones individuales
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Mostrar progreso cada 10 direcciones
    if ((i + batchSize) % 10 === 0 || i + batchSize >= uncachedLocations.length) {
      const progress = Math.min(i + batchSize, uncachedLocations.length);
      console.log(`[Map] 🔍 Progreso geocodificación: ${progress}/${uncachedLocations.length} (${Math.round(progress/uncachedLocations.length*100)}%)`);
    }
    
    // Pausa entre lotes
    if (i + batchSize < uncachedLocations.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Guardar cache actualizado
  saveGeocodeCache();
  
  console.log('[Map] ✅ Geocodificación en segundo plano completada:');
  console.log(`[Map] - Geocodificadas exitosamente: ${geocodedCount}`);
  console.log(`[Map] - Errores: ${errorCount}`);
  console.log(`[Map] - Cache total: ${geocodeCache.size} direcciones`);
}
