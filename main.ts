import { Plugin, MarkdownRenderer, TFile, MarkdownPostProcessorContext, MarkdownView, Notice, Editor, parseYaml, requestUrl} from 'obsidian';
import { EmbedCodeFileSettings, EmbedCodeFileSettingTab, DEFAULT_SETTINGS, LineNumberMode} from "./settings";
import { analyseSrcLines, extractSrcLines, buildEmbedLineRows, buildFullFileRows, buildLineGutterPlan, resolveLineTops, contentLineCount, pickFirstPositiveRect, geometricLinePitch, resolveLinePitch, EmbedLineRow, LineGutterPlan, LineRangeSet, normalizeLineRanges, applyHideToRows, hasVisibleCodeRow, rowsToSourceLineRanges, subtractLineRanges, rangesToSpec, parseHideSpec, lineStartOffsets, selectionRowRange, collectSourceLineNums, lineNumsToRanges, updateHideInSection, EmbedHideSpec, EmbedSelectionRows, gutterSpanSourceLineNums, gutterSpanRangeToSourceLineNums, clampGutterSpanRange, applyHideToFullText, computeMinimalDiff, contentTailOf, describeText, describeSectionInfo, describeInfoTextFlavor, describeFence, describeUpdate, computeHideAllButtonRight, DEFAULT_CORE_BUTTON_SELECTORS, buildVisibleRowsForHide } from "./utils";
import { AddEmbedCodeModal } from "./add-embed-modal";

export default class EmbedCodeFile extends Plugin {
	settings: EmbedCodeFileSettings;

	async onload() {
		await this.loadSettings();

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
						.setTitle('Add embed-code')
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
				await MarkdownRenderer.renderMarkdown("`ERROR: invalid embedding (invalid YAML)`", el, '', this)
				return
			}

			let srcPath = metaYaml.PATH
			if (!srcPath) {
				await MarkdownRenderer.renderMarkdown("`ERROR: invalid source path`", el, '', this)
				return
			}

			if (srcPath.startsWith("https://") || srcPath.startsWith("http://")) {
				try {
					let httpResp = await requestUrl({url: srcPath, method: "GET"})
					fullSrc = httpResp.text
				} catch(e) {
					const errMsg = `\`ERROR: could't fetch '${srcPath}'\``
					await MarkdownRenderer.renderMarkdown(errMsg, el, '', this)
					return
				}
			} else if (srcPath.startsWith("vault://")) {
				srcPath = srcPath.replace(/^(vault:\/\/)/,'');

				const tFile = app.vault.getAbstractFileByPath(srcPath)
				if (tFile instanceof TFile) {
					fullSrc = await app.vault.read(tFile)
				} else {
					const errMsg = `\`ERROR: could't read file '${srcPath}'\``
					await MarkdownRenderer.renderMarkdown(errMsg, el, '', this)
					return
				}
			} else {
				const errMsg = "`ERROR: invalid source path, use 'vault://...' or 'http[s]://...'`"
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

			// 行号显示（g-005）：默认 none 不建模型=与旧版渲染产物完全一致（零回归）。
			// 行号模型必须在 extractSrcLines 之前、对同一初始数组构建（buildEmbedLineRows
			// 内部在副本上重放同样的遍历），正文与行号列才能严格逐行对齐。
			const lineNumberMode: LineNumberMode = this.settings.lineNumbers
			let lineRows: EmbedLineRow[] | null = null
			let activeLineNumberMode: 'original' | 'new' | null = null
			if (lineNumberMode !== 'none') {
				activeLineNumberMode = lineNumberMode
				lineRows = srcLinesNum.length > 0
					? buildEmbedLineRows(fullSrc, srcLinesNum)
					: buildFullFileRows(fullSrc)
			}

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

			if (srcLinesNum.length == 0) {
				src = fullSrc
			} else {
				src = extractSrcLines(fullSrc, srcLinesNum)
			}
			if (renderRows) {
				// 行模型 ⟺ 渲染行文本：用行模型（源行号）重建正文，HIDE 与既有 `...` 同源
				src = renderRows.map((r) => (r.dot ? '...' : (srcLines[r.num - 1] ?? ''))).join('\n')
				if (lineRows) {
					// 行号列与正文逐行对齐：行号模型必须**由同一份渲染模型派生**（行数一致）
					lineRows = renderRows.slice()
				}
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
			if (lineRows && activeLineNumberMode) {
				// 单点覆盖阅读视图与 live preview（两视图都经本 code-block processor 渲染）
				this.addLineNumbers(el, lineRows, activeLineNumberMode)
			}
			this.addTitleLivePreview(el, title);
			this.refreshHideAllButton(el);

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
	private hideFloatTarget: HTMLElement | null = null;
	private hideUiDisposers: (() => void)[] = [];
	/** g-009 增量：行号列拖选态（单击=起点=终点；拖选=起点..当前） */
	private gutterDrag: { gutter: HTMLElement; el: HTMLElement; spans: HTMLElement[]; start: number; end: number } | null = null;
	/** 拖选期间被抑制的行号列刷新（鼠标释放后补做，避免拖到一半 DOM 被换掉） */
	private pendingGutterRefresh = new Set<HTMLPreElement>();

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
			name: '隐藏选中的代码行（embed 块内选区，写入 HIDE）',
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
			name: '显示全部（清除隐藏）',
			checkCallback: (checking: boolean) => {
				const embed = this.resolveEmbedFromEditor();
				if (!embed) { return false }
				if (!checking) { this.clearHiddenLinesFromResolved(embed) }
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
					.setTitle('隐藏选中的代码行')
					.setIcon('eye-off')
					.onClick(() => { this.hideSelectedLines(embed.el) }));
				menu.addItem((item) => item
					.setTitle('显示全部（清除隐藏）')
					.setIcon('eye')
					.setDisabled(!hasHidden)
					.onClick(() => { this.clearHiddenLinesFromResolved(embed) }));
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
			new Notice('请在 embed 代码块内选中要隐藏的代码行，再执行此命令');
			return;
		}
		this.hideSelectionFromResolved(info);
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
	}

