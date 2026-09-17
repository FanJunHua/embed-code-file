import path from "path";

export function pathJoin(dir: string, subpath: string): string {
  const result = path.join(dir, subpath);
  // it seems that obsidian do not understand paths with backslashes in Windows, so turn them into forward slashes
  return result.replace(/\\/g, "/");
}

export function analyseSrcLines(str: string): number[] {
	str = str.replace(/\s*/g, "")
	const result: number[] = []

	let strs = str.split(",")
	strs.forEach(it => {
		if(/\w+-\w+/.test(it)) {
			let left = Number(it.split('-')[0])
			let right = Number(it.split('-')[1])
			for(let i = left; i <= right; i++) {
				result.push(i)
			}
			result.push(0) // three dots
		} else {
			result.push(Number(it))
			result.push(0) // three dots
		}
	})

	return result
}

export function extractSrcLines(fullSrc: string,  srcLinesNum: number[]): string {
    let src = ""

    const fullSrcLines = fullSrc.split("\n")
	const fullSrcLinesLen = fullSrcLines.length

	srcLinesNum.forEach((lineNum, index, arr) => {
		if (lineNum > fullSrcLinesLen) {
		  arr.splice(index, 1);
		}
	});

	srcLinesNum.forEach((lineNum, index, arr) => {
		if (lineNum == 0 && arr[index-1] == 0) {
		  arr.splice(index, 1);
		}
	});
	
    srcLinesNum.forEach((lineNum, index) => {
		if (lineNum > fullSrcLinesLen) {
			return
		}

		if (index == srcLinesNum.length-1 && lineNum == 0 && srcLinesNum[index-1] == fullSrcLinesLen) {
			return
		} 

		if (index == 0 && lineNum != 1) {
			src = '...' + '\n' + fullSrcLines[lineNum-1]
			return
		}
		
		// zeros is dots (analyseSrcLines)
        if (lineNum == 0 ) {
			src = src + '\n' + '...'
			return
		}

		if (index == 0) {
			src = fullSrcLines[lineNum-1]
		} else {
			src = src + '\n' + fullSrcLines[lineNum-1]
		}
	});

    return src
}

/**
 * 行号列的行模型（g-005，语义见已批原型 §5 与 docs/plan/g-005-line-numbers-exploration.md §6）。
 * dot=true 表示 extractSrcLines 输出中的省略行 "..."（不编号、不占号，行号单元格留空）；
 * dot=false 时 num 为该行对应的源文件真实行号（1-based）。
 */
export interface EmbedLineRow {
	dot: boolean;
	num: number;
}

/**
 * 与 extractSrcLines 完全同构的行模型推导（g-005）。
 * 在 srcLinesNumInput 的副本上按同样的三轮遍历（含 splice 边界行为）逐行推导，
 * 不修改调用方数组；extractSrcLines 仍独立负责正文提取，既有渲染输出零改动。
 * 必须在 extractSrcLines 之前、对同一初始数组调用，两者的行序列才严格逐行一致
 * （main.ts 另有行数一致性兜底校验，不一致时放弃绘制行号）。
 */
export function buildEmbedLineRows(fullSrc: string, srcLinesNumInput: number[]): EmbedLineRow[] {
	const fullSrcLines = fullSrc.split("\n")
	const fullSrcLinesLen = fullSrcLines.length

	const srcLinesNum = srcLinesNumInput.slice()

	srcLinesNum.forEach((lineNum, index, arr) => {
		if (lineNum > fullSrcLinesLen) {
			arr.splice(index, 1);
		}
	});

	srcLinesNum.forEach((lineNum, index, arr) => {
		if (lineNum == 0 && arr[index-1] == 0) {
			arr.splice(index, 1);
		}
	});

	const rows: EmbedLineRow[] = []
	srcLinesNum.forEach((lineNum, index) => {
		if (lineNum > fullSrcLinesLen) {
			return
		}

		if (index == srcLinesNum.length-1 && lineNum == 0 && srcLinesNum[index-1] == fullSrcLinesLen) {
			return
		}

		if (index == 0 && lineNum != 1) {
			rows.push({dot: true, num: 0})
			rows.push({dot: false, num: lineNum})
			return
		}

		// zeros is dots (analyseSrcLines)
		if (lineNum == 0 ) {
			rows.push({dot: true, num: 0})
			return
		}

		rows.push({dot: false, num: lineNum})
	});

	return rows
}

