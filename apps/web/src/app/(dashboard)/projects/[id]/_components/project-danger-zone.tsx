'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { ApiError, api } from '@/lib/api';

export function ProjectDangerZone({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.delete<void>(`/api/v1/projects/${projectId}`),
    onSuccess: () => {
      setOpen(false);
      toast.success('Project deleted');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.removeQueries({ queryKey: ['project', projectId] });
      router.push('/');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete project');
    },
  });

  return (
    <div className="mt-12 rounded-lg border border-destructive/30 bg-destructive/5 p-5">
      <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Permanently delete this project, every package inside it, and all uploaded and exported
        documents. This cannot be undone.
      </p>
      <div className="mt-4">
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete project
        </Button>
      </div>
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
    </div>
  );
}
