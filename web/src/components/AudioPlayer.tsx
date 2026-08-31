import { notifyError } from '../lib/feedback';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { LoaderCircle, Music2, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
import { formatDuration } from '../lib/utils';
import { requestAudioFocus, subscribeAudioFocus } from '../lib/audio-focus';

export interface PlayerSource {
  id?: string;
  label: string;
  url: string;
  loudness?: number | null;
}
export interface PlayerControls {
  pause: () => void;
  toggle: () => void;
}
type PlayerProps = {
  sources: PlayerSource[];
  trackKey?: string;
  title?: string;
  artist?: string;
  coverUrl?: string;
  autoPlay?: boolean;
  controlsRef?: Ref<PlayerControls>;
  onPlayingChange?: (playing: boolean) => void;
  onClose?: () => void;
};
const TARGET_LUFS = -14;
const NORM_KEY = 'ommb.normalize';
const VOL_KEY = 'ommb.volume';
const MUTE_KEY = 'ommb.muted';
function preference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function savePreference(key: string, value: string) {
  // 隐私模式禁用存储时，仍允许本次会话正常控制音频。
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 不影响播放。 */
  }
}

export function AudioPlayer(props: PlayerProps) {
  // 只有主动选择另一首曲目才重建会话，页面卸载不再决定播放器生命周期。
  return <PlayerSession key={props.trackKey ?? props.sources[0]?.id ?? props.sources[0]?.url ?? ''} {...props} />;
}
function PlayerSession({
  sources,
  title,
  artist,
  coverUrl,
  autoPlay = false,
  controlsRef,
  onPlayingChange,
  onClose,
}: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const restoreRef = useRef<number | null>(null);
  const wantsPlay = useRef(autoPlay);
  const playAttempt = useRef(0);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(() => {
    const value = Number(preference(VOL_KEY) ?? 1);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  });
  const [muted, setMuted] = useState(() => preference(MUTE_KEY) === 'on');
  const [normalize, setNormalize] = useState(() => preference(NORM_KEY) !== 'off');
  const index = Math.min(idx, Math.max(0, sources.length - 1));
  const source = sources[index];
  const url = source?.url ?? '';
  const multiplier =
    !normalize || source?.loudness == null ? 1 : Math.min(1, 10 ** ((TARGET_LUFS - source.loudness) / 20));

  const pause = useCallback(() => {
    wantsPlay.current = false;
    ++playAttempt.current;
    audioRef.current?.pause();
    setPlaying(false);
    setLoading(false);
  }, []);
  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.getAttribute('src')) return;
    wantsPlay.current = true;
    const attempt = ++playAttempt.current;
    requestAudioFocus(audio);
    setLoading(true);
    void audio.play().catch((error: unknown) => {
      // 快速切歌、切音质或暂停会取消旧请求，不应弹出过期错误或恢复旧播放。
      if (audioRef.current !== audio || attempt !== playAttempt.current || !wantsPlay.current) return;
      wantsPlay.current = false;
      setLoading(false);
      setPlaying(false);
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        notifyError('无法播放音频，请检查网络或更换音质');
    });
  }, []);
  const toggle = useCallback(() => {
    if (wantsPlay.current || (audioRef.current && !audioRef.current.paused)) pause();
    else play();
  }, [pause, play]);
  useImperativeHandle(controlsRef, () => ({ pause, toggle }), [pause, toggle]);
  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);
  useEffect(
    () =>
      subscribeAudioFocus((owner) => {
        if (owner !== audioRef.current) pause();
      }),
    [pause],
  );
  useEffect(() => {
    const audio = audioRef.current!;
    audio.load();
    // 首次播放直接发起；切音质需等待新元数据后恢复位置。
    if (wantsPlay.current && restoreRef.current === null) play();
    const invalidate = () => {
      ++playAttempt.current;
    };
    return () => {
      restoreRef.current = audio.currentTime || 0;
      invalidate();
      audio.pause();
    };
  }, [url, play]);
  useEffect(() => {
    audioRef.current!.volume = vol * multiplier;
    audioRef.current!.muted = muted;
  }, [muted, vol, multiplier, url]);

  function onMetadata(audio: HTMLAudioElement) {
    if (audioRef.current !== audio) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    setDur(duration);
    if (restoreRef.current !== null) {
      audio.currentTime = Math.min(restoreRef.current, duration || restoreRef.current);
      setCur(audio.currentTime);
      restoreRef.current = null;
      if (wantsPlay.current) play();
    }
  }
  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto]">
      <audio
        key={url}
        ref={audioRef}
        src={url || undefined}
        preload="metadata"
        className="hidden"
        onTimeUpdate={(e) => {
          if (audioRef.current === e.currentTarget) setCur(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => onMetadata(e.currentTarget)}
        onDurationChange={(e) => {
          if (audioRef.current === e.currentTarget)
            setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0);
        }}
        onPlay={(e) => {
          if (audioRef.current !== e.currentTarget || !wantsPlay.current) {
            e.currentTarget.pause();
            return;
          }
          setPlaying(true);
        }}
        onPause={(e) => {
          if (audioRef.current !== e.currentTarget || !e.currentTarget.paused) return;
          setPlaying(false);
          // 切音质的内部暂停需保留续播意图；系统媒体控制触发的暂停则应取消续播。
          if (restoreRef.current === null) {
            wantsPlay.current = false;
            ++playAttempt.current;
            setLoading(false);
          }
        }}
        onEnded={pause}
        onWaiting={() => {
          if (wantsPlay.current) setLoading(true);
        }}
        onPlaying={() => setLoading(false)}
        onCanPlay={() => setLoading(false)}
        onError={(e) => {
          if (audioRef.current !== e.currentTarget) return;
          pause();
          notifyError('音频加载失败：可能已下架、凭证过期或格式不受支持，请刷新详情后重试');
        }}
      />
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 lg:row-span-2">
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden border bg-muted text-muted-foreground">
          {coverUrl ? <img src={coverUrl} alt="" className="size-full object-cover" /> : <Music2 className="size-5" />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={title}>
            {title || '未命名曲目'}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={artist}>
            {artist || '未知艺术家'} · {loading ? '缓冲中' : playing ? '正在播放' : '已暂停'}
          </div>
        </div>
      </div>
      <Button
        className="col-start-2 row-start-1 justify-self-center"
        size="icon-lg"
        disabled={!url}
        aria-label={playing || loading ? '暂停' : '播放'}
        onClick={toggle}
      >
        {loading ? <LoaderCircle className="animate-spin" /> : playing ? <Pause /> : <Play />}
      </Button>
      <div className="col-span-3 row-start-2 min-w-0 lg:col-span-1 lg:col-start-2">
        <PlaybackProgress
          current={cur}
          duration={dur}
          onSeek={(time) => {
            if (restoreRef.current !== null) restoreRef.current = time;
            audioRef.current!.currentTime = time;
            setCur(time);
          }}
        />
      </div>
      <div className="col-span-3 row-start-3 flex flex-wrap items-center justify-between gap-2 lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:justify-end">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label={muted ? '取消静音' : '静音'}
            onClick={() => {
              setMuted(!muted);
              savePreference(MUTE_KEY, muted ? 'off' : 'on');
            }}
          >
            {muted || vol === 0 ? <VolumeX /> : <Volume2 />}
          </Button>
          <div className="w-16 shrink-0 sm:w-20">
            <Slider
              aria-label="音量"
              min={0}
              max={1}
              step={0.01}
              value={[vol]}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                setVol(next);
                setMuted(false);
                savePreference(VOL_KEY, String(next));
                savePreference(MUTE_KEY, 'off');
              }}
            />
          </div>
        </div>
        {sources.length > 1 && (
          <NativeSelect
            size="sm"
            aria-label="音质"
            value={index}
            className="max-w-44"
            onChange={(e) => {
              const next = Number(e.currentTarget.value);
              if (next === index) return;
              restoreRef.current = audioRef.current!.currentTime || cur;
              ++playAttempt.current;
              audioRef.current!.pause();
              setLoading(wantsPlay.current);
              setIdx(next);
            }}
          >
            {sources.map((s, i) => (
              <NativeSelectOption key={s.id ?? s.url} value={i}>
                {s.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {sources.some((s) => s.loudness != null) && (
          <Button
            size="sm"
            variant="outline"
            aria-pressed={normalize}
            onClick={() => {
              setNormalize(!normalize);
              savePreference(NORM_KEY, normalize ? 'off' : 'on');
            }}
            title={`响度均衡到 ${TARGET_LUFS} LUFS`}
          >
            响度均衡 {normalize ? '开' : '关'}
          </Button>
        )}
      </div>
      {onClose && (
        <Button
          className="col-start-3 row-start-1 justify-self-end lg:col-start-4 lg:row-span-2"
          size="icon"
          variant="ghost"
          aria-label="关闭播放器"
          onClick={() => {
            pause();
            onClose();
          }}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

function PlaybackProgress({
  current,
  duration,
  onSeek,
}: {
  current: number;
  duration: number;
  onSeek: (time: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(current)}</span>
      <Slider
        aria-label="播放进度"
        min={0}
        max={duration || 1}
        step={0.1}
        value={[Math.min(current, duration)]}
        disabled={!duration}
        onValueChange={(value) => onSeek(Array.isArray(value) ? value[0] : value)}
      />
      <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(duration)}</span>
    </div>
  );
}
