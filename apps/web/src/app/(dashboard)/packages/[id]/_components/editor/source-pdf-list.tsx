'use client';

import { ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import type { PackageItemResponse } from '@submittal/shared/api';

type SourcePdf = PackageItemResponse['source_pdfs'][number];

export function SourcePdfList({ sourcePdfs }: { sourcePdfs: SourcePdf[] }) {
  if (sourcePdfs.length === 0) {
    return <p className="text-xs text-muted-foreground">No source PDFs linked.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {sourcePdfs.map((pdf) => (
        <SourcePdfRow key={pdf.id} pdf={pdf} />
      ))}
    </ul>
  );
}

function SourcePdfRow({ pdf }: { pdf: SourcePdf }) {
  const [opening, setOpening] = useState(false);

  async function openPdf() {
    setOpening(true);
    try {
      const res = await api.get<{ url: string }>(`/api/v1/source-pdfs/${pdf.id}/download`);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not open the source PDF.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{pdf.original_filename}</span>
        {pdf.page_count !== null ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {pdf.page_count} pp
          </span>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={openPdf}
        disabled={opening}
        className="h-8 gap-1 text-xs"
      >
        <ExternalLink className="h-3 w-3" />
        Open
      </Button>
    </li>
  );
}
