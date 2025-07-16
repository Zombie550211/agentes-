document.addEventListener("DOMContentLoaded", () => {
  cargarDatosDesdeServidor();

  const form = document.getElementById("lead-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Obtener datos del formulario Lead
      const formData = new FormData(form);
      // Mapeo explícito de campos según el formulario y la tabla Costumer
      const lead = {
        nombre_cliente: formData.get('nombre_cliente') || '',
        telefono_principal: formData.get('telefono_principal') || '',
        telefono_alterno: formData.get('telefono_alterno') || '',
        numero_cuenta: formData.get('numero_cuenta') || '',
        autopago: formData.get('autopago') || '',
        direccion: formData.get('direccion') || '',
        tipo_servicios: formData.get('tipo_servicios') || '',
        sistema: formData.get('sistema') || '',
        riesgo: formData.get('riesgo') || '',
        dia_venta: formData.get('dia_venta') || '',
        dia_instalacion: formData.get('dia_instalacion') || '',
        status: formData.get('status') || '',
        servicios: formData.get('servicios') || '',
        mercado: formData.get('mercado') || '',
        supervisor: formData.get('supervisor') || '',
        comentario: formData.get('comentario') || '',
        motivo_llamada: formData.get('motivo_llamada') || '',
        zip_code: formData.get('zip_code') || ''
      };

      // Asignar automáticamente el TEAM según SUPERVISOR
      const supervisor = lead.supervisor ? lead.supervisor.trim().toUpperCase() : '';
      let team = '';
      switch (supervisor) {
        case 'PLEITEZ': team = 'Team Pleitez'; break;
        case 'ROBERTO': team = 'Team Roberto'; break;
        case 'IRANIA': team = 'Team Irania'; break;
        case 'MARISOL': team = 'Team Marisol'; break;
        case 'RANDAL': team = 'Team Randal'; break;
        case 'JONATHAN': team = 'Team Lineas'; break;
        default: team = '';
      }
      lead.team = team;

      // El campo agente se toma del usuario autenticado (window.usuario_actual)
      if (window.usuario_actual && window.usuario_actual.nombre) {
        lead.agente = window.usuario_actual.nombre;
      }

      // Validar que todos los campos requeridos del formulario estén presentes
      const camposRequeridos = [
        'nombre_cliente', 'telefono_principal', 'telefono_alterno', 'numero_cuenta',
        'autopago', 'direccion', 'tipo_servicios', 'sistema', 'riesgo',
        'dia_venta', 'dia_instalacion', 'status', 'servicios', 'mercado',
        'supervisor', 'comentario', 'motivo_llamada', 'zip_code'
      ];
      let camposFaltantes = [];
      camposRequeridos.forEach(campo => {
        if (!lead[campo] || lead[campo].toString().trim() === '') {
          camposFaltantes.push(campo.replace(/_/g, ' '));
        }
      });
      if (camposFaltantes.length > 0) {
        alert('Faltan campos obligatorios: ' + camposFaltantes.join(', '));
        return;
      }

      // Validar puntaje antes de enviar
      if (team === 'Team Lineas') {
        lead.puntaje = 'Sin Puntaje';
      } else {
        let puntaje = formData.get('puntaje');
        if (!puntaje || isNaN(puntaje)) {
          alert('El campo Puntaje es obligatorio y debe ser un número válido.');
          return;
        }
        lead.puntaje = parseFloat(puntaje);
      }

      // Enviar los datos al backend
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem('token')}` },
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
  renderCostumerTable(leads);
  // Las gráficas ahora se renderizan solo desde graficas.js

}

// Renderizado profesional y alineado de la tabla Costumer
function renderCostumerTable(leads) {
  const tbody = document.getElementById('costumer-tbody');
  tbody.innerHTML = '';
  if (!leads || leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="21" style="text-align:center;padding:2em;">No hay registros para mostrar.</td></tr>`;
    return;
  }
  leads.forEach((lead, idx) => {
    const rowClass = idx % 2 === 0 ? 'costumer-row-striped' : '';
    tbody.innerHTML += `
      <tr class="${rowClass}">
        <td class="td-ellipsis" title="${lead.nombre_cliente || ''}">${lead.nombre_cliente || ''}</td>
        <td class="td-nowrap" title="${lead.telefono_principal || ''}">${lead.telefono_principal || ''}</td>
        <td class="td-nowrap" title="${lead.telefono_alterno || 'N/A'}">${lead.telefono_alterno || 'N/A'}</td>
        <td class="td-nowrap" title="${lead.numero_cuenta || 'N/A'}">${lead.numero_cuenta || 'N/A'}</td>
        <td class="td-nowrap" title="${lead.autopago || ''}">${lead.autopago || ''}</td>
        <td class="td-ellipsis" title="${lead.direccion || ''}">${lead.direccion || ''}</td>
        <td class="td-ellipsis" title="${lead.tipo_servicios || ''}">${lead.tipo_servicios || ''}</td>
        <td class="td-ellipsis" title="${lead.sistema || ''}">${lead.sistema || ''}</td>
        <td class="td-nowrap" title="${lead.riesgo || ''}">${lead.riesgo || ''}</td>
        <td class="td-nowrap" title="${lead.dia_venta || ''}">${lead.dia_venta || ''}</td>
        <td class="td-nowrap" title="${lead.dia_instalacion || ''}">${lead.dia_instalacion || ''}</td>
        <td class="td-nowrap"><span class="badge-status badge-status-${(lead.status||'').toLowerCase()}">${lead.status || ''}</span></td>
        <td class="td-ellipsis" title="${lead.servicios || ''}">${lead.servicios || ''}</td>
        <td class="td-ellipsis" title="${lead.mercado || ''}">${lead.mercado || ''}</td>
        <td class="td-ellipsis" title="${lead.supervisor || ''}">${lead.supervisor || ''}</td>
        <td class="td-ellipsis" title="${lead.comentario || ''}">${lead.comentario || ''}</td>
        <td class="td-ellipsis" title="${lead.motivo_llamada || ''}">${lead.motivo_llamada || ''}</td>
        <td class="td-nowrap" title="${lead.zip_code || ''}">${lead.zip_code || ''}</td>
        <td class="td-nowrap" title="${lead.puntaje !== undefined ? lead.puntaje : 0}">${lead.puntaje !== undefined ? lead.puntaje : 0}</td>
        <td class="td-ellipsis">
          ${Array.isArray(lead.comentarios_venta) && lead.comentarios_venta.length > 0
            ? `<button class='comentarios-btn' onclick='toggleComentariosPanel(${idx})' title='Ver comentarios'>${lead.comentarios_venta[lead.comentarios_venta.length-1].texto.split("\n")[0].slice(0,40)}${lead.comentarios_venta[lead.comentarios_venta.length-1].texto.length>40?'...':''}</button>`
            : `<button class='comentarios-btn' onclick='toggleComentariosPanel(${idx})'>Añadir comentario</button>`}
        </td>
        <td class="td-nowrap">
          <button class="costumer-action-btn edit" title="Editar cliente" onclick="editarClienteModal('${lead._id || ''}')" ${!window.usuario_actual || !['admin','BO'].includes(window.usuario_actual.rol) ? 'disabled' : ''}>
            <i class="fas fa-pencil-alt"></i>
          </button>
          <button class="costumer-action-btn delete" title="Eliminar cliente" onclick="confirmarEliminarCliente('${lead._id || ''}')" ${!window.usuario_actual || !['admin','BO'].includes(window.usuario_actual.rol) ? 'disabled' : ''}>
            <i class="fas fa-trash-alt"></i>
          </button>
        </td>
      </tr>
      <tr id="comentarios-panel-${idx}" class="comentarios-panel-row" style="display:none;"><td colspan="21" style="background:#f9fafd;padding:0;">
        <div class="comentarios-panel" id="comentarios-panel-${idx}">
          <div style="font-weight:600;color:#1976d2;margin-bottom:0.5em;">Comentarios</div>
          <div>
            ${(Array.isArray(lead.comentarios_venta) && lead.comentarios_venta.length > 0)
              ? lead.comentarios_venta.map(com => `<div class='comentario-item'><div class='comentario-meta'>${com.autor} ${com.fecha}</div>${com.texto}</div>`).join('')
              : '<div class="comentario-item" style="color:#888;">Sin comentarios previos.</div>'}
          </div>
          <form class="nuevo-comentario-form" onsubmit="event.preventDefault(); enviarNuevoComentario(${idx}, '${lead._id || ''}')">
            <textarea id="nuevo-comentario-textarea-${idx}" maxlength="300" placeholder="Escribe un nuevo comentario..."></textarea>
            <button type="submit">Añadir</button>
          </form>
        </div>
      </td></tr>
    `;
  });
}