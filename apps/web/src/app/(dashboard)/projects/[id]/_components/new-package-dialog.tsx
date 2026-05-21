'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import type { PackageResponse } from '@submittal/shared/api';

const formSchema = z.object({
  submittal_number: z.string().trim().min(1, 'Submittal number is required'),
  spec_section: z.string().trim().min(1, 'Spec section is required'),
  revision: z.string().trim().optional(),
  title: z.string().trim().optional(),
  submittal_date: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), {
      message: 'Date must be YYYY-MM-DD',
    }),
});

type FormValues = z.infer<typeof formSchema>;

function nullIfBlank(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

export function NewPackageDialog({
  projectId,
  trigger,
}: {
  projectId: string;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const revision = values.revision?.trim();
      return api.post<PackageResponse>(`/api/v1/projects/${projectId}/packages`, {
        submittal_number: values.submittal_number.trim(),
        spec_section: values.spec_section.trim(),
        ...(revision ? { revision } : {}),
        title: nullIfBlank(values.title),
        submittal_date: nullIfBlank(values.submittal_date),
      });
    },
    onSuccess: (pkg) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success(`Created ${pkg.submittal_number}`);
      reset();
      setOpen(false);
      router.push(`/packages/${pkg.id}`);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Could not create package';
      toast.error(msg);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New package</DialogTitle>
          <DialogDescription>
            Add a submittal package to this project.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="npk-submittal">Submittal number</Label>
              <Input
                id="npk-submittal"
                autoFocus
                placeholder="09 51 13-002"
                {...register('submittal_number')}
              />
              {errors.submittal_number && (
                <p className="text-sm text-destructive">{errors.submittal_number.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="npk-spec">Spec section</Label>
              <Input
                id="npk-spec"
                placeholder="09 51 13"
                {...register('spec_section')}
              />
              {errors.spec_section && (
                <p className="text-sm text-destructive">{errors.spec_section.message}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="npk-title">Title</Label>
            <Input
              id="npk-title"
              placeholder="Acoustical Ceiling Panels"
              {...register('title')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="npk-revision">Revision</Label>
              <Input id="npk-revision" placeholder="R0" {...register('revision')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="npk-date">Submittal date</Label>
              <Input id="npk-date" type="date" {...register('submittal_date')} />
              {errors.submittal_date && (
                <p className="text-sm text-destructive">{errors.submittal_date.message}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create package'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
