import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { Button } from './ui/button';
import { cn, formatDuration } from '../lib/utils';

export interface PlayerSource {
  id?: string;
  label: string;
  url: string;
  loudness?: number | null;
}
const TARGET_LUFS = -14;
const NORM_KEY = 'ommb.normalize';

export function AudioPlayer(props: { sources: PlayerSource[]; title?: string }) {
  // 曲目变化时销毁旧播放会话，阻止旧媒体事件污染下一首的进度和状态。
  return <PlayerSession key={props.sources[0]?.id ?? props.sources[0]?.url ?? ''} {...props} />;
}
function PlayerSession({ sources, title }: { sources: PlayerSource[]; title?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const restoreRef = useRef<{ time: number; playing: boolean } | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [normalize, setNormalize] = useState(() => localStorage.getItem(NORM_KEY) !== 'off');
  const index = Math.min(idx, Math.max(0, sources.length - 1));
  const source = sources[index];
  const url = source?.url ?? '';
  const multiplier =
    !normalize || source?.loudness == null ? 1 : Math.min(1, 10 ** ((TARGET_LUFS - source.loudness) / 20));

  useEffect(() => {
    const audio = audioRef.current!;
    if (audio.getAttribute('src') !== url) {
      restoreRef.current = { time: audio.currentTime || 0, playing: !audio.paused };
      audio.pause();
      if (url) audio.src = url;
      else audio.removeAttribute('src');
      audio.load();
      setLoading(false);
      setError('');
    }
  }, [url]);
  useEffect(() => {
    audioRef.current!.volume = muted ? 0 : vol * multiplier;
  }, [muted, vol, multiplier]);
  useEffect(() => {
    const audio = audioRef.current!;
    return () => {
      audio.pause();
    };
  }, []);

  function play() {
    const audio = audioRef.current!;
    const requested = audio.getAttribute('src');
    void audio.play().catch(() => {
      if (audioRef.current === audio && audio.getAttribute('src') === requested) {
        setLoading(false);
        setError('无法播放音频，请检查网络或更换音质');
      }
    });
  }
  function onMetadata() {
    const audio = audioRef.current!;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    setDur(duration);
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore) {
      audio.currentTime = Math.min(restore.time, duration || restore.time);
      setCur(audio.currentTime);
      if (restore.playing) play();
    }
  }
  return (
    <div className="rounded-lg border bg-card p-3">
      <audio
        ref={audioRef}
        preload="metadata"
        className="hidden"
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={onMetadata}
        onDurationChange={(e) => setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onCanPlay={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setPlaying(false);
          setError('音频加载失败：可能已下架、凭证过期或格式不受支持，请刷新详情后重试');
        }}
      />
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {title && <div className="mb-2 truncate text-sm font-medium">{title}</div>}
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          className="shrink-0 rounded-full"
          disabled={!url}
          aria-label={playing ? '暂停' : '播放'}
          onClick={() => {
            if (audioRef.current!.paused) play();
            else audioRef.current!.pause();
          }}
        >
          {loading ? <LoaderCircle className="animate-spin" /> : playing ? <Pause /> : <Play />}
        </Button>
        <div className="min-w-0 flex-1 space-y-1">
          <input
            type="range"
            aria-label="播放进度"
            min={0}
            max={dur || 0}
            step={0.1}
            value={Math.min(cur, dur)}
            disabled={!dur}
            className="h-2 w-full cursor-pointer accent-primary"
            onChange={(e) => {
              const time = Number(e.currentTarget.value);
              audioRef.current!.currentTime = time;
              setCur(time);
            }}
          />
          <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{formatDuration(cur)}</span>
            <span>{formatDuration(dur)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            aria-label={muted ? '取消静音' : '静音'}
            onClick={() => setMuted((value) => !value)}
          >
            {muted || vol === 0 ? <VolumeX /> : <Volume2 />}
          </Button>
          <input
            type="range"
            aria-label="音量"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            className="h-1 w-16 cursor-pointer accent-primary sm:w-20"
            onChange={(e) => {
              setVol(Number(e.currentTarget.value));
              setMuted(false);
            }}
          />
        </div>
      </div>
      {(sources.length > 1 || sources.some((s) => s.loudness != null)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
          {sources.length > 1 && (
            <>
              <span className="text-muted-foreground">音质</span>
              {sources.map((s, i) => (
                <Button
                  key={s.id ?? s.url}
                  size="sm"
                  variant={i === index ? 'default' : 'secondary'}
                  onClick={() => setIdx(i)}
                >
                  {s.label}
                </Button>
              ))}
            </>
          )}
          {sources.some((s) => s.loudness != null) && (
            <Button
              size="sm"
              variant="secondary"
              className={cn('ml-auto', normalize && 'bg-primary/10 text-primary')}
              onClick={() => {
                setNormalize(!normalize);
                localStorage.setItem(NORM_KEY, normalize ? 'off' : 'on');
              }}
              title={`响度均衡到 ${TARGET_LUFS} LUFS`}
            >
              响度均衡 {normalize ? '开' : '关'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
