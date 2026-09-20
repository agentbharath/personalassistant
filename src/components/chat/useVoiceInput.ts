"use client";

import { useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

/** Browser speech-to-text that appends to whatever is already typed. Unchanged behavior, now isolated. */
export function useVoiceInput(getText: () => string, setText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");

  useEffect(() => () => recognitionRef.current?.abort(), []);

  function stop() { recognitionRef.current?.stop(); }
  function clearMessage() { setVoiceMessage(null); }

  function toggle() {
    if (listening) { stop(); return; }
    const browserWindow = window as typeof window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) { setVoiceMessage("Voice input isn’t supported by this browser."); return; }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    baseRef.current = getText().trim();
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0]?.transcript ?? "";
      setText([baseRef.current, transcript.trim()].filter(Boolean).join(" "));
    };
    recognition.onerror = (event) => {
      setVoiceMessage(event.error === "not-allowed" ? "Microphone access was not allowed." : "Voice transcription stopped. You can keep typing.");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      setVoiceMessage((current) => (current?.startsWith("Listening") ? "Transcript ready—review before sending." : current));
    };
    recognitionRef.current = recognition;
    setVoiceMessage("Listening… review the transcript before sending.");
    setListening(true);
    recognition.start();
  }

  return { listening, voiceMessage, toggle, stop, clearMessage };
}
