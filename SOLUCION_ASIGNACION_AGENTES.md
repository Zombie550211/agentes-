# Solución: Guardar Cliente en Colección del Agente Asignado

## Problema
Cuando un supervisor (ej: Bryan Pleitez) asigna un cliente a un agente específico (ej: Luis Chavarria), el cliente solo se guarda en la colección general `costumers`, pero NO se guarda en la colección personal del agente.

## Solución Implementada

### Cambios en el endpoint POST /api/customers

Agregar esta lógica DESPUÉS de guardar en la colección `costumers`:

```javascript
// 1. Determinar nombre de la colección del agente
const agentCollectionName = finalAgentName 
  ? finalAgentName.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
  : null;

console.log('📁 Colección del agente:', agentCollectionName || 'N/A');

// 2. Guardar en colección general (YA EXISTE)
const mainResult = await db.collection('costumers').insertOne(customerToSave);
console.log('✅ Cliente guardado en costumers:', mainResult.insertedId);

// 3. SI HAY AGENTE ASIGNADO, guardar también en su colección
if (agentCollectionName && finalAgentName) {
  try {
    console.log(`📁 Guardando copia en: ${agentCollectionName}`);
    
    // Crear copia del cliente para la colección del agente
    const customerForAgent = { 
      ...customerToSave,
      _id: new ObjectId(), // Nuevo ID único
      collectionSource: 'agent_collection',
      mainRecordId: mainResult.insertedId // Referencia al registro principal
    };
    
    const agentResult = await db.collection(agentCollectionName).insertOne(customerForAgent);
    console.log(`✅ Guardado en ${agentCollectionName}:`, agentResult.insertedId);
  } catch (agentError) {
    console.warn(`⚠️  Error guardando en ${agentCollectionName}:`, agentError.message);
    // No fallar la operación si falla la colección del agente
  }
}
```

## Ejemplo de Flujo

### Caso 1: Bryan Pleitez asigna cliente a Luis Chavarria

**Input:**
- Supervisor: Bryan Pleitez
- Agente asignado: Luis Chavarria
- Cliente: Juan Pérez

**Output:**
1. ✅ Cliente guardado en `costumers` con:
   - `agente`: "Luis Chavarria"
   - `agenteNombre`: "Luis Chavarria"
   - `asignadoPor`: "Bryan Pleitez"
   - `agenteId`: [ID de Luis]

2. ✅ Cliente guardado en `LUIS_CHAVARRIA` con:
   - Mismos datos
   - `mainRecordId`: [ID del registro en costumers]
   - `collectionSource`: "agent_collection"

### Caso 2: Agente crea su propio cliente

**Input:**
- Usuario: Luis Chavarria (agente)
- Cliente: María López

**Output:**
1. ✅ Cliente guardado en `costumers` con:
   - `agente`: "Luis Chavarria"
   - `agenteNombre`: "Luis Chavarria"
   - `agenteId`: [ID de Luis]

2. ✅ Cliente guardado en `LUIS_CHAVARRIA`

## Nombres de Colecciones por Agente

El sistema genera nombres de colección automáticamente:

| Agente | Colección |
|--------|-----------|
| Luis Chavarria | `LUIS_CHAVARRIA` |
| Evelin Garcia | `EVELIN_GARCIA` |
| Diego Mejia | `DIEGO_MEJIA` |
| Abigail Galdamez | `ABIGAIL_GALDAMEZ` |
| Steven Varela | `STEVEN_VARELA` |

**Reglas:**
- Convertir a MAYÚSCULAS
- Reemplazar espacios con `_`
- Eliminar caracteres especiales
- Solo letras, números y `_`

## Verificación

Para verificar que funciona:

```javascript
// En MongoDB
db.costumers.find({ agenteNombre: "Luis Chavarria" })
db.LUIS_CHAVARRIA.find({})
```

Ambas consultas deben devolver el mismo cliente.

## Archivos Modificados

1. `server.js` o `server_backup.js` - Endpoint POST /api/customers
2. `lead.html` - Ya envía el campo `agenteAsignado` correctamente

## Próximos Pasos

1. ✅ Revisar este documento
2. ⏳ Aplicar los cambios al archivo `server.js` (el principal, no el backup)
3. ⏳ Reiniciar el servidor
4. ⏳ Probar creando un lead como supervisor y asignándolo a un agente
5. ⏳ Verificar en MongoDB que el cliente aparece en ambas colecciones
