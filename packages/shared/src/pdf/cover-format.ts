// Blank-safe formatting for the cover-page letterhead header. Every field is
// optional — any combination may be missing, and the output must never contain
// stray commas, labels, or empty lines.

export type CoverHeaderInput = {
  /** Primary company name (workspace name). */
  companyName: string;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactWebsite?: string | null;
};

/** Trim and treat whitespace-only as absent. */
function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Compose the "City, State ZIP" line in standard US address format, omitting
 * whatever is missing:
 *   city + state + zip → "City, State 12345"
 *   city + state       → "City, State"
 *   state + zip        → "State 12345"
 *   zip only           → "12345"
 *   nothing            → ""
 */
export function formatCityStateZip(input: {
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const city = clean(input.city);
  const state = clean(input.state);
  const zip = clean(input.zip);

  const locality = city && state ? `${city}, ${state}` : city || state;
  return [locality, zip].filter(Boolean).join(' ');
}

/**
 * Ordered list of non-blank header lines: company name, street, city/state/zip,
 * then each present contact value. Blank fields are skipped entirely so no empty
 * lines are ever emitted.
 */
export function buildHeaderLines(input: CoverHeaderInput): string[] {
  const cityStateZip = formatCityStateZip({
    city: input.addressCity,
    state: input.addressState,
    zip: input.addressZip,
  });

  return [
    clean(input.companyName),
    clean(input.addressStreet),
    cityStateZip,
    clean(input.contactPhone),
    clean(input.contactEmail),
    clean(input.contactWebsite),
  ].filter(Boolean);
}
