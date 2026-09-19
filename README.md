# Kokoro (Web/JS Enhanced Fork)

An inference library for [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M).

> ⚠️ **ABOUT THIS FORK**: This repository is a specialized fork focusing on a **Robust, Offline-First Web/JavaScript Implementation**. It solves several critical bugs related to ONNX Web integration, Vite/Rollup bundling, and browser memory limits, making Kokoro 100% production-ready for PWAs, Ionic, and Capacitor apps.

## 🚀 Web/JS Enhancements in this Fork

This fork introduces deep modifications to the `kokoro.js` architecture to support seamless frontend deployments:

1. **Fully Offline & PWA Ready (IndexedDB)**: Exposes a `configKokoroEnv` function to dynamically inject a custom cache (like Dexie.js) and local server URLs, completely bypassing hardcoded Hugging Face fetches.
2. **ONNX Output Patch (Monkey Patch)**: Fixed the critical `Cannot read properties of undefined (reading 'data')` bug. Quantized ONNX models (like `model_uint8.onnx` or `q4`) often output variables named `audio` and `pred_dur` instead of the expected `waveform` and `durations`. This fork safely intercepts and remaps the ONNX outputs.
3. **Large Audio Support (Memory Fix)**: Fixed the `RangeError: Maximum call stack size exceeded` in JavaScript. The original implementation used spread operators (`...audio.audio`) which crashed the V8 engine on texts longer than 3 seconds. This was rewritten into optimized loops.
4. **Precise Word-Level Timestamps**: The JS generation pipeline was enhanced to return highly accurate `phonemeMap` and word-level timestamps, allowing UI text-highlighting synced with the audio.
5. **Vite/Rollup Bundler Proof**: Fixed the "Singleton Duplication" bug where bundlers duplicate `@huggingface/transformers` instances. By injecting the cache directly via `configKokoroEnv`, it prevents `Failed to fetch` and Mixed Content errors on mobile (Ionic/Capacitor).
6. **Built-in WAV Encoder**: The Web Worker implementation now natively supports `encodeWAV`, wrapping the raw `Float32Array` directly into a playable ArrayBuffer without external dependencies.
7. **Multi-threading Enabled**: Dynamically detects `navigator.hardwareConcurrency` to max out WebAssembly threads, turning 1-minute generation times into seconds.

---

## 💻 JavaScript / Web Worker Usage (New in this Fork)

To prevent hardcoded URLs and bundler issues, this fork exports `configKokoroEnv`. You must call this function before initializing the model to inject your local server URL and your optional IndexedDB cache.

```javascript
import { KokoroTTS, configKokoroEnv } from "kokoro-js";

// Your custom IndexedDB cache logic (e.g., Dexie)
const dexieCustomCache = {
  async match(request) { /* Read from IndexedDB */ },
  async put() {} 
};

self.addEventListener("message", async (e) => {
  if (e.data.type === "init") {
    
    // 1️⃣ Configure the environment dynamically
    // Injects the local server URL and your offline cache directly into the Transformers.js instance
    configKokoroEnv(e.data.serverUrl, dexieCustomCache);
    
    // 2️⃣ Load the model safely
    const tts = await KokoroTTS.from_pretrained("kokoro-82m", {
      dtype: "q8",
      device: "wasm", // or "webgpu"
      voices: ["pf_dora"]
    });

    self.postMessage({ status: "ready" });
  }

  if (e.data.type === "generate") {
    // 3️⃣ Generate audio (Now returns a safe payload with phonemeMaps)
    const result = await tts.generate(e.data.text, { voice: "pf_dora" });
    
    // Contains Float32Array audio and word-level timestamps
    console.log(result.audio, result.phonemeMap); 
  }
});

```

---

