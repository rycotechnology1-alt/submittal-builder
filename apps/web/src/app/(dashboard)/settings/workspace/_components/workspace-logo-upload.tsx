'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { putFileWithProgress } from '@/lib/upload';
import type {
  LogoPresignRequest,
  LogoPresignResponse,
  WorkspaceResponse,
} from '@submittal/shared/api';

import {
  ALLOWED_LOGO_CONTENT_TYPES,
  MAX_LOGO_BYTES,
  isValidLogoContentType,
  isWithinLogoSizeLimit,
  type LogoContentType,
} from './workspace-settings-helpers';

type UploadStage = 'idle' | 'presigning' | 'uploading' | 'confirming';

const ACCEPT_ATTR = ALLOWED_LOGO_CONTENT_TYPES.join(',');

export function WorkspaceLogoUpload({ workspace }: { workspace: WorkspaceResponse }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [progress, setProgress] = useState(0);

  const busy = stage !== 'idle';

  async function handleFile(file: File) {
    if (!isValidLogoContentType(file.type)) {
      toast.error('Logo must be a PNG, JPEG, WebP, or SVG image.');
      return;
    }
    if (!isWithinLogoSizeLimit(file.size)) {
      const cap = Math.round(MAX_LOGO_BYTES / (1024 * 1024));
      toast.error(`Logo must be ${cap} MB or smaller.`);
      return;
    }

    try {
      setStage('presigning');
      setProgress(0);
      const presignBody: LogoPresignRequest = {
        filename: file.name,
        byte_size: file.size,
        content_type: file.type as LogoContentType,
      };
      const presigned = await api.post<LogoPresignResponse>(
        '/api/v1/workspace/logo/presign',
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
      const confirmed = await api.post<WorkspaceResponse>('/api/v1/workspace/logo/confirm', {
        storage_key: presigned.storage_key,
      });

      queryClient.setQueryData<WorkspaceResponse>(['workspace'], confirmed);
      toast.success('Logo updated.');
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : 'Could not upload logo.',
      );
    } finally {
      setStage('idle');
      setProgress(0);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <LogoPreview url={workspace.sub_company_logo_url} />
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            {busy ? stageLabel(stage, progress) : workspace.sub_company_logo_url ? 'Replace logo' : 'Upload logo'}
          </Button>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, WebP, or SVG · up to {Math.round(MAX_LOGO_BYTES / (1024 * 1024))} MB
          </p>
        </div>
      </div>
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
    </div>
  );
}

function stageLabel(stage: UploadStage, progress: number): string {
  if (stage === 'presigning') return 'Preparing…';
  if (stage === 'uploading') return `Uploading ${progress}%`;
  if (stage === 'confirming') return 'Saving…';
  return '';
}

function LogoPreview({ url }: { url: string | null }) {
  if (url) {
    return (
      <img
        src={url}
        alt="Workspace sub-company logo"
        className="h-20 w-32 rounded border bg-background object-contain p-2"
      />
    );
  }
  return (
    <div className="flex h-20 w-32 items-center justify-center rounded border border-dashed bg-muted/30 text-xs text-muted-foreground">
      No logo
    </div>
  );
}
