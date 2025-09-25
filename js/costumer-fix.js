// Fix rápido para página Costumer
console.log('[COSTUMER-FIX] Cargando fix...');

// Función simple que funciona
async function cargarDatosCostumer() {
  try {
    console.log('[COSTUMER-FIX] Iniciando carga...');
    
    const response = await fetch('/api/leads', {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      console.error('[COSTUMER-FIX] Error HTTP:', response.status);
      return;
    }
    
    const leads = await response.json();
    console.log('[COSTUMER-FIX] ✅ Recibidos', leads.length, 'leads');
    
    // Llenar la tabla directamente
    const tbody = document.querySelector('#costumer-tbody');
    if (tbody && Array.isArray(leads)) {
      tbody.innerHTML = '';
      
      leads.slice(0, 50).forEach(lead => { // Mostrar solo los primeros 50 para evitar lag
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${lead.nombre || lead.NOMBRE || lead.name || ''}</td>
          <td>${lead.telefono || lead.TELEFONO || lead.phone || ''}</td>
          <td>${lead.email || lead.EMAIL || lead.correo || ''}</td>
          <td>${lead.agente || lead.AGENTE || lead.agent || ''}</td>
          <td>${lead.estado || lead.ESTADO || lead.status || ''}</td>
          <td>${lead.fecha || lead.FECHA || lead.date || ''}</td>
          <td>${lead.producto || lead.PRODUCTO || lead.service || ''}</td>
          <td>${lead.direccion || lead.DIRECCION || lead.address || ''}</td>
        `;
        tbody.appendChild(row);
      });
      
      console.log('[COSTUMER-FIX] ✅ Tabla actualizada con', Math.min(50, leads.length), 'filas');
    }
    
  } catch (error) {
    console.error('[COSTUMER-FIX] ❌ Error:', error);
  }
}

// Ejecutar cuando la página esté lista
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(cargarDatosCostumer, 2000);
  });
} else {
  setTimeout(cargarDatosCostumer, 2000);
}

// También hacer disponible globalmente
window.fetchLeadsAgente = cargarDatosCostumer;
window.cargarDatosCostumer = cargarDatosCostumer;
