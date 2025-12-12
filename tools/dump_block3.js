const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname,'..','Costumer.html'),'utf8');
let i=0; let idx=0;
while(true){
  const s = html.indexOf('<script', i);
  if (s===-1) break;
  const openEnd = html.indexOf('>', s);
  if (openEnd===-1) break;
  const close = html.indexOf('</script>', openEnd);
  if (close===-1) break;
  idx++;
  const content = html.slice(openEnd+1, close);
  if (idx===3) {
    const out = `// auto-stubbed runtime globals\nvar window = {}; var head = { querySelectorAll: ()=>[] }; var container = { insertBefore: ()=>{} }; var wrap = { clientWidth: 800, scrollLeft:0, addEventListener: ()=>{}, removeEventListener: ()=>{} };\n` + content;
    fs.writeFileSync('tmp_block3.js', out, 'utf8');
    console.log('Wrote tmp_block3.js');
    break;
  }
  i = close + 9;
}
