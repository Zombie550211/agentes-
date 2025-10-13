/**
 * Script para verificar qué campos de teléfono existen en la base de datos
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function checkPhoneFields() {
  try {
    console.log('Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✓ Conectado\n');
    
    const db = mongoose.connection.db;
    
    // Verificar colección Leads
    console.log('=== COLECCIÓN: leads ===');
    const leadsCount = await db.collection('leads').countDocuments();
    console.log(`Total documentos: ${leadsCount}`);
    
    if (leadsCount > 0) {
      const sampleLead = await db.collection('leads').findOne();
      console.log('\nCampos de ejemplo:');
      console.log('- telefono:', sampleLead.telefono || 'NO EXISTE');
      console.log('- telefono_principal:', sampleLead.telefono_principal || 'NO EXISTE');
      
      // Contar cuántos tienen cada campo
      const conTelefono = await db.collection('leads').countDocuments({ telefono: { $exists: true, $ne: null, $ne: '' } });
      const conTelefonoPrincipal = await db.collection('leads').countDocuments({ telefono_principal: { $exists: true, $ne: null, $ne: '' } });
      
      console.log(`\nDocumentos con "telefono": ${conTelefono}`);
      console.log(`Documentos con "telefono_principal": ${conTelefonoPrincipal}`);
    }
    
    // Verificar colección Costumers
    console.log('\n=== COLECCIÓN: costumers ===');
    const costumersCount = await db.collection('costumers').countDocuments();
    console.log(`Total documentos: ${costumersCount}`);
    
    if (costumersCount > 0) {
      const sampleCostumer = await db.collection('costumers').findOne();
      console.log('\nCampos de ejemplo:');
      console.log('- telefono:', sampleCostumer.telefono || 'NO EXISTE');
      console.log('- telefono_principal:', sampleCostumer.telefono_principal || 'NO EXISTE');
      
      // Contar cuántos tienen cada campo
      const conTelefono = await db.collection('costumers').countDocuments({ telefono: { $exists: true, $ne: null, $ne: '' } });
      const conTelefonoPrincipal = await db.collection('costumers').countDocuments({ telefono_principal: { $exists: true, $ne: null, $ne: '' } });
      
      console.log(`\nDocumentos con "telefono": ${conTelefono}`);
      console.log(`Documentos con "telefono_principal": ${conTelefonoPrincipal}`);
    }
    
    // Verificar colección Costumers (con mayúscula)
    console.log('\n=== COLECCIÓN: Costumers (con mayúscula) ===');
    const CostumersCount = await db.collection('Costumers').countDocuments();
    console.log(`Total documentos: ${CostumersCount}`);
    
    if (CostumersCount > 0) {
      const sampleCostumer = await db.collection('Costumers').findOne();
      console.log('\nCampos de ejemplo:');
      console.log('- telefono:', sampleCostumer.telefono || 'NO EXISTE');
      console.log('- telefono_principal:', sampleCostumer.telefono_principal || 'NO EXISTE');
      
      // Contar cuántos tienen cada campo
      const conTelefono = await db.collection('Costumers').countDocuments({ telefono: { $exists: true, $ne: null, $ne: '' } });
      const conTelefonoPrincipal = await db.collection('Costumers').countDocuments({ telefono_principal: { $exists: true, $ne: null, $ne: '' } });
      
      console.log(`\nDocumentos con "telefono": ${conTelefono}`);
      console.log(`Documentos con "telefono_principal": ${conTelefonoPrincipal}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Conexión cerrada');
  }
}

checkPhoneFields();
