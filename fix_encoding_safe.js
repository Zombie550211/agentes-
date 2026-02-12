const fs = require('fs');

const content = fs.readFileSync('frontend/Costumer.html', 'utf8');

// Replace common corrupted UTF-8 sequences
const replacements = {
  // Vowels with accent - estas son the real corrupted forms
  'estÃ¡': 'está',
  'todavÃ­a': 'todavía',
  'VersiÃ³n': 'Versión',
  'aÃºn': 'aún',
  'mÃ¡s': 'más',
  'cÃ³mo': 'cómo',
  'FunciÃ³n': 'Función',
  'crÃ­tico': 'crítico',
  'vÃ¡lido': 'válido',
  'Ã­ndice': 'índice',
  'DÃ­a': 'Día',
  'DÃA': 'DÍA',
  'DirecciÃ³n': 'Dirección',
  'DIRECCIÃ"N': 'DIRECCIÓN',
  'NÃºmero': 'Número',
  'NÃšMERO': 'NÚMERO',
  'TelÃ©fono': 'Teléfono',
  'TELÃ‰FONO': 'TELÉFONO',
  'LÃ­nea': 'Línea',
  'LÃNEA': 'LÍNEA',
  'TelÃ©fonos': 'Teléfonos',
  'TELÃ‰FONOS': 'TELÉFONOS',
  // Add more patterns
  'Ã¡': 'á',
  'Ã©': 'é',
  'Ã­': 'í',
  'Ã³': 'ó',
  'Ãº': 'ú',
  'Ã±': 'ñ',
  'Ã‰': 'É',
  'Ã"': 'Ó',
  'ÃŠ': 'Ê',
};

let fixed = content;
let count = 0;

for (const [corrupted, correct] of Object.entries(replacements)) {
  const regex = new RegExp(corrupted.split('').map(c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4)).join(''), 'g');
  const matches = (fixed.match(regex) || []).length;
  if (matches > 0) {
    fixed = fixed.split(corrupted).join(correct);
    count += matches;
    console.log(`Replaced '${corrupted}' -> '${correct}': ${matches} times`);
  }
}

fs.writeFileSync('frontend/Costumer.html', fixed, 'utf8');
console.log(`\\n✅ Done! Total replacements: ${count}`);
