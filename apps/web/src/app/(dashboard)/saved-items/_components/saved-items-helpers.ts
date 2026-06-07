import type { SavedItemSummary } from '@submittal/shared/api';

export function savedItemAttributeValue(item: SavedItemSummary, key: string): string | null {
  return item.attributes.find((attribute) => attribute.key === key)?.current_value ?? null;
}

export function savedItemStatusLabel(
  item: Pick<SavedItemSummary, 'processing_status' | 'processing_error'>,
) {
  if (item.processing_status === 'uploaded') return 'Queued';
  if (item.processing_status === 'ocr_running') return 'Reading';
  if (item.processing_status === 'classifying') return 'Classifying';
  if (item.processing_status === 'extracting') return 'Extracting';
  if (item.processing_status === 'extracted') return 'Ready';
  if (item.processing_status === 'cancelled') return 'Cancelled';
  return item.processing_error ? `Error: ${item.processing_error}` : 'Error';
}

export function savedItemMetaLine(item: SavedItemSummary) {
  return [
    savedItemAttributeValue(item, 'manufacturer'),
    savedItemAttributeValue(item, 'model_number'),
    savedItemAttributeValue(item, 'description'),
  ]
    .filter(Boolean)
    .join(' | ');
}

export function docTypeLabel(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatBytes(value: number | null) {
  if (value === null) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
