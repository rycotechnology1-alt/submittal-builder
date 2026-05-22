'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function PdfPreview({ url }: { url: string | null }) {
  if (!url) {
    return <PreviewSkeleton message="Generating preview…" />;
  }

  return (
    <iframe
      title="Exported package preview"
      src={url}
      className="h-[680px] w-full max-w-[540px] rounded bg-white"
    />
  );
}

function PreviewSkeleton({ message }: { message: string }) {
  return (
    <div className="flex h-[680px] w-full max-w-[540px] flex-col items-center justify-center gap-3">
      <Skeleton className="h-full w-full" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
