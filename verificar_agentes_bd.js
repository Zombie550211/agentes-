// Script para verificar nombres exactos de agentes en la base de datos
const { MongoClient } = require('mongodb');

async function verificarAgentes() {
    const uri = "mongodb+srv://dashboard:dashboard123@cluster0.6xqqn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        console.log('🔍 Conectado a MongoDB - Verificando agentes...');
        
        const db = client.db('dashboard');
        const collection = db.collection('costumers');
        
        // Buscar todos los nombres de agentes únicos
        const agentes = await collection.aggregate([
            {
                $match: {
                    $or: [
                        { agenteNombre: { $exists: true, $ne: null, $ne: "" } },
                        { agente: { $exists: true, $ne: null, $ne: "" } }
                    ]
                }
            },
            {
                $project: {
                    agenteNombre: 1,
                    agente: 1
                }
            }
        ]).toArray();
        
        // Extraer todos los nombres únicos
        const nombresUnicos = new Set();
        
        agentes.forEach(doc => {
            if (doc.agenteNombre) nombresUnicos.add(doc.agenteNombre.trim());
            if (doc.agente) nombresUnicos.add(doc.agente.trim());
        });
        
        const nombresArray = Array.from(nombresUnicos).sort();
        
        console.log('\n📋 NOMBRES DE AGENTES ENCONTRADOS:');
        console.log('='.repeat(50));
        
        // Buscar variaciones de Jorge
        const jorgeVariations = nombresArray.filter(nombre => 
            nombre.toLowerCase().includes('jorge') && 
            nombre.toLowerCase().includes('segov')
        );
        
        console.log('\n👤 VARIACIONES DE JORGE SEGOVIA:');
        jorgeVariations.forEach(nombre => console.log(`  - "${nombre}"`));
        
        // Buscar variaciones de Jairo
        const jairoVariations = nombresArray.filter(nombre => 
            nombre.toLowerCase().includes('jairo') && 
            nombre.toLowerCase().includes('flore')
        );
        
        console.log('\n👤 VARIACIONES DE JAIRO FLORES:');
        jairoVariations.forEach(nombre => console.log(`  - "${nombre}"`));
        
        // Contar clientes para cada variación
        console.log('\n📊 CLIENTES POR VARIACIÓN:');
        console.log('='.repeat(50));
        
        for (const nombre of [...jorgeVariations, ...jairoVariations]) {
            const count = await collection.countDocuments({
                $or: [
                    { agenteNombre: nombre },
                    { agente: nombre }
                ]
            });
            console.log(`  ${nombre}: ${count} clientes`);
        }
        
        console.log(`\n📈 Total agentes únicos: ${nombresArray.length}`);
        console.log('\n✅ Verificación completada');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
    }
}

verificarAgentes();
