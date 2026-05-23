'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { ApiError, api } from '@/lib/api';

export function PackageDangerZone({
  packageId,
  packageLabel,
  projectId,
}: {
  packageId: string;
  packageLabel: string;
  projectId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.delete<void>(`/api/v1/packages/${packageId}`),
    onSuccess: () => {
      setOpen(false);
      toast.success('Package deleted');
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.removeQueries({ queryKey: ['package', packageId] });
      router.push(`/projects/${projectId}`);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete package');
    },
  });

  return (
    <div className="mx-auto mt-12 max-w-6xl px-6 pb-12">
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently delete this package, every uploaded source PDF, and every export. This
          cannot be undone.
        </p>
        <div className="mt-4">
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Delete package
          </Button>
        </div>
      </div>
      <ConfirmDestructiveDialog
        open={open}
        title="Delete this package?"
        description={
          <>
            <span className="font-medium">&ldquo;{packageLabel}&rdquo;</span> and every uploaded
            PDF and export inside it will be permanently removed. This action cannot be undone.
          </>
        }
        confirmLabel="Delete package"
        isPending={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onOpenChange={setOpen}
      />
    </div>
  );
}
