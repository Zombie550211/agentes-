document.addEventListener("DOMContentLoaded", () => {
  const equipos = ["Team Irania", "Team Pleitez", "Team Roberto", "Team Lineas", "Team Randal", "Team Marisol"];
  const productos = [
    "225 AT&T AIR", "18 AT&T", "25 AT&T", "50 AT&T", "75 AT&T", "100 AT&T", "300 AT&T", "500 AT&T", "1G AT&T", "5G AT&T",
    "2GB SPECTRUM", "1GB SPECTRUM", "500 SPECTRUM", "200 SPECTRUM", "SPECTRUM BUSSINES", "SPECTRUM PREMIER", "SPECTRUM ADVENTAGE",
    "5GB FRONTIER", "2GB FRONTIER", "1GB FRONTIER", "500 FRONTIER", "200 FRONTIER",
    "OPTIMO MAS", "MAS LATINO", "MAS ULTRA", "DIRECTV BUSSINES", "HUGHESNET", "OPTIMUM", "VIASAT", "WINDSTREAM",
    "VIVINT", "KINETICK", "WOW", "ALTAFIBER", "ZYPLYFIBER", "CONSOLIDATE COMUNICATION", "BRIGHTSPEED", "EARTHLINK", "LINEA + CELULAR"
  ];

  fetch("/api/leads", {
    headers: {
      "Authorization": `Bearer ${localStorage.getItem('token')}`
    }
  })
    .then(res => res.json())
    .then(data => {
      if (!Array.isArray(data)) {
        console.error("Respuesta inesperada de /api/leads:", data);
        alert("No autorizado o error al obtener leads. Por favor inicia sesión.");
        return;
      }
      // Obtener el usuario activo del contexto global o de localStorage
      let usuarioActivo = window.usuario_actual;
      if (!usuarioActivo) {
        usuarioActivo = {
          nombre: localStorage.getItem('nombre') || '',
          rol: localStorage.getItem('rol') || ''
        };
        window.usuario_actual = usuarioActivo;
      }
      // Filtrar solo los leads del usuario activo (solo agentes ven su propia info)      
      let dataFiltrada = data;
      console.log('Leads recibidos:', data);
      console.log('Usuario activo:', usuarioActivo);
      if (usuarioActivo && usuarioActivo.nombre) {
        dataFiltrada = data.filter(lead => (lead.agente || lead.AGENTE) === usuarioActivo.nombre);
      }
      console.log('Leads filtrados:', dataFiltrada);

      // --- GRÁFICA DIARIA DE VENTAS Y PUNTAJE (Monday-Sunday) ---
      const diasSemana = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const ventasPorDia = [0, 0, 0, 0, 0, 0, 0];
      const puntajePorDia = [0, 0, 0, 0, 0, 0, 0];

      // Obtener la fecha seleccionada en el filtro (si existe)
      let fechaFiltro = document.getElementById('fechaGraficas')?.value;

      dataFiltrada.forEach(lead => {
        if (!lead.dia_venta) return;
        const fecha = new Date(lead.dia_venta);
        // Si hay filtro de fecha, solo contar ese día
        if (fechaFiltro) {
          const yyyy_mm_dd = fecha.toISOString().slice(0,10);
          if (yyyy_mm_dd !== fechaFiltro) return;
        }
        // getDay: 0=Sunday, 1=Monday... ajustamos para que 0=Monday
        let day = fecha.getDay();
        if (day === 0) day = 6; else day--;
        ventasPorDia[day]++;
         let puntaje = 0;
        if (lead.tipo_servicios && lead.tipo_servicios.trim().toUpperCase() === "AT&T AIR") {
          puntaje = 0.35;
        } else if (lead.puntaje !== undefined && lead.puntaje !== null && lead.puntaje !== '' && lead.puntaje !== 'Sin Puntaje') {
          puntaje = parseFloat(lead.puntaje) || 0;
        }
        puntajePorDia[day] += puntaje;
      });
      // Mostrar/ocultar mensaje de no datos
      document.getElementById('no-data-team').style.display = ventasPorDia.every(v => v === 0) ? '' : 'none';
      // Renderizar la gráfica en el canvas ventasTeamChart
      const ctx = document.getElementById('ventasTeamChart').getContext('2d');
      if (window.chartVentasPorDia) window.chartVentasPorDia.destroy();
      window.chartVentasPorDia = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: diasSemana,
          datasets: [
            {
              label: 'Ventas por día',
              data: ventasPorDia,
              backgroundColor: '#1976d2',
              borderRadius: 8
            },
            {
              label: 'Puntaje total por día',
              data: puntajePorDia,
              backgroundColor: '#e53935',
              borderRadius: 8
            }
          ]
        },
        options: {
          plugins: {
            legend: { display: true },
            tooltip: { enabled: true },
            datalabels: {
              anchor: 'end',
              align: 'end',
              color: '#111',
              font: { weight: 'bold', size: 13 },
              formatter: function(value) {
                return typeof value === 'number' ? value.toFixed(2) : value;
              }
            }
          },
          responsive: true,
          scales: {
            y: { beginAtZero: true }
          },
          animation: false
        },
        plugins: [ChartDataLabels]
      });
      // --- FIN GRÁFICA DIARIA ---

      // --- GRÁFICA DE PRODUCTOS ---
      // Contar ventas por producto
      let ventasPorProducto = {};
      productos.forEach(p => ventasPorProducto[p] = 0);
      dataFiltrada.forEach(lead => {
        if (lead.tipo_servicios) {
          // Normalizar ambos lados para coincidencia flexible
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
      // Mostrar/ocultar mensaje de no datos
      const totalVentasProd = Object.values(ventasPorProducto).reduce((a, b) => a + b, 0);
      document.getElementById('no-data-producto').style.display = totalVentasProd === 0 ? '' : 'none';
      const ctxProd = document.getElementById('productosChart').getContext('2d');
      if (window.chartProductos) window.chartProductos.destroy();
      window.chartProductos = new Chart(ctxProd, {
        type: 'bar',
        data: {
          labels: productos,
          datasets: [{
            label: 'Ventas por producto',
            data: productos.map(p => ventasPorProducto[p]),
            backgroundColor: '#43a047',
            borderRadius: 8
          }]
        },
        options: {
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          },
          responsive: true,
          scales: {
            y: { beginAtZero: true }
          },
          animation: false
        }
      });
    })
    .catch(err => console.error("Error al cargar datos de las gráficas:", err));
});
