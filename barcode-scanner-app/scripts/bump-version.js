import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.resolve(__dirname, '../package.json');
const versionTsPath = path.resolve(__dirname, '../src/version.ts');

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const versionParts = (pkg.version || '1.0.0').split('.').map(Number);
  
  // Increment patch number
  versionParts[2] = (versionParts[2] || 0) + 1;
  const newVersion = versionParts.join('.');
  
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // Update src/version.ts
  const tsContent = `export const APP_VERSION = 'v${newVersion}';\n`;
  fs.writeFileSync(versionTsPath, tsContent, 'utf8');

  console.log(`[VERSION] Automatically bumped version to v${newVersion}`);
} catch (e) {
  console.error('[VERSION] Failed to bump version:', e);
}
