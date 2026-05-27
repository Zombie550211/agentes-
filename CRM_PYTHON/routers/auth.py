from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import bcrypt as _bcrypt
from jose import jwt, JWTError
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from pathlib import Path
import unicodedata, re, os, json, math, time, secrets, smtplib
import datetime as _dt
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

router = APIRouter(prefix="/api/auth", tags=["Auth"])

JWT_SECRET  = os.getenv("JWT_SECRET", "tu_clave_secreta_super_segura")
JWT_ALGO    = "HS256"
JWT_EXPIRES = 7 * 24 * 3600
IS_PROD     = os.getenv("NODE_ENV") == "production"

def _hash_pwd(plain: str) -> str:
    return _bcrypt.hashpw(plain[:72].encode(), _bcrypt.gensalt(rounds=10)).decode()

def _verify_pwd(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain[:72].encode(), hashed.encode())
    except Exception:
        return False

MAINTENANCE_FILE = Path(__file__).parent.parent.parent / "maintenance.json"

class LoginBody(BaseModel):
    username: str
    password: str

class MaintenanceBody(BaseModel):
    active: bool
    message: str = "El sistema se encuentra en mantenimiento. Por favor, intenta más tarde."

class RegisterBody(BaseModel):
    username: str
    password: str
    role: str
    name: str = ""
    email: str = ""
    team: str = ""
    supervisor: str = ""
    supervisorName: str = ""
    supervisorId: Optional[str] = None
    permissions: List[str] = []

class ForgotPasswordBody(BaseModel):
    username: str

class VerifyCodeBody(BaseModel):
    username: str
    code: str

class ResetPasswordBody(BaseModel):
    username: str
    newPassword: str
    resetToken: Optional[str] = None

# ── Helpers ──────────────────────────────────────────────────────
def _normalize(s: str) -> str:
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()

def _username_variants(raw: str) -> list[str]:
    u = raw.strip()
    un = _normalize(u)
    is_camel = not re.search(r"[\s.]", u) and re.search(r"[a-z][A-Z]", u)
    camel_sp  = re.sub(r"([a-z])([A-Z])", r"\1 \2", u) if is_camel else u
    camel_dot = re.sub(r"([a-z])([A-Z])", r"\1.\2", u) if is_camel else u
    raw_list = [
        u, un,
        re.sub(r"\s+", ".", u),  re.sub(r"\.+", " ", u),
        re.sub(r"\s+", ".", un), re.sub(r"\.+", " ", un),
        camel_sp, camel_dot,
        _normalize(camel_sp), _normalize(camel_dot),
    ]
    return list(dict.fromkeys(v for v in raw_list if v))

def _row_to_user(row) -> dict:
    u = dict(row)
    for col in ("aliases", "permissions"):
        v = u.get(col)
        if isinstance(v, str):
            try: u[col] = json.loads(v)
            except: u[col] = []
        elif v is None:
            u[col] = []
    u["_id"] = str(u["id"])
    u["password"] = u.pop("password_hash", "") or ""
    return u

async def _find_user_by_variants(variants: list[str]) -> dict | None:
    async with AsyncSessionLocal() as s:
        for v in variants:
            v = v.strip()
            if not v:
                continue
            q = text("SELECT * FROM users WHERE TRIM(username) = :v OR TRIM(name) = :v LIMIT 1")
            r = await s.execute(q, {"v": v})
            row = r.mappings().first()
            if row:
                return _row_to_user(row)
    return None

async def _find_user_by_username(username: str) -> dict | None:
    async with AsyncSessionLocal() as s:
        q = text("SELECT * FROM users WHERE username = :u LIMIT 1")
        r = await s.execute(q, {"u": username})
        row = r.mappings().first()
        return _row_to_user(row) if row else None

