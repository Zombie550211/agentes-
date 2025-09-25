document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const initPage = parseInt(urlParams.get('page') || '1', 10);
  const initLimit = parseInt(urlParams.get('limit') || '40', 10);
  cargarDatosDesdeServidor(initPage, initLimit);

  const form = document.getElementById("lead-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Obtener datos del formulario Lead
      const formData = new FormData(form);
      // Mapeo explícito de campos según el formulario y la tabla Costumer
      const lead = {
        nombre_cliente: formData.get('nombre_cliente') || '',
        telefono_principal: formData.get('telefono_principal') || '',
        telefono_alterno: formData.get('telefono_alterno') || '',
        numero_cuenta: formData.get('numero_cuenta') || '',
        autopago: formData.get('autopago') || '',
        direccion: formData.get('direccion') || '',
        tipo_servicios: formData.get('tipo_servicios') || '',
        sistema: formData.get('sistema') || '',
        riesgo: formData.get('riesgo') || '',
        dia_venta: formData.get('dia_venta') || '',
        dia_instalacion: formData.get('dia_instalacion') || '',
        status: formData.get('status') || '',
        servicios: formData.get('servicios') || '',
        mercado: formData.get('mercado') || '',
        supervisor: formData.get('supervisor') || '',
        comentario: formData.get('comentario') || '',
        motivo_llamada: formData.get('motivo_llamada') || '',
        zip_code: formData.get('zip_code') || ''
      };

      // Asignar automáticamente el TEAM según SUPERVISOR
      const supervisor = lead.supervisor ? lead.supervisor.trim().toUpperCase() : '';
      let team = '';
      switch (supervisor) {
        case 'PLEITEZ': team = 'Team Pleitez'; break;
        case 'ROBERTO': team = 'Team Roberto'; break;
        case 'IRANIA': team = 'Team Irania'; break;
        case 'MARISOL': team = 'Team Marisol'; break;
        case 'RANDAL': team = 'Team Randal'; break;
        case 'JONATHAN': team = 'Team Lineas'; break;
        default: team = '';
      }

// --- Paginación ligera para Costumer ---
function renderPaginationControls() {
  const { total = 0, page = 1, limit = 40 } = window.pagination || {};
  const totalPages = Math.max(Math.ceil(total / Math.max(limit, 1)), 1);

  let container = document.getElementById('costumer-pagination');
  if (!container) {
    container = document.createElement('div');
    container.id = 'costumer-pagination';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    container.style.margin = '10px 0';
    const table = document.getElementById('costumer-tbody')?.closest('table');
    if (table && table.parentElement) {
      table.parentElement.insertBefore(container, table);
    } else {
      document.body.appendChild(container);
    }
  }

  container.innerHTML = `
    <button id="pg-prev" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
    <span> Página ${page} de ${totalPages} </span>
    <button id="pg-next" ${page >= totalPages ? 'disabled' : ''}>Siguiente</button>
  `;

  const prevBtn = container.querySelector('#pg-prev');
  const nextBtn = container.querySelector('#pg-next');
  if (prevBtn) prevBtn.onclick = () => changePage(page - 1);
  if (nextBtn) nextBtn.onclick = () => changePage(page + 1);
}

function changePage(newPage) {
  const { total = 0, limit = 40 } = window.pagination || {};
  const totalPages = Math.max(Math.ceil(total / Math.max(limit, 1)), 1);
  const page = Math.min(Math.max(newPage, 1), totalPages);
  // Actualizar querystring para permitir recarga con misma página
  const url = new URL(window.location.href);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  window.history.replaceState(null, '', url.toString());
  cargarDatosDesdeServidor(page, limit);
}
      lead.team = team;

      // El campo agente se toma del usuario autenticado (window.usuario_actual)
      if (window.usuario_actual && window.usuario_actual.nombre) {
        lead.agente = window.usuario_actual.nombre;
      }

      // Validar que todos los campos requeridos del formulario estén presentes
      const camposRequeridos = [
        'nombre_cliente', 'telefono_principal', 'telefono_alterno', 'numero_cuenta',
        'autopago', 'direccion', 'tipo_servicios', 'sistema', 'riesgo',
        'dia_venta', 'dia_instalacion', 'status', 'servicios', 'mercado',
        'supervisor', 'comentario', 'motivo_llamada', 'zip_code'
      ];
      let camposFaltantes = [];
      camposRequeridos.forEach(campo => {
        if (!lead[campo] || lead[campo].toString().trim() === '') {
          camposFaltantes.push(campo.replace(/_/g, ' '));
        }
      });
      if (camposFaltantes.length > 0) {
        alert('Faltan campos obligatorios: ' + camposFaltantes.join(', '));
        return;
      }

      // Validar puntaje antes de enviar
      if (team === 'Team Lineas') {
        lead.puntaje = 'Sin Puntaje';
      } else {
        let puntaje = formData.get('puntaje');
        if (!puntaje || isNaN(puntaje)) {
          alert('El campo Puntaje es obligatorio y debe ser un número válido.');
          return;
        }
        lead.puntaje = parseFloat(puntaje);
      }

      // Enviar los datos al backend
      // Validar que haya token antes de enviar
      const token = localStorage.getItem('token');
      if (!token) {
        alert('No tienes sesión activa. Por favor, inicia sesión nuevamente.');
        return;
      }

      let response, result;
      try {
        response = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify(lead)
        });
        result = await response.json();
      } catch (err) {
        alert('Error de red al intentar guardar el lead. Intenta de nuevo.');
        return;
      }

      if (response.ok && result.ok) {
        alert("Lead guardado con éxito");
        cargarDatosDesdeServidor(); // vuelve a pintar con el nuevo lead
        form.reset();
      } else {
        // Mostrar mensaje de error del backend si existe
        let mensaje = (result && result.error) ? result.error : 'Hubo un error al guardar el lead.';
        alert(mensaje);
        if (result) console.error(result);
      }
    });
  }
});

