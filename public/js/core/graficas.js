document.addEventListener("DOMContentLoaded", () => {
  const equipos = ["Team Irania", "Team Pleitez", "Team Roberto", "Team Lineas", "Team Randal", "Team Marisol"];
  const productos = [
    "225 AT&T AIR", "18 AT&T", "25 AT&T", "50 AT&T", "75 AT&T", "100 AT&T", "300 AT&T", "500 AT&T", "1G AT&T", "5G AT&T",
    "2GB SPECTRUM", "1GB SPECTRUM", "500 SPECTRUM", "200 SPECTRUM", "SPECTRUM BUSSINES", "SPECTRUM PREMIER", "SPECTRUM ADVENTAGE",
    "5GB FRONTIER", "2GB FRONTIER", "1GB FRONTIER", "500 FRONTIER", "200 FRONTIER",
    "OPTIMO MAS", "MAS LATINO", "MAS ULTRA", "DIRECTV BUSSINES", "HUGHESNET", "OPTIMUM", "VIASAT", "WINDSTREAM",
    "VIVINT", "KINETICK", "WOW", "ALTAFIBER", "ZYPLYFIBER", "CONSOLIDATE COMUNICATION", "BRIGHTSPEED", "EARTHLINK", "LINEA + CELULAR"
  ];

  fetch("/api/leads")
    .then(res => res.json())
    .then(data => {
      // Obtener el usuario activo del contexto global (debe existir en el HTML principal)
      const usuarioActivo = window.usuario_actual || { nombre: '', rol: '' };
      // Filtrar solo los leads del usuario activo (solo agentes ven su propia info)
      let dataFiltrada = data;
      if (usuarioActivo.rol !== 'bo') {
        dataFiltrada = data.filter(lead => lead.AGENTE === usuarioActivo.nombre);
      }

      const ventasPorEquipo = {};
      const puntosPorEquipo = {};
      const ventasPorProducto = {};

      equipos.forEach(e => {
        ventasPorEquipo[e] = 0;
        puntosPorEquipo[e] = 0;
      });
      productos.forEach(p => ventasPorProducto[p] = 0);

      dataFiltrada.forEach(lead => {
        if (!lead.TEAM || !lead.PRODUCTO) return;
        ventasPorEquipo[lead.TEAM] += 1;
        if (lead.TEAM !== "Team Lineas") {
          puntosPorEquipo[lead.TEAM] += parseFloat(lead.PUNTOS || 0);
        }
        ventasPorProducto[lead.PRODUCTO] += 1;
      });

      actualizarGraficas(Object.entries(ventasPorEquipo).map(([TEAM, v]) => ({ TEAM, PUNTOS: puntosPorEquipo[TEAM], PRODUCTO: null })))
    })
    .catch(err => console.error("Error al cargar datos de las gráficas:", err));
});
