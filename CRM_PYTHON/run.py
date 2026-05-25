import asyncio, warnings, sys

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
    config = uvicorn.Config("main:app", host="0.0.0.0", port=8001, loop="none")
    server = uvicorn.Server(config)
    asyncio.get_event_loop().run_until_complete(server.serve())
