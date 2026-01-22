// Script para debug en consola del navegador
// Copia y pega esto en la consola de F12 en producción

console.log('🔍 DEBUG DE AGENTES EN PRODUCCIÓN');
console.log('='.repeat(50));

// 1. Verificar que el código está cargado
if (typeof window.SIDEBAR_FILTER_OVERRIDE !== 'undefined') {
    console.log('✅ SIDEBAR_FILTER_OVERRIDE disponible');
} else {
    console.log('❌ SIDEBAR_FILTER_OVERRIDE NO disponible');
}

// 2. Verificar TEAMS
try {
    const teamsScript = document.querySelector('script').textContent;
    const hasJorge = teamsScript.includes('Jorge Segovia');
    const hasJairo = teamsScript.includes('Jairo Flores');
    
    console.log('👤 Jorge Segovia en TEAMS:', hasJorge);
    console.log('👤 Jairo Flores en TEAMS:', hasJairo);
} catch (e) {
    console.log('❌ Error verificando TEAMS:', e);
}

// 3. Verificar datos actuales
if (window.leadsData && Array.isArray(window.leadsData)) {
    const agentes = new Set();
    window.leadsData.forEach(lead => {
        const agente = lead.agente || lead.agenteNombre || lead.nombreAgente;
        if (agente) agentes.add(agente);
    });
    
    const jorgeNames = Array.from(agentes).filter(n => 
        n.toLowerCase().includes('jorge') && n.toLowerCase().includes('segov')
    );
    
    const jairoNames = Array.from(agentes).filter(n => 
        n.toLowerCase().includes('jairo') && n.toLowerCase().includes('flore')
    );
    
    console.log('\n📊 NOMBRES EN DATOS ACTUALES:');
    console.log('Jorge:', jorgeNames);
    console.log('Jairo:', jairoNames);
} else {
    console.log('❌ leadsData no disponible');
}

console.log('\n🔧 Para probar manualmente:');
console.log('applyFilters("TEAM IRANIA", "Irania Serrano", "Jorge Segovia")');
