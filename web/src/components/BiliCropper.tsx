import { notifyError } from '../lib/feedback';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { formatDuration } from '../lib/utils';

type CropperProps = {
  src: string;
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
};
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export function BiliCropper(props: CropperProps) {
  return <CropperSession key={props.src} {...props} />;
}
function CropperSession(props: CropperProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const segmentPreview = useRef(false);
  const drag = useRef<'start' | 'end' | null>(null);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [metaDur, setMetaDur] = useState(0);
  const dur = metaDur || props.duration || 1;
  const gap = Math.min(0.5, dur);
  const pct = (v: number) => `${clamp(v / dur, 0, 1) * 100}%`;
  useEffect(() => {
    const audio = audioRef.current!;
    return () => {
      audio.pause();
    };
  }, []);
  function play() {
    const audio = audioRef.current!;
    void audio.play().catch(() => {
      // 换源或关闭裁剪器后，旧播放请求不再向全局浮层发送错误。
      if (audioRef.current === audio) notifyError('试听失败，请刷新视频或检查网络');
    });
  }
  function timeAt(clientX: number) {
    const rect = barRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / (rect.width || 1), 0, 1) * dur;
  }
  function startDrag(which: 'start' | 'end', e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = which;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const time = timeAt(e.clientX);
    if (drag.current === 'start') props.onChange(clamp(time, 0, Math.max(0, props.end - gap)), props.end);
    else props.onChange(props.start, clamp(time, props.start + gap, dur));
  }
  function stop(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <div className="space-y-2">
      <audio
        ref={audioRef}
        src={props.src}
        preload="metadata"
        className="hidden"
        onTimeUpdate={(e) => {
          setCur(e.currentTarget.currentTime);
          if (segmentPreview.current && e.currentTarget.currentTime >= props.end) {
            e.currentTarget.pause();
            segmentPreview.current = false;
          }
        }}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) setMetaDur(e.currentTarget.duration);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => notifyError('音频加载失败，请刷新视频后重试')}
      />
      <div
        ref={barRef}
        className="relative h-10 cursor-pointer touch-none select-none rounded-md border bg-muted"
        onPointerDown={(e) => {
          if (drag.current) return;
          const time = timeAt(e.clientX);
          audioRef.current!.currentTime = time;
          setCur(time);
        }}
      >
        <div
          className="absolute inset-y-0 bg-primary/25"
          style={{ left: pct(props.start), width: pct(props.end - props.start) }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: pct(cur) }} />
        {(['start', 'end'] as const).map((which) => (
          <div
            key={which}
            className="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded bg-primary"
            style={{ left: pct(props[which]) }}
            role="slider"
            tabIndex={0}
            aria-label={which === 'start' ? '裁剪起点' : '裁剪终点'}
            aria-valuemin={which === 'start' ? 0 : props.start + gap}
            aria-valuemax={which === 'start' ? props.end - gap : dur}
            aria-valuenow={props[which]}
            onPointerDown={(e) => startDrag(which, e)}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
              e.preventDefault();
              const next = props[which] + (e.key === 'ArrowLeft' ? -gap : gap);
              if (which === 'start') props.onChange(clamp(next, 0, Math.max(0, props.end - gap)), props.end);
              else props.onChange(props.start, clamp(next, props.start + gap, dur));
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            segmentPreview.current = false;
            if (audioRef.current!.paused) play();
            else audioRef.current!.pause();
          }}
        >
          {playing ? '暂停' : '播放'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            audioRef.current!.currentTime = props.start;
            segmentPreview.current = true;
            play();
          }}
        >
          试听片段
        </Button>
        <span className="tabular-nums">
          起 {formatDuration(props.start)} · 止 {formatDuration(props.end)} · 时长{' '}
          {formatDuration(props.end - props.start)}
        </span>
        <span className="ml-auto tabular-nums">
          {formatDuration(cur)} / {formatDuration(dur)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => props.onChange(clamp(cur, 0, Math.max(0, props.end - gap)), props.end)}
        >
          以当前为起点
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => props.onChange(props.start, clamp(cur, props.start + gap, dur))}
        >
          以当前为终点
        </Button>
        {(props.start > 0 || props.end < dur) && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => props.onChange(0, dur)}>
            重置为整段
          </Button>
        )}
      </div>
    </div>
  );
}
