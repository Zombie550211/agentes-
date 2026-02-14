/**
 * Script para cambiar todas las líneas a PENDING por lotes
 * Ejecutar en consola del navegador logueado como admin
 */

async function setAllLinesPendingByBatches() {
  console.log('🚀 Iniciando script para cambiar todas las líneas a PENDING...');
  
  try {
    // Primero obtener lista de colecciones
    const collectionsResponse = await fetch('/api/lineas-team/collections', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (!collectionsResponse.ok) {
      throw new Error('Error obteniendo colecciones');
    }
    
    const { collections } = await collectionsResponse.json();
    console.log(`📁 Found ${collections.length} collections`);
    
    let totalUpdated = 0;
    let totalLinesChanged = 0;
    
    // Procesar una colección a la vez
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      console.log(`\n📂 Processing collection ${i + 1}/${collections.length}: ${collection}`);
      
      try {
        const response = await fetch('/api/lineas-team/set-all-lines-pending-batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ collection })
        });
        
        if (!response.ok) {
          console.error(`❌ Error processing ${collection}:`, response.statusText);
          continue;
        }
        
        const result = await response.json();
        if (result.success) {
          totalUpdated += result.stats.updated || 0;
          totalLinesChanged += result.stats.totalLinesChanged || 0;
          console.log(`✅ ${collection}: ${result.stats.updated} documents, ${result.stats.totalLinesChanged} lines changed`);
        } else {
          console.error(`❌ Error processing ${collection}:`, result.message);
        }
        
        // Pequeña pausa entre colecciones para no sobrecargar
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ Error processing ${collection}:`, error);
      }
    }
    
    console.log(`\n🎉 Process completed!`);
    console.log(`📊 Total documents updated: ${totalUpdated}`);
    console.log(`📊 Total lines changed to PENDING: ${totalLinesChanged}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Ejecutar el script
setAllLinesPendingByBatches();
