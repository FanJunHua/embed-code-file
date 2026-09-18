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

/* ======================= g-009：选中代码隐藏（HIDE 键） =======================
 * 设计要点（为什么不用 extractSrcLines 实现 HIDE）：
 * extractSrcLines 只在「1,2,0,3,4」这种 token 序列上工作，而 HIDE 的语义是**源行号集合**
 * （随意顺序、区间、与 LINES 求差集），且它已知有 splice 边界 bug（见 utils 顶部实现）。
 * 故 HIDE 全程走独立的「行区间集合运算 + 行模型变换」：先由 LINES 得到行模型，
 * 再把被隐藏的源行在模型里就地变成 dot 行——渲染出的 `...` 因此与既有省略逻辑**同源**，
 * 不引入第二套省略实现。
 */

/** 闭区间源行号区间（1-based，含首含尾）。 */
export interface LineRangeSegment {
	start: number;
	end: number;
}

/** 行区间集合：内部 invariants 见 normalizeLineRanges（已排序、已合并、均为合法闭区间）。 */
export type LineRangeSet = LineRangeSegment[];

/**
 * 归一化源行号区间集合：丢弃非法项（非整数/start>end），裁掉超出 [1, maxLine] 的部分，
 * 然后按 start 升序排序并合并重叠/相邻区间（相邻必须合并，否则序列化结果不紧凑）。
 * 返回新数组，不修改入参。maxLine <= 0 时返回空集合。
 */
export function normalizeLineRanges(segments: LineRangeSegment[], maxLine: number): LineRangeSet {
	const limit = Math.floor(maxLine);
	if (!isFinite(limit) || limit <= 0) { return [] }

	const items: LineRangeSegment[] = [];
	for (const seg of segments) {
		if (!seg) { continue }
		if (!isFinite(seg.start) || !isFinite(seg.end)) { continue }
		let s = Math.floor(seg.start);
		let e = Math.floor(seg.end);
		if (s > e) { const t = s; s = e; e = t }   // 容错：反向区间按同一区间处理
		if (e < 1 || s > limit) { continue }       // 完全越界
		if (s < 1) { s = 1 }
		if (e > limit) { e = limit }
		items.push({ start: s, end: e });
	}
	items.sort((a, b) => (a.start - b.start) || (a.end - b.end));

	const out: LineRangeSet = [];
	for (const it of items) {
		const last = out.length ? out[out.length - 1] : null;
		if (last && it.start <= last.end + 1) {
			if (it.end > last.end) { last.end = it.end }
		} else {
			out.push({ start: it.start, end: it.end });
		}
	}
	return out;
}

/** 源行号是否落在区间集合内（集合已归一化，二分查找）。 */
export function lineInRanges(num: number, ranges: LineRangeSet): boolean {
	let lo = 0;
	let hi = ranges.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const r = ranges[mid];
		if (num < r.start) { hi = mid - 1 }
		else if (num > r.end) { lo = mid + 1 }
		else { return true }
	}
	return false;
}

/** 区间集合是否覆盖任一源行（空集合 → false）。用于「没有真正隐藏任何东西」的判定。 */
export function rangesHitAnyLine(ranges: LineRangeSet, maxLine: number): boolean {
	for (const r of normalizeLineRanges(ranges, maxLine)) { if (r.start <= r.end) { return true } }
	return false;
}

/** 区间集合是否覆盖全部源行（1..maxLine）；maxLine <= 0 → false。 */
export function rangesCoverAllLines(ranges: LineRangeSet, maxLine: number): boolean {
	const limit = Math.floor(maxLine);
	if (!isFinite(limit) || limit <= 0) { return false }
	const norm = normalizeLineRanges(ranges, limit);
	return norm.length === 1 && norm[0].start <= 1 && norm[0].end >= limit;
}

/**
 * 集合差：visible − hidden（两者先各自归一化到 [1, maxLine]）。
 * 结果已排序、已合并，故 164-168,172-208 减去 183-193 → 164-168,172-182,194-208。
 */
export function subtractLineRanges(visible: LineRangeSegment[], hidden: LineRangeSegment[], maxLine: number): LineRangeSet {
	const vis = normalizeLineRanges(visible, maxLine);
	const hid = normalizeLineRanges(hidden, maxLine);
	if (!vis.length) { return [] }
	if (!hid.length) { return vis }

	const out: LineRangeSet = [];
	for (const v of vis) {
		let cursor = v.start;
		for (const h of hid) {
			if (h.end < cursor) { continue }
			if (h.start > v.end) { break }
			if (h.start > cursor) { out.push({ start: cursor, end: h.start - 1 }) }
			cursor = Math.max(cursor, h.end + 1);
			if (cursor > v.end) { break }
		}
		if (cursor <= v.end) { out.push({ start: cursor, end: v.end }) }
	}
	return out;
}

/** 区间 → 源行号升序数组（用于「本次会隐藏 N 行」提示与覆盖判定）。 */
export function lineNumbersFromRanges(ranges: LineRangeSet, maxLine: number): number[] {
	const out: number[] = [];
	for (const r of normalizeLineRanges(ranges, maxLine)) {
		for (let n = r.start; n <= r.end; n++) { out.push(n) }
	}
	return out;
}

/** 区间集合 → 源文件键值文本（单行=裸数字，多行=start-end，逗号分隔；空集合 → ''）。 */
export function rangesToSpec(ranges: LineRangeSet, maxLine: number): string {
	return normalizeLineRanges(ranges, maxLine)
		.map((r) => (r.start === r.end ? String(r.start) : r.start + '-' + r.end))
		.join(',');
}

function plainHideSegment(text: string, maxLine: number): LineRangeSegment | null {
	const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(text);
	if (!m) { return null }
	const start = Number(m[1]);
	const end = m[2] === undefined ? start : Number(m[2]);
	// start 允许 0（YAML 里 `0-99999` 这类写法由 normalize 裁到第 1 行）；负号只可能来自
	// `-5` 这种开头减号，正则已排除，故此处只需挡掉全 0 与非有限值。
	if (!isFinite(start) || !isFinite(end) || (start < 1 && end < 1)) { return null }
	return { start, end };
}

