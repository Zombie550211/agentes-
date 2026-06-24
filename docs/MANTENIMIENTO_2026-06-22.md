# Informe Técnico de Mantenimiento — CRM Connecting
**Fecha:** 2026-06-22
**Ejecutado por:** Daniel Martinez
**Rama:** main
**Servidor:** FastAPI + MySQL (Aiven Cloud) · Puerto 8001

> Origen: análisis "Buenos días Code". Sesión enfocada en cerrar los **puntos críticos**
> y los **pendientes acumulados** de informes previos (02-jun, 12-jun, 14-jun, 18-jun).
> Todo validado en vivo: conexión TLS real a Aiven, carga de la app (186 rutas),
> QA funcional con login y controles de rol reales contra la base de datos de producción.

---

## 1. Seguridad (crítico)

### 1.1 Normalización de fin de línea CRLF → LF
- **Problema:** 47 archivos de código (todos los routers Python, `run.py`, `database_mysql.py`,
  scripts, varios CSS/JS) y ~16 de configuración tenían **CRLF**, contra lo que pide
  `.editorconfig` (`end_of_line = lf`). Git los mostraba como "modificados" sin cambio real
  (~77 archivos), ensuciando cada `diff`/`status` y arriesgando conflictos de merge espurios.
- **Acción:**
  - Nuevo **`.gitattributes`** con `eol=lf` por tipo de archivo (binarios marcados `binary`),
    para que git normalice a LF en cada checkout sin importar el SO.
  - Convertidos a LF 72 archivos (código + config/docs), excluyendo `vendor/` y `socket.io/`
    (terceros, los normaliza git al próximo checkout).
- **Archivos:** `.gitattributes` (nuevo), 72 archivos normalizados.

### 1.2 Verificación TLS de MySQL activada y comprobada (cerrado, pendiente desde 02-jun)
- **Problema:** Sin `MYSQL_SSL_CA`, la conexión a Aiven usaba `CERT_NONE` + `check_hostname=False`
  (cifrada pero vulnerable a MITM). Pendiente de configurar desde el informe del 2026-06-02.
- **Acción:**
  - Descargado el CA cert de Aiven Console → guardado en `CRM_PYTHON/ca.pem`.
  - `MYSQL_SSL_CA` configurado en `.env` (ruta absoluta; `.env` no se versiona).
  - **`.gitignore`** ampliado con `*.pem`, `*.crt`, `*.key` (los certificados/llaves nunca se commitean).
- **Verificado en vivo:**
  - `openssl s_client -starttls mysql -CAfile ca.pem` → **`Verify return code: 0 (ok)`**;
    el cert del servidor (`CN=mysql-2f2a0b31-…`) está emitido por el Project CA del `ca.pem`.
  - Conexión real de la app: `verify_mode=CERT_REQUIRED`, `check_hostname=True`,
    **`SELECT VERSION()` → MySQL 8.4.8**. Sin MITM posible.
- **Archivos:** `CRM_PYTHON/.env`, `.gitignore`, `CRM_PYTHON/ca.pem` (no versionado).

---

## 2. Mantenibilidad

### 2.1 `datetime.utcnow()` deprecado — migración completa (cerrado, pendiente desde 18-jun)
- **Problema:** El informe del 18-jun migró solo `auth.py` y `lineas.py`; quedaban **87 llamadas
  en 22 routers** (deprecado en Python 3.12+, el servidor corre 3.13).
- **Acción:** Helper local `_utcnow()` → `datetime.now(timezone.utc).replace(tzinfo=None)`
  (UTC *naive*, idéntico a lo que devuelve MySQL) inyectado en cada router según su estilo de
  import (`_dt` alias o `from datetime import …`). Migración automatizada + reposicionamiento
  manual del helper en 6 archivos donde quedó mal insertado.
- **Verificado:** 0 llamadas `datetime.utcnow()` restantes; `py_compile` de todos los routers OK;
  **la app importa con `DeprecationWarning` elevado a error** sin fallar.
- **Archivos:** 22 routers en `CRM_PYTHON/routers/`.

### 2.2 Limpieza de `console.log` (continuación del 18-jun)
- **Problema:** 53 `console.log` de depuración restantes, varios **exponiendo datos sensibles**
  en la consola del navegador (token, cookies, datos de usuario/rol).
- **Acción:** 53 eliminados. Los más sensibles: `index.html` (25 — cookies, localStorage, datos
  de usuario), `register.html` (12 — username/rol/token), `multimedia.html` (6),
  `comisiones.html` (3), `reglas.html` (1), `agentes/js/auth-check.js` (1 — username).
  Se conservan `console.error/warn` (útiles).
- **Archivos:** `frontend/index.html`, `frontend/register.html`,
  `frontend/residencial/{multimedia,comisiones,reglas}.html`, `frontend/agentes/js/auth-check.js`.

---

## 3. Mejoras funcionales

