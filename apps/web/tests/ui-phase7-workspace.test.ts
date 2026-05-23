import { describe, expect, test } from 'vitest';

import {
  ALLOWED_LOGO_CONTENT_TYPES,
  MAX_LOGO_BYTES,
  buildWorkspacePatch,
  hasWorkspaceChanged,
  isEmptyWorkspaceField,
  isValidLogoContentType,
  isWithinLogoSizeLimit,
  normalizeWorkspaceFieldValue,
} from '@/app/(dashboard)/settings/workspace/_components/workspace-settings-helpers';

describe('isValidLogoContentType', () => {
  test('accepts allowed image content types', () => {
    for (const type of ALLOWED_LOGO_CONTENT_TYPES) {
      expect(isValidLogoContentType(type)).toBe(true);
    }
  });

  test('rejects pdf and other types', () => {
    expect(isValidLogoContentType('application/pdf')).toBe(false);
    expect(isValidLogoContentType('image/gif')).toBe(false);
    expect(isValidLogoContentType('')).toBe(false);
  });
});

describe('isWithinLogoSizeLimit', () => {
  test('accepts bytes up to the cap', () => {
    expect(isWithinLogoSizeLimit(1)).toBe(true);
    expect(isWithinLogoSizeLimit(MAX_LOGO_BYTES)).toBe(true);
  });

  test('rejects zero, negative, and over-cap sizes', () => {
    expect(isWithinLogoSizeLimit(0)).toBe(false);
    expect(isWithinLogoSizeLimit(-1)).toBe(false);
    expect(isWithinLogoSizeLimit(MAX_LOGO_BYTES + 1)).toBe(false);
  });
});

describe('normalizeWorkspaceFieldValue', () => {
  test('trims whitespace', () => {
    expect(normalizeWorkspaceFieldValue('  Acme  ')).toBe('Acme');
    expect(normalizeWorkspaceFieldValue('Acme')).toBe('Acme');
  });

  test('returns empty string for whitespace-only input', () => {
    expect(normalizeWorkspaceFieldValue('   ')).toBe('');
  });
});

describe('isEmptyWorkspaceField', () => {
  test('flags empty and whitespace-only values', () => {
    expect(isEmptyWorkspaceField('')).toBe(true);
    expect(isEmptyWorkspaceField('   ')).toBe(true);
  });

  test('does not flag non-empty values', () => {
    expect(isEmptyWorkspaceField('Acme')).toBe(false);
    expect(isEmptyWorkspaceField('  Acme  ')).toBe(false);
  });
});

describe('buildWorkspacePatch', () => {
  test('builds a single-field patch with the trimmed value', () => {
    expect(buildWorkspacePatch('name', '  Acme Workspace  ')).toEqual({ name: 'Acme Workspace' });
    expect(buildWorkspacePatch('sub_company_name', 'Acme Co')).toEqual({
      sub_company_name: 'Acme Co',
    });
  });
});

describe('hasWorkspaceChanged', () => {
  test('returns false when trimmed draft matches current', () => {
    expect(hasWorkspaceChanged('Acme', 'Acme')).toBe(false);
    expect(hasWorkspaceChanged('  Acme  ', 'Acme')).toBe(false);
  });

  test('returns true when value differs', () => {
    expect(hasWorkspaceChanged('Acme', 'Beta')).toBe(true);
    expect(hasWorkspaceChanged('', 'Acme')).toBe(true);
  });
});
