import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  UploadCloud,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { SourcePdfResponse } from '@submittal/shared/api';

export type UploadRowStage =
  | 'queued'
  | 'presigning'
  | 'uploading'
  | 'confirming'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'error'
  | 'cancelled';

export type UploadFileRowData = {
  id: string;
  sourcePdfId?: string;
  fileName: string;
  byteSize: number | null;
  stage: UploadRowStage;
  progress: number;
  pageCount?: number | null;
  processingStatus?: SourcePdfResponse['processing_status'];
  error?: string | null;
  canCancel?: boolean;
  cancelPending?: boolean;
};

const stageLabels: Record<UploadRowStage, string> = {
  queued: 'Queued',
  presigning: 'Preparing',
  uploading: 'Uploading',
  confirming: 'Confirming',
  uploaded: 'Uploaded',
  processing: 'Processing',
  ready: 'Ready',
  error: 'Error',
  cancelled: 'Cancelled',
};

export function UploadFileRow({
  row,
  onCancel,
}: {
  row: UploadFileRowData;
  onCancel?: (row: UploadFileRowData) => void;
}) {
  const isActive = ['presigning', 'uploading', 'confirming', 'uploaded', 'processing'].includes(
    row.stage,
  );
  const Icon =
    row.stage === 'error'
      ? XCircle
      : row.stage === 'cancelled'
        ? XCircle
      : row.stage === 'ready'
        ? CheckCircle2
        : isActive
          ? Loader2
          : row.stage === 'queued'
            ? FileText
            : UploadCloud;

  return (
    <li className="flex gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="mt-0.5 shrink-0 text-muted-foreground">
        <Icon className={isActive ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{row.fileName}</p>
          <div className="flex shrink-0 items-center gap-2">
            {row.canCancel ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                aria-label={`Cancel processing for ${row.fileName}`}
                title="Cancel this PDF"
                onClick={() => onCancel?.(row)}
                disabled={row.cancelPending}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            ) : null}
            <Badge variant={row.stage === 'error' ? 'destructive' : 'secondary'}>
              {stageLabels[row.stage]}
            </Badge>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{formatBytes(row.byteSize)}</span>
          {row.pageCount ? <span>{row.pageCount} pages</span> : null}
          {row.processingStatus ? <span>{formatProcessingStatus(row.processingStatus)}</span> : null}
        </div>
        {row.stage === 'uploading' ? <Progress className="mt-3" value={row.progress} /> : null}
        {row.error ? (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {row.error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function formatBytes(value: number | null): string {
  if (!value) return 'Size pending';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatProcessingStatus(status: SourcePdfResponse['processing_status']): string {
  const labels: Record<SourcePdfResponse['processing_status'], string> = {
    uploaded: 'Uploaded',
    ocr_running: 'OCR running',
    classifying: 'Classifying',
    extracting: 'Extracting',
    extracted: 'Extracted',
    error: 'Processing error',
    cancelled: 'Cancelled',
  };
  return labels[status];
}
