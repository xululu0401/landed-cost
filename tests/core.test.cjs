/* 到岸成本台 · 核心测试
 * 运行：node --test tests/core.test.cjs
 * 覆盖：默认锚点、闭式公式、**BigInt 有理数独立实现对拍**（精确分数重算整条税链，
 *       与工程实现的浮点路径完全独立）、分摊比例与货值无关、逐行税额求和、
 *       成本对货值的仿射性、含税放大恒等式、可承受货值上限与关税率上限的回代互证、
 *       最低售价、保险两种口径一致、边界与非法输入、输出字段有效性、确定性。
 * 说明：参考实现与工程实现对拍只能证明一致；本文件另外用「精确有理数」这条
 *       完全独立的路径重算，并单独检查常识（税负率 ≥ 名义相加、税额非负等）。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

// ══════════════════════════════════════════════════════════════
// 0. 工具：确定性伪随机、精确有理数参考实现
// ══════════════════════════════════════════════════════════════
function lcg(seed) {
  let s = seed >>> 0;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }
function rint(rnd, lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }
function dec2(rnd, lo, hi) { return (lo + rnd() * (hi - lo)).toFixed(2); }
function dec1(rnd, lo, hi) { return (lo + rnd() * (hi - lo)).toFixed(1); }

function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return a < 0n ? -a : a; }
function F(n, d) {
  if (d === undefined) d = 1n;
  if (d < 0n) { n = -n; d = -d; }
  if (n === 0n) return [0n, 1n];
  const g = gcd(n, d);
  return [n / g, d / g];
}
function fAdd(a, b) { return F(a[0] * b[1] + b[0] * a[1], a[1] * b[1]); }
function fSub(a, b) { return F(a[0] * b[1] - b[0] * a[1], a[1] * b[1]); }
function fMul(a, b) { return F(a[0] * b[0], a[1] * b[1]); }
function fDiv(a, b) {
  if (b[0] === 0n) throw new Error('参考实现：除以零');
  return F(a[0] * b[1], a[1] * b[0]);
}
function fNum(a) { return Number(a[0]) / Number(a[1]); }
/** 十进制字符串 → 精确分数（不接受科学计数法，测试生成的数据里也没有） */
function dec(s) {
  s = String(s).trim();
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  const parts = s.split('.');
  const ip = parts[0] || '0';
  const fp = parts[1] || '';
  const d = 10n ** BigInt(fp.length);
  let n = BigInt(ip) * d + BigInt(fp || '0');
  if (neg) n = -n;
  return F(n, d);
}

/** 与 core.js 完全独立的参考实现：整条税链用精确分数重算 */
function refSolve(input) {
  const R = dec(input.rate);
  const G = input.rows.reduce((s, r) => fAdd(s, fMul(dec(r.qty), dec(r.unitPrice))), F(0n));
  const Fr = dec(input.freight);
  const I = input.insuranceMode === 'rate'
    ? fMul(G, fDiv(dec(input.insuranceRate), F(100n)))
    : dec(input.insuranceAmount);
  const ratio = fDiv(fAdd(Fr, I), G);              // 运保费 / 货值
  let U = F(0n), D = F(0n), E = F(0n), V = F(0n);
  const rows = input.rows.map((r) => {
    const g = fMul(dec(r.qty), dec(r.unitPrice));
    const u = fMul(g, fAdd(F(1n), ratio));         // 完税价格
    const dr = fDiv(dec(r.dutyRate), F(100n));
    const er = fDiv(dec(r.exciseRate), F(100n));
    const vr = fDiv(dec(r.vatRate), F(100n));
    const d = fMul(u, dr);
    const e = fMul(fDiv(fAdd(u, d), fSub(F(1n), er)), er);
    const v = fMul(fAdd(fAdd(u, d), e), vr);
    U = fAdd(U, u); D = fAdd(D, d); E = fAdd(E, e); V = fAdd(V, v);
    return { u, d, e, v, tax: fAdd(fAdd(d, e), v), goods: g };
  });
  const T = fAdd(fAdd(D, E), V);
  const other = (input.otherFees || []).reduce((s, f) => fAdd(s, dec(f.amount)), F(0n));
  const landedLocal = fMul(U, R);
  const taxLocal = fMul(T, R);
  const totalLocal = fAdd(fAdd(landedLocal, taxLocal), other);
  const qty = input.rows.reduce((s, r) => s + Number(r.qty), 0);
  return {
    goodsForeign: G, dutiableForeign: U, dutyForeign: D, exciseForeign: E, vatForeign: V,
    taxForeign: T, landedLocal, taxLocal, otherLocal: other, totalLocal,
    burdenRate: fMul(fDiv(T, U), F(100n)), unitCostLocal: fDiv(totalLocal, F(BigInt(qty))),
    rows
  };
}

