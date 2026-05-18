# ESTRUCTURA HTML - COSTUMER.HTML

## 1. HEAD (Meta, Links, Scripts iniciales)

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
  <title>CRM Agente - Costumer</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  
  <!-- CSS Externos -->
  <link rel="stylesheet" href="css/theme.css" />
  <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/costumer-table-clean.css?v=20251124">
  <link rel="stylesheet" href="css/costumer-table-actions.css">
  <link rel="stylesheet" href="css/costumer-table-comments.css">
  <link rel="stylesheet" href="css/costumer-calendar.css">
  <link rel="stylesheet" href="css/sidebar-shared.css?v=20251124f">
  
  <!-- Scripts externos básicos -->
  <script src="scripts/measure_fetch_times.js"></script>
  <script src="/js/logout-handler.js"></script>
  <script src="/js/user-info.js"></script>
  <script src="js/sidebar-loader.js"></script>
  <script src="utils/teams.js?v=20251024b"></script>
</head>
```

## 2. BODY STRUCTURE

```html
<body>
  <div class="layout">
    <!-- SIDEBAR (cargado dinámicamente) -->
    <nav class="sidebar sidebar-inicio" data-active="costumer"></nav>

    <main class="main main-content">
      <!-- TOPBAR / HEADER -->
      <div class="topbar costumer-table-header">
        <div class="tb-left">
          <div>
            <div class="tb-title">Lista de Clientes</div>
            <div class="tb-sub" id="costumer-top-sub">CRM · registros</div>
          </div>
          <div class="live"><span class="live-dot"></span> En vivo</div>
        </div>
        <div class="tb-right costumer-table-actions">
          <div class="srch">
            🔍 <input id="costumer-search" class="costumer-filter-input" type="text" placeholder="Buscar cliente, teléfono, ZIP, cuenta..." />
          </div>
          <button class="btn" id="enable-notifications-btn" title="Activar Notificaciones">🔔</button>
          <button class="btn" id="toggle-compact" title="Vista compacta">🧾 Compacto</button>
          <button class="btn" id="refresh-table" title="Refrescar">🔄 Refrescar</button>
        </div>
      </div>

      <!-- CONTENIDO PRINCIPAL -->
      <div class="content">
        <!-- KPI CARDS ROW -->
        <div class="kpi-row">
          <div class="kpi k1">
            <div class="kpi-header"><div class="kpi-icon ki1">🛒</div></div>
            <div class="kpi-val" id="costumer-ventas-hoy">0</div>
            <div class="kpi-lbl">Ventas Hoy</div>
          </div>
          <div class="kpi k2">
            <div class="kpi-header"><div class="kpi-icon ki2">📈</div></div>
            <div class="kpi-val" id="costumer-ventas-mes">0</div>
            <div class="kpi-lbl">Ventas del Mes</div>
          </div>
          <div class="kpi k3">
            <div class="kpi-header"><div class="kpi-icon ki3">⚡</div></div>
            <div class="kpi-val" id="costumer-ventas-activas">0</div>
            <div class="kpi-lbl">Ventas Activas</div>
          </div>
          <div class="kpi k4">
            <div class="kpi-header"><div class="kpi-icon ki4">⏳</div></div>
            <div class="kpi-val" id="costumer-pendientes">0</div>
            <div class="kpi-lbl">Pendientes</div>
          </div>
          <div class="kpi k5">
            <div class="kpi-header"><div class="kpi-icon ki5">🚫</div></div>
            <div class="kpi-val" id="costumer-cancelados">0</div>
            <div class="kpi-lbl">Cancelados</div>
          </div>
        </div>

        <!-- TABLE PANEL -->
        <div class="tpanel costumer-table-container compact">
          <!-- FILTER BAR -->
          <div class="fbar">
            <span class="ftitle">Registro de Clientes</span>

            <div class="chipbar" id="quickStatusChips">
              <button type="button" class="chip dot all is-active" data-status="all">Todos</button>
              <button type="button" class="chip dot pending" data-status="pending">Pending</button>
              <button type="button" class="chip dot active" data-status="completed">Active</button>
              <button type="button" class="chip dot cancelled" data-status="cancelled">Cancelled</button>
            </div>

            <!-- SELECTS / FILTERS -->
            <select id="serviceFilter" class="fsel costumer-filter-input" title="Servicio">
              <option value="">Todos los servicios</option>
              <option value="ATT">ATT (Todos)</option>
              <option value="DIRECTV">DIRECTV (Todos)</option>
              <option value="SPECTRUM">SPECTRUM (Todos)</option>
              <!-- más opciones... -->
            </select>

            <select id="monthFilter" class="fsel costumer-filter-input" title="Mes">
              <option value="" selected>Todos los meses</option>
              <option value="2025-12">Diciembre 2025</option>
              <!-- más meses... -->
            </select>

            <select id="teamFilter" class="fsel costumer-filter-input" title="Team" style="min-width: 140px;">
              <option value="">Todos los teams</option>
              <option value="Oficina" selected>Oficina</option>
            </select>

            <select id="agentFilter" class="fsel costumer-filter-input" title="Agente" style="min-width: 160px;">
              <option value="">Todos los agentes</option>
            </select>

            <select id="mercadoFilter" class="fsel costumer-filter-input" title="Mercado" style="min-width: 140px;">
              <option value="">Todos los mercados</option>
              <option value="ICON">ICON</option>
              <option value="BAMO">BAMO</option>
            </select>

            <select id="statusFilter" class="fsel costumer-filter-input" title="Status" style="min-width: 160px;">
              <option value="all">Todos</option>
              <option value="completed">Completed / Active</option>
              <option value="active_oficina">Active Oficina</option>
              <option value="pending">Pending</option>
              <option value="reserva">Ventas en reserva</option>
              <option value="cancelled">Cancelled</option>
              <option value="hold">Hold</option>
              <option value="rescheduled">Rescheduled</option>
            </select>

            <input id="dateFrom" type="date" class="fsel costumer-filter-input" style="min-width: 150px;" />
            <input id="dateTo" type="date" class="fsel costumer-filter-input" style="min-width: 150px;" />

            <button id="btnClearDates" class="btn" type="button" title="Limpiar fechas">✕ Fechas</button>
            <input id="recuentoCount" class="fsel costumer-filter-input" type="text" value="0" readonly style="width: 90px; text-align: center; font-weight: 800;" />

            <button id="scroll-left" class="btn" type="button" title="Desplazar a la izquierda">«</button>
            <button id="scroll-right" class="btn" type="button" title="Desplazar a la derecha">»</button>

            <button id="toggle-forceall" class="btn" type="button" title="Ver todos" style="display:none">👥 Ver todos</button>
            <button id="bulk-excel-btn" class="btn" type="button" title="Actualizar status desde Excel" style="display:none">📄 Excel</button>
          </div>

          <!-- TABLE SCROLLABLE -->
          <div class="tscroll">
            <table class="costumer-table">
              <thead>
                <tr>
                  <th>Nombre cliente</th>
                  <th>Teléfono principal</th>
                  <th>Teléfono alterno</th>
                  <th>Número de cuenta</th>
                  <th>Autopago</th>
                  <th>Dirección</th>
                  <th>Tipo de servicios</th>
                  <th>Sistema</th>
                  <th>Riesgo</th>
                  <th style="white-space:nowrap;">Día de venta 
                    <button id="filterDiaVenta" class="date-filter-btn" data-field="dia_venta" data-lskey="costumer_datefilter_dia_venta" title="Filtrar por Día de venta" style="border:none;background:transparent;padding:2px 6px;margin-left:6px;cursor:pointer;">▾</button>
                  </th>
                  <th style="white-space:nowrap;">Día de instalación 
                    <button id="filterDiaInstalacion" class="date-filter-btn" data-field="dia_instalacion" data-lskey="costumer_datefilter_dia_instalacion" title="Filtrar por Día de instalación" style="border:none;background:transparent;padding:2px 6px;margin-left:6px;cursor:pointer;">▾</button>
                  </th>
                  <th>Status</th>
                  <th>Servicios</th>
                  <th>Mercado</th>
                  <th>Supervisor</th>
                  <th>Comentario</th>
                  <th>Motivo llamada</th>
                  <th>ZIP CODE</th>
                  <th>Puntaje</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody id="costumer-tbody"></tbody>
            </table>
          </div>

          <div id="scrollbarMirror" class="scrollbar-mirror">
            <div id="scrollbarMirrorInner" style="width:1px;height:1px;"></div>
          </div>

          <!-- PAGINATION -->
          <div id="paginationControls" class="pag">
            <div>
              <label for="pageSizeSelect" style="font-size:.72rem;color:#6B7280;">Por página</label>
              <select id="pageSizeSelect" class="fsel">
                <option value="50">50</option>
                <option value="100" selected>100</option>
                <option value="200">200</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
                <option value="99999">Todos</option>
              </select>
            </div>
            <button id="toggleMonthsBtn" class="btn" type="button" style="min-width:140px;">Solo 2 meses</button>
            <div id="pageInfo" style="font-size:.72rem;color:#6B7280;">Página 1</div>
            <div style="display:flex; gap:6px;">
              <button id="pagePrev" class="btn" type="button" title="Página anterior">‹</button>
              <button id="pageNext" class="btn" type="button" title="Página siguiente">›</button>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- MODAL: COMENTARIOS -->
  <div id="comentariosModal" class="modal" style="display: none; ...">
    <!-- Contenido del modal de comentarios -->
  </div>

  <!-- MODAL: EDITAR LEAD -->
  <div id="editarModal-wrapper" style="display:none;...">
    <div class="modal" id="editarModal">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-avatar">✏️</div>
          <div>
            <div class="modal-title">Editar Lead <span id="modal-lead-id">#A6C9</span></div>
            <div class="modal-subtitle">Modifica los datos del cliente</div>
          </div>
        </div>
        <button class="modal-close" onclick="cerrarModal()">✕</button>
      </div>

      <div class="modal-body">
        <input type="hidden" id="edit-lead-id" />
        <input type="hidden" id="edit-id" />

        <div class="fields-grid">
          <!-- CAMPOS DEL FORMULARIO -->
          <div class="section-label col-span-3">Datos del Cliente</div>
          <div class="field">
            <label>Teléfono</label>
            <input type="tel" id="edit-telefono" placeholder="Teléfono principal" />
          </div>
          <!-- MAS CAMPOS... -->
        </div>

        <!-- SECCIÓN DE NOTAS -->
        <div class="notes-section">
          <!-- Contenido de notas -->
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-save" onclick="guardarCambiosLead()">💾 Guardar</button>
      </div>
    </div>
  </div>

  <!-- MODAL: BULK EXCEL -->
  <div id="bulkExcelModal" class="modal" aria-hidden="true">
    <!-- Contenido del modal de Excel -->
  </div>
