'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import type { SavedItemUploadConfirmResponse } from '@submittal/shared/api';

type PresignResponse = {
  upload_url: string;
  storage_key: string;
  required_headers: Record<string, string>;
};

async function uploadFile(file: File) {
  const presign = await api.post<PresignResponse>('/api/v1/saved-items/uploads/presign', {
    filename: file.name,
    byte_size: file.size,
    content_type: file.type || 'application/pdf',
  });

  const put = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: presign.required_headers,
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);

  return api.post<SavedItemUploadConfirmResponse>('/api/v1/saved-items/uploads/confirm', {
    storage_key: presign.storage_key,
    original_filename: file.name,
  });
}

export function SavedItemsUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (files: File[]) => Promise.all(files.map(uploadFile)),
    onSuccess: (results) => {
      const duplicates = results.filter((result) => result.duplicate);
      if (duplicates.length > 0) {
        toast.info(
          `${duplicates.length} duplicate PDF${duplicates.length === 1 ? '' : 's'} already saved`,
        );
      } else {
        toast.success(`${results.length} PDF${results.length === 1 ? '' : 's'} uploaded`);
      }
      queryClient.invalidateQueries({ queryKey: ['saved-items'] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Upload failed',
      );
    },
  });

  function pickFiles(files: FileList | null) {
    const pdfs = Array.from(files ?? []).filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    if (pdfs.length > 0) mutation.mutate(pdfs);
  }

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-md border border-dashed bg-card px-4 py-3"
      onDrop={(event) => {
        event.preventDefault();
        pickFiles(event.dataTransfer.files);
      }}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">Upload saved PDFs</p>
        <p className="truncate text-xs text-muted-foreground">
          Drop PDF cut sheets here or choose files from your computer.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(event) => pickFiles(event.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        Upload
      </Button>
    </div>
  );
}
