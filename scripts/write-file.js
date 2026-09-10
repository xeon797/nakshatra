import fs from 'node:fs';
import path from 'node:path';

const targetFile = process.argv[2];
if (!targetFile) {
  console.error('Usage: node write-file.js <targetFile>');
  process.exit(1);
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', () => {
  const resolved = path.resolve(targetFile);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, data, { encoding: 'utf8' });
  console.log(`Successfully wrote ${Buffer.byteLength(data, 'utf8')} bytes to ${targetFile}`);
});