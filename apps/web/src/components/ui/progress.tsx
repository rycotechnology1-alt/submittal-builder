import * as React from 'react';

import { cn } from '@/lib/utils';

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number | null;
};

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => {
    const safeValue = Math.min(100, Math.max(0, value ?? 0));

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeValue}
        className={cn('h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
        {...props}
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

export { Progress };
