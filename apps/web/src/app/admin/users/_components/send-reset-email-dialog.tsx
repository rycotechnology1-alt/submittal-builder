'use client';

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, api } from '@/lib/api';

import type { AdminSendResetEmailResponse, AdminUserListItem } from './shared-types';

export function SendResetEmailDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useMutation({
    mutationFn: (): Promise<AdminSendResetEmailResponse> =>
      api.post<AdminSendResetEmailResponse>(
        `/api/v1/admin/users/${user.id}/send-reset-email`,
      ),
    onSuccess: (data) => {
      if (data.emailDelivery === 'sent') {
        toast.success(`Reset email sent to ${user.email}`);
      } else {
        toast.warning('Reset prepared, but no email was sent (email service offline)');
      }
      onOpenChange(false);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Could not send reset email';
      toast.error(msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send password reset email?</DialogTitle>
          <DialogDescription>
            Triggers the standard password-reset flow for{' '}
            <strong>{user.email}</strong>. They will receive a one-time link to choose
            a new password.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Sending…' : 'Send reset email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
