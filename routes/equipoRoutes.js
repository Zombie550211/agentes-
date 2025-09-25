const express = require('express');
const router = express.Router();
const equipoController = require('../controllers/equipoController');
const { protect, authorize } = require('../middleware/auth');

/**
 * @swagger
 * /api/equipos/estadisticas:
 *   get:
 *     summary: Obtiene estadísticas de equipos
 *     description: Devuelve estadísticas agregadas de los equipos con filtros opcionales
 *     tags: [Equipos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: fechaInicio
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha de inicio para filtrar (YYYY-MM-DD)
 *       - in: query
 *         name: fechaFin
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha de fin para filtrar (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Estadísticas de equipos obtenidas correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       TEAM:
 *                         type: string
 *                       Icon:
 *                         type: number
 *                       BAMO:
 *                         type: number
 *                       Total:
 *                         type: number
 *                       Puntaje:
 *                         type: number
 *                       Cali:
 *                         type: number
 *                       Repro:
 *                         type: number
 *                 total:
 *                   type: number
 *                 fechaInicio:
 *                   type: string
 *                 fechaFin:
 *                   type: string
 *       500:
 *         description: Error al obtener las estadísticas
 */
router.get('/estadisticas', protect, equipoController.obtenerEstadisticasEquipos);

/**
 * @swagger
 * /api/equipos/lista:
 *   get:
 *     summary: Obtiene la lista de equipos únicos
 *     description: Devuelve una lista de todos los equipos únicos en la base de datos
 *     tags: [Equipos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de equipos obtenida correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *                 total:
 *                   type: number
 *       500:
 *         description: Error al obtener la lista de equipos
 */
router.get('/lista', protect, equipoController.obtenerListaEquipos);

/**
 * @swagger
 * /api/equipos/test:
 *   get:
 *     summary: Endpoint de prueba para verificar conexión
 *     description: Devuelve datos de prueba sin consultar la base de datos
 *     tags: [Equipos]
 *     responses:
 *       200:
 *         description: Datos de prueba devueltos correctamente
 */
router.get('/test', protect, (req, res) => {
  const datosPrueba = [
    { TEAM: 'TEAM IRANIA', ICON: 8, BAMO: 7, Total: 15, Puntaje: 46.7 },
    { TEAM: 'TEAM ROBERTO VELASQUEZ', ICON: 12, BAMO: 11, Total: 23, Puntaje: 47.8 },
    { TEAM: 'TEAM BRYAN PLEITEZ', ICON: 9, BAMO: 9, Total: 18, Puntaje: 50.0 },
    { TEAM: 'TEAM MARISOL BELTRAN', ICON: 6, BAMO: 6, Total: 12, Puntaje: 50.0 },
    { TEAM: 'TEAM RANDAL MARTINEZ', ICON: 11, BAMO: 9, Total: 20, Puntaje: 45.0 },
    { TEAM: 'TEAM LINEA', ICON: 4, BAMO: 4, Total: 8, Puntaje: 50.0 }
  ];
  
  res.json({
    success: true,
    data: datosPrueba,
    total: datosPrueba.length,
    message: 'Datos de prueba - endpoint funcionando correctamente'
  });
});

// Endpoint de debug para verificar datos reales
router.get('/debug', protect, equipoController.debugCostumers);

module.exports = router;
