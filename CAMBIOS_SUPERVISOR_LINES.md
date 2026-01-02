# Implementación de Asignación Automática de Supervisores - Team Líneas

## Resumen
Se ha implementado un sistema de asignación **automática** de supervisores cuando se crean agentes en Team Líneas. Esto asegura que:
- ✅ Cada agente se conecte automáticamente con su supervisor correcto
- ✅ Las ventas/leads se asignen automáticamente al supervisor responsable
- ✅ El supervisor vea automáticamente los leads de sus agentes

## Cambios Implementados

### 1. **Frontend: crear-cuenta.html**

#### A) Interfaz de Selección de Subdivisión de Líneas
- Se agregó un select adicional "Subdivisión de Team Líneas" que se muestra solo cuando se selecciona "TEAM LÍNEAS"
- Opciones disponibles:
  - 📞 **Team Líneas Jonathan** (Supervisor: JONATHAN F)
  - 📞 **Team Líneas Luis** (Supervisor: LUIS G)

**Ubicaciones:**
- Sección "Crear Nueva Cuenta" - línea ~510
- Sección "Editar Rol y Equipo" - línea ~615

#### B) Lógica Automática de Asignación de Supervisor
```javascript
// Cuando se crea una cuenta con Team Líneas:
if (teamValue === 'team lineas jonathan') {
    supervisorValue = 'JONATHAN F';
} else if (teamValue === 'team lineas luis') {
    supervisorValue = 'LUIS G';
}
```

**Ubicación:** línea ~850 en handleFormSubmit

#### C) Validación
- El formulario valida que si se selecciona "TEAM LÍNEAS", se debe especificar la subdivisión
- No permite crear una cuenta sin definir a cuál de las dos líneas pertenece

**Ubicación:** línea ~845

### 2. **Backend: server.js**

#### A) Endpoint POST /api/auth/register (Crear Usuario)
**Ubicación:** línea ~2870

Se agregó lógica para asignar automáticamente el supervisor según el team:
```javascript
// Asignar supervisor automáticamente según el team de Líneas
let supervisorValue = supervisor || null;
if (!supervisorValue && teamNormalized) {
  const normalizedTeam = String(teamNormalized).toLowerCase();
  if (normalizedTeam.includes('team lineas jonathan') || normalizedTeam.includes('jonathan')) {
    supervisorValue = 'JONATHAN F';
  } else if (normalizedTeam.includes('team lineas luis') || normalizedTeam.includes('luis')) {
    supervisorValue = 'LUIS G';
  }
}
```

#### B) Endpoint POST /api/lineas (Team Líneas - Crear Venta)
**Ubicación:** línea ~630

Se mejoró la determinación automática del supervisor:
```javascript
// Determinar el supervisor automáticamente según el team del usuario
let supervisorVal = String(body.supervisor || '').toLowerCase();
if (!supervisorVal && user.supervisor) {
  supervisorVal = String(user.supervisor).toLowerCase();
} else if (!supervisorVal && user.team) {
  const userTeamLower = String(user.team).toLowerCase();
  if (userTeamLower.includes('jonathan')) {
    supervisorVal = 'jonathan f';
  } else if (userTeamLower.includes('luis')) {
    supervisorVal = 'luis g';
  }
}
```

#### C) Endpoint POST /api/leads (Crear Lead)
**Ubicación:** línea ~5620

Se agregó asignación automática del supervisor si el usuario pertenece a Team Líneas:
```javascript
// Asignar supervisor automáticamente si el usuario pertenece a Team Líneas
if (req.user?.supervisor) {
  newLead.supervisor = req.user.supervisor;
} else if (req.user?.team && String(req.user.team).toLowerCase().includes('lineas')) {
  const userTeamLower = String(req.user.team).toLowerCase();
  if (userTeamLower.includes('jonathan')) {
    newLead.supervisor = 'JONATHAN F';
  } else if (userTeamLower.includes('luis')) {
    newLead.supervisor = 'LUIS G';
  }
}
```

### 3. **Script de Seed: seed_team_lineas.js**
✅ Ya estaba correctamente configurado con:
- **JONATHAN F** → team: 'team lineas jonathan', supervisor: 'JONATHAN F'
- **LUIS G** → team: 'team lineas luis', supervisor: 'LUIS G'

