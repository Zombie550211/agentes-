/**
 * Inicialización de la página Costumer
 * Carga datos y renderiza la tabla
 */

(function() {
  console.log('[COSTUMER INIT] Inicializando página de clientes...');

  /**
   * Cargar datos de clientes desde el servidor
   */
  async function loadCustomers() {
    try {
      console.log('[COSTUMER] Cargando clientes desde el servidor...');
      
      // Obtener usuario actual
      const user = window.getCurrentUser ? window.getCurrentUser() : null;
      const role = user?.role?.toLowerCase() || '';
      const username = user?.username || '';
      
      console.log('[COSTUMER] Usuario:', username, 'Rol:', role);
      
      // Determinar endpoint según el rol
      let endpoint = '/api/leads?limit=10000'; // Solicitar hasta 10000 registros
      
      // Si es Team Líneas, usar endpoint específico
      if (role.includes('lineas') || username.includes('lineas')) {
        endpoint = '/api/lineas?limit=10000';
        console.log('[COSTUMER] Usuario Team Líneas detectado');
      }
      
      // Hacer la petición
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.error('[COSTUMER] Error en respuesta:', response.status);
        
        // Si falla, usar datos mock
        console.warn('[COSTUMER] Usando datos de ejemplo...');
        if (window.MockData) {
          const mockCustomers = window.MockData.getMockCustomers();
          renderCustomers(mockCustomers);
          updateStats(mockCustomers);
          return;
        }
        
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[COSTUMER] Respuesta recibida:', data);
      
      // Extraer array de leads
      let customers = [];
      if (Array.isArray(data)) {
        customers = data;
      } else if (data.data && Array.isArray(data.data)) {
        customers = data.data;
      } else if (data.leads && Array.isArray(data.leads)) {
        customers = data.leads;
      } else if (data.success && Array.isArray(data.data)) {
        customers = data.data;
      }
      
      console.log('[COSTUMER] Clientes cargados:', customers.length);
      
      // Si no hay datos, usar mock
      if (customers.length === 0 && window.MockData) {
        console.warn('[COSTUMER] No hay datos, usando mock data...');
        customers = window.MockData.getMockCustomers();
      }
      
      // Renderizar tabla
      renderCustomers(customers);
      
      // Actualizar estadísticas usando funciones del calendario
      const stats = window.CostumerCalendar.calculateExtendedStats(customers, customers);
      window.CostumerCalendar.updateStatsCards(stats);
      
      // Guardar datos globalmente para otras funciones
      window.ultimaListaLeads = customers;
      
    } catch (error) {
      console.error('[COSTUMER] Error cargando clientes:', error);
      
      // Fallback a datos mock
      if (window.MockData) {
        console.warn('[COSTUMER] Error en carga, usando datos de ejemplo...');
        const mockCustomers = window.MockData.getMockCustomers();
        renderCustomers(mockCustomers);
        updateStats(mockCustomers);
      } else {
        // Mostrar mensaje de error en la tabla
        const tbody = document.getElementById('costumer-tbody');
        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td colspan="21" style="text-align: center; padding: 40px; color: #64748b;">
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
                <p style="font-size: 18px; margin-bottom: 8px;">No se pudieron cargar los clientes</p>
                <p style="font-size: 14px;">Error: ${error.message}</p>
                <button onclick="window.location.reload()" style="margin-top: 16px; padding: 8px 16px; background: #0ea5e9; color: white; border: none; border-radius: 6px; cursor: pointer;">
                  <i class="fas fa-sync-alt"></i> Reintentar
                </button>
              </td>
            </tr>
          `;
        }
      }
    }
  }

  /**
   * Renderizar clientes en la tabla
   */
  function renderCustomers(customers) {
    console.log('[COSTUMER] Renderizando', customers.length, 'clientes');
    
    // Si existe la función de calendario, usarla
    if (window.CostumerCalendar && window.CostumerCalendar.renderTableWithMonthGroups) {
      window.CostumerCalendar.renderTableWithMonthGroups(customers);
      return;
    }
    
    // Fallback: renderizado simple
    const tbody = document.getElementById('costumer-tbody');
    if (!tbody) {
      console.error('[COSTUMER] No se encontró el tbody');
      return;
    }
    
    // Limpiar tabla
    tbody.innerHTML = '';
    
    if (customers.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="21" style="text-align: center; padding: 40px; color: #64748b;">
            <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
            <p style="font-size: 18px;">No hay clientes para mostrar</p>
          </td>
        </tr>
      `;
      return;
    }
    
    // Renderizar cada cliente
    customers.forEach(customer => {
      const row = document.createElement('tr');
      
      // Formatear datos
      const autopago = customer.autopago === true || customer.autopago === 'Sí' || customer.autopago === 'SI' ? 'Sí' : 'No';
      // Usar fecha directamente sin conversión para evitar desfase UTC
      const fechaVenta = customer.dia_venta || customer.fecha_contratacion || customer.fecha || '';
      const fechaInstalacion = customer.dia_instalacion || '';
      
      row.innerHTML = `
        <td>${customer.nombre_cliente || ''}</td>
        <td>${customer.telefono_principal || ''}</td>
        <td>${customer.telefono_alterno || ''}</td>
        <td>${customer.numero_cuenta || ''}</td>
        <td>${autopago}</td>
        <td>${customer.direccion || ''}</td>
        <td>${customer.tipo_servicios || ''}</td>
        <td>${customer.sistema || ''}</td>
        <td>${customer.riesgo || ''}</td>
        <td>${fechaVenta}</td>
        <td>${fechaInstalacion}</td>
        <td><span class="status-badge status-${(customer.status || '').toLowerCase()}">${customer.status || ''}</span></td>
        <td>${customer.servicios || ''}</td>
        <td>${customer.mercado || ''}</td>
        <td>${customer.supervisor || ''}</td>
        <td>${customer.comentario || ''}</td>
        <td>${customer.motivo_llamada || ''}</td>
        <td>${customer.zip_code || ''}</td>
        <td>${customer.puntaje || ''}</td>
        <td>
          <button class="action-btn action-btn-view" onclick="verComentarios('${customer._id || customer.id}')">
            <i class="fas fa-comment"></i>
          </button>
        </td>
        <td>
          <div class="table-actions">
            <button class="action-btn action-btn-edit" onclick="editarCliente('${customer._id || customer.id}')">
              <i class="fas fa-edit"></i>
            </button>
            <button class="action-btn action-btn-delete" onclick="eliminarCliente('${customer._id || customer.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
    
    console.log('[COSTUMER] Tabla renderizada correctamente');
  }

  /**
   * Actualizar estadísticas
   */
  function updateStats(customers) {
    // Si existe el sistema de calendario, usar estadísticas extendidas
    if (window.CostumerCalendar && window.CostumerCalendar.calculateExtendedStats) {
      // Pasar customers (del mes) y customers (todos) - al inicio son los mismos
      const stats = window.CostumerCalendar.calculateExtendedStats(customers, customers);
      if (window.CostumerCalendar.updateStatsCards) {
        window.CostumerCalendar.updateStatsCards(stats);
      }
      console.log('[COSTUMER] Estadísticas extendidas actualizadas:', stats);
      return;
    }
    
    // Fallback: usar Dashboard normal
    if (!window.Dashboard) return;
    
    const stats = window.Dashboard.calculateStats(customers);
    if (stats) {
      window.Dashboard.updateSummaryCards(stats);
      console.log('[COSTUMER] Estadísticas actualizadas:', stats);
    }
  }

  /**
   * Configurar búsqueda
   */
  function setupSearch() {
    const searchInput = document.getElementById('costumer-search');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', window.Utils ? window.Utils.debounce(function(e) {
      const query = e.target.value.toLowerCase();
      const rows = document.querySelectorAll('#costumer-tbody tr');
      
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
      });
    }, 300) : function(e) {
      const query = e.target.value.toLowerCase();
      const rows = document.querySelectorAll('#costumer-tbody tr');
      
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
      });
    });
    
    console.log('[COSTUMER] Búsqueda configurada');
  }

  /**
   * Configurar botón de refresh
   */
  function setupRefresh() {
    const refreshBtn = document.getElementById('refresh-table');
    if (!refreshBtn) return;
    
    refreshBtn.addEventListener('click', async function() {
      const icon = this.querySelector('i');
      const originalClass = icon.className;
      
      icon.className = 'fas fa-sync-alt fa-spin';
      
      await loadCustomers();
      
      icon.className = originalClass;
    });
    
    console.log('[COSTUMER] Botón de refresh configurado');
  }

  /**
   * Inicializar página
   */
  async function init() {
    console.log('[COSTUMER] Iniciando carga de página...');
    
    // Esperar a que otros scripts se carguen
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Cargar clientes
    await loadCustomers();
    
    // Configurar búsqueda
    setupSearch();
    
    // Configurar refresh
    setupRefresh();
    
    console.log('[COSTUMER] Página inicializada correctamente');
  }

  // Exponer funciones globalmente
  window.CostumerPage = {
    loadCustomers,
    renderCustomers,
    updateStats
  };

  // Inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[COSTUMER INIT] Script cargado correctamente');
})();
