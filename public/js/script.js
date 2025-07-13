document.addEventListener("DOMContentLoaded", () => {
  cargarDatosDesdeServidor();

  const form = document.getElementById("lead-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const lead = {
        team: document.getElementById("team").value,
        agent: document.getElementById("agent").value,
        producto: document.getElementById("producto").value,
        puntaje: parseFloat(document.getElementById("puntaje").value),
        cuenta: document.getElementById("cuenta").value,
        telefono: document.getElementById("telefono").value,
        direccion: document.getElementById("direccion").value,
        zip: document.getElementById("zip").value
      };

      const response = await fetch("/guardar-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead)
      });

      const result = await response.json();
      if (response.ok) {
        alert("Lead guardado con éxito");
        cargarDatosDesdeServidor(); // vuelve a pintar con el nuevo lead
        form.reset();
      } else {
        alert("Hubo un error al guardar el lead.");
        console.error(result);
      }
    });
  }
});

let chartTeam, chartProducto;

async function cargarDatosDesdeServidor() {
  const res = await fetch("/api/leads");
  const leads = await res.json();
  actualizarGraficas(leads);
}

function actualizarGraficas(leads) {
  const teams = ["Team Irania", "Team Pleitez", "Team Roberto", "Team Lineas", "Team Randal", "Team Marisol"];
  const productos = [...new Set(leads.map(l => l.PRODUCTO))];

  const ventasPorTeam = {};
  const puntosPorTeam = {};
  const ventasPorProducto = {};

  teams.forEach(t => {
    ventasPorTeam[t] = 0;
    puntosPorTeam[t] = 0;
  });

  productos.forEach(p => {
    ventasPorProducto[p] = 0;
  });

  leads.forEach(lead => {
    const team = lead.TEAM;
    const producto = lead.PRODUCTO;
    const puntos = parseFloat(lead.PUNTOS || 0);

    if (ventasPorTeam[team] !== undefined) ventasPorTeam[team] += 1;
    if (puntosPorTeam[team] !== undefined && team !== "Team Lineas") puntosPorTeam[team] += puntos;

    if (ventasPorProducto[producto] !== undefined) ventasPorProducto[producto] += 1;
    else ventasPorProducto[producto] = 1;
  });

  const ctxTeam = document.getElementById("chartTeam").getContext("2d");
  const ctxProducto = document.getElementById("chartProducto").getContext("2d");

  if (chartTeam) chartTeam.destroy();
  if (chartProducto) chartProducto.destroy();

  chartTeam = new Chart(ctxTeam, {
    type: "bar",
    data: {
      labels: teams,
      datasets: [
        {
          label: "Ventas",
          backgroundColor: "blue",
          data: teams.map(t => ventasPorTeam[t])
        },
        {
          label: "Puntaje",
          backgroundColor: "red",
          data: teams.map(t => t === "Team Lineas" ? 0 : puntosPorTeam[t])
        }
      ]
    },
    options: {
      plugins: {
        legend: { position: "top" },
        tooltip: { enabled: true },
      },
      responsive: true,
      scales: {
        y: { beginAtZero: true }
      }
    }
  });

  chartProducto = new Chart(ctxProducto, {
    type: "bar",
    data: {
      labels: Object.keys(ventasPorProducto),
      datasets: [{
        label: "Ventas",
        backgroundColor: "green",
        data: Object.values(ventasPorProducto)
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
      }
    }
  });
}
