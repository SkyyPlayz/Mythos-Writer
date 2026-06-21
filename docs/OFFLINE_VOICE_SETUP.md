# Offline Voice Setup Guide

**Mythos Writer** supports local speech-to-text (STT) and text-to-speech (TTS) when configured with offline engines. This guide documents how to set up **whisper.cpp** (STT) and **Piper** (TTS) on Linux, macOS, and Windows.

## Prerequisites

- Mythos Writer v0.3.0 or later
- Voice feature enabled in Settings → Voice
- STT and/or TTS set to "Local" provider in Voice settings
- Sufficient disk space for binaries (~50–100 MB depending on engine and models)

## Whisper.cpp (Speech-to-Text)

[**whisper.cpp**](https://github.com/ggerganov/whisper.cpp) is a C++ implementation of OpenAI's Whisper model optimized for CPU inference. Mythos Writer uses it for local, offline transcription.

### Choosing a Model

Whisper.cpp supports multiple model sizes. **For Beta 2, recommend `tiny` or `base`:**

| Model | Size | Speed | Accuracy | Language Support |
|-------|------|-------|----------|------------------|
| `tiny` | 75 MB | Very fast (CPU) | ~95% BLEU vs. API | Multi (~99 langs) |
| `base` | 140 MB | Fast (CPU) | ~97% BLEU vs. API | Multi (~99 langs) |
| `small` | 466 MB | Moderate | ~98% BLEU | Multi (multilingual) |
| `medium` | 1.5 GB | Slow on CPU | High | Multi |
| `large` | 3 GB | Very slow on CPU | Highest | Multi |

**Start with `tiny` for local testing; `base` for production if disk/RAM permit.**

### Linux Setup

1. **Download the pre-built binary** from [whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases):
   - Look for `whisper-bin-<version>-linux-<arch>.tar.gz` (x86_64 or aarch64)
   - Or build from source: `git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp && make`

2. **Extract to a safe location** (avoid paths with spaces):
   ```bash
   mkdir -p ~/.mythos/engines/whisper
   tar xzf whisper-bin-*.tar.gz -C ~/.mythos/engines/whisper
   chmod +x ~/.mythos/engines/whisper/whisper
   ```

3. **Download a model** using the `models.sh` script in the whisper.cpp repo:
   ```bash
   cd ~/.mythos/engines/whisper
   # If whisper.cpp was built from source:
   ./models.sh <model-name>  # e.g., tiny, base, small
   
   # Or download the GGML-quantized model directly:
   curl -fsSL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin \
     -o ggml-tiny.en.bin
   ```

4. **Verify the binary:**
   ```bash
   ~/.mythos/engines/whisper/whisper --help
   ```

5. **In Mythos Writer Settings:**
   - Settings → Voice → STT Provider: `Local`
   - STT Binary Path: `/home/YOUR_USER/.mythos/engines/whisper/whisper`
   - (Mythos will show a file picker; select the binary from the above path)

### macOS Setup

1. **Download the pre-built binary** from [whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases):
   - Look for `whisper-bin-<version>-macos-universal.tar.gz` (Intel + Apple Silicon universal)
   - Or build: `brew install whisper-cpp` (if using Homebrew with the tap)
   - Or from source: `git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp && make`

2. **Extract and place:**
   ```bash
   mkdir -p ~/Library/Application\ Support/Mythos/engines/whisper
   tar xzf whisper-bin-*.tar.gz -C ~/Library/Application\ Support/Mythos/engines/whisper
   chmod +x ~/Library/Application\ Support/Mythos/engines/whisper/whisper
   ```

3. **Download a model:**
   ```bash
   cd ~/Library/Application\ Support/Mythos/engines/whisper
   # Using curl (or the whisper.cpp models.sh if the repo is present):
   curl -fsSL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin \
     -o ggml-tiny.en.bin
   ```

4. **If the binary is notarized, verify or bypass Gatekeeper** (depending on macOS version):
   ```bash
   # Check if it runs:
   ~/Library/Application\ Support/Mythos/engines/whisper/whisper --help
   
   # If blocked by Gatekeeper, remove the quarantine flag:
   xattr -d com.apple.quarantine ~/Library/Application\ Support/Mythos/engines/whisper/whisper
   ```

5. **In Mythos Writer Settings:**
   - Settings → Voice → STT Provider: `Local`
   - STT Binary Path: `~/Library/Application Support/Mythos/engines/whisper/whisper`

### Windows Setup

1. **Download the pre-built binary** from [whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases):
   - Look for `whisper-bin-<version>-windows-x64.zip`
   - Or build from source using [Visual Studio or Clang](https://github.com/ggerganov/whisper.cpp#compiling)

2. **Extract to a safe location** (no spaces in path; avoid Program Files):
   ```
   C:\Users\<YourUser>\AppData\Local\Mythos\engines\whisper\
   ```
   - Extract the .zip contents to that folder.

3. **Download a model:**
   - Use PowerShell to download from HuggingFace:
     ```powershell
     $url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
     $out = "C:\Users\<YourUser>\AppData\Local\Mythos\engines\whisper\ggml-tiny.en.bin"
     Invoke-WebRequest -Uri $url -OutFile $out
     ```
   - Or download manually via browser and move to the folder.

4. **Verify the binary:**
   - Open PowerShell and run:
     ```powershell
     & "C:\Users\<YourUser>\AppData\Local\Mythos\engines\whisper\whisper.exe" --help
     ```

5. **In Mythos Writer Settings:**
   - Settings → Voice → STT Provider: `Local`
   - STT Binary Path: `C:\Users\<YourUser>\AppData\Local\Mythos\engines\whisper\whisper.exe`

### Integrity Verification

To verify downloaded binaries and models haven't been corrupted or tampered:

1. **Check file size** (at least confirms it's not truncated):
   - `ggml-tiny.en.bin`: ~75 MB
   - `ggml-base.en.bin`: ~140 MB
   - Whisper binary: ~10–20 MB (varies by platform)

2. **Verify SHA256 checksums** (if provided in the release notes):
   ```bash
   # Linux/macOS:
   sha256sum ggml-tiny.en.bin
   # Compare output to the official checksum
   
   # Windows (PowerShell):
   (Get-FileHash "path\to\ggml-tiny.en.bin" -Algorithm SHA256).Hash
   ```

3. **Test the binary** (will fail on corrupted files):
   ```bash
   whisper <test-audio-file.wav> -m ggml-tiny.en.bin
   ```

---

## Piper (Text-to-Speech)

[**Piper**](https://github.com/rhasspy/piper) is a fast, local TTS engine. Mythos Writer uses it to synthesize text into speech offline.

### Choosing a Voice

Piper supports many voices across languages. **For Beta 2, recommend English voices:**

| Voice | Gender | Quality | Size |
|-------|--------|---------|------|
| `en_US-libritts-high` | Multi | High quality | ~750 MB |
| `en_US-ljspeech` | Female | Good | ~50 MB |
| `en_US-glow-tts` | Female | Good | ~100 MB |
| `en_GB-alba` | Female | Good | ~50 MB |

**Start with a ~50 MB voice for faster downloads and lower disk usage.**

### Linux Setup

1. **Download the pre-built binary** from [piper releases](https://github.com/rhasspy/piper/releases):
   - Look for `piper_linux_x86_64.tar.gz` (or `aarch64` for ARM)

2. **Extract:**
   ```bash
   mkdir -p ~/.mythos/engines/piper
   tar xzf piper_linux_x86_64.tar.gz -C ~/.mythos/engines/piper
   chmod +x ~/.mythos/engines/piper/piper
   ```

3. **Download a voice model:**
   ```bash
   cd ~/.mythos/engines/piper
   # Download from HuggingFace:
   curl -fsSL https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx \
     -o en_US-ljspeech-medium.onnx
   
   # Also get the config (JSON):
   curl -fsSL https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json \
     -o en_US-ljspeech-medium.onnx.json
   ```

4. **Verify the binary:**
   ```bash
   echo "Hello, this is a test." | ~/.mythos/engines/piper/piper \
     --model en_US-ljspeech-medium.onnx --output-raw > /tmp/test.wav
   ```

5. **In Mythos Writer Settings:**
   - Settings → Voice → TTS Provider: `Local`
   - TTS Binary Path: `/home/YOUR_USER/.mythos/engines/piper/piper`
   - TTS Model Path: `/home/YOUR_USER/.mythos/engines/piper/en_US-ljspeech-medium.onnx`
   - TTS Voice ID: `en_US-ljspeech-medium`

### macOS Setup

1. **Download the pre-built binary** from [piper releases](https://github.com/rhasspy/piper/releases):
   - Look for `piper_macos_x86_64.tar.gz` (Intel) or `aarch64` (Apple Silicon)

2. **Extract:**
   ```bash
   mkdir -p ~/Library/Application\ Support/Mythos/engines/piper
   tar xzf piper_macos_*.tar.gz -C ~/Library/Application\ Support/Mythos/engines/piper
   chmod +x ~/Library/Application\ Support/Mythos/engines/piper/piper
   ```

3. **Download a voice model:**
   ```bash
   cd ~/Library/Application\ Support/Mythos/engines/piper
   curl -fsSL https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx \
     -o en_US-ljspeech-medium.onnx
   curl -fsSL https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json \
     -o en_US-ljspeech-medium.onnx.json
   ```

4. **If blocked by Gatekeeper:**
   ```bash
   xattr -d com.apple.quarantine ~/Library/Application\ Support/Mythos/engines/piper/piper
   ```

5. **Test:**
   ```bash
   echo "Hello, this is a test." | ~/Library/Application\ Support/Mythos/engines/piper/piper \
     --model en_US-ljspeech-medium.onnx --output-raw > /tmp/test.wav
   ```

6. **In Mythos Writer Settings:**
   - Settings → Voice → TTS Provider: `Local`
   - TTS Binary Path: `~/Library/Application Support/Mythos/engines/piper/piper`
   - TTS Model Path: `~/Library/Application Support/Mythos/engines/piper/en_US-ljspeech-medium.onnx`
   - TTS Voice ID: `en_US-ljspeech-medium`

### Windows Setup

1. **Download the pre-built binary** from [piper releases](https://github.com/rhasspy/piper/releases):
   - Look for `piper_windows_x86_64.zip`

2. **Extract:**
   ```
   C:\Users\<YourUser>\AppData\Local\Mythos\engines\piper\
   ```

3. **Download a voice model:**
   - Use PowerShell:
     ```powershell
     $model_url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx"
     $config_url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json"
     $out_dir = "C:\Users\<YourUser>\AppData\Local\Mythos\engines\piper"
     
     Invoke-WebRequest -Uri $model_url -OutFile "$out_dir\en_US-ljspeech-medium.onnx"
     Invoke-WebRequest -Uri $config_url -OutFile "$out_dir\en_US-ljspeech-medium.onnx.json"
     ```

4. **Test (PowerShell):**
   ```powershell
   @"Hello, this is a test."@ | & "C:\Users\<YourUser>\AppData\Local\Mythos\engines\piper\piper.exe" `
     --model "C:\Users\<YourUser>\AppData\Local\Mythos\engines\piper\en_US-ljspeech-medium.onnx" `
     --output-raw > "C:\Temp\test.wav"
   ```

5. **In Mythos Writer Settings:**
   - Settings → Voice → TTS Provider: `Local`
   - TTS Binary Path: `C:\Users\<YourUser>\AppData\Local\Mythos\engines\piper\piper.exe`
   - TTS Model Path: `C:\Users\<YourUser>\AppData\Local\Mythos\engines\piper\en_US-ljspeech-medium.onnx`
   - TTS Voice ID: `en_US-ljspeech-medium`

### Integrity Verification

1. **Verify file sizes:**
   - Voice model (.onnx): 50–750 MB (varies by voice)
   - Voice config (.onnx.json): < 5 KB
   - Piper binary: ~10–30 MB

2. **Test with a simple phrase:**
   ```bash
   echo "Test" | piper --model model.onnx --output-raw > /tmp/test.wav
   ```
   - Should complete without errors
   - Output file should be > 1 KB

---

## Troubleshooting

### "Binary is not in the trusted set"

**Cause:** The binary path wasn't registered via Settings → Voice → Pick Binary.

**Fix:**
1. Go to Settings → Voice → STT/TTS settings
2. Click the "Pick Binary" button next to the path field
3. Navigate to and select the binary
4. The path is now registered and can be used

### Whisper.cpp: "exited with non-zero code"

**Cause:** 
- Model file not found or corrupted
- Audio file format unsupported
- Insufficient disk space for temporary files

**Fix:**
1. Verify the model file exists and is readable
2. Check the audio format (WAV, MP3, WebM supported)
3. Ensure `/tmp` (Linux/macOS) or `%TEMP%` (Windows) has ≥100 MB free

### Piper: "spawn error"

**Cause:**
- Binary or model path contains spaces (not escaped)
- Model .onnx.json config missing
- Binary not executable on macOS/Linux

**Fix:**
1. Use paths without spaces (or in quotes on command-line tests)
2. Ensure both .onnx and .onnx.json are in the same directory
3. Check executable bit: `chmod +x piper` (Linux/macOS)

### "Network error" or "SSRF rejected"

**Cause:** Using a cloud provider; attempting to use an internal/local endpoint.

**Fix:**
1. For cloud STT, ensure a valid OpenAI API key is set
2. Do not override the cloud endpoint to internal addresses
3. Verify internet connectivity if using cloud fallback

---

## Performance Notes

### CPU Usage

- **Whisper.cpp `tiny`:** ~100–300 ms per second of audio (CPU-dependent)
- **Whisper.cpp `base`:** ~300–800 ms per second of audio
- **Piper `ljspeech`:** ~50–200 ms per second of output audio

### Memory

- **Whisper.cpp models:** 75–300 MB RAM (depending on model size)
- **Piper models:** 150–500 MB RAM (depending on voice)
- Mythos Writer temp files: ~20 MB per transcription/synthesis session

### Disk Space

- **Whisper.cpp binary + `tiny` model:** ~100 MB
- **Whisper.cpp binary + `base` model:** ~160 MB
- **Piper binary + voice model:** ~50–800 MB (voice-dependent)

**Total for full local setup:** ~150–250 MB (recommended)

---

## Privacy & Security

- Audio files are written to system temp directory (`/tmp`, `%TEMP%`) and **deleted after processing**
- Transcripts are **never logged by Mythos Writer**; only returned to the app in memory
- Binaries are executed only after going through the **MYT-788 spawn gate** (trusted binary registry)
- Models and binaries are not signed by Mythos Writer; verify checksums when downloading

---

## FAQ

**Q: Can I use a different Whisper model?**
A: Yes. Whisper.cpp supports all OpenAI Whisper models. Download the GGML-quantized version from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp).

**Q: Can I mix local STT with cloud TTS?**
A: Yes. Set STT Provider to `Local` (whisper.cpp) and TTS Provider to `Cloud` (OpenAI TTS), and configure both paths/keys in Settings.

**Q: Will offline voice work without internet?**
A: Fully offline if you choose Local STT (whisper.cpp) + Local TTS (Piper). Cloud STT/TTS require internet. OS TTS (the default) does not require internet.

**Q: How do I update the model or voice?**
A: Replace the model file in the directory (e.g., download `ggml-base.en.bin` instead of `ggml-tiny.en.bin`). No app restart needed; the new model is picked up on the next transcription.

**Q: What if the binary architecture doesn't match my system?**
A: Ensure you download the correct binary for your architecture (x86_64, aarch64, universal/ARM64 for macOS). Run `uname -m` (Linux/macOS) or check System Settings (Windows) to verify.

---

## References

- [Whisper.cpp GitHub](https://github.com/ggerganov/whisper.cpp)
- [Piper GitHub](https://github.com/rhasspy/piper)
- [Whisper.cpp Models (HuggingFace)](https://huggingface.co/ggerganov/whisper.cpp)
- [Piper Voices (HuggingFace)](https://huggingface.co/rhasspy/piper-voices)
- Mythos Writer Voice Settings: Settings → Voice

---

**Last Updated:** 2026-06-21  
**Document Status:** QA Verification In Progress ([SKY-3191](/SKY/issues/SKY-3191))
