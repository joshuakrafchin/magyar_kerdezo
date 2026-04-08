let selectedVoiceURI = null;

function getHungarianVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices().filter(v => v.lang.startsWith('hu'));
}

// Voices load async in some browsers
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = () => getHungarianVoices();
}

export function setVoiceURI(uri) {
  selectedVoiceURI = uri;
}

export function getVoiceURI() {
  return selectedVoiceURI;
}

export function listHungarianVoices() {
  return getHungarianVoices().map(v => ({
    uri: v.voiceURI,
    name: v.name,
    lang: v.lang,
    local: v.localService,
  }));
}

export function speak(text, rate = 0.85) {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'hu-HU';

  const voices = getHungarianVoices();
  let voice = null;
  if (selectedVoiceURI) {
    voice = voices.find(v => v.voiceURI === selectedVoiceURI) || null;
  }
  if (!voice && voices.length > 0) {
    voice = voices[0];
  }
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
