import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');
const androidAssetsWww = path.resolve('android/app/src/main/assets/www');

if (!fs.existsSync(distDir)) {
  console.error('dist/ folder not found. Run "npm run build" first.');
  process.exit(1);
}

fs.rmSync(androidAssetsWww, { recursive: true, force: true });
fs.mkdirSync(androidAssetsWww, { recursive: true });
fs.cpSync(distDir, androidAssetsWww, { recursive: true, force: true });

console.log('Synced dist/ -> android/app/src/main/assets/www/');
