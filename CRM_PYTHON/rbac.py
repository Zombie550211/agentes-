"""Roles y permisos del CRM — fuente única (RBAC).

- QUÉ ACCIONES EXISTEN lo define el código (ACCIONES, abajo): un permiso solo protege
  algo si el servidor lo revisa en ese punto con `tiene()` / `exigir()` / `requiere()`.
- QUÉ ROLES EXISTEN y QUÉ ACCIONES TIENE CADA ROL vive en la base de datos (tablas
  `roles` y `rol_permisos`, migraciones 0096-0098) y se edita desde Permisos.
- Denegar por defecto: un rol que no tiene marcada una acción no la puede hacer; un rol
  desconocido no tiene ninguna.

Al arrancar, `asegurar()` crea los 8 roles de siempre y, para cada acción NUEVA del
catálogo, le da sus roles por defecto (los que tenían ese permiso en el código antes de
existir este módulo). Las acciones ya conocidas no se tocan: lo que un administrador
cambió desde Permisos se respeta.

`tiene()` es síncrona: lee una caché en memoria que se carga al arrancar y se recarga
al guardar cambios (el despliegue corre un solo worker). Si la caché aún no se cargó
(p. ej. BD caída al arrancar) se usan los valores por defecto del código.
"""
import unicodedata

from fastapi import Depends, HTTPException
from sqlalchemy import text

ADMIN = "Administrador"
BO = "Backoffice"
ICON = "Rol_icon"
SUP = "Supervisor"
SUP_LIN = "Supervisor Team Lineas"
AGENTE = "Agente"
VENDEDOR = "vendedor"
AG_LIN = "Lineas-Agentes"

# Roles de siempre: (clave guardada en users.role, nombre visible, descripción, orden)
ROLES_BASE = [
    (ADMIN, "Administrador", "Todo el CRM, incluida la página de Permisos.", 1),
    (BO, "Backoffice", "Gestiona las ventas de todos los equipos y los ajustes de ventas.", 2),
    (ICON, "Rol Icon", "Gestiona las ventas del mercado ICON.", 3),
    (SUP, "Supervisor", "Supervisa su equipo de Residencial.", 4),
    (SUP_LIN, "Supervisor Líneas", "Supervisa su equipo de Líneas y la cola de Transferencias.", 5),
    (AGENTE, "Agente", "Sus propias ventas.", 6),
    (VENDEDOR, "Vendedor", "Igual que Agente.", 7),
    (AG_LIN, "Líneas Agente", "Sus propios clientes de Líneas.", 8),
]

