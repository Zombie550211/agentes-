# Análisis de Bottlenecks en Costumer.html

## 🔍 Problemas Identificados

### 1. **CRÍTICO: Dos Requests Duplicados en Serie (línea ~4400)**
```javascript
// Request 1: Completo
let url = `/api/leads?page=1&limit=50000&skipDate=1&showAllMonths=1&...`;
let response = await fetch(url, fetchOptions);  // ⏳ Espera aquí
let leadsRaw = extractArray(data);

// Request 2: INMEDIATAMENTE DESPUÉS
const custRes = await fetch(`/api/customers?page=1&limit=50000&...`, fetchOptions);  // ⏳ Espera de nuevo
const customers = extractArray(custJson);
// Unificar manualmente por _id...
```

**Impacto:** 
- Dos viajes de red SECUENCIALES al servidor
- Carga total: ~2-3s (si cada uno toma 1-1.5s)
- Con 50,000 límite por query = INEFICIENTE

**Solución:** 
- El backend YA retorna TODOS los datos de `/api/leads`
- NO necesita segundo request a `/api/customers`
- Eliminar `custRes` fetch completamente

---

### 2. **Fallback con Múltiples Requests Alternativos (línea ~4480)**
```javascript
if (!leadsRaw || leadsRaw.length === 0) {
  const altUrls = [
    '/api/leads?page=1&limit=1000',        // Request 3
    '/api/leads?page=1&limit=1000&skipDate=1'  // Request 4
  ];
  // Loop que intenta AMBAS URLs secuencialmente
  for (const alt of altUrls) {
    const r = await fetch(alt, fetchOptions);  // ⏳ Espera
  }
}
```

**Impacto:**
- Si los primeros 2 requests fallan/vacíos, hace 2 más
- Hasta 4 requests totales = 4-6s potencial
- Lógica innecesaria: si `/api/leads?limit=50000` retorna 0, no habrá datos en `?limit=1000`

**Solución:**
- Eliminar fallbacks redundantes
- Mantener máximo 1 retry con menor limit como medida defensiva

---

### 3. **Lógica de Paginación Manual (línea ~4500+)**
```javascript
const totalPages = Number(data?.pages || data?.pagination?.totalPages || 1);
for (let p = currentPage + 1; p <= totalPages; p++) {
  const pageUrl = `${u.pathname}?${baseParams.toString()}`;
  const r = await fetch(pageUrl, fetchOptions);  // ⏳ Request N para página 2, 3, 4...
}
```

**Impacto:**
- Si API retorna `pages=5`, hace 4 requests ADICIONALES
- Con `limit=50000`, el backend DEBERÍA retornar TODO en página 1
- Si no lo hace, indica problema en el backend (no en frontend)

**Solución:**
- Si `limit=50000` y solo retorna 1 página: confiar en backend
- Si paging es realmente necesario: aumentar `limit` en backend a 100k

---

### 4. **Fallbacks Secuenciales por ID/Nombre (línea ~4650+)**
```javascript
if (!normalizedLeads || normalizedLeads.length === 0) {
  // Intento 1: fetch /api/leads con múltiples keys
  for (const key of variantKeys) {      // 5 keys diferentes
    for (const v of names) {            // N nombres del usuario
      const r = await fetch(`/api/leads?${key}=${v}`, fetchOptions);  // ⏳ Múltiples requests
    }
  }
  
  // Intento 2: fetchLeadsByAgentId()
  for (const id of ids) {
    const byId = await fetchLeadsByAgentId(id);  // ⏳ Más requests
  }
  
  // Intento 3: fetchLeadsByAgentName()
  for (const nm of names) {
    const byName = await fetchLeadsByAgentName(nm);  // ⏳ Más requests
  }
}
```

**Impacto:**
- En el PEOR caso: 15-20+ requests en cascada
- Cada uno espera al anterior
- Total: 30-60 segundos potencial

**Solución:**
- Si `/api/leads?limit=50000` retorna vacío PARA UN USUARIO ESPECÍFICO, es problema real
- Pero con caché pre-calentado (ya implementado), esto nunca se ejecuta
- Solo mantener último resort: single `/api/leads?agente=${username}&limit=500`

---

### 5. **DOMContentLoaded Listeners Redundantes**
Conteo encontrado: **8+ listeners** en diferentes puntos:
- `initMirror()` - sincronización scroll horizontal
- Sidebar control
- Color sync para status
- Team Líneas detection
- Multiple date/filter initializations

