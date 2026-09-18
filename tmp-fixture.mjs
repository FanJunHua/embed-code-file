// F-1 临时夹具（不提交）：行号列对齐/折行兜底的离线断言
import { analyseSrcLines, extractSrcLines, buildEmbedLineRows, buildFullFileRows, buildLineGutterPlan, resolveLineTops, contentLineCount, pickFirstPositiveRect, geometricLinePitch, resolveLinePitch,
  normalizeLineRanges, subtractLineRanges, rangesToSpec, parseHideSpec, applyHideToRows, hasVisibleCodeRow,
  rowsToSourceLineRanges, rowsToSourceLineSpec, lineStartOffsets, selectionRowRange, collectSourceLineNums, lineNumsToRanges, updateHideInSection,
  gutterSpanSourceLineNums, gutterSpanRangeToSourceLineNums, clampGutterSpanRange,
  applyHideToFullText, updateLinesInSection, describeLinesUpdate, computeMinimalDiff, describeText, describeSectionInfo, describeInfoTextFlavor, describeFence, describeUpdate,
  mergeConsecutiveDots, computeHideAllButtonRight, isUsableButtonRect, DEFAULT_CORE_BUTTON_SELECTORS,
  buildVisibleRowsForHide, findEmbedFenceBlocks, extractEmbedMetadata,
  dotsSegmentsOfRows, dotsSegmentId, buildExpandedRows, ghostNumsFromExpanded, ghostStartNumsOfExpanded, ghostEndNumsOfExpanded, restoreCompute, linesSpecToRanges } from './utils.ts';
import { normalizeLocale, initI18n, locale, t, tReason } from './i18n.ts';

let fail = 0;
const check = (cond, label) => { if (!cond) { fail++; console.log('  FAIL ' + label); } };

// ---------- 场景构造：长行(≥200字符) + 多段 LINES + 前导省略 + 段间 ... ----------
const total = 150;
const lines = [];
for (let i = 1; i <= total; i++) {
  lines.push(i % 10 === 0
    ? 'SRC_' + i + ' long: ' + 'x'.repeat(200)   // 每 10 行一条 200+ 字符长行（触发 pre-wrap 折行）
    : 'SRC_' + i);
}
const fullSrc = lines.join('\n');
const LINES = '5-20,45-60,80-95';                 // 前导省略 + 三段（段间有 ...）+ 尾部省略

const nums = analyseSrcLines(LINES);
const src = extractSrcLines(fullSrc, nums.slice());
const rows = buildEmbedLineRows(fullSrc, nums);
const srcLines = src.split('\n');
console.log(`场景 LINES "${LINES}"：正文 ${srcLines.length} 行 / 行模型 ${rows.length} 行`);

// ---------- 断言 1：数据层（复核） ----------
check(srcLines.length === rows.length, '数据层行数一致');
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r.dot) check(srcLines[i] === '...', `行${i + 1} dot↔...`);
  else check(srcLines[i] === lines[r.num - 1], `行${i + 1} ↔ 源第${r.num}行`);
}
console.log('断言1 数据层逐行对应：' + (fail === 0 ? 'PASS' : 'FAIL'));

// ---------- 断言 2：buildLineGutterPlan 对齐规则 ----------
// 2a exact：DOM 行 == 模型
let plan = buildLineGutterPlan(srcLines, rows, 'original');
check(plan.ok && plan.reason === 'exact', '2a exact');
check(plan.cells.length === srcLines.length, '2a cells 数 == DOM 行数');
let idx = 0;
for (const r of rows) {
  if (r.dot) check(plan.cells[idx] === '', `2a 行${idx + 1} 省略行留空`);
  else check(plan.cells[idx] === String(r.num), `2a 行${idx + 1} = ${r.num}`);
  idx++;
}
// 2b 尾随空元素（负责人实测形态：49 = 48 + 尾部换行）
const withTail = [...srcLines, ''];
const planTail = buildLineGutterPlan(withTail, rows, 'original');
check(planTail.ok && planTail.reason === 'trailing-blank' && planTail.cells.length === rows.length, '2b trailing-blank');
check(planTail.rowCount === rows.length, '2b rowCount=48 基准');
// 2c 前导空行
const planLead = buildLineGutterPlan(['', ...srcLines], rows, 'original');
check(planLead.ok && planLead.reason === 'leading-blank' && planLead.cells.length === srcLines.length + 1 && planLead.cells[0] === '' && planLead.cells[1] === String(rows[0].dot ? '' : rows[0].num), '2c leading-blank 补空单元格');
// 2d 不可解释 → 放弃
check(!buildLineGutterPlan(['', ...srcLines, '', 'x'], rows, 'original').ok, '2d 不可解释放弃');
// 2e 新行号跨段连续（"5-20,45-60,80-95" → 16+16+16=48 行 → 1..48）
const planNew = buildLineGutterPlan(srcLines, rows, 'new');
const nums5 = planNew.cells.filter(c => c !== '').map(Number);
check(nums5.length === 48 && nums5[0] === 1 && nums5[47] === 48 && nums5.every((v, i) => v === i + 1), '2e 新行号 1..48 跨段连续');
console.log('断言2 对齐规则（exact/trailing/leading/放弃/跨段新行号）：' + (fail === 0 ? 'PASS' : 'FAIL'));

// ---------- 断言 2f：resolveLineTops（F-5 行号纵坐标解析；取代统一行距假设） ----------
const r1 = resolveLineTops([100, 121, 142]);
check(!!r1 && Math.abs(r1.pitch - 21) < 0.001 && JSON.stringify(r1.tops) === JSON.stringify([100, 121, 142]), '2f 等距已知行：top/pitch 正确');
const r2 = resolveLineTops([100, null, 142]);
check(!!r2 && Math.abs(r2.pitch - 21) < 0.001 && Math.abs(r2.tops[1] - 121) < 0.01, '2f 空行按中位行距外推');
const r3 = resolveLineTops([null, 121, 142]);
check(!!r3 && Math.abs(r3.tops[0] - 100) < 0.01, '2f 首行缺失向前外推');
check(resolveLineTops([null, null, null]) === null, '2f 全部缺失返回 null（调用方回退等距排布）');
const r5 = resolveLineTops([100, 118, 140, 160]);
check(!!r5 && Math.abs(r5.pitch - 20) < 0.001, '2f 非等距取中位 pitch');
check(!!r5 && Math.abs(r5.tops[1] - 118) < 0.01 && Math.abs(r5.tops[3] - 160) < 0.01, '2f 已知 top 原样保留（不平滑）');
console.log('断言2f F-5 行号纵坐标解析：' + (fail === 0 ? 'PASS' : 'FAIL'));

// ---------- 断言 3：F-5 长块（48 行）与空行外推——本缺陷的回归锁 ----------
// 负责人第五轮现象：统一行距假设导致「行号间隔与代码间隔不一致」并逐行累积漂移。
// F-5 改为逐行绝对定位后，「已知 top 原样保留、零累积误差」即本缺陷的回归判据。
const longTops = [];
for (let i = 0; i < 48; i++) { longTops.push(100 + i * 19.69) }
const r6 = resolveLineTops(longTops);
check(!!r6 && Math.abs(r6.pitch - 19.69) < 0.01, '3a 48 行长块 pitch 解析');
check(!!r6 && r6.tops.every((t, i) => Math.abs(t - longTops[i]) < 0.01), '3a 48 行 top 逐行原样保留（零累积误差）');
const withGaps = longTops.map((t, i) => (i % 7 === 3 ? null : t));
const r7 = resolveLineTops(withGaps);
check(!!r7 && r7.tops.every((t, i) => Math.abs(t - longTops[i]) < 0.02), '3b 含空行（每 7 行 1 空）外推误差 < 0.02px');
check(!!r7 && Math.abs(r7.pitch - 19.69) < 0.01, '3b 含空行时 pitch 仍为真实行距');
console.log('断言3 F-5 长块与空行外推：' + (fail === 0 ? 'PASS' : 'FAIL'));

// ---------- 断言 4：F-6 行距三源与零宽 rect 清洗（g-007 根因修复的回归锁） ----------
// 负责人实机数据：真实行距 22.5，而 code computed line-height = 19.6875、F-3 探针 = 19.69 都是错的。
check(contentLineCount('a\nb\n') === 2 && contentLineCount('a\nb') === 2 && contentLineCount('a\n') === 1 && contentLineCount('') === 0, '4a 内容行数（去尾部空段）');
check(Math.abs(geometricLinePitch(375.2, 0, 0, 15.2, 17) - 22.5) < 1e-9, '4b blk0 几何行距 = 22.5（实机 codeH/内容行数/内容高）');
check(Math.abs(geometricLinePitch(1005.2, 0, 0, 15.2, 45) - 22.5) < 1e-9, '4b blk1 几何行距 = 22.5');
check(Math.abs(geometricLinePitch(690.2, 0, 0, 15.2, 31) - 22.5) < 1e-9, '4b blk2 几何行距 = 22.5');
check(Math.abs(geometricLinePitch(395.2, 10, 10, 15.2, 17) - 22.5) < 1e-9, '4c 扣除上下 padding');
check(geometricLinePitch(0, 0, 0, 15.2, 17) === 0 && geometricLinePitch(375.2, 0, 0, 0, 17) === 0 && geometricLinePitch(375.2, 0, 0, 15.2, 1) === 0, '4d 不可推算返回 0');
// 4e 零宽 rect 清洗：blk0 第 2 行实机 rects（首个 w=0 且 top 属上一行）
check(pickFirstPositiveRect([{ top: 96.22, width: 0, height: 15.2 }, { top: 118.72, width: 15.38, height: 15.2 }]).top === 118.72, '4e 跳过零宽 rect（实机 blk0 数据）');
check(pickFirstPositiveRect([{ top: 5, width: 0, height: 1 }]) === null, '4e 全零宽返回 null');
check(pickFirstPositiveRect([{ top: 5, width: 1, height: 1 }]).top === 5, '4e 首个有宽度 rect 原样返回');
// 4f 行距取值链：实测优先，其后几何 → pre 计算行高 → code 计算行高 → 字号×1.5 → 21
const pick = (o) => resolveLinePitch(Object.assign({ measured: 0, geometric: 0, preComputed: 0, codeComputed: 0, fontSize: 0 }, o));
check(pick({ measured: 22.5, geometric: 19.69, preComputed: 21 }).source === 'measured' && pick({ measured: 22.5, geometric: 19.69 }).pitch === 22.5, '4f 实测中位差优先（不被探针/计算样式污染）');
check(pick({ geometric: 22.5, preComputed: 21 }).source === 'geometric', '4f 几何推算兜底');
check(pick({ preComputed: 22.5 }).source === 'pre-line-height' && pick({ codeComputed: 19.6875 }).source === 'code-line-height', '4f 计算样式兜底链');
check(pick({ fontSize: 14 }).pitch === 21 && pick({}).pitch === 21 && pick({}).source === 'fallback-21', '4f 终末兜底');
console.log('断言4 F-6 行距三源/内容行数/零宽 rect 清洗：' + (fail === 0 ? 'PASS' : 'FAIL'));

