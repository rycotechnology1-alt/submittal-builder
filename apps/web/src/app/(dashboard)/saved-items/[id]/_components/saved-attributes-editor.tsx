'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import type { SavedItemAttribute, SavedItemDetailResponse } from '@submittal/shared/api';

import { docTypeLabel } from '../../_components/saved-items-helpers';

const ATTRIBUTE_KEYS = ['manufacturer', 'model_number', 'description', 'spec_section_ref'] as const;

export function SavedAttributesEditor({ detail }: { detail: SavedItemDetailResponse }) {
  const queryClient = useQueryClient();
  const disabled = detail.saved_item.processing_status !== 'extracted';
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        ATTRIBUTE_KEYS.map((key) => [
          key,
          detail.attributes.find((attribute) => attribute.key === key)?.current_value ?? '',
        ]),
      ) as Record<(typeof ATTRIBUTE_KEYS)[number], string>,
  );

  const mutation = useMutation({
    mutationFn: async (key: (typeof ATTRIBUTE_KEYS)[number]) =>
      api.put<{ attribute: SavedItemAttribute }>(
        `/api/v1/saved-items/${detail.saved_item.id}/attributes/${key}`,
        { value: values[key].trim() || null },
      ),
    onSuccess: () => {
      toast.success('Attribute saved');
      queryClient.invalidateQueries({ queryKey: ['saved-item', detail.saved_item.id] });
      queryClient.invalidateQueries({ queryKey: ['saved-items'] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not save attribute');
    },
  });

  return (
    <section className="rounded-md border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold">Attributes</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {ATTRIBUTE_KEYS.map((key) => (
          <div key={key} className="grid gap-1.5">
            <Label htmlFor={`saved-attr-${key}`}>{docTypeLabel(key)}</Label>
            <div className="flex gap-2">
              <Input
                id={`saved-attr-${key}`}
                value={values[key]}
                disabled={disabled}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={`Save ${docTypeLabel(key)}`}
                disabled={disabled || mutation.isPending}
                onClick={() => mutation.mutate(key)}
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
