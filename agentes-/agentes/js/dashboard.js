// --- CONFIGURACIÓN AUTOMÁTICA DE URL DEL BACKEND ---
// Ajuste: el servidor local corre en el puerto 3002 (según server.js),
// por lo que en entorno local debemos apuntar a http://localhost:3002
const API_URL =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3002"
    : "https://connecting-klf7.onrender.com"; // <-- Cambia esta URL por la tuya de Render

// --- TAB NAVIGATION ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = function(e) {
    e.preventDefault();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    document.getElementById('leadTab').style.display = (this.dataset.tab === 'leadTab') ? 'block' : 'none';
    document.getElementById('costumerTab').style.display = (this.dataset.tab === 'costumerTab') ? 'block' : 'none';
    if(this.dataset.tab === 'costumerTab') {
      cargarCostumerPanel();
    }
  }
});

// --- LEAD PANEL INICIALIZACIÓN ---
async function getAgenteInfo() {
  const resp = await fetch(`${API_URL}/api/agente/info`);
  return await resp.json();
}
getAgenteInfo().then(info => {
  document.getElementById('nombreAgente').textContent = info.nombre || '';
  document.getElementById('agente').value = info.nombreCompleto || '';
  document.getElementById('fecha').valueAsDate = new Date();
  cargarGraficaMensual();
  cargarGraficaProducto();
});

// --- LEAD FORMULARIO ---
document.getElementById('formLead').onsubmit = async function(e) {
  e.preventDefault();
  const f = this;
  // Normalizar teléfono: solo dígitos
  const telefonoLimpio = (f.telefono.value || '').replace(/\D+/g, '');
  const data = {
    fecha: f.fecha.value,
    team: f.team.value,
    agente: f.agente.value,
    producto: f.producto.value,
    puntaje: f.puntaje.value,
    telefono: telefonoLimpio,
    direccion: f.direccion.value,
    zip: f.zip.value
  };
  const errorDiv = document.getElementById('leadError');
  const okDiv = document.getElementById('leadSuccess');
  errorDiv.style.display = okDiv.style.display = "none";
  const resp = await fetch(`${API_URL}/api/agente/leads`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const res = await resp.json();
  if(res.success){
    okDiv.textContent = "Venta registrada!";
    okDiv.style.display = "block";
    cargarGraficaMensual();
    cargarGraficaProducto();
    f.reset();
    document.getElementById('fecha').valueAsDate = new Date();
  }else{
    errorDiv.textContent = res.error || "Error al guardar.";
    errorDiv.style.display = "block";
  }
};

// --- GRÁFICAS ---
async function cargarGraficaMensual() {
  const resp = await fetch(`${API_URL}/api/agente/estadisticas-mes`);
  const data = await resp.json();
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const ctx = document.getElementById('graficaMensual').getContext('2d');
  if(window.graficaMensualObj) window.graficaMensualObj.destroy();
  window.graficaMensualObj = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: meses,
      datasets: [
        { label:'Ventas', data: data.ventasPorMes, backgroundColor: '#22b3ec' },
        { label:'Puntaje', data: data.puntajePorMes, backgroundColor: '#ef5350' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend:{position:'top'},
        title:{display:true,text:'Ventas mensuales personales'},
        tooltip: {
          callbacks: {
            label: function(ctx){
              const ds = ctx.dataset || {};
              const arr = Array.isArray(ds.data) ? ds.data.map(Number) : [];
              const idx = (ctx.dataIndex != null ? ctx.dataIndex : 0);
              const sum = arr.slice(0, idx + 1).reduce((a,b)=>a + b, 0);
              // Mostrar acumulado exacto sin redondeo
              return (ds.label ? ds.label + ' acumulado: ' : 'Acumulado: ') + sum;
            }
          }
        }
      },
      scales: {
        x:{ticks:{color:'#222'}},
        y:{
          beginAtZero:true,
          ticks: {
            callback: function(value){ return value; }
          }
        }
      }
    }
  });
}
async function cargarGraficaProducto() {
  const resp = await fetch(`${API_URL}/api/agente/ventas-producto`);
  const data = await resp.json();
  const ctx = document.getElementById('graficaProducto').getContext('2d');
  if(window.graficaProductoObj) window.graficaProductoObj.destroy();
  window.graficaProductoObj = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [{ label:'Ventas por producto', data: data.data, backgroundColor: '#22b3ec' }]
    },
    options:{
      responsive:true,
      plugins:{
        legend:{display:false},
        title:{display:true,text:'Ventas por producto'},
        tooltip: {
          callbacks: {
            label: function(ctx){
              const ds = ctx.dataset || {};
              const arr = Array.isArray(ds.data) ? ds.data.map(Number) : [];
              const idx = (ctx.dataIndex != null ? ctx.dataIndex : 0);
              const sum = arr.slice(0, idx + 1).reduce((a,b)=>a + b, 0);
              return (ds.label ? ds.label + ' acumulado: ' : 'Acumulado: ') + sum;
            }
          }
        }
      },
      indexAxis:'x',
      scales:{
        x:{ticks:{color:'#222'}},
        y:{
          beginAtZero:true,
          ticks:{
            callback: function(value){ return value; }
          }
        }
      }
    }
  });
}

