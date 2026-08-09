const fs = require('fs');
let content = fs.readFileSync('custom.js', 'utf8');
const index = content.indexOf('// --- Warehouse Location Setting Override ---');
if (index !== -1) {
  content = content.substring(0, index);
  fs.writeFileSync('custom.js', content, 'utf8');
}
