import { describe, expect, test } from 'vitest';

import {
  buildPackagePatch,
  hasChanged,
  isEmptyRequiredField,
  normalizeFieldValue,
} from '@/app/(dashboard)/packages/[id]/_components/editor/cover-sheet-helpers';

describe('isEmptyRequiredField', () => {
  test('flags empty submittal_number', () => {
    expect(isEmptyRequiredField('submittal_number', '')).toBe(true);
    expect(isEmptyRequiredField('submittal_number', '   ')).toBe(true);
  });

  test('flags empty spec_section', () => {
    expect(isEmptyRequiredField('spec_section', '')).toBe(true);
  });

  test('flags empty revision', () => {
    expect(isEmptyRequiredField('revision', '')).toBe(true);
  });

  test('allows non-empty required fields', () => {
    expect(isEmptyRequiredField('submittal_number', '09 51 13-002')).toBe(false);
    expect(isEmptyRequiredField('spec_section', '09 51 13')).toBe(false);
    expect(isEmptyRequiredField('revision', 'R1')).toBe(false);
  });

  test('never flags nullable fields as empty-required', () => {
    expect(isEmptyRequiredField('submittal_date', '')).toBe(false);
    expect(isEmptyRequiredField('title', '')).toBe(false);
  });
});

describe('normalizeFieldValue', () => {
  test('trims required fields and returns the string', () => {
    expect(normalizeFieldValue('submittal_number', '  X  ')).toBe('X');
    expect(normalizeFieldValue('revision', 'R2')).toBe('R2');
  });

  test('returns null when a nullable field is cleared', () => {
    expect(normalizeFieldValue('title', '')).toBe(null);
    expect(normalizeFieldValue('title', '   ')).toBe(null);
    expect(normalizeFieldValue('submittal_date', '')).toBe(null);
  });

  test('returns the trimmed value when a nullable field has content', () => {
    expect(normalizeFieldValue('title', 'Acoustical Panels')).toBe('Acoustical Panels');
    expect(normalizeFieldValue('submittal_date', '2026-05-13')).toBe('2026-05-13');
  });
});

describe('buildPackagePatch', () => {
  test('maps each field into the API payload shape', () => {
    expect(buildPackagePatch('submittal_number', '09 51 13-002')).toEqual({
      submittal_number: '09 51 13-002',
    });
    expect(buildPackagePatch('spec_section', '09 51 13')).toEqual({
      spec_section: '09 51 13',
    });
    expect(buildPackagePatch('revision', 'R1')).toEqual({ revision: 'R1' });
  });

  test('sends null when a nullable field is cleared', () => {
    expect(buildPackagePatch('title', '')).toEqual({ title: null });
    expect(buildPackagePatch('submittal_date', '')).toEqual({ submittal_date: null });
  });

  test('sends a trimmed value for nullable fields with content', () => {
    expect(buildPackagePatch('title', '  Acoustical Ceiling Panels  ')).toEqual({
      title: 'Acoustical Ceiling Panels',
    });
    expect(buildPackagePatch('submittal_date', '2026-05-13')).toEqual({
      submittal_date: '2026-05-13',
    });
  });
});

describe('hasChanged', () => {
  test('returns false when a required field draft matches current', () => {
    expect(hasChanged('submittal_number', 'X-001', 'X-001')).toBe(false);
    expect(hasChanged('submittal_number', '  X-001  ', 'X-001')).toBe(false);
  });

  test('returns true when a required field draft differs from current', () => {
    expect(hasChanged('submittal_number', 'X-002', 'X-001')).toBe(true);
  });

  test('returns false when a nullable field is empty and current is null', () => {
    expect(hasChanged('title', '', null)).toBe(false);
    expect(hasChanged('submittal_date', '   ', null)).toBe(false);
  });

  test('returns true when a nullable field is cleared from a non-null current', () => {
    expect(hasChanged('title', '', 'Old title')).toBe(true);
  });

  test('returns true when a nullable field changes value', () => {
    expect(hasChanged('title', 'New', 'Old')).toBe(true);
    expect(hasChanged('submittal_date', '2026-05-13', '2026-04-01')).toBe(true);
  });
});
