export type TimeRange = { start: number; end: number };

// 区间按真实时间合并，跳播留下的空白不能当成已经加载的音频。
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const merged: TimeRange[] = [];
  for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) continue;
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function missingRanges(buffered: TimeRange[], decoded: TimeRange[]): TimeRange[] {
  const missing: TimeRange[] = [];
  for (const range of buffered) {
    let start = range.start;
    for (const done of decoded) {
      if (done.end <= start) continue;
      if (done.start >= range.end) break;
      if (done.start > start) missing.push({ start, end: done.start });
      start = Math.max(start, done.end);
    }
    if (start < range.end) missing.push({ start, end: range.end });
  }
  return missing;
}

export class WaveformPeaks {
  // 固定桶数，长音频也只保存峰值，不积累整段 PCM；-1 表示尚未解码，0 才表示静音。
  readonly peaks = new Float32Array(1600).fill(-1);

  constructor(readonly duration: number) {}

  add(
    buffer: Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>,
    timestamp: number,
    range: TimeRange,
  ) {
    const first = Math.max(0, Math.ceil((Math.max(0, range.start) - timestamp) * buffer.sampleRate));
    const last = Math.min(
      buffer.length,
      Math.ceil((Math.min(this.duration, range.end) - timestamp) * buffer.sampleRate),
    );
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = first; i < last; i++) {
        const bin = Math.floor(((timestamp + i / buffer.sampleRate) / this.duration) * this.peaks.length);
        if (bin < 0 || bin >= this.peaks.length) continue;
        // 各声道取绝对峰值，避免左右声道反相抵消；统一振幅刻度，不随加载进度重新归一化。
        this.peaks[bin] = Math.max(this.peaks[bin], Math.min(1, Math.abs(samples[i])));
      }
    }
  }

  path() {
    const bars: string[] = [];
    for (let i = 0; i < this.peaks.length; i++) {
      if (this.peaks[i] < 0) continue;
      const height = Math.max(0.6, this.peaks[i] * 46);
      bars.push(`M${i},${(50 - height).toFixed(2)}v${(height * 2).toFixed(2)}h1v-${(height * 2).toFixed(2)}Z`);
    }
    return bars.join('');
  }
}
