const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'frontend', 'rankingAgente.html');
let text = fs.readFileSync(file, 'utf8');
const start = text.indexOf('function normalizeNameKey(name)');
if (start === -1) {
  console.error('function normalizeNameKey not found');
  process.exit(1);
}
const brace = text.indexOf('{', start);
if (brace === -1) {
  console.error('opening brace not found');
  process.exit(1);
}
let depth = 1;
let i = brace + 1;
while (i < text.length && depth > 0) {
  if (text[i] === '{') depth++;
  else if (text[i] === '}') depth--;
  i++;
}
if (depth !== 0) {
  console.error('brace mismatch');
  process.exit(1);
}

const replacement = `function normalizeNameKey(name) {
  return String(name || '')
    .trim()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}
`;

const oldBlock = text.slice(start, i);
if (oldBlock === replacement) {
  console.log('Already fixed');
  process.exit(0);
}

fs.writeFileSync(file, text.slice(0, start) + replacement + text.slice(i), 'utf8');
console.log('Normalization function updated');
