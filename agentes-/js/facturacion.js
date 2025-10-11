function logout() {
    fetch('/logout').then(() => location.href = 'login.html');
  }
  const filtroMes = document.getElementById("filtroMes");
  const filtroAno = document.getElementById("filtroAno");
  const excelBody = document.getElementById("excelBody");
  const btnUp = document.getElementById('btnUp');
  const btnDown = document.getElementById('btnDown');
  
  // Llenar select de años
  (function(){
    const yearNow = (new Date()).getFullYear();
    let anos = '';
    for (let y = yearNow - 2; y <= yearNow + 1; y++) {
      anos += `<option value="${y}">${y}</option>`;
    }
    filtroAno.innerHTML = anos;
    filtroMes.value = (new Date()).getMonth() + 1;
    filtroAno.value = yearNow;
  })();
  
  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }
  
  let currentBlock = 0;
  let currentMonth = parseInt(filtroMes.value, 10);
  let currentYear = parseInt(filtroAno.value, 10);
  
  let datosFacturacionMes = [];
  
  async function cargarFacturacionMes(ano, mes) {
    const resp = await fetch(`/api/facturacion/${ano}/${String(mes).padStart(2,'0')}`);
    const { ok, data } = await resp.json();
    if (ok && Array.isArray(data)) {
      datosFacturacionMes = data;
    } else {
      datosFacturacionMes = [];
    }
  }
  
  function buscarCamposPorFecha(fecha) {
    const fila = datosFacturacionMes.find(f => f.fecha === fecha);
    return fila ? fila.campos : Array(14).fill("");
  }
  
  async function renderTablaDias(mes, ano, block=0) {
    await cargarFacturacionMes(ano, mes);
  
    excelBody.innerHTML = "";
    const numDias = daysInMonth(ano, mes);
    const start = block * 16;
    const end = Math.min(start + 16, numDias);
    for (let i = start; i < end; i++) {
      const tr = document.createElement("tr");
      const fecha = String(i+1).padStart(2,'0') + '/' + String(mes).padStart(2,'0') + '/' + ano;
      const campos = buscarCamposPorFecha(fecha);
      for (let c = 0; c < 15; c++) {
        const td = document.createElement("td");
        if (c === 0) {
          td.textContent = fecha;
          td.contentEditable = false;
        } else {
          td.contentEditable = true;
          td.textContent = campos[c-1] ?? "";
        }
        tr.appendChild(td);
      }
      excelBody.appendChild(tr);
    }
    btnUp.disabled = (block === 0);
    btnDown.disabled = ((block + 1) * 16 >= numDias);
    renderFilaTotalesFacturacion();
  }
  
  async function updateTableByFilters() {
    currentBlock = 0;
    currentMonth = parseInt(filtroMes.value, 10);
    currentYear = parseInt(filtroAno.value, 10);
    await renderTablaDias(currentMonth, currentYear, currentBlock);
    actualizarGrafica(false); // SIEMPRE lee solo del backend
  }
  filtroMes.addEventListener('change', async () => {
    await updateTableByFilters();
  });
  filtroAno.addEventListener('change', async () => {
    await updateTableByFilters();
  });
  async function nextBlock() {
    const numDias = daysInMonth(currentYear, currentMonth);
    if ((currentBlock + 1) * 16 < numDias) {
      currentBlock++;
      await renderTablaDias(currentMonth, currentYear, currentBlock);
      actualizarGrafica(false); // SIEMPRE lee solo del backend
    }
  }
  async function prevBlock() {
    if (currentBlock > 0) {
      currentBlock--;
      await renderTablaDias(currentMonth, currentYear, currentBlock);
      actualizarGrafica(false); // SIEMPRE lee solo del backend
    }
  }
  window.addEventListener('DOMContentLoaded', async () => {
    await renderTablaDias(currentMonth, currentYear, currentBlock);
    actualizarGrafica(false); // SIEMPRE lee solo del backend
  });
  
  /* --- GRAFICA Chart.js --- */
  let grafica;
  async function actualizarGrafica(usarTabla = false) {
    const ano = parseInt(filtroAno.value, 10);
    let totalesPorMes = Array(12).fill(0);
    try {
      const resp = await fetch(`/api/facturacion/anual/${ano}`);
      const datos = await resp.json();
      if (datos.ok && Array.isArray(datos.totalesPorMes)) {
        totalesPorMes = datos.totalesPorMes.map(v => Number(v) || 0);
      }
    } catch (e) {
      console.error("Error obteniendo los datos para la gráfica:", e);
    }
  
    // NO SE INCLUYEN DATOS LOCALES, SIEMPRE SOLO BACKEND
  
    if (grafica) grafica.destroy();
    const ctx = document.getElementById('graficaGastosMes').getContext('2d');
    grafica = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [
          "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
          "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
        ],
        datasets: [{
          label: "",
          data: totalesPorMes,
          backgroundColor: "rgba(40,181,232,0.70)",
          borderColor: "#1e293b",
          borderWidth: 2,
          borderRadius: 8,
          datalabels: {
            anchor: 'end',
            align: 'start',
            color: '#23485d',
            font: { weight: 'bold', size: 16 },
            formatter: v => v === 0 ? "" : "$" + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          }
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          title: { display: false },
          datalabels: { display: true }
        },
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: { display: true, color: "#204052", font: { weight: "bold", size: 15 } }
          },
          y: {
            grid: { display: false, drawBorder: false },
            ticks: { display: false }
          }
        }
      },
      plugins: [window.ChartDataLabels || {}]
    });
  }
  
  // ----------- FÓRMULAS Y TOTALES -----------
  
  function limpiarNumero(texto) {
    if (typeof texto !== "string") texto = String(texto);
    return Number(texto.replace(/[^0-9.\-]/g, "")) || 0;
  }
  
  function recalcularFila(tr) {
    const tds = Array.from(tr.children);
  
    // Alexis
    let alexis = limpiarNumero(tds[1].textContent);
    let ventasAlexis = limpiarNumero(tds[2].textContent);
    tds[3].textContent = ventasAlexis > 0 ? (alexis / ventasAlexis).toFixed(2) : "";
  
    // Cuenta Alterna
    let cuentaAlterna = limpiarNumero(tds[4].textContent);
    let ventasCA = limpiarNumero(tds[5].textContent);
    tds[6].textContent = ventasCA > 0 ? (cuentaAlterna / ventasCA).toFixed(2) : "";
  
    // Lineas
    let lineas = limpiarNumero(tds[7].textContent);
    let ventasLineas = limpiarNumero(tds[8].textContent);
    tds[9].textContent = ventasLineas > 0 ? (lineas / ventasLineas).toFixed(2) : "";
  
    // TOTAL DEL DIA = alexis + cuentaAlterna + lineas
    let totalDia = alexis + cuentaAlterna + lineas;
    tds[10].textContent = totalDia.toFixed(2);
  }
  
  excelBody.addEventListener('input', function(e) {
    const td = e.target;
    const tr = td.parentElement;
    if (td.cellIndex !== 0) {
      recalcularFila(tr);
      renderFilaTotalesFacturacion();
      actualizarGrafica(false); // SIEMPRE lee solo del backend
    }
  });
  
  function renderFilaTotalesFacturacion() {
    const numCols = 15;
    const totales = Array(numCols).fill(0);
    const filas = Array.from(excelBody.querySelectorAll('tr'));
    filas.forEach(tr => {
      Array.from(tr.children).forEach((td, i) => {
        if (i === 0) return;
        const val = limpiarNumero(td.textContent) || 0;
        totales[i] += val;
      });
    });
    for (let i = 1; i < numCols; i++) {
      const el = document.getElementById('total-col-' + i);
      if (el) el.textContent = totales[i].toFixed(2);
    }
  }
  
  // ------------------ GUARDAR TODO -------------------
  document.getElementById('btnGuardarFacturacion').addEventListener('click', guardarTodoFacturacion);
  
  async function guardarTodoFacturacion() {
    const filas = Array.from(document.querySelectorAll('#excelBody tr'));
    let guardados = 0, errores = 0;
    for (const tr of filas) {
      recalcularFila(tr);
      const tds = Array.from(tr.children);
      const fecha = tds[0].textContent.trim();
      const campos = tds.slice(1).map(td => td.textContent.trim());
      if (campos.some(val => val !== "")) {
        const res = await fetch('/api/facturacion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fecha, campos })
        });
        const data = await res.json();
        if (data.ok) guardados++;
        else errores++;
      }
    }
    await renderTablaDias(currentMonth, currentYear, currentBlock);
    await actualizarGrafica(false); // SOLO backend después de guardar
    renderFilaTotalesFacturacion();
    alert(`Guardados: ${guardados}. Errores: ${errores}`);
  }