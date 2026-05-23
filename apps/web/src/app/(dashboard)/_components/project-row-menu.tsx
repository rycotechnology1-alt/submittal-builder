'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError, api } from '@/lib/api';

export function ProjectRowMenu({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.delete<void>(`/api/v1/projects/${projectId}`),
    onSuccess: () => {
      setOpen(false);
      toast.success('Project deleted');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.removeQueries({ queryKey: ['project', projectId] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete project');
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Project actions for ${projectName}`}
            className="h-8 w-8 shrink-0"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          >
            Delete project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDestructiveDialog
        open={open}
        title="Delete this project?"
        description={
          <>
            <span className="font-medium">&ldquo;{projectName}&rdquo;</span> and every package,
            uploaded PDF, and export inside it will be permanently removed. This action cannot be
            undone.
          </>
        }
        confirmLabel="Delete project"
        isPending={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onOpenChange={setOpen}
      />
    </>
  );
}
