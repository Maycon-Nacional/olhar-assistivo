// Gera as falas fixas do app com a voz do Gemini (mesma voz da conversa ao vivo).
// Rodar: node scripts/gen-voice.mjs   (lê EXPO_PUBLIC_GEMINI_KEY do .env)
// Saída: WAV 24 kHz mono 16-bit em modules/olhar-native/android/src/main/assets/voice/
import fs from 'fs'
import { PHRASES } from '../src/phrases.js'
const root = new URL('..', import.meta.url)
const key = fs.readFileSync(new URL('.env', root), 'utf8').match(/EXPO_PUBLIC_GEMINI_KEY=(\S+)/)[1]
const out = new URL('modules/olhar-native/android/src/main/assets/voice/', root)
fs.mkdirSync(out, { recursive: true })

// textos em src/phrases.js (o app usa os mesmos textos como reserva)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const only = process.argv.slice(2) // opcional: gerar só algumas
for (const [name, text] of Object.entries(PHRASES)) {
  if (only.length && !only.includes(name)) continue
  if (fs.existsSync(new URL(`${name}.wav`, out))) { console.log(name, 'já existe'); continue }
  for (let tries = 0; ; tries++) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }], // só o texto: instrução de estilo seria lida em voz alta
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
    }),
  })
  const j = await r.json()
  if (r.status === 429 && tries < 30) { console.log(name, 'limite grátis, aguardando 65s…'); await sleep(65000); continue }
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!part) { console.error(name, JSON.stringify(j).slice(0, 300)); process.exit(1) }
  const pcm = Buffer.from(part.inlineData.data, 'base64')
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] || 24000)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  fs.writeFileSync(new URL(`${name}.wav`, out), Buffer.concat([h, pcm]))
  console.log(`${name}: ${(pcm.length / 2 / rate).toFixed(1)}s @ ${rate}Hz`)
  break
  }
}
