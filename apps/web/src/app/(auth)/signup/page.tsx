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

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1, 'Your name is required'),
  sub_company_name: z.string().trim().min(1, 'Company name is required'),
  workspace_name: z.string().trim().min(1, 'Workspace name is required'),
});

type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
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
      await api.post('/api/v1/auth/signup', values);
      router.replace('/');
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'email_in_use') {
          setSubmitError('An account with that email already exists.');
        } else {
          setSubmitError(e.message);
        }
        return;
      }
      setSubmitError('Could not create your account. Please try again.');
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Submittal Builder</CardTitle>
        <CardDescription>Create your workspace</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" autoFocus {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...register('password')}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" autoComplete="name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="sub_company_name">Company name (sub)</Label>
            <Input
              id="sub_company_name"
              autoComplete="organization"
              {...register('sub_company_name')}
            />
            {errors.sub_company_name && (
              <p className="text-sm text-destructive">{errors.sub_company_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace_name">Workspace name</Label>
            <Input id="workspace_name" {...register('workspace_name')} />
            {errors.workspace_name && (
              <p className="text-sm text-destructive">{errors.workspace_name.message}</p>
            )}
          </div>
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
