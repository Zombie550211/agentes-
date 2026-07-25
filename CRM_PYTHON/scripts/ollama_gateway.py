"""
Gateway con token para exponer Ollama local hacia el CRM (que corre en Render).

Ollama NO tiene autenticación propia y solo debe escuchar en localhost:11434 — nunca
exponerlo directo a internet. Este gateway es el ÚNICO punto que se expone (vía un
túnel, ej. `cloudflared tunnel --url http://localhost:11500`): exige un Bearer token y
solo reenvía POST /api/chat a Ollama, nada más de su API queda accesible.

Uso:
    cd CRM_PYTHON && source .venv/bin/activate
    python scripts/ollama_gateway.py
    # Lee AI_GATEWAY_TOKEN (y el resto) del .env de CRM_PYTHON automáticamente — no
    # hace falta exportar nada a mano ni hacer `source .env` (el .env tiene valores
    # con caracteres especiales, como la URL de Mongo, que rompen el parseo del shell).

Variables de entorno (en CRM_PYTHON/.env o exportadas manualmente):
    AI_GATEWAY_TOKEN  (obligatoria) — debe coincidir con la que usa el CRM.
    OLLAMA_URL        (opcional, default http://localhost:11434)
    GATEWAY_PORT      (opcional, default 11500)
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

GATEWAY_TOKEN = os.getenv("AI_GATEWAY_TOKEN", "")
OLLAMA_URL    = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
GATEWAY_PORT  = int(os.getenv("GATEWAY_PORT", "11500"))

if not GATEWAY_TOKEN:
    print("ERROR: falta la variable de entorno AI_GATEWAY_TOKEN. Generá una (ej. "
          "`python -c \"import secrets; print(secrets.token_hex(32))\"`) y exportala "
          "acá y en las env vars del CRM (Render) antes de arrancar este gateway.",
          file=sys.stderr)
    sys.exit(1)

app = FastAPI(title="Ollama Gateway (solo /api/chat, con token)")


def _check_auth(request: Request) -> None:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if token != GATEWAY_TOKEN:
        raise HTTPException(401, "Token inválido")


@app.get("/health")
async def health():
    return {"ok": True, "ollama_url": OLLAMA_URL}


@app.post("/api/chat")
async def proxy_chat(request: Request):
    _check_auth(request)
    body = await request.json()
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/chat", json=body)
    except httpx.RequestError as e:
        return JSONResponse({"error": f"No se pudo contactar a Ollama local: {e}"}, status_code=502)
    return JSONResponse(resp.json(), status_code=resp.status_code)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=GATEWAY_PORT)
