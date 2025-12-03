import React, { useState, useRef, useEffect } from 'react';
import { Camera, Utensils, BookOpen, AlertCircle, Play, Square, Settings, Heart, Zap } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

// --- CONFIGURATION ---
const getEnvVar = (key) => {
  try {
    return (import.meta && import.meta.env && import.meta.env[key]) || "";
  } catch (e) {
    return "";
  }
};

const GEMINI_API_KEY = getEnvVar("VITE_GEMINI_API_KEY");
const FIREBASE_CONFIG_RAW = getEnvVar("VITE_FIREBASE_CONFIG");

// --- FIREBASE INIT ---
let db = null;
let auth = null;

if (FIREBASE_CONFIG_RAW) {
  try {
    const firebaseConfig = JSON.parse(FIREBASE_CONFIG_RAW);
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    signInAnonymously(auth).catch(console.error);
  } catch (e) {
    console.warn("Firebase config invalid or missing. Logs will not be saved.");
  }
}

// --- APP COMPONENT ---
function App() {
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode] = useState('homework');
  const [status, setStatus] = useState('idle');
  const [lastMessage, setLastMessage] = useState("Mom is ready.");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(GEMINI_API_KEY);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  
  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera Error:", err);
      setLastMessage("Camera unavailable.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  };

  const toggleMonitoring = () => {
    if (isActive) {
      clearInterval(intervalRef.current);
      setIsActive(false);
      setStatus('idle');
      setLastMessage("Monitoring paused.");
    } else {
      if (!apiKey) {
        setSettingsOpen(true);
        alert("Please enter a Gemini API Key in settings.");
        return;
      }
      setIsActive(true);
      setLastMessage("Mom is watching...");
      intervalRef.current = setInterval(analyzeFrame, 6000); 
    }
  };

  const analyzeFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setStatus('analyzing');

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];

    let prompt = "";
    if (mode === 'eating') {
      prompt = `
        You are 'AI Mom', a strict but caring mother monitoring her child eating.
        Analyze the image for:
        1. Not holding a utensil (spoon/fork/chopsticks) properly.
        2. Looking away from food/distracted.
        3. Playing or Talking instead of eating.
        
        If failures found: return status "bad".
        If eating politely: return status "good".
        
        Response JSON: { "status": "good" | "bad", "message": "Short 5-word strict motherly command." }
      `;
    } else {
      prompt = `
        You are 'AI Mom', a strict but caring mother monitoring homework.
        Analyze for:
        1. Slouching/Leaning (bad for back).
        2. Distraction (looking away from books/screen).
        3. Sleeping or Playing with toys.
        
        If failures found: return status "bad".
        If focused: return status "good".
        
        Response JSON: { "status": "good" | "bad", "message": "Short 5-word strict motherly command." }
      `;
    }

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: base64Image } }
            ]
          }],
          generationConfig: { response_mime_type: "application/json" }
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.candidates[0].content.parts[0].text);

      if (result.status === 'bad') {
        setStatus('warning');
        setLastMessage(result.message);
        speakText(result.message);
        logEvent(result.message, 'violation');
      } else {
        setStatus('good');
        setLastMessage("Mom is happy.");
      }

    } catch (error) {
      console.error("AI Error:", error);
      setStatus('error');
    }
  };

  const speakText = (text) => {
    const synth = window.speechSynthesis;
    if (!synth || synth.speaking) return;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0; 
    utterance.pitch = 1.1; // Slightly higher pitch for female/motherly tone
    
    // Try to find a female voice
    const voices = synth.getVoices();
    const femaleVoice = voices.find(v => 
      (v.name.includes("Female") || v.name.includes("Samantha") || v.name.includes("Google US English")) 
      && !v.name.includes("Male")
    );
    if (femaleVoice) utterance.voice = femaleVoice;

    synth.speak(utterance);
  };

  const logEvent = async (message, type) => {
    if (!db) return;
    try {
      await addDoc(collection(db, "monitor_logs"), {
        timestamp: serverTimestamp(),
        mode: mode,
        message: message,
        type: type,
        uid: auth?.currentUser?.uid || 'anon'
      });
    } catch (e) {
      console.error("Log error", e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center relative font-sans">
      
      {/* Top Bar */}
      <div className="w-full p-4 flex justify-between items-center bg-slate-900 border-b border-slate-800 z-10">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Heart className="text-pink-500 fill-pink-500" /> AI Mom
        </h1>
        <button onClick={() => setSettingsOpen(!settingsOpen)} className="p-2 text-slate-400 hover:text-white">
          <Settings size={24} />
        </button>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 w-full max-w-md flex flex-col items-center justify-center p-4 gap-6">
        
        {/* Camera Feed */}
        <div className={`relative w-full aspect-[3/4] bg-black rounded-3xl overflow-hidden border-4 shadow-2xl transition-colors duration-500 ${
          status === 'warning' ? 'border-red-500' : 
          status === 'good' ? 'border-pink-500' : 'border-slate-800'
        }`}>
          <canvas ref={canvasRef} className="hidden" />
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover transform scale-x-[-1]" 
          />

          <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs font-mono text-white flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`}></div>
            {isActive ? "MOM IS WATCHING" : "OFFLINE"}
          </div>

          <div className="absolute bottom-4 left-4 right-4 flex justify-center">
            <div className="bg-black/70 backdrop-blur-md px-6 py-3 rounded-2xl text-center">
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Status</p>
              <p className={`text-lg font-bold ${
                status === 'warning' ? 'text-red-400' : 
                status === 'good' ? 'text-pink-400' : 'text-white'
              }`}>
                {lastMessage}
              </p>
            </div>
          </div>
        </div>

        {/* Controls */}
        {!isActive && (
          <div className="w-full grid grid-cols-2 gap-4">
            <button 
              onClick={() => setMode('homework')}
              className={`p-4 rounded-xl flex flex-col items-center justify-center gap-2 border-2 transition-all ${
                mode === 'homework' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <BookOpen size={32} />
              <span className="font-semibold">Homework</span>
            </button>
            <button 
              onClick={() => setMode('eating')}
              className={`p-4 rounded-xl flex flex-col items-center justify-center gap-2 border-2 transition-all ${
                mode === 'eating' ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <Utensils size={32} />
              <span className="font-semibold">Eating</span>
            </button>
          </div>
        )}

        <button 
          onClick={toggleMonitoring}
          className={`w-full py-5 rounded-2xl font-black text-xl tracking-widest uppercase shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-3 ${
            isActive 
              ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/50' 
              : 'bg-white hover:bg-slate-200 text-black shadow-white/20'
          }`}
        >
          {isActive ? (
            <><Square fill="currentColor" /> Stop Monitoring</>
          ) : (
            <><Play fill="currentColor" /> Call Mom</>
          )}
        </button>

      </div>

      {settingsOpen && (
        <div className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center p-6">
          <div className="bg-slate-900 w-full max-w-sm p-6 rounded-2xl border border-slate-700">
            <h2 className="text-xl font-bold mb-4">Settings</h2>
            <label className="block text-sm text-slate-400 mb-2">Gemini API Key</label>
            <input 
              type="password" 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded p-3 text-white mb-4"
              placeholder="Paste AI Studio Key here..."
            />
            <button 
              onClick={() => setSettingsOpen(false)}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold"
            >
              Save & Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;