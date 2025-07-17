// Verifica autenticación del usuario en localStorage y redirige si no hay token
(function(){
  if(!localStorage.getItem('token')) {
    window.location.href = '/login.html';
  }
})();
