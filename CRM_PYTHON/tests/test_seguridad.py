"""Pruebas de las piezas de seguridad: contraseñas, URLs de imagen y tokens de sesión."""
import time

import jwt
import pytest
from fastapi import HTTPException

import deps
import politica_password as pp
from validators import validar_imagen_url


# ── Política de contraseñas ──────────────────────────────────────

@pytest.mark.parametrize("pwd", ["Sol4rPlaya9x", "mi-clave-2026-segura", "Ñandú12345z"])
def test_password_valida(pwd):
    assert pp.problema(pwd, "daniel") is None


@pytest.mark.parametrize("pwd, motivo", [
    ("abc123", "al menos"),                    # corta
    ("a1" * 70, "demasiado larga"),            # > 128
    ("soloLetrasSinNumero", "letras y números"),
    ("1234567890123", "letras y números"),
    ("Connecting123", "fácil de adivinar"),    # lista de comunes, sin importar mayúsculas
    ("contraseña123", "fácil de adivinar"),
    ("aaaa1111aaaa", "fácil de adivinar"),     # <= 3 caracteres distintos
])
def test_password_rechazada(pwd, motivo):
    assert motivo in (pp.problema(pwd, "") or "")


def test_password_no_puede_contener_usuario():
    assert "nombre de usuario" in pp.problema("xx.juan.perez99", "juan_perez")


def test_exigir_lanza_400():
    with pytest.raises(HTTPException) as e:
        pp.exigir("corta1", "")
    assert e.value.status_code == 400


# ── imagen_url (XSS almacenado) ──────────────────────────────────

@pytest.mark.parametrize("url", [
    "https://res.cloudinary.com/demo/image/upload/foto.png",
    "/uploads/image (3).png",
    "/api/files/123/image",
    "",
])
def test_imagen_url_valida(url):
    assert validar_imagen_url(url) == url


@pytest.mark.parametrize("url", [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://x.com/a.png\" onerror=\"alert(1)",
    "/uploads/a.png'+alert(1)+'",
    "//evil.com/a.png",
    "/uploads/../../etc/passwd",
    "https://x.com/" + "a" * 600,
])
def test_imagen_url_peligrosa_se_rechaza(url):
    with pytest.raises(ValueError):
        validar_imagen_url(url)


# ── Tokens de sesión ─────────────────────────────────────────────

def test_token_ida_y_vuelta():
    tok = deps.make_token({"id": 7, "username": "ana", "role": "Agente", "team": "Team A"})
    p = deps.decode_token(tok)
    assert p["id"] == "7" and p["username"] == "ana" and p["role"] == "Agente"


def test_token_con_otra_firma_se_rechaza():
    falso = jwt.encode({"id": "1", "role": "Administrador", "exp": time.time() + 60},
                       "otra-clave-de-un-atacante-" + "y" * 32, algorithm="HS256")
    assert deps.decode_token(falso) is None


def test_token_vencido_se_rechaza():
    viejo = jwt.encode({"id": "1", "exp": time.time() - 10}, deps.JWT_SECRET, algorithm="HS256")
    assert deps.decode_token(viejo) is None


def test_token_sin_firma_alg_none_se_rechaza():
    sin_firma = jwt.encode({"id": "1", "role": "Administrador"}, None, algorithm="none")
    assert deps.decode_token(sin_firma) is None


def test_permiso_admin_total_da_rol_administrador():
    assert deps.rol_efectivo("Supervisor", ["admin:full"]) == "Administrador"
    assert deps.rol_efectivo("Supervisor", '["admin:full"]') == "Administrador"
    assert deps.rol_efectivo("Supervisor", "no-es-json") == "Supervisor"
    assert deps.rol_efectivo(None) == ""


@pytest.mark.parametrize("team, role, esperado", [
    ("Team Líneas Norte", "", "lineas"),
    ("", "Lineas-Agentes", "lineas"),
    ("Team Roberto", "Agente", "residencial"),
])
def test_team_seccion(team, role, esperado):
    assert deps.team_seccion(team, role) == esperado
