import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { AudioPlayer, type PlayerControls, type PlayerSource } from './AudioPlayer';
import { Button } from './ui/button';
import { useAuth } from '../stores/auth';
import { useSiteConfig } from './SiteBranding';
import { resolveAPIOrigin } from '../lib/site';
import type { TrackDTO } from '../lib/api';

export interface PlaybackTrack {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
  sources: PlayerSource[];
}
const PlayerContext = createContext<{
  track: PlaybackTrack | null;
  playing: boolean;
  start: (track: PlaybackTrack) => void;
  close: () => void;
} | null>(null);

export function GlobalPlayerProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<PlaybackTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const controls = useRef<PlayerControls>(null);
  function close() {
    controls.current?.pause();
    setTrack(null);
    setPlaying(false);
  }
  return (
    <PlayerContext
      value={{
        track,
        playing,
        close,
        start: (next) => {
          if (!next.sources.length) return;
          if (track?.id === next.id) {
            // 再次点击同一曲目只暂停或继续，不重置进度和选中的音质；同时刷新临时音频地址。
            setTrack(next);
            controls.current?.toggle();
          } else {
            controls.current?.pause();
            setPlaying(false);
            setTrack(next);
          }
        },
      }}
    >
      {children}
      {track && (
        <PlayerDock>
          <AudioPlayer
            trackKey={track.id}
            sources={track.sources}
            title={track.title}
            artist={track.artist}
            coverUrl={track.coverUrl}
            autoPlay
            controlsRef={controls}
            onPlayingChange={setPlaying}
            onClose={close}
          />
        </PlayerDock>
      )}
    </PlayerContext>
  );
}

function PlayerDock({ children }: { children: ReactNode }) {
  const dock = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = dock.current!;
    // 按真实高度为页面和通知让位，兼容小屏换行、缩放和底部安全区。
    const update = () =>
      document.documentElement.style.setProperty(
        '--global-player-height',
        `${element.getBoundingClientRect().height}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--global-player-height');
    };
  }, []);
  return (
    <>
      <div aria-hidden="true" style={{ height: 'var(--global-player-height, 0px)' }} />
      <section
        ref={dock}
        aria-label="全局播放器"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur"
      >
        {children}
      </section>
    </>
  );
}

export function useGlobalPlayer() {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('播放器必须位于 GlobalPlayerProvider 内');
  return player;
}

/** 账号或 API 部署变化时清理旧会话，不把短期签名 URL 持久化到本地存储。 */
export function PlayerSessionBoundary() {
  const { user } = useAuth();
  const { apiOrigin } = useSiteConfig();
  const { close } = useGlobalPlayer();
  const identity = `${user?.id ?? ''}:${resolveAPIOrigin(apiOrigin)}`;
  const previous = useRef(identity);
  useEffect(() => {
    if (previous.current !== identity) {
      previous.current = identity;
      close();
    }
  }, [identity, close]);
  return null;
}

/** 页面只保留播放入口；音频元素与播放进度始终由根布局持有。 */
export function TrackPlayButton({ track, origin = window.location.origin }: { track: TrackDTO; origin?: string }) {
  const player = useGlobalPlayer();
  const id = `${origin}:${track.id}`;
  const active = player.track?.id === id;
  return (
    <Button
      variant={active ? 'secondary' : 'default'}
      disabled={!track.audios?.length}
      aria-label={`${active && player.playing ? '暂停' : '播放'} ${track.title}`}
      onClick={() =>
        player.start({
          id,
          title: track.title,
          artist: track.artists.map((a) => a.name).join(' / ') || '未知艺术家',
          coverUrl: track.coverUrl,
          sources: (track.audios ?? []).map((audio) => ({
            id: audio.id,
            label: `${audio.qualityLabel} · ${Math.round(audio.bitrate / 1000)}kbps`,
            url: audio.url,
            loudness: audio.loudness,
          })),
        })
      }
    >
      {active && player.playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
      {active ? (player.playing ? '暂停播放' : '继续播放') : '播放'}
    </Button>
  );
}
