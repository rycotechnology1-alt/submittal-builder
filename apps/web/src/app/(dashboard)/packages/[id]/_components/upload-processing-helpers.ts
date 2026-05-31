import type { SourcePdfResponse } from '@submittal/shared/api';

type ProcessingRow = {
  processingStatus?: SourcePdfResponse['processing_status'];
};

export function shouldAutoProceedToSizeSelection({
  autoProceedToSizes: _autoProceedToSizes,
  hasObservedProcessing: _hasObservedProcessing,
  rows: _rows,
}: {
  autoProceedToSizes: boolean;
  hasObservedProcessing: boolean;
  rows: readonly ProcessingRow[];
}): boolean {
  return false;
}
