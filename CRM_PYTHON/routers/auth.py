from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import bcrypt as _bcrypt
from jose import jwt, JWTError
from bson import ObjectId
from database import get_db
from pathlib import Path
import unicodedata, re, os, json, math, time, secrets, smtplib
import datetime as _dt
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

router = APIRouter(prefix="/api/auth", tags=["Auth"])

# ── Configuración ────────────────────────────────────────────────
JWT_SECRET  = os.getenv("JWT_SECRET", "tu_clave_secreta_super_segura")
JWT_ALGO    = "HS256"
JWT_EXPIRES = 7 * 24 * 3600          # 7 días en segundos
IS_PROD     = os.getenv("NODE_ENV") == "production"

def _hash_pwd(plain: str) -> str:
    return _bcrypt.hashpw(plain[:72].encode(), _bcrypt.gensalt(rounds=10)).decode()

def _verify_pwd(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain[:72].encode(), hashed.encode())
    except Exception:
        return False

MAINTENANCE_FILE = Path(__file__).parent.parent.parent / "maintenance.json"

# ── Modelos ──────────────────────────────────────────────────────
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

def _build_query(variants: list[str]) -> dict:
    ors = []
    for v in variants:
        pattern = re.compile(rf"^\s*{re.escape(v)}\s*$", re.IGNORECASE)
        ors += [{"username": pattern}, {"name": pattern}]
    return {"$or": ors}