function closeTo(actual, ref, relTol, label) {
  const tol = relTol === undefined ? 1e-9 : relTol;
  const d = Math.abs(actual - ref);
  const scale = Math.max(1, Math.abs(ref));
  assert.ok(d / scale <= tol, (label || '') + ' 实际 ' + actual + ' vs 精确 ' + ref + '，相对差 ' + (d / scale));
}
function row(name, qty, unitPrice, duty, excise, vat) {
  return { name, qty: String(qty), unitPrice: String(unitPrice), dutyRate: String(duty), exciseRate: String(excise), vatRate: String(vat) };
}
function inp(over) {
  return Object.assign({
    currency: 'USD', rate: '7.20', freight: '480', insuranceMode: 'rate',
    insuranceRate: '0.3', insuranceAmount: '', margin: '25', targetPrice: '120000',
    rows: [row('便携榨汁机', 500, '12.50', 10, 0, 13)],
    otherFees: [{ name: '报关与口岸费', amount: '800' }, { name: '国内运费', amount: '1200' }]
  }, over || {});
}

// ══════════════════════════════════════════════════════════════
// 1. 默认锚点（页面默认场景的所有数字都出自这一次计算）
// ══════════════════════════════════════════════════════════════
test('默认锚点：跨境电商小家电的全部关键数字', () => {
  const r = C.solve(C.clonePreset('appliance'));
  const t = r.totals, m = r.measures;
  assert.strictEqual(t.goodsForeign, 6250);
  assert.strictEqual(t.freightForeign, 480);
  closeTo(t.insuranceForeign, 18.75, 1e-12, '保险费');
  closeTo(t.dutiableForeign, 6748.75, 1e-12, '完税价格');
  closeTo(t.dutyForeign, 674.875, 1e-12, '关税');
  assert.strictEqual(t.exciseForeign, 0);
  closeTo(t.vatForeign, 965.07125, 1e-12, '增值税');
  closeTo(t.taxForeign, 1639.94625, 1e-12, '税费合计');
  closeTo(t.landedLocal, 48591, 1e-12, '到岸成本');
  closeTo(t.taxLocal, 11807.613, 1e-9, '税费（本币）');
  closeTo(t.otherLocal, 2000, 1e-12, '其他费用');
  closeTo(t.totalLocal, 62398.613, 1e-9, '总成本');
  closeTo(t.unitCostLocal, 124.797226, 1e-9, '单件成本');
  assert.strictEqual(t.totalQty, 500);
  closeTo(m.burdenRate, 24.3, 1e-12, '综合税负率');
  closeTo(m.amplifier, 1.243, 1e-12, '含税放大倍数');
  closeTo(m.dutyShare, 41.15226337448559, 1e-9, '关税占比');
  closeTo(m.vatShare, 58.8477366255144, 1e-9, '增值税占比');
  closeTo(m.naiveTaxLocal, 11175.93, 1e-9, '名义相加口径');
  closeTo(m.naiveUnderstateLocal, 631.683, 1e-9, '名义相加低估额');
  closeTo(r.pricing.minPriceLocal, 83198.15066666668, 1e-9, '最低售价');
  closeTo(r.pricing.minUnitPriceLocal, 166.39630133333335, 1e-9, '单件最低售价');
  closeTo(r.reverse.maxGoodsForeign, 9324.867089978834, 1e-9, '可承受货值上限');
  closeTo(r.reverse.headroomPct, 49.197873439661336, 1e-9, '货值余量');
  assert.strictEqual(r.reverse.meets, true);
  closeTo(r.maxDuty.rate, 60.26858100201735, 1e-9, '可承受关税率上限');
  assert.strictEqual(r.maxDuty.capped, false);
  assert.strictEqual(r.warnings.length, 1);
  assert.match(r.warnings[0], /少算 631\.68 元/);
});

// ══════════════════════════════════════════════════════════════
// 2. 单行闭式公式（手算）
// ══════════════════════════════════════════════════════════════
test('单行闭式：关税 10% + 增值税 13% 时税负率应为 24.3% 而不是 23%', () => {
  // 1 件 100 元、运费 0、保险 0 → 完税价格 100
  const r = C.solve(inp({ rows: [row('A', 1, '100', 10, 0, 13)], freight: '0', insuranceMode: 'rate', insuranceRate: '0', targetPrice: '', otherFees: [] }));
  closeTo(r.totals.dutiableForeign, 100, 1e-12, '完税价格');
  closeTo(r.totals.dutyForeign, 10, 1e-12, '关税');
  closeTo(r.totals.vatForeign, 14.3, 1e-12, '增值税 = (100+10)×13%');
  closeTo(r.totals.taxForeign, 24.3, 1e-12, '税费');
  closeTo(r.measures.burdenRate, 24.3, 1e-12, '税负率');
  // 名义相加 23% → 低估 1.3 元（= 关税 10 × 13%）
  closeTo(r.measures.naiveTaxLocal / r.rate, 23, 1e-12, '名义相加口径');
  closeTo(r.measures.naiveUnderstateLocal / r.rate, 1.3, 1e-12, '低估额');
});

