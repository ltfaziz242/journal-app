/* tests.js — unit test sederhana, tanpa dependency.
   Node   : node tests.js
   Browser: buka tests.html

   Tes hanya menguji fungsi hitung di calc.js. Tidak menyentuh localStorage,
   tidak memakai jaringan. */

(function (root, factory) {
  const isNode = (typeof module === 'object' && module && module.exports);
  const Calc = isNode ? require('./calc.js') : (root && root.Calc);
  const api = factory(Calc);

  if (isNode) module.exports = api;
  if (root) root.Tests = api;

  if (isNode) {
    const results = api.run();
    let failed = 0;
    for (const r of results) {
      if (r.ok) {
        console.log('LULUS  ' + r.name);
      } else {
        failed++;
        console.log('GAGAL  ' + r.name);
        console.log('       -> ' + r.error);
      }
    }
    console.log('');
    console.log('Total ' + results.length + ' tes · lulus ' + (results.length - failed) + ' · gagal ' + failed);
    process.exitCode = failed ? 1 : 0;
  } else if (root && root.document) {
    const start = () => api.render(root.document, api.run());
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Calc) {
  'use strict';

  if (!Calc) throw new Error('calc.js belum dimuat.');

  const TESTS = [];

  function test(name, fn) { TESTS.push({ name: name, fn: fn }); }

  /* ---------- helper assert ---------- */

  function fail(msg) { throw new Error(msg); }

  function isTrue(cond, msg) {
    if (!cond) fail(msg || 'diharapkan true, dapat false');
  }

  function eq(a, b, msg) {
    if (a !== b) fail((msg ? msg + ': ' : '') + 'dapat ' + JSON.stringify(a) + ', harusnya ' + JSON.stringify(b));
  }

  function near(a, b, tol, msg) {
    const t = (tol == null) ? 1e-9 : tol;
    if (typeof a !== 'number' || !Number.isFinite(a)) {
      fail((msg ? msg + ': ' : '') + 'bukan angka valid: ' + String(a));
    }
    if (Math.abs(a - b) > t) {
      fail((msg ? msg + ': ' : '') + 'dapat ' + a + ', harusnya sekitar ' + b);
    }
  }

  function isNull(a, msg) {
    if (a !== null) fail((msg ? msg + ': ' : '') + 'harusnya null, dapat ' + JSON.stringify(a));
  }

  function includesCode(arr, code, msg) {
    if (!arr.some((x) => x.code === code)) {
      fail((msg ? msg + ': ' : '') + 'kode "' + code + '" tidak muncul. Yang ada: ' +
        (arr.map((x) => x.code).join(', ') || '(kosong)'));
    }
  }

  function excludesCode(arr, code, msg) {
    if (arr.some((x) => x.code === code)) {
      fail((msg ? msg + ': ' : '') + 'kode "' + code + '" tidak seharusnya muncul.');
    }
  }

  function allChecked(over) {
    const o = {};
    for (const it of Calc.CHECKLIST) o[it.id] = true;
    return Object.assign(o, over || {});
  }

  /* ================= aturan tetap ================= */

  test('RULES_FIXED: nilainya terkunci dan sesuai AGENTS.md', function () {
    isTrue(Object.isFrozen(Calc.RULES_FIXED), 'RULES_FIXED harus frozen');
    eq(Calc.RULES_FIXED.riskPct, 0.5);
    eq(Calc.RULES_FIXED.rrMin, 1.5);
    eq(Calc.RULES_FIXED.maxTradesPerDay, 2);
    eq(Calc.RULES_FIXED.dailyStopPct, 3);
    eq(Calc.RULES_FIXED.weeklyStopPct, 6);
    eq(Calc.RULES_FIXED.maxConsecLoss, 2);
  });

  test('CHECKLIST: tepat 7 poin', function () {
    eq(Calc.CHECKLIST.length, 7);
    const ids = Calc.CHECKLIST.map((x) => x.id).join(',');
    eq(ids, 'setup,sl,rr,risk,news,emotion,own');
  });

  /* ================= parsing angka ================= */

  test('parseNum: "1.860,50" -> 1860,5', function () {
    near(Calc.parseNum('1.860,50'), 1860.5);
  });

  test('parseNum: "1860.50" -> 1860,5', function () {
    near(Calc.parseNum('1860.50'), 1860.5);
  });

  test('parseNum: "1 860,5" (spasi ribuan) -> 1860,5', function () {
    near(Calc.parseNum('1 860,5'), 1860.5);
  });

  test('parseNum: "-2500" -> -2500', function () {
    eq(Calc.parseNum('-2500'), -2500);
  });

  test('parseNum: kosong / bukan angka -> null', function () {
    isNull(Calc.parseNum(''));
    isNull(Calc.parseNum('   '));
    isNull(Calc.parseNum('abc'));
    isNull(Calc.parseNum(null));
  });

  /* ================= jarak SL & RR ================= */

  test('slDistance: 2665,2 vs 2659,5 -> 5,7 USD', function () {
    near(Calc.slDistance(2665.2, 2659.5), 5.7);
  });

  test('slDistance: arah tidak berpengaruh (SL di atas entry)', function () {
    near(Calc.slDistance(2650, 2656), 6);
  });

  test('slDistance: input tidak valid -> null', function () {
    isNull(Calc.slDistance(null, 2650));
    isNull(Calc.slDistance(NaN, 2650));
  });

  test('rr: BUY entry 2000 / SL 1990 / TP 2020 -> 2,0', function () {
    near(Calc.rr(2000, 1990, 2020), 2);
  });

  test('rr: SELL entry 2000 / SL 2010 / TP 1980 -> 2,0', function () {
    near(Calc.rr(2000, 2010, 1980), 2);
  });

  test('rr: SL sama dengan entry -> null (tidak bisa dibagi)', function () {
    isNull(Calc.rr(2000, 2000, 2020));
  });

  /* ================= risiko ================= */

  test('riskCent: 5,00 USD x 0,5 lot x 10.000 cent = 25.000 cent', function () {
    near(Calc.riskCent(5, 0.5, 10000), 25000);
  });

  test('riskCent: konversi belum diisi -> null (tidak menebak)', function () {
    isNull(Calc.riskCent(5, 0.5, null));
    isNull(Calc.riskCent(5, 0.5, 0));
  });

  test('riskPct: 25.000 cent dari 10.000.000 cent = 0,25%', function () {
    near(Calc.riskPct(25000, 10000000), 0.25);
  });

  test('riskPct: saldo 0 -> null', function () {
    isNull(Calc.riskPct(25000, 0));
  });

  /* ================= hasil dalam R ================= */

  test('resultR: +25.000 cent dengan risiko 25.000 cent = +1,0R', function () {
    near(Calc.resultR(25000, 25000), 1);
  });

  test('resultR: -12.500 cent dengan risiko 25.000 cent = -0,5R', function () {
    near(Calc.resultR(-12500, 25000), -0.5);
  });

  test('resultR: risiko tidak tercatat -> null', function () {
    isNull(Calc.resultR(1000, 0));
  });

  /* ================= statistik ================= */

  test('profitFactor: untung 300 vs rugi 150 -> 2,0', function () {
    near(Calc.profitFactor([100, -50, 200, -100]), 2);
  });

  test('profitFactor: tanpa loss -> null (bukan "tak terbatas")', function () {
    isNull(Calc.profitFactor([100, 200]));
  });

  test('profitFactor: belum ada trade -> null', function () {
    isNull(Calc.profitFactor([]));
  });

  test('expectancyR: (1 + (-1) + 2) / 3 = 0,667R', function () {
    near(Calc.expectancyR([1, -1, 2]), 2 / 3);
  });

  test('expectancyR: kosong -> null', function () {
    isNull(Calc.expectancyR([]));
  });

  test('winRate: 3 menang dari 4 = 75%', function () {
    near(Calc.winRate([100, -50, 200, 10]), 75);
  });

  test('winRate: kosong -> null', function () {
    isNull(Calc.winRate([]));
  });

  test('equitySeries: 1000 -> +100 -> -50 menghasilkan 3 titik', function () {
    const s = Calc.equitySeries(1000, [100, -50]);
    eq(s.length, 3);
    eq(s[0].equity, 1000);
    eq(s[1].equity, 1100);
    eq(s[2].equity, 1050);
  });

  test('maxDrawdownPct: 1000 -> 1100 -> 800 = 27,27%', function () {
    near(Calc.maxDrawdownPct(1000, [100, -300]), (300 / 1100) * 100);
  });

  test('maxDrawdownPct: hanya untung -> 0%', function () {
    near(Calc.maxDrawdownPct(1000, [100, 200]), 0);
  });

  test('trailingLosses: 3 loss di akhir deret -> 3', function () {
    eq(Calc.trailingLosses([1, -1, -2, -3]), 3);
  });

  test('trailingLosses: trade terakhir untung -> 0', function () {
    eq(Calc.trailingLosses([-1, -2, 5]), 0);
  });

  /* ================= aturan stop ================= */

  function stopCase(over) {
    return Calc.stopStatus(Object.assign({
      todayNetCent: 0,
      weekNetCent: 0,
      balanceDayStartCent: 10000000,
      balanceWeekStartCent: 10000000,
      tradesToday: 0,
      trailingLosses: 0,
      rules: Calc.RULES_FIXED
    }, over || {}));
  }

  test('stopStatus: tanpa rugi & tanpa trade -> tidak stop', function () {
    const s = stopCase();
    eq(s.dayPct, 0);
    eq(s.weekPct, 0);
    isTrue(!s.stopToday, 'stopToday harus false');
    isTrue(!s.stopWeek, 'stopWeek harus false');
    eq(s.reasons.length, 0);
  });

  test('stopStatus: rugi harian tepat 3% -> STOP HARI INI', function () {
    const s = stopCase({ todayNetCent: -300000 });
    near(s.dayPct, 3);
    isTrue(s.dailyTriggered, 'dailyTriggered harus true');
    isTrue(s.stopToday, 'stopToday harus true');
    eq(s.reasons.length, 1);
  });

  test('stopStatus: rugi harian 2,99% -> belum stop', function () {
    const s = stopCase({ todayNetCent: -299000 });
    isTrue(!s.dailyTriggered, 'dailyTriggered harus false');
    isTrue(!s.stopToday, 'stopToday harus false');
  });

  test('stopStatus: rugi mingguan 6% -> STOP MINGGU INI', function () {
    const s = stopCase({ weekNetCent: -600000 });
    near(s.weekPct, 6);
    isTrue(s.weeklyTriggered, 'weeklyTriggered harus true');
    isTrue(s.stopWeek, 'stopWeek harus true');
    isTrue(s.stopToday, 'stopToday harus true juga');
  });

  test('stopStatus: 2 trade hari ini -> stop, 1 trade -> lanjut', function () {
    isTrue(stopCase({ tradesToday: 2 }).tradesTriggered, '2 trade harus stop');
    isTrue(!stopCase({ tradesToday: 1 }).tradesTriggered, '1 trade belum stop');
  });

  test('stopStatus: 2 loss beruntun -> stop, 1 -> lanjut', function () {
    isTrue(stopCase({ trailingLosses: 2 }).streakTriggered, '2 loss harus stop');
    isTrue(!stopCase({ trailingLosses: 1 }).streakTriggered, '1 loss belum stop');
  });

  /* ================= pemeriksaan form entry ================= */

  function entryCase(over) {
    const base = {
      settings: { convCentPerUsdPerLot: 10000, rules: Calc.RULES_FIXED },
      balanceCent: 10000000,
      entry: 2000,
      sl: 1995,
      tp: 2010,
      lot: 0.1,
      dir: 'BUY',
      checklist: allChecked(),
      stops: null
    };
    const o = Object.assign({}, base, over || {});
    if (over && over.settings) o.settings = Object.assign({}, base.settings, over.settings);
    if (over && over.checklist) o.checklist = Object.assign({}, base.checklist, over.checklist);
    return Calc.entryFailures(o);
  }

  test('entryFailures: setup sehat -> tidak ada pelanggaran', function () {
    const f = entryCase();
    eq(f.length, 0, 'harusnya 0 pelanggaran, dapat: ' + f.map((x) => x.code).join(', '));
  });

  test('entryFailures: konversi kosong -> diminta isi, bukan ditebak', function () {
    includesCode(entryCase({ settings: { convCentPerUsdPerLot: null } }), 'conv');
  });

  test('entryFailures: saldo awal kosong -> diminta isi', function () {
    includesCode(entryCase({ balanceCent: null }), 'balance');
  });

  test('entryFailures: RR 1,0 di bawah minimum -> pelanggaran rr', function () {
    includesCode(entryCase({ tp: 2005 }), 'rr');
  });

  test('entryFailures: RR tepat 1,5 -> lolos (batas)', function () {
    excludesCode(entryCase({ tp: 2007.5 }), 'rr');
  });

  test('entryFailures: risiko 0,6% -> pelanggaran risk', function () {
    includesCode(entryCase({ lot: 1.2 }), 'risk');
  });

  test('entryFailures: risiko tepat 0,5% -> lolos (batas)', function () {
    excludesCode(entryCase({ lot: 1 }), 'risk');
  });

  test('entryFailures: SL/TP tidak sesuai arah -> pelanggaran dir', function () {
    includesCode(entryCase({ sl: 2005, tp: 2010 }), 'dir');
  });

  test('entryFailures: SL sama dengan entry -> pelanggaran sl', function () {
    includesCode(entryCase({ sl: 2000, tp: 2010 }), 'sl');
  });

  test('entryFailures: checklist belum lengkap -> poinnya dilaporkan', function () {
    includesCode(entryCase({ checklist: { emotion: false } }), 'emotion');
  });

  test('entryFailures: aturan stop aktif -> pelanggaran stop', function () {
    includesCode(entryCase({ stops: { reasons: ['Rugi harian 3,00% sudah mencapai batas 3%'] } }), 'stop');
  });

  test('entryFailures: lot 0 -> pelanggaran input', function () {
    includesCode(entryCase({ lot: 0 }), 'input');
  });

  /* ================= runner ================= */

  function run() {
    const out = [];
    for (const t of TESTS) {
      try {
        t.fn();
        out.push({ name: t.name, ok: true, error: '' });
      } catch (e) {
        out.push({ name: t.name, ok: false, error: (e && e.message) ? e.message : String(e) });
      }
    }
    return out;
  }

  // Tampilan hasil di browser (tests.html). Tanpa innerHTML.
  function render(doc, results) {
    const box = doc.getElementById('test-results');
    const sum = doc.getElementById('test-summary');
    if (!box) return;

    while (box.firstChild) box.removeChild(box.firstChild);

    let failed = 0;
    for (const r of results) {
      if (!r.ok) failed++;

      const li = doc.createElement('li');
      li.className = r.ok ? 'pass' : 'fail';

      const badge = doc.createElement('span');
      badge.className = 'badge';
      badge.textContent = r.ok ? 'LULUS' : 'GAGAL';
      li.appendChild(badge);
      li.appendChild(doc.createTextNode(r.name));

      if (!r.ok) {
        const p = doc.createElement('p');
        p.className = 'err';
        p.textContent = r.error;
        li.appendChild(p);
      }
      box.appendChild(li);
    }

    if (sum) {
      sum.textContent = 'Total ' + results.length + ' tes · lulus ' +
        (results.length - failed) + ' · gagal ' + failed;
      sum.className = 'banner ' + (failed ? 'banner-bad' : 'banner-good');
    }
  }

  return { run: run, render: render, tests: TESTS };
});
