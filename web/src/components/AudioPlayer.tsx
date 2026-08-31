/**
 * 自定义音频播放器：底层用隐藏的 <audio> 作为播放内核，自绘播放/进度/音量/音质 UI。
 *
 * 响度均衡：以 -14 LUFS 为参考，把「比参考更响」的曲目通过音量衰减拉到一致水平
 * （仅衰减，不增益——增益需 Web Audio + 跨域 CORS，留待服务端转码时做）。
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import { cn, formatDuration } from '../lib/utils';

export interface PlayerSource {
  id?: string;
  label: string;
  url: string;
  loudness?: number | null;
}

const TARGET_LUFS = -14;
const NORM_KEY = 'ommb.normalize';

function normMultiplier(loudness: number | null | undefined, on: boolean): number {
  if (!on || loudness == null) return 1;
  const gainDb = TARGET_LUFS - loudness;
  return Math.min(1, Math.pow(10, gainDb / 20));
}

export function AudioPlayer(props: { sources: PlayerSource[]; title?: string }) {
  let audio!: HTMLAudioElement;
  let bar!: HTMLDivElement;

  const [idx, setIdx] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  let sourceIdentity = '';
  createEffect(() => {
    const sources = props.sources;
    const identity = sources[0]?.id ?? sources[0]?.url ?? '';
    const changed = identity !== sourceIdentity;
    sourceIdentity = identity;
    untrack(() => {
      if (!audio) return;
      if (changed) {
        setIdx(0);
        setCur(0);
        setDur(0);
        setPlaying(false);
      }
      const next = sources[Math.min(idx(), Math.max(0, sources.length - 1))]?.url ?? '';
      if (audio.getAttribute('src') !== next) {
        audio.pause();
        audio.src = next;
        audio.load();
        setLoading(false);
        setError('');
      }
    });
  });
  const [cur, setCur] = createSignal(0);
  const [dur, setDur] = createSignal(0);
  const [vol, setVol] = createSignal(1);
  const [muted, setMuted] = createSignal(false);
  const [scrubbing, setScrubbing] = createSignal(false);
  const [normalize, setNormalize] = createSignal(localStorage.getItem(NORM_KEY) !== 'off');

  const current = () => props.sources[Math.min(idx(), Math.max(0, props.sources.length - 1))];
  const multiplier = createMemo(() => normMultiplier(current()?.loudness, normalize()));
  const progress = () => (dur() > 0 ? (cur() / dur()) * 100 : 0);
  const hasLoudness = () => props.sources.some((s) => s.loudness != null);

  createEffect(() => {
    if (audio) audio.volume = muted() ? 0 : vol() * multiplier();
  });

  onMount(() => {
    audio.src = current()?.url ?? '';
    const onTime = () => {
      if (!scrubbing()) setCur(audio.currentTime);
    };
    const onMeta = () => setDur(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onEnded = () => setPlaying(false);
    const onError = () => {
      setLoading(false);
      setPlaying(false);
      setError('音频加载失败：可能已下架、凭证过期或格式不受支持，请刷新详情后重试');
    };
    audio.addEventListener('error', onError);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onPlaying);
    audio.addEventListener('ended', onEnded);
    onCleanup(() => {
      audio.pause();
      audio.removeEventListener('error', onError);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onPlaying);
      audio.removeEventListener('ended', onEnded);
    });
  });

  function togglePlay() {
    if (audio.paused)
      audio.play().catch(() => {
        setLoading(false);
        setError('无法播放音频，请检查网络或更换音质');
      });
    else audio.pause();
  }

  function switchQuality(i: number) {
    if (i === idx() || !props.sources[i]) return;
    const t = audio.currentTime;
    const wasPlaying = !audio.paused;
    setIdx(i);
    audio.src = props.sources[i].url;
    const restore = () => {
      try {
        audio.currentTime = t;
      } catch {
        /* 忽略 */
      }
      if (wasPlaying)
        audio.play().catch(() => {
          setLoading(false);
          setError('无法播放音频，请检查网络或更换音质');
        });
      audio.removeEventListener('loadedmetadata', restore);
    };
    audio.addEventListener('loadedmetadata', restore);
    audio.load();
  }

  function timeFromPointer(e: PointerEvent): number {
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return frac * (dur() || 0);
  }
  function onBarDown(e: PointerEvent) {
    setScrubbing(true);
    bar.setPointerCapture(e.pointerId);
    setCur(timeFromPointer(e));
  }
  function onBarMove(e: PointerEvent) {
    if (scrubbing()) setCur(timeFromPointer(e));
  }
  function onBarUp(e: PointerEvent) {
    if (!scrubbing()) return;
    audio.currentTime = cur();
    setScrubbing(false);
    try {
      bar.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
  }

  return (
    <div class="rounded-lg border bg-card p-3">
      {/* 播放内核：隐藏的原生 <audio>，仅供 JS 控制，UI 全部自绘 */}
      <audio ref={audio} preload="metadata" class="hidden" />
      <Show when={error()}>
        <p role="alert" class="mb-2 text-sm text-destructive">
          {error()}
        </p>
      </Show>

      <Show when={props.title}>
        <div class="mb-2 truncate text-sm font-medium">{props.title}</div>
      </Show>

      <div class="flex items-center gap-3">
        <button
          type="button"
          class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={togglePlay}
          aria-label={playing() ? '暂停' : '播放'}
        >
          <Show
            when={loading()}
            fallback={
              <Show when={playing()} fallback={<IconPlay />}>
                <IconPause />
              </Show>
            }
          >
            <IconSpinner />
          </Show>
        </button>

        <div class="min-w-0 flex-1 space-y-1">
          <div
            ref={bar}
            class="group relative h-2 cursor-pointer touch-none rounded-full bg-muted"
            onPointerDown={onBarDown}
            onPointerMove={onBarMove}
            onPointerUp={onBarUp}
          >
            <div class="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${progress()}%` }} />
            <div
              class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-100"
              style={{ left: `${progress()}%` }}
            />
          </div>
          <div class="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
            <span>{formatDuration(cur())}</span>
            <span>{formatDuration(dur())}</span>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground"
            onClick={() => setMuted(!muted())}
            aria-label="静音"
          >
            <Show when={muted() || vol() === 0} fallback={<IconVolume />}>
              <IconMute />
            </Show>
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={vol()}
            class="h-1 w-16 cursor-pointer accent-primary sm:w-20"
            onInput={(e) => {
              setVol(Number(e.currentTarget.value));
              setMuted(false);
            }}
          />
        </div>
      </div>

      <Show when={props.sources.length > 1 || hasLoudness()}>
        <div class="mt-3 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
          <Show when={props.sources.length > 1}>
            <span class="text-muted-foreground">音质</span>
            <For each={props.sources}>
              {(s, i) => (
                <button
                  type="button"
                  class={cn(
                    'rounded px-2 py-0.5',
                    i() === idx() ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent',
                  )}
                  onClick={() => switchQuality(i())}
                >
                  {s.label}
                </button>
              )}
            </For>
          </Show>
          <Show when={hasLoudness()}>
            <button
              type="button"
              class={cn(
                'ml-auto rounded px-2 py-0.5',
                normalize() ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground',
              )}
              onClick={() => {
                const v = !normalize();
                setNormalize(v);
                localStorage.setItem(NORM_KEY, v ? 'on' : 'off');
              }}
              title={`响度均衡到 ${TARGET_LUFS} LUFS`}
            >
              响度均衡 {normalize() ? '开' : '关'}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// 内联 SVG 图标，避免运行时依赖图标 CDN。
const IconPlay = () => (
  <svg viewBox="0 0 24 24" class="size-5" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconPause = () => (
  <svg viewBox="0 0 24 24" class="size-5" fill="currentColor">
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </svg>
);
const IconSpinner = () => (
  <svg viewBox="0 0 24 24" class="size-5 animate-spin" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="9" stroke-opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke-linecap="round" />
  </svg>
);
const IconVolume = () => (
  <svg viewBox="0 0 24 24" class="size-4" fill="currentColor">
    <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />
  </svg>
);
const IconMute = () => (
  <svg viewBox="0 0 24 24" class="size-4">
    <path d="M3 10v4h4l5 5V5L7 10H3z" fill="currentColor" />
    <path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </svg>
);