/** HIDE 键值的解析结果；raw 保留原文（序列化未变化时原样保留用户写法，避免无谓改写）。 */
export interface EmbedHideSpec {
	ranges: LineRangeSet;
	raw: string;
	/** 被忽略的片段（空/非法/越界），仅用于 console.warn，不阻断渲染 */
	warnings: string[];
	/** 原文非空但一个合法区间都没有（全非法/全越界）→ 调用方按「未生效」告警 */
	requested: boolean;
}

/**
 * 解析 HIDE 键值。宽容度与既有 LINES 解析同级（去空白、容忍有/无引号、大小写无关键名）；
 * 非法片段一律忽略并记入 warnings——**绝不因为 HIDE 有问题而不渲染**（零回归红线）。
 * maxLine 为源文件总行数：超出部分被裁掉（HIDE: "0-99999" → 1-总行数）。
 */
export function parseHideSpec(raw: unknown, maxLine: number): EmbedHideSpec {
	const requested = raw !== undefined && raw !== null && String(raw).trim() !== '';
	if (typeof raw !== 'string' && typeof raw !== 'number') {
		return { ranges: [], raw: '', warnings: requested ? ['HIDE 值不是字符串或数字'] : [], requested };
	}
	const text = String(raw).replace(/["']/g, '').trim();
	if (!text) { return { ranges: [], raw: '', warnings: [], requested: false } }

	const limit = Math.floor(maxLine);
	const segments: LineRangeSegment[] = [];
	const warnings: string[] = [];
	text.split(',').forEach((part) => {
		const t = part.trim();
		if (!t) { warnings.push('空片段'); return }
		const seg = plainHideSegment(t, limit);
		if (!seg) { warnings.push(`无法识别的片段 "${t}"`); return }
		if (limit <= 0 || seg.start > limit) { warnings.push(`越界片段 "${t}"（源文件共 ${isFinite(limit) ? limit : 0} 行）`); return }
		if (seg.end > limit) { warnings.push(`片段 "${t}" 超出末行，已裁到 ${limit}`) }
		segments.push(seg);
	});

	return { ranges: normalizeLineRanges(segments, limit), raw: text, warnings, requested };
}

/**
 * 把行模型里**连续的 dot 行合并成一行**（含「新隐藏行与既有省略段相邻」的情形）。
 * 为什么不逐行渲染 `...`：负责人实机截图显示隐藏 182-194（13 行）会渲染出 13 行 `...`，
 * 视觉上是一列省略号——语义上这些行是**一段**被省略的内容，只应占一个 `...`。
 * 合并只动 dot 行、不动代码行，故正文模型与行号模型（都由本函数结果派生）仍逐行对齐；
 * dot 行本就不占行号（buildLineGutterPlan 给空单元格），合并后行号不会错位。
 */
export function mergeConsecutiveDots(rows: EmbedLineRow[]): { rows: EmbedLineRow[]; mergedDots: number } {
	const out: EmbedLineRow[] = [];
	let mergedDots = 0;
	for (const row of rows) {
		const last = out.length ? out[out.length - 1] : null;
		if (row.dot && last && last.dot) { mergedDots += 1; continue }
		out.push(row);
	}
	return { rows: out, mergedDots };
}

/**
 * 把行模型按 HIDE 变换：被隐藏的**代码行**就地变成 dot 行（沿用既有 `...` 渲染语义），
 * dot 行原样保留；**连续的 dot 行最后合并为一行**（见 mergeConsecutiveDots）。
 * 返回新数组（不修改入参）、被真正隐藏的源行号（升序）与被合并掉的 dot 行数。
 */
export function applyHideToRows(rows: EmbedLineRow[], ranges: LineRangeSet): { rows: EmbedLineRow[]; hiddenNums: number[]; mergedDots: number } {
	const normalized = normalizeLineRanges(ranges, Number.MAX_SAFE_INTEGER);
	const applied: EmbedLineRow[] = [];
	const hiddenNums: number[] = [];
	for (const row of rows) {
		if (!row.dot && lineInRanges(row.num, normalized)) {
			hiddenNums.push(row.num);
			applied.push({ dot: true, num: 0 });
			continue;
		}
		applied.push(row);
	}
	const merged = mergeConsecutiveDots(applied);
	return { rows: merged.rows, hiddenNums, mergedDots: merged.mergedDots };
}

/** 行模型是否已被隐藏行掏空（无任何可见代码行）→ 调用方拒绝并 Notice。 */
export function hasVisibleCodeRow(rows: EmbedLineRow[]): boolean {
	return rows.some((r) => !r.dot);
}

/**
 * 行模型 → 可见代码行的源行号区间集合（未归一化前的原始区间）。
 * LINES 缺省的整文件模型：源行号可能不连续（越界被剔除），故按「连续段」切区间而不是取首尾。
 */
export function rowsToSourceLineRanges(rows: EmbedLineRow[]): LineRangeSegment[] {
	const segments: LineRangeSegment[] = [];
	let prev = 0;
	let cur: LineRangeSegment | null = null;
	for (const row of rows) {
		if (row.dot) { continue }
		if (cur && row.num === prev + 1) { cur.end = row.num } else { cur = { start: row.num, end: row.num }; segments.push(cur) }
		prev = row.num;
	}
	return segments;
}

/** 行模型 → 可见代码行的源行号键值文本（空模型 → ''）。 */
export function rowsToSourceLineSpec(rows: EmbedLineRow[]): string {
	return rowsToSourceLineRanges(rows).map((r) => (r.start === r.end ? String(r.start) : r.start + '-' + r.end)).join(',');
}

/** 行模型 → 渲染文本行数（省略行也占一行）。 */
export function rowsLineCount(rows: EmbedLineRow[]): number {
	return rows.length;
}

/** 行模型 × 渲染文本 → 每个逻辑行首字符的全局偏移（长度恰为 lineCount）。
 *  文本比模型短（末行无换行）时后续行首偏移钳到文本长度，偏移表因此恒自洽，
 *  调用方（selectionRowRange）不必再为「行数对不上」兜底。 */
export function lineStartOffsets(codeText: string, lineCount: number): number[] {
	const starts: number[] = [0];
	while (starts.length < lineCount) {
		const from = starts[starts.length - 1];
		const nl = codeText.indexOf('\n', from);
		if (nl === -1) { starts.push(codeText.length) } else { starts.push(nl + 1) }
	}
	return starts;
}
/** 字符偏移 → 逻辑行索引（落在换行符上归其所属行；超出末尾 → 末行）。 */
export function charOffsetToLineIndex(offsets: number[], offset: number): number {
	const limit = offsets.length ? offsets[offsets.length - 1] : 0;
	const off = Math.max(0, Math.min(offset, limit));
	let lo = 0;
	let hi = offsets.length - 1;
	let ans = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (offsets[mid] <= off) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
	}
	return ans;
}

/** 选区字符偏移 → 逻辑行范围（1-based 行号 + 0-based 索引）。 */
export interface EmbedSelectionRows {
	/** 1-based 起始行 */
	startLine: number;
	/** 1-based 结束行（含） */
	endLine: number;
	/** 0-based 起始行索引 */
	startIndex: number;
	/** 0-based 结束行索引（含） */
	endIndex: number;
	/** 选中的逻辑行数 */
	count: number;
}

/**
 * 选区字符偏移 → 逻辑行范围。纯函数，边界规则（g-009 规格 §2.3）：
 * - 按**整行**处理：选区覆盖到的行全部计入；
 * - **终点恰落在下一行行首时不包含该行**（经典 off-by-one：endOffset === lineStart[k] 时结束行回退到 k-1）；
 * - 空选区 / 偏移非法 / 行模型为空 → null（调用方 Notice，不抛异常）；
 * - 行数不一致（DOM 文本与行模型对不上）→ null，不做错误映射。
 * textLength 为 code 的完整文本长度：末行无尾随换行时其行首偏移被钳到该长度（无可选字符），
 * 此时终点落在末行行首只能理解为「选到文末」，不触发回退。
 */
export function selectionRowRange(offsets: number[], lineCount: number, startOffset: number, endOffset: number, textLength: number): EmbedSelectionRows | null {
	if (!offsets.length || lineCount <= 0 || offsets.length !== lineCount) { return null }
	if (!isFinite(startOffset) || !isFinite(endOffset)) { return null }

	// 只做「不小于 0」的下界保护：上界交给偏移表查找（endOffset === textLength 是合法终点，
	// 若按最后一项行首偏移钳掉，末行永远无法被选中）。
	let s = Math.max(0, Math.floor(startOffset));
	let e = Math.max(0, Math.floor(endOffset));
	if (s > e) { const t = s; s = e; e = t }
	if (s === e) { return null }

	let startIndex = charOffsetToLineIndex(offsets, s);
	let endIndex = charOffsetToLineIndex(offsets, e);
	// 终点正好落在某行行首 → 该行未被选中（经典 off-by-one）。
	// 例外：该行行首偏移已到文本末尾（空行——如 DOM 文本末尾那个尾随空元素），
	// 行内没有任何字符可选，终点落在它上面只能是「选到文末」，回退会让整块选中少算一行。
	if (endIndex > startIndex && e === offsets[endIndex]) {
		const emptyRowAtTextEnd = offsets[endIndex] >= textLength;
		if (!emptyRowAtTextEnd) { endIndex -= 1 }
	}
	if (endIndex > lineCount - 1) { endIndex = lineCount - 1 }
	if (endIndex < startIndex) { return null }

	return { startLine: startIndex + 1, endLine: endIndex + 1, startIndex, endIndex, count: endIndex - startIndex + 1 };
}

/** 逻辑行范围内所有**代码行**的源行号（dots 行不产生源行号；结果升序去重）。 */
export function collectSourceLineNums(rows: EmbedLineRow[], startIndex: number, endIndex: number): number[] {
	const seen = new Set<number>();
	const out: number[] = [];
	for (let i = Math.max(0, startIndex); i <= Math.min(rows.length - 1, endIndex); i++) {
		const row = rows[i];
		if (!row || row.dot) { continue }
		if (seen.has(row.num)) { continue }
		seen.add(row.num);
		out.push(row.num);
	}
	out.sort((a, b) => a - b);
	return out;
}

/* ---------- g-009 增量：行号列（gutter）交互的「span → 源行号」反查 ---------- */

/**
 * 行模型 → gutter 行号 span 序列的**源行号**（紧凑数组，第 k 项 = 第 k 个 span 的源行号）。
 * 关键不变式：gutter 里 `span.embed-line-number` 的出现顺序 == 本数组顺序，因此
 * 「DOM 里的第 k 个 span」的源行号恒为 `arr[k]`——**与行号显示模式无关**。
 * dot 行（既有省略行）与已隐藏行都不产生 span，故天然不在本数组里（不可点）。
 * 「新行号」模式下 span 文本是 1..N，绝不能把它当源行号用（本函数正是为此而存在）。
 */
export function gutterSpanSourceLineNums(rows: EmbedLineRow[]): number[] {
	const out: number[] = [];
	for (const row of rows) {
		if (row.dot) { continue }
		out.push(row.num);
	}
	return out;
}

/** 源行号数组 → 区间集合（相邻合并交由 normalizeLineRanges 处理）。 */
export function lineNumsToRanges(nums: number[]): LineRangeSegment[] {
	return nums.map((n) => ({ start: n, end: n }));
}

/**
 * gutter 选区（**span 索引**闭区间，0-based）→ 源行号集合（升序去重）。
 * 入参是压缩后的 span 序号（跳过 dots），索引越界/反向一律容错，
 * 越界项被忽略——故调用方拿到空集合时应当 Notice 而不是写文件。
 */
export function gutterSpanRangeToSourceLineNums(rows: EmbedLineRow[], startSpan: number, endSpan: number): number[] {
	const spans = gutterSpanSourceLineNums(rows);
	const nums: number[] = [];
	const lo = Math.max(0, Math.min(startSpan, endSpan));
	const hi = Math.min(spans.length - 1, Math.max(startSpan, endSpan));
	for (let i = lo; i <= hi; i++) {
		const num = spans[i];
		if (num === undefined) { continue }
		nums.push(num);
	}
	nums.sort((a, b) => a - b);
	return nums.filter((n, i) => i === 0 || n !== nums[i - 1]);
}

/**
 * gutter 拖选区间归一化（0-based，闭区间，**仅按真实 span 个数** clamp）。
 * 返回 null 表示没有任何 span（块已全隐藏/未启用行号）→ 调用方不动作。
 * 归一化只认 span 数量而不是模型行数：dots 与已隐藏行都不产生 span，索引空间是压缩的。
 */
export function clampGutterSpanRange(rows: EmbedLineRow[], startSpan: number, endSpan: number): { start: number; end: number } | null {
	const count = gutterSpanSourceLineNums(rows).length;
	if (count <= 0) { return null }
	const a = Math.min(Math.floor(startSpan), Math.floor(endSpan));
	const b = Math.max(Math.floor(startSpan), Math.floor(endSpan));
	const start = Math.max(0, Math.min(a, count - 1));
	const end = Math.max(0, Math.min(b, count - 1));
	if (end < start) { return null }
	return { start, end };
}

/** 文本 → 行数组（与 extractSrcLines / 渲染链一致的 '\n' 切分）。 */
export function linesOfText(text: string): string[] {
	return text.split('\n');
}

/**
 * 渲染期行模型的唯一推导入口（g-009 体验修复 1 的核心）：
 * 显示集合 = （LINES 缺省 ? 1..N : LINES 可见行）− HIDE 指定的源行号，然后**由该集合重建行模型**。
 * 为什么必须重建：analyseSrcLines 对 "1-5,8-11" 只产出末尾那一个 0（段间省略），若在「老模型」上
 * 就地打点，「隐藏 LINES 之外的行」会打空、多行隐藏会变成一列 `...`；由归一化区间集合重建后，
 * 段间与隐藏处一律恰好一个 `...`，且正文与行号列由同一 rows 派生，行号必然对齐。
 * rows=null 表示 HIDE 未生效（调用方走 v1.4.1 既有路径，零回归）。
 */
export function buildVisibleRowsForHide(srcText: string, linesSpec: unknown, hideSpec: unknown): { rows: EmbedLineRow[] | null; hideRanges: LineRangeSet; visibleRanges: LineRangeSet; hide: EmbedHideSpec } {
	const total = srcText.split('\n').length;
	const hide = parseHideSpec(hideSpec, total);
	const hideRanges = hide.requested ? hide.ranges : [];
	if (!hideRanges.length) { return { rows: null, hideRanges: [], visibleRanges: [], hide } }

	const linesText = linesSpec === undefined || linesSpec === null ? '' : String(linesSpec).trim();
	const baseVisible: LineRangeSegment[] = linesText
		? rowsToSourceLineRanges(buildEmbedLineRows(srcText, analyseSrcLines(linesText)))
		: [{ start: 1, end: total }];
	const visibleRanges = subtractLineRanges(baseVisible, hideRanges, total);
	const visibleSpec = rangesToSpec(visibleRanges, total);
	return { rows: buildEmbedLineRows(srcText, visibleSpec ? analyseSrcLines(visibleSpec) : []), hideRanges, visibleRanges, hide };
}

/* ---------- g-009 体验修复：块级按钮与 Obsidian 核心按钮并排的纯几何计算 ---------- */

/** 只保留有意义的最小矩形（左/右/宽）。 */
export interface ButtonRectLike {
	left: number;
	right: number;
	width: number;
}

/** 核心按钮选择器默认值（不同主题/版本的核心按钮类名不同，故做成可配置）。 */
export const DEFAULT_CORE_BUTTON_SELECTORS = ['.copy-code-button', '.edit-block-button', '.code-block-flair'];

/** rect 是否可用于定位：有实际宽度（零宽 = 隐藏/未布局 → 跳过）。 */
export function isUsableButtonRect(rect: ButtonRectLike | null | undefined): boolean {
	if (!rect) { return false }
	return isFinite(rect.left) && isFinite(rect.right) && isFinite(rect.width) && rect.width > 0;
}

/**
 * 「显示全部」按钮的 right 偏移（px，CSS `right` 语义：元素右边界距块右边界多远）：
 * 取**最靠左**的核心按钮（复制 / 编辑此块 等；零宽者跳过），把本按钮放在它左侧 gap 处；
 * 无核心按钮时退回默认偏移；结果 clamp 在块内（不越界、不压住行号列）。
 * 注意必须用**块的 right 坐标**（不是 width）——块自身有 left 偏移时用 width 会把按钮放偏。
 * panelRight 非正（拿不到布局）时不做 clamp。
 */
export function computeHideAllButtonRight(
	panelRight: number,
	coreRects: Array<ButtonRectLike | null | undefined>,
	buttonWidth: number,
	opts?: { gap?: number; fallbackRight?: number; minRight?: number },
): { right: number; source: 'core-leftmost' | 'fallback-no-core' | 'fallback-no-panel'; coreLeft: number | null } {
	const gap = opts && isFinite(opts.gap as number) ? (opts.gap as number) : 6;
	const fallback = opts && isFinite(opts.fallbackRight as number) ? (opts.fallbackRight as number) : 6;
	const minRight = opts && isFinite(opts.minRight as number) ? (opts.minRight as number) : 0;
	const panel = isFinite(panelRight) ? panelRight : NaN;

	const usable = coreRects.filter((r) => isUsableButtonRect(r)) as ButtonRectLike[];
	if (!usable.length) {
		// 无核心按钮（或都不可见）→ 退回默认偏移；块很窄时也保证不为负
		const right = panel > 0 ? Math.max(minRight, Math.min(fallback, Math.max(minRight, panel - buttonWidth))) : fallback;
		const safe = Math.max(0, Number.isFinite(right) ? right : fallback);
		return { right: safe, source: 'fallback-no-core', coreLeft: null };
	}

	const coreLeft = Math.min(...usable.map((r) => r.left));
	if (!(panel > 0)) { return { right: Math.max(0, gap), source: 'fallback-no-panel', coreLeft } }

	let right = panel - coreLeft + gap;
	const maxRight = Math.max(minRight, panel - buttonWidth);
	right = Math.max(minRight, Math.min(right, maxRight));
	return { right, source: 'core-leftmost', coreLeft };
}

/* ======================= g-009：HIDE 写回 section ======================= */

/** section 内既有键行；hideLineIndex=null 表示该 section 没有 HIDE 键。 */
export interface EmbedSectionKeys {
	hideLineIndex: number | null;
	hideValue: string | null;
	hideQuote: string;
	/** 没有 HIDE 键时的插入点（解析失败时回退为紧邻开栏行之后） */
	insertAt: number;
	warnings: string[];
}

function matchKeyLine(text: string, key: string): { value: string; quote: string } | null {
	const m = new RegExp('^\\s*' + key + '\\s*:\\s*(.*)$', 'i').exec(text.replace(/\r$/, ''));
	if (!m) { return null }
	const rawValue = m[1].trim();
	const quote = rawValue.length >= 2 && (rawValue[0] === '"' || rawValue[0] === "'") && rawValue[rawValue.length - 1] === rawValue[0] ? rawValue[0] : '';
	const value = quote ? rawValue.slice(1, -1) : rawValue;
	return { value, quote };
}

/** 无语言标注的围栏行（``` / ~~~）——开栏可以是「```embed-ts」，故按「围栏符号后无内容」判定。 */
function isBareFence(text: string): boolean {
	return /^\s*(?:`{3,}|~{3,})\s*$/.test(text.replace(/\r$/, ''));
}

/**
 * 在代码块 section 文本内定位 LINES / HIDE 键行（行号相对 section 起点，0-based）。
 * 只扫描开栏行之后的**键值行**（`KEY:` 形态）；遇到收栏行或非键值行即停——避免把代码正文里
 * 形如 `Hide: xxx` 的行误判成元数据。解析失败（找不到开栏行）时给出警告并回退
 * 「插到第 1 行之后」，由调用方的 section 一致性校验兜底。
 */
export function parseEmbedSectionKeys(sectionText: string): EmbedSectionKeys {
	const lines = sectionText.split('\n');
	const warnings: string[] = [];
	let fenceIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*(?:`{3,}|~{3,})/.test(lines[i])) { fenceIndex = i; break }
	}
	if (fenceIndex === -1) { warnings.push('section 内找不到代码块开栏行') }

	let linesIndex: number | null = null;
	let pathIndex: number | null = null;
	let hideIndex: number | null = null;
	let hideValue: string | null = null;
	let hideQuote = '';

	for (let i = fenceIndex + 1; i < lines.length; i++) {
		const text = lines[i];
		if (isBareFence(text)) { break }             // 收栏行：元数据区结束
		if (/^\s*$/.test(text)) { break }            // 空行：元数据区结束（Obsidian 解析同样不再认键）
		const line = matchKeyLine(text, 'LINES');
		const hide = matchKeyLine(text, 'HIDE');
		const pathKey = matchKeyLine(text, 'PATH');
		if (line) { if (linesIndex === null) { linesIndex = i } continue }
		if (hide) { if (hideIndex === null) { hideIndex = i; hideValue = hide.value; hideQuote = hide.quote } continue }
		if (pathKey) { pathIndex = i; continue }
		break                                          // 出现非键值行 → 元数据区结束
	}

	// 插入点：优先插到最后一条「应排在 HIDE 之前」的键行之后
	//（规格：HIDE 不存在时插到 LINES 之后，无 LINES 则插到 PATH 之后）
	const anchor = linesIndex !== null ? linesIndex : (pathIndex !== null ? pathIndex : fenceIndex);
	const insertAt = Math.min(Math.max(anchor, 0) + 1, lines.length);

	return { hideLineIndex: hideIndex, hideValue, hideQuote, insertAt, warnings };
}

