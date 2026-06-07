'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import type { SavedItemDetailResponse, SavedItemVariant } from '@submittal/shared/api';

type Draft = {
  id?: string;
  part_number: string;
  size: string;
  display_label: string;
  sort_order: number;
  is_default_for_size: boolean;
};

function draftFromVariant(variant: SavedItemVariant): Draft {
  return {
    id: variant.id,
    part_number: variant.part_number,
    size: variant.size,
    display_label: variant.display_label,
    sort_order: variant.sort_order,
    is_default_for_size: variant.is_default_for_size,
  };
}

export function SavedVariantsEditor({ detail }: { detail: SavedItemDetailResponse }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => detail.variants.map(draftFromVariant));
  const queryClient = useQueryClient();
  const disabled = detail.saved_item.processing_status !== 'extracted';

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['saved-item', detail.saved_item.id] });
    queryClient.invalidateQueries({ queryKey: ['saved-items'] });
  };

  const saveMutation = useMutation({
    mutationFn: (draft: Draft) => {
      const body = {
        part_number: draft.part_number,
        size: draft.size,
        display_label: draft.display_label,
        sort_order: draft.sort_order,
        is_default_for_size: draft.is_default_for_size,
        secondary_dims: null,
      };
      return draft.id
        ? api.patch<{ variant: SavedItemVariant }>(
            `/api/v1/saved-items/${detail.saved_item.id}/variants/${draft.id}`,
            body,
          )
        : api.post<{ variant: SavedItemVariant }>(
            `/api/v1/saved-items/${detail.saved_item.id}/variants`,
            body,
          );
    },
    onSuccess: () => {
      toast.success('Variant saved');
      refresh();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not save variant');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (variantId: string) =>
      api.delete<void>(`/api/v1/saved-items/${detail.saved_item.id}/variants/${variantId}`),
    onSuccess: () => {
      toast.success('Variant deleted');
      refresh();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete variant');
    },
  });

  function updateDraft(index: number, patch: Partial<Draft>) {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  return (
    <section className="rounded-md border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Variants</h2>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            setDrafts((current) => [
              ...current,
              {
                part_number: '',
                size: '',
                display_label: '',
                sort_order: current.length,
                is_default_for_size: false,
              },
            ])
          }
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
      <div className="grid gap-3">
        {drafts.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No variants saved for this item.
          </p>
        ) : (
          drafts.map((draft, index) => (
            <div
              key={draft.id ?? `new-${index}`}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_1.4fr_90px_120px] md:items-end"
            >
              <Field label="Part number">
                <Input
                  value={draft.part_number}
                  disabled={disabled}
                  onChange={(event) => updateDraft(index, { part_number: event.target.value })}
                />
              </Field>
              <Field label="Size">
                <Input
                  value={draft.size}
                  disabled={disabled}
                  onChange={(event) => updateDraft(index, { size: event.target.value })}
                />
              </Field>
              <Field label="Label">
                <Input
                  value={draft.display_label}
                  disabled={disabled}
                  onChange={(event) => updateDraft(index, { display_label: event.target.value })}
                />
              </Field>
              <Field label="Order">
                <Input
                  type="number"
                  min={0}
                  value={draft.sort_order}
                  disabled={disabled}
                  onChange={(event) =>
                    updateDraft(index, { sort_order: Number(event.target.value) })
                  }
                />
              </Field>
              <div className="flex items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Save variant"
                  disabled={
                    disabled ||
                    saveMutation.isPending ||
                    !draft.part_number.trim() ||
                    !draft.size.trim() ||
                    !draft.display_label.trim()
                  }
                  onClick={() => saveMutation.mutate(draft)}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Delete variant"
                  disabled={disabled || deleteMutation.isPending}
                  onClick={() => {
                    if (draft.id) deleteMutation.mutate(draft.id);
                    else setDrafts((current) => current.filter((_, i) => i !== index));
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
