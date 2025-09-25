// Archivo para manejar datos de clientes del backend
console.log('Módulo de datos de clientes cargado correctamente');

/**
 * Genera datos de prueba realistas para clientes
 * @returns {Array} Lista de clientes de ejemplo
 */
function generarDatosDePrueba() {
  const nombres = ['Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Laura', 'Pedro', 'Sofía', 'Diego', 'Valentina'];
  const apellidos = ['González', 'Rodríguez', 'Gómez', 'Fernández', 'López', 'Martínez', 'Pérez', 'García', 'Sánchez', 'Romero'];
  const empresas = ['TecnoSol', 'InnovaCorp', 'GlobalTech', 'Soluciones Web', 'DigitalMind', 'FutureSoft', 'TechNova', 'WebMasters', 'DataLogic', 'CloudSystems'];
  const estados = ['Nuevo', 'Contactado', 'Calificado', 'En negociación', 'Ganado', 'Perdido', 'Renovación'];
  const fuentes = ['Web', 'Referido', 'Redes Sociales', 'Email', 'Evento', 'Llamada en frío', 'Publicidad'];
  const productos = ['Hosting Básico', 'Hosting Premium', 'Dominio .com', 'Certificado SSL', 'Diseño Web', 'Tienda Online', 'Mantenimiento Web'];
  
  const clientes = [];
  const hoy = new Date();
  
  for (let i = 1; i <= 20; i++) {
    const nombre = nombres[Math.floor(Math.random() * nombres.length)];
    const apellido = apellidos[Math.floor(Math.random() * apellidos.length)];
    const empresa = empresas[Math.floor(Math.random() * empresas.length)];
    const estado = estados[Math.floor(Math.random() * estados.length)];
    const fuente = fuentes[Math.floor(Math.random() * fuentes.length)];
    const producto = productos[Math.floor(Math.random() * productos.length)];
    
    // Generar fechas aleatorias de los últimos 30 días
    const fecha = new Date();
    fecha.setDate(hoy.getDate() - Math.floor(Math.random() * 30));
    
    // Generar monto aleatorio entre 100 y 5000
    const monto = Math.floor(Math.random() * 4900) + 100;
    
    clientes.push({
      id: 1000 + i,
      nombre: `${nombre} ${apellido}`,
      email: `${nombre.toLowerCase()}.${apellido.toLowerCase()}@ejemplo.com`,
      telefono: `+52 55 ${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(1000 + Math.random() * 9000)}`,
      empresa: empresa,
      puesto: 'Gerente',
      estado: estado,
      fuente: fuente,
      producto: producto,
      fecha_contacto: fecha.toISOString().split('T')[0],
      proximo_contacto: new Date(fecha.setDate(fecha.getDate() + Math.floor(Math.random() * 30) + 1)).toISOString().split('T')[0],
      monto: monto,
      moneda: 'MXN',
      prioridad: ['Baja', 'Media', 'Alta'][Math.floor(Math.random() * 3)],
      notas: `Cliente interesado en ${producto.toLowerCase()}. ${['Muy interesado', 'Interesado', 'Poco interesado'][Math.floor(Math.random() * 3)]} en nuestra oferta.`,
      direccion: {
        calle: `Calle ${Math.floor(Math.random() * 100) + 1}`,
        colonia: 'Centro',
        ciudad: 'Ciudad de México',
        estado: 'CDMX',
        cp: '01000',
        pais: 'México'
      },
      redes_sociales: {
        linkedin: `linkedin.com/in/${nombre.toLowerCase()}${apellido.toLowerCase()}`,
        twitter: `@${nombre.toLowerCase()}${apellido[0].toLowerCase()}`
      },
      historial: [
        {
          fecha: new Date().toISOString(),
          accion: 'Contacto inicial',
          descripcion: 'Se realizó primer contacto vía ' + ['llamada', 'email', 'redes sociales'][Math.floor(Math.random() * 3)],
          usuario: 'Sistema'
        }
      ]
    });
  }
  
  return clientes;
}

/**
 * Obtiene los datos de clientes desde el backend o genera datos de prueba si falla
 * @returns {Promise<Array>} Lista de clientes
 */
