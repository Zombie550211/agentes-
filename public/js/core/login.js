// Lógica básica de login para CRM Agente
(async function(){
  document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('loginForm');
    if(form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const email = form.email.value;
        const password = form.password.value;
        try {
          const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password})
          });
          const data = await res.json();
          if(res.ok && data.token) {
            localStorage.setItem('token', data.token);
            window.location.href = '/dashboard.html';
          } else {
            alert(data.message || 'Login incorrecto');
          }
        } catch(err) {
          alert('Error de red');
        }
      });
    }
  });
})();
