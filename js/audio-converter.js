// js/audio-converter.js
// 浏览器端音频处理：webm blob → PCM Int16 16kHz mono → base64

export async function webmToPcmBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  const audioCtx = new AudioContext();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    console.log('[conv] decoded: sampleRate=', audioBuffer.sampleRate, 'channels=', audioBuffer.numberOfChannels, 'duration=', audioBuffer.duration);

    const targetRate = 16000;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(targetRate * audioBuffer.duration), targetRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    const resampled = await offlineCtx.startRendering();

    const floatData = resampled.getChannelData(0);
    const pcm = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      pcm[i] = Math.max(-32768, Math.min(32767, floatData[i] * 32768));
    }

    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    return { base64, byteLen: pcm.byteLength };
  } finally {
    audioCtx.close();
  }
}
