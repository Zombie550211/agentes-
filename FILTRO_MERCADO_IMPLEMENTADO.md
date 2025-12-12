# Filtro de MERCADO Agregado a Costumer.html

## ✅ Cambios Implementados

### 1. **HTML: Selector de Mercado (Línea ~2295)**

Se agregó un nuevo dropdown después del filtro de Agente:

```html
<label for="mercadoFilter">Mercado</label>
<select id="mercadoFilter" style="min-width: 120px;">
  <option value="">Todos los mercados</option>
  <option value="ICON">ICON</option>
  <option value="BAMO">BAMO</option>
</select>
```

**Características:**
- ID: `mercadoFilter`
- Dos opciones: ICON y BAMO
- Opción por defecto: "Todos los mercados" (vacío)
- Ancho mínimo: 120px

---

### 2. **Lógica de Filtrado (Línea ~5137)**

Se agregó código en la función `renderCostumerTable()` para aplicar el filtro:

```javascript
// Aplicar filtro por mercado (ICON / BAMO) si el select existe
try {
  const mercadoSel = document.getElementById('mercadoFilter');
  if (mercadoSel && mercadoSel.value && mercadoSel.value !== '') {
    const mercadoValue = String(mercadoSel.value).trim().toUpperCase();
    const predicate = (l) => {
      const lMercado = String(l?.mercado || '').trim().toUpperCase();
      return lMercado === mercadoValue;
    };
    try { leadsArray = leadsArray.filter(predicate); } catch(_) {}
    console.log('[Costumer Filter] Filtro de mercado aplicado:', mercadoValue, '-> Resultados:', leadsArray.length);
  }
} catch (e) { console.warn('[Costumer Filter] error applying mercado filter', e); }
```

**Características:**
- Filtra por coincidencia exacta (case-insensitive)
- Solo aplica si hay valor seleccionado
- Log de depuración en consola
- Manejo de errores seguro

---

### 3. **Event Listener (Línea ~9080)**

Se agregó un listener para reaccionar a cambios en el filtro:

```javascript
// Configurar filtro de mercado
const mercadoFilter = document.getElementById('mercadoFilter');
if (mercadoFilter) {
  mercadoFilter.addEventListener('change', function() {
    console.log('[MERCADO FILTER] Cambiando a mercado:', this.value || 'Todos los mercados');
    
    // Re-renderizar tabla
    if (window.ultimaListaLeads && typeof window.renderCostumerTable === 'function') {
      const prevSuspend = window.__suspendRender;
      try {
        window.__suspendRender = false;
        window.renderCostumerTable(window.ultimaListaLeads);
      } finally {
        window.__suspendRender = prevSuspend;
      }
    }
  });
}
```

**Características:**
- Escucha cambios en el select
- Re-renderiza tabla inmediatamente
- Mantiene integridad con otros filtros
- Respeta flag de suspend render

---

### 4. **Limpieza de Filtros (Línea ~8878)**

Se actualizo la función `clearAllFilters()` para incluir mercadoFilter:

```javascript
window.clearAllFilters = function(forceReload = false) {
  try {
    // ... otros filtros ...
    const mercadoFilter = document.getElementById('mercadoFilter');
    
    // ... limpiar otros ...
    if (mercadoFilter) mercadoFilter.value = '';
```

**Características:**
- Botón "Limpiar" ahora resetea el filtro de mercado
- Mantiene consistencia con otros filtros

---

## 🎯 Cómo Funciona

### Flujo de Filtrado:
1. Usuario selecciona ICON o BAMO en el dropdown
2. Event listener detecta el cambio
3. Re-renderiza tabla con `renderCostumerTable()`
4. Función aplica predicado: `l.mercado === selectedValue`
5. Solo filas que coincidan se muestran
6. Log en consola indica cantidad de resultados

### Ejemplos:
```
Usuario selecciona: ICON
→ Tabla muestra: Solo clientes con mercado=ICON
→ Consola: "[Costumer Filter] Filtro de mercado aplicado: ICON -> Resultados: 125"

Usuario selecciona: BAMO
→ Tabla muestra: Solo clientes con mercado=BAMO
→ Consola: "[Costumer Filter] Filtro de mercado aplicado: BAMO -> Resultados: 87"

Usuario selecciona: (vacío)
→ Tabla muestra: Todos los clientes
```

---

## 🔄 Integración con Otros Filtros

El nuevo filtro funciona **en combinación** con:
- ✅ Filtro de Mes
- ✅ Filtro de Team
- ✅ Filtro de Agente
- ✅ Filtro de Status
- ✅ Filtro de Fechas (Día de venta / Instalación)
- ✅ Búsqueda por texto

**Ejemplo:** Usuario puede filtrar por:
- Mes: Octubre 2025
- Agente: Juan Pérez
- Mercado: ICON
- Status: Completed
- → Solo clientes que cumplan TODOS los criterios se muestran

---

## 📊 Campos Soportados

El filtro busca coincidencias en el campo `mercado` del objeto cliente:

```javascript
{
  nombre_cliente: "...",
  telefono_principal: "...",
  mercado: "ICON",  // ← Este campo es el que se filtra
  // ... otros campos
}
```

---

## 🧪 Validación

### Cómo verificar:
1. Abrir Costumer.html
2. Buscar el dropdown "Mercado" (después de "Agente")
3. Seleccionar "ICON" → Tabla muestra solo ICON
4. Seleccionar "BAMO" → Tabla muestra solo BAMO
5. Seleccionar "Todos los mercados" → Se muestra todo
6. Abrir DevTools (F12) → Consola → Ver logs [MERCADO FILTER]
7. Clickear "Limpiar" → Filtro se resetea

---

## 📝 Notas Técnicas

- **Case-insensitive:** "icon", "ICON", "Icon" se tratan igual
- **Trim:** Espacios en blanco se eliminan antes de comparar
- **NULL-safe:** Si un cliente no tiene mercado, se excluye del filtro
- **Performance:** Filtrado ocurre en cliente (rápido para <10k clientes)
- **Combinable:** Puede usarse con cualquier otro filtro sin conflictos

---

## 🚀 Mejoras Futuras

1. **Autocompletar:** Agregar opciones dinámicamente desde datos
2. **Multi-select:** Permitir seleccionar ICON y BAMO simultáneamente
3. **Persistencia:** Guardar último mercado seleccionado en localStorage
4. **Búsqueda:** Filtro de mercado en el buscador de texto

