/* calc.js — fungsi hitung murni (tanpa DOM, tanpa dependency).
   Dipakai app.js (browser) dan tests.js (Node atau browser). */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Calc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RULES_FIXED = Object.freeze({
    riskPct: 0.5,          // risiko per trade (%)
    rrMin: 1.5,            // RR minimum
    maxTradesPerDay: 2,    // maks trade per hari
    dailyStopPct: 3,       // stop harian (% saldo awal hari)
    weeklyStopPct: 6,      // stop mingguan (% saldo awal minggu)
    maxConsecLoss: 2       // stop setelah 2 loss beruntun
  });

  /* ---------- util ---------- */

  function round(x, d) {
    const p = Math.pow(10, d == null ? 2 : d);
    return Math.round((x + Number.EPSILON) * p) / p;
  }

  // Angka dari input user: terima "1.860,50", "1860.50", "1 860,5".
  // Aturan: kalau ada '.' DAN ',' -> '.' ribuan, ',' desimal.
  //         hanya ',' -> desimal. hanya '.' -> desimal (kecuali lebih dari satu titik).
  function parseNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    let s = v.trim().replace(/\s|\u00a0/g, '');
    if (s === '') return null;
    const hasDot = s.indexOf('.') >= 0;
    const hasComma = s.indexOf(',') >= 0;
    if (hasDot && hasComma) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      s = s.replace(',', '.');
    } else if (hasDot && (s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    s = s.replace(/[^0-9.+-]/g, '');
    if (s === '') return null;            // "abc" / "—" tidak boleh jadi 0
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function isFiniteNum(n) { return typeof n === 'number' && Number.isFinite(n); }

  /* ---------- hitungan trade ---------- */

  // Jarak SL dalam satuan harga (USD untuk XAUUSD).
  function slDistance(entry, sl) {
    if (!isFiniteNum(entry) || !isFiniteNum(sl)) return null;
    return Math.abs(entry - sl);
  }

  // RR = jarak TP / jarak SL. null kalau data tidak valid.
  function rr(entry, sl, tp) {
    const d = slDistance(entry, sl);
    if (!(d > 0) || !isFiniteNum(tp)) return null;
    return Math.abs(tp - entry) / d;
  }

  // Risiko dalam cent: jarak SL x lot x (cent per 1,00 USD gerak per 1 lot).
  function riskCent(slDist, lot, convCentPerUsdPerLot) {
    if (!(slDist > 0) || !(lot > 0) || !(convCentPerUsdPerLot > 0)) return null;
    return slDist * lot * convCentPerUsdPerLot;
  }

  function riskPct(riskCentValue, balanceCent) {
    if (!(balanceCent > 0) || !isFiniteNum(riskCentValue)) return null;
    return (riskCentValue / balanceCent) * 100;
  }

  // Hasil dalam R: hasil cent / risiko cent saat trade dibuka.
  function resultR(resultCentValue, riskCentAtOpen) {
    if (!(riskCentAtOpen > 0) || !isFiniteNum(resultCentValue)) return null;
    return resultCentValue / riskCentAtOpen;
  }

  /* ---------- statistik ---------- */

  function sumCent(arr) {
    return arr.reduce((a, b) => a + b, 0);
  }

  function profitFactor(resultsCent) {
    const wins = resultsCent.filter((x) => x > 0);
    const losses = resultsCent.filter((x) => x < 0);
    if (!losses.length) return null;              // tidak terdefinisi, bukan "tak terbatas"
    return sumCent(wins) / Math.abs(sumCent(losses));
  }

  function expectancyR(rs) {
    const valid = rs.filter((x) => isFiniteNum(x));
    if (!valid.length) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }

  function winRate(resultsCent) {
    if (!resultsCent.length) return null;
    const wins = resultsCent.filter((x) => x > 0).length;
    return (wins / resultsCent.length) * 100;
  }

  // Deret equity (mulai dari saldo awal), satu titik per trade selesai.
  function equitySeries(startCent, resultsCent) {
    const out = [{ i: 0, equity: startCent }];
    let eq = startCent;
    for (let i = 0; i < resultsCent.length; i++) {
      eq += resultsCent[i];
      out.push({ i: i + 1, equity: eq });
    }
    return out;
  }

  // Max drawdown dalam % dari puncak (peak-to-trough).
  function maxDrawdownPct(startCent, resultsCent) {
    if (!(startCent > 0)) return null;
    let eq = startCent;
    let peak = startCent;
    let dd = 0;
    for (let i = 0; i < resultsCent.length; i++) {
      eq += resultsCent[i];
      if (eq > peak) peak = eq;
      if (peak > 0) {
        const cur = ((peak - eq) / peak) * 100;
        if (cur > dd) dd = cur;
      }
    }
    return dd;
  }

  // Jumlah loss beruntun di AKHIR deret (paling baru di indeks terakhir).
  function trailingLosses(resultsCent) {
    let n = 0;
    for (let i = resultsCent.length - 1; i >= 0; i--) {
      if (resultsCent[i] < 0) n++;
      else break;
    }
    return n;
  }

  /* ---------- aturan / gerbang ---------- */

  // Status berhenti trading. Semua persen dihitung dari saldo AWAL periode.
  function stopStatus(o) {
    const rules = o.rules || RULES_FIXED;
    const dayPct = pctLoss(o.todayNetCent, o.balanceDayStartCent);
    const weekPct = pctLoss(o.weekNetCent, o.balanceWeekStartCent);
    const tradesToday = isFiniteNum(o.tradesToday) ? o.tradesToday : 0;
    const streak = isFiniteNum(o.trailingLosses) ? o.trailingLosses : 0;

    const dailyTriggered = dayPct != null && dayPct >= rules.dailyStopPct;
    const weeklyTriggered = weekPct != null && weekPct >= rules.weeklyStopPct;
    const tradesTriggered = tradesToday >= rules.maxTradesPerDay;
    const streakTriggered = streak >= rules.maxConsecLoss;
    // Stop mingguan juga menghentikan trading hari ini (bukan cuma minggu depan).
    const stopToday = dailyTriggered || weeklyTriggered || tradesTriggered || streakTriggered;

    return {
      dayPct, weekPct, tradesToday, streak,
      dailyTriggered, weeklyTriggered, tradesTriggered, streakTriggered,
      stopToday,
      stopWeek: weeklyTriggered,
      reasons: buildStopReasons({
        dailyTriggered, weeklyTriggered, tradesTriggered, streakTriggered,
        dayPct, weekPct, tradesToday, streak, rules
      })
    };
  }

  function pctLoss(netCent, balanceStartCent) {
    if (!isFiniteNum(netCent) || !(balanceStartCent > 0)) return null;
    if (netCent >= 0) return 0;
    return (Math.abs(netCent) / balanceStartCent) * 100;
  }

  function buildStopReasons(s) {
    const r = [];
    const p = (x) => round(x, 2).toFixed(2).replace('.', ',') + '%';
    if (s.dailyTriggered) r.push('Rugi harian ' + p(s.dayPct) + ' sudah mencapai batas ' + s.rules.dailyStopPct + '%');
    if (s.weeklyTriggered) r.push('Rugi mingguan ' + p(s.weekPct) + ' sudah mencapai batas ' + s.rules.weeklyStopPct + '%');
    if (s.tradesTriggered) r.push('Sudah ' + s.tradesToday + ' trade hari ini (maks ' + s.rules.maxTradesPerDay + ')');
    if (s.streakTriggered) r.push('Sudah ' + s.streak + ' loss beruntun (maks ' + s.rules.maxConsecLoss + ')');
    return r;
  }

  // Pemeriksaan form entry. Mengembalikan daftar pelanggaran (kosong = aman).
  function entryFailures(o) {
    const out = [];
    const settings = o.settings || {};
    const rules = settings.rules || RULES_FIXED;

    if (!(settings.convCentPerUsdPerLot > 0)) {
      out.push({ code: 'conv', text: 'Data konversi belum diisi di Pengaturan (cent rugi per 1,00 USD per 1 lot).' });
    }
    if (!(o.balanceCent > 0)) {
      out.push({ code: 'balance', text: 'Saldo awal akun belum diisi di Pengaturan (cent).' });
    }

    if (!isFiniteNum(o.entry) || !isFiniteNum(o.sl) || !isFiniteNum(o.tp) || !isFiniteNum(o.lot) || !(o.lot > 0)) {
      out.push({ code: 'input', text: 'Entry / SL / TP / lot belum lengkap atau bukan angka.' });
    }

    const d = slDistance(o.entry, o.sl);
    if (isFiniteNum(d) && !(d > 0)) out.push({ code: 'sl', text: 'Stop Loss harus berbeda dari harga entry.' });
    if (isFiniteNum(o.entry) && isFiniteNum(o.sl) && isFiniteNum(o.tp)) {
      const dirOk = o.dir === 'BUY' ? (o.sl < o.entry && o.tp > o.entry)
                                    : (o.sl > o.entry && o.tp < o.entry);
      if (!dirOk) out.push({ code: 'dir', text: 'Posisi SL/TP tidak sesuai arah ' + (o.dir || 'BUY') + '.' });
    }

    const rrV = rr(o.entry, o.sl, o.tp);
    if (rrV == null) {
      if (isFiniteNum(d)) out.push({ code: 'rr', text: 'RR belum bisa dihitung.' });
    } else if (rrV < rules.rrMin) {
      out.push({ code: 'rr', text: 'RR ' + round(rrV, 2).toString().replace('.', ',') + ' < minimum ' +
        String(rules.rrMin).replace('.', ',') });
    }

    const riskC = riskCent(d, o.lot, settings.convCentPerUsdPerLot);
    if (riskC != null && o.balanceCent > 0) {
      const rp = riskPct(riskC, o.balanceCent);
      if (rp > rules.riskPct) {
        out.push({ code: 'risk', text: 'Risiko ' + round(rp, 2).toString().replace('.', ',') +
          '% > maksimum ' + String(rules.riskPct).replace('.', ',') + '%' });
      }
    }

    const chk = o.checklist || {};
    for (const item of CHECKLIST) {
      if (!chk[item.id]) out.push({ code: item.id, text: 'Checklist belum dicentang: ' + item.short });
    }

    if (o.stops) {
      for (const reason of o.stops.reasons) out.push({ code: 'stop', text: 'Aturan stop: ' + reason });
    }

    return out;
  }

  // 7 poin checklist (dipakai UI dan uji).
  const CHECKLIST = Object.freeze([
    { id: 'setup', short: 'setup tertulis', full: 'Setup sudah tertulis (bukan improvisasi saat entry)' },
    { id: 'sl', short: 'SL sebelum entry', full: 'SL sudah ditentukan sebelum entry' },
    { id: 'rr', short: 'RR >= 1,5', full: 'RR minimal 1,5 terhadap jarak SL' },
    { id: 'risk', short: 'risiko <= 0,5%', full: 'Risiko <= 0,5% saldo' },
    { id: 'news', short: 'aman dari news besar', full: 'Tidak dalam 15 menit sebelum/sesudah news besar' },
    { id: 'emotion', short: 'tidak emosi', full: 'Tidak sedang kesal / ingin balik modal' },
    { id: 'own', short: 'setup sendiri', full: 'Bukan ikut sinyal orang tanpa cocok dengan setup sendiri' }
  ]);

  return {
    RULES_FIXED, CHECKLIST,
    round, parseNum, isFiniteNum,
    slDistance, rr, riskCent, riskPct, resultR,
    sumCent, profitFactor, expectancyR, winRate,
    equitySeries, maxDrawdownPct, trailingLosses,
    stopStatus, entryFailures
  };
});
