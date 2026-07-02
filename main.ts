import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	normalizePath,
} from "obsidian";

// ─────────────────────────────────────────────
// Constants — static option lists
// ─────────────────────────────────────────────

const DEEPGRAM_MODELS: Record<string, string> = {
	"nova-2":           "Nova 2 (recommended)",
	"nova-2-general":   "Nova 2 General",
	"nova-2-meeting":   "Nova 2 Meeting",
	"nova-2-phonecall": "Nova 2 Phone Call",
	"nova":             "Nova",
	"enhanced":         "Enhanced",
	"base":             "Base",
};

const GROQ_MODELS: Record<string, string> = {
	"whisper-large-v3":       "Whisper Large v3 (recommended)",
	"whisper-large-v3-turbo": "Whisper Large v3 Turbo",
	"distil-whisper-large-v3-en": "Distil Whisper Large v3 EN",
};

const LANGUAGES: Record<string, string> = {
	auto: "Auto (detect language)",
	ru:   "Russian (ru)",
	en:   "English (en)",
	de:   "German (de)",
	fr:   "French (fr)",
	es:   "Spanish (es)",
	it:   "Italian (it)",
	pt:   "Portuguese (pt)",
	zh:   "Chinese (zh)",
	ja:   "Japanese (ja)",
	ko:   "Korean (ko)",
	nl:   "Dutch (nl)",
	pl:   "Polish (pl)",
	tr:   "Turkish (tr)",
	ar:   "Arabic (ar)",
	uk:   "Ukrainian (uk)",
};

// ─────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────

type Provider = "deepgram" | "groq";

interface VoiceToTextSettings {
	provider:         Provider;
	deepgramApiKey:   string;
	deepgramModel:    string;
	groqApiKey:       string;
	groqModel:        string;
	language:         string;
	hotkey:           string; // serialized, e.g. "Meta+Alt"
	loggingEnabled:   boolean;
	logFolder:        string;
	saveAudio:        boolean;
	audioSaveFolder:  string;
}

const DEFAULT_SETTINGS: VoiceToTextSettings = {
	provider:        "deepgram",
	deepgramApiKey:  "",
	deepgramModel:   "nova-2",
	groqApiKey:      "",
	groqModel:       "whisper-large-v3",
	language:        "auto",
	hotkey:          "Meta+Alt",
	loggingEnabled:  false,
	logFolder:       "voice-to-text-logs",
	saveAudio:       false,
	audioSaveFolder: "voice-recordings",
};

// ─────────────────────────────────────────────
// SVG icon helpers
// ─────────────────────────────────────────────

/** Returns an SVG string for common key names */
function keyIcon(key: string): string {
	switch (key) {
		case "Meta":
			// OS-independent: use ◆ / ⊞-like glyph
			return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`;
		case "Control":
		case "Ctrl":
			return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><polyline points="3,10 8,5 13,10"/></svg>`;
		case "Alt":
			return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="12" x2="7" y2="4"/><line x1="7" y1="4" x2="12" y2="12"/><line x1="9" y1="12" x2="14" y2="12"/></svg>`;
		case "Shift":
			return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><polyline points="8,2 14,9 11,9 11,14 5,14 5,9 2,9"/></svg>`;
		default:
			return ""; // plain text fallback
	}
}

const MIC_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`;

const REC_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="6"/></svg>`;

// ─────────────────────────────────────────────
// Logger — writes to file, not console
// ─────────────────────────────────────────────

class FileLogger {
	private app: App;
	private enabled: boolean;
	private folder: string;
	private filePath: string;

	constructor(app: App, enabled: boolean, folder: string) {
		this.app = app;
		this.enabled = enabled;
		this.folder = normalizePath(folder);
		const date = new Date().toISOString().slice(0, 10);
		this.filePath = normalizePath(`${this.folder}/${date}.log`);
	}

