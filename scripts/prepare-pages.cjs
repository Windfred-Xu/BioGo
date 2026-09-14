/* Create a self-contained static site directory for GitHub Pages. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'www');
const target = path.join(root, 'docs');

function copyTree(from, to) {
  const stat = fs.statSync(from);
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    copyTree(path.join(from, entry.name), path.join(to, entry.name));
  }
}

if (!fs.existsSync(source)) throw new Error('Missing www. Run "npm run prepare:mobile" first.');
fs.rmSync(target, { recursive: true, force: true });
copyTree(source, target);
fs.writeFileSync(path.join(target, '.nojekyll'), '');
console.log('GitHub Pages bundle ready: docs');