// ---------- 断言 5：g-009 选中隐藏（HIDE 键）----------
let failBase = fail;
// 5a HIDE 解析：空/缺省/非法/越界/正常 + 宽容度（引号、空格、单点）
check(parseHideSpec(undefined, 250).ranges.length === 0 && !parseHideSpec(undefined, 250).requested, '5a 缺省 → 无区间且未请求');
check(parseHideSpec('', 250).ranges.length === 0 && !parseHideSpec('', 250).requested, '5a 空串 → 无区间且未请求');
check(parseHideSpec('   ', 250).ranges.length === 0, '5a 纯空白 → 无区间');
const hNorm = parseHideSpec('"183-193,200"', 250);
check(JSON.stringify(hNorm.ranges) === JSON.stringify([{ start: 183, end: 193 }, { start: 200, end: 200 }]), '5a 正常（带引号/单点/区间）');
const hMessy = parseHideSpec("' 200 , 183 - 193 '", 250);
check(JSON.stringify(hMessy.ranges) === JSON.stringify([{ start: 183, end: 193 }, { start: 200, end: 200 }]), '5a 乱序 + 空格 + 单引号 → 排序归一');
const hOOR = parseHideSpec('0-99999', 250);
check(JSON.stringify(hOOR.ranges) === JSON.stringify([{ start: 1, end: 250 }]) && hOOR.warnings.length === 1, '5a 越界裁到末行并 warn');
const hBad = parseHideSpec('abc,183-193,--,1-2-3', 250);
check(JSON.stringify(hBad.ranges) === JSON.stringify([{ start: 183, end: 193 }]) && hBad.warnings.length === 3 && hBad.requested, '5a 非法片段忽略 + 保留合法片段 + warn');
const hMerge = parseHideSpec('5,6,7,9-10,8', 250);
check(JSON.stringify(hMerge.ranges) === JSON.stringify([{ start: 5, end: 10 }]), '5a 相邻/重叠自动合并');
check(parseHideSpec(183, 250).ranges.length === 1, '5a YAML 数字标量也容忍');
check(parseHideSpec('abc', 250).ranges.length === 0 && parseHideSpec('abc', 250).requested, '5a 全非法 → 空区间但标记 requested（调用方 warn 后按未设置渲染）');
console.log('断言5a HIDE 解析：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5b 区间集合运算（本需求实例回归锁）：164-168,172-208 减去 183-193
const gView = [{ start: 164, end: 168 }, { start: 172, end: 208 }];
const gHide = [{ start: 183, end: 193 }];
const gDiff = subtractLineRanges(gView, gHide, 1000);
check(JSON.stringify(gDiff) === JSON.stringify([{ start: 164, end: 168 }, { start: 172, end: 182 }, { start: 194, end: 208 }]), '5b 164-168,172-208 − 183-193 = 164-168,172-182,194-208');
check(rangesToSpec(gDiff, 1000) === '164-168,172-182,194-208', '5b 序列化与实例期望文本一致');
check(subtractLineRanges(gView, [{ start: 100, end: 300 }], 1000).length === 0, '5b 全遮蔽 → 空集合');
check(subtractLineRanges(gView, [], 1000).length === 2, '5b 隐藏为空 → 原集合');
check(JSON.stringify(subtractLineRanges([{ start: 5, end: 10 }], [{ start: 7, end: 7 }], 1000)) === JSON.stringify([{ start: 5, end: 6 }, { start: 8, end: 10 }]), '5b 挖单行');
check(JSON.stringify(subtractLineRanges([{ start: 5, end: 10 }], [{ start: 10, end: 20 }], 1000)) === JSON.stringify([{ start: 5, end: 9 }]), '5b 尾部相交裁剪');
check(JSON.stringify(subtractLineRanges([{ start: 5, end: 10 }], [{ start: 1, end: 5 }], 1000)) === JSON.stringify([{ start: 6, end: 10 }]), '5b 头部相交裁剪');
console.log('断言5b 区间集合 subtract：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5c HIDE 应用到行模型：被剔除行就地变 dots（复用既有 ... 语义），连续的 dots 合并为一行
const gSrc = Array.from({ length: 250 }, (_, i) => 'SRC_' + (i + 1)).join('\n');
const gRows = buildFullFileRows(gSrc);
const gApplied = applyHideToRows(gRows, gHide);
check(gApplied.rows.length === gRows.length - 10, '5c 连续隐藏合并：11 行 → 1 个 dot（净减 10 行）');
check(gApplied.rows.filter(r => r.dot).length === 1 && gApplied.hiddenNums.length === 11, '5c 隐藏 11 行只在原位置留 1 个 dots');
check(gApplied.rows[181].num === 182 && gApplied.rows[182].dot && gApplied.rows[183].num === 194, '5c 合并后 182 与 194 紧邻同一个 dot，边界行不受影响');
// 实例组合：LINES = 164-208，HIDE = 183-193 → 合并后应只剩「前导 dots + 尾部 dots」两个省略段
const gLINES = '164-208';
const gBaseRows = buildEmbedLineRows(gSrc, analyseSrcLines(gLINES));
const gVisibleSpec = rowsToSourceLineRanges(gBaseRows).map(r => r.start === r.end ? String(r.start) : r.start + '-' + r.end).join(',');
check(gVisibleSpec === '164-208', '5c LINES 164-208 → 可隐藏集合 164-208');
const gCombined = applyHideToRows(gBaseRows, gHide);
check(gCombined.hiddenNums.length === 11, '5c 组合（LINES 164-208 + HIDE 183-193）：隐藏 11 行');
check(gCombined.rows.filter(r => r.dot).length === 3, '5c 组合：前导 dots + 中间 dots + 尾部 dots = 3 个 dots（原 13 个）');
check(gCombined.rows.length === gBaseRows.length - 10, '5c 组合：行数 = 原模型 − 10（10 个多余 dots 被合并）');
const gDotIdx = gCombined.rows.findIndex((r, i) => r.dot && i > 0 && gCombined.rows[i - 1].num === 182);
check(gDotIdx > 0 && gCombined.rows[gDotIdx].dot && gCombined.rows[gDotIdx + 1].num === 194, '5c 组合：182 与 194 之间只有 1 个 dot');
check(JSON.stringify(gCombined.hiddenNums) === JSON.stringify([183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193]), '5c 组合：隐藏行号恰为 183..193');
check(rangesToSpec(subtractLineRanges(rowsToSourceLineRanges(gBaseRows), gHide, 250), 250) === '164-182,194-208', '5c 组合后可见集合 = 164-182,194-208');
check(rangesToSpec(rowsToSourceLineRanges(gCombined.rows), 250) === '164-182,194-208', '5c 变换后行模型自证：与 subtract 结果一致（HIDE 与既有 ... 同源）');
// 与 LINES 无交集 → 不隐藏任何行；LINES 全被 HIDE 覆盖 → 无可见代码行（调用方拒绝）
check(applyHideToRows(buildEmbedLineRows(gSrc, analyseSrcLines('5-20')), [{ start: 183, end: 193 }]).hiddenNums.length === 0, '5c HIDE 与 LINES 无交集 → 零隐藏');
check(!hasVisibleCodeRow(applyHideToRows(buildEmbedLineRows(gSrc, analyseSrcLines('5-20')), [{ start: 5, end: 20 }]).rows), '5c LINES 全被隐藏 → 无可见代码行（调用方拒绝）');
check(hasVisibleCodeRow(gCombined.rows), '5c 部分隐藏仍有可见行');
console.log('断言5c HIDE 应用与 LINES 组合：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5d HIDE 序列化 / 往返：空集合 → ''（键被移除，不留 HIDE: ""）
const seg = [{ start: 10, end: 12 }, { start: 11, end: 15 }, { start: 20, end: 20 }];
check(rangesToSpec(seg, 1000) === '10-15,20', '5d 乱序/重叠/相邻 → 10-15,20');
check(rangesToSpec([], 1000) === '', '5d 空集合 → 空串（调用方移除 HIDE 行）');
check(rangesToSpec([{ start: 200, end: 100 }], 1000) === '100-200', '5d 反向区间容错');
check(rangesToSpec(normalizeLineRanges([{ start: 1, end: 5 }], 3), 3) === '1-3', '5d 越界裁到 maxLine');
check(parseHideSpec(rangesToSpec(seg, 1000), 1000).ranges.length === 2, '5d 序列化 → 解析往返一致');
console.log('断言5d HIDE 序列化/往返：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5e 选区行范围（纯函数：字符偏移 + 行模型）
// 段落模型：dots / 5 / 6 / 7 / dots / 12 / 13；渲染文本 7 行（末行为空，对应尾随换行）
const selRows = [{ dot: true, num: 0 }, { dot: false, num: 5 }, { dot: false, num: 6 }, { dot: false, num: 7 }, { dot: true, num: 0 }, { dot: false, num: 12 }, { dot: false, num: 13 }];
const selText = '...\nb\nc\nd\n...\nf\ng\n';
const so = lineStartOffsets(selText, selRows.length);
check(JSON.stringify(so) === JSON.stringify([0, 4, 6, 8, 10, 14, 16]), '5e 行首偏移表（7 行，末行为空）');
check(selectionRowRange(so, selRows.length, 5, 5, selText.length) === null, '5e 空选区 → null');
check(selectionRowRange(so, selRows.length, 4, 4, selText.length) === null, '5e 起止相等 → null');
check(selectionRowRange(so, selRows.length, 6, 6, selText.length) === null, '5e 起止都在行首且相等 → null');
// 从行内 5（第 2 行 'b' 中间）到行首 6（第 3 行行首）：只含第 2 行
const s1 = selectionRowRange(so, selRows.length, 5, 6, selText.length);
check(!!s1 && s1.startLine === 2 && s1.endLine === 2 && s1.count === 1, '5e 终点恰在下一行行首 → 不含该行');
check(selectionRowRange(so, selRows.length, 4, 6, selText.length).count === 1, '5e 终点=下一行行首时结束行回退一行');
// 选中第 2..4 行（'b\nc\nd'）：偏移 4 → 10
const s2 = selectionRowRange(so, selRows.length, 4, 10, selText.length);
check(!!s2 && s2.startLine === 2 && s2.endLine === 4 && s2.count === 3, '5e 单/多行选区');
// 单行（只选第 6 行 'f'：10+... 终点 16 为末行行首 → 结束行回退）
const s2b = selectionRowRange(so, selRows.length, 14, 16, selText.length);
check(!!s2b && s2b.startLine === 6 && s2b.endLine === 6 && s2b.count === 1, '5e 单行选区（终点在末行行首）');
// 跨 dots 行：第 2 行 → 第 5 行（含中间的 dots）
const s3 = selectionRowRange(so, selRows.length, 4, 14, selText.length);
check(!!s3 && s3.startLine === 2 && s3.endLine === 5 && s3.count === 4, '5e 跨 dots 行选区');
check(JSON.stringify(collectSourceLineNums(selRows, s3.startIndex, s3.endIndex)) === JSON.stringify([5, 6, 7]), '5e 跨 dots：dots 不产生隐藏行号（只取选区内的真实行）');
check(JSON.stringify(collectSourceLineNums(selRows, 0, selRows.length - 1)) === JSON.stringify([5, 6, 7, 12, 13]), '5e 整块 → 全部代码行（调用方据此拒绝）');
// 末行无尾随换行（退化形态）：偏移表恒有 lineCount 项，末行行首 < 文本末尾（行内字符可选）
const noTail = selText.slice(0, -1);
const soNoTail = lineStartOffsets(noTail, selRows.length);
check(soNoTail.length === selRows.length && soNoTail[selRows.length - 1] === noTail.length - 1, '5e 末行无换行：偏移表长度 = 模型行数，末项 = 末行行首（文本末尾 −1）');
const sAll = selectionRowRange(soNoTail, selRows.length, 0, noTail.length, noTail.length);
check(!!sAll && sAll.count === selRows.length, '5e 末行无换行时整块选中覆盖全部 7 行');
// 真实渲染形态（DOM 文本带尾随换行 → 文本行数 = 模型行数 + 1）：整块选中 → 覆盖全部行 → 调用方拒绝
const tailOffsets = lineStartOffsets(selText, selRows.length + 1);
check(tailOffsets.length === selRows.length + 1 && JSON.stringify(tailOffsets.slice(0, selRows.length)) === JSON.stringify(so), '5e 带尾随换行：偏移表 = 模型各行行首 + 尾随空行行首');
const tailRows = selRows.concat([{ dot: true, num: 0 }]);
const sAllTail = selectionRowRange(tailOffsets, tailRows.length, 0, selText.length, selText.length);
check(!!sAllTail && sAllTail.count === tailRows.length && sAllTail.endIndex === tailRows.length - 1, '5e 整块选中（真实尾随换行）→ 覆盖全部行（供调用方拒绝）');
// 末行本身为空：其行首偏移 = 文本长度，只选到文本末尾即包含末行
const emptyTailText = ['...', 'b', 'c', 'd', '...', 'f', ''].join('\n');
const emptyTailOffsets = lineStartOffsets(emptyTailText, 7);
check(emptyTailOffsets.length === 7 && emptyTailOffsets[6] === emptyTailText.length, '5e 末行为空时行首偏移 = 文本长度（使末行可被覆盖的形态）');
const emptyTailSel = selectionRowRange(emptyTailOffsets, 7, 0, emptyTailText.length, emptyTailText.length);
check(!!emptyTailSel && emptyTailSel.count === 7 && emptyTailSel.endIndex === 6, '5e 末行为空时整块选中覆盖 7 行');
const emptyTailNoBlank = ['...', 'b', 'c', 'd', '...', 'f'].join('\n');
check(selectionRowRange(lineStartOffsets(emptyTailNoBlank, 6), 6, 0, emptyTailNoBlank.length, emptyTailNoBlank.length).count === 6, '5e 无尾随空行时整块选中覆盖 6 行');
// 最后一行有字符但无尾随换行：末行行首 < 文本长度，行内可见
const noNewlineTail = ['a', 'b'].join('\n');
const nnOffsets = lineStartOffsets(noNewlineTail, 2);
check(nnOffsets.length === 2 && nnOffsets[1] === 2 && selectionRowRange(nnOffsets, 2, 0, noNewlineTail.length, noNewlineTail.length).count === 2, '5e 末行有字符且无换行 → 整块覆盖 2 行');
// 行列不一致 / 非法偏移 → null（宁可不动作）
check(selectionRowRange(so, selRows.length + 1, 4, 10, selText.length) === null, '5e 行数不一致 → null');
check(selectionRowRange(so, selRows.length, NaN, 10, selText.length) === null, '5e 非法偏移 → null');
check(selectionRowRange([], 0, 0, 5, 5) === null, '5e 空模型 → null');
// 单行块（模型 1 行代码，渲染文本 "x\n"）：偏移表 = [0]（文本末尾即末行行首，行内无可选字符），
// 整块选中 → count=1 → 调用方拒绝
const oneText = 'x\n';
const oneOffsets = lineStartOffsets(oneText, 1);
check(JSON.stringify(oneOffsets) === JSON.stringify([0]), '5e 单行块偏移表 = [0]（末行行首钳到文本末尾）');
const oneSel = selectionRowRange(oneOffsets, 1, 0, oneText.length, oneText.length);
check(!!oneSel && oneSel.count === 1 && oneSel.endIndex === 0, '5e 单行块选中该行 = 整块（count=1 → 拒绝）');console.log('断言5e 选区行范围映射：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5f section 写回（HIDE 插入/替换/删除，其余行字节级保留）
const secA = ['```embed-ts', 'PATH: "vault://a.ts"', 'TITLE: "t"', '```'].join('\n');
const uA = updateHideInSection(secA, '183-193,200');
check(uA.ok && uA.changed && uA.text === ['```embed-ts', 'PATH: "vault://a.ts"', 'HIDE: "183-193,200"', 'TITLE: "t"', '```'].join('\n'), '5f 无 HIDE 且无 LINES → 插到 PATH 之后');
const secB = ['```embed-ts', 'PATH: "vault://a.ts"', 'LINES: "164-208"', 'TITLE: "t"', '```'].join('\n');
const uB = updateHideInSection(secB, '183-193');
check(uB.ok && uB.text === ['```embed-ts', 'PATH: "vault://a.ts"', 'LINES: "164-208"', 'HIDE: "183-193"', 'TITLE: "t"', '```'].join('\n'), '5f 有 LINES → 插到 LINES 之后（其余行原样）');
const uC = updateHideInSection(uB.text, '183-193,200');
check(uC.ok && uC.changed && uC.text.includes('HIDE: "183-193,200"') && uC.text.split('\n').length === 6, '5f 已有 HIDE → 就地替换保持顺序');
const uC2 = updateHideInSection(uC.text, '183-193,200');
check(uC2.ok && !uC2.changed && uC2.text === uC.text, '5f 值未变 → 不产生写入');
const uD = updateHideInSection(uC.text, '');
check(uD.ok && uD.changed && !uD.text.includes('HIDE'), '5f 空值 → 移除 HIDE 行（不留 HIDE: ""）');
check(uD.text === secB, '5f 移除后回到原 section（往返）');
const uE = updateHideInSection(secB, '');
check(uE.ok && !uE.changed && uE.text === secB, '5f 无 HIDE 且清空 → 无改动');
const uF = updateHideInSection(["```embed-ts", "PATH: 'vault://a.ts'", '```'].join('\n'), '5,6');
check(uF.text.includes("PATH: 'vault://a.ts'") && uF.text.includes('HIDE: "5,6"'), '5f 保留原有单引号风格');
const uG = updateHideInSection(['```embed-ts', 'PATH: "vault://a.ts"', '```', 'CODE_BODY_LINE', '```'].join('\n'), '7-8');
check(uG.ok && uG.text === ['```embed-ts', 'PATH: "vault://a.ts"', 'HIDE: "7-8"', '```', 'CODE_BODY_LINE', '```'].join('\n'), '5f 收栏行终止元数据区（正文行不被误判为元数据，HIDE 插在收栏行之前）');
const uH = updateHideInSection(['```embed-ts', 'PATH: "vault://a.ts"', 'LINES: "1-5"', '', '```'].join('\n'), '3');
check(uH.ok && uH.text.split('\n')[3] === 'HIDE: "3"', '5f 空行终止元数据区但仍按 LINES 之后插入');
console.log('断言5f HIDE 写回 section：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5g 行号列（gutter）交互：span 索引 → 源行号反查（g-009 增量）
// 模型：dots / 183 / 184 / dots / 195 / 196 —— dots 无 span、已隐藏行无 span，
// 故 span 序列是**压缩后**的 [183,184,195,196]（span#0 ↔ 模型行 1、span#3 ↔ 模型行 5）
const gutRows = [{ dot: true, num: 0 }, { dot: false, num: 183 }, { dot: false, num: 184 }, { dot: true, num: 0 }, { dot: false, num: 195 }, { dot: false, num: 196 }];
const gutMap = gutterSpanSourceLineNums(gutRows);
check(JSON.stringify(gutMap) === JSON.stringify([183, 184, 195, 196]), '5g span 序列的源行号（dots 不产生 span，故已压缩）');
check(gutterSpanRangeToSourceLineNums(gutRows, 0, 0).length === 1 && gutterSpanRangeToSourceLineNums(gutRows, 0, 0)[0] === 183, '5g 单击第 1 个 span → 源行 183');
check(JSON.stringify(gutterSpanRangeToSourceLineNums(gutRows, 3, 3)) === JSON.stringify([196]), '5g 单击第 4 个 span → 源行 196（跨过两个 dots）');
check(JSON.stringify(gutterSpanRangeToSourceLineNums(gutRows, 0, 1)) === JSON.stringify([183, 184]), '5g 拖选 span 0-1 → 源行 183,184');
check(JSON.stringify(gutterSpanRangeToSourceLineNums(gutRows, 0, 3)) === JSON.stringify([183, 184, 195, 196]), '5g 拖选跨 dots 的 span 0-3 → 四个源行（dots 不产生行号）');
check(JSON.stringify(gutterSpanRangeToSourceLineNums(gutRows, 2, 0)) === JSON.stringify([183, 184, 195]), '5g 反向拖选（index 归一化为 0..2）');
check(gutterSpanRangeToSourceLineNums(gutRows, 3, 99).length === 1 && gutterSpanRangeToSourceLineNums(gutRows, 3, 99)[0] === 196, '5g 越界结束索引容错（截到最后一个 span）');
check(gutterSpanRangeToSourceLineNums(gutRows, 99, 200).length === 0, '5g 全越界 → 空集合（调用方 Notice，不写文件）');
check(gutterSpanRangeToSourceLineNums(gutRows, -5, -1).length === 0, '5g 负索引 → 空集合');
// 整块被选满：全部可见代码行 → 调用方据此拒绝（沿用 hasVisibleCodeRow 语义）
const allGut = gutterSpanRangeToSourceLineNums(gutRows, 0, 3);
check(allGut.length === 4 && !hasVisibleCodeRow(applyHideToRows(gutRows, lineNumsToRanges(allGut)).rows), '5g 选满全部代码行 → 拒绝（无可见行）');
// 「新行号」模式：span 文本是 1..N，**绝不能**当源行号；反查必须走位置映射
const newPlan = buildLineGutterPlan(gutRows.map((r) => (r.dot ? '...' : 'CODE')), gutRows, 'new');
const newCells = newPlan.cells.filter((c) => c !== '');
check(newPlan.ok && JSON.stringify(newCells) === JSON.stringify(['1', '2', '3', '4']), '5g 新行号模式 span 文本为 1..4（与源行号不同）');
check(gutterSpanSourceLineNums(gutRows).length === newCells.length, '5g span 个数 == 反查表项数（位置映射自洽）');
const newReverse = gutterSpanRangeToSourceLineNums(gutRows, 0, 1);
check(JSON.stringify(newReverse) === JSON.stringify([183, 184]) && newReverse[0] !== Number(newCells[0]), '5g 新行号模式下反查得到源行号 183/184（不是 span 文本 1/2）');
// 已隐藏行没有 span：模型里被 HIDE 掉的行不出现，故索引空间随之收窄
const hiddenGut = applyHideToRows(gutRows, [{ start: 183, end: 183 }]).rows;
check(JSON.stringify(gutterSpanSourceLineNums(hiddenGut)) === JSON.stringify([184, 195, 196]), '5g 183 被隐藏后其 span 消失（索引空间收窄）');
check(JSON.stringify(gutterSpanRangeToSourceLineNums(hiddenGut, 0, 0)) === JSON.stringify([184]), '5g 隐藏后第 1 个 span 变成源行 184');
// 空模型 / 全 dots：没有任何 span → 空集合
check(gutterSpanRangeToSourceLineNums([], 0, 0).length === 0, '5g 空模型 → 空集合');
check(gutterSpanRangeToSourceLineNums([{ dot: true, num: 0 }, { dot: true, num: 0 }], 0, 1).length === 0, '5g 全 dots（整块已隐藏）→ 空集合');
// clampGutterSpanRange：拖选索引空间只有真实 span 个数（dots 不占位）
check(JSON.stringify(clampGutterSpanRange(gutRows, 0, 0)) === JSON.stringify({ start: 0, end: 0 }), '5g clamp：单击第 1 个 span');
check(JSON.stringify(clampGutterSpanRange(gutRows, 0, 99)) === JSON.stringify({ start: 0, end: 3 }), '5g clamp：拖到越界 → 截到最后一个 span（3，而非模型行数 5）');
check(JSON.stringify(clampGutterSpanRange(gutRows, 3, 0)) === JSON.stringify({ start: 0, end: 3 }), '5g clamp：反向拖选归一化');
check(JSON.stringify(clampGutterSpanRange(gutRows, -3, 1)) === JSON.stringify({ start: 0, end: 1 }), '5g clamp：负索引截到 0');
check(JSON.stringify(clampGutterSpanRange(gutRows, 99, 200)) === JSON.stringify({ start: 3, end: 3 }), '5g clamp：完全越界 → 截到最后一个 span（宁可截断也不错位）');
check(clampGutterSpanRange([], 0, 0) === null && clampGutterSpanRange([{ dot: true, num: 0 }], 0, 0) === null, '5g clamp：无任何 span → null');
check(JSON.stringify(clampGutterSpanRange(hiddenGut, 0, 99)) === JSON.stringify({ start: 0, end: 2 }), '5g clamp：隐藏一行后索引空间收窄（3 个 span）');
console.log('断言5g 行号列 span → 源行号反查：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5h 写回修复：applyHideToFullText（全文口径 + 围栏定位 + 最小 diff）
// 事故场景：代码块**不覆盖整个文件**（前有 frontmatter、后有正文），旧守卫会恒真中止
const F = '```';
const fileLines = [
  '---', 'title: note', '---', '',
  '前言文字', '',
  F + 'embed-ts', 'PATH: "vault://src/demo.ts"', 'LINES: "164-208"', F,
  '源码正文',
  F, '',
  '中间文字', '',
  F + 'embed-ts', 'PATH: "vault://src/other.ts"', F,
  '另一段正文',
  F, '',
  '结尾文字',
];
const fullFile = fileLines.join('\n');
// 5h-1 单块 + HIDE 插到 LINES 之后，且全文其余行字节级不变
const plan1 = applyHideToFullText(fullFile, '183-193', { start: 6, end: 11 }, { path: 'vault://src/demo.ts', lines: '164-208' });
check(plan1.ok && plan1.mode === 'fence' && plan1.startLine === 6 && plan1.endLine === 9, '5h 围栏定位：startLine=6 endLine=9（块不覆盖整个文件时不再中止）');
check(plan1.matchedBy.indexOf('fence') === 0, '5h matchedBy 标注为 fence 系');
check(plan1.keyLineIndex === 3, '5h HIDE 插到 LINES 之后（keyLineIndex=3）');
const expect1 = fileLines.slice();
expect1.splice(9, 0, 'HIDE: "183-193"');
check(plan1.newText === expect1.join('\n'), '5h 只改 HIDE 一行：其余行（含前后正文）字节级不变');
check(plan1.newText.split('\n').length === fileLines.length + 1, '5h 行数 +1（新增一条键行）');
// 5h-2 已有 HIDE 时只替换该行 → 行数不变
const plan2 = applyHideToFullText(plan1.newText, '183-193,200', { start: 6, end: 12 });
check(plan2.ok && plan2.reason === 'replaced' && plan2.changed && plan2.newText.split('\n').length === fileLines.length + 1, '5h 已有 HIDE → 就地替换（行数不变）');
// 5h-3 往返幂等：同值再写一次 changed=false
const plan3 = applyHideToFullText(plan2.newText, '183-193,200', { start: 6, end: 12 });
check(plan3.ok && !plan3.changed && plan3.reason === 'unchanged' && plan3.newText === plan2.newText, '5h 幂等：第二次写同值 changed=false');
// 5h-4 清空 → 移除 HIDE 行，精确回到原文件
const plan4 = applyHideToFullText(plan2.newText, '', { start: 6, end: 12 });
check(plan4.ok && plan4.reason === 'removed' && plan4.newText === fullFile, '5h 清空 → 删除 HIDE 行并精确回到原文件');
// 5h-5 多 embed 块：靠 lineStartHint/PATH 命中正确块（另一个块不得被动到）
const plan5 = applyHideToFullText(fullFile, '9-10', { start: 15, end: 18 }, { path: 'vault://src/other.ts' });
check(plan5.ok && plan5.startLine === 15 && plan5.endLine === 17, '5h 多块：命中第二个块（startLine=15）');
const p5 = plan5.newText;
check(p5.indexOf('HIDE: "9-10"') > p5.indexOf('other.ts') && p5.indexOf('HIDE: "9-10"') < p5.indexOf('另一段正文'), '5h 多块：HIDE 写在第二个块内（第一个块未动）');
check(p5.indexOf('LINES: "164-208"') > 0 && p5.indexOf('demo.ts') > 0, '5h 多块：第一个块内容原样保留');
// 5h-6 完全扫不到围栏 → 退回节区范围（range-hint），仍按「键区之后」插入
const noFence = ['# 标题', '', 'PATH: "vault://x.ts"', 'LINES: "1-5"', '', '正文'];
const plan6 = applyHideToFullText(noFence.join('\n'), '3', { start: 2, end: 4 });
check(plan6.ok && plan6.mode === 'range' && plan6.matchedBy.indexOf('range-hint') === 0, '5h 无围栏 → 退回 range-hint 口径');
check(plan6.newText === ['# 标题', '', 'PATH: "vault://x.ts"', 'LINES: "1-5"', 'HIDE: "3"', '', '正文'].join('\n'), '5h range 口径：HIDE 插在 LINES 之后，其余行不变');
// 5h-7 定位失败是唯一合法中止
const plan7 = applyHideToFullText('纯文本无代码块', '3', { start: -1 });
check(!plan7.ok && plan7.reason.indexOf('无法在全文里定位') === 0 && plan7.changed === false && plan7.newText === '纯文本无代码块', '5h 定位失败 → ok=false 且不改文本');
// 5h-8 节区口径输入不误伤：仅在该切片内改键、不丢字符
const sliceText = [F + 'embed-ts', 'PATH: "vault://a.ts"', 'LINES: "1-9"', '代码行1', '代码行2', F].join('\n');
const plan8 = applyHideToFullText(sliceText, '5', { start: 0, end: 5 });
check(plan8.ok && plan8.newText === [F + 'embed-ts', 'PATH: "vault://a.ts"', 'LINES: "1-9"', 'HIDE: "5"', '代码行1', '代码行2', F].join('\n'), '5h 节区口径输入：只加一行 HIDE，其余字符不丢');
// 5h-9 CRLF 保留：全文按 \n 切分，行内 \r 原样保留
const crlf = ['---', F + 'embed-ts', 'PATH: "vault://c.ts"', F, 'body', F].join('\r\n');
const plan9 = applyHideToFullText(crlf, '7', { start: 1, end: 4 });
check(plan9.ok && plan9.newText.indexOf('HIDE: "7"\r\n') > 0 && plan9.newText.split('\r\n').length === crlf.split('\r\n').length + 1, '5h CRLF：新行带 \\r 且原有行尾不被改写');
// 5h-10 computeMinimalDiff：行内对齐的最小替换
const d1 = computeMinimalDiff('a\nb\nc', 'a\nB\nc');
check(d1.changed && d1.prefix === 2 && d1.oldSuffix === 3 && d1.newSuffix === 3, '5h 最小 diff：单行替换精确到该行（替换区间 = "b" → "B"）');
const d2 = computeMinimalDiff('a\nb', 'a\nb\nc');
check(d2.changed && d2.prefix === 2 && d2.oldSuffix === 3 && d2.newSuffix === 5, '5h 最小 diff：追加新行只替换尾部（替换区间 = "b" → "b\\nc"）');
check(!computeMinimalDiff('x', 'x').changed, '5h 最小 diff：相同文本 changed=false');
const d4 = computeMinimalDiff('a\r\nb', 'a\r\nB');
check(d4.changed && d4.prefix === 3 && d4.oldSuffix === 4 && d4.newSuffix === 4, '5h 最小 diff：CRLF 下前缀退到行首、替换区间只含行内容');
// 关键回归：写回后原文与新文在「替换区间之外」必须逐字节相同（编辑器只动这一小段）
const dApply = computeMinimalDiff(plan1.newText, plan2.newText);
check(dApply.changed && plan1.newText.slice(0, dApply.prefix) === plan2.newText.slice(0, dApply.prefix) && plan1.newText.slice(dApply.oldSuffix) === plan2.newText.slice(dApply.newSuffix), '5h 最小 diff：替换区间外原文/新文完全一致');
// 5h-11 口径判定工具（describeInfoTextFlavor）——实测 info.text 到底是整文件还是节区
const flavorA = describeInfoTextFlavor({}, { text: fullFile, lineStart: 6, lineEnd: 11 }, fullFile);
check(flavorA.infoTextIsWholeFile === true && flavorA.infoTextIsSectionSlice === false, '5h 口径判定：整文件输入 → wholeFile=true');
const flavorB = describeInfoTextFlavor({}, { text: fileLines.slice(6, 12).join('\n'), lineStart: 6, lineEnd: 11 }, fullFile);
check(flavorB.infoTextIsWholeFile === false && flavorB.infoTextIsSectionSlice === true, '5h 口径判定：节区切片输入 → sectionSlice=true');
console.log('断言5h 写回修复（全文口径/围栏定位/最小 diff）：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5i 连续隐藏行合并为单个 ...（g-009 体验修复 1）
// 负责人实机症状：隐藏 182-194（13 行）渲染出一列 13 个 ...
const mSrc = Array.from({ length: 20 }, (_, i) => 'L' + (i + 1)).join('\n');
const mBase = buildFullFileRows(mSrc);
// 5i-1 连续 13 行 → 只新增 1 个 dot（净减 12 行）
const mConsec = applyHideToRows(mBase, [{ start: 3, end: 15 }]);
check(mConsec.rows.filter((r) => r.dot).length === 1, '5i 连续隐藏 13 行 → 只有 1 个 dots');
check(mConsec.rows.length === mBase.length - 12, '5i 连续隐藏 13 行 → 行数净减 12（13 dots 合成 1）');
check(mConsec.hiddenNums.length === 13, '5i 隐藏行号仍记录 13 行（语义不变）');
check(mConsec.rows[1].num === 2 && mConsec.rows[2].dot && mConsec.rows[3].num === 16, '5i 合并后 2 与 16 紧邻同一个 dots');
// 5i-2 与既有 dots 相邻 → 合并（老 LINES 模型只带末尾 0，多个 LINES 段之间本就没有 dots；
//     「段间省略」由渲染期用可见行区间集合重建模型得到，正是 5i-2b 验的那条路径）
const mSegmented = buildEmbedLineRows(mSrc, analyseSrcLines('1-5,8-11'));
check(mSegmented.filter((r) => r.dot).length === 2, '5i 前置：1-5,8-11 的老模型有 2 个 dots（首段前 + 末尾）');
const mAdjacent = applyHideToRows(mSegmented, [{ start: 12, end: 13 }]);
check(mAdjacent.rows.length === mSegmented.length, '5i 隐藏 LINES 之外的行 → 模型不变（本来就不显示）');
check(mAdjacent.rows.filter((r) => r.dot).length === 2, '5i 隐藏 LINES 之外的行 → dots 数不变');
// 5i-2b 渲染期口径：可见行集合 = LINES 可见行 − HIDE，再由集合重建模型 → 每段间隙恰好 1 个 dots
const visibleSpec = rangesToSpec(subtractLineRanges(rowsToSourceLineRanges(mSegmented), [{ start: 3, end: 4 }], 20), 20);
check(visibleSpec === '1-2,5,8-11', '5i 可见集合 = 1-2,5,8-11（LINES − HIDE）');
const mRebuilt = buildEmbedLineRows(mSrc, analyseSrcLines(visibleSpec));
check(mRebuilt.filter((r) => r.dot).length === 3, '5i 重建模型：每段间隔恰好 1 个 dots（1-2 | 5 | 8-11 共 3 个）');
check(mRebuilt.length === 10, '5i 重建模型：10 行 = 7 行内容 + 3 个 dots');
check(JSON.stringify(mRebuilt.filter((r) => !r.dot).map((r) => r.num)) === JSON.stringify([1, 2, 5, 8, 9, 10, 11]), '5i 重建模型：可见行号与原 LINES∩非 HIDE 完全一致');
// 关键：每段间隔恒为 1 个 dots，且不存在连续两个 dots（不会逐行铺开）
const mLong = buildEmbedLineRows(mSrc, analyseSrcLines('1-2,5,8-11,20'));
check(mLong.filter((r) => r.dot).length === 3, '5i 重建模型：段间隔恰好 3 个 dots（1-2 | 5 | 8-11 … 20）');
const mLongGaps = mLong.filter((r, i) => r.dot && i > 0 && mLong[i - 1].dot).length;
check(mLongGaps === 0, '5i 重建模型里不存在连续两个 dots（不会逐行铺开）');
check(mLong.length <= 12, '5i 重建模型行数远小于「逐行铺开」的写法（20 行源 → 模型 ≤ 12 行）');
// 相邻合并（render-time 语义）：两个 dots 中间的行被隐藏 → 合并为 1 个 dots
const mTwoDots = [{ dot: false, num: 1 }, { dot: true, num: 0 }, { dot: false, num: 5 }, { dot: true, num: 0 }, { dot: false, num: 9 }];
const mAdjMerge = applyHideToRows(mTwoDots, [{ start: 5, end: 5 }]);
check(mAdjMerge.rows.filter((r) => r.dot).length === 1, '5i 两个既有 dots 之间的行被隐藏 → 合并为 1 个 dots');
check(mAdjMerge.rows.length === 3 && mAdjMerge.rows[0].num === 1 && mAdjMerge.rows[1].dot && mAdjMerge.rows[2].num === 9, '5i 相邻合并后 1 与 9 紧邻同一个 dots');
// 5i-3 不连续隐藏 → 两段各 1 个 dots
const mSparse = applyHideToRows(mBase, [{ start: 3, end: 4 }, { start: 10, end: 11 }]);
check(mSparse.rows.filter((r) => r.dot).length === 2, '5i 不连续隐藏（3-4 与 10-11）→ 两段各 1 个 dots');
check(mSparse.rows.length === mBase.length - 2, '5i 两段各合并掉 1 行（共减 2）');
// 5i-4 合并后正文模型与行号模型仍逐行对齐（原行号 / 新行号两种模式）
function textOfRows(rows) { return rows.map((r) => (r.dot ? '...' : 'CODE')).join('\n') }
function alignCheck(rows, mode, label) {
  const textLines = textOfRows(rows).split('\n');
  const plan = buildLineGutterPlan(textLines, rows, mode);
  const ok = plan.ok && plan.cells.length === textLines.length;
  if (!ok) { return false }
  // dot 行单元格留空；代码行单元格非空
  for (let i = 0; i < rows.length; i++) {
    const blankCell = plan.cells[i] === '';
    if (rows[i].dot !== blankCell) { return false }
  }
  return true;
}
check(alignCheck(mAdjMerge.rows, 'original', 'orig'), '5i 相邻合并后原行号模式与正文逐行对齐');
check(alignCheck(mAdjMerge.rows, 'new', 'new'), '5i 相邻合并后新行号模式与正文逐行对齐');
check(alignCheck(mConsec.rows, 'original', 'orig'), '5i 连续合并后原行号模式对齐');
check(alignCheck(mConsec.rows, 'new', 'new'), '5i 连续合并后新行号模式对齐');
// 行号不得错位：合并只吃掉 dots 行，其余行（含被隐藏行之外的代码行）原样保留
const mTwoDotsCodes = mTwoDots.filter((r) => !r.dot).map((r) => r.num);
const mAdjMergeCodes = mAdjMerge.rows.filter((r) => !r.dot).map((r) => r.num);
check(JSON.stringify(mAdjMergeCodes) === JSON.stringify([1, 9]), '5i 合并后可见代码行 = [1, 9]（只少掉被隐藏的 5）');
check(mAdjMergeCodes.length === mTwoDotsCodes.length - 1, '5i 合并只额外吃掉 dots 行，不多删代码行');
check(mAdjMerge.mergedDots === 2, '5i 相邻合并记录 mergedDots=2（两个 dots 合成一个）');
// 原行号模式：合并后每个代码行仍拿到自己的源行号（1 / 9）
const planOrig = buildLineGutterPlan(textOfRows(mAdjMerge.rows).split('\n'), mAdjMerge.rows, 'original');
check(JSON.stringify(planOrig.cells) === JSON.stringify(['1', '', '9']), '5i 原行号模式：合并后 cells = [1, 空, 9]');
const planNewMerged = buildLineGutterPlan(textOfRows(mAdjMerge.rows).split('\n'), mAdjMerge.rows, 'new');
check(JSON.stringify(planNewMerged.cells) === JSON.stringify(['1', '', '2']), '5i 新行号模式：合并后 cells = [1, 空, 2]（连续不跳号）');
const nwBefore = buildLineGutterPlan(textOfRows(mTwoDots).split('\n'), mTwoDots, 'new').cells.filter((c) => c !== '');
const nwAfter = buildLineGutterPlan(textOfRows(mAdjMerge.rows).split('\n'), mAdjMerge.rows, 'new').cells.filter((c) => c !== '');
check(JSON.stringify(nwBefore) === JSON.stringify(['1', '2', '3']) && JSON.stringify(nwAfter) === JSON.stringify(['1', '2']), '5i 新行号模式：合并后编号连续无空洞（1,2）');
// 5i-5 原有全隐藏 / 单行语义不变
const mAllHidden = applyHideToRows(mSegmented, [{ start: 1, end: 11 }]);
check(mAllHidden.rows.filter((r) => r.dot).length === 1 && !hasVisibleCodeRow(mAllHidden.rows), '5i 全隐藏 → 只剩 1 个 dots 且判定无可见行');
const mOne = applyHideToRows(mBase, [{ start: 7, end: 7 }]);
check(mOne.rows.filter((r) => r.dot).length === 1, '5i 单行隐藏 → 1 个 dots');
check(mOne.rows.some((r) => !r.dot && r.num === 7) === false, '5i 单行隐藏 → 该代码行确实消失');
// 5i-6 mergeConsecutiveDots 纯函数本身
const mRaw = [{ dot: true, num: 0 }, { dot: true, num: 0 }, { dot: false, num: 5 }, { dot: true, num: 0 }, { dot: true, num: 0 }, { dot: true, num: 0 }, { dot: false, num: 9 }];
const mMerged = mergeConsecutiveDots(mRaw);
check(mMerged.rows.length === 4 && mMerged.mergedDots === 3, '5i mergeConsecutiveDots：3 组合并为 3 项、记录合并数 3');
check(mMerged.rows[0].dot && mMerged.rows[1].num === 5 && mMerged.rows[2].dot && mMerged.rows[3].num === 9, '5i mergeConsecutiveDots：首个 dot 保留、代码行原样');
check(mergeConsecutiveDots([]).rows.length === 0 && mergeConsecutiveDots([{ dot: false, num: 1 }]).mergedDots === 0, '5i mergeConsecutiveDots：空数组/无 dots 边界');
// 5i-7 渲染期唯一入口 buildVisibleRowsForHide：负责人实机实例（LINES 164-208 + HIDE 182-194）
const hSrc = Array.from({ length: 250 }, (_, i) => 'SRC_' + (i + 1)).join('\n');
const hp = buildVisibleRowsForHide(hSrc, '164-208', '182-194');
check(hp.rows !== null && hp.rows.filter((r) => r.dot).length === 3, '5i 实机实例：可见 164-181 / 195-208 → 3 个 dots（前导 + 中间 + 尾部）');
check(hp.hideRanges.length === 1 && hp.visibleRanges.length === 2, '5i 实机实例：HIDE 1 段、可见集合 2 段');
check(rangesToSpec(hp.visibleRanges, 250) === '164-181,195-208', '5i 实机实例：可见集合 = 164-181,195-208');
check(hp.rows.filter((r) => !r.dot).length === 32 && hp.rows.length === 35, '5i 实机实例：32 行内容 + 3 dots = 35 行（原 45 行 − 13 隐藏 + 3 dots）');
check(!hp.rows.some((r, i) => r.dot && i > 0 && hp.rows[i - 1].dot), '5i 实机实例：不存在相邻两个 dots（一列 ... 已消除）');
const hpAlign = buildLineGutterPlan(textOfRows(hp.rows).split('\n'), hp.rows, 'original');
check(hpAlign.ok && hpAlign.cells.length === hp.rows.length && hpAlign.cells.filter((c) => c !== '').length === 32, '5i 实机实例：行号列与正文逐行对齐（32 个行号单元格）');
// HIDE 未生效（缺省/非法）→ rows=null，调用方走既有路径（零回归）
check(buildVisibleRowsForHide(hSrc, '164-208', undefined).rows === null, '5i HIDE 缺省 → rows=null（零回归路径）');
check(buildVisibleRowsForHide(hSrc, '164-208', 'abc').rows === null, '5i HIDE 全非法 → rows=null');
check(buildVisibleRowsForHide(hSrc, '164-208', '5-20').rows !== null, '5i HIDE 与 LINES 无交集 → 仍按可见集合重建（不隐藏任何行）');
check(buildVisibleRowsForHide(hSrc, undefined, '182-194').rows.filter((r) => !r.dot).length === 237, '5i LINES 缺省（整文件）→ 隐藏 13 行后剩 237 行内容');
console.log('断言5i 连续隐藏合并为单个 ...：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 5j 块级「显示全部」按钮避让核心按钮的几何计算（g-009 体验修复 2）
// 约定：panelRight = 块的 getBoundingClientRect().right（CSS right 语义用右坐标，不是 width）
const core = { left: 300, right: 330, width: 30 };
const core2 = { left: 250, right: 280, width: 30 };
const core3 = { left: 330, right: 360, width: 30 };
const zeroW = { left: 200, right: 200, width: 0 };
// 5j-1 无核心按钮 → 退回默认偏移
const j1 = computeHideAllButtonRight(400, [], 60);
check(j1.source === 'fallback-no-core' && j1.right === 6, '5j 无核心按钮 → fallback right=6');
check(computeHideAllButtonRight(400, [null, undefined], 60).right === 6, '5j 只有 null/undefined → fallback');
// 5j-2 单个核心按钮 → 放在其左侧 6px
const j2 = computeHideAllButtonRight(400, [core], 60);
check(j2.source === 'core-leftmost' && j2.right === 400 - 300 + 6 && j2.coreLeft === 300, '5j 单个核心按钮 → right = panelRight − left + 6');
// 5j-3 多个核心按钮 → 取最靠左
const j3 = computeHideAllButtonRight(400, [core, core2, core3], 60);
check(j3.source === 'core-leftmost' && j3.coreLeft === 250 && j3.right === 400 - 250 + 6, '5j 多个核心按钮 → 取最左（250）');
// 5j-4 零尺寸/隐藏的核心按钮跳过
const j4 = computeHideAllButtonRight(400, [zeroW, core], 60);
check(j4.coreLeft === 300, '5j 零宽核心按钮被跳过');
check(computeHideAllButtonRight(400, [zeroW], 60).source === 'fallback-no-core', '5j 只有零宽核心按钮 → fallback');
check(isUsableButtonRect(zeroW) === false && isUsableButtonRect(core) === true && isUsableButtonRect(null) === false, '5j isUsableButtonRect 判定');
// 5j-5 clamp：按钮不越出块（core 太靠左 → right 截到 panelRight − buttonWidth）
const j5 = computeHideAllButtonRight(400, [{ left: 10, right: 40, width: 30 }], 60);
check(j5.right === 340 && j5.source === 'core-leftmost', '5j clamp：core 极靠左 → right 截到 panelRight − buttonWidth');
// 5j-6 自定义 gap / fallback / minRight
const j6 = computeHideAllButtonRight(400, [core], 60, { gap: 12 });
check(j6.right === 400 - 300 + 12, '5j 自定义 gap=12');
const j7 = computeHideAllButtonRight(50, [], 60);
check(j7.right === 0, '5j 块比按钮还窄 → right 截到 0（不为负）');
const j8 = computeHideAllButtonRight(400, [core], 60, { minRight: 4 });
check(j8.right >= 4, '5j minRight 生效');
// 5j-7 拿不到块布局（panelRight=0）→ 有 core 时退回 gap
const j9 = computeHideAllButtonRight(0, [core], 60);
check(j9.source === 'fallback-no-panel' && j9.right === 6 && j9.coreLeft === 300, '5j 无块布局 → 退回 gap=6');
// 5j-8 块自身有 left 偏移时也必须正确（用 right 坐标而非 width 的回归锁）
const jOffset = computeHideAllButtonRight(500, [{ left: 400, right: 430, width: 30 }], 60);
check(jOffset.right === 106, '5j 块 left=100/width=400（right=500）→ right=106（不是 6 或 76）');
// 5j-9 默认核心按钮选择器数组可配置
check(Array.isArray(DEFAULT_CORE_BUTTON_SELECTORS) && DEFAULT_CORE_BUTTON_SELECTORS.length === 3 && DEFAULT_CORE_BUTTON_SELECTORS.indexOf('.copy-code-button') >= 0 && DEFAULT_CORE_BUTTON_SELECTORS.indexOf('.code-block-flair') >= 0, '5j 默认选择器含 copy/edit/flair');
console.log('断言5j 显示全部按钮避让几何：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// ---------- 断言 6：g-010 i18n 纯函数（语言选择回退链 / 缺键回退 / 占位替换 / reason 映射） ----------
// 6a normalizeLocale：zh 家族（zh/zh-CN/zh-TW/zh_Hans，大小写不敏感）→ zh；其余（含空串/空白）→ en
check(normalizeLocale('zh') === 'zh' && normalizeLocale('zh-CN') === 'zh' && normalizeLocale('zh-TW') === 'zh' && normalizeLocale(' zh_Hans ') === 'zh', '6a zh 家族 → zh');
check(normalizeLocale('en') === 'en' && normalizeLocale('en-GB') === 'en' && normalizeLocale('ja') === 'en' && normalizeLocale('') === 'en' && normalizeLocale('   ') === 'en', '6a 非 zh（含空串/空白）→ en');
// 6b initI18n 候选链：按顺序取第一个非空候选定型（调用方保证 moment 优先、navigator 兜底）
check(initI18n(['zh-CN', 'en']) === 'zh' && locale() === 'zh', '6b 首个非空候选 zh → zh');
check(initI18n(['en-GB', 'zh']) === 'en' && locale() === 'en', '6b 首个非空候选 en → en（zh 候选被跳过）');
check(initI18n([null, undefined, '', '  ', 'zh']) === 'zh', '6b 空候选/空白候选跳过 → 兜底候选生效');
check(initI18n([]) === 'en' && initI18n([null]) === 'en' && initI18n(['']) === 'en', '6b 全部候选为空 → en（不抛错）');
// 6c zh 取值 / 缺键回退链：zh 表 → zh 缺键回退 en → 双缺回退 key 本身（不抛错、无占位标记）
initI18n(['zh']);
check(t('hideAllBtnText', { n: 3 }) === '显示全部（3 行已隐藏）', '6c zh 表 + {n} 占位替换');
check(t('noticeHiddenOne', { n: 7 }) === '已隐藏第 7 行', '6c zh 单行隐藏文案');
check(t('noticeWriteAbandoned', { reason: 'x' }) === '已放弃写入：x', '6c zh 带参文案');
check(t('fixtureOnlyEnKey') === 'EN_ONLY', '6c zh 缺键回退 en 表');
check(t('__no_such_key__') === '__no_such_key__', '6c 双缺回退 key 本身（不抛错、不渲染占位标记）');
check(t('__no_such_key__', { n: 1 }) === '__no_such_key__', '6c 双缺 + 带参仍回退 key 本身');
// 6d en 取值 / 占位符边界
initI18n(['en']);
check(t('hideAllBtnText', { n: 3 }) === 'Show all (3 lines hidden)', '6d en 表 + {n} 占位替换');
check(t('noticeHiddenOne', { n: 7 }) === 'Hidden line 7', '6d en 单行隐藏文案');
check(t('hideAllBtnText') === 'Show all ({n} lines hidden)', '6d 缺参时占位符原样保留（不抛错）');
check(t('floatHideTitle', { unknown: 1 }) === "Write the selected source line numbers into this embed block's HIDE", '6d 未知参数名不影响文案');
// 6e tReason：utils 中文 reason（夹具 5h-7 按原文断言的值）→ 文案键映射；未知 reason 透传
initI18n(['zh']);
check(tReason('无法在全文里定位 embed 块（围栏扫描无候选且节区提示无效）') === '无法在全文里定位 embed 块（围栏扫描无候选且节区提示无效）', '6e zh 下 tReason 与原文逐字一致（零回归）');
initI18n(['en']);
check(tReason('无法在全文里定位 embed 块（围栏扫描无候选且节区提示无效）').indexOf('cannot locate the embed block') === 0, '6e en 下 tReason 给出英文说明');
check(tReason('unchanged') === 'unchanged' && tReason('') === '' , '6e 未知 reason / 空 reason 透传');
console.log('断言6 g-010 i18n 纯函数（语言链/缺键回退/占位/reason 映射）：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// ---------- 断言 7：g-011 LINES 写回（updateLinesInSection：插入/替换/删HIDE/CRLF/最小diff/幂等） ----------
// 7a 插入：无 LINES → 插到 PATH 之后，clearHide 同时删 HIDE 行，其余行字节级不变
const f7a = ['---', 'title: t', '---', '', F + 'embed-ts', 'PATH: "vault://a.ts"', 'HIDE: "3-4"', F, 'body', F, '', 'tail'].join('\n');
const l7a = updateLinesInSection(f7a, '1-2', true, { start: 4, end: 7 }, { path: 'vault://a.ts', hideSpec: '3-4' });
check(l7a.ok && l7a.changed && l7a.reason === 'inserted' && l7a.hideAction === 'removed', '7a 无 LINES → 插入 + 按 clearHide 删 HIDE');
check(l7a.newText === ['---', 'title: t', '---', '', F + 'embed-ts', 'PATH: "vault://a.ts"', 'LINES: "1-2"', F, 'body', F, '', 'tail'].join('\n'), '7a LINES 插到 PATH 之后且 HIDE 行被移除（其余行字节级不变）');
check(l7a.removedHideLine === 'HIDE: "3-4"' && !l7a.newText.includes('HIDE'), '7a removedHideLine 记录被删的 HIDE 行原文');

// 7b 替换：已有 LINES → 原位替换，HIDE 未要求处理时原样保留，顺序不变
const f7b = [F + 'embed-ts', 'PATH: "vault://b.ts"', 'LINES: "5-20"', 'HIDE: "8"', F, 'x', F].join('\n');
const l7b = updateLinesInSection(f7b, '5-7,9-20', false, { start: 0, end: 5 }, { path: 'vault://b.ts' });
check(l7b.ok && l7b.changed && l7b.reason === 'replaced' && l7b.keyLineIndex === 2 && l7b.hideAction === 'none', '7b 已有 LINES → 原位替换（HIDE 不动）');
check(l7b.newText === [F + 'embed-ts', 'PATH: "vault://b.ts"', 'LINES: "5-7,9-20"', 'HIDE: "8"', F, 'x', F].join('\n'), '7b 只动 LINES 一行（顺序与其余行不变）');
const l7b2 = updateLinesInSection([F + 'embed-ts', "LINES: '1-5'", F, 'x', F].join('\n'), '2-4', false, { start: 0 });
check(l7b2.ok && l7b2.newText.includes("LINES: '2-4'"), '7b 单引号风格保留');

// 7c LINES 已同值 + clearHide → 只删 HIDE 行（hide-removed-only）
const l7c = updateLinesInSection(f7b, '5-20', true, { start: 0, end: 5 });
check(l7c.ok && l7c.changed && l7c.reason === 'hide-removed-only' && l7c.removedHideLine === 'HIDE: "8"', '7c LINES 已同值但 clearHide → 只删 HIDE 行');
check(l7c.newText === [F + 'embed-ts', 'PATH: "vault://b.ts"', 'LINES: "5-20"', F, 'x', F].join('\n'), '7c 删除后其余行不变（LINES 原样）');

// 7d CRLF 保留：+LINES −HIDE 行数不变、新行带 \r、原有行尾不改写
const crlf7 = ['---', F + 'embed-ts', 'PATH: "vault://c.ts"', 'HIDE: "2"', F, 'body', F].join('\r\n');
const l7d = updateLinesInSection(crlf7, '1,3', true, { start: 1, end: 4 });
check(l7d.ok && l7d.newText.indexOf('LINES: "1,3"\r\n') > 0 && !l7d.newText.includes('HIDE'), '7d CRLF：新行带 \\r 且 HIDE 行被删');
check(l7d.newText.split('\r\n').length === crlf7.split('\r\n').length, '7d CRLF：行数不变（+LINES −HIDE）');
// 7d-2 双键替换（增量 C 恢复语义）的 CRLF 保留（守卫④a）
const crlf7b = [F + 'embed-ts', 'PATH: "vault://c2.ts"', 'LINES: "1-10"', 'HIDE: "3-4"', F, 'body', F].join('\r\n');
const l7d2 = updateLinesInSection(crlf7b, '1-11', false, { start: 0, end: 5 }, { path: 'vault://c2.ts' }, '3');
check(l7d2.ok && l7d2.hideAction === 'replaced' && l7d2.newText.indexOf('HIDE: "3"\r\n') > 0 && l7d2.newText.indexOf('LINES: "1-11"\r\n') > 0, '7d-2 CRLF 双键：LINES 替换 + HIDE 原位替换（\\r 保留）');
check(l7d2.newText.split('\r\n').length === crlf7b.split('\r\n').length, '7d-2 CRLF 双键：行数不变（两行均原位替换）');

// 7e 最小 diff：替换区间外逐字节一致（编辑器单次 replaceRange 保 Ctrl+Z 的前提）
const d7 = computeMinimalDiff(f7b, l7c.newText);
check(d7.changed && f7b.slice(0, d7.prefix) === l7c.newText.slice(0, d7.prefix) && f7b.slice(d7.oldSuffix) === l7c.newText.slice(d7.newSuffix), '7e 最小 diff：替换区间外原文/新文逐字节一致');
// 7e-2 双键改动 = 一个连续替换区间（守卫④b：一次 replaceRange，而非两次写回）
const dualBefore = [F + 'embed-ts', 'PATH: "vault://d.ts"', 'LINES: "1-10"', 'HIDE: "3-4"', F, 'body', F].join('\n');
const dualPlan = updateLinesInSection(dualBefore, '1-11', false, { start: 0, end: 5 }, { path: 'vault://d.ts' }, '3');
check(dualPlan.ok && dualPlan.changed && dualPlan.reason === 'replaced' && dualPlan.hideAction === 'replaced', '7e-2 双键：LINES 替换 + HIDE 替换');
const dualDiff = computeMinimalDiff(dualBefore, dualPlan.newText);
const dualOldRegion = dualBefore.slice(dualDiff.prefix, dualDiff.oldSuffix);
const dualNewRegion = dualPlan.newText.slice(dualDiff.prefix, dualDiff.newSuffix);
const dualKzStart = dualBefore.indexOf('LINES: "1-10"');
const dualKzEnd = dualBefore.indexOf(F, dualBefore.indexOf('HIDE: "3-4"'));
check(dualDiff.changed && dualOldRegion.length > 0 && dualDiff.prefix >= dualKzStart && dualDiff.oldSuffix <= dualKzEnd
	&& !dualOldRegion.includes(F) && !dualOldRegion.includes('body') && !dualNewRegion.includes(F),
	'7e-2 双键：单个连续替换区间只覆盖键区（一次 replaceRange 完成 LINES+HIDE 双改动）');
check(dualBefore.slice(0, dualDiff.prefix) === dualPlan.newText.slice(0, dualDiff.prefix) && dualBefore.slice(dualDiff.oldSuffix) === dualPlan.newText.slice(dualDiff.newSuffix), '7e-2 双键：区间外逐字节一致');

// 7f 定位失败 → ok=false 且不改文本（含 hideSpec 双键场景，守卫④a）
const l7f = updateLinesInSection('纯文本无代码块', '1-2', true, { start: -1 });
check(!l7f.ok && l7f.changed === false && l7f.newText === '纯文本无代码块', '7f 定位失败 → ok=false 且不改文本');
const l7f2 = updateLinesInSection('纯文本无代码块', '1-2', false, { start: -1 }, undefined, '');
check(!l7f2.ok && l7f2.newText === '纯文本无代码块', '7f 双键场景定位失败 → 同样不改文本');

// 7g 空 LINES 拒绝写入
const l7g = updateLinesInSection(f7b, '', true, { start: 0 });
check(!l7g.ok && l7g.changed === false && l7g.newText === f7b, '7g 空 LINES 拒绝写入');

// 7h 幂等：转换后再转 → no-op（LINES 已同值、HIDE 已删）
const l7h1 = updateLinesInSection(f7b, '5-7,9-20', true, { start: 0, end: 5 });
const l7h2 = updateLinesInSection(l7h1.newText, '5-7,9-20', true, { start: 0, end: 5 });
check(l7h2.ok && !l7h2.changed && l7h2.reason === 'unchanged' && l7h2.newText === l7h1.newText, '7h 转换幂等：转换后再转 → no-op');

// 7i 多块定位：命中第二个块，第一个块不动
const two7 = [F + 'embed-ts', 'PATH: "vault://one.ts"', 'HIDE: "9"', F, 'a', F, '', F + 'embed-ts', 'PATH: "vault://two.ts"', F, 'b', F].join('\n');
const l7i = updateLinesInSection(two7, '1-3', true, { start: 7, end: 10 }, { path: 'vault://two.ts' });
check(l7i.ok && l7i.startLine === 7, '7i 多块：命中第二个块');
check(l7i.newText.includes('HIDE: "9"') && l7i.newText.indexOf('LINES: "1-3"') > l7i.newText.indexOf('two.ts') && l7i.newText.indexOf('LINES: "1-3"') < l7i.newText.indexOf('\nb\n'), '7i 多块：第一个块原样、LINES 写进第二个块');

// 7j describeLinesUpdate 日志字段完整
const du7 = describeLinesUpdate(l7b);
check(du7.ok === true && du7.oldLines === '5-20' && du7.newLines === '5-7,9-20' && du7.newLinesLine === 'LINES: "5-7,9-20"' && du7.hideAction === 'none', '7j describeLinesUpdate：日志描述字段完整');
console.log('断言7 g-011 LINES 写回（插入/替换/删HIDE/CRLF/最小diff/双键单区间/幂等/多块）：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// ---------- 断言 8：g-011 增量 C（dots 段展开模型 + 恢复 spec 纯函数） ----------
const cSrc = Array.from({ length: 250 }, (_, i) => 'SRC_' + (i + 1)).join('\n');

// 8a dots 段识别：LINES 164-208 + HIDE 183-193 → 前导/隐藏/尾部三段（相邻可见行外推）
const cRows = buildVisibleRowsForHide(cSrc, '164-208', '183-193').rows;
const cSegs = dotsSegmentsOfRows(cRows, 250);
check(!!cRows && cSegs.length === 3, '8a 三个 dots 段（前导/隐藏/尾部）');
check(cSegs[0].start === 1 && cSegs[0].end === 163, '8a 前导段 = 1-163');
check(cSegs[1].start === 183 && cSegs[1].end === 193, '8a HIDE 段 = 183-193');
check(cSegs[2].start === 209 && cSegs[2].end === 250, '8a 尾部段 = 209-250');
check(dotsSegmentId(cSegs[1]) === '183-193', '8a 段标识 = start-end');

// 8b 展开：中段展开 → 真实行替换 dots；未展开间隙仍是恰好一个 dots
const midId = dotsSegmentId(cSegs[1]);
const cExpMid = buildExpandedRows(cSrc, cRows, new Set([midId]));
check(cExpMid.some((r) => !r.dot && r.num === 183) && cExpMid.some((r) => !r.dot && r.num === 193), '8b 展开 HIDE 段：183..193 成为真实代码行');
check(cExpMid.filter((r) => r.dot).length === 2, '8b 未展开的前导/尾部间隙仍是恰好一个 dots（2 个）');
const cExpAll = buildExpandedRows(cSrc, cRows, new Set(cSegs.map((s) => dotsSegmentId(s))));
check(cExpAll.every((r) => !r.dot) && cExpAll.length === 250 && cExpAll[0].num === 1 && cExpAll[249].num === 250, '8b 全部展开 → 1..250 全真实行、无 dots');

// 8c 从基模型推导的展开/收起往返 + 展开重入幂等
const cBack = buildExpandedRows(cSrc, cRows, new Set());
check(JSON.stringify(cBack) === JSON.stringify(cRows) && cBack !== cRows, '8c 收起（空展开集，从基模型重推）= 原模型（往返恒等）');
const cExpAgain = buildExpandedRows(cSrc, cExpMid, new Set([midId]));
check(JSON.stringify(cExpAgain) === JSON.stringify(cExpMid), '8c 展开幂等：对已展开模型再推导同一展开集 → 恒等');

// 8d 展开模型与行号计划逐行对齐（原/新行号两模式；alignCheck/textOfRows 为 5i 既有工具）
check(alignCheck(cExpMid, 'original', 'orig') && alignCheck(cExpMid, 'new', 'new'), '8d 展开模型与行号计划逐行对齐（原/新两模式）');
check(alignCheck(cExpAll, 'original', 'orig') && alignCheck(cExpAll, 'new', 'new'), '8d 全展开模型对齐（原/新两模式）');

// 8e LINES 缺省 + HIDE 的整文件块：模型从 1 开始 → 唯一 dots 段恰为 HIDE 区间
const dRows = buildVisibleRowsForHide(cSrc, undefined, '182-194').rows;
const dSegs = dotsSegmentsOfRows(dRows, 250);
check(!!dRows && dSegs.length === 1 && dSegs[0].start === 182 && dSegs[0].end === 194, '8e LINES 缺省块：唯一 dots 段 = HIDE 182-194');
const dExp = buildExpandedRows(cSrc, dRows, new Set([dotsSegmentId(dSegs[0])]));
check(dExp.filter((r) => r.dot).length === 0 && dExp.some((r) => !r.dot && r.num === 182) && dExp.some((r) => !r.dot && r.num === 194), '8e 展开后无 dots、182..194 全为真实行');

// 8f 混合选区：只挑幽灵行（守卫①的纯函数口径；普通行不受影响）
const mixed8 = ghostNumsFromExpanded([164, 181, 183, 190, 194, 196], new Set([midId]));
check(JSON.stringify(mixed8) === JSON.stringify([183, 190]), '8f 混合选区 → 只恢复幽灵行 183/190');
check(ghostNumsFromExpanded([164, 181], new Set([midId])).length === 0, '8f 纯普通行选区 → 无幽灵行（走既有隐藏语义）');
check(ghostNumsFromExpanded([183], new Set()).length === 0, '8f 无展开态 → 恒为空（零回归）');

// 8g restoreCompute 统一恢复语义
const rc1 = restoreCompute('164-208', '183-193', [183, 184], 250);
check(rc1.lines === '164-208' && rc1.hide === '185-193' && rc1.changed, '8g 双键：LINES∪选中 幂等不变、HIDE−选中 剩 185-193');
const rc2 = restoreCompute('164-182,194-208', '183-193', [183, 184], 250);
check(rc2.lines === '164-184,194-208' && rc2.hide === '185-193' && rc2.changed, '8g 双键：LINES 区间并入 183-184');
const rc3 = restoreCompute(undefined, '182-194', [185, 186], 250);
check(rc3.lines === null && rc3.hide === '182-184,187-194' && rc3.changed, '8g 仅 HIDE：lines=null（绝不创建 LINES 键）、HIDE 挖掉 185-186');
const rc4 = restoreCompute('5-20', undefined, [21, 22], 250);
check(rc4.lines === '5-22' && rc4.hide === '' && rc4.changed, '8g 仅 LINES：5-20∪21-22=5-22，HIDE 保持无');
const rc5 = restoreCompute('5-20,45-60', undefined, [21, 44, 70, 71], 250);
check(rc5.lines === '5-21,44-60,70-71' && rc5.changed, '8g 跨段：相邻选中区间分别并入两段、新段 70-71 追加');
const rc6 = restoreCompute(rc1.lines, rc1.hide, [183, 184], 250);
check(!rc6.changed && rc6.hide === '185-193' && rc6.lines === '164-208', '8g 幂等：恢复后再恢复 → changed=false');
const rc7 = restoreCompute('1-10', '', [3, 4], 250);
check(!rc7.changed, '8g 选中行本就可见 → changed=false（调用方 Notice 不写）');
const rc8 = restoreCompute(undefined, '5-8', [7, 5, 5, 6], 250);
check(rc8.hide === '8' && rc8.changed, '8g 乱序/重复 selected 归一化：5-7 全清、HIDE 剩 8');

// 8h linesSpecToRanges 与 analyseSrcLines 同源
check(JSON.stringify(linesSpecToRanges('5-20,45-60')) === JSON.stringify([{ start: 5, end: 20 }, { start: 45, end: 60 }]), '8h linesSpecToRanges：区间还原');
check(linesSpecToRanges('abc').length === 0, '8h 非法 token 忽略');

// 8i g-011 新增文案 zh/en 两表键面对齐（键在两表都存在 → t() 都不回退到 key 本身）
const g11Keys = ['cmdShowOnlySelectedLines', 'cmdConvertHideToLines', 'menuConvertHideToLines',
	'floatShowOnlySelected', 'floatShowOnlySelectedMany', 'floatShowOnlyTitle',
	'floatRestoreSelected', 'floatRestoreSelectedMany', 'floatRestoreTitle',
	'expandDotsTitle', 'collapseDotsTitle', 'collapseGhostTitle',
	'noticeLinesAlreadySet', 'noticeNoHideToConvert', 'noticeEmptyVisibleSet',
	'noticeShowOnlyOne', 'noticeShowOnlyMany', 'noticeConvertedToLines',
	'noticeNoRestorableLines', 'noticeNothingToRestore', 'noticeRestoredOne', 'noticeRestoredMany', 'noticeExpandFailed',
	'reasonEmptyLinesSpec'];
initI18n(['zh']);
const zhOk8 = g11Keys.every((k) => t(k) !== k);
initI18n(['en']);
const enOk8 = g11Keys.every((k) => t(k) !== k);
check(zhOk8 && enOk8, '8i g-011 新增键 zh/en 两表对齐（不回退到 key 本身）');
initI18n(['en']);
check(tReason('LINES 值为空，已拒绝写入') === t('reasonEmptyLinesSpec'), '8i en 下 tReason 映射空 LINES reason');
initI18n(['zh']);
check(tReason('LINES 值为空，已拒绝写入') === 'LINES 值为空，已拒绝写入', '8i zh 下 tReason 与原文逐字一致（零回归）');
console.log('断言8 g-011 增量 C（dots 段展开模型/恢复 spec 纯函数/i18n 对齐）：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 8j 展开态收起符号定位（实机修复：展开后 dots 行消失，▾ 以首幽灵行为载体）
// 单段：start=183 在展开模型中是真实行 → ▾ 落在行 183
const gs1 = ghostStartNumsOfExpanded(cExpMid, new Set([midId]));
check(gs1.size === 1 && gs1.get(183) === '183-193', '8j 单段：首幽灵行 183 → 段 id');
// 多段 + 段首即文件首行（前导段 start=1 → ▾ 落在行 1）
const gs2 = ghostStartNumsOfExpanded(cExpAll, new Set(cSegs.map((s) => dotsSegmentId(s))));
check(gs2.size === 3 && gs2.get(1) === '1-163' && gs2.get(183) === '183-193' && gs2.get(209) === '209-250', '8j 多段 + 段首即文件首行（1-163 → 行 1）');
// 陈旧 id / 模型漂移防御：start 不在当前模型（cRows 折叠态）→ 跳过，绝不误挂
check(ghostStartNumsOfExpanded(cRows, new Set([midId])).size === 0, '8j start 不在当前模型 → 跳过（陈旧 id 防御）');
check(ghostStartNumsOfExpanded(cExpMid, new Set()).size === 0, '8j 空展开集 → 恒空');
console.log('断言8j 展开态收起符号定位（首幽灵行 = 段 start）：' + (fail === failBase ? 'PASS' : 'FAIL'));
failBase = fail;

// 8k 「▾首 + ▴末」括号式：末幽灵行 = 段 end（同构防御；单行段 start==end 由调用方去重）
// 单段 3-5：start map → 行 3，end map → 行 5
const kRows = buildVisibleRowsForHide(cSrc, '1-2,6-10', '3-5').rows;
const kExp = buildExpandedRows(cSrc, kRows, new Set(['3-5']));
check(ghostStartNumsOfExpanded(kExp, new Set(['3-5'])).get(3) === '3-5', '8k 单段 3-5：首符号落在行 3');
check(ghostEndNumsOfExpanded(kExp, new Set(['3-5'])).get(5) === '3-5', '8k 单段 3-5：末符号落在行 5');
// 多段 + 段末即文件末行（209-250 → end=250）
const kEnds = ghostEndNumsOfExpanded(cExpAll, new Set(cSegs.map((s) => dotsSegmentId(s))));
check(kEnds.size === 3 && kEnds.get(163) === '1-163' && kEnds.get(193) === '183-193' && kEnds.get(250) === '209-250', '8k 多段末幽灵行 163/193/250（含段末即文件末行）');
// 陈旧 id 防御：end 不在当前模型（折叠态 cRows）→ 跳过
check(ghostEndNumsOfExpanded(cRows, new Set([midId])).size === 0, '8k end 不在当前模型 → 跳过（陈旧 id 防御）');
// 单行展开段 start==end：两映射同一行号——调用方据「starts.has(num)」只挂一个符号
const sRows = buildVisibleRowsForHide(cSrc, '1-4,6-10', '5-5').rows;
const sExp = buildExpandedRows(cSrc, sRows, new Set(['5-5']));
const sStarts = ghostStartNumsOfExpanded(sExp, new Set(['5-5']));
const sEnds = ghostEndNumsOfExpanded(sExp, new Set(['5-5']));
check(sStarts.size === 1 && sEnds.size === 1 && sStarts.has(5) && sEnds.has(5) && sStarts.get(5) === '5-5' && sEnds.get(5) === '5-5', '8k 单行段 start==end：两映射同为行 5（去重输入）');
check(ghostStartNumsOfExpanded(sExp, new Set()).size === 0 && ghostEndNumsOfExpanded(sExp, new Set()).size === 0, '8k 空展开集 → 恒空');
console.log('断言8k 展开态括号式符号定位（末幽灵行 = 段 end / 单行段去重输入）：' + (fail === failBase ? 'PASS' : 'FAIL'));

console.log(fail === 0 ? 'FIXTURE ALL PASS' : 'FIXTURE FAILED: ' + fail);
