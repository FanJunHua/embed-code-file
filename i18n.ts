/**
 * g-010 i18n：zh/en 双语字符串表 + 取值函数。
 *
 * 设计约束（为什么这样写）：
 * - 零依赖：不引第三方 i18n 库，双语规模一张表即可；本模块**不 import obsidian**，
 *   环境探测（moment.locale()/navigator.language）留在调用方（main.ts），这样本模块
 *   保持纯函数、可被离线夹具（tmp-fixture.mjs，裸 Node）直接导入断言。
 * - 语言在插件 onload 时一次定型（initI18n），不做运行时热切换：
 *   Obsidian 换语言后重载插件生效（已在设置页描述文案中说明）。
 * - 缺键回退链：当前语言 → en → key 本身；绝不抛错、也绝不渲染 "[missing]" 之类的占位标记。
 */

/** 支持的界面语言（en 为兜底语言） */
export type LocaleLang = 'en' | 'zh';

/**
 * 英文字符串表。
 * 原有英文文案原样收编（仅修正 could't → couldn't 两处拼写）；
 * 原有中文文案在此给出英文译文。
 */
const STRINGS_EN: Record<string, string> = {
	// ---- 命令 / 菜单 ----
	cmdHideSelectedLines: 'Hide selected code lines (selection in an embed block, writes HIDE)',
	cmdShowAll: 'Show all (clear hidden lines)',
	menuHideSelectedLines: 'Hide selected code lines',
	addEmbedCode: 'Add embed-code',
	// g-011：仅显示选中行（写 LINES）/ HIDE 转 LINES
	cmdShowOnlySelectedLines: 'Show only the selected code lines (writes LINES)',
	cmdConvertHideToLines: 'Convert HIDE to LINES',
	menuConvertHideToLines: 'Convert HIDE to LINES',

	// ---- 选中隐藏：Notice / 浮动按钮 / 显示全部按钮 ----
	noticeSelectInEmbedFirst: 'Select the code lines to hide inside an embed block, then run this command',
	noticeNoValidSelection: 'No valid selection found (select whole code lines inside an embed block)',
	noticeGutterLineUnavailable: 'That line number is no longer available (the block may have re-rendered), please retry',
	noticeNoHideableLines: 'No code lines available to hide',
	noticeCannotReadRowModel: 'Cannot read the line model of this block (reopen the note and try again)',
	noticeAlreadyHidden: 'These lines are already hidden',
	noticeCannotHideAll: 'Cannot hide every code line (the block would become empty); keep at least one line visible',
	noticeHiddenOne: 'Hidden line {n}',
	noticeHiddenMany: 'Hidden {n} lines',
	noticeSelectionOnlyDots: 'The selection only covers ellipsis rows (...) with no code lines to hide',
	noticeNoEmbedBlock: 'No embed code block found (place the cursor inside a block or select some code first)',
	noticeNoHiddenLines: 'This embed block currently has no hidden lines',
	noticeShownAll: 'All lines shown (HIDE cleared)',
	// g-011：仅显示选中行 / HIDE 转 LINES 的 Notice
	noticeLinesAlreadySet: 'This block already has a LINES value; the existing LINES is not overwritten',
	noticeNoHideToConvert: 'This embed block has no HIDE to convert',
	noticeEmptyVisibleSet: 'The visible line set is empty; write abandoned',
	noticeShowOnlyOne: 'Showing only line {n} (LINES)',
	noticeShowOnlyMany: 'Showing only {n} lines (LINES)',
	noticeConvertedToLines: 'Converted HIDE to LINES (rendering unchanged)',
	floatHideSelected: 'Hide selected lines',
	floatHideSelectedMany: 'Hide {n} selected lines',
	floatHideTitle: "Write the selected source line numbers into this embed block's HIDE",
	// g-011：浮层并列按钮「仅显示选中行」（仅 LINES 缺省的块出现）
	floatShowOnlySelected: 'Show only selected lines',
	floatShowOnlySelectedMany: 'Show only {n} selected lines',
	floatShowOnlyTitle: "Write the selected source line numbers into this embed block's LINES and remove HIDE",
	// g-011 增量 C：dots 段临时展开 + 恢复
	floatRestoreSelected: 'Restore selected lines',
	floatRestoreSelectedMany: 'Restore {n} selected lines',
	floatRestoreTitle: 'Restore the selected lines to the visible set (LINES ∪ selected / HIDE − selected)',
	expandDotsTitle: 'Expand hidden code lines (temporary view, does not modify the file)',
	collapseDotsTitle: 'Collapse the expanded code lines',
	collapseGhostTitle: 'Collapse these hidden lines',
	noticeNoRestorableLines: 'No restorable lines in the selection (select expanded hidden lines)',
	noticeNothingToRestore: 'Those lines are already visible; nothing to restore',
	noticeRestoredOne: 'Restored line {n}',
	noticeRestoredMany: 'Restored {n} lines',
	noticeExpandFailed: 'Expansion failed (source content unavailable); reverted',
	hideAllBtnTitle: "Clear this block's HIDE",
	hideAllBtnText: 'Show all ({n} lines hidden)',

	// ---- 写回路径 Notice ----
	noticeCannotLocateSource: 'Cannot locate the source position of this embed block (reopen the note and try again)',
	noticeCannotLocateSourceNoInfo: 'Cannot locate the source position of this embed block (getSectionInfo returned null); write abandoned',
	noticeWriteFailedEditorRead: 'Write-back failed: error reading the editor content, see the console for details',
	noticeWriteAbandoned: 'Write abandoned: {reason}',
	noticeNoChanges: 'Nothing to write (already up to date)',
	noticeWriteFailed: 'Write-back failed, see the console for details',
	reasonSourceFileNotFound: 'source file not found',
	reasonCannotReadFile: 'cannot read file content',
	// g-011：updateLinesInSection 的空 LINES 拒绝（reason 中文原文是键，见 REASON_KEYS）
	reasonEmptyLinesSpec: 'LINES value is empty; write abandoned',
	// 与 utils.ts applyHideToFullText 的中文 reason 一一对应（见 tReason），仅作 Notice 侧翻译
	reasonLocateFailedFullText: 'cannot locate the embed block in the full text (no fence candidates and an invalid section hint)',

	// ---- 代码块内渲染错误（进用户笔记预览，属用户可见文案） ----
	renderInvalidYaml: 'ERROR: invalid embedding (invalid YAML)',
	renderInvalidSourcePath: 'ERROR: invalid source path',
	renderFetchFailed: "ERROR: couldn't fetch '{path}'",
	renderReadFailed: "ERROR: couldn't read file '{path}'",
	renderInvalidSourcePathHint: "ERROR: invalid source path, use 'vault://...' or 'http[s]://...'",

	// ---- 设置页 ----
	settingsHeading: 'Embed Code File Settings',
	settingsIncludedLanguages: 'Included Languages',
	settingsIncludedLanguagesDesc: 'Comma separated list of included languages.',
	settingsIncludedLanguagesPlaceholder: 'Comma separated list',
	settingsLineNumbers: 'Line numbers',
	settingsLineNumbersDesc: 'Show a line-number gutter for embed-<lang> code blocks. Off by default (rendering identical to before); applies to embed blocks only, not regular code blocks.',
	lineNumbersNone: 'None (default)',
	lineNumbersOriginal: 'Original line numbers',
	lineNumbersNew: 'New line numbers (from 1)',
	settingsSelectionHideButton: 'Selection hide floating button',
	settingsSelectionHideButtonDesc: 'When code is selected inside an embed block, show a floating "Hide selected lines" button near the selection. Turning it off removes the button; the commands "Hide selected code lines" and "Show all (clear hidden lines)" and the block\'s top-right "Show all" button remain available.',
	settingsTitleFontColor: 'Font color of title',
	settingsTitleFontColorPlaceholder: 'Enter a color',
	settingsTitleBgColor: 'Background color of title',

	// ---- Add embed-code 弹窗 ----
	modalSource: 'Code source',
	modalSourceVault: '📁 Vault file',
	modalSourceRemote: '☁️ Remote URL',
	modalPath: 'File path',
	modalPathDesc: 'Type to fuzzy-search vault files; the vault:// prefix is added automatically. The language is matched by file extension after picking a file.',
	modalRemoteUrl: 'Remote URL',
	modalRemoteUrlDesc: 'For GitHub and similar platforms, use raw.githubusercontent.com links.',
	modalLanguage: 'Language',
	modalLanguageDesc: 'Options come from "Included Languages" in the plugin settings; the current choice is kept when no extension matches.',
	modalLines: 'Line range (LINES)',
	modalLinesDesc: 'E.g. 2,9,30-40; leave empty to embed all lines. Pre-filled from the editor selection when one exists.',
	modalLinesPlaceholder: 'e.g. 2,9,30-40; empty = all lines',
	modalTitle: 'Title (TITLE)',
	modalTitleDesc: 'Leave empty to omit this line; rendering falls back to PATH.',
	modalTitlePlaceholder: 'Empty shows PATH as the title',
	modalPreview: 'Insert preview (live)',
	modalPreviewDesc: 'The complete code block that will be inserted at the cursor.',
	modalPreviewEmpty: '# Fill in a path to preview the code block that will be inserted…',
	modalCancel: 'Cancel',
	modalInsert: 'Insert embed block',
	noticePathRequired: 'Enter a Vault file path or a remote URL first',
	noticeLangsEmpty: '"Included Languages" in the plugin settings is empty; configure languages there first',

	// 供夹具断言「zh 缺键 → 回退 en」的英文专属键（zh 表刻意不含此键）
	fixtureOnlyEnKey: 'EN_ONLY',
};

