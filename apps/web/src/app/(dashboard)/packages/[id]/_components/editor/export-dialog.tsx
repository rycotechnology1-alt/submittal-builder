'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ApiError, api } from '@/lib/api';
import type {
  CreateExportRequest,
  CreateExportResponse,
  ExportResponse,
  PackageDetailResponse,
  PackageItemResponse,
  ProjectResponse,
} from '@submittal/shared/api';

import {
  computeExportBlockers,
  defaultBatesPrefix,
  summarizeExport,
  validateBatesPrefix,
  type ExportWarning,
} from './export-helpers';

type DialogPhase = 'confirm' | 'rendering' | 'error';

export function ExportDialog({
  open,
  onOpenChange,
  pkg,
  project,
  items,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  pkg: PackageDetailResponse;
  project: ProjectResponse | null;
  items: PackageItemResponse[];
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<DialogPhase>('confirm');
  const [exportId, setExportId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [batesPrefix, setBatesPrefix] = useState(() => defaultBatesPrefix(pkg));
  const [batesError, setBatesError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('confirm');
      setExportId(null);
      setErrorMessage(null);
      setBatesPrefix(defaultBatesPrefix(pkg));
      setBatesError(null);
    }
  }, [open, pkg]);

  const { hardBlockers, warnings } = useMemo(() => computeExportBlockers(items), [items]);
  const summary = useMemo(() => summarizeExport(items), [items]);

  const exportQuery = useQuery({
    queryKey: ['export', exportId],
    queryFn: () => api.get<ExportResponse>(`/api/v1/exports/${exportId}`),
    enabled: phase === 'rendering' && exportId != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'ready' || status === 'failed') return false;
      return 2000;
    },
  });

  useEffect(() => {
    const data = exportQuery.data;
    if (!data || phase !== 'rendering') return;
    if (data.status === 'ready') {
      queryClient.invalidateQueries({ queryKey: ['package', pkg.id] });
      queryClient.invalidateQueries({ queryKey: ['package-exports', pkg.id] });
      toast.success('Package exported');
      onOpenChange(false);
    } else if (data.status === 'failed') {
      setPhase('error');
      setErrorMessage(data.error ?? 'Rendering failed. Try again.');
    }
  }, [exportQuery.data, phase, queryClient, pkg.id, onOpenChange]);

  const createMutation = useMutation({
    mutationFn: (body: CreateExportRequest) =>
      api.post<CreateExportResponse>(`/api/v1/packages/${pkg.id}/exports`, body),
    onSuccess: (data) => {
      setExportId(data.export_id);
      setPhase('rendering');
    },
    onError: (err) => {
      setPhase('error');
      setErrorMessage(err instanceof ApiError ? err.message : 'Could not start export.');
    },
  });

  function startRender() {
    const validation = validateBatesPrefix(batesPrefix);
    if (!validation.ok) {
      setBatesError(validation.message);
      return;
    }
    setBatesError(null);
    const body: CreateExportRequest = validation.value
      ? { bates_prefix: validation.value }
      : {};
    createMutation.mutate(body);
  }

  function jumpToItem(itemId: string) {
    onOpenChange(false);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-item-id="${itemId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    }, 80);
  }

  const renderProgress = computeRenderProgress(exportQuery.data?.status);
  const summaryLine = formatSummaryLine(pkg, project);
  const canRender = hardBlockers.length === 0 && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {phase === 'confirm' ? (
          <>
            <DialogHeader>
              <DialogTitle>Export package</DialogTitle>
              <DialogDescription>{summaryLine}</DialogDescription>
            </DialogHeader>

            <section className="space-y-2 text-sm">
              <p className="font-medium">This package will include:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Cover sheet (1 page)</li>
                <li>Table of contents with page citations</li>
                <li>
                  {summary.itemCount} item{summary.itemCount === 1 ? '' : 's'},{' '}
                  {summary.sourcePageCount} source page
                  {summary.sourcePageCount === 1 ? '' : 's'}
                </li>
                <li>Bates-style numbering on every page</li>
                <li>PDF bookmarks per item</li>
              </ul>
            </section>

            <section className="space-y-1">
              <label htmlFor="bates-prefix" className="text-sm font-medium">
                Bates prefix <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="bates-prefix"
                value={batesPrefix}
                onChange={(e) => {
                  setBatesPrefix(e.target.value);
                  if (batesError) setBatesError(null);
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                maxLength={20}
                aria-invalid={batesError ? true : undefined}
                aria-describedby={batesError ? 'bates-prefix-error' : undefined}
              />
              {batesError ? (
                <p id="bates-prefix-error" className="text-xs text-destructive">
                  {batesError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Up to 16 characters. Letters, numbers, . _ - only.
                </p>
              )}
            </section>

            {hardBlockers.length > 0 ? (
              <section className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <p className="font-medium">Cannot export yet:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {hardBlockers.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {warnings.length > 0 ? (
              <section className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <p className="inline-flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" /> Heads up:
                </p>
                <ul className="space-y-1">
                  {warnings.map((warning) => (
                    <WarningRow
                      key={warning.kind}
                      warning={warning}
                      onView={() => jumpToItem(warning.firstItemId)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={startRender} disabled={!canRender}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Starting…
                  </>
                ) : (
                  'Render package →'
                )}
              </Button>
            </DialogFooter>
          </>
        ) : phase === 'rendering' ? (
          <>
            <DialogHeader>
              <DialogTitle>Rendering package…</DialogTitle>
              <DialogDescription>
                Assembling {summary.sourcePageCount} source page
                {summary.sourcePageCount === 1 ? '' : 's'} with cover, TOC, bookmarks, and Bates numbering.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Progress value={renderProgress} />
              <p className="text-sm text-muted-foreground">
                This usually takes 10–30 seconds. You can leave this screen and come back — we&apos;ll save the export.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Run in background
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Export failed</DialogTitle>
              <DialogDescription>{errorMessage ?? 'Something went wrong.'}</DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={() => setPhase('confirm')}>Try again</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WarningRow({
  warning,
  onView,
}: {
  warning: ExportWarning;
  onView: () => void;
}) {
  const label =
    warning.kind === 'low_confidence'
      ? `${warning.itemCount} item${warning.itemCount === 1 ? '' : 's'} ${
          warning.itemCount === 1 ? 'has' : 'have'
        } low-confidence fields you haven't reviewed.`
      : `${warning.itemCount} item${warning.itemCount === 1 ? '' : 's'} ${
          warning.itemCount === 1 ? 'is' : 'are'
        } missing common attributes (manufacturer, model #, description).`;
  return (
    <li className="flex items-start justify-between gap-3 text-amber-800 dark:text-amber-200">
      <span>{label}</span>
      <button
        type="button"
        onClick={onView}
        className="shrink-0 rounded border border-amber-500/40 px-2 py-0.5 text-xs font-medium hover:bg-amber-500/10"
      >
        View
      </button>
    </li>
  );
}

function computeRenderProgress(status: ExportResponse['status'] | undefined): number {
  switch (status) {
    case 'pending':
      return 15;
    case 'rendering':
      return 60;
    case 'ready':
      return 100;
    case 'failed':
      return 0;
    default:
      return 5;
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
