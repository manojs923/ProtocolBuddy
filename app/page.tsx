"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { Copy, Send, RefreshCw, Layers } from "lucide-react";

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface SessionData {
  id: number;
  batch_id: string;
  image_url: string;
  created_at: string;
}

export default function FriendDashboard() {
  const [sessionCode, setSessionCode] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [batches, setBatches] = useState<Record<string, SessionData[]>>({});
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("AWAITING CONNECTION...");

  // Fetch captures when connected
  const fetchCaptures = async () => {
    if (!sessionCode) return;
    
    const { data, error } = await supabase
      .from("copilot_sessions")
      .select("*")
      .eq("session_code", sessionCode)
      .not("image_url", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      setStatus("ERROR FETCHING DATA");
      return;
    }

    // Group images by Batch ID so they don't mix
    const grouped = data.reduce((acc: Record<string, SessionData[]>, curr) => {
      if (!acc[curr.batch_id]) acc[curr.batch_id] = [];
      acc[curr.batch_id].push(curr);
      return acc;
    }, {});

    setBatches(grouped);
    setStatus("LIVE & SYNCED");
  };

  useEffect(() => {
    if (!isConnected) return;
    
    fetchCaptures();

    // Listen for new screenshots arriving in real-time
    const channel = supabase
      .channel(`copilot-session-${sessionCode}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "copilot_sessions", filter: `session_code=eq.${sessionCode}` },
        () => {
          fetchCaptures();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isConnected, sessionCode]);

// 🛡️ FIXED CORS-SAFE STITCH & COPY FUNCTION
  const copyBatchToClipboard = async (batchImages: SessionData[]) => {
    setStatus("STITCHING IMAGES...");
    try {
      // Fetch all images through a safe blob fetcher to bypass CORS blocks
      const loadedImages = await Promise.all(
        batchImages.map(async (imgData) => {
          const response = await fetch(imgData.image_url);
          const blob = await response.blob();
          return new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              URL.revokeObjectURL(img.src);
              resolve(img);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
          });
        })
      );

      // Calculate total height and max width for vertical stacking
      let totalHeight = 0;
      let maxWidth = 0;
      loadedImages.forEach((img) => {
        totalHeight += img.height;
        if (img.width > maxWidth) maxWidth = img.width;
      });

      // Create canvas and draw stacked images
      const canvas = document.createElement("canvas");
      canvas.width = maxWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext("2d");

      let currentY = 0;
      loadedImages.forEach((img) => {
        ctx?.drawImage(img, 0, currentY);
        currentY += img.height;
      });

      // Convert canvas to blob and write to clipboard
      canvas.toBlob(async (blob) => {
        if (!blob) throw new Error("Canvas blob failed");
        try {
          const item = new ClipboardItem({ "image/png": blob });
          await navigator.clipboard.write([item]);
          setStatus("BATCH COPIED TO CLIPBOARD ✅");
        } catch (clipboardErr) {
          // Fallback mechanism if permissions block direct write
          console.warn("ClipboardItem failed, trying fallback...", clipboardErr);
          setStatus("FAILED TO WRITE TO CLIPBOARD DIRECTLY");
        }
        setTimeout(() => setStatus("LIVE & SYNCED"), 3000);
      }, "image/png");

    } catch (error) {
      console.error(error);
      setStatus("FAILED TO COPY IMAGES");
    }
  };

  // Send answer back to your Tauri app
  const sendAnswer = async () => {
    if (!answer.trim()) return;
    setStatus("SENDING...");

    const { error } = await supabase
      .from("copilot_sessions")
      .insert([
        {
          session_code: sessionCode,
          batch_id: "reply_" + Date.now(),
          answer_text: answer,
        }
      ]);

    if (error) {
      setStatus("FAILED TO SEND");
    } else {
      setStatus("ANSWER DELIVERED ✅");
      setAnswer("");
      setTimeout(() => setStatus("LIVE & SYNCED"), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-mono p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* HEADER & CONNECTION */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="text-emerald-500" />
            <h1 className="text-xl font-bold text-white tracking-widest">OVERSEER TERMINAL</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold px-3 py-1 rounded ${isConnected ? "bg-emerald-900 text-emerald-400" : "bg-red-900 text-red-400"}`}>
              {status}
            </span>
            <input 
              type="text" 
              placeholder="ENTER 6-DIGIT CODE" 
              value={sessionCode}
              onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
              disabled={isConnected}
              className="bg-slate-950 border border-slate-700 rounded px-3 py-1 text-sm outline-none focus:border-emerald-500"
            />
            <button 
              onClick={() => setIsConnected(!isConnected)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4 py-1 rounded transition-colors"
            >
              {isConnected ? "DISCONNECT" : "CONNECT"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* IMAGE FEED (LEFT COLUMN) */}
          <div className="lg:col-span-2 space-y-6 overflow-y-auto max-h-[80vh] pr-2">
            {!isConnected && (
              <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-800 rounded-xl text-slate-500">
                <RefreshCw className="w-8 h-8 mb-3 animate-spin opacity-50" />
                <p>Waiting for connection...</p>
              </div>
            )}

            {Object.keys(batches).reverse().map((batchId, index) => (
              <div key={batchId} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="bg-slate-800/50 p-3 flex items-center justify-between border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-400">BATCH: {batchId}</span>
                  <button 
                    onClick={() => copyBatchToClipboard(batches[batchId])}
                    className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors"
                  >
                    <Copy className="w-4 h-4" /> COPY ALL IMAGES TO CLIPBOARD
                  </button>
                </div>
                
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950">
                  {batches[batchId].map((img) => (
                    <img 
                      key={img.id} 
                      src={img.image_url} 
                      alt="Capture" 
                      className="rounded border border-slate-700 w-full h-auto object-contain bg-black"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* REPLY TERMINAL (RIGHT COLUMN) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col h-[80vh]">
            <h2 className="text-sm font-bold text-emerald-500 mb-4 border-b border-slate-800 pb-2">TRANSMIT OVERRIDE</h2>
            
            <textarea 
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-white resize-none outline-none focus:border-emerald-500 font-sans"
              placeholder="Paste AI response or type manual override here. It will instantly appear on their screen..."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            
            <button 
              onClick={sendAnswer}
              disabled={!isConnected || !answer.trim()}
              className="mt-4 flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" /> TRANSMIT TO COPILOT
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

