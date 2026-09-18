import asyncio, warnings, sys, os

# Python 3.14 Windows: ProactorEventLoop no soporta SSL con aiomysql.
# Creamos SelectorEventLoop ANTES de importar uvicorn para que no lo override.
if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    _loop = asyncio.SelectorEventLoop()
    asyncio.set_event_loop(_loop)

import uvicorn

if __name__ == "__main__":
    # Solo el propio equipo por defecto. En 0.0.0.0 el CRM local quedaba abierto a
    # toda la red (Wi-Fi incluida): con la BD de Docker todas las cuentas entran con
    # 'local123', y con el túnel a la RDS lo expuesto serían datos reales.
    # Para probar desde otro dispositivo: CRM_HOST=0.0.0.0 ./iniciar-local.sh
    host = os.getenv("CRM_HOST", "127.0.0.1")
    config = uvicorn.Config("main:app", host=host, port=8001, loop="none")
    server = uvicorn.Server(config)
    asyncio.get_event_loop().run_until_complete(server.serve())
