// Where the spoken voice goes. Besides this computer's speakers it can go to a virtual audio cable
// (VB-Audio Virtual Cable, Steam Streaming Microphone, ...) that meeting apps (Zoom, Meet, Teams,
// Discord) use as a microphone, so the other people hear the voice as if the user spoke.
// Uses HTMLMediaElement.setSinkId (Chrome/Edge). Listing output devices by name needs microphone
// permission once; the microphone stream is stopped immediately and nothing is recorded.
const KEY = 'signvoice-voice-output';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (value) => { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode */ } };
const VIRTUAL = /cable|virtual|voicemeeter|steam streaming microphone|blackhole|loopback/i;

export const outputSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
let settings = { deviceId: '', label: '', monitor: true, ...load() };

export const voiceOutput = () => settings;

export async function listOutputs({ askPermission = false } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (askPermission && !devices.some((d) => d.kind === 'audiooutput' && d.label)) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());  // only needed to reveal device names
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  return devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ id: d.deviceId, label: d.label || 'อุปกรณ์เสียง', virtual: VIRTUAL.test(d.label) }));
}

/**
 * Firefox / Zen do not list speakers in enumerateDevices(); instead the browser shows its own picker
 * (selectAudioOutput). The chosen device can then be used with setSinkId like in Chrome.
 */
export const canPickOutput = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.selectAudioOutput;
export async function pickOutput() {
  const d = await navigator.mediaDevices.selectAudioOutput();
  return { id: d.deviceId, label: d.label || 'อุปกรณ์ที่เลือก', virtual: VIRTUAL.test(d.label) };
}

export function setVoiceOutput(next) {
  settings = { ...settings, ...next };
  save(settings);
}

/**
 * Plays the voice. Returns { primary, extra }: `primary` drives the end of speech and the aura;
 * `extra` is a second copy sent to the chosen device when the user also wants to hear it.
 */
export async function routeAudio(url) {
  const primary = new Audio(url);
  if (!outputSupported || !settings.deviceId) return { primary, extra: null, analyse: true };
  try {
    if (!settings.monitor) {
      await primary.setSinkId(settings.deviceId);
      return { primary, extra: null, analyse: false };  // Web Audio analysis would pull it back to the speakers
    }
    const extra = new Audio(url);
    await extra.setSinkId(settings.deviceId);
    return { primary, extra, analyse: true };
  } catch (error) {  // device unplugged or not allowed: speak on the normal speakers
    console.warn('voice output device unavailable:', error.message);
    return { primary: new Audio(url), extra: null, analyse: true, failed: true };
  }
}
