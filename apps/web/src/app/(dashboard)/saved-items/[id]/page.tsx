'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import type { SavedItemDetailResponse } from '@submittal/shared/api';

import { SavedAttributesEditor } from './_components/saved-attributes-editor';
import { SavedItemEditor } from './_components/saved-item-editor';
import { SavedVariantsEditor } from './_components/saved-variants-editor';

export default function SavedItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useQuery({
    queryKey: ['saved-item', id],
    queryFn: () => api.get<SavedItemDetailResponse>(`/api/v1/saved-items/${id}`),
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Button asChild variant="ghost" className="-ml-3 mb-2">
            <Link href="/saved-items">
              <ArrowLeft className="h-4 w-4" />
              Saved items
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {query.data?.saved_item.title ?? 'Saved item'}
          </h1>
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex h-48 items-center justify-center rounded-md border bg-card text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading
        </div>
      ) : query.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {query.error instanceof ApiError ? query.error.message : 'Could not load saved item.'}
        </div>
      ) : query.data ? (
        <div className="grid gap-4">
          <SavedItemEditor detail={query.data} />
          <SavedAttributesEditor detail={query.data} />
          <SavedVariantsEditor detail={query.data} />
        </div>
      ) : null}
    </div>
  );
}
