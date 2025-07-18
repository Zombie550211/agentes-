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
        legend: {
          position: 'top',
          labels: {
            padding: 20 // Aumentar el padding para dejar espacio para los números
          }
        },
        datalabels: {
          anchor: 'end',
          align: 'start', // Cambiar a 'start' para que aparezca debajo de la barra
          offset: 0,
          color: '#444',
          font: {weight:'bold', size: 12},
          backgroundColor: 'rgba(255, 255, 255, 0.7)',
          borderRadius: 4,
          padding: 3,
          formatter: function(value) {
            return Number.isFinite(value) && value > 0 ? Math.round(value) : '';
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
  // Buscar campos relacionados con productos/servicios
  let campoProducto = camposLead.find(c => c.toLowerCase().includes('servicio') || 
                                         c.toLowerCase().includes('producto') || 
                                         c.toLowerCase().includes('tipo_servicios'));
  
  // Obtener todos los servicios disponibles del formulario
  const todosLosServicios = [];
  const selectServicios = document.querySelector('select[name="tipo_servicios"]');
  if (selectServicios) {
    Array.from(selectServicios.options).forEach(option => {
      if (option.value && option.value !== '') {
        todosLosServicios.push(option.value);
      }
    });
  }
  
  console.log('[Graficas] Todos los servicios disponibles:', todosLosServicios);
  
  if (!campoProducto && todosLosServicios.length === 0) {
    console.error('No se encontró un campo de producto/servicio adecuado en los leads y no hay servicios disponibles en el formulario');
    const canvasProd = document.getElementById('productosChart');
    if (canvasProd) canvasProd.style.display = 'none';
    return;
  }
  
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

  // Contar productos
  const productosMap = {};
  
  // Inicializar todos los servicios disponibles con contador 0
  if (todosLosServicios.length > 0) {
    todosLosServicios.forEach(servicio => {
      productosMap[servicio] = 0;
    });
  }
  
  // Contar los productos/servicios vendidos
  if (campoProducto) {
    leads.forEach(l => {
      let prod = (l[campoProducto] || '').toString().trim();
      if (!prod) return;
      if (!productosMap[prod]) productosMap[prod] = 0;
      productosMap[prod]++;
    });
  }
  
  // Preparar datos para la gráfica y ordenarlos por cantidad descendente
  const productosOrdenados = Object.entries(productosMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12); // Mostrar hasta 12 servicios para mejor visualización
    
  const productos = productosOrdenados.map(item => item[0]);
  const ventasPorProducto = productosOrdenados.map(item => item[1]);
  
  // LOG: Datos para gráfica de productos
  console.log('[Graficas] Productos:', productos);
  console.log('[Graficas] Ventas por producto:', ventasPorProducto);
  
  // Mostrar mensaje si no hay datos
  const msgDiv = document.getElementById('no-data-producto');
  const canvasProd = document.getElementById('productosChart');
  
  // Siempre mostrar la gráfica, incluso si no hay ventas
  if (msgDiv) msgDiv.style.display = 'none';
  
  // Asegurar que el canvas siempre esté visible
  if (canvasProd) canvasProd.style.display = 'block';
  
  // Destruir instancia previa si existe
  if (window.productosChartInstance) {
    window.productosChartInstance.destroy();
  }
  
  // Restaurar la visibilidad del canvas
  if (canvasProd) {
    canvasProd.style.display = 'block';
  }
  
  // Renderizar gráfica de productos con estilo minimalista
  const ctxProd = canvasProd.getContext('2d');
  
  // No agregamos título adicional para evitar redundancia
  
  // Registrar el plugin Chart.js Datalabels
  Chart.register(ChartDataLabels);
  
  // Configurar la gráfica de productos (barras verticales)
  window.productosChartInstance = new Chart(ctxProd, {
    type: 'bar',
    data: {
      labels: productos,
      datasets: [{
        label: 'Cantidad de ventas',
        backgroundColor: 'rgba(33, 150, 243, 0.8)',
        borderColor: 'rgba(33, 150, 243, 1)',
        data: ventasPorProducto,
        borderWidth: 1,
        barThickness: 25,
        maxBarThickness: 25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      indexAxis: 'x', // Barras verticales
      layout: {
        padding: {
          left: 5,
          right: 5,
          top: 30, // Aumentado para dar espacio a los números encima de las barras
          bottom: 10
        }
      },
      aspectRatio: 2.2,
      animation: {
        duration: 0 // Sin animaciones
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          titleFont: {
            size: 12
          },
          bodyFont: {
            size: 12
          },
          callbacks: {
            label: function(context) {
              return `Ventas: ${context.raw}`;
            }
          }
        },
        datalabels: {
          display: true,
          color: '#333',
          anchor: 'end',
          align: 'top',
          offset: 8,
          font: {
            weight: 'bold',
            size: 13
          },
          formatter: function(value) {
            return value > 0 ? value : '';
          },
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          borderRadius: 4,
          padding: 3,
          textShadow: '0px 0px 2px rgba(255,255,255,0.7)'
        },
        title: {
          display: true,
          text: 'Servicios',
          font: {
            size: 16,
            weight: 'bold'
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: false,
            drawBorder: true
          },
          ticks: {
            display: true,
            color: '#666',
            font: {
              size: 8,
              weight: '400',
              family: "'Arial', sans-serif"
            },
            padding: 5,
            callback: function(value, index) {
              // Limitar longitud de texto para mejor visualización
              let label = productos[index];
              return label.length > 12 ? label.substring(0, 10) + '...' : label;
            },
            autoSkip: false
          }
        },
        y: {
          display: true,
          grid: {
            display: true,
            drawBorder: true,
            color: 'rgba(200, 200, 200, 0.3)'
          },
          ticks: {
            display: true,
            color: '#666',
            font: {
              size: 10
            }
          }
        }
      }
    }
  });
  
  // No destruir la instancia aquí, ya que queremos que se mantenga visible
  // La instancia anterior ya fue destruida antes de crear la nueva
};

// Inicializar gráficas cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  if (typeof renderGraficas === 'function') renderGraficas();
});
