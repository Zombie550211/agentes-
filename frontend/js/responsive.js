/**
 * Responsive CRM JavaScript
 * Maneja la funcionalidad responsive del CRM
 */

class ResponsiveCRM {
  constructor() {
    this.sidebar = null;
    this.mobileMenuToggle = null;
    this.mobileMenuOverlay = null;
    this.isMobile = window.innerWidth <= 768;
    this.isTablet = window.innerWidth <= 1024;
    
    this.init();
  }

  init() {
    this.setupElements();
    this.setupEventListeners();
    this.setupResizeHandler();
    this.setupTableResponsive();
    this.setupMobileMenu();
  }

  setupElements() {
    this.sidebar = document.querySelector('.sidebar');
    this.mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    this.mobileMenuOverlay = document.querySelector('.mobile-menu-overlay');
  }

  setupEventListeners() {
    // Mobile menu toggle
    if (this.mobileMenuToggle) {
      this.mobileMenuToggle.addEventListener('click', () => this.toggleMobileMenu());
    }

    // Mobile menu overlay
    if (this.mobileMenuOverlay) {
      this.mobileMenuOverlay.addEventListener('click', () => this.closeMobileMenu());
    }

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      if (this.isMobile && this.sidebar && this.sidebar.classList.contains('active')) {
        if (!this.sidebar.contains(e.target) && !this.mobileMenuToggle?.contains(e.target)) {
          this.closeMobileMenu();
        }
      }
    });

    // Handle escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.sidebar?.classList.contains('active')) {
        this.closeMobileMenu();
      }
    });
  }

  setupResizeHandler() {
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.handleResize();
      }, 250);
    });
  }

  handleResize() {
    const wasMobile = this.isMobile;
    const wasTablet = this.isTablet;
    
    this.isMobile = window.innerWidth <= 768;
    this.isTablet = window.innerWidth <= 1024;

    // Close mobile menu when switching to desktop
    if (wasMobile && !this.isMobile) {
      this.closeMobileMenu();
    }

    // Handle responsive tables
    this.updateResponsiveTables();
    
    // Handle responsive cards
    this.updateResponsiveCards();
  }

  setupMobileMenu() {
    // Create mobile menu toggle if it doesn't exist
    if (!this.mobileMenuToggle && this.sidebar) {
      this.createMobileMenuToggle();
    }

    // Create mobile menu overlay if it doesn't exist
    if (!this.mobileMenuOverlay) {
      this.createMobileMenuOverlay();
    }
  }

  createMobileMenuToggle() {
    const toggle = document.createElement('button');
    toggle.className = 'mobile-menu-toggle';
    toggle.innerHTML = '<i class="fas fa-bars"></i>';
    toggle.setAttribute('aria-label', 'Toggle navigation menu');
    document.body.appendChild(toggle);
    this.mobileMenuToggle = toggle;
  }

  createMobileMenuOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'mobile-menu-overlay';
    document.body.appendChild(overlay);
    this.mobileMenuOverlay = overlay;
  }

  toggleMobileMenu() {
    if (this.sidebar?.classList.contains('active')) {
      this.closeMobileMenu();
    } else {
      this.openMobileMenu();
    }
  }

  openMobileMenu() {
    if (this.sidebar) {
      this.sidebar.classList.add('active');
      this.mobileMenuOverlay?.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      // Update toggle icon
      if (this.mobileMenuToggle) {
        this.mobileMenuToggle.innerHTML = '<i class="fas fa-times"></i>';
      }
    }
  }

  closeMobileMenu() {
    if (this.sidebar) {
      this.sidebar.classList.remove('active');
      this.mobileMenuOverlay?.classList.remove('active');
      document.body.style.overflow = '';
      
      // Update toggle icon
      if (this.mobileMenuToggle) {
        this.mobileMenuToggle.innerHTML = '<i class="fas fa-bars"></i>';
      }
    }
  }

  setupTableResponsive() {
    this.updateResponsiveTables();
  }

  updateResponsiveTables() {
    const tables = document.querySelectorAll('.crm-table');
    
    tables.forEach(table => {
      const container = table.closest('.table-responsive-wrapper');
      if (!container) return;

      const cardView = container.querySelector('.table-card-view');
      if (!cardView) return;

      if (this.isMobile || window.innerWidth <= 576) {
        // Show card view on mobile
        this.createCardView(table, cardView);
        table.style.display = 'none';
        cardView.style.display = 'block';
      } else {
        // Show table view on desktop
        table.style.display = 'table';
        cardView.style.display = 'none';
      }
    });
  }

  createCardView(table, cardContainer) {
    if (cardContainer.dataset.created === 'true') return;

    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const rows = table.querySelectorAll('tbody tr');

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      const card = document.createElement('div');
      card.className = 'table-card-item';

      // Card header (usually first column or a specific column)
      const headerCell = cells[0];
      const statusCell = cells.find((cell, index) => 
        headers[index].toLowerCase().includes('status') || 
        headers[index].toLowerCase().includes('estado')
      );

      let cardHeader = '';
      if (headerCell) {
        cardHeader += `<div class="table-card-title">${headerCell.textContent.trim()}</div>`;
      }
      if (statusCell) {
        cardHeader += `<div class="table-card-status">${statusCell.textContent.trim()}</div>`;
      }

      card.innerHTML = `
        <div class="table-card-header">
          ${cardHeader}
        </div>
        <div class="table-card-body">
          ${Array.from(cells).map((cell, index) => {
            if (index === 0) return ''; // Skip first column (already in header)
            if (cell === statusCell) return ''; // Skip status column (already in header)
            
            const label = headers[index] || `Column ${index + 1}`;
            const value = cell.textContent.trim();
            
            // Handle action buttons
            if (cell.querySelector('.btn')) {
              return `
                <div class="table-card-field">
                  <span class="table-card-label">Acciones</span>
                  <div class="table-card-value">
                    ${cell.innerHTML}
                  </div>
                </div>
              `;
            }
            
            return `
              <div class="table-card-field">
                <span class="table-card-label">${label}</span>
                <span class="table-card-value">${value}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="table-card-actions">
          ${this.getActionButtons(row)}
        </div>
      `;

      cardContainer.appendChild(card);
    });

    cardContainer.dataset.created = 'true';
  }

  getActionButtons(row) {
    const actionButtons = row.querySelectorAll('.btn');
    if (actionButtons.length === 0) return '';

    return Array.from(actionButtons).map(btn => 
      `<button class="btn ${btn.className}" onclick="${btn.getAttribute('onclick') || ''}">
        ${btn.innerHTML}
      </button>`
    ).join('');
  }

  updateResponsiveCards() {
    const cardGrids = document.querySelectorAll('.card-grid');
    
    cardGrids.forEach(grid => {
      if (this.isMobile) {
        grid.style.gridTemplateColumns = '1fr';
      } else if (this.isTablet) {
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(250px, 1fr))';
      } else {
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
      }
    });
  }

  // Utility methods
  static isMobileDevice() {
    return window.innerWidth <= 768;
  }

  static isTabletDevice() {
    return window.innerWidth <= 1024;
  }

  static isDesktopDevice() {
    return window.innerWidth > 1024;
  }

  // Debounce helper
  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Throttle helper
  static throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
}

// Initialize responsive CRM when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.responsiveCRM = new ResponsiveCRM();
});

// Handle orientation change
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    if (window.responsiveCRM) {
      window.responsiveCRM.handleResize();
    }
  }, 100);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ResponsiveCRM;
}
