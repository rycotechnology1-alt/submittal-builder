'use client';

import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';

export function DeleteSavedItemDialog({
  open,
  title,
  isPending,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ConfirmDestructiveDialog
      open={open}
      title="Delete saved item"
      description={
        <>
          Delete <span className="font-medium text-foreground">{title}</span> from the workspace
          library. Package snapshots that already imported it will keep their backing file.
        </>
      }
      confirmLabel="Delete"
      pendingLabel="Deleting..."
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />
  );
}
