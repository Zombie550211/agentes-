      // Migración de compatibilidad: renombrar filtro legado a nombre neutral
      try {
        if (window.iraniaAgentFilter != null && window.supervisorAgentFilter == null) {
          window.supervisorAgentFilter = window.iraniaAgentFilter;
        }
      } catch(_) {}
