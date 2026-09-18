import EmbedCodeFile from './main';

import { PluginSettingTab, Setting, App } from 'obsidian';
import { t } from './i18n';

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
	/** g-009：块内选中代码时是否浮现「隐藏选中行」浮动按钮（命令与「显示全部」不受此开关影响） */
	selectionHideButton: boolean;
	/** g-009：块级「显示全部」按钮要避让的核心按钮选择器（不同主题类名不同，故做成可配置数组） */
	hideAllButtonCoreSelectors: string[];
}

export const DEFAULT_SETTINGS: EmbedCodeFileSettings = {
	includedLanguages: 'c,cs,cpp,java,python,go,ruby,javascript,js,typescript,ts,shell,sh,bash',
	titleBackgroundColor: "#00000020",
	titleFontColor: "",
	lineNumbers: 'none',
	selectionHideButton: true,
	hideAllButtonCoreSelectors: ['.copy-code-button', '.edit-block-button', '.code-block-flair']
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
		containerEl.createEl('h2', {text: t('settingsHeading')});

		new Setting(containerEl)
			.setName(t('settingsIncludedLanguages'))
			.setDesc(t('settingsIncludedLanguagesDesc'))
			.addText(text => text
				.setPlaceholder(t('settingsIncludedLanguagesPlaceholder'))
				.setValue(this.plugin.settings.includedLanguages)
				.onChange(async (value) => {
					this.plugin.settings.includedLanguages = value;
					await this.plugin.saveSettings();
				}));

		// 行号显示（g-005，文案与已批原型一致；默认不显示=零回归）
		new Setting(containerEl)
			.setName(t('settingsLineNumbers'))
			.setDesc(t('settingsLineNumbersDesc'))
			.addDropdown(dd => dd
				.addOptions({
					'none': t('lineNumbersNone'),
					'original': t('lineNumbersOriginal'),
					'new': t('lineNumbersNew')
				})
				.setValue(this.plugin.settings.lineNumbers)
				.onChange(async (value) => {
					this.plugin.settings.lineNumbers = value as LineNumberMode;
					await this.plugin.saveSettings();
				}));

		// g-009：选中隐藏浮动按钮开关（默认开启；只在有块内选区且开启时才出现，不影响渲染结果）
		new Setting(containerEl)
			.setName(t('settingsSelectionHideButton'))
			.setDesc(t('settingsSelectionHideButtonDesc'))
			.addToggle(tg => tg
				.setValue(this.plugin.settings.selectionHideButton)
				.onChange(async (value) => {
					this.plugin.settings.selectionHideButton = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settingsTitleFontColor'))
			.addText(text => text
				.setPlaceholder(t('settingsTitleFontColorPlaceholder'))
				.setValue(this.plugin.settings.titleFontColor)
				.onChange(async (value) => {
					this.plugin.settings.titleFontColor = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settingsTitleBgColor'))
			.addText(text => text
				.setPlaceholder('#00000020')
				.setValue(this.plugin.settings.titleBackgroundColor)
				.onChange(async (value) => {
					this.plugin.settings.titleBackgroundColor = value;
					await this.plugin.saveSettings();
				}));
	}
}
