# 波形回归样本

`waveform.m4a` 是自行合成的 24 秒 AAC/分片 MP4 音频（含 sidx 索引与每两秒一个 moof 分片），不含外部录音。包含每 6 秒一次的静音与变化振幅的 440 Hz 正弦波，用于验证浏览器实际分段解码，而非模拟解码器。

生成命令（需要 FFmpeg，仅重新生成样本时执行）：

```sh
ffmpeg -f lavfi -i 'aevalsrc=0.65*sin(2*PI*440*t)*(0.15+0.85*abs(sin(2*PI*0.8*t)))*gt(mod(t\,6)\,1):s=44100:d=24' -c:a aac -b:a 128k -movflags +frag_keyframe+empty_moov+default_base_moof+global_sidx -frag_duration 2000000 waveform.m4a
```
