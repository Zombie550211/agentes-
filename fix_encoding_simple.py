#!/usr/bin/env python3
# -*- coding: utf-8 -*-

file_path = r"c:\Users\Zombie\Documents\dashboard\frontend\Costumer.html"

print("Leyendo archivo...", flush=True)
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Tamaño original: {len(content)} caracteres", flush=True)

# Reemplazos
replacements = {
    'Ã¡': 'á',
    'Ã©': 'é',
    'Ã­': 'í',
    'Ã³': 'ó',
    'Ã¼': 'ü',
    'Ã ': 'à',
    'Ã‰': 'É',
    'Ã±': 'ñ',
    'Ã"': 'Ó',
    'Ã': 'Á',
}

for old, new in replacements.items():
    if old in content:
        print(f"Reemplazando {repr(old)} -> {repr(new)}", flush=True)
        content = content.replace(old, new)

print(f"Tamaño final: {len(content)} caracteres", flush=True)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✓ Archivo reparado", flush=True)