/**
 * 生成新的 section 文本（纯函数；只改/增/删 HIDE 键那一行，其余行**字节级**原样保留，
 * 因此原有键的顺序与引号风格天然不变）。hideSpec 为空串 → 删除 HIDE 行而不是留 `HIDE: ""`。
 */
export function updateHideInSection(sectionText: string, hideSpec: string): { text: string; changed: boolean; ok: boolean; reason: string } {
	const lines = sectionText.split('\n');
	const keys = parseEmbedSectionKeys(sectionText);
	const spec = (hideSpec ?? '').trim();

	if (keys.hideLineIndex !== null) {
		const current = (keys.hideValue ?? '').trim();
		if (spec === '') {
			lines.splice(keys.hideLineIndex, 1);
			return { text: lines.join('\n'), changed: true, ok: true, reason: 'removed' };
		}
		if (current === spec) { return { text: sectionText, changed: false, ok: true, reason: 'unchanged' } }
		const quote = keys.hideQuote || '"';
		lines[keys.hideLineIndex] = 'HIDE: ' + quote + spec + quote;
		return { text: lines.join('\n'), changed: true, ok: true, reason: 'replaced' };
	}

	if (spec === '') { return { text: sectionText, changed: false, ok: true, reason: 'no-hide-key' } }

	if (keys.warnings.length && keys.insertAt <= 0) {
		return { text: sectionText, changed: false, ok: false, reason: 'section 结构无法识别（' + keys.warnings.join('；') + '）' };
	}
	lines.splice(keys.insertAt, 0, 'HIDE: "' + spec + '"');
	return { text: lines.join('\n'), changed: true, ok: true, reason: 'inserted' };
}

