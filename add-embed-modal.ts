import { App, DropdownComponent, Editor, Modal, Notice, prepareFuzzySearch, Setting, TFile } from 'obsidian';
import { EmbedCodeFileSettings } from "./settings";
import { t } from "./i18n";

/**
 * 扩展名 → 语言候选映射（g-003 负责人钦定需求）。
 * 每个扩展名给出有序候选语言标识，取第一个在设置页
 * Included Languages 中登记的语言；全部未登记则视为无匹配。
 */
const EXTENSION_LANGUAGES: Record<string, string[]> = {
	'c': ['c'],
	'h': ['c', 'cpp'],
	'cpp': ['cpp', 'c++'],
	'cc': ['cpp'],
	'cxx': ['cpp'],
	'hpp': ['cpp'],
	'hxx': ['cpp'],
	'cs': ['cs', 'csharp'],
	'java': ['java'],
	'py': ['python'],
	'go': ['go', 'golang'],
	'rb': ['ruby', 'rb'],
	'js': ['javascript', 'js'],
	'mjs': ['javascript', 'js'],
	'cjs': ['javascript', 'js'],
	'jsx': ['javascript', 'js'],
	'ts': ['typescript', 'ts'],
	'tsx': ['typescript', 'ts'],
	'mts': ['typescript', 'ts'],
	'cts': ['typescript', 'ts'],
	'sh': ['bash', 'shell', 'sh'],
	'bash': ['bash', 'shell', 'sh'],
	'zsh': ['shell', 'sh', 'bash'],
};

export function fileExtension(fileName: string): string {
	const lower = fileName.toLowerCase();
	const dot = lower.lastIndexOf('.');
	if (dot <= 0) {
		return '';
	}
	return lower.slice(dot + 1);
}

/**
 * 按扩展名在已登记语言中匹配语言标识；无匹配返回 null（调用方保持当前选择不变）。
 */
export function matchLanguageByExtension(fileName: string, includedLanguages: string[]): string | null {
	const ext = fileExtension(fileName);
	if (!ext) {
		return null;
	}
	const candidates = EXTENSION_LANGUAGES[ext];
	if (!candidates) {
		return null;
	}
	for (const lang of candidates) {
		if (includedLanguages.contains(lang)) {
			return lang;
		}
	}
	return null;
}

export function parseIncludedLanguages(settings: EmbedCodeFileSettings): string[] {
	const seen = new Set<string>();
	const langs: string[] = [];
	settings.includedLanguages.split(',').forEach(raw => {
		const lang = raw.trim();
		if (lang && !seen.has(lang)) {
			seen.add(lang);
			langs.push(lang);
		}
	});
	return langs;
}

/**
 * 生成完整 embed 代码块；空字段行省略（TITLE 缺省时渲染回退为 PATH）。
 */
export function buildEmbedBlock(lang: string, path: string, lines: string, title: string): string {
	const out: string[] = ['```embed-' + lang, 'PATH: "' + path + '"'];
	if (lines) {
		out.push('LINES: "' + lines + '"');
	}
	if (title) {
		out.push('TITLE: "' + title + '"');
	}
	out.push('```');
	return out.join('\n');
}

interface SelectionSpan {
	hasSelection: boolean;
	startLine: number; // 1-based
	endLine: number;   // 1-based
}

export class AddEmbedCodeModal extends Modal {
	private pluginSettings: EmbedCodeFileSettings;
	private editor: Editor;
	private langs: string[];
	private mode: 'vault' | 'remote' = 'vault';

	private pathInput!: HTMLInputElement;
	private urlInput!: HTMLInputElement;
	private langDropdown!: DropdownComponent;
	private linesInput!: HTMLInputElement;
	private titleInput!: HTMLInputElement;
	private previewEl!: HTMLElement;
	private pathSetting!: Setting;
	private urlSetting!: Setting;
	private vaultButton!: HTMLButtonElement;
	private remoteButton!: HTMLButtonElement;
	private suggestEl!: HTMLElement;

	private suggestResults: TFile[] = [];
	private suggestActive = -1;
	private suggestOpen = false;

	constructor(app: App, settings: EmbedCodeFileSettings, editor: Editor) {
		super(app);
		this.pluginSettings = settings;
		this.editor = editor;
		this.langs = parseIncludedLanguages(settings);
	}

