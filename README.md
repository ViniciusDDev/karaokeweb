# 🎤 OpenKaraoke (Plug & Play)

Um aplicativo local de Karaokê leve, web-based e projetado sob o conceito **1-Click / Plug & Play** para Windows. O projeto permite buscar vídeos no YouTube, separar dinamicamente as faixas de áudio por inteligência artificial (com suporte a GPU e CPU) e reproduzir as faixas com mixer individual e visual personalizável.

---

## 🎯 Proposta do Projeto

* **Zero Configuração (1-Click):** Qualquer pessoa sem conhecimento de programação pode rodar o app apenas dando dois cliques no arquivo `iniciar_karaoke.bat`.
* **Instalação e Setup Automático:** O script `.bat` gerencia o ambiente Python (`venv`), instala as dependências e abre o navegador automaticamente na página do aplicativo (`http://localhost:5000`).
* **Busca Integrada no YouTube:** Pesquise diretamente na interface web para selecionar a próxima música.
* **Separação Dinâmica em 3 Faixas (IA):** Divisão automática do áudio em **Instrumental**, **Backing Vocals** e **Voz Principal**.
* **Modo Economia de Recursos (Hardware Fallback):** Detecção automática de aceleração por GPU (PyTorch CUDA). Em computadores sem GPU dedicada (ex: notebooks simples), o sistema alterna automaticamente para modelos leves otimizados para CPU.
* **Controle da Mixer & Interface:**
  * Sliders de volume independentes para cada uma das 3 faixas de áudio.
  * Capa do álbum utilizada como imagem de fundo da tela de karaokê.
  * Controle de contraste/opacidade para garantir 100% de leitura da letra da música sobre o fundo.
* **Sistema de Pontuação Amigável:** Cálculo de pontuação festivo ao final de cada música, garantindo notas sempre entre **75 e 100**.
* **Limpeza de Sessão:** O histórico de pontuações ("Hall da Fama") e os arquivos de áudio baixados/processados em `./temp/` são mantidos apenas na memória e limpos automaticamente ao encerrar o aplicativo.

---

## 🛠️ Arquitetura e Tecnologias

* **Automação & Bootstrapping:** Batch Script (`iniciar_karaoke.bat`).
* **Backend:** Python (FastAPI ou Flask) + `yt-dlp` (download de áudio) + `demucs` / `torch` (separação de faixas).
* **Frontend:** Single Page Application (SPA) em HTML5, TailwindCSS e Vanilla JavaScript.

---

## 🚀 Como Executar

1. Baixe ou clone a pasta do repositório `./open-karaoke/`.
2. Execute o arquivo **`iniciar_karaoke.bat`** com dois cliques.
3. Aguarde o setup inicial (caso seja a primeira execução, as dependências serão baixadas automaticamente).
4. O navegador abrirá automaticamente em `http://localhost:5000`.

---

## 📂 Estrutura do Repositório

```text
open-karaoke/
├── AGENTS.md             # Diretrizes e contexto para o Antigravity CLI
├── README.md             # Documentação principal do projeto
├── iniciar_karaoke.bat   # Script de inicialização 1-click para Windows
├── requirements.txt      # Dependências Python (FastAPI, yt-dlp, demucs, torch, etc.)
├── backend/              # Código do servidor backend Python
│   ├── main.py           # Endpoints REST e servidor web
│   └── audio_processor.py# Módulo de separação de áudio e detecção de GPU/CPU
├── frontend/             # Interface web (HTML/JS/CSS)
│   ├── index.html        # Single Page Application
│   └── app.js            # Lógica dos sliders, busca e player
└── temp/                 # Diretório temporário (limpo a cada encerramento)
```

---

## 🤝 Desenvolvimento com Antigravity CLI

Este repositório está configurado para desenvolvimento guiado por IA usando o **Antigravity CLI**. O arquivo `AGENTS.md` contém todas as instruções de *pair programming*, regras de código e o checklist de entrega (`Done-When`).

Para iniciar o desenvolvimento com a CLI:
```bash
cd open-karaoke
agy
```