// Lógica para mostrar gráficas (ventas y productos)
window.renderGraficas = async function() {
  // Obtener los leads del agente usando la función global
  let leads = [];
  if (typeof fetchLeadsAgente === 'function') {
    leads = await fetchLeadsAgente();
  }
  if (!Array.isArray(leads) || leads.length === 0) {
    if (window.Swal) Swal.fire('Sin datos', 'No hay ventas registradas para graficar.', 'info');
    return;
  }

  // Agrupar por día (usando campo creadoEn o fecha)
  const diasMap = {};
  leads.forEach(l => {
    const fecha = (l.creadoEn || l.fecha || '').slice(0, 10);
    if (!fecha) return;
    if (!diasMap[fecha]) diasMap[fecha] = {ventas: 0, puntaje: 0};
    diasMap[fecha].ventas++;
    // Sumar puntaje si es numérico
    let p = 0;
    if (typeof l.puntaje === 'number') p = l.puntaje;
    else if (!isNaN(parseFloat(l.puntaje))) p = parseFloat(l.puntaje);
    diasMap[fecha].puntaje += p;
  });

  // Tomar solo los últimos 7 días (ordenados)
  const dias = Object.keys(diasMap).sort().slice(-7);
  const ventas = dias.map(d => diasMap[d].ventas);
  const puntajes = dias.map(d => diasMap[d].puntaje);

  // Preparar etiquetas (formato: día/mes)
  const etiquetas = dias.map(d => {
    const dt = new Date(d);
    return dt.toLocaleDateString('es-MX', {weekday:'short', day:'2-digit', month:'2-digit'});
  });

  // Destruir gráfica previa si existe
  if (window.ventasTeamChartInstance) {
    window.ventasTeamChartInstance.destroy();
  }
  const ctx = document.getElementById('ventasTeamChart').getContext('2d');
  window.ventasTeamChartInstance = new Chart(ctx, {
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
          font: {weight:'bold'}
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
};
  // --- Gráfica de productos vendidos (productosChart) ---
  // Agrupar por producto
  const productosMap = {};
  leads.forEach(l => {
    // Normaliza nombre del producto
    let prod = (l.producto || l.servicio || '').toString().trim();
    if (!prod) return;
    if (!productosMap[prod]) productosMap[prod] = 0;
    productosMap[prod]++;
  });
  const productos = Object.keys(productosMap);
  const ventasPorProducto = productos.map(p => productosMap[p]);
  // Colores para las barras
  const colores = productos.map((_,i) => `hsl(${(i*37)%360},70%,60%)`);
  // Destruir instancia previa si existe
  if (window.productosChartInstance) {
    window.productosChartInstance.destroy();
  }
  const ctxProd = document.getElementById('productosChart').getContext('2d');
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
          font: {weight:'bold'}
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
// Archivo JS válido
