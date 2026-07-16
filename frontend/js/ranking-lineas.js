/**
 * RANKING LÍNEAS JS
 * Obtiene datos de líneas vendidas por agente y calcula ranking
 * Muestra: Líneas Totales, Wireless, Sin Wireless, Total de Ventas
 * Con opción de incluir ventas de Colchón
 */

let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();
let includeColchon = false;

// Escapa HTML para interpolar datos del servidor en innerHTML sin riesgo de XSS.
const escH = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Tokens de teams de Líneas según la página de permisos (sin hardcode).
async function getLineasTokens() {
  try {
    const r = await fetch('/api/lineas/teams', { credentials: 'include' });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.teams || []).map(t => String(t.token || '').toUpperCase()).filter(Boolean);
  } catch (_) { return []; }
}

async function loadRankingData() {
  try {
    // Teams válidos de Líneas desde permisos
    const lineasTokens = await getLineasTokens();
    // Obtener datos de líneas del endpoint
    const endpoint = `/api/leads-lineas?month=${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      console.error('Error al obtener datos:', response.status);
      return [];
    }

    const data = await response.json();
    const leads = data.data || [];

    // Procesar datos para ranking
    const agentMap = {};

    leads.forEach(lead => {
      const agentName = lead.agenteAsignado || lead._collection || lead.agente || 'Sin asignar';
      const supervisor = lead.supervisor || 'Sin supervisor';

      // Incluir solo si el supervisor del lead pertenece a un team de Líneas (permisos)
      const __supU = String(supervisor || '').toUpperCase();
      if (lineasTokens.length && !lineasTokens.some(tok => __supU.includes(tok))) {
        return;
      }

      if (!agentMap[agentName]) {
        agentMap[agentName] = {
          name: agentName,
          lineasTotal: 0,
          lineasWireless: 0,
          lineasNoWireless: 0,
          ventas: 0,
          colchonVentas: 0,
          supervisor: supervisor
        };
      }

      const cantidadLineas = lead.cantidad_lineas || 1;
      const status = (lead.status || '').toLowerCase();

      // Contar venta
      agentMap[agentName].ventas += 1;

      // Contar líneas totales
      agentMap[agentName].lineasTotal += cantidadLineas;

      // Determinar si es Wireless o Sin Wireless basado en servicios/status.
      // 'LINEA + EQUIPO' es el nombre nuevo de 'WIRELESS' (datos antiguos conservan el valor viejo).
      const servicios = lead.servicios || [];
      const _esWireless = v => {
        const t = String(v || '').toLowerCase();
        return t.includes('wireless') || t.includes('linea + equipo');
      };
      const isWireless = servicios.some(s => s && _esWireless(s)) ||
        _esWireless(status);

      if (isWireless) {
        agentMap[agentName].lineasWireless += cantidadLineas;
      } else {
        agentMap[agentName].lineasNoWireless += cantidadLineas;
      }

      // Contar ventas de colchón si está incluido
      if (includeColchon) {
        const tieneColchon = servicios.some(s =>
          s && String(s).toLowerCase().includes('colchon')
        ) || status.includes('colchon');
        if (tieneColchon) {
          agentMap[agentName].colchonVentas += 1;
        }
      }
    });

    // Convertir a array y ordenar por líneas totales
    let ranking = Object.values(agentMap);

    // Si se incluye colchón, ordenar por líneas + colchón
    if (includeColchon) {
      ranking.sort((a, b) => (b.lineasTotal + b.colchonVentas) - (a.lineasTotal + a.colchonVentas));
    } else {
      ranking.sort((a, b) => b.lineasTotal - a.lineasTotal);
    }

    return ranking;
  } catch (error) {
    console.error('Error en loadRankingData:', error);
    return [];
  }
}

function renderPodium(ranking) {
  const container = document.querySelector('.ranking-main-card');
  if (!container) return;

  const top3 = ranking.slice(0, 3);

  // Actualizar labels del podio
  if (top3[0]) {
    document.querySelector('.first-pos .astronaut-name').textContent = top3[0].name;
    const score = includeColchon ? top3[0].lineasTotal + top3[0].colchonVentas : top3[0].lineasTotal;
    document.querySelector('.first-pos .astronaut-score').textContent = score;
  }

  if (top3[1]) {
    document.querySelector('.second-pos .astronaut-name').textContent = top3[1].name;
    const score = includeColchon ? top3[1].lineasTotal + top3[1].colchonVentas : top3[1].lineasTotal;
    document.querySelector('.second-pos .astronaut-score').textContent = score;
  }

  if (top3[2]) {
    document.querySelector('.third-pos .astronaut-name').textContent = top3[2].name;
    const score = includeColchon ? top3[2].lineasTotal + top3[2].colchonVentas : top3[2].lineasTotal;
    document.querySelector('.third-pos .astronaut-score').textContent = score;
  }
}

function renderRankList(ranking) {
  const listContainer = document.getElementById('rank-list-dynamic');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  ranking.forEach((agent, idx) => {
    const item = document.createElement('div');
    item.className = 'rank-item';
    const score = includeColchon ? agent.lineasTotal + agent.colchonVentas : agent.lineasTotal;
    item.innerHTML = `
      <div class="rank-number">${idx + 1}</div>
      <div class="agent-info">
        <div class="agent-avatar">
          <i class="fas fa-user"></i>
        </div>
        <div class="agent-details">
          <h4>${escH(agent.name)}</h4>
          <p></p>
        </div>
      </div>
      <div class="agent-stats">
        <div class="sales">${score}</div>
      </div>
    `;
    listContainer.appendChild(item);
  });
}

function renderFullTable(ranking) {
  const tbody = document.querySelector('#full-rank-table tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  ranking.forEach((agent, idx) => {
    const row = document.createElement('tr');
    row.style.cssText = 'border-bottom: 1px solid #e5e7eb;';
    const lineasTotal = includeColchon ? agent.lineasTotal + agent.colchonVentas : agent.lineasTotal;
    row.innerHTML = `
      <td style="text-align:left; padding:10px;">${idx + 1}</td>
      <td style="text-align:left; padding:10px;"><strong>${escH(agent.name)}</strong></td>
      <td style="text-align:right; padding:10px;">${lineasTotal}</td>
      <td style="text-align:right; padding:10px; color:#22c55e;">${agent.lineasWireless}</td>
      <td style="text-align:right; padding:10px; color:#f97316;">${agent.lineasNoWireless}</td>
    `;
    tbody.appendChild(row);
  });
}

async function updatePeriodLabel() {
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                       'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const label = document.getElementById('rank-period-label');
  if (label) {
    label.textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;
  }
}

async function init() {
  await updatePeriodLabel();

  const ranking = await loadRankingData();

  if (ranking.length === 0) {
    console.warn('No hay datos de ranking');
    return;
  }

  renderPodium(ranking);
  renderRankList(ranking);
  renderFullTable(ranking);
}

// Event listeners para navegación de meses
document.addEventListener('DOMContentLoaded', function() {
  const btnOpenFull = document.getElementById('btn-open-full-ranking');
  const btnCloseFull = document.getElementById('btn-close-full-ranking');
  const modal = document.getElementById('fullRankingModal');
  const btnSumarColchon = document.getElementById('btn-sumar-colchon');

  if (btnOpenFull) {
    btnOpenFull.addEventListener('click', () => {
      if (modal) modal.style.display = 'flex';
    });
  }

  if (btnCloseFull) {
    btnCloseFull.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  // Botón Sumar Colchón
  if (btnSumarColchon) {
    btnSumarColchon.addEventListener('click', async () => {
      includeColchon = !includeColchon;

      // Actualizar visual del botón
      if (includeColchon) {
        btnSumarColchon.style.background = 'rgba(139,92,246,0.55)';
        btnSumarColchon.style.border = '1.5px solid rgba(139,92,246,0.85)';
      } else {
        btnSumarColchon.style.background = 'rgba(139,92,246,0.25)';
        btnSumarColchon.style.border = '1.5px solid rgba(139,92,246,0.55)';
      }

      // Recargar datos
      await init();
    });
  }

  // Cargar datos iniciales
  init();
});

