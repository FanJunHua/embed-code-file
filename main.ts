import { Plugin, MarkdownRenderer, TFile, MarkdownPostProcessorContext, MarkdownView, parseYaml, requestUrl} from 'obsidian';
import { EmbedCodeFileSettings, EmbedCodeFileSettingTab, DEFAULT_SETTINGS, LineNumberMode} from "./settings";
import { analyseSrcLines, extractSrcLines, buildEmbedLineRows, buildFullFileRows, buildLineGutterPlan, resolveLineTops, EmbedLineRow, LineGutterPlan} from "./utils";
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
	 * F-5：刷新行号列——**每个行号按它自己那一行的实测 top 绝对定位**。
	 * 演进脉络（每一步都由负责人实测数据定位）：
	 * - F-1/F-2：用「内容高度算术」判折行 + 放弃绘制兜底 → 实测脆弱（13px 固定偏移 vs 半行
	 *   容差 10.5px → 误判折行 → 行号被整体移除，连续 3 次后停手）。
	 * - F-3/F-4：改为克隆探针实测行距 + 逐行视觉行数展开 → 行号能显示，但负责人第五轮指出
	 *   「行号之间的间隔与代码行之间的间隔不一致」：探针测得 19.69px 与代码真实排版不符——
	 *   **任何统一行距假设都会随时间累积漂移**。
	 * - F-5：彻底放弃统一行距。用 Range 逐逻辑行测出该行首视觉行的 top，每个行号以绝对定位
	 *   贴到自己那一行上；行距由代码自身排版决定，物理上不可能漂移。空行无 rect，由相邻已知
	 *   top ± 中位行距外推补全；折行时行号贴首视觉行（续行不占号）依然正确。
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
		const fallbackPitch = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.5) || 21;

		const resolved = resolveLineTops(this.measureLineTops(code, cells.length));
		const pitch = resolved && resolved.pitch > 0 ? resolved.pitch : fallbackPitch;

		// 容器与代码内容盒顶端对齐，高度取代码高度（子元素全部绝对定位，容器不参与流布局）
		gutter.style.top = (codeRect.top - pre.getBoundingClientRect().top) + 'px';
		gutter.style.height = codeRect.height + 'px';
		gutter.textContent = '';

		// F-5 自校准：首个行号落位后实测其盒顶相对目标 top 的偏差（字体半行距等），
		// 全体行号按同一修正量上移——保证行号与代码行的内容盒严格对齐。
		let correction = 0;
		let calibrated = false;
		for (let i = 0; i < cells.length; i++) {
			if (cells[i] === '') { continue }   // 省略行：不编号、不占号、不绘制
			const targetTop = resolved ? resolved.tops[i] : (codeRect.top + i * pitch);
			const span = document.createElement('span');
			span.className = 'embed-line-number';
			span.textContent = cells[i];
			span.style.fontFamily = cs.fontFamily;
			span.style.fontSize = cs.fontSize;
			span.style.lineHeight = pitch + 'px';
			span.style.top = (targetTop - codeRect.top - correction) + 'px';
			gutter.appendChild(span);
			if (!calibrated) {
				correction = span.getBoundingClientRect().top - targetTop;
				if (Math.abs(correction) > 0.05) {
					span.style.top = (targetTop - codeRect.top - correction) + 'px';
				}
				calibrated = true;
			}
		}
	}

	/**
	 * F-5：逐逻辑行测量该行**首视觉行**的 top（px，文档坐标）；空行/测量失败返回 null。
	 * 与 F-4 的「视觉行数」不同，这里要的是每行自身的纵坐标——行号据此绝对定位，
	 * 行距完全由代码实际排版决定（不再有统一 pitch 假设，也就不会累积漂移）。
	 */
	measureLineTops(code: HTMLElement, lineCount: number): (number | null)[] {
		const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		let text = '';
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			nodes.push(node);
			text += node.data;
		}
		const tops = new Array<number | null>(lineCount).fill(null);
		if (!nodes.length) { return tops }

		const locate = (pos: number): { node: Text; offset: number } | null => {
			let acc = 0;
			for (const node of nodes) {
				if (pos <= acc + node.data.length) { return { node, offset: pos - acc } }
				acc += node.data.length;
			}
			return null;
		};

		const range = document.createRange();
		const totalLines = text.split('\n').length;
		let pos = 0;
		for (let i = 0; i < lineCount && i < totalLines; i++) {
			const nl = text.indexOf('\n', pos);
			const end = nl === -1 ? text.length : nl;
			if (end > pos) {
				const a = locate(pos);
				const b = locate(end);
				if (a && b) {
					try {
						range.setStart(a.node, a.offset);
						range.setEnd(b.node, b.offset);
						const rects = range.getClientRects();
						if (rects.length > 0) { tops[i] = rects[0].top }
					} catch (e) {
						// 保守：保持 null（由相邻已知行外推补全）
					}
				}
			}
			pos = nl === -1 ? text.length : nl + 1;
		}
		return tops;
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
