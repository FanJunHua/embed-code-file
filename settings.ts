import EmbedCodeFile from './main';

import { PluginSettingTab, Setting, App } from 'obsidian';

/**
 * 行号显示模式（g-005，与已批原型 docs/ui-mockup-line-numbers.html §1/§5 一致）：
 * none=不显示（默认，渲染产物与旧版完全一致）；original=显示源文件真实行号；new=从 1 重新计数。
 */
export type LineNumberMode = 'none' | 'original' | 'new';

export interface EmbedCodeFileSettings {
	includedLanguages: string;
	titleBackgroundColor: string;
	titleFontColor: string;
	lineNumbers: LineNumberMode;
}

export const DEFAULT_SETTINGS: EmbedCodeFileSettings = {
	includedLanguages: 'c,cs,cpp,java,python,go,ruby,javascript,js,typescript,ts,shell,sh,bash',
	titleBackgroundColor: "#00000020",
	titleFontColor: "",
	lineNumbers: 'none'
}

export class EmbedCodeFileSettingTab extends PluginSettingTab {
	plugin: EmbedCodeFile;

	constructor(app: App, plugin: EmbedCodeFile) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		containerEl.createEl('h2', {text: 'Embed Code File Settings'});

		new Setting(containerEl)
			.setName('Included Languages')
			.setDesc('Comma separated list of included languages.')
			.addText(text => text
				.setPlaceholder('Comma separated list')
				.setValue(this.plugin.settings.includedLanguages)
				.onChange(async (value) => {
					this.plugin.settings.includedLanguages = value;
					await this.plugin.saveSettings();
				}));

		// 行号显示（g-005，文案与已批原型一致；默认不显示=零回归）
		new Setting(containerEl)
			.setName('行号显示')
			.setDesc('为 embed-<lang> 代码块显示行号列。默认不显示，与当前版本行为一致；仅对 embed 块生效，不影响普通代码块。')
			.addDropdown(dd => dd
				.addOptions({
					'none': '不显示（默认）',
					'original': '显示原行号',
					'new': '显示新行号'
				})
				.setValue(this.plugin.settings.lineNumbers)
				.onChange(async (value) => {
					this.plugin.settings.lineNumbers = value as LineNumberMode;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Font color of title")
			.addText(text => text
				.setPlaceholder('Enter a color')
				.setValue(this.plugin.settings.titleFontColor)
				.onChange(async (value) => {
					this.plugin.settings.titleFontColor = value;
					await this.plugin.saveSettings();
				}));
		  
		new Setting(containerEl)
			.setName('Background color of title')
			.addText(text => text
				.setPlaceholder('#00000020')
				.setValue(this.plugin.settings.titleBackgroundColor)
				.onChange(async (value) => {
					this.plugin.settings.titleBackgroundColor = value;
					await this.plugin.saveSettings();
				}));
	}
}
