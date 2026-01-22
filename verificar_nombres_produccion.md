# VERIFICACIÓN DE NOMBRES EN PRODUCCIÓN

## Pasos para identificar el problema:

1. **Ejecuta este script en la consola F12 de producción:**
```javascript
// Obtener todos los nombres de agentes únicos
if (window.leadsData) {
    const agentes = new Set();
    window.leadsData.forEach(lead => {
        const agente = lead.agente || lead.agenteNombre || lead.nombreAgente;
        if (agente) agentes.add(agente);
    });
    
    console.log('Todos los agentes:', Array.from(agentes).sort());
    
    // Buscar específicamente
    const jorge = Array.from(agentes).filter(n => 
        n.toLowerCase().includes('jorge')
    );
    const jairo = Array.from(agentes).filter(n => 
        n.toLowerCase().includes('jairo')
    );
    
    console.log('Nombres con Jorge:', jorge);
    console.log('Nombres con Jairo:', jairo);
}
```

2. **Si los nombres son diferentes, actualiza el código:**
- Agrega las variaciones exactas que encuentres
- Modifica el mapeo en `applyFilters()`

3. **Prueba con el nombre exacto:**
```javascript
applyFilters("TEAM IRANIA", "Irania Serrano", "NOMBRE_EXACTO_DE_BD");
```

## Posibles problemas comunes:
- Espacios extra: "Jorge Segovia " vs "Jorge Segovia"
- Mayúsculas/minúsculas: "JORGE SEGOVIA" vs "Jorge Segovia"
- Caracteres especiales: "Jorge Segovía" (con tilde)
- Nombres completamente diferentes
