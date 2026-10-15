// Alternativa ao gen-voice.mjs quando a cota diária de TTS acaba: grava as falas pelo Gemini Live
// (mesma voz "Kore"), pedindo leitura literal. Confere a transcrição antes de salvar.
// Rodar: node scripts/gen-voice-live.mjs [nomes...]   (só gera os que ainda não existem)
import fs from 'fs'
import { PHRASES } from '../src/phrases.js'
const root = new URL('..', import.meta.url)
const key = fs.readFileSync(new URL('.env', root), 'utf8').match(/EXPO_PUBLIC_GEMINI_KEY=(\S+)/)[1]
const out = new URL('modules/olhar-native/android/src/main/assets/voice/', root)
const URL_ = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w ]/g, ' ').replace(/\s+/g, ' ').trim()

function record(text) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_)
    const chunks = []
    let said = ''
    ws.onopen = () => ws.send(JSON.stringify({ setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }, languageCode: 'pt-BR' } },
      systemInstruction: { parts: [{ text: 'Você é um locutor. Leia em voz alta, em português do Brasil, EXATAMENTE o texto que receber, palavra por palavra, com voz calma, clara e acolhedora. Não acrescente nem omita nada. Não comente.' }] },
      outputAudioTranscription: {},
    } }))
    ws.onmessage = async (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString())
      if (m.setupComplete) {
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }))
        return
      }
      const sc = m.serverContent
      if (!sc) return
      if (sc.outputTranscription?.text) said += sc.outputTranscription.text
      for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) chunks.push(Buffer.from(p.inlineData.data, 'base64'))
      if (sc.turnComplete) { ws.close(); resolve({ pcm: Buffer.concat(chunks), said }) }
    }
    ws.onclose = (e) => { if (!chunks.length) reject(new Error(`fechou ${e.code} ${e.reason}`)) }
    setTimeout(() => reject(new Error('timeout')), 120000)
  })
}

const only = process.argv.slice(2)
for (const [name, text] of Object.entries(PHRASES)) {
  if (only.length && !only.includes(name)) continue
  if (fs.existsSync(new URL(`${name}.wav`, out))) continue
  for (let tries = 1; tries <= 3; tries++) {
    const { pcm, said } = await record(text)
    const a = norm(text), b = norm(said)
    const ok = a === b
    console.log(`${name} (tentativa ${tries}): ${(pcm.length / 48000).toFixed(1)}s ${ok ? 'texto idêntico' : 'DIFERENTE'}`)
    if (!ok) { console.log('  esperado:', a, '\n  falado:  ', b); continue }
    const h = Buffer.alloc(44)
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
    h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28)
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
    fs.writeFileSync(new URL(`${name}.wav`, out), Buffer.concat([h, pcm]))
    break
  }
}
