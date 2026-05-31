'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ConfirmDeleteDialog({
  open,
  itemTitle,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  itemTitle: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete item?</DialogTitle>
          <DialogDescription>
            &ldquo;{itemTitle}&rdquo; and its linked source PDFs will be removed from this
            package. Previous exports remain downloadable, but future exports will omit it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
