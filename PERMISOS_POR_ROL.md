# 🔐 PERMISOS POR ROL - SISTEMA CRM

## 📋 Resumen de Roles

El sistema tiene 5 roles principales:
1. **Agente** (agent/agente)
2. **Supervisor**
3. **Admin** (administrador)
4. **Backoffice**
5. **Team Líneas** (teamlineas)

---

## 👤 ROL: AGENTE (agent/agente)

### Permisos de Visualización
- ✅ **Ver solo sus propias ventas**
- ✅ Ver su propio ranking
- ✅ Ver estadísticas personales
- ✅ Ver tabla de puntajes
- ❌ NO puede ver ventas de otros agentes
- ❌ NO puede ver estadísticas globales

### Permisos de Acción
- ✅ Crear nuevas ventas (leads/customers)
- ✅ Editar sus propias ventas
- ✅ Cambiar status de sus ventas (PENDING/REPRO)
- ✅ Agregar comentarios a sus ventas
- ❌ NO puede eliminar ventas
- ❌ NO puede editar ventas de otros

### Filtros Aplicados Automáticamente
```javascript
// En /api/leads
filter = {
  $or: [
    { agenteNombre: user.username },
    { agente: user.username },
    { usuario: user.username }
  ]
}
```

### Páginas Accesibles
- ✅ Inicio (inicio.html)
- ✅ Lead (lead.html) - Crear ventas
- ✅ Costumer (Costumer.html) - Ver sus ventas
- ✅ Ranking (Ranking y Promociones.html) - Ver su posición
- ✅ Estadísticas (Estadisticas.html) - Ver sus métricas
- ✅ Tabla de Puntaje (Tabla de puntaje.html)

---

## 👔 ROL: SUPERVISOR

### Permisos de Visualización
- ✅ **Ver ventas de su equipo completo**
- ✅ Ver ranking de su equipo
- ✅ Ver estadísticas de su equipo
- ✅ Ver comparativas entre agentes de su equipo
- ❌ NO puede ver ventas de otros equipos
- ❌ NO puede ver datos globales de todos los equipos

### Permisos de Acción
- ✅ Crear ventas
- ✅ Editar ventas de su equipo
- ✅ Cambiar status de ventas de su equipo
- ✅ Agregar comentarios
- ✅ Reasignar ventas dentro de su equipo
- ❌ NO puede eliminar ventas
- ❌ NO puede modificar ventas de otros equipos

### Filtros Aplicados Automáticamente
```javascript
// En /api/leads
filter = {
  $or: [
    { supervisor: user.username },
    { team: user.team }
  ]
}
```

### Páginas Accesibles
- ✅ Inicio
- ✅ Lead - Crear ventas
- ✅ Costumer - Ver ventas del equipo
- ✅ Ranking - Ver ranking del equipo
- ✅ Estadísticas - Ver métricas del equipo
- ✅ Equipos (equipos.html) - Ver comparativas
- ✅ Tabla de Puntaje

---

## 👑 ROL: ADMIN (administrador)

### Permisos de Visualización
- ✅ **Ver TODAS las ventas del sistema**
- ✅ Ver todos los equipos
- ✅ Ver todos los agentes
- ✅ Ver estadísticas globales
- ✅ Ver reportes completos
- ✅ Ver auditorías

### Permisos de Acción
- ✅ Crear ventas
- ✅ Editar CUALQUIER venta
- ✅ Eliminar ventas
- ✅ Cambiar status de cualquier venta
- ✅ Reasignar ventas entre equipos
- ✅ Crear/editar/eliminar usuarios
- ✅ Modificar configuraciones del sistema
- ✅ Acceder a herramientas de debugging

### Filtros Aplicados
```javascript
// En /api/leads
// SIN FILTROS - Ve todo
filter = {}
```

### Páginas Accesibles
- ✅ **TODAS las páginas del sistema**
- ✅ Inicio
- ✅ Lead
- ✅ Costumer
- ✅ Ranking
- ✅ Estadísticas
- ✅ Equipos
- ✅ Facturación (facturacion.html)
- ✅ Empleado del Mes (empleado-del-mes.html)
- ✅ Multimedia (multimedia.html)
- ✅ Reglas (Reglas.html)
- ✅ Debug (debug.html)

---

## 📊 ROL: BACKOFFICE

### Permisos de Visualización
- ✅ **Ver TODAS las ventas del sistema**
- ✅ Ver todos los equipos
- ✅ Ver estadísticas globales
- ✅ Ver reportes completos
- ✅ Ver facturación

