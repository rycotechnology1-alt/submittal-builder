import { describe, expect, it } from 'vitest';

import { buildHeaderLines, formatCityStateZip } from './cover-format.js';

describe('formatCityStateZip', () => {
  it('composes the full city, state zip line', () => {
    expect(formatCityStateZip({ city: 'Austin', state: 'TX', zip: '78701' })).toBe(
      'Austin, TX 78701',
    );
  });

  it('drops the comma when city is missing', () => {
    expect(formatCityStateZip({ state: 'TX', zip: '78701' })).toBe('TX 78701');
  });

  it('omits the zip when missing', () => {
    expect(formatCityStateZip({ city: 'Austin', state: 'TX' })).toBe('Austin, TX');
  });

  it('handles city only and state only', () => {
    expect(formatCityStateZip({ city: 'Austin' })).toBe('Austin');
    expect(formatCityStateZip({ state: 'TX' })).toBe('TX');
  });

  it('handles zip only', () => {
    expect(formatCityStateZip({ zip: '78701' })).toBe('78701');
  });

  it('returns empty string when all blank', () => {
    expect(formatCityStateZip({})).toBe('');
    expect(formatCityStateZip({ city: '  ', state: '', zip: null })).toBe('');
  });
});

describe('buildHeaderLines', () => {
  it('returns all lines when every field is present', () => {
    expect(
      buildHeaderLines({
        companyName: 'Acme Submittals',
        addressStreet: '123 Main St',
        addressCity: 'Austin',
        addressState: 'TX',
        addressZip: '78701',
        contactPhone: '512-555-0100',
        contactEmail: 'hi@acme.com',
        contactWebsite: 'acme.com',
      }),
    ).toEqual([
      'Acme Submittals',
      '123 Main St',
      'Austin, TX 78701',
      '512-555-0100',
      'hi@acme.com',
      'acme.com',
    ]);
  });

  it('skips blank fields without leaving empty lines', () => {
    expect(
      buildHeaderLines({
        companyName: 'Acme Submittals',
        addressStreet: null,
        addressCity: 'Austin',
        addressState: 'TX',
        addressZip: '',
        contactPhone: '   ',
        contactEmail: 'hi@acme.com',
        contactWebsite: null,
      }),
    ).toEqual(['Acme Submittals', 'Austin, TX', 'hi@acme.com']);
  });

  it('returns just the company name when nothing else is set', () => {
    expect(buildHeaderLines({ companyName: 'Acme Submittals' })).toEqual(['Acme Submittals']);
  });
});
