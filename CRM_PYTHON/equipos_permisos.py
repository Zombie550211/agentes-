"""Teams desde Roles y permisos: fuente única para todo lo que se mide por team.

Un team de venta es el `team` de un usuario con rol de supervisor (página de Permisos). Al
crear un team y asignarle supervisor, aparece solo en Semáforo, Estadísticas, Líneas, fines de
semana, etc.: no hay que escribirlo en el código.

Las ventas guardan el NOMBRE del supervisor (leads.supervisor, p. ej. «EDUARDO NUÑEZ») y el
usuario del agente (leads.agente). `ResolverTeam` pasa cualquiera de los dos al team de Permisos
(«TEAM MIGUEL NUÑEZ»).
"""
import re
import unicodedata

from sqlalchemy import text

from deps import team_seccion


def clave(v) -> str:
    """'Eduardo Nuñez' / 'eduardo.nunez' / 'EDUARDO  NUÑEZ' → 'EDUARDO NUNEZ'."""
    s = unicodedata.normalize("NFD", str(v or "")).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", re.sub(r"[._\-]+", " ", s)).strip()


class ResolverTeam:
    def __init__(self, supervisores: list[dict], usuarios: list[dict]):
        self.por_supervisor: dict[str, str] = {}
        self.por_usuario: dict[str, str] = {}
        self.teams: list[str] = []
        for u in supervisores:
            team = str(u.get("team") or "").strip()
            if not team:
                continue
            if team not in self.teams:
                self.teams.append(team)
            for k in (u.get("username"), u.get("name")):
                if clave(k):
                    self.por_supervisor.setdefault(clave(k), team)
            # El propio nombre del team también identifica al supervisor («TEAM IRANIA SERRANO»).
            self.por_supervisor.setdefault(clave(team), team)
            self.por_supervisor.setdefault(clave(re.sub(r"(?i)^team\s+", "", team)), team)
        for u in usuarios:
            team = str(u.get("team") or "").strip()
            if team and clave(u.get("username")):
                self.por_usuario.setdefault(clave(u.get("username")), team)
        self.teams.sort()

    def team(self, supervisor: str = "", agente: str = "", respaldo: str = "") -> str:
        """Team de Permisos de una venta: por su supervisor; si no, por el team del agente; si
        tampoco, el texto que traiga la venta (respaldo) o 'SIN EQUIPO'."""
        t = self.por_supervisor.get(clave(supervisor)) or self.por_usuario.get(clave(agente))
        if t:
            return t
        r = str(respaldo or supervisor or "").strip().upper()
        return self.por_supervisor.get(clave(r)) or r or "SIN EQUIPO"

    def de_seccion(self, seccion: str) -> list[str]:
        return [t for t in self.teams if team_seccion(t) == seccion]


async def cargar_resolver(s) -> ResolverTeam:
    """Lee de `users` los supervisores (con su team) y el team de cada usuario."""
    r = await s.execute(text("""
        SELECT username, name, TRIM(team) AS team, role, COALESCE(active, 1) AS active FROM users
        WHERE team IS NOT NULL AND TRIM(team) != ''
    """))
    rows = [dict(x) for x in r.mappings().all()]
    sup = [x for x in rows if "supervisor" in str(x["role"] or "").lower()]
    # Primero los supervisores activos: si un nombre se repite, gana el activo.
    sup.sort(key=lambda x: -int(x["active"] or 0))
    return ResolverTeam(sup, rows)


async def teams_de_venta(s, seccion: str = "") -> list[str]:
    """Teams con supervisor (los que se miden), opcionalmente de una sección (lineas/residencial)."""
    res = await cargar_resolver(s)
    return res.de_seccion(seccion) if seccion else list(res.teams)
