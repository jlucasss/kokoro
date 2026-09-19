import { useRef, useState, useEffect } from "react";
import { motion } from "motion/react";

export default function App() {
  // Create a reference to the worker object.
  const worker = useRef(null);

  const [inputText, setInputText] = useState("No princípio criou Deus os céus e a terra.");
  const [selectedSpeaker, setSelectedSpeaker] = useState("pf_dora");//af_heart");

  const [voices, setVoices] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("Loading...");

  const [results, setResults] = useState([]);

  // We use the `useEffect` hook to setup the worker as soon as the `App` component is mounted.
  useEffect(() => {
    // Create the worker if it does not yet exist.
    worker.current ??= new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });

    // Create a callback function for messages from the worker thread.
    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "device":
          setLoadingMessage(`Loading model (device="${e.data.device}")`);
          break;
        case "ready":
          setStatus("ready");
          setVoices(e.data.voices);
          break;
        case "error":
          setError(e.data.data);
          break;
        case "complete":
          const { audio, text, isWord, wordIndex  } = e.data;
          // Generation complete: re-enable the "Generate" button
          if (isWord) {
            // Se for uma palavra individual, atualizamos o resultado correspondente
            setResults((prev) => {
              const newResults = [...prev];
              // O primeiro item [0] é sempre a geração mais recente
              if (!newResults[0].wordAudios) newResults[0].wordAudios = {};
              newResults[0].wordAudios[wordIndex] = audio;
              return newResults;
          });
          } else {
            // Geração do versículo completo
            const words = text.split(/\s+/).filter(w => w.length > 0);
            setResults((prev) => [{ text, src: audio, words, wordAudios: {} }, ...prev]);
            setStatus("ready");            
            // DISPARAR GERAÇÃO DAS PALAVRAS INDIVIDUAIS (BACKGROUND)
            words.forEach((word, index) => {
              worker.current.postMessage({
                type: "generate",
                text: word.replace(/[.,!?;:]/g, ""), // Limpa pontuação para a palavra
                voice: selectedSpeaker,
                isWord: true,
                wordIndex: index
              });
            });
          }
            break;
         }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setError(e.message);
    };

    // Attach the callback function as an event listener.
    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    // Define a cleanup function for when the component is unmounted.
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [selectedSpeaker]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setStatus("running");

    worker.current.postMessage({
      type: "generate",
      text: inputText.trim(),
      voice: selectedSpeaker,
      isWord: false
    });
  };

  const playAudio = (src) => {
    const audio = new Audio(src);
    audio.play();
  };

  return (
    <div className="relative w-full min-h-screen bg-gradient-to-br from-gray-900 to-gray-700 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Loading Overlay */}
      <motion.div initial={{ opacity: 1 }} animate={{ opacity: status === null ? 1 : 0 }} transition={{ duration: 0.5 }} className="absolute w-screen h-screen justify-center flex flex-col items-center z-50 bg-gray-800/95 backdrop-blur-md" style={{ pointerEvents: status === null ? "auto" : "none" }}>
        <div className="w-[250px] h-[250px] border-4 border-white shadow-[0_0_0_5px_#4973ff] rounded-full overflow-hidden">
          <div className="loading-wave"></div>
        </div>
        <p className={`text-3xl my-5 text-center ${error ? "text-red-500" : "text-white"}`}>{error ?? loadingMessage}</p>
      </motion.div>

      <div className="max-w-3xl w-full space-y-8 relative z-[2] mt-10">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-gray-100 mb-2 drop-shadow-lg font-heading">Kokoro Text-to-Speech</h1>
          <p className="text-2xl text-gray-300 font-semibold font-subheading">
            Powered by&nbsp;
            <a href="https://github.com/hexgrad/kokoro" target="_blank" rel="noreferrer" className="underline">
              Kokoro
            </a>
            &nbsp;and&nbsp;
            <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noreferrer" className="underline">
              <img width="40" src="hf-logo.svg" className="inline translate-y-[-2px] me-1"></img>Transformers.js
            </a>
          </p>
        </div>
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <textarea placeholder="Enter text..." value={inputText} onChange={(e) => setInputText(e.target.value)} className="w-full min-h-[100px] max-h-[300px] bg-gray-700/50 backdrop-blur-sm border-2 border-gray-600 rounded-xl resize-y text-gray-100 placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" rows={Math.min(8, inputText.split("\n").length)} />
            <div className="flex gap-4">
              {/* <select value={selectedSpeaker} onChange={(e) => setSelectedSpeaker(e.target.value)} className="w-full bg-gray-700/50 backdrop-blur-sm border-2 border-gray-600 rounded-xl text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                {Object.entries(voices).map(([id, voice]) => (
                  <option key={id} value={id}>
                    {voice.name} ({voice.language === "en-us" ? "American" : "British"} {voice.gender})
                  </option>
                ))}
              </select> */}
              <select 
                value={selectedSpeaker} 
                onChange={(e) => setSelectedSpeaker(e.target.value)} 
                className="w-full bg-gray-700/50 backdrop-blur-sm border-2 border-gray-600 rounded-xl text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {Object.entries(voices).map(([id, voice]) => {
                  // Lógica simples para identificar o idioma pelo prefixo do ID
                  let langName = "Unknown";
                  if (id.startsWith('p')) langName = "Português";
                  else if (id.startsWith('a')) langName = "Inglês (EUA)";
                  else if (id.startsWith('b')) langName = "Inglês (UK)";
                  else if (id.startsWith('e')) langName = "Espanhol";
                  else if (id.startsWith('z')) langName = "Chinês";

                  return (
                    <option key={id} value={id}>
                      {langName} - {voice.name} ({voice.gender})
                    </option>
                  );
                })}
              </select>

              <button type="submit" className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-bold disabled:opacity-50" disabled={status === "running"}>
                {status === "running" ? "Processando..." : "Gerar"}
              </button>
            </div>
          </form>
        </div>

        {results.length > 0 && (
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }} className="max-h-[250px] overflow-y-auto px-2 mt-4 space-y-6 relative z-[2]">
            {results.map((result, i) => (
              <div key={i}>
                <div className="text-white bg-gray-800/70 backdrop-blur-sm border border-gray-700 rounded-lg p-4 z-10">
                  <span className="absolute right-5 font-bold">#{results.length - i}</span>
                  <p className="mb-3 max-w-[95%]">{result.text}</p>

                  {/* Botões de Palavras */}
                  <div className="flex flex-wrap gap-2 mb-6">
                    {result.words.map((word, idx) => (
                      <button
                        key={idx}
                        onClick={() => result.wordAudios[idx] && playAudio(result.wordAudios[idx])}
                        className={`px-3 py-1 rounded-lg text-sm transition-all ${
                          result.wordAudios[idx] 
                          ? "bg-blue-900/40 text-blue-200 border border-blue-500/50 hover:bg-blue-600 hover:text-white" 
                          : "bg-gray-700 text-gray-500 cursor-wait border border-transparent"
                        }`}
                        title={result.wordAudios[idx] ? "Ouvir palavra" : "Processando áudio da palavra..."}
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-gray-700 pt-4">
                    <p className="text-xs text-gray-500 mb-2">ÁUDIO COMPLETO:</p>
                    <audio controls src={result.src} className="w-full h-10 shadow-inner" />
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </div>

      <div className="bg-[#015871] pointer-events-none absolute left-0 w-full h-[5%] bottom-[-50px]">
        <div className="wave"></div>
        <div className="wave"></div>
      </div>
    </div>
  );
}
