      } else {
        // Render por defecto con separadores mensuales
        console.log('[RENDER ROUTE] Usando renderWithMonthlySeparators con', leadsArray.length, 'leads');
        renderWithMonthlySeparators(leadsArray);
        try { if (window.rebuildStickyHead) window.rebuildStickyHead(); } catch(_){ }
      }
