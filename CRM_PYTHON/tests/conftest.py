"""Configuración común de las pruebas.

Las pruebas cubren lógica pura (sin base de datos ni red): se pueden correr en
cualquier PC y en el CI de GitHub con:

    cd CRM_PYTHON && python -m pytest
"""
import os
import sys
from pathlib import Path

# Los módulos del CRM se importan como en producción (desde CRM_PYTHON/).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# deps.py exige JWT_SECRET al importarse. Valor fijo solo para pruebas.
os.environ.setdefault("JWT_SECRET", "secreto-solo-para-pruebas-" + "x" * 32)
