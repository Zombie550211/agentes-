# Scripts de Mantenimiento CRM

## 🔧 fix-agent-names.js

Este script corrige automáticamente los nombres de agentes en registros existentes que aparecen como "Agente Desconocido" o están vacíos.

### ¿Qué hace el script?

1. **Busca registros problemáticos** con:
   - `agente: "Agente Desconocido"`
   - `agente: "Agente"`
   - Campos `agente` o `agenteNombre` nulos o inexistentes

2. **Intenta corregir usando múltiples estrategias**:
   - **Historial**: Busca en el historial del lead el usuario que lo creó
   - **AgenteId**: Si existe un ID, busca el usuario correspondiente en la base de datos
   - **CreatedBy**: Usa el campo `createdBy` si tiene un valor válido
   - **Campos alternativos**: Busca en `usuario`, `registradoPor`, `owner`, etc.

3. **Actualiza los campos**:
   - `agente`
   - `agenteNombre`
   - `createdBy`
   - Marca con timestamp de actualización

### Cómo ejecutar el script

#### Opción 1: Desde el directorio scripts
```bash
cd scripts
npm install
npm run fix-agents
```

#### Opción 2: Directamente con Node
```bash
cd scripts
node fix-agent-names.js
```

### Características de seguridad

- ✅ **Confirmación antes de ejecutar**: El script pide confirmación antes de hacer cambios
- ✅ **Logs detallados**: Muestra cada actualización que realiza
- ✅ **Resumen final**: Presenta estadísticas de registros actualizados y fallidos
- ✅ **No destructivo**: Solo actualiza campos vacíos o genéricos, no sobrescribe datos válidos

### Output esperado

```
🚀 SCRIPT DE CORRECCIÓN DE NOMBRES DE AGENTES
============================================================
Este script actualizará todos los registros con "Agente Desconocido"
basándose en el historial, agenteId y otros campos disponibles.
============================================================

¿Deseas continuar? (s/n): s

🔧 Iniciando corrección de nombres de agentes...
✅ Conectado a MongoDB
📊 Encontrados 25 registros para actualizar

✅ Actualizado: 68af40c1c61c405e2bb7b0c2 - Agente → Daniel Martinez (historial)
✅ Actualizado: 68af545cc61c405e2bb7b0de - Agente → Evelin Garcia (agenteId)
⚠️ No se pudo determinar el agente para: 68af5050c61c405e2bb7b0d8

============================================================
📊 RESUMEN DE LA ACTUALIZACIÓN
============================================================
✅ Registros actualizados exitosamente: 23
⚠️ Registros sin actualizar: 2
📝 Total de registros procesados: 25

✨ Script completado exitosamente
```

### Notas importantes

⚠️ **IMPORTANTE**: Este script actualizará directamente la base de datos de producción. Se recomienda:
1. Hacer un backup antes de ejecutar
2. Probar primero en un ambiente de desarrollo si es posible
3. Ejecutar fuera de horarios pico para minimizar impacto

### Registros que NO se actualizarán

El script NO actualizará registros que:
- Ya tienen un nombre de agente válido (diferente de "Agente", "Agente Desconocido", "SISTEMA")
- No tienen ninguna información para determinar el agente real
- Tienen errores en su estructura de datos

Estos casos requerirán revisión manual.

### Verificación post-ejecución

Después de ejecutar el script, puedes verificar los resultados:

1. Revisa el ranking en `/Ranking y Promociones.html` - deberías ver nombres reales
2. Verifica en `/Costumer.html` que los agentes aparecen correctamente
3. El script muestra cuántos registros aún necesitan revisión manual
