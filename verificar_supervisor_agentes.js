// Script para verificar asignación de agentes a supervisor
// Copia y pega esto en la consola F12 de producción

console.log('🔍 VERIFICACIÓN DE SUPERVISOR-AGENTES');
console.log('='.repeat(50));

// 1. Obtener usuario actual
const currentUser = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
console.log('👤 Usuario actual:', {
    username: currentUser.username,
    role: currentUser.role,
    team: currentUser.team,
    supervisor: currentUser.supervisor,
    supervisorId: currentUser.supervisorId
});

// 2. Verificar si hay datos de usuarios cargados
fetch('/api/users/agents', {
    headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || sessionStorage.getItem('token'))
    }
})
.then(response => response.json())
.then(users => {
    console.log('\n👥 Usuarios en el sistema:');
    console.log('Total usuarios:', users.length);
    
    // Filtrar agentes del supervisor actual
    const supervisorUsername = currentUser.username;
    const supervisorName = currentUser.name || currentUser.fullName || currentUser.nombre;
    
    const agentesDelSupervisor = users.filter(user => {
        return user.supervisor === supervisorUsername || 
               user.supervisor === supervisorName ||
               user.supervisorId === currentUser._id ||
               user.supervisorId === currentUser.id;
    });
    
    console.log('\n🎯 Agentes asignados al supervisor:', supervisorUsername);
    console.log('Agentes encontrados:', agentesDelSupervisor.length);
    
    agentesDelSupervisor.forEach(agente => {
        console.log(`  - ${agente.username} (${agente.name || agente.nombre})`);
        console.log(`    Team: ${agente.team || 'N/A'}`);
        console.log(`    Supervisor: ${agente.supervisor || 'N/A'}`);
        console.log(`    SupervisorId: ${agente.supervisorId || 'N/A'}`);
    });
    
    // Buscar específicamente a Jorge, Jairo y Mauricio
    const objetivos = ['Jorge Segovia', 'Jairo Flores', 'Mauricio Martinez'];
    console.log('\n🔍 Buscando agentes objetivos:');
    
    objetivos.forEach(objetivo => {
        const agente = users.find(u => 
            u.username === objetivo || 
            u.name === objetivo || 
            u.nombre === objetivo ||
            (u.name && u.name.toLowerCase().includes(objetivo.toLowerCase().split(' ')[0]))
        );
        
        if (agente) {
            console.log(`✅ ${objetivo}:`);
            console.log(`  Username: ${agente.username}`);
            console.log(`  Name: ${agente.name || agente.nombre || 'N/A'}`);
            console.log(`  Team: ${agente.team || 'N/A'}`);
            console.log(`  Supervisor: ${agente.supervisor || 'N/A'}`);
            console.log(`  SupervisorId: ${agente.supervisorId || 'N/A'}`);
            console.log(`  ¿Asignado al supervisor actual?: ${
                agente.supervisor === supervisorUsername || 
                agente.supervisor === supervisorName ||
                agente.supervisorId === currentUser._id ||
                agente.supervisorId === currentUser.id ? 'SÍ' : 'NO'
            }`);
        } else {
            console.log(`❌ ${objetivo}: No encontrado en usuarios`);
        }
    });
    
    // 3. Verificar datos de leads
    if (window.leadsData && Array.isArray(window.leadsData)) {
        console.log('\n📊 Verificando leads:');
        
        objetivos.forEach(objetivo => {
            const leadsDelAgente = window.leadsData.filter(lead => {
                const agente = lead.agente || lead.agenteNombre || lead.nombreAgente || '';
                return agente.toLowerCase().includes(objetivo.toLowerCase().split(' ')[0]);
            });
            
            console.log(`${objetivo}: ${leadsDelAgente.length} leads`);
            if (leadsDelAgente.length > 0) {
                console.log(`  Muestra de leads:`);
                leadsDelAgente.slice(0, 3).forEach(lead => {
                    console.log(`    - ${lead.nombre_cliente} (${lead.agente || lead.agenteNombre})`);
                });
            }
        });
    }
    
})
.catch(error => {
    console.error('❌ Error obteniendo usuarios:', error);
});

// 4. Probar endpoint de leads con filtros
console.log('\n🧪 Para probar el endpoint directamente:');
console.log('// Copia y ejecuta estos comandos uno por uno:');
console.log(`
// Ver todos los leads (si eres admin)
fetch('/api/leads', {
    headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || sessionStorage.getItem('token'))
    }
}).then(r => r.json()).then(d => console.log('Todos los leads:', d.data?.length || 0));

// Ver leads filtrados por agente específico
fetch('/api/leads?agentName=Jorge Segovia', {
    headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem('token') || sessionStorage.getItem('token'))
    }
}).then(r => r.json()).then(d => console.log('Leads de Jorge Segovia:', d.data?.length || 0));
`);
