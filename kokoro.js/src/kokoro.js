import { env as hf, StyleTextToSpeech2Model, AutoTokenizer, Tensor, RawAudio } from "@huggingface/transformers";
import { normalize_text, phonemize } from "./phonemize.js";
import { TextSplitterStream } from "./splitter.js";
import { getVoiceData, VOICES } from "./voices.js";
import { phonemize as espeakng } from "./espeakng/phonemizer.js";

export function configKokoroEnv(serverBaseUrl, customCache = null) {
  hf.allowLocalModels = true;
  hf.allowRemoteModels = false;
  hf.localModelPath = `${serverBaseUrl}/models/`;
  hf.backends.onnx.wasm.wasmPaths = `${serverBaseUrl}/onnx-runtime-web/`;

  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 : 4;
  hf.backends.onnx.wasm.numThreads = Math.max(1, cores);

  if (customCache) {
    hf.useCustomCache = true;
    hf.customCache = customCache;
  }
}

const STYLE_DIM = 256;
const SAMPLE_RATE = 24000;

/**
 * @typedef {Object} GenerateOptions
 * @property {keyof typeof VOICES} [voice="af_heart"] The voice
 * @property {number} [speed=1] The speaking speed
 * @property {number} [groupSize=1] Group 
 */

/**
 * @typedef {Object} StreamProperties
 * @property {RegExp} [split_pattern] The pattern to split the input text. If unset, the default sentence splitter will be used.
 * @typedef {GenerateOptions & StreamProperties} StreamGenerateOptions
 */

export class KokoroTTS {
  /**
   * Create a new KokoroTTS instance.
   * @param {import('@huggingface/transformers').StyleTextToSpeech2Model} model The model
   * @param {import('@huggingface/transformers').PreTrainedTokenizer} tokenizer The tokenizer
   */
  constructor(model, tokenizer) {
    this.model = model;
    this.tokenizer = tokenizer;
  }

  /**
   * Load a KokoroTTS model from the Hugging Face Hub.
   * @param {string} model_id The model id
   * @param {Object} options Additional options
   * @param {"fp32"|"fp16"|"q8"|"q4"|"q4f16"} [options.dtype="fp32"] The data type to use.
   * @param {"wasm"|"webgpu"|"cpu"|null} [options.device=null] The device to run the model on.
   * @param {import("@huggingface/transformers").ProgressCallback} [options.progress_callback=null] A callback function that is called with progress information.
   * @returns {Promise<KokoroTTS>} The loaded model
   */
  static async from_pretrained(model_id, { dtype = "fp32", device = null, progress_callback = null } = {}) {
    const model = StyleTextToSpeech2Model.from_pretrained(model_id, { 
      subfolder: "onnx",
      progress_callback, dtype, device 
    });
    const tokenizer = AutoTokenizer.from_pretrained(model_id, { 
      progress_callback 
    });

    const info = await Promise.all([model, tokenizer]);
    return new KokoroTTS(...info);
  }

  get voices() {
    return VOICES;
  }

  list_voices() {
    console.table(VOICES);
  }