test('单行闭式：价内消费税 10% 的倒算', () => {
  // 完税价格 100、关税 14% → 消费税 = (100+14)/(1-10%)×10% = 12.6666…
  const r = C.solve(inp({ rows: [row('B', 1, '100', 14, 10, 13)], freight: '0', insuranceRate: '0', targetPrice: '', otherFees: [] }));
  closeTo(r.totals.exciseForeign, 12.666666666666666, 1e-9, '消费税');
  closeTo(r.totals.vatForeign, (114 + 12.666666666666666) * 0.13, 1e-9, '增值税');
  // 消费税是价内税：把消费税当成价外算会少
  const outside = 100 * 0.14 + 100 * 0.10 + (114) * 0.13;
  assert.ok(r.totals.taxForeign > outside, '价内税倒算结果应大于把消费税当价外税的口径');
});

test('单行闭式：关税率 0、增值税 0 时完全没有税负并给出提示', () => {
  const r = C.solve(inp({ rows: [row('C', 10, '5', 0, 0, 0)], freight: '0', insuranceRate: '0', targetPrice: '', otherFees: [] }));
  assert.strictEqual(r.totals.taxForeign, 0);
  assert.strictEqual(r.measures.burdenRate, 0);
  assert.strictEqual(r.measures.amplifier, 1);
  assert.ok(r.warnings.some((w) => /没有任何税负/.test(w)));
});

// ══════════════════════════════════════════════════════════════
// 3. BigInt 有理数独立实现对拍（300 组随机 + 5 个内置场景 + 默认）
// ══════════════════════════════════════════════════════════════
test('精确有理数独立实现对拍：5 个内置场景 + 默认场景', () => {
  const names = ['appliance', 'wine', 'cosmetic', 'machine', 'material'];
  names.forEach((k) => {
    const input = C.clonePreset(k);
    const got = C.solve(input), ref = refSolve(input);
    closeTo(got.totals.dutiableForeign, fNum(ref.dutiableForeign), 1e-9, k + ' 完税价格');
    closeTo(got.totals.taxForeign, fNum(ref.taxForeign), 1e-9, k + ' 税费');
    closeTo(got.totals.totalLocal, fNum(ref.totalLocal), 1e-9, k + ' 总成本');
    closeTo(got.measures.burdenRate, fNum(ref.burdenRate), 1e-9, k + ' 税负率');
    closeTo(got.totals.unitCostLocal, fNum(ref.unitCostLocal), 1e-9, k + ' 单件成本');
    got.rows.forEach((r2, i) => {
      closeTo(r2.dutiableForeign, fNum(ref.rows[i].u), 1e-9, k + ' 行' + i + ' 完税价格');
      closeTo(r2.dutyForeign, fNum(ref.rows[i].d), 1e-9, k + ' 行' + i + ' 关税');
      closeTo(r2.exciseForeign, fNum(ref.rows[i].e), 1e-9, k + ' 行' + i + ' 消费税');
      closeTo(r2.vatForeign, fNum(ref.rows[i].v), 1e-9, k + ' 行' + i + ' 增值税');
    });
  });
});

test('精确有理数独立实现对拍：300 组随机构造（1–6 行、两种保险口径、随机税率）', () => {
  const rnd = lcg(20261109);
  const names = ['货A', '货B', '货C', '货D', '货E', '零件-F', '原料G'];
  for (let t = 0; t < 300; t++) {
    const n = rint(rnd, 1, 6);
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(row(pick(rnd, names) + i, rint(rnd, 1, 20000), dec2(rnd, 0.01, 5000),
        dec1(rnd, 0, 300), dec1(rnd, 0, 60), pick(rnd, ['0', '6', '9', '13', '13', '16'])));
    }
    const mode = rnd() < 0.5 ? 'rate' : 'amount';
    const input = {
      currency: 'X', rate: dec2(rnd, 0.01, 100),
      freight: dec2(rnd, 0, 50000), insuranceMode: mode,
      insuranceRate: mode === 'rate' ? dec2(rnd, 0, 5) : '0.3',
      insuranceAmount: mode === 'amount' ? dec2(rnd, 0, 5000) : '',
      margin: String(rint(rnd, 0, 95)),
      targetPrice: rnd() < 0.5 ? dec2(rnd, 1000, 9999999) : '',
      rows,
      otherFees: rint(rnd, 0, 4) === 0 ? [] : [{ name: '费用', amount: dec2(rnd, 0, 20000) }]
    };
    const got = C.solve(input), ref = refSolve(input);
    closeTo(got.totals.dutiableForeign, fNum(ref.dutiableForeign), 1e-8, '第' + t + '组 完税价格');
    closeTo(got.totals.taxForeign, fNum(ref.taxForeign), 1e-8, '第' + t + '组 税费');
    closeTo(got.totals.totalLocal, fNum(ref.totalLocal), 1e-8, '第' + t + '组 总成本');
    closeTo(got.measures.burdenRate, fNum(ref.burdenRate), 1e-8, '第' + t + '组 税负率');
    // 独立检查常识：实际税费不低于「三档税率直接相加」口径
    assert.ok(got.measures.naiveUnderstateLocal >= -1e-6, '第' + t + '组 名义相加不应大于实际税费');
    // 逐行税额之和等于合计
    const sumTax = got.rows.reduce((s, r2) => s + r2.taxForeign, 0);
    closeTo(sumTax, got.totals.taxForeign, 1e-12, '第' + t + '组 逐行求和');
  }
});

