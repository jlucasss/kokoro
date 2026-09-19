import { useRef, useState, useEffect } from "react";

export default function App() {
  const worker = useRef(null);
  const audioPlayerRef = useRef(null);

  const [inputText, setInputText] = useState("No princípio criou Deus os céus e a terra.");
  const [selectedSpeaker, setSelectedSpeaker] = useState("pf_dora");
  const [voices, setVoices] = useState([]);
  const [status, setStatus] = useState(null);
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    }

    const onMessageReceived = (e) => {
      if (e.data.status === "ready") {
        setStatus("ready");
        setVoices(e.data.voices);
      } else if (e.data.status === "complete") {
        // Criamos um objeto único com ID baseado no timestamp para evitar chaves duplicadas
        const newResult = {
          id: crypto.randomUUID(),
          text: e.data.text,
          src: e.data.audio,
          words: e.data.words // Array de objetos {text, start, end}
        };

        console.log("e", e);
        console.log("words", newResult.words);

        setResults((prev) => [newResult, ...prev]);
        setStatus("ready");
      }
    };

    worker.current.addEventListener("message", onMessageReceived);
    return () => worker.current?.removeEventListener("message", onMessageReceived);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (status === "running") return;
    setStatus("running");
    worker.current.postMessage({ text: inputText, voice: selectedSpeaker });
  };

  const [audioSrc, setAudioSrc] = useState();
  const [startTime, setStartTime] = useState();
  const [endTime, setEndTime] = useState();
  const [currentTime, setCurrentTime] = useState(0);

  const requestRef = useRef(); // Ref para cancelar o loop do rAF
  
  const [currentWordIdx, setCurrentWordIdx] = useState(null); // Para destacar a palavra na UI
  const playPromiseRef = useRef(null);

  // Função para tocar (mesma lógica, mas limpando estados anteriores)
  const handleWordClick = async (audioSrc, startTime, endTime) => {
    const audio = audioPlayerRef.current;
    if (!audio) return;

    // 1. Se já existe uma promessa de play em curso, aguardamos ou ignoramos
    if (playPromiseRef.current) {
      try { await playPromiseRef.current; } catch(e) { /* ignore */ }
    }

    // Se mudar a fonte, resetamos
    if (audio.src !== audioSrc) {
      audio.src = audioSrc;
    }

    setAudioSrc(audioSrc);
    setStartTime(startTime);
    //const safetyMargin = 0.025; // 25ms
    setEndTime(endTime ? endTime : 9999); // Se não houver fim (frase toda), pomos um valor alto
    //console.log(`${endTime} * ${safetyMargin}`, (endTime - safetyMargin))

    audio.currentTime = startTime;

    // 2. Armazena a promessa e trata o play
    playPromiseRef.current = audio.play();

    try {
      await playPromiseRef.current;
      playPromiseRef.current = null;
    } catch (error) {
      console.error("Play impedido:", error);
    }
  };

  useEffect(() => {
    const audio = audioPlayerRef.current;
    if (!audio) return;

    // No useEffect do requestAnimationFrame, mude a condição de pausa:
    const syncUI = () => {
      const now = audio.currentTime;
      setCurrentTime(now);

      if (endTime !== null && now >= endTime) {
        // SÓ PAUSA SE NÃO ESTIVERMOS NO MEIO DE UM COMANDO DE PLAY
        if (!playPromiseRef.current) {
          audio.pause();
          cancelAnimationFrame(requestRef.current);
        }
        return;
      }
      requestRef.current = requestAnimationFrame(syncUI);
    };

   const onPlay = () => {
      requestRef.current = requestAnimationFrame(syncUI);
    };

    const onPause = () => {
      cancelAnimationFrame(requestRef.current);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      cancelAnimationFrame(requestRef.current);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [endTime]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
      <div className="w-full max-w-2xl space-y-6">
        
        {/* PLAYER ÚNICO FIXO */}
        <div className="sticky top-0 bg-gray-800 p-4 rounded-b-xl border-x border-b border-blue-500/20 shadow-xl z-20">
          <audio ref={audioPlayerRef} controls className="w-full" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-gray-800 p-4 rounded-xl">
          <textarea 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="w-full bg-gray-700 p-3 rounded-lg outline-none focus:ring-1 ring-blue-500"
          />
          <div className="flex gap-4">
            <select 
              value={selectedSpeaker} 
              onChange={(e) => setSelectedSpeaker(e.target.value)}
              className="flex-1 bg-gray-700 p-2 rounded-lg"
            >
              {Object.entries(voices).map(([id, v]) => (
                <option key={id} value={id}>{v.name}</option>
              ))}
            </select>
            <button 
              disabled={status === "running"}
              className="px-6 py-2 bg-blue-600 rounded-lg font-bold disabled:opacity-50"
            >
              {status === "running" ? "Gerando..." : "Gerar Voz"}
            </button>
          </div>
        </form>

        <div className="space-y-4">
          {results.map((result) => (
            <div key={result.id} className="bg-gray-800 p-5 rounded-xl border border-gray-700">
              <div className="flex flex-wrap gap-2">
                {result.words.map((word, idx) => (
                  <button
                    key={`${result.id}-w-${idx}`}
                    onClick={() => handleWordClick(result.src, word.start, word.end)}
                    className={`px-2 py-1 bg-gray-700 hover:bg-blue-600 rounded text-sm transition-colors `}
                  >
                    {word.word}
                  </button>
                ))}
              </div>
              <button 
                onClick={() => handleWordClick(result.src, 0)}
                className="mt-4 text-xs text-blue-400 hover:underline"
              >
                Tocar frase completa
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}