# Voice to Text

> Push-to-talk voice transcription plugin for [Obsidian](https://obsidian.md).  
> Hold a hotkey → speak → release → text is inserted at the cursor.

**Providers:** Deepgram (Nova 2) · Groq (Whisper)  
**Author:** [SATOSprod](https://github.com/SATOSprod)  
**License:** Proprietary — see [LICENSE](./LICENSE)

---

## Features

- **Push-to-talk** — hold a key combination to record, release to transcribe
- **Two providers** — Deepgram Nova 2 or Groq Whisper, switchable in settings
- **Static model & language lists** — dropdown selectors, no free-text input
- **Interactive hotkey capture** — click the field, press your combo, done; keys are displayed as icons
- **File logging** — activity logs written to `.log` files inside the vault (one file per day)
- **Audio saving** — optionally save each recording as a WAV file in the vault
- **No emoji** — SVG icons only in the status bar and settings UI
- **Minimal flat design** — no shadows, no hover animations

---

## Requirements

- Obsidian **0.15.0** or later (desktop only)
- A **Deepgram** or **Groq** API key (free tiers available)
- Node.js **16+** and npm (for building from source)

---

## Installation

### From source (recommended)

```bash
# 1. Clone the repository
git clone https://github.com/SATOSprod/voice-to-text.git
cd voice-to-text

# 2. Install dependencies
npm install

# 3. Build
npm run build
# Produces: main.js
```

Then copy the plugin folder into your vault:

```
<your-vault>/.obsidian/plugins/voice-to-text/
├── main.js          ← compiled output
├── manifest.json
├── styles.css
```

Open Obsidian → **Settings → Community plugins → Installed plugins** and enable **Voice to Text**.

### Development mode (auto-rebuild on save)

```bash
npm run dev
```

---

## Configuration

Open **Settings → Voice to Text**.

| Setting | Default | Description |
|---|---|---|
| **Provider** | Deepgram | Switch between Deepgram and Groq |
| **API key** | — | Secret key for the chosen provider |
| **Model** | nova-2 / whisper-large-v3 | Select from a fixed list per provider |
| **Language** | Auto | Dropdown: auto-detect or a specific language code |
| **Hotkey** | Meta+Alt | Click the field to capture interactively |
| **Enable logging** | Off | Write activity logs to the vault |
| **Log folder** | `voice-to-text-logs` | Vault-relative path; created automatically |
| **Save recordings** | Off | Keep a WAV file of each recording |
| **Recordings folder** | `voice-recordings` | Vault-relative path; created automatically |

### Getting an API key

**Deepgram**
1. Go to [console.deepgram.com](https://console.deepgram.com)
2. Create a free account (includes $200 credit)
3. **API Keys → Create a key** → copy and paste into plugin settings

**Groq**
1. Go to [console.groq.com](https://console.groq.com)
2. Create a free account
3. **API Keys → Create API key** → copy and paste into plugin settings

---

## Usage

1. Open any note in Obsidian
2. Place the cursor where you want the text inserted
3. **Hold** your configured hotkey (default: `Meta+Alt` = Win+Alt / Cmd+Alt)
4. **Speak** — a notice appears confirming recording is active
5. **Release** the keys — transcription starts automatically
6. The transcribed text is inserted at the cursor position

If no editor is active, the transcription is copied to the clipboard instead.

---

## Supported Languages

| Code | Language | Code | Language |
|---|---|---|---|
| `auto` | Auto-detect | `ko` | Korean |
| `ru` | Russian | `nl` | Dutch |
| `en` | English | `pl` | Polish |
| `de` | German | `tr` | Turkish |
| `fr` | French | `ar` | Arabic |
| `es` | Spanish | `uk` | Ukrainian |
| `it` | Italian | `zh` | Chinese |
| `pt` | Portuguese | `ja` | Japanese |

---

## Supported Models

**Deepgram**

| Model | Description |
|---|---|
| `nova-2` | Best accuracy, recommended |
| `nova-2-general` | General purpose |
| `nova-2-meeting` | Optimised for meetings |
| `nova-2-phonecall` | Optimised for phone audio |
| `nova` | Previous generation |
| `enhanced` | Legacy enhanced |
| `base` | Legacy base |

**Groq (Whisper)**

| Model | Description |
|---|---|
| `whisper-large-v3` | Best accuracy |
| `whisper-large-v3-turbo` | Faster, slightly lower accuracy |
| `distil-whisper-large-v3-en` | English-only, fastest |

---

## File Structure

```
voice-to-text/
├── main.ts           ← TypeScript source (single file)
├── main.js           ← compiled output (gitignored, built locally)
├── styles.css        ← plugin styles
├── manifest.json     ← Obsidian plugin manifest
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── versions.json
├── .gitignore
├── LICENSE
└── README.md
```

---

## License

This project is released under a **proprietary license**.  
Copying source code into other projects is **not permitted**.  
See [LICENSE](./LICENSE) for full terms.

© 2026 SATOSprod
