// Chave vem do arquivo .env (EXPO_PUBLIC_* fica embutido no app — ok para o protótipo do TCC;
// em produção a chave deve ficar num servidor e o app usar tokens temporários).
export const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_KEY

// Conversa em tempo real (voz natural, interrupção no servidor). Plano grátis do Google AI Studio.
// Teste: ~0,35 s do fim da fala até o início da resposta falada.
export const LIVE_MODEL = process.env.EXPO_PUBLIC_LIVE_MODEL || 'gemini-3.8-live'
export const LIVE_VOICE = 'Kore'
export const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
