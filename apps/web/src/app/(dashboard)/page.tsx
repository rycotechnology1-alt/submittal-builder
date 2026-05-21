'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import type { ProjectResponse } from '@submittal/shared/api';

import { NewProjectDialog } from './_components/new-project-dialog';

type ProjectListResponse = { data: ProjectResponse[]; next_cursor: string | null };

export default function DashboardPage() {
  const [query, setQuery] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectListResponse>('/api/v1/projects'),
  });

  const filtered = useMemo(() => {
    const projects = data?.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.project_number ?? '').toLowerCase().includes(q) ||
        (p.gc_name ?? '').toLowerCase().includes(q) ||
        (p.architect_name ?? '').toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Pick a project to start a submittal package.
          </p>
        </div>
        <NewProjectDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4" />
              New project
            </Button>
          }
        />
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
      </div>

      {error ? (
        <ErrorState message={error instanceof ApiError ? error.message : 'Could not load projects.'} />
      ) : isLoading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        (data?.data.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            No projects match &ldquo;{query}&rdquo;.
          </p>
        )
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {filtered.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-accent/40"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-3">
                    <p className="truncate font-medium">{project.name}</p>
                    {project.project_number && (
                      <span className="text-xs text-muted-foreground">
                        Project #{project.project_number}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {[
                      project.gc_name && `GC: ${project.gc_name}`,
                      project.architect_name && `Architect: ${project.architect_name}`,
                    ]
                      .filter(Boolean)
                      .join('   ·   ') || 'No GC or architect set'}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed bg-card p-10 text-center">
      <h3 className="text-base font-medium">No projects yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Create your first project to start assembling submittals.
      </p>
      <div className="mt-6 flex justify-center">
        <NewProjectDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4" />
              New project
            </Button>
          }
        />
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {message}
    </div>
  );
}
