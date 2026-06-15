# Informe Técnico de Mantenimiento — CRM Connecting
**Fecha:** 2026-06-14
**Ejecutado por:** Daniel Martinez 
**Rama:** main
**Servidor:** FastAPI + MySQL (Aiven Cloud) · Puerto 8001

---

## 1. Seguridad — Sección Líneas

> Origen: análisis "Buenos días Code". Correcciones ordenadas de más grave a menos grave.
> **Estado:** commiteadas (commit `10608df`) y **pusheadas a GitHub (origin)**. El push al deploy de Hugging Face (`hf`) **quedó pendiente** por fallo de autenticación (ver §5).

### 1.1 XSS almacenado en el frontend de Líneas
- **Problema:** Datos de texto libre que entran por el **webhook público del chatbot** (`POST /api/webhook/lineas`: nombre, teléfono, dirección, servicio, notas) y nombres de agentes se inyectaban en `innerHTML` **sin escapar**, ejecutándose automáticamente al renderizar listas. Un `nombre` con `<img src=x onerror=...>` se ejecutaba al cargar la tabla → robo de sesión / acciones en nombre de la víctima.
- **Acción:** Helper `escH()` (escapa `& < > " '`, válido para contenido y atributos con comillas dobles) aplicado en cada punto de interpolación de datos del servidor.
- **Archivos:** `frontend/lineas/costumer.html` (19 puntos: tarjeta de cliente, info general, líneas asociadas, notas, inputs de edición), `frontend/lineas/inicio.html` (rankings + "ventas recientes"), `frontend/lineas/lead.html`, `frontend/lineas/llamadas-ventas.html`, `frontend/js/ranking-lineas.js`.
- **Nota:** `facturacion.html` ya era seguro (usa `textContent`); `estadisticas.html` solo tiene strings estáticos.

### 1.2 Comparación de API key del webhook no era timing-safe
- **Problema:** `webhook_post` comparaba la clave con `x_api_key != WEBHOOK_KEY` (comparación no constante → filtrable por timing).
- **Acción:** Cambiado a `secrets.compare_digest(...)`.
- **Archivos:** `CRM_PYTHON/routers/lineas.py`

### 1.3 SheetJS (xlsx) 0.18.5 vulnerable
- **Problema:** `costumer.html` cargaba **xlsx 0.18.5 desde cdnjs** y **parsea archivos subidos por el usuario** (`XLSX.read` → `sheet_to_json`). Esa versión es vulnerable a **CVE-2023-30533** (prototype pollution, corregido en 0.19.3) y **CVE-2024-22363** (ReDoS, corregido en 0.20.2). Un usuario autenticado podía subir un `.xlsx` malicioso.
- **Acción:** Descargada **xlsx 0.20.3** (parcheada) al vendor local `frontend/vendor/xlsx/xlsx-0.20.3.full.min.js` (self-host, sin tocar el `xlsx.full.min.js` 0.18.5 existente — que no se usa en ningún lado). `costumer.html` ahora carga la copia local; se elimina además la dependencia de CDN externo. Verificada versión e integridad (round-trip de lectura/escritura).
- **Archivos:** `frontend/lineas/costumer.html`, `frontend/vendor/xlsx/xlsx-0.20.3.full.min.js` (nuevo)

### 1.4 Token JWT expuesto a JavaScript
- **Hallazgo:** El frontend ya **no** guardaba el token en `localStorage` (la auth real era por cookie httpOnly; `login.js` solo persiste el objeto `user`). La única fuga restante era que `POST /login` devolvía `"token": token` en el **body** de la respuesta.
- **Acción:** Eliminado el campo `token` del body de `/login`. Ahora el JWT vive **exclusivamente** en la cookie httpOnly → inaccesible a JS, por lo que un XSS ya no puede robar la sesión. Verificado que `login.js` solo usa `data.success`/`data.user` (no rompe el login).
- **Archivos:** `CRM_PYTHON/routers/auth.py`

---

## 2. Mantenimiento — Sección Líneas y backend

### 2.1 Videos huérfanos eliminados del repositorio
- **Problema:** Dos videos versionados (~26 MB) sin referencia alguna en el código: `frontend/public/images/lanocheestrellada.mp4` (24 MB) y `frontend/images/videos/VIDEO DE FONDO CONNECTING.mp4` (2 MB). Confirmado con `git grep` que no se usan.
- **Acción:** `git rm` de ambos.
- **Nota:** Quita los archivos del working tree, pero **no reduce el `.git`** hasta reescribir el historial (operación destructiva, **no realizada**).

### 2.2 `except:` desnudos acotados en todo el backend
- **Problema:** 21 bloques `except:` sin tipo (incluidos 2 `except: pass`) capturaban también `KeyboardInterrupt`/`SystemExit`/`GeneratorExit` — mala práctica que puede tragarse señales del sistema.
- **Acción:** Todos eran `json.loads` / `datetime.strptime` / `float()` con fallback. Acotados a `except (ValueError, TypeError):` (manteniendo el fallback intacto). 0 `except:` desnudos restantes; backend compila completo.
- **Archivos:** `lineas.py`, `llamadas_ventas_lineas.py`, `facturacion_lineas.py`, `auth.py`, `facturacion.py`, `init.py`, `leads.py`, `misc.py`, `pre_leads.py`, `ranking.py`, `users.py`.

