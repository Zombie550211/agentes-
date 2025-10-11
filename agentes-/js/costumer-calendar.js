/**
 * Sistema de calendario y estadísticas mejoradas para Costumer
 */

(function() {
  console.log('[COSTUMER CALENDAR] Inicializando...');

  /**
   * Crear header con calendario
   */
  function createCalendarHeader() {
    const now = new Date();
    const monthNames = [
      'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
      'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
    ];
    
    const currentMonth = monthNames[now.getMonth()];
    const currentYear = now.getFullYear();
    
    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML = `
      <div>
        <h1 class="calendar-title">${currentMonth} ${currentYear}</h1>
        <p class="calendar-subtitle">Mes actual · En progreso</p>
      </div>
      <div class="calendar-nav">
        <button onclick="navigateMonth(-1)">
          <i class="fas fa-chevron-left"></i> Anterior
        </button>
        <button onclick="navigateMonth(1)">
          Siguiente <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    `;
    
    return header;
  }

// Verificar si el usuario puede editar el status
function canEditStatus() {
  try {
    const user = window.getCurrentUser ? window.getCurrentUser() : null;
    const role = (user?.role || '').toLowerCase();
    return (
      role.includes('admin') ||
      role.includes('supervisor') ||
      role.includes('backoffice') ||
      role === 'bo'
    );
  } catch (e) {
    return false;
  }
}

// Renderizar celda de status (select para roles permitidos, badge para el resto)
function renderStatusCell(customer) {
  const statusRaw = (customer.status || '').trim();
  if (!canEditStatus()) {
    return `<td><span class="status-badge status-${statusRaw.toLowerCase()}">${statusRaw}</span></td>`;
  }

  // Opciones oficiales
  const options = ['Pending', 'Rescheduled', 'HOLD', 'Cancelled', 'Pending Chargeback'];
  // Normalización para seleccionar correctamente aunque el dato venga en otro casing/idioma
  const normalize = (s) => (s || '').toString().trim().toLowerCase()
    .replace('pendiente', 'pending')
    .replace('cancelado', 'cancelled');
  const currentNorm = normalize(statusRaw);

  const selectId = `status-select-${customer._id || customer.id}`;
  const clsByStatus = `status-select status-${currentNorm.replace(/\s+/g, '-')}`;
  const optsHtml = options
    .map(op => {
      const isSelected = normalize(op) === currentNorm;
      return `<option value="${op}" ${isSelected ? 'selected' : ''}>${op}</option>`;
    })
    .join('');
  return `
    <td>
      <select id="${selectId}" class="${clsByStatus}" onchange="window.CostumerCalendar.onStatusChange('${customer._id || customer.id}', this.value)">
        ${optsHtml}
      </select>
    </td>
  `;
}

// Handler para actualizar el status en backend y refrescar KPIs/local
async function onStatusChange(id, newStatus) {
  try {
    const res = await fetch(`/api/leads/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'No se pudo actualizar el status');

    // Actualizar dataset local
    if (Array.isArray(window.ultimaListaLeads)) {
      const idx = window.ultimaListaLeads.findIndex(c => (c._id || c.id) === id);
      if (idx >= 0) window.ultimaListaLeads[idx].status = newStatus;
    }

    // Refrescar KPIs para reflejar conteos
    const all = window.ultimaListaLeads || [];
    const stats = calculateExtendedStats(all, all);
    updateStatsCards(stats);

    console.log('[STATUS] Actualizado correctamente', { id, newStatus });
  } catch (e) {
    console.error('[STATUS] Error al actualizar', e);
    alert('No se pudo actualizar el status: ' + e.message);
  }
}

  /**
   * Crear grid de 6 tarjetas de estadísticas
   */
  function createStatsGrid(stats) {
    const grid = document.createElement('div');
    grid.className = 'stats-grid-6';
    
    const cards = [
      {
        id: 'ventas-hoy',
        title: 'VENTAS HOY',
        value: stats.ventasHoy || 0,
        subtitle: 'Actualizado ahora',
        icon: 'fa-shopping-cart',
        class: 'ventas-hoy'
      },
      {
        id: 'ventas-mes',
        title: 'VENTAS DEL MES',
        value: stats.ventasMes || 0,
        subtitle: 'Mes actual',
        icon: 'fa-chart-line',
        class: 'ventas-mes'
      },
      {
        id: 'ventas-totales',
        title: 'VENTAS TOTALES',
        value: stats.ventasTotales || 0,
        subtitle: 'Total acumulado',
        icon: 'fa-chart-bar',
        class: 'ventas-totales'
      },
      {
        id: 'pendientes',
        title: 'PENDIENTES',
        value: stats.pendientes || 0,
        subtitle: 'Por atender',
        icon: 'fa-clock',
        class: 'pendientes'
      },
      {
        id: 'cancelados',
        title: 'CANCELADOS',
        value: stats.cancelados || 0,
        subtitle: 'Este mes',
        icon: 'fa-times-circle',
        class: 'cancelados'
      },
      {
        id: 'activos',
        title: 'ACTIVOS',
        value: stats.activos || 0,
        subtitle: 'Clientes activos',
        icon: 'fa-check-circle',
        class: 'activos'
      }
    ];
    
    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = `stat-card-large ${card.class}`;
      cardEl.innerHTML = `
        <div class="stat-card-header">
          <div class="stat-icon-large">
            <i class="fas ${card.icon}"></i>
          </div>
          <div class="stat-title">${card.title}</div>
        </div>
        <div class="stat-value-large" id="${card.id}-value">${card.value}</div>
        <div class="stat-subtitle">
          <i class="fas fa-info-circle"></i> ${card.subtitle}
        </div>
      `;
      grid.appendChild(cardEl);
    });
    
    return grid;
  }

  /**
   * Calcular estadísticas extendidas
   * @param {Array} customers - Clientes del mes visible (para ventasMes)
   * @param {Array} allCustomers - TODOS los clientes del CRM (para totales y status)
   */
  function getSaleDate(customer) {
    // SOLO usar dia_venta como campo de fecha
    const val = customer.dia_venta;
    if (!val) return null;
    
    // Parsear la fecha directamente
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1900) return d;
    
    return null;
  }

  function calculateExtendedStats(customers, allCustomers = null) {
    // Si no se pasa allCustomers, usar customers para todo
    const todosLosClientes = allCustomers || customers;

    if (!Array.isArray(customers)) return {};

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const stats = {
      ventasHoy: 0,
      ventasMes: 0,
      ventasTotales: 0,
      pendientes: 0,
      cancelados: 0,
      activos: 0
    };

    // VENTAS TOTALES: Contar TODOS los clientes del CRM
    stats.ventasTotales = todosLosClientes.length;

    // VENTAS DEL MES: Contar por prefijo de string YYYY-MM en dia_venta (sin parsear fechas)
    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    let ventasDelMes = 0;
    todosLosClientes.forEach(customer => {
      const val = (customer.dia_venta || '').trim();
      if (val.length >= 7 && val.slice(0, 7) === monthKey) ventasDelMes++;
    });
    stats.ventasMes = ventasDelMes;

    // Recorrer TODOS los clientes para: Ventas Hoy, Pendientes, Cancelados, Activos
    todosLosClientes.forEach(customer => {
      const diaVenta = customer.dia_venta;
      const status = (customer.status || '').toLowerCase().trim();

      // VENTAS HOY: Solo ventas de hoy usando dia_venta
      if (diaVenta && diaVenta.startsWith(today)) {
        stats.ventasHoy++;
      }

      // PENDIENTES: Todos con status pendiente (sin filtrar por mes)
      if (status === 'pendiente' || status === 'pending') {
        stats.pendientes++;
      }

      // CANCELADOS: Todos con status cancelado (sin filtrar por mes)
      if (status === 'cancelado' || status === 'cancelled' || status === 'canceled') {
        stats.cancelados++;
      }

      // ACTIVOS: Todos con status activo (sin filtrar por mes)
      if (status === 'activo' || status === 'active' || status === 'completado' || status === 'completed') {
        stats.activos++;
      }
    });

    console.log('[COSTUMER CALENDAR] Estadísticas calculadas:', {
      ventasHoy: stats.ventasHoy,
      ventasMes: `${stats.ventasMes} (mes actual: ${now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })} )`,
      ventasTotales: `${stats.ventasTotales} (total CRM)`,
      pendientes: stats.pendientes,
      cancelados: stats.cancelados,
      activos: stats.activos
    });

    return stats;
  }

  /**
   * Agrupar clientes por mes
   */
  function groupCustomersByMonth(customers) {
    const groups = {};
    
    customers.forEach(customer => {
      // Probar múltiples campos de fecha en orden de prioridad
      const saleDate = getSaleDate(customer);

      if (saleDate) {
        const monthKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;

        if (!groups[monthKey]) {
          const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                             'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
          const monthName = monthNames[saleDate.getMonth()];

          groups[monthKey] = {
            month: `${monthName.toUpperCase()} DE ${saleDate.getFullYear()}`,
            customers: [],
            year: saleDate.getFullYear(),
            monthNum: saleDate.getMonth()
          };
        }
        groups[monthKey].customers.push(customer);
      } else {
        // Si no tiene fecha, agrupar en "Sin fecha"
        if (!groups['no-date']) {
          groups['no-date'] = {
            month: 'SIN FECHA',
            customers: [],
            year: null,
            monthNum: -1
          };
        }
        groups['no-date'].customers.push(customer);
      }
    });
    
    console.log('[COSTUMER CALENDAR] Grupos por mes:', Object.keys(groups).map(k => `${k}: ${groups[k].customers.length}`));
    
    // Reordenar grupos por mes (ascendente)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const dateA = new Date(groups[a].year, groups[a].monthNum);
      const dateB = new Date(groups[b].year, groups[b].monthNum);
      return dateA - dateB;
    });

    return groups;
  }

  /**
   * Renderizar tabla con agrupación por mes
   */
  function renderTableWithMonthGroups(customers) {
    const tbody = document.getElementById('costumer-tbody');
    if (!tbody) return;
    
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
    
    // Agrupar por mes
    const groups = groupCustomersByMonth(customers);
    const sortedKeys = Object.keys(groups).sort().reverse();
    
    sortedKeys.forEach(key => {
      const group = groups[key];
      
      // Header del grupo
      const headerRow = document.createElement('tr');
      headerRow.className = 'month-group-header';
      headerRow.innerHTML = `
        <td colspan="21">
          <i class="fas fa-calendar-alt"></i>
          ${group.month} (${group.customers.length} registros)
        </td>
      `;
      tbody.appendChild(headerRow);
      
      // Clientes del grupo
      group.customers.forEach(customer => {
        const row = document.createElement('tr');
        
        const autopago = customer.autopago === true || customer.autopago === 'Sí' || customer.autopago === 'SI' ? 'Sí' : 'No';
        const fechaVenta = window.Utils ? window.Utils.formatDate(customer.dia_venta || customer.fecha_contratacion || customer.fecha) : (customer.dia_venta || '');
        const fechaInstalacion = window.Utils ? window.Utils.formatDate(customer.dia_instalacion) : (customer.dia_instalacion || '');
        
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
          ${renderStatusCell(customer)}
          <td>${customer.servicios || ''}</td>
          <td>${customer.mercado || ''}</td>
          <td>${customer.supervisor || ''}</td>
          <td>${customer.comentario || ''}</td>
          <td>${customer.motivo_llamada || ''}</td>
          <td>${customer.zip_code || ''}</td>
          <td>${customer.puntaje || ''}</td>
          <td class="comment-cell">
            <button class="action-btn action-btn-view" onclick="verComentarios('${customer._id || customer.id}')">
              <i class="fas fa-comment"></i>
            </button>
          </td>
          <td class="actions-cell">
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
    });
  }

  /**
   * Actualizar estadísticas en las tarjetas
   */
  function updateStatsCards(stats) {
    const elements = {
      'ventas-hoy-value': stats.ventasHoy || 0,
      'ventas-mes-value': stats.ventasMes || 0,
      'ventas-totales-value': stats.ventasTotales || 0,
      'pendientes-value': stats.pendientes || 0,
      'cancelados-value': stats.cancelados || 0,
      'activos-value': stats.activos || 0
    };
    
    Object.keys(elements).forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = elements[id];
      }
    });
  }

  /**
   * Inicializar vista de calendario
   */
  function initCalendarView() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    
    // Buscar contenedor de tarjetas existente
    const existingCards = document.querySelector('.summary-cards-container');
    
    if (existingCards) {
      // Insertar calendario antes de las tarjetas
      const calendarHeader = createCalendarHeader();
      mainContent.insertBefore(calendarHeader, existingCards);
      
      // Reemplazar tarjetas con el nuevo grid de 6
      const allCustomers = window.ultimaListaLeads || [];
      // Al inicio, crear grid vacío (se actualizará cuando lleguen los datos)
      const emptyStats = {
        ventasHoy: 0,
        ventasMes: 0,
        ventasTotales: 0,
        pendientes: 0,
        cancelados: 0,
        activos: 0
      };
      const statsGrid = createStatsGrid(emptyStats);
      existingCards.replaceWith(statsGrid);
    }
    
    console.log('[COSTUMER CALENDAR] Vista de calendario inicializada');
  }

  /**
   * Mes actual seleccionado
   */
  let currentDate = new Date();

  /**
   * Navegar entre meses
   */
  window.navigateMonth = function(direction) {
    console.log('[COSTUMER CALENDAR] Navegando:', direction > 0 ? 'siguiente' : 'anterior');
    
    // Cambiar mes
    currentDate.setMonth(currentDate.getMonth() + direction);
    
    // Actualizar header
    updateCalendarHeader();
    
    // Filtrar y mostrar solo clientes del mes seleccionado
    filterByMonth();
  };

  /**
   * Actualizar header del calendario
   */
  function updateCalendarHeader() {
    const monthNames = [
      'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
      'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
    ];
    
    const currentMonth = monthNames[currentDate.getMonth()];
    const currentYear = currentDate.getFullYear();
    
    const titleElement = document.querySelector('.calendar-title');
    if (titleElement) {
      titleElement.textContent = `${currentMonth} ${currentYear}`;
    }
    
    console.log('[COSTUMER CALENDAR] Navegando a:', currentMonth, currentYear);
  }

  /**
   * Filtrar clientes por mes actual
   */
  function filterByMonth() {
    if (!window.ultimaListaLeads) {
      console.warn('[COSTUMER CALENDAR] No hay datos para filtrar');
      return;
    }

    const allCustomers = window.ultimaListaLeads;
    const selectedMonth = currentDate.getMonth();
    const selectedYear = currentDate.getFullYear();

    // Filtrar clientes del mes seleccionado usando múltiples campos de fecha
    const filteredCustomers = allCustomers.filter(customer => {
    const saleDate = getSaleDate(customer);
    if (!saleDate) return false;
    return saleDate.getMonth() === selectedMonth && saleDate.getFullYear() === selectedYear;
  });

    console.log('[COSTUMER CALENDAR] Clientes filtrados:', filteredCustomers.length, 'de', allCustomers.length);

    // Renderizar solo los clientes del mes seleccionado
    renderTableWithMonthGroups(filteredCustomers);

    // LOS KPIs NO CAMBIAN - siempre muestran el mes actual
    // Los KPIs se mantienen igual porque siempre calculan del mes actual
    const stats = calculateExtendedStats(filteredCustomers, allCustomers);
    updateStatsCards(stats);
  };

  // Exponer funciones globalmente
  window.CostumerCalendar = {
    initCalendarView,
    calculateExtendedStats,
    updateStatsCards,
    renderTableWithMonthGroups
  };

  // Inicializar vista de calendario inmediatamente
  document.addEventListener('DOMContentLoaded', function() {
    // Inicializar la vista del calendario primero
    setTimeout(() => {
      initCalendarView();
      console.log('[COSTUMER CALENDAR] Vista inicializada, esperando datos...');
    }, 500);
  });

  console.log('[COSTUMER CALENDAR] Inicializado correctamente');
})();
