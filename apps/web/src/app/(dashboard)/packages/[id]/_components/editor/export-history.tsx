'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type { ExportDownloadResponse, ExportResponse } from '@submittal/shared/api';

import { formatBytes, formatRelativeTime } from './export-helpers';

export function ExportHistory({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);

  const exportsQuery = useQuery({
    queryKey: ['package-exports', packageId],
    queryFn: () => api.get<ExportResponse[]>(`/api/v1/packages/${packageId}/exports`),
  });

  const downloadMutation = useMutation({
    mutationFn: (exportId: string) =>
      api.get<ExportDownloadResponse>(
        `/api/v1/exports/${exportId}/download?disposition=attachment`,
      ),
    onSuccess: (data) => triggerBrowserDownload(data.url),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not generate download link.'),
  });

  const ready = (exportsQuery.data ?? []).filter((e) => e.status === 'ready');
  // The newest export is already shown in the banner; list the rest here.
  const previous = ready.slice(1);
  if (previous.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium"
        aria-expanded={open}
      >
        <span>Previous exports ({previous.length})</span>
        <ChevronDown
          className={'h-4 w-4 transition-transform ' + (open ? 'rotate-180' : '')}
        />
      </button>
      {open ? (
        <ul className="divide-y border-t">
          {previous.map((exp) => (
            <li key={exp.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{exp.revision ?? '—'}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {exp.page_count != null ? `${exp.page_count} pages · ` : ''}
                  {formatBytes(exp.byte_size)} · {formatRelativeTime(exp.created_at)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => downloadMutation.mutate(exp.id)}
                disabled={downloadMutation.isPending}
                className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs font-medium hover:bg-muted"
              >
                {downloadMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Download
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
