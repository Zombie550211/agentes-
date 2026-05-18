# Informe de Mantenimiento Técnico
**Proyecto:** CRM Agentes Dashboard  
**Commit:** `b81c313`  
**Fecha:** 21 de abril de 2026  
**Responsable:** Daniel Martinez  

---

## Resumen Ejecutivo

Se realizó una limpieza general del repositorio eliminando archivos obsoletos, unificando dependencias externas y corrigiendo inconsistencias de configuración acumuladas desde el inicio del proyecto. El resultado neto fue la eliminación de **4,474 líneas de código muerto** y **~1.6 MB** de archivos innecesarios en 58 archivos modificados.

---

## 1. Eliminación de Scripts Temporales (Raíz)

**Archivos eliminados:** 29  
**Peso aproximado:** ~180 KB

Todos eran residuos de una migración de encoding de caracteres ya resuelta. Ninguno era requerido por `server.js` ni referenciado desde ningún HTML.

| Categoría | Archivos eliminados |
|---|---|
| Fix de encoding | `brutal_fix.js`, `brutal_fix2.js`, `bytes_fix.js`, `comprehensive_fix.js`, `deep_encoding_fix.js`, `direct_line_fix.js`, `direct_replace.js`, `final_cleanup.js`, `final_fix.js`, `fix_enc.js`, `fix_encoding.js`, `fix_encoding_deep.js`, `fix_encoding_emojis.js`, `fix_encoding_final.js`, `fix_encoding_phase2.js`, `fix_encoding_safe.js`, `fix_final.js`, `fix_hex.js`, `fix_remaining.js`, `fix_utf8_final.js`, `hex_fix.js`, `line_by_line_fix.js`, `simple_fix.js`, `smart_fix.js` |
| Análisis | `byte_analysis.js`, `buffer_replace.js`, `detect_encoding.js`, `find_patterns.js`, `read_utf8.js`, `replace_remaining.js` |
| Datos de prueba | `populate-test-data.js`, `populate_leads_data.js`, `setup-test-data.js`, `check_leads_data.js` |
| Migración puntual | `script-pending-by-batches.js`, `script-set-all-lines-pending.js`, `script_teams_mongodb.js`, `update-password.js`, `map-functions.js` |
| Python helpers | `clean_html.py`, `fix_encoding.py`, `fix_encoding_simple.py`, `fix_encoding_v2.py`, `fix_utf8_costumer.py` |

---

## 2. Rutas Backend Duplicadas

**Archivos eliminados:** 7  
**Líneas eliminadas:** ~3,230

`server.js` carga únicamente `backend/routes/api.js` mediante `app.use('/api', require('./backend/routes/api'))`. Las demás versiones eran snapshots de ediciones previas que nunca fueron limpiadas y nunca se montaban en el servidor.

```
backend/routes/
  ├── api.js                ← ACTIVO
  ├── api_backup.js         ← ELIMINADO
  ├── api_before_restore.js ← ELIMINADO
  ├── api_clean.js          ← ELIMINADO
  ├── api_clean_version.js  ← ELIMINADO
  ├── api_fixed.js          ← ELIMINADO
  ├── api_new.js            ← ELIMINADO
  └── api_temp.js           ← ELIMINADO
```

---

## 3. Vendor Duplicado (`public/vendor/`)

**Archivos eliminados:** 11  
**Motivo:** Duplicado exacto de `frontend/vendor/`, sin ninguna referencia en HTMLs

Se verificó mediante grep que ningún archivo HTML referenciaba `public/vendor` antes de eliminar.

| Archivo eliminado | Conservado en |
|---|---|
| `public/vendor/chartjs/chart.umd.min.js` | `vendor/chartjs/chart.umd.min.js` |
| `public/vendor/chartjs-plugin/chartjs-plugin-datalabels.min.js` | `vendor/chartjs-plugin/...` |
| `public/vendor/fontawesome/css/all.min.css` | `vendor/fontawesome/...` |
| `public/vendor/fontawesome/webfonts/*.woff2` (4 archivos) | `vendor/fontawesome/webfonts/...` |
| `public/vendor/xlsx/xlsx.full.min.js` | `vendor/xlsx/...` |

---

## 4. Archivos Frontend Sin Uso

**Archivos eliminados:** 4

| Archivo | Tamaño | Motivo de eliminación |
|---|---|---|
| `frontend/test_baa.html` | 1.2 MB | Export HTML masivo, nunca referenciado en ninguna ruta |
| `frontend/debug.html` | 2.5 KB | Página de debug abandonada sin rutas activas |
| `frontend/Costumer_functions_only.html` | 636 B | Shell vacío sin contenido funcional |
| `frontend/CSS_COMPLETO.css` | 15 KB | 0 referencias en cualquier HTML del proyecto |

---

## 5. Referencia Rota — `Costumer.html`

El archivo `scripts/measure_fetch_times.js` nunca existió en el repositorio. Generaba un error 404 silencioso en cada carga de `Costumer.html`. Al no usar `defer` ni `async`, añadía latencia bloqueante al inicio de la página.

