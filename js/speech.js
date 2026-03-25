let hungVoice = null;

function findHungarianVoice() {
  if (hungVoice) return hungVoice;
  const voices = speechSynthesis.getVoices();
  hungVoice = voices.find(v => v.lang.startsWith('hu')) || null;
  return hungVoice;
}

// Voices load async in some browsers
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = () => findHungarianVoice();
}

export function speak(text, rate = 0.85) {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'hu-HU';
  const voice = findHungarianVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  utterance.pitch = 1;
  return new Promise((resolve) => {
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

export function stop() {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel();
  }
}