An inference library for [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M). You can [`pip install kokoro`](https://pypi.org/project/kokoro/).

> **Kokoro** is an open-weight TTS model with 82 million parameters. Despite its lightweight architecture, it delivers comparable quality to larger models while being significantly faster and more cost-efficient. With Apache-licensed weights, Kokoro can be deployed anywhere from production environments to personal projects.

### Usage
You can run this basic cell on [Google Colab](https://colab.research.google.com/). [Listen to samples](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/SAMPLES.md).
```py
!pip install -q kokoro>=0.9.4 soundfile
!apt-get -qq -y install espeak-ng > /dev/null 2>&1
from kokoro import KPipeline
from IPython.display import display, Audio
import soundfile as sf
import torch
pipeline = KPipeline(lang_code='a')
text = '''
[Kokoro](/kˈOkəɹO/) is an open-weight TTS model with 82 million parameters. Despite its lightweight architecture, it delivers comparable quality to larger models while being significantly faster and more cost-efficient. With Apache-licensed weights, [Kokoro](/kˈOkəɹO/) can be deployed anywhere from production environments to personal projects.
'''
generator = pipeline(text, voice='af_heart')
for i, (gs, ps, audio) in enumerate(generator):
    print(i, gs, ps)
    display(Audio(data=audio, rate=24000, autoplay=i==0))
    sf.write(f'{i}.wav', audio, 24000)
```
Under the hood, `kokoro` uses [`misaki`](https://pypi.org/project/misaki/), a G2P library at https://github.com/hexgrad/misaki

### Advanced Usage
You can run this advanced cell on [Google Colab](https://colab.research.google.com/).
```py
# 1️⃣ Install kokoro
!pip install -q kokoro>=0.9.4 soundfile
# 2️⃣ Install espeak, used for English OOD fallback and some non-English languages
!apt-get -qq -y install espeak-ng > /dev/null 2>&1

# 3️⃣ Initalize a pipeline
from kokoro import KPipeline
from IPython.display import display, Audio
import soundfile as sf
import torch
# 🇺🇸 'a' => American English, 🇬🇧 'b' => British English
# 🇪🇸 'e' => Spanish es
# 🇫🇷 'f' => French fr-fr
# 🇮🇳 'h' => Hindi hi
# 🇮🇹 'i' => Italian it
# 🇯🇵 'j' => Japanese: pip install misaki[ja]
# 🇧🇷 'p' => Brazilian Portuguese pt-br
# 🇨🇳 'z' => Mandarin Chinese: pip install misaki[zh]
pipeline = KPipeline(lang_code='a') # <= make sure lang_code matches voice, reference above.

# This text is for demonstration purposes only, unseen during training
text = '''
The sky above the port was the color of television, tuned to a dead channel.
"It's not like I'm using," Case heard someone say, as he shouldered his way through the crowd around the door of the Chat. "It's like my body's developed this massive drug deficiency."
It was a Sprawl voice and a Sprawl joke. The Chatsubo was a bar for professional expatriates; you could drink there for a week and never hear two words in Japanese.

These were to have an enormous impact, not only because they were associated with Constantine, but also because, as in so many other areas, the decisions taken by Constantine (or in his name) were to have great significance for centuries to come. One of the main issues was the shape that Christian churches were to take, since there was not, apparently, a tradition of monumental church buildings when Constantine decided to help the Christian church build a series of truly spectacular structures. The main form that these churches took was that of the basilica, a multipurpose rectangular structure, based ultimately on the earlier Greek stoa, which could be found in most of the great cities of the empire. Christianity, unlike classical polytheism, needed a large interior space for the celebration of its religious services, and the basilica aptly filled that need. We naturally do not know the degree to which the emperor was involved in the design of new churches, but it is tempting to connect this with the secular basilica that Constantine completed in the Roman forum (the so-called Basilica of Maxentius) and the one he probably built in Trier, in connection with his residence in the city at a time when he was still caesar.

[Kokoro](/kˈOkəɹO/) is an open-weight TTS model with 82 million parameters. Despite its lightweight architecture, it delivers comparable quality to larger models while being significantly faster and more cost-efficient. With Apache-licensed weights, [Kokoro](/kˈOkəɹO/) can be deployed anywhere from production environments to personal projects.
'''
# text = '「もしおれがただ偶然、そしてこうしようというつもりでなくここに立っているのなら、ちょっとばかり絶望するところだな」と、そんなことが彼の頭に思い浮かんだ。'
# text = '中國人民不信邪也不怕邪，不惹事也不怕事，任何外國不要指望我們會拿自己的核心利益做交易，不要指望我們會吞下損害我國主權、安全、發展利益的苦果！'
# text = 'Los partidos políticos tradicionales compiten con los populismos y los movimientos asamblearios.'
# text = 'Le dromadaire resplendissant déambulait tranquillement dans les méandres en mastiquant de petites feuilles vernissées.'
# text = 'ट्रांसपोर्टरों की हड़ताल लगातार पांचवें दिन जारी, दिसंबर से इलेक्ट्रॉनिक टोल कलेक्शनल सिस्टम'
# text = "Allora cominciava l'insonnia, o un dormiveglia peggiore dell'insonnia, che talvolta assumeva i caratteri dell'incubo."
# text = 'Elabora relatórios de acompanhamento cronológico para as diferentes unidades do Departamento que propõem contratos.'

# 4️⃣ Generate, display, and save audio files in a loop.
generator = pipeline(
    text, voice='af_heart', # <= change voice here
    speed=1, split_pattern=r'\n+'
)
# Alternatively, load voice tensor directly:
# voice_tensor = torch.load('path/to/voice.pt', weights_only=True)
# generator = pipeline(
#     text, voice=voice_tensor,
#     speed=1, split_pattern=r'\n+'
# )

for i, (gs, ps, audio) in enumerate(generator):
    print(i)  # i => index
    print(gs) # gs => graphemes/text
    print(ps) # ps => phonemes
    display(Audio(data=audio, rate=24000, autoplay=i==0))
    sf.write(f'{i}.wav', audio, 24000) # save each audio file
```

### Windows Installation
To install espeak-ng on Windows:
1. Go to [espeak-ng releases](https://github.com/espeak-ng/espeak-ng/releases)
2. Click on **Latest release** 
3. Download the appropriate `*.msi` file (e.g. **espeak-ng-20191129-b702b03-x64.msi**)
4. Run the downloaded installer

For advanced configuration and usage on Windows, see the [official espeak-ng Windows guide](https://github.com/espeak-ng/espeak-ng/blob/master/docs/guide.md)

### MacOS Apple Silicon GPU Acceleration

On Mac M1/M2/M3/M4 devices, you can explicitly specify the environment variable `PYTORCH_ENABLE_MPS_FALLBACK=1` to enable GPU acceleration.

```bash
PYTORCH_ENABLE_MPS_FALLBACK=1 python run-your-kokoro-script.py
```

### Conda Environment
Use the following conda `environment.yml` if you're facing any dependency issues.
```yaml
name: kokoro
channels:
  - defaults
dependencies:
  - python==3.9       
  - libstdcxx~=12.4.0 # Needed to load espeak correctly. Try removing this if you're facing issues with Espeak fallback. 
  - pip:
      - kokoro>=0.3.1
      - soundfile
      - misaki[en]
```

### Acknowledgements
- 🛠️ [@yl4579](https://huggingface.co/yl4579) for architecting StyleTTS 2.
- 🏆 [@Pendrokar](https://huggingface.co/Pendrokar) for adding Kokoro as a contender in the TTS Spaces Arena.
- 📊 Thank you to everyone who contributed synthetic training data.
- ❤️ Special thanks to all compute sponsors.
- 👾 Discord server: https://discord.gg/QuGxSWBfQy
- 🪽 Kokoro is a Japanese word that translates to "heart" or "spirit". Kokoro is also a [character in the Terminator franchise](https://terminator.fandom.com/wiki/Kokoro) along with [Misaki](https://github.com/hexgrad/misaki?tab=readme-ov-file#acknowledgements).

<img src="https://static0.gamerantimages.com/wordpress/wp-content/uploads/2024/08/terminator-zero-41-1.jpg" width="400" alt="kokoro" />
