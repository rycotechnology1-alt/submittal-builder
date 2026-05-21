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
import type { ProjectResponse } from '@submittal/shared/api';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required'),
  project_number: z.string().trim().optional(),
  gc_name: z.string().trim().optional(),
  architect_name: z.string().trim().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function nullIfBlank(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

export function NewProjectDialog({ trigger }: { trigger: React.ReactNode }) {
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
      return api.post<ProjectResponse>('/api/v1/projects', {
        name: values.name,
        project_number: nullIfBlank(values.project_number),
        gc_name: nullIfBlank(values.gc_name),
        architect_name: nullIfBlank(values.architect_name),
      });
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Created ${project.name}`);
      reset();
      setOpen(false);
      router.push(`/projects/${project.id}`);
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Could not create project';
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
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Add a project to start organizing submittal packages.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="np-name">Project name</Label>
            <Input id="np-name" autoFocus {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="np-number">Project number</Label>
            <Input id="np-number" placeholder="24-118" {...register('project_number')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="np-gc">GC</Label>
              <Input id="np-gc" placeholder="Turner" {...register('gc_name')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-architect">Architect</Label>
              <Input id="np-architect" placeholder="SOM" {...register('architect_name')} />
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
              {mutation.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
