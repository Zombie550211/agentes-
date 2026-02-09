// Roles y permisos del sistema
const ROLES = {
  ADMINISTRADOR: 'Administrador',
  BACKOFFICE: 'Backoffice',
  SUPERVISOR: 'Supervisor',
  AGENTES: 'Agentes',
  SUPERVISOR_TEAM_LINEAS: 'Supervisor Team Lineas',
  LINEAS_AGENTES: 'Lineas-Agentes'
};

// Permisos para cada rol
const PERMISSIONS = {
  [ROLES.ADMINISTRADOR]: {
    canViewAllLeads: true,
    canEditAllLeads: true,
    canDeleteLeads: true,
    canManageUsers: true,
    canViewReports: true,
    canManageSettings: true,
    canExportData: true,
    canManageEmployees: true
  },
  [ROLES.BACKOFFICE]: {
    canViewAllLeads: true,
    canEditAllLeads: true,
    canDeleteLeads: false,
    canManageUsers: false,
    canViewReports: true,
    canManageSettings: false,
    canExportData: true,
    canManageEmployees: false
  },
  [ROLES.SUPERVISOR]: {
    canViewAllLeads: false,
    canEditAllLeads: false,
    canDeleteLeads: false,
    canManageUsers: false,
    canViewReports: true,
    canManageSettings: false,
    canExportData: true,
    canViewTeam: true
  },
  [ROLES.AGENTES]: {
    canViewAllLeads: false,
    canEditAllLeads: false,
    canDeleteLeads: false,
    canManageUsers: false,
    canViewReports: false,
    canManageSettings: false,
    canExportData: false,
    canViewOwn: true
  },
  [ROLES.SUPERVISOR_TEAM_LINEAS]: {
    canViewAllLeads: false,
    canEditAllLeads: false,
    canDeleteLeads: false,
    canManageUsers: false,
    canViewReports: true,
    canManageSettings: false,
    canExportData: true,
    canViewTeam: true,
    canManageEmployees: true,
    canManageLineas: true
  },
  [ROLES.LINEAS_AGENTES]: {
    canViewAllLeads: false,
    canEditAllLeads: false,
    canDeleteLeads: false,
    canManageUsers: false,
    canViewReports: false,
    canManageSettings: false,
    canExportData: false,
    canViewOwn: true,
    canUseLineasForm: true
  }
};

// Verificar si un rol tiene un permiso específico
const hasPermission = (role, permission) => {
  return PERMISSIONS[role] && PERMISSIONS[role][permission];
};

// Obtener todos los permisos de un rol
const getRolePermissions = (role) => {
  return PERMISSIONS[role] || {};
};

module.exports = {
  ROLES,
  PERMISSIONS,
  hasPermission,
  getRolePermissions
};