if (typeof chartTeam === 'undefined') {
  let chartTeam, chartProducto;
}

async function cargarDatosDesdeServidor(page = 1, limit = 40) {
  try {
    console.log('[cargarDatosDesdeServidor] Iniciando carga de datos...');

    // Evitar múltiples llamadas simultáneas
    if (window.isLoadingData) {
      console.log('[cargarDatosDesdeServidor] Ya hay una carga en progreso, esperando...');
      return window.ultimaListaLeads || [];
    }

    window.isLoadingData = true;

    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    // Detectar si es usuario Team Líneas
    const userData = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
    const role = (userData.role || userData?.usuario?.role || '').toString().trim().toLowerCase();
    const username = (userData.username || userData?.usuario?.username || '').toString().trim().toLowerCase();
    const isTeamLineasUser = role === 'teamlineas' || username.startsWith('lineas-') || username.includes('lineas');

    // Construir URL según el tipo de usuario
    let url = isTeamLineasUser ? '/api/lineas' : '/api/customers?page=1&limit=200';
    let alreadyFilteredByAgent = isTeamLineasUser;

    console.log(`[cargarDatosDesdeServidor] Rol: ${role}, Username: ${username}, Team Líneas: ${isTeamLineasUser}`);
    console.log(`[cargarDatosDesdeServidor] URL: ${url}`);

    // Obtener parámetros URL
    const urlParams = new URLSearchParams(window.location.search);
    const forceAll = urlParams.get('forceAll') === '1' || urlParams.get('forceAll') === 'true';

    // Para usuarios no Team Líneas, aplicar filtro por agente si es necesario
    if (!isTeamLineasUser) {
      if (role === 'agent' && !forceAll) {
        const idCandidates = [userData._id, userData.id, userData.userId, userData.uid, userData?.usuario?._id, userData?.usuario?.id].map(v => v && String(v).trim()).filter(Boolean);
        const nameCandidates = [userData.username, userData.name, userData.nombre, userData?.usuario?.username, userData?.usuario?.name, userData?.usuario?.nombre].map(v => v && String(v).trim()).filter(Boolean);
        if (idCandidates.length) {
          const agenteId = encodeURIComponent(idCandidates[0]);
          url += `&agenteId=${agenteId}`;
          alreadyFilteredByAgent = true;
          console.log('[cargarDatosDesdeServidor] Rol=agent. Usando agenteId para URL:', idCandidates[0]);
        } else if (nameCandidates.length) {
          const agente = encodeURIComponent(nameCandidates[0]);
          url += `&agente=${agente}`;
          alreadyFilteredByAgent = true;
          console.log('[cargarDatosDesdeServidor] Rol=agent. Usando agente(nombre) para URL:', nameCandidates[0]);
        }
      }
    }

    // Agregar paginación para /api/customers
    if (!isTeamLineasUser) {
      const urlObj = new URL(url, window.location.origin);
      urlObj.searchParams.set('page', String(page));
      urlObj.searchParams.set('limit', String(limit));
      url = urlObj.pathname + '?' + urlObj.searchParams.toString();
    }

    console.log('[cargarDatosDesdeServidor] URL final:', url);
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[cargarDatosDesdeServidor] Datos recibidos:', {
      tipo: Array.isArray(data) ? 'array' : typeof data,
      len: Array.isArray(data) ? data.length : (data && Array.isArray(data.leads) ? data.leads.length : (data && Array.isArray(data.data) ? data.data.length : 0)),
      tieneStats: !!(data && data.stats),
      stats: data && data.stats ? data.stats : 'NO_STATS'
    });

    // Extraer datos según el endpoint
    let leadsRaw = [];
    if (isTeamLineasUser) {
      leadsRaw = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
      window.pagination = { total: leadsRaw.length, page: 1, limit: leadsRaw.length || 1 };
    } else {
      if (data && Array.isArray(data.data)) {
        leadsRaw = data.data;
        window.pagination = {
          total: Number(data.total || leadsRaw.length) || leadsRaw.length,
          page: Number(data.page || page) || page,
          limit: Number(data.limit || limit) || limit
        };
      } else {
        leadsRaw = Array.isArray(data) ? data : (data && Array.isArray(data.leads) ? data.leads : []);
        window.pagination = { total: leadsRaw.length, page: 1, limit: leadsRaw.length || 1 };
      }
    }

    // Normalizar los leads
    const normalizedLeads = normalizeLeadsFromScript(leadsRaw);

    // Aplicar filtros adicionales según el rol
    let filteredLeads = normalizedLeads;

    if (!alreadyFilteredByAgent && !forceAll) {
      if (role === 'agent') {
        filteredLeads = filterLeadsByAgent(normalizedLeads, userData);
      } else if (role === 'supervisor') {
        filteredLeads = filterLeadsByTeam(normalizedLeads, userData);
      }
    }

    // Guardar y renderizar
    window.ultimaListaLeads = filteredLeads;
    renderCostumerTable(filteredLeads);
    renderPaginationControls();
    
    // Usar estadísticas del servidor (totales globales)
    if (data && data.stats) {
      console.log('[cargarDatosDesdeServidor] Actualizando KPIs con stats del servidor:', data.stats);
      updateSummaryCardsFromServer(data.stats);
    } else {
      console.log('[cargarDatosDesdeServidor] NO SE RECIBIERON STATS DEL SERVIDOR');
      // Fallback temporal para mostrar algo
      updateSummaryCardsFromServer({
        ventasHoy: 0,
        ventasMes: 0, 
        pendientes: 0,
        cancelados: 0
      });
    }

    console.log('[cargarDatosDesdeServidor] Carga completada exitosamente:', filteredLeads.length, 'leads');
    return filteredLeads;

  } catch (error) {
    console.error('[cargarDatosDesdeServidor] Error:', error);
    mostrarMensajeSinDatos();
    return [];
  } finally {
    window.isLoadingData = false;
  }
}

