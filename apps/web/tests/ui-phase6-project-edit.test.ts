import { describe, expect, test } from 'vitest';

import {
  buildProjectPatch,
  hasChanged,
  isEmptyRequiredField,
  normalizeFieldValue,
} from '@/app/(dashboard)/projects/[id]/_components/project-edit-helpers';

describe('isEmptyRequiredField', () => {
  test('flags empty name', () => {
    expect(isEmptyRequiredField('name', '')).toBe(true);
    expect(isEmptyRequiredField('name', '   ')).toBe(true);
  });

  test('does not flag nullable fields as empty-required', () => {
    expect(isEmptyRequiredField('project_number', '')).toBe(false);
    expect(isEmptyRequiredField('gc_name', '')).toBe(false);
    expect(isEmptyRequiredField('architect_name', '')).toBe(false);
  });

  test('allows non-empty name', () => {
    expect(isEmptyRequiredField('name', 'Riverside Tower')).toBe(false);
  });
});

describe('normalizeFieldValue', () => {
  test('trims and returns required values', () => {
    expect(normalizeFieldValue('name', '  Riverside  ')).toBe('Riverside');
  });

  test('returns null for empty nullable fields', () => {
    expect(normalizeFieldValue('project_number', '')).toBe(null);
    expect(normalizeFieldValue('gc_name', '   ')).toBe(null);
  });

  test('trims and returns nullable values with content', () => {
    expect(normalizeFieldValue('gc_name', '  Acme GC  ')).toBe('Acme GC');
  });
});

describe('buildProjectPatch', () => {
  test('builds a partial update for required fields', () => {
    expect(buildProjectPatch('name', 'Riverside Tower')).toEqual({ name: 'Riverside Tower' });
  });

  test('sends null when a nullable field is cleared', () => {
    expect(buildProjectPatch('gc_name', '')).toEqual({ gc_name: null });
    expect(buildProjectPatch('architect_name', '   ')).toEqual({ architect_name: null });
  });

  test('sends trimmed value for nullable fields with content', () => {
    expect(buildProjectPatch('project_number', '  PR-001  ')).toEqual({ project_number: 'PR-001' });
  });
});

describe('hasChanged', () => {
  test('returns false when required field draft matches current', () => {
    expect(hasChanged('name', 'Riverside', 'Riverside')).toBe(false);
    expect(hasChanged('name', '  Riverside  ', 'Riverside')).toBe(false);
  });

  test('returns false when nullable field is empty and current is null', () => {
    expect(hasChanged('gc_name', '', null)).toBe(false);
    expect(hasChanged('architect_name', '   ', null)).toBe(false);
  });

  test('returns true when nullable field is cleared from a non-null current', () => {
    expect(hasChanged('gc_name', '', 'Acme')).toBe(true);
  });

  test('returns true when value changes', () => {
    expect(hasChanged('name', 'Other', 'Riverside')).toBe(true);
    expect(hasChanged('project_number', 'PR-002', 'PR-001')).toBe(true);
  });
});
