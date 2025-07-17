
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

  const response = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: emailInput.value,
      password: passwordInput.value
    })
  });

  const result = await response.json();

  if (result.success) {
    loginError.style.color = "green";
    loginError.textContent = "¡Login exitoso! Redirigiendo...";
    loginError.style.display = "block";
    setTimeout(() => window.location.href = "lead.html", 1000);
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