/* ======================= g-009 写回修复：以「当前真实全文」为唯一事实来源 =======================
 * 背景（负责人实机事故）：原实现把 `getSectionInfo(el).text` 当成「只有节区文本」，
 * 却又拿它按整文件 + lineStart/lineEnd 切片使用，两者自相矛盾 → 只要代码块不覆盖整个文件就恒真中止
 * （Notice「代码块节区行数与编辑器不一致」）。本段改为：全文由调用方提供（编辑器 getValue / vault.read），
 * `info.text` 只用于日志与提示；定位块一律靠**围栏扫描**，且只有定位失败才是合法中止。
 */

/** 触发侧历史（仅用于 writeHideToFullText 的合并与日志）。 */
export interface HideTriggerHistory {
	/** 触发瞬间从 DOM 读到的当前 HIDE 文本（可能为空串） */
	hiddenNow: string;
	/** 未被 LINES 覆盖而被剔除的越界片段 */
	droppedOutOfView?: number[];
}

export interface EmbedMetadataHint {
	path?: string;
	lines?: string;
	hideSpec?: string;
	/** 块正文尾部（用于多个候选围栏时的消歧） */
	contentTail?: string;
}

export interface EmbedFenceCandidate {
	start: number;
	end: number;
	path?: string;
	lines?: string;
	hide?: string;
	score: number;
}

