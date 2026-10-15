// Ponte JS → módulo nativo Android (modules/olhar-native/android).
import { requireNativeModule } from 'expo-modules-core'

const Native = requireNativeModule('OlharNative')
export default Native

// Eventos: onMic {data, level}, onPlayback {playing}, onSpeech {speaking}
export const on = (event, cb) => Native.addListener(event, cb)
