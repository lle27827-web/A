let context: AudioContext | null = null;

function getContext() {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  try {
    context ??= new window.AudioContext();
    return context;
  } catch {
    return null;
  }
}

/** Unlock Web Audio during a user gesture so the save sound can play after the server responds. */
export function primeSaveChime() {
  const audio = getContext();
  if (audio?.state === 'suspended') void audio.resume().catch(() => undefined);
}

/** A quiet two-note chime used only after a successful data mutation. */
export function playSaveChime() {
  const audio = getContext();
  if (!audio) return;

  const play = () => {
    if (audio.state !== 'running') return;
    const start = audio.currentTime;
    [880, 1175].forEach((frequency, index) => {
      const at = start + index * 0.105;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.035, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.16);
    });
  };

  if (audio.state === 'running') play();
  else void audio.resume().then(play).catch(() => undefined);
}
