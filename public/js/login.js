
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginError = document.getElementById("loginError");
  loginError.style.display = "none";
  emailInput.classList.remove("valid");
  passwordInput.classList.remove("valid");

  if (!emailInput.value.trim()) {
    emailInput.focus();
    loginError.textContent = "Por favor ingresa tu correo electrónico.";
    loginError.style.display = "block";
    return;
  } else {
    emailInput.classList.add("valid");
  }

  if (!passwordInput.value.trim()) {
    passwordInput.focus();
    loginError.textContent = "Por favor ingresa tu contraseña.";
    loginError.style.display = "block";
    return;
  } else {
    passwordInput.classList.add("valid");
  }

  const API_URL =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3002"
    : "https://connecting-klf7.onrender.com";

  const response = await fetch(`${API_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: emailInput.value,
      password: passwordInput.value
    })
  });

  const result = await response.json();

  if (result.ok && result.token) {
    // Guarda el token y rol en localStorage
    localStorage.setItem('token', result.token);
    localStorage.setItem('nombre', result.user.nombre);
    localStorage.setItem('rol', result.user.rol);
    loginError.style.color = "green";
    loginError.textContent = "¡Login exitoso! Redirigiendo...";
    loginError.style.display = "block";
    setTimeout(() => window.location.href = "dashboard.html", 1000);
  } else {
    loginError.style.color = "#e53935";
    loginError.textContent = result.error || "Credenciales incorrectas.";
    loginError.style.display = "block";
  }
});

document.getElementById("togglePassword").addEventListener("click", () => {
  const passwordInput = document.getElementById("password");
  const toggleIcon = document.querySelector("#togglePassword i");
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleIcon.classList.toggle("fa-eye");
  toggleIcon.classList.toggle("fa-eye-slash");
});

document.querySelectorAll('.nav-button').forEach(btn => {
  btn.disabled = false;
});

if (response.ok) {
  console.log("Login exitoso, redirigiendo...");
  window.location.href = "/lead.html";
}
