const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect } = require('../middleware/auth');

/**
 * Normalizar número telefónico (eliminar todo excepto dígitos)
 */
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * @route POST /api/leads/bulk-status-by-phone
 * @desc Cambio masivo de status por números telefónicos
 * @access Private (Administrador, Backoffice)
 */
router.post('/bulk-status-by-phone', protect, async (req, res) => {
  try {
    const { phones, newStatus } = req.body;

    // Validaciones
    if (!Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Debe proporcionar al menos un número telefónico' 
      });
    }

    if (!newStatus) {
      return res.status(400).json({ 
        success: false, 
        message: 'Debe especificar el nuevo status' 
      });
    }

    // Verificar permisos (solo admin y backoffice)
    const userRole = String(req.user?.role || '').toLowerCase().trim();
    const isAdmin = userRole === 'admin' || userRole === 'administrador';
    const isBackoffice = userRole === 'backoffice' || userRole === 'back office' || userRole === 'back_office';
    const isRolIcon = userRole === 'rol_icon' || userRole === 'rol-icon';

    if (!isAdmin && !isBackoffice && !isRolIcon) {
      return res.status(403).json({ 
        success: false, 
        message: 'No tienes permisos para realizar cambios masivos de status' 
      });
    }

    const db = getDb();
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error de conexión a la base de datos' 
      });
    }

    // Normalizar números telefónicos
    const normalizedPhones = phones.map(normalizePhone).filter(p => p.length >= 10);

    if (normalizedPhones.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No se detectaron números telefónicos válidos' 
      });
    }

    console.log(`[BULK STATUS BY PHONE] Usuario: ${req.user?.username}, Números: ${normalizedPhones.length}, Nuevo status: ${newStatus}`);

    // Buscar leads en costumers_unified que coincidan con los números
    const collection = db.collection('costumers_unified');

    // ESTRATEGIA MEJORADA: Buscar todos los leads que tengan teléfono o teléfono alterno
    // y luego comparar normalizando en memoria
    console.log(`[BULK STATUS PHONE] Buscando leads con teléfono...`);
    
    // Obtener todos los leads que tienen algún teléfono
    const allLeadsWithPhones = await collection.find({
      $or: [
        { telefono: { $exists: true, $ne: null, $ne: '' } },
        { telefono_alterno: { $exists: true, $ne: null, $ne: '' } },
        { telefono_principal: { $exists: true, $ne: null, $ne: '' } }
      ]
    }).toArray();
    
    console.log(`[BULK STATUS PHONE] Total leads con teléfono: ${allLeadsWithPhones.length}`);
    
    // Crear un mapa de teléfono normalizado -> lead
    const phoneToLeadMap = new Map();
    allLeadsWithPhones.forEach(lead => {
      const phone1 = normalizePhone(lead.telefono);
      const phone2 = normalizePhone(lead.telefono_alterno);
      const phone3 = normalizePhone(lead.telefono_principal);
      
      // DEBUG: Verificar si este lead tiene el número 5593556760
      if (phone1 === '5593556760' || phone2 === '5593556760' || phone3 === '5593556760') {
        console.log(`[BULK STATUS DEBUG] Lead con 5593556760 encontrado:`, {
          _id: lead._id,
          telefono_raw: lead.telefono,
          telefono_norm: phone1,
          telefono_alterno_raw: lead.telefono_alterno,
          telefono_alterno_norm: phone2,
          telefono_principal_raw: lead.telefono_principal,
          telefono_principal_norm: phone3
        });
      }
      
      if (phone1 && phone1.length >= 10) {
        if (!phoneToLeadMap.has(phone1)) {
          phoneToLeadMap.set(phone1, []);
        }
        phoneToLeadMap.get(phone1).push(lead);
      }
      if (phone3 && phone3.length >= 10 && phone3 !== phone1 && phone3 !== phone2) {
        if (!phoneToLeadMap.has(phone3)) {
          phoneToLeadMap.set(phone3, []);
        }
        phoneToLeadMap.get(phone3).push(lead);
      }
    });
    
    // DEBUG: Verificar si 5593556760 está en el mapa
    console.log(`[BULK STATUS DEBUG] ¿5593556760 en el mapa?:`, phoneToLeadMap.has('5593556760'));
    console.log(`[BULK STATUS DEBUG] Total números en mapa:`, phoneToLeadMap.size);
    
    // DEBUG: Buscar números que comiencen con 559
    const numbersStartingWith559 = Array.from(phoneToLeadMap.keys()).filter(p => p.startsWith('559'));
    console.log(`[BULK STATUS DEBUG] Números que comienzan con 559:`, numbersStartingWith559.slice(0, 10));
    
    console.log(`[BULK STATUS PHONE] Mapa de teléfonos creado con ${phoneToLeadMap.size} números únicos`);
    
    // Encontrar leads que coincidan con los números de entrada
    const leadsToUpdate = [];
    const foundPhoneNumbers = new Set();
    
    normalizedPhones.forEach(inputPhone => {
      const matchingLeads = phoneToLeadMap.get(inputPhone);
      if (matchingLeads) {
        foundPhoneNumbers.add(inputPhone);
        matchingLeads.forEach(lead => {
          if (!leadsToUpdate.find(l => l._id.toString() === lead._id.toString())) {
            leadsToUpdate.push(lead);
          }
        });
      }
    });
    
    console.log(`[BULK STATUS PHONE] Números de entrada encontrados: ${foundPhoneNumbers.size}`);
    console.log(`[BULK STATUS PHONE] Leads únicos a actualizar: ${leadsToUpdate.length}`);

    if (leadsToUpdate.length === 0) {
      return res.json({
        success: true,
        message: 'No se encontraron leads con los números proporcionados',
        updated: 0,
        notFound: normalizedPhones.length
      });
    }

    // Actualizar status de los leads encontrados
    // Crear query usando los IDs de los leads encontrados
    const leadIds = leadsToUpdate.map(lead => lead._id);
    const updateQuery = { _id: { $in: leadIds } };
    
    const updateResult = await collection.updateMany(
      updateQuery,
      { 
        $set: { 
          status: newStatus,
          updatedAt: new Date(),
          updatedBy: req.user?.username || req.user?.name || 'Sistema'
        } 
      }
    );

    console.log(`[BULK STATUS BY PHONE] Leads actualizados: ${updateResult.modifiedCount}`);

    // Calcular cuántos números no se encontraron
    const notFoundPhones = normalizedPhones.filter(p => !foundPhoneNumbers.has(p));
    const notFoundCount = notFoundPhones.length;
    
    // Crear lista de números que sí se encontraron y actualizaron
    const foundPhonesList = Array.from(foundPhoneNumbers);
    const foundCount = foundPhonesList.length;

    res.json({
      success: true,
      message: `Status actualizado exitosamente para ${updateResult.modifiedCount} lead(s)`,
      updated: updateResult.modifiedCount,
      found: foundCount,
      foundPhones: foundPhonesList,
      notFound: notFoundCount,
      notFoundPhones: notFoundPhones,
      totalPhones: normalizedPhones.length
    });

  } catch (error) {
    console.error('[BULK STATUS BY PHONE] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor',
      error: error.message 
    });
  }
});

module.exports = router;