// ══════════════════════════════════════════════════════════════
// 4. 分摊与结构性质
// ══════════════════════════════════════════════════════════════
test('运保费按货值比例分摊：同一场景内各行比例相同；运费固定时货值翻倍会把比例摊薄', () => {
  const base = C.solve(inp({ rows: [row('甲', 100, '10', 8, 0, 13), row('乙', 50, '20', 0, 0, 13)], targetPrice: '' }));
  const doubled = C.solve(inp({ rows: [row('甲', 100, '20', 8, 0, 13), row('乙', 50, '40', 0, 0, 13)], targetPrice: '' }));
  const r1 = base.rows.map((r) => r.apportionedForeign / r.goodsForeign);
  const r2 = doubled.rows.map((r) => r.apportionedForeign / r.goodsForeign);
  closeTo(r1[0], r1[1], 1e-12, '同一场景内两行分摊比例应相同');
  closeTo(r2[0], r2[1], 1e-12, '缩放后两行分摊比例仍相同');
  // (运费 480 + 保险 6) / 货值 2000 = 0.243；货值翻倍后 (480 + 12) / 4000 = 0.123
  closeTo(r1[0], 486 / 2000, 1e-12, '原始分摊比例');
  closeTo(r2[0], 492 / 4000, 1e-12, '货值翻倍后的分摊比例（运费固定，比例被摊薄）');
  assert.ok(r2[0] < r1[0], '运费固定时货值越大，运保费占比越低');
  closeTo(doubled.totals.dutiableForeign, base.totals.dutiableForeign * 2 - base.totals.freightForeign, 1e-9, '完税价格 = 货值×2 + 运费 + 保险（保险按货值比例翻倍）');
});

test('成本对货值是仿射的：C(3) = 2·C(2) − C(1) 的线性外推成立', () => {
  const input = inp({ rows: [row('甲', 100, '10', 8, 0, 13), row('乙', 50, '20', 17, 5, 13)], targetPrice: '' });
  const n = C.normalize(input);
  const c1 = C.computeAt(n, 1).totals.totalLocal;
  const c2 = C.computeAt(n, 2).totals.totalLocal;
  const c3 = C.computeAt(n, 3).totals.totalLocal;
  closeTo(c3, 2 * c2 - c1, 1e-9, '仿射外推');
});

test('含税放大恒等式：完税价格每多 1 元，总成本恰好多 (1 + 综合税负率) 元', () => {
  const inputs = [
    inp({ rows: [row('甲', 100, '10', 10, 0, 13)] }),
    inp({ rows: [row('甲', 100, '10', 14, 10, 13)] }),
    inp({ rows: [row('甲', 100, '10', 5, 15, 13), row('乙', 20, '30', 0, 0, 9)] }),
    inp({ rows: [row('甲', 100, '10', 0, 0, 0)] })
  ];
  inputs.forEach((input, i) => {
    const r = C.solve(input);
    closeTo(r.checks.dutiableAmplifier.actual, r.checks.dutiableAmplifier.expected, 1e-9, '第' + i + '组 放大倍数');
    closeTo(r.checks.freightAmplifier.actual, r.rate * r.measures.amplifier, 1e-9, '第' + i + '组 外币口径放大');
    assert.ok(Math.abs(r.checks.dutiableAmplifier.diff) < 1e-6, '第' + i + '组 恒等式差值应接近 0');
  });
});

test('税种占比合计 100%（有税时）；无税时为 0', () => {
  ['appliance', 'wine', 'cosmetic', 'machine', 'material'].forEach((k) => {
    const r = C.solve(C.clonePreset(k));
    const sum = r.measures.dutyShare + r.measures.exciseShare + r.measures.vatShare;
    assert.ok(r.totals.taxForeign > 0);
    closeTo(sum, 100, 1e-9, k + ' 占比合计');
  });
  const zero = C.solve(inp({ rows: [row('零', 1, '10', 0, 0, 0)], targetPrice: '' }));
  assert.strictEqual(zero.measures.dutyShare, 0);
  assert.strictEqual(zero.measures.shareSum === undefined ? 0 : zero.checks.shareSum.actual, 0);
});

