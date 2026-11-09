/* 到岸成本台 · core.js
 * 进口到岸成本与税费算术：按货值比例分摊运保费 → 完税价格 → 关税
 * → 价内消费税倒算 → 增值税（按含消费税价格计征）→ 成本汇总
 * → 综合税负率 / 含税放大倍数 → 最低售价 → 可承受货值上限与关税率上限（仿射两点精确反推）。
 * 纯计算、无 DOM、无网络；浏览器挂 window.AppCore，Node 下 module.exports。
 */
(function (global) {
  'use strict';

  var LIMITS = {
    MIN_ROWS: 1, MAX_ROWS: 6,
    MAX_NAME: 16,
    MAX_QTY: 1000000,
    MAX_PRICE: 1e9,
    MAX_RATE: 1e6,             // 汇率（人民币 / 外币）
    MAX_DUTY: 300,             // 关税率 %
    MAX_EXCISE: 99,            // 消费税率 %（必须 < 100，价内税倒算的分母）
    MAX_VAT: 100,              // 增值税率 %
    MAX_FREIGHT: 1e9,
    MAX_INS_RATE: 100,         // 保险费率 %
    MAX_FEE: 4,                // 其他费用最多几项
    MAX_FEE_AMOUNT: 1e9,
    MAX_MARGIN: 95,            // 目标毛利率 %
    EPS: 1e-9
  };

  function err(msg) { var e = new Error(msg); e.userMessage = msg; return e; }

  var NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

  // ── 数值解析 ────────────────────────────────────────────────
  function numStrict(v, label, min, max) {
    var x;
    if (typeof v === 'number') {
      x = v;
    } else {
      var s = String(v === null || v === undefined ? '' : v).trim();
      if (!s) throw err(label + '不能为空');
      if (!NUM_RE.test(s)) throw err(label + '不是有效数字：' + s);
      x = Number(s);
    }
    if (!isFinite(x)) throw err(label + '超出了可计算范围');
    if (typeof min === 'number' && x < min) throw err(label + '不能小于 ' + min);
    if (typeof max === 'number' && x > max) throw err(label + '不能大于 ' + max);
    return x;
  }

  function intStrict(v, label, min, max) {
    var x = numStrict(v, label, min, max);
    if (Math.abs(x - Math.round(x)) > 1e-9) throw err(label + '必须是整数');
    return Math.round(x);
  }

  function optNum(v, label, min, max) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return null;
    return numStrict(s, label, min, max);
  }

  // ── 格式化 ──────────────────────────────────────────────────
  function fmt(x, d) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    d = typeof d === 'number' ? d : 2;
    if (x !== 0 && Math.abs(x) < Math.pow(10, -d) / 2) x = 0;
    return x.toFixed(d);
  }
  function money(x) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    var neg = x < 0; x = Math.abs(x);
    var s = x.toFixed(2).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s[0] + '.' + s[1];
  }
  function money4(x) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    var neg = x < 0; x = Math.abs(x);
    var s = x.toFixed(4).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s[0] + '.' + s[1];
  }
  function pct(x, d) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    return fmt(x, typeof d === 'number' ? d : 2) + '%';
  }

  // ── 内置场景（全部虚构，税率只是演示用整数） ────────────────
  var PRESETS = [
    {
      key: 'appliance',
      label: '跨境电商小家电（默认）',
      note: '虚构示例：一批便携小家电，关税 10%，无消费税',
      input: {
        currency: 'USD', rate: '7.20', freight: '480',
        insuranceMode: 'rate', insuranceRate: '0.3', insuranceAmount: '',
        margin: '25', targetPrice: '120000',
        rows: [{ name: '便携榨汁机', qty: '500', unitPrice: '12.50', dutyRate: '10', exciseRate: '0', vatRate: '13' }],
        otherFees: [{ name: '报关与口岸费', amount: '800' }, { name: '国内运费', amount: '1200' }]
      }
    },
    {
      key: 'wine',
      label: '进口葡萄酒（消费税）',
      note: '虚构示例：消费税是从价价内税，会让税基滚起来',
      input: {
        currency: 'EUR', rate: '7.80', freight: '2600',
        insuranceMode: 'rate', insuranceRate: '0.3', insuranceAmount: '',
        margin: '35', targetPrice: '120000',
        rows: [{ name: '干红葡萄酒 750ml', qty: '1200', unitPrice: '4.20', dutyRate: '14', exciseRate: '10', vatRate: '13' }],
        otherFees: [{ name: '报关与口岸费', amount: '1500' }, { name: '国内运费与仓储', amount: '2600' }]
      }
    },
    {
      key: 'cosmetic',
      label: '进口化妆品（高消费税）',
      note: '虚构示例：消费税率越高，价内税倒算的放大越明显',
      input: {
        currency: 'JPY', rate: '0.048', freight: '38000',
        insuranceMode: 'amount', insuranceAmount: '12000',
        margin: '45', targetPrice: '380000',
        rows: [{ name: '精华液 30ml', qty: '800', unitPrice: '3200', dutyRate: '5', exciseRate: '15', vatRate: '13' }],
        otherFees: [{ name: '报关与口岸费', amount: '1200' }]
      }
    },
    {
      key: 'machine',
      label: '进口机械设备（运保费高）',
      note: '虚构示例：运保费占货值两成以上，也被征税',
      input: {
        currency: 'USD', rate: '7.20', freight: '26000',
        insuranceMode: 'amount', insuranceAmount: '3200',
        margin: '20', targetPrice: '1750000',
        rows: [{ name: '数控雕刻机', qty: '4', unitPrice: '26000', dutyRate: '8', exciseRate: '0', vatRate: '13' }],
        otherFees: [{ name: '报关与口岸费', amount: '3600' }, { name: '国内运输与吊装', amount: '9800' }]
      }
    },
    {
      key: 'material',
      label: '零关税原材料（多行分摊）',
      note: '虚构示例：两种原材料不同关税率，运保费按货值比例分摊',
      input: {
        currency: 'USD', rate: '7.20', freight: '1500',
        insuranceMode: 'rate', insuranceRate: '0.5', insuranceAmount: '',
        margin: '15', targetPrice: '130000',
        rows: [
          { name: '食品级树脂', qty: '3000', unitPrice: '2.10', dutyRate: '0', exciseRate: '0', vatRate: '13' },
          { name: '色母粒', qty: '600', unitPrice: '6.80', dutyRate: '6.5', exciseRate: '0', vatRate: '13' }
        ],
        otherFees: [{ name: '报关与口岸费', amount: '600' }]
      }
    }
  ];

  function blankRow() {
    return { name: '', qty: '1', unitPrice: '', dutyRate: '', exciseRate: '0', vatRate: '13' };
  }
  function blankInput() {
    return {
      currency: 'USD', rate: '', freight: '', insuranceMode: 'rate',
      insuranceRate: '0.3', insuranceAmount: '', margin: '25', targetPrice: '',
      rows: [blankRow()], otherFees: []
    };
  }
  function clonePreset(key) {
    var p = null;
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) p = PRESETS[i];
    if (!p) throw err('没有这个内置场景：' + key);
    return JSON.parse(JSON.stringify(p.input));
  }

  // ── 校验 + 归一化 ───────────────────────────────────────────
  function normalize(input) {
    if (!input || typeof input !== 'object') throw err('输入不是一个对象');
    var out = {};
    out.currency = String(input.currency === null || input.currency === undefined ? '' : input.currency).trim().slice(0, 8) || '外币';
    out.rate = numStrict(input.rate, '汇率', LIMITS.EPS, LIMITS.MAX_RATE);

    var rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length < LIMITS.MIN_ROWS) throw err('至少要有一行货物');
    if (rows.length > LIMITS.MAX_ROWS) throw err('货物最多 ' + LIMITS.MAX_ROWS + ' 行');
    out.rows = rows.map(function (r, i) {
      var n = i + 1;
      var name = String(r && r.name !== null && r.name !== undefined ? r.name : '').trim();
      if (!name) throw err('第 ' + n + ' 行的名称不能为空');
      if (name.length > LIMITS.MAX_NAME) throw err('第 ' + n + ' 行的名称最多 ' + LIMITS.MAX_NAME + ' 个字符');
      return {
        name: name,
        qty: intStrict(r.qty, '第 ' + n + ' 行的数量', 1, LIMITS.MAX_QTY),
        unitPrice: numStrict(r.unitPrice, '第 ' + n + ' 行的单价', 0, LIMITS.MAX_PRICE),
        dutyRate: numStrict(r.dutyRate, '第 ' + n + ' 行的关税率', 0, LIMITS.MAX_DUTY),
        exciseRate: numStrict(r.exciseRate, '第 ' + n + ' 行的消费税率', 0, LIMITS.MAX_EXCISE),
        vatRate: numStrict(r.vatRate, '第 ' + n + ' 行的增值税率', 0, LIMITS.MAX_VAT)
      };
    });

    out.freight = numStrict(input.freight, '国际运费', 0, LIMITS.MAX_FREIGHT);
    var mode = String(input.insuranceMode || 'rate');
    if (mode !== 'rate' && mode !== 'amount') throw err('保险口径只能是「按货值比例」或「固定金额」');
    out.insuranceMode = mode;
    if (mode === 'rate') {
      out.insuranceRate = numStrict(input.insuranceRate, '保险费率', 0, LIMITS.MAX_INS_RATE);
      out.insuranceAmount = null;
    } else {
      out.insuranceAmount = numStrict(input.insuranceAmount, '保险金额', 0, LIMITS.MAX_FREIGHT);
      out.insuranceRate = null;
    }

    var fees = Array.isArray(input.otherFees) ? input.otherFees : [];
    if (fees.length > LIMITS.MAX_FEE) throw err('其他费用最多 ' + LIMITS.MAX_FEE + ' 项');
    out.otherFees = fees.map(function (f, i) {
      var n = i + 1;
      var name = String(f && f.name ? f.name : '').trim();
      if (!name) throw err('其他费用第 ' + n + ' 项的名称不能为空');
      if (name.length > LIMITS.MAX_NAME) throw err('其他费用第 ' + n + ' 项的名称最多 ' + LIMITS.MAX_NAME + ' 个字符');
      return { name: name, amount: numStrict(f.amount, '其他费用第 ' + n + ' 项的金额', 0, LIMITS.MAX_FEE_AMOUNT) };
    });

    out.margin = numStrict(input.margin, '目标毛利率', 0, LIMITS.MAX_MARGIN);
    out.targetPrice = optNum(input.targetPrice, '目标售价', LIMITS.EPS, LIMITS.MAX_PRICE * LIMITS.MAX_RATE);

    var G = 0;
    out.rows.forEach(function (r) { G += r.qty * r.unitPrice; });
    if (!(G > 0)) throw err('所有行的货值合计为 0（数量 × 单价），没有可以分摊运保费和计税的基数');
    out.goodsForeign = G;
    return out;
  }

  // ── 核心计算：货值缩放 s 倍时的全部结果 ─────────────────────
  function computeAt(n, s) {
    var rowsIn = n.rows;
    var G = n.goodsForeign * s;
    var F = n.freight;
    var I = n.insuranceMode === 'rate' ? G * n.insuranceRate / 100 : n.insuranceAmount;
    var ratio = (F + I) / G;                       // 运保费 / 货值（与缩放无关）

    var rows = [];
    var U = 0, D = 0, E = 0, V = 0, naive = 0, qty = 0, other = 0;
    rowsIn.forEach(function (r) {
      var g = r.qty * r.unitPrice * s;
      var u = g * (1 + ratio);                     // 完税价格（外币）
      var d = u * r.dutyRate / 100;
      var e = (u + d) / (1 - r.exciseRate / 100) * r.exciseRate / 100;
      var v = (u + d + e) * r.vatRate / 100;
      var tax = d + e + v;
      var naiveTax = u * (r.dutyRate + r.exciseRate + r.vatRate) / 100; // 「三档税率直接相加」的错算口径
      U += u; D += d; E += e; V += v; naive += naiveTax; qty += r.qty;
      rows.push({
        name: r.name, qty: r.qty, unitPrice: r.unitPrice * s, dutyRate: r.dutyRate,
        exciseRate: r.exciseRate, vatRate: r.vatRate,
        goodsForeign: g, apportionedForeign: u - g, dutiableForeign: u,
        dutyForeign: d, exciseForeign: e, vatForeign: v, taxForeign: tax,
        dutiableLocal: u * n.rate, taxLocal: tax * n.rate,
        totalLocal: (u + tax) * n.rate, unitLocal: (u + tax) * n.rate / r.qty,
        burdenRate: u > 0 ? tax / u * 100 : 0,
        amplifier: u > 0 ? (u + tax) / u : 1
      });
    });
    n.otherFees.forEach(function (f) { other += f.amount; });

    var taxForeign = D + E + V;
    var landedLocal = U * n.rate;
    var taxLocal = taxForeign * n.rate;
    var totalLocal = landedLocal + taxLocal + other;
    var burdenRate = U > 0 ? taxForeign / U * 100 : 0;

    return {
      s: s,
      rows: rows,
      totals: {
        goodsForeign: G, freightForeign: F, insuranceForeign: I, apportionedForeign: F + I,
        dutiableForeign: U, dutyForeign: D, exciseForeign: E, vatForeign: V,
        taxForeign: taxForeign, taxLocal: taxLocal, landedLocal: landedLocal,
        otherLocal: other, totalLocal: totalLocal, totalQty: qty,
        goodsLocal: G * n.rate, freightLocal: F * n.rate, insuranceLocal: I * n.rate,
        dutyLocal: D * n.rate, exciseLocal: E * n.rate, vatLocal: V * n.rate,
        unitCostLocal: totalLocal / qty, unitDutiableLocal: U * n.rate / qty,
        unitTaxLocal: taxLocal / qty
      },
      measures: {
        burdenRate: burdenRate,                       // 综合税负率 %（税费 ÷ 到岸成本）
        amplifier: 1 + burdenRate / 100,              // 运保费含税放大倍数
        dutyShare: taxForeign > 0 ? D / taxForeign * 100 : 0,
        exciseShare: taxForeign > 0 ? E / taxForeign * 100 : 0,
        vatShare: taxForeign > 0 ? V / taxForeign * 100 : 0,
        freightShare: totalLocal > 0 ? (F + I) * n.rate / totalLocal * 100 : 0,
        naiveTaxLocal: naive * n.rate,
        naiveUnderstateLocal: (taxForeign - naive) * n.rate
      },
      marginal: { freightPerUnitGainLocal: 1 + burdenRate / 100 }
    };
  }

  // ── 主求解 ─────────────────────────────────────────────────
  function solve(input) {
    var n = normalize(input);
    var base = computeAt(n, 1);
    var t = base.totals, m = base.measures;

    // 定价
    var minPrice = t.totalLocal / (1 - n.margin / 100);
    var pricing = {
      margin: n.margin, minPriceLocal: minPrice, minUnitPriceLocal: minPrice / t.totalQty,
      grossProfitLocal: minPrice - t.totalLocal, costLocal: t.totalLocal
    };

    // 反推：目标售价 → 可承受货值上限（成本对货值仿射，两点求值精确解）
    var reverse = null;
    if (n.targetPrice !== null) {
      var limit = n.targetPrice * (1 - n.margin / 100);
      var c1 = t.totalLocal, c2 = computeAt(n, 2).totals.totalLocal;
      var a = c2 - c1, b = 2 * c1 - c2;            // C(s) = a·s + b
      var sMax = a > 0 ? (limit - b) / a : (c1 <= limit ? Infinity : -Infinity);
      var maxGoodsForeign = sMax * n.goodsForeign;
      var meets = c1 <= limit + Math.max(1, limit) * LIMITS.EPS;
      var residual = null, reason = '';
      if (a <= 0) reason = '货值对成本的边际影响为 0（所有单价都是 0），无法反推货值上限';
      else if (sMax < 0) reason = '即使货值为 0 也不达标：固定费用与运保费本身已超过这个售价允许的成本';
      else if (!isFinite(maxGoodsForeign)) reason = '当前成本已低于售价允许的成本，货值上限不受此项约束';
      if (a > 0 && sMax >= 0 && isFinite(sMax)) {
        residual = computeAt(n, sMax).totals.totalLocal - limit;
      }
      reverse = {
        targetPriceLocal: n.targetPrice, allowedCostLocal: limit, meets: meets,
        scale: sMax, maxGoodsForeign: maxGoodsForeign,
        maxGoodsLocal: maxGoodsForeign * n.rate,
        headroomPct: (sMax - 1) * 100,
        currentGoodsForeign: n.goodsForeign,
        slope: a, intercept: b, residualLocal: residual, reason: reason,
        perUnitMaxGoodsLocal: maxGoodsForeign * n.rate / t.totalQty
      };
    }

    // 反推：目标售价 → 可承受的统一关税率上限（成本对关税率同样仿射）
    var maxDuty = null;
    if (n.targetPrice !== null) {
      var limit2 = n.targetPrice * (1 - n.margin / 100);
      var rowsZero = n.rows.map(function (r) { return { name: r.name, qty: r.qty, unitPrice: r.unitPrice, dutyRate: 0, exciseRate: r.exciseRate, vatRate: r.vatRate }; });
      var rowsHundred = n.rows.map(function (r) { return { name: r.name, qty: r.qty, unitPrice: r.unitPrice, dutyRate: 100, exciseRate: r.exciseRate, vatRate: r.vatRate }; });
      var c0 = computeAt({ rows: rowsZero, rate: n.rate, freight: n.freight, insuranceMode: n.insuranceMode, insuranceRate: n.insuranceRate, insuranceAmount: n.insuranceAmount, otherFees: n.otherFees, goodsForeign: n.goodsForeign }, 1).totals.totalLocal;
      var c100 = computeAt({ rows: rowsHundred, rate: n.rate, freight: n.freight, insuranceMode: n.insuranceMode, insuranceRate: n.insuranceRate, insuranceAmount: n.insuranceAmount, otherFees: n.otherFees, goodsForeign: n.goodsForeign }, 1).totals.totalLocal;
      var k = (c100 - c0) / 100;                   // 每 1 个百分点关税带来的成本增加
      var tMax = k > 0 ? (limit2 - c0) / k : Infinity;
      var capped = false, dutyReason = '';
      if (!(k > 0)) dutyReason = '关税对成本没有影响（完税价格为 0）';
      else if (tMax < 0) dutyReason = '即使关税为 0 也不达标：不含关税的成本已经超过这个售价允许的成本';
      if (tMax > LIMITS.MAX_DUTY) { capped = true; tMax = LIMITS.MAX_DUTY; }
      var dutyResidual = null;
      if (k > 0 && tMax >= 0 && isFinite(tMax)) {
        var rowsAt = n.rows.map(function (r) { return { name: r.name, qty: r.qty, unitPrice: r.unitPrice, dutyRate: tMax, exciseRate: r.exciseRate, vatRate: r.vatRate }; });
        dutyResidual = computeAt({ rows: rowsAt, rate: n.rate, freight: n.freight, insuranceMode: n.insuranceMode, insuranceRate: n.insuranceRate, insuranceAmount: n.insuranceAmount, otherFees: n.otherFees, goodsForeign: n.goodsForeign }, 1).totals.totalLocal - limit2;
      }
      maxDuty = {
        available: k > 0, rate: k > 0 ? tMax : null, capped: capped, reason: dutyReason,
        currentMaxDuty: Math.max.apply(null, n.rows.map(function (r) { return r.dutyRate; })),
        perPointLocal: k, costAtZeroDutyLocal: c0, residualLocal: dutyResidual, allowedCostLocal: limit2
      };
    }

    // 敏感性
    function variant(patch, label, note) {
      var rows = n.rows.map(function (r) { return { name: r.name, qty: r.qty, unitPrice: r.unitPrice, dutyRate: r.dutyRate, exciseRate: r.exciseRate, vatRate: r.vatRate }; });
      var v = { rows: rows, rate: n.rate, freight: n.freight, insuranceMode: n.insuranceMode, insuranceRate: n.insuranceRate, insuranceAmount: n.insuranceAmount, otherFees: n.otherFees, goodsForeign: n.goodsForeign };
      if (patch.dutyAdd) rows.forEach(function (r) { r.dutyRate = Math.min(LIMITS.MAX_DUTY, r.dutyRate + patch.dutyAdd); });
      if (patch.exciseAdd) {
        var clamped = false;
        rows.forEach(function (r) {
          var want = r.exciseRate + patch.exciseAdd;
          if (want > LIMITS.MAX_EXCISE) { want = LIMITS.MAX_EXCISE; clamped = true; }
          r.exciseRate = want;
        });
        if (clamped) note = (note ? note + '；' : '') + '有行被截断到 ' + LIMITS.MAX_EXCISE + '%';
      }
      if (patch.rateMul) v.rate = n.rate * patch.rateMul;
      if (patch.freightMul) v.freight = n.freight * patch.freightMul;
      var r2 = computeAt(v, 1);
      var total = r2.totals.totalLocal;
      return {
        label: label, note: note || '',
        totalLocal: total, deltaLocal: total - t.totalLocal,
        deltaPct: t.totalLocal > 0 ? (total - t.totalLocal) / t.totalLocal * 100 : 0,
        minPriceLocal: total / (1 - n.margin / 100),
        unitCostLocal: r2.totals.unitCostLocal, fallout: t.totalLocal > 0 ? (total - t.totalLocal) / t.totalLocal * 100 : 0
      };
    }
    var sensitivity = [
      variant({ dutyAdd: 5 }, '关税率 +5 个百分点', '各行关税率同时加 5 个点'),
      variant({ dutyAdd: 20 }, '关税率 +20 个百分点', ''),
      variant({ rateMul: 1.05 }, '汇率 +5%', '外币升值，本币成本上升'),
      variant({ rateMul: 0.95 }, '汇率 −5%', '外币贬值，本币成本下降'),
      variant({ freightMul: 1.2 }, '国际运费 +20%', '运保费也进完税价格'),
      variant({ exciseAdd: 5 }, '消费税 +5 个百分点', '')
    ];

    // 提示
    var warnings = [];
    if (t.taxForeign === 0) warnings.push('三档税率都是 0，这批货没有任何税负；如果这不是你的本意，请检查关税率与增值税率是否漏填。');
    var zeroRows = base.rows.filter(function (r) { return r.goodsForeign === 0; });
    if (zeroRows.length) warnings.push('有 ' + zeroRows.length + ' 行货值为 0（' + zeroRows.map(function (r) { return r.name; }).join('、') + '）：不分摊运保费、不产生税额，但数量会计入单件成本的分母。');
    var exciseRows = base.rows.filter(function (r) { return r.exciseRate > 0; });
    if (exciseRows.length) warnings.push('有 ' + exciseRows.length + ' 行要缴消费税：它是价内税，会先把 (完税价格 + 关税) 还原成含税价再乘税率，同时抬高增值税的税基。');
    if (m.naiveUnderstateLocal > 0.005) warnings.push('把三档税率直接相加会少算 ' + money(m.naiveUnderstateLocal) + ' 元（名义相加 ' + money(m.naiveTaxLocal) + ' 元 vs 实际税费 ' + money(t.taxLocal) + ' 元）。');
    if (m.freightShare > 15) warnings.push('运保费占到总成本的 ' + pct(m.freightShare, 1) + '，而它们也要被征税——每省 1 元运保费，总成本降 ' + fmt(m.amplifier, 4) + ' 元。');
    if (!n.targetPrice) warnings.push('没有填目标售价，已跳过「可承受货值上限 / 可承受关税率上限」的反推。');
    if (t.otherLocal > t.totalLocal * 0.2) warnings.push('其他费用占总成本 ' + pct(t.otherLocal / t.totalLocal * 100, 1) + '，它们不进完税价格、不产生税额，但直接吃掉毛利。');

    var result = {
      ok: true,
      currency: n.currency, rate: n.rate, insuranceMode: n.insuranceMode, margin: n.margin,
      input: n,
      rows: base.rows,
      totals: t,
      measures: m,
      pricing: pricing,
      reverse: reverse,
      maxDuty: maxDuty,
      sensitivity: sensitivity,
      warnings: warnings,
      nominal: {
        dutyRate: n.rows.reduce(function (s, r) { return s + r.dutyRate; }, 0) / n.rows.length,
        exciseRate: n.rows.reduce(function (s, r) { return s + r.exciseRate; }, 0) / n.rows.length,
        vatRate: n.rows.reduce(function (s, r) { return s + r.vatRate; }, 0) / n.rows.length,
        weightedSum: n.rows.reduce(function (s, r) { return s + r.dutyRate + r.exciseRate + r.vatRate; }, 0) / n.rows.length
      }
    };
    // 自检恒等式（页面与测试都用得到；这里算出实际差值，便于如实标注）
    var probe = n.rows.map(function (r) { return { name: r.name, qty: r.qty, unitPrice: r.unitPrice, dutyRate: r.dutyRate, exciseRate: r.exciseRate, vatRate: r.vatRate }; });
    // 把外币运费加 1/汇率（即完税价格正好多 1 元本币），总成本应恰好多 (1 + 综合税负率) 元
    var plusOneDutiable = { rows: probe, rate: n.rate, freight: n.freight + 1 / n.rate, insuranceMode: n.insuranceMode, insuranceRate: n.insuranceRate, insuranceAmount: n.insuranceAmount, otherFees: n.otherFees, goodsForeign: n.goodsForeign };
    var deltaDutiable = computeAt(plusOneDutiable, 1).totals.totalLocal - t.totalLocal;
    var plusOneForeign = { rows: probe, rate: n.rate, freight: n.freight + 1, insuranceMode: n.insuranceMode, insuranceRate: n.insuranceRate, insuranceAmount: n.insuranceAmount, otherFees: n.otherFees, goodsForeign: n.goodsForeign };
    var deltaForeign = computeAt(plusOneForeign, 1).totals.totalLocal - t.totalLocal;
    result.checks = {
      dutiableAmplifier: { actual: deltaDutiable, expected: m.amplifier, diff: deltaDutiable - m.amplifier },
      freightAmplifier: { actual: deltaForeign, expected: n.rate * m.amplifier, diff: deltaForeign - n.rate * m.amplifier },
      shareSum: { actual: m.dutyShare + m.exciseShare + m.vatShare, expected: t.taxForeign > 0 ? 100 : 0 }
    };
    return result;
  }

  var api = {
    LIMITS: LIMITS, PRESETS: PRESETS, blankRow: blankRow, blankInput: blankInput,
    clonePreset: clonePreset, normalize: normalize, solve: solve, computeAt: computeAt,
    fmt: fmt, money: money, money4: money4, pct: pct
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AppCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