/**
 * 未设 LINES（嵌入全文件）时的行模型：1..N 全部为代码行（原行号=新行号，两模式重合）。
 */
export function buildFullFileRows(fullSrc: string): EmbedLineRow[] {
	return fullSrc.split("\n").map((_, i) => ({dot: false, num: i + 1}))
}

/**
 * 行号列绘制计划（g-005 F-1）：以渲染后 <code> 的 DOM 文本行为对齐基准。
 * 实测（负责人环境）code 文本比行模型多 1 个尾随空元素（尾部换行，良性），
 * 故只容忍两类可解释差异，其余放弃绘制（宁可不显示也不错位）：
 * - 尾随空元素（DOM 行数 = 模型 + 1，末行为空白）→ 模型 1:1，末行无行号；
 * - 前导空行（DOM 行数 = 模型 + 1，首行为空白）→ 行号列前补一个空单元格；
 */
export interface LineGutterPlan {
	ok: boolean;
	/** 与 code 文本行一一对应的行号单元格（空串 = 该行留空：省略行/前导空行） */
	cells: string[];
	/** 行模型行数（折行兜底检测的期望行数基准） */
	rowCount: number;
	/** ok=true 为对齐方式（exact/trailing-blank/leading-blank）；ok=false 为放弃原因 */
	reason: string;
}

export function buildLineGutterPlan(codeTextLines: string[], rows: EmbedLineRow[], mode: 'original' | 'new'): LineGutterPlan {
	const n = codeTextLines.length
	const m = rows.length
	const blank = (s: string) => s.trim() === ''

	let lead = 0
	if (n === m) {
		// exact：1:1
	} else if (n === m + 1 && blank(codeTextLines[n - 1])) {
		// 尾随空元素：不补单元格（末行为空白、不可见）
	} else if (n === m + 1 && blank(codeTextLines[0])) {
		lead = 1
	} else {
		return {ok: false, cells: [], rowCount: m, reason: `code 文本 ${n} 行与行模型 ${m} 行无法可解释对齐（仅容忍首/尾单一空行差异）`}
	}

	const cells: string[] = []
	for (let i = 0; i < lead; i++) { cells.push('') }
	let counter = 0
	for (const r of rows) {
		if (r.dot) { cells.push(''); continue }
		if (mode === 'new') {
			counter += 1
			cells.push(String(counter))
		} else {
			cells.push(String(r.num))
		}
	}

	const reason = lead ? 'leading-blank' : (n === m ? 'exact' : 'trailing-blank')
	return {ok: true, cells, rowCount: m, reason}
}

/**
 * F-5（g-005）：把「逐逻辑行实测的 top」整理为可直接用于绝对定位的行号纵坐标。
 * 背景：F-1…F-4 都假设「行号按统一行距排布」，但负责人第五轮实测证明该假设不成立
 * （克隆探针测得 19.69px，而代码真实行盒与之不符）→ 统一行距必然造成累积漂移。
 * F-5 因此改为**每个行号贴各自那一行的实测 top 绝对定位**，本函数只负责：
 * 1) pitch：相邻已知 top 之差 ÷ 行距数，取中位数（仅用于补全无法测量的行，如空行）；
 * 2) 补全 null（空行/该行测量失败）：按最近已知 top ± pitch × 距离外推。
 * 返回 null 表示一个 top 都没测到（调用方回退为按计算行高等距排布）。纯函数，便于离线验证。
 */
