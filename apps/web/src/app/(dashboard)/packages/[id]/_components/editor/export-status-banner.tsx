'use client';

import { useMutation } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import type {
  ExportDownloadResponse,
  PackageDetailResponse,
} from '@submittal/shared/api';

import { formatBytes, formatRelativeTime } from './export-helpers';

export function ExportStatusBanner({ pkg }: { pkg: PackageDetailResponse }) {
  const downloadMutation = useMutation({
    mutationFn: (exportId: string) =>
      api.get<ExportDownloadResponse>(
        `/api/v1/exports/${exportId}/download?disposition=attachment`,
      ),
    onSuccess: (data) => {
      triggerBrowserDownload(data.url);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Could not generate download link.');
    },
  });

  const latest = pkg.latest_export;
  if (!latest || latest.status !== 'ready') return null;

  const isExported = pkg.status === 'exported';

  return (
    <div
      className={
        'mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ' +
        (isExported
          ? 'border-border bg-muted/30'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200')
      }
    >
      <div className="min-w-0">
        <p className="font-medium">
          {isExported ? 'Latest export ready' : 'Edited since last export'}
        </p>
        <p className="text-xs text-muted-foreground">
          {latest.page_count != null ? `${latest.page_count} pages · ` : ''}
          {formatBytes(latest.byte_size)} · rendered {formatRelativeTime(latest.created_at)}
          {isExported ? '' : ' · re-export to publish your edits'}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => downloadMutation.mutate(latest.id)}
        disabled={downloadMutation.isPending}
      >
        {downloadMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        Download {isExported ? 'export' : 'last export'}
      </Button>
    </div>
  );
}

function triggerBrowserDownload(url: string): void {
  if (typeof window === 'undefined') return;
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.setAttribute('download', '');
  document.body.appendChild(link);
  link.click();
  link.remove();
}
