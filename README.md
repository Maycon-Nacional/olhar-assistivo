# Olhar — app assistivo (TCC, UNEMAT)

Voz + visão computacional para descrição contextual de ambientes para pessoas cegas.
App Android nativo (Expo SDK 57 + módulo nativo próprio). **Não roda no Expo Go.**

## Instalar
APK pronto: `android/app/build/outputs/apk/release/app-release.apk` (arm64).
Copie para o celular e abra (permita "instalar apps desconhecidos"), ou com o cabo USB e depuração ativada:
```
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Gerar o APK de novo
```
npx expo prebuild -p android --no-install   # só se mudar app.json ou dependências nativas
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```
Chave no `.env`: `EXPO_PUBLIC_GEMINI_KEY` (plano grátis do Google AI Studio).

## Como funciona
- A pessoa fala a qualquer momento (microfone sempre ligado) ou toca em **Descrever**.
- O app manda a voz e a imagem atual da câmera ao **Gemini Live**, que responde falando, com voz natural.
- Se a pessoa fala por cima, o Gemini para na hora e escuta (interrupção no servidor).
- Comandos por voz ("para", "me explica de novo") viram ferramentas chamadas pelo modelo.
- Botões: **Descrever** (2/3 da tela) e **Parar**. Segurar um botão fala a função; cada botão vibra diferente (1 ou 2 pulsos).

## Arquitetura
| Parte | Onde | Arquivo |
|---|---|---|
| Microfone com **cancelamento de eco** (VOICE_COMMUNICATION + AEC) e saída de áudio em streaming | Kotlin | `modules/olhar-native/android/.../AudioEngine.kt` |
| Câmera sem obturador (CameraX): último quadro sempre pronto | Kotlin | `CameraEngine.kt` |
| Vibração forte, voz do sistema (reserva), ponte JS | Kotlin | `OlharNativeModule.kt` |
| Conversa por voz em tempo real (Gemini Live, `gemini-3.8-live`) | JS | `src/live.js` |
| Orquestração, botões, falas gravadas | JS | `src/assistant.js`, `App.js` |
| Prompts e falas fixas | JS | `src/prompts.js`, `src/phrases.js` |

Falas fixas (tutorial etc.) são gravadas com a voz do Gemini: `node scripts/gen-voice.mjs`
(o plano grátis limita por dia; o que faltar o app fala com a voz do sistema).

## Medições (PC, out/2026)
- Gemini Live: ~0,35 s do fim da fala até o início da resposta falada; comando de voz → ferramenta em ~0,3 s.
- Botão Descrever (imagem + texto na mesma mensagem): ~1,5 s até a voz.