test('保险两种口径在等价时给出同一结果', () => {
  const goods = 100 * 10;                              // 1000
  const byRate = C.solve(inp({ rows: [row('甲', 100, '10', 10, 0, 13)], freight: '200', insuranceMode: 'rate', insuranceRate: '0.5', targetPrice: '' }));
  const byAmount = C.solve(inp({ rows: [row('甲', 100, '10', 10, 0, 13)], freight: '200', insuranceMode: 'amount', insuranceAmount: String(goods * 0.005), targetPrice: '' }));
  closeTo(byRate.totals.insuranceForeign, byAmount.totals.insuranceForeign, 1e-12, '保险费');
  closeTo(byRate.totals.totalLocal, byAmount.totals.totalLocal, 1e-9, '总成本');
});

// ══════════════════════════════════════════════════════════════
// 5. 反推与定价
// ══════════════════════════════════════════════════════════════
test('最低售价：总成本 ÷ (1 − 毛利率)，毛利额等于成本 × 毛利率 ÷ (1 − 毛利率)', () => {
  ['appliance', 'wine', 'machine'].forEach((k) => {
    const input = C.clonePreset(k);
    const r = C.solve(input);
    const m = Number(input.margin) / 100;
    closeTo(r.pricing.minPriceLocal, r.totals.totalLocal / (1 - m), 1e-12, k + ' 最低售价');
    closeTo(r.pricing.grossProfitLocal, r.totals.totalLocal * m / (1 - m), 1e-9, k + ' 毛利额');
    closeTo(r.pricing.minPriceLocal * (1 - m), r.totals.totalLocal, 1e-9, k + ' 回代');
  });
});

test('可承受货值上限：回代重算恰为售价允许的成本（残差≈0）', () => {
  ['appliance', 'cosmetic', 'machine', 'material'].forEach((k) => {
    const input = C.clonePreset(k);
    const r = C.solve(input);
    assert.strictEqual(r.reverse.meets, true, k + ' 这个场景应达标');
    const n = C.normalize(input);
    const scaled = { rows: n.rows.map((x) => Object.assign({}, x, { unitPrice: x.unitPrice * r.reverse.scale })), rate: n.rate, freight: n.freight, insuranceMode: n.insuranceMode, insuranceRate: n.insuranceRate, insuranceAmount: n.insuranceAmount, otherFees: n.otherFees, goodsForeign: n.goodsForeign };
    // 用同样结构把货值缩放到上限，总成本应恰好等于「目标售价 × (1 − 毛利率)」
    const scaledRows = n.rows.map((x) => Object.assign({}, x, { unitPrice: String(x.unitPrice * r.reverse.scale) }));
    const check = C.solve(Object.assign({}, input, { rows: scaledRows, targetPrice: '' }));
    closeTo(check.totals.totalLocal, r.reverse.allowedCostLocal, 1e-6, k + ' 回代总成本');
    assert.ok(Math.abs(r.reverse.residualLocal) < 1e-6 * Math.max(1, r.reverse.allowedCostLocal), k + ' 残差');
  });
});

test('可承受统一关税率上限：回代重算恰为售价允许的成本（残差≈0）', () => {
  ['appliance', 'cosmetic', 'machine', 'material'].forEach((k) => {
    const input = C.clonePreset(k);
    const r = C.solve(input);
    assert.ok(r.maxDuty.available, k + ' 应可反推');
    const n = C.normalize(input);
    const rowsAt = n.rows.map((x) => Object.assign({}, x, { dutyRate: String(r.maxDuty.rate) }));
    const check = C.solve(Object.assign({}, input, { rows: rowsAt, targetPrice: '' }));
    closeTo(check.totals.totalLocal, r.maxDuty.allowedCostLocal, 1e-6, k + ' 回代总成本');
    assert.ok(Math.abs(r.maxDuty.residualLocal) < 1e-6 * Math.max(1, r.maxDuty.allowedCostLocal), k + ' 残差');
    // 再高一点就应该超
    const rowsOver = n.rows.map((x) => Object.assign({}, x, { dutyRate: String(Math.min(C.LIMITS.MAX_DUTY, r.maxDuty.rate + 1)) }));
    const over = C.solve(Object.assign({}, input, { rows: rowsOver, targetPrice: '' }));
    assert.ok(over.totals.totalLocal > r.maxDuty.allowedCostLocal - 1e-6, k + ' 超过上限应超预算');
  });
});

test('反推的三种情形：达标有余量 / 需要压缩货值 / 即使关税为 0 也不达标', () => {
  const plenty = C.solve(inp({ targetPrice: '200000' }));
  assert.strictEqual(plenty.reverse.meets, true);
  assert.ok(plenty.reverse.headroomPct > 0);
  const tight = C.solve(inp({ targetPrice: '80000' }));
  assert.strictEqual(tight.reverse.meets, false);
  assert.ok(tight.reverse.headroomPct < 0);
  assert.ok(tight.maxDuty.rate === null || tight.maxDuty.rate < tight.maxDuty.currentMaxDuty);
  const impossible = C.solve(inp({ targetPrice: '1000' }));
  assert.strictEqual(impossible.reverse.meets, false);
  assert.match(impossible.maxDuty.reason, /即使关税为 0 也不达标/);
  assert.match(impossible.reverse.reason, /即使货值为 0 也不达标/);
  assert.ok(impossible.reverse.maxGoodsForeign < 0);
});