/**
 * 中文字符串表。
 * 既有中文文案与 v1.4.1 **逐字一致**（零回归）；原英文文案给出中文译文；
 * t() 的缺键回退会兜到英文表，故两表键面保持一致（fixtureOnlyEnKey 除外）。
 */
const STRINGS_ZH: Record<string, string> = {
	// ---- 命令 / 菜单 ----
	cmdHideSelectedLines: '隐藏选中的代码行（embed 块内选区，写入 HIDE）',
	cmdShowAll: '显示全部（清除隐藏）',
	menuHideSelectedLines: '隐藏选中的代码行',
	addEmbedCode: '添加 embed 代码块',
	// g-011：仅显示选中行（写 LINES）/ HIDE 转 LINES
	cmdShowOnlySelectedLines: '仅显示选中的代码行（写入 LINES）',
	cmdConvertHideToLines: '将 HIDE 转为 LINES',
	menuConvertHideToLines: '将 HIDE 转为 LINES',

	// ---- 选中隐藏：Notice / 浮动按钮 / 显示全部按钮 ----
	noticeSelectInEmbedFirst: '请在 embed 代码块内选中要隐藏的代码行，再执行此命令',
	noticeNoValidSelection: '未找到有效选区（请在 embed 代码块内选中整行代码）',
	noticeGutterLineUnavailable: '该行号已不可用（块可能已重新渲染），请重试',
	noticeNoHideableLines: '没有可隐藏的代码行',
	noticeCannotReadRowModel: '无法读取该块的行模型（请重新打开笔记再试）',
	noticeAlreadyHidden: '这些行已经隐藏了',
	noticeCannotHideAll: '不能隐藏全部代码行（会产生空块）；请至少保留一行',
	noticeHiddenOne: '已隐藏第 {n} 行',
	noticeHiddenMany: '已隐藏 {n} 行',
	noticeSelectionOnlyDots: '选区只覆盖了省略行（...），没有可隐藏的代码行',
	noticeNoEmbedBlock: '未找到 embed 代码块（请把光标放进块内或先选中代码）',
	noticeNoHiddenLines: '该 embed 块当前没有隐藏行',
	noticeShownAll: '已显示全部行（清除 HIDE）',
	// g-011：仅显示选中行 / HIDE 转 LINES 的 Notice
	noticeLinesAlreadySet: '该块已设置 LINES，不覆盖既有 LINES',
	noticeNoHideToConvert: '该块没有 HIDE，无需转换',
	noticeEmptyVisibleSet: '可见行集合为空，已放弃写入',
	noticeShowOnlyOne: '仅显示第 {n} 行（LINES）',
	noticeShowOnlyMany: '仅显示 {n} 行（LINES）',
	noticeConvertedToLines: '已将 HIDE 转为 LINES（渲染不变）',
	floatHideSelected: '隐藏选中行',
	floatHideSelectedMany: '隐藏选中 {n} 行',
	floatHideTitle: '把选中的源行号写入该 embed 块的 HIDE',
	// g-011：浮层并列按钮「仅显示选中行」（仅 LINES 缺省的块出现）
	floatShowOnlySelected: '仅显示选中行',
	floatShowOnlySelectedMany: '仅显示选中 {n} 行',
	floatShowOnlyTitle: '把选中的源行号写入该 embed 块的 LINES，并移除 HIDE',
	// g-011 增量 C：dots 段临时展开 + 恢复
	floatRestoreSelected: '恢复选中行',
	floatRestoreSelectedMany: '恢复选中 {n} 行',
	floatRestoreTitle: '把选中的行恢复进可见集合（LINES∪选中 / HIDE−选中）',
	expandDotsTitle: '展开隐藏的代码行（临时视图，不修改文件）',
	collapseDotsTitle: '收起展开的代码行',
	collapseGhostTitle: '收起此段隐藏行',
	noticeNoRestorableLines: '选区里没有可恢复的行（请选中展开出的隐藏行）',
	noticeNothingToRestore: '这些行已在可见集合中，无需恢复',
	noticeRestoredOne: '已恢复第 {n} 行',
	noticeRestoredMany: '已恢复 {n} 行',
	noticeExpandFailed: '展开失败（源内容不可用），已回滚',
	hideAllBtnTitle: '清除该块的 HIDE',
	hideAllBtnText: '显示全部（{n} 行已隐藏）',

	// ---- 写回路径 Notice ----
	noticeCannotLocateSource: '无法定位该 embed 块的源位置（请重新打开笔记再试）',
	noticeCannotLocateSourceNoInfo: '无法定位该 embed 块的源位置（getSectionInfo 返回空），已放弃写入',
	noticeWriteFailedEditorRead: '写回失败：读取编辑器内容异常，详见控制台',
	noticeWriteAbandoned: '已放弃写入：{reason}',
	noticeNoChanges: '没有需要写入的改动',
	noticeWriteFailed: '写回失败，详见控制台',
	reasonSourceFileNotFound: '找不到源文件',
	reasonCannotReadFile: '无法读取文件内容',
	reasonEmptyLinesSpec: 'LINES 值为空，已拒绝写入',
	reasonLocateFailedFullText: '无法在全文里定位 embed 块（围栏扫描无候选且节区提示无效）',

	// ---- 代码块内渲染错误 ----
	renderInvalidYaml: '错误：无效嵌入（YAML 解析失败）',
	renderInvalidSourcePath: '错误：无效的源路径',
	renderFetchFailed: "错误：无法获取 '{path}'",
	renderReadFailed: "错误：无法读取文件 '{path}'",
	renderInvalidSourcePathHint: "错误：无效的源路径，请使用 'vault://...' 或 'http[s]://...'",

	// ---- 设置页 ----
	settingsHeading: 'Embed Code File 设置',
	settingsIncludedLanguages: '包含的语言',
	settingsIncludedLanguagesDesc: '以英文逗号分隔的语言列表。',
	settingsIncludedLanguagesPlaceholder: '逗号分隔的语言列表',
	settingsLineNumbers: '行号显示',
	settingsLineNumbersDesc: '为 embed-<lang> 代码块显示行号列。默认不显示，与当前版本行为一致；仅对 embed 块生效，不影响普通代码块。',
	lineNumbersNone: '不显示（默认）',
	lineNumbersOriginal: '显示原行号',
	lineNumbersNew: '显示新行号',
	settingsSelectionHideButton: '选中隐藏浮动按钮',
	settingsSelectionHideButtonDesc: '在 embed 代码块内选中代码时，于选区附近浮现「隐藏选中行」按钮。关闭后不再浮现该按钮；命令「隐藏选中的代码行」与「显示全部（清除隐藏）」以及块右上角的「显示全部」小按钮仍然可用。',
	settingsTitleFontColor: '标题字体颜色',
	settingsTitleFontColorPlaceholder: '输入颜色值',
	settingsTitleBgColor: '标题背景颜色',

	// ---- Add embed-code 弹窗 ----
	modalSource: '代码来源',
	modalSourceVault: '📁 Vault 文件',
	modalSourceRemote: '☁️ 远程 URL',
	modalPath: '文件路径',
	modalPathDesc: '输入即搜索库内文件，自动携带 vault:// 前缀；选中后按扩展名自动匹配语言。',
	modalRemoteUrl: '远程 URL',
	modalRemoteUrlDesc: 'GitHub 等平台请使用 raw.githubusercontent.com 链接。',
	modalLanguage: '语言',
	modalLanguageDesc: '选项来自设置页 Included Languages；无扩展名匹配时保持当前选择。',
	modalLines: '行范围 LINES',
	modalLinesDesc: '如 2,9,30-40；留空 = 嵌入全部行。编辑器有选区时自动预填选区行号。',
	modalLinesPlaceholder: '如 2,9,30-40；留空 = 嵌入全部行',
	modalTitle: '标题 TITLE',
	modalTitleDesc: '留空则省略该行，渲染时回退为 PATH。',
	modalTitlePlaceholder: '留空则显示 PATH 作为标题',
	modalPreview: '插入预览（实时）',
	modalPreviewDesc: '将要插入到光标处的完整代码块。',
	modalPreviewEmpty: '# 填写路径后在此实时预览将要插入的代码块…',
	modalCancel: '取消',
	modalInsert: '插入 embed 块',
	noticePathRequired: '请先填写 Vault 文件路径或远程 URL',
	noticeLangsEmpty: '设置页 Included Languages 为空，请先在插件设置中配置语言',
};

