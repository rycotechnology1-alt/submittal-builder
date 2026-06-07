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

import type { AdminCreateUserResponse } from './shared-types';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  name: z.string().trim().min(1, 'Name is required'),
  workspace_name: z.string().trim().min(1, 'Workspace name is required'),
  sub_company_name: z.string().trim().min(1, 'Company name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormValues = z.infer<typeof schema>;

function suggestPassword(): string {
  // 16 base64url chars = 96 bits of entropy. Server still generates its own if
  // the field is blank; this is just the suggest-button affordance.
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(36))
    .join('')
    .slice(0, 16);
}

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [created, setCreated] = useState<AdminCreateUserResponse | null>(null);
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
    mutationFn: (values: FormValues): Promise<AdminCreateUserResponse> =>
      api.post<AdminCreateUserResponse>('/api/v1/admin/users', values),
    onSuccess: (result) => {
      setCreated(result);
      onCreated();
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Could not create user';
      toast.error(msg);
    },
  });

  function handleClose(next: boolean) {
    if (mutation.isPending) return;
    onOpenChange(next);
    if (!next) {
      reset({
        email: '',
        name: '',
        workspace_name: '',
        sub_company_name: '',
        password: suggestPassword(),
      });
      setCreated(null);
      setCopied(false);
    }
  }

  async function copyPassword() {
    if (!created) return;
    await navigator.clipboard.writeText(created.tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        {!created ? (
          <>
            <DialogHeader>
              <DialogTitle>New user</DialogTitle>
              <DialogDescription>
                Creates the user, their workspace, and a temporary password. The user
                will be required to change the password on first sign-in.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={handleSubmit((values) => mutation.mutate(values))}
              noValidate
            >
              <div className="space-y-2">
                <Label htmlFor="cu-email">Email</Label>
                <Input
                  id="cu-email"
                  type="email"
                  autoComplete="off"
                  autoFocus
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cu-name">Name</Label>
                <Input id="cu-name" {...register('name')} />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="cu-workspace">Workspace name</Label>
                  <Input id="cu-workspace" {...register('workspace_name')} />
                  {errors.workspace_name && (
                    <p className="text-sm text-destructive">
                      {errors.workspace_name.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cu-sub-company">Company (sub)</Label>
                  <Input id="cu-sub-company" {...register('sub_company_name')} />
                  {errors.sub_company_name && (
                    <p className="text-sm text-destructive">
                      {errors.sub_company_name.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cu-password">Temporary password</Label>
                <div className="flex gap-2">
                  <Input
                    id="cu-password"
                    type="text"
                    autoComplete="off"
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
                  {mutation.isPending ? 'Creating…' : 'Create user'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>
                Copy this temporary password now. It is shown <strong>only once</strong>
                — close this dialog and you will not be able to retrieve it. The user
                must change it on first sign-in.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Email</div>
                <div className="font-mono text-sm">{created.user.email}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Temporary password
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-background px-2 py-1 font-mono text-sm">
                    {created.tempPassword}
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
