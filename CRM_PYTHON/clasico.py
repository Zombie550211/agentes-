"""Rediseño visible sólo para administración (despliegue gradual).

Mientras el rediseño está a prueba, frontend/_clasico/ guarda la versión anterior (la de
producción) de cada archivo del frontend que el rediseño cambió o borró, en la misma ruta
relativa. A quien NO tiene un rol de administración (deps.ADMIN_ROLES) el servidor le
entrega esa copia en la dirección de siempre; administración recibe el archivo nuevo.

Sólo afecta a los archivos que existen en _clasico (páginas rediseñadas y sus hojas y
scripts propios); todo lo demás se sirve igual para todos. Las APIs no cambian: cada una
sigue comprobando sus permisos. Esto es sólo qué versión de la interfaz se ve.

Para abrir el rediseño a todos: borrar frontend/_clasico/ (o vaciarla). Sin la carpeta,
este módulo no hace nada.
"""
from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse

from deps import ADMIN_ROLES, decode_token

_ADMIN = {r.strip().lower() for r in ADMIN_ROLES}
# Las dos versiones comparten dirección: que ninguna caché (navegador o intermedia) sirva
# la de un rol a otro.
SIN_CACHE = {"Cache-Control": "no-store, private", "Vary": "Cookie", "Pragma": "no-cache"}


class Clasico:
    def __init__(self, frontend_dir: Path):
        self.base = (frontend_dir / "_clasico").resolve()
        self.frontend = frontend_dir.resolve()
        # rutas relativas con '/' (p. ej. "residencial/costumer.html")
        self.rutas = set()
        if self.base.is_dir():
            self.rutas = {p.relative_to(self.base).as_posix() for p in self.base.rglob("*")
                          if p.is_file() and p.name != "LEEME.md"}

    @staticmethod
    def es_admin(request: Request) -> bool:
        token = request.cookies.get("token")
        if not token:
            auth = request.headers.get("Authorization", "")
            token = auth[7:] if auth.startswith("Bearer ") else None
        payload = decode_token(token) if token else None
        return bool(payload) and str(payload.get("role") or "").strip().lower() in _ADMIN

    def archivo(self, request: Request, real: Path | None, rel: str | None = None) -> Path | None:
        """Qué archivo entregar. `real` = el del rediseño (puede no existir si se borró);
        `rel` = ruta relativa al frontend cuando `real` no está. Devuelve la copia clásica
        para quien no es administrador (o si el archivo nuevo ya no existe)."""
        if not self.rutas:
            return None
        if rel is None:
            try:
                rel = real.resolve().relative_to(self.frontend).as_posix()
            except (ValueError, OSError):
                return None
        if rel not in self.rutas:
            return None
        nuevo_existe = real is not None and real.is_file()
        if nuevo_existe and self.es_admin(request):
            return None
        return self.base / rel

    def respuesta(self, request: Request, real: Path | None, rel: str | None = None):
        f = self.archivo(request, real, rel)
        return FileResponse(str(f), headers=SIN_CACHE) if f else None

    def afecta(self, rel: str) -> bool:
        return rel in self.rutas
