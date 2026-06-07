'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import type { AdminResetPasswordResponse, AdminUserListItem } from './shared-types';

const schema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
type FormValues = z.infer<typeof schema>;

function suggestPassword(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(36))
    .join('')
    .slice(0, 16);
}

export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
  onResetComplete,
}: {
  user: AdminUserListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResetComplete: () => void;
}) {
  const [result, setResult] = useState<AdminResetPasswordResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: suggestPassword() },
  });
  const currentPassword = watch('password');

  const mutation = useMutation({
    mutationFn: (values: FormValues): Promise<AdminResetPasswordResponse> =>
      api.post<AdminResetPasswordResponse>(
        `/api/v1/admin/users/${user.id}/reset-password`,
        { password: values.password },
      ),
    onSuccess: (data) => {
      setResult(data);
      onResetComplete();
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Could not reset password';
      toast.error(msg);
    },
  });

  function handleClose(next: boolean) {
    if (mutation.isPending) return;
    onOpenChange(next);
    if (!next) {
      reset({ password: suggestPassword() });
      setResult(null);
      setCopied(false);
    }
  }

  async function copyPassword() {
    if (!result) return;
    await navigator.clipboard.writeText(result.tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        {!result ? (
          <>
            <DialogHeader>
              <DialogTitle>Reset password</DialogTitle>
              <DialogDescription>
                Sets a new temporary password for <strong>{user.email}</strong>. All
                active sessions for this user will be revoked, and they will be
                required to change the password on next sign-in.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={handleSubmit((values) => mutation.mutate(values))}
              noValidate
            >
              <div className="space-y-2">
                <Label htmlFor="rp-password">New temporary password</Label>
                <div className="flex gap-2">
                  <Input
                    id="rp-password"
                    type="text"
                    autoComplete="off"
                    autoFocus
                    value={currentPassword}
                    onChange={(e) => setValue('password', e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setValue('password', suggestPassword())}
                    title="Generate new password"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password.message}</p>
                )}
                <input type="hidden" {...register('password')} />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleClose(false)}
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Resetting…' : 'Reset password'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Password reset</DialogTitle>
              <DialogDescription>
                Copy this temporary password now. It is shown <strong>only once</strong>
                . {result.sessionsRevoked} active session(s) were revoked.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground">User</div>
                <div className="font-mono text-sm">{user.email}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Temporary password
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-background px-2 py-1 font-mono text-sm">
                    {result.tempPassword}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyPassword}
                  >
                    {copied ? (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 h-4 w-4" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
