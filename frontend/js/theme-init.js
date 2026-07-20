(function () {
  try { localStorage.setItem('theme', 'dark'); } catch (_) {}
  document.body.classList.add('dark-theme');
})();
