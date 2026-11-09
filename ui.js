/* 到岸成本台 · ui.js —— 界面、导出与本地持久化（纯前端，不联网） */
(function () {
  'use strict';
  var C = window.AppCore;
  var STORE = 'landed-cost-ledger-v1';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(x) { return C.money(x); }
  function f2(x) { return C.fmt(x, 2); }
  function f4(x) { return C.fmt(x, 4); }

  // ── 状态 ────────────────────────────────────────────────────
  var state = C.clonePreset('appliance');
  var lastResult = null;
  var savedAt = null;

  function readInput() {
    return {
      currency: $('currency').value,
      rate: $('rate').value,
      freight: $('freight').value,
      insuranceMode: $('insuranceMode').value,
      insuranceRate: $('insuranceRate').value,
      insuranceAmount: $('insuranceAmount').value,
      margin: $('margin').value,
      targetPrice: $('targetPrice').value,
      rows: state.rows.map(function (r, i) {
        return {
          name: ($('rowName' + i) || {}).value === undefined ? r.name : $('rowName' + i).value,
          qty: ($('rowQty' + i) || {}).value === undefined ? r.qty : $('rowQty' + i).value,
          unitPrice: ($('rowPrice' + i) || {}).value === undefined ? r.unitPrice : $('rowPrice' + i).value,
          dutyRate: ($('rowDuty' + i) || {}).value === undefined ? r.dutyRate : $('rowDuty' + i).value,
          exciseRate: ($('rowExcise' + i) || {}).value === undefined ? r.exciseRate : $('rowExcise' + i).value,
          vatRate: ($('rowVat' + i) || {}).value === undefined ? r.vatRate : $('rowVat' + i).value
        };
      }),
      otherFees: state.otherFees.map(function (f, i) {
        return {
          name: ($('feeName' + i) || {}).value === undefined ? f.name : $('feeName' + i).value,
          amount: ($('feeAmount' + i) || {}).value === undefined ? f.amount : $('feeAmount' + i).value
        };
      })
    };
  }

  function writeInput(input) {
    state = {
      currency: input.currency || 'USD', rate: input.rate, freight: input.freight,
      insuranceMode: input.insuranceMode || 'rate',
      insuranceRate: input.insuranceRate === undefined || input.insuranceRate === null ? '0.3' : input.insuranceRate,
      insuranceAmount: input.insuranceAmount === undefined || input.insuranceAmount === null ? '' : input.insuranceAmount,
      margin: input.margin === undefined || input.margin === null ? '25' : input.margin,
      targetPrice: input.targetPrice === undefined || input.targetPrice === null ? '' : input.targetPrice,
      rows: (input.rows || []).map(function (r) {
        return { name: r.name || '', qty: r.qty === '' || r.qty === undefined ? '1' : String(r.qty), unitPrice: r.unitPrice === undefined ? '' : String(r.unitPrice), dutyRate: r.dutyRate === undefined ? '' : String(r.dutyRate), exciseRate: r.exciseRate === undefined ? '0' : String(r.exciseRate), vatRate: r.vatRate === undefined ? '13' : String(r.vatRate) };
      }),
      otherFees: (input.otherFees || []).map(function (f) { return { name: f.name || '', amount: f.amount === undefined ? '' : String(f.amount) }; })
    };
    if (!state.rows.length) state.rows = [C.blankRow()];
  }

  // ── 输入区渲染 ──────────────────────────────────────────────
  function renderRows() {
    var box = $('rows');
    box.innerHTML = state.rows.map(function (r, i) {
      return '<div class="item" data-row="' + i + '">' +
        '<div class="item-head"><span class="idx">' + (i + 1) + '</span>' +
        '<input type="text" id="rowName' + i + '" aria-label="第' + (i + 1) + '行货物名称" placeholder="货物名称" value="' + esc(r.name) + '">' +
        '<button type="button" class="mini del-row" data-arg="' + i + '">删除</button></div>' +
        '<div class="grid3">' +
        '<label class="f"><span>数量</span><input type="text" inputmode="numeric" id="rowQty' + i + '" aria-label="第' + (i + 1) + '行数量" value="' + esc(r.qty) + '"></label>' +
        '<label class="f"><span>单价（外币）</span><input type="text" inputmode="decimal" id="rowPrice' + i + '" aria-label="第' + (i + 1) + '行单价" value="' + esc(r.unitPrice) + '"></label>' +
        '<label class="f"><span>关税率 %</span><input type="text" inputmode="decimal" id="rowDuty' + i + '" aria-label="第' + (i + 1) + '行关税率" value="' + esc(r.dutyRate) + '"></label>' +
        '<label class="f"><span>消费税率 %</span><input type="text" inputmode="decimal" id="rowExcise' + i + '" aria-label="第' + (i + 1) + '行消费税率" value="' + esc(r.exciseRate) + '"></label>' +
        '<label class="f"><span>增值税率 %</span><input type="text" inputmode="decimal" id="rowVat' + i + '" aria-label="第' + (i + 1) + '行增值税率" value="' + esc(r.vatRate) + '"></label>' +
        '</div></div>';
    }).join('');
  }
  function renderFees() {
    $('fees').innerHTML = state.otherFees.map(function (f, i) {
      return '<div class="item" data-fee="' + i + '"><div class="item-head"><span class="idx">¥</span>' +
        '<input type="text" id="feeName' + i + '" aria-label="第' + (i + 1) + '项费用名称" placeholder="费用名称（如 报关与口岸费）" value="' + esc(f.name) + '">' +
        '<input type="text" inputmode="decimal" id="feeAmount' + i + '" class="amount" aria-label="第' + (i + 1) + '项费用金额" placeholder="金额" value="' + esc(f.amount) + '">' +
        '<button type="button" class="mini del-fee" data-arg="' + i + '">删除</button></div></div>';
    }).join('');
  }
  function renderFields() {
    $('currency').value = state.currency;
    $('rate').value = state.rate;
    $('freight').value = state.freight;
    $('insuranceMode').value = state.insuranceMode;
    $('insuranceRate').value = state.insuranceRate === null ? '' : state.insuranceRate;
    $('insuranceAmount').value = state.insuranceAmount === null ? '' : state.insuranceAmount;
    $('margin').value = state.margin;
    $('targetPrice').value = state.targetPrice;
    var byRate = state.insuranceMode === 'rate';
    $('insuranceRate').disabled = !byRate;
    $('insuranceAmount').disabled = byRate;
  }
  function renderInputs() { renderRows(); renderFees(); renderFields(); }

  // ── 结果区渲染 ──────────────────────────────────────────────
  var COST_KEYS = [
    ['goodsLocal', '货物货值', false],
    ['freightLocal', '国际运费', false],
    ['insuranceLocal', '保险费', false],
    ['dutyLocal', '关税', true],
    ['exciseLocal', '消费税', true],
    ['vatLocal', '增值税', true],
    ['otherLocal', '其他费用', false]
  ];

  function renderResult(r) {
    var t = r.totals, m = r.measures, u = esc(r.currency);
    var h = [];
    h.push('<div class="metric">' + esc('到岸总成本') + ' <strong>' + money(t.totalLocal) + '</strong> 元（人民币）<br>' +
      '<span class="sub">单件 ' + money(t.unitCostLocal) + ' 元 / ' + t.totalQty + ' 件 · 综合税负率 <strong>' + f2(m.burdenRate) + '%</strong> · 含税放大 ' + f4(m.amplifier) + ' 倍</span></div>');
    h.push('<div class="stats">' +
      '<div><strong>' + money(t.goodsLocal) + '</strong><span>货物货值（本币，按汇率 ' + f4(r.rate) + ' 折算）</span></div>' +
      '<div><strong>' + money((t.freightForeign + t.insuranceForeign) * r.rate) + '</strong><span>运保费（本币，也进完税价格）</span></div>' +
      '<div><strong>' + money(t.dutiableForeign * r.rate) + '</strong><span>完税价格（货值＋运保费，本币）</span></div>' +
      '<div><strong>' + money(t.taxLocal) + '</strong><span>税费合计（本币）</span></div>' +
      '<div><strong>' + f2(m.freightShare) + '%</strong><span>运保费占总成本</span></div>' +
      '</div>');

    // 成本构成
    h.push('<h3>成本构成</h3><div>');
    var maxv = Math.max.apply(null, COST_KEYS.map(function (k) { return t[k[0]]; }));
    COST_KEYS.forEach(function (k) {
      var v = t[k[0]];
      var share = t.totalLocal > 0 ? v / t.totalLocal * 100 : 0;
      var cls = k[2] ? 'bar hot' : 'bar';
      h.push('<div class="barrow"><b>' + esc(k[1]) + '</b><span class="' + cls + '"><i style="width:' + (maxv > 0 ? v / maxv * 100 : 0).toFixed(2) + '%"></i></span><span>' + money(v) + '（' + f2(share) + '%）</span></div>');
    });
    h.push('</div>');
    h.push('<div class="tw"><table class="stack"><thead><tr><th>构成</th><th>金额（本币）</th><th>占总成本</th><th>是否进完税价格</th></tr></thead><tbody>');
    var anyExcise = t.exciseLocal > 0;
    COST_KEYS.forEach(function (k) {
      var v = t[k[0]];
      h.push('<tr><td data-label="构成">' + esc(k[1]) + '</td><td class="num" data-label="金额（本币）">' + money(v) + '</td><td class="num" data-label="占总成本">' + f2(t.totalLocal > 0 ? v / t.totalLocal * 100 : 0) + '%</td><td data-label="是否进完税价格">' + (k[0] === 'goodsLocal' || k[0] === 'freightLocal' || k[0] === 'insuranceLocal' ? '是' : (k[2] ? '间接：以完税价格为基数' : '否')) + '</td></tr>');
    });
    h.push('<tr class="cur"><td data-label="构成"><b>总成本</b></td><td class="num" data-label="金额（本币）"><b>' + money(t.totalLocal) + '</b></td><td class="num" data-label="占总成本"><b>100.00%</b></td><td data-label="是否进完税价格">—</td></tr>');
    h.push('</tbody></table></div>');

    // 逐行明细
    h.push('<h3>逐行明细<span class="note" style="font-weight:400">（表格较宽时可左右滑动查看全部列）</span></h3><div class="tw"><table class="stack"><thead><tr><th>货物</th><th>数量</th><th>单价</th><th>货值</th><th>运保费</th><th>完税价</th><th>关税</th>' + (anyExcise ? '<th>消费税</th>' : '') + '<th>增值税</th><th>行成本</th><th>税负率</th></tr></thead><tbody>');
    r.rows.forEach(function (x) {
      h.push('<tr><td data-label="货物">' + esc(x.name) + '</td><td class="num" data-label="数量">' + x.qty + '</td><td class="num" data-label="单价">' + f4(x.unitPrice) + '</td><td class="num" data-label="货值">' + f2(x.goodsForeign) + '</td><td class="num" data-label="运保费">' + f2(x.apportionedForeign) + '</td><td class="num" data-label="完税价">' + f2(x.dutiableForeign) + '</td><td class="num" data-label="关税">' + f2(x.dutyForeign) + '</td>' + (anyExcise ? '<td class="num" data-label="消费税">' + f2(x.exciseForeign) + '</td>' : '') + '<td class="num" data-label="增值税">' + f2(x.vatForeign) + '</td><td class="num" data-label="行成本">' + money(x.totalLocal) + '</td><td class="num" data-label="税负率">' + f2(x.burdenRate) + '%</td></tr>');
    });
    h.push('</tbody></table></div><div class="note">表中外币列为 ' + esc(r.currency) + '，本币列（行成本）按汇率 ' + f4(r.rate) + ' 折算，显示四舍五入到分。每行分摊的运保费 = 该行货值 × （运保费 ÷ 总货值）。</div>');

    // 口径对照
    h.push('<h3>口径对照：为什么不能用「三档税率直接相加」</h3><div class="tw"><table class="stack fix"><thead><tr><th style="width:24%">口径</th><th style="width:20%">税费（本币）</th><th style="width:56%">说明</th></tr></thead><tbody>');
    h.push('<tr><td data-label="口径">三档税率直接相加（常见错算）</td><td class="num" data-label="税费（本币）">' + money(m.naiveTaxLocal) + '</td><td data-label="说明">完税价格 ×（关税率 + 消费税率 + 增值税率），忽略了消费税是价内税、增值税的税基含关税与消费税</td></tr>');
    h.push('<tr class="cur"><td data-label="口径"><b>本页口径（逐层计征）</b></td><td class="num" data-label="税费（本币）"><b>' + money(t.taxLocal) + '</b></td><td data-label="说明">关税 → 价内消费税倒算 → 增值税按含关税与消费税的价格计征</td></tr>');
    h.push('<tr><td data-label="口径">差额（错算会少算）</td><td class="num" data-label="税费（本币）">' + money(m.naiveUnderstateLocal) + '</td><td data-label="说明">' + (t.taxLocal > 0 ? '相当于实际税费的 ' + f2(m.naiveUnderstateLocal / t.taxLocal * 100) + '%' : '—') + '</td></tr>');
    h.push('</tbody></table></div>');
    h.push('<div class="note">综合税负率 <b>' + f2(m.burdenRate) + '%</b>（税费 ÷ 完税价格），三档税率行平均之和只有 ' + f2(r.nominal.weightedSum) + '%。<b>含税放大倍数 ' + f4(m.amplifier) + '</b>：完税价格（或运保费）每多 1 元，本币总成本就多 ' + f4(m.amplifier) + ' 元。</div>');

    // 定价与反推
    h.push('<h3>定价与反推</h3><div class="tw"><table class="stack fix"><thead><tr><th style="width:30%">项目</th><th style="width:26%">数值</th><th style="width:44%">口径</th></tr></thead><tbody>');
    h.push('<tr><td data-label="项目">总成本</td><td class="num" data-label="数值">' + money(t.totalLocal) + '</td><td data-label="口径">到岸成本 + 税费 + 其他费用</td></tr>');
    h.push('<tr><td data-label="项目">目标毛利率</td><td class="num" data-label="数值">' + f2(r.margin) + '%</td><td data-label="口径">你在左侧填的毛利要求</td></tr>');
    h.push('<tr class="cur"><td data-label="项目"><b>最低售价（整批）</b></td><td class="num" data-label="数值"><b>' + money(r.pricing.minPriceLocal) + '</b></td><td data-label="口径">总成本 ÷ (1 − 毛利率)</td></tr>');
    h.push('<tr><td data-label="项目">最低单件售价</td><td class="num" data-label="数值">' + money(r.pricing.minUnitPriceLocal) + '</td><td data-label="口径">最低售价 ÷ ' + t.totalQty + ' 件</td></tr>');
    h.push('<tr><td data-label="项目">这个售价下的毛利额</td><td class="num" data-label="数值">' + money(r.pricing.grossProfitLocal) + '</td><td data-label="口径">最低售价 − 总成本</td></tr>');
    if (r.reverse) {
      h.push('<tr><td data-label="项目">目标售价</td><td class="num" data-label="数值">' + money(r.reverse.targetPriceLocal) + '</td><td data-label="口径">你在左侧填的卖价</td></tr>');
      h.push('<tr><td data-label="项目">这个售价允许的成本</td><td class="num" data-label="数值">' + money(r.reverse.allowedCostLocal) + '</td><td data-label="口径">目标售价 × (1 − 毛利率)</td></tr>');
      h.push('<tr class="' + (r.reverse.meets ? 'cur' : '') + '"><td data-label="项目"><b>目标是否达标</b></td><td class="num" data-label="数值"><b>' + (r.reverse.meets ? '达标' : '不达标') + '</b></td><td data-label="口径">当前成本 ' + money(t.totalLocal) + ' vs 允许成本 ' + money(r.reverse.allowedCostLocal) + '</td></tr>');
      if (r.reverse.reason) h.push('<tr><td data-label="项目">可承受货值上限</td><td class="num" data-label="数值">—</td><td data-label="口径">' + esc(r.reverse.reason) + '</td></tr>');
      else {
        h.push('<tr><td data-label="项目">可承受货值上限（合计）</td><td class="num" data-label="数值">' + money(r.reverse.maxGoodsForeign) + ' ' + u + '（' + money(r.reverse.maxGoodsLocal) + ' 元）</td><td data-label="口径">保持各行比例与运保费、其他费用不变，货值最高到这个数</td></tr>');
        h.push('<tr><td data-label="项目">相对当前货值的余量</td><td class="num" data-label="数值">' + (r.reverse.headroomPct >= 0 ? '+' : '') + f2(r.reverse.headroomPct) + '%</td><td data-label="口径">（上限 ÷ 当前货值 − 1）；当前货值 ' + f2(r.reverse.currentGoodsForeign) + ' ' + u + '</td></tr>');
        h.push('<tr><td data-label="项目">反推校验（解回代残差）</td><td class="num" data-label="数值">' + C.fmt(r.reverse.residualLocal, 8) + ' 元</td><td data-label="口径">把货值缩放到上限后重算的总成本 − 允许成本</td></tr>');
      }
      if (r.maxDuty && r.maxDuty.available) {
        h.push('<tr' + (r.maxDuty.rate > r.maxDuty.currentMaxDuty ? ' class="cur"' : '') + '><td data-label="项目"><b>可承受的统一关税率上限</b></td><td class="num" data-label="数值"><b>' + f2(r.maxDuty.rate) + '%</b>' + (r.maxDuty.capped ? '（已截断到 300%）' : '') + '</td><td data-label="口径">各行关税率统一提高到这个数时，成本恰好用满允许成本；当前最高 ' + f2(r.maxDuty.currentMaxDuty) + '%；每 1 个百分点约 ' + money(r.maxDuty.perPointLocal) + ' 元' + (r.maxDuty.residualLocal === null ? '' : '；回代残差 ' + C.fmt(r.maxDuty.residualLocal, 8) + ' 元') + '</td></tr>');
      } else if (r.maxDuty) {
        h.push('<tr><td data-label="项目">可承受的统一关税率上限</td><td class="num" data-label="数值">—</td><td data-label="口径">' + esc(r.maxDuty.reason || '关税为 0 时已经是当前成本') + '</td></tr>');
      }
    } else {
      h.push('<tr><td data-label="项目">可承受货值 / 关税率上限</td><td class="num" data-label="数值">—</td><td data-label="口径">左侧没有填目标售价，未反推</td></tr>');
    }
    h.push('</tbody></table></div>');
    if (r.reverse && !r.reverse.meets && !r.reverse.reason) {
      h.push('<div class="buttons"><button type="button" class="mini apply" data-act="scale-goods">把各行单价按上限等比压低并重算</button></div>');
    }
    if (r.maxDuty && r.maxDuty.available && r.maxDuty.rate > 0 && !r.maxDuty.capped && r.maxDuty.rate < 300) {
      h.push('<div class="buttons"><button type="button" class="mini apply" data-act="set-duty">把各行关税率改成上限值并重算</button></div>');
    }

    // 敏感性
    h.push('<h3>敏感性：改一个条件，成本怎么变</h3><div class="tw"><table class="stack"><thead><tr><th>情形</th><th>总成本</th><th>变化</th><th>最低售价</th></tr></thead><tbody>');
    r.sensitivity.forEach(function (s) {
      h.push('<tr><td data-label="情形">' + esc(shortLabel(s.label)) + (s.note ? '<br><span class="note">' + esc(s.note) + '</span>' : '') + '</td><td class="num" data-label="总成本">' + money(s.totalLocal) + '</td><td class="num" data-label="变化">' + (s.deltaLocal >= 0 ? '+' : '−') + money(Math.abs(s.deltaLocal)) + '（' + (s.deltaPct >= 0 ? '+' : '−') + f2(Math.abs(s.deltaPct)) + '%）</td><td class="num" data-label="最低售价">' + money(s.minPriceLocal) + '</td></tr>');
    });
    h.push('</tbody></table></div>');

    // 建议
    h.push('<h3>下一步</h3><ul class="advice">');
    advise(r).forEach(function (a) { h.push('<li class="' + a.cls + '">' + a.html + '</li>'); });
    h.push('</ul>');

    // 提示
    if (r.warnings.length) {
      h.push('<h3>需要注意</h3><ul class="warnlist">');
      r.warnings.forEach(function (w) { h.push('<li>' + esc(w) + '</li>'); });
      h.push('</ul>');
    }
    $('result').innerHTML = h.join('');
  }

  /** 敏感性表的短标签（表格里省地方；完整口径在「算法与使用边界」与 MD 里） */
  function shortLabel(label) {
    return String(label).replace('关税率 +5 个百分点', '关税 +5 个点').replace('关税率 +20 个百分点', '关税 +20 个点')
      .replace('消费税 +5 个百分点', '消费税 +5 个点').replace('国际运费 +20%', '运费 +20%');
  }

  function advise(r) {
    var t = r.totals, m = r.measures, out = [];
    // 主导税种
    if (t.taxForeign > 0) {
      var kinds = [['关税', m.dutyShare, t.dutyLocal], ['消费税', m.exciseShare, t.exciseLocal], ['增值税', m.vatShare, t.vatLocal]];
      kinds.sort(function (a, b) { return b[1] - a[1]; });
      var top = kinds[0];
      out.push({ cls: 'key', html: '这批货的税费里 <b>' + top[0] + '</b> 最多：' + money(top[2]) + ' 元，占税费的 <b>' + f2(top[1]) + '%</b>。综合税负率 ' + f2(m.burdenRate) + '%（税费 ÷ 完税价格），而三档税率行平均之和只有 ' + f2(r.nominal.weightedSum) + '%——差的这部分就是税在滚：' + (t.exciseLocal > 0 ? '消费税是价内税，会把 (完税价格 + 关税) 还原成含税价；' : '') + '增值税的税基里含关税' + (t.exciseLocal > 0 ? '与消费税' : '') + '。' });
    }
    // 放大倍数
    out.push({ cls: 'info', html: '含税放大倍数 <b>' + f4(m.amplifier) + '</b>：完税价格每多 1 元（比如多花 1 元运费或保险），本币总成本就多 <b>' + f4(m.amplifier) + '</b> 元。目前运保费占总成本 ' + f2(m.freightShare) + '%。' + (m.freightShare >= 8 ? '想省钱，先看能不能压运费与保险。' : '运保费占比不高，压它省下来的有限。') });
    // 达标
    if (r.reverse) {
      if (r.reverse.meets) {
        var extra = r.reverse.reason ? '' : '，货值还有约 ' + f2(r.reverse.headroomPct) + '% 的空间（上限 ' + money(r.reverse.maxGoodsForeign) + ' ' + r.currency + '）';
        out.push({ cls: 'ok', html: '在目标售价 ' + money(r.reverse.targetPriceLocal) + ' 元、毛利率 ' + f2(r.margin) + '% 的要求下，允许成本 ' + money(r.reverse.allowedCostLocal) + ' 元，当前成本 ' + money(t.totalLocal) + ' 元，<b>达标</b>' + extra + '。' });
      } else if (r.reverse.reason) {
        out.push({ cls: 'act', html: '在目标售价 ' + money(r.reverse.targetPriceLocal) + ' 元、毛利率 ' + f2(r.margin) + '% 的要求下，允许成本只有 ' + money(r.reverse.allowedCostLocal) + ' 元，而当前成本 ' + money(t.totalLocal) + ' 元：<b>' + esc(r.reverse.reason) + '</b>。要么提高售价、要么降低毛利要求，要么把运保费与其他费用压下来。' });
      } else {
        out.push({ cls: 'act', html: '在目标售价 ' + money(r.reverse.targetPriceLocal) + ' 元、毛利率 ' + f2(r.margin) + '% 的要求下，允许成本 ' + money(r.reverse.allowedCostLocal) + ' 元，当前成本 ' + money(t.totalLocal) + ' 元，<b>超了 ' + money(t.totalLocal - r.reverse.allowedCostLocal) + ' 元</b>。按现在的结构，货值要压到 ' + money(r.reverse.maxGoodsForeign) + ' ' + r.currency + '（' + (r.reverse.headroomPct >= 0 ? '还能涨 ' : '要降 ') + f2(Math.abs(r.reverse.headroomPct)) + '%）才够；也可以把售价提到 ' + money(r.pricing.minPriceLocal) + ' 元以上。' });
      }
    }
    // 关税率上限
    if (r.maxDuty && r.maxDuty.available && !r.maxDuty.capped && r.maxDuty.rate >= 0) {
      out.push({ cls: r.maxDuty.rate > r.maxDuty.currentMaxDuty ? 'ok' : 'warn', html: '关税最多能涨到 <b>' + f2(r.maxDuty.rate) + '%</b>（各行统一口径，当前最高 ' + f2(r.maxDuty.currentMaxDuty) + '%）：再高，这个售价与毛利就撑不住了。每 1 个百分点关税约 ' + money(r.maxDuty.perPointLocal) + ' 元。' });
    } else if (r.maxDuty && r.maxDuty.reason) {
      out.push({ cls: 'warn', html: '关于关税空间：' + esc(r.maxDuty.reason) + '。' });
    }
    // 最敏感
    if (r.sensitivity.length) {
      var worst = r.sensitivity.slice().sort(function (a, b) { return Math.abs(b.deltaPct) - Math.abs(a.deltaPct); })[0];
      out.push({ cls: 'info', html: '这几项里最敏感的是 <b>' + esc(worst.label) + '</b>：总成本 ' + (worst.deltaPct >= 0 ? '+' : '−') + f2(Math.abs(worst.deltaPct)) + '%（' + (worst.deltaLocal >= 0 ? '+' : '−') + money(Math.abs(worst.deltaLocal)) + ' 元），最低售价随之变成 ' + money(worst.minPriceLocal) + ' 元。' });
    }
    if (m.exciseShare > 0) out.push({ cls: 'info', html: '消费税只在部分品类上征收，本页按你填的税率算<b>从价</b>消费税；从量、复合计税（按支、按升加定额税）不在本页范围内。' });
    out.push({ cls: 'info', html: '本页不查税则、不判断归类、不联网：所有税率都来自你填的输入。真实申报的完税价格认定、汇率适用日与税额取整另有规定，请以海关与税务的正式口径为准。' });
    return out;
  }

  function showError(msg) {
    $('error').textContent = msg;
    $('downloads').style.display = 'none';
  }
  function clearError() {
    $('error').textContent = '';
    $('downloads').style.display = '';
  }

  function recompute(silent) {
    var input = readInput();
    var r;
    try {
      r = C.solve(input);
    } catch (e) {
      lastResult = null;
      window.__lastResult = null;
      showError((e && e.userMessage) || ('计算出错：' + (e && e.message)));
      return null;
    }
    lastResult = r;
    window.__lastResult = r;
    clearError();
    renderResult(r);
    if (!silent) $('message').textContent = '';
    return r;
  }

  // ── 导出 ────────────────────────────────────────────────────
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvText(r) {
    var t = r.totals;
    var head = ['行号', '货物', '数量', '单价(' + r.currency + ')', '关税率%', '消费税率%', '增值税率%', '货值(' + r.currency + ')', '分摊运保费(' + r.currency + ')', '完税价格(' + r.currency + ')', '关税(' + r.currency + ')', '消费税(' + r.currency + ')', '增值税(' + r.currency + ')', '税额合计(' + r.currency + ')', '行总成本(本币)', '单件成本(本币)', '该行税负率%'];
    var lines = [head.join(',')];
    r.rows.forEach(function (x, i) {
      lines.push([i + 1, '"' + String(x.name).replace(/"/g, '""') + '"', x.qty, x.unitPrice.toFixed(4), x.dutyRate, x.exciseRate, x.vatRate,
        x.goodsForeign.toFixed(4), x.apportionedForeign.toFixed(4), x.dutiableForeign.toFixed(4),
        x.dutyForeign.toFixed(4), x.exciseForeign.toFixed(4), x.vatForeign.toFixed(4), x.taxForeign.toFixed(4),
        x.totalLocal.toFixed(2), x.unitLocal.toFixed(2), x.burdenRate.toFixed(6)].join(','));
    });
    lines.push('');
    lines.push(['# 汇总'].join(','));
    [['货物货值(' + r.currency + ')', t.goodsForeign], ['国际运费(' + r.currency + ')', t.freightForeign], ['保险费(' + r.currency + ')', t.insuranceForeign],
      ['完税价格(' + r.currency + ')', t.dutiableForeign], ['关税(' + r.currency + ')', t.dutyForeign], ['消费税(' + r.currency + ')', t.exciseForeign],
      ['增值税(' + r.currency + ')', t.vatForeign], ['税费合计(' + r.currency + ')', t.taxForeign], ['汇率', r.rate],
      ['到岸成本(本币)', t.landedLocal], ['税费(本币)', t.taxLocal], ['其他费用(本币)', t.otherLocal], ['总成本(本币)', t.totalLocal],
      ['总数量', t.totalQty], ['单件成本(本币)', t.unitCostLocal], ['综合税负率%', r.measures.burdenRate], ['含税放大倍数', r.measures.amplifier],
      ['名义相加口径税费(本币)', r.measures.naiveTaxLocal], ['名义相加少算(本币)', r.measures.naiveUnderstateLocal],
      ['最低售价(本币)', r.pricing.minPriceLocal], ['最低单件售价(本币)', r.pricing.minUnitPriceLocal]].forEach(function (p) {
        lines.push('"' + p[0] + '",' + (typeof p[1] === 'number' ? p[1].toFixed(6) : p[1]));
      });
    if (r.reverse) {
      lines.push('"目标售价(本币)",' + r.reverse.targetPriceLocal.toFixed(2));
      lines.push('"允许成本(本币)",' + r.reverse.allowedCostLocal.toFixed(2));
      lines.push('"目标是否达标",' + (r.reverse.meets ? '达标' : '不达标'));
      if (!r.reverse.reason) {
        lines.push('"可承受货值上限(' + r.currency + ')",' + r.reverse.maxGoodsForeign.toFixed(6));
        lines.push('"货值余量%",' + r.reverse.headroomPct.toFixed(6));
      }
    }
    if (r.maxDuty && r.maxDuty.available) lines.push('"可承受统一关税率上限%",' + r.maxDuty.rate.toFixed(6));
    lines.push('"说明","默认样例与内置场景均为虚构示例；税率由用户自填，本页不查税则、不联网"');
    return lines.join('\n') + '\n';
  }
  function mdText(r) {
    var t = r.totals, m = r.measures, L = [];
    L.push('# 到岸成本台 · 结果说明');
    L.push('');
    L.push('- 生成时间：' + new Date().toISOString() + '（本机时间 ' + new Date().toLocaleString() + '）');
    L.push('- 币种：' + r.currency + '，汇率 ' + f4(r.rate) + '（人民币 / 1 外币）');
    L.push('- 本页所有数字来自同一次计算；默认样例与内置场景均为**虚构示例**，税率由用户自填，不代表任何真实税则或政策。');
    L.push('');
    L.push('## 结论');
    L.push('');
    L.push('| 项目 | 数值 |');
    L.push('|---|---|');
    L.push('| 到岸总成本 | ' + money(t.totalLocal) + ' 元 |');
    L.push('| 单件成本 | ' + money(t.unitCostLocal) + ' 元 / ' + t.totalQty + ' 件 |');
    L.push('| 完税价格（含运保费） | ' + money(t.dutiableForeign * r.rate) + ' 元（' + f2(t.dutiableForeign) + ' ' + r.currency + '） |');
    L.push('| 税费合计 | ' + money(t.taxLocal) + ' 元 |');
    L.push('| 综合税负率 | ' + f2(m.burdenRate) + '% |');
    L.push('| 含税放大倍数 | ' + f4(m.amplifier) + ' |');
    L.push('| 最低售价（毛利 ' + f2(r.margin) + '%） | ' + money(r.pricing.minPriceLocal) + ' 元 |');
    if (r.reverse && !r.reverse.reason) L.push('| 可承受货值上限 | ' + money(r.reverse.maxGoodsForeign) + ' ' + r.currency + '（余量 ' + f2(r.reverse.headroomPct) + '%） |');
    if (r.maxDuty && r.maxDuty.available) L.push('| 可承受统一关税率上限 | ' + f2(r.maxDuty.rate) + '% |');
    L.push('');
    L.push('## 成本构成');
    L.push('');
    L.push('| 构成 | 金额（本币） | 占总成本 |');
    L.push('|---|---|---|');
    COST_KEYS.forEach(function (k) {
      L.push('| ' + k[1] + ' | ' + money(t[k[0]]) + ' | ' + f2(t.totalLocal > 0 ? t[k[0]] / t.totalLocal * 100 : 0) + '% |');
    });
    L.push('| **总成本** | **' + money(t.totalLocal) + '** | **100.00%** |');
    L.push('');
    L.push('## 逐行明细');
    L.push('');
    L.push('| 货物 | 数量 | 单价(' + r.currency + ') | 货值 | 分摊运保费 | 完税价格 | 关税 | 消费税 | 增值税 | 行总成本(本币) | 单件成本 | 该行税负率 |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    r.rows.forEach(function (x) {
      L.push('| ' + x.name + ' | ' + x.qty + ' | ' + f4(x.unitPrice) + ' | ' + f2(x.goodsForeign) + ' | ' + f2(x.apportionedForeign) + ' | ' + f2(x.dutiableForeign) + ' | ' + f2(x.dutyForeign) + ' | ' + f2(x.exciseForeign) + ' | ' + f2(x.vatForeign) + ' | ' + money(x.totalLocal) + ' | ' + money(x.unitLocal) + ' | ' + f2(x.burdenRate) + '% |');
    });
    L.push('');
    L.push('## 口径对照');
    L.push('');
    L.push('- 三档税率直接相加（常见错算）：' + money(m.naiveTaxLocal) + ' 元');
    L.push('- 本页逐层计征口径：' + money(t.taxLocal) + ' 元');
    L.push('- 错算会少算：' + money(m.naiveUnderstateLocal) + ' 元' + (t.taxLocal > 0 ? '（实际税费的 ' + f2(m.naiveUnderstateLocal / t.taxLocal * 100) + '%）' : ''));
    L.push('- 三档税率行平均之和 ' + f2(r.nominal.weightedSum) + '%，实际综合税负率 ' + f2(m.burdenRate) + '%');
    L.push('- 含税放大倍数 ' + f4(m.amplifier) + '：完税价格每多 1 元，总成本多 ' + f4(m.amplifier) + ' 元');
    L.push('');
    L.push('## 敏感性');
    L.push('');
    L.push('| 情形 | 总成本（本币） | 变化额 | 变化率 | 最低售价 |');
    L.push('|---|---|---|---|---|');
    r.sensitivity.forEach(function (s) {
      L.push('| ' + s.label + (s.note ? '（' + s.note + '）' : '') + ' | ' + money(s.totalLocal) + ' | ' + (s.deltaLocal >= 0 ? '+' : '−') + money(Math.abs(s.deltaLocal)) + ' | ' + (s.deltaPct >= 0 ? '+' : '−') + f2(Math.abs(s.deltaPct)) + '% | ' + money(s.minPriceLocal) + ' |');
    });
    L.push('');
    L.push('## 建议');
    L.push('');
    advise(r).forEach(function (a) { L.push('- ' + a.html.replace(/<[^>]+>/g, '')); });
    if (r.warnings.length) {
      L.push('');
      L.push('## 需要注意');
      L.push('');
      r.warnings.forEach(function (w) { L.push('- ' + w); });
    }
    L.push('');
    L.push('## 边界（同页面「算法与使用边界」）');
    L.push('');
    L.push('- 运保费按货值比例分摊；不做从量税与复合计税、反倾销税、出口退税与进项抵扣、免税额度与行邮税、跨境电商综合税优惠口径。');
    L.push('- 不查税则、不判断商品归类、不联网查税率与汇率；不做申报口径的取整与汇率适用日规则；不支持一行一币种与分批到货。');
    L.push('- 不给任何避税、低报或归类规避建议。真实申报请以海关与税务的正式口径为准。');
    return L.join('\n') + '\n';
  }

  // ── 结果卡 PNG（1080×1350） ─────────────────────────────────
  function wrapText(ctx, text, maxWidth, maxLines) {
    var chars = String(text).split('');
    var lines = [], line = '';
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = chars[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    }
    return lines;
  }
  function drawCard(r) {
    var cv = document.createElement('canvas');
    cv.width = 1080; cv.height = 1350;
    var g = cv.getContext('2d');
    var t = r.totals, m = r.measures;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = '#eef3f8'; g.fillRect(0, 0, 1080, 250);
    g.fillStyle = '#2d5f96'; g.fillRect(0, 0, 1080, 14);
    g.fillStyle = '#4f6b91'; g.font = '600 24px system-ui,"PingFang SC",sans-serif';
    g.fillText('LANDED COST LEDGER · 进口到岸成本与税费对账', 64, 84);
    g.fillStyle = '#22344e'; g.font = '700 52px system-ui,"PingFang SC",sans-serif';
    g.fillText('到岸成本台', 64, 152);
    g.fillStyle = '#5a6d84'; g.font = '400 26px system-ui,"PingFang SC",sans-serif';
    g.fillText('币种 ' + r.currency + ' · 汇率 ' + f4(r.rate) + ' · 目标毛利 ' + f2(r.margin) + '%', 64, 200);
    // 主结论
    g.fillStyle = '#22344e'; g.font = '700 76px system-ui,"PingFang SC",sans-serif';
    g.fillText(money(t.totalLocal) + ' 元', 64, 340);
    g.fillStyle = '#5a6d84'; g.font = '400 28px system-ui,"PingFang SC",sans-serif';
    g.fillText('到岸总成本 · ' + t.totalQty + ' 件 · 单件 ' + money(t.unitCostLocal) + ' 元', 64, 388);
    // 三个指标盒
    var boxes = [
      ['综合税负率', f2(m.burdenRate) + '%', '税费 ÷ 完税价格'],
      ['含税放大倍数', f4(m.amplifier), '每 1 元完税价格的代价'],
      ['税费合计', money(t.taxLocal), '关税＋消费税＋增值税']
    ];
    boxes.forEach(function (b, i) {
      var x = 64 + i * 320;
      g.fillStyle = '#f4f8fd'; g.fillRect(x, 424, 296, 148);
      g.strokeStyle = '#d9e3ee'; g.strokeRect(x, 424, 296, 148);
      g.fillStyle = '#61738a'; g.font = '600 22px system-ui,"PingFang SC",sans-serif';
      g.fillText(b[0], x + 20, 466);
      g.fillStyle = '#2d5f96'; g.font = '700 40px system-ui,"PingFang SC",sans-serif';
      g.fillText(b[1], x + 20, 520);
      g.fillStyle = '#7b8ca0'; g.font = '400 18px system-ui,"PingFang SC",sans-serif';
      g.fillText(b[2], x + 20, 552);
    });
    // 成本构成条
    g.fillStyle = '#22344e'; g.font = '700 30px system-ui,"PingFang SC",sans-serif';
    g.fillText('成本构成', 64, 640);
    var maxv = Math.max.apply(null, COST_KEYS.map(function (k) { return t[k[0]]; }));
    var y = 682;
    COST_KEYS.forEach(function (k) {
      var v = t[k[0]];
      var share = t.totalLocal > 0 ? v / t.totalLocal * 100 : 0;
      g.fillStyle = '#39485c'; g.font = '600 24px system-ui,"PingFang SC",sans-serif';
      g.fillText(k[1], 64, y + 22);
      var bx = 264, bw = 480;
      g.fillStyle = '#e8eef7'; g.fillRect(bx, y, bw, 26);
      g.fillStyle = k[2] ? '#a23b28' : '#4a7cb5';
      g.fillRect(bx, y, maxv > 0 ? bw * v / maxv : 0, 26);
      g.fillStyle = '#39485c'; g.font = '600 22px system-ui,"PingFang SC",sans-serif';
      g.textAlign = 'right';
      g.fillText(money(v) + '（' + f2(share) + '%）', 1016, y + 21);
      g.textAlign = 'left';
      y += 46;
    });
    // 结论行
    y += 16;
    g.fillStyle = '#22344e'; g.font = '700 30px system-ui,"PingFang SC",sans-serif';
    g.fillText('口径与反推', 64, y + 14);
    y += 44;
    var rowsOut = [];
    rowsOut.push('三档税率直接相加会少算 ' + money(m.naiveUnderstateLocal) + ' 元（实际税费 ' + money(t.taxLocal) + ' 元）');
    rowsOut.push('最低售价（毛利 ' + f2(r.margin) + '%）：' + money(r.pricing.minPriceLocal) + ' 元');
    if (r.reverse) {
      if (r.reverse.reason) rowsOut.push('反推：' + r.reverse.reason);
      else rowsOut.push('目标售价 ' + money(r.reverse.targetPriceLocal) + ' 元 → 可承受货值上限 ' + money(r.reverse.maxGoodsForeign) + ' ' + r.currency + '（余量 ' + f2(r.reverse.headroomPct) + '%）');
    }
    if (r.maxDuty && r.maxDuty.available && !r.maxDuty.capped) rowsOut.push('可承受的统一关税率上限：' + f2(r.maxDuty.rate) + '%（当前最高 ' + f2(r.maxDuty.currentMaxDuty) + '%）');
    g.font = '400 25px system-ui,"PingFang SC",sans-serif';
    rowsOut.forEach(function (line) {
      wrapText(g, '· ' + line, 950, 2).forEach(function (ln) {
        g.fillStyle = '#4d6076';
        g.fillText(ln, 64, y + 26);
        y += 38;
      });
      y += 6;
    });
    // 页脚
    g.fillStyle = '#eef3f8'; g.fillRect(0, 1240, 1080, 110);
    g.fillStyle = '#7b8ca0'; g.font = '400 20px system-ui,"PingFang SC",sans-serif';
    g.fillText('到岸成本台 V1.0.0 · 数字来自同一次计算 · 默认样例与内置场景均为虚构示例', 64, 1282);
    g.fillText('税率由用户自填；本页不查税则、不联网，不给避税建议 · 生成于 ' + new Date().toLocaleString(), 64, 1316);
    return cv;
  }
  function exportPNG(r) {
    var cv = drawCard(r);
    return new Promise(function (resolve) {
      cv.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'landed-cost-card-1080x1350.png';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); resolve(true); }, 1200);
      }, 'image/png');
    });
  }

  // ── 持久化 ──────────────────────────────────────────────────
  function save() {
    var input = readInput();
    try {
      var payload = { app: 'landed-cost', version: 1, savedAt: new Date().toISOString(), input: input };
      localStorage.setItem(STORE, JSON.stringify(payload));
      savedAt = payload.savedAt;
      $('savedNote').textContent = '已保存到本机：' + new Date(payload.savedAt).toLocaleString() + '（只保存在这个浏览器里，不会上传）';
      $('message').textContent = '已保存。';
    } catch (e) {
      $('message').textContent = '';
      showError('保存失败：' + (e && e.message));
    }
  }
  function restore(silent) {
    var raw = null;
    try { raw = localStorage.getItem(STORE); } catch (e) { raw = null; }
    if (!raw) { if (!silent) $('message').textContent = '本机还没有保存过。'; return false; }
    var payload;
    try { payload = JSON.parse(raw); } catch (e) { showError('本机保存的数据解析失败。'); return false; }
    if (!payload || !payload.input) { showError('本机保存的数据里没有输入。'); return false; }
    writeInput(payload.input);
    renderInputs();
    savedAt = payload.savedAt;
    $('savedNote').textContent = '已恢复本机保存：' + new Date(payload.savedAt).toLocaleString();
    recompute(true);
    return true;
  }

  // ── 事件 ────────────────────────────────────────────────────
  function bind() {
    $('inputPanel').addEventListener('input', function () { recompute(); });
    $('inputPanel').addEventListener('change', function () {
      state.insuranceMode = $('insuranceMode').value;
      renderFields();
      recompute();
    });
    $('inputPanel').addEventListener('click', function (ev) {
      var target = ev.target;
      if (target.classList.contains('del-row')) {
        var i = Number(target.getAttribute('data-arg'));
        if (state.rows.length <= 1) { $('message').textContent = '至少要留一行货物。'; return; }
        state.rows.splice(i, 1);
        renderRows(); recompute();
        return;
      }
      if (target.classList.contains('del-fee')) {
        var j = Number(target.getAttribute('data-arg'));
        state.otherFees.splice(j, 1);
        renderFees(); recompute();
        return;
      }
    });
    $('addRow').addEventListener('click', function () {
      if (state.rows.length >= C.LIMITS.MAX_ROWS) { $('message').textContent = '最多 ' + C.LIMITS.MAX_ROWS + ' 行货物。'; return; }
      var input = readInput();
      writeInput(input);
      state.rows.push(C.blankRow());
      renderRows(); recompute();
      $('message').textContent = '已添加一行，请填名称、数量、单价与三档税率。';
    });
    $('addFee').addEventListener('click', function () {
      if (state.otherFees.length >= C.LIMITS.MAX_FEE) { $('message').textContent = '其他费用最多 ' + C.LIMITS.MAX_FEE + ' 项。'; return; }
      var input = readInput();
      writeInput(input);
      state.otherFees.push({ name: '', amount: '' });
      renderFees(); recompute();
    });
    $('demo').addEventListener('click', function () {
      writeInput(C.clonePreset('appliance'));
      renderInputs(); recompute();
      $('message').textContent = '已载入虚构示例（不是真实税则或真实报价）。';
    });
    $('presets').addEventListener('click', function (ev) {
      var k = ev.target.getAttribute && ev.target.getAttribute('data-key');
      if (!k) return;
      writeInput(C.clonePreset(k));
      renderInputs(); recompute();
      $('message').textContent = '已载入内置场景：' + (C.PRESETS.filter(function (p) { return p.key === k; })[0] || {}).label;
    });
    $('result').addEventListener('click', function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (!act || !lastResult) return;
      var input = readInput();
      if (act === 'scale-goods') {
        var r = lastResult;
        if (!r.reverse || r.reverse.reason || !isFinite(r.reverse.scale) || r.reverse.scale <= 0) { $('message').textContent = '这个场景不支持按上限缩放货值。'; return; }
        state = JSON.parse(JSON.stringify(state));
        state.rows = input.rows.map(function (x) {
          return { name: x.name, qty: x.qty, unitPrice: x.unitPrice === '' ? '' : String(Number(x.unitPrice) * r.reverse.scale), dutyRate: x.dutyRate, exciseRate: x.exciseRate, vatRate: x.vatRate };
        });
        renderInputs(); recompute();
        $('message').textContent = '已把各行单价按上限等比缩放 ×' + f4(r.reverse.scale) + '（货值结构调整过，请复核）。';
        return;
      }
      if (act === 'set-duty') {
        var r2 = lastResult;
        state = JSON.parse(JSON.stringify(state));
        state.rows = input.rows.map(function (x) {
          return { name: x.name, qty: x.qty, unitPrice: x.unitPrice, dutyRate: f4(r2.maxDuty.rate), exciseRate: x.exciseRate, vatRate: x.vatRate };
        });
        renderInputs(); recompute();
        $('message').textContent = '已把各行关税率改成 ' + f4(r2.maxDuty.rate) + '% 并重算。';
        return;
      }
    });
    $('save').addEventListener('click', save);
    $('restore').addEventListener('click', function () { restore(false); });
    $('backup').addEventListener('click', function () {
      var payload = { app: 'landed-cost', version: 1, savedAt: new Date().toISOString(), input: readInput() };
      download('landed-cost-backup.json', JSON.stringify(payload, null, 2), 'application/json');
      $('message').textContent = '已下载备份 JSON。';
    });
    $('import').addEventListener('click', function () { $('imports').click(); });
    $('imports').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var payload = JSON.parse(String(reader.result));
          if (!payload || !payload.input) throw new Error('文件里没有 input 字段');
          writeInput(payload.input);
          renderInputs(); recompute();
          $('message').textContent = '已从备份导入。';
        } catch (e) {
          showError('导入失败：' + (e && e.message));
        }
        ev.target.value = '';
      };
      reader.readAsText(file);
    });
    $('csv').addEventListener('click', function () { if (lastResult) { download('landed-cost-detail.csv', csvText(lastResult), 'text/csv;charset=utf-8'); $('message').textContent = '已下载 CSV 明细。'; } });
    $('md').addEventListener('click', function () { if (lastResult) { download('landed-cost-result.md', mdText(lastResult), 'text/markdown;charset=utf-8'); $('message').textContent = '已下载结果说明 MD。'; } });
    $('json').addEventListener('click', function () { if (lastResult) { download('landed-cost-backup.json', JSON.stringify({ app: 'landed-cost', version: 1, savedAt: new Date().toISOString(), input: readInput() }, null, 2), 'application/json'); $('message').textContent = '已下载 JSON 备份。'; } });
    $('png').addEventListener('click', function () { if (lastResult) { exportPNG(lastResult).then(function () { $('message').textContent = '已下载结果卡 PNG（1080×1350）。'; }); } });
  }

  function renderPresets() {
    $('presets').innerHTML = C.PRESETS.map(function (p) {
      return '<button type="button" data-key="' + p.key + '" title="' + esc(p.note) + '">' + esc(p.label) + '</button>';
    }).join('');
  }

  function init() {
    renderPresets();
    var restored = restore(true);
    if (!restored) { renderInputs(); recompute(true); }
    window.__App = { readInput: readInput, render: function () { renderInputs(); return recompute(); }, state: function () { return state; } };
  }

  bind();
  init();
})();
