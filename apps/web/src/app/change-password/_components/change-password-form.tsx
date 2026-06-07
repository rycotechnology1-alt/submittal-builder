'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from current',
    path: ['newPassword'],
  });

type FormValues = z.infer<typeof schema>;

/**
 * Props
 * - forced: true when the user MUST change their password before the rest of
 *   the app is reachable (admin-created account or admin-initiated reset).
 *   Drives copy + hides the cancel link.
 */
export function ChangePasswordForm({ forced = true }: { forced?: boolean }) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      await api.post('/api/v1/me/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      router.replace('/');
      router.refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Could not change password';
      setSubmitError(msg);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          {forced ? 'Set a new password' : 'Change your password'}
        </CardTitle>
        <CardDescription>
          {forced
            ? 'Your account was set up with a temporary password. Please choose a new one to continue.'
            : 'Choose a new password. You will stay signed in on this device.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              autoFocus
              {...register('currentPassword')}
            />
            {errors.currentPassword && (
              <p className="text-sm text-destructive">{errors.currentPassword.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...register('newPassword')}
            />
            {errors.newPassword && (
              <p className="text-sm text-destructive">{errors.newPassword.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
        {!forced && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground hover:underline">
              Cancel — back to dashboard
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
