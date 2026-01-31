async function playTTS(text) {
  const response = await fetch("http://localhost:3000/api/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: text,
      voice: "en-US-AriaNeural",
      rate: "+10%",
      pitch: "-5%",
    }),
  });

  if (!response.ok) {
    throw new Error("TTS request failed");
  }

  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);

  const audio = new Audio(audioUrl);
  audio.play();
}

// Example usage
playTTS("Hello from pure JavaScript frontend");
