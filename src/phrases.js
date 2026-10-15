// Falas fixas do app. Gravadas com a voz do Gemini por scripts/gen-voice.mjs
// (WAV em modules/olhar-native/android/src/main/assets/voice/). Se faltar o WAV, o app usa a voz do sistema.
export const PHRASES = {
  tutorial: `Bem-vindo ao Olhar, seu assistente de visão.
Eu uso a câmera do celular para ver o ambiente e conversar com você sobre ele.
Segure o celular na altura do peito, com a câmera de trás apontando para a frente.
Eu estou sempre ouvindo. Não precisa apertar nada: é só falar.
Por exemplo: o que tem à minha frente? Leia esse papel. Tem alguma porta aqui? De que cor é essa blusa?
Se eu estiver falando, pode falar por cima que eu paro e escuto você.
A tela tem só dois botões.
Em cima, ocupando quase toda a tela, o botão Descrever, que conta o que está à sua frente.
Embaixo, o botão Parar, que me cala na hora.
Se você segurar um botão, eu digo o que ele faz.
Para ouvir estas instruções de novo, é só pedir: me explica de novo.
Com fone de ouvido, a conversa fica ainda melhor.
Pronto! Pode começar.`,
  welcome: 'Olhar ativo. Estou ouvindo, pode falar.',
  perm_intro: 'Bem-vindo ao Olhar. Eu preciso da câmera e do microfone. Vão aparecer duas janelas. Toque em Permitir nas duas.',
  perm_denied: 'Sem a câmera e o microfone eu não consigo ajudar. Toque na tela para abrir as configurações e liberar.',
  no_internet: 'Atenção: sem internet. Não consigo ver nem conversar até a conexão voltar.',
  internet_back: 'Internet de volta. Pode falar.',
  reconnecting: 'Perdi a conexão. Estou reconectando.',
  hint_describe: 'Descrever. Conta o que está à sua frente.',
  hint_stop: 'Botão Parar. Ele me faz parar de falar na hora.',
}
