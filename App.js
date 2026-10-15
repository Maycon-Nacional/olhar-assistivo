import { useEffect, useRef, useState } from 'react'
import { AppState, Linking, PermissionsAndroid, Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useKeepAwake } from 'expo-keep-awake'
import { addNetworkStateListener } from 'expo-network'
import { Assistant, buzz } from './src/assistant'

const PERMS = [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]
const hasPerms = async () => (await Promise.all(PERMS.map((p) => PermissionsAndroid.check(p)))).every(Boolean)
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms))

export default function App() {
  useKeepAwake() // tela apagada derruba câmera e microfone
  const ai = useRef(null)
  const [st, setSt] = useState({ phase: 'boot', live: 'connecting', liveError: '', speaking: false, user: '', answer: '' })
  const set = (p) => setSt((s) => ({ ...s, ...p }))

  if (!ai.current) ai.current = new Assistant({ set })

  // ---------- permissões + início ----------
  async function boot() {
    const a = ai.current
    a.startOutput()
    if (!(await hasPerms())) {
      a.playVoice('perm_intro')
      await waitMs(5500) // deixa a explicação tocar antes das janelas do sistema
      const res = await PermissionsAndroid.requestMultiple(PERMS)
      if (!PERMS.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED)) {
        set({ phase: 'denied' })
        a.playVoice('perm_denied')
        return
      }
    }
    await a.startInput()
    set({ phase: 'ready' })
    a.welcome()
  }

  useEffect(() => {
    boot()
    return () => ai.current?.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // voltou das configurações / do segundo plano
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      const a = ai.current
      if (s !== 'active') { if (st.phase === 'ready') a.pause(); return }
      if (st.phase === 'denied' && (await hasPerms())) {
        await a.startInput()
        set({ phase: 'ready' })
        a.welcome()
      } else if (st.phase === 'ready') a.resume()
    })
    return () => sub.remove()
  }, [st.phase])

  // internet caiu / voltou: avisa por voz
  useEffect(() => {
    const sub = addNetworkStateListener((n) => ai.current.network(!!n.isConnected && n.isInternetReachable !== false))
    return () => sub.remove()
  }, [])

  const a = ai.current
  const ready = st.phase === 'ready'

  if (st.phase === 'denied') {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <Pressable
          style={s.full}
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Abrir configurações para liberar câmera e microfone"
          accessibilityHint="Depois de liberar, volte para o app."
        >
          <Text style={s.fullBig}>Liberar câmera e microfone</Text>
          <Text style={s.fullSmall}>Toque para abrir as configurações</Text>
        </Pressable>
      </View>
    )
  }

  const state = !ready ? 'Iniciando…'
    : st.live !== 'ready' ? `Conectando…${st.liveError ? ' (' + st.liveError + ')' : ''}`
    : st.speaking ? '◉ Falando (fale por cima para interromper)'
    : '● Ouvindo'

  return (
    <View style={s.root}>
      <StatusBar style="light" hidden />

      {/* Sem região "live": o próprio app já fala (evita leitura dobrada com TalkBack) */}
      <View style={s.panel} accessible accessibilityLabel={`${state}. ${st.user ? 'Você disse: ' + st.user : ''}`}>
        <Text style={s.state} maxFontSizeMultiplier={1.4}>{state}</Text>
        {!!st.user && <Text style={s.user} numberOfLines={2} maxFontSizeMultiplier={1.4}>Você: {st.user}</Text>}
        {!!st.answer && <Text style={s.answer} numberOfLines={4} maxFontSizeMultiplier={1.4}>{st.answer}</Text>}
      </View>

      <Btn
        style={s.big} disabled={!ready} n={1} icon="👁" label="Descrever"
        hint="Conta o que está à sua frente. Segure para ouvir a explicação."
        onPress={() => a.describe()} onLongPress={() => a.hint('hint_describe')}
      />
      <Btn
        style={s.small} disabled={!ready} n={2} icon="■" label="Parar" danger
        hint="Me cala na hora."
        onPress={() => a.stop()} onLongPress={() => a.hint('hint_stop')}
      />
    </View>
  )
}

// Botão grande: vibra n vezes (= posição), segurar fala a função.
function Btn({ style, n, icon, label, hint, onPress, onLongPress, disabled, danger }) {
  const color = danger ? RED : YELLOW
  return (
    <Pressable
      disabled={disabled}
      onPress={() => { buzz(n); onPress() }}
      onLongPress={() => { buzz(n); onLongPress() }}
      delayLongPress={600}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [s.btn, style, { borderColor: color }, pressed && { backgroundColor: color }]}
    >
      {({ pressed }) => {
        const c = pressed ? '#000' : color
        return (
          <>
            <Text style={[s.icon, { color: c }]} accessible={false}>{icon}</Text>
            <Text style={[s.label, { color: c }]} maxFontSizeMultiplier={1.3}>{label}</Text>
          </>
        )
      }}
    </Pressable>
  )
}

// Alto contraste (WCAG AAA): amarelo sobre preto, alvos de toque enormes.
const YELLOW = '#FFD400'
const RED = '#FF4D4D'
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', padding: 10, paddingTop: 36, gap: 10 },
  panel: { minHeight: 120, maxHeight: '24%', paddingHorizontal: 6 },
  state: { color: YELLOW, fontWeight: '800', fontSize: 18 },
  user: { color: '#9FD8FF', fontSize: 19, marginTop: 6 },
  answer: { color: '#fff', fontSize: 21, fontWeight: '600', marginTop: 6, lineHeight: 28 },
  btn: { borderWidth: 5, borderRadius: 28, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  big: { flex: 2 },
  small: { flex: 1 },
  icon: { fontSize: 48, marginBottom: 6 },
  label: { fontSize: 30, fontWeight: '900', textAlign: 'center' },
  full: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, borderWidth: 6, borderColor: YELLOW, borderRadius: 28 },
  fullBig: { color: YELLOW, fontSize: 34, fontWeight: '800', textAlign: 'center' },
  fullSmall: { color: '#fff', fontSize: 22, marginTop: 16, textAlign: 'center' },
})