async function fetchCustomersData() {
  try {
    // Generamos los datos de prueba
    const datosPrueba = generarDatosDePrueba();
    
    // Formatear los datos para que coincidan con la estructura esperada por la tabla
    const leadsFormateados = datosPrueba.map(cliente => ({
      _id: `mock_${cliente.id}`,
      nombre_cliente: cliente.nombre,
      telefono_principal: cliente.telefono,
      telefono_alterno: `+52 55 ${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(1000 + Math.random() * 9000)}`,
      numero_cuenta: `C-${Math.floor(10000 + Math.random() * 90000)}`,
      autopago: Math.random() > 0.5 ? 'Sí' : 'No',
      direccion: cliente.direccion.calle + ', ' + cliente.direccion.colonia + ', ' + cliente.direccion.ciudad,
      tipo_servicios: cliente.producto,
      sistema: Math.random() > 0.5 ? 'Activo' : 'Inactivo',
      riesgo: ['Bajo', 'Medio', 'Alto'][Math.floor(Math.random() * 3)],
      dia_venta: cliente.fecha_contacto,
      // Estado del cliente (uno de los tres estados: Pendiente, Cancelados, Activos)
      estado: ['Pendiente', 'Cancelados', 'Activos'][Math.floor(Math.random() * 3)],
      status: ['Pendiente', 'Cancelados', 'Activos'][Math.floor(Math.random() * 3)],
      servicios: cliente.producto,
      mercado: ['Residencial', 'Empresarial', 'Gobierno'][Math.floor(Math.random() * 3)],
      supervisor: ['Juan Pérez', 'María García', 'Carlos López'][Math.floor(Math.random() * 3)],
      comentario: cliente.notas,
      motivo_llamada: ['Consulta', 'Soporte', 'Venta', 'Cobranza'][Math.floor(Math.random() * 4)],
      zip_code: cliente.direccion.cp,
      puntaje: Math.floor(Math.random() * 10) + 1,
      comentarios_venta: cliente.historial[0].descripcion,
      empresa: cliente.empresa,
      email: cliente.email
    }));
    
    console.log('Datos de prueba generados para la tabla:', leadsFormateados);
    
    // Inyectar algunos leads específicos del flujo real (TEAM MARISOL / Eduardo R.)
    try {
      const hoyISO = new Date().toISOString().slice(0,10); // YYYY-MM-DD
      const extras = [
        {
          _id: `mock_marisol_edur_1`,
          nombre_cliente: 'Cliente Demo 1',
          telefono_principal: '+1 786 555 0101',
          telefono_alterno: '+1 786 555 0102',
          numero_cuenta: 'C-EDU-1001',
          autopago: 'Sí',
          direccion: '123 Demo St, Miami FL 33176',
          tipo_servicios: 'ATT 1G+',
          sistema: 'SARA',
          riesgo: 'Bajo',
          dia_venta: hoyISO,
          dia_instalacion: hoyISO,
          status: 'Completed',
          servicios: 'att-1g-plus',
          mercado: 'ICON',
          supervisor: 'TEAM MARISOL',
          team: 'TEAM MARISOL',
          comentario: 'Venta demo para validar filtro de agente',
          motivo_llamada: 'VENTA',
          zip_code: '33176',
          puntaje: 2,
          comentarios_venta: 'Cliente cerró con autopago.',
          agenteNombre: 'Eduardo R.',
          agente: 'Eduardo R.'
        },
        {
          _id: `mock_marisol_edur_2`,
          nombre_cliente: 'Cliente Demo 2',
          telefono_principal: '+1 786 555 0201',
          telefono_alterno: '+1 786 555 0202',
          numero_cuenta: 'C-EDU-1002',
          autopago: 'No',
          direccion: '456 Example Ave, Miami FL 33176',
          tipo_servicios: 'XFINITY',
          sistema: 'SARA',
          riesgo: 'Medio',
          dia_venta: hoyISO,
          dia_instalacion: hoyISO,
          status: 'Pending',
          servicios: 'xfinity-internet',
          mercado: 'ICON',
          supervisor: 'TEAM MARISOL',
          team: 'TEAM MARISOL',
          comentario: 'Pendiente de confirmación de instalación',
          motivo_llamada: 'VENTA',
          zip_code: '33176',
          puntaje: 1.5,
          comentarios_venta: 'Cliente interesado, falta confirmar.',
          agenteNombre: 'Eduardo R.',
          agente: 'Eduardo R.'
        }
      ];
      leadsFormateados.unshift(...extras);
      console.log('[MOCK] Inyectados leads de TEAM MARISOL / Eduardo R.:', extras.length);
    } catch (_) {}

    // Devolver en el formato que espera la aplicación
    return { 
      success: true, 
      leads: leadsFormateados,
      message: 'Datos de prueba cargados correctamente'
    };
    
  } catch (error) {
    console.error('Error al generar datos de prueba:', error);
    return {
      success: false,
      leads: [],
      message: 'Error al generar datos de prueba: ' + error.message
    };
  }
}

// Función para simular una llamada a la API
async function fetchMockCostumerData() {
  return new Promise((resolve) => {
    // Simular tiempo de respuesta de la API
    setTimeout(() => {
      const data = generarDatosDePrueba();
      resolve(data);
    }, 800);
  });
}

// Función auxiliar para mostrar notificaciones (solo en consola)
function showNotification(message, type = 'info') {
  // Mostrar solo en consola para evitar notificaciones molestas
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  // Opcional: Si necesitas ver los mensajes en la interfaz, puedes descomentar esto:
  // if (typeof window.showNotification === 'function') {
  //   window.showNotification(message, type);
  // }
}
