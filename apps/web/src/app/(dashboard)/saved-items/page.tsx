'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import type { SavedItemsListResponse } from '@submittal/shared/api';

import { SavedItemsList } from './_components/saved-items-list';
import { SavedItemsUpload } from './_components/saved-items-upload';

export default function SavedItemsPage() {
  const [query, setQuery] = useState('');
  const savedItemsQuery = useQuery({
    queryKey: ['saved-items', query],
    queryFn: () =>
      api.get<SavedItemsListResponse>(
        `/api/v1/saved-items${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
      ),
  });

  const error = savedItemsQuery.error;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Saved items</h1>
          <p className="text-sm text-muted-foreground">Workspace common submittal sheets.</p>
        </div>
      </div>

      <div className="mb-4 grid gap-3">
        <SavedItemsUpload />
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved items"
            className="pl-9"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Could not load saved items.'}
        </div>
      ) : (
        <SavedItemsList
          items={savedItemsQuery.data?.data ?? []}
          isLoading={savedItemsQuery.isLoading}
          emptyLabel={query.trim() ? `No saved items match "${query}".` : 'No saved items yet.'}
        />
      )}
    </div>
  );
}