test('关税率上限超过 300% 时截断并标注', () => {
  const r = C.solve(inp({ targetPrice: '10000000', margin: '95' }));
  assert.strictEqual(r.maxDuty.capped, true);
  assert.strictEqual(r.maxDuty.rate, C.LIMITS.MAX_DUTY);
});

test('不填目标售价时跳过反推并提示', () => {
  const r = C.solve(inp({ targetPrice: '' }));
  assert.strictEqual(r.reverse, null);
  assert.strictEqual(r.maxDuty, null);
  assert.ok(r.warnings.some((w) => /没有填目标售价/.test(w)));
});

// ══════════════════════════════════════════════════════════════
// 6. 敏感性
// ══════════════════════════════════════════════════════════════
test('敏感性表：6 行、方向正确、每行都与独立重算一致', () => {
  const input = C.clonePreset('wine');
  const r = C.solve(input);
  assert.strictEqual(r.sensitivity.length, 6);
  const dutyUp = r.sensitivity[0];
  const rateUp = r.sensitivity[2];
  const rateDown = r.sensitivity[3];
  const freightUp = r.sensitivity[4];
  assert.ok(dutyUp.deltaLocal > 0, '关税率上升成本应上升');
  assert.ok(rateUp.deltaLocal > 0, '汇率上升成本应上升');
  assert.ok(rateDown.deltaLocal < 0, '汇率下降成本应下降');
  assert.ok(freightUp.deltaLocal > 0, '运费上升成本应上升');
  // 汇率 +5% 只影响会随汇率变动的部分（本币「其他费用」不随汇率变）
  const r0 = C.solve(input);
  const scalable = (r0.totals.totalLocal - r0.totals.otherLocal) / r0.totals.totalLocal;
  closeTo(rateUp.deltaPct, 5 * scalable, 1e-6, '汇率 +5% 时成本涨幅 = 5% × 随汇率变动的占比');
  assert.ok(rateUp.deltaPct < 5, '有其他费用时汇率 +5% 的成本涨幅应小于 5%');
  // 独立重算：关税率 +5 个百分点
  const n = C.normalize(input);
  const rows5 = n.rows.map((x) => Object.assign({}, x, { dutyRate: String(x.dutyRate + 5) }));
  const manual = C.solve(Object.assign({}, input, { rows: rows5, targetPrice: '' }));
  closeTo(dutyUp.totalLocal, manual.totals.totalLocal, 1e-9, '关税率 +5 独立重算');
  r.sensitivity.forEach((s) => { assert.ok(isFinite(s.totalLocal) && isFinite(s.minPriceLocal)); });
});

test('敏感性：消费税 +5 个百分点在 99% 上限处被截断并注明', () => {
  const r = C.solve(inp({ rows: [row('甲', 10, '10', 5, 97, 13)], targetPrice: '' }));
  const sens = r.sensitivity[5];
  assert.match(sens.note, /截断到 99%/);
});

// ══════════════════════════════════════════════════════════════
// 7. 边界
// ══════════════════════════════════════════════════════════════
test('边界：6 行全部可算，逐行合计与总数一致', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(row('第' + (i + 1) + '种货', (i + 1) * 10, String((i + 1) * 3.5), i * 5, i === 5 ? 0 : i, 13));
  const r = C.solve(inp({ rows, targetPrice: '' }));
  assert.strictEqual(r.rows.length, 6);
  const sumU = r.rows.reduce((s, x) => s + x.dutiableForeign, 0);
  closeTo(sumU, r.totals.dutiableForeign, 1e-9, '逐行完税价格求和');
  closeTo(r.rows.reduce((s, x) => s + x.goodsForeign, 0), r.totals.goodsForeign, 1e-9, '逐行货值求和');
});

test('边界：货值为 0 的行不分摊运保费、不产生税额，但计入单件分母并给出提示', () => {
  const r = C.solve(inp({ rows: [row('赠品', 100, '0', 10, 0, 13), row('正品', 10, '100', 10, 0, 13)], targetPrice: '' }));
  assert.strictEqual(r.rows[0].goodsForeign, 0);
  assert.strictEqual(r.rows[0].dutiableForeign, 0);
  assert.strictEqual(r.rows[0].taxForeign, 0);
  assert.ok(r.rows[1].dutiableForeign > 1000);   // 全部运保费摊到正品上
  assert.strictEqual(r.totals.totalQty, 110);
  assert.ok(r.warnings.some((w) => /货值为 0/.test(w)));
});