	onOpen() {
		this.modalEl.addClass('embed-add-modal');
		this.titleEl.setText(t('addEmbedCode'));

		// ---- 代码来源（分段切换）----
		const sourceSetting = new Setting(this.contentEl).setName(t('modalSource'));
		const seg = sourceSetting.controlEl.createDiv('embed-add-source-buttons');
		this.vaultButton = seg.createEl('button', { text: t('modalSourceVault') });
		this.remoteButton = seg.createEl('button', { text: t('modalSourceRemote') });
		this.vaultButton.addEventListener('click', () => this.setMode('vault'));
		this.remoteButton.addEventListener('click', () => this.setMode('remote'));
		this.vaultButton.classList.add('mod-cta');

		// ---- 文件路径（vault，输入即模糊搜索）----
		this.pathSetting = new Setting(this.contentEl)
			.setName(t('modalPath'))
			.setDesc(t('modalPathDesc'))
			.addText(text => {
				text.setPlaceholder('vault://Code/main.cpp');
				this.pathInput = text.inputEl;
				this.pathInput.addEventListener('input', () => this.onPathInput());
				this.pathInput.addEventListener('keydown', (e: KeyboardEvent) => this.onPathKeydown(e));
				this.pathInput.addEventListener('change', () => this.onPathCommit());
			});
		// F-3：路径行改整行布局（label/描述在上，输入框在下占满整行），建议列表随之完整展示
		this.pathSetting.settingEl.addClass('embed-add-path-item');
		// 把路径输入框包进 relative wrapper，建议下拉以输入框为锚，
		// 完整落在 Modal 内容区内并与输入框左右对齐（F-2 修复）
		const pathWrap = this.pathSetting.controlEl.createDiv('embed-add-path-wrap');
		pathWrap.appendChild(this.pathInput);
		this.suggestEl = pathWrap.createDiv('embed-add-suggest');
		this.suggestEl.hide();
		this.suggestOpen = false;

		// ---- 远程 URL ----
		this.urlSetting = new Setting(this.contentEl)
			.setName(t('modalRemoteUrl'))
			.setDesc(t('modalRemoteUrlDesc'))
			.addText(text => {
				text.setPlaceholder('https://raw.githubusercontent.com/user/repo/main/main.ts');
				this.urlInput = text.inputEl;
				this.urlInput.addEventListener('change', () => this.onUrlCommit());
			});
		this.urlSetting.settingEl.hide();

		// ---- 语言 ----
		new Setting(this.contentEl)
			.setName(t('modalLanguage'))
			.setDesc(t('modalLanguageDesc'))
			.addDropdown(dd => {
				this.langDropdown = dd;
				const options: Record<string, string> = {};
				this.langs.forEach(lang => {
					options[lang] = lang;
				});
				dd.addOptions(options);
				const def = this.langs.contains('cpp') ? 'cpp' : this.langs[0];
				if (def) {
					dd.setValue(def);
				}
				dd.onChange(() => this.updatePreview());
			});

		// ---- 行范围 LINES（选区预填）----
		new Setting(this.contentEl)
			.setName(t('modalLines'))
			.setDesc(t('modalLinesDesc'))
			.addText(text => {
				text.setPlaceholder(t('modalLinesPlaceholder'));
				text.setValue(this.selectionLinesPrefill());
				this.linesInput = text.inputEl;
				this.linesInput.addEventListener('input', () => this.updatePreview());
			});

		// ---- 标题 TITLE ----
		new Setting(this.contentEl)
			.setName(t('modalTitle'))
			.setDesc(t('modalTitleDesc'))
			.addText(text => {
				text.setPlaceholder(t('modalTitlePlaceholder'));
				this.titleInput = text.inputEl;
				this.titleInput.addEventListener('input', () => this.updatePreview());
			});

		// ---- 插入预览（实时）----
		new Setting(this.contentEl)
			.setName(t('modalPreview'))
			.setDesc(t('modalPreviewDesc'));
		this.previewEl = this.contentEl.createDiv('embed-add-preview');
		this.updatePreview();

		// ---- 底部按钮 ----
		const buttons = this.contentEl.createDiv('modal-button-container');
		const cancelBtn = buttons.createEl('button', { text: t('modalCancel') });
		cancelBtn.addEventListener('click', () => this.close());
		const insertBtn = buttons.createEl('button', { text: t('modalInsert'), cls: 'mod-cta' });
		insertBtn.addEventListener('click', () => this.insertBlock());
	}

	onClose() {
		this.contentEl.empty();
	}

	// ---------- 来源切换 ----------