export interface HideUpdatePlan {
	ok: boolean;
	reason: string;
	matchedBy: string;
	mode: 'fence' | 'range';
	/** 该块在 fullText.split('\n') 中的围栏行号（-1 表示退回 range 口径） */
	startLine: number;
	endLine: number;
	textLines: string[];
	keyLineIndex: number;
	oldHide: string;
	newHide: string;
	newHideLine: string;
	changed: boolean;
	newText: string;
	candidates: EmbedFenceCandidate[];
	/** fence（收栏行前）或 range（节区末尾）内的插入点，0-based 相对 textLines */
	insertAt: number;
	text: string;
}

/** 从块正文里提取 PATH / LINES / HIDE 元数据（只扫开栏行之后的连续键值行，遇正文即停）。 */
export function extractEmbedMetadata(blockTextLines: string[]): { path?: string; lines?: string; hide?: string } {
	const out: { path?: string; lines?: string; hide?: string } = {};
	for (let i = 1; i < blockTextLines.length; i++) {
		const text = blockTextLines[i];
		if (isBareFence(text)) { break }
		if (/^\s*$/.test(text)) { break }
		const pathKey = matchKeyLine(text, 'PATH');
		const linesKey = matchKeyLine(text, 'LINES');
		const hideKey = matchKeyLine(text, 'HIDE');
		if (pathKey) { if (out.path === undefined) { out.path = pathKey.value } continue }
		if (linesKey) { if (out.lines === undefined) { out.lines = linesKey.value } continue }
		if (hideKey) { if (out.hide === undefined) { out.hide = hideKey.value } continue }
		break
	}
	return out;
}

