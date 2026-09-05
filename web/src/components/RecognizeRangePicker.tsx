import { useRef } from 'react';
import { formatDuration } from '../lib/utils';

type RecognizeRangePickerProps = {
  /** 裁剪起点，对应本条的最左端。 */
  rangeStart: number;
  /** 裁剪终点，对应本条的最右端。 */
  rangeEnd: number;
  /** 识别窗口起点（绝对秒）。 */
  start: number;
  /** 识别窗口时长。 */
  length: number;
  /** 识别服务允许的最长片段。 */
  maxLength: number;
  /** 服务要求定长窗口（如网易云固定 6 秒）时只能整体平移。 */
  fixedLength: boolean;
  onChange: (start: number, length: number) => void;
};
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * 识别选段条：整条宽度即当前裁剪范围，在其中再挑出真正送去识别的片段。
 * 与 BiliCropper 分开，避免裁剪（入库用）和识别窗口互相干扰。
 */
export function RecognizeRangePicker(props: RecognizeRangePickerProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'start' | 'end' | 'move'; offset: number } | null>(null);
  const span = Math.max(props.rangeEnd - props.rangeStart, 0);
  const winStart = props.start;
  const winEnd = props.start + props.length;
  const minLen = Math.min(1, span);
  const step = Math.min(1, span) || 1;
  const ratio = (v: number) => (span ? clamp((v - props.rangeStart) / span, 0, 1) : 0);
  const pct = (v: number) => `${ratio(v) * 100}%`;
  function timeAt(clientX: number) {
    const rect = barRef.current!.getBoundingClientRect();
    return props.rangeStart + clamp((clientX - rect.left) / (rect.width || 1), 0, 1) * span;
  }
  /** 命中判定按像素折算成秒，窄窗口下也能抓住两侧手柄。 */
  function tolerance() {
    const rect = barRef.current!.getBoundingClientRect();
    return (8 / (rect.width || 1)) * span;
  }
  function moveTo(time: number, offset: number) {
    const start = clamp(time - offset, props.rangeStart, Math.max(props.rangeStart, props.rangeEnd - props.length));
    props.onChange(start, props.length);
  }
  function apply(mode: 'start' | 'end' | 'move', time: number, offset: number) {
    if (mode === 'start') {
      const start = clamp(time, Math.max(props.rangeStart, winEnd - props.maxLength), winEnd - minLen);
      props.onChange(start, winEnd - start);
    } else if (mode === 'end') {
      const end = clamp(time, winStart + minLen, Math.min(props.rangeEnd, winStart + props.maxLength));
      props.onChange(winStart, end - winStart);
    } else {
      moveTo(time, offset);
    }
  }
  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (span <= 0) return;
    const time = timeAt(e.clientX);
    const tol = tolerance();
    const mode: 'start' | 'end' | 'move' = props.fixedLength
      ? 'move'
      : Math.abs(time - winStart) <= tol
        ? 'start'
        : Math.abs(time - winEnd) <= tol
          ? 'end'
          : 'move';
    // 点在窗口内保持相对位置拖动，点在窗口外则把窗口移到点击处居中。
    const offset = time >= winStart && time <= winEnd ? time - winStart : props.length / 2;
    drag.current = { mode, offset };
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(mode, time, offset);
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    apply(drag.current.mode, timeAt(e.clientX), drag.current.offset);
  }
  function stop(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function key(mode: 'start' | 'end' | 'move', e: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const delta = e.key === 'ArrowLeft' ? -step : step;
    if (mode === 'move') moveTo(winStart + delta, 0);
    else apply(mode, (mode === 'start' ? winStart : winEnd) + delta, 0);
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:justify-between">
        <span>识别片段 · 范围为上方裁剪区间</span>
        <span>
          {props.fixedLength ? `该服务固定 ${props.maxLength} 秒，只能整体平移` : `最长 ${props.maxLength} 秒`}
        </span>
      </div>
      <div
        ref={barRef}
        data-testid="recognize-timeline"
        className="relative h-10 cursor-pointer touch-none select-none rounded-none border bg-muted"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        <div
          className="pointer-events-none absolute inset-y-0 border-x border-primary/50 bg-primary/25"
          style={{ left: pct(winStart), width: `${(ratio(winEnd) - ratio(winStart)) * 100}%` }}
        />
        {props.fixedLength ? (
          <div
            className="pointer-events-none absolute inset-y-0 -translate-x-1/2"
            style={{ left: pct((winStart + winEnd) / 2) }}
            role="slider"
            tabIndex={0}
            aria-label="识别片段位置"
            aria-valuemin={props.rangeStart}
            aria-valuemax={Math.max(props.rangeStart, props.rangeEnd - props.length)}
            aria-valuenow={winStart}
            onKeyDown={(e) => key('move', e)}
          />
        ) : (
          (['start', 'end'] as const).map((which) => (
            <div
              key={which}
              className="pointer-events-none absolute inset-y-0 w-2 -translate-x-1/2 rounded-none bg-primary"
              style={{ left: pct(which === 'start' ? winStart : winEnd) }}
              role="slider"
              tabIndex={0}
              aria-label={which === 'start' ? '识别起点' : '识别终点'}
              aria-valuemin={
                which === 'start' ? Math.max(props.rangeStart, winEnd - props.maxLength) : winStart + minLen
              }
              aria-valuemax={which === 'start' ? winEnd - minLen : Math.min(props.rangeEnd, winStart + props.maxLength)}
              aria-valuenow={which === 'start' ? winStart : winEnd}
              onKeyDown={(e) => key(which, e)}
            />
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums" role="status">
        将识别 {formatDuration(winStart)} – {formatDuration(winEnd)} · 时长 {formatDuration(props.length)}
      </p>
    </div>
  );
}
