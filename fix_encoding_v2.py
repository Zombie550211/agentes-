#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix UTF-8 encoding issues in Costumer.html
Replaces incorrectly encoded characters with their correct UTF-8 equivalents
"""

import re

# Read the file with UTF-8 encoding, but interpret as if it was saved with latin-1 or similar
file_path = r'c:\Users\Zombie\Documents\dashboard\frontend\Costumer.html'

# First, read with UTF-8 to see what we have
with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Define replacements for common UTF-8 encoding issues
# These are the corrupted forms and their correct replacements
replacements = {
    'Ã¡': 'á',      # á
    'Ã©': 'é',      # é
    'Ã­': 'í',      # í
    'Ã³': 'ó',      # ó
    'Ãº': 'ú',      # ú
    'Ã±': 'ñ',      # ñ
    'Ã': 'Á',       # Á
    'Ã‰': 'É',      # É
    'ÃŒ': 'Í',      # Í
    'ÃŒ': 'Ó',      # Ó
    'Ã›': 'Ú',      # Ú
    'Ã'': 'Ñ',      # Ñ
    'â€™': "'",     # apostrophe
    'â€œ': '"',     # left quote
    'â€\x9d': '"',  # right quote
    'â€"': '–',     # en dash
    'â€"': '—',     # em dash
    'Â¿': '¿',      # ¿
    'Â¡': '¡',      # ¡
    'Â': '',        # Remove stray Â
}

original_len = len(content)

# Apply replacements
for wrong, correct in replacements.items():
    content = content.replace(wrong, correct)

# Remove any remaining double-encoded sequences
# Sometimes é can be encoded as Ã© in UTF-8 when read as latin-1
content = re.sub(r'([a-zA-Z])Ã¡', r'\1á', content)
content = re.sub(r'([a-zA-Z])Ã©', r'\1é', content)
content = re.sub(r'([a-zA-Z])Ã­', r'\1í', content)
content = re.sub(r'([a-zA-Z])Ã³', r'\1ó', content)
content = re.sub(r'([a-zA-Z])Ãº', r'\1ú', content)
content = re.sub(r'([a-zA-Z])Ã±', r'\1ñ', content)

# Write back with UTF-8 encoding
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

new_len = len(content)
print(f"✅ Archivo corregido exitosamente")
print(f"   Tamaño original: {original_len} bytes")
print(f"   Tamaño nuevo: {new_len} bytes")
print(f"   Diferencia: {original_len - new_len} bytes eliminados")
