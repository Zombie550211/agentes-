const fs = require('fs');
const path = require('path');
const file = path.join(__dirname,'..','Costumer.html');
const orig = fs.readFileSync(file,'utf8');
let html = orig;
let i=0; let idx=0; const parts=[]; let changed=false;
while(true){
  const s = html.indexOf('<script', i);
  if (s===-1) break;
  const openEnd = html.indexOf('>', s);
  if (openEnd===-1) break;
  const close = html.indexOf('</script>', openEnd);
  if (close===-1) break;
  idx++;
  const content = html.slice(openEnd+1, close);
  parts.push({start:s, openEnd, close, content});
  i = close + 9;
}
console.log('Found', parts.length, 'script blocks');
const backup = file + '.bak.' + Date.now();
fs.copyFileSync(file, backup);
console.log('Backup created:', backup);
let newHtml = orig;
for (let k=0;k<parts.length;k++){
  const p = parts[k];
  const content = p.content;
  function test(code){ try{ new Function(code); return true;}catch(e){ return false;} }
  if (test(content)) continue;
  console.log('Block', k+1, 'failed parse — attempting fixes');
  let fixed = null;
  // Try 1: strip ONE trailing IIFE close '})();' (and surrounding whitespace/newlines)
  if (/\)\s*;?\s*\)?\s*;?\s*$/.test(content)){
    const c2 = content.replace(/\)\s*;?\s*\)?\s*;?\s*$/,'');
    if (test(c2)) fixed = c2;
  }
  // Try 2: specifically remove trailing '})();'
  if (!fixed && /\)\s*\)\s*;?\s*$/.test(content)){
    const c2 = content.replace(/\)\s*\)\s*;?\s*$/,'');
    if (test(c2)) fixed = c2;
  }
  // Try 3: remove last line if it's just ');' or '})();' lines
  if (!fixed){
    const lines = content.split(/\n/);
    for (let r=0;r<3;r++){
      const copy = lines.slice(0, lines.length-1-r).join('\n');
      if (copy.length===0) break;
      if (test(copy)) { fixed = copy; break; }
    }
  }
  // Try 4: wrap content in IIFE
  if (!fixed){
    const c2 = '(function(){\n' + content + '\n})();';
    if (test(c2)) fixed = c2;
  }
  if (fixed){
    console.log('Block', k+1, 'fixed by applying a repair.');
    // replace in newHtml between p.openEnd+1 and p.close
    newHtml = newHtml.slice(0, p.openEnd+1) + fixed + newHtml.slice(p.close);
    changed = true;
    // update offsets for subsequent parts (naive: recalc from file)
    // Recompute parts for simplicity and restart
    fs.writeFileSync(file, newHtml, 'utf8');
    console.log('Wrote interim file, restarting scan to re-evaluate offsets.');
    process.exit(0);
  } else {
    console.log('Block', k+1, 'could not be auto-fixed.');
  }
}
if (!changed) console.log('No automatic fixes applied.');
