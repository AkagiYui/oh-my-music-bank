import { AudioBufferSink, CustomSource, Input, MP4, FLAC, WAVE, MP3, ADTS, OGG, WEBM } from 'mediabunny';
import type { TimeRange } from './audio-waveform';

const blockSize = 128 * 1024;

// 原生 audio 不公开缓冲字节。使用同一受保护地址读取有限 Range，禁止自动退回整文件下载。
export function createWaveformReader(src: string) {
  const controller = new AbortController();
  const blocks = new Map<number, Uint8Array>();
  let size = 0;
  async function fetchRange(start: number, end: number) {
    const response = await fetch(src, {
      headers: { Range: `bytes=${start}-${end - 1}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    });
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
    if (response.status !== 206 || !match || Number(match[1]) !== start || Number(match[2]) !== end - 1) {
      await response.body?.cancel();
      throw new Error('音频服务未提供有效的分段响应');
    }
    const total = Number(match[3]);
    if (!Number.isSafeInteger(total) || total < end || (size && total !== size)) {
      await response.body?.cancel();
      throw new Error('音频分段大小发生变化');
    }
    size = total;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== end - start) throw new Error('音频分段不完整');
    return bytes;
  }
  const input = new Input({
    formats: [MP4, FLAC, WAVE, MP3, ADTS, OGG, WEBM],
    source: new CustomSource({
      getSize: async () => {
        await fetchRange(0, 1);
        return size;
      },
      read: async (start, end) => {
        const result = new Uint8Array(end - start);
        for (let offset = Math.floor(start / blockSize) * blockSize; offset < end; offset += blockSize) {
          let block = blocks.get(offset);
          if (!block) {
            block = await fetchRange(offset, Math.min(size, offset + blockSize));
            // 最多缓存 4 MiB 编码数据，换源时连同请求一起释放。
            if (blocks.size >= 32) blocks.delete(blocks.keys().next().value!);
            blocks.set(offset, block);
          }
          const from = Math.max(start, offset);
          const to = Math.min(end, offset + block.length);
          result.set(block.subarray(from - offset, to - offset), from - start);
        }
        return result;
      },
      maxCacheSize: 1024 * 1024,
      prefetchProfile: 'none',
      dispose: () => {
        controller.abort();
        blocks.clear();
      },
    }),
  });
  let sink: AudioBufferSink | undefined;
  return {
    async *buffers(range: TimeRange) {
      if (!sink) {
        const track = await input.getPrimaryAudioTrack();
        if (!track || !(await track.canDecode())) throw new Error('浏览器不支持此音频的波形解码');
        sink = new AudioBufferSink(track);
      }
      yield* sink.buffers(range.start, range.end);
    },
    dispose: () => input.dispose(),
  };
}
