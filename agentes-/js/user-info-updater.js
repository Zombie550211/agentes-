// Minimal user-info-updater to prevent 404 and optionally update username placeholders
(function(){
  // Simple cache for current user across pages
  let cachedUser = null;

  // Public: setter to update user globally
  window.setCurrentUser = function(user) {
    try {
      cachedUser = user || null;
      if (user) {
        sessionStorage.setItem('user', JSON.stringify(user));
      }
    } catch (_) {}
  };

  // Public: getter used by sidebar-loader.js
  window.getCurrentUser = function() {
    if (cachedUser) return cachedUser;
    try {
      const stored = sessionStorage.getItem('user') || localStorage.getItem('user');
      if (stored) {
        cachedUser = JSON.parse(stored);
        return cachedUser;
      }
    } catch (_) {}
    return null;
  };

  // Optional: update any inline placeholders if available
  try {
    const user = window.getCurrentUser();
    const name = user?.username || user?.name || '';
    if (name) {
      document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = name; });
    }
  } catch (_) {}
})();
