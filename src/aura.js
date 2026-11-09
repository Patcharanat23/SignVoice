// Rainbow glow around the screen edge while the voice speaks: the one moment colour enters the
// black-and-white app. Its thickness and brightness follow the loudness of the audio (Web Audio
// analyser on the <audio> element). Without an analyser it breathes at a steady speaking rhythm.
export function createAura(el) {
  let context = null;
  let frame = 0;
  let level = 0;

  async function analyserFor(audio) {
    try {
      context ??= new AudioContext();
      if (context.state !== 'running') await Promise.race([context.resume(), new Promise((r) => setTimeout(r, 300))]);
      // Only route the audio through Web Audio when the context really runs, or it would play silently.
      if (context.state !== 'running') return null;
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyser.connect(context.destination);
      return analyser;
    } catch {
      return null;
    }
  }

  function loop(analyser) {
    const data = analyser ? new Uint8Array(analyser.fftSize) : null;
    const tick = () => {
      let target;
      if (analyser) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const x of data) sum += ((x - 128) / 128) ** 2;
        target = Math.min(1, Math.sqrt(sum / data.length) * 5);
      } else {
        const t = performance.now() / 1000;
        target = 0.35 + 0.25 * Math.abs(Math.sin(t * 5.2)) * (0.6 + 0.4 * Math.sin(t * 1.3));
      }
      level += (target - level) * (target > level ? 0.45 : 0.08);  // fast attack, slow release
      el.style.setProperty('--level', level.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(frame);
    tick();
  }

  return {
    /** Prepare before audio.play(): connects the analyser (call once per audio element). */
    async attach(audio) {
      loop(audio ? await analyserFor(audio) : null);
      el.classList.add('on');
    },
    stop() {
      el.classList.remove('on');
      setTimeout(() => { if (!el.classList.contains('on')) { cancelAnimationFrame(frame); level = 0; el.style.setProperty('--level', '0'); } }, 700);
    }
  };
}
