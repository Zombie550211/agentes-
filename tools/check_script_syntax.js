const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname,'..','Costumer.html'),'utf8');
const scripts = [];
let i=0;
while(true){
  const s = html.indexOf('<script', i);
  if (s===-1) break;
  const openEnd = html.indexOf('>', s);
  if (openEnd===-1) break;
  const close = html.indexOf('</script>', openEnd);
  if (close===-1) break;
  const content = html.slice(openEnd+1, close);
  scripts.push({start:s, openEnd, close, src: content});
  i = close + 9;
}
console.log('Found', scripts.length, 'inline script blocks');
// Test each block separately to find parse errors

// If combined parsing failed, test each block separately to find the broken one
for (let idx=0; idx<scripts.length; idx++){
  try{
    new Function(scripts[idx].src);
  } catch(err){
    console.error('\nParsing error in script block', idx+1, 'at file offset', scripts[idx].start);
    console.error('Message:', err.message);
    const lines = scripts[idx].src.split(/\n/);
    // try to extract line from stack
    const match = /<anonymous>:(\d+):(\d+)/.exec(err.stack||'');
    let lineno = match ? parseInt(match[1],10) : null;
    if (lineno) {
      const contextStart = Math.max(0, lineno-5);
      const context = lines.slice(contextStart, contextStart+12).map((l,ii)=>`${contextStart+ii+1}: ${l}`);
      console.error(context.join('\n'));
    } else {
        console.error('First 60 lines of the script block:');
        lines.slice(0,60).forEach((l,i)=>{
          console.error(`${i+1}: ${JSON.stringify(l)}`);
        });
    }
    process.exit(3);
  }
}
console.log('All individual script blocks parsed OK (unexpected).');
