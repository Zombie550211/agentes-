const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'frontend', 'Costumer.html');

// Read file
let content = fs.readFileSync(filePath, 'utf8');

// Define replacements for common UTF-8 encoding issues
const replacements = {
  'estÃ¡': 'está',
  'todavÃ­a': 'todavía',
  'Funci_ó_n': 'Función',
  'Ã¡': 'á',
  'Ã©': 'é',
  'Ã­': 'í',
  'Ã³': 'ó',
  'Ãº': 'ú',
  'Ã±': 'ñ',
  'Ã‰': 'É',
  'Ã"': 'Ó',
  'Ã™': 'Ú',
  'ÃŁ': 'Ñ',
  'Â¿': '¿',
  'Â¡': '¡',
  'â€¢': '•',
  'â€œ': '"',
  'â€\x9d': '"',
  'â€"': '–',
  'â€"': '—'
};

// Apply replacements
let changeCount = 0;
Object.entries(replacements).forEach(([wrong, correct]) => {
  const regex = new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const before = content;
  content = content.replace(regex, correct);
  if (content !== before) {
    changeCount += (before.length - content.length) / (wrong.length - correct.length);
  }
});

// Write back to file
fs.writeFileSync(filePath, content, 'utf8');

console.log('✅ Encoding fixed successfully');
console.log(`   Replacements made: ${changeCount} instances`);
