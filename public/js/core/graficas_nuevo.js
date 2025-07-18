// Lógica para mostrar gráficas (ventas y productos)
window.renderGraficas = async function() {
  // Obtener leads
  let leads = [];
  if (typeof fetchLeadsAgente === 'function') {
    leads = await fetchLeadsAgente();
  }
  console.log('[Graficas] Leads recibidos:', leads);
  if (!Array.isArray(leads) || leads.length === 0) {
    if (window.Swal) Swal.fire('Sin datos', 'No hay ventas registradas para graficar.', 'info');
    return;
  }

  // Detectar campos reales
  const camposLead = Object.keys(leads[0] || {});
  console.log('[Graficas] Campos de un lead:', camposLead);

  // --- Gráfica de ventas por día ---
  let campoFecha = camposLead.find(c => c.toLowerCase().includes('dia_venta') || 
                                      c.toLowerCase().includes('fecha') || 
                                      c.toLowerCase().includes('creado'));
  if (!campoFecha) {
    if (window.Swal) Swal.fire('Error', 'No se encontró un campo de fecha adecuado en los leads.', 'error');
    return;
  }

  const diasMap = {};
  leads.forEach(l => {
    const fecha = (l[campoFecha] || '').slice(0, 10);
    if (!fecha) return;
    if (!diasMap[fecha]) diasMap[fecha] = {ventas: 0, puntaje: 0};
    diasMap[fecha].ventas++;
    let p = 0;
    if (typeof l.puntaje === 'number') p = l.puntaje;
    else if (!isNaN(parseFloat(l.puntaje))) p = parseFloat(l.puntaje);
    diasMap[fecha].puntaje += p;
  });

  const hoy = new Date();
  const diaSemana = hoy.getDay();
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - ((diaSemana + 6) % 7));
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    dias.push(d.toISOString().slice(0, 10));
  }

  const ventas = dias.map(d => (diasMap[d] ? diasMap[d].ventas : 0));
  const puntajes = dias.map(d => (diasMap[d] ? diasMap[d].puntaje : 0));
  const etiquetas = dias.map(d => {
    const dt = new Date(d);
    return dt.toLocaleDateString('es-MX', {weekday:'short', day:'2-digit', month:'2-digit'});
  });

  // LOG: Datos para gráfica de días
  console.log('[Graficas] Días:', dias);
  console.log('[Graficas] Ventas por día:', ventas);
  console.log('[Graficas] Puntajes por día:', puntajes);

  // Destruir gráfica previa si existe
  if (window.ventasTeamChartInstance) {
    window.ventasTeamChartInstance.destroy();
  }
  
  const ventasCanvas = document.getElementById('ventasTeamChart');
  if (!ventasCanvas) {
    console.error('No se encontró el canvas de ventas (ventasTeamChart)');
    return;
  }
  
  const ctxVentas = ventasCanvas.getContext('2d');
  window.ventasTeamChartInstance = new Chart(ctxVentas, {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: [
        {
          label: 'Ventas',
          data: ventas,
          backgroundColor: 'rgba(33, 150, 243, 0.8)',
          borderColor: 'rgba(33, 150, 243, 1)',
          borderWidth: 1
        },
        {
          label: 'Puntaje',
          data: puntajes,
          backgroundColor: 'rgba(244, 67, 54, 0.7)',
          borderColor: 'rgba(244, 67, 54, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {position: 'top'},
        title: {
          display: true,
          text: 'Ventas y Puntaje por Día (últimos 7 días)'
        },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#444',
          font: {weight:'bold'},
          formatter: function(value) {
            return Number.isFinite(value) ? Math.round(value) : value;
          }
        }
      },
      scales: {
        x: {grid: {display:false}},
        y: {
          beginAtZero: true,
          title: {display: true, text: 'Cantidad / Puntaje'}
        }
      }
    },
    plugins: window.ChartDataLabels ? [ChartDataLabels] : []
  });

  // --- Gráfica de productos vendidos ---
  let campoProducto = camposLead.find(c => c.toLowerCase().includes('servicio') || 
                                         c.toLowerCase().includes('producto') || 
                                         c.toLowerCase().includes('tipo'));
  if (!campoProducto) {
    const msgDiv = document.getElementById('no-data-producto');
    if (msgDiv) {
      msgDiv.style.display = 'block';
      msgDiv.textContent = 'No se encontró un campo de producto/servicio en los leads.';
    }
    const canvasProd = document.getElementById('productosChart');
    if (canvasProd) canvasProd.style.display = 'none';
    return;
  }

  const productosMap = {};
  leads.forEach(l => {
    let prod = (l[campoProducto] || '').toString().trim();
    if (!prod) return;
    if (!productosMap[prod]) productosMap[prod] = 0;
    productosMap[prod]++;
  });
  
  const productos = Object.keys(productosMap);
  const ventasPorProducto = productos.map(p => productosMap[p]);
  
  // LOG: Datos para gráfica de productos
  console.log('[Graficas] Productos:', productos);
  console.log('[Graficas] Ventas por producto:', ventasPorProducto);
  
  // Mostrar mensaje si no hay datos
  const msgDiv = document.getElementById('no-data-producto');
  const canvasProd = document.getElementById('productosChart');
  
  if (!productos.length) {
    if (msgDiv) {
      msgDiv.style.display = 'block';
      msgDiv.textContent = 'No hay ventas por producto para mostrar.';
    }
    if (canvasProd) canvasProd.style.display = 'none';
    return;
  } else {
    if (msgDiv) msgDiv.style.display = 'none';
    if (canvasProd) canvasProd.style.display = 'block';
  }
  
  // Colores para las barras
  const colores = productos.map((_,i) => `hsl(${(i*37)%360},70%,60%)`);
  
  // Destruir instancia previa si existe
  if (window.productosChartInstance) {
    window.productosChartInstance.destroy();
  }
  
  // Renderizar gráfica de productos
  const ctxProd = canvasProd.getContext('2d');
  window.productosChartInstance = new Chart(ctxProd, {
    type: 'bar',
    data: {
      labels: productos,
      datasets: [{
        label: 'Ventas por producto',
        data: ventasPorProducto,
        backgroundColor: colores,
        borderColor: colores,
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: {display: false},
        title: {
          display: true,
          text: 'Ventas por Producto (todos los productos vendidos)'
        },
        datalabels: {
          anchor: 'end',
          align: 'right',
          color: '#444',
          font: {weight:'bold'},
          formatter: function(value) {
            return Number.isFinite(value) ? Math.round(value) : value;
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          title: {display: true, text: 'Cantidad vendida'}
        },
        y: {
          title: {display: true, text: 'Producto'}
        }
      }
    },
    plugins: window.ChartDataLabels ? [ChartDataLabels] : []
  });
};

// Inicializar gráficas cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  if (typeof renderGraficas === 'function') renderGraficas();
});
