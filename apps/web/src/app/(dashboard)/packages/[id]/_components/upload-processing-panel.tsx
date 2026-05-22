'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileUp, RefreshCw, UploadCloud, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { partitionUploadBatch, putFileWithProgress, type UploadBatchRow } from '@/lib/upload';
import type {
  PackageDetailResponse,
  PackageStatusResponse,
  SourcePdfPresignRequest,
  SourcePdfResponse,
} from '@submittal/shared/api';

import { UploadFileRow, type UploadFileRowData, type UploadRowStage } from './upload-file-row';
import {
  getPackageStatusPollingInterval,
  isTerminalProcessingStatus,
} from './processing-status';

type PresignResponse = {
  source_pdf_id: string;
  upload_url: string;
  storage_key: string;
  expires_at: string;
  required_headers: Record<string, string>;
};

type LocalUploadRow = UploadFileRowData & {
  file?: File;
  sourcePdfId?: string;
};

export function UploadProcessingPanel({
  packageId,
  packageStatus,
  sourcePdfCount,
}: {
  packageId: string;
  packageStatus: PackageDetailResponse['status'];
  sourcePdfCount: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<LocalUploadRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [processingRequested, setProcessingRequested] = useState(packageStatus === 'processing');

  const shouldPoll = useMemo(() => {
    if (packageStatus === 'processing' || processingRequested) return true;
    return rows.some(
      (row) =>
        row.sourcePdfId &&
        row.processingStatus &&
        !isTerminalProcessingStatus(row.processingStatus),
    );
  }, [packageStatus, processingRequested, rows]);

  const statusQuery = useQuery({
    queryKey: ['package-status', packageId],
    queryFn: () => api.get<PackageStatusResponse>(`/api/v1/packages/${packageId}/status`),
    enabled: shouldPoll || sourcePdfCount > 0,
    refetchInterval: (query) => {
      return getPackageStatusPollingInterval(query.state.data, shouldPoll);
    },
  });

  const processMutation = useMutation({
    mutationFn: () => api.post<{ status: 'processing' }>(`/api/v1/packages/${packageId}/process`, {}),
    onSuccess: () => {
      setProcessingRequested(true);
      queryClient.invalidateQueries({ queryKey: ['package', packageId] });
      queryClient.invalidateQueries({ queryKey: ['package-status', packageId] });
      toast.success('Processing started');
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not start processing');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      api.post<{ processing_state: 'cancelled'; cancelled_source_pdf_count: number }>(
        `/api/v1/packages/${packageId}/cancel-processing`,
        {},
      ),
    onSuccess: () => {
      setProcessingRequested(false);
      queryClient.invalidateQueries({ queryKey: ['package-status', packageId] });
      toast.success('Processing cancelled');
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not cancel processing');
    },
  });

  const updateRow = useCallback((id: string, patch: Partial<LocalUploadRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const uploadOne = useCallback(
    async (row: LocalUploadRow): Promise<boolean> => {
      if (!row.file) return false;
      try {
        updateRow(row.id, { stage: 'presigning', progress: 0, error: null });
        const body: SourcePdfPresignRequest = {
          filename: row.file.name,
          byte_size: row.file.size,
          content_type: 'application/pdf',
        };
        const presign = await api.post<PresignResponse>(
          `/api/v1/packages/${packageId}/source-pdfs/presign`,
          body,
        );

        updateRow(row.id, {
          sourcePdfId: presign.source_pdf_id,
          stage: 'uploading',
          progress: 0,
        });
        await putFileWithProgress({
          file: row.file,
          uploadUrl: presign.upload_url,
          requiredHeaders: presign.required_headers,
          onProgress: (progress) => updateRow(row.id, { progress }),
        });

        updateRow(row.id, { stage: 'confirming', progress: 100 });
        const confirmed = await api.post<SourcePdfResponse>(
          `/api/v1/packages/${packageId}/source-pdfs/${presign.source_pdf_id}/confirm`,
          {},
        );

        updateRow(row.id, {
          stage: 'uploaded',
          sourcePdfId: confirmed.id,
          fileName: confirmed.original_filename,
          byteSize: confirmed.byte_size,
          pageCount: confirmed.page_count,
          processingStatus: confirmed.processing_status,
          progress: 100,
        });
        return true;
      } catch (error) {
        updateRow(row.id, {
          stage: 'error',
          error: error instanceof Error ? error.message : 'Upload failed.',
        });
        return false;
      }
    },
    [packageId, updateRow],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const batch = partitionUploadBatch(Array.from(fileList));
      const newRows = batch.map(uploadBatchRowToLocalRow);
      setRows((current) => [...newRows, ...current]);

      const validRows = newRows.filter((row) => row.stage === 'queued');
      if (validRows.length === 0) return;

      const results = await Promise.all(validRows.map((row) => uploadOne(row)));
      if (results.some(Boolean)) {
        processMutation.mutate();
      }
    },
    [processMutation, uploadOne],
  );

  useEffect(() => {
    const data = statusQuery.data;
    if (!data) return;

    setRows((current) =>
      current.map((row) => {
        if (!row.sourcePdfId) return row;
        const status = data.source_pdfs.find((pdf) => pdf.id === row.sourcePdfId);
        if (!status) return row;
        return {
          ...row,
          stage: processingStatusToStage(status.processing_status),
          processingStatus: status.processing_status,
          error: status.processing_error ?? row.error,
        };
      }),
    );

    if (data.status === 'ready' || !data.has_active_processing) {
      setProcessingRequested(false);
    }
    if (data.status === 'ready') {
      queryClient.invalidateQueries({ queryKey: ['package', packageId] });
    }
  }, [packageId, queryClient, statusQuery.data]);

  const serverRows = useMemo(() => {
    const knownIds = new Set(rows.map((row) => row.sourcePdfId).filter(Boolean));
    return (statusQuery.data?.source_pdfs ?? [])
      .filter((pdf) => !knownIds.has(pdf.id))
      .map<UploadFileRowData>((pdf) => ({
        id: pdf.id,
        fileName: `Source PDF ${pdf.id.slice(0, 8)}`,
        byteSize: null,
        stage: processingStatusToStage(pdf.processing_status),
        progress: pdf.processing_status === 'extracted' ? 100 : 0,
        processingStatus: pdf.processing_status,
        error: pdf.processing_error,
      }));
  }, [rows, statusQuery.data]);

  const allRows = [...serverRows, ...rows];
  const statusData = statusQuery.data;
  const hasProcessingError = statusData?.has_errors ?? false;
  const isBlocked = statusData?.processing_state === 'blocked';
  const isActuallyPolling = getPackageStatusPollingInterval(statusData, shouldPoll) === 2000;
  const canCancel = statusData?.can_cancel ?? shouldPoll;

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      {hasProcessingError ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {isBlocked
              ? 'Processing is blocked until the failed files are retried.'
              : 'Some files hit an issue while other files continue processing.'}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => processMutation.mutate()}
            disabled={processMutation.isPending}
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      ) : null}

      <div
        className={[
          'flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-10 text-center transition-colors',
          dragActive ? 'border-foreground bg-accent/40' : 'border-border',
        ].join(' ')}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          void handleFiles(event.dataTransfer.files);
        }}
      >
        <UploadCloud className="h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold tracking-tight">Drop PDFs here</h2>
        <p className="mt-1 text-sm text-muted-foreground">Up to 20 files, 50 MB each.</p>
        <div className="mt-5">
          <Button type="button" onClick={() => inputRef.current?.click()}>
            <FileUp className="h-4 w-4" />
            Browse files
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) void handleFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Files ({allRows.length})</h2>
          <div className="flex flex-wrap items-center gap-3">
            {isActuallyPolling ? (
              <p className="text-sm text-muted-foreground">Checking processing status every 2s.</p>
            ) : null}
            {canCancel ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                <XCircle className="h-4 w-4" />
                Cancel processing
              </Button>
            ) : null}
          </div>
        </div>
        {allRows.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            Uploaded PDFs will appear here as they move through processing.
          </div>
        ) : (
          <ul className="overflow-hidden rounded-lg border bg-card">
            {allRows.map((row) => (
              <UploadFileRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function uploadBatchRowToLocalRow(row: UploadBatchRow): LocalUploadRow {
  return {
    id: row.id,
    file: row.file,
    fileName: row.file.name,
    byteSize: row.file.size,
    stage: row.status === 'queued' ? 'queued' : 'error',
    progress: 0,
    error: row.status === 'error' ? row.error : null,
  };
}

function processingStatusToStage(status: SourcePdfResponse['processing_status']): UploadRowStage {
  const map: Record<SourcePdfResponse['processing_status'], UploadRowStage> = {
    uploaded: 'uploaded',
    ocr_running: 'processing',
    classifying: 'processing',
    extracting: 'processing',
    extracted: 'ready',
    error: 'error',
    cancelled: 'cancelled',
  };
  return map[status];
}
