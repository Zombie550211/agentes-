const fs = require('fs');

const content = fs.readFileSync('frontend/Costumer.html', 'latin1').toString();

let fixed = content
  .replace(/estÃ¡/g, 'está')
  .replace(/todavÃ­a/g, 'todavía')
  .replace(/FunciÃ³n/g, 'Función')
  .replace(/Ã¡/g, 'á')
  .replace(/Ã©/g, 'é')
  .replace(/Ã­/g, 'í')
  .replace(/Ã³/g, 'ó')
  .replace(/Ãº/g, 'ú')
  .replace(/Ã±/g, 'ñ')
  .replace(/Ã‰/g, 'É')
  .replace(/ÃŒ/g, 'Ó')
  .replace(/Ã™/g, 'Ú')
  .replace(/ÃŽ/g, 'Ñ')
  .replace(/VersiÃ³n/g, 'Versión')
  .replace(/aÃºn/g, 'aún')
  .replace(/mÃ¡s/g, 'más')
  .replace(/cÃ³mo/g, 'cómo')
  .replace(/Â¿/g, '¿')
  .replace(/Â¡/g, '¡')
  .replace(/crÃ­tico/g, 'crítico')
  .replace(/vÃ¡lido/g, 'válido')
  .replace(/conteniendoÃ³/g, 'conteniendo')
  .replace(/pÃ©gam/g, 'pégam');

fs.writeFileSync('frontend/Costumer.html', fixed, 'utf8');
console.log('✅ Encoding fixed successfully');