// --- COSTUMER PANEL (MÉTRICAS + FILTROS + TABLA) ---
let costumerFiltro = {
  fechaDesde: '', fechaHasta: '', team: '', numero: '', direccion: '', zip: ''
};

async function cargarCostumerPanel() {
  await Promise.all([
    cargarCostumerMetricas(),
    cargarCostumerTeams(),
    cargarCostumersTabla()
  ]);
}

// --- Helper de auth ---
function getAuthHeaders() {
  try {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  } catch (_) { return {}; }
}

// --- Métricas ---
async function cargarCostumerMetricas() {
  const params = new URLSearchParams(costumerFiltro).toString();
  try {
    const resp = await fetch(`${API_URL}/api/agente/costumer-metricas?` + params, {
      headers: { ...getAuthHeaders() },
      credentials: 'include'
    });
    if (!resp.ok) {
      console.warn('cargarCostumerMetricas: respuesta no OK', resp.status);
      return;
    }
    const m = await resp.json();

    const setKpi = (ids, value) => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) { el.textContent = value ?? 0; return true; }
      }
      return false;
    };

    // Ventas Hoy
    setKpi(['ventasHoy','costumer-ventas-hoy'], m.ventasHoy || 0);
    // Ventas del Mes
    setKpi(['ventasMes','costumer-ventas-mes'], m.ventasMes || 0);
    // Pendientes
    setKpi(['leadsPendientes','costumer-pendientes'], m.leadsPendientes || 0);
    // Cancelados (antes no se actualizaba)
    setKpi(['cancelados','costumer-cancelados'], m.cancelados || 0);
    // Total clientes (si existe alguna tarjeta para esto)
    setKpi(['clientesTotal','costumer-clientes-total'], m.clientes || 0);
  } catch (e) {
    console.error('Error en cargarCostumerMetricas:', e);
  }
}

// --- Teams para filtro ---
async function cargarCostumerTeams() {
  const resp = await fetch(`${API_URL}/api/agente/teams`);
  const teams = await resp.json();
  const sel = document.getElementById('filtroTeam');
  let prev = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + teams.map(t=>`<option value="${t}">${t}</option>`).join('');
  sel.value = prev || '';
}

// --- Tabla principal ---
async function cargarCostumersTabla() {
  const params = new URLSearchParams(costumerFiltro).toString();
  const resp = await fetch(`${API_URL}/api/agente/costumer?` + params);
  const data = await resp.json();
  const tbody = document.querySelector('#tablaCostumer tbody');
  tbody.innerHTML = '';
  data.costumers.forEach(c => {
    tbody.innerHTML += `<tr>
      <td>${c.fecha||''}</td>
      <td>${c.equipo||''}</td>
      <td>${c.agente||''}</td>
      <td>${c.producto||''}</td>
      <td>${c.estado||''}</td>
      <td>${c.puntaje||''}</td>
      <td>${c.cuenta||''}</td>
      <td>${c.telefono||''}</td>
      <td>${c.direccion||''}</td>
      <td>${c.zip||''}</td>
      <td class="acciones">
        <button onclick="editarCostumer('${c._id}')" title="Editar">&#9998;</button>
        <button onclick="eliminarCostumer('${c._id}')" title="Eliminar" style="color:#ef5350;">&#10006;</button>
      </td>
    </tr>`;
  });
}

