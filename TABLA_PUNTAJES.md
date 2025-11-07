# TABLA DE PUNTAJES - SISTEMA AUTOMÁTICO

## 📋 Resumen del Sistema

El sistema de puntación automática calcula el puntaje de cada venta basándose en:
1. **Servicio seleccionado** (obligatorio)
2. **Nivel de riesgo** (obligatorio)

El puntaje se calcula automáticamente en el frontend y se valida en el backend.

---

## 🎯 Tabla Completa de Puntajes

### VIDEO

| Servicio | Riesgo LOW | Riesgo MEDIUM | Riesgo HIGH | Riesgo N/A |
|----------|------------|---------------|-------------|------------|
| **VIDEO DIRECTV VIA INTERNET** | 1.0 | 0.35 | 0.35 | 1.0 |
| **VIDEO DIRECTV VIA SATELITE** | 1.0 | 1.0 | 1.0 | 1.0 |
| **VIDEO SELECT SPECTRUM** | 1.0 | 1.0 | 1.0 | 1.0 |

> ⚠️ **IMPORTANTE**: Solo "VIDEO DIRECTV VIA INTERNET" tiene puntajes diferentes según el riesgo.

---

### AT&T

| Servicio | Puntaje Fijo |
|----------|--------------|
| **ATT AIR** | 0.35 |
| **ATT 18-25 MB** | 0.25 |
| **ATT 50-100 MB** | 0.70 |
| **ATT 300-500 MB** | 1.25 |
| **ATT 1G+** | 1.5 |

> ✅ Todos los servicios AT&T tienen puntaje fijo (no dependen del riesgo)

---

### XFINITY

| Servicio | Puntaje Fijo |
|----------|--------------|
| **XFINITY 100-299 MBPS** | 0.35 |
| **XFINITY 300MBPS** | 0.35 |
| **XFINITY 500MBPS+** | 0.75 |
| **XFINITY DOUBLE PLAY** | 0.75 |
| **XFINITY ULTIMATE TV** | 0.75 |
| **XFINITY UNLIMITED VOIP** | 0.75 |

> ✅ Todos los servicios XFINITY tienen puntaje fijo

---

### FRONTIER

| Servicio | Puntaje Fijo |
|----------|--------------|
| **FRONTIER 200 MB** | 1.0 |
| **FRONTIER 500 MB** | 1.0 |
| **FRONTIER 1G** | 1.25 |
| **FRONTIER 2G+** | 1.5 |

> ✅ Todos los servicios FRONTIER tienen puntaje fijo

---

### SPECTRUM

| Servicio | Puntaje Fijo |
|----------|--------------|
| **SPECTRUM 500** | 0.75 |
| **SPECTRUM 1G** | 1.0 |
| **SPECTRUM 2G** | 1.25 |
| **DOUBLE PLAY SPECTRUM** | 1.0 |
| **MOBILITY SPECTRUM** | 0.5 |
| **SIM SPECTRUM** | 0.5 |

> ✅ Todos los servicios SPECTRUM tienen puntaje fijo

---

### OTROS PROVEEDORES

| Servicio | Puntaje Fijo |
|----------|--------------|
| **INTERNET EARTHLINK** | 1.0 |
| **INTERNET ZIPLY FIBER** | 0.35 |
| **INTERNET WINDSTREAM** | 1.25 |
| **BRIGHTSPEED 10-100MBPS** | 0.35 |
| **BRIGHTSPEED 100-900MBPS** | 1.0 |
| **INTERNET WOW** | 1.0 |
| **INTERNET ALTA FIBER** | 1.0 |
| **INTERNET HUGHESNET** | 0.35 |
| **INTERNET VIASAT** | 0.75 |
| **INTERNET CONSOLIDATE** | 1.0 |
| **INTERNET CENTURYLINK** | 1.0 |
| **INTERNET METRONET** | 1.0 |
| **INTERNET HAWAIIAN** | 1.0 |
| **INTERNET OPTIMUM** | 1.0 |

> ✅ Todos estos servicios tienen puntaje fijo

---

## 🔧 Funcionamiento del Sistema

### Frontend (`js/scoring-system.js`)
1. El usuario selecciona un **servicio** en el formulario
2. El usuario selecciona un **nivel de riesgo**
3. El sistema calcula automáticamente el puntaje
4. El campo de puntaje se actualiza en tiempo real
5. El campo es de **solo lectura** (no se puede editar manualmente)

### Backend (`utils/scoring-system.js`)
1. Recibe los datos del formulario
2. Valida que el puntaje sea correcto
3. Si el puntaje es incorrecto, lo recalcula automáticamente
4. Guarda el puntaje correcto en la base de datos
5. Registra advertencias si detecta puntajes incorrectos

---

## 📝 Indicadores Visuales

- **Borde Verde**: El servicio tiene puntaje fijo (no depende del riesgo)
- **Borde Naranja**: El servicio tiene puntajes diferentes según el riesgo
- **Campo Bloqueado**: El puntaje se calcula automáticamente

---

## ⚙️ Archivos del Sistema

### Frontend
- `js/scoring-system.js` - Módulo de cálculo de puntajes
- `lead.html` - Formulario con auto-cálculo integrado

### Backend
- `utils/scoring-system.js` - Validación y cálculo en servidor
- `server.js` - Endpoint `/api/customers` con validación automática

---

## 🚨 Reglas Importantes

1. **NUNCA** editar manualmente el puntaje en el formulario
2. **SIEMPRE** seleccionar servicio y riesgo para obtener el puntaje correcto
3. Si agregas un nuevo servicio, actualiza ambos archivos:
   - `js/scoring-system.js` (frontend)
   - `utils/scoring-system.js` (backend)
4. Mantener sincronizadas las tablas de puntajes en frontend y backend

---

## 📊 Ejemplo de Uso

```javascript
// Frontend
const puntaje = ScoringSystem.calculateScore('video-directv-internet', 'low');
// Resultado: 1.0

const puntaje2 = ScoringSystem.calculateScore('video-directv-internet', 'medium');
// Resultado: 0.35

const puntaje3 = ScoringSystem.calculateScore('att-1g-plus', 'low');
// Resultado: 1.5 (mismo para cualquier riesgo)
```

---

## 🔄 Actualización de Puntajes

Para cambiar un puntaje:

1. Editar `js/scoring-system.js` (línea del servicio correspondiente)
2. Editar `utils/scoring-system.js` (misma línea)
3. Reiniciar el servidor
4. Refrescar el navegador (Ctrl + Shift + R)

---

**Última actualización**: 24 de octubre de 2025
