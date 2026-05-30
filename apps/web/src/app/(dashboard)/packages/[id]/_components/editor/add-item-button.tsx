'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { putFileWithProgress } from '@/lib/upload';
import type {
  SourcePdfPresignRequest,
  SourcePdfResponse,
} from '@submittal/shared/api';

import { MAX_PDF_BYTES, validateAddItemFile } from './add-item-helpers';

type PresignResponse = {
  source_pdf_id: string;
  upload_url: string;
  storage_key: string;
  expires_at: string;
  required_headers: Record<string, string>;
};

type Stage = 'idle' | 'presigning' | 'uploading' | 'confirming' | 'requesting-process';

const ACCEPT_ATTR = 'application/pdf,.pdf';

export function AddItemButton({
  packageId,
  variant = 'outline',
  size = 'sm',
  label = '+ Add item',
}: {
  packageId: string;
  variant?: 'outline' | 'default';
  size?: 'sm' | 'default';
  label?: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);

  const busy = stage !== 'idle';

  async function handleFile(file: File) {
    const rejection = validateAddItemFile(file);
    if (rejection) {
      toast.error(rejection.message);
      return;
    }

    try {
      setStage('presigning');
      setProgress(0);
      const presignBody: SourcePdfPresignRequest = {
        filename: file.name,
        byte_size: file.size,
        content_type: 'application/pdf',
      };
      const presigned = await api.post<PresignResponse>(
        `/api/v1/packages/${packageId}/source-pdfs/presign`,
        presignBody,
      );

      setStage('uploading');
      await putFileWithProgress({
        file,
        uploadUrl: presigned.upload_url,
        requiredHeaders: presigned.required_headers,
        onProgress: setProgress,
      });

      setStage('confirming');
      await api.post<SourcePdfResponse>(
        `/api/v1/packages/${packageId}/source-pdfs/${presigned.source_pdf_id}/confirm`,
        {},
      );

      setStage('requesting-process');
      await api.post<{ status: 'processing' }>(`/api/v1/packages/${packageId}/process`, {});

      queryClient.invalidateQueries({ queryKey: ['package', packageId] });
      queryClient.invalidateQueries({ queryKey: ['package-status', packageId] });
      router.push(`${pathname}?view=upload&after=sizes`);
      toast.success('Processing started. Your new item will appear when classification finishes.');
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : 'Could not add item.',
      );
    } finally {
      setStage('idle');
      setProgress(0);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : variant === 'default' ? (
          <Plus className="h-4 w-4" />
        ) : null}
        {busy ? stageLabel(stage, progress) : label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = '';
          if (file) void handleFile(file);
        }}
      />
    </>
  );
}

export const ADD_ITEM_HELP_TEXT = `PDF · up to ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB`;

function stageLabel(stage: Stage, progress: number): string {
  if (stage === 'presigning') return 'Preparing…';
  if (stage === 'uploading') return `Uploading ${progress}%`;
  if (stage === 'confirming') return 'Saving…';
  if (stage === 'requesting-process') return 'Processing…';
  return '';
}
