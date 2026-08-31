import * as React from 'react';

import { cn } from '~/lib/utils';

// Base UI 没有独立 Label primitive；原生 label 保留 htmlFor 和表单标签语义。
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-xs leading-none select-none group-data-disabled:pointer-events-none group-data-disabled:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-data-disabled:cursor-not-allowed peer-data-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