/** utils.ts 写回定位失败的中文 reason → 文案键。中文原文是键（匹配值），不是展示文案： */
/** 该 reason 同时被 console 诊断与夹具 5h-7 按原文断言，必须保持原文不动，故只做展示层映射。 */
const REASON_KEYS: Record<string, string> = {
	'无法在全文里定位 embed 块（围栏扫描无候选且节区提示无效）': 'reasonLocateFailedFullText',
	// g-011：updateLinesInSection 对空 LINES 的拒绝分支（zh 原文即 utils 里的 reason 字面量）
	'LINES 值为空，已拒绝写入': 'reasonEmptyLinesSpec',
};

let currentLocale: LocaleLang = 'en';

/**
 * locale 归一化：以 zh 开头（zh / zh-CN / zh-TW / zh_Hans…，大小写不敏感）→ zh，其余 → en。
 * 空串/空白 → en。
 */
export function normalizeLocale(raw: string): LocaleLang {
	return /^zh/i.test((raw || '').trim()) ? 'zh' : 'en';
}

/**
 * 语言定型（onload 调用一次）：按候选顺序取**第一个非空候选**归一化；
 * 全部为空（如冒烟测试桩环境）→ en。候选顺序由调用方保证：moment.locale() 优先、
 * navigator.language 兜底（Obsidian 界面语言优先级最高）。
 */
