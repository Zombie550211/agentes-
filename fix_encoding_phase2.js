const fs = require('fs');

const content = fs.readFileSync('frontend/Costumer.html', 'utf8');

// Replace remaining corrupted UTF-8 sequences
const replacements = {
  // Simple replacements first
  'menú': 'menú',
  'menÂ¨Â²': 'menú',
  'menÂ¨': 'menú',
  'especÂ¨Âªficos': 'específicos',
  'Â¨Â¢rea': 'área',
  'mÂ¨Â¢rgenes': 'márgenes',
  'segÂ¨Â²n': 'según',
  'lÂ¨Âªneas': 'líneas',
  'BotÂ¨Â®n': 'Botón',
};

let fixed = content;
let count = 0;

// First pass: Replace complex patterns
const complexReplacements = [
  ['menÂ¨Â²', 'menú'],
  ['especÂ¨Âªficos', 'específicos'],
  ['Â¨Â¢rea', 'área'],
  ['mÂ¨Â¢rgenes', 'márgenes'],
  ['segÂ¨Â²n', 'según'],
  ['lÂ¨Âªneas', 'líneas'],
  ['BotÂ¨Â®n', 'Botón'],
];

for (const [corrupted, correct] of complexReplacements) {
  let matches = 0;
  while (fixed.includes(corrupted)) {
    fixed = fixed.replace(corrupted, correct);
    matches++;
  }
  if (matches > 0) {
    count += matches;
    console.log(`Replaced '${corrupted}' -> '${correct}': ${matches} times`);
  }
}

fs.writeFileSync('frontend/Costumer.html', fixed, 'utf8');
console.log(`\n✅ Done! Total replacements: ${count}`);
