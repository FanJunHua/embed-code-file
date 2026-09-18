import { Plugin, MarkdownRenderer, TFile, MarkdownPostProcessorContext, MarkdownView, Notice, Editor, parseYaml, requestUrl, moment} from 'obsidian';
import { EmbedCodeFileSettings, EmbedCodeFileSettingTab, DEFAULT_SETTINGS, LineNumberMode} from "./settings";
import { analyseSrcLines, extractSrcLines, buildEmbedLineRows, buildFullFileRows, buildLineGutterPlan, resolveLineTops, contentLineCount, pickFirstPositiveRect, geometricLinePitch, resolveLinePitch, EmbedLineRow, LineGutterPlan, LineRangeSet, LineRangeSegment, normalizeLineRanges, lineInRanges, applyHideToRows, hasVisibleCodeRow, rowsToSourceLineRanges, rowsToSourceLineSpec, subtractLineRanges, rangesToSpec, parseHideSpec, lineStartOffsets, charOffsetToLineIndex, selectionRowRange, collectSourceLineNums, lineNumsToRanges, updateHideInSection, EmbedHideSpec, EmbedSelectionRows, gutterSpanSourceLineNums, gutterSpanRangeToSourceLineNums, clampGutterSpanRange, applyHideToFullText, updateLinesInSection, HideUpdatePlan, LinesUpdatePlan, computeMinimalDiff, contentTailOf, describeText, describeSectionInfo, describeInfoTextFlavor, describeFence, describeUpdate, describeLinesUpdate, computeHideAllButtonRight, DEFAULT_CORE_BUTTON_SELECTORS, buildVisibleRowsForHide, dotsSegmentsOfRows, dotsSegmentId, EmbedDotsSegment, buildExpandedRows, ghostNumsFromExpanded, ghostStartNumsOfExpanded, ghostEndNumsOfExpanded, restoreCompute } from "./utils";
import { AddEmbedCodeModal } from "./add-embed-modal";
import { initI18n, t, tReason } from "./i18n";

/** g-010：Obsidian 界面语言原始值（moment.locale()）；拿不到返回空串（冒烟桩等无 moment 环境兜底）。 */
function obsidianLocaleRaw(): string {
	try {
		const loc = moment.locale();
		return loc ? String(loc) : '';
	} catch (e) {
		return '';
	}
}

// g-010：环境探测（moment/navigator）留在这里而非 i18n.ts —— i18n.ts 保持零依赖纯函数，
// 离线夹具（裸 Node）才能直接导入断言。
/** g-010：navigator.language 兜底；无 navigator 环境返回空串。 */
function navigatorLocaleRaw(): string {
	try {
		return (typeof navigator !== 'undefined' && navigator.language) ? String(navigator.language) : '';
	} catch (e) {
		return '';
	}
}

export default class EmbedCodeFile extends Plugin {
	settings: EmbedCodeFileSettings;

