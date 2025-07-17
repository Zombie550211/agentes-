document.addEventListener("DOMContentLoaded", () => {
  // cargarDatosDesdeServidor(); // Comentado para evitar ReferenceError

  const form = document.getElementById("lead-form");
  if (form) {
    let enviandoLead = false; // Flag para evitar doble envío

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
      // Quita 'puntaje' de la lista de campos requeridos generales, ya que se valida aparte
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
        // Asegura que el valor no sea vacío ni "Elige"
        if (puntaje === null || puntaje === undefined || puntaje === '' || puntaje === 'Elige') {
          alert('Debes seleccionar un puntaje válido antes de guardar el lead.');
          return;
        }
        // Valida que sea un número
        if (isNaN(Number(puntaje))) {
          alert('El valor seleccionado en Puntaje no es válido.');
          return;
        }
        lead.puntaje = parseFloat(puntaje);
      }

      // Enviar los datos al backend
      console.log('DEBUG LEAD ENVIADO:', lead); // LOG TEMPORAL PARA DEPURACIÓN
      // Validar que haya token antes de enviar
      const token = localStorage.getItem('token');
      if (!token) {
        alert('No tienes sesión activa. Por favor, inicia sesión nuevamente.');
        return;
      }

      let response, result;
      try {
        response = await fetch('/api/leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify(lead)
        });
        result = await response.json();
      } catch (err) {
        alert('Error de red al intentar guardar el lead. Intenta de nuevo.');
        return;
      }

      if (response.ok && result.ok) {
        Swal.fire({
          icon: 'success',
          title: '¡Éxito!',
          text: 'Lead guardado con éxito',
          confirmButtonText: 'OK',
          customClass: { popup: 'swal2-popup' }
        });
        form.reset();
      } else {
        // Mostrar mensaje de error del backend si existe
        let mensaje = (result && result.error) ? result.error : 'Hubo un error al guardar el lead.';
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: mensaje,
          confirmButtonText: 'OK',
          customClass: { popup: 'swal2-popup' }
        });
        if (result) console.error(result);
      }
    });
  }
});

