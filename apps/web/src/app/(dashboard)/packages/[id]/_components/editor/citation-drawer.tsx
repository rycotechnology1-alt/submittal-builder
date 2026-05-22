'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';

type SourcePagePreviewResponse = {
  image_url: string;
  ocr_text: string | null;
  page_number: number;
  source_pdf_id: string;
};

type DownloadResponse = { url: string };

export type CitationTarget = {
  sourcePageId: string;
  sourcePdfFilename: string;
  pageCount: number | null;
};

export function CitationDrawer({
  target,
  onClose,
}: {
  target: CitationTarget | null;
  onClose: () => void;
}) {
  const open = target !== null;
  const [downloading, setDownloading] = useState(false);

  const preview = useQuery({
    queryKey: ['source-page-preview', target?.sourcePageId],
    queryFn: () =>
      api.get<SourcePagePreviewResponse>(
        `/api/v1/source-pages/${target!.sourcePageId}/preview`,
      ),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) setDownloading(false);
  }, [open]);

  async function openFullPdf() {
    if (!target || !preview.data) return;
    setDownloading(true);
    try {
      const res = await api.get<DownloadResponse>(
        `/api/v1/source-pdfs/${preview.data.source_pdf_id}/download`,
      );
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not open the source PDF.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent>
        {target ? (
          <>
            <SheetHeader>
              <SheetTitle className="truncate">{target.sourcePdfFilename}</SheetTitle>
              <SheetDescription>
                {preview.data
                  ? `Page ${preview.data.page_number}${target.pageCount ? ` of ${target.pageCount}` : ''}`
                  : 'Loading citation…'}
              </SheetDescription>
            </SheetHeader>

            <div className="-mx-6 flex-1 overflow-y-auto px-6">
              <div className="rounded-md border bg-muted/30 p-2">
                {preview.isLoading ? (
                  <Skeleton className="aspect-[8.5/11] w-full" />
                ) : preview.error ? (
                  <div className="rounded border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {preview.error instanceof ApiError
                      ? preview.error.message
                      : 'Could not load page preview.'}
                  </div>
                ) : preview.data ? (
                  <img
                    src={preview.data.image_url}
                    alt={`Page ${preview.data.page_number} of ${target.sourcePdfFilename}`}
                    className="mx-auto block max-h-[60vh] w-auto rounded shadow-sm"
                  />
                ) : null}
              </div>

              {preview.data?.ocr_text ? (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    OCR text
                  </h3>
                  <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                    {preview.data.ocr_text}
                  </pre>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openFullPdf}
                disabled={downloading || !preview.data}
              >
                <ExternalLink className="h-4 w-4" />
                Open full PDF
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