	private setMode(mode: 'vault' | 'remote') {
		this.mode = mode;
		const vault = mode === 'vault';
		this.vaultButton.classList.toggle('mod-cta', vault);
		this.remoteButton.classList.toggle('mod-cta', !vault);
		this.pathSetting.settingEl.toggle(vault);
		this.urlSetting.settingEl.toggle(!vault);
		if (!vault) {
			this.closeSuggestions();
		}
		this.updatePreview();
	}

	// ---------- Vault 模糊搜索建议 ----------

	private onPathInput() {
		const raw = this.pathInput.value.trim();
		if (!raw || raw.startsWith('http://') || raw.startsWith('https://')) {
			this.closeSuggestions();
			this.updatePreview();
			return;
		}
		const query = raw.replace(/^vault:\/\//i, '');
		const results = this.searchVaultFiles(query);
		this.renderSuggestions(results);
		this.updatePreview();
	}

	private searchVaultFiles(query: string): TFile[] {
		if (!query) {
			return [];
		}
		const files = this.app.vault.getFiles();
		const fuzzy = prepareFuzzySearch(query.toLowerCase());
		const scored: { file: TFile; score: number }[] = [];
		files.forEach(file => {
			const match = fuzzy(file.path.toLowerCase());
			if (match) {
				scored.push({ file, score: match.score });
			}
		});
		// prepareFuzzySearch 的 score 越高表示匹配越好，降序取优（与 QuickSwitcher 惯例一致）
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, 20).map(x => x.file);
	}

	private renderSuggestions(files: TFile[]) {
		this.suggestEl.empty();
		this.suggestResults = files;
		this.suggestActive = -1;
		if (!files.length) {
			this.closeSuggestions();
			return;
		}
		files.forEach((file, index) => {
			const item = this.suggestEl.createDiv('embed-add-suggest-item');
			item.createSpan('embed-add-suggest-path').setText(file.path);
			item.addEventListener('click', () => this.chooseVaultFile(file));
			item.addEventListener('mouseenter', () => this.setActiveSuggestion(index, false));
		});
		this.suggestEl.show();
		this.suggestOpen = true;
	}

	private closeSuggestions() {
		this.suggestEl.empty();
		this.suggestEl.hide();
		this.suggestOpen = false;
		this.suggestActive = -1;
	}

	private setActiveSuggestion(index: number, scroll = true) {
		const items = Array.from(this.suggestEl.children) as HTMLElement[];
		if (!items.length) {
			return;
		}
		this.suggestActive = Math.max(0, Math.min(index, items.length - 1));
		items.forEach((el, i) => el.classList.toggle('is-active', i === this.suggestActive));
		if (scroll && items[this.suggestActive]) {
			items[this.suggestActive].scrollIntoView({ block: 'nearest' });
		}
	}

	private moveActiveSuggestion(delta: number) {
		const count = this.suggestResults.length;
		if (!count) {
			return;
		}
		let next = this.suggestActive + delta;
		if (next < 0) {
			next = count - 1;
		}
		if (next >= count) {
			next = 0;
		}
		this.setActiveSuggestion(next);
	}

