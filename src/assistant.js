// Controlador: liga microfone (com cancelamento de eco) → Gemini Live → alto-falante,
// câmera → imagem para o Live, falas gravadas e botões.
import { File, Paths } from 'expo-file-system'
import Native, { on } from '../modules/olhar-native'
import { LiveSession } from './live'
import { DESCRIBE_TEXT } from './prompts'
import { PHRASES } from './phrases'

const FRAME_EVERY_MS = 1000 // o Live aceita no máx. 1 quadro/s
const SPEECH_DB = -38 // nível do microfone considerado voz (para enviar quadro junto da pergunta)

// ---------- sinais não visuais ----------
export const buzz = (n) => Native.vibrate(Array.from({ length: n * 2 - 1 }, (_, i) => (i % 2 ? 110 : 70)), 255)
const tone = {
  listen: () => Native.tone(660, 70, 0.25),
  capture: () => Native.tone(1200, 45, 0.18),
  stop: () => Native.tone(330, 120, 0.3),
}

// ---------- preferências ----------
const prefsFile = () => new File(Paths.document, 'olhar.json')
function loadPrefs() { try { const f = prefsFile(); return f.exists ? JSON.parse(f.textSync()) : {} } catch { return {} } }
function savePrefs(p) { try { const f = prefsFile(); if (!f.exists) f.create(); f.write(JSON.stringify(p)) } catch {} }

export class Assistant {
  constructor(ui) {
    this.ui = ui // { set(partialState) }
    this.prefs = loadPrefs()
    this.playing = false // alto-falante tocando (Live ou fala gravada)
    this.systemVoice = false // fala gravada tocando → microfone pausado
    this.ttsSpeaking = false // fala de reserva (voz do sistema) → microfone pausado
    this.ignoreModel = false // depois de "Parar": descarta o resto da fala do modelo
    this.lastFrame = 0
    this.userText = ''
    this.modelText = ''
    this.subs = []

    this.live = new LiveSession({
      onState: (s, reason) => this.ui.set({ live: s, liveError: s === 'closed' ? reason || '' : '' }),
      onAudio: (b64) => { if (!this.ignoreModel) Native.playPcm(b64) },
      onInterrupted: () => { Native.flush(); this.ignoreModel = false },
      onTurnComplete: () => { this.ignoreModel = false },
      onUserSpeech: (start) => {
        if (!start) return
        this.ignoreModel = false
        this.userText = ''
        this.modelText = ''
        if (!this.playing) tone.listen()
        this.sendFrame(true)
      },
      onUserText: (t) => { this.userText += t; this.ui.set({ user: this.userText.trim() }) },
      onModelText: (t) => { if (!this.ignoreModel) { this.modelText += t; this.ui.set({ answer: this.modelText.trim() }) } },
      onTool: (name) => this.onTool(name),
    })
  }

  // ---------- início ----------
  startOutput() {
    Native.startOutput()
    this.subs.push(
      on('onPlayback', ({ playing }) => {
        this.playing = playing
        this.ui.set({ speaking: playing })
      }),
      on('onSpeech', ({ speaking }) => { this.ttsSpeaking = speaking; this.updateMic() }),
      on('onMic', ({ data, level }) => {
        if (!this.live.ready) {
          // falou sem conexão: avisa (no máx. a cada 15 s)
          if (level > SPEECH_DB && Date.now() - (this.warnedAt || 0) > 15000) {
            this.warnedAt = Date.now()
            this.playVoice('reconnecting')
          }
          return
        }
        this.live.sendAudio(data)
        if (level > SPEECH_DB) this.sendFrame(false)
      }),
    )
  }

  async startInput() {
    const r = await Native.startInput()
    this.aec = r?.aec
    this.live.connect()
  }

  welcome() {
    const first = !this.prefs.tutorialSeen
    this.playVoice(first ? 'tutorial' : 'welcome')
    if (first) { this.prefs = { ...this.prefs, tutorialSeen: true }; savePrefs(this.prefs) }
  }

  // ---------- microfone ----------
  updateMic() {
    // pausado enquanto toca fala gravada (o Live não deve responder a ela)
    Native.setMicEnabled(!this.systemVoice && !this.ttsSpeaking && !this.paused)
  }

  pause() { this.paused = true; this.updateMic(); this.live.close() }
  resume() { this.paused = false; this.updateMic(); this.live.connect() }

  // ---------- câmera ----------
  async sendFrame(force) {
    const now = Date.now()
    if (!this.live.ready || now - this.lastFrame < (force ? 400 : FRAME_EVERY_MS)) return
    this.lastFrame = now
    const img = await Native.getFrame(640, 60)
    if (img) this.live.sendFrame(img)
  }

  // ---------- falas gravadas ----------
  playVoice(name) {
    Native.flush()
    clearTimeout(this.voiceTimer)
    this.systemVoice = true
    this.updateMic()
    let ms = 0
    try { ms = Native.playVoice(name) } catch {}
    if (!ms) { // sem o WAV gravado: usa a voz do sistema (microfone pausado pelo evento onSpeech)
      this.systemVoice = false
      Native.speak(PHRASES[name] || '', 1.0)
    } else {
      // microfone volta quando a fala gravada termina (ou antes, se apertar Parar)
      this.voiceTimer = setTimeout(() => { this.systemVoice = false; this.updateMic() }, ms + 300)
    }
    this.ui.set({ answer: PHRASES[name] })
  }

  // ---------- botões ----------
  describe() {
    if (!this.live.ready) return this.playVoice('reconnecting')
    Native.flush()
    Native.stopSpeak()
    clearTimeout(this.voiceTimer)
    this.systemVoice = false
    this.updateMic()
    this.ignoreModel = false
    this.modelText = ''
    this.userText = 'Descrever'
    this.ui.set({ user: 'Descrever', answer: '' })
    tone.capture()
    // imagem e pedido na mesma mensagem: o modelo sempre descreve ESTA imagem
    Native.getFrame(1024, 70).then((img) => this.live.sendTurn(img, DESCRIBE_TEXT)) // maior: ajuda a ler textos
  }

  stop() {
    Native.flush()
    Native.stopSpeak()
    this.ignoreModel = true // descarta o resto desta resposta
    clearTimeout(this.voiceTimer)
    this.systemVoice = false
    this.updateMic()
    tone.stop()
  }

  hint(name) { this.playVoice(name) }

  // ---------- ferramentas chamadas pelo modelo (comandos de voz) ----------
  onTool(name) {
    if (name === 'tutorial') {
      this.ignoreModel = true
      this.playVoice('tutorial')
      return 'O tutorial está tocando. Não fale nada.'
    }
    if (name === 'parar') {
      this.stop()
      return 'Parado. Não fale nada.'
    }
    return 'desconhecido'
  }

  network(online) {
    if (online === this.online) return
    const before = this.online
    this.online = online
    if (before === undefined) return
    this.playVoice(online ? 'internet_back' : 'no_internet')
  }

  destroy() {
    this.subs.forEach((s) => s.remove())
    this.live.close()
    Native.stop()
  }
}
