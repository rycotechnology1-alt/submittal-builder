import type { SourcePdfResponse } from '@submittal/shared/api';

type ProcessingRow = {
  processingStatus?: SourcePdfResponse['processing_status'];
};

const discardableStatuses: SourcePdfResponse['processing_status'][] = ['error', 'cancelled'];

export function shouldAutoProceedToSizeSelection({
  autoProceedToSizes,
  hasObservedProcessing,
  rows,
}: {
  autoProceedToSizes: boolean;
  hasObservedProcessing: boolean;
  rows: readonly ProcessingRow[];
}): boolean {
  if (!autoProceedToSizes || !hasObservedProcessing) return false;

  const proceedableRows = rows.filter(
    (row) => row.processingStatus && !discardableStatuses.includes(row.processingStatus),
  );
  return (
    proceedableRows.length > 0 &&
    proceedableRows.every((row) => row.processingStatus === 'extracted')
  );
}
