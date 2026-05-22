import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

let standardFontDataUrl: string | null = null;

export function getStandardFontDataUrl(): string {
  if (standardFontDataUrl) return standardFontDataUrl;

  const packageJson = require.resolve('pdfjs-dist/package.json');
  const fontsDir = path.join(path.dirname(packageJson), 'standard_fonts');
  standardFontDataUrl = pathToFileURL(`${fontsDir}${path.sep}`).href;
  return standardFontDataUrl;
}
