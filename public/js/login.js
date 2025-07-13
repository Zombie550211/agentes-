
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  usernameInput.classList.remove("valid");
  passwordInput.classList.remove("valid");

  if (!usernameInput.value.trim()) {
    usernameInput.focus();
    return;
  } else {
    usernameInput.classList.add("valid");
  }

  if (!passwordInput.value.trim()) {
    passwordInput.focus();
    return;
  } else {
    passwordInput.classList.add("valid");
  }

  const response = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: usernameInput.value,
      password: passwordInput.value,
      remember: document.getElementById("remember").checked
    })
  });

  const result = await response.json();
  const message = document.getElementById("message");

if (result.success) {
  message.style.color = "green";
  message.textContent = "Login exitoso. Redirigiendo...";
  // Guardar token o session si aplica
  setTimeout(() => window.location.href = "lead.html", 1000);
}

});

document.getElementById("togglePassword").addEventListener("click", () => {
  const passwordInput = document.getElementById("password");
  const toggleIcon = document.getElementById("togglePassword");
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
