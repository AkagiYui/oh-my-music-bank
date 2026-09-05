/**
 * 网易云听歌识曲的音频指纹在浏览器里计算。
 *
 * 指纹算法只存在于网易官方 Chrome 扩展的 afp.wasm 里，本仓库不分发这个文件：
 * 由管理员在集成配置中触发后端从 Chrome 应用店拉取并校验哈希，前端按需取回。
 * 第三方代码全部跑在 Worker 里，不进主页面；wasm 本身没有网络或存储导入，只做纯计算。
 */
import { api } from './api';

const WASM_NAME = 'afp.wasm';
const GLUE_NAME = 'sandbox.bundle.js';
/** 指纹窗口固定 6 秒，8kHz 下恰好 48000 个样点。 */
export const NETEASE_SEGMENT_SEC = 6;

// Worker 里运行的驱动：按扩展 sandbox 页自己的 message 协议喂数据，不触碰其内部实现。
const WORKER_SOURCE = String.raw`
let listener = null;
let wasmBytes = null;
let resolveWasm = null;

self.window = {
  addEventListener: function (type, fn) { if (type === 'message') listener = fn; },
  removeEventListener: function () {},
};
self.document = {
  currentScript: { src: self.location.href },
  baseURI: self.location.href,
  createElement: function () { return { style: {} }; },
  addEventListener: function () {},
};
// 胶水在 web 分支会 fetch 同目录下的 afp.wasm，这里直接回本地字节，杜绝任何外部请求。
self.fetch = function () {
  return Promise.resolve({ ok: true, arrayBuffer: function () { return Promise.resolve(wasmBytes); } });
};
WebAssembly.instantiateStreaming = undefined;
const instantiate = WebAssembly.instantiate.bind(WebAssembly);
WebAssembly.instantiate = function (bin, imports) {
  return instantiate(bin, imports).then(function (res) {
    if (resolveWasm) setTimeout(resolveWasm, 0);
    return res;
  });
};

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// 扩展的录音器按 128 帧攒够 48000 个样点才出指纹，这里照它的节奏喂完整段。
function fingerprint(pcm) {
  listener({ data: { type: 'reset' }, source: { postMessage: function () {} } });
  let out = null;
  for (let i = 0; i < pcm.length && !out; i += 128) {
    listener({
      data: { type: 'record', data: [pcm.subarray(i, i + 128)] },
      source: { postMessage: function (msg) { if (msg.data) out = msg.data; } },
    });
  }
  return out;
}

self.onmessage = function (event) {
  const msg = event.data;
  if (msg.type === 'init') {
    wasmBytes = msg.wasm;
    const loaded = new Promise(function (resolve) { resolveWasm = resolve; });
    try {
      self.importScripts(URL.createObjectURL(new Blob([msg.glue], { type: 'text/javascript' })));
    } catch (err) {
      self.postMessage({ type: 'error', message: '指纹模块加载失败：' + err });
      return;
    }
    loaded.then(function () {
      if (listener) self.postMessage({ type: 'ready' });
      else self.postMessage({ type: 'error', message: '指纹模块未注册消息接口' });
    });
    return;
  }
  if (msg.type === 'fingerprint') {
    try {
      const out = fingerprint(msg.pcm);
      if (!out) {
        self.postMessage({ type: 'error', message: '音频样点不足，无法生成指纹' });
        return;
      }
      self.postMessage({ type: 'fingerprint', rawdata: toBase64(out.result) });
    } catch (err) {
      self.postMessage({ type: 'error', message: '指纹计算失败：' + err });
    }
  }
};
`;

let booting: Promise<Worker> | null = null;
let current: Worker | null = null;

async function ensureWorker(): Promise<Worker> {
  if (!booting) {
    booting = (async () => {
      const [wasm, glueBuffer] = await Promise.all([
        api.admin.integrations.neteaseAfpAsset(WASM_NAME),
        api.admin.integrations.neteaseAfpAsset(GLUE_NAME),
      ]);
      const glue = new TextDecoder().decode(glueBuffer);
      const worker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = (event) => {
          if (event.data?.type === 'ready') resolve();
          else reject(new Error(event.data?.message ?? '指纹模块初始化失败'));
        };
        worker.onerror = () => reject(new Error('指纹 Worker 启动失败'));
        worker.postMessage({ type: 'init', wasm, glue }, [wasm]);
      });
      current = worker;
      return worker;
    })();
    // 初始化失败不缓存，下次调用可重试（例如资源刚拉取完）。
    booting.catch(() => {
      booting = null;
    });
  }
  return booting;
}

/**
 * 计算一段 8kHz 单声道浮点 PCM 的网易云指纹，返回 base64 的 rawdata。
 * pcm 的底层缓冲会被转移给 Worker，调用后不要再复用。
 */
export async function computeNeteaseFingerprint(pcm: Float32Array): Promise<string> {
  const worker = await ensureWorker();
  return new Promise<string>((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data?.type === 'fingerprint') resolve(event.data.rawdata as string);
      else reject(new Error(event.data?.message ?? '指纹计算失败'));
    };
    worker.onerror = () => reject(new Error('指纹 Worker 执行失败'));
    worker.postMessage({ type: 'fingerprint', pcm }, [pcm.buffer]);
  });
}

/** 指纹资源被重新拉取或移除后丢弃当前 Worker，下次识别重新加载。 */
export function resetNeteaseFingerprint() {
  current?.terminate();
  current = null;
  booting = null;
}
