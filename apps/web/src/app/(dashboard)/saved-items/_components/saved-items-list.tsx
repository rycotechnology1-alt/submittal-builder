'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Edit, FileText, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import type { SavedItemSummary } from '@submittal/shared/api';

import { DeleteSavedItemDialog } from './delete-saved-item-dialog';
import {
  docTypeLabel,
  savedItemAttributeValue,
  savedItemMetaLine,
  savedItemStatusLabel,
} from './saved-items-helpers';

export function SavedItemsList({
  items,
  isLoading,
  emptyLabel,
}: {
  items: SavedItemSummary[];
  isLoading: boolean;
  emptyLabel: string;
}) {
  const [deleteTarget, setDeleteTarget] = useState<SavedItemSummary | null>(null);
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/saved-items/${id}`),
    onSuccess: () => {
      toast.success('Saved item deleted');
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['saved-items'] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete saved item');
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border bg-card text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed bg-card text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border bg-card">
        <table className="w-full table-fixed text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-[36%] px-4 py-3 font-medium">Item</th>
              <th className="w-[18%] px-4 py-3 font-medium">Manufacturer</th>
              <th className="w-[14%] px-4 py-3 font-medium">Type</th>
              <th className="w-[12%] px-4 py-3 font-medium">Status</th>
              <th className="w-[10%] px-4 py-3 font-medium">Sizes</th>
              <th className="w-[10%] px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => {
              const status = savedItemStatusLabel(item);
              const error = item.processing_status === 'error';
              return (
                <tr key={item.id} className="hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <Link
                          href={`/saved-items/${item.id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {savedItemMetaLine(item) || item.original_filename}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="truncate px-4 py-3">
                    {savedItemAttributeValue(item, 'manufacturer') ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{docTypeLabel(item.doc_type)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={error ? 'inline-flex items-center gap-1 text-destructive' : ''}
                    >
                      {error ? <AlertCircle className="h-3.5 w-3.5" /> : null}
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{item.variant_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon" title="Edit saved item">
                        <Link href={`/saved-items/${item.id}`}>
                          <Edit className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Delete saved item"
                        onClick={() => setDeleteTarget(item)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DeleteSavedItemDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? ''}
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </>
  );
}