	private onPathKeydown(e: KeyboardEvent) {
		if (!this.suggestOpen) {
			if (e.key === 'Enter') {
				this.onPathCommit();
			}
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			this.moveActiveSuggestion(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this.moveActiveSuggestion(-1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (this.suggestActive >= 0 && this.suggestResults[this.suggestActive]) {
				this.chooseVaultFile(this.suggestResults[this.suggestActive]);
			} else {
				this.closeSuggestions();
				this.onPathCommit();
			}
		} else if (e.key === 'Escape') {
			// 仅关闭建议下拉，不关闭 Modal
			e.preventDefault();
			e.stopPropagation();
			this.closeSuggestions();
		}
	}

	private chooseVaultFile(file: TFile) {
		this.pathInput.value = 'vault://' + file.path;
		this.closeSuggestions();
		this.autoMatchLanguage(file.name);
		this.updatePreview();
	}

	// ---------- 扩展名 → 语言自动匹配 ----------

	private autoMatchLanguage(fileName: string) {
		const lang = matchLanguageByExtension(fileName, this.langs);
		if (lang) {
			this.langDropdown.setValue(lang);
		}
		// 无匹配：保持当前语言选择不变
	}

	private onPathCommit() {
		// 手动输入（含粘贴）路径后失焦/回车：同样尝试按文件名匹配语言
		const raw = this.pathInput.value.trim();
		if (!raw) {
			return;
		}
		const parts = raw.replace(/^vault:\/\//i, '').split('/');
		const base = parts[parts.length - 1];
		if (base) {
			this.autoMatchLanguage(base);
		}
		this.updatePreview();
	}

	private onUrlCommit() {
		const url = this.urlInput.value.trim();
		if (!url) {
			return;
		}
		try {
			const parsed = new URL(url);
			const parts = parsed.pathname.split('/');
			const base = parts[parts.length - 1];
			if (base) {
				this.autoMatchLanguage(base);
			}
		} catch (e) {
			// 非法 URL：忽略自动匹配
		}
		this.updatePreview();
	}

	// ---------- 选区行号 ----------

	private selectionSpan(): SelectionSpan {
		const selection = this.editor.listSelections()[0];
		if (!selection) {
			return { hasSelection: false, startLine: 0, endLine: 0 };
		}
		const anchor = selection.anchor;
		const head = selection.head;
		const hasSelection = anchor.line !== head.line || anchor.ch !== head.ch;
		const anchorFirst = anchor.line < head.line || (anchor.line === head.line && anchor.ch <= head.ch);
		const startLine = (anchorFirst ? anchor.line : head.line) + 1;
		const endLine = (anchorFirst ? head.line : anchor.line) + 1;
		return { hasSelection, startLine, endLine };
	}

	private selectionLinesPrefill(): string {
		const span = this.selectionSpan();
		if (!span.hasSelection) {
			return '';
		}
		if (span.startLine === span.endLine) {
			return String(span.startLine);
		}
		return span.startLine + '-' + span.endLine;
	}

	// ---------- 预览与插入 ----------

	private currentPath(): string {
		if (this.mode === 'vault') {
			let p = this.pathInput.value.trim();
			if (p && !p.startsWith('vault://')) {
				p = 'vault://' + p.replace(/^\/+/, '');
			}
			return p;
		}
		return this.urlInput.value.trim();
	}

	private currentLang(): string {
		return this.langDropdown ? this.langDropdown.getValue() : '';
	}

	private updatePreview() {
		this.previewEl.empty();
		const path = this.currentPath();
		const lang = this.currentLang();
		if (!path || !lang) {
			this.previewEl.createSpan('embed-add-preview-dim')
				.setText(t('modalPreviewEmpty'));
			return;
		}
		const lines = this.linesInput.value.trim();
		const title = this.titleInput.value.trim();
		const block = buildEmbedBlock(lang, path, lines, title);
		block.split('\n').forEach(line => {
			const lineEl = this.previewEl.createDiv('embed-add-preview-line');
			if (line.startsWith('```')) {
				lineEl.createSpan('embed-add-preview-fence').setText('```');
				if (line.length > 3) {
					lineEl.createSpan('embed-add-preview-lang').setText(line.slice(3));
				}
			} else {
				const idx = line.indexOf(':');
				lineEl.createSpan('embed-add-preview-key').setText(line.slice(0, idx + 1));
				lineEl.createSpan('embed-add-preview-val').setText(line.slice(idx + 1));
			}
		});
	}

	private insertBlock() {
		const path = this.currentPath();
		if (!path) {
			new Notice(t('noticePathRequired'));
			(this.mode === 'vault' ? this.pathInput : this.urlInput).focus();
			return;
		}
		const lang = this.currentLang();
		if (!lang) {
			new Notice(t('noticeLangsEmpty'));
			return;
		}
		const lines = this.linesInput.value.trim();
		const title = this.titleInput.value.trim();
		const block = buildEmbedBlock(lang, path, lines, title);

		// 若编辑器仍有选区：先把光标折叠到选区末尾再插入，
		// 避免 replaceSelection 清掉被选中的原文。
		const span = this.selectionSpan();
		if (span.hasSelection) {
			const selection = this.editor.listSelections()[0];
			const anchor = selection.anchor;
			const head = selection.head;
			const anchorFirst = anchor.line < head.line || (anchor.line === head.line && anchor.ch < head.ch);
			const end = anchorFirst ? head : anchor;
			this.editor.setSelection(end, end);
		}

		const cursor = this.editor.getCursor();
		const lineText = this.editor.getLine(cursor.line);
		const before = lineText.slice(0, cursor.ch);
		const after = lineText.slice(cursor.ch);
		const pre = before.trim().length > 0 ? '\n\n' : '\n';
		const post = after.trim().length > 0 ? '\n\n' : '\n';
		this.editor.replaceSelection(pre + block + post);
		this.close();
	}
}
