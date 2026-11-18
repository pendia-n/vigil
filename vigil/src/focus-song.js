const SECONDS = 30
const SAMPLE_RATE = 22050
const BEAT = 0.625

function note(context, output, midi, start, duration, level, type = 'sine') {
  const tone = context.createOscillator()
  const volume = context.createGain()
  tone.type = type
  tone.frequency.value = 440 * 2 ** ((midi - 69) / 12)
  volume.gain.setValueAtTime(0, start)
  volume.gain.linearRampToValueAtTime(level, start + 0.04)
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  tone.connect(volume).connect(output)
  tone.start(start)
  tone.stop(start + duration)
}

function wav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (offset, string) => [...string].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  write(0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  write(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export async function renderFocusSong(seed) {
  const context = new OfflineAudioContext(1, SECONDS * SAMPLE_RATE, SAMPLE_RATE)
  const output = context.createGain()
  output.connect(context.destination)
  output.gain.setValueAtTime(0, 0)
  output.gain.linearRampToValueAtTime(0.8, 0.4)
  output.gain.setValueAtTime(0.8, SECONDS - 0.6)
  output.gain.linearRampToValueAtTime(0, SECONDS)
  const root = 48 + seed % 12
  const chords = [[0, 4, 7, 11], [-3, 0, 4, 7], [-8, -5, 0, 4], [-5, -1, 2, 7]]
  let state = seed
  for (let beat = 0; beat < 48; beat++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const start = beat * BEAT
    const chord = chords[Math.floor(beat / 4) % chords.length]
    if (beat % 4 === 0) {
      note(context, output, root + chord[0] - 12, start, BEAT * 3.8, 0.11)
      for (const pitch of chord) note(context, output, root + pitch, start, BEAT * 3.8, 0.045)
    }
    const pitch = chord[(state >>> 24) % chord.length] + (beat % 4 === 0 ? 12 : 24)
    note(context, output, root + pitch, start, BEAT * 0.9, 0.10, 'triangle')
    if ((state >>> 28) % 3 === 0) note(context, output, root + pitch + 12, start + BEAT / 2, BEAT / 3, 0.035)
  }
  return wav((await context.startRendering()).getChannelData(0))
}
