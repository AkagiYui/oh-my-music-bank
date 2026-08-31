import { useEffect, useState, type RefObject } from 'react';
import { mergeRanges, missingRanges, WaveformPeaks, type TimeRange } from '../lib/audio-waveform';
import type { createWaveformReader } from '../lib/waveform-reader';

export function useAudioWaveform(audioRef: RefObject<HTMLAudioElement | null>, src: string) {
  const [waveform, setWaveform] = useState({ path: '', status: 'waiting', buffered: [] as TimeRange[] });
  useEffect(() => {
    const audio = audioRef.current!;
    let disposed = false;
    let running = false;
    let failed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReturnType<typeof createWaveformReader> | undefined;
    let peaks: WaveformPeaks | undefined;
    let decoded: TimeRange[] = [];
    let buffered: TimeRange[] = [];
    const publish = (status: string) => {
      if (!disposed) setWaveform({ path: peaks?.path() ?? '', status, buffered });
    };
    const collect = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      buffered = mergeRanges(
        Array.from({ length: audio.buffered.length }, (_, i) => ({
          start: Math.max(0, audio.buffered.start(i)),
          end: Math.min(audio.duration, audio.buffered.end(i)),
        })),
      );
    };
    async function run() {
      if (running || failed || disposed) return;
      collect();
      if (!missingRanges(buffered, decoded).length) return;
      running = true;
      publish('loading');
      try {
        if (!reader) {
          // 仅在播放器已有可用缓冲时加载解码器，不拖慢页面首屏，也不抢占音频焦点。
          const { createWaveformReader } = await import('../lib/waveform-reader');
          if (disposed) return;
          reader = createWaveformReader(src);
          peaks = new WaveformPeaks(audio.duration);
        }
        while (!disposed) {
          collect();
          const missing = missingRanges(buffered, decoded);
          // 跳播时优先处理当前播放位置附近的缓冲，随后再补齐其他已加载区间。
          const next = missing.find((r) => r.start <= audio.currentTime && r.end > audio.currentTime) ?? missing[0];
          if (!next) break;
          const range = { start: next.start, end: Math.min(next.end, next.start + 5) };
          for await (const { buffer, timestamp } of reader.buffers(range)) {
            if (disposed) return;
            peaks!.add(buffer, timestamp, range);
          }
          decoded = mergeRanges([...decoded, range]);
          publish('loading');
          // 每五秒音频让出主线程，长视频解码不阻塞裁剪拖动。
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        publish('ready');
      } catch {
        if (!disposed) {
          failed = true;
          reader?.dispose();
          publish('unavailable');
        }
      } finally {
        running = false;
      }
    }
    const schedule = () => {
      if (timer !== undefined || disposed) return;
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, 100);
    };
    const events = ['loadedmetadata', 'loadeddata', 'progress', 'seeked', 'canplay', 'durationchange'];
    events.forEach((event) => audio.addEventListener(event, schedule));
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      events.forEach((event) => audio.removeEventListener(event, schedule));
      reader?.dispose();
    };
  }, [audioRef, src]);
  return waveform;
}