export function initI18n(rawLocales: Array<string | null | undefined>): LocaleLang {
	currentLocale = 'en';
	for (const raw of rawLocales) {
		if (raw && String(raw).trim()) {
			currentLocale = normalizeLocale(String(raw));
			break;
		}
	}
	return currentLocale;
}

/** 当前语言（诊断/测试用） */
export function locale(): LocaleLang {
	return currentLocale;
}

/**
 * 取文案：当前语言表 → 缺键回退 en 表 → 仍缺回退 key 本身（不抛错、不渲染占位标记）。
 * params 做 {name} 简单占位替换；未提供的占位符原样保留（宁可不替换也不丢信息）。
 */
export function t(key: string, params?: Record<string, string | number>): string {
	const dict = currentLocale === 'zh' ? STRINGS_ZH : STRINGS_EN;
	const raw = dict[key] !== undefined ? dict[key] : STRINGS_EN[key] !== undefined ? STRINGS_EN[key] : key;
	if (!params) {
		return raw;
	}
	return raw.replace(/\{(\w+)\}/g, (match: string, name: string) =>
		Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
	);
}

/**
 * utils.ts 的写回定位失败 reason → Notice 侧文案。
 * 匹配不到映射的 reason（含英文状态码 unchanged/replaced 等）原样透传；
 * zh 下映射结果与原文逐字一致（零回归），en 下给出英文说明。
 */
export function tReason(reason: string): string {
	const key = reason ? REASON_KEYS[reason] : undefined;
	return key ? t(key) : reason;
}
