const token = localStorage.getItem('token');
const API_URL =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://connecting-klf7.onrender.com";

const rol = localStorage.getItem('rol');

// --- Cargar y mostrar clientes ---
async function cargarClientes() {
  const resp = await fetch(`${API_URL}/api/leads`, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const clientes = await resp.json();
  mostrarClientes(clientes);
}

function mostrarClientes(clientes) {
  const tbody = document.querySelector('#tablaClientes tbody');
  tbody.innerHTML = '';
  clientes.forEach(cliente => {
    let acciones = `
      <button onclick="mostrarComentarioForm('${cliente._id}')">Comentar</button>
      <button onclick="enviarVentaExistente('${cliente._id}')">Enviar Venta</button>
    `;
    if (rol === 'admin') {
      acciones += `
        <button class="solo-admin" onclick="editarCliente('${cliente._id}')">Editar</button>
        <button class="solo-admin" onclick="eliminarCliente('${cliente._id}')">Eliminar</button>
        <button class="solo-admin" onclick="cambiarEstadoCliente('${cliente._id}')">Cambiar Estado</button>
      `;
    }
    tbody.innerHTML += `
      <tr>
        <td>${cliente.nombre}</td>
        <td>${cliente.email}</td>
        <td>${cliente.telefono}</td>
        <td>${cliente.agente || ''}</td>
        <td>${cliente.estado || ''}</td>
        <td>${acciones}</td>
      </tr>
    `;
  });
}

// --- Acciones de botones ---
function mostrarFormularioVenta() {
  document.getElementById('formularioVenta').style.display = '';
}
function mostrarFormularioCliente() {
  document.getElementById('formularioCliente').style.display = '';
}
function ocultarFormularios() {
  document.getElementById('formularioVenta').style.display = 'none';
  document.getElementById('formularioCliente').style.display = 'none';
  document.getElementById('comentarioFormSection').style.display = 'none';
}

// --- Enviar nueva venta (agente o admin) ---
document.getElementById('ventaForm').onsubmit = async function(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(this).entries());
  const resp = await fetch(`${API_URL}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(data)
  });
  if (resp.ok) {
    alert('Venta enviada');
    cargarClientes();
    ocultarFormularios();
  } else {
    alert('Error al enviar venta');
  }
};

// --- Enviar venta para cliente existente ---
async function enviarVentaExistente(id) {
  // Aquí puedes implementar lógica para enviar una venta existente, según tus reglas.
  alert('Función de enviar venta para cliente existente: personaliza según tu flujo.');
}

// --- Agregar/editar cliente (solo admin) ---
document.getElementById('clienteForm').onsubmit = async function(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(this).entries());
  let url = `${API_URL}/api/leads`;
  let method = 'POST';
  if (data.id) {
    url = `${API_URL}/api/leads/${data.id}`;
    method = 'PUT'; // Debes tener este endpoint en backend
  }
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(data)
  });
  if (resp.ok) {
    alert('Cliente guardado');
    cargarClientes();
    ocultarFormularios();
  } else {
    alert('Error al guardar cliente');
  }
};

// --- Editar cliente (solo admin) ---
async function editarCliente(id) {
  // Puedes hacer un fetch para obtener los datos y rellenar el formulario
  const resp = await fetch(`${API_URL}/api/leads`, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const clientes = await resp.json();
  const cliente = clientes.find(c => c._id === id);
  if (cliente) {
    const form = document.getElementById('clienteForm');
    form.nombre.value = cliente.nombre;
    form.email.value = cliente.email;
    form.telefono.value = cliente.telefono;
    form.estado.value = cliente.estado || 'nuevo';
    form.id.value = cliente._id;
    mostrarFormularioCliente();
  }
}

// --- Eliminar cliente (solo admin) ---
async function eliminarCliente(id) {
  if (!confirm('¿Seguro que deseas eliminar este cliente?')) return;
  const resp = await fetch(`${API_URL}/api/leads/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (resp.ok) {
    alert('Cliente eliminado');
    cargarClientes();
  } else {
    alert('No se pudo eliminar');
  }
}

// --- Cambiar estado de cliente (solo admin) ---
async function cambiarEstadoCliente(id) {
  const nuevoEstado = prompt('Nuevo estado (nuevo, contactado, vendido):');
  if (!nuevoEstado) return;
  const resp = await fetch(`${API_URL}/api/leads/${id}`, {
    method: 'PATCH', // Asegúrate de tener este endpoint en backend
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ estado: nuevoEstado })
  });
  if (resp.ok) {
    alert('Estado cambiado');
    cargarClientes();
  } else {
    alert('No se pudo cambiar el estado');
  }
}

// --- Comentar cliente (ambos roles) ---
function mostrarComentarioForm(id) {
  const formSection = document.getElementById('comentarioFormSection');
  formSection.style.display = '';
  document.getElementById('comentarioForm').id.value = id;
}
document.getElementById('comentarioForm').onsubmit = async function(e) {
  e.preventDefault();
  const id = this.id.value;
  const comentario = this.comentario.value;
  const resp = await fetch(`${API_URL}/api/leads/${id}/comentarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ comentario })
  });
  if (resp.ok) {
    alert('Comentario enviado');
    cargarClientes();
    ocultarFormularios();
  } else {
    alert('No se pudo comentar');
  }
};

// --- Logout ---
function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

// --- Inicialización ---
window.onload = cargarClientes;