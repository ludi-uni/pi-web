// Cross-platform copy of the freshly-built export bundle into the Go embed
// directory. Replaces the Unix-only `cp` in package.json so `npm run build`
// works identically on Windows and Linux. Run from web/ (the npm script cwd).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../dist-export/export.js');
const dest = resolve(here, '../../internal/ui/embedded/export/export.js');

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`copied ${src} -> ${dest}`);
