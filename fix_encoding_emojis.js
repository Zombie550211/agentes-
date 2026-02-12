const fs = require('fs');

const content = fs.readFileSync('frontend/Costumer.html', 'utf8');

// Replace remaining corrupted UTF-8 sequences, including emoji
const replacements = {
  // Emoji and special characters
  'âŒ': '❌',
  'âœ…': '✅',
  'âœ"': '✓',
  'â€¢': '•',
  'â€œ': '"',
  'â€\x9d': '"',
  'â€"': '–',
  'â€"': '—',
  'â–¶': '▶',
  'â–¼': '▼',
  'â—': '●',
  'âš ï¸': '⚠️',
  'ðŸ—'ï¸': '🗑️',
  'ðŸ"': '📋',
  'ðŸ"„': '📄',
  // More accent replacements
  'menÂ¨Â²': 'menú',
  'menÂ¨': 'menú',
  'especÂ¨Âªficos': 'específicos',
  'Â¨Â¢rea': 'área',
  'mÂ¨Â¢rgenes': 'márgenes',
  'segÂ¨Â²n': 'según',
  'lÂ¨Âªneas': 'líneas',
  'BotÂ¨Â®n': 'Botón',
  'â': '',  // Remove stray characters
  'Â': '',
};

let fixed = content;
let count = 0;

for (const [corrupted, correct] of Object.entries(replacements)) {
  const matches = (fixed.match(new RegExp(corrupted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (matches > 0) {
    fixed = fixed.split(corrupted).join(correct);
    count += matches;
    console.log(`Replaced '${corrupted}' -> '${correct}': ${matches} times`);
  }
}

fs.writeFileSync('frontend/Costumer.html', fixed, 'utf8');
console.log(`\\n✅ Done! Total replacements: ${count}`);
