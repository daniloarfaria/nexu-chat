# Componentes de voz

Whisper.cpp v1.8.2, commit 4979e04f5dcaccb36057e059bbaed8a2f5288315, licença MIT (WHISPER-LICENSE).
FFmpeg 8.0.1 mínimo LGPL 2.1+ (FFMPEG-LICENSE.txt), compilado sem GPL, version3, nonfree, rede ou bibliotecas externas.
CLIs estáticas para macOS 12+, sem bibliotecas Homebrew. O cliente Mac baixa somente o modelo de voz que faltar; não precisa de Xcode ou Homebrew.

Reproduzir em Mac com ferramentas Apple existentes:

```
node scripts/build-whisper-mac.mjs all
node scripts/build-ffmpeg-mac.mjs all
```

Os scripts baixam fontes oficiais e CMake 3.31.8 para uma pasta temporária e verificam SHA-256 antes de extrair. Não instalam ferramentas no sistema. Configurações de compilação estão nos scripts; os SHA-256 dos executáveis resultantes ficam em BUILD-MANIFEST.json, regenerado ao compilar. `beforePack` verifica presença, arquitetura e integridade dos dois programas e das licenças antes de criar o instalador Mac. Os recursos são extraídos por asarUnpack.

FFmpeg mínimo converte Ogg/WebM (Opus/Vorbis), MP3, WAV, AAC/M4A/MP4 e FLAC em PCM mono de 16 kHz. Não contém componentes para encodar mensagens de voz. Origem e código completo: https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz . O script build-ffmpeg-mac.mjs contém a receita exata de configuração e compilação.

O modelo small multilíngue vem do repositório Whisper.cpp de ggerganov, com revisão fixa. O Windows x64 baixa whisper-bin-x64.zip oficial e o FFmpeg LGPL shared da release datada autobuild-2026-11-11-12-39 do distribuidor https://github.com/FFmpeg-Builds/FFmpeg-Builds ; as DLLs e a licença do pacote são preservadas. URLs, tamanhos e SHA-256 em src/main/wa/voice-catalog.ts.

Limite de validação: Mac arm64 executado com amostra real portuguesa. Mac x64 foi compilado e inspecionado (Mach-O e dependências Apple); não foi executado porque esta máquina não tem Rosetta. Windows não foi executado. A CLI oficial Windows requer Microsoft Visual C++ Runtime x64; sem ele, a validação de execução falha antes de baixar o modelo e nenhum caminho é salvo. O aplicativo não instala runtime do sistema nem solicita administrador.