# Catálogo: (clave, módulo, etiqueta, descripción, roles por defecto)
ACCIONES = [
    # ── Usuarios y permisos ──
    ("usuarios.gestionar", "Usuarios y permisos", "Gestionar usuarios",
     "Crear, editar, suspender, eliminar y unificar cuentas; ver el registro de cambios.", [ADMIN]),
    ("usuarios.ver_lista", "Usuarios y permisos", "Ver la lista completa de usuarios",
     "Datos de todas las cuentas (para reportes y selectores).", [ADMIN, BO]),
    ("roles.gestionar", "Usuarios y permisos", "Gestionar roles y permisos",
     "Crear roles y decidir qué puede hacer cada uno.", [ADMIN]),
    ("mercado.restringir", "Usuarios y permisos", "Restringir a un solo mercado",
     "Decidir qué equipo o persona ve solo un mercado.", [ADMIN]),
    # ── Ajustes de ventas ──
    ("catalogos.editar", "Ajustes de ventas", "Editar catálogos del formulario", "", [ADMIN, BO]),
    ("productos.editar", "Ajustes de ventas", "Editar servicios y puntajes", "", [ADMIN, BO]),
    ("finesemana.editar", "Ajustes de ventas", "Editar la rotación de fines de semana", "", [ADMIN, BO]),
    # ── Ventas ──
    ("ventas.gestion", "Ventas", "Gestionar todas las ventas",
     "Ver y editar las de todos los equipos, eliminarlas, status de comisión, casos y Riesgo CX.", [ADMIN, BO, ICON]),
    ("ventas.supervisar", "Ventas", "Supervisar ventas",
     "Ver las ventas de todos los equipos y gestionar su status y comisión como supervisor.", [SUP, SUP_LIN]),
    ("ventas.cambiar_status", "Ventas", "Cambiar el status de una venta",
     "Sin este permiso solo se cambia el status de comisión (así trabaja Back Office).", [ADMIN, ICON, SUP, SUP_LIN]),
    ("ventas.moderar_comentarios", "Ventas", "Editar o borrar comentarios de otros", "", [ADMIN, BO]),
    # ── Líneas ──
    ("lineas.gestion", "Líneas", "Gestionar todos los clientes de Líneas",
     "Ver, editar y eliminar los de todos los equipos.", [ADMIN, BO, ICON]),
    ("lineas.supervisar", "Líneas", "Supervisar los clientes de su equipo de Líneas", "", [SUP, SUP_LIN]),
    # ── Horarios ──
    ("horarios.gestionar_todos", "Horarios", "Gestionar los horarios de todos los equipos", "", [ADMIN, BO]),
    ("horarios.su_equipo", "Horarios", "Gestionar los horarios de su equipo", "", [SUP, SUP_LIN]),
    ("horarios.dias_pasados", "Horarios", "Editar días pasados", "Sin este permiso solo desde hoy en adelante.", [ADMIN]),
    # ── Monitoreo ──
    ("monitoreo.gestionar_todos", "Monitoreo", "Marcar faltas de todos los equipos", "", [ADMIN, BO]),
    ("monitoreo.su_equipo", "Monitoreo", "Marcar faltas de su equipo", "", [SUP, SUP_LIN]),
    # ── Llamadas y ventas por team ──
    ("llamadas_ventas.ver", "Llamadas y ventas", "Ver Llamadas y Ventas por Team", "", [ADMIN, BO, SUP, SUP_LIN]),
    ("llamadas_ventas.editar_todos", "Llamadas y ventas", "Editar Llamadas y Ventas de todos los equipos",
     "Sin este permiso, solo las de su equipo.", [ADMIN, BO]),
    # ── Transferencias (ver) ──
    ("transferencias.ver_todas", "Transferencias", "Ver y cerrar las transferencias de todos", "", [ADMIN, BO]),
    ("transferencias.su_equipo", "Transferencias", "Ver las transferencias de su equipo", "", [SUP, SUP_LIN]),
    # ── Resúmenes (inicio, actividad reciente, clientes, instalaciones) ──
    ("paneles.ver_todo", "Resúmenes", "Ver los resúmenes de todos los equipos",
     "Inicio, actividad reciente, clientes e instalaciones del día de todo el CRM.", [ADMIN, BO]),
    ("paneles.su_equipo", "Resúmenes", "Ver los resúmenes de su equipo", "", [SUP, SUP_LIN]),
    ("menu.ambas_secciones", "Usuarios y permisos", "Ver Residencial y Líneas en el menú",
     "Sin este permiso, el menú muestra solo la sección de su equipo.", [ADMIN, BO, ICON]),
    ("equipos.renombrar", "Usuarios y permisos", "Registrar renombres de equipo",
     "Para que las ventas viejas cuenten con el nombre nuevo del equipo.", [ADMIN, BO]),
    ("ventas.estado_masivo", "Ventas", "Cambiar el status de muchas ventas a la vez",
     "Por lista de teléfonos o de nombres.", [ADMIN, ICON]),
    ("comisiones.gestionar", "Comisiones", "Gestionar comisiones",
     "Ver la tendencia y decidir qué agentes no comisionan un mes.", [ADMIN, BO, ICON]),
    ("consolidado.ver_todo", "Estadísticas", "Ver el consolidado de todos los equipos", "", [ADMIN, BO]),
    ("estadisticas.cxc_editar", "Estadísticas", "Editar la tabla CXC Xfinity",
     "El equipo Control de Calidad también puede, por su equipo.", [ADMIN]),
    ("llamadas_ventas.registro", "Llamadas y ventas", "Registro diario de llamadas y ventas", "", [ADMIN, BO]),
    # ── Transferencias ──
    ("transferencias.gestionar_cola", "Transferencias", "Gestionar la cola",
     "Dar prioridad, pausar, cambiar el status y sacar agentes de la cola.", [ADMIN, SUP_LIN]),
    # ── Pre-leads ──
    ("pre_leads.procesar", "Pre-leads", "Procesar pre-leads", "Ver todos y resolverlos.", [ADMIN]),
    # ── Monitoreo ──
    ("monitoreo.alertas", "Monitoreo", "Ver las alertas de faltas", "", [ADMIN]),
    # ── Facturación ──
    ("facturacion.residencial", "Facturación", "Facturación de Residencial", "", [ADMIN]),
    ("facturacion.lineas", "Facturación", "Facturación de Líneas", "", [ADMIN, BO]),
    ("recibos.google", "Facturación", "Recibos de Google Ads", "", [ADMIN]),
    # ── Contenido ──
    ("contenido.publicar", "Contenido", "Publicar premios, promociones, video y empleado del mes", "", [ADMIN]),
    ("archivos.gestionar", "Contenido", "Ver todos los archivos y eliminarlos", "", [ADMIN, BO]),
    ("multimedia.eliminar", "Contenido", "Eliminar multimedia", "", [ADMIN, BO]),
    # ── Sistema ──
    ("sistema.apariencia", "Sistema", "Cambiar la apariencia del CRM", "", [ADMIN, BO]),
    ("sistema.rendimiento", "Sistema", "Ver el rendimiento de usuarios",
     "Cuánto tarda cada pantalla en cargar en la PC de cada persona.", [ADMIN]),
    ("sistema.administrar", "Sistema", "Mantenimiento del sistema",
     "Modo mantenimiento, cerrar todas las sesiones, limpiar cachés.", [ADMIN]),
]
CLAVES = {a[0] for a in ACCIONES}
# Al rol Administrador nunca se le pueden quitar estas (si no, nadie podría arreglarlo).
PROTEGIDAS_ADMIN = {"usuarios.gestionar", "roles.gestionar"}