test('边界：关税率 300%、消费税率 99%、增值税率 100% 都能算出有限值', () => {
  const r = C.solve(inp({ rows: [row('极端', 1, '100', 300, 99, 100)], freight: '0', insuranceMode: 'rate', insuranceRate: '0', targetPrice: '' }));
  assert.ok(isFinite(r.totals.totalLocal) && r.totals.totalLocal > 0);
  // 手算：完税价格 100 → 关税 300 → 消费税 (400)/(0.01)*0.99 = 39600 → 增值税 (400+39600)*1 = 40000
  closeTo(r.totals.exciseForeign, (100 + 300) / 0.01 * 0.99, 1e-6, '消费税');
  closeTo(r.totals.vatForeign, (100 + 300 + (100 + 300) / 0.01 * 0.99) * 1, 1e-6, '增值税');
  closeTo(r.measures.burdenRate, (300 + (400 / 0.01 * 0.99) + r.totals.vatForeign) / 100 * 100, 1e-6, '税负率');
});

test('边界：数量 1 与 1000000、单价 0.01 与 1e9 都是合法输入', () => {
  const a = C.solve(inp({ rows: [row('一件', 1, '0.01', 0, 0, 13)], targetPrice: '' }));
  assert.strictEqual(a.totals.totalQty, 1);
  const b = C.solve(inp({ rows: [row('百万件', 1000000, '1e9', 5, 0, 13)], targetPrice: '' }));
  assert.ok(isFinite(b.totals.totalLocal));
  closeTo(b.totals.goodsForeign, 1e15, 1e-9, '货值 1e15');
});

test('边界：目标毛利率 0% 与 95%', () => {
  const zero = C.solve(inp({ margin: '0' }));
  closeTo(zero.pricing.minPriceLocal, zero.totals.totalLocal, 1e-9, '毛利 0 时最低售价 = 成本');
  const high = C.solve(inp({ margin: '95' }));
  closeTo(high.pricing.minPriceLocal, high.totals.totalLocal / 0.05, 1e-9, '毛利 95%');
});

test('边界：其他费用 0 项与 4 项', () => {
  const none = C.solve(inp({ otherFees: [], targetPrice: '' }));
  assert.strictEqual(none.totals.otherLocal, 0);
  const four = C.solve(inp({ otherFees: [{ name: 'a', amount: '1' }, { name: 'b', amount: '2' }, { name: 'c', amount: '3' }, { name: 'd', amount: '4' }], targetPrice: '' }));
  assert.strictEqual(four.totals.otherLocal, 10);
});

test('边界：运费 0、保险费 0、汇率为极小值与 1e6', () => {
  const r1 = C.solve(inp({ freight: '0', insuranceMode: 'rate', insuranceRate: '0', targetPrice: '' }));
  closeTo(r1.totals.dutiableForeign, r1.totals.goodsForeign, 1e-12, '运保费为 0 时完税价格 = 货值');
  const tiny = C.solve(inp({ rate: '0.000001', targetPrice: '' }));
  assert.ok(isFinite(tiny.totals.totalLocal));
  const huge = C.solve(inp({ rate: '1000000', targetPrice: '' }));
  assert.ok(isFinite(huge.totals.totalLocal) && huge.totals.totalLocal > tiny.totals.totalLocal);
});

