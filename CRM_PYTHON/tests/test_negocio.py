"""Pruebas de reglas de negocio: status de comisión, puntajes y permisos por rol."""
import pytest

import estado_comision as ec
import rbac
import scoring


# ── Status de comisión ───────────────────────────────────────────

@pytest.mark.parametrize("valor, grupo", [
    ("ACTIVE", "completed"), ("ACTIVE BY SYSTEM", "completed"), ("active by fastgm", "completed"),
    ("CANCEL", "cancelled"), ("CANCEL BY SYSTEM", "cancelled"), ("CHARGEBACK", "cancelled"),
    ("HOLD", "hold"), ("OFICINA", "oficina"), ("RESERVA", "reserva"), ("REPRO", "repro"),
    ("PENDING", "pending"), ("CXNC", "pending"), ("NEXT PAY", "pending"), ("", "pending"), (None, "pending"),
])
def test_grupo_de_status(valor, grupo):
    assert ec.grupo(valor) == grupo


def test_toda_la_lista_tiene_grupo_conocido():
    validos = {"completed", "cancelled", "hold", "oficina", "reserva", "repro", "pending"}
    assert all(ec.grupo(v) in validos for v in ec.LISTA)


def test_venta_nueva_entra_pending_y_repro_entra_repro():
    assert ec.inicial_para("Pending") == "PENDING"
    assert ec.inicial_para("Repro") == "REPRO"


def test_normalizar_solo_acepta_valores_de_lista():
    assert ec.normalizar(" active ") == "ACTIVE"
    assert ec.normalizar("INVENTADO") == ""


# ── Puntajes ─────────────────────────────────────────────────────

@pytest.mark.parametrize("tipo, servicio, puntaje", [
    ("DOUBLE PLAY", "XFINITY 1G", 1.0),
    ("double play", " xfinity 500 ", 0.85),
    ("XFINITY", "XFINITY 1G", 0.75),
    ("XFINITY", "XFINITY 500", 0.60),
])
def test_reglas_especiales_xfinity(tipo, servicio, puntaje):
    assert scoring.special_score(servicio, tipo) == puntaje


def test_sin_regla_especial_devuelve_none():
    assert scoring.special_score("ATT AIR", "AT&T AIR") is None


@pytest.mark.parametrize("servicio, categoria, esperado", [
    ("ATT AIR", "ATT", ("AT&T AIR", "SARA")),
    ("ATT 18 - 25 MB", "ATT", ("INTERNET", "SARA")),
    ("XFINITY 1G", "XFINITY", ("XFINITY", "N/A")),
    ("STARLINK BUSINESS 1 TB", "STARLINK BUSINESS", ("STARLINK BUSINESS", "CHUZO")),
    ("ALGO NUEVO", "DESCONOCIDA", ("INTERNET", "SARA")),
])
def test_service_meta(servicio, categoria, esperado):
    assert scoring.service_meta(servicio, categoria) == esperado


# ── Permisos por rol (RBAC, valores por defecto del código) ─────

@pytest.fixture(autouse=True)
def _sin_cache_rbac(monkeypatch):
    # Sin BD: se usan los permisos por defecto definidos en rbac.ACCIONES.
    monkeypatch.setattr(rbac, "_cache", None)


def test_admin_puede_gestionar_usuarios_y_roles():
    for accion in rbac.PROTEGIDAS_ADMIN:
        assert rbac.tiene({"role": "Administrador"}, accion)


@pytest.mark.parametrize("rol", ["Agente", "vendedor", "Lineas-Agentes", "Supervisor", "Backoffice"])
def test_roles_no_admin_no_gestionan_usuarios(rol):
    assert not rbac.tiene({"role": rol}, "usuarios.gestionar")
    assert not rbac.tiene({"role": rol}, "roles.gestionar")


def test_agente_solo_puede_crear_tickets():
    assert rbac.acciones_de("Agente") == {"tickets.crear"}


def test_backoffice_no_cambia_status_pero_gestiona_ventas():
    assert rbac.tiene("Backoffice", "ventas.gestion")
    assert not rbac.tiene("Backoffice", "ventas.cambiar_status")


@pytest.mark.parametrize("alias, rol", [
    ("admin", "Administrador"), ("ADMINISTRADOR", "Administrador"),
    ("back_office", "Backoffice"), ("rol icon", "Rol_icon"), ("agent", "Agente"),
])
def test_alias_de_rol(alias, rol):
    assert rbac.acciones_de(alias) == rbac.acciones_de(rol)


def test_rol_desconocido_no_tiene_nada():
    assert rbac.acciones_de("Hacker") == set()
    assert rbac.rol_canonico("Hacker") is None


def test_accion_inexistente_es_error_de_programacion():
    with pytest.raises(ValueError):
        rbac.tiene("Administrador", "accion.que.no.existe")


def test_claves_de_acciones_unicas():
    claves = [a[0] for a in rbac.ACCIONES]
    assert len(claves) == len(set(claves))
