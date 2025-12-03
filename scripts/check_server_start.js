const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const outFile = path.join(__dirname, '..', 'server_start.log');
if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

console.log('Starting server (child process). Output will be written to', outFile);

const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});

const writeStream = fs.createWriteStream(outFile, { flags: 'a' });
child.stdout.on('data', (d) => {
  process.stdout.write(d);
  writeStream.write(d);
});
child.stderr.on('data', (d) => {
  process.stderr.write(d);
  writeStream.write(d);
});

child.on('close', (code) => {
  const msg = `Server process exited with code ${code}\n`;
  console.log(msg);
  writeStream.write(msg);
  writeStream.end(() => {
    // Print last 200 lines of the log for convenience
    const content = fs.readFileSync(outFile, 'utf8');
    const lines = content.split(/\r?\n/).slice(-200);
    console.log('\n---- Last log lines ----\n' + lines.join('\n'));
    console.log(`\nFull log saved to ${outFile}`);
  });
});
