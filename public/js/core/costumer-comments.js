// Módulo de comentarios para la tabla Costumer
// Maneja: mostrar resumen, expandir panel, historial, añadir, guardar con usuario/fecha

window.toggleComentariosPanel = function(idx) {
  const panel = document.getElementById('comentarios-panel-' + idx);
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  }
};

window.enviarNuevoComentario = async function(idx, leadId) {
  const textarea = document.getElementById('nuevo-comentario-textarea-' + idx);
  const texto = textarea.value.trim();
  if (!texto) return;
  const usuario = window.usuario_actual ? window.usuario_actual.nombre : 'Desconocido';
  const fecha = new Date();
  const fechaStr = fecha.toLocaleDateString('es-MX') + ' ' + fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
  const comentarioObj = { autor: usuario, fecha: fechaStr, texto };
  // Guardar en backend
  await fetch(`/api/leads/${leadId}/comentarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(comentarioObj)
  });
  textarea.value = '';
  window.cargarDatosDesdeServidor();
};