```html
<!-- ANTES -->
<script src="scripts/measure_fetch_times.js"></script>  ← 404 en producción
<script src="/js/fetch-interceptor.js"></script>

<!-- DESPUÉS -->
<script src="/js/fetch-interceptor.js"></script>
```

---

## 6. FontAwesome — Unificación a `6.5.1`

**Archivos modificados:** 21 HTMLs

Se encontraban 5 versiones distintas cargadas simultáneamente en el proyecto:

| Versión anterior | Archivos afectados |
|---|---|
| `5.15.4` | `index.html`, `multimedia.html`, `Ranking y Promociones.html` |
| `6.0.0` | `lead.html`, `lead-lineas.html`, `Premios.html`, `Reglas.html`, `Tabla de puntaje.html`, `register.html`, `reset-password.html`, `TEAM LINEAS/COSTUMER-LINEAS.html`, `TEAM LINEAS/ESTADISTICAS-LINEAS.html`, `TEAM LINEAS/INICIO-LINEAS.html`, `TEAM LINEAS/LEAD-LINEAS.html` |
| `6.4.0` | `login.html`, `inicio.html`, `crear-cuenta.html`, `empleado-del-mes.html` |
| `6.5.0` | `Estadisticas.html`, `rankingAgente.html` |
| **`6.5.1`** | **Versión final unificada en todos los archivos** |

**Notas técnicas:**
- La migración `5.x → 6.x` cambió la clase base de `fa` a `fa-solid`/`fa-regular`. Las páginas que usaban `5.15.4` podían tener iconos rotos sin que fuera evidente.
- La migración `6.0 → 6.5` es retro-compatible; solo agrega nuevos iconos y correcciones.

---

## 7. Parámetro de Caché CSS — Estandarización

**Archivos modificados:** 9 HTMLs  
**Versión estándar adoptada:** `?v=20251124f`

Se encontraron tres estados distintos para `sidebar-shared.css`:

```
sidebar-shared.css?v=20250905-163930   ← versión antigua
sidebar-shared.css?v=20251124f         ← versión correcta
sidebar-shared.css                     ← sin versión (fuerza re-descarga en cada visita)
```

Sin un parámetro de caché consistente, cada navegador podía cachear una versión diferente del CSS según cuándo cargó la página por primera vez, generando inconsistencias visuales entre usuarios.

**Archivos corregidos:**
`facturacion.html`, `index.html`, `inicio.html`, `multimedia.html`, `Ranking y Promociones.html`, `register.html`, `Reglas.html`, `Tabla de puntaje.html`, y varios de `TEAM LINEAS/`

---

## 8. Índices MongoDB — `ENTRANTES_CHATBOT`

Se agregaron tres índices a la colección `ENTRANTES_CHATBOT` (base de datos `TEAM_LINEAS`) dentro de la función `ensureIndexes()` que se ejecuta al arrancar el servidor.

```javascript
cb.createIndex({ creadoEn: -1 },  { name: 'idx_cb_creadoEn' })   // orden descendente para GET
cb.createIndex({ agente: 1 },     { name: 'idx_cb_agente' })      // filtro por agente asignado
cb.createIndex({ supervisor: 1 }, { name: 'idx_cb_supervisor' })  // filtro por supervisor
```

**Impacto:** Sin índices, cada `GET /api/webhook/lineas` ejecutaba un full collection scan (complejidad O(n)). Con los índices, las consultas filtradas por agente o supervisor escalan en O(log n).

---

## Resultado Neto

| Métrica | Antes | Después |
|---|---|---|
| Scripts en raíz del proyecto | 47 | 6 |
| Versiones activas de `api.js` | 8 | 1 |
| Versiones de FontAwesome en uso | 5 | 1 |
| Estados del parámetro de caché CSS | 3 | 1 |
| Copias del directorio `vendor/` | 2 | 1 |
| Tamaño total eliminado | — | ~1.6 MB |
| Líneas de código eliminadas | — | 4,474 |
| Archivos modificados en el commit | — | 58 |

---

## Pendientes Recomendados (Próximo Ciclo)

Los siguientes puntos no se abordaron en este ciclo por requerir mayor análisis o porque implican riesgo de rotura funcional:

1. **Rotar credenciales** — El archivo `.env` con MongoDB URI, Cloudinary API Key/Secret y Webhook Key fue commiteado al repositorio en algún punto. Se recomienda rotar todas las credenciales desde los paneles de MongoDB Atlas y Cloudinary.
2. **Persistir índice round-robin en BD** — El contador de asignación automática de agentes se reinicia con cada reinicio del servidor. Para producción estable se recomienda guardar el índice en una colección de configuración en MongoDB.
3. **Modularizar HTMLs monolíticos** — `Costumer.html` (3,114 líneas), `Ranking y Promociones.html` (3,198 líneas) y `El semaforo.html` (2,165 líneas) concentran lógica que debería separarse en módulos JS independientes.
4. **Agregar `defer` a scripts no críticos** — La mayoría de los `<script>` en los HTMLs son bloqueantes. Agregar `defer` reduciría el tiempo de primer render.
