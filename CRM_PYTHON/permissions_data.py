"""
Catálogo administrable de permisos — fuente de datos + siembra.

La tabla `permission_definitions` (creada por la migración 0041 en main.py) es el
catálogo que se administra desde la pestaña "Permisos avanzados" de crear-cuenta.html.
Se siembra con dos grupos de filas:

1. Los 17 permisos "clásicos" (ALL_PERMS en crear-cuenta.html), copiados aquí SOLO para
   que aparezcan listados en el catálogo nuevo — is_system=1 así el admin no puede
   borrarlos ni renombrar su key. Su asignación por usuario sigue siendo, como siempre,
   los checkboxes de la pestaña Usuarios (PUT /api/users/{id}/permissions); esta tabla
   no los gestiona.
2. Permisos nuevos que sí tienen lógica real conectada (enforced=1) — hoy solo
   'market:restrict_view' (ver permissions.py → resolve_market_restriction, usado en
   routers/leads.py, routers/ranking.py y routers/equipo.py).

enforced=0 marca permisos que un admin creó desde la UI pero que todavía no tienen
código que los aplique (el catálogo se lo indica en pantalla).
"""

# (perm_key, label, description, group_name, scope, enforced, is_system)
PERMISSION_DEFS_SEED = [
    # ── Permisos clásicos (solo visibilidad; se gestionan vía checkboxes de Usuarios) ──
    ("read:all",          "Leer todos los leads",   "", "General", "user", True, True),
    ("write:all",         "Editar todos los leads", "", "General", "user", True, True),
    ("delete:all",        "Eliminar leads",         "", "General", "user", True, True),
    ("read:own",          "Leer propios",           "", "General", "user", True, True),
    ("write:own",         "Editar propios",         "", "General", "user", True, True),
    ("read:team",         "Leer equipo",            "", "Equipo",  "user", True, True),
    ("write:team",        "Editar equipo",          "", "Equipo",  "user", True, True),
    ("view:reports",      "Ver reportes",           "", "Equipo",  "user", True, True),
    ("read:team:lineas",  "Leer equipo Líneas",     "", "Líneas",  "user", True, True),
    ("write:team:lineas", "Editar equipo Líneas",   "", "Líneas",  "user", True, True),
    ("read:own:lineas",   "Leer propios Líneas",    "", "Líneas",  "user", True, True),
    ("write:own:lineas",  "Editar propios Líneas",  "", "Líneas",  "user", True, True),
    ("form:lineas",       "Formulario Líneas",      "", "Líneas",  "user", True, True),
    ("manage:lineas",     "Gestionar Líneas",       "", "Líneas",  "user", True, True),
    ("export:data",       "Exportar datos",         "", "Admin",   "user", True, True),
    ("manage:users",      "Gestionar usuarios",     "", "Admin",   "user", True, True),
    ("manage:employees",  "Gestionar empleados",    "", "Admin",   "user", True, True),
    # ── Permisos dinámicos con lógica real conectada ──
    ("market:restrict_view", "Restringir a un solo mercado",
     "El equipo (o usuario) solo ve leads, estadísticas y productividad del mercado "
     "configurado (ej. BAMO). Se aplica en Leads/Ventas, Estadísticas/Ranking y "
     "Equipos/Productividad.",
     "Mercado", "team", True, True),
]


async def ensure_permission_defs(session) -> None:
    """Siembra permission_definitions SOLO con filas que aún no existan (INSERT IGNORE
    por perm_key): no pisa ediciones que el admin haya hecho desde la UI."""
    from sqlalchemy import text
    for perm_key, label, description, group_name, scope, enforced, is_system in PERMISSION_DEFS_SEED:
        await session.execute(text("""
            INSERT IGNORE INTO permission_definitions
                (perm_key, label, description, group_name, scope, enforced, is_system)
            VALUES (:k, :l, :d, :g, :s, :e, :sys)
        """), {
            "k": perm_key, "l": label, "d": description, "g": group_name,
            "s": scope, "e": enforced, "sys": is_system,
        })
    await session.commit()