### 2.3 Limpieza de código legacy del token en Líneas
- **Problema:** 18 sitios leían `localStorage.getItem('token')` (siempre `null` desde la migración a cookie) y añadían cabeceras `Authorization: Bearer null` redundantes (la cookie autentica por same-origin).
- **Acción:** Eliminados `const token = ...` y las cabeceras `Authorization` redundantes en `costumer.html` (10), `facturacion.html` (2), `lead.html` (2), `llamadas-ventas.html` (3). En `comisiones.html` (líneas) había un caso especial que **decodificaba el JWT para detectar el rol** (bloque muerto con token=null) → migrado a leer el objeto `user` de `localStorage`.

---

## 3. Sección Residencial — Permisos y acceso por rol

> Se levantó temporalmente el foco "solo Líneas" para trabajar permisos de residencial.
> **Estado:** en el working tree, **sin commitear** (a la espera de pruebas funcionales del usuario).

### 3.1 Dashboard de Inicio — métricas del Supervisor
- **Problema:** En el Inicio residencial, las tarjetas "Mis Métricas del Mes" (Ventas/Puntos totales) mostraban **0** para los supervisores. La rama que devuelve los totales **globales** estaba limitada a admin/backoffice; los demás roles se buscaban a sí mismos en el ranking de agentes, y un supervisor no vende a su nombre → 0.
- **Acción:** Incluidos los supervisores en la rama global: ahora ven los **mismos KPIs globales que un admin** (`kpis.ventas_totales`/`puntos_totales`, que ya venían globales del backend). No requirió cambios de backend.
- **Archivos:** `frontend/residencial/inicio.html`

### 3.2 Comisiones — el Supervisor ve solo a su equipo (solo lectura)
- **Problema:** Un supervisor caía en la "vista de agente" de comisiones (se buscaba a sí mismo como vendedor → vacío). Además, al no encontrar coincidencia, el objeto de respaldo de `resolveAgentData` **no incluía `rawName`** y `buildSelfViewHTML` hacía `agentData.rawName.toLowerCase()` → **crash** (`TypeError: Cannot read properties of undefined`). Bug **preexistente** que afectaba a cualquier usuario sin ventas propias.
- **Acción:**
  1. **Fix del crash:** añadido `rawName` al objeto de respaldo de `resolveAgentData`.
  2. **Vista de equipo:** el supervisor ahora ve la **grilla del equipo** (KPIs + tarjetas + tabla), filtrada a **los agentes de su equipo**.
  3. **Fuente de verdad = página de Permisos:** los agentes del equipo se obtienen de **`GET /api/teams/agents?supervisor={usuario}`**, que agrupa por `users.team` (la misma "card de team" de la página de permisos). El emparejamiento cruza el nombre del agente en los leads con el `name`/`username` de su ficha de usuario.
  4. **Solo lectura:** el badge "Tipo" (que recalcula la comisión) solo es editable por admin (`canEditTipo`); `cycleAgentTipo` aborta si el usuario no es admin. La edición de pago vive en la vista personal, que ya no se muestra al supervisor.
  5. **Seguridad ante fallo:** si el endpoint del equipo falla, no se exponen agentes de otros equipos (lista vacía en lugar de "todos").
- **Archivos:** `frontend/residencial/comisiones.html`

---

## 4. Verificaciones realizadas

| Verificación | Resultado |
|---|---|
| Sintaxis JS de cada bloque inline editado (vía `vm.Script`) | ✅ |
| `py_compile` de los routers editados | ✅ |
| Compilación completa del backend (`compileall`) | ✅ |
| `escH()` contra payloads XSS (`<img onerror>`, `"><script>`) | ✅ neutralizados |
| xlsx 0.20.3 descargado: versión + round-trip lectura/escritura | ✅ 0.20.3 |
| `login.js` no depende del token del body | ✅ |
| Push a GitHub (origin) del commit de Líneas | ✅ `4331a6f..10608df` |
| Push a Hugging Face (deploy) | ❌ fallo de auth (ver §5) |

---

## 5. Pendientes

1. **Deploy a Hugging Face pendiente.** `git push hf main` falló con `Invalid username or password`. Resolver de forma segura (`huggingface-cli login` con un token **write** sobre el Space `zombie55093/CRM`) y reintentar. No incrustar el token en la URL del remoto.
2. **Commit de los cambios de Residencial.** Los cambios de §3 (inicio + comisiones) están en el working tree sin commitear, a la espera de prueba funcional (verificar como supervisor que el Inicio muestra los globales y Comisiones muestra solo su equipo).
3. **Estadísticas Residencial — métricas del agente (EN CURSO).** Pendiente: en `frontend/residencial/estadisticas.html`, las métricas de los KPIs (`kv-ventas`, `kv-icon`, `kv-puntaje`, `kv-activacion`) deben mostrar los **datos globales** (los mismos que ve el administrador) en lugar de filtrarse a los leads del agente. Hoy `/api/leads/bootstrap` filtra por agente (`_is_agent`), por eso difieren. Requiere que estadísticas obtenga los totales globales sin romper el filtrado de la Lista de Clientes (que sí debe seguir mostrando solo los del agente).
4. **Validación de emparejamiento de equipo en Comisiones.** Confirmar que cada supervisor ve exactamente los agentes de su card de permisos; si algún agente difiere de nombre entre los leads y su ficha de usuario, ajustar el mapeo.
5. **Pendientes heredados** (informe 2026-06-12): borrar `Documents/dashboard-backup-2026-06-12.bundle` cuando se confirme estabilidad; configurar `MYSQL_SSL_CA`; poner `COOKIE_SAMESITE=lax` si frontend y API se unifican en un dominio.
