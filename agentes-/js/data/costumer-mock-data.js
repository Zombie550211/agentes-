/**
 * Datos de ejemplo para la tabla de clientes
 * Este archivo proporciona datos mock para desarrollo y testing
 */

(function() {
  console.log('[COSTUMER MOCK DATA] Cargando datos de ejemplo...');

  // Datos de ejemplo
  const mockCustomers = [
    {
      _id: '1',
      nombre_cliente: 'Juan Pérez',
      telefono_principal: '555-0101',
      telefono_alterno: '555-0102',
      numero_cuenta: 'ACC-001',
      autopago: 'Sí',
      direccion: '123 Main St, Ciudad',
      tipo_servicios: 'Internet + TV',
      sistema: 'Fibra',
      riesgo: 'Bajo',
      dia_venta: '2025-01-15',
      dia_instalacion: '2025-01-20',
      status: 'Activo',
      servicios: 'Internet 500Mbps, TV Premium',
      mercado: 'Residencial',
      supervisor: 'Irania Serrano',
      comentario: 'Cliente satisfecho',
      motivo_llamada: 'Consulta',
      zip_code: '12345',
      puntaje: 95,
      agenteNombre: 'Daniel Martinez'
    },
    {
      _id: '2',
      nombre_cliente: 'María González',
      telefono_principal: '555-0201',
      telefono_alterno: '555-0202',
      numero_cuenta: 'ACC-002',
      autopago: 'No',
      direccion: '456 Oak Ave, Ciudad',
      tipo_servicios: 'Internet',
      sistema: 'Cable',
      riesgo: 'Medio',
      dia_venta: '2025-01-16',
      dia_instalacion: '2025-01-22',
      status: 'Pendiente',
      servicios: 'Internet 300Mbps',
      mercado: 'Residencial',
      supervisor: 'Bryan Pleitez',
      comentario: 'Requiere seguimiento',
      motivo_llamada: 'Instalación',
      zip_code: '12346',
      puntaje: 80,
      agenteNombre: 'Daniel Martinez'
    },
    {
      _id: '3',
      nombre_cliente: 'Carlos Rodríguez',
      telefono_principal: '555-0301',
      telefono_alterno: '555-0302',
      numero_cuenta: 'ACC-003',
      autopago: 'Sí',
      direccion: '789 Pine Rd, Ciudad',
      tipo_servicios: 'Internet + TV + Teléfono',
      sistema: 'Fibra',
      riesgo: 'Bajo',
      dia_venta: '2025-01-17',
      dia_instalacion: '2025-01-23',
      status: 'Activo',
      servicios: 'Paquete Triple Play',
      mercado: 'Empresarial',
      supervisor: 'Marisol Beltrán',
      comentario: 'Excelente cliente',
      motivo_llamada: 'Upgrade',
      zip_code: '12347',
      puntaje: 98,
      agenteNombre: 'Daniel Martinez'
    }
  ];

  /**
   * Obtener todos los clientes mock
   */
  function getMockCustomers() {
    return [...mockCustomers];
  }

  /**
   * Obtener cliente por ID
   */
  function getMockCustomerById(id) {
    return mockCustomers.find(c => c._id === id);
  }

  /**
   * Filtrar clientes por criterio
   */
  function filterMockCustomers(criteria) {
    return mockCustomers.filter(customer => {
      return Object.keys(criteria).every(key => {
        const value = criteria[key];
        if (typeof value === 'string') {
          return customer[key]?.toString().toLowerCase().includes(value.toLowerCase());
        }
        return customer[key] === value;
      });
    });
  }

  /**
   * Generar datos aleatorios adicionales
   */
  function generateRandomCustomers(count = 10) {
    const nombres = ['Ana', 'Luis', 'Carmen', 'Pedro', 'Laura', 'Miguel', 'Sofia', 'Diego'];
    const apellidos = ['García', 'Martínez', 'López', 'Hernández', 'González', 'Pérez', 'Rodríguez'];
    const sistemas = ['Fibra', 'Cable', 'DSL'];
    const riesgos = ['Bajo', 'Medio', 'Alto'];
    const status = ['Activo', 'Pendiente', 'Cancelado'];
    const mercados = ['Residencial', 'Empresarial'];

    const customers = [];
    for (let i = 0; i < count; i++) {
      const nombre = nombres[Math.floor(Math.random() * nombres.length)];
      const apellido = apellidos[Math.floor(Math.random() * apellidos.length)];
      
      customers.push({
        _id: `mock-${i + 4}`,
        nombre_cliente: `${nombre} ${apellido}`,
        telefono_principal: `555-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
        telefono_alterno: `555-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
        numero_cuenta: `ACC-${String(i + 4).padStart(3, '0')}`,
        autopago: Math.random() > 0.5 ? 'Sí' : 'No',
        direccion: `${Math.floor(Math.random() * 999) + 1} Street ${i}, Ciudad`,
        tipo_servicios: 'Internet',
        sistema: sistemas[Math.floor(Math.random() * sistemas.length)],
        riesgo: riesgos[Math.floor(Math.random() * riesgos.length)],
        dia_venta: new Date(2025, 0, Math.floor(Math.random() * 28) + 1).toISOString().split('T')[0],
        dia_instalacion: new Date(2025, 0, Math.floor(Math.random() * 28) + 1).toISOString().split('T')[0],
        status: status[Math.floor(Math.random() * status.length)],
        servicios: `Internet ${Math.floor(Math.random() * 500) + 100}Mbps`,
        mercado: mercados[Math.floor(Math.random() * mercados.length)],
        supervisor: 'Daniel Martinez',
        comentario: 'Cliente generado automáticamente',
        motivo_llamada: 'Consulta',
        zip_code: String(Math.floor(Math.random() * 90000) + 10000),
        puntaje: Math.floor(Math.random() * 40) + 60,
        agenteNombre: 'Daniel Martinez'
      });
    }
    
    return customers;
  }

  // Exponer API globalmente
  window.MockData = {
    getMockCustomers,
    getMockCustomerById,
    filterMockCustomers,
    generateRandomCustomers
  };

  console.log('[COSTUMER MOCK DATA] Datos cargados:', mockCustomers.length, 'clientes');
})();