_cache: dict | None = None   # {"permisos": {rol_norm: set}, "roles": [dict]}


def norm(s) -> str:
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(s.replace("_", " ").replace("-", " ").lower().split())


# Variantes de escritura que ya existen en el CRM para cada rol.
_ALIAS = {
    "admin": ADMIN, "administrador": ADMIN,
    "back office": BO, "bo": BO,
    "rol icon": ICON, "rolicon": ICON,
    "supervisora": SUP,
    "agent": AGENTE,
    "lineas agentes": AG_LIN,
}


def _por_defecto() -> dict:
    perm: dict[str, set] = {}
    for clave, _m, _e, _d, roles in ACCIONES:
        for r in roles:
            perm.setdefault(norm(r), set()).add(clave)
    return perm


def _rol_de(user_o_rol) -> str:
    rol = user_o_rol.get("role", "") if isinstance(user_o_rol, dict) else user_o_rol
    n = norm(rol)
    return norm(_ALIAS.get(n, rol))


def acciones_de(user_o_rol) -> set:
    tabla = _cache["permisos"] if _cache else _por_defecto()
    return set(tabla.get(_rol_de(user_o_rol), set()))


def tiene(user_o_rol, accion: str) -> bool:
    if accion not in CLAVES:
        raise ValueError(f"Acción desconocida: {accion}")   # error de programación
    return accion in acciones_de(user_o_rol)


def exigir(user: dict, accion: str, mensaje: str = "No tienes permiso para esta acción") -> None:
    if not tiene(user, accion):
        raise HTTPException(403, mensaje)


def requiere(accion: str, mensaje: str = "No tienes permiso para esta acción"):
    """Dependencia de FastAPI: Depends(requiere("catalogos.editar"))."""
    from deps import current_user

    async def _dep(user: dict = Depends(current_user)):
        exigir(user, accion, mensaje)
        return user
    return _dep


def roles_cache() -> list[dict]:
    return list(_cache["roles"]) if _cache else [
        {"clave": c, "nombre": n, "descripcion": d, "orden": o, "sistema": 1, "activo": 1}
        for c, n, d, o in ROLES_BASE]


def rol_canonico(rol: str) -> str | None:
    """Clave del rol (como se guarda en users.role) o None si no existe o está inactivo."""
    n = _rol_de(rol)
    for r in roles_cache():
        if norm(r["clave"]) == n and r.get("activo", 1):
            return r["clave"]
    return None


async def asegurar(s) -> None:
    """Siembra roles base y permisos por defecto de acciones nuevas (idempotente)."""
    for clave, nombre, desc, orden in ROLES_BASE:
        await s.execute(text("""INSERT IGNORE INTO roles (clave, nombre, descripcion, orden, sistema, activo)
                                VALUES (:c, :n, :d, :o, 1, 1)"""), {"c": clave, "n": nombre, "d": desc, "o": orden})
    r = await s.execute(text("SELECT clave FROM rbac_acciones"))
    conocidas = {x[0] for x in r.all()}
    for clave, modulo, etiqueta, desc, roles in ACCIONES:
        await s.execute(text("""INSERT INTO rbac_acciones (clave, modulo, etiqueta, descripcion)
                                VALUES (:c, :m, :e, :d)
                                ON DUPLICATE KEY UPDATE modulo = :m, etiqueta = :e, descripcion = :d"""),
                        {"c": clave, "m": modulo, "e": etiqueta, "d": desc})
        if clave not in conocidas:
            for rol in roles:
                await s.execute(text("INSERT IGNORE INTO rol_permisos (rol, accion) VALUES (:r, :a)"),
                                {"r": rol, "a": clave})
    # El administrador siempre conserva las protegidas.
    for a in PROTEGIDAS_ADMIN:
        await s.execute(text("INSERT IGNORE INTO rol_permisos (rol, accion) VALUES (:r, :a)"), {"r": ADMIN, "a": a})
    await s.commit()


async def cargar(s) -> None:
    global _cache
    roles = [dict(x) for x in (await s.execute(text(
        "SELECT clave, nombre, descripcion, orden, sistema, activo FROM roles ORDER BY orden, nombre"))).mappings().all()]
    perm: dict[str, set] = {}
    for rol, accion in (await s.execute(text("SELECT rol, accion FROM rol_permisos"))).all():
        if accion in CLAVES:
            perm.setdefault(norm(rol), set()).add(accion)
    _cache = {"permisos": perm, "roles": roles}


async def recargar() -> None:
    from database_mysql import AsyncSessionLocal
    async with AsyncSessionLocal() as s:
        await cargar(s)