### Permisos de Acción
- ✅ Crear ventas
- ✅ Editar CUALQUIER venta
- ✅ Cambiar status de cualquier venta
- ✅ Agregar comentarios
- ✅ Generar reportes
- ✅ Exportar datos
- ❌ NO puede eliminar ventas (solo admin)
- ❌ NO puede crear/editar usuarios (solo admin)

### Filtros Aplicados
```javascript
// En /api/leads
// SIN FILTROS - Ve todo
filter = {}
```

### Páginas Accesibles
- ✅ Inicio
- ✅ Lead
- ✅ Costumer
- ✅ Ranking
- ✅ Estadísticas
- ✅ Equipos
- ✅ Facturación
- ✅ Empleado del Mes
- ✅ Tabla de Puntaje
- ❌ NO accede a Debug (solo admin)

---

## 📱 ROL: TEAM LÍNEAS (teamlineas)

### Permisos de Visualización
- ✅ **Ver solo ventas de Team Líneas**
- ✅ Ver ranking de Team Líneas
- ✅ Ver estadísticas de Team Líneas
- ✅ Páginas especializadas para líneas
- ❌ NO puede ver ventas de otros equipos

### Permisos de Acción
- ✅ Crear ventas de líneas
- ✅ Editar sus propias ventas
- ✅ Cambiar status de sus ventas
- ✅ Agregar comentarios
- ❌ NO puede ver/editar ventas de otros equipos

### Filtros Aplicados Automáticamente
```javascript
// En /api/lineas (endpoint especializado)
filter = {
  $or: [
    { team: 'TEAM LINEAS' },
    { supervisor: 'TEAM LINEAS' },
    { agenteNombre: user.username } // Si es agente de líneas
  ]
}
```

### Páginas Accesibles (Especializadas)
- ✅ INICIO-LINEAS.html
- ✅ LEAD-LINEAS.html
- ✅ COSTUMER-LINEAS.html
- ✅ RANKING-LINEAS.html
- ✅ ESTADISTICAS-LINEAS.html
- ✅ EMPLEADO-LINEAS.html
- ✅ REGLAS-LINEAS.html
- ❌ NO accede a páginas generales

---

## 🔒 Matriz de Permisos

| Acción | Agente | Supervisor | Admin | Backoffice | Team Líneas |
|--------|--------|------------|-------|------------|-------------|
| Ver propias ventas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ver ventas del equipo | ❌ | ✅ | ✅ | ✅ | ✅ |
| Ver todas las ventas | ❌ | ❌ | ✅ | ✅ | ❌ |
| Crear ventas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editar propias ventas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editar ventas del equipo | ❌ | ✅ | ✅ | ✅ | ❌ |
| Editar cualquier venta | ❌ | ❌ | ✅ | ✅ | ❌ |
| Eliminar ventas | ❌ | ❌ | ✅ | ❌ | ❌ |
| Cambiar status | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reasignar ventas | ❌ | ✅* | ✅ | ✅ | ❌ |
| Crear usuarios | ❌ | ❌ | ✅ | ❌ | ❌ |
| Ver debug | ❌ | ❌ | ✅ | ❌ | ❌ |

*Solo dentro de su equipo

---

## 📝 Filtros de Fecha por Defecto

**TODOS los roles** tienen aplicado automáticamente:

### Filtro de Mes Actual
```javascript
// Por defecto en /api/leads
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
```

### Desactivar Filtro de Fecha
```javascript
// Agregar parámetro en URL
/api/leads?skipDate=1
```

### Filtro Personalizado
```javascript
// Agregar parámetros en URL
/api/leads?fechaInicio=2025-10-01&fechaFin=2025-10-31
```

---

## 🚨 Reglas Importantes

1. **Agentes solo ven sus datos** - No pueden ver ventas de otros
2. **Supervisores solo ven su equipo** - No pueden ver otros equipos
3. **Admin y Backoffice ven todo** - Sin restricciones de equipo
4. **Team Líneas está aislado** - Usa endpoints y páginas separadas
5. **Filtro de mes automático** - Todas las consultas filtran por mes actual por defecto
6. **Puntajes automáticos** - Todos los roles usan el mismo sistema de puntación

---

## 🔧 Implementación Técnica

### Middleware de Autenticación
```javascript
// routes/api.js
const role = (user?.role || '').toLowerCase();

if (role === 'agente' || role === 'agent') {
  // Filtrar por agente
} else if (role === 'supervisor') {
  // Filtrar por equipo
} else {
  // Admin/Backoffice - sin filtros
}
```

### Protección de Rutas
```javascript
// Todas las rutas usan middleware 'protect'
router.get('/leads', protect, async (req, res) => {
  // Validar usuario y aplicar filtros según rol
});
```

---

**Última actualización**: 24 de octubre de 2025
