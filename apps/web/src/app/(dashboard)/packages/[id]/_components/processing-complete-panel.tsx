'use client';

import { ArrowRight, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { PackageDetailResponse } from '@submittal/shared/api';

export function ProcessingCompletePanel({
  pkg,
  onContinue,
}: {
  pkg: PackageDetailResponse;
  onContinue: () => void;
}) {
  const pdfLabel = pkg.source_pdf_count === 1 ? 'PDF' : 'PDFs';
  const itemLabel = pkg.item_count === 1 ? 'item' : 'items';

  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto flex max-w-md flex-col items-center rounded-lg border bg-card p-10 text-center">
        <div className="rounded-full bg-emerald-100 p-3 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-xl font-semibold tracking-tight">Processing complete</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {pkg.source_pdf_count} {pdfLabel} · {pkg.item_count} {itemLabel} ready to review.
        </p>
        <Button className="mt-6" onClick={onContinue}>
          Continue to package
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
