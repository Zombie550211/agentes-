const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'Costumer.html');
const txt = fs.readFileSync(file, 'utf8');
const lines = txt.split(/\r?\n/);
let depth = 0;
const events = [];
for (let i=0;i<lines.length;i++){
  const l = lines[i];
  const lower = l.toLowerCase();
  if (lower.includes('<script') && !/<!--/.test(lower)){
    // ignore commented scripts lines crudely
    events.push({line: i+1, type: 'open', text: l.trim()});
    depth++;
  }
  if (lower.includes('</script>')){
    events.push({line: i+1, type: 'close', text: l.trim()});
    depth--;
    if (depth < 0) {
      console.log('UNMATCHED close at line', i+1, "text:", l.trim());
      depth = 0;
    }
  }
}
console.log('Final depth:', depth);
console.log('Total events:', events.length);
// show last 20 events
console.log('Last events (up to 40):');
console.log(events.slice(-40).map(e=>`${e.type}@${e.line}: ${e.text}`).join('\n'));
// find all standalone lines outside scripts that contain JS tokens
let inScript = false; depth = 0;
const suspicious = [];
for (let i=0;i<lines.length;i++){
  const l = lines[i];
  const low = l.toLowerCase();
  if (low.includes('<script')) { inScript = true; depth++; }
  if (low.includes('</script>')) { depth--; if (depth<=0) { inScript = false; depth = 0;} }
  if (!inScript) {
    // if outside script and contains JS-like tokens
    if (/\bfunction\b|\bconst\b|\blet\b|\bvar\b|=>|\{|\}|\(|\)|\[|\]|=|\+\+|--|;/.test(l)){
      suspicious.push({line: i+1, text: l.trim().slice(0,200)});
    }
  }
}
console.log('\nSuspicious lines outside scripts (first 80):');
console.log(suspicious.slice(0,80).map(s=>`${s.line}: ${s.text}`).join('\n'));
// Also: find suspicious lines INSIDE <script> blocks (like a lone "/" or stray chars)
inScript = false; depth = 0;
const badInScript = [];
for (let i=0;i<lines.length;i++){
  const l = lines[i];
  const low = l.toLowerCase();
  if (low.includes('<script')) { inScript = true; depth++; }
  if (low.includes('</script>')) { depth--; if (depth<=0) { inScript = false; depth = 0;} }
  if (inScript) {
    // lines that are just a symbol or unlikely JS
    if (/^\s*[`~@#$%^&*(){}<>\\]??\s*$/.test(l) || /^\s*\/\s*$/.test(l) || /^\s*\|\s*$/.test(l)) {
      badInScript.push({ line: i+1, text: l.trim() });
    }
    // lines starting with '/* Lines' are fine; skip
    if (/^\s*\/\*\s*Lines\s+\d+/i.test(l)) continue;
  }
}
if (badInScript.length) {
  console.log('\nSuspicious lines INSIDE <script> blocks:');
  console.log(badInScript.map(b=>`${b.line}: ${b.text}`).join('\n'));
} else {
  console.log('\nNo obvious lone-symbol lines found inside <script> blocks.');
}

// exit
process.exit(0);
