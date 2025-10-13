# 🚨 IMPORTANTE: Manejo de Fechas en el Sistema

## ⚠️ Problema Crítico: Bug de Parseo UTC

### El Problema

Cuando usas `new Date("2025-10-01")` en JavaScript, el navegador parsea el string como **UTC 00:00**.

En zonas horarias como México (UTC-6), esto causa que:
- `"2025-10-01"` se convierta a `2025-09-30 18:00` hora local
- Las fechas de **octubre aparecen en septiembre**
- Los clientes se agrupan en el mes **incorrecto**

### ❌ NO HACER ESTO

```javascript
// ❌ MAL - Parsea como UTC
const date = new Date("2025-10-01");
console.log(date.getMonth()); // 8 (septiembre) en vez de 9 (octubre)

// ❌ MAL - Causa desfase de mes
const fecha = lead.dia_venta; // "2025-10-01"
const d = new Date(fecha);
const mes = d.getMonth(); // 8 (septiembre) ❌
```

### ✅ HACER ESTO

```javascript
// ✅ BIEN - Usar utilidad centralizada
const date = window.DateUtils.parseLocalDate("2025-10-01");
console.log(date.getMonth()); // 9 (octubre) ✅

// ✅ BIEN - Parseo manual como local
const [year, month, day] = "2025-10-01".split('-').map(Number);
const date = new Date(year, month - 1, day); // Local
console.log(date.getMonth()); // 9 (octubre) ✅
```

## 📚 Utilidades Disponibles

### `window.DateUtils.parseLocalDate(dateValue)`

Parsea un string YYYY-MM-DD como fecha **local** (no UTC).

```javascript
const date = window.DateUtils.parseLocalDate("2025-10-01");
// Date object: 2025-10-01 00:00:00 (hora local)
```

### `window.DateUtils.formatLocalDate(dateValue)`

Convierte una fecha a string YYYY-MM-DD sin conversión de zona horaria.

```javascript
const str = window.DateUtils.formatLocalDate(new Date(2025, 9, 1));
// "2025-10-01"
```

### `window.DateUtils.getMonthKey(dateValue)`

Obtiene el mes y año como "YYYY-MM".

```javascript
const key = window.DateUtils.getMonthKey("2025-10-01");
// "2025-10"
```

### `window.DateUtils.getMonthName(dateValue)`

Obtiene el nombre del mes en español.

```javascript
const name = window.DateUtils.getMonthName("2025-10-01");
// "octubre"
```

### `window.DateUtils.formatShortDate(dateValue)`

Formatea como "día_semana día" (ej: "mié 13").

```javascript
const short = window.DateUtils.formatShortDate("2025-10-01");
// "mar 1"
```

## 🔧 Archivos Corregidos

Los siguientes archivos ya usan el parseo correcto:

1. ✅ `js/date-utils.js` - Utilidades centralizadas
2. ✅ `js/costumer-calendar.js` - Función `getSaleDate()`
3. ✅ `Costumer.html` - Funciones `getDateFromLead()` y `formatearFechaSinDesfase()`
4. ✅ `js/costumer-init.js` - Renderizado de fechas
5. ✅ `js/costumer-actions.js` - Acciones de cliente

## 🛡️ Reglas para Desarrolladores

### Regla #1: NUNCA usar `new Date(string)` con YYYY-MM-DD

```javascript
// ❌ PROHIBIDO
const bad = new Date("2025-10-01");

// ✅ PERMITIDO
const good = window.DateUtils.parseLocalDate("2025-10-01");
```

### Regla #2: SIEMPRE usar `window.DateUtils` para parseo

```javascript
// ❌ NO
function parseDate(str) {
  return new Date(str);
}

// ✅ SÍ
function parseDate(str) {
  return window.DateUtils.parseLocalDate(str);
}
```

### Regla #3: Si NO puedes usar DateUtils, parsea manualmente

```javascript
// Si DateUtils no está disponible (fallback)
const [year, month, day] = dateStr.split('-').map(Number);
const date = new Date(year, month - 1, day); // ✅ Local
```

### Regla #4: Para agrupar por mes, usa getMonthKey()

```javascript
// ❌ NO
const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;

// ✅ SÍ
const monthKey = window.DateUtils.getMonthKey(dateStr);
```

## 🧪 Cómo Probar

```javascript
// Test 1: Parseo correcto
const date = window.DateUtils.parseLocalDate("2025-10-01");
console.assert(date.getMonth() === 9, "Debe ser octubre (mes 9)");
console.assert(date.getDate() === 1, "Debe ser día 1");

// Test 2: Formateo correcto
const str = window.DateUtils.formatLocalDate(new Date(2025, 9, 1));
console.assert(str === "2025-10-01", "Debe ser 2025-10-01");

// Test 3: Agrupación correcta
const key = window.DateUtils.getMonthKey("2025-10-01");
console.assert(key === "2025-10", "Debe ser 2025-10");
```

## 📝 Checklist para Code Review

Antes de aprobar un PR que toca fechas, verifica:

- [ ] ¿Usa `window.DateUtils` para parsear fechas?
- [ ] ¿NO usa `new Date(string)` con formato YYYY-MM-DD?
- [ ] ¿Parsea como LOCAL en vez de UTC?
- [ ] ¿Los tests pasan con zona horaria UTC-6?
- [ ] ¿Las fechas se agrupan en el mes correcto?

## 🆘 Si Encuentras un Bug de Fechas

1. Busca `new Date(` en el código
2. Verifica si está parseando strings YYYY-MM-DD
3. Reemplaza con `window.DateUtils.parseLocalDate()`
4. Prueba en zona horaria UTC-6 (México)
5. Actualiza este documento si es necesario

## 📞 Contacto

Si tienes dudas sobre el manejo de fechas, consulta este documento o revisa `js/date-utils.js`.

---

**Última actualización:** 2025-10-13  
**Autor:** Sistema de gestión de clientes  
**Versión:** 1.0
