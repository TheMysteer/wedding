# 💍 Wedding DJ — Painel de Músicas

## ▶ Como abrir

| Situação | Arquivo a abrir |
|---|---|
| Com internet | `index.html` (usa fontes do Google) |
| Sem internet / no casamento | `index-offline.html` (usa fontes do sistema) |

Abra o arquivo no **Google Chrome** ou **Microsoft Edge**.  
Nenhuma instalação necessária. Funciona 100% offline.

---

## 📁 Estrutura das pastas

```
wedding-dj/
  index.html            ← versão com internet
  index-offline.html    ← versão sem internet (use essa no casamento)
  style.css             ← estilos
  app.js                ← lógica
  README.md             ← este arquivo
  musicas/
    entrada-saida/      ← coloque aqui suas músicas especiais
    fundo/              ← coloque aqui as músicas de fundo
```

> As pastas dentro de `musicas/` são só para organização.
> Para carregar as músicas no site, use os botões **＋ Arquivos** ou **📁 Pasta**. Da primeira vez você precisa selecionar manualmente a pasta ou os arquivos; depois disso o sistema lembra as músicas em cache e elas reaparecem automaticamente, mesmo após reiniciar o navegador (funciona offline via IndexedDB).

---

## 🎵 Como usar

### 1. Carregar músicas
- **＋ Arquivos** → seleciona um ou mais arquivos avulsos
- **📁 Pasta** → seleciona uma pasta inteira de uma vez (mais prático!)

### 2. Painéis
| Painel | Para que serve |
|---|---|
| 🎊 **Entrada & Saída** | Música da entrada dos noivos, saída, momentos especiais |
| 🎶 **Fundo** | Músicas contínuas que tocam durante o evento |

### 3. Ativar uma playlist
- Clique em **▶ Ativar** para começar a tocar pela primeira faixa
- Clique duas vezes em qualquer faixa para tocá-la imediatamente
- O painel ativo fica destacado com borda dourada

### 4. Mover músicas entre painéis
- Passe o mouse sobre uma faixa → aparece botão 🎶 ou 🎊
- Clique nele para mover a música para o outro painel (sem parar a reprodução)

---

## 🎛 Controles do player

| Botão | Função |
|---|---|
| **▶ / ⏸** | Play / Pause |
| **⏮** | Voltar (ou reiniciar se >3s tocados) |
| **⏭** | Próxima faixa |
| **⇄** | Aleatório (shuffle) |
| **↻ / ↺** | Repetir: desligado → repetir tudo → repetir esta música |
| **⏩** | Reprodução automática (avança pro próximo automaticamente) |
| **🌙 / ☀️** | Alternar tema claro/escuro |

## ⌨️ Atalhos de teclado

| Tecla | Ação |
|---|---|
| `Espaço` | Play / Pause |
| `Alt + →` | Próxima faixa |
| `Alt + ←` | Faixa anterior |
| `Alt + S` | Alternar aleatório |
| `Alt + R` | Ciclo de repetição |

---

## 🎧 Formatos suportados

| Formato | Suporte |
|---|---|
| **MP3** | ✅ Todos os navegadores |
| **MPEG / MPG** | ✅ Geralmente funciona |
| **WAV, OGG, M4A, AAC, FLAC, OPUS** | ✅ Chrome e Edge |
| **WMA** | ⚠️ Somente Microsoft Edge no Windows |

> **Dica sobre WMA:** Se tiver arquivos WMA que não tocam, abra o site no
> **Microsoft Edge** (não Chrome). O Edge usa os codecs do Windows e consegue
> reproduzir WMA nativamente.

---

## 💡 Dicas para o dia do casamento

1. Abra o `index-offline.html` no Edge ou Chrome
2. Use **📁 Pasta** para cada painel — carrega todas as músicas de uma vez
3. Ative o **⇄ Aleatório** e **⏩ Reprodução automática** para as músicas de fundo
4. Para momentos especiais, troque para o painel **Entrada & Saída** e clique **▶ Ativar**
5. Ligue o volume máximo no Windows e controle pelo slider do player
