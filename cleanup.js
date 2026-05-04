const fs = require('fs');
const path = require('path');

const root = process.cwd();
const scriptsDir = path.join(root, 'scripts');
const backupsDir = path.join(root, 'backups');

if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir);
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);

const files = fs.readdirSync(root);

const configFiles = [
  'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 
  'tailwind.config.ts', 'postcss.config.js', 'vitest.config.ts', 'vitest.setup.ts',
  'playwright.config.ts', 'ecosystem.config.js', 'docker-compose.yml', 'docker-compose.prod.yml',
  'Dockerfile', '.gitignore', '.dockerignore', 'eslint.config.mjs'
];

files.forEach(file => {
  const filePath = path.join(root, file);
  if (fs.lstatSync(filePath).isDirectory()) return;
  if (file.startsWith('.env')) return;
  if (configFiles.includes(file)) return;
  if (file === 'cleanup.js') return;

  // Scripts
  if (file.endsWith('.js') || (file.endsWith('.ts') && !file.endsWith('.d.ts'))) {
    console.log(`Moving script: ${file}`);
    fs.renameSync(filePath, path.join(scriptsDir, file));
  } 
  // Data/Backups
  else if (file.endsWith('.xlsx') || file.endsWith('.wbk') || file.endsWith('.pdf')) {
    console.log(`Moving data file: ${file}`);
    fs.renameSync(filePath, path.join(backupsDir, file));
  }
  // Temporary/Trash
  else if (file.endsWith('.txt') || file.endsWith('.json')) {
    if (['README.md', 'DEPLOYMENT.md'].includes(file)) return;
    console.log(`Deleting temp file: ${file}`);
    fs.unlinkSync(filePath);
  }
});
