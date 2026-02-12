#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re

# Mapeo de caracteres mal codificados a correctos
replacements = {
    'Ã¡': 'á',
    'Ã©': 'é',
    'Ã­': 'í',
    'Ã³': 'ó',
    'Ã»': 'ú',
    'Ã±': 'ñ',
    'Ã ': 'à',
    'Ã¢': 'â',
    'Ã§': 'ç',
    'Ã©': 'é',
    'Ã¸': 'ø',
    'Ã±': 'ñ',
    'Ã³': 'ó',
    'Ã¡': 'á',
    'Å½': 'Ž',
    'Å ': 'š',
    'TELÃ‰FONO': 'TELÉFONO',
    'NÃšMERO': 'NÚMERO',
    'TELÃ‰FONOS': 'TELÉFONOS',
    'DIRECCIÃ"N': 'DIRECCIÓN',
    'DÃA': 'DÍA',
    'INSTALACIÃ"N': 'INSTALACIÓN',
    'LÃNEAS': 'LÍNEAS',
    'estÃ¡': 'está',
    'todavÃ­a': 'todavía',
    'FunciÃ³n': 'Función',
    'crÃ­tico': 'crítico',
    'EdiciÃ³n': 'Edición',
    'proporcionÃ³': 'proporcionó',
    'encontrÃ³': 'encontró',
    'vÃ¡lido': 'válido',
    'ediciÃ³n': 'edición',
    'Intentar abrir modal de ediciÃ³n': 'Intentar abrir modal de edición',
    'funciÃ³n': 'función',
    'disponible': 'disponible',
    'pequeÃ±o': 'pequeño',
    'parpadeos': 'parpadeos',
    'âœ…': '✅',
    'âŒ': '❌',
    'ðŸ—'': '🗑️',
    'ðŸ"': '📝',
    'Â¿': '¿',
    'Â?': '?',
    'â€¢': '•',
}

# Leer archivo
with open('frontend/Costumer.html', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Reemplazar
for bad, good in replacements.items():
    content = content.replace(bad, good)

# Escribir archivo
with open('frontend/Costumer.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Caracteres corregidos correctamente")
