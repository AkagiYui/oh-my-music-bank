import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn } from '~/lib/utils';

function Progress({ className, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={(state) =>
        cn(
          'relative h-1 w-full overflow-hidden rounded-none bg-muted',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    >
      {/* 由 Base UI 同步计算填充宽度和无障碍进度，避免视觉数值与读屏状态不一致。 */}
      <ProgressPrimitive.Track data-slot="progress-track" className="h-full w-full">
        <ProgressPrimitive.Indicator data-slot="progress-indicator" className="h-full bg-primary transition-all" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
