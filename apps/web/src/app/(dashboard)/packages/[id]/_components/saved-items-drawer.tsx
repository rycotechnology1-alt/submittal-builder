'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Library, Loader2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ApiError, api } from '@/lib/api';
import type {
  ImportSavedItemsResponse,
  SavedItemsListResponse,
  SavedItemSummary,
} from '@submittal/shared/api';

function attr(item: SavedItemSummary, key: string): string | null {
  return item.attributes.find((attribute) => attribute.key === key)?.current_value ?? null;
}

function summaryLine(item: SavedItemSummary): string {
  return [attr(item, 'manufacturer'), attr(item, 'model_number'), item.original_filename]
    .filter(Boolean)
    .join(' · ');
}

export function SavedItemsDrawer({
  packageId,
  open,
  onOpenChange,
}: {
  packageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const savedItemsQuery = useQuery({
    queryKey: ['saved-items', query],
    queryFn: () =>
      api.get<SavedItemsListResponse>(
        `/api/v1/saved-items${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
      ),
    enabled: open,
  });

  const items = savedItemsQuery.data?.data ?? [];
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  );

  const importMutation = useMutation({
    mutationFn: () =>
      api.post<ImportSavedItemsResponse>(`/api/v1/packages/${packageId}/saved-items`, {
        saved_item_ids: [...selected],
      }),
    onSuccess: () => {
      toast.success('Saved item added');
      queryClient.invalidateQueries({ queryKey: ['package', packageId] });
      queryClient.invalidateQueries({ queryKey: ['package-items', packageId] });
      queryClient.invalidateQueries({ queryKey: ['package-status', packageId] });
      setSelected(new Set());
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not add saved item');
    },
  });

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-2xl">
        <SheetHeader>
          <SheetTitle>Saved items</SheetTitle>
          <SheetDescription>Workspace common submittal sheets.</SheetDescription>
        </SheetHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved items"
            className="pl-9"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {savedItemsQuery.isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Library className="h-5 w-5" />
              <span>No saved items</span>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const active = selected.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => toggle(item.id)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border">
                        {active ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {summaryLine(item)}
                        </span>
                        {item.variant_count > 0 ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {item.variant_count} size option{item.variant_count === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <span className="text-sm text-muted-foreground">{selectedItems.length} selected</span>
          <Button
            type="button"
            disabled={selected.size === 0 || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add to package
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
