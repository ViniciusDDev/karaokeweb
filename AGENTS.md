# AGENTS.md: Agente OpenKaraoke

## Goal

Construir o **`open-karaoke`**: um aplicativo local de Karaokê leve, web-based e no conceito **Plug & Play / 1-Click** para Windows. O app deve ser iniciado por um script `.bat` (que verifica/instala o ambiente Python automaticamente), baixar vídeos do YouTube via `yt-dlp`, separar o áudio em 3 faixas (Instrumental, Backing Vocals e Voz Principal) com detecção automática de hardware (GPU ou CPU), exibir letras sincronizadas com contraste ajustável sobre a capa da música, e registrar pontuações amigáveis (entre 75 e 100) temporariamente por sessão.

## Context

* **Quem é você:** Um engenheiro de software especialista em áudio, automação no Windows e aplicações web leves, fazendo *pair programming* com um desenvolvedor iniciante. Explique **o que** está fazendo e **por quê**, em português do Brasil, de forma clara, didática e direta.
* **Ambiente & Ferramentas:** Windows OS. O Antigravity CLI roda na raiz do repositório `./open-karaoke/`.
* **Proposta do App:** "Zero configuração para o usuário final". Amigos sem conhecimento técnico devem conseguir abrir a pasta, dar duplo clique em `iniciar_karaoke.bat` e usar o app direto no navegador.
* **Backend:** Python (FastAPI ou Flask) responsável por expor endpoints REST e gerenciar o processamento de áudio local.
* **IA & Áudio:** Separação de áudio via `demucs` (ou modelo leve equivalente). Detecção automática de aceleração via PyTorch (CUDA). Caso o computador não tenha GPU dedicada, fazer fallback suave para modelos otimizados em CPU sem travar a interface.
* **Frontend:** Interface SPA leve (HTML5, TailwindCSS, Vanilla JS) servida pelo backend Python.
* **Ciclo de Dados Temporário:** Todo o áudio processado e as notas da noite ficam em uma pasta temporária (`./temp/`) que é completamente limpa quando o script `.bat` ou a aplicação é encerrada.

## Constraints

* **Zero Autotune / Processamento de Mic Complexo:** NÃO implemente autotune, efeitos de voz ou mic-in complexo. A nota final deve ser gerada por um cálculo amigável simplificado.
* **Sem dependência de setup manual:** O usuário não deve abrir o terminal CMD/PowerShell. O script `iniciar_karaoke.bat` cuida de verificar se o Python está presente, criar o `venv`, instalar o `requirements.txt` e abrir o navegador em `http://localhost:5000`.
* **Limitação de Nota:** A pontuação final exibida após o término de qualquer música DEVE ser obrigatoriamente um número inteiro no intervalo de **75 a 100** (para manter o clima festivo e descontraído).
* **Modo Economia (Notebooks):** O módulo de áudio deve testar `torch.cuda.is_available()`. Se falso, alternar para parâmetros de amostragem mais leves do Demucs (ex: `htdemucs_ft` ou menor número de *shifts*).
* **Limpeza Obrigatória:** Não persistir histórico em banco de dados ou arquivos permanentes. Ao fechar a sessão, apagar todo o conteúdo de `/temp/` e ressetar o ranking.
* **Controle de Interface:** O player web DEVE possuir 3 sliders independentes de volume (Voz, Backing, Instrumental) e um slider para alterar a opacidade/contraste da caixa de texto sobre a imagem da capa da música.
* **Simplicidade:** Mantenha a estrutura em um repositório enxuto e prefira código simples e legível. Confirme a abordagem com o usuário antes de criar abstrações desnecessárias.

## Done-When

- [x] O script `iniciar_karaoke.bat` é criado na raiz, sendo capaz de inicializar o ambiente Python e abrir a página `http://localhost:5000` automaticamente.
- [x] O backend backend em Python expõe o endpoint de busca e o endpoint `/api/process` para baixar vídeos do YouTube (`yt-dlp`) e separar em 3 stems (`demucs`).
- [x] A detecção de hardware GPU vs. CPU funciona corretamente, aplicando o modelo mais leve em máquinas sem suporte a CUDA.
- [x] O frontend exibe os controles dos 3 canais de áudio com sliders de volume individuais operantes durante a reprodução.
- [x] A capa da música é renderizada como plano de fundo com slider funcional de contraste/opacidade para o texto da letra.
- [x] Ao final da música, o app exibe uma pontuação entre 75 e 100 e atualiza o "Hall da Fama" temporário da sessão.
- [x] Ao encerrar o servidor/script, os arquivos baixados e dados de sessão em `/temp/` são automaticamente apagados.