    /**
   * Validate input voice against supported voices
   *
   * @param {string} voice The voice to validate
   */
  _validate_voice(voice) {
    if (!VOICES.hasOwnProperty(voice)) {
      console.error(`Voice "${voice}" not found. Available voices:`);
      console.table(VOICES);
      throw new Error(`Voice "${voice}" not found. Should be one of: ${Object.keys(VOICES).join(", ")}.`);
    }
    const language = /** @type {"a"|"b"|"z"|"e"|"p"} */ (voice.at(0)); // "a" or "b" or "z" or "e" or "p"
    return language;
  }

/**
 * Generate audio from text.
 *
 * @param {string} text The input text
 * @param {GenerateOptions} options Additional options
 * @returns {Promise<{audio: { audio: Float32Array<ArrayBufferLike>, sampling_rate: number }, phonemeMap: { word: string; start: number; end: number;}[]}>} The generated audio        wordTimestamps: { word: string, start: number, end: number; phonemes: string }[]
 */
async generate(text, { voice = "af_heart", speed = 1 } = {}) {
  console.log("Entrou em generate")
  const language = this._validate_voice(voice);

  const chunks = await this.splitTextIntoChunks(text, 500, language);

  const batchAudio = [];
  const batchAlignments = [];
  let globalTimeOffset = 0.0;
  let sampleRate = 24000;

  for (const chunk of chunks) {
    const { phonemes, wordMap } = await this.phonemize(chunk, language);

    const { input_ids } = await this.tokenizer(phonemes, { truncation: true });
    const result = await this.generate_from_ids(input_ids, { voice, speed });

    const audio = result.audio;
    sampleRate = audio.sampling_rate;
    const audioSec = audio.audio.length / audio.sampling_rate;

    // Se não usar durations, você pode pular buildWordAlignments
    const pred_dur = Array.from(result.durations || []);
    const alignments = this.buildWordAlignments(
      pred_dur,
      wordMap,
      audio.audio.length,
      audio.sampling_rate,
      //speed
    );

    for (const al of alignments) {
      batchAlignments.push({
        word: al.word,
        start: al.start + globalTimeOffset,
        end: al.end + globalTimeOffset
      });
    }

    // FIX: Substitui o spread operator (...) por um loop para evitar 
    // "Maximum call stack size exceeded" em áudios longos.
    for (let i = 0; i < audio.audio.length; i++) {
        batchAudio.push(audio.audio[i]);
    }
    
    globalTimeOffset += audioSec;
  }

  const rawAudio = {
    audio: Float32Array.from(batchAudio),
    sampling_rate: sampleRate
  };

  console.log("rawAudio", rawAudio)
  console.log("batchAlignments", batchAlignments)

  return {
    audio: rawAudio,
    phonemeMap: batchAlignments
  };
}

async splitTextIntoChunks(text, maxTokens, lan) {
  console.log("Entrou em splitTextIntoChunks")
  const chunks = [];
  const sentences = text.split(/[.!?;]/).filter(s => s.trim().length > 0);

  let currentChunk = "";

  for (let sentence of sentences) {
    sentence = sentence.trim() + ".";

    const sentencePhonemes = (await espeakng(sentence, lan)).join("");
    const { input_ids: sent_ids } = await this.tokenizer(sentencePhonemes, { truncation: true });
    const tokenCount = sent_ids.ort_tensor.cpuData.length;

    if (tokenCount > maxTokens) {
      const words = sentence.split(/\s+/);
      let wordChunk = "";

      for (let word of words) {
        const testChunk = wordChunk ? `${wordChunk} ${word}` : word;
        const testPhonemes = (await espeakng(testChunk, lan)).join("");
        const { input_ids: test_ids } = await this.tokenizer(testPhonemes, { truncation: true });
        const testTokens = test_ids.ort_tensor.cpuData.length;

        if (testTokens > maxTokens) {
          if (wordChunk) chunks.push(wordChunk);
          wordChunk = word;
        } else {
          wordChunk = testChunk;
        }
      }
      if (wordChunk) chunks.push(wordChunk);
    } else if (currentChunk) {
      const testText = `${currentChunk} ${sentence}`;
      const testPhonemes = (await espeakng(testText, lan)).join("");
      const { input_ids: test_ids } = await this.tokenizer(testPhonemes, { truncation: true });
      const testTokens = test_ids.ort_tensor.cpuData.length;

      if (testTokens > maxTokens) {
        chunks.push(currentChunk);
        currentChunk = sentence;
      } else {
        currentChunk = testText;
      }
    } else {
      currentChunk = sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

buildWordAlignments(durations, wordMap, audioLength, sampleRate = 24000, gap = 0.087) {
  console.log("Entrou em buildWordAlignments");
  const audioSec = audioLength / sampleRate;

  // filtra apenas palavras válidas
  const validWords = wordMap.filter(w => w.end > w.start);

  const tokenCounts = validWords.map(w => w.end - w.start);
  const totalTokens = tokenCounts.reduce((a, b) => a + b, 0);
  if (totalTokens === 0) return [];

  const alignments = [];
  let cursor = 0;
  for (let i = 0; i < validWords.length; i++) {
    console.log("i1", i)
    if (tokenCounts[i] === 0) continue;
    const dur = (tokenCounts[i] / totalTokens) * audioSec;
    let startSec = cursor;
    let endSec = cursor + dur;
    if (i > 0 && i < validWords.length - 1) {
      startSec += gap / 2;
      endSec   -= gap / 2;
    }
    alignments.push({ word: validWords[i].word, start: startSec, end: endSec });
    cursor = endSec;
  }

  // snap simples: garante que cada fim < início da próxima
  for (let i = 0; i < alignments.length - 1; i++) {
    console.log("i2", i)
    if (alignments[i].end > alignments[i+1].start) {
      alignments[i].end = alignments[i+1].start - 0.01;
      if (alignments[i].end < alignments[i].start) {
        alignments[i].end = alignments[i].start;
      }
    }
  }

  if (alignments.length > 0) {
    const last = alignments[alignments.length - 1];
    last.end = audioSec;
    if (last.end < last.start) last.end = last.start;
  }

  return alignments;
}

async phonemize(text, language = "a", norm = true) {
  console.log("Entrou em phonemize")
  if (norm) text = normalize_text(text);

  const langMap = { a: "en-us", b: "en-gb", p: "pt-br", e: "es", z: "cmn" };
  const lan = langMap[language] || "en-us";

  // Fonemas da frase inteira
  const fullPhonemes = (await espeakng(text, lan)).join("");

  // Tokenização completa via tokenizer do modelo
  const { input_ids: allTokens } = await this.tokenizer(fullPhonemes, { truncation: true });
  const targetLen = allTokens.ort_tensor.cpuData.length;

  // Split em palavras + pontuação isolada
  function splitWordsAndPunct(s) {
    const out = [];
    for (const raw of s.split(/\s+/)) {
      if (/^[.,!?:;]+$/.test(raw)) {
        out.push(raw);
      } else {
        out.push(raw);
      }
    }
    return out;
  }

  const items = splitWordsAndPunct(text);

  // Conta tokens por item
  const perItemCounts = [];
  const perItemIsPunct = [];
  for (const it of items) {
    if (it.length === 1 && ".,!?:;".includes(it)) {
      perItemCounts.push(0);
      perItemIsPunct.push(true);
      continue; // não adiciona ao wordMap
    } else {
      const ph = (await espeakng(it, lan)).join("");
      const { input_ids } = await this.tokenizer(ph, { truncation: true });
      perItemCounts.push(input_ids.ort_tensor.cpuData.length);
      perItemIsPunct.push(false);
    }
  }

  // Rescale counts para bater com targetLen
  let sumCounts = perItemCounts.reduce((a, b) => a + b, 0);
  console.log("sumCounts", sumCounts)
  console.log("targetLen", targetLen)
  let adjustedCounts = [...perItemCounts];
  if (sumCounts !== targetLen && sumCounts > 0) {
    const scale = targetLen / sumCounts;
    let fractional = [];
    let newSum = 0;
    for (let i = 0; i < perItemCounts.length; i++) {
      console.log("phonetize i", i)
      if (!perItemIsPunct[i]) {
        const scaled = perItemCounts[i] * scale;
        let floored = Math.floor(scaled);

        // 🔧 mínimo de 2 tokens para palavras de uma letra
        if (items[i].length === 1) {
          floored = Math.max(2, floored);
        } else {
          floored = Math.max(1, floored);
        }

        adjustedCounts[i] = floored;
        newSum += floored;
        fractional.push([i, scaled - floored]);
      } else {
        adjustedCounts[i] = 0;
      }
    }
    let remaining = targetLen - newSum;
    fractional.sort((a, b) => b[1] - a[1]);
    for (const [i] of fractional) {
      if (remaining === 0) break;
      adjustedCounts[i]++;
      remaining--;
    }
  }

  // Construir wordMap com spans
  const wordMap = [];
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    const cnt = adjustedCounts[i];
    if (perItemIsPunct[i]) {
      wordMap.push({ word: items[i], start: cursor, end: cursor });
    } else {
      wordMap.push({ word: items[i], start: cursor, end: cursor + cnt });
      cursor += cnt;
    }
  }
  if (cursor < targetLen) {
    for (let i = wordMap.length - 1; i >= 0; i--) {
      if (wordMap[i].start < wordMap[i].end) {
        wordMap[i].end = targetLen;
        break;
      }
    }
  }

  return { phonemes: fullPhonemes, tokens: allTokens.ort_tensor.cpuData, wordMap };
}








/*async generate(text, { voice = "af_heart", speed = 1 } = {}) {
  const language = this._validate_voice(voice);

  // 1. Fonemas
  const { phonemes, tokens: phonemeTokens } = await phonemize(text, language);

  // 2. Tokeniza para IDs (frase inteira)
  const { input_ids } = this.tokenizer(phonemes, { truncation: true });
  const idsArray = Array.from(input_ids.ort_tensor.cpuData);

  // 3. Inferência
  const result = await this.generate_from_ids(input_ids, { voice, speed });
  const pred_dur = result.durations;

  // 3.1 Duração real do áudio
  const rawAudio = result.audio;
  const totalAudioTime = rawAudio.audio.length / rawAudio.sampling_rate;

  // 3.2 Frames totais e overhead (BOS/EOS)
  const totalFrames = pred_dur.reduce((a, b) => a + b, 0);
  const overheadFrames = (pred_dur[0] || 0) + (pred_dur[pred_dur.length - 1] || 0);
  const usableFrames = totalFrames - overheadFrames;

  // 4. Construir phonemeMap consumindo frames
  let durIndex = 1; // pula BOS
  let consumedFrames = 0;
  const phonemeMap = [];
  let currentTime = 0;

  for (const ph of phonemeTokens) {
    // tokenizar o fonema para saber quantos IDs ele ocupa
    const { input_ids: ph_ids } = this.tokenizer(ph, { truncation: true, add_special_tokens: false });
    const phIdsArray = Array.from(ph_ids.ort_tensor.cpuData);

    const start_ts = currentTime;
    let end_ts = start_ts;

    for (let j = 0; j < phIdsArray.length; j++) {
      const d = pred_dur[durIndex] || 0;
      consumedFrames += d;
      durIndex++;
      // temporariamente acumula em tempo bruto (sem divisor)
      end_ts += d; 
    }

    phonemeMap.push({
      phoneme: ph,
      // guardamos tempo em "frames brutos" por enquanto
      start_raw: start_ts,
      end_raw: end_ts
    });

    // atualiza currentTime para o fim bruto do cluster
    currentTime = end_ts;
  }

  // 5. Absorver frames restantes (pausas, EOS, etc.) no último fonema
  const remainingFrames = usableFrames - consumedFrames;
  if (remainingFrames > 0 && phonemeMap.length > 0) {
    phonemeMap[phonemeMap.length - 1].end_raw += remainingFrames;
    currentTime += remainingFrames;
  }

  // 6. Converter frames brutos em segundos com um único divisor global
  //    O divisor é calculado para que o último end bata com totalAudioTime.
  const MAGIC_DIVISOR = (currentTime / totalAudioTime) * 0.9; // frames_brutos_por_segundo
  // opcional: leve ajuste fino
  // const CALIBRATION_FACTOR = 1.0;
  // const MAGIC_DIVISOR = (currentTime / totalAudioTime) * CALIBRATION_FACTOR;

  // 7. Normalizar todos os fonemas para segundos
  const normalizedPhonemeMap = phonemeMap.map(p => ({
    phoneme: p.phoneme,
    start: parseFloat((p.start_raw / MAGIC_DIVISOR).toFixed(4)),
    end: parseFloat((p.end_raw / MAGIC_DIVISOR).toFixed(4))
  }));

  // 8. Garantir que o último fonema termina exatamente no fim do áudio
  if (normalizedPhonemeMap.length > 0) {
    normalizedPhonemeMap[normalizedPhonemeMap.length - 1].end = parseFloat(totalAudioTime.toFixed(4));
  }

  // Logs úteis
  console.log("MAGIC_DIVISOR", MAGIC_DIVISOR, "totalAudioTime", totalAudioTime);
  console.log("consumedFrames", consumedFrames, "usableFrames", usableFrames, "remainingFrames", remainingFrames);

  return {
    ...result,
    phonemes,
    phonemeMap: normalizedPhonemeMap
  };
}*/







//   /**
//    * Generate audio from text.
//    *
//    * @param {string} text The input text
//    * @param {GenerateOptions} options Additional options
//    * @returns {Promise<{audio: RawAudio, durations: Float32Array, wordTimestamps: { word: string, start: number, end: number; phonemes: string[] }[], phonemeMap: { char: string; start: number; end: number; frames: number}[]}>} The generated audio
//    */
// async generate(text, { voice = "af_heart", speed = 1 } = {}) {
//   const language = this._validate_voice(voice);

//   // 1. Gera os fonemas
//   const phonemes = await phonemize(text, language);
  
//   // 2. Tokeniza (isso gera os IDs que vão para o ONNX)
//   const { input_ids } = this.tokenizer(phonemes, { truncation: true });

//   // 3. Executa a inferência (agora com o modelo timestamped)
//   const result = await this.generate_from_ids(input_ids, { voice, speed });

//   let wordTimestamps;
//   let phonemeMap;
  
//   // 4. Se o modelo retornou durations, calculamos os timestamps por caractere fonético
//   if (result.durations) {
//     // No kokoro.js, dentro do generate()
//     const rawAudio = result.audio;
//     const totalAudioTime = rawAudio.audio.length / rawAudio.sampling_rate;

//     // 1. Identificar quanto tempo o modelo "gastou" com tokens especiais (BOS/EOS)
//     // Geralmente o durations[0] é o BOS e o durations[durations.length - 1] é o EOS
//     const overheadFrames = result.durations[0] + result.durations[result.durations.length - 1];
//     const usableFrames = result.durations.reduce((a, b) => a + b, 0) - overheadFrames;

//     // O Kokoro ONNX geralmente retorna: [BOS, ...phonemes..., EOS]
//     const bosFrames = result.durations[0];
//     const eosFrames = result.durations[result.durations.length - 1];
//     const totalFrames = result.durations.reduce((a, b) => a + b, 0);
//     const speechFrames = totalFrames - bosFrames - eosFrames;

//     // 2. Calcular o divisor baseado apenas no que é audível (texto real)
//     // Nós queremos que speechFrames ocupem exatamente o tempo que não é silêncio inicial/final
//     // Como aproximação robusta, usamos o total para não perder o alinhamento:
//     const CALIBRATION_FACTOR = 1.03; // Aumenta o divisor em 3%
//     const MAGIC_DIVISOR = (totalFrames / totalAudioTime) * CALIBRATION_FACTOR;
//     console.log("MAGIC_DIVISOR", MAGIC_DIVISOR, "totalAudioTime", totalAudioTime);

//     const durations = result.durations;

//     // O áudio da primeira palavra só começa DEPOIS do BOS
//     let currentTime = bosFrames / MAGIC_DIVISOR;

//     const phonemeMap = [];
//     // Começamos do 1 para ignorar o BOS no mapeamento de caracteres
//     for (let i = 0; i < phonemes.length; i++) {
//       const d = durations[i + 1] || 0; // i+1 pula o BOS
//       const start = currentTime;
//       currentTime += (d / MAGIC_DIVISOR);
      
//       phonemeMap.push({
//         char: phonemes[i],
//         start: parseFloat(start.toFixed(4)),
//         end: parseFloat(currentTime.toFixed(4)),
//         frames: d
//       });
//     }

//     // 5. Agrupamos os fonemas de volta em palavras para a UI
//     const words = text.split(/\s+/);
//     let charOffset = 0;
//     wordTimestamps = words.map(word => {
//         // 1. Pular fonemas que não pertencem a letras (espaços, pontuação solta no início)
//         // while (charOffset < phonemeMap.length && !/[a-zA-Z0-9áéíóúâêîôûãõç\u00C0-\u017F]/.test(phonemeMap[charOffset].char)) {
//         //   charOffset++;
//         // }

//         while (charOffset < phonemeMap.length && 
//               /[\s\.,;!\?\-]/.test(phonemeMap[charOffset].char) 
//             //  || !/[a-zA-Z0-9\u00C0-\u017Fðθɪɛæʊəɔʌɑɡɹʃʒç]/.test(phonemeMap[charOffset].char)
//         ) {
//           charOffset++;
//         }

//         // Encontra onde esta palavra termina na string de fonemas (aproximado)
//         // Uma lógica mais robusta usaria o MToken, mas aqui podemos filtrar por espaços
//         const startTs = phonemeMap[charOffset]?.start || 0;
//         const phonemesInWord = [];
        
//         // // Avança o offset até encontrar o próximo espaço nos fonemas
//         // while (charOffset < phonemeMap.length && phonemeMap[charOffset].char !== ' ') {
//         //   phonemesInWord.push(phonemeMap[charOffset]);  
//         //   charOffset++;
//         // }

//         // 2. Heurística de parada para Inglês/Línguas Rápidas
//         // Se a palavra for muito curta (ex: "In", "the", "a"), limitamos quantos 
//         // fonemas ela pode "roubar" antes de encontrar um espaço.
//         const maxPhonemesForShortWord = word.length + 1;

//         // 2. Lógica de captura baseada no que o Phonemizer entregou
//         // Vamos capturar até o espaço OU até atingirmos o limite de fonemas 
//         // que uma palavra desse tamanho costuma ter (heurística de segurança)
//         while (charOffset < phonemeMap.length) {
//           const char = phonemeMap[charOffset].char;

//           // Condição de parada 1: Espaço explícito
//           if (char === ' ') break; 
          
//           phonemesInWord.push(phonemeMap[charOffset]);
//           charOffset++;
          
//           // Se a palavra for "e" ou "a" (tamanho 1), e já pegamos 1 fonema, 
//           // paramos para não roubar o fonema da próxima palavra
//           //if (word.length <= 3 && phonemesInWord.length >= maxPhonemesForShortWord) break;
//         }
        
//         // Em vez de usar o 'end' do último fonema da palavra, 
//         // garantimos um respiro fixo de 20ms a 30ms.
//         const lastPhoneme = phonemesInWord[phonemesInWord.length - 1];
//         let endTs = lastPhoneme?.end || startTs;
//         charOffset++; // Pula o espaço

//         // Importante: Avança o offset para o próximo ciclo
//         if (charOffset < phonemeMap.length && phonemeMap[charOffset].char === ' ') {
//           charOffset++;
//         }

//         console.log(`Palavra: ${word} | Fonemas: ${phonemesInWord.map(p => p.char).join('')}`);
//         console.log("startTs", startTs, "endTs", endTs);

//       // Seus ajustes de gap que funcionaram bem no PT
//       const gap = 0.040;
//       const halfGap = gap / 2;
//       const adjustedStart = Math.max(0, startTs - halfGap);
//       const adjustedEnd = Math.max(adjustedStart + 0.01, endTs - gap);

//       return { 
//         word, 
//         start: adjustedStart, 
//         end: adjustedEnd,
//         phonemes: phonemesInWord
//       };
//     });
//   }

//   return { ...result, 
//     wordTimestamps: wordTimestamps, 
//     phonemeMap: phonemeMap
//   };
// }

  // /**
  //  * Generate audio from text.
  //  *
  //  * @param {string} text The input text
  //  * @param {GenerateOptions} options Additional options
  //  * @returns {Promise<RawAudio>} The generated audio
  //  */
  // async generate(text, { voice = "af_heart", speed = 1 } = {}) {
  //   const language = this._validate_voice(voice);

  //   const phonemes = await phonemize(text, language);
  //   console.log("phonemes", phonemes);
  //   const { input_ids } = this.tokenizer(phonemes, {
  //     truncation: true,
  //   });

  //   return this.generate_from_ids(input_ids, { voice, speed });
  // }

  // /**
  //  * Generate audio from input ids.
  //  * @param {Tensor} input_ids The input ids
  //  * @param {GenerateOptions} options Additional options
  //  * @returns {Promise<RawAudio>} The generated audio
  //  */

    /**
   * Generate audio from input ids.
   * @param {Tensor} input_ids The input ids
   * @param {GenerateOptions} options Additional options
   * @returns {Promise<{audio: RawAudio, durations: Float32Array}>} The generated audio
   */
  async generate_from_ids(input_ids, { voice = "af_heart", speed = 1 } = {}) {
    // Select voice style based on number of input tokens
    const num_tokens = Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);

    // Load voice style
    const data = await getVoiceData(voice);
    const offset = num_tokens * STYLE_DIM;
    const voiceData = data.slice(offset, offset + STYLE_DIM);

    // Prepare model inputs
    const inputs = {
      input_ids,
      style: new Tensor("float32", voiceData, [1, STYLE_DIM]),
      speed: new Tensor("float32", [speed], [1]),
    };

    const result = await this.model(inputs);

    // Generate audio
    return {
      audio: new RawAudio(result.waveform.data, SAMPLE_RATE),
      durations: result.durations.data // O Float32Array(49)
    };
  //   return new RawAudio(waveform.data, SAMPLE_RATE);
  }

  /**
   * Generate audio from text in a streaming fashion.
   * @param {string|TextSplitterStream} text The input text
   * @param {StreamGenerateOptions} options Additional options
   * @returns {AsyncGenerator<{text: string, phonemes: string, audio: RawAudio}, void, void>}
   */
  async *stream(text, { voice = "af_heart", speed = 1, split_pattern = null } = {}) {
    const language = this._validate_voice(voice);

    /** @type {TextSplitterStream} */
    let splitter;
    if (text instanceof TextSplitterStream) {
      splitter = text;
    } else if (typeof text === "string") {
      splitter = new TextSplitterStream();
      const chunks = split_pattern
        ? text
          .split(split_pattern)
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk.length > 0)
        : [text];
      splitter.push(...chunks);
    } else {
      throw new Error("Invalid input type. Expected string or TextSplitterStream.");
    }
    for await (const sentence of splitter) {
      const phonemeObj = await phonemize(sentence, language); 
      const phonemesStr = phonemeObj.phonemes; // string para tokenizer
      const phonemeTokens = phonemeObj.tokens; // array de tokens para alinhamento
      const { input_ids } = this.tokenizer(phonemesStr, {
        truncation: true,
      });

      // TODO: There may be some cases where - even with splitting - the text is too long.
      // In that case, we should split the text into smaller chunks and process them separately.
      // For now, we just truncate these exceptionally long chunks
      const audio = await this.generate_from_ids(input_ids, { voice, speed });
      yield { text: sentence, phonemes: phonemesStr, audio: audio.audio };
    }
  }
}

export const env = {
  set cacheDir(value) {
    hf.cacheDir = value
  },
  get cacheDir() {
    return hf.cacheDir
  },
  set wasmPaths(value) {
    hf.backends.onnx.wasm.wasmPaths = value;
  },
  get wasmPaths() {
    return hf.backends.onnx.wasm.wasmPaths;
  },
};

export { TextSplitterStream };
