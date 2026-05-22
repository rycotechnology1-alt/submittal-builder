import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('sharp warning suppression', () => {
  test('keeps sharp externalized and ignores only known optional sharp probes', async () => {
    const source = await readFile(path.resolve(__dirname, '..', 'next.config.mjs'), 'utf8');

    expect(source).toContain("serverExternalPackages: ['sharp', 'pdf-to-img', 'pdfjs-dist']");
    expect(source).toContain('config.ignoreWarnings = [');
    expect(source).toContain("Can't resolve '@img\\/sharp-libvips-dev\\/include'");
    expect(source).toContain("Can't resolve '@img\\/sharp-libvips-dev\\/cplusplus'");
    expect(source).toContain("Can't resolve '@img\\/sharp-wasm32\\/versions'");
  });

  test('preview route imports only the PDF renderer subpath', async () => {
    const source = await readFile(
      path.resolve(
        __dirname,
        '..',
        'src/app/api/v1/source-pages/[id]/preview/route.ts',
      ),
      'utf8',
    );

    expect(source).toContain("from '@submittal/shared/pdf/render'");
    expect(source).not.toMatch(/from '@submittal\/shared\/pdf';/);
  });
});