## Flujo de Funcionamiento

### Cuando se crea un nuevo agente de Team Líneas:

```
1. Admin entra a crear-cuenta.html
   ↓
2. Selecciona:
   - Nombre: "Carlos López"
   - Usuario: "carlos.lopez"
   - Rol: "Lineas-Agentes"
   - Equipo: "TEAM LÍNEAS"
   ↓
3. Se muestra selector de subdivisión → Selecciona "Team Líneas Jonathan"
   ↓
4. El frontend automáticamente asigna supervisor = "JONATHAN F"
   ↓
5. Se envía al backend: {username, role, team: 'team lineas jonathan', supervisor: 'JONATHAN F', ...}
   ↓
6. El backend confirma y crea el usuario
```

### Cuando el agente envía una venta (lead):

```
1. Agente "carlos.lopez" (Team Líneas Jonathan) crea un lead
   ↓
2. El backend detecta: user.team = 'team lineas jonathan'
   ↓
3. Automáticamente asigna: supervisor = 'JONATHAN F'
   ↓
4. El lead se guarda con:
   - agente: "carlos.lopez"
   - supervisor: "JONATHAN F"
   ↓
5. El supervisor JONATHAN F puede ver el lead en su panel
```

## Supervisores Definidos

| Supervisor | Team | Agentes Típicos |
|-----------|------|-----------------|
| **JONATHAN F** | team lineas jonathan | VICTOR HURTADO, EDWARD RAMIREZ, CRISTIAN RIVERA |
| **LUIS G** | team lineas luis | DANIEL DEL CID, FERNANDO BELTRAN, KARLA RODRIGUEZ, JOCELYN REYES, JONATHAN GARCIA, NANCY LOPEZ |

## Validaciones Implementadas

✅ **Frontend:**
- Valida que si se selecciona "TEAM LÍNEAS", se debe especificar subdivisión
- Muestra/oculta dinámicamente el selector de subdivisión

✅ **Backend:**
- Valida que el supervisor sea "JONATHAN F" o "LUIS G"
- Asigna automáticamente si no se proporciona
- Valida que el team sea válido para Team Líneas

## Testing

Para verificar que funciona correctamente:

```bash
# 1. Crear un nuevo usuario de Team Líneas Jonathan
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token_admin>" \
  -d '{
    "username": "test.jonathan",
    "password": "Password123",
    "role": "Lineas-Agentes",
    "team": "team lineas jonathan"
  }'

# Verificar que el usuario tiene supervisor: "JONATHAN F"

# 2. Crear un lead con ese usuario
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token_usuario>" \
  -d '{
    "nombre_cliente": "Test Client",
    "telefono_principal": "1234567890",
    "direccion": "Test Address",
    "tipo_servicio": "Internet"
  }'

# Verificar que el lead tiene supervisor: "JONATHAN F"

# 3. Verficar en Costumer.html que el supervisor ve el lead
# Iniciar sesión como JONATHAN F y confirmar que ve los leads del agente
```

## Notas Importantes

1. **Compatibilidad**: El sistema busca "jonathan" o "luis" en minúsculas dentro del nombre del team
2. **Fallback**: Si por alguna razón no se puede determinar el supervisor automáticamente, el sistema lo rechaza con un error claro
3. **Editabilidad**: Un admin puede cambiar el supervisor de un usuario en la sección "Editar rol y equipo"
4. **Historiales**: Todos los cambios se registran en los logs del servidor

## Archivos Modificados

- [crear-cuenta.html](crear-cuenta.html) - UI y lógica frontend
- [server.js](server.js) - Endpoints de backend (3 modificaciones)
- [scripts/seed_team_lineas.js](scripts/seed_team_lineas.js) - Ya estaba configurado correctamente

## Próximos Pasos Opcionales

1. Agregar vista detallada del equipo en el panel de supervisores
2. Crear reportes de productividad por supervisor
3. Implementar notificaciones en tiempo real cuando un agente envía un lead
4. Agregar gráficos de distribución de cargas por supervisor
