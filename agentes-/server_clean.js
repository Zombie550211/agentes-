// ===== ARCHIVO LIMPIO PARA DEBUGGING =====
// Este archivo ha sido creado desde cero para diagnosticar problemas de sintaxis

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Servidor funcionando correctamente' });
});

// Iniciar servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});

module.exports = app;