// --- Filtros ---
function actualizarFiltroCostumer() {
  costumerFiltro.fechaDesde = document.getElementById('filtroFechaDesde').value;
  costumerFiltro.fechaHasta = document.getElementById('filtroFechaHasta').value;
  costumerFiltro.team = document.getElementById('filtroTeam').value;
  costumerFiltro.numero = document.getElementById('filtroNumero').value;
  costumerFiltro.direccion = document.getElementById('filtroDireccion').value;
  costumerFiltro.zip = document.getElementById('filtroZip').value;
  cargarCostumerPanel();
}
['filtroFechaDesde','filtroFechaHasta','filtroTeam','filtroNumero','filtroDireccion','filtroZip'].forEach(id=>{
  document.getElementById(id).addEventListener('change',actualizarFiltroCostumer);
  document.getElementById(id).addEventListener('input',actualizarFiltroCostumer);
});

// --- ACCIONES: EDITAR / ELIMINAR ---
window.eliminarCostumer = async function(id){
  if(!confirm("¿Seguro de eliminar este registro?")) return;
  const resp = await fetch(`${API_URL}/api/agente/costumer/`+id, {method:'DELETE'});
  const data = await resp.json();
  if(data.success){
    cargarCostumerPanel();
  }else{
    alert("Error al eliminar");
  }
};
window.editarCostumer = function(id){
  alert("Función de edición pendiente de implementar.");
  // Aquí podrías abrir un modal con los datos del costumer, etc.
};

// --- ACCIONES: DESCARGAR EXCEL ---
document.getElementById('btnDescargarExcel').onclick = function(){
  const params = new URLSearchParams(costumerFiltro).toString();
  window.open(`${API_URL}/api/agente/costumer-excel?` + params, '_blank');
};

// --- ACCIONES: IMPORTAR EXCEL ---
let archivoSeleccionado = null;
document.getElementById('btnSeleccionarArchivo').onclick = function(){
  document.getElementById('inputExcel').click();
};
document.getElementById('inputExcel').onchange = function(){
  archivoSeleccionado = this.files[0];
  document.getElementById('nombreArchivo').textContent = archivoSeleccionado ? archivoSeleccionado.name : "Ningún archivo seleccionado";
};
document.getElementById('btnImportarExcel').onclick = async function(){
  if(!archivoSeleccionado) return alert("Selecciona un archivo Excel primero.");
  const formData = new FormData();
  formData.append('excel', archivoSeleccionado);
  const resp = await fetch(`${API_URL}/api/agente/costumer-import`, {method:'POST', body:formData});
  const data = await resp.json();
  if(data.success){
    alert("Importado correctamente.");
    archivoSeleccionado = null;
    document.getElementById('inputExcel').value = "";
    document.getElementById('nombreArchivo').textContent = "Ningún archivo seleccionado";
    cargarCostumerPanel();
  }else{
    alert("Error al importar: " + (data.error || ""));
  }
};

// --- ACCIONES: ELIMINAR TODO ---
document.getElementById('btnEliminarTodo').onclick = async function(){
  if(!confirm("¿Seguro de eliminar TODOS tus costumers?")) return;
  const resp = await fetch(`${API_URL}/api/agente/costumer-eliminar-todo`, {method:'DELETE'});
  const data = await resp.json();
  if(data.success){
    alert("Eliminados todos los registros.");
    cargarCostumerPanel();
  }else{
    alert("Error al eliminar todo.");
  }
};

// --- Inicialización automática si se entra directo a costumer ---
if(window.location.hash === "#costumer" || window.location.search.includes("costumer")){
  document.getElementById('tabCostumer').click();
}