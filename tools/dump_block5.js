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
  if (idx===5) {
    const out = `// auto-stubbed runtime globals\nvar window = {}; var document = { querySelector: ()=>null, querySelectorAll: ()=>[] }; var Map = global.Map; var Array = global.Array;\n` + content;
    fs.writeFileSync('tmp_block5.js', out, 'utf8');
    console.log('Wrote tmp_block5.js');
    break;
  }
  i = close + 9;
}