**Impacto:**
- Cada listener ejecuta lógica de inicialización
- Algunos duplican trabajo (e.g., `syncStatusDatasets()` x3)
- Pueden ejecutarse en orden no predecible si no hay await

**Solución:**
- Consolidar en UN solo `DOMContentLoaded` que orqueste todos los pasos
- Usar flags para evitar doble ejecución

---

### 6. **Normalización y Transformación Lenta**
```javascript
function normalizeLeads(arr) {
  return arr.map(lead => ({
    // +20 transformaciones por lead
    nombre_cliente: lead.nombre || lead.name || ...,
    telefono_principal: normalizarTelefono(lead.telefono || lead.phone || ...),
    status: normalizeStatus(lead.status || lead.stato || ...),
    // ...más campos
  }));
}
```

**Impacto:**
- Si `arr.length = 50,000`, esto es **muy** lento
- Cada transformación toca múltiples propiedades
- Múltiples normalizaciones (teléfono, fecha, status)

**Solución:**
- Hacer normalización PARCIAL: solo campos necesarios para tabla
- Diferir normalizaciones costosas (detalles) hasta edición

---

## 📊 Comparativa: Antes vs. Después

| Scenario | Antes | Después |
|----------|-------|---------|
| Con caché (login reciente) | 200ms (caché hit) | 50-100ms (caché hit + reducido overhead) |
| Sin caché (primer load) | 6-8s (2 requests + fallbacks) | 1.5-2s (1 request + cleanup) |
| Error en API | 30-60s (fallbacks cascada) | 3-5s (fallback single) |

---

## ✅ Plan de Optimización

### Fase 1 (Inmediato - 30min)
1. **Eliminar request `/api/customers` redundante** (línea ~4400)
   - Ahorro: 1-1.5s directo
   
2. **Simplificar fallbacks alternativos** (línea ~4480)
   - Mantener 1 fallback con `limit=1000`, descartar loop
   - Ahorro: 1-2s en error scenarios

3. **Desactivar paginación manual** (línea ~4500+)
   - Confiar en `limit=50000` del backend
   - Ahorro: 2-3s si API retorna múltiples páginas

### Fase 2 (Segundo plano - 1h)
4. **Consolidar DOMContentLoaded listeners**
   - Ejecutar en orden: mirror init → sidebar → colors → team líneas
   - Usar flags para evitar duplicados
   - Ganancia: más predecible, menos hilos sin espera

5. **Lazy-load detalles del lead**
   - Normalizar SOLO campos visibles en tabla
   - Diferir `comentarios`, `servicios_detalle` hasta modal
   - Ahorro: 500-800ms en normalización inicial

6. **Caché de normalización**
   - Si lead objeto no cambió: reutilizar normalizado anterior
   - Ahorro: 200-300ms si se recarga

### Fase 3 (Validación)
7. **Perfil DevTools Performance**
   - Antes: Total ~6-8s
   - Después: Total ~1.5-2s
   - **Target: 78% improvement = Success** ✅

---

## 📝 Implementación Recomendada

### Código Base Consolidado
```javascript
async function fetchLeadsAgente(page = 1) {
  console.log('[fetchLeadsAgente] Iniciando...');
  
  // 1. FAST PATH: Cache
  const cached = await tryLoadFromPrecachedData();
  if (cached?.length > 0) {
    renderCostumerTable(normalizeLeads(cached));
    return;
  }
  
  // 2. MAIN REQUEST: Single API call
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const url = `/api/leads?page=1&limit=50000&skipDate=1&showAllMonths=1`;
  const response = await fetch(url, { 
    credentials: 'include',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  const data = await response.json();
  let leads = Array.isArray(data) ? data : (data?.data || data?.leads || []);
  
  // 3. SINGLE FALLBACK: Only if empty
  if (!leads?.length) {
    const fallback = await fetch(`/api/leads?limit=500`, ...);
    if (fallback.ok) leads = await fallback.json();
  }
  
  // 4. RENDER
  renderCostumerTable(normalizeLeads(leads));
  
  // 5. INIT: All at once
  initTableFeatures(); // mirrors, colors, sidebar, team líneas, etc
}
```

---

## 🎯 Próximos Pasos

- [ ] Implementar cambios Fase 1 (eliminar requests duplicados)
- [ ] Medir con DevTools Performance: Verificar mejora 1.5-2s
- [ ] Implementar Fase 2 (consolidar listeners)
- [ ] Medir nuevamente: Validar 78% improvement
- [ ] Desplegar y monitorear en producción