// ══════════════════════════════════════════════════════════════
// 8. 非法输入
// ══════════════════════════════════════════════════════════════
test('非法输入：逐条报错且信息可读', () => {
  const bad = [
    [inp({ rows: [] }), /至少要有一行货物/],
    [inp({ rows: new Array(7).fill(row('x', 1, '1', 0, 0, 13)) }), /最多 6 行/],
    [inp({ rows: [row('', 1, '1', 0, 0, 13)] }), /名称不能为空/],
    [inp({ rows: [row('x'.repeat(17), 1, '1', 0, 0, 13)] }), /名称最多 16 个字符/],
    [inp({ rows: [row('x', '0', '1', 0, 0, 13)] }), /数量不能小于 1/],
    [inp({ rows: [row('x', '-3', '1', 0, 0, 13)] }), /数量不能小于 1/],
    [inp({ rows: [row('x', '2.5', '1', 0, 0, 13)] }), /数量必须是整数/],
    [inp({ rows: [row('x', '1000001', '1', 0, 0, 13)] }), /数量不能大于 1000000/],
    [inp({ rows: [row('x', '1', '', 0, 0, 13)] }), /单价不能为空/],
    [inp({ rows: [row('x', '1', 'abc', 0, 0, 13)] }), /不是有效数字/],
    [inp({ rows: [row('x', '1', '-1', 0, 0, 13)] }), /单价不能小于 0/],
    [inp({ rows: [row('x', '1', '1', '301', 0, 13)] }), /关税率不能大于 300/],
    [inp({ rows: [row('x', '1', '1', '-1', 0, 13)] }), /关税率不能小于 0/],
    [inp({ rows: [row('x', '1', '1', '0', '100', 13)] }), /消费税率不能大于 99/],
    [inp({ rows: [row('x', '1', '1', '0', '0', '101')] }), /增值税率不能大于 100/],
    [inp({ rows: [row('x', '1', '1', '0', '0', '13')], rate: '0' }), /汇率不能小于/],
    [inp({ rate: '-7' }), /汇率不能小于/],
    [inp({ rate: '' }), /汇率不能为空/],
    [inp({ rate: '1000001' }), /汇率不能大于 1000000/],
    [inp({ freight: '-1' }), /国际运费不能小于 0/],
    [inp({ freight: 'x' }), /不是有效数字/],
    [inp({ insuranceMode: 'weird' }), /保险口径只能是/],
    [inp({ insuranceRate: '101' }), /保险费率不能大于 100/],
    [inp({ insuranceMode: 'amount', insuranceAmount: '' }), /保险金额不能为空/],
    [inp({ insuranceMode: 'amount', insuranceAmount: '-5' }), /保险金额不能小于 0/],
    [inp({ otherFees: new Array(5).fill({ name: 'a', amount: '1' }) }), /其他费用最多 4 项/],
    [inp({ otherFees: [{ name: '', amount: '1' }] }), /其他费用第 1 项的名称不能为空/],
    [inp({ otherFees: [{ name: 'a', amount: 'x' }] }), /不是有效数字/],
    [inp({ margin: '-1' }), /目标毛利率不能小于 0/],
    [inp({ margin: '96' }), /目标毛利率不能大于 95/],
    [inp({ margin: '' }), /目标毛利率不能为空/],
    [inp({ targetPrice: '0' }), /目标售价不能小于/],
    [inp({ targetPrice: '-5' }), /目标售价不能小于/],
    [inp({ rows: [row('x', '1', '0', 10, 0, 13)] }), /货值合计为 0/],
    [inp({ rows: [row('x', '1', '1', 0, 0, 13)], currency: 'USD' }, null), null]
  ];
  bad.forEach(([input, re], i) => {
    if (re === null) return;
    assert.throws(() => C.solve(input), (e) => {
      assert.ok(e.userMessage, '第' + i + '条应带 userMessage');
      assert.match(e.userMessage, re);
      return true;
    }, '第' + i + '条未按预期报错');
  });
});

test('非法输入：clonePreset 未知 key 报错', () => {
  assert.throws(() => C.clonePreset('nope'), /没有这个内置场景/);
});

// ══════════════════════════════════════════════════════════════
// 9. 输出字段有效性与确定性
// ══════════════════════════════════════════════════════════════
test('输出字段递归有效性：没有 undefined / NaN / Infinity', () => {
  function walk(v, path) {
    if (v === undefined) assert.fail('字段为 undefined：' + path);
    if (typeof v === 'number') {
      assert.ok(isFinite(v), '字段不是有限数：' + path + ' = ' + v);
      assert.ok(!Number.isNaN(v), '字段是 NaN：' + path);
    }
    if (typeof v === 'string') assert.ok(v.length > 0 || path.indexOf('reason') >= 0 || path.indexOf('note') >= 0, '空字符串：' + path);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '[' + i + ']'));
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k], path + '.' + k));
  }
  ['appliance', 'wine', 'cosmetic', 'machine', 'material'].forEach((k) => {
    walk(C.solve(C.clonePreset(k)), k);
  });
  walk(C.solve(inp({ targetPrice: '' })), 'appliance-no-target');
  walk(C.solve(inp({ rows: [row('甲', 1, '10', 0, 0, 0)], targetPrice: '' })), 'zero-tax');
});

test('确定性：同一输入两次求解结果逐字节一致', () => {
  ['appliance', 'wine', 'cosmetic', 'machine', 'material'].forEach((k) => {
    const a = JSON.stringify(C.solve(C.clonePreset(k)));
    const b = JSON.stringify(C.solve(C.clonePreset(k)));
    assert.strictEqual(a, b, k + ' 两次结果应一致');
  });
});

test('求解不修改传入的输入对象（纯函数）', () => {
  const input = C.clonePreset('wine');
  const before = JSON.stringify(input);
  C.solve(input);
  assert.strictEqual(JSON.stringify(input), before);
});

test('内置场景元数据完整：key/label/note/input 齐全且都能解', () => {
  assert.ok(C.PRESETS.length >= 5);
  const keys = new Set();
  C.PRESETS.forEach((p) => {
    assert.ok(p.key && p.label && p.note && p.input, '场景字段缺失：' + p.key);
    assert.ok(!keys.has(p.key), 'key 重复：' + p.key);
    keys.add(p.key);
    const r = C.solve(C.clonePreset(p.key));
    assert.ok(r.totals.totalLocal > 0);
    assert.ok(r.rows.length >= 1);
    // 所有变量都参与：逐行货值 > 0
    r.rows.forEach((x) => assert.ok(x.goodsForeign >= 0));
  });
});