// Función auxiliar para normalizar leads (simplificada)
function normalizeLeadsFromScript(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(lead => ({
    ...lead,
    _id: lead._id || lead.id,
    nombre_cliente: lead.nombre_cliente || lead.NOMBRE || lead.cliente || lead.nombre || 'N/A',
    telefono_principal: lead.telefono_principal || lead.TELEFONO || lead.celular || lead.telefono || 'N/A',
    telefono_alterno: lead.telefono_alterno || lead.TELEFONO_ALTERNO || lead.telefono2 || '',
    // numero_de_cuenta en backend
    numero_cuenta: lead.numero_cuenta || lead.numero_de_cuenta || lead.CUENTA || lead.account || '',
    // autopaquete en backend
    autopago: (lead.autopago ?? lead.AUTOPAGO ?? lead.autopaquete) ?? '',
    direccion: lead.direccion || lead.DIRECCION || lead.address || '',
    // tipo_de_serv y producto en backend
    tipo_servicios: lead.tipo_servicios || lead.tipo_de_serv || lead.SERVICIO || lead.producto || '',
    sistema: lead.sistema || lead.SISTEMA || '',
    riesgo: lead.riesgo || lead.RIESGO || '',
    // fecha en backend (YYYY-MM-DD)
    dia_venta: lead.dia_venta || lead.FECHA || lead.fecha || '',
    dia_instalacion: lead.dia_instalacion || lead.FECHA_INSTALACION || '',
    // estado en backend
    status: lead.status || lead.STATUS || lead.estado || 'N/A',
    servicios: lead.servicios || lead.SERVICIOS || '',
    mercado: lead.mercado || lead.MERCADO || '',
    supervisor: lead.supervisor || lead.SUPERVISOR || '',
    comentario: lead.comentario || lead.COMENTARIO || '',
    motivo_llamada: lead.motivo_llamada || lead.MOTIVO || '',
    // zip en backend
    zip_code: lead.zip_code || lead.ZIP || lead.zip || lead.cp || '',
    puntaje: Number(lead.puntaje || lead.PUNTAJE || 0) || 0,
    comentarios_venta: lead.comentarios_venta || lead.COMENTARIOS || lead.comentarios || []
  }));
}