export function resolveLineTops(rawTops: (number | null)[]): { tops: number[]; pitch: number } | null {
	const known: { i: number; top: number }[] = []
	rawTops.forEach((t, i) => {
		if (t !== null && isFinite(t)) { known.push({ i, top: t }) }
	})
	if (!known.length) { return null }

	const diffs: number[] = []
	for (let k = 1; k < known.length; k++) {
		const span = known[k].i - known[k - 1].i
		const d = (known[k].top - known[k - 1].top) / span
		if (isFinite(d) && d > 0) { diffs.push(d) }
	}
	diffs.sort((a, b) => a - b)
	const pitch = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0

	const tops: number[] = []
	for (let i = 0; i < rawTops.length; i++) {
		const t = rawTops[i]
		if (t !== null && isFinite(t)) { tops.push(t); continue }
		let prev: { i: number; top: number } | null = null
		for (const k of known) { if (k.i < i) { prev = k } else { break } }
		const next = known.find((k) => k.i > i) ?? null
		if (prev && pitch > 0) { tops.push(prev.top + (i - prev.i) * pitch) }
		else if (next && pitch > 0) { tops.push(next.top - (next.i - i) * pitch) }
		else { tops.push(prev ? prev.top : (next ? next.top : 0)) }
	}
	return { tops, pitch }
}

/**
 * F-6（g-007）：内容行数——文本按 '\n' 切分后去掉结尾空段（渲染器写入的尾部换行不产生内容行）。
 * 供几何行距推算 (codeHeight − contentHeight) / (内容行数 − 1) 使用。
 */
export function contentLineCount(text: string): number {
	const parts = text.split('\n')
	if (parts.length && parts[parts.length - 1] === '') { return parts.length - 1 }
	return parts.length
}

/**
 * F-6（g-007）：从 getClientRects() 结果中取「第一个有实际宽度的 rect」。
 * 负责人实机数据（blk0 第 2 行）：首个 rect 宽度为 0 且 top 等于上一行——Range 起点落在上一行
 * '\n' 之后的文本节点边界上，F-5 直接取 rects[0] 便把该行画到了上一行的位置。本函数是第一道修复。
 */
export function pickFirstPositiveRect<T extends { top: number; width: number; height: number }>(rects: ArrayLike<T>): T | null {
	for (let i = 0; i < rects.length; i++) {
		if (rects[i].width > 0) { return rects[i] }
	}
	return null
}

/**
 * F-6（g-007）：由 code 元素几何推算行盒行距。inline 的 <code> 其 rect 高度 =
 * (内容行数 − 1) × 行距 + 字体内容盒高，故 行距 = (codeHeight − 上下 padding − contentHeight) / (内容行数 − 1)。
 * 负责人实机三块零误差命中（375.2 / 1005.2 / 690.2 ↔ 22.5）。不可推算时返回 0。
 */
export function geometricLinePitch(codeHeight: number, paddingTop: number, paddingBottom: number, contentHeight: number, lines: number): number {
	if (!isFinite(codeHeight) || !isFinite(contentHeight) || contentHeight <= 0) { return 0 }
	if (!isFinite(lines) || lines < 2) { return 0 }
	const pt = isFinite(paddingTop) ? paddingTop : 0
	const pb = isFinite(paddingBottom) ? paddingBottom : 0
	const p = (codeHeight - pt - pb - contentHeight) / (lines - 1)
	return isFinite(p) && p > 0 ? p : 0
}

/**
 * F-6（g-007）：行距取值链。清洗零宽 rect 后的逐行实测中位差是数据驱动的真值，优先采用；
 * 几何推算、<pre> 计算行高（行盒的真正归属者）、<code> 计算行高、字号×1.5 依次兜底。
 * 实机教训：<code> 的 computed line-height（19.6875）与 F-3 克隆探针（19.69）都不是行盒行距（22.5）。
 */
export function resolveLinePitch(input: { measured: number; geometric: number; preComputed: number; codeComputed: number; fontSize: number }): { pitch: number; source: string } {
	const ok = (v: number) => isFinite(v) && v > 0
	if (ok(input.measured)) { return { pitch: input.measured, source: 'measured' } }
	if (ok(input.geometric)) { return { pitch: input.geometric, source: 'geometric' } }
	if (ok(input.preComputed)) { return { pitch: input.preComputed, source: 'pre-line-height' } }
	if (ok(input.codeComputed)) { return { pitch: input.codeComputed, source: 'code-line-height' } }
	if (ok(input.fontSize)) { return { pitch: input.fontSize * 1.5, source: 'fontSize*1.5' } }
	return { pitch: 21, source: 'fallback-21' }
}
