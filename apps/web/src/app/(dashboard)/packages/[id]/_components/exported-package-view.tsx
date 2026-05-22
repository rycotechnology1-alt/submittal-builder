'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import type {
  ExportDownloadResponse,
  ExportResponse,
  PackageDetailResponse,
  PackageItemResponse,
  ProjectResponse,
} from '@submittal/shared/api';

import { ExportDialog } from './editor/export-dialog';
import {
  REMINDER_COOLDOWN_MS,
  formatBytes,
  formatRelativeTime,
} from './editor/export-helpers';
import { PdfPreview } from './pdf-preview';

export function ExportedPackageView({
  pkg,
  project,
}: {
  pkg: PackageDetailResponse;
  project: ProjectResponse | null;
}) {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [lastRenderCompletedAt, setLastRenderCompletedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const itemsQuery = useQuery({
    queryKey: ['package-items', pkg.id],
    queryFn: () => api.get<PackageItemResponse[]>(`/api/v1/packages/${pkg.id}/items`),
  });

  const exportsQuery = useQuery({
    queryKey: ['package-exports', pkg.id],
    queryFn: () => api.get<ExportResponse[]>(`/api/v1/packages/${pkg.id}/exports`),
  });

  const exports = exportsQuery.data ?? [];
  const readyExports = useMemo(
    () => exports.filter((e) => e.status === 'ready'),
    [exports],
  );
  const latestReady = readyExports[0] ?? null;

  // Track render completion to enforce 60s cooldown after a fresh export.
  useEffect(() => {
    if (!latestReady) return;
    const completed = new Date(latestReady.updated_at).getTime();
    if (Number.isNaN(completed)) return;
    setLastRenderCompletedAt((prev) => (prev === null || completed > prev ? completed : prev));
  }, [latestReady]);

  useEffect(() => {
    if (lastRenderCompletedAt == null) return;
    const remaining = REMINDER_COOLDOWN_MS - (Date.now() - lastRenderCompletedAt);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [lastRenderCompletedAt, now]);

  const cooldownRemaining = useMemo(() => {
    if (lastRenderCompletedAt == null) return 0;
    return Math.max(0, REMINDER_COOLDOWN_MS - (now - lastRenderCompletedAt));
  }, [lastRenderCompletedAt, now]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewExportId, setPreviewExportId] = useState<string | null>(null);

  const downloadMutation = useMutation({
    mutationFn: (exportId: string) =>
      api.get<ExportDownloadResponse>(`/api/v1/exports/${exportId}/download`),
  });

  const fetchPreviewUrl = useCallback(
    async (exportId: string) => {
      try {
        const res = await api.get<ExportDownloadResponse>(`/api/v1/exports/${exportId}/download`);
        setPreviewUrl(res.url);
        setPreviewExportId(exportId);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Could not load preview.');
      }
    },
    [],
  );

  useEffect(() => {
    if (!latestReady) return;
    if (previewExportId === latestReady.id) return;
    void fetchPreviewUrl(latestReady.id);
  }, [latestReady, previewExportId, fetchPreviewUrl]);

  function downloadExport(exportId: string) {
    downloadMutation.mutate(exportId, {
      onSuccess: (data) => {
        if (typeof window === 'undefined') return;
        window.location.assign(data.url);
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : 'Could not generate download link.');
      },
    });
  }

  const items = itemsQuery.data ?? [];
  const summaryLine = formatSummaryLine(pkg, project);
  const reRenderDisabled = cooldownRemaining > 0;

  return (
    <>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
                Package ready <Badge variant="secondary">Exported</Badge>
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">{summaryLine}</p>
              {latestReady ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {latestReady.page_count != null ? `${latestReady.page_count} pages · ` : ''}
                  {formatBytes(latestReady.byte_size)} · rendered{' '}
                  {formatRelativeTime(latestReady.updated_at)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => latestReady && downloadExport(latestReady.id)}
                disabled={!latestReady || downloadMutation.isPending}
              >
                {downloadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => setExportDialogOpen(true)}
                disabled={reRenderDisabled || itemsQuery.isLoading}
                title={
                  reRenderDisabled
                    ? `Available in ${Math.ceil(cooldownRemaining / 1000)}s`
                    : undefined
                }
              >
                <RefreshCw className="h-4 w-4" />
                Re-render
              </Button>
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <div className="rounded border bg-muted/30 p-2">
              <PdfPreview url={previewUrl} />
            </div>
          </div>
        </div>

        <section className="mt-8">
          <h3 className="text-base font-semibold tracking-tight">Previous exports</h3>
          {exportsQuery.isLoading ? (
            <div className="mt-3 space-y-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : exports.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No previous exports yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y rounded-lg border bg-card">
              {exports.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {row.bates_prefix ?? '—'}
                      {row.id === latestReady?.id ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (latest)
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatExportStatusLabel(row)} ·{' '}
                      {formatRelativeTime(row.updated_at ?? row.created_at)}
                      {row.byte_size ? ` · ${formatBytes(row.byte_size)}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadExport(row.id)}
                    disabled={row.status !== 'ready' || downloadMutation.isPending}
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        pkg={pkg}
        project={project}
        items={items}
      />
    </>
  );
}

function formatExportStatusLabel(row: ExportResponse): string {
  switch (row.status) {
    case 'ready':
      return 'Ready';
    case 'pending':
      return 'Queued';
    case 'rendering':
      return 'Rendering';
    case 'failed':
      return row.error ? `Failed: ${row.error}` : 'Failed';
    default:
      return row.status;
  }
}

function formatSummaryLine(
  pkg: PackageDetailResponse,
  project: ProjectResponse | null,
): string {
  const left = [project?.name, `${pkg.submittal_number} ${pkg.revision}`]
    .filter(Boolean)
    .join(' / ');
  const right = pkg.title ?? '';
  return right ? `${left} — ${right}` : left;
}