	async onload() {
		await this.loadSettings();

		// g-010：界面语言在加载时定型 —— 跟随 Obsidian 界面语言（moment.locale() 优先，
		// navigator.language 兜底）；不做运行时热切换，Obsidian 换语言后重载插件生效。
		initI18n([obsidianLocaleRaw(), navigatorLocaleRaw()]);

		this.addSettingTab(new EmbedCodeFileSettingTab(this.app, this));

		// g-009：选中隐藏的触发入口（浮动按钮 + 命令 + 悬停「显示全部」）
		this.setupSelectionHideUi();
		this.registerHideCommands();

		this.registerMarkdownPostProcessor((element, context) => {
			this.addTitle(element, context);
		});

		// live preview renderers
		const supportedLanguages = this.settings.includedLanguages.split(",")
		supportedLanguages.forEach(l => {
			console.log(`registering renderer for ${l}`)
			this.registerRenderer(l)
		});

		// editor context menu: quick "Add embed-code" (g-003)
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				menu.addItem((item) => {
					item
						.setTitle(t('addEmbedCode'))
						.setIcon('code-glyph')
						.onClick(() => {
							new AddEmbedCodeModal(this.app, this.settings, editor).open();
						});
				});
			})
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async registerRenderer(lang: string) {
		this.registerMarkdownCodeBlockProcessor(`embed-${lang}`, async (meta, el, ctx) => {
			let fullSrc = ""
			let src = ""

			let metaYaml: any
			try {
				metaYaml = parseYaml(meta)
			} catch(e) {
				await MarkdownRenderer.renderMarkdown('`' + t('renderInvalidYaml') + '`', el, '', this)
				return
			}

			let srcPath = metaYaml.PATH
			if (!srcPath) {
				await MarkdownRenderer.renderMarkdown('`' + t('renderInvalidSourcePath') + '`', el, '', this)
				return
			}

			if (srcPath.startsWith("https://") || srcPath.startsWith("http://")) {
				try {
					let httpResp = await requestUrl({url: srcPath, method: "GET"})
					fullSrc = httpResp.text
				} catch(e) {
					const errMsg = '`' + t('renderFetchFailed', { path: srcPath }) + '`'
					await MarkdownRenderer.renderMarkdown(errMsg, el, '', this)
					return
				}
			} else if (srcPath.startsWith("vault://")) {
				srcPath = srcPath.replace(/^(vault:\/\/)/,'');

				const tFile = app.vault.getAbstractFileByPath(srcPath)
				if (tFile instanceof TFile) {
					fullSrc = await app.vault.read(tFile)
				} else {
					const errMsg = '`' + t('renderReadFailed', { path: srcPath }) + '`'
					await MarkdownRenderer.renderMarkdown(errMsg, el, '', this)
					return
				}
			} else {
				const errMsg = '`' + t('renderInvalidSourcePathHint') + '`'
				await MarkdownRenderer.renderMarkdown(errMsg, el, '', this)
				return
			}

			let srcLinesNum: number[] = []
			const srcLinesNumString = metaYaml.LINES
			if (srcLinesNumString) {
				srcLinesNum = analyseSrcLines(srcLinesNumString)
			}

			// ===== HIDE（g-009 方案 B）=====
			// 语义：先按 LINES 得到显示行集合，再剔除 HIDE 指定的源行号；被剔除处沿用既有
			// 「省略」逻辑渲染 `...`（等价于 LINES 集合 − HIDE 集合）。零回归红线：缺省/空/
			// 非法/越界一律忽略并 warn，绝不因此不渲染。
			const fullSrcLineCount = fullSrc.split('\n').length
			const hidePlan = buildVisibleRowsForHide(fullSrc, srcLinesNumString, (metaYaml as any).HIDE)
			const hide: EmbedHideSpec = hidePlan.hide
			if (hide.warnings.length) {
				console.warn(`[embed-code-file] HIDE 值 ${JSON.stringify(hide.raw)} 有被忽略的片段：${hide.warnings.join('；')}`)
			}
			const hideRanges: LineRangeSet = hidePlan.hideRanges
			if (hide.requested && !hide.ranges.length) {
				console.warn(`[embed-code-file] HIDE 值 ${JSON.stringify(hide.raw)} 未产生任何有效行号，已忽略（按未设置 HIDE 渲染）`)
			} else if (hideRanges.length && !hidePlan.visibleRanges.length) {
				console.warn(`[embed-code-file] HIDE 值 ${JSON.stringify(hide.raw)} 与 LINES 无交集，未隐藏任何行`)
			}
			let hideApplied: LineRangeSet = hideRanges

			// 行号显示（g-005）：默认 none 不绘制行号列=与旧版渲染产物完全一致（零回归）。
			// g-011 增量 C：行模型**无条件构建**（展开/恢复等模型派生功能在行号关闭模式下也要工作，
			// 与 g-009「模型与设置解耦」同一原则）；行号列的绘制仍按设置门控。
			// 行号模型必须在 extractSrcLines 之前、对同一初始数组构建（buildEmbedLineRows
			// 内部在副本上重放同样的遍历），正文与行号列才能严格逐行对齐。
			const lineNumberMode: LineNumberMode = this.settings.lineNumbers
			const lineRows: EmbedLineRow[] = srcLinesNum.length > 0
				? buildEmbedLineRows(fullSrc, srcLinesNum)
				: buildFullFileRows(fullSrc)
			const activeLineNumberMode: 'original' | 'new' | null = lineNumberMode !== 'none' ? lineNumberMode : null

			// 正文的渲染行模型：HIDE 生效时必须建（与设置里的行号显示解耦——g-009 的选区映射、
			// 行号编号都依赖它），HIDE 未生效时保持 v1.4.1 的既有路径（零回归）。
			//
			// 关键修复（g-009 体验修复 1）：HIDE 生效时不再在「LINES 老模型」上就地打点，而是
			// 先把 LINES 变成**源行号集合**、减去 HIDE 得到真正的可见行集合，再由该集合重建行模型。
			// 原因：analyseSrcLines 对 "1-5,8-11" 只产出末尾那一个 0（段间省略），若在老模型上打点，
			// 「隐藏 6-7」（LINES 里本来就不存在的行）会打空、且 10 个逐行 dots 也合并不了；
			// 由区间集合重建后，段间/隐藏处一律恰好一个 `...`，且与行号模型同源对齐。
			const srcLines = fullSrc.split('\n')
			const renderRows: EmbedLineRow[] | null = hidePlan.rows
			// g-011：行号列实际使用的模型（HIDE 生效时必须由渲染模型派生，行数才与正文一致）；
			// lineRows 本体保持为「完整行模型」，供 dataset.embedLineRows 在无 HIDE 时挂载
			let gutterRows: EmbedLineRow[] = lineRows

			if (srcLinesNum.length == 0) {
				src = fullSrc
			} else {
				src = extractSrcLines(fullSrc, srcLinesNum)
			}
			if (renderRows) {
				// 行模型 ⟺ 渲染行文本：用行模型（源行号）重建正文，HIDE 与既有 `...` 同源
				src = renderRows.map((r) => (r.dot ? '...' : (srcLines[r.num - 1] ?? ''))).join('\n')
				// 行号列与正文逐行对齐：行号模型必须**由同一份渲染模型派生**（行数一致）
				gutterRows = renderRows.slice()
			}

			let title = metaYaml.TITLE
			if (!title) {
				title = srcPath
			}

			// g-009：标记 embed 块并挂行模型，供选区 → 源行号映射使用
			// （默认「不显示行号」时也挂，否则选区无法映射）
			const modelRows = renderRows ?? lineRows
			el.dataset.embedBlock = '1'
			el.dataset.embedPath = srcPath
			if (srcLinesNum.length > 0) { el.dataset.embedLines = String(srcLinesNumString) } else { delete el.dataset.embedLines }
			el.dataset.embedTail = contentTailOf(src)
			// g-011 增量 C：展开重建所需的块参数（fence 语言 / 标题 / 源文件总行数）
			el.dataset.embedLang = lang
			el.dataset.embedTitle = String(title ?? '')
			el.dataset.embedTotalLines = String(fullSrcLineCount)
			if (modelRows) {
				el.dataset.embedLineRows = JSON.stringify(modelRows)
			}
			if (hideRanges.length && renderRows) {
				// 与 LINES 求交后的**真实可隐藏集合**：选区合并以此为准，避免写入永远不生效的行号
				el.dataset.embedHideSpec = rangesToSpec(hideApplied, fullSrcLineCount)
			}
			this.embedSections.set(el, ctx)
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
			if (activeView) { this.lastEditorCtx = { editor: activeView.editor, file: activeView.file } }

			await MarkdownRenderer.renderMarkdown('```' + lang + '\n' + src + '\n```', el, '', this)
			// g-011 增量 C（守卫②a）：源文本缓存以渲染为唯一刷新点——渲染收尾必刷新，展开时只读不回源
			this.embedSources.set(el, fullSrc)
			if (activeLineNumberMode) {
				// 单点覆盖阅读视图与 live preview（两视图都经本 code-block processor 渲染）
				this.addLineNumbers(el, gutterRows, activeLineNumberMode)
			}
			this.addTitleLivePreview(el, title);
			this.refreshHideAllButton(el);
			// g-011 增量 C：行号关闭模式没有行号格可放展开符号 → 把 `...` 行本身作为等效点击入口
			if (!activeLineNumberMode) {
				this.attachDotsClickTarget(el)
				this.positionExpandToggles(el)
			}

			if (hideRanges.length && renderRows) {
				console.log(`[embed-code-file][g-009] HIDE 生效：可见 ${hideApplied.length} 段 / 渲染 ${renderRows.length} 行（连续省略已合并为单个 ...）`)
			}
		});
	}

	addTitleLivePreview(el: HTMLElement, title: string) {
		const codeElm = el.querySelector('pre > code')
		if (!codeElm) { return }
		const pre = codeElm.parentElement as HTMLPreElement;

		this.insertTitlePreElement(pre, title)
	}

	/* ======================= g-009：选中代码隐藏（HIDE 键） ======================= */

	/** 渲染上下文（写回时定位 section）；WeakMap 不阻止元素回收，重渲染即刷新。 */
	private embedSections = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
	/** 最近活跃的 Markdown 编辑器；观察器捕获阶段优先用事件里的 editor。 */
	private lastEditorCtx: { editor: Editor; file: TFile | null } | null = null;
	private hideFloatBtn: HTMLElement | null = null;
	/** g-011：浮层并列按钮「仅显示选中行」（仅 LINES 缺省的块随主按钮一同创建） */
	private showOnlyFloatBtn: HTMLElement | null = null;
	private hideFloatTarget: HTMLElement | null = null;
	private hideUiDisposers: (() => void)[] = [];
	/** g-009 增量：行号列拖选态（单击=起点=终点；拖选=起点..当前） */
	private gutterDrag: { gutter: HTMLElement; el: HTMLElement; spans: HTMLElement[]; start: number; end: number } | null = null;
	/** 拖选期间被抑制的行号列刷新（鼠标释放后补做，避免拖到一半 DOM 被换掉） */
	private pendingGutterRefresh = new Set<HTMLPreElement>();
	/* ======================= g-011 增量 C：dots 段临时展开（纯视图态） =======================
	 * 展开状态是**元素级**会话状态：键为 embed 块根元素，值为已展开段 id（源行区间 start-end）集合。
	 * 文件变更重渲染会产生新元素 → 状态随元素回收自然清空（自动收起），绝不写文件。
	 */
	private expandedSegments = new WeakMap<HTMLElement, Set<string>>();
	/** 首次展开前的基模型快照：重建一律从「基模型 ∪ 仍展开段」推导（否则收起后 dots 已从当前
	 *  模型消失，无法还原）；元素即生命周期，写回重渲染产生新元素后自然重建快照。 */
	private expandedBaseRows = new WeakMap<HTMLElement, EmbedLineRow[]>();
	/** 异步重建进行中的块（防重入：期间忽略再次点击/选区触发的展开） */
	private expandingBlocks = new WeakSet<HTMLElement>();
	/** 渲染收尾缓存的源文本（展开重建的正文来源；守卫②a：渲染为唯一刷新点，展开只读不回源） */
	private embedSources = new WeakMap<HTMLElement, string>();
	/** 浮层第三个按钮「恢复选中行」（展开态且选区含幽灵行时出现） */
	private restoreFloatBtn: HTMLElement | null = null;

	onunload() {
		this.clearGutterSelection();
		this.gutterDrag = null;
		this.pendingGutterRefresh.clear();
		this.hideUiDisposers.forEach((d) => { try { d() } catch (e) { /* 卸载期忽略 */ } });
		this.hideUiDisposers = [];
		this.removeHideFloatButton();
		document.querySelectorAll('.embed-hide-all-btn').forEach((n) => n.remove());
	}

	/** 选区浮动按钮的监听器（选区变化 / 滚动 / 点击别处）+ 行号列拖选的全局 mousemove/mouseup。 */
	setupSelectionHideUi() {
		const onSync = () => { this.syncHideFloatButton() };
		const onScroll = () => { this.removeHideFloatButton() };
		const onGutterBlur = () => { this.cancelGutterDrag() };
		const onMouseDown = (e: MouseEvent) => {
			const t = e.target as HTMLElement | null;
			// 拖选进行中按下别处 → 取消拖选（清理高亮，不执行隐藏）
			if (this.gutterDrag && !(t && t.closest && t.closest('.embed-line-gutter'))) { this.cancelGutterDrag() }
			if (t && (t === this.hideFloatBtn || t.closest('.embed-hide-float'))) { return }
			this.removeHideFloatButton();
		};
		document.addEventListener('selectionchange', onSync);
		document.addEventListener('mouseup', onSync);
		document.addEventListener('keyup', onSync);
		document.addEventListener('mousedown', onMouseDown, true);
		// g-009 增量：行号列拖选（mousedown 落在 gutter span 上时才激活）
		const onGutterMove = (e: MouseEvent) => { this.onGutterDragMove(e) };
		const onGutterUp = (e: MouseEvent) => { this.onGutterDragEnd(e) };
		const onGutterKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { this.cancelGutterDrag() } };
		document.addEventListener('mousemove', onGutterMove);
		document.addEventListener('mouseup', onGutterUp);
		document.addEventListener('keydown', onGutterKey, true);
		window.addEventListener('blur', onGutterBlur);
		window.addEventListener('scroll', onScroll, true);
		this.hideUiDisposers.push(() => {
			document.removeEventListener('selectionchange', onSync);
			document.removeEventListener('mouseup', onSync);
			document.removeEventListener('keyup', onSync);
			document.removeEventListener('mousedown', onMouseDown, true);
			document.removeEventListener('mousemove', onGutterMove);
			document.removeEventListener('mouseup', onGutterUp);
			document.removeEventListener('keydown', onGutterKey, true);
			window.removeEventListener('blur', onGutterBlur);
			window.removeEventListener('scroll', onScroll, true);
		});
	}

	registerHideCommands() {
		this.addCommand({
			id: 'hide-selected-lines',
			name: t('cmdHideSelectedLines'),
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'H' }],
			checkCallback: (checking: boolean) => {
				const embed = this.resolveEmbedFromEditor();
				if (!embed) { return false }
				if (!checking) { this.hideSelectedLines(embed.el) }
				return true
			}
		});

		this.addCommand({
			id: 'clear-hidden-lines',
			name: t('cmdShowAll'),
			checkCallback: (checking: boolean) => {
				const embed = this.resolveEmbedFromEditor();
				if (!embed) { return false }
				if (!checking) { this.clearHiddenLinesFromResolved(embed) }
				return true
			}
		});

		// g-011 功能 A：仅显示选中的代码行（写 LINES=选区 + 移除 HIDE；块已有 LINES 时 Notice 不动作）
		this.addCommand({
			id: 'show-only-selected-lines',
			name: t('cmdShowOnlySelectedLines'),
			checkCallback: (checking: boolean) => {
				const embed = this.resolveEmbedFromEditor();
				if (!embed) { return false }
				if (!checking) { this.showOnlySelectedLines(embed.el) }
				return true
			}
		});

		// g-011 功能 B：将 HIDE 转为 LINES（可见集合恒等的纯源码重构）
		this.addCommand({
			id: 'convert-hide-to-lines',
			name: t('cmdConvertHideToLines'),
			checkCallback: (checking: boolean) => {
				const embed = this.resolveEmbedFromEditor();
				if (!embed) { return false }
				if (!checking) { this.convertHideToLines(embed.el) }
				return true
			}
		});

		// 编辑器右键菜单（与 g-003 的 Add embed-code 并列）；移动端由 Obsidian 的
		// 「更多选项」菜单呈现同一 editor-menu 项。
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				const embed = this.resolveEmbedFromEditor(editor);
				if (!embed) { return }
				const hasHidden = !!(embed.el.dataset.embedHideSpec || '').trim();
				menu.addItem((item) => item
					.setTitle(t('menuHideSelectedLines'))
					.setIcon('eye-off')
					.onClick(() => { this.hideSelectedLines(embed.el) }));
				menu.addItem((item) => item
					.setTitle(t('cmdShowAll'))
					.setIcon('eye')
					.setDisabled(!hasHidden)
					.onClick(() => { this.clearHiddenLinesFromResolved(embed) }));
				// g-011 功能 B：右键菜单同名项（与既有两项并列；无 HIDE 的块禁用）
				menu.addItem((item) => item
					.setTitle(t('menuConvertHideToLines'))
					.setIcon('list')
					.setDisabled(!hasHidden)
					.onClick(() => { this.convertHideToLines(embed.el) }));
			})
		);
	}

	/**
	 * 命令/右键菜单入口：选区 → 源行号（只能来自块内 DOM 选区，编辑器行选区无法区分
	 * 代码行与省略行），写入该块的 HIDE。
	 */
	hideSelectedLines(el: HTMLElement) {
		const info = this.resolveSelectionHide();
		if (!info || info.el !== el) {
			new Notice(t('noticeSelectInEmbedFirst'));
			return;
		}
		this.hideSelectionFromResolved(info);
	}

	/* ======================= g-011：仅显示选中行（写 LINES）/ HIDE 转 LINES ======================= */

	/**
	 * 该块是否已有 LINES 键（渲染期只在 LINES 有值时挂 dataset.embedLines，缺省/空值都会删掉它）。
	 * 这是「LINES 是否缺省」的可靠判据：已有 LINES 的块绝不静默改写（不出现「仅显示选中行」）。
	 */
	embedHasLinesKey(el: HTMLElement): boolean {
		return !!(el.dataset.embedLines || '').trim();
	}

	/**
	 * 命令入口：仅显示选中的代码行（g-011 功能 A）。与浮层按钮等效：
	 * 选区 → 源行号 → 写 LINES=<选区 spec> 并同时移除 HIDE；块已有 LINES 时 Notice 不动作。
	 */
	showOnlySelectedLines(el: HTMLElement) {
		const info = this.resolveSelectionHide();
		if (!info || info.el !== el) {
			new Notice(t('noticeSelectInEmbedFirst'));
			return;
		}
		this.showOnlySelectionFromResolved(info);
	}

	showOnlySelectionFromResolved(resolved: { el: HTMLElement | null; rows: EmbedLineRow[]; nums: number[] } | null) {
		if (!resolved || !resolved.el) { new Notice(t('noticeNoValidSelection')); return }
		const { el, nums } = resolved;
		if (!nums.length) { new Notice(t('noticeSelectionOnlyDots')); return }
		this.showOnlyLinesFromGutter(el, nums);
	}

	/**
	 * 「仅显示选中行」唯一写入口（浮层按钮与命令共用）：nums 必须来自**当前可见代码行**
	 * （resolveSelectionHide/collectSourceLineNums 已保证：dots 行与已隐藏行不产生行号）。
	 * 空选区/选区全在 dots 行 → Notice 不写；最终写回 LINES=<选区> + 移除 HIDE。
	 */
	showOnlyLinesFromGutter(el: HTMLElement, nums: number[]) {
		if (this.embedHasLinesKey(el)) { new Notice(t('noticeLinesAlreadySet')); return }
		const rows = this.readEmbedRows(el);
		if (!rows || !rows.length) { new Notice(t('noticeCannotReadRowModel')); return }
		if (!nums.length) { new Notice(t('noticeSelectionOnlyDots')); return }
		const spec = rangesToSpec(lineNumsToRanges(nums), Number.MAX_SAFE_INTEGER);
		if (!spec.trim()) { new Notice(t('noticeSelectionOnlyDots')); return }
		const msg = nums.length === 1 ? t('noticeShowOnlyOne', { n: nums[0] }) : t('noticeShowOnlyMany', { n: nums.length });
		this.applyLinesValue(el, spec, true, msg);
	}

	/**
	 * 命令/右键菜单入口：把当前 HIDE 折叠进 LINES（g-011 功能 B）。
	 * 可见集合取该块**当前渲染行模型**（dataset.embedLineRows；LINES 缺省按整文件计算，
	 * HIDE 已在渲染期减过一轮）→ rowsToSourceLineSpec，转换前后渲染行模型逐行一致。
	 */
	convertHideToLines(el: HTMLElement) {
		if (!(el.dataset.embedHideSpec || '').trim()) { new Notice(t('noticeNoHideToConvert')); return }
		const rows = this.readEmbedRows(el);
		if (!rows || !rows.length) { new Notice(t('noticeCannotReadRowModel')); return }
		const visibleSpec = rowsToSourceLineSpec(rows);
		if (!visibleSpec.trim()) { new Notice(t('noticeEmptyVisibleSet')); return }
		this.applyLinesValue(el, visibleSpec, true, t('noticeConvertedToLines'));
	}

	/* ---------- g-011 增量 C：展开状态机 + 恢复写回 ---------- */

	/** 源文件总行数（渲染期挂在 dataset；缺失/非法 → 0，调用方按不可用处理）。 */
	embedTotalLines(el: HTMLElement): number {
		const n = Number(el.dataset.embedTotalLines ?? '0');
		return isFinite(n) && n > 0 ? n : 0;
	}

	/** 该块已展开段 id 集合（懒创建；元素即生命周期，重渲染自动为新空集）。 */
	private expandedIdsOf(el: HTMLElement): Set<string> {
		let s = this.expandedSegments.get(el);
		if (!s) { s = new Set<string>(); this.expandedSegments.set(el, s) }
		return s;
	}

	/** 选中行号里的幽灵行（落在已展开段区间内的行；纯函数 ghostNumsFromExpanded 的薄包装）。 */
	private ghostNumsOf(el: HTMLElement, nums: number[]): number[] {
		const ids = this.expandedSegments.get(el);
		if (!ids || !ids.size) { return [] }
		return ghostNumsFromExpanded(nums, ids);
	}

	private isGhostLine(el: HTMLElement, num: number): boolean {
		return this.ghostNumsOf(el, [num]).length > 0;
	}

	/**
	 * 展开/收起一个 dots 段（纯视图态切换）。展开 = 用扩展行模型重建块内容
	 * （buildExpandedRows 为单一事实来源，正文/行号/选区映射全部经既有函数派生）；
	 * 异步重建期间置 expanding 标志防重入，完成/失败都清标志（失败回滚状态 + Notice + warn）。
	 */
	async toggleDotsSegment(el: HTMLElement, segId: string) {
		if (this.expandingBlocks.has(el)) { return }
		const rowsNow = this.readEmbedRows(el);
		if (!rowsNow || !rowsNow.length) { new Notice(t('noticeCannotReadRowModel')); return }
		// 首次展开前快照基模型（收起/混合展开都从它重推，dots 才能还原）
		if (!this.expandedBaseRows.has(el)) { this.expandedBaseRows.set(el, rowsNow) }
		const ids = this.expandedIdsOf(el);
		const wasExpanded = ids.has(segId);
		if (wasExpanded) { ids.delete(segId) } else { ids.add(segId) }
		this.expandingBlocks.add(el);
		try {
			await this.rebuildBlockContent(el);
		} catch (e) {
			// 失败回滚展开态，避免「符号显示已展开但内容没变」的错位；绝不静默按 PATH 回源拉取
			if (wasExpanded) { ids.add(segId) } else { ids.delete(segId) }
			console.warn('[embed-code-file][g-011] 展开重建失败（已回滚）', { segId, wasExpanded, error: String(e) });
			new Notice(t('noticeExpandFailed'));
		} finally {
			this.expandingBlocks.delete(el);
		}
	}

	/**
	 * 用扩展行模型重建块内容（走与渲染处理器相同的后处理序列，逐项核对不遗漏）：
	 * 清空旧渲染产物 → renderMarkdown fence → addLineNumbers（设置开启时）→ addTitleLivePreview
	 * → refreshHideAllButton；行号关闭模式再挂 `...` 行点击入口。
	 * 单一事实来源：正文 src、行号计划、dataset.embedLineRows 全部由 buildExpandedRows 的结果派生，
	 * 不做任何 DOM 补丁（保护 g-005/g-007 行号对齐机制）。
	 */
	private async rebuildBlockContent(el: HTMLElement): Promise<void> {
		const srcText = this.embedSources.get(el);
		if (srcText === undefined) {
			// 守卫②b：缓存缺失（理论上不该发生）→ 放弃展开，绝不静默按 PATH 重新拉源（URL 源会走网络）
			throw new Error('embed 源文本缓存缺失');
		}
		const rowsNow = this.readEmbedRows(el);
		if (!rowsNow || !rowsNow.length) { throw new Error('行模型缺失') }
		// 单一事实来源：从「基模型 ∪ 仍展开段」推导（收起后 dots 才能从基模型还原）
		const base = this.expandedBaseRows.get(el) ?? rowsNow;
		const expanded = buildExpandedRows(srcText, base, this.expandedIdsOf(el));
		const lang = el.dataset.embedLang ?? 'txt';
		const title = el.dataset.embedTitle ?? '';
		const mode = this.settings.lineNumbers;

		// 正文由扩展模型派生（与渲染处理器 HIDE 路径同一写法：dots ↔ '...'，代码行按源行号回填）
		const srcLines = srcText.split('\n');
		const srcView = expanded.map((r) => (r.dot ? '...' : (srcLines[r.num - 1] ?? ''))).join('\n');

		// 清空旧渲染产物（保留块根元素自身：dataset / ctx / WeakMap 状态都挂在它上面）
		el.querySelectorAll('pre').forEach((n) => n.remove());

		await MarkdownRenderer.renderMarkdown('```' + lang + '\n' + srcView + '\n```', el, '', this);
		el.dataset.embedLineRows = JSON.stringify(expanded);
		if (mode !== 'none') {
			this.addLineNumbers(el, expanded, mode as 'original' | 'new');
		}
		if (title) { this.addTitleLivePreview(el, title) }
		this.refreshHideAllButton(el);
		if (mode === 'none') {
			this.attachDotsClickTarget(el)
			// g-011 修复：行号关闭模式的收起符号（展开段首幽灵行左缘的浮层 ▾）
			this.positionExpandToggles(el)
		}
		// 展开行视觉区分：给幽灵行的文本范围套上 CSS 类（纯展示层包装，textContent 不变，
		// 选区映射/行号对齐依赖的文本内容与偏移不受影响；从最后一行往前包，避免偏移失效）
		this.markGhostLines(el, expanded);
	}

	/** 幽灵行的视觉区分：把已展开段内的代码行文本包进 .embed-ghost-line（倒序处理防偏移失效）。 */
	private markGhostLines(el: HTMLElement, rows: EmbedLineRow[]) {
		const ids = this.expandedSegments.get(el);
		if (!ids || !ids.size) { return }
		const ghost = this.ghostNumsOf(el, rows.filter((r) => !r.dot).map((r) => r.num));
		if (!ghost.length) { return }
		const ghostSet = new Set<number>(ghost);
		const codeEl = el.querySelector('pre > code') as HTMLElement | null;
		if (!codeEl) { return }
		const { nodes, text } = this.collectCodeText(codeEl);
		if (!nodes.length) { return }
		const offsets = lineStartOffsets(text, rows.length);
		const range = document.createRange();
		for (let i = rows.length - 1; i >= 0; i--) {
			const row = rows[i];
			if (row.dot || !ghostSet.has(row.num)) { continue }
			const start = offsets[i];
			// 行内容终点：下一行行首（或文末）；空行没有内容可包，跳过
			const lineEnd = i + 1 < rows.length ? offsets[i + 1] - 1 : text.length;
			if (!(lineEnd > start)) { continue }
			const a = this.locateTextPos(nodes, start);
			const b = this.locateTextPos(nodes, lineEnd);
			if (!a || !b) { continue }
			try {
				range.setStart(a.node, a.offset);
				range.setEnd(b.node, b.offset);
				const frag = range.extractContents();
				const span = document.createElement('span');
				span.className = 'embed-ghost-line';
				span.appendChild(frag);
				range.insertNode(span);
			} catch (e) {
				// 单行包装失败不影响展开功能（视觉区分尽力而为）
			}
		}
	}

	/** 字符偏移 → 文本节点位置（与 measureCodeLines 内的 locate 同口径，供幽灵行包装使用）。 */
	private locateTextPos(nodes: Text[], pos: number): { node: Text; offset: number } | null {
		let acc = 0;
		for (let k = 0; k < nodes.length; k++) {
			const node = nodes[k];
			if (pos < acc + node.data.length) { return { node, offset: pos - acc } }
			if (pos === acc + node.data.length) {
				const next = nodes[k + 1];
				return next ? { node: next, offset: 0 } : { node, offset: node.data.length };
			}
			acc += node.data.length;
		}
		return null;
	}

	/**
	 * 行号关闭模式的展开入口（C1 等效入口）：把 `...` 行本身作为点击目标。
	 * 用既有偏移映射管线把点击位置反查到模型行，命中 dots 行才切换其所在段；
	 * 普通代码行上的点击完全不受影响（零回归）。
	 */
	private attachDotsClickTarget(el: HTMLElement) {
		const codeEl = el.querySelector('pre > code') as HTMLElement | null;
		if (!codeEl) { return }
		const anyEl = el as any;
		if (anyEl.__embedDotsClick) { return }
		anyEl.__embedDotsClick = true;
		codeEl.addEventListener('click', (e: MouseEvent) => {
			const rows = this.readEmbedRows(el);
			if (!rows || !rows.length || this.expandingBlocks.has(el)) { return }
			const segs = dotsSegmentsOfRows(rows, this.embedTotalLines(el));
			if (!segs.length) { return }
			// 点击位置 → code 文本偏移 → 逻辑行（caretRangeFromPoint 为 Chromium 专有，拿不到就放弃）
			const docAny = document as any;
			let container: Node | null = null;
			let offset = 0;
			if (typeof docAny.caretRangeFromPoint === 'function') {
				const r = docAny.caretRangeFromPoint(e.clientX, e.clientY);
				if (r) { container = r.startContainer; offset = r.startOffset }
			} else if (typeof docAny.caretPositionFromPoint === 'function') {
				const p = docAny.caretPositionFromPoint(e.clientX, e.clientY);
				if (p) { container = p.offsetNode; offset = p.offset }
			}
			if (!container) { return }
			const { nodes, text } = this.collectCodeText(codeEl);
			if (!nodes.length) { return }
			const off = this.textOffsetOf(nodes, text, container, offset);
			if (off === null) { return }
			const idx = charOffsetToLineIndex(lineStartOffsets(text, rows.length), off);
			const seg = segs.find((s) => idx >= s.startIndex && idx <= s.endIndex);
			if (!seg) { return }
			e.preventDefault();
			e.stopPropagation();
			this.toggleDotsSegment(el, dotsSegmentId(seg));
		});
	}

	/**
	 * 行号关闭模式的收起符号（g-011 实机修复）：展开后 `...` 行消失，▾ 需要新载体。
	 * 「▾首 + ▴末」括号式：首幽灵行挂 ▾、末幽灵行挂 ▴（U+25B4），两端点击动作相同=收起该段。
	 * 绝对定位浮层——绝不修改 code 的 textContent（任何文本偏移都会破坏 selectionRowRange
	 * 的选区映射）；符号只覆盖行首空白区。重建幂等：先清旧符号再挂新符号。
	 */
	private positionExpandToggles(el: HTMLElement) {
		const preEl = el.querySelector('pre') as HTMLPreElement | null;
		const codeElm = preEl ? preEl.querySelector('code') : null;
		if (!preEl || !codeElm) { return }
		// 清掉旧符号（重建幂等；行号模式符号在 gutter 内部、不在此清理范围）
		preEl.querySelectorAll('.embed-expand-floating').forEach((n) => n.remove());
		const ids = this.expandedSegments.get(el);
		if (!ids || !ids.size) { return }
		const rows = this.readEmbedRows(el);
		if (!rows || !rows.length) { return }
		const starts = ghostStartNumsOfExpanded(rows, ids);
		const ends = ghostEndNumsOfExpanded(rows, ids);
		if (!starts.size && !ends.size) { return }
		const code = codeElm as HTMLElement;
		const measured = this.measureCodeLines(code, rows.length);
		const resolved = resolveLineTops(measured.tops);
		const contentH = measured.contentHeight;
		const halfLeading = contentH > 0 && resolved && resolved.pitch > contentH ? (resolved.pitch - contentH) / 2 : 0;
		const preRect = preEl.getBoundingClientRect();
		const codeRect = code.getBoundingClientRect();
		const cs = getComputedStyle(code);
		const pitchFallback = contentH || 0;
		preEl.style.position = 'relative';
		const appendToggle = (num: number, segId: string, ch: string) => {
			const idx = rows.findIndex((r) => !r.dot && r.num === num);
			if (idx < 0) { return }
			const rowTop = resolved ? resolved.tops[idx] : (codeRect.top + idx * pitchFallback);
			const toggle = document.createElement('span');
			toggle.className = 'embed-expand-toggle is-expanded embed-expand-floating';
			toggle.textContent = ch;
			toggle.title = t('collapseGhostTitle');
			toggle.setAttribute('aria-label', t('collapseGhostTitle'));
			toggle.dataset.dotsSegment = segId;
			toggle.style.fontFamily = cs.fontFamily;
			toggle.style.fontSize = cs.fontSize;
			toggle.style.lineHeight = (resolved ? resolved.pitch : contentH) + 'px';
			toggle.style.top = (rowTop - preRect.top - halfLeading) + 'px';
			toggle.style.left = (codeRect.left - preRect.left + 2) + 'px';
			toggle.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() });
			toggle.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.toggleDotsSegment(el, segId);
			});
			preEl.appendChild(toggle);
		};
		// 先挂首符号 ▾；末符号 ▴ 跳过「同一段同一行」（单行段 start==end 只挂一个，不叠加）
		for (const [num, segId] of starts) { appendToggle(num, segId, '▾') }
		for (const [num, segId] of ends) {
			if (starts.has(num)) { continue }
			appendToggle(num, segId, '▴');
		}
	}

	/**
	 * 展开态「恢复选中行」唯一写入口（单击幽灵行 / 拖选确认 / Ctrl+拖选共用）。
	 * 统一语义（C4）：LINES 已有 → LINES∪选中 且 HIDE−选中（合并为一次全文最小 diff，单步 Ctrl+Z）；
	 * LINES 缺省 → 绝不创建 LINES 键，只做 HIDE−选中（走既有 HIDE 通道）。
	 * 写回成功 → 文件变更 → 自动重渲染（新元素）→ 展开态自动收起。
	 */
	restoreLinesFromGutter(el: HTMLElement, nums: number[]) {
		const rows = this.readEmbedRows(el);
		if (!rows || !rows.length) { new Notice(t('noticeCannotReadRowModel')); return }
		const ghost = this.ghostNumsOf(el, nums);
		if (!ghost.length) { new Notice(t('noticeNoRestorableLines')); return }
		const total = this.embedTotalLines(el);
		const comp = restoreCompute(
			this.embedHasLinesKey(el) ? (el.dataset.embedLines ?? '') : undefined,
			el.dataset.embedHideSpec || '',
			ghost,
			total,
		);
		if (!comp.changed) { new Notice(t('noticeNothingToRestore')); return }
		const msg = ghost.length === 1 ? t('noticeRestoredOne', { n: ghost[0] }) : t('noticeRestoredMany', { n: ghost.length });
		if (comp.lines !== null) {
			this.applyLinesValue(el, comp.lines, false, msg, comp.hide);
		} else {
			this.applyHideValue(el, comp.hide, msg);
		}
	}

	/* ---------- 选区 → 块 / 行模型 ---------- */

	/** 从 DOM 节点向上找到 embed 块根（editor-menu 与 editor 路径共用）。 */
	resolveEmbedFromNode(node: Node | null): HTMLElement | null {
		let cur: HTMLElement | null = null;
		if (!node) { return null }
		if (node.nodeType === Node.ELEMENT_NODE) { cur = node as HTMLElement } else { cur = node.parentElement }
		while (cur) {
			if (cur.dataset && cur.dataset.embedBlock === '1') { return cur }
			cur = cur.parentElement;
		}
		return null;
	}

	/** code 元素文本节点的连续拼接（TreeWalker）+ 行数（用于偏移映射）。 */
	private collectCodeText(codeEl: HTMLElement): { nodes: Text[]; text: string } {
		const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		let text = '';
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			nodes.push(node);
			text += node.data;
		}
		return { nodes, text };
	}

	/**
	 * (container, offset) → 该点在 code 文本上的绝对偏移。
	 * 元素容器（整段/整块选中）走 Range 测量：把 Range 起点钉在 code 的首个文本节点、
	 * 终点落在给定位置，`toString().length` 即绝对偏移——与文本节点 chunk 无关。
	 */
	private textOffsetOf(nodes: Text[], text: string, container: Node, offset: number): number | null {
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (container.nodeType === Node.TEXT_NODE) {
			const idx = nodes.indexOf(container as Text);
			if (idx < 0) { return null }
			let base = 0;
			for (let i = 0; i < idx; i++) { base += nodes[i].data.length }
			return base + Math.min(offset, (container as Text).data.length);
		}
		try {
			const range = document.createRange();
			range.setStart(first, 0);
			const el = container as HTMLElement;
			const count = el.childNodes.length;
			if (count === 0) {
				range.setEnd(last, last.data.length);
			} else if (offset >= count) {
				range.setEnd(last, last.data.length);
			} else {
				const child = el.childNodes[offset];
				const pos = this.firstTextNodeIn(child);
				if (pos && nodes.indexOf(pos) >= 0) { range.setEnd(pos, 0) } else { range.setEnd(last, last.data.length) }
			}
			return range.toString().length;
		} catch (e) {
			// Range 测量失败：退化为「块首 0 / 块尾 text.length」（宁可不动作也不错映射）
			return offset <= 0 ? 0 : text.length;
		}
	}

	private firstTextNodeIn(root: Node): Text | null {
		if (root.nodeType === Node.TEXT_NODE) { return root as Text }
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		return walker.nextNode() as Text | null;
	}

	/**
	 * window.getSelection() → { embed 块, 行模型, 选中的源行号 }。
	 * 关键点（g-009 判据 2）：偏移映射全部基于**行模型**，不复用 extractSrcLines 的 token 序列。
	 */
	resolveSelectionHide(): { el: HTMLElement; rows: EmbedLineRow[]; nums: number[]; range: EmbedSelectionRows } | null {
		if (typeof window === 'undefined' || typeof window.getSelection !== 'function') { return null }
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { return null }
		const range = sel.getRangeAt(0);
		const embed = this.resolveEmbedFromNode(range.startContainer);
		if (!embed) { return null }
		// 跨块选区：只接受起止都在同一个 embed 块内的选区
		if (this.resolveEmbedFromNode(range.endContainer) !== embed) { return null }

		const codeEl = embed.querySelector('pre > code') as HTMLElement | null;
		if (!codeEl) { return null }
		if (!codeEl.contains(range.startContainer) || !codeEl.contains(range.endContainer)) { return null }

		const rows = this.readEmbedRows(embed);
		if (!rows || !rows.length) { return null }

		const { nodes, text } = this.collectCodeText(codeEl);
		if (!nodes.length) { return null }
		const startOffset = this.textOffsetOf(nodes, text, range.startContainer, range.startOffset);
		const endOffset = this.textOffsetOf(nodes, text, range.endContainer, range.endOffset);
		if (startOffset === null || endOffset === null) { return null }

		const offsets = lineStartOffsets(text, rows.length);
		const mapped = selectionRowRange(offsets, rows.length, startOffset, endOffset, text.length);
		if (!mapped) { return null }

		const nums = collectSourceLineNums(rows, mapped.startIndex, mapped.endIndex);
		return { el: embed, rows, nums, range: mapped };
	}

	/** 读出块上挂的行模型（JSON）；损坏时放弃（宁可不动作也不错误映射）。 */
	readEmbedRows(el: HTMLElement): EmbedLineRow[] | null {
		const raw = el.dataset.gutterRows ?? el.dataset.embedLineRows;
		return this.parseRowsJson(raw);
	}

	/** 行模型的原始 JSON（转发给行号列节点，避免二次序列化）。 */
	private readEmbedRowsJson(el: HTMLElement): string | null {
		return el.dataset.embedLineRows ?? null;
	}

	private parseRowsJson(raw: string | undefined): EmbedLineRow[] | null {
		if (!raw) { return null }
		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) { return null }
			return parsed.filter((r: any) => r && typeof r.num === 'number' && typeof r.dot === 'boolean') as EmbedLineRow[];
		} catch (e) {
			return null;
		}
	}

	/* ---------- 浮动按钮 ---------- */

	private syncHideFloatButton() {
		if (!this.settings.selectionHideButton) { this.removeHideFloatButton(); return }
		if (this.hideFloatBtn && this.hideFloatTarget && this.hideFloatTarget.isConnected) {
			this.positionHideFloatButton(this.hideFloatTarget);
			return;
		}
		this.removeHideFloatButton();
		const info = this.resolveSelectionHide();
		if (!info) { return }
		this.showHideFloatButton(info.el, info.nums.length);
		// g-011 增量 C：代码选区落在展开态幽灵行上 → 追加「恢复选中行」（不给回调=代码选区路径，
		// 点击时重新解析选区并只恢复其中的幽灵行）
		if (this.ghostNumsOf(info.el, info.nums).length) { this.attachRestoreFloatButton(info.nums.length) }
	}

	/**
	 * 浮出「隐藏选中行」按钮。
	 * - 代码选区路径：不给 anchor，按 window.getSelection() 定位（既有行为不变）；
	 * - 行号列拖选路径：给 anchor（被拖选行号的包围盒），因为此时浏览器选区在 gutter 上，
	 *   用 getSelection() 定位会跑偏。
	 * g-011：块为 LINES 缺省（dataset.embedLines 不存在）时并列追加「仅显示选中行」按钮；
	 * 块已有 LINES 时绝不出现（不静默改写既有 LINES）。
	 */
	private showHideFloatButton(embed: HTMLElement, count: number, anchor?: DOMRect | null, onClick?: () => void, showOnlyOnClick?: () => void, restoreOnClick?: () => void) {
		this.removeHideFloatButton();
		const btn = document.createElement('button');
		btn.className = 'embed-hide-float';
		btn.setText(count > 1 ? t('floatHideSelectedMany', { n: count }) : t('floatHideSelected'));
		btn.title = t('floatHideTitle');
		btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() }, true);
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.removeHideFloatButton();
			if (onClick) { onClick(); return }
			const info = this.resolveSelectionHide();
			if (!info) { new Notice(t('noticeNoValidSelection')); return }
			this.hideSelectionFromResolved(info);
		});
		document.body.appendChild(btn);
		this.hideFloatBtn = btn;
		this.hideFloatTarget = embed;
		this.positionHideFloatButton(embed, anchor);

		if (!this.embedHasLinesKey(embed)) {
			this.attachShowOnlyFloatButton(count, showOnlyOnClick);
		}
		// g-011 增量 C：展开态选区含幽灵行 → 追加「恢复选中行」（排在主按钮正下方）
		if (restoreOnClick) {
			this.attachRestoreFloatButton(count, restoreOnClick);
		}
	}

	/** g-011：「仅显示选中行」并列按钮（浮层第二个动作；位置排在主按钮正上方）。 */
	private attachShowOnlyFloatButton(count: number, showOnlyOnClick?: () => void) {
		const btn = document.createElement('button');
		btn.className = 'embed-hide-float embed-show-only-float';
		btn.setText(count > 1 ? t('floatShowOnlySelectedMany', { n: count }) : t('floatShowOnlySelected'));
		btn.title = t('floatShowOnlyTitle');
		btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() }, true);
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.removeHideFloatButton();
			if (showOnlyOnClick) { showOnlyOnClick(); return }
			const info = this.resolveSelectionHide();
			if (!info) { new Notice(t('noticeNoValidSelection')); return }
			this.showOnlySelectionFromResolved(info);
		});
		document.body.appendChild(btn);
		this.showOnlyFloatBtn = btn;
		this.positionShowOnlyFloatButton();
	}

	/**
	 * g-011 增量 C：浮层「恢复选中行」按钮（展开态且选区含幽灵行时出现，排在主按钮正下方）。
	 * 不给 onClick 时走代码选区路径：重新解析选区并只恢复其中的幽灵行。
	 */
	private attachRestoreFloatButton(count: number, restoreOnClick?: () => void) {
		const btn = document.createElement('button');
		btn.className = 'embed-hide-float embed-restore-float';
		btn.setText(count > 1 ? t('floatRestoreSelectedMany', { n: count }) : t('floatRestoreSelected'));
		btn.title = t('floatRestoreTitle');
		btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() }, true);
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.removeHideFloatButton();
			if (restoreOnClick) { restoreOnClick(); return }
			const info = this.resolveSelectionHide();
			if (!info) { new Notice(t('noticeNoValidSelection')); return }
			this.restoreLinesFromGutter(info.el, info.nums);
		});
		document.body.appendChild(btn);
		this.restoreFloatBtn = btn;
		this.positionRestoreFloatButton();
	}

	private positionHideFloatButton(embed: HTMLElement, anchor?: DOMRect | null) {
		if (!this.hideFloatBtn) { return }
		let rect: DOMRectReadOnly | null = anchor ?? null;
		if (!rect) {
			const sel = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null;
			if (sel && sel.rangeCount > 0) {
				const r = sel.getRangeAt(0).getBoundingClientRect();
				if (r && (r.width || r.height)) { rect = r }
			}
		}
		if (!rect) {
			const box = embed.getBoundingClientRect();
			rect = new DOMRect(box.left + 8, box.top + 8, 0, 20);
		}
		const btn = this.hideFloatBtn;
		const w = btn.offsetWidth || 110;
		const h = btn.offsetHeight || 26;
		const x = rect.left + rect.width / 2 - w / 2;
		const y = rect.top - h - 6;
		btn.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
		btn.style.top = Math.max(4, (y < 4 ? rect.bottom + 6 : y)) + 'px';
		this.positionShowOnlyFloatButton();
	}

	/** g-011：并列按钮定位——与主按钮左对齐、排在其正上方 4px（上下排布避免窄窗口横向溢出）。 */
	private positionShowOnlyFloatButton() {
		const btn = this.showOnlyFloatBtn;
		const primary = this.hideFloatBtn;
		if (!btn || !primary) { return }
		const w = btn.offsetWidth || 130;
		const h = btn.offsetHeight || 26;
		const px = parseFloat(primary.style.left);
		const py = parseFloat(primary.style.top);
		const x = isFinite(px) ? px : 4;
		const y = (isFinite(py) ? py : h + 4) - h - 4;
		btn.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
		btn.style.top = Math.max(4, y) + 'px';
	}

	/** g-011 增量 C：「恢复选中行」按钮定位——与主按钮左对齐、排在其正下方 4px。 */
	private positionRestoreFloatButton() {
		const btn = this.restoreFloatBtn;
		const primary = this.hideFloatBtn;
		if (!btn || !primary) { return }
		const w = btn.offsetWidth || 130;
		const ph = primary.offsetHeight || 26;
		const px = parseFloat(primary.style.left);
		const py = parseFloat(primary.style.top);
		const x = isFinite(px) ? px : 4;
		const y = (isFinite(py) ? py : 4) + ph + 4;
		btn.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
		btn.style.top = Math.max(4, y) + 'px';
	}

	private removeHideFloatButton() {
		if (this.hideFloatBtn) { this.hideFloatBtn.remove() }
		if (this.showOnlyFloatBtn) { this.showOnlyFloatBtn.remove() }
		if (this.restoreFloatBtn) { this.restoreFloatBtn.remove() }
		this.hideFloatBtn = null;
		this.showOnlyFloatBtn = null;
		this.restoreFloatBtn = null;
		this.hideFloatTarget = null;
	}

	/* ---------- g-009 增量：行号列（gutter）单击/拖选 ---------- */

	/** 行号 span → 源行号：**只能靠行模型反查**（新行号模式下 span 文本是 1..N，绝不是源行号）。 */
	gutterSourceLineNumForSpan(el: HTMLElement, index: number): number | null {
		const rows = this.readEmbedRows(el);
		if (!rows || index < 0) { return null }
		const nums = gutterSpanSourceLineNums(rows);
		const num = nums[index];
		return typeof num === 'number' && num > 0 ? num : null;
	}

	/**
	 * 行号列 mousedown：只认 span（事件目标即行号，**不用 Y 坐标反算**），
	 * preventDefault 进入拖选态（避免浏览器把行号当文本拖）。
	 */
	onGutterMouseDown(gutter: HTMLElement, e: MouseEvent) {
		const embed = this.resolveEmbedFromNode(gutter);
		if (!embed) { return }
		const spans = Array.from(gutter.querySelectorAll('.embed-line-number')) as HTMLElement[];
		const index = this.gutterSpanIndexFromEvent(spans, e.target);
		if (index < 0) { return }
		// span 数量是拖选索引空间的唯一权威（模型行数含 dots，更大）
		const bounded = clampGutterSpanRange(this.readEmbedRows(embed) ?? [], index, index);
		if (!bounded) { return }
		e.preventDefault();
		this.removeHideFloatButton();
		this.clearGutterSelection();
		this.gutterDrag = { gutter, el: embed, spans, start: bounded.start, end: bounded.end };
		this.paintGutterSelection(bounded.start, bounded.end);
	}

	onGutterDragMove(e: MouseEvent) {
		const drag = this.gutterDrag;
		if (!drag) { return }
		if (!drag.gutter.isConnected) { this.cancelGutterDrag(); return }
		const index = this.gutterSpanIndexFromEvent(drag.spans, e.target);
		if (index < 0) { return }
		const bounded = clampGutterSpanRange(this.readEmbedRows(drag.el) ?? [], drag.start, index);
		if (!bounded) { return }
		if (bounded.start === drag.start && bounded.end === drag.end) { return }
		drag.end = bounded.end;
		this.paintGutterSelection(bounded.start, bounded.end);
	}

	onGutterDragEnd(e: MouseEvent) {
		const drag = this.gutterDrag;
		if (!drag) { return }
		const lo = drag.start;
		const hi = drag.end;
		this.clearGutterSelection();
		this.gutterDrag = null;
		// 行号列可能因 observer/主题切换被重建 → 延后到本次事件收尾再补刷新
		setTimeout(() => { this.flushPendingGutterRefresh() }, 0);
		if (!drag.gutter.isConnected) { return }

		const el = drag.el;
		const gutter = drag.gutter;
		const spans = drag.spans;

		// 单击（起点=终点）→ 幽灵行=立即恢复该行；普通行=立即隐藏（既有语义，零回归）
		if (lo === hi) {
			const num = this.gutterSourceLineNumForSpan(el, lo);
			if (num === null) { new Notice(t('noticeGutterLineUnavailable')); return }
			if (this.isGhostLine(el, num)) { this.restoreLinesFromGutter(el, [num]); return }
			this.hideLinesFromGutter(el, [num]);
			return;
		}

		// 拖选多行 → 浮出确认按钮（按住 Ctrl/Cmd 则按下即执行，便于连续操作）
		const nums = gutterSpanRangeToSourceLineNums(this.readEmbedRows(el) ?? [], lo, hi);
		if (!nums.length) { new Notice(t('noticeNoHideableLines')); return }

		// g-011 增量 C：展开态——选区含任一幽灵行 → 追加「恢复选中行」动作（只恢复幽灵行；
		// 普通行本就可见，恢复为 no-op）。纯普通行选区走既有隐藏路径，零回归。
		const ghost = this.ghostNumsOf(el, nums);
		if (ghost.length) {
			const freshNums = () => {
				const fresh = this.gutterSpanRangeFromLiveGutter(gutter, lo, hi);
				return fresh.length ? fresh : nums;
			};
			if (e.ctrlKey || e.metaKey) { this.restoreLinesFromGutter(el, this.ghostNumsOf(el, freshNums())); return }
			const anchor = this.gutterSpansRect(spans, lo, hi);
			this.showHideFloatButton(el, nums.length, anchor, () => {
				this.hideLinesFromGutter(el, freshNums());
			}, () => {
				this.showOnlyLinesFromGutter(el, freshNums());
			}, () => {
				const freshGhost = this.ghostNumsOf(el, freshNums());
				if (freshGhost.length) { this.restoreLinesFromGutter(el, freshGhost) } else { new Notice(t('noticeNoRestorableLines')) }
			});
			return;
		}

		if (e.ctrlKey || e.metaKey) { this.hideLinesFromGutter(el, nums); return }
		const anchor = this.gutterSpansRect(spans, lo, hi);
		this.showHideFloatButton(el, nums.length, anchor, () => {
			const fresh = this.gutterSpanRangeFromLiveGutter(gutter, lo, hi);
			this.hideLinesFromGutter(el, fresh.length ? fresh : nums);
		}, () => {
			// g-011：「仅显示选中行」并列按钮（仅 LINES 缺省的块会创建）
			const fresh = this.gutterSpanRangeFromLiveGutter(gutter, lo, hi);
			this.showOnlyLinesFromGutter(el, fresh.length ? fresh : nums);
		});
	}

	/** 拖选结束若块已被重渲染（span 失效）→ 按现有 span 重新取同一区间，拿不到就用快照。 */
	private gutterSpanRangeFromLiveGutter(gutter: HTMLElement, lo: number, hi: number): number[] {
		const embed = this.resolveEmbedFromNode(gutter);
		if (!embed) { return [] }
		const rows = this.readEmbedRows(embed);
		if (!rows) { return [] }
		return gutterSpanRangeToSourceLineNums(rows, lo, hi);
	}

	/** 命中判断：事件目标向上找 span（不用坐标反算）。走到 gutter 之外即放弃。 */
	private gutterSpanIndexFromEvent(spans: HTMLElement[], target: EventTarget | null): number {
		let node: Node | null = target as Node | null;
		for (let guard = 0; node && guard < 100; guard++) {
			const idx = spans.indexOf(node as HTMLElement);
			if (idx >= 0) { return idx }
			node = node.parentNode;
		}
		return -1;
	}

	/** 给 [lo..hi] 的 span 加高亮（主题变量），并清掉区间外的高亮。 */
	private paintGutterSelection(lo: number, hi: number) {
		const drag = this.gutterDrag;
		if (!drag) { return }
		const min = Math.min(lo, hi);
		const max = Math.max(lo, hi);
		drag.spans.forEach((span, i) => {
			span.classList.toggle('is-selected', i >= min && i <= max);
		});
	}

	private clearGutterSelection() {
		const drag = this.gutterDrag;
		if (!drag) { return }
		drag.spans.forEach((span) => span.classList.remove('is-selected'));
	}

	/** 任何非正常结束路径（移出块/失焦/重渲染）都走这里：清理高亮与拖选态，**不执行隐藏**。 */
	private cancelGutterDrag() {
		this.clearGutterSelection();
		this.gutterDrag = null;
		this.flushPendingGutterRefresh();
	}

	private flushPendingGutterRefresh() {
		if (!this.pendingGutterRefresh.size) { return }
		const pending = Array.from(this.pendingGutterRefresh);
		this.pendingGutterRefresh.clear();
		pending.forEach((pre) => { if (pre.isConnected) { this.refreshLineGutter(pre) } });
	}

	/** 多个 span 的包围盒（浮出按钮的锚点）。 */
	private gutterSpansRect(spans: HTMLElement[], lo: number, hi: number): DOMRect | null {
		const min = Math.max(0, Math.min(lo, hi));
		const max = Math.min(spans.length - 1, Math.max(lo, hi));
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		for (let i = min; i <= max; i++) {
			const span = spans[i];
			if (!span) { continue }
			const r = span.getBoundingClientRect();
			left = Math.min(left, r.left);
			top = Math.min(top, r.top);
			right = Math.max(right, r.right);
			bottom = Math.max(bottom, r.bottom);
		}
		if (!isFinite(left) || !isFinite(top)) { return null }
		return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
	}

	/**
	 * 隐藏写入的唯一入口（三个触发源共用：行号单击 / 行号拖选确认按钮 / 代码选区浮动按钮）。
	 * 合并现有 HIDE → 拒绝「隐藏后无可见行」→ 走安全写回；文案由真正被隐藏的行号生成。
	 */
	hideLinesFromGutter(el: HTMLElement, nums: number[]) {
		const rows = this.readEmbedRows(el);
		if (!rows || !rows.length) { new Notice(t('noticeCannotReadRowModel')); return }
		if (!nums.length) { new Notice(t('noticeNoHideableLines')); return }
		const hiddenNow = parseHideSpec(el.dataset.embedHideSpec || '', Number.MAX_SAFE_INTEGER);
		const merged = normalizeLineRanges([...hiddenNow.ranges, ...lineNumsToRanges(nums)], Number.MAX_SAFE_INTEGER);
		const remaining = applyHideToRows(rows, merged);
		const newly = remaining.hiddenNums.filter((n) => !hiddenNow.ranges.some((r) => n >= r.start && n <= r.end));
		if (!newly.length) { new Notice(t('noticeAlreadyHidden')); return }
		if (!hasVisibleCodeRow(remaining.rows)) {
			new Notice(t('noticeCannotHideAll'));
			return;
		}
		const msg = newly.length === 1 ? t('noticeHiddenOne', { n: newly[0] }) : t('noticeHiddenMany', { n: newly.length });
		this.applyHideValue(el, rangesToSpec(merged, Number.MAX_SAFE_INTEGER), msg);
	}

	/* ---------- 命令路径 ---------- */

	/**
	 * 命令/右键菜单：从编辑器光标所在行解析出 embed 块。
	 * 解析路径不依赖 CM 私有 API：在**已渲染**的 embed 块里找 section 行范围覆盖光标行的那个块。
	 * 光标来源优先级：① 右键菜单事件给的 editor；② 最近渲染时活跃的编辑器；③ 任意 markdown 叶子的
	 * 编辑器（阅读视图下 lastEditorCtx 可能为空，此时仍希望命令可用）；④ 纯阅读视图（没有任何编辑器）
	 * 则退化为「按渲染时记录的 sourcePath 找到唯一候选块」。
	 */
	resolveEmbedFromEditor(editor?: Editor): { el: HTMLElement; editor: Editor | null; file: TFile | null } | null {
		const target: { editor: Editor; file: TFile | null } | null =
			editor ? { editor, file: this.app.workspace.getActiveFile() } : (this.lastEditorCtx ?? this.anyMarkdownEditorCtx());
		let line: number | null = null;
		if (target && target.editor) {
			try { line = target.editor.getCursor().line } catch (e) { line = null }
		}

		const blocks = document.querySelectorAll('[data-embed-block="1"]');
		if (line !== null) {
			for (let i = 0; i < blocks.length; i++) {
				const cand = blocks[i] as HTMLElement;
				const range = this.sectionLineRange(cand);
				if (range && line >= range.start && line <= range.end) {
					return { el: cand, editor: target ? target.editor : null, file: target ? target.file : null };
				}
			}
		}

		// 退化路径：无编辑器（纯阅读视图）→ 取渲染时记录的 sourcePath 命中的块
		if (target && target.file) {
			for (let i = 0; i < blocks.length; i++) {
				const cand = blocks[i] as HTMLElement;
				const ctx = this.embedSections.get(cand);
				if (ctx && ctx.sourcePath === target.file.path) {
					return { el: cand, editor: target.editor, file: target.file };
				}
			}
		}
		if (blocks.length === 1) {
			const only = blocks[0] as HTMLElement;
			const ctx = this.embedSections.get(only);
			const file = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
			return { el: only, editor: target ? target.editor : null, file: file instanceof TFile ? file : null };
		}
		return null;
	}

	/** 任意 markdown 叶子的编辑器（阅读视图下 lastEditorCtx 可能为空时的兜底光标来源）。 */
	private anyMarkdownEditorCtx(): { editor: Editor; file: TFile | null } | null {
		let found: { editor: Editor; file: TFile | null } | null = null;
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			const view = leaf.view;
			if (!found && view instanceof MarkdownView && view.editor) { found = { editor: view.editor, file: view.file } }
		});
		return found;
	}

	/** 取 section 行范围（懒计算，供光标命中判定）。 */
	private sectionLineRange(el: HTMLElement): { start: number; end: number } | null {
		const ctx = this.embedSections.get(el);
		if (!ctx) { return null }
		const info = ctx.getSectionInfo(el);
		if (!info) { return null }
		return { start: info.lineStart, end: info.lineEnd };
	}

	hideSelectionFromResolved(resolved: { el: HTMLElement | null; rows: EmbedLineRow[]; nums: number[] } | null) {
		if (!resolved || !resolved.el) { new Notice(t('noticeNoValidSelection')); return }
		const { el, nums } = resolved;
		if (!nums.length) { new Notice(t('noticeSelectionOnlyDots')); return }
		this.hideLinesFromGutter(el, nums);
	}

	clearHiddenLinesFromResolved(resolved: { el: HTMLElement } | null) {
		if (!resolved) { new Notice(t('noticeNoEmbedBlock')); return }
		if (!(resolved.el.dataset.embedHideSpec || '').trim()) { new Notice(t('noticeNoHiddenLines')); return }
		this.applyHideValue(resolved.el, '', t('noticeShownAll'));
	}

	/**
	 * 悬停「显示全部（N 行已隐藏）」小按钮：清除该块 HIDE。
	 * g-009 体验修复：不再固定 right:6px（会与核心的复制/编辑按钮重叠），改为运行时把本按钮
	 * 放到**最靠左的核心按钮左侧 6px**；核心按钮常「悬停才完整布局」，故在块 mouseenter 时重算。
	 */
	refreshHideAllButton(el: HTMLElement) {
		const codeElm = el.querySelector('pre > code');
		const spec = (el.dataset.embedHideSpec || '').trim();
		const hiddenCount = spec ? parseHideSpec(spec, Number.MAX_SAFE_INTEGER).ranges.reduce((n, r) => n + (r.end - r.start + 1), 0) : 0;
		let btn = el.querySelector('.embed-hide-all-btn') as HTMLElement | null;

		if (!codeElm || !hiddenCount) {
			if (btn) { btn.remove() }
			return;
		}
		const pre = codeElm.parentElement as HTMLPreElement;
		if (!pre) { return }

		if (!btn) {
			btn = document.createElement('button');
			btn.className = 'embed-hide-all-btn';
			btn.title = t('hideAllBtnTitle');
			btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() });
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.applyHideValue(el, '', t('noticeShownAll'));
			});
			pre.appendChild(btn);
			// 核心按钮常在悬停时才完整布局 → 每次进入该块时重算一次位置
			if (!(el as any).__embedHideAllHover) {
				(el as any).__embedHideAllHover = true;
				el.addEventListener('mouseenter', () => { this.applyHideAllButtonPosition(el) });
			}
			// 核心按钮可能是异步插入的（Obsidian 在渲染后挂 copy/edit 按钮）→ 下一帧再算一次
			window.setTimeout(() => { if (el.isConnected) { this.applyHideAllButtonPosition(el) } }, 50);
		}
		btn.setText(t('hideAllBtnText', { n: hiddenCount }));
		this.applyHideAllButtonPosition(el);
	}

	/** 把「显示全部」按钮放到核心按钮左侧（找不到核心按钮则退回默认偏移）。 */
	applyHideAllButtonPosition(el: HTMLElement) {
		const btn = el.querySelector('.embed-hide-all-btn') as HTMLElement | null;
		if (!btn) { return }
		const pre = btn.parentElement as HTMLElement | null;
		if (!pre) { return }
		const selectors = (this.settings.hideAllButtonCoreSelectors && this.settings.hideAllButtonCoreSelectors.length)
			? this.settings.hideAllButtonCoreSelectors
			: DEFAULT_CORE_BUTTON_SELECTORS;
		const coreRects: Array<{ left: number; right: number; width: number }> = [];
		selectors.forEach((sel) => {
			pre.querySelectorAll(sel).forEach((node) => {
				const rect = (node as HTMLElement).getBoundingClientRect();
				coreRects.push({ left: rect.left, right: rect.right, width: rect.width });
			});
		});
		const panel = pre.getBoundingClientRect();
		const width = btn.getBoundingClientRect().width || btn.offsetWidth || 0;
		const placed = computeHideAllButtonRight(panel.right, coreRects, width);
		btn.style.right = placed.right + 'px';
		btn.dataset.hideAllPlacement = placed.source;
	}

	/* ---------- 写回（g-009 修复：以「当前真实全文」为唯一事实来源） ---------- */

	/**
	 * 写回入口（HIDE 通道）。事实来源优先级：① 该文件正在 MarkdownView 编辑器中打开 → `editor.getValue()`
	 * （这就是用户此刻看到的全文，也是唯一可信的当前状态）；② 否则 `vault.read`（process 路径在
	 * 其回调里拿同一份全文）。
	 * 渲染期的 `info.text` **只用于日志与提示**，不再作为中止依据（旧实现把它当节区文本却又按整文件
	 * 切片使用，导致「代码块不覆盖整个文件」时恒真中止）。
	 */
	applyHideValue(el: HTMLElement, hideSpec: string, successMsg: string) {
		this.applySectionWrite(el, { kind: 'hide', spec: hideSpec, successMsg });
	}

	/**
	 * g-011：LINES 写回入口（功能 A「仅显示选中行」/ 功能 B「HIDE 转 LINES」共用）。
	 * 复用 HIDE 的整条安全管线：编辑器优先最小 diff replaceRange（保 Ctrl+Z）、vault 兜底、
	 * 全部分支 Notice + 结构化日志（LINES 通道用 [embed-code-file][g-011] 前缀）。
	 * clearHide=true 时同时删除该块的 HIDE 键行——两条新功能的最终语义都由 LINES 全权决定可见集合，
	 * 留着 HIDE 渲染期会再减一轮，语义就不对了。
	 * 增量 C（恢复语义）：hideSpec 显式给出时按该值写/删 HIDE（''=移除键行），与 LINES 改动
	 * 合并为**一次**全文最小 diff——单步 Ctrl+Z，而不是两次写回两步撤销。
	 */
	applyLinesValue(el: HTMLElement, linesSpec: string, clearHide: boolean, successMsg: string, hideSpec?: string) {
		this.applySectionWrite(el, { kind: 'lines', spec: linesSpec, clearHide, successMsg, hideSpec });
	}

	/**
	 * HIDE/LINES 两通道共用的写回管线（g-011 泛化自原 applyHideValue；HIDE 分支逐行保持原行为）。
	 * 事实来源优先级：编辑器 getValue() → vault.read/process；定位失败是唯一合法中止。
	 */
	private applySectionWrite(el: HTMLElement, req: { kind: 'hide'; spec: string; clearHide?: false; successMsg: string; hideSpec?: string } | { kind: 'lines'; spec: string; clearHide: boolean; successMsg: string; hideSpec?: string }) {
		const isLines = req.kind === 'lines';
		const clearHide = req.clearHide === true;
		const hideSpec = req.hideSpec !== undefined && req.hideSpec !== null ? req.hideSpec : undefined;
		const successMsg = req.successMsg;
		// HIDE 通道保持 g-009 的日志前缀（零回归）；LINES 通道按 g-011 纪律用新前缀
		const logTag = isLines ? '[embed-code-file][g-011] LINES 写入' : '[embed-code-file][g-009] HIDE 写入';
		const abortTag = isLines ? '[embed-code-file][g-011] 写回中止' : '[embed-code-file][g-009] 写回中止';
		const log = isLines ? this.buildLinesWriteLog(el, req.spec, clearHide, hideSpec) : this.buildWriteLog(el, req.spec);

		const ctx = this.embedSections.get(el);
		if (!ctx) {
			console.warn(abortTag, { ...log, branch: 'abort-no-context', abort: '找不到该块的渲染上下文' });
			new Notice(t('noticeCannotLocateSource'));
			return;
		}

		const info = ctx.getSectionInfo(el);
		log.sectionInfo = describeSectionInfo(info);
		log.infoRaw = info;
		if (!info) {
			// getSectionInfo 返回 null：不再当作中止依据（dev 版本常见），改用日志中记录的提示继续定位
			console.warn(abortTag, { ...log, branch: 'abort-no-section-info', abort: 'getSectionInfo 返回 null，无行号提示可定位' });
			new Notice(t('noticeCannotLocateSourceNoInfo'));
			return;
		}

		const file = this.resolveFileFor(ctx);
		const view = this.findMarkdownViewFor(file);
		const editor = view && view.editor ? view.editor : null;
		const pathKind: 'editor' | 'vault' = editor ? 'editor' : 'vault';
		const sourcePath = ctx.sourcePath ?? (file ? file.path : '');
		const hint = { start: info.lineStart, end: info.lineEnd };

		if (editor) {
			let fullText = '';
			try { fullText = editor.getValue() } catch (e) {
				console.warn(abortTag, { ...log, branch: 'abort-editor-getValue-threw', sourcePath, path: pathKind, abort: String(e) });
				new Notice(t('noticeWriteFailedEditorRead'));
				return;
			}
			// 两通道恰有一个产出计划；isLines 在本次调用内定型，显式分支才能拿到具体类型做 describe
			const planLines = isLines ? updateLinesInSection(fullText, req.spec, clearHide, hint, log.meta, hideSpec) : null;
			const planHide = isLines ? null : applyHideToFullText(fullText, req.spec, hint, log.meta);
			const plan = planLines ?? planHide;
			if (!plan) { return } // 不可达（两通道恰一产出计划）；仅为类型收窄
			log.path = pathKind;
			log.sourcePath = sourcePath;
			log.editorLineCount = editor.lastLine() + 1;
			log.fullText = describeText(fullText);
			describeInfoTextFlavor(log, info, fullText);
			log.fence = describeFence(plan, info.lineStart);
			if (planLines) { log.update = describeLinesUpdate(planLines) } else if (planHide) { log.update = describeUpdate(planHide) }
			if (!plan.ok) {
				console.warn(abortTag, { ...log, branch: 'abort-locate-failed', abort: plan.reason });
				new Notice(t('noticeWriteAbandoned', { reason: tReason(plan.reason) }));
				return;
			}
			if (!plan.changed) {
				// 幂等：内容已一致，不做任何写入（也不报「没有需要写入的改动」以外的错）
				console.log(logTag, { ...log, branch: 'noop-unchanged', result: 'unchanged' });
				new Notice(t('noticeNoChanges'));
				return;
			}
			const diff = computeMinimalDiff(fullText, plan.newText);
			const from = this.offsetToEditorPos(fullText, diff.prefix);
			const to = this.offsetToEditorPos(fullText, diff.oldSuffix);
			editor.replaceRange(plan.newText.slice(diff.prefix, diff.newSuffix), from, to);
			console.log(logTag, {
				...log, branch: 'editor-replaceRange-minimal-diff', result: 'ok',
				diff: { prefix: diff.prefix, oldSuffix: diff.oldSuffix, replacedChars: diff.oldSuffix - diff.prefix },
				from, to,
			});
			new Notice(successMsg);
			return;
		}

		if (!file) {
			console.warn(abortTag, { ...log, branch: 'abort-no-file', sourcePath, path: pathKind, abort: '找不到源文件（ctx.sourcePath 未命中 vault）' });
			new Notice(t('noticeWriteAbandoned', { reason: t('reasonSourceFileNotFound') }));
			return;
		}

		this.writeSectionToVault(log, file, req, hint, { logTag, abortTag })
			.catch((e) => {
				console.error(abortTag, { ...log, branch: 'abort-vault-write-threw', sourcePath, path: 'vault', error: String(e) });
				new Notice(t('noticeWriteFailed'));
			});
	}

	/** 非编辑器路径：vault.process（缺 API 时 read + modify）；g-011 起 HIDE/LINES 两通道共用，同样只按全文口径改键行。 */
	private async writeSectionToVault(
		log: any,
		file: TFile,
		req: { kind: 'hide' | 'lines'; spec: string; clearHide?: boolean; successMsg: string; hideSpec?: string },
		hint: { start: number; end: number },
		tags: { logTag: string; abortTag: string },
	): Promise<void> {
		const vaultAny = this.app.vault as any;
		const isLines = req.kind === 'lines';
		// 用可变状态对象承接回调里的结果（TS 无法追踪回调赋值，避免窄化成 never）
		const state: { text: string; plan: HideUpdatePlan | LinesUpdatePlan | null } = { text: '', plan: null };
		let planLines: LinesUpdatePlan | null = null;
		let planHide: HideUpdatePlan | null = null;

		const applyToFullText = (content: string): string => {
			state.text = content;
			if (isLines) {
				planLines = updateLinesInSection(content, req.spec, req.clearHide === true, hint, log.meta, req.hideSpec);
				state.plan = planLines;
			} else {
				planHide = applyHideToFullText(content, req.spec, hint, log.meta);
				state.plan = planHide;
			}
			if (!state.plan || !state.plan.ok) { return content }
			return state.plan.newText;
		};

		const useProcess = typeof vaultAny.process === 'function';
		if (useProcess) {
			await vaultAny.process(file, (content: string) => applyToFullText(content));
		} else {
			const content = await this.app.vault.read(file);
			const next = applyToFullText(content);
			if (state.plan && state.plan.changed) { await this.app.vault.modify(file, next) }
		}

		log.path = 'vault';
		log.sourcePath = file.path;
		log.fullText = describeText(state.text);
		describeInfoTextFlavor(log, log.infoRaw ?? null, state.text);
		if (state.plan) {
			log.fence = describeFence(state.plan, hint.start);
		}
		if (planLines) { log.update = describeLinesUpdate(planLines) } else if (planHide) { log.update = describeUpdate(planHide) }
		if (!state.plan || !state.plan.ok) {
			const abort = state.plan ? state.plan.reason : t('reasonCannotReadFile');
			console.warn(tags.abortTag, { ...log, branch: 'abort-locate-failed', abort });
			new Notice(t('noticeWriteAbandoned', { reason: tReason(abort) }));
			return;
		}
		if (!state.plan.changed) {
			console.log(tags.logTag, { ...log, branch: 'noop-unchanged', result: 'unchanged' });
			new Notice(t('noticeNoChanges'));
			return;
		}
		console.log(tags.logTag, {
			...log,
			branch: useProcess ? 'vault-process' : 'vault-read-modify',
			result: 'ok',
		});
		new Notice(req.successMsg);
	}

	/* ---------- g-009 调试日志（负责人明确要求把该问题的全部判断打进 console） ---------- */

	/** 构造一份可 grep 的日志骨架；调用方在各分支补 branch / abort / result。 */
	private buildWriteLog(el: HTMLElement, hideSpec: string): any {
		const rows = this.readEmbedRows(el);
		const currentHide = el.dataset.embedHideSpec || '';
		let parsedNow: string[] = [];
		try { parsedNow = parseHideSpec(currentHide, Number.MAX_SAFE_INTEGER).ranges.map((r) => (r.start === r.end ? String(r.start) : r.start + '-' + r.end)) } catch (e) { parsedNow = [] }
		return {
			hideSpec: String(hideSpec),
			hiddenNow: currentHide,
			hiddenNowRanges: parsedNow,
			rowCount: rows ? rows.length : -1,
			meta: {
				path: el.dataset.embedPath ?? '',
				lines: el.dataset.embedLines ?? '',
				hideSpec: currentHide,
				contentTail: el.dataset.embedTail ?? '',
			},
			infoRaw: null,
			sectionInfo: null,
			infoTextIsWholeFile: false,
			infoTextIsSectionSlice: false,
			editorLineCount: -1,
			fullText: null,
			fence: null,
			update: null,
		};
	}

	/** g-011：LINES 写回的日志骨架（与 buildWriteLog 同构，键值字段换成 LINES 语义）。 */
	private buildLinesWriteLog(el: HTMLElement, linesSpec: string, clearHide: boolean, hideSpec?: string): any {
		const rows = this.readEmbedRows(el);
		const linesNow = el.dataset.embedLines ?? '';
		const currentHide = el.dataset.embedHideSpec || '';
		return {
			linesSpec: String(linesSpec),
			linesNow,
			clearHide,
			hideSpec: hideSpec === undefined ? '(unchanged)' : String(hideSpec),
			hiddenNow: currentHide,
			rowCount: rows ? rows.length : -1,
			meta: {
				path: el.dataset.embedPath ?? '',
				lines: linesNow,
				hideSpec: currentHide,
				contentTail: el.dataset.embedTail ?? '',
			},
			infoRaw: null,
			sectionInfo: null,
			editorLineCount: -1,
			fullText: null,
			fence: null,
			update: null,
		};
	}

	/** 偏移 → 编辑器位置（最小 diff 写回用）。 */
	private offsetToEditorPos(text: string, offset: number): { line: number; ch: number } {
		const upto = text.slice(0, Math.max(0, Math.min(offset, text.length)));
		const nl = upto.lastIndexOf('\n');
		if (nl === -1) { return { line: 0, ch: upto.length } }
		return { line: upto.split('\n').length - 1, ch: upto.length - nl - 1 };
	}

	/** 渲染上下文 → 源文件（sourcePath 未命中时退回该块所在笔记）。 */
	private resolveFileFor(ctx: MarkdownPostProcessorContext): TFile | null {
		if (ctx && ctx.sourcePath) {
			const found = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			if (found instanceof TFile) { return found }
		}
		return null;
	}

	/** 找到该文件正在编辑中的 MarkdownView（不看「活跃」——活跃视图可能是别的笔记）。 */
	private findMarkdownViewFor(file: TFile | null): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active && (!file || active.file === file)) { return active }
		if (!file) { return active }
		let found: MarkdownView | null = null;
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			const view = leaf.view;
			if (!found && view instanceof MarkdownView && view.file === file) { found = view as MarkdownView }
		});
		return found;
	}

	/**
	 * g-005：为 embed 代码块追加行号列（代码块内部左侧、TITLE 标题条下方开始）。
	 * F-1：以渲染后 <code> 的 DOM 文本行为对齐基准（src 推导行数与 DOM 可能差 1 个
	 * 尾部空元素），仅接受可解释差异，否则放弃绘制；默认「不显示」不进入本路径（零回归）。
	 */
	addLineNumbers(el: HTMLElement, rows: EmbedLineRow[], mode: 'original' | 'new') {
		const codeElm = el.querySelector('pre > code')
		if (!codeElm) { return }
		const pre = codeElm.parentElement as HTMLPreElement;
		const code = codeElm as HTMLElement;

		const codeTextLines = (code.textContent ?? '').split('\n');
		const plan = buildLineGutterPlan(codeTextLines, rows, mode);
		if (!plan.ok) {
			console.warn('[embed-code-file] 行号列放弃绘制：' + plan.reason);
			return;
		}

		// g-011 增量 C：dots 模型行 ↔ 展开段 id 映射（与 cells 对齐；leading-blank 时整体后移一格），
		// 供行号格渲染展开/收起符号
		const segs = dotsSegmentsOfRows(rows, this.embedTotalLines(el));
		const lead = plan.reason === 'leading-blank' ? 1 : 0;
		const dotsFlags = plan.cells.map((cell, i) => {
			const rowIdx = i - lead;
			if (cell !== '' || rowIdx < 0 || rowIdx >= rows.length) { return '' }
			const seg = segs.find((s) => rowIdx >= s.startIndex && rowIdx <= s.endIndex);
			return seg ? dotsSegmentId(seg) : '';
		});

		this.insertLineGutterElement(pre, code, plan, dotsFlags);
	}

	/** 生成/刷新行号列节点（同 insertTitlePreElement 的防御式先移除模式）。 */
	insertLineGutterElement(pre: HTMLPreElement, code: HTMLElement, plan: LineGutterPlan, dotsFlags?: string[]) {
		pre.querySelectorAll('.embed-line-gutter').forEach((x) => x.remove());

		// F-4：绘制计划挂到 pre 上（与 gutter 生命周期解耦，重渲染后可重建）
		pre.dataset.lineGutterCells = plan.cells.join('\n');
		// g-011：cells→模型行的对齐偏移（leading-blank 时首个 cell 是空行）——展开符号反查模型行用
		pre.dataset.lineGutterLead = plan.reason === 'leading-blank' ? '1' : '0';
		// g-011 增量 C：dots 行的展开段 id（与 cells 逐位对齐；无 dots 时清掉，避免陈旧状态）
		if (dotsFlags && dotsFlags.some((f) => f !== '')) {
			pre.dataset.lineGutterDots = JSON.stringify(dotsFlags);
		} else {
			delete pre.dataset.lineGutterDots;
		}

		this.setupGutterObserver(pre);
		this.refreshLineGutter(pre);
	}

	/**
	 * F-6：刷新行号列——每个行号按**自己那一行的实测 top** 绝对定位，并把行号**字形**对齐到代码字形。
	 * 演进脉络（每一步都由负责人实测数据定位）：
	 * - F-1/F-2：内容高度算术判折行 + 放弃兜底 → 13px 固定偏移撞破半行容差 → 行号被整体移除。
	 * - F-3/F-4：克隆探针实测行距 + 视觉行数展开 → 探针 19.69px 与真实排版（22.5px）不符 → 仍漂移。
	 * - F-5：逐行实测 top + 绝对定位（方向正确），但残留三类缺陷（g-007 实机诊断定位）：
	 *   ①测量含「零宽 rect 属上一行」的污染；②行距取值错（45px 双倍行盒）；③把行号**盒顶**对齐到
	 *   行的**文本 rect 顶**——字形在盒内居中，于是低了一个半行距（22.5 行距下 3.65px，肉眼可见）。
	 * - F-6（本次）：①跳过零宽 rect + locate 边界改 `<`；②行距走三源取值链（清洗后实测中位差优先，
	 *   几何推算 (codeH−contentH)/(内容行数−1) 兜底——实机三块零误差命中 22.5）；③定位改「行盒顶」
	 *   = 文本 rect 顶 − 半行距，并叠加**字形级自校准**（行号文本 rect ↔ 代码行文本 rect）。
	 * 标题注入、主题切换、resize、字体加载（经 ResizeObserver）都会重入，逻辑保持幂等收敛。
	 */
	refreshLineGutter(pre: HTMLPreElement) {
		// g-009 增量：行号拖选进行中不要重建 span（会打断拖选）——登记待刷新，鼠标释放后补做
		if (this.gutterDrag) { this.pendingGutterRefresh.add(pre); return }

		const codeElm = pre.querySelector('code');
		if (!codeElm) { return }
		const code = codeElm as HTMLElement;

		const cellsText = pre.dataset.lineGutterCells;
		if (cellsText === undefined) { return }   // 该块未启用行号
		const cells = cellsText.split('\n');
		// g-011 增量 C：dots 行 ↔ 展开段 id（与 cells 逐位对齐）；展开态由块根元素的状态决定符号方向
		let dotsFlags: string[] = [];
		try { dotsFlags = pre.dataset.lineGutterDots ? JSON.parse(pre.dataset.lineGutterDots) as string[] : [] } catch (e) { dotsFlags = [] }
		const gutterEmbed = this.resolveEmbedFromNode(pre);
		const expandedIds = gutterEmbed ? this.expandedSegments.get(gutterEmbed) : null;
		// g-011 修复：展开段的收起符号定位（首幽灵行 = 段 start）；cells→模型行偏移经 dataset 对齐
		const leadHere = pre.dataset.lineGutterLead === '1' ? 1 : 0;
		const rowsForSymbols = gutterEmbed ? this.readEmbedRows(gutterEmbed) : null;
		const expandedStarts = (expandedIds && expandedIds.size && rowsForSymbols)
			? ghostStartNumsOfExpanded(rowsForSymbols, expandedIds)
			: null;
		// g-011 二次反馈：「▾首 + ▴末」括号式——末幽灵行（= 段 end）同样叠加符号
		const expandedEnds = (expandedIds && expandedIds.size && rowsForSymbols)
			? ghostEndNumsOfExpanded(rowsForSymbols, expandedIds)
			: null;

		this.applyLineGutterNoWrap(pre, code);

		let gutter = pre.querySelector('.embed-line-gutter') as HTMLElement | null;
		if (!gutter) {
			gutter = document.createElement('div');
			gutter.className = 'embed-line-gutter';
			pre.appendChild(gutter);
		} else {
			// 防御式：清理历史渲染遗留的重复节点
			pre.querySelectorAll('.embed-line-gutter').forEach((x) => { if (x !== gutter) { x.remove() } });
		}
		pre.classList.add('embed-has-line-numbers');
		// g-009 增量：行号列交互需要行模型反查源行号（模型未挂时点击不动作，绝不猜）
		const embed = this.resolveEmbedFromNode(pre);
		const modelJson = embed ? this.readEmbedRowsJson(embed) : null;
		if (modelJson) { gutter.dataset.gutterRows = modelJson }
		gutter.onmousedown = (e) => { this.onGutterMouseDown(gutter as HTMLElement, e) };

		const codeRect = code.getBoundingClientRect();
		const cs = getComputedStyle(code);
		const preCS = getComputedStyle(pre);

		// F-6：逐行实测（清洗零宽 rect）+ 字体内容盒高 + 内容行数 → 行距三源取值
		const measured = this.measureCodeLines(code, cells.length);
		const resolved = resolveLineTops(measured.tops);
		const contentH = measured.contentHeight;
		const geomPitch = geometricLinePitch(
			codeRect.height,
			parseFloat(cs.paddingTop) || 0,
			parseFloat(cs.paddingBottom) || 0,
			contentH,
			measured.contentLines,
		);
		const chosen = resolveLinePitch({
			measured: resolved ? resolved.pitch : 0,
			geometric: geomPitch,
			preComputed: parseFloat(preCS.lineHeight) || 0,
			codeComputed: parseFloat(cs.lineHeight) || 0,
			fontSize: parseFloat(cs.fontSize) || 0,
		});
		const pitch = chosen.pitch;
		// F-6 半行距：文本 rect 顶 = 行盒顶 + (行距 − 字体内容盒高)/2，
		// 故行号盒顶须落在行盒顶 = 文本 rect 顶 − 半行距（F-5 把盒顶直接对齐文本 rect 顶 → 偏低一个半行距）。
		const halfLeading = contentH > 0 && pitch > contentH ? (pitch - contentH) / 2 : 0;

		pre.dataset.lineGutterPitch = String(Math.round(pitch * 100) / 100);
		pre.dataset.lineGutterPitchSource = chosen.source;
		pre.dataset.lineGutterGeomPitch = String(Math.round(geomPitch * 100) / 100);
		pre.dataset.lineGutterContentH = String(Math.round(contentH * 100) / 100);

		// 容器与代码内容盒顶端对齐，高度取代码高度（子元素全部绝对定位，容器不参与流布局）
		gutter.style.top = (codeRect.top - pre.getBoundingClientRect().top) + 'px';
		gutter.style.height = codeRect.height + 'px';
		gutter.textContent = '';

		const spans: HTMLElement[] = [];
		const targets: number[] = [];
		for (let i = 0; i < cells.length; i++) {
			if (cells[i] === '') {
				// g-011 增量 C：省略行的行号格 → 展开符号（纯视图态）。符号不是 .embed-line-number，
				// 天然不进入行号拖选索引空间；mousedown 阻止默认避免触发行号拖选/文本选择。
				const segId = dotsFlags[i];
				if (segId && gutterEmbed) {
					const isExpanded = !!expandedIds && expandedIds.has(segId);
					const toggle = document.createElement('span');
					toggle.className = 'embed-expand-toggle';
					toggle.textContent = isExpanded ? '▾' : '▸';
					toggle.title = isExpanded ? t('collapseDotsTitle') : t('expandDotsTitle');
					toggle.dataset.dotsSegment = segId;
					// 与行号 span 同一坐标系（F-5/F-6：逐行实测 top 绝对定位 + 半行距修正）
					const targetTop = resolved ? resolved.tops[i] : (codeRect.top + i * pitch);
					toggle.style.fontFamily = cs.fontFamily;
					toggle.style.fontSize = cs.fontSize;
					toggle.style.lineHeight = pitch + 'px';
					toggle.style.top = (targetTop - codeRect.top - halfLeading) + 'px';
					toggle.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() });
					toggle.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						const embed = this.resolveEmbedFromNode(gutter);
						if (!embed) { return }
						this.toggleDotsSegment(embed, segId);
					});
					gutter.appendChild(toggle);
					continue;
				}
				continue;   // 省略行：不编号、不占号、不绘制
			}
			// g-011 修复：展开段首/末幽灵行 → 行号格左侧叠加 ▾/▴（点击都收起该段）。行号 span 照常创建：
			// spans 索引空间是拖选映射的权威（gutterSpanSourceLineNums 按「非 dot 模型行」顺序对齐），
			// 用叠加而不是替换行号，拖选/恢复选区的映射完全不受影响。
			const rowIdxSym = i - leadHere;
			let ghostSeg: { id: string; ch: string } | null = null;
			if (expandedStarts && expandedEnds && rowIdxSym >= 0 && rowsForSymbols && rowIdxSym < rowsForSymbols.length && !rowsForSymbols[rowIdxSym].dot) {
				const rowNum = rowsForSymbols[rowIdxSym].num;
				// 单行展开段 start==end：同一行只挂一个符号（首符号优先），不叠加
				const sid = expandedStarts.get(rowNum);
				const eid = expandedEnds.get(rowNum);
				if (sid) { ghostSeg = { id: sid, ch: '▾' } } else if (eid) { ghostSeg = { id: eid, ch: '▴' } }
			}
			if (ghostSeg) {
				const collapseSeg = ghostSeg;   // 闭包捕获 const（TS 不窄化闭包内的 let）
				const collapse = document.createElement('span');
				collapse.className = 'embed-expand-toggle is-expanded';
				collapse.textContent = collapseSeg.ch;
				collapse.title = t('collapseGhostTitle');
				collapse.setAttribute('aria-label', t('collapseGhostTitle'));
				collapse.dataset.dotsSegment = collapseSeg.id;
				const ghostTop = resolved ? resolved.tops[i] : (codeRect.top + i * pitch);
				collapse.style.fontFamily = cs.fontFamily;
				collapse.style.fontSize = cs.fontSize;
				collapse.style.lineHeight = pitch + 'px';
				collapse.style.top = (ghostTop - codeRect.top - halfLeading) + 'px';
				collapse.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() });
				collapse.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					const embedG = this.resolveEmbedFromNode(gutter);
					if (!embedG) { return }
					this.toggleDotsSegment(embedG, collapseSeg.id);
				});
				gutter.appendChild(collapse);
			}
			const targetTop = resolved ? resolved.tops[i] : (codeRect.top + i * pitch);
			const span = document.createElement('span');
			span.className = 'embed-line-number';
			span.textContent = cells[i];
			span.style.fontFamily = cs.fontFamily;
			span.style.fontSize = cs.fontSize;
			span.style.lineHeight = pitch + 'px';
			span.style.top = (targetTop - codeRect.top - halfLeading) + 'px';
			gutter.appendChild(span);
			spans.push(span);
			targets.push(targetTop);
		}

		// F-6 字形级自校准：测「行号自身文本 rect 顶 ↔ 该代码行文本 rect 顶」的偏差并全体补偿。
		// F-5 的旧自校准测的是我们自己写进去的盒顶（恒为 0，空转），从未校准过字形位置。
		let glyphDelta = 0;
		if (spans.length) {
			const d = this.measureGlyphDelta(spans[0], targets[0]);
			if (isFinite(d) && Math.abs(d) > 0.05) {
				glyphDelta = d;
				for (const span of spans) {
					const cur = parseFloat(span.style.top);
					if (isFinite(cur)) { span.style.top = (cur - d) + 'px' }
				}
			}
		}
		pre.dataset.lineGutterGlyphDelta = String(Math.round(glyphDelta * 100) / 100);

		// g-009：行号列尺寸变化会挤动块内布局 → 顺带重算「显示全部」按钮的避让位置
		const embedEl = this.resolveEmbedFromNode(pre);
		if (embedEl) { this.applyHideAllButtonPosition(embedEl) }
	}

	/**
	 * F-6：测量行号 span 的**字形顶**（其文本 rect 顶）相对目标代码行文本 rect 顶的偏差（px）。
	 * 这是唯一能反映「肉眼看到的行号与代码行是否齐平」的量（F-5 的盒顶比对是恒等式，无意义）。
	 */
	measureGlyphDelta(span: HTMLElement, codeLineTop: number): number {
		try {
			const range = document.createRange();
			range.selectNodeContents(span);
			const rect = pickFirstPositiveRect(range.getClientRects());
			if (rect) { return rect.top - codeLineTop }
		} catch (e) {
			// 无法测量时不做补偿（半行距公式已提供一阶精度）
		}
		return 0;
	}

	/**
	 * F-6：逐逻辑行测量该行**首视觉行**的 top（px，文档坐标），并返回字体内容盒高与内容行数。
	 * 相对 F-5 修掉两处缺陷（均由负责人实机数据定位）：
	 * 1) `locate` 边界改为 `<`：位置恰落在文本节点末尾（上一行 '\n' 的结尾）时，前进到下一节点起点
	 *    （同一文档位置，但 Range 不再把上一行换行符纳入）；
	 * 2) 取 rect 时**跳过宽度为 0 的 rect**（同症状的第二道防线，见 pickFirstPositiveRect）。
	 * 实机症状：blk0 第 2 行首个 rect = {top: 96.22, width: 0}（上一行的 top），真实文本在 118.72；
	 * 污染还会让相邻差出现 0/45，把中位行距抬成 45px（真实 22.5），行号被画进双倍高的行盒。
	 */
	measureCodeLines(code: HTMLElement, lineCount: number): { tops: (number | null)[]; contentHeight: number; contentLines: number } {
		const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		let text = '';
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			nodes.push(node);
			text += node.data;
		}
		const tops = new Array<number | null>(lineCount).fill(null);
		const parts = text.split('\n');
		const contentLines = contentLineCount(text);
		let contentHeight = 0;
		if (!nodes.length) { return { tops, contentHeight, contentLines } }

		const locate = (pos: number): { node: Text; offset: number } | null => {
			let acc = 0;
			for (let k = 0; k < nodes.length; k++) {
				const node = nodes[k];
				if (pos < acc + node.data.length) { return { node, offset: pos - acc } }
				if (pos === acc + node.data.length) {
					// F-6：边界位置前进到下一文本节点起点，避免 Range 把上一行的 '\n' 纳入
					const next = nodes[k + 1];
					return next ? { node: next, offset: 0 } : { node, offset: node.data.length };
				}
				acc += node.data.length;
			}
			return null;
		};

		const range = document.createRange();
		let pos = 0;
		for (let i = 0; i < lineCount && i < parts.length; i++) {
			const nl = text.indexOf('\n', pos);
			const end = nl === -1 ? text.length : nl;
			if (end > pos) {
				const a = locate(pos);
				const b = locate(end);
				if (a && b) {
					try {
						range.setStart(a.node, a.offset);
						range.setEnd(b.node, b.offset);
						const rect = pickFirstPositiveRect(range.getClientRects());
						if (rect) {
							tops[i] = rect.top;
							if (contentHeight <= 0) { contentHeight = rect.height }
						}
					} catch (e) {
						// 保守：保持 null（由相邻已知行外推补全）
					}
				}
			}
			pos = nl === -1 ? text.length : nl + 1;
		}
		return { tops, contentHeight, contentLines };
	}

	/** F-3：内联 important 强制禁折行——内联 important 优先于任何作者样式表的 important。 */
	applyLineGutterNoWrap(pre: HTMLElement, code: HTMLElement) {
		pre.style.setProperty('white-space', 'pre', 'important');
		pre.style.setProperty('overflow-x', 'auto', 'important');
		code.style.setProperty('white-space', 'pre', 'important');
		code.style.setProperty('overflow-wrap', 'normal', 'important');
		code.style.setProperty('word-break', 'normal', 'important');
	}

	/** F-1：监听 pre/code 尺寸变化（主题切换、窗口 resize、字体加载都会体现为尺寸变化）刷新行号列。 */
	setupGutterObserver(pre: HTMLPreElement) {
		if (typeof ResizeObserver === 'undefined') { return }
		if (this.gutterObservers.has(pre)) { return }
		const observer = new ResizeObserver(() => { this.refreshLineGutter(pre); });
		observer.observe(pre);
		const code = pre.querySelector('code');
		if (code) { observer.observe(code); }
		this.gutterObservers.set(pre, observer);
	}

	private gutterObservers = new WeakMap<object, ResizeObserver>();

	addTitle(el: HTMLElement, context: MarkdownPostProcessorContext) {
		// add some commecnt 
		let codeElm = el.querySelector('pre > code')
		if (!codeElm) {
			return
		}

		const pre = codeElm.parentElement as HTMLPreElement;

		const codeSection = context.getSectionInfo(pre)
		if (!codeSection) {
			return
		}

		const view = app.workspace.getActiveViewOfType(MarkdownView)
		if (!view) {
			return
		}

		const num = codeSection.lineStart
		const codeBlockFirstLine = view.editor.getLine(num)

		let matchTitle = codeBlockFirstLine.match(/TITLE:\s*"([^"]*)"/i)
		if (matchTitle == null) {
			return
		}

		const title = matchTitle[1]
		if (title == "") {
			return
		}

		this.insertTitlePreElement(pre, title)
	}

	insertTitlePreElement(pre: HTMLPreElement, title: string) {
		pre
		.querySelectorAll(".obsidian-embed-code-file")
		.forEach((x) => x.remove());

		let titleElement = document.createElement("pre");
		titleElement.appendText(title);
		titleElement.className = "obsidian-embed-code-file";
		titleElement.style.color = this.settings.titleFontColor;
		titleElement.style.backgroundColor = this.settings.titleBackgroundColor;
		pre.prepend(titleElement);

		// g-005：标题插入会改变正文起始纵向位置，已有行号列时刷新定位
		// （阅读视图/ live preview 的标题注入先后两种顺序均由此覆盖）
		this.refreshLineGutter(pre)
		// g-009：标题条会挤动核心按钮，顺带重算「显示全部」按钮的位置
		const embedEl = this.resolveEmbedFromNode(pre);
		if (embedEl) { this.applyHideAllButtonPosition(embedEl) }
	}
}
