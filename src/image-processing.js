export function exposureFor(mean) {
  if (mean >= 95) return { gain: 1, contrast: 1, quality: 'normal' };
  const gain = Math.min(2.2, Math.max(1, 98 / Math.max(mean, 1)));
  return { gain, contrast: 1.08, quality: mean < 35 ? 'very-dark' : 'low-light' };
}

export class FramePreprocessor {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sample = document.createElement('canvas');
    this.sample.width = 64;
    this.sample.height = 36;
    this.sampleCtx = this.sample.getContext('2d', { willReadFrequently: true });
    this.lastCheck = -Infinity;
    this.exposure = exposureFor(128);
  }

  process(video, now) {
    if (now - this.lastCheck > 500) {
      this.lastCheck = now;
      this.sampleCtx.drawImage(video, 0, 0, 64, 36);
      const pixels = this.sampleCtx.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        sum += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      }
      this.exposure = exposureFor(sum / (pixels.length / 4));
    }
    const width = Math.min(video.videoWidth, 960);
    const height = Math.round(width * video.videoHeight / video.videoWidth);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const { gain, contrast } = this.exposure;
    this.ctx.filter = `brightness(${gain.toFixed(2)}) contrast(${contrast.toFixed(2)})`;
    this.ctx.drawImage(video, 0, 0, width, height);
    this.ctx.filter = 'none';
    return this.canvas;
  }
}
