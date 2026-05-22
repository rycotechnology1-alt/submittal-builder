import type { PackageDetailResponse, PackageItemResponse } from '@submittal/shared/api';

import { itemNeedsReview } from './item-helpers';

export const BATES_PREFIX_REGEX = /^[A-Za-z0-9._-]+$/;
export const BATES_PREFIX_MAX_LENGTH = 16;

const COMMON_ATTRIBUTE_KEYS = ['manufacturer', 'model_number', 'description'] as const;
type CommonAttributeKey = (typeof COMMON_ATTRIBUTE_KEYS)[number];

export type ExportBlockers = {
  hardBlockers: string[];
  warnings: ExportWarning[];
};

export type ExportWarning =
  | { kind: 'low_confidence'; itemCount: number; firstItemId: string }
  | { kind: 'missing_attributes'; itemCount: number; firstItemId: string };

export type ExportSummary = {
  itemCount: number;
  sourcePageCount: number;
};

export function computeExportBlockers(items: PackageItemResponse[]): ExportBlockers {
  const hardBlockers: string[] = [];

  if (items.length === 0) {
    hardBlockers.push('Package has no items. Add at least one item before exporting.');
  } else {
    const itemsWithoutSource = items.filter((row) => row.source_pdfs.length === 0);
    if (itemsWithoutSource.length > 0) {
      hardBlockers.push(
        itemsWithoutSource.length === 1
          ? '1 item has no source PDFs attached.'
          : `${itemsWithoutSource.length} items have no source PDFs attached.`,
      );
    }
  }

  const warnings: ExportWarning[] = [];

  const lowConfidenceItems = items.filter(itemNeedsReview);
  if (lowConfidenceItems.length > 0) {
    warnings.push({
      kind: 'low_confidence',
      itemCount: lowConfidenceItems.length,
      firstItemId: lowConfidenceItems[0]!.item.id,
    });
  }

  const itemsMissingAttrs = items.filter(itemMissingCommonAttribute);
  if (itemsMissingAttrs.length > 0) {
    warnings.push({
      kind: 'missing_attributes',
      itemCount: itemsMissingAttrs.length,
      firstItemId: itemsMissingAttrs[0]!.item.id,
    });
  }

  return { hardBlockers, warnings };
}

function itemMissingCommonAttribute(item: PackageItemResponse): boolean {
  const filled = new Set(
    item.attributes
      .filter((attr) => attr.current_value != null && attr.current_value !== '')
      .map((attr) => attr.key),
  );
  return COMMON_ATTRIBUTE_KEYS.some((key: CommonAttributeKey) => !filled.has(key));
}

export function summarizeExport(items: PackageItemResponse[]): ExportSummary {
  const seen = new Set<string>();
  let sourcePageCount = 0;
  for (const row of items) {
    for (const pdf of row.source_pdfs) {
      if (seen.has(pdf.id)) continue;
      seen.add(pdf.id);
      sourcePageCount += pdf.page_count ?? 0;
    }
  }
  return { itemCount: items.length, sourcePageCount };
}

export function defaultBatesPrefix(pkg: Pick<PackageDetailResponse, 'submittal_number' | 'revision'>): string {
  const submittal = sanitizeBatesPart(pkg.submittal_number);
  const revision = sanitizeBatesPart(pkg.revision);
  const parts = [submittal, revision].filter(Boolean);
  if (parts.length === 0) return '';
  const joined = parts.join('-');
  const withTrailer = `${joined}-`;
  if (withTrailer.length > BATES_PREFIX_MAX_LENGTH) {
    const truncated = joined.slice(0, BATES_PREFIX_MAX_LENGTH - 1);
    return `${truncated.replace(/-+$/g, '')}-`;
  }
  return withTrailer;
}

function sanitizeBatesPart(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type BatesPrefixValidation =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export function validateBatesPrefix(raw: string): BatesPrefixValidation {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (trimmed.length > BATES_PREFIX_MAX_LENGTH) {
    return { ok: false, message: `Bates prefix must be ${BATES_PREFIX_MAX_LENGTH} characters or fewer.` };
  }
  if (!BATES_PREFIX_REGEX.test(trimmed)) {
    return { ok: false, message: 'Bates prefix may contain only letters, numbers, . _ -' };
  }
  return { ok: true, value: trimmed };
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const REMINDER_COOLDOWN_MS = 60_000;
