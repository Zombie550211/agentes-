// Script para diagnosticar problemas de supervisor en producción
// Copia y pega esto en la consola F12 de producción

console.log('🔍 DEBUG DE SUPERVISOR EN PRODUCCIÓN');
console.log('='.repeat(60));

// 1. Verificar usuario actual
const currentUser = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
console.log('👤 Usuario actual:', {
    username: currentUser.username,
    role: currentUser.role,
    team: currentUser.team,
    supervisor: currentUser.supervisor
});

// 2. Verificar si es supervisor
const userRole = (currentUser.role || '').toLowerCase();
const isSupervisor = userRole.includes('supervisor');
console.log('🔑 ¿Es supervisor?', isSupervisor);

// 3. Verificar datos cargados
if (window.leadsData && Array.isArray(window.leadsData)) {
    console.log(`📊 Total leads cargados: ${window.leadsData.length}`);
    
    // Buscar agentes específicos
    const agentes = new Set();
    const jorgeLeads = [];
    const jairoLeads = [];
    const mauricioLeads = [];
    
    window.leadsData.forEach(lead => {
        const agente = lead.agente || lead.agenteNombre || lead.nombreAgente || '';
        if (agente) agentes.add(agente);
        
        // Buscar leads específicos
        const agenteLower = agente.toLowerCase();
        if (agenteLower.includes('jorge') && agenteLower.includes('segov')) {
            jorgeLeads.push({ id: lead._id, agente, cliente: lead.nombre_cliente });
        }
        if (agenteLower.includes('jairo') && agenteLower.includes('flore')) {
            jairoLeads.push({ id: lead._id, agente, cliente: lead.nombre_cliente });
        }
        if (agenteLower.includes('mauricio') && agenteLower.includes('martin')) {
            mauricioLeads.push({ id: lead._id, agente, cliente: lead.nombre_cliente });
        }
    });
    
    console.log('\n👥 Agentes encontrados:', Array.from(agentes).sort());
    
    console.log('\n📋 Leads por agente:');
    console.log('Jorge Segovia:', jorgeLeads.length, 'leads');
    jorgeLeads.forEach(lead => console.log(`  - ${lead.cliente} (${lead.agente})`));
    
    console.log('Jairo Flores:', jairoLeads.length, 'leads');
    jairoLeads.forEach(lead => console.log(`  - ${lead.cliente} (${lead.agente})`));
    
    console.log('Mauricio Martinez:', mauricioLeads.length, 'leads');
    mauricioLeads.forEach(lead => console.log(`  - ${lead.cliente} (${lead.agente})`));
    
} else {
    console.log('❌ No hay datos cargados (window.leadsData)');
}

// 4. Verificar configuración del sidebar
console.log('\n🔧 Configuración del sidebar:');
console.log('SIDEBAR_FILTER_OVERRIDE:', window.SIDEBAR_FILTER_OVERRIDE);

// 5. Probar filtros manualmente
console.log('\n🧪 Para probar filtros manualmente:');
console.log('// Para ver todos los leads (si eres admin):');
console.log('window.renderCostumerTable(window.leadsData);');
console.log('');
console.log('// Para filtrar por agente específico:');
console.log('applyFilters("TEAM IRANIA", "Irania Serrano", "Jorge Segovia");');
console.log('applyFilters("TEAM IRANIA", "Irania Serrano", "Jairo Flores");');
console.log('applyFilters("TEAM IRANIA", "Irania Serrano", "Mauricio Martinez");');

// 6. Verificar si hay filtros activos
const agentDropdown = document.getElementById('agentFilter');
const teamDropdown = document.getElementById('teamFilter');
console.log('\n🎛️ Filtros activos:');
console.log('Agente seleccionado:', agentDropdown?.value);
console.log('Team seleccionado:', teamDropdown?.value);