/** 转义正则元字符（用于把块正文尾部当字面量匹配）。 */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 全文的行尾风格（'\r\n' 占多数用 CRLF，否则 LF）——用于把改过的行按原风格 join 回去。 */
export function detectEol(text: string): string {
	const crlf = (text.match(/\r\n/g) ?? []).length;
	const lf = (text.match(/\n/g) ?? []).length - crlf;
	return crlf > lf ? '\r\n' : '\n';
}

/* ---------- g-009 写回调试日志的描述工具（纯函数，便于离线夹具验证） ----------
 * 负责人明确要求把「代码块节区行数与编辑器不一致」事故的全部判断打进 console：
 * 中止分支 console.warn('[embed-code-file][g-009] 写回中止', {...})、成功
 * console.log('[embed-code-file][g-009] HIDE 写入', {...})。以下四个函数生成其中可序列化的字段。
 */

/** 文本摘要：行数 / 字符数 / 前 120 字符（避免把整篇笔记刷进控制台）。 */
export function describeText(text: string | null | undefined): { lines: number; chars: number; head: string } | null {
	if (text === null || text === undefined) { return null }
	return { lines: text.split('\n').length, chars: text.length, head: text.slice(0, 120) }
}

/** getSectionInfo 结果摘要（text 只取摘要，避免刷屏）；declaredLines 为 lineStart..lineEnd 的名义行数。 */
export function describeSectionInfo(info: { text: string; lineStart: number; lineEnd: number } | null): any {
	if (!info) { return null }
	return {
		lineStart: info.lineStart,
		lineEnd: info.lineEnd,
		textLines: info.text === null || info.text === undefined ? -1 : info.text.split('\n').length,
		textChars: info.text === null || info.text === undefined ? -1 : info.text.length,
		head: info.text === null || info.text === undefined ? '' : info.text.slice(0, 120),
		declaredLines: info.lineEnd - info.lineStart + 1,
	}
}

/**
 * **info.text 口径判定**（本次事故的核心未知量）：把渲染期记录的 info.text 与当前真实全文逐字节比对，
 * 得出它到底是「整文件」还是「节区切片」：
 * - infoTextIsWholeFile：info.text === 全文
 * - infoTextIsSectionSlice：info.text === 全文[lineStart..lineEnd]
 * - infoTextIsSectionSliceDotTrimmed：info.text === 该切片 trim 后的形式（Obsidian 可能裁过行首尾空白）
 */
export function describeInfoTextFlavor(log: any, info: { text: string; lineStart: number; lineEnd: number } | null, fullText: string): any {
	if (!info || typeof info.text !== 'string' || fullText === null || fullText === undefined) { return log }
	const lines = fullText.split('\n');
	const start = Math.max(0, Math.min(info.lineStart, lines.length));
	const end = Math.max(start, Math.min(info.lineEnd, lines.length - 1));
	const slice = lines.slice(start, end + 1).join('\n');
	log.infoTextIsWholeFile = info.text === fullText;
	log.infoTextIsSectionSlice = info.text === slice;
	log.infoTextIsSectionSliceDotTrimmed = info.text.trim() === slice.trim();
	return log
}

