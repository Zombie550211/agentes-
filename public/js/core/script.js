document.addEventListener("DOMContentLoaded", () => {
  // cargarDatosDesdeServidor(); // Comentado para evitar ReferenceError

  const form = document.getElementById("lead-form");
  if (form) {
    let enviandoLead = false; // Flag para evitar doble envío
    console.log('DEBUG: Inicializando flag enviandoLead =', enviandoLead);

    if (typeof window.renderGraficas === 'function') {
      window.renderGraficas();
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Prevenir doble envío
      console.log('DEBUG: Estado del flag antes de verificar:', enviandoLead);
      if (enviandoLead) {
        console.log('Ya se está enviando un lead, ignorando...');
        return;
      }
      console.log('DEBUG: Iniciando envío, estableciendo flag = true');
      enviandoLead = true;

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
        case 'PLEITEZ': team = 'TEAM PLEITEZ'; break;
        case 'ROBERTO': team = 'TEAM ROBERTO'; break;
        case 'IRANIA': team = 'TEAM IRANIA'; break;
        case 'MARISOL': team = 'TEAM MARISOL'; break;
        case 'RANDAL': team = 'TEAM RANDAL'; break;
        case 'JONATHAN': team = 'TEAM LINEAS'; break;
        default: team = supervisor ? `TEAM ${supervisor}` : '';
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
      console.log('DEBUG: === INICIO VALIDACIÓN PUNTAJE ===');
      console.log('DEBUG: Valor de team:', team);
      
      // Obtener el valor del select directamente del DOM para depuración
      const selectPuntaje = document.getElementById('puntaje');
      const valorSelect = selectPuntaje ? selectPuntaje.value : 'No encontrado';
      console.log('DEBUG: Valor del select (DOM):', valorSelect);
      
      // Obtener el valor de formData para comparar
      const puntajeFormData = formData.get('puntaje');
      console.log('DEBUG: Valor de formData.get(\'puntaje\'):', puntajeFormData);
      
      if (team === 'TEAM LINEAS') {
        console.log('DEBUG: Es TEAM LINEAS, asignando Sin Puntaje');
        lead.puntaje = 'Sin Puntaje';
      } else {
        let puntaje = formData.get('puntaje');
        console.log('DEBUG: Valor de puntaje (formData):', puntaje);
        console.log('DEBUG: Tipo de dato de puntaje:', typeof puntaje);
        
        // Asegura que el valor no sea vacío ni "Elige"
        if (puntaje === null || puntaje === undefined || puntaje === '' || puntaje === 'Elige') {
          console.log('DEBUG: Puntaje no válido, mostrando alerta');
          console.log('DEBUG: Razón - Valor:', puntaje, 'Tipo:', typeof puntaje);
          alert('Debes seleccionar un puntaje válido antes de guardar el lead.');
          return;
        }
        // Valida que sea un número
        if (isNaN(Number(puntaje))) {
          console.log('DEBUG: Puntaje no es un número válido');
          alert('El valor seleccionado en Puntaje no es válido.');
          return;
        }
        console.log('DEBUG: Puntaje válido, asignando:', parseFloat(puntaje));
        lead.puntaje = parseFloat(puntaje);
      }
      console.log('DEBUG: === FIN VALIDACIÓN PUNTAJE ===');

      // Enviar los datos al backend
      console.log('DEBUG LEAD ENVIADO:', lead);
      
      let response, result;
      try {
        response = await fetch('/api/leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(lead)
        });
        result = await response.json();
      } catch (err) {
        console.log('DEBUG: Error red - reseteando flag = false');
        enviandoLead = false; // Resetear flag en caso de error de red
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
        console.log('DEBUG: Éxito - reseteando flag = false');
        enviandoLead = false; // Resetear flag después del éxito
        
        // Actualizar la tabla y gráficas después de guardar
        if (typeof window.refrescarLeadsAgente === 'function') {
          console.log('DEBUG: Llamando a refrescarLeadsAgente para actualizar la vista');
          await window.refrescarLeadsAgente();
          
          // También forzar la actualización de las gráficas
          if (typeof window.renderGraficas === 'function') {
            console.log('DEBUG: Actualizando gráficas después de guardar');
            window.renderGraficas();
          }
        }
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
        console.log('DEBUG: Error backend - reseteando flag = false');
        enviandoLead = false; // Resetear flag después del error
      }
    });
  }
});

