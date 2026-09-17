import { Plugin, MarkdownRenderer, TFile, MarkdownPostProcessorContext, MarkdownView, parseYaml, requestUrl} from 'obsidian';
import { EmbedCodeFileSettings, EmbedCodeFileSettingTab, DEFAULT_SETTINGS, LineNumberMode} from "./settings";
import { analyseSrcLines, extractSrcLines, buildEmbedLineRows, buildFullFileRows, buildLineGutterPlan, resolveLineTops, contentLineCount, pickFirstPositiveRect, geometricLinePitch, resolveLinePitch, EmbedLineRow, LineGutterPlan} from "./utils";
import { AddEmbedCodeModal } from "./add-embed-modal";

export default class EmbedCodeFile extends Plugin {
	settings: EmbedCodeFileSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new EmbedCodeFileSettingTab(this.app, this));

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

			if (srcLinesNum.length == 0) {
				src = fullSrc
			} else {
				src = extractSrcLines(fullSrc, srcLinesNum)
			}

			let title = metaYaml.TITLE
			if (!title) {
				title = srcPath
			}

			await MarkdownRenderer.renderMarkdown('```' + lang + '\n' + src + '\n```', el, '', this)
			if (lineRows && activeLineNumberMode) {
				// 单点覆盖阅读视图与 live preview（两视图都经本 code-block processor 渲染）
				this.addLineNumbers(el, lineRows, activeLineNumberMode)
			}
			this.addTitleLivePreview(el, title);
		});
	}

	addTitleLivePreview(el: HTMLElement, title: string) {
		const codeElm = el.querySelector('pre > code')
		if (!codeElm) { return }
		const pre = codeElm.parentElement as HTMLPreElement;

		this.insertTitlePreElement(pre, title)
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
	}
}