def _make_token(user: dict) -> str:
    payload = {
        "id":         str(user["_id"]),
        "username":   user.get("username", ""),
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

# ── Dependencia: usuario autenticado ────────────────────────────
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
    db = get_db()
    if db is None:
        raise HTTPException(500, "DB no disponible")

    variants = _username_variants(body.username)
    query    = _build_query(variants)
    user     = await db["users"].find_one(query)

    if not user or not _verify_pwd(body.password, user.get("password", "")):
        raise HTTPException(401, "Credenciales inválidas")

    token = _make_token(user)
    _set_token_cookie(response, token)

    return {
        "success": True,
        "message": "Inicio de sesión exitoso",
        "user": {
            "id":         str(user["_id"]),
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
    db = get_db()
    doc = await db["users"].find_one(
        {"username": user["username"]},
        {"password": 0}
    )
    if not doc:
        raise HTTPException(404, "Usuario no encontrado")
    doc["id"] = str(doc.pop("_id"))
    return {"success": True, "user": doc}


@router.get("/verify-server")
async def verify_server(request: Request):
    token = _get_token(request)
    if not token:
        return {"success": False, "authenticated": False, "role": None, "username": None}

    decoded = _decode_token(token)
    if not decoded:
        return {"success": False, "authenticated": False, "role": None, "username": None}

    # Verificar mantenimiento
    maint = _load_maintenance()
    if maint.get("active") and maint.get("activeSince") and decoded.get("iat", 0) < maint["activeSince"]:
        return {"success": False, "authenticated": False, "maintenance": True, "maintenanceMessage": maint["message"]}

    # Enriquecer con datos de BD
    db = get_db()
    user_data = {
        "id":         decoded.get("id"),
        "username":   decoded.get("username"),
        "role":       decoded.get("role"),
        "team":       decoded.get("team"),
        "supervisor": decoded.get("supervisor"),
        "permissions": decoded.get("permissions", []),
    }
    if db is not None:
        doc = await db["users"].find_one(
            {"username": decoded["username"]},
            {"avatarUrl": 1, "name": 1, "nombre": 1, "fullName": 1,
             "team": 1, "role": 1, "supervisor": 1, "supervisorName": 1}
        )
        if doc:
            name = doc.get("name") or doc.get("nombre") or doc.get("fullName")
            if name:           user_data["name"]           = name
            if doc.get("team"):           user_data["team"]           = doc["team"]
            if doc.get("role"):           user_data["role"]           = doc["role"]
            if doc.get("avatarUrl"):      user_data["avatarUrl"]      = doc["avatarUrl"]
            if doc.get("supervisorName"): user_data["supervisorName"] = doc["supervisorName"]

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
    db = get_db()
    username = body.username.strip()
    if not username or not body.password or not body.role:
        raise HTTPException(400, "Faltan campos obligatorios (usuario, contraseña, rol)")

    exists = await db["users"].find_one({"username": username})
    if exists:
        raise HTTPException(409, "El usuario ya existe")

    hashed = _hash_pwd(body.password)
    now = __import__("datetime").datetime.utcnow()

    team_key = _norm_team_key(body.team)
    normalized_team = TEAM_CODE_MAP.get(team_key, body.team.strip())

    sup_key = _canon_sup_key(body.supervisor or body.supervisorName)
    team_from_supervisor = SUPERVISOR_ALIAS_TO_TEAM.get(sup_key, "")
    normalized_team_final = team_from_supervisor or normalized_team or ""

    derived_sup = TEAM_SUPERVISOR_MAP.get(normalized_team_final) or {}
    use_derived = bool(team_from_supervisor)

    sup_name_final = (derived_sup.get("supervisorName") or body.supervisorName or body.supervisor or "").strip() if use_derived else (body.supervisorName or derived_sup.get("supervisorName") or body.supervisor or "").strip()
    sup_user_final = (derived_sup.get("supervisor") or body.supervisor or "").strip() if use_derived else (body.supervisor or derived_sup.get("supervisor") or "").strip()

    sup_id_final = body.supervisorId
    if not sup_id_final and (sup_name_final or sup_user_final):
        ors = []
        if sup_user_final:
            ors.append({"username": re.compile(rf"^\s*{re.escape(sup_user_final)}\s*$", re.IGNORECASE)})
        if sup_name_final:
            rx = re.compile(rf"^\s*{re.escape(sup_name_final)}\s*$", re.IGNORECASE)
            ors += [{"name": rx}, {"nombre": rx}, {"fullName": rx}]
        if ors:
            sup_doc = await db["users"].find_one({"$or": ors}, {"_id": 1})
            if sup_doc:
                sup_id_final = str(sup_doc["_id"])

    user_doc = {
        "username": username,
        "password": hashed,
        "role": body.role,
        "permissions": body.permissions,
        "team": normalized_team_final,
        "name": body.name,
        "email": body.email,
        "supervisor": sup_user_final or sup_name_final,
        "supervisorName": sup_name_final,
        "supervisorId": sup_id_final,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await db["users"].insert_one(user_doc)
    return {"success": True, "message": "Usuario creado", "userId": str(result.inserted_id)}


# ── Password reset helpers ────────────────────────────────────────
_RESET_EXPIRY_MS   = int(os.getenv("RESET_CODE_EXPIRY_MINUTES", "10")) * 60
_MAX_ATTEMPTS      = 5
_RESET_TOKEN_SECS  = 15 * 60
_hash_code   = _hash_pwd
_verify_code = _verify_pwd


def _gen_code() -> str:
    n = secrets.randbelow(900000) + 100000
    return str(n)


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
    db = get_db()
    username = body.username.strip()
    if not username or len(username) < 3:
        return {"success": True, "message": "Si el usuario existe, recibirás un código en tu correo."}

    user_doc = await db["users"].find_one(
        {"username": username},
        {"_id": 1, "username": 1, "email": 1}
    )
    if not user_doc or not user_doc.get("email"):
        return {"success": True, "message": "Si el usuario existe, recibirás un código en tu correo."}

    code       = _gen_code()
    code_hash  = _hash_code(code)
    expires_at = _dt.datetime.utcnow() + _dt.timedelta(seconds=_RESET_EXPIRY_MS)
    expiry_min = _RESET_EXPIRY_MS // 60

    await db["users"].update_one(
        {"_id": user_doc["_id"]},
        {"$set": {
            "reset_code_hash": code_hash,
            "reset_code_expires_at": expires_at,
            "reset_code_attempts": 0,
            "reset_token_hash": None,
            "reset_token_expires_at": None,
            "reset_token_used": False,
        }}
    )

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
        _send_email(user_doc["email"], "Código de verificación — Restablecer contraseña", html)
    except Exception:
        pass  # Never reveal whether send succeeded

    masked = _mask_email(user_doc["email"])
    return {"success": True, "message": "Si el usuario existe, recibirás un código en tu correo.", "maskedEmail": masked}


@router.post("/verify-reset-code")
async def verify_reset_code(body: VerifyCodeBody):
    db = get_db()
    username = body.username.strip()
    code     = body.code.strip()
    if not username or not code or not re.match(r"^\d{6}$", code):
        raise HTTPException(400, "Datos inválidos.")

    user_doc = await db["users"].find_one(
        {"username": username},
        {"_id": 1, "reset_code_hash": 1, "reset_code_expires_at": 1, "reset_code_attempts": 1}
    )
    if not user_doc or not user_doc.get("reset_code_hash"):
        raise HTTPException(400, "No hay solicitud de recuperación activa. Vuelve al paso 1.")

    now = _dt.datetime.utcnow()
    if user_doc.get("reset_code_expires_at") and now > user_doc["reset_code_expires_at"]:
        await db["users"].update_one(
            {"_id": user_doc["_id"]},
            {"$set": {"reset_code_hash": None, "reset_code_expires_at": None, "reset_code_attempts": 0}}
        )
        raise HTTPException(400, "El código ha expirado. Solicita uno nuevo.")

    attempts = user_doc.get("reset_code_attempts", 0)
    if attempts >= _MAX_ATTEMPTS:
        await db["users"].update_one(
            {"_id": user_doc["_id"]},
            {"$set": {"reset_code_hash": None, "reset_code_expires_at": None, "reset_code_attempts": 0}}
        )
        raise HTTPException(400, "Superaste el máximo de intentos. Solicita un nuevo código.")

    await db["users"].update_one(
        {"_id": user_doc["_id"]},
        {"$inc": {"reset_code_attempts": 1}}
    )

    valid = _verify_code(code, user_doc["reset_code_hash"])
    if not valid:
        remaining = _MAX_ATTEMPTS - (attempts + 1)
        msg = (f"Código incorrecto. Te quedan {remaining} intento{'s' if remaining != 1 else ''}."
               if remaining > 0 else "Código incorrecto. Sin intentos restantes. Solicita un nuevo código.")
        raise HTTPException(400, msg)

    reset_token      = _gen_reset_token()
    reset_token_hash = _hash_code(reset_token)
    token_expiry     = now + _dt.timedelta(seconds=_RESET_TOKEN_SECS)

    await db["users"].update_one(
        {"_id": user_doc["_id"]},
        {"$set": {
            "reset_code_hash": None,
            "reset_code_expires_at": None,
            "reset_code_attempts": 0,
            "reset_token_hash": reset_token_hash,
            "reset_token_expires_at": token_expiry,
            "reset_token_used": False,
        }}
    )

    return {"success": True, "resetToken": reset_token}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordBody, request: Request):
    db = get_db()
    username     = body.username.strip()
    new_password = body.newPassword

    if not username or not new_password:
        raise HTTPException(400, "Campos requeridos: username, newPassword")
    if len(new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres.")

    # Forgot-password flow: uses resetToken (no auth required)
    if body.resetToken:
        reset_token = body.resetToken
        if len(reset_token) != 64:
            raise HTTPException(400, "Token de recuperación inválido.")
        if len(new_password) < 8 or not re.search(r"[A-Z]", new_password) or not re.search(r"[0-9]", new_password):
            raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.")
        if len(new_password) > 128:
            raise HTTPException(400, "La contraseña es demasiado larga.")

        user_doc = await db["users"].find_one(
            {"username": username},
            {"_id": 1, "reset_token_hash": 1, "reset_token_expires_at": 1, "reset_token_used": 1}
        )
        if not user_doc or not user_doc.get("reset_token_hash"):
            raise HTTPException(400, "Token de recuperación no válido o ya utilizado.")

        now = _dt.datetime.utcnow()
        if user_doc.get("reset_token_expires_at") and now > user_doc["reset_token_expires_at"]:
            await db["users"].update_one(
                {"_id": user_doc["_id"]},
                {"$set": {"reset_token_hash": None, "reset_token_expires_at": None, "reset_token_used": True}}
            )
            raise HTTPException(400, "El token de recuperación ha expirado. Inicia el proceso nuevamente.")

        if user_doc.get("reset_token_used"):
            raise HTTPException(400, "Este token ya fue utilizado.")

        token_valid = _verify_code(reset_token, user_doc["reset_token_hash"])
        if not token_valid:
            raise HTTPException(400, "Token de recuperación inválido.")

        hashed = _hash_pwd(new_password)
        await db["users"].update_one(
            {"_id": user_doc["_id"]},
            {"$set": {
                "password": hashed,
                "reset_token_hash": None,
                "reset_token_expires_at": None,
                "reset_token_used": True,
            }}
        )
        return {"success": True, "message": "Contraseña actualizada exitosamente."}

    # Admin reset flow: requires admin auth, no resetToken
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
    ors = []
    for v in variants:
        rx = re.compile(rf"^\s*{re.escape(v)}\s*$", re.IGNORECASE)
        ors += [{"username": rx}, {"name": rx}]

    user_doc = await db["users"].find_one({"$or": ors})
    if not user_doc:
        raise HTTPException(404, "Usuario no encontrado")

    hashed = _hash_pwd(new_password)
    await db["users"].update_one(
        {"_id": user_doc["_id"]},
        {"$set": {"password": hashed, "updatedAt": _dt.datetime.utcnow()}},
    )
    return {"success": True, "message": "Contraseña restablecida"}
