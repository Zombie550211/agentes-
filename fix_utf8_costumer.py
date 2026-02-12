#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys

file_path = r"c:\Users\Zombie\Documents\dashboard\frontend\Costumer.html"

print(f"[1] Leyendo {file_path}...")

# Leer como bytes
with open(file_path, 'rb') as f:
    raw_bytes = f.read()

print(f"[2] Decodificando de UTF-8 -> Latin-1 -> UTF-8...")

# Los bytes UTF-8 fueron malinterpretados como Latin-1
# Entonces: decodificar como Latin-1, encodear como UTF-8
try:
    # Decodificar como Latin-1 (ISO-8859-1)
    decoded_as_latin1 = raw_bytes.decode('iso-8859-1')
    
    # Encodear como UTF-8
    reencoded_utf8 = decoded_as_latin1.encode('utf-8')
    
    # Escribir de vuelta
    with open(file_path, 'wb') as f:
        f.write(reencoded_utf8)
    
    print(f"[3] ✓ Archivo reparado exitosamente")
    print(f"    Bytes: {len(raw_bytes)} -> {len(reencoded_utf8)}")
    
except Exception as e:
    print(f"[ERROR] {e}")
    sys.exit(1)

print("\n[4] Verificando reparación...")

# Verificar que se reparó correctamente
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read(500)
    if 'TELÉFONO' in content or 'NÚMERO' in content or 'Sí' in content:
        print("✓ Los caracteres acentuados ahora son correctos")
    else:
        print("Nota: Verificar manualmente si la reparación fue correcta")