	async log(...args: unknown[]): Promise<void> {
		if (!this.enabled) return;
		const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}\n`;
		try {
			if (!(await this.app.vault.adapter.exists(this.folder))) {
				await this.app.vault.createFolder(this.folder);
			}
			if (await this.app.vault.adapter.exists(this.filePath)) {
				const existing = await this.app.vault.adapter.read(this.filePath);
				await this.app.vault.adapter.write(this.filePath, existing + line);
			} else {
				await this.app.vault.adapter.write(this.filePath, line);
			}
		} catch (e) {
			// last resort: console only if file write fails
			console.error("[VoiceToText] Log write failed:", e);
		}
	}

	update(enabled: boolean, folder: string) {
		this.enabled = enabled;
		this.folder = normalizePath(folder);
		const date = new Date().toISOString().slice(0, 10);
		this.filePath = normalizePath(`${this.folder}/${date}.log`);
	}
}

// ─────────────────────────────────────────────
// Audio helpers
// ─────────────────────────────────────────────

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
	const numChannels = 1;
	const sampleRate = buffer.sampleRate;
	const numFrames = buffer.length;
	const bytesPerSample = 2;
	const dataLength = numFrames * numChannels * bytesPerSample;
	const arrayBuffer = new ArrayBuffer(44 + dataLength);
	const view = new DataView(arrayBuffer);

	const ws = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
	};
	ws(0, "RIFF"); view.setUint32(4, 36 + dataLength, true);
	ws(8, "WAVE"); ws(12, "fmt ");
	view.setUint32(16, 16, true); view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
	view.setUint16(32, numChannels * bytesPerSample, true); view.setUint16(34, 16, true);
	ws(36, "data"); view.setUint32(40, dataLength, true);

	const channelData: Float32Array[] = [];
	for (let c = 0; c < buffer.numberOfChannels; c++) channelData.push(buffer.getChannelData(c));

	let offset = 44;
	for (let i = 0; i < numFrames; i++) {
		let sample = 0;
		for (let c = 0; c < buffer.numberOfChannels; c++) sample += channelData[c][i];
		sample /= buffer.numberOfChannels;
		const s = Math.max(-1, Math.min(1, sample));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		offset += 2;
	}
	return arrayBuffer;
}

async function blobToWav(blob: Blob): Promise<ArrayBuffer> {
	const arrayBuffer = await blob.arrayBuffer();
	const audioCtx = new AudioContext();
	const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
	await audioCtx.close();
	return audioBufferToWav(audioBuffer);
}

async function saveWavFile(
	app: App,
	settings: VoiceToTextSettings,
	wavBuffer: ArrayBuffer,
	logger: FileLogger
): Promise<void> {
	try {
		const folderPath = normalizePath(settings.audioSaveFolder);
		if (!(await app.vault.adapter.exists(folderPath))) {
			await app.vault.createFolder(folderPath);
		}
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const fileName = `voice-${timestamp}.wav`;
		const filePath = normalizePath(`${folderPath}/${fileName}`);
		await app.vault.adapter.writeBinary(filePath, new Uint8Array(wavBuffer));
		await logger.log("Saved audio to", filePath);
	} catch (e) {
		await logger.log("Failed to save WAV:", e);
	}
}

// ─────────────────────────────────────────────
// Transcription
// ─────────────────────────────────────────────

async function transcribeDeepgram(
	wavBuffer: ArrayBuffer,
	settings: VoiceToTextSettings,
	logger: FileLogger
): Promise<string> {
	const params: Record<string, string> = {
		model: settings.deepgramModel,
		smart_format: "true",
		punctuate: "true",
	};
	if (settings.language !== "auto") {
		params.language = settings.language;
		params.detect_language = "false";
	} else {
		params.detect_language = "true";
	}
	const url = `https://api.deepgram.com/v1/listen?${new URLSearchParams(params)}`;
	await logger.log("Sending to Deepgram:", url);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Token ${settings.deepgramApiKey}`,
			"Content-Type": "audio/wav",
		},
		body: wavBuffer,
	});
	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Deepgram error ${response.status}: ${errText}`);
	}
	const data = await response.json();
	await logger.log("Deepgram response:", JSON.stringify(data).slice(0, 300));
	return (data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}

