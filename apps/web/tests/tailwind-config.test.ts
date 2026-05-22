import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import config from '../tailwind.config';

describe('tailwind config', () => {
  test('loads in the ESM web package without CommonJS require', () => {
    expect(config.content).toContain('./src/**/*.{ts,tsx}');
    expect(config.plugins).toHaveLength(1);
  });

  test('loads through Tailwind CommonJS config loader without require errors', () => {
    const require = createRequire(import.meta.url);
    const { loadConfig } = require('tailwindcss/lib/lib/load-config') as {
      loadConfig(configPath: string): { plugins?: unknown[] };
    };

    const loaded = loadConfig(path.resolve(__dirname, '..', 'tailwind.config.ts'));

    expect(loaded.plugins).toHaveLength(1);
  });

  test('does not use CommonJS require inside the ESM config file', async () => {
    const source = await readFile(path.resolve(__dirname, '..', 'tailwind.config.ts'), 'utf8');

    expect(source).not.toContain('require(');
  });
});