/** 围栏定位摘要（定位失败是唯一合法中止，故把候选与提示都打出来）。 */
export function describeFence(plan: { mode: string; matchedBy: string; startLine: number; endLine: number; candidates: Array<{ start: number; end: number; score: number }> }, hintStart: number): any {
	return {
		start: plan.startLine,
		end: plan.endLine,
		mode: plan.mode,
		matchedBy: plan.matchedBy,
		matchedByHint: plan.matchedBy,
		hintStart,
		candidates: plan.candidates.map((c) => ({ start: c.start, end: c.end, score: c.score })),
	}
}

/** HIDE 行改动摘要。 */
export function describeUpdate(plan: { ok: boolean; changed: boolean; reason: string; keyLineIndex: number; oldHide: string; newHide: string; newHideLine: string; insertAt: number }): any {
	return {
		ok: plan.ok,
		changed: plan.changed,
		reason: plan.reason,
		keyLineIndex: plan.keyLineIndex,
		oldHide: plan.oldHide,
		newHide: plan.newHide,
		newHideLine: plan.newHideLine,
		insertAt: plan.insertAt,
	}
}

/**
 * 围栏感知的候选块扫描（全文口径）：所有以 ```` ```embed- ```` 开头的围栏块，含开/收栏行号。
 * 收栏行只认「围栏符号后无内容」的裸围栏，故不会把块内正文误判成收栏；扫不到收栏行就丢弃该候选
 * （宁可不写也不猜边界）。
 */
