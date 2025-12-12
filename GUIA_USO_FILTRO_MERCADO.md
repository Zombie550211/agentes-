# 🎯 Guía de Uso: Filtro de MERCADO en Costumer.html

## ✨ Lo Nuevo

Se agregó un **nuevo filtro desplegable** para filtrar clientes por **MERCADO** (ICON o BAMO) en la tabla de Costumer.html.

---

## 📍 Dónde Está

**Ubicación en la interfaz:** Barra de filtros superior, después del filtro "Agente"

```
[Buscar]  [Mes ▼]  [Team ▼]  [Agente ▼]  [Mercado ▼]  [Limpiar] [Recargar]
                                           ← NUEVO
```

---

## 🎮 Cómo Usarlo

### Opción 1: Filtrar por ICON

1. Haz clic en el dropdown **"Mercado"**
2. Selecciona **"ICON"**
3. ✅ La tabla se actualiza automáticamente mostrando solo clientes del mercado ICON

**Resultado esperado:**
- Tabla muestra: ~125 clientes (ejemplo)
- Consola muestra: `[MERCADO FILTER] Filtro de mercado aplicado: ICON -> Resultados: 125`

---

### Opción 2: Filtrar por BAMO

1. Haz clic en el dropdown **"Mercado"**
2. Selecciona **"BAMO"**
3. ✅ La tabla se actualiza mostrando solo clientes del mercado BAMO

**Resultado esperado:**
- Tabla muestra: ~87 clientes (ejemplo)
- Consola muestra: `[MERCADO FILTER] Filtro de mercado aplicado: BAMO -> Resultados: 87`

---

### Opción 3: Ver Todos (Limpiar Filtro)

1. Haz clic en el dropdown **"Mercado"**
2. Selecciona **"Todos los mercados"** (opción vacía)
3. ✅ La tabla vuelve a mostrar todos los clientes

**Alternativa:** Clickea el botón **"Limpiar"** rojo para resetear TODOS los filtros

---

## 🔀 Combinación con Otros Filtros

El filtro de Mercado funciona **perfectamente combinado** con los otros filtros:

### Ejemplo 1: ICON de Octubre
- Mes: Octubre 2025
- Mercado: ICON
- → Muestra solo clientes ICON de octubre

### Ejemplo 2: BAMO del Agente Juan
- Agente: Juan Pérez
- Mercado: BAMO
- → Muestra solo clientes BAMO asignados a Juan

### Ejemplo 3: Búsqueda avanzada completa
- Mes: Diciembre 2025
- Agente: María López
- Mercado: ICON
- Status: Completed
- → Muestra solo clientes completados de Maria, en ICON, en diciembre

---

## 💡 Consejos

### ✅ Cosas que Puedes Hacer:
- Filtrar por ICON y BAMO individualmente
- Combinar con mes, agente, team, status
- Ver logs en la consola del navegador (F12)
- Limpiar todos los filtros con un click

### ⚠️ Cosas a Tener en Cuenta:
- El filtro es **case-insensitive** (ICON = icon = Icon)
- El campo mercado viene de la base de datos
- Si un cliente no tiene mercado asignado, no aparecerá en filtros específicos
- El cambio se aplica **instantáneamente** sin necesidad de recargar

---

## 🔍 Ver Logs en Consola

Para verificar que el filtro está funcionando:

1. Abre DevTools: **F12** (Windows/Linux) o **Cmd+Option+I** (Mac)
2. Ve a la pestaña **"Console"**
3. Cambia el filtro de Mercado
4. Deberías ver:
   ```
   [MERCADO FILTER] Cambiando a mercado: ICON
   [Costumer Filter] Filtro de mercado aplicado: ICON -> Resultados: 125
   ```

---

## 📊 Opciones Disponibles

| Opción | Valor | Descripción |
|--------|-------|-------------|
| Todos los mercados | (vacío) | Muestra todos sin filtro |
| ICON | ICON | Filtra solo ICON |
| BAMO | BAMO | Filtra solo BAMO |

---

## 🆘 Solución de Problemas

### P: El dropdown no aparece
**R:** Recarga la página (Ctrl+F5 en Windows, Cmd+Shift+R en Mac)

### P: El filtro no funciona
**R:** Verifica en la consola (F12) si hay errores. Asegúrate de que los clientes tengan el campo "mercado" en la BD.

### P: No veo los resultados esperados
**R:** Verifica que los clientes en la BD tengan mercado="ICON" o mercado="BAMO" (sin espacios extras, mayúsculas o minúsculas)

### P: Quiero limpiar solo este filtro, no los otros
**R:** Selecciona "Todos los mercados" en el dropdown. Si quieres limpiar TODO, usa el botón "Limpiar" rojo.

---

## 📈 Performance

✅ **Rendimiento:** El filtrado ocurre en el cliente (navegador) = **instantáneo**
- No requiere viajes al servidor
- Funciona offline si los datos ya están cargados

---

## 🚀 Mejoras Futuras (Roadmap)

- [ ] Multi-select (seleccionar ICON y BAMO simultáneamente)
- [ ] Opciones dinámicas directamente de la base de datos
- [ ] Guardar preferencia de mercado en navegador
- [ ] Exportar solo clientes de un mercado específico

---

## 📞 Soporte

Si encuentras algún problema:

1. Verifica la consola (F12) para mensajes de error
2. Recarga la página completamente (Ctrl+F5)
3. Limpia el caché del navegador
4. Revisa que los datos en la BD tengan el campo "mercado" correcto

