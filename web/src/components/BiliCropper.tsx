/**
 * 视频音频裁剪器：在时间轴上拖动起止把手选取片段，可整段播放或试听片段。
 * 音频由后端代理流（带 Referer），支持 Range，故可秒级 seek。
 */
import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Button } from './ui/button';
import { formatDuration } from '../lib/utils';

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

export function BiliCropper(props: {
  src: string;
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  let audio!: HTMLAudioElement;
  let bar!: HTMLDivElement;

  const [cur, setCur] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [metaDur, setMetaDur] = createSignal(0);
  const [drag, setDrag] = createSignal<null | 'start' | 'end'>(null);
  let segmentPreview = false;

  const dur = () => metaDur() || props.duration || 1;
  const pct = (v: number) => `${(v / dur()) * 100}%`;

  onMount(() => {
    const onTime = () => {
      setCur(audio.currentTime);
      if (segmentPreview && audio.currentTime >= props.end) {
        audio.pause();
        segmentPreview = false;
      }
    };
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setMetaDur(audio.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    onCleanup(() => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    });
  });

  function timeAt(clientX: number) {
    const r = bar.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * dur();
  }

  function startDrag(which: 'start' | 'end') {
    return (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDrag(which);
      const move = (ev: PointerEvent) => {
        const t = timeAt(ev.clientX);
        if (which === 'start') props.onChange(Math.min(t, props.end - 0.5), props.end);
        else props.onChange(props.start, Math.max(t, props.start + 0.5));
      };
      const up = () => {
        setDrag(null);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  function onBarPointerDown(e: PointerEvent) {
    if (drag()) return;
    const t = timeAt(e.clientX);
    audio.currentTime = t;
    setCur(t);
  }

  function togglePlay() {
    segmentPreview = false;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }
  function playSegment() {
    audio.currentTime = props.start;
    segmentPreview = true;
    audio.play().catch(() => {});
  }

  return (
    <div class="space-y-2">
      <audio ref={audio} src={props.src} preload="metadata" class="hidden" />

      <div
        ref={bar}
        class="relative h-10 cursor-pointer touch-none select-none rounded-md border bg-muted"
        onPointerDown={onBarPointerDown}
      >
        {/* 选中区间 */}
        <div class="absolute inset-y-0 bg-primary/25" style={{ left: pct(props.start), width: pct(props.end - props.start) }} />
        {/* 播放头 */}
        <div class="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: pct(cur()) }} />
        {/* 起把手 */}
        <div
          class="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded bg-primary"
          style={{ left: pct(props.start) }}
          onPointerDown={startDrag('start')}
        />
        {/* 止把手 */}
        <div
          class="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded bg-primary"
          style={{ left: pct(props.end) }}
          onPointerDown={startDrag('end')}
        />
      </div>

      <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Button size="sm" variant="secondary" onClick={togglePlay}>
          {playing() ? '暂停' : '播放'}
        </Button>
        <Button size="sm" variant="outline" onClick={playSegment}>
          试听片段
        </Button>
        <span class="tabular-nums">
          起 {formatDuration(props.start)} · 止 {formatDuration(props.end)} · 时长 {formatDuration(props.end - props.start)}
        </span>
        <span class="ml-auto tabular-nums">
          {formatDuration(cur())} / {formatDuration(dur())}
        </span>
      </div>

      <div class="flex items-center gap-2 text-xs">
        <Button size="sm" variant="ghost" class="h-7" onClick={() => props.onChange(cur(), props.end)}>
          以当前为起点
        </Button>
        <Button size="sm" variant="ghost" class="h-7" onClick={() => props.onChange(props.start, cur())}>
          以当前为终点
        </Button>
        <Show when={props.start > 0 || props.end < dur()}>
          <Button size="sm" variant="ghost" class="h-7" onClick={() => props.onChange(0, dur())}>
            重置为整段
          </Button>
        </Show>
      </div>
    </div>
  );
}