export function findEmbedFenceBlocks(text: string): Array<{ start: number; end: number }> {
	const lines = text.split('\n');
	const out: Array<{ start: number; end: number }> = [];
	for (let i = 0; i < lines.length; i++) {
		if (!/^\s*(?:`{3,}|~{3,})\s*embed-/i.test(lines[i])) { continue }
		let end = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (isBareFence(lines[j])) { end = j; break }
		}
		if (end >= 0) { out.push({ start: i, end }) }
	}
	return out;
}

/** 归一化单行文本：去引号、去首尾空白、CRLF 行尾去掉 \r。 */
export function normalizeKeyText(value: string | undefined | null): string {
	if (value === undefined || value === null) { return '' }
	return String(value).replace(/["']/g, '').replace(/\r$/, '').trim();
}

/** 块正文尾部（去掉尾部空行、最多 3 行，逐行 strip）——多候选时用于消歧。 */
export function contentTailOf(text: string): string {
	const lines = text.split('\n');
	while (lines.length && lines[lines.length - 1].trim() === '') { lines.pop() }
	return lines.slice(-3).map((l) => l.trim()).join('\n');
}

/**
 * 在全文里按**围栏扫描**定位 HIDE 所属的 embed 块，并算出「只改 HIDE 那一行」之后的新全文。
 * - 定位优先用 lineStartHint（渲染时记录的节区起始行，通常就是开栏行），再用提示元数据
 *   （PATH / LINES / dataset HIDE / 正文尾部）在多个候选里消歧；只有定位失败才 ok=false。
 * - 只改/增/删 HIDE 那一行，其余行（含 CRLF）**字节级保留**：按 '\n' 切分再 join，行内 \r 不动。
 * - text 入参必须是**全文**；信息口径（整文件 or 节区切片）由调用方自行测试与日志判定。
 */
export function applyHideToFullText(fullText: string, hideSpec: string, hint: { start: number; end?: number } | null, meta?: EmbedMetadataHint): HideUpdatePlan {
	const lines = fullText.split('\n');
	// 行尾风格：按 \n 切分后每行可能带 \r。按原风格 join，拼接出的新行才不会把整篇换成混合行尾
	// （实测症状：CRLF 文件插入 HIDE 后该行变成 '\n'，往返再也回不到原字节）。
	const eol = detectEol(fullText);
	const spec = (hideSpec ?? '').trim();
	const blocks = findEmbedFenceBlocks(fullText);
	const hintStart = hint && isFinite(hint.start) ? Math.floor(hint.start) : -1;
	const hintEnd = hint && hint.end !== undefined && isFinite(hint.end) ? Math.floor(hint.end) : -1;
	const contentHint = meta && meta.contentTail !== undefined ? normalizeKeyText(meta.contentTail) : '';
	const hintPath = meta && meta.path !== undefined ? normalizeKeyText(meta.path) : '';
	const hintLines = meta && meta.lines !== undefined ? normalizeKeyText(meta.lines) : '';
	const hintHide = meta && meta.hideSpec !== undefined ? normalizeKeyText(meta.hideSpec) : '';

	const scored: EmbedFenceCandidate[] = blocks.map((b) => {
		const blockLines = lines.slice(b.start, b.end + 1);
		const metadata = extractEmbedMetadata(blockLines);
		let score = 0;
		// lineStartHint 落在开栏行/块内 → 强信号（真实渲染时 lineStart 就是开栏行）
		if (hintStart >= 0) {
			if (hintStart === b.start) { score += 1000 }
			else if (hintStart >= b.start && hintStart <= b.end) { score += 400 }
			else if (hintStart === b.end + 1) { score += 200 }
		}
		if (hintPath && normalizeKeyText(metadata.path) === hintPath) { score += 100 }
		if (hintLines && normalizeKeyText(metadata.lines) === hintLines) { score += 50 }
		if (hintHide && normalizeKeyText(metadata.hide) === hintHide) { score += 25 }
		if (contentHint && contentTailOf(blockLines.join('\n')) === contentHint) { score += 10 }
		return { start: b.start, end: b.end, path: metadata.path, lines: metadata.lines, hide: metadata.hide, score };
	});

	let mode: 'fence' | 'range' = 'fence';
	let matchedBy = '';
	let startLine = -1;
	let endLine = -1;

	const usable = scored.filter((c) => c.score > 0);
	if (scored.length) {
		let pick: EmbedFenceCandidate;
		if (scored.length === 1) { pick = scored[0]; matchedBy = usable.length ? 'fence-only-candidate(hint-matched)' : 'fence-only-candidate' }
		else if (usable.length) { pick = usable.slice().sort((a, b) => b.score - a.score)[0]; matchedBy = 'fence-scored' }
		else { pick = scored.slice().sort((a, b) => Math.abs(a.start - hintStart) - Math.abs(b.start - hintStart))[0]; matchedBy = 'fence-nearest' }
		startLine = pick.start;
		endLine = pick.end;
	} else if (hintStart >= 0 && hintStart <= lines.length - 1) {
		// 扫不到围栏才退回节区范围（[lineStart,lineEnd] 提示），并标注 matchedBy=range-hint
		mode = 'range';
		matchedBy = hintEnd >= 0 ? 'range-hint' : 'range-hint-single-line';
		startLine = Math.max(0, Math.min(hintStart, lines.length - 1));
		endLine = hintEnd >= 0 ? Math.max(startLine, Math.min(hintEnd, lines.length - 1)) : startLine;
	} else {
		return buildFailedPlan(fullText, spec, scored);
	}

	let end = endLine;
	if (end < startLine) { end = startLine }
	const textLines = lines.slice(startLine, end + 1);
	const text = textLines.join('\n');
	const keys = parseEmbedSectionKeys(text);
	const oldHide = normalizeKeyText(keys.hideValue);

	// ── 只改 HIDE 那一行；其余行原样保留（就地 splice，故全文任何位置都不会被重排/丢字符） ──
	let keyLineIndex = -1;
	let newHideLine = '';
	let insertAt = -1;

	if (keys.hideLineIndex !== null) {
		keyLineIndex = keys.hideLineIndex;
		if (spec === '') {
			textLines.splice(keyLineIndex, 1);
		} else if (oldHide === spec) {
			return {
				ok: true, reason: 'unchanged', matchedBy, mode, startLine, endLine: end, textLines, keyLineIndex,
				oldHide, newHide: spec, newHideLine: '', changed: false, newText: fullText, candidates: scored, insertAt: -1, text,
			};
		} else {
			const quote = keys.hideQuote || '"';
			newHideLine = 'HIDE: ' + quote + spec + quote;
			textLines[keyLineIndex] = newHideLine;
		}
	} else if (spec === '') {
		return {
			ok: true, reason: 'no-hide-key', matchedBy, mode, startLine, endLine: end, textLines, keyLineIndex: -1,
			oldHide: '', newHide: '', newHideLine: '', changed: false, newText: fullText, candidates: scored, insertAt: -1, text,
		};
	} else {
		// 插入点：各口径统一插在**键区之后**（HIDE 排在 LINES 之后，无 LINES 则 PATH 之后）；
		// 键区解析不到时，range 口径退回节区末尾，fence 口径退回收栏行之前。
		insertAt = keys.insertAt;
		if (keys.insertAt <= 0 && textLines.length > 1) {
			insertAt = mode === 'range' ? textLines.length : textLines.length - 1;
		}
		if (insertAt < 1) { insertAt = textLines.length }
		newHideLine = 'HIDE: "' + spec + '"';
		textLines.splice(insertAt, 0, newHideLine);
		keyLineIndex = insertAt;
	}

	const newText = lines.slice(0, startLine).concat(textLines, lines.slice(end + 1)).join(eol);
	const reason = keys.hideLineIndex !== null ? (spec === '' ? 'removed' : 'replaced') : 'inserted';
	return {
		ok: true, reason, matchedBy, mode, startLine, endLine: end, textLines, keyLineIndex, oldHide, newHide: spec,
		newHideLine, changed: newText !== fullText, newText, candidates: scored, insertAt, text,
	};
}

function buildFailedPlan(fullText: string, spec: string, candidates: EmbedFenceCandidate[]): HideUpdatePlan {
	return {
		ok: false, reason: '无法在全文里定位 embed 块（围栏扫描无候选且节区提示无效）',
		matchedBy: 'none', mode: 'fence', startLine: -1, endLine: -1, textLines: [], keyLineIndex: -1,
		oldHide: '', newHide: spec, newHideLine: '', changed: false, newText: fullText, candidates, insertAt: -1, text: '',
	};
}

/**
 * 最小 diff 计算：返回需要替换的字符区间与替换文本（公共前缀/后缀之外的部分）。
 * 行内切分（前缀退到行首、后缀退到行尾），保证写回时每次替换都覆盖完整行——
 * 编辑器路径据此只做**一次** replaceRange，保留 Ctrl+Z 撤销与其余内容零改动。
 */
export function computeMinimalDiff(oldText: string, newText: string): { prefix: number; oldSuffix: number; newSuffix: number; changed: boolean } {
	if (oldText === newText) { return { prefix: 0, oldSuffix: 0, newSuffix: 0, changed: false } }
	const oldLen = oldText.length;
	const newLen = newText.length;
	let p = 0;
	const maxPrefix = Math.min(oldLen, newLen);
	while (p < maxPrefix && oldText.charCodeAt(p) === newText.charCodeAt(p)) { p += 1 }
	let s = 0;
	const maxSuffix = Math.min(oldLen - p, newLen - p);
	while (s < maxSuffix && oldText.charCodeAt(oldLen - 1 - s) === newText.charCodeAt(newLen - 1 - s)) { s += 1 }
	// 行内对齐：把公共前缀退到行首（LF/CRLF 都退干净）。后缀侧「保留下来的尾巴」总以完整行开头，
	// 故行级改动必然得到「替换若干完整行」的一次性 diff。
	let prefix = p;
	while (prefix > 0 && oldText[prefix - 1] !== '\n') { prefix -= 1 }
	return { prefix, oldSuffix: oldLen - s, newSuffix: newLen - s, changed: true };
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
