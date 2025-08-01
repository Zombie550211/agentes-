// Registrar el plugin de datalabels globalmente
Chart.register(ChartDataLabels);

// Lógica para mostrar gráficas (ventas y productos)
window.renderGraficas = function(leads) { 
  console.log('[Graficas] renderGraficas ejecutado con:', leads);
  
  if (!Array.isArray(leads) || leads.length === 0) {
    if (window.Swal) Swal.fire('Sin datos', 'No hay ventas registradas para graficar.', 'info');
    if (window.ventasTeamChartInstance) window.ventasTeamChartInstance.destroy();
    if (window.productosChartInstance) window.productosChartInstance.destroy();
    return;
  }

  const diasMap = {};
  leads.forEach(l => {
    const fecha = (l.dia_venta || '').slice(0, 10); 
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
  lunes.setDate(hoy.getDate() - (diaSemana === 0 ? 6 : diaSemana - 1));
  
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    dias.push(`${anio}-${mes}-${dia}`);
  }

  const ventas = dias.map(d => (diasMap[d] ? diasMap[d].ventas : 0));
  const puntajes = dias.map(d => (diasMap[d] ? diasMap[d].puntaje : 0));
  const etiquetas = dias.map(d => {
    const dt = new Date(d + 'T00:00:00'); 
    return dt.toLocaleDateString('es-MX', {weekday:'short', day:'2-digit'});
  });

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
        { label: 'Ventas', data: ventas, backgroundColor: 'rgba(74, 144, 226, 0.8)' },
        { label: 'Puntaje', data: puntajes, backgroundColor: 'rgba(255, 87, 34, 0.8)' }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: 'Ventas y Puntaje por Día (Últimos 7 Días)' },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#475569',
          font: { weight: 'bold' },
          formatter: (value, context) => {
            if (value <= 0) return null;
            // El dataset de Puntaje es el segundo (índice 1)
            if (context.datasetIndex === 1) {
              return parseFloat(value).toFixed(2);
            }
            return Math.round(value);
          }
        }
      },
      scales: { y: { beginAtZero: true } }
    }
  });

  const productos = [
    "5GB AT&T", "2GB AT&T", "1GB AT&T", "500 AT&T", "300 AT&T", "100 AT&T", "AT&T BUSSINES", "AT&T PREMIER", "AT&T ADVENTAGE", "AT&T AIR",
    "5GB SPECTRUM", "2GB SPECTRUM", "1GB SPECTRUM", "500 SPECTRUM", "200 SPECTRUM", "SPECTRUM BUSSINES", "SPECTRUM PREMIER", "SPECTRUM ADVENTAGE",
    "5GB FRONTIER", "2GB FRONTIER", "1GB FRONTIER", "500 FRONTIER", "200 FRONTIER",
    "OPTIMO MAS", "MAS LATINO", "MAS ULTRA", "DIRECTV BUSSINES", "HUGHESNET", "OPTIMUM", "VIASAT", "WINDSTREAM",
    "VIVINT", "KINETICK", "WOW", "ALTAFIBER", "ZYPLYFIBER", "CONSOLIDATE COMUNICATION", "BRIGHTSPEED", "EARTHLINK", "LINEA + CELULAR"
  ];

  const ventasPorProducto = {};
  productos.forEach(p => ventasPorProducto[p] = 0);

  leads.forEach(lead => {
    if (lead.tipo_servicios) { 
      const tipoLead = lead.tipo_servicios.trim().toLowerCase().replace(/\s+/g, ' ');
      for (const prod of productos) {
        const prodNorm = prod.trim().toLowerCase().replace(/\s+/g, ' ');
        if (tipoLead === prodNorm) {
          ventasPorProducto[prod]++;
          break;
        }
      }
    }
  });
  
  const canvasProd = document.getElementById('productosChart');
  if (!canvasProd) {
    console.error('No se encontró el canvas de productos (productosChart)');
    return;
  }

  if (window.productosChartInstance) {
    window.productosChartInstance.destroy();
  }
  
  const colores = productos.map((_, i) => `hsl(${(i * 137.508) % 360}, 70%, 60%)`);
  
  const ctxProd = canvasProd.getContext('2d');
  window.productosChartInstance = new Chart(ctxProd, {
    type: 'bar',
    data: {
      labels: productos,
      datasets: [{
        label: 'Ventas por producto',
        data: productos.map(p => ventasPorProducto[p] || 0),
        backgroundColor: colores,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {display: false},
        title: { display: true, text: 'Ventas por Producto' },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#475569',
          font: { weight: 'bold' },
          formatter: (value) => value > 0 ? value : null
        }
      },
      scales: { y: { beginAtZero: true } }
    }
  });
};

// Inicializar gráficas cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  // No llamar a renderGraficas directamente, en su lugar, llamar a la función que obtenga los leads y luego llame a renderGraficas con los leads obtenidos.
});
