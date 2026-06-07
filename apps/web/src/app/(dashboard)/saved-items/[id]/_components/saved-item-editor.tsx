'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import type { SavedItemDetailResponse, SavedItemSummary } from '@submittal/shared/api';

import {
  docTypeLabel,
  formatBytes,
  savedItemStatusLabel,
} from '../../_components/saved-items-helpers';

const DOC_TYPES = [
  'product_data',
  'shop_drawing',
  'sds',
  'warranty',
  'installation',
  'test_report',
  'other',
] as const;

export function SavedItemEditor({ detail }: { detail: SavedItemDetailResponse }) {
  const [title, setTitle] = useState(detail.saved_item.title);
  const [docType, setDocType] = useState(detail.saved_item.doc_type);
  const queryClient = useQueryClient();
  const disabled = detail.saved_item.processing_status !== 'extracted';

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<{ saved_item: SavedItemSummary }>(`/api/v1/saved-items/${detail.saved_item.id}`, {
        title,
        doc_type: docType,
      }),
    onSuccess: () => {
      toast.success('Saved item updated');
      queryClient.invalidateQueries({ queryKey: ['saved-item', detail.saved_item.id] });
      queryClient.invalidateQueries({ queryKey: ['saved-items'] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not update saved item');
    },
  });

  return (
    <section className="grid gap-4 rounded-md border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="saved-title">Title</Label>
          <Input
            id="saved-title"
            value={title}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="saved-doc-type">Doc type</Label>
          <select
            id="saved-doc-type"
            value={docType}
            disabled={disabled}
            onChange={(event) => setDocType(event.target.value as typeof docType)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {docTypeLabel(type)}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={disabled || mutation.isPending || !title.trim()}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>
      <dl className="grid gap-3 border-t pt-4 text-sm md:grid-cols-4">
        <Meta label="File" value={detail.file.original_filename} />
        <Meta label="Pages" value={String(detail.file.page_count ?? '-')} />
        <Meta label="Size" value={formatBytes(detail.file.byte_size)} />
        <Meta label="Status" value={savedItemStatusLabel(detail.saved_item)} />
        <Meta label="SHA-256" value={detail.file.sha256} wide />
      </dl>
    </section>
  );
}

function Meta({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'min-w-0 md:col-span-4' : 'min-w-0'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
