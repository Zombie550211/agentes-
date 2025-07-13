// guardar-lead.js

document.getElementById("crmForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const team = document.getElementById("team").value;
  const agent = document.getElementById("agent").value;
  const producto = document.getElementById("producto").value;
  const puntaje = parseFloat(document.getElementById("puntaje").value);
  const cuenta = document.getElementById("cuenta").value;
  const telefono = document.getElementById("telefono").value;
  const direccion = document.getElementById("direccion").value;
  const zip = document.getElementById("zip").value;

  if (
    team === "Seleccione team" || agent === "Seleccione Agente" ||
    producto === "Seleccione Producto" || isNaN(puntaje) ||
    cuenta === "Seleccione Cuenta" || telefono.trim() === "" ||
    direccion.trim() === "" || zip.trim() === ""
  ) {
    alert("Por favor, complete todos los campos.");
    return;
  }

  fetch("/guardar-lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team, agent, producto, puntaje, cuenta, telefono, direccion, zip })
  })
    .then(res => {
      if (!res.ok) throw new Error("Error al guardar el lead.");
      return res.json();
    })
    .then(() => {
      alert("Lead guardado exitosamente.");
      document.getElementById("crmForm").reset();
      location.reload(); // Refresca para mostrar cambios en gráficas
    })
    .catch(error => {
      console.error("Error:", error);
      alert("Hubo un error al guardar el lead.");
    });
});