</body>
</html>
```

---

## NOTAS IMPORTANTES SOBRE LA ESTRUCTURA:

1. **Sidebar** - Se carga dinámicamente desde `js/sidebar-loader.js`
2. **KPI Cards** - 5 tarjetas de métricas con IDs específicos para actualizar via JS
3. **Table** - 18 columnas con thead y tbody separados
4. **Filterbar** - Múltiples selects y inputs para filtrado
5. **Modals** - 3 modales (Comentarios, Editar Lead, Bulk Excel)
6. **Hidden Inputs** - `edit-lead-id` y `edit-id` para guardar el ID del lead en edición

---

## ELEMENTOS CLAVE CON IDs (para referencia al rediseñar):

### Topbar
- `costumer-search` - Input de búsqueda
- `enable-notifications-btn` - Botón notificaciones
- `toggle-compact` - Botón vista compacta  
- `refresh-table` - Botón refrescar

### KPI Cards
- `costumer-ventas-hoy`
- `costumer-ventas-mes`
- `costumer-ventas-activas`
- `costumer-pendientes`
- `costumer-cancelados`

### Filters
- `quickStatusChips` - Chips de status
- `serviceFilter` - Select servicios
- `monthFilter` - Select meses
- `teamFilter` - Select teams
- `agentFilter` - Select agentes
- `mercadoFilter` - Select mercados
- `statusFilter` - Select status
- `dateFrom` / `dateTo` - Input fechas
- `btnClearDates` - Botón limpiar fechas

### Table
- `costumer-tbody` - Body de la tabla (se rellena dinámicamente)
- `pageSizeSelect` - Select items por página
- `toggleMonthsBtn` - Botón toggle meses
- `pageInfo` - Info de página
- `pagePrev` / `pageNext` - Botones anterior/siguiente

### Edit Modal
- `editarModal-wrapper` - Wrapper del modal
- `editarModal` - El modal
- `edit-lead-id` / `edit-id` - Hidden inputs con el ID
- `modal-lead-id` - Span con el ID del lead

---

## ESTRUCTURA DE CARPETAS CSS/JS RECOMENDADA:

```
frontend/
├── Costumer.html (tu HTML limpio)
├── css/
│   ├── costumer-main.css (todos tus estilos)
│   ├── costumer-table.css (estilos tabla)
│   ├── costumer-modal.css (estilos modales)
│   └── costumer-responsive.css (media queries)
├── js/
│   ├── costumer-logic.js (lógica principal)
│   ├── costumer-table-render.js (renderizado tabla)
│   ├── costumer-modal.js (lógica modales)
│   └── costumer-filters.js (lógica filtros)
```

Ahora crea los archivos CSS y JS separados para tener un código más limpio y mantenible.
