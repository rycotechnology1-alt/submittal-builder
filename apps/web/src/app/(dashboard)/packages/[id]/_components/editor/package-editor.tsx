'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import type {
  PackageDetailResponse,
  PackageItemResponse,
  ProjectResponse,
} from '@submittal/shared/api';

import { AddItemButton } from './add-item-button';
import { CitationDrawer, type CitationTarget } from './citation-drawer';
import { CoverSheetDrawer } from './cover-sheet-drawer';
import { type DocType } from './doc-types';
import { ExportDialog } from './export-dialog';
import { ExportStatusBanner } from './export-status-banner';
import { applyReorder, countItemsNeedingReview } from './item-helpers';
import { ItemList } from './item-list';

type Attribute = PackageItemResponse['attributes'][number];
type ItemsQueryData = PackageItemResponse[];

const itemsKey = (packageId: string) => ['package-items', packageId] as const;

export function PackageEditor({
  pkg,
  project,
}: {
  pkg: PackageDetailResponse;
  project: ProjectResponse | null;
}) {
  const packageId = pkg.id;
  const queryClient = useQueryClient();
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [citationTarget, setCitationTarget] = useState<CitationTarget | null>(null);
  const [coverSheetOpen, setCoverSheetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const itemsQuery = useQuery({
    queryKey: itemsKey(packageId),
    queryFn: () =>
      api.get<PackageItemResponse[]>(`/api/v1/packages/${packageId}/items`),
  });

  const items = itemsQuery.data ?? [];
  const reviewCount = countItemsNeedingReview(items);

  const setItemsCache = useCallback(
    (updater: (prev: ItemsQueryData) => ItemsQueryData) => {
      queryClient.setQueryData<ItemsQueryData>(itemsKey(packageId), (prev) =>
        updater(prev ?? []),
      );
    },
    [packageId, queryClient],
  );

  function rollback(snapshot: ItemsQueryData) {
    queryClient.setQueryData(itemsKey(packageId), snapshot);
  }

  function notify(err: unknown, fallback: string) {
    toast.error(err instanceof ApiError ? err.message : fallback);
  }

  // --- mutations -----------------------------------------------------------

  const changeDocTypeMutation = useMutation({
    mutationFn: ({ itemId, docType }: { itemId: string; docType: DocType }) =>
      api.patch(`/api/v1/items/${itemId}`, { doc_type: docType }),
  });

  function changeDocType(itemId: string, next: DocType) {
    const snapshot = queryClient.getQueryData<ItemsQueryData>(itemsKey(packageId)) ?? [];
    setItemsCache((prev) =>
      prev.map((row) =>
        row.item.id === itemId
          ? {
              ...row,
              item: {
                ...row.item,
                doc_type: next,
                doc_type_original_ai_value:
                  row.item.doc_type_original_ai_value ?? row.item.doc_type,
              },
            }
          : row,
      ),
    );
    changeDocTypeMutation.mutate(
      { itemId, docType: next },
      {
        onError: (err) => {
          rollback(snapshot);
          notify(err, 'Could not change document type.');
        },
      },
    );
  }

  const changeTitleMutation = useMutation({
    mutationFn: ({ itemId, title }: { itemId: string; title: string }) =>
      api.patch(`/api/v1/items/${itemId}`, { title }),
  });

  function changeTitle(itemId: string, next: string) {
    const snapshot = queryClient.getQueryData<ItemsQueryData>(itemsKey(packageId)) ?? [];
    setItemsCache((prev) =>
      prev.map((row) =>
        row.item.id === itemId ? { ...row, item: { ...row.item, title: next } } : row,
      ),
    );
    changeTitleMutation.mutate(
      { itemId, title: next },
      {
        onError: (err) => {
          rollback(snapshot);
          notify(err, 'Could not update title.');
        },
      },
    );
  }

  const saveAttributeMutation = useMutation({
    mutationFn: ({
      itemId,
      key,
      value,
    }: {
      itemId: string;
      key: Attribute['key'];
      value: string | null;
    }) =>
      api.put<Attribute>(`/api/v1/items/${itemId}/attributes/${key}`, { value }),
  });

  function saveAttribute(itemId: string, key: Attribute['key'], value: string | null) {
    const snapshot = queryClient.getQueryData<ItemsQueryData>(itemsKey(packageId)) ?? [];
    const editedAt = new Date().toISOString();
    setItemsCache((prev) =>
      prev.map((row) => {
        if (row.item.id !== itemId) return row;
        const existing = row.attributes.find((a) => a.key === key);
        const nextAttr: Attribute = existing
          ? { ...existing, current_value: value, edited_by_user_at: editedAt }
          : {
              key,
              current_value: value,
              original_ai_value: null,
              confidence: null,
              source_page_id: null,
              edited_by_user_at: editedAt,
            };
        const others = row.attributes.filter((a) => a.key !== key);
        return { ...row, attributes: [...others, nextAttr] };
      }),
    );
    saveAttributeMutation.mutate(
      { itemId, key, value },
      {
        onSuccess: (updated) => {
          setItemsCache((prev) =>
            prev.map((row) =>
              row.item.id === itemId
                ? {
                    ...row,
                    attributes: [
                      ...row.attributes.filter((a) => a.key !== key),
                      updated,
                    ],
                  }
                : row,
            ),
          );
        },
        onError: (err) => {
          rollback(snapshot);
          notify(err, 'Could not save attribute.');
        },
      },
    );
  }

  const revertAttributeMutation = useMutation({
    mutationFn: ({ itemId, key }: { itemId: string; key: Attribute['key'] }) =>
      api.post<Attribute>(`/api/v1/items/${itemId}/attributes/${key}/revert`),
  });

  function revertAttribute(itemId: string, key: Attribute['key']) {
    const snapshot = queryClient.getQueryData<ItemsQueryData>(itemsKey(packageId)) ?? [];
    setItemsCache((prev) =>
      prev.map((row) =>
        row.item.id === itemId
          ? {
              ...row,
              attributes: row.attributes.map((a) =>
                a.key === key && a.original_ai_value != null
                  ? { ...a, current_value: a.original_ai_value, edited_by_user_at: null }
                  : a,
              ),
            }
          : row,
      ),
    );
    revertAttributeMutation.mutate(
      { itemId, key },
      {
        onSuccess: (updated) => {
          setItemsCache((prev) =>
            prev.map((row) =>
              row.item.id === itemId
                ? {
                    ...row,
                    attributes: [
                      ...row.attributes.filter((a) => a.key !== key),
                      updated,
                    ],
                  }
                : row,
            ),
          );
        },
        onError: (err) => {
          rollback(snapshot);
          notify(err, 'Could not revert attribute.');
        },
      },
    );
  }

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete(`/api/v1/items/${itemId}`),
  });

  async function deleteItem(itemId: string) {
    const snapshot = queryClient.getQueryData<ItemsQueryData>(itemsKey(packageId)) ?? [];
    setItemsCache((prev) => prev.filter((row) => row.item.id !== itemId));
    if (expandedItemId === itemId) setExpandedItemId(null);
    try {
      await deleteItemMutation.mutateAsync(itemId);
      toast.success('Item deleted');
      queryClient.invalidateQueries({ queryKey: ['package', packageId] });
    } catch (err) {
      rollback(snapshot);
      notify(err, 'Could not delete item.');
    }
  }

  const reorderMutation = useMutation({
    mutationFn: (order: { item_id: string; sort_order: number }[]) =>
      api.post(`/api/v1/packages/${packageId}/items/reorder`, { order }),
  });

  function reorderItems(fromId: string, toId: string) {
    const snapshot = queryClient.getQueryData<ItemsQueryData>(itemsKey(packageId)) ?? [];
    const ids = snapshot.map((row) => row.item.id);
    const nextIds = applyReorder(ids, fromId, toId);
    if (nextIds === ids) return;
    const byId = new Map(snapshot.map((row) => [row.item.id, row]));
    const reordered: ItemsQueryData = nextIds.map((id, idx) => {
      const row = byId.get(id)!;
      return { ...row, item: { ...row.item, sort_order: idx } };
    });
    queryClient.setQueryData(itemsKey(packageId), reordered);
    const payload = nextIds.map((id, idx) => ({ item_id: id, sort_order: idx }));
    reorderMutation.mutate(payload, {
      onError: (err) => {
        rollback(snapshot);
        notify(err, 'Could not save new order.');
      },
    });
  }

  // --- keyboard ------------------------------------------------------------

  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (citationTarget) return;
      const target = e.target as HTMLElement;
      const insideInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      if (insideInput) return;
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = focusedRowIndex === null ? 0 : Math.min(focusedRowIndex + 1, items.length - 1);
        focusRow(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = focusedRowIndex === null ? 0 : Math.max(focusedRowIndex - 1, 0);
        focusRow(next);
      }
    }
    function focusRow(index: number) {
      setFocusedRowIndex(index);
      const itemId = items[index]?.item.id;
      if (!itemId) return;
      const el = document.querySelector<HTMLElement>(`[data-item-id="${itemId}"]`);
      el?.focus();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [items, focusedRowIndex, citationTarget]);

  // --- render --------------------------------------------------------------

  if (itemsQuery.isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  if (itemsQuery.error) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {itemsQuery.error instanceof ApiError
            ? itemsQuery.error.message
            : 'Could not load items.'}
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <ExportStatusBanner pkg={pkg} />
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div className="text-sm">
            <span className="font-medium">
              {items.length} item{items.length === 1 ? '' : 's'}
            </span>
            {reviewCount > 0 ? (
              <span className="ml-2 text-amber-700 dark:text-amber-300">
                {reviewCount} need review
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AddItemButton packageId={packageId} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCoverSheetOpen(true)}
            >
              Cover sheet
            </Button>
            <Button
              size="sm"
              onClick={() => setExportOpen(true)}
              disabled={items.length === 0}
              title={items.length === 0 ? 'Add at least one item before exporting' : undefined}
            >
              Export package →
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState packageId={packageId} />
        ) : (
          <ItemList
            items={items}
            expandedItemId={expandedItemId}
            onToggleExpanded={(itemId) =>
              setExpandedItemId((prev) => (prev === itemId ? null : itemId))
            }
            onChangeDocType={changeDocType}
            onChangeTitle={changeTitle}
            onSaveAttribute={saveAttribute}
            onRevertAttribute={revertAttribute}
            onDelete={deleteItem}
            onReorder={reorderItems}
            onOpenCitation={setCitationTarget}
            onRowFocus={setFocusedRowIndex}
          />
        )}
      </main>

      <CitationDrawer target={citationTarget} onClose={() => setCitationTarget(null)} />
      <CoverSheetDrawer
        open={coverSheetOpen}
        onOpenChange={setCoverSheetOpen}
        pkg={pkg}
        project={project}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        pkg={pkg}
        project={project}
        items={items}
      />
    </>
  );
}

function EmptyState({ packageId }: { packageId: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card p-10 text-center">
      <h3 className="text-base font-medium">No items in this package</h3>
      <p className="text-sm text-muted-foreground">
        Add a PDF and we&apos;ll classify it and create the item automatically.
      </p>
      <AddItemButton packageId={packageId} variant="default" label="+ Add PDF" />
    </div>
  );
}
