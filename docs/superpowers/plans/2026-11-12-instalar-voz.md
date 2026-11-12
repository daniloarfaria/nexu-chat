# Instalação de voz — design aprovado

1. Conferir assets oficiais, SHA-256 e contratos IPC. Whisper v1.8.2: Windows tem CLI; Mac recebe CLIs de Whisper e FFmpeg mínimo compiladas previamente e incluídas em resources/transcribe por arquitetura. O cliente não precisa de ferramentas Apple, Homebrew ou administrador.
2. Implementar catálogo pinado e instalador reutilizando download verificado e extração Windows; testes RED/GREEN para reuso, falhas, cancelamento e salvamento apenas após validar executáveis. FFmpeg Mac vem da fonte oficial 8.0.1, sem GPL/version3/nonfree/rede/extern libs. Script de build reproduzível e manifest de hashes guardam a procedência.
3. Integrar botão, tamanho e progresso em Transcrição; opções manuais avançadas; validar typecheck e smoke real no Mac. Hook beforePack impede empacotar sem CLIs íntegras da arquitetura correta.

Fontes: https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.2 ; https://github.com/Kitware/CMake/releases/tag/v3.31.8 ; https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz ; https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-11-11-12-39 ; https://huggingface.co/ggerganov/whisper.cpp . Versões/tamanhos/SHA-256 estão em src/main/wa/voice-catalog.ts.

Validação: arm64 executado com amostra portuguesa (conversão e Whisper). x64 compilado e inspecionado, sem Rosetta para executar. Windows não executado; CLI oficial depende de Microsoft Visual C++ Runtime x64. Ausência é detectada ao validar whisper-cli antes do download do modelo, com erro em português, sem salvar caminhos e sem instalar dependências do sistema.
