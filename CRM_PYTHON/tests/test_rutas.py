"""Prueba de humo de la API: la app arranca y NINGUNA ruta entrega datos sin sesión.

Recorre todas las rutas /api/* sin cookie (no hace falta base de datos: la
autenticación corta antes). Si alguien agrega un endpoint y olvida protegerlo,
esta prueba falla. Para una ruta que de verdad deba ser pública, agréguela a
PUBLICAS con el motivo.
"""
import re

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

import main

# Rutas que responden sin sesión a propósito.
PUBLICAS = {
    "POST /api/auth/logout",          # cerrar sesión no necesita sesión válida
    "GET /api/auth/verify-server",    # dice si hay sesión (sin datos si no la hay)
    "GET /api/auth/verify",
    "GET /api/auth/maintenance",      # el login muestra si el CRM está en mantenimiento
    "POST /api/portal/logout",
}


def _rutas():
    for r in main.app.routes:
        if isinstance(r, APIRoute) and r.path.startswith("/api"):
            for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
                yield m, r.path


@pytest.fixture(scope="module")
def cliente():
    # Sin `with`: no corre el arranque (lifespan), que necesita la base de datos.
    return TestClient(main.app, raise_server_exceptions=False)


def test_la_app_registra_las_rutas():
    assert sum(1 for _ in _rutas()) > 250


@pytest.mark.parametrize("metodo, ruta", list(_rutas()), ids=lambda x: str(x))
def test_ninguna_ruta_entrega_datos_sin_sesion(cliente, metodo, ruta):
    url = re.sub(r"\{[^}]+\}", "1", ruta)
    estado = cliente.request(metodo, url, json={}).status_code
    if f"{metodo} {ruta}" in PUBLICAS:
        return
    # 401/403: rechazada por falta de sesión o permiso. 422: datos inválidos
    # (login, formularios e integraciones con clave propia, que validan después).
    assert estado in (401, 403, 422), f"{metodo} {ruta} respondió {estado} sin sesión"