// Función auxiliar para filtrar por agente
function filterLeadsByAgent(leads, userData) {
  const norm = (s) => (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').trim().toLowerCase();
  const myIds = [userData.id, userData._id, userData.userId, userData.uid, userData?.usuario?._id, userData?.usuario?.id].map(String).filter(Boolean);
  const myNames = [userData.username, userData.name, userData.nombre, userData?.usuario?.username, userData?.usuario?.name, userData?.usuario?.nombre].map(String).filter(Boolean);

  return leads.filter(lead => {
    const leadAgentId = String(lead.agenteId || lead.agente_id || lead.idAgente || lead.agentId || '').trim();
    const leadAgentName = String(lead.agenteNombre || lead.nombreAgente || lead.agente || lead.agent || '').trim();

    return myIds.some(id => leadAgentId.includes(id)) || myNames.some(name => norm(leadAgentName).includes(norm(name)));
  });
}

// Función para manejar la ausencia de datos
function mostrarMensajeSinDatos() {
  const tableBody = document.querySelector('#costumer-tbody');
  if (tableBody) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="21" style="text-align: center; padding: 20px;">
          <p>No se encontraron datos disponibles.</p>
          <p>Por favor, verifica tu conexión o contacta al administrador.</p>
        </td>
      </tr>
    `;
  }

  // No actualizar KPIs cuando no hay datos - mantener los últimos valores del servidor
}

// Función para actualizar las tarjetas de resumen
function updateSummaryCards(leads) {
  const ventasHoyElement = document.getElementById('costumer-ventas-hoy');
  const ventasMesElement = document.getElementById('costumer-ventas-mes');
  const pendientesElement = document.getElementById('costumer-pendientes');
  const canceladosElement = document.getElementById('costumer-cancelados');

  let ventasHoy = 0;
  let ventasMes = 0;
  let pendientes = 0;
  let cancelados = 0;

  if (!leads || !Array.isArray(leads) || leads.length === 0) {
    console.log('No hay datos para mostrar en los gráficos');
  } else {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();

    leads.forEach(lead => {
      const status = (lead.status || '').toString().toLowerCase();

      if (status.includes('pendiente') || status.includes('pending')) {
        pendientes++;
      }

      if (status.includes('cancel') || status.includes('anulad')) {
        cancelados++;
      }

      const fechaVenta = lead.dia_venta || lead.FECHA || lead.fecha_venta || lead.fecha;
      if (fechaVenta) {
        const fecha = new Date(fechaVenta);
        if (fecha.getMonth() === mesActual && fecha.getFullYear() === anioActual) {
          ventasMes++;
          if (fecha.toDateString() === hoy.toDateString()) {
            ventasHoy++;
          }
        }
      }
    });
  }

  if (ventasHoyElement) ventasHoyElement.textContent = ventasHoy.toString();
  if (ventasMesElement) ventasMesElement.textContent = ventasMes.toString();
  if (pendientesElement) pendientesElement.textContent = pendientes.toString();
  if (canceladosElement) canceladosElement.textContent = cancelados.toString();
}

// Función para actualizar KPIs con estadísticas del servidor
function updateSummaryCardsFromServer(stats) {
  const ventasHoyElement = document.getElementById('costumer-ventas-hoy');
  const ventasMesElement = document.getElementById('costumer-ventas-mes');
  const pendientesElement = document.getElementById('costumer-pendientes');
  const canceladosElement = document.getElementById('costumer-cancelados');

  if (ventasHoyElement) ventasHoyElement.textContent = stats.ventasHoy.toString();
  if (ventasMesElement) ventasMesElement.textContent = stats.ventasMes.toString();
  if (pendientesElement) pendientesElement.textContent = stats.pendientes.toString();
  if (canceladosElement) canceladosElement.textContent = stats.cancelados.toString();
  
  console.log('[updateSummaryCardsFromServer] KPIs actualizados con datos del servidor:', stats);
}

// --- Paginación ligera para Costumer (global) ---
function renderPaginationControls() {
  const { total = 0, page = 1, limit = 40 } = window.pagination || {};
  const totalPages = Math.max(Math.ceil(total / Math.max(limit, 1)), 1);

  let container = document.getElementById('costumer-pagination');
  if (!container) {
    container = document.createElement('div');
    container.id = 'costumer-pagination';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    container.style.margin = '10px 0';
    const table = document.getElementById('costumer-tbody')?.closest('table');
    if (table && table.parentElement) {
      table.parentElement.insertBefore(container, table);
    } else {
      document.body.appendChild(container);
    }
  }

  container.innerHTML = `
    <button id="pg-prev" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
    <span> Página ${page} de ${totalPages} </span>
    <button id="pg-next" ${page >= totalPages ? 'disabled' : ''}>Siguiente</button>
  `;

  const prevBtn = container.querySelector('#pg-prev');
  const nextBtn = container.querySelector('#pg-next');
  if (prevBtn) prevBtn.onclick = () => changePage(page - 1);
  if (nextBtn) nextBtn.onclick = () => changePage(page + 1);
}

function changePage(newPage) {
  const { total = 0, limit = 40 } = window.pagination || {};
  const totalPages = Math.max(Math.ceil(total / Math.max(limit, 1)), 1);
  const page = Math.min(Math.max(newPage, 1), totalPages);

  const url = new URL(window.location.href);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  window.history.replaceState(null, '', url.toString());
  cargarDatosDesdeServidor(page, limit);
}

// Renderizado profesional y alineado de la tabla Costumer
function renderCostumerTable(leads) {
  console.log('RENDER COSTUMER TABLE', leads);
  window.ultimaListaLeads = leads;
  const tbody = document.getElementById('costumer-tbody');
  tbody.innerHTML = '';
  if (!leads || leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="21" style="text-align:center;padding:2em;">No hay registros para mostrar.</td></tr>`;
    return;
  }
  const rows = leads.map((lead, idx) => {
    const rowClass = idx % 2 === 0 ? 'costumer-row-striped' : '';
    return `
      <tr class="${rowClass}">
        <td class="td-ellipsis" title="${lead.nombre_cliente || ''}">${lead.nombre_cliente || ''}</td>
        <td class="td-nowrap" title="${lead.telefono_principal || ''}">${lead.telefono_principal || ''}</td>
        <td class="td-nowrap" title="${lead.telefono_alterno || 'N/A'}">${lead.telefono_alterno || 'N/A'}</td>
        <td class="td-nowrap" title="${lead.numero_cuenta || 'N/A'}">${lead.numero_cuenta || 'N/A'}</td>
        <td class="td-nowrap" title="${lead.autopago || ''}">${lead.autopago || ''}</td>
        <td class="td-ellipsis" title="${lead.direccion || ''}">${lead.direccion || ''}</td>
        <td class="td-ellipsis" title="${lead.tipo_servicios || ''}">${lead.tipo_servicios || ''}</td>
        <td class="td-ellipsis" title="${lead.sistema || ''}">${lead.sistema || ''}</td>
        <td class="td-nowrap" title="${lead.riesgo || ''}">${lead.riesgo || ''}</td>
        <td class="td-nowrap" title="${lead.dia_venta || ''}">${lead.dia_venta || ''}</td>
        <td class="td-nowrap" title="${lead.dia_instalacion || ''}">${lead.dia_instalacion || ''}</td>
        <td class="td-nowrap"><span class="badge-status badge-status-${(lead.status||'').toLowerCase()}">${lead.status || ''}</span></td>
        <td class="td-ellipsis" title="${lead.servicios || ''}">${lead.servicios || ''}</td>
        <td class="td-ellipsis" title="${lead.mercado || ''}">${lead.mercado || ''}</td>
        <td class="td-ellipsis" title="${lead.supervisor || ''}">${lead.supervisor || ''}</td>
        <td class="td-ellipsis" title="${lead.comentario || ''}">${lead.comentario || ''}</td>
        <td class="td-ellipsis" title="${lead.motivo_llamada || ''}">${lead.motivo_llamada || ''}</td>
        <td class="td-nowrap" title="${lead.zip_code || ''}">${lead.zip_code || ''}</td>
        <td class="td-nowrap" title="${lead.puntaje !== undefined ? lead.puntaje : 0}">${lead.puntaje !== undefined ? lead.puntaje : 0}</td>
        <td class="td-ellipsis">
          <button class='comentarios-btn' onclick='toggleComentariosPanel(${idx})' title='Ver o añadir comentarios'>
            <i class="fas fa-comment-dots"></i>
          </button>
        </td>
        <td class="td-nowrap">
          <button class="costumer-action-btn edit" title="Editar cliente" onclick="editarClienteModal('${lead._id || ''}')" ${!window.usuario_actual || !['admin','BO'].includes(window.usuario_actual.rol) ? 'disabled' : ''}>
            <i class="fas fa-pencil-alt"></i>
          </button>
          <button class="costumer-action-btn delete" title="Eliminar cliente" onclick="confirmarEliminarCliente('${lead._id || ''}')" ${!window.usuario_actual || !['admin','BO'].includes(window.usuario_actual.rol) ? 'disabled' : ''}>
            <i class="fas fa-trash-alt"></i>
          </button>
        </td>
      </tr>
      <tr id="comentarios-panel-${idx}" class="comentarios-panel-row" style="display:none;"><td colspan="21" style="background:#f9fafd;padding:0;">
        <div class="comentarios-panel" id="comentarios-panel-${idx}">
          <div style="font-weight:600;color:#1976d2;margin-bottom:0.5em;">Comentarios</div>
          <div>
            ${(Array.isArray(lead.comentarios_venta) && lead.comentarios_venta.length > 0)
  ? lead.comentarios_venta.map((com, cidx) => `<div class='comentario-item'>
    <div class='comentario-meta'>
      <span class='comentario-autor'>${com.autor}</span>
      <span class='comentario-fecha'>${com.fecha}</span>
      ${window.usuario_actual && (window.usuario_actual.nombre === com.autor || window.usuario_actual.rol === 'admin') ? `
        <button class='comentario-btn editar' title='Editar comentario' onclick='iniciarEdicionComentario(${idx},${cidx})'><i class="fas fa-pen"></i></button>
        <button class='comentario-btn borrar' title='Borrar comentario' onclick='confirmarBorrarComentario(${idx},${cidx})'><i class="fas fa-trash"></i></button>
      ` : ''}
    </div>
    <div class='comentario-texto' id='comentario-texto-${idx}-${cidx}'>${com.texto}</div>
    <div class='comentario-edicion' id='comentario-edicion-${idx}-${cidx}' style='display:none;'>
      <textarea id='editar-comentario-textarea-${idx}-${cidx}' maxlength='300'>${com.texto}</textarea>
      <button class='comentario-btn guardar' title='Guardar edición' onclick='guardarEdicionComentario(${idx},${cidx})'><i class="fas fa-check"></i></button>
      <button class='comentario-btn cancelar' title='Cancelar' onclick='cancelarEdicionComentario(${idx},${cidx})'><i class="fas fa-times"></i></button>
    </div>
  </div>`).join('')
  : '<div class="comentario-item" style="color:#888;">Sin comentarios previos.</div>'}
          </div>
          <form class="nuevo-comentario-form" onsubmit="event.preventDefault(); enviarNuevoComentario(${idx}, '${lead._id || ''}')">
            <textarea id="nuevo-comentario-textarea-${idx}" maxlength="300" placeholder="Escribe un nuevo comentario..."></textarea>
            <button type="submit">Añadir</button>
          </form>
        </div>
      </td></tr>
    `;
  }).join('');
  
  tbody.innerHTML = rows;
}