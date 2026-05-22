import type { PackageStatusResponse, SourcePdfResponse } from '@submittal/shared/api';

export type ProcessingStatus = SourcePdfResponse['processing_status'];

const terminalProcessingStatuses: ProcessingStatus[] = ['extracted', 'error', 'cancelled'];

export function isTerminalProcessingStatus(status: ProcessingStatus): boolean {
  return terminalProcessingStatuses.includes(status);
}

export function getPackageStatusPollingInterval(
  status: PackageStatusResponse | undefined,
  hasLocalActiveRows: boolean,
): 2000 | false {
  if (status?.status === 'ready') return false;
  if (status?.has_active_processing) return 2000;
  if (hasLocalActiveRows && !status) return 2000;
  return false;
}
