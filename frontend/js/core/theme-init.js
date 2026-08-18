(function () {
  try { localStorage.setItem('theme', 'light'); } catch (_) {}
  document.body.classList.remove('dark-theme');
})();