def _make_token(user: dict) -> str:
    payload = {
        "id":         str(user.get("_id") or user.get("id")),
        "username":   user.get("username", ""),
        "name":       user.get("name", "") or user.get("username", ""),
        "role":       user.get("role", ""),
        "team":       user.get("team", ""),
        "supervisor": user.get("supervisor", ""),
        "iat":        math.floor(time.time()),
        "exp":        math.floor(time.time()) + JWT_EXPIRES,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except JWTError:
        return None

def _get_token(request: Request) -> str | None:
    token = request.cookies.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token

def _load_maintenance() -> dict:
    try:
        if MAINTENANCE_FILE.exists():
            return json.loads(MAINTENANCE_FILE.read_text())
    except Exception:
        pass
    return {"active": False, "message": "", "activeSince": None}

def _save_maintenance(state: dict):
    try:
        MAINTENANCE_FILE.write_text(json.dumps(state, indent=2))
    except Exception:
        pass

def _set_token_cookie(response: Response, token: str):
    response.set_cookie(
        key="token", value=token,
        httponly=True,
        secure=IS_PROD,
        samesite="none" if IS_PROD else "lax",
        max_age=24 * 3600,
        path="/",
    )

async def current_user(request: Request) -> dict:
    token = _get_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado")
    decoded = _decode_token(token)
    if not decoded:
        raise HTTPException(status_code=401, detail="Token inválido")
    return decoded

def require_roles(*roles):
    async def checker(user: dict = Depends(current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Sin permiso")
        return user
    return checker

ADMIN_ROLES = ("Administrador", "admin", "administrador", "Administrativo")

# ── RUTAS ────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginBody, response: Response):
    variants = _username_variants(body.username)
    user = await _find_user_by_variants(variants)
    if not user or not _verify_pwd(body.password, user.get("password", "")):
        raise HTTPException(401, "Credenciales inválidas")

    token = _make_token(user)
    _set_token_cookie(response, token)
    return {
        "success": True,
        "message": "Inicio de sesión exitoso",
        "user": {
            "id":         str(user.get("_id") or user.get("id")),
            "username":   user.get("username"),
            "role":       user.get("role"),
            "team":       user.get("team"),
            "supervisor": user.get("supervisor"),
            "name":       user.get("name"),
        },
        "token": token,
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("token", path="/", samesite="none" if IS_PROD else "lax")
    return {"success": True, "message": "Sesión cerrada exitosamente"}


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    doc = await _find_user_by_username(user["username"])
    if not doc:
        raise HTTPException(404, "Usuario no encontrado")
    doc.pop("password", None)
    doc["id"] = doc.get("_id")
    return {"success": True, "user": doc}


@router.get("/verify-server")
async def verify_server(request: Request):
    token = _get_token(request)
    if not token:
        return {"success": False, "authenticated": False, "role": None, "username": None}

    decoded = _decode_token(token)
    if not decoded:
        return {"success": False, "authenticated": False, "role": None, "username": None}

    maint = _load_maintenance()
    if maint.get("active") and maint.get("activeSince") and decoded.get("iat", 0) < maint["activeSince"]:
        return {"success": False, "authenticated": False, "maintenance": True, "maintenanceMessage": maint["message"]}

    user_data = {
        "id":          decoded.get("id"),
        "username":    decoded.get("username"),
        "role":        decoded.get("role"),
        "team":        decoded.get("team"),
        "supervisor":  decoded.get("supervisor"),
        "permissions": decoded.get("permissions", []),
    }

    doc = await _find_user_by_username(decoded["username"])
    if doc:
        # name: siempre incluir (fallback a username si no hay nombre)
        user_data["name"]       = doc.get("name") or doc.get("username") or decoded.get("username", "")
        if doc.get("team"):       user_data["team"]       = doc["team"]
        if doc.get("role"):       user_data["role"]       = doc["role"]
        if doc.get("supervisor"): user_data["supervisor"] = doc["supervisor"]
        if doc.get("avatar_url"): user_data["avatarUrl"]  = doc["avatar_url"]

    return {"success": True, "authenticated": True, "user": user_data}


@router.get("/verify")
async def verify(request: Request):
    return await verify_server(request)


@router.get("/maintenance")
async def get_maintenance():
    m = _load_maintenance()
    return {"success": True, "active": m.get("active", False),
            "message": m.get("message", ""), "activeSince": m.get("activeSince")}


@router.post("/maintenance")
async def set_maintenance(body: MaintenanceBody, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    if body.active:
        state = {"active": True, "message": body.message, "activeSince": math.floor(time.time())}
    else:
        state = {"active": False, "message": "", "activeSince": None}
    _save_maintenance(state)
    return {"success": True, "maintenance": state}


# ── Email helpers ────────────────────────────────────────────────
SMTP_HOST   = os.getenv("SMTP_HOST", "")
SMTP_PORT   = int(os.getenv("SMTP_PORT", "587"))
SMTP_SECURE = os.getenv("SMTP_SECURE", "").lower() == "true"
EMAIL_USER  = os.getenv("EMAIL_USER", "")
EMAIL_PASS  = os.getenv("EMAIL_PASS", "")
EMAIL_FROM  = os.getenv("EMAIL_FROM", EMAIL_USER)


def _send_email(to: str, subject: str, html: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = EMAIL_FROM
    msg["To"]      = to
    msg.attach(MIMEText(html, "html"))
    try:
        if SMTP_HOST:
            srv = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
            if not SMTP_SECURE:
                srv.starttls()
        else:
            srv = smtplib.SMTP("smtp.gmail.com", 587)
            srv.starttls()
        if EMAIL_USER and EMAIL_PASS:
            srv.login(EMAIL_USER, EMAIL_PASS)
        srv.sendmail(EMAIL_FROM, [to], msg.as_string())
        srv.quit()
    except Exception as e:
        raise RuntimeError(f"Email error: {e}")


# ── Register ─────────────────────────────────────────────────────
TEAM_CODE_MAP = {
    "team_irania": "TEAM IRANIA",
    "team_bryan": "TEAM BRYAN PLEITEZ",
    "team_marisol": "TEAM MARISOL BELTRAN",
    "team_roberto": "TEAM ROBERTO VELASQUEZ",
    "team_johana": "TEAM JOHANA",
    "team_lineas": "TEAM LINEAS",
    "backoffice": "Backoffice",
    "administracion": "Administración",
}

TEAM_SUPERVISOR_MAP = {
    "TEAM IRANIA":            {"supervisor": "irania.serrano",      "supervisorName": "Irania Serrano"},
    "TEAM BRYAN PLEITEZ":     {"supervisor": "bryan.pleitez",       "supervisorName": "Bryan Pleitez"},
    "TEAM MARISOL BELTRAN":   {"supervisor": "marisol.beltran",     "supervisorName": "Marisol Beltrán"},
    "TEAM ROBERTO VELASQUEZ": {"supervisor": "roberto.velasquez",   "supervisorName": "Roberto Velásquez"},
    "TEAM JOHANA":            {"supervisor": "johana.supervisor",   "supervisorName": "Guadalupe Santana"},
    "TEAM LINEAS":            {"supervisor": "jonathan.figueroa",   "supervisorName": "Jonathan Figueroa"},
    "Backoffice":             {"supervisor": None, "supervisorName": None},
    "Administración":         {"supervisor": None, "supervisorName": None},
}

SUPERVISOR_ALIAS_TO_TEAM = {
    "IRANIA": "TEAM IRANIA",
    "ROBERTO": "TEAM ROBERTO VELASQUEZ",
    "MARISOL": "TEAM MARISOL BELTRAN",
    "PLEITEZ": "TEAM BRYAN PLEITEZ",
    "BRYAN": "TEAM BRYAN PLEITEZ",
    "JOHANA": "TEAM JOHANA",
    "JONATHAN": "TEAM LINEAS",
    "JONATHAN F": "TEAM LINEAS",
    "LUIS": "TEAM LINEAS",
    "LUIS G": "TEAM LINEAS",
}


def _norm_team_key(v: str) -> str:
    s = str(v or "").strip().lower()
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s)


def _canon_sup_key(v: str) -> str:
    s = str(v or "").strip()
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    return s.strip().upper()


@router.post("/register")
async def register(body: RegisterBody, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    username = body.username.strip()
    if not username or not body.password or not body.role:
        raise HTTPException(400, "Faltan campos obligatorios (usuario, contraseña, rol)")

    async with AsyncSessionLocal() as s:
        exists = await s.execute(text("SELECT id FROM users WHERE username = :u LIMIT 1"), {"u": username})
        if exists.first():
            raise HTTPException(409, "El usuario ya existe")

        hashed = _hash_pwd(body.password)

        team_key = _norm_team_key(body.team)
        normalized_team = TEAM_CODE_MAP.get(team_key, body.team.strip())

        sup_key = _canon_sup_key(body.supervisor or body.supervisorName)
        team_from_supervisor = SUPERVISOR_ALIAS_TO_TEAM.get(sup_key, "")
        normalized_team_final = team_from_supervisor or normalized_team or ""

        derived_sup = TEAM_SUPERVISOR_MAP.get(normalized_team_final) or {}
        use_derived = bool(team_from_supervisor)

        sup_name_final = (derived_sup.get("supervisorName") or body.supervisorName or body.supervisor or "").strip() if use_derived else (body.supervisorName or derived_sup.get("supervisorName") or body.supervisor or "").strip()
        sup_user_final = (derived_sup.get("supervisor") or body.supervisor or "").strip() if use_derived else (body.supervisor or derived_sup.get("supervisor") or "").strip()

        await s.execute(text("""
            INSERT INTO users (username, password_hash, role, permissions, team, name, email, supervisor)
            VALUES (:username, :password_hash, :role, :permissions, :team, :name, :email, :supervisor)
        """), {
            "username":      username,
            "password_hash": hashed,
            "role":          body.role,
            "permissions":   json.dumps(body.permissions),
            "team":          normalized_team_final,
            "name":          body.name,
            "email":         body.email,
            "supervisor":    sup_user_final or sup_name_final,
        })
        await s.commit()
        result = await s.execute(text("SELECT LAST_INSERT_ID() as lid"))
        new_id = result.scalar()

    return {"success": True, "message": "Usuario creado", "userId": str(new_id)}


# ── Password reset helpers ────────────────────────────────────────
_RESET_EXPIRY_MS   = int(os.getenv("RESET_CODE_EXPIRY_MINUTES", "10")) * 60
_MAX_ATTEMPTS      = 5
_RESET_TOKEN_SECS  = 15 * 60
_hash_code   = _hash_pwd
_verify_code = _verify_pwd


def _gen_code() -> str:
    return str(secrets.randbelow(900000) + 100000)


def _gen_reset_token() -> str:
    return secrets.token_hex(32)


def _mask_email(email: str) -> str:
    parts = email.split("@")
    if len(parts) != 2:
        return "***"
    user, domain = parts
    visible = user[:2] if len(user) > 2 else user[:1]
    return f"{visible}***@{domain}"


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordBody):
    username = body.username.strip()
    if not username or len(username) < 3:
        return {"success": True, "message": "Si el usuario existe, recibirás un código en tu correo."}

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, email FROM users WHERE username = :u LIMIT 1"), {"u": username})
        row = r.mappings().first()

    if not row or not row.get("email"):
        return {"success": True, "message": "Si el usuario existe, recibirás un código en tu correo."}

    code       = _gen_code()
    code_hash  = _hash_code(code)
    expires_at = _dt.datetime.utcnow() + _dt.timedelta(seconds=_RESET_EXPIRY_MS)
    expiry_min = _RESET_EXPIRY_MS // 60

    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            UPDATE users SET
                reset_code_hash = :hash,
                reset_code_expires_at = :exp,
                reset_code_attempts = 0,
                reset_token_hash = NULL,
                reset_token_expires_at = NULL,
                reset_token_used = FALSE
            WHERE username = :u
        """), {"hash": code_hash, "exp": expires_at, "u": username})
        await s.commit()

    html = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f2ed;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0"
      style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(28,25,23,0.10);">
      <tr><td style="background:#c0392b;padding:28px 40px;">
        <span style="color:#ffffff;font-size:14px;font-weight:600;">Connecting CRM</span>
      </td></tr>
      <tr><td style="padding:40px 40px 20px;">
        <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1c1917;">Código de verificación</h1>
        <p style="margin:0 0 28px;font-size:14px;color:#6b6560;">
          Solicitaste restablecer la contraseña de <strong>{username}</strong>.
        </p>
        <div style="text-align:center;margin:0 0 28px;">
          <div style="display:inline-block;background:#faf8f5;border:2px solid #e8e3db;border-radius:8px;padding:20px 40px;">
            <div style="font-size:42px;font-weight:800;letter-spacing:16px;color:#c0392b;">{code}</div>
          </div>
          <p style="margin:12px 0 0;font-size:12px;color:#b8b2aa;">
            Expira en <strong>{expiry_min} minutos</strong>.
          </p>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""

    try:
        _send_email(row["email"], "Código de verificación — Restablecer contraseña", html)
    except Exception:
        pass

    masked = _mask_email(row["email"])
    return {"success": True, "message": "Si el usuario existe, recibirás un código en tu correo.", "maskedEmail": masked}


@router.post("/verify-reset-code")
async def verify_reset_code(body: VerifyCodeBody):
    username = body.username.strip()
    code     = body.code.strip()
    if not username or not code or not re.match(r"^\d{6}$", code):
        raise HTTPException(400, "Datos inválidos.")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, reset_code_hash, reset_code_expires_at, reset_code_attempts
            FROM users WHERE username = :u LIMIT 1
        """), {"u": username})
        row = r.mappings().first()

    if not row or not row.get("reset_code_hash"):
        raise HTTPException(400, "No hay solicitud de recuperación activa. Vuelve al paso 1.")

    now = _dt.datetime.utcnow()
    exp = row["reset_code_expires_at"]
    if exp and now > exp:
        async with AsyncSessionLocal() as s:
            await s.execute(text("UPDATE users SET reset_code_hash=NULL, reset_code_expires_at=NULL, reset_code_attempts=0 WHERE username=:u"), {"u": username})
            await s.commit()
        raise HTTPException(400, "El código ha expirado. Solicita uno nuevo.")

    attempts = row.get("reset_code_attempts") or 0
    if attempts >= _MAX_ATTEMPTS:
        async with AsyncSessionLocal() as s:
            await s.execute(text("UPDATE users SET reset_code_hash=NULL, reset_code_expires_at=NULL, reset_code_attempts=0 WHERE username=:u"), {"u": username})
            await s.commit()
        raise HTTPException(400, "Superaste el máximo de intentos. Solicita un nuevo código.")

    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET reset_code_attempts = reset_code_attempts + 1 WHERE username = :u"), {"u": username})
        await s.commit()

    if not _verify_code(code, row["reset_code_hash"]):
        remaining = _MAX_ATTEMPTS - (attempts + 1)
        msg = (f"Código incorrecto. Te quedan {remaining} intento{'s' if remaining != 1 else ''}."
               if remaining > 0 else "Código incorrecto. Sin intentos restantes. Solicita un nuevo código.")
        raise HTTPException(400, msg)

    reset_token      = _gen_reset_token()
    reset_token_hash = _hash_code(reset_token)
    token_expiry     = now + _dt.timedelta(seconds=_RESET_TOKEN_SECS)

    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            UPDATE users SET
                reset_code_hash = NULL,
                reset_code_expires_at = NULL,
                reset_code_attempts = 0,
                reset_token_hash = :th,
                reset_token_expires_at = :te,
                reset_token_used = FALSE
            WHERE username = :u
        """), {"th": reset_token_hash, "te": token_expiry, "u": username})
        await s.commit()

    return {"success": True, "resetToken": reset_token}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordBody, request: Request):
    username     = body.username.strip()
    new_password = body.newPassword

    if not username or not new_password:
        raise HTTPException(400, "Campos requeridos: username, newPassword")
    if len(new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres.")

    if body.resetToken:
        reset_token = body.resetToken
        if len(reset_token) != 64:
            raise HTTPException(400, "Token de recuperación inválido.")
        if not re.search(r"[A-Z]", new_password) or not re.search(r"[0-9]", new_password):
            raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.")
        if len(new_password) > 128:
            raise HTTPException(400, "La contraseña es demasiado larga.")

        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT id, reset_token_hash, reset_token_expires_at, reset_token_used
                FROM users WHERE username = :u LIMIT 1
            """), {"u": username})
            row = r.mappings().first()

        if not row or not row.get("reset_token_hash"):
            raise HTTPException(400, "Token de recuperación no válido o ya utilizado.")

        now = _dt.datetime.utcnow()
        if row.get("reset_token_expires_at") and now > row["reset_token_expires_at"]:
            async with AsyncSessionLocal() as s:
                await s.execute(text("UPDATE users SET reset_token_hash=NULL, reset_token_expires_at=NULL, reset_token_used=TRUE WHERE username=:u"), {"u": username})
                await s.commit()
            raise HTTPException(400, "El token de recuperación ha expirado. Inicia el proceso nuevamente.")

        if row.get("reset_token_used"):
            raise HTTPException(400, "Este token ya fue utilizado.")

        if not _verify_code(reset_token, row["reset_token_hash"]):
            raise HTTPException(400, "Token de recuperación inválido.")

        hashed = _hash_pwd(new_password)
        async with AsyncSessionLocal() as s:
            await s.execute(text("""
                UPDATE users SET
                    password_hash = :h,
                    reset_token_hash = NULL,
                    reset_token_expires_at = NULL,
                    reset_token_used = TRUE
                WHERE username = :u
            """), {"h": hashed, "u": username})
            await s.commit()
        return {"success": True, "message": "Contraseña actualizada exitosamente."}

    # Admin reset flow
    token = _get_token(request)
    if not token:
        raise HTTPException(401, "Acceso denegado. Token no proporcionado.")
    decoded = _decode_token(token)
    if not decoded or decoded.get("role") not in ("admin", "Administrador", "administrador"):
        raise HTTPException(403, "Sin permiso")

    variants = list(dict.fromkeys([
        username,
        re.sub(r"\s+", ".", username),
        re.sub(r"[.]+", " ", username),
        re.sub(r"[.\s]+", " ", username),
        re.sub(r"[.\s]+", ".", username),
    ]))

    user_doc = await _find_user_by_variants(variants)
    if not user_doc:
        raise HTTPException(404, "Usuario no encontrado")

    hashed = _hash_pwd(new_password)
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET password_hash = :h WHERE id = :id"), {"h": hashed, "id": user_doc["id"]})
        await s.commit()
    return {"success": True, "message": "Contraseña restablecida"}
