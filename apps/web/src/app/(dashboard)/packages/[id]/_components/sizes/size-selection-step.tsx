'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import type { ItemVariantResponse, PackageItemResponse } from '@submittal/shared/api';

const itemsKey = (packageId: string) => ['package-items', packageId] as const;

type SourcePagePreviewResponse = {
  image_url: string;
  page_number: number;
};

/** Distinct sizes (in variant order) and the variants within each size. */
function sizeGroups(variants: ItemVariantResponse[]): { size: string; variants: ItemVariantResponse[] }[] {
  const groups: { size: string; variants: ItemVariantResponse[] }[] = [];
  for (const variant of variants) {
    const group = groups.find((g) => g.size === variant.size);
    if (group) group.variants.push(variant);
    else groups.push({ size: variant.size, variants: [variant] });
  }
  return groups;
}

function defaultVariantId(variants: ItemVariantResponse[]): string {
  return (variants.find((v) => v.is_default_for_size) ?? variants[0]!).id;
}

function attr(item: PackageItemResponse, key: string): string | null {
  return item.attributes.find((a) => a.key === key)?.current_value ?? null;
}

/**
 * A guided step that walks each multi-variant document, asking the user which
 * trade size(s) they are submitting. Only items with more than one variant and
 * no existing selection are shown; when none remain we hand off to the editor.
 */
export function SizeSelectionStep({ packageId }: { packageId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: itemsKey(packageId),
    queryFn: () => api.get<PackageItemResponse[]>(`/api/v1/packages/${packageId}/items`),
  });

  const goToEditor = () => router.replace(`${pathname}?view=assemble`);

  // Freeze the set of documents to walk on first load. Saving a selection
  // invalidates the items query (so the editor sees fresh data), but we must not
  // let the working list reshape underneath the wizard — that would shift the
  // index and skip items.
  const [queue, setQueue] = useState<PackageItemResponse[] | null>(null);
  useEffect(() => {
    if (queue !== null || !itemsQuery.isSuccess) return;
    const pending = (itemsQuery.data ?? []).filter(
      (item) => item.variants.length > 1 && item.selected_part_numbers.length === 0,
    );
    setQueue(pending);
    if (pending.length === 0) goToEditor();
  }, [itemsQuery.isSuccess, queue]);

  const [index, setIndex] = useState(0);
  const current = queue?.[index];

  if (itemsQuery.isLoading || queue === null) {
    return (
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-96 w-full rounded-lg" />
      </section>
    );
  }

  if (!current) {
    // Either redirecting (effect above) or no pending items.
    return null;
  }

  return (
    <SizeSelectionItem
      key={current.item.id}
      item={current}
      stepNumber={index + 1}
      stepCount={queue.length}
      onBack={index > 0 ? () => setIndex((i) => i - 1) : undefined}
      onResolved={() => {
        queryClient.invalidateQueries({ queryKey: itemsKey(packageId) });
        if (index + 1 < queue.length) setIndex((i) => i + 1);
        else router.push(`${pathname}?view=assemble`);
      }}
      onSkipAll={goToEditor}
    />
  );
}

function SizeSelectionItem({
  item,
  stepNumber,
  stepCount,
  onBack,
  onResolved,
  onSkipAll,
}: {
  item: PackageItemResponse;
  stepNumber: number;
  stepCount: number;
  onBack?: () => void;
  onResolved: () => void;
  onSkipAll: () => void;
}) {
  const groups = useMemo(() => sizeGroups(item.variants), [item.variants]);

  const [chosen, setChosen] = useState<Set<string>>(new Set());
  // size → selected variant id (defaults to the smart-default variant).
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Preview the page the part-number table sits on (first variant with a page).
  const sourcePageId =
    item.variants.find((v) => v.source_page_id !== null)?.source_page_id ?? null;

  const preview = useQuery({
    queryKey: ['source-page-preview', sourcePageId],
    queryFn: () =>
      api.get<SourcePagePreviewResponse>(`/api/v1/source-pages/${sourcePageId}/preview`),
    enabled: sourcePageId !== null,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (variantIds: string[]) =>
      api.put(`/api/v1/items/${item.item.id}/variant-selection`, { variant_ids: variantIds }),
    onSuccess: () => onResolved(),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save size selection'),
  });

  const toggleSize = (size: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(size)) next.delete(size);
      else next.add(size);
      return next;
    });
  };

  const selectAll = () => setChosen(new Set(groups.map((g) => g.size)));

  const variantIdForSize = (group: { size: string; variants: ItemVariantResponse[] }) =>
    overrides[group.size] ?? defaultVariantId(group.variants);

  const submit = () => {
    const ids = groups
      .filter((g) => chosen.has(g.size))
      .map((g) => variantIdForSize(g));
    save.mutate(ids);
  };

  const manufacturer = attr(item, 'manufacturer');
  const description = attr(item, 'description');

  return (
    <section className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          Select size · {stepNumber} of {stepCount}
        </p>
        <Button variant="ghost" size="sm" onClick={onSkipAll}>
          Skip all
        </Button>
      </div>

      <h1 className="mt-2 text-xl font-semibold tracking-tight">{item.item.title}</h1>
      {manufacturer ? <p className="text-sm text-muted-foreground">{manufacturer}</p> : null}

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1.2fr]">
        {/* Source page preview for context. */}
        <div className="rounded-md border bg-muted/30 p-2">
          {preview.isLoading && sourcePageId ? (
            <Skeleton className="aspect-[8.5/11] w-full" />
          ) : preview.data ? (
            <img
              src={preview.data.image_url}
              alt={`Page ${preview.data.page_number} of ${item.item.title}`}
              className="mx-auto block max-h-[60vh] w-auto rounded shadow-sm"
            />
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {description ?? 'No page preview available.'}
            </div>
          )}
        </div>

        {/* Size picker. */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Which size(s) are you submitting?</h2>
            <Button variant="ghost" size="sm" onClick={selectAll}>
              Select all
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick the trade size — we’ll match it to the exact part number on the sheet.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {groups.map((group) => {
              const active = chosen.has(group.size);
              return (
                <button
                  key={group.size}
                  type="button"
                  onClick={() => toggleSize(group.size)}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-card hover:bg-accent',
                  ].join(' ')}
                >
                  {active ? <Check className="h-3.5 w-3.5" /> : null}
                  {group.size}
                </button>
              );
            })}
          </div>

          {/* Secondary-dimension overrides for chosen sizes that have options. */}
          {groups
            .filter((g) => chosen.has(g.size) && g.variants.length > 1)
            .map((group) => (
              <label key={group.size} className="mt-4 block text-sm">
                <span className="text-muted-foreground">{group.size} option</span>
                <select
                  className="mt-1 block w-full rounded-md border bg-card px-2 py-1.5 text-sm"
                  value={variantIdForSize(group)}
                  onChange={(e) =>
                    setOverrides((current) => ({ ...current, [group.size]: e.target.value }))
                  }
                >
                  {group.variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.display_label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between border-t pt-4">
        <div>
          {onBack ? (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onResolved()} disabled={save.isPending}>
            Skip
          </Button>
          <Button size="sm" onClick={submit} disabled={chosen.size === 0 || save.isPending}>
            {stepNumber < stepCount ? 'Next' : 'Finish'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
