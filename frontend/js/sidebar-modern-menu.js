/**
 * Generador de menú moderno con bloques separados
 */

function getModernMenuBlocks(normalizedRole, normalizedActive, ctx = {}) {
  const isLineas = ctx.isLineas || false;
  
  // Items de Servicios Residenciales
  const residencialItems = [
    { key: 'inicio', icon: 'fa-home', text: 'Inicio', href: '/inicio.html' },
    { key: 'lead', icon: 'fa-user-plus', text: 'Nuevo Lead', href: '/lead.html' },
    { key: 'costumer', icon: 'fa-users', text: 'Lista de Clientes', href: '/Costumer.html', hasSubmenu: true },
    { key: 'estadisticas', icon: 'fa-chart-bar', text: 'Estadísticas', href: '/Estadisticas.html' },
    { key: 'rankings', icon: 'fa-chart-line', text: 'Ranking', href: '/Rankings.html' },
    { key: 'ranking', icon: 'fa-trophy', text: 'Ranking y Promociones', href: '/Ranking y Promociones.html' },
    { key: 'facturacion', icon: 'fa-file-invoice-dollar', text: 'Facturación', href: '/facturacion.html' },
    { key: 'comisiones', icon: 'fa-coins', text: 'Comisiones', href: '/Comisiones.html' },
    { key: 'semaforo', icon: 'fa-traffic-light', text: 'El Semáforo', href: '/El semaforo.html' },
    { key: 'llamadas-team', icon: 'fa-phone', text: 'Llamadas y Ventas por Team', href: '/llamadas y ventas por team.html', adminOnly: true },
    { key: 'empleado', icon: 'fa-star', text: 'Empleado del Mes', href: '/empleado-del-mes.html' },
    { key: 'tabla-puntaje', icon: 'fa-list', text: 'Tabla de Puntaje', href: '/Tabla de puntaje.html' }
  ];

  // Items de Servicios Móviles (Team Líneas)
  const movilesItems = [
    { key: 'costumer-lineas', icon: 'fa-users', text: 'Costumer Líneas', href: '/TEAM LINEAS/COSTUMER-LINEAS.html' },
    { key: 'estadisticas-lineas', icon: 'fa-chart-bar', text: 'Estadísticas Líneas', href: '/TEAM LINEAS/ESTADISTICAS-LINEAS.html' },
    { key: 'ranking-lineas', icon: 'fa-chart-line', text: 'Ranking Líneas', href: '/TEAM LINEAS/RANKING-LINEAS.html' },
    { key: 'comisiones-lineas', icon: 'fa-coins', text: 'Comisiones Líneas', href: '/TEAM LINEAS/COMISIONES-LINEAS.html' },
    { key: 'facturacion-lineas', icon: 'fa-file-invoice-dollar', text: 'Facturación Líneas', href: '/TEAM LINEAS/FACTURACION-LINEAS.html' },
    { key: 'llamadas-lineas', icon: 'fa-phone', text: 'Llamadas y Ventas Líneas', href: '/TEAM LINEAS/LLAMADAS-LINEAS.html' }
  ];

  // Teams para el submenu
  const teams = [
    { name: 'Oficina', href: '/Costumer.html?team=oficina' },
    { name: 'Team Irania', href: '/Costumer.html?team=irania' },
    { name: 'Team Johana', href: '/Costumer.html?team=johana' },
    { name: 'Team Marisol', href: '/Costumer.html?team=marisol' },
    { name: 'Team Pleitez', href: '/Costumer.html?team=pleitez' },
    { name: 'Team Roberto', href: '/Costumer.html?team=roberto' }
  ];

  const isAdmin = normalizedRole === 'admin' || normalizedRole === 'backoffice';
  
  let html = '';

  // Bloque de Servicios Residenciales
  html += `
    <div class="nav-block res">
      <div class="block-header">
        <div class="block-indicator"></div>
        <span class="block-label">Servicios Residenciales</span>
      </div>
  `;

  residencialItems.forEach(item => {
    if (item.adminOnly && !isAdmin) return;
    
    const isActive = item.key === normalizedActive ? 'active-res' : '';
    
    if (item.hasSubmenu) {
      html += `
        <div class="nav-item has-submenu ${isActive}" id="clientes-toggle" onclick="window.toggleClientesSubmenu && window.toggleClientesSubmenu()">
          <i class="fas ${item.icon} item-icon"></i>
          <span class="item-label">${item.text}</span>
          <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="submenu" id="clientes-submenu">
          ${teams.map(team => `
            <a href="${team.href}" class="submenu-item" onclick="event.stopPropagation()">
              <div class="team-dot"></div>
              <span>${team.name}</span>
            </a>
          `).join('')}
        </div>
      `;
    } else {
      html += `
        <a href="${item.href}" class="nav-item ${isActive}">
          <i class="fas ${item.icon} item-icon"></i>
          <span class="item-label">${item.text}</span>
        </a>
      `;
    }
  });

  html += `</div>`;

  // Divider
  html += `<div class="block-divider"></div>`;

  // Bloque de Servicios Móviles
  html += `
    <div class="nav-block mov">
      <div class="block-header">
        <div class="block-indicator"></div>
        <span class="block-label">Servicios Móviles</span>
      </div>
  `;

  movilesItems.forEach(item => {
    const isActive = item.key === normalizedActive ? 'active-res' : '';
    html += `
      <a href="${item.href}" class="nav-item mov-item ${isActive}">
        <i class="fas ${item.icon} item-icon"></i>
        <span class="item-label">${item.text}</span>
      </a>
    `;
  });

  html += `</div>`;

  return html;
}

// Función para toggle del submenu de clientes
window.toggleClientesSubmenu = function() {
  const toggle = document.getElementById('clientes-toggle');
  const submenu = document.getElementById('clientes-submenu');
  if (!toggle || !submenu) return;
  
  const isOpen = submenu.classList.contains('open');
  submenu.classList.toggle('open', !isOpen);
  toggle.classList.toggle('open', !isOpen);
};

// Exportar para uso en sidebar-loader.js
if (typeof window !== 'undefined') {
  window.getModernMenuBlocks = getModernMenuBlocks;
}
