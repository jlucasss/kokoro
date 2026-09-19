import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const worker = useRef(null);

  const [inputText, setInputText] = useState("No princípio criou Deus os céus e a terra.");
  const [selectedSpeaker, setSelectedSpeaker] = useState("pf_dora");
  const [voices, setVoices] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("Carregando Modelos...");

  // Agora guardamos apenas a geração ATUAL para evitar poluição visual
  const [currentResult, setCurrentResult] = useState(null);

  useEffect(() => {
    worker.current ??= new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "device": setLoadingMessage(`Otimizando para ${e.data.device}...`); break;
        case "ready": 
          setStatus("ready"); 
          setVoices(e.data.voices); 
          break;
        case "error": setError(e.data.data); break;
        case "complete":
          const { audio, text, isWord, wordIndex } = e.data;
          
          if (isWord) {
            // Atualiza o áudio da palavra específica dentro do resultado atual
            setCurrentResult(prev => {
              if (!prev) return prev;
              const updatedWordAudios = { ...prev.wordAudios, [wordIndex]: audio };
              return { ...prev, wordAudios: updatedWordAudios };
            });
          } else {
            // Novo versículo completo
            const words = text.split(/\s+/).filter(w => w.length > 0);
            setCurrentResult({ text, src: audio, words, wordAudios: {} });
            setStatus("ready");
            
            // Dispara gerações individuais em background
            words.forEach((word, index) => {
              worker.current.postMessage({
                type: "generate",
                text: word.replace(/[.,!?;:]/g, ""),
                voice: selectedSpeaker,
                isWord: true,
                wordIndex: index
              });
            });
          }
          break;
      }
    };

    worker.current.addEventListener("message", onMessageReceived);
    return () => worker.current.removeEventListener("message", onMessageReceived);
  }, [selectedSpeaker]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    setStatus("running");
    worker.current.postMessage({ type: "generate", text: inputText.trim(), voice: selectedSpeaker, isWord: false });
  };

  const playAudio = (src) => { if (src) new Audio(src).play(); };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6 font-sans overflow-x-hidden">
      
      {/* Overlay de Carregamento */}
      <AnimatePresence>
        {status === null && (
          <motion.div exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950">
            <div className="w-24 h-24 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-xl font-medium">{error ?? loadingMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-2xl w-full space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-blue-400">Leitor Bíblico</h1>
          <p className="text-slate-400">MVP de Pronúncia Nativa (Kokoro v1.0)</p>
        </header>

        {/* Input de Texto */}
        <section className="bg-slate-800 p-6 rounded-2xl shadow-xl border border-slate-700">
          <form onSubmit={handleSubmit} className="space-y-4">
            <textarea 
              value={inputText} 
              onChange={(e) => setInputText(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl p-4 h-32 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder="Digite o versículo aqui..."
            />
            <div className="flex gap-4">
              <select 
                value={selectedSpeaker} 
                onChange={(e) => setSelectedSpeaker(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2"
              >
                {Object.entries(voices).map(([id, v]) => (
                  <option key={id} value={id}>{id.startsWith('p') ? '🇧🇷' : '🇺🇸'} {v.name}</option>
                ))}
              </select>
              <button 
                type="submit" 
                disabled={status === "running"}
                className="px-8 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-xl font-bold transition-colors"
              >
                {status === "running" ? "Processando..." : "Ler Versículo"}
              </button>
            </div>
          </form>
        </section>

        {/* Resultado Único */}
        <AnimatePresence mode="wait">
          {currentResult && (
            <motion.section 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-8 space-y-6">
                {/* Texto do Versículo */}
                <p className="text-2xl font-serif italic text-center text-slate-200 leading-relaxed">
                  "{currentResult.text}"
                </p>

                {/* Player Principal Minimalista */}
                <div className="flex justify-center">
                  <button 
                    onClick={() => playAudio(currentResult.src)}
                    className="flex items-center gap-2 px-10 py-3 bg-white text-slate-900 rounded-full font-bold hover:scale-105 active:scale-95 transition-all"
                  >
                    <svg xmlns="www.w3.org" width="24" height="24" fill="currentColor" viewBox="0 0 256 256"><path d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.75a16,16,0,0,1-24.32-13.51V40a16,16,0,0,1,24.32-13.51L232.4,114.49A15.74,15.74,0,0,1,240,128Z"></path></svg>
                    OUVIR TUDO
                  </button>
                </div>

                {/* Grade de Palavras para Estudo */}
                <div className="pt-6 border-t border-slate-700">
                  <p className="text-xs font-bold text-slate-500 mb-4 tracking-widest uppercase text-center">Clique na palavra para treinar pronúncia</p>
                  <div className="flex flex-wrap justify-center gap-3">
                    {currentResult.words.map((word, idx) => (
                      <button
                        key={idx}
                        onClick={() => playAudio(currentResult.wordAudios[idx])}
                        disabled={!currentResult.wordAudios[idx]}
                        className={`px-4 py-2 rounded-lg font-medium transition-all border-2 ${
                          currentResult.wordAudios[idx] 
                          ? "bg-slate-700 border-slate-600 hover:border-blue-500 text-blue-100" 
                          : "bg-slate-800 border-dashed border-slate-700 text-slate-600 cursor-wait"
                        }`}
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
