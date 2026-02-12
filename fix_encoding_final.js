const fs = require('fs');

const content = fs.readFileSync('frontend/Costumer.html', 'utf8');

// More comprehensive replacements for remaining patterns
const replacements = [
  ['llenarÂ¨Â¢n', 'llenarán'],
  ['dinÂ¨Â¢micamente', 'dinámicamente'],
  ['cargarÂ¨Â¢n', 'cargarán'],
  ['aquÂ¨Âª', 'aquí'],
  ['rÂ¨Â¢pidamente', 'rápidamente'],
  ['despuÂ¨Â¦s', 'después'],
  ['FunciÂ¨Â®n', 'Función'],
  ['canÂ¨Â®nico', 'canónico'],
  ['heurÂ¨Âªsticas', 'heurísticas'],
  ['estÂ¨Â¦', 'está'],
  ['InicializaciÂ¨Â®n', 'Inicialización'],
  ['botÂ¨Â®n', 'botón'],
  ['se usarÂ¨Â¢', 'se usará'],
  ['vacÂ¨Âªo', 'vacío'],
  ['Â¨Â²ltimo', 'último'],
  ['NormalizaciÂ¨Â®n', 'Normalización'],
  ['mÂ¨Â¢s', 'más'],
  ['aÂ¨Â²n', 'aún'],
  ['Â¨Â¦', 'é'],  // catch-all for remaining Â¨Â¦
  ['Â¨Â¢', 'á'],  // catch-all for remaining Â¨Â¢
  ['Â¨Â®', 'ó'],  // catch-all for remaining Â¨Â®
  ['Â¨Âª', 'í'],  // catch-all for remaining Â¨Âª
  ['Â¨Â²', 'ú'],  // catch-all for remaining Â¨Â²
];

let fixed = content;
let count = 0;

for (const [corrupted, correct] of replacements) {
  let matches = 0;
  while (fixed.includes(corrupted)) {
    fixed = fixed.replace(corrupted, correct);
    matches++;
  }
  if (matches > 0) {
    count += matches;
    console.log(`Replaced: ${matches} occurrences`);
  }
}

fs.writeFileSync('frontend/Costumer.html', fixed, 'utf8');
console.log(`\n✅ Done! Total replacements: ${count}`);