	/**
	 * 浮出「隐藏选中行」按钮。
	 * - 代码选区路径：不给 anchor，按 window.getSelection() 定位（既有行为不变）；
	 * - 行号列拖选路径：给 anchor（被拖选行号的包围盒），因为此时浏览器选区在 gutter 上，
	 *   用 getSelection() 定位会跑偏。
	 */
	private showHideFloatButton(embed: HTMLElement, count: number, anchor?: DOMRect | null, onClick?: () => void) {
		this.removeHideFloatButton();
		const btn = document.createElement('button');
		btn.className = 'embed-hide-float';
		btn.setText(count > 1 ? `隐藏选中 ${count} 行` : '隐藏选中行');
		btn.title = '把选中的源行号写入该 embed 块的 HIDE';
		btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() }, true);
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.removeHideFloatButton();
			if (onClick) { onClick(); return }
			const info = this.resolveSelectionHide();
			if (!info) { new Notice('未找到有效选区（请在 embed 代码块内选中整行代码）'); return }
			this.hideSelectionFromResolved(info);
		});
		document.body.appendChild(btn);
		this.hideFloatBtn = btn;
		this.hideFloatTarget = embed;
		this.positionHideFloatButton(embed, anchor);
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
	}

	private removeHideFloatButton() {
		if (this.hideFloatBtn) { this.hideFloatBtn.remove() }
		this.hideFloatBtn = null;
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

		// 单击（起点=终点）→ 立即隐藏该行，无二次确认
		if (lo === hi) {
			const num = this.gutterSourceLineNumForSpan(el, lo);
			if (num === null) { new Notice('该行号已不可用（块可能已重新渲染），请重试'); return }
			this.hideLinesFromGutter(el, [num]);
			return;
		}

		// 拖选多行 → 浮出确认按钮（按住 Ctrl/Cmd 则按下即隐藏，便于连续操作）
		const nums = gutterSpanRangeToSourceLineNums(this.readEmbedRows(el) ?? [], lo, hi);
		if (!nums.length) { new Notice('没有可隐藏的代码行'); return }
		if (e.ctrlKey || e.metaKey) { this.hideLinesFromGutter(el, nums); return }
		const anchor = this.gutterSpansRect(spans, lo, hi);
		this.showHideFloatButton(el, nums.length, anchor, () => {
			const fresh = this.gutterSpanRangeFromLiveGutter(gutter, lo, hi);
			this.hideLinesFromGutter(el, fresh.length ? fresh : nums);
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
		if (!rows || !rows.length) { new Notice('无法读取该块的行模型（请重新打开笔记再试）'); return }
		if (!nums.length) { new Notice('没有可隐藏的代码行'); return }
		const hiddenNow = parseHideSpec(el.dataset.embedHideSpec || '', Number.MAX_SAFE_INTEGER);
		const merged = normalizeLineRanges([...hiddenNow.ranges, ...lineNumsToRanges(nums)], Number.MAX_SAFE_INTEGER);
		const remaining = applyHideToRows(rows, merged);
		const newly = remaining.hiddenNums.filter((n) => !hiddenNow.ranges.some((r) => n >= r.start && n <= r.end));
		if (!newly.length) { new Notice('这些行已经隐藏了'); return }
		if (!hasVisibleCodeRow(remaining.rows)) {
			new Notice('不能隐藏全部代码行（会产生空块）；请至少保留一行');
			return;
		}
		const msg = newly.length === 1 ? `已隐藏第 ${newly[0]} 行` : `已隐藏 ${newly.length} 行`;
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
		if (!resolved || !resolved.el) { new Notice('未找到有效选区（请在 embed 代码块内选中整行代码）'); return }
		const { el, nums } = resolved;
		if (!nums.length) { new Notice('选区只覆盖了省略行（...），没有可隐藏的代码行'); return }
		this.hideLinesFromGutter(el, nums);
	}

	clearHiddenLinesFromResolved(resolved: { el: HTMLElement } | null) {
		if (!resolved) { new Notice('未找到 embed 代码块（请把光标放进块内或先选中代码）'); return }
		if (!(resolved.el.dataset.embedHideSpec || '').trim()) { new Notice('该 embed 块当前没有隐藏行'); return }
		this.applyHideValue(resolved.el, '', '已显示全部行（清除 HIDE）');
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
			btn.title = '清除该块的 HIDE';
			btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() });
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.applyHideValue(el, '', '已显示全部行（清除 HIDE）');
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
		btn.setText(`显示全部（${hiddenCount} 行已隐藏）`);
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
	 * 写回入口。事实来源优先级：① 该文件正在 MarkdownView 编辑器中打开 → `editor.getValue()`
	 * （这就是用户此刻看到的全文，也是唯一可信的当前状态）；② 否则 `vault.read`（process 路径在
	 * 其回调里拿同一份全文）。
	 * 渲染期的 `info.text` **只用于日志与提示**，不再作为中止依据（旧实现把它当节区文本却又按整文件
	 * 切片使用，导致「代码块不覆盖整个文件」时恒真中止）。
	 */
	applyHideValue(el: HTMLElement, hideSpec: string, successMsg: string) {
		const log = this.buildWriteLog(el, hideSpec);
		const ctx = this.embedSections.get(el);
		if (!ctx) {
			console.warn('[embed-code-file][g-009] 写回中止', { ...log, branch: 'abort-no-context', abort: '找不到该块的渲染上下文' });
			new Notice('无法定位该 embed 块的源位置（请重新打开笔记再试）');
			return;
		}

		const info = ctx.getSectionInfo(el);
		log.sectionInfo = describeSectionInfo(info);
		log.infoRaw = info;
		if (!info) {
			// getSectionInfo 返回 null：不再当作中止依据（dev 版本常见），改用日志中记录的提示继续定位
			console.warn('[embed-code-file][g-009] 写回中止', { ...log, branch: 'abort-no-section-info', abort: 'getSectionInfo 返回 null，无行号提示可定位' });
			new Notice('无法定位该 embed 块的源位置（getSectionInfo 返回空），已放弃写入');
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
				console.warn('[embed-code-file][g-009] 写回中止', { ...log, branch: 'abort-editor-getValue-threw', sourcePath, path: pathKind, abort: String(e) });
				new Notice('写回失败：读取编辑器内容异常，详见控制台');
				return;
			}
			const plan = applyHideToFullText(fullText, hideSpec, hint, log.meta);
			log.path = pathKind;
			log.sourcePath = sourcePath;
			log.editorLineCount = editor.lastLine() + 1;
			log.fullText = describeText(fullText);
			describeInfoTextFlavor(log, info, fullText);
			log.fence = describeFence(plan, info.lineStart);
			log.update = describeUpdate(plan);
			if (!plan.ok) {
				console.warn('[embed-code-file][g-009] 写回中止', { ...log, branch: 'abort-locate-failed', abort: plan.reason });
				new Notice('已放弃写入：' + plan.reason);
				return;
			}
			if (!plan.changed) {
				// 幂等：内容已一致，不做任何写入（也不报「没有需要写入的改动」以外的错）
				console.log('[embed-code-file][g-009] HIDE 写入', { ...log, branch: 'noop-unchanged', result: 'unchanged' });
				new Notice('没有需要写入的改动');
				return;
			}
			const diff = computeMinimalDiff(fullText, plan.newText);
			const from = this.offsetToEditorPos(fullText, diff.prefix);
			const to = this.offsetToEditorPos(fullText, diff.oldSuffix);
			editor.replaceRange(plan.newText.slice(diff.prefix, diff.newSuffix), from, to);
			console.log('[embed-code-file][g-009] HIDE 写入', {
				...log, branch: 'editor-replaceRange-minimal-diff', result: 'ok',
				diff: { prefix: diff.prefix, oldSuffix: diff.oldSuffix, replacedChars: diff.oldSuffix - diff.prefix },
				from, to,
			});
			new Notice(successMsg);
			return;
		}

		if (!file) {
			console.warn('[embed-code-file][g-009] 写回中止', { ...log, branch: 'abort-no-file', sourcePath, path: pathKind, abort: '找不到源文件（ctx.sourcePath 未命中 vault）' });
			new Notice('已放弃写入：找不到源文件');
			return;
		}

		this.writeHideToVault(log, file, hideSpec, hint, successMsg)
			.catch((e) => {
				console.error('[embed-code-file][g-009] 写回失败', { ...log, branch: 'abort-vault-write-threw', sourcePath, path: 'vault', error: String(e) });
				new Notice('写回失败，详见控制台');
			});
	}

	/** 非编辑器路径：vault.process（缺 API 时 read + modify），同样只按全文口径改 HIDE 一行。 */
	private async writeHideToVault(log: any, file: TFile, hideSpec: string, hint: { start: number; end: number }, successMsg: string): Promise<void> {
		const vaultAny = this.app.vault as any;
		// 用可变状态对象承接回调里的结果（TS 无法追踪回调赋值，避免窄化成 never）
		const state: { text: string; plan: ReturnType<typeof applyHideToFullText> | null } = { text: '', plan: null };

		const applyToFullText = (content: string): string => {
			state.text = content;
			const plan = applyHideToFullText(content, hideSpec, hint, log.meta);
			state.plan = plan;
			if (!plan.ok) { return content }
			return plan.newText;
		};

		const useProcess = typeof vaultAny.process === 'function';
		if (useProcess) {
			await vaultAny.process(file, (content: string) => applyToFullText(content));
		} else {
			const content = await this.app.vault.read(file);
			const next = applyToFullText(content);
			if (state.plan && state.plan.changed) { await this.app.vault.modify(file, next) }
		}

		const plan = state.plan;
		log.path = 'vault';
		log.sourcePath = file.path;
		log.fullText = describeText(state.text);
		describeInfoTextFlavor(log, log.infoRaw ?? null, state.text);
		if (plan) {
			log.fence = describeFence(plan, hint.start);
			log.update = describeUpdate(plan);
		}
		if (!plan || !plan.ok) {
			const abort = plan ? plan.reason : '无法读取文件内容';
			console.warn('[embed-code-file][g-009] 写回中止', { ...log, branch: 'abort-locate-failed', abort });
			new Notice('已放弃写入：' + abort);
			return;
		}
		if (!plan.changed) {
			console.log('[embed-code-file][g-009] HIDE 写入', { ...log, branch: 'noop-unchanged', result: 'unchanged' });
			new Notice('没有需要写入的改动');
			return;
		}
		console.log('[embed-code-file][g-009] HIDE 写入', {
			...log,
			branch: useProcess ? 'vault-process' : 'vault-read-modify',
			result: 'ok',
		});
		new Notice(successMsg);
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

		this.insertLineGutterElement(pre, code, plan);
	}

	/** 生成/刷新行号列节点（同 insertTitlePreElement 的防御式先移除模式）。 */
	insertLineGutterElement(pre: HTMLPreElement, code: HTMLElement, plan: LineGutterPlan) {
		pre.querySelectorAll('.embed-line-gutter').forEach((x) => x.remove());

		// F-4：绘制计划挂到 pre 上（与 gutter 生命周期解耦，重渲染后可重建）
		pre.dataset.lineGutterCells = plan.cells.join('\n');

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
			if (cells[i] === '') { continue }   // 省略行：不编号、不占号、不绘制
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