async function transcribeGroq(
	wavBuffer: ArrayBuffer,
	settings: VoiceToTextSettings,
	logger: FileLogger
): Promise<string> {
	const formData = new FormData();
	formData.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
	formData.append("model", settings.groqModel);
	if (settings.language !== "auto") formData.append("language", settings.language);
	formData.append("response_format", "json");

	const url = "https://api.groq.com/openai/v1/audio/transcriptions";
	await logger.log("Sending to Groq:", url);

	const response = await fetch(url, {
		method: "POST",
		headers: { Authorization: `Bearer ${settings.groqApiKey}` },
		body: formData,
	});
	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Groq error ${response.status}: ${errText}`);
	}
	const data = await response.json();
	await logger.log("Groq response:", JSON.stringify(data).slice(0, 300));
	return (data?.text ?? "").trim();
}

// ─────────────────────────────────────────────
// Main Plugin
// ─────────────────────────────────────────────

export default class VoiceToTextPlugin extends Plugin {
	settings!: VoiceToTextSettings;
	logger!: FileLogger;

	private mediaRecorder:    MediaRecorder | null = null;
	private audioChunks:      Blob[]               = [];
	private isRecording       = false;
	private stream:           MediaStream | null    = null;
	private pressedKeys:      Set<string>           = new Set();
	private statusBarItem:    HTMLElement | null    = null;
	private recordingNotice:  Notice | null         = null;

	private boundKeyDown!: (e: KeyboardEvent) => void;
	private boundKeyUp!:   (e: KeyboardEvent) => void;

	async onload() {
		await this.loadSettings();
		this.logger = new FileLogger(
			this.app,
			this.settings.loggingEnabled,
			this.settings.logFolder
		);

		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar(false);

		this.addSettingTab(new VoiceToTextSettingTab(this.app, this));

		this.boundKeyDown = this.handleKeyDown.bind(this);
		this.boundKeyUp   = this.handleKeyUp.bind(this);
		window.addEventListener("keydown", this.boundKeyDown, true);
		window.addEventListener("keyup",   this.boundKeyUp,   true);

		await this.logger.log("Voice to Text plugin loaded. Hotkey:", this.settings.hotkey);
	}

	onunload() {
		window.removeEventListener("keydown", this.boundKeyDown, true);
		window.removeEventListener("keyup",   this.boundKeyUp,   true);
		this.stopRecording(false);
		if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
	}

	// ── Hotkey parsing ───────────────────────

	private parseHotkey(): Set<string> {
		return new Set(this.settings.hotkey.split("+").map((k) => k.trim()).filter(Boolean));
	}

	private isHotkeyActive(e: KeyboardEvent): boolean {
		const required = this.parseHotkey();
		const map: Record<string, boolean> = {
			Meta: e.metaKey, Control: e.ctrlKey, Alt: e.altKey, Shift: e.shiftKey,
		};
		for (const key of required) {
			if (key in map) { if (!map[key]) return false; }
			else             { if (!this.pressedKeys.has(key)) return false; }
		}
		return true;
	}

	// ── Key event handlers ───────────────────

	private handleKeyDown(e: KeyboardEvent) {
		this.pressedKeys.add(e.key);
		if (!this.isRecording && this.isHotkeyActive(e)) {
			e.preventDefault();
			this.startRecording();
		}
	}

	private handleKeyUp(e: KeyboardEvent) {
		this.pressedKeys.delete(e.key);
		if (!this.isRecording) return;
		const required = this.parseHotkey();
		const map: Record<string, boolean> = {
			Meta: e.metaKey, Control: e.ctrlKey, Alt: e.altKey, Shift: e.shiftKey,
		};
		let allHeld = true;
		for (const key of required) {
			if (key in map) { if (!map[key]) { allHeld = false; break; } }
			else            { if (!this.pressedKeys.has(key)) { allHeld = false; break; } }
		}
		if (!allHeld) this.stopRecording(true);
	}

	// ── Recording ────────────────────────────

	private async startRecording() {
		if (this.isRecording) return;
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
			});
		} catch (err) {
			new Notice("Voice to Text: microphone access denied.");
			await this.logger.log("getUserMedia error:", err);
			return;
		}

		const mimeTypes = [
			"audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg",
		];
		const mimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

		this.audioChunks  = [];
		this.isRecording  = true;
		this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});
		this.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.audioChunks.push(e.data);
		};
		this.mediaRecorder.start(100);
		this.updateStatusBar(true);
		this.recordingNotice = new Notice("Recording… release to transcribe.", 30000);
		await this.logger.log("Recording started");
	}

	private stopRecording(shouldTranscribe: boolean) {
		if (!this.isRecording || !this.mediaRecorder) return;
		this.isRecording = false;
		this.recordingNotice?.hide();
		this.recordingNotice = null;
		this.updateStatusBar(false);

		if (!shouldTranscribe) {
			this.mediaRecorder.stop();
			this.stream?.getTracks().forEach((t) => t.stop());
			this.stream = null;
			return;
		}

		this.mediaRecorder.onstop = async () => {
			this.stream?.getTracks().forEach((t) => t.stop());
			this.stream = null;
			await this.processAudio();
		};
		this.mediaRecorder.stop();
	}

	private async processAudio() {
		if (this.audioChunks.length === 0) return;
		const blob = new Blob(this.audioChunks, { type: this.audioChunks[0].type });
		let wavBuffer: ArrayBuffer;
		try {
			wavBuffer = await blobToWav(blob);
		} catch (e) {
			new Notice("Voice to Text: failed to process audio.");
			await this.logger.log("blobToWav error:", e);
			return;
		}
		if (this.settings.saveAudio) {
			await saveWavFile(this.app, this.settings, wavBuffer, this.logger);
		}
		let text = "";
		try {
			if (this.settings.provider === "deepgram") {
				text = await transcribeDeepgram(wavBuffer, this.settings, this.logger);
			} else {
				text = await transcribeGroq(wavBuffer, this.settings, this.logger);
			}
		} catch (err) {
			new Notice(`Voice to Text: ${(err as Error).message}`);
			await this.logger.log("Transcription error:", err);
			return;
		}
		if (!text) {
			new Notice("Voice to Text: empty transcription returned.");
			return;
		}
		await this.logger.log("Transcription result:", text);
		this.insertText(text);
	}

	// ── Text insertion ────────────────────────

	private insertText(text: string) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.editor) {
			const editor: Editor = view.editor;
			const cursor = editor.getCursor();
			editor.replaceRange(text, cursor);
			const lines = text.split("\n");
			editor.setCursor({
				line: cursor.line + lines.length - 1,
				ch: lines.length === 1
					? cursor.ch + text.length
					: lines[lines.length - 1].length,
			});
			new Notice("Text inserted.", 2000);
		} else {
			navigator.clipboard.writeText(text).then(() => {
				new Notice("Transcription copied to clipboard (no active editor).");
			});
		}
	}

	// ── Status bar ────────────────────────────

	private updateStatusBar(recording: boolean) {
		if (!this.statusBarItem) return;
		// this.statusBarItem.empty();
		// this.statusBarItem.addClass("vtt-statusbar");
		// this.statusBarItem.innerHTML = recording
		// 	? `${REC_SVG}<span>Recording</span>`
		// 	: `${MIC_SVG}<span>Voice to Text</span>`;
		// this.statusBarItem.setAttribute(
		// 	"title",
		// 	recording
		// 		? "Voice to Text: recording in progress"
		// 		: `Voice to Text: hold ${this.settings.hotkey} to record`
		// );
	}

	// ── Settings persistence ──────────────────

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateStatusBar(false);
		if (this.logger) {
			this.logger.update(this.settings.loggingEnabled, this.settings.logFolder);
		}
	}
}

// ─────────────────────────────────────────────
// Settings Tab
// ─────────────────────────────────────────────

class VoiceToTextSettingTab extends PluginSettingTab {
	plugin: VoiceToTextPlugin;
	private capturingHotkey = false;
	private capturedKeys:   Set<string> = new Set();
	private hotkeyDisplayEl: HTMLElement | null = null;

	constructor(app: App, plugin: VoiceToTextPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// ── Render hotkey badges ──────────────────

	private renderHotkeyBadges(container: HTMLElement, hotkey: string, placeholder = false) {
		container.empty();
		if (placeholder || !hotkey) {
			container.addClass("is-empty");
			container.setText("Click to set hotkey");
			return;
		}
		container.removeClass("is-empty");
		const keys = hotkey.split("+").map((k) => k.trim()).filter(Boolean);
		keys.forEach((key, i) => {
			const badge = container.createEl("span", { cls: "vtt-key-badge" });
			const svg = keyIcon(key);
			if (svg) {
				badge.innerHTML = svg + key;
			} else {
				badge.setText(key);
			}
			if (i < keys.length - 1) {
				container.createEl("span", { cls: "vtt-key-sep", text: "+" });
			}
		});
	}

	// ── Rich description helper ───────────────

	private desc(parts: Array<string | { strong?: string; code?: string }>): DocumentFragment {
		const frag = document.createDocumentFragment();
		for (const p of parts) {
			if (typeof p === "string") {
				frag.appendText(p);
			} else if (p.strong) {
				const el = document.createElement("span");
				el.className = "vtt-desc-strong";
				el.textContent = p.strong;
				frag.appendChild(el);
			} else if (p.code) {
				const el = document.createElement("code");
				el.className = "vtt-desc-code";
				el.textContent = p.code;
				frag.appendChild(el);
			}
		}
		return frag;
	}

	// ── Main render ───────────────────────────

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Voice to Text" });

		// ─── Provider ─────────────────────────
		containerEl.createEl("h3", { text: "Provider", cls: "vtt-section-heading" });

		new Setting(containerEl)
			.setName("Speech-to-text provider")
			.setDesc(this.desc([
				"Choose which API to use. ",
				{ strong: "Deepgram" },
				" offers Nova models; ",
				{ strong: "Groq" },
				" uses Whisper.",
			]))
			.addDropdown((dd) =>
				dd
					.addOption("deepgram", "Deepgram")
					.addOption("groq", "Groq (Whisper)")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value as Provider;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		// ─── Deepgram ─────────────────────────
		if (this.plugin.settings.provider === "deepgram") {
			containerEl.createEl("h3", { text: "Deepgram", cls: "vtt-section-heading" });

			new Setting(containerEl)
				.setClass("vtt-api-key-row")
				.setName("API key")
				.setDesc(this.desc([
					{ strong: "Required." },
					" Your Deepgram secret key. Get one at ",
					{ code: "console.deepgram.com" },
					".",
				]))
				.addText((text) =>
					text
						.setPlaceholder("033215ef…")
						.setValue(this.plugin.settings.deepgramApiKey)
						.onChange(async (value) => {
							this.plugin.settings.deepgramApiKey = value.trim();
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc(this.desc([
					"Select a Deepgram model. ",
					{ strong: "Nova 2" },
					" is the most accurate general-purpose model.",
				]))
				.addDropdown((dd) => {
					Object.entries(DEEPGRAM_MODELS).forEach(([val, label]) =>
						dd.addOption(val, label)
					);
					return dd
						.setValue(this.plugin.settings.deepgramModel)
						.onChange(async (value) => {
							this.plugin.settings.deepgramModel = value;
							await this.plugin.saveSettings();
						});
				});
		}

		// ─── Groq ─────────────────────────────
		if (this.plugin.settings.provider === "groq") {
			containerEl.createEl("h3", { text: "Groq (Whisper)", cls: "vtt-section-heading" });

			new Setting(containerEl)
				.setClass("vtt-api-key-row")
				.setName("API key")
				.setDesc(this.desc([
					{ strong: "Required." },
					" Your Groq API key. Get one at ",
					{ code: "console.groq.com" },
					".",
				]))
				.addText((text) =>
					text
						.setPlaceholder("gsk_…")
						.setValue(this.plugin.settings.groqApiKey)
						.onChange(async (value) => {
							this.plugin.settings.groqApiKey = value.trim();
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc(this.desc([
					"Select a Whisper model. ",
					{ strong: "Turbo" },
					" is faster; ",
					{ strong: "Large v3" },
					" is more accurate.",
				]))
				.addDropdown((dd) => {
					Object.entries(GROQ_MODELS).forEach(([val, label]) =>
						dd.addOption(val, label)
					);
					return dd
						.setValue(this.plugin.settings.groqModel)
						.onChange(async (value) => {
							this.plugin.settings.groqModel = value;
							await this.plugin.saveSettings();
						});
				});
		}

		// ─── Language ─────────────────────────
		containerEl.createEl("h3", { text: "Language", cls: "vtt-section-heading" });

		new Setting(containerEl)
			.setName("Transcription language")
			.setDesc(this.desc([
				"Select the spoken language. ",
				{ strong: "Auto" },
				" lets the provider detect it automatically — slightly slower.",
			]))
			.addDropdown((dd) => {
				Object.entries(LANGUAGES).forEach(([val, label]) =>
					dd.addOption(val, label)
				);
				return dd
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value;
						await this.plugin.saveSettings();
					});
			});

		// ─── Hotkey ───────────────────────────
		containerEl.createEl("h3", { text: "Push-to-talk hotkey", cls: "vtt-section-heading" });

		const hotkeyRow = new Setting(containerEl)
			.setName("Hotkey")
			.setDesc(this.desc([
				{ strong: "Click the field" },
				", then hold your desired key combination. The binding will be captured automatically.",
			]));

		const hotkeyWrap = hotkeyRow.controlEl.createDiv({ cls: "vtt-hotkey-container" });
		const displayEl  = hotkeyWrap.createDiv({ cls: "vtt-hotkey-display" });
		this.hotkeyDisplayEl = displayEl;
		this.renderHotkeyBadges(displayEl, this.plugin.settings.hotkey);

		const hintEl = hotkeyRow.settingEl.createDiv({ cls: "vtt-hotkey-hint" });
		hintEl.setText(this.capturingHotkey
			? "Press your key combination now…"
			: "Click the field above to capture");

		const clearBtn = hotkeyWrap.createEl("button", { text: "Clear" });
		clearBtn.style.cssText = "font-size:12px;padding:2px 8px;";
		clearBtn.onclick = async () => {
			this.plugin.settings.hotkey = "";
			await this.plugin.saveSettings();
			this.renderHotkeyBadges(displayEl, "", true);
		};

		// Capture logic
		let capturedSet: Set<string> = new Set();
		let captureTimeout: ReturnType<typeof setTimeout> | null = null;

		const startCapture = () => {
			this.capturingHotkey = true;
			capturedSet = new Set();
			displayEl.addClass("is-capturing");
			displayEl.empty();
			displayEl.addClass("is-empty");
			displayEl.setText("Press keys…");
			hintEl.setText("Hold your combination, then release.");
		};

		const finishCapture = async (keys: Set<string>) => {
			this.capturingHotkey = false;
			displayEl.removeClass("is-capturing");
			if (keys.size === 0) {
				this.renderHotkeyBadges(displayEl, this.plugin.settings.hotkey);
				hintEl.setText("Click the field above to capture");
				return;
			}
			// Prefer modifier ordering: Meta, Control, Alt, Shift, then others
			const order = ["Meta", "Control", "Alt", "Shift"];
			const sorted = [
				...order.filter((k) => keys.has(k)),
				...[...keys].filter((k) => !order.includes(k)),
			];
			const hotkey = sorted.join("+");
			this.plugin.settings.hotkey = hotkey;
			await this.plugin.saveSettings();
			this.renderHotkeyBadges(displayEl, hotkey);
			hintEl.setText("Click the field above to capture");
		};

		displayEl.addEventListener("click", (e) => {
			e.stopPropagation();
			startCapture();
		});

		displayEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (!this.capturingHotkey) return;
			e.preventDefault();
			e.stopPropagation();
			// Collect all currently held keys
			if (e.metaKey)    capturedSet.add("Meta");
			if (e.ctrlKey)    capturedSet.add("Control");
			if (e.altKey)     capturedSet.add("Alt");
			if (e.shiftKey)   capturedSet.add("Shift");
			const k = e.key;
			if (!["Meta","Control","Alt","Shift"].includes(k)) capturedSet.add(k);
			// Live preview
			this.renderHotkeyBadges(displayEl, [...capturedSet].join("+"));
			displayEl.addClass("is-capturing");
		}, true);

		displayEl.addEventListener("keyup", async (e: KeyboardEvent) => {
			if (!this.capturingHotkey) return;
			e.preventDefault();
			// On first key release, commit
			if (captureTimeout) clearTimeout(captureTimeout);
			captureTimeout = setTimeout(() => finishCapture(capturedSet), 150);
		}, true);

		displayEl.setAttribute("tabindex", "0");

		// Clicking outside cancels capture
		const cancelCapture = () => {
			if (this.capturingHotkey) {
				this.capturingHotkey = false;
				displayEl.removeClass("is-capturing");
				this.renderHotkeyBadges(displayEl, this.plugin.settings.hotkey);
				hintEl.setText("Click the field above to capture");
			}
		};
		document.addEventListener("click", cancelCapture, { once: true });

		// ─── Logging ──────────────────────────
		containerEl.createEl("h3", { text: "Logging", cls: "vtt-section-heading" });

		new Setting(containerEl)
			.setName("Enable file logging")
			.setDesc(this.desc([
				"Write plugin activity to ",
				{ strong: ".log files" },
				" inside the log folder. Each day gets its own file.",
			]))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.loggingEnabled)
					.onChange(async (value) => {
						this.plugin.settings.loggingEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.loggingEnabled) {
			new Setting(containerEl)
				.setName("Log folder")
				.setDesc(this.desc([
					"Vault-relative path for log files (e.g. ",
					{ code: "voice-to-text-logs" },
					"). Created automatically if missing.",
				]))
				.addText((text) =>
					text
						.setPlaceholder("voice-to-text-logs")
						.setValue(this.plugin.settings.logFolder)
						.onChange(async (value) => {
							this.plugin.settings.logFolder = value.trim() || "voice-to-text-logs";
							await this.plugin.saveSettings();
						})
				);
		}

		// ─── Audio saving ─────────────────────
		containerEl.createEl("h3", { text: "Audio", cls: "vtt-section-heading" });

		new Setting(containerEl)
			.setName("Save recordings")
			.setDesc(this.desc([
				"Save each recording as a ",
				{ strong: "WAV file" },
				" in your vault after transcription.",
			]))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.saveAudio)
					.onChange(async (value) => {
						this.plugin.settings.saveAudio = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.saveAudio) {
			new Setting(containerEl)
				.setName("Recordings folder")
				.setDesc(this.desc([
					"Vault-relative folder for saved WAV files (e.g. ",
					{ code: "voice-recordings" },
					"). Created automatically if missing.",
				]))
				.addText((text) =>
					text
						.setPlaceholder("voice-recordings")
						.setValue(this.plugin.settings.audioSaveFolder)
						.onChange(async (value) => {
							this.plugin.settings.audioSaveFolder = value.trim() || "voice-recordings";
							await this.plugin.saveSettings();
						})
				);
		}

		// ─── Status ───────────────────────────
		containerEl.createEl("h3", { text: "Status", cls: "vtt-section-heading" });

		const statusDiv = containerEl.createDiv({ cls: "vtt-status-block" });
		statusDiv.createEl("p", {
			text: `Active provider: ${this.plugin.settings.provider.toUpperCase()}`,
		});
		statusDiv.createEl("p", {
			text: `Language: ${LANGUAGES[this.plugin.settings.language] ?? this.plugin.settings.language}`,
		});
		if (this.plugin.settings.hotkey) {
			statusDiv.createEl("p", {
				text: `Hold [ ${this.plugin.settings.hotkey} ] to record.`,
			});
		} else {
			statusDiv.createEl("p", { text: "No hotkey set — configure above." });
		}
	}
}
