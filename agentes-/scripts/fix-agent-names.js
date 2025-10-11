/**
 * Script para corregir los nombres de agentes en registros existentes
 * Actualiza los campos agente, agenteNombre y createdBy basándose en el historial
 * o en el agenteId si está disponible
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ path: '../.env' });

// Configuración de MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Zombie550211:fDJneHzSCsiU5mdy@cluster0.ywxaotz.mongodb.net/crmagente?retryWrites=true&w=majority&appName=Cluster0';

async function fixAgentNames() {
    let client;
    
    try {
        console.log('🔧 Iniciando corrección de nombres de agentes...\n');
        
        // Conectar a MongoDB
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Conectado a MongoDB\n');
        
        const db = client.db('crmagente');
        const customersCollection = db.collection('costumers');
        const usersCollection = db.collection('users');
        
        // Buscar todos los registros con "Agente Desconocido" o "Agente"
        const problematicRecords = await customersCollection.find({
            $or: [
                { agente: 'Agente Desconocido' },
                { agente: 'Agente' },
                { agenteNombre: 'Agente Desconocido' },
                { agenteNombre: 'Agente' },
                { agente: null },
                { agenteNombre: null },
                { agente: { $exists: false } },
                { agenteNombre: { $exists: false } }
            ]
        }).toArray();
        
        console.log(`📊 Encontrados ${problematicRecords.length} registros para actualizar\n`);
        
        if (problematicRecords.length === 0) {
            console.log('✨ No hay registros que necesiten actualización');
            return;
        }
        
        let updatedCount = 0;
        let failedCount = 0;
        const updateDetails = [];
        
        // Procesar cada registro
        for (const record of problematicRecords) {
            try {
                let agentName = null;
                let updateReason = '';
                
                // Estrategia 1: Buscar en el historial
                if (record.historial && Array.isArray(record.historial) && record.historial.length > 0) {
                    const creationEntry = record.historial.find(h => h.accion === 'CREADO');
                    if (creationEntry && creationEntry.usuario && creationEntry.usuario !== 'SISTEMA') {
                        agentName = creationEntry.usuario;
                        updateReason = 'historial';
                    }
                }
                
                // Estrategia 2: Usar agenteId para buscar el usuario
                if (!agentName && record.agenteId) {
                    try {
                        const user = await usersCollection.findOne({ 
                            _id: ObjectId.isValid(record.agenteId) ? new ObjectId(record.agenteId) : record.agenteId 
                        });
                        if (user && user.username) {
                            agentName = user.username;
                            updateReason = 'agenteId';
                        }
                    } catch (e) {
                        // Si falla la búsqueda por ID, continuar
                    }
                }
                
                // Estrategia 3: Usar createdBy si existe y no es genérico
                if (!agentName && record.createdBy && record.createdBy !== 'SISTEMA' && record.createdBy !== 'Agente') {
                    agentName = record.createdBy;
                    updateReason = 'createdBy existente';
                }
                
                // Estrategia 4: Buscar en otros campos relacionados
                if (!agentName) {
                    // Intentar con campos alternativos
                    const possibleFields = ['usuario', 'registradoPor', 'owner', 'assignedTo'];
                    for (const field of possibleFields) {
                        if (record[field] && record[field] !== 'SISTEMA' && record[field] !== 'Agente') {
                            agentName = record[field];
                            updateReason = `campo ${field}`;
                            break;
                        }
                    }
                }
                
                // Si encontramos un nombre válido, actualizar
                if (agentName && agentName !== 'SISTEMA' && agentName !== 'Agente' && agentName !== 'Agente Desconocido') {
                    const updateResult = await customersCollection.updateOne(
                        { _id: record._id },
                        { 
                            $set: {
                                agente: agentName,
                                agenteNombre: agentName,
                                createdBy: agentName,
                                actualizadoEn: new Date(),
                                actualizadoPor: 'SCRIPT_FIX_AGENT_NAMES'
                            }
                        }
                    );
                    
                    if (updateResult.modifiedCount > 0) {
                        updatedCount++;
                        updateDetails.push({
                            id: record._id,
                            oldAgent: record.agente || 'null',
                            newAgent: agentName,
                            reason: updateReason
                        });
                        console.log(`✅ Actualizado: ${record._id} - ${record.agente || 'null'} → ${agentName} (${updateReason})`);
                    }
                } else {
                    failedCount++;
                    console.log(`⚠️ No se pudo determinar el agente para: ${record._id}`);
                }
                
            } catch (error) {
                failedCount++;
                console.error(`❌ Error procesando registro ${record._id}:`, error.message);
            }
        }
        
        // Resumen final
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMEN DE LA ACTUALIZACIÓN');
        console.log('='.repeat(60));
        console.log(`✅ Registros actualizados exitosamente: ${updatedCount}`);
        console.log(`⚠️ Registros sin actualizar: ${failedCount}`);
        console.log(`📝 Total de registros procesados: ${problematicRecords.length}`);
        
        if (updateDetails.length > 0) {
            console.log('\n📋 DETALLES DE ACTUALIZACIONES:');
            console.log('-'.repeat(60));
            updateDetails.slice(0, 10).forEach(detail => {
                console.log(`  ID: ${detail.id}`);
                console.log(`  Antes: "${detail.oldAgent}" → Después: "${detail.newAgent}"`);
                console.log(`  Razón: ${detail.reason}`);
                console.log('-'.repeat(60));
            });
            if (updateDetails.length > 10) {
                console.log(`\n... y ${updateDetails.length - 10} actualizaciones más.`);
            }
        }
        
        // Verificación adicional: contar registros que aún necesitan corrección
        const stillProblematic = await customersCollection.countDocuments({
            $or: [
                { agente: 'Agente Desconocido' },
                { agente: 'Agente' },
                { agente: null },
                { agente: { $exists: false } }
            ]
        });
        
        if (stillProblematic > 0) {
            console.log(`\n⚠️ Aún quedan ${stillProblematic} registros que necesitan revisión manual.`);
            console.log('   Estos registros probablemente no tienen información suficiente para determinar el agente.');
        } else {
            console.log('\n✨ ¡Todos los registros han sido corregidos exitosamente!');
        }
        
    } catch (error) {
        console.error('❌ Error general:', error);
        process.exit(1);
    } finally {
        if (client) {
            await client.close();
            console.log('\n👋 Conexión a MongoDB cerrada');
        }
    }
}

// Ejecutar el script
console.log('🚀 SCRIPT DE CORRECCIÓN DE NOMBRES DE AGENTES');
console.log('='.repeat(60));
console.log('Este script actualizará todos los registros con "Agente Desconocido"');
console.log('basándose en el historial, agenteId y otros campos disponibles.');
console.log('='.repeat(60) + '\n');

// Confirmar antes de ejecutar
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('¿Deseas continuar? (s/n): ', (answer) => {
    if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'si') {
        rl.close();
        fixAgentNames()
            .then(() => {
                console.log('\n✅ Script completado exitosamente');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n❌ Error ejecutando el script:', error);
                process.exit(1);
            });
    } else {
        console.log('\n❌ Script cancelado por el usuario');
        rl.close();
        process.exit(0);
    }
});
