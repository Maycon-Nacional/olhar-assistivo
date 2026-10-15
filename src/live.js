// Sessão Gemini Live (WebSocket): áudio do microfone + quadros da câmera → voz da resposta.
// O servidor detecta quando a pessoa fala (VAD), interrompe a própria fala e devolve transcrições.
import { GEMINI_KEY, LIVE_MODEL, LIVE_URL, LIVE_VOICE } from './config'
import { LIVE_PROMPT, LIVE_TOOLS } from './prompts'

export class LiveSession {
  // h: { onAudio(b64), onInterrupted(), onTurnComplete(), onUserText(t), onModelText(t),
  //      onUserSpeech(start:boolean), onTool(name, args) → any, onState('connecting'|'ready'|'closed') }
  constructor(h) {
    this.h = h
    this.ws = null
    this.ready = false
    this.handle = null // retomada de sessão (mantém o contexto ao reconectar)
    this.wanted = false
    this.retry = 0
  }

  connect() {
    this.wanted = true
    if (this.ws) return
    this.h.onState('connecting')
    const ws = new WebSocket(`${LIVE_URL}?key=${GEMINI_KEY}`)
    ws.binaryType = 'arraybuffer' // o Gemini manda parte das mensagens como binário (no RN o padrão seria Blob)
    this.ws = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: `models/${LIVE_MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } }, languageCode: 'pt-BR' },
          },
          systemInstruction: { parts: [{ text: LIVE_PROMPT }] },
          tools: LIVE_TOOLS,
          realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 600, prefixPaddingMs: 200 } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // sem isso, sessões com vídeo caem em ~2 min
          contextWindowCompression: { slidingWindow: {} },
          sessionResumption: this.handle ? { handle: this.handle } : {},
        },
      }))
    }

    ws.onmessage = (ev) => {
      let m
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)) } catch { return }
      if (m.setupComplete) {
        this.ready = true
        this.retry = 0
        this.h.onState('ready')
        return
      }
      if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
        this.handle = m.sessionResumptionUpdate.newHandle
      }
      if (m.goAway) { this.reconnect(0); return } // servidor vai encerrar: reconecta já, com o contexto
      if (m.voiceActivity?.type === 'ACTIVITY_START') this.h.onUserSpeech(true)
      if (m.voiceActivity?.type === 'ACTIVITY_END') this.h.onUserSpeech(false)
      if (m.toolCall) this.handleTools(m.toolCall.functionCalls || [])

      const sc = m.serverContent
      if (!sc) return
      if (sc.interrupted) this.h.onInterrupted()
      if (sc.inputTranscription?.text) this.h.onUserText(sc.inputTranscription.text)
      if (sc.outputTranscription?.text) this.h.onModelText(sc.outputTranscription.text)
      for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) this.h.onAudio(p.inlineData.data)
      if (sc.turnComplete) this.h.onTurnComplete()
    }

    ws.onerror = () => {}
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      this.ready = false
      this.h.onState('closed', e?.reason) // ex.: limite do plano grátis
      if (this.wanted) this.reconnect(Math.min(8000, 500 * 2 ** this.retry++))
    }
  }

  reconnect(delay) {
    const old = this.ws
    this.ws = null
    this.ready = false
    try { old?.close() } catch {}
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.wanted && this.connect(), delay)
  }

  async handleTools(calls) {
    const functionResponses = []
    for (const c of calls) {
      let result = 'ok'
      try { result = (await this.h.onTool(c.name, c.args || {})) ?? 'ok' } catch (e) { result = 'erro: ' + e.message }
      functionResponses.push({ id: c.id, name: c.name, response: { result } })
    }
    this.send({ toolResponse: { functionResponses } })
  }

  send(obj) {
    if (this.ready && this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj))
  }

  sendAudio(b64) { this.send({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } }) }
  sendFrame(b64) { this.send({ realtimeInput: { video: { data: b64, mimeType: 'image/jpeg' } } }) }
  sendText(text) { this.send({ realtimeInput: { text } }) }
  // Pedido completo (imagem + texto na mesma mensagem): o modelo sempre usa ESTA imagem.
  sendTurn(imageB64, text) {
    const parts = imageB64 ? [{ inlineData: { data: imageB64, mimeType: 'image/jpeg' } }, { text }] : [{ text }]
    this.send({ clientContent: { turns: [{ role: 'user', parts }], turnComplete: true } })
  }

  close() {
    this.wanted = false
    clearTimeout(this.timer)
    const ws = this.ws
    this.ws = null
    this.ready = false
    try { ws?.close() } catch {}
  }
}
