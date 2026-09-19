import { KokoroTTS } from "kokoro-js";
import { detectWebGPU } from "./utils.js";
import { env } from "@huggingface/transformers"; 

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = `${location.origin}/models`;

// Configura o caminho específico para os binários do ONNX Runtime
env.backends.onnx.wasm.wasmPaths = `${location.origin}/onnx-runtime-web/`

// Device detection
const device = (await detectWebGPU()) ? "webgpu" : "wasm";
self.postMessage({ status: "device", device });

// Load the model
//const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
const localPath = "kokoro-82m-timestamps";

const tts = await KokoroTTS.from_pretrained(localPath, {
  dtype: device === "wasm" ? "q8" : "fp32",
  device,
  // Aqui carregamos os arquivos de vozes para Português (p), Espanhol (e), etc.
  voices: [
    "af_heart", "af_bella", // Originais Inglês
    "bf_emma", "bm_george", // Britânico
    "pf_dora", "pm_alex",   // Português (Brasil)
    "ef_dora", "em_alex",    // Espanhol
    "zf_xiaobei", "zm_yunyang", // Chinês
  ] 
}).catch((e) => {
  self.postMessage({ status: "error", error: e.message });
  throw e;
});
self.postMessage({ status: "ready", voices: tts.voices, device });

// Listen for messages from the main thread
// self.addEventListener("message", async (e) => {
//   const { text, voice, isWord, wordIndex } = e.data;

//   // Generate speech
//   // Send the audio file back to the main thread
//   const audio = await tts.generate(text, { voice });
//     const blob = audio.toBlob();
//     self.postMessage({ 
//       status: "complete", 
//       audio: URL.createObjectURL(blob), 
//       text,
//       isWord: isWord || false,
//       wordIndex: wordIndex ?? null
//     });

//   //self.postMessage({ status: "complete", audio: URL.createObjectURL(blob), text });
// });

// ... (mantenha as importações e o carregamento do modelo igual)

self.addEventListener("message", async (e) => {
  const { text, voice, speed, id } = e.data;

  try {
    const tStart = performance.now();
    
    // Chamamos o generate que agora retorna { audio, wordTimestamps, durations }
    const result = await tts.generate(text, { 
      voice, 
      speed 
    });

    console.log("worker result", result)

    const rawAudio = result.audio;
    const tEnd = performance.now();
    const duration = rawAudio.audio.length / rawAudio.sample_rate;

    //const blob = rawAudio.audio//.toBlob();
    //const audioUrl = URL.createObjectURL(blob);
    const wavBlob = encodeWav(rawAudio.audio, rawAudio.sampling_rate);
    const audioUrl = URL.createObjectURL(wavBlob);


    // Se o alinhamento falhar ou não existir, usamos um fallback vazio
    // mas como você está usando o modelo 'timestamped', result.wordTimestamps deve vir preenchido.
    console.log("result.wordTimestamps", result.wordTimestamps);
    const wordsData = result.phonemeMap || text.split(/\s+/).map(w => ({
      word: w,
      start: 0,
      end: 0
    }));

    self.postMessage({ 
      status: "complete", 
      id, // Importante para o React saber qual áudio é qual
      audio: audioUrl, 
      text,
      words: wordsData, // Timestamps REAIS vindos do pred_dur do ONNX
      info: {
        latency: `${(tEnd - tStart).toFixed(0)}ms`,
        duration: `${duration.toFixed(2)}s`,
        sampleRate: `${rawAudio.sampling_rate}Hz`,
        device: tts.model.device,
        dtype: tts.model.config.torch_dtype || "float32",
        numSamples: rawAudio.audio.length,
        phonemes: result.phonemes // Opcional: para debug na UI
      }
    });

  } catch (err) {
    console.error("Worker Error:", err);
    self.postMessage({ status: "error", data: err.message });
  }
});










function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

function writeWavHeader(samples, sampleRate) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  return buffer;
}

function encodeWav(float32Array, sampleRate) {
  const header = writeWavHeader(float32Array, sampleRate);
  const pcm = floatTo16BitPCM(float32Array);
  return new Blob([header, pcm], { type: "audio/wav" });
}