### 3.1 KPIs de Estadísticas Residencial con datos globales (cerrado, EN CURSO desde 14-jun)
- **Problema:** En `frontend/residencial/estadisticas.html` los KPIs (`kv-ventas`, `kv-icon`,
  `kv-puntaje`, `kv-activacion`) y los gráficos por equipo se calculaban desde `/api/leads/bootstrap`,
  que **filtra por agente** (`_is_agent`). Un agente veía solo sus propias ventas en una página
  pensada para mostrar el panorama **global** de la empresa.
- **Acción (segura, sin fuga de PII):**
  - Backend: nuevo parámetro `stats=1` en `/api/leads/bootstrap`. En ese modo **no** se aplica el
    filtro por agente (datos globales, los mismos que ve el admin), pero se serializa con
    **`_serialize_lead_stats()`** — un serializador reducido que devuelve **solo campos agregables**
    (`dia_venta`, `dia_instalacion`, `status`, `puntaje`, `mercado`, `team`, `supervisor`,
    `servicios`, `tipo_servicio`). **No** incluye nombre, teléfono, dirección ni notas de clientes
    de otros agentes. La restricción por mercado (BAMO) se mantiene.
  - Frontend: la página pide `?stats=1`; clave de caché bumpeada `v12 → v13` para invalidar datos
    filtrados antiguos.
  - **La Lista de Clientes (`costumer.html`, sin `stats`) no cambia** → sigue filtrada por agente.
- **Verificado en vivo (agente real "Jonathan Morales", mes 2026-06):**
  - Modo NORMAL: **35 leads** (solo suyos). Modo STATS: **819 leads** (global). ✅
  - Payload de stats sin PII: `['dia_instalacion','dia_venta','id','mercado','puntaje','servicios','status','supervisor','team','tipo_servicio']`. ✅
- **Archivos:** `CRM_PYTHON/routers/leads.py`, `frontend/residencial/estadisticas.html`.

---

## 4. QA funcional (pendiente desde 18-jun)

Levantado el servidor real (puerto 8001) y probado contra la base de datos de producción con
usuarios de prueba temporales (`admin_qa_test`, `agente_qa_test`, **eliminados al terminar**):

| Prueba | Esperado | Resultado |
|--------|----------|-----------|
| Login credenciales inválidas | 401 | ✅ 401 |
| Login admin / agente | 200 | ✅ 200 (cookie de sesión OK) |
| DELETE líneas como **agente** | 403 | ✅ 403 |
| DELETE líneas como **admin** (id inexistente) | 404 (pasa control de rol) | ✅ 404 |
| PUT status como **agente** sobre registro ajeno | 403 | ✅ 403 |
| PUT status sin autenticación | 401 | ✅ 401 |
| PUT status como **admin** | 200 (acceso total) | ✅ 200 |
| Listado: admin ve todo / agente solo lo suyo | 1174 / 0 | ✅ |

- **Conclusión:** los controles de rol añadidos el 18-jun en `lineas.py`
  (`_user_scope_clause` / `_ensure_can_modify`, regla "lo que ves = lo que puedes editar")
  funcionan de extremo a extremo.
- **Nota:** durante el caso positivo (admin modifica) se cambió el `status` del registro real
  id 2265 a `PENDING`. Revisado con el operador: era el estado correcto para esa venta
  (creada 2026-06-22, instalación 2026-06-23). Para futuros QA de escritura debe usarse un
  registro de prueba dedicado, no datos reales.

---

## 5. Entorno de ejecución (Linux)

- **Problema:** El `.venv` del proyecto apuntaba a Windows (`C:\Users\Zombie\…`), inservible en
  el Kali Linux donde ahora se ejecuta el servidor. La máquina no tenía `pip`/`venv`.
- **Acción:** Instalados `python3-venv` y `python3-pip` (apt); recreado `CRM_PYTHON/.venv` para
  Linux e instalado `requirements.txt`. App cargando con **186 rutas**, conexión a Aiven OK.
- **Archivos:** `CRM_PYTHON/.venv/` (no versionado).

---

## 6. Pendientes (diferidos)

1. **Modularizar HTMLs monolíticos** (pendiente desde 21-abr). Hay 19 HTML de >800 líneas
   (el mayor `lineas/costumer.html` con 4399). **Diferido**: refactor grande y de alto riesgo
   (JS inline con dependencias de orden y globales), puramente de mantenibilidad. Debe abordarse
   como proyecto propio, archivo por archivo y verificando cada página.
2. **Deploy a Hugging Face** (pendiente desde 14-jun). `git push hf main` falla por auth; resolver
   con `huggingface-cli login` (token **write** del Space `zombie55093/CRM`). No incrustar el token
   en la URL del remoto.
3. **Borrar el backup** `Documents/dashboard-backup-2026-06-12.bundle` (344 MB) cuando se confirme
   estabilidad (decisión del operador).
4. **Dominio personalizado en Render** (`linea-latina.com`): introducir el nombre **sin** `https://`
   ni `/` final (Render pide el host, no la URL). Aplazado a petición del usuario.

---

## 7. Estado


