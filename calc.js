/* Bộ tính toán sơ bộ. Đơn vị nội bộ: N, mm, MPa. Đầu vào lực kN, moment kNm. */
(function (root) {
  const DATA = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : root.DATA;
  const C = {};
  const sq = Math.sqrt, PI = Math.PI;
  const r1 = x => Math.round(x * 10) / 10;
  const kN = N => N / 1000;
  const find = (arr, key, val) => arr.find(o => o[key] === val) || arr[0];
  C.barArea = D => PI * D * D / 4;

  // Tổng hợp kết quả: checks có util; trả về util lớn nhất và mục khống chế
  function summarize(checks) {
    let gov = null;
    checks.forEach(c => { if (c.util != null && isFinite(c.util) && (!gov || c.util > gov.util)) gov = c; });
    return gov;
  }
  C.summarize = summarize;

  /* ================= BTCT ================= */
  C.xiR = Rs => 0.8 / (1 + (Rs / DATA.ES) / 0.0035);

  // Bố trí thanh vào 1–3 lớp, trả về a (khoảng cách trọng tâm thép tới mép chịu kéo)
  function layout(n, D, b, cover, dStir, smin, gapV) {
    const avail = b - 2 * cover - 2 * dStir;
    const nmax = Math.max(1, Math.floor((avail + smin) / (D + smin)));
    const layers = [];
    let left = n;
    while (left > 0) { const k = Math.min(nmax, left); layers.push(k); left -= k; }
    // trọng tâm
    const y0 = cover + dStir + D / 2;
    let sumy = 0;
    layers.forEach((k, i) => { sumy += k * (y0 + i * (D + gapV)); });
    const a = sumy / n;
    const n1 = layers[0];
    const clear = n1 > 1 ? (avail - n1 * D) / (n1 - 1) : avail - D;
    return { layers, a, nmax, clear, avail };
  }
  C.layout = layout;

  C.beamFlex = function (p) {
    const notes = [], formulas = [];
    const b = +p.b, h = +p.h, cover = +p.cover, ds = +p.dStir, D = +p.D;
    const M = +p.M * 1e6;
    const aBar = C.barArea(D);
    const code = p.code || 'TCVN';
    let Rb, Rs, fc, fy, smin;
    const gapV = +p.gapV || Math.max(D, 25);
    if (code === 'TCVN') {
      const cc = find(DATA.CONCRETE, 'g', p.conc), st = find(DATA.REBAR, 'g', p.steel);
      Rb = cc.Rb * (+p.gb1 || 1); Rs = st.Rs; smin = Math.max(D, 25);
    } else {
      fc = +p.fc; fy = +p.fy; smin = Math.max(25, D, 4 / 3 * (+p.dagg || 20));
    }
    let n = 2, lay, h0, As, AsQuick, iter = 0, alpham = 0, xi = 0, xiR = 0, alphaR = 0, rho = 0, overR = false;
    let a = cover + ds + D / 2;
    for (iter = 0; iter < 8; iter++) {
      h0 = h - a;
      if (code === 'TCVN') {
        xiR = C.xiR(Rs); alphaR = xiR * (1 - 0.5 * xiR);
        alpham = M / (Rb * b * h0 * h0);
        overR = alpham > alphaR;
        xi = 1 - sq(Math.max(0, 1 - 2 * alpham));
        As = (overR ? xiR : xi) * Rb * b * h0 / Rs;
        AsQuick = M / (0.9 * h0 * Rs);
        const Asmin = 0.001 * b * h0;
        if (As < Asmin) As = Math.max(As, Asmin);
      } else {
        const Rn = M / (0.9 * b * h0 * h0);
        const disc = 1 - 2 * Rn / (0.85 * fc);
        overR = disc < 0;
        rho = 0.85 * fc / fy * (1 - sq(Math.max(0, disc)));
        As = rho * b * h0;
        AsQuick = M / (0.9 * 0.9 * h0 * fy);
        const Asmin = Math.max(0.25 * sq(fc) / fy, 1.4 / fy) * b * h0;
        if (As < Asmin) As = Asmin;
      }
      const nNew = Math.max(2, Math.ceil(As / aBar - 1e-9));
      lay = layout(nNew, D, b, cover, ds, smin, gapV);
      const aNew = lay.a;
      if (nNew === n && Math.abs(aNew - a) < 0.5) { n = nNew; a = aNew; break; }
      n = nNew; a = aNew;
    }
    h0 = h - a;
    const AsProv = n * aBar;
    // khả năng chịu lực với thép đã chọn
    let Mcap, xiProv, epsT = null;
    const checks = [];
    if (code === 'TCVN') {
      const x = Rs * AsProv / (Rb * b);
      xiProv = x / h0;
      const xUse = Math.min(x, xiR * h0);
      Mcap = Rb * b * xUse * (h0 - xUse / 2);
      checks.push({ k: 'Chịu uốn M ≤ Mgh', d: p.M, c: Mcap / 1e6, u: 'kNm', util: M / Mcap });
      checks.push({ k: 'Vùng nén ξ ≤ ξR', d: xiProv, c: xiR, u: '', util: xiProv / xiR, fmt: 3 });
      formulas.push('αm = M / (Rb·b·h0²);  ξ = 1 − √(1 − 2αm);  As = ξ·Rb·b·h0 / Rs');
      formulas.push('ξR = 0,8 / (1 + εs,el/εb2), εs,el = Rs/Es, εb2 = 0,0035');
      formulas.push('Ước nhanh: As ≈ M / (0,9·h0·Rs)  (giả định z = 0,9h0)');
      formulas.push('Mgh = Rb·b·x·(h0 − x/2), x = Rs·As/(Rb·b) ≤ ξR·h0');
      formulas.push('Tiêu chuẩn: TCVN 5574:2018, tính theo nội lực giới hạn. Hàm lượng tối thiểu lấy 0,1%.');
    } else {
      const beta1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);
      const aa = AsProv * fy / (0.85 * fc * b);
      const c = aa / beta1;
      epsT = 0.003 * (h0 - c) / c;
      const phi = epsT >= 0.005 ? 0.9 : Math.max(0.65, 0.65 + 0.25 * (epsT - 0.002) / 0.003);
      Mcap = phi * AsProv * fy * (h0 - aa / 2);
      checks.push({ k: 'Chịu uốn Mu ≤ φMn', d: p.M, c: Mcap / 1e6, u: 'kNm', util: M / Mcap });
      checks.push({ k: 'Biến dạng thép εt ≥ 0,005', d: epsT, c: 0.005, u: '', util: 0.005 / Math.max(epsT, 1e-6), fmt: 4 });
      formulas.push('Rn = Mu/(φ·b·d²);  ρ = 0,85f′c/fy·(1 − √(1 − 2Rn/(0,85f′c)));  As = ρ·b·d');
      formulas.push('Ước nhanh: As ≈ Mu / (φ·0,9d·fy)');
      formulas.push('φMn = φ·As·fy·(d − a/2), a = As·fy/(0,85f′c·b); φ = 0,9 khi εt ≥ 0,005');
      formulas.push('As,min = max(0,25√f′c/fy; 1,4/fy)·b·d. Tiêu chuẩn: ACI 318-19 chương 9 và 22.');
    }
    const rows = [
      { k: 'Chiều cao làm việc h0', v: r1(h0), u: 'mm' },
      { k: code === 'TCVN' ? 'αm' : 'ρ yêu cầu', v: code === 'TCVN' ? alpham.toFixed(3) : (rho * 100).toFixed(3) + '%', u: '' },
      { k: 'As ước nhanh', v: Math.round(AsQuick), u: 'mm²' },
      { k: 'As yêu cầu (tính đúng)', v: Math.round(As), u: 'mm²', strong: true },
      { k: 'Chọn thép', v: `${n}Φ${D} = ${Math.round(AsProv)}`, u: 'mm²', strong: true },
      { k: 'Bố trí', v: lay.layers.length === 1 ? `1 lớp ${lay.layers[0]} cây` : lay.layers.map((k, i) => `lớp ${i + 1}: ${k}`).join(', '), u: '' },
      { k: 'Khoảng hở giữa 2 cây (lớp 1)', v: r1(lay.clear), u: 'mm' },
      { k: 'Hàm lượng μ', v: (AsProv / (b * h0) * 100).toFixed(2) + '%', u: '' },
    ];
    if (overR) notes.push({ t: 'bad', s: code === 'TCVN' ? `αm = ${alpham.toFixed(3)} > αR = ${alphaR.toFixed(3)}: tiết diện quá nhỏ. Tăng h, tăng mác bê tông hoặc đặt thêm thép chịu nén.` : 'Tiết diện không đủ để chịu Mu với cốt đơn. Tăng tiết diện.' });
    const diff = (AsQuick - As) / As;
    if (Math.abs(diff) > 0.05) notes.push({ t: 'info', s: `Công thức ước nhanh lệch ${diff > 0 ? '+' : ''}${(diff * 100).toFixed(0)}% so với tính đúng${diff < 0 ? ' (thiếu an toàn)' : ''}.` });
    if (lay.layers.length > 1) notes.push({ t: 'warn', s: `Một lớp chỉ xếp được tối đa ${lay.nmax} cây Φ${D} (khoảng hở tối thiểu ${r1(smin)} mm), đã chuyển sang ${lay.layers.length} lớp và tính lại h0 = ${r1(h0)} mm.` });
    else notes.push({ t: 'ok', s: `Khoảng hở ${r1(lay.clear)} mm ≥ tối thiểu ${r1(smin)} mm, xếp 1 lớp được (tối đa ${lay.nmax} cây/lớp).` });
    if (lay.layers.length > 2) notes.push({ t: 'warn', s: 'Từ lớp 3 trở lên nên tăng khoảng hở giữa các lớp (≥ 50 mm) và kiểm tra lại đổ bê tông.' });
    if (code === 'TCVN' && xiProv > xiR) notes.push({ t: 'bad', s: 'Thép chọn quá nhiều làm ξ > ξR, thép không chảy dẻo. Giảm thép hoặc tăng tiết diện.' });
    return { rows, checks, notes, formulas, gov: summarize(checks), draw: { b, h, cover, ds, D, layers: lay.layers, gapV, clear: lay.clear } };
  };

  C.beamShear = function (p) {
    const notes = [], formulas = [];
    const b = +p.b, h = +p.h, h0 = h - (+p.a), Q = +p.Q * 1000;
    const cc = find(DATA.CONCRETE, 'g', p.conc), st = find(DATA.REBAR, 'g', p.steel);
    const Rb = cc.Rb, Rbt = cc.Rbt, Rsw = st.Rsw;
    const dsw = +p.dStir, legs = +p.legs, s = +p.s;
    const Asw = legs * C.barArea(dsw);
    let qsw = Rsw * Asw / s;
    const qswMin = 0.25 * Rbt * b;
    const counted = qsw >= qswMin;
    const Qstrut = 0.3 * Rb * b * h0;
    const Qb0 = 0.5 * Rbt * b * h0;
    // khả năng chịu cắt: lấy nhỏ nhất theo c trong [h0, 3h0]
    let Qu = Infinity, cGov = h0;
    for (let c = h0; c <= 3 * h0 + 1e-6; c += h0 / 40) {
      const Qb = Math.min(2.5 * Rbt * b * h0, Math.max(0.5 * Rbt * b * h0, 1.5 * Rbt * b * h0 * h0 / c));
      const Qsw = counted ? 0.75 * qsw * Math.min(c, 2 * h0) : 0;
      if (Qb + Qsw < Qu) { Qu = Qb + Qsw; cGov = c; }
    }
    const sMaxCalc = Rbt * b * h0 * h0 / Q;
    const sMaxCons = Math.min(0.5 * h0, 300);
    const checks = [
      { k: 'Dải nén nghiêng Q ≤ 0,3Rb·b·h0', d: p.Q, c: Qstrut / 1000, u: 'kN', util: Q / Qstrut },
      { k: 'Tiết diện nghiêng Q ≤ Qb + Qsw', d: p.Q, c: Qu / 1000, u: 'kN', util: Q / Qu },
      { k: 'Bước đai s ≤ Rbt·b·h0²/Q', d: s, c: sMaxCalc, u: 'mm', util: s / sMaxCalc },
      { k: 'Bước đai cấu tạo s ≤ min(0,5h0; 300)', d: s, c: sMaxCons, u: 'mm', util: s / sMaxCons },
    ];
    // bước đai cần thiết
    let sReq = null;
    for (let ss = 300; ss >= 50; ss -= 5) {
      const q = Rsw * Asw / ss;
      if (q < qswMin) continue;
      let Qm = Infinity;
      for (let c = h0; c <= 3 * h0 + 1e-6; c += h0 / 40) {
        const Qb = Math.min(2.5 * Rbt * b * h0, Math.max(0.5 * Rbt * b * h0, 1.5 * Rbt * b * h0 * h0 / c));
        Qm = Math.min(Qm, Qb + 0.75 * q * Math.min(c, 2 * h0));
      }
      if (Qm >= Q) { sReq = ss; break; }
    }
    const sUse = sReq == null ? null : Math.min(sReq, sMaxCalc, sMaxCons);
    const rows = [
      { k: 'h0', v: r1(h0), u: 'mm' },
      { k: 'Bê tông tự chịu 0,5Rbt·b·h0', v: r1(kN(Qb0)), u: 'kN' },
      { k: 'qsw = Rsw·Asw/s', v: r1(qsw), u: 'N/mm' },
      { k: 'Khả năng Qb + Qsw (c nguy hiểm)', v: `${r1(kN(Qu))} (c = ${Math.round(cGov)})`, u: 'kN', strong: true },
      { k: `Bước đai cần với Φ${dsw}, ${legs} nhánh`, v: sUse == null ? 'không đủ' : Math.floor(sUse / 10) * 10, u: 'mm', strong: true },
    ];
    if (Q <= Qb0) notes.push({ t: 'ok', s: `Q ≤ 0,5Rbt·b·h0 = ${r1(kN(Qb0))} kN: bê tông tự chịu cắt, chỉ cần đặt đai cấu tạo.` });
    if (!counted) notes.push({ t: 'warn', s: `qsw = ${r1(qsw)} < 0,25Rbt·b = ${r1(qswMin)} N/mm: đai quá thưa, không được kể vào khả năng chịu cắt.` });
    if (Q > Qstrut) notes.push({ t: 'bad', s: 'Vượt khả năng dải nén nghiêng. Phải tăng tiết diện, tăng đai không giải quyết được.' });
    if (sReq == null && Q <= Qstrut) notes.push({ t: 'bad', s: 'Với đường kính và số nhánh đai này, bước 50 mm vẫn không đủ. Tăng đường kính đai hoặc số nhánh.' });
    formulas.push('Q ≤ φb1·Rb·b·h0, φb1 = 0,3');
    formulas.push('Qb = 1,5·Rbt·b·h0²/c, giới hạn 0,5Rbt·b·h0 ≤ Qb ≤ 2,5Rbt·b·h0');
    formulas.push('Qsw = 0,75·qsw·c0, c0 = min(c; 2h0); chỉ kể khi qsw ≥ 0,25Rbt·b');
    formulas.push('App xét c chạy từ h0 tới 3h0 và lấy trường hợp bất lợi nhất, Q giữ không đổi (thiên về an toàn).');
    formulas.push('Tiêu chuẩn: TCVN 5574:2018, tính theo tiết diện nghiêng.');
    return { rows, checks, notes, formulas, gov: summarize(checks) };
  };

  C.slab = function (p) {
    const notes = [], formulas = [];
    const h = +p.h, cover = +p.cover, D = +p.D, M = +p.M * 1e6, b = 1000;
    const cc = find(DATA.CONCRETE, 'g', p.conc), st = find(DATA.REBAR, 'g', p.steel);
    const Rb = cc.Rb, Rs = st.Rs;
    const h0 = h - cover - D / 2;
    const xiR = C.xiR(Rs), alphaR = xiR * (1 - 0.5 * xiR);
    const am = M / (Rb * b * h0 * h0);
    const xi = 1 - sq(Math.max(0, 1 - 2 * am));
    let As = Math.min(xi, xiR) * Rb * b * h0 / Rs;
    const Asmin = 0.001 * b * h0;
    const governedMin = As < Asmin;
    As = Math.max(As, Asmin);
    const sMax = h <= 150 ? 200 : Math.min(1.5 * h, 400);
    const pick = d => { const a = C.barArea(d); let s = Math.floor(1000 * a / As / 10) * 10; s = Math.min(s, sMax); return { d, s, prov: 1000 * a / s }; };
    const main = pick(D);
    const alt = [8, 10, 12, 14, 16].filter(d => d !== D).map(pick).filter(x => x.s >= 80);
    const x = Rs * main.prov / (Rb * b);
    const Mcap = Rb * b * Math.min(x, xiR * h0) * (h0 - Math.min(x, xiR * h0) / 2);
    const checks = [{ k: 'Chịu uốn M ≤ Mgh (trên 1 m)', d: p.M, c: Mcap / 1e6, u: 'kNm/m', util: M / Mcap }];
    const rows = [
      { k: 'h0', v: r1(h0), u: 'mm' },
      { k: 'αm', v: am.toFixed(3), u: '' },
      { k: 'As yêu cầu', v: Math.round(As), u: 'mm²/m', strong: true },
      { k: 'Chọn', v: `Φ${D} a${main.s} = ${Math.round(main.prov)}`, u: 'mm²/m', strong: true },
      { k: 'Phương án khác', v: alt.map(x => `Φ${x.d}a${x.s}`).join(', '), u: '' },
    ];
    if (am > alphaR) notes.push({ t: 'bad', s: 'αm > αR: sàn quá mỏng so với moment. Tăng chiều dày.' });
    if (governedMin) notes.push({ t: 'info', s: 'Thép theo hàm lượng tối thiểu 0,1% khống chế.' });
    notes.push({ t: 'info', s: `Bước thép lớn nhất ${sMax} mm (h ${h <= 150 ? '≤' : '>'} 150 mm).` });
    formulas.push('Tính như dải dầm rộng b = 1000 mm: αm = M/(Rb·b·h0²) → ξ → As/m');
    formulas.push('Bước a = 1000·as/As, làm tròn xuống 10 mm; amax = 200 mm (h ≤ 150) hoặc min(1,5h; 400)');
    formulas.push('Tiêu chuẩn: TCVN 5574:2018.');
    return { rows, checks, notes, formulas, gov: summarize(checks) };
  };

  /* ================= THÉP: LIÊN KẾT BULÔNG ================= */
  C.boltGroup = function (p) {
    const notes = [], formulas = [];
    const bolt = find(DATA.BOLTS, 'n', p.bolt), gr = find(DATA.BOLT_GRADES, 'g', p.grade);
    const rows_ = Math.max(1, +p.rows), cols = Math.max(1, +p.cols), n = rows_ * cols;
    const pp = +p.p, g = +p.g, M = (+p.M) * 1e6, N = (+p.N) * 1000, V = (+p.V) * 1000;
    const d = bolt.d, d0 = bolt.d0, As = bolt.As, Ab = PI * d * d / 4;
    const fub = gr.fub;
    const t = +p.t, fu = +p.fu, e1 = +p.e1, e2 = +p.e2;
    // lực kéo bulông do moment
    let TM = 0, sumY2 = 0, ymax = 0, nt = 0, z = 0;
    for (let i = 0; i < rows_; i++) { const y = (i - (rows_ - 1) / 2) * pp; sumY2 += cols * y * y; ymax = Math.max(ymax, Math.abs(y)); }
    if (p.method === 'couple') {
      nt = Math.max(1, Math.min(rows_, +p.nt || Math.floor(rows_ / 2) || 1));
      z = +p.z || Math.max(pp * (rows_ - 1), pp);
      TM = M / z / (cols * nt);
      formulas.push(`Cặp ngẫu lực: T = M / z / (số bulông chịu kéo) = M / (z · ${cols}·${nt})`);
    } else {
      TM = sumY2 > 0 ? M * ymax / sumY2 : 0;
      formulas.push('Phân bố tuyến tính quanh trọng tâm nhóm: Tmax = M·ymax / Σy²');
      if (rows_ === 1 && M > 0) notes.push({ t: 'bad', s: 'Chỉ có 1 hàng bulông thì nhóm không chịu được moment theo phương này.' });
    }
    const Tb = TM + Math.max(0, N) / n;
    const Vb = V / n;
    const checks = [];
    const code = p.code || 'EC3';
    if (code === 'EC3') {
      const gM2 = 1.25;
      const FtRd = 0.9 * fub * As / gM2;
      const thread = p.shear !== 'shank';
      const av = thread ? gr.av : 0.6;
      const FvRd = av * fub * (thread ? As : Ab) / gM2;
      const p1 = pp, p2 = g;
      const ad = Math.min(e1 / (3 * d0), rows_ > 1 ? p1 / (3 * d0) - 0.25 : Infinity);
      const ab = Math.min(ad, fub / fu, 1);
      const k1 = Math.min(2.8 * e2 / d0 - 1.7, cols > 1 ? 1.4 * p2 / d0 - 1.7 : Infinity, 2.5);
      const FbRd = Math.max(0, k1 * ab * fu * d * t / gM2);
      const inter = Vb / FvRd + Tb / (1.4 * FtRd);
      checks.push({ k: 'Kéo đứt bulông Ft,Ed ≤ Ft,Rd', d: kN(Tb), c: kN(FtRd), u: 'kN', util: Tb / FtRd });
      checks.push({ k: `Cắt đứt bulông (${thread ? 'qua ren' : 'qua thân'})`, d: kN(Vb), c: kN(FvRd), u: 'kN', util: Vb / FvRd });
      checks.push({ k: 'Tương tác Fv/Fv,Rd + Ft/(1,4Ft,Rd) ≤ 1', d: inter, c: 1, u: '', util: inter, fmt: 2 });
      checks.push({ k: 'Ép mặt bản mã Fb,Rd', d: kN(Vb), c: kN(FbRd), u: 'kN', util: Vb / FbRd });
      formulas.push('Ft,Rd = 0,9·fub·As / γM2;  Fv,Rd = αv·fub·A / γM2;  γM2 = 1,25');
      formulas.push(`αv = ${av} (${thread ? 'mặt cắt qua ren, A = As' : 'mặt cắt qua thân, A = πd²/4'})`);
      formulas.push('Fb,Rd = k1·αb·fu·d·t / γM2;  αb = min(e1/3d0; p1/3d0 − 1/4; fub/fu; 1);  k1 = min(2,8e2/d0 − 1,7; 1,4p2/d0 − 1,7; 2,5)');
      formulas.push('Tiêu chuẩn: EN 1993-1-8, bảng 3.4. Lực cắt giả định theo phương hàng bulông (p1 = p, p2 = g).');
      if (k1 <= 0) notes.push({ t: 'bad', s: 'Khoảng cách mép e2 hoặc p2 quá nhỏ so với lỗ, k1 ≤ 0.' });
      if (e1 < 1.2 * d0) notes.push({ t: 'warn', s: `e1 = ${e1} < 1,2d0 = ${r1(1.2 * d0)} mm: nhỏ hơn khoảng cách mép tối thiểu.` });
      if (e2 < 1.2 * d0) notes.push({ t: 'warn', s: `e2 = ${e2} < 1,2d0 = ${r1(1.2 * d0)} mm: nhỏ hơn khoảng cách mép tối thiểu.` });
      if (rows_ > 1 && pp < 2.2 * d0) notes.push({ t: 'warn', s: `p = ${pp} < 2,2d0 = ${r1(2.2 * d0)} mm: bước bulông nhỏ hơn tối thiểu.` });
      if (cols > 1 && g < 2.4 * d0) notes.push({ t: 'warn', s: `g = ${g} < 2,4d0 = ${r1(2.4 * d0)} mm: khoảng cách cột bulông nhỏ hơn tối thiểu.` });
      if (e1 >= 3 * d0) notes.push({ t: 'ok', s: `e1 ≥ 3d0 = ${3 * d0} mm: khoảng cách đầu không còn làm giảm ép mặt.` });
    } else {
      const phi = 0.75;
      const Fnt = 0.75 * fub;
      const thread = p.shear !== 'shank';
      const Fnv = (thread ? 0.45 : 0.563) * fub;
      const frv = Vb / Ab;
      const Fntp = Math.min(Fnt, Math.max(0, 1.3 * Fnt - Fnt / (phi * Fnv) * frv));
      const Rt = phi * Fnt * Ab, Rtp = phi * Fntp * Ab, Rv = phi * Fnv * Ab;
      const lcEdge = e1 - d0 / 2, lcIn = pp - d0;
      const lc = rows_ > 1 ? Math.min(lcEdge, lcIn) : lcEdge;
      const Rbr = phi * Math.min(1.2 * lc * t * fu, 2.4 * d * t * fu);
      checks.push({ k: 'Kéo đứt bulông φRnt', d: kN(Tb), c: kN(Rt), u: 'kN', util: Tb / Rt });
      checks.push({ k: `Cắt đứt bulông φRnv (${thread ? 'ren trong mặt cắt, N' : 'ren ngoài mặt cắt, X'})`, d: kN(Vb), c: kN(Rv), u: 'kN', util: Vb / Rv });
      checks.push({ k: 'Kéo khi có cắt φF′nt·Ab', d: kN(Tb), c: kN(Rtp), u: 'kN', util: Tb / Rtp });
      checks.push({ k: 'Ép mặt / xé lỗ bản mã', d: kN(Vb), c: kN(Rbr), u: 'kN', util: Vb / Rbr });
      formulas.push('φRn = 0,75·Fn·Ab, Ab = πd²/4 (diện tích danh định, không dùng As)');
      formulas.push(`Fnt = 0,75fub; Fnv = ${thread ? '0,45' : '0,563'}fub (quy đổi theo cách AISC lập bảng J3.2 cho A325/A490)`);
      formulas.push('F′nt = 1,3Fnt − Fnt/(φFnv)·frv ≤ Fnt');
      formulas.push('Ép mặt/xé: Rn = min(1,2·lc·t·Fu; 2,4·d·t·Fu); lc = e1 − d0/2 hoặc p − d0');
      formulas.push('Tiêu chuẩn: AISC 360-16 mục J3.6, J3.7, J3.10.');
      notes.push({ t: 'info', s: 'Cấp bền hệ mét quy đổi sang Fnt, Fnv theo tỷ lệ AISC dùng cho A325/A490 (8.8 ≈ A325, 10.9 ≈ A490).' });
    }
    const rows = [
      { k: 'Số bulông', v: `${n} (${rows_} hàng × ${cols} cột)`, u: '' },
      { k: 'Lực kéo bulông do M', v: r1(kN(TM)), u: 'kN' },
      { k: 'Lực kéo bulông lớn nhất', v: r1(kN(Tb)), u: 'kN', strong: true },
      { k: 'Lực cắt mỗi bulông', v: r1(kN(Vb)), u: 'kN', strong: true },
    ];
    if (N < 0) notes.push({ t: 'info', s: 'N âm (nén) được bỏ qua khi tính lực kéo bulông, thiên về an toàn.' });
    return { rows, checks, notes, formulas, gov: summarize(checks), draw: { rows: rows_, cols, p: pp, g, e1, e2, d0, method: p.method } };
  };

  C.blockTear = function (p) {
    const notes = [], formulas = [];
    const n1 = Math.max(1, +p.n1), n2 = Math.max(1, +p.n2), p1 = +p.p1, p2 = +p.p2, e1 = +p.e1, e2 = +p.e2;
    const d0 = +p.d0, t = +p.t, V = +p.V * 1000;
    const st = find(DATA.STEEL, 'g', p.grade);
    const fy = +p.fy || st.fy, fu = +p.fu || st.fu;
    const centre = p.mode !== 'corner';
    const Lv = e1 + (n1 - 1) * p1;
    const Agv = (centre ? 2 : 1) * Lv * t;
    const Anv = (centre ? 2 : 1) * (Lv - (n1 - 0.5) * d0) * t;
    const Ant = centre ? Math.max(0, ((n2 - 1) * p2 - (n2 - 1) * d0) * t) : Math.max(0, ((n2 - 1) * p2 + e2 - (n2 - 0.5) * d0) * t);
    let cap;
    if ((p.code || 'EC3') === 'EC3') {
      const gM2 = 1.25, gM0 = 1.0;
      cap = (centre ? 1 : 0.5) * fu * Ant / gM2 + fy * Anv / (sq(3) * gM0);
      formulas.push(centre ? 'Veff,1,Rd = fu·Ant/γM2 + fy·Anv/(√3·γM0)  (tải đúng tâm)' : 'Veff,2,Rd = 0,5·fu·Ant/γM2 + fy·Anv/(√3·γM0)  (tải lệch tâm, ví dụ bụng dầm)');
      formulas.push('Tiêu chuẩn: EN 1993-1-8 mục 3.10.2.');
    } else {
      const Ubs = centre ? 1 : 0.5;
      const Rn = Math.min(0.6 * fu * Anv + Ubs * fu * Ant, 0.6 * fy * Agv + Ubs * fu * Ant);
      cap = 0.75 * Rn;
      formulas.push(`Rn = 0,6Fu·Anv + Ubs·Fu·Ant ≤ 0,6Fy·Agv + Ubs·Fu·Ant;  φ = 0,75; Ubs = ${Ubs}`);
      formulas.push('Tiêu chuẩn: AISC 360-16 mục J4.3.');
    }
    const checks = [{ k: 'Xé khối (block tearing)', d: p.V, c: kN(cap), u: 'kN', util: V / cap }];
    const rows = [
      { k: 'Agv (cắt, nguyên)', v: Math.round(Agv), u: 'mm²' },
      { k: 'Anv (cắt, thực)', v: Math.round(Anv), u: 'mm²' },
      { k: 'Ant (kéo, thực)', v: Math.round(Ant), u: 'mm²' },
      { k: 'Khả năng chống xé khối', v: r1(kN(cap)), u: 'kN', strong: true },
    ];
    notes.push({ t: 'info', s: centre ? 'Khối giữa: 2 mặt cắt dọc + 1 mặt kéo giữa các cột bulông ngoài cùng (ví dụ bản mã giữa).' : 'Khối góc: 1 mặt cắt dọc + 1 mặt kéo ra mép bên (ví dụ bụng dầm cắt khấc, thép góc).' });
    if (centre && n2 === 1) notes.push({ t: 'warn', s: 'Chỉ 1 cột bulông thì khối giữa không có mặt kéo. Kiểm tra dạng khối góc.' });
    return { rows, checks, notes, formulas, gov: summarize(checks), draw: { n1, n2, p1, p2, e1, e2, d0, centre } };
  };

  C.tension = function (p) {
    const notes = [], formulas = [];
    const st = find(DATA.STEEL, 'g', p.grade);
    const fy = st.fy, fu = st.fu;
    const w = +p.w, t = +p.t, nh = +p.nh, d0 = +p.d0, N = +p.N * 1000, U = +p.U || 1;
    const Ag = p.Ag ? +p.Ag : w * t;
    const An = Ag - nh * d0 * t;
    const checks = [];
    if ((p.code || 'EC3') === 'EC3') {
      const Npl = Ag * fy / 1.0, Nu = 0.9 * An * fu / 1.25;
      checks.push({ k: 'Chảy tiết diện nguyên Npl,Rd', d: p.N, c: kN(Npl), u: 'kN', util: N / Npl });
      checks.push({ k: 'Đứt tiết diện thực Nu,Rd', d: p.N, c: kN(Nu), u: 'kN', util: N / Nu });
      formulas.push('Npl,Rd = A·fy/γM0;  Nu,Rd = 0,9·Anet·fu/γM2;  γM0 = 1,0; γM2 = 1,25');
      formulas.push('Tiêu chuẩn: EN 1993-1-1 mục 6.2.3.');
    } else {
      const Ry = 0.9 * fy * Ag, Ru = 0.75 * fu * U * An;
      checks.push({ k: 'Chảy tiết diện nguyên φFy·Ag', d: p.N, c: kN(Ry), u: 'kN', util: N / Ry });
      checks.push({ k: 'Đứt tiết diện hiệu dụng φFu·Ae', d: p.N, c: kN(Ru), u: 'kN', util: N / Ru });
      formulas.push('φPn = 0,9·Fy·Ag;  φPn = 0,75·Fu·Ae, Ae = U·An');
      formulas.push('Tiêu chuẩn: AISC 360-16 mục D2.');
      if (U < 1) notes.push({ t: 'info', s: `Hệ số trễ cắt U = ${U} (liên kết không truyền lực qua toàn bộ tiết diện).` });
    }
    const rows = [
      { k: 'Tiết diện nguyên A', v: Math.round(Ag), u: 'mm²' },
      { k: 'Tiết diện thực Anet', v: Math.round(An), u: 'mm²' },
    ];
    if (An <= 0) notes.push({ t: 'bad', s: 'Lỗ khoét hết tiết diện.' });
    return { rows, checks, notes, formulas, gov: summarize(checks) };
  };

  /* ================= BULÔNG NEO — ACI 318-19 chương 17 ================= */
  C.anchor = function (p) {
    const notes = [], formulas = [];
    const big = 1e9;
    const ce = v => (v === '' || v == null || +v <= 0 ? big : +v);
    const bolt = find(DATA.BOLTS, 'n', p.bolt), gr = find(DATA.ANCHOR_GRADES, 'g', p.grade);
    const da = bolt.d, Ase = bolt.As;
    const futa = Math.min(gr.futa, 1.9 * gr.fya, 860);
    const fc = +p.fc, lam = 1, cracked = p.cracked !== 'no';
    const rows_ = Math.max(1, +p.rows), cols = Math.max(1, +p.cols), n = rows_ * cols;
    const sx = cols > 1 ? +p.sx : 0, sy = rows_ > 1 ? +p.sy : 0;
    const cL = ce(p.cL), cR = ce(p.cR), cB = ce(p.cB), cT = ce(p.cT);
    const ha = +p.ha;
    let hef = +p.hef;
    const Nua = Math.max(0, +p.N) * 1000, Vua = Math.max(0, +p.V) * 1000;
    const F = sq(fc);
    // diện tích đế neo (mũ / ê-cu): mặc định ê-cu lục giác nặng
    const Fhex = 1.5 * da + 3;
    const Abrg = +p.Abrg || (0.866 * Fhex * Fhex - PI * da * da / 4);
    const checks = [];
    const edges = [cL, cR, cB, cT];
    const camin = Math.min(...edges);
    // hef giảm khi 3 mép trở lên < 1,5hef
    const nearEdges = edges.filter(c => c < 1.5 * hef);
    const hefIn = hef;
    if (nearEdges.length >= 3) {
      const camax = Math.max(...nearEdges);
      hef = Math.max(camax / 1.5, Math.max(sx, sy) / 3);
      if (hef < hefIn) notes.push({ t: 'warn', s: `Có ${nearEdges.length} mép gần hơn 1,5hef: dùng hef′ = ${r1(hef)} mm thay cho ${hefIn} mm khi tính phá vỡ.` });
      else hef = hefIn;
    }
    /* --- KÉO --- */
    const NsaOne = Ase * futa;
    const phiNsa = 0.75 * n * NsaOne;
    const ANco = 9 * hef * hef;
    const wX = Math.min(cL, 1.5 * hef) + (cols - 1) * sx + Math.min(cR, 1.5 * hef);
    const wY = Math.min(cB, 1.5 * hef) + (rows_ - 1) * sy + Math.min(cT, 1.5 * hef);
    const ANc = Math.min(wX * wY, n * ANco);
    const Nb = (hef > 280 && hef <= 635) ? 3.9 * lam * F * Math.pow(hef, 5 / 3) : 10 * lam * F * Math.pow(hef, 1.5);
    const psiEdN = camin >= 1.5 * hef ? 1 : 0.7 + 0.3 * camin / (1.5 * hef);
    const psiCN = cracked ? 1.0 : 1.25;
    const Ncbg = ANc / ANco * psiEdN * psiCN * Nb;
    const phiNcbg = 0.70 * Ncbg;
    const psiCP = cracked ? 1.0 : 1.4;
    const Np = 8 * Abrg * fc;
    const phiNpn = 0.70 * n * psiCP * Np;
    let phiNsb = null;
    if (Nua > 0) {
      checks.push({ k: 'Kéo: đứt thép bulông φNsa', d: kN(Nua), c: kN(phiNsa), u: 'kN', util: Nua / phiNsa, grp: 'N' });
      checks.push({ k: 'Kéo: phá vỡ hình nón φNcbg', d: kN(Nua), c: kN(phiNcbg), u: 'kN', util: Nua / phiNcbg, grp: 'N' });
      checks.push({ k: 'Kéo: tuột neo φNpn', d: kN(Nua), c: kN(phiNpn), u: 'kN', util: Nua / phiNpn, grp: 'N' });
    }
    // side-face blowout
    if (camin < 0.4 * hef) {
      const ca2 = [...edges].sort((a, b) => a - b)[1];
      let Nsb = 13 * camin * sq(Abrg) * lam * F;
      if (ca2 < 3 * camin) Nsb *= (1 + ca2 / camin) / 4;
      const nEdge = (camin === cL || camin === cR) ? rows_ : cols;
      const sEdge = (camin === cL || camin === cR) ? sy : sx;
      let Nsbg = nEdge > 1 && sEdge < 6 * camin ? (1 + sEdge / (6 * camin)) * Nsb : nEdge * Nsb;
      phiNsb = 0.70 * Nsbg;
      const NuaEdge = Nua * nEdge / n;
      if (Nua > 0) checks.push({ k: 'Kéo: bung mặt bên φNsb', d: kN(NuaEdge), c: kN(phiNsb), u: 'kN', util: NuaEdge / phiNsb, grp: 'N' });
      notes.push({ t: 'warn', s: `Mép gần nhất ${camin} mm < 0,4hef = ${r1(0.4 * hef)} mm: phải kiểm bung mặt bên (side-face blowout).` });
    } else if (camin < big) notes.push({ t: 'ok', s: `Mép gần nhất ${camin} mm ≥ 0,4hef = ${r1(0.4 * hef)} mm: không cần kiểm bung mặt bên.` });
    if (camin >= 1.5 * hef) notes.push({ t: 'ok', s: `Mép gần nhất ${camin >= big ? '∞' : camin} ≥ 1,5hef = ${r1(1.5 * hef)} mm: mép không làm giảm hình nón (ψed,N = 1).` });
    else notes.push({ t: 'info', s: `Mép ${camin} mm < 1,5hef = ${r1(1.5 * hef)} mm: ψed,N = ${psiEdN.toFixed(3)}. Cần c ≥ ${r1(1.5 * hef)} mm để bỏ ảnh hưởng mép.` });
    const smaxGrid = Math.max(sx, sy);
    if (n > 1) {
      if (Math.min(cols > 1 ? sx : big, rows_ > 1 ? sy : big) < 3 * hef) notes.push({ t: 'info', s: `Khoảng cách bulông < 3hef = ${r1(3 * hef)} mm: các hình nón chồng nhau, đã tính theo diện tích chiếu chung ANc = ${Math.round(ANc)} mm².` });
      else notes.push({ t: 'ok', s: `Khoảng cách bulông ≥ 3hef = ${r1(3 * hef)} mm: các hình nón không chồng nhau.` });
      const smin = Math.min(cols > 1 ? sx : big, rows_ > 1 ? sy : big);
      if (smin < 4 * da) notes.push({ t: 'bad', s: `Khoảng cách bulông ${smin} mm < 4da = ${4 * da} mm (tối thiểu).` });
    }
    /* --- CẮT --- */
    const dir = p.vdir || 'R';
    const ca1 = { L: cL, R: cR, B: cB, T: cT }[dir];
    const perpA = (dir === 'L' || dir === 'R') ? cB : cL;
    const perpB = (dir === 'L' || dir === 'R') ? cT : cR;
    const nPerp = (dir === 'L' || dir === 'R') ? rows_ : cols;
    const sPerp = (dir === 'L' || dir === 'R') ? sy : sx;
    const phiVsa = 0.65 * n * 0.6 * Ase * futa;
    const le = Math.min(hef, 8 * da);
    const shearEdge = (c1raw) => {
      let c1 = c1raw;
      const ca2min = Math.min(perpA, perpB);
      if (perpA < 1.5 * c1 && perpB < 1.5 * c1 && ha < 1.5 * c1) {
        c1 = Math.max(Math.max(perpA, perpB) / 1.5, ha / 1.5, sPerp / 3);
      }
      const Avco = 4.5 * c1 * c1;
      const Avc = Math.min((Math.min(perpA, 1.5 * c1) + (nPerp - 1) * sPerp + Math.min(perpB, 1.5 * c1)) * Math.min(ha, 1.5 * c1), nPerp * Avco);
      const Vb = Math.min(0.6 * Math.pow(le / da, 0.2) * sq(da) * lam * F * Math.pow(c1, 1.5), 3.7 * lam * F * Math.pow(c1, 1.5));
      const psiEdV = ca2min >= 1.5 * c1 ? 1 : 0.7 + 0.3 * ca2min / (1.5 * c1);
      const psiCV = cracked ? 1.0 : 1.4;
      const psiHV = Math.max(1, sq(1.5 * c1 / ha));
      return { V: 0.70 * Avc / Avco * psiEdV * psiCV * psiHV * Vb, c1, Avc, Avco, psiEdV, psiHV, Vb };
    };
    let se = null;
    if (ca1 < big) se = shearEdge(ca1);
    const kcp = hef < 65 ? 1 : 2;
    const phiVcp = 0.70 * kcp * Ncbg;
    if (Vua > 0) {
      checks.push({ k: 'Cắt: đứt thép bulông φVsa', d: kN(Vua), c: kN(phiVsa), u: 'kN', util: Vua / phiVsa, grp: 'V' });
      if (se) checks.push({ k: 'Cắt: phá vỡ mép bê tông φVcbg', d: kN(Vua), c: kN(se.V), u: 'kN', util: Vua / se.V, grp: 'V' });
      checks.push({ k: 'Cắt: bẩy bật (pryout) φVcpg', d: kN(Vua), c: kN(phiVcp), u: 'kN', util: Vua / phiVcp, grp: 'V' });
    }
    if (se) {
      if (se.c1 !== ca1) notes.push({ t: 'warn', s: `Cấu kiện hẹp và mỏng: dùng ca1′ = ${r1(se.c1)} mm thay ca1 = ${ca1} mm.` });
      const ca2min = Math.min(perpA, perpB);
      notes.push(ca2min >= 1.5 * se.c1 ? { t: 'ok', s: `Mép vuông góc ca2 ${ca2min >= big ? '∞' : ca2min} ≥ 1,5ca1 = ${r1(1.5 * se.c1)} mm: ψed,V = 1.` }
        : { t: 'info', s: `Mép vuông góc ca2 = ${ca2min} < 1,5ca1 = ${r1(1.5 * se.c1)} mm: ψed,V = ${se.psiEdV.toFixed(3)}.` });
      notes.push(ha >= 1.5 * se.c1 ? { t: 'ok', s: `Chiều dày ha = ${ha} ≥ 1,5ca1 = ${r1(1.5 * se.c1)} mm: ψh,V = 1.` }
        : { t: 'info', s: `Chiều dày ha = ${ha} < 1,5ca1 = ${r1(1.5 * se.c1)} mm: ψh,V = ${se.psiHV.toFixed(3)} (cấu kiện mỏng).` });
      // khoảng cách mép để phá vỡ mép không còn khống chế so với đứt thép
      let lo = 10, hi = 20000, thr = null;
      if (shearEdge(hi).V >= phiVsa) {
        for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (shearEdge(mid).V >= phiVsa) hi = mid; else lo = mid; }
        thr = hi;
      }
      if (thr != null) notes.push(ca1 >= thr ? { t: 'ok', s: `ca1 = ${ca1} mm ≥ ${Math.ceil(thr / 10) * 10} mm: phá vỡ mép không khống chế, đứt thép bulông khống chế khi cắt.` }
        : { t: 'info', s: `Cần ca1 ≥ ${Math.ceil(thr / 10) * 10} mm thì phá vỡ mép mới không còn khống chế (so với đứt thép bulông).` });
      const enLim = Math.max(10 * hef, 60 * da);
      notes.push({ t: 'info', s: `Tham khảo EN 1992-4: được bỏ qua kiểm phá vỡ mép khi mọi mép ≥ max(10hef; 60d) = ${Math.round(enLim)} mm.` });
    } else if (Vua > 0) notes.push({ t: 'ok', s: 'Không có mép theo hướng lực cắt: không có phá vỡ mép.' });
    if (camin < 6 * da && camin < big) notes.push({ t: 'warn', s: `Mép ${camin} mm < 6da = ${6 * da} mm: nếu bulông được siết lực trước thì không đạt khoảng cách mép tối thiểu.` });
    /* --- TƯƠNG TÁC --- */
    const nChecks = checks.filter(c => c.grp === 'N'), vChecks = checks.filter(c => c.grp === 'V');
    const uN = nChecks.length ? Math.max(...nChecks.map(c => c.util)) : 0;
    const uV = vChecks.length ? Math.max(...vChecks.map(c => c.util)) : 0;
    if (Nua > 0 && Vua > 0) {
      let inter, lim = 1.2;
      if (uV <= 0.2) { inter = uN; lim = 1; notes.push({ t: 'info', s: 'Vua ≤ 0,2φVn: cho phép chỉ kiểm kéo.' }); }
      else if (uN <= 0.2) { inter = uV; lim = 1; notes.push({ t: 'info', s: 'Nua ≤ 0,2φNn: cho phép chỉ kiểm cắt.' }); }
      else inter = uN + uV;
      checks.push({ k: `Tương tác kéo + cắt ≤ ${lim}`, d: inter, c: lim, u: '', util: inter / lim, fmt: 2 });
    }
    const rows = [
      { k: 'hef dùng tính', v: r1(hef), u: 'mm' },
      { k: 'ANc / ANco', v: `${Math.round(ANc)} / ${Math.round(ANco)}`, u: 'mm²' },
      { k: 'Nb (1 neo, bê tông)', v: r1(kN(Nb)), u: 'kN' },
      { k: 'Diện tích tựa đầu neo Abrg', v: Math.round(Abrg), u: 'mm²' },
    ];
    if (se) rows.push({ k: 'Avc / Avco (cắt)', v: `${Math.round(se.Avc)} / ${Math.round(se.Avco)}`, u: 'mm²' });
    formulas.push('Đứt thép: φNsa = 0,75·n·Ase·futa; φVsa = 0,65·n·0,6·Ase·futa; futa ≤ min(1,9fya; 860 MPa)');
    formulas.push('Hình nón: Nb = 10λ√f′c·hef^1,5 (hef > 280: 3,9λ√f′c·hef^5/3); Ncbg = ANc/ANco·ψed,N·ψc,N·Nb; ANco = 9hef²');
    formulas.push('ψed,N = 0,7 + 0,3·ca,min/(1,5hef) ≤ 1; ψc,N = 1,25 bê tông không nứt (neo đặt sẵn)');
    formulas.push('Tuột neo: Np = 8·Abrg·f′c; ψc,P = 1,4 không nứt');
    formulas.push('Bung mặt bên (ca1 < 0,4hef): Nsb = 13·ca1·√Abrg·λ√f′c');
    formulas.push('Phá vỡ mép khi cắt: Vb = min(0,6(le/da)^0,2·√da·λ√f′c·ca1^1,5; 3,7λ√f′c·ca1^1,5); Vcbg = Avc/Avco·ψed,V·ψc,V·ψh,V·Vb; Avco = 4,5ca1²');
    formulas.push('Pryout: Vcpg = kcp·Ncpg, kcp = 2 khi hef ≥ 65 mm');
    formulas.push('Tương tác: Nua/φNn + Vua/φVn ≤ 1,2');
    formulas.push('φ bê tông = 0,70 (neo đặt sẵn, không có thép gia cường bổ sung). Tiêu chuẩn: ACI 318-19 chương 17.');
    formulas.push('Lực cắt giả định do hàng neo gần mép nhất chịu toàn bộ, ca1 đo từ hàng đó (thiên về an toàn).');
    return {
      rows, checks, notes, formulas, gov: summarize(checks),
      draw: { rows: rows_, cols, sx, sy, cL, cR, cB, cT, hef, big, dir, c1: se ? se.c1 : null, ha }
    };
  };

  /* ================= THÉP HÌNH ================= */
  C.sectionProps = function (type, dims) {
    let A, Iy, Iz, Iv = null, Iu = null, extra = {};
    if (type === 'H' || type === 'U') {
      const [h, b, tw, tf] = dims; const rf = dims[4] || 0;
      const hw = h - 2 * tf;
      // góc lượn: diện tích (1 − π/4)r², trọng tâm cách góc 0,2234r
      const af = (1 - PI / 4) * rf * rf, ec = 0.2234 * rf;
      const nf = type === 'H' ? 4 : 2;
      A = 2 * b * tf + hw * tw + nf * af;
      const yf = h / 2 - tf - ec;
      Iy = (b * h ** 3 - (b - tw) * hw ** 3) / 12 + nf * af * yf * yf;
      if (type === 'H') { const xf = tw / 2 + ec; Iz = 2 * tf * b ** 3 / 12 + hw * tw ** 3 / 12 + nf * af * xf * xf; }
      else {
        const xf = tw + ec;
        const xb = (2 * b * tf * b / 2 + hw * tw * tw / 2 + nf * af * xf) / A;
        Iz = 2 * (tf * b ** 3 / 12 + b * tf * (b / 2 - xb) ** 2) + hw * tw ** 3 / 12 + hw * tw * (tw / 2 - xb) ** 2 + nf * af * (xf - xb) ** 2;
        extra.xb = xb;
      }
    } else if (type === 'L') {
      const [a, b, t] = dims;
      const A1 = a * t, A2 = (b - t) * t;
      A = A1 + A2;
      const x1 = a / 2, y1 = t / 2, x2 = t / 2, y2 = t + (b - t) / 2;
      const xc = (A1 * x1 + A2 * x2) / A, yc = (A1 * y1 + A2 * y2) / A;
      const Ix = a * t ** 3 / 12 + A1 * (y1 - yc) ** 2 + t * (b - t) ** 3 / 12 + A2 * (y2 - yc) ** 2;
      const Iyy = t * a ** 3 / 12 + A1 * (x1 - xc) ** 2 + (b - t) * t ** 3 / 12 + A2 * (x2 - xc) ** 2;
      const Ixy = A1 * (x1 - xc) * (y1 - yc) + A2 * (x2 - xc) * (y2 - yc);
      const m = (Ix + Iyy) / 2, r = sq(((Ix - Iyy) / 2) ** 2 + Ixy ** 2);
      Iy = Ix; Iz = Iyy; Iu = m + r; Iv = m - r;
      extra = { xc, yc };
    } else if (type === 'CHS') {
      const [Dd, t] = dims; const di = Dd - 2 * t;
      A = PI / 4 * (Dd * Dd - di * di); Iy = Iz = PI / 64 * (Dd ** 4 - di ** 4);
    } else if (type === 'RHS') {
      const [H, B, t] = dims;
      A = H * B - (H - 2 * t) * (B - 2 * t);
      Iy = (B * H ** 3 - (B - 2 * t) * (H - 2 * t) ** 3) / 12;
      Iz = (H * B ** 3 - (H - 2 * t) * (B - 2 * t) ** 3) / 12;
    }
    const out = { A, Iy, Iz, ry: sq(Iy / A), rz: sq(Iz / A), mass: A * 7850e-6 };
    if (Iv != null) { out.Iu = Iu; out.Iv = Iv; out.rv = sq(Iv / A); out.ru = sq(Iu / A); }
    out.rmin = Math.min(out.ry, out.rz, out.rv || Infinity);
    return Object.assign(out, extra);
  };
  C.sectionName = (type, d) => type === 'H' ? `H${d[0]}×${d[1]}×${d[2]}×${d[3]}` : type === 'U' ? `U${d[0]}×${d[1]}×${d[2]}×${d[3]}`
    : type === 'L' ? `L${d[0]}×${d[1]}×${d[2]}` : type === 'CHS' ? `Ống Φ${d[0]}×${d[1]}` : `Hộp ${d[0]}×${d[1]}×${d[2]}`;

  C.member = function (p) {
    const notes = [], formulas = [];
    const type = p.type, dims = String(p.sec).split('x').map(Number);
    const pr = C.sectionProps(type, dims);
    const st = find(DATA.STEEL, 'g', p.grade);
    const fy = st.fy;
    const code = p.code || 'EC3';
    const E = code === 'EC3' ? 210000 : 200000;
    const L = +p.L * 1000, Ky = +p.Ky, Kz = +p.Kz;
    const N = +p.N * 1000;
    const comp = p.force !== 'tension';
    // độ mảnh theo các trục
    const axes = [];
    if (type === 'L') {
      axes.push({ ax: 'v-v (trục chính nhỏ)', r: pr.rv, K: Math.max(Ky, Kz), curve: 'b' });
      axes.push({ ax: 'x-x (song song cánh)', r: pr.ry, K: Ky, curve: 'b' });
      axes.push({ ax: 'y-y', r: pr.rz, K: Kz, curve: 'b' });
    } else if (type === 'H') {
      const hb = dims[0] / dims[1];
      axes.push({ ax: 'y-y (trục khỏe)', r: pr.ry, K: Ky, curve: hb > 1.2 ? 'a' : 'b' });
      axes.push({ ax: 'z-z (trục yếu)', r: pr.rz, K: Kz, curve: hb > 1.2 ? 'b' : 'c' });
    } else if (type === 'U') {
      axes.push({ ax: 'y-y (trục khỏe)', r: pr.ry, K: Ky, curve: 'c' });
      axes.push({ ax: 'z-z (trục yếu)', r: pr.rz, K: Kz, curve: 'c' });
    } else {
      const cv = p.formed === 'cold' ? 'c' : 'a';
      axes.push({ ax: 'y-y', r: pr.ry, K: Ky, curve: cv });
      if (type === 'RHS') axes.push({ ax: 'z-z', r: pr.rz, K: Kz, curve: cv });
    }
    axes.forEach(a => { a.lam = a.K * L / a.r; });
    const govAx = axes.reduce((m, a) => a.lam > m.lam ? a : m, axes[0]);
    const lamLim = comp ? 200 : 300;
    const checks = [{ k: `Độ mảnh KL/r ≤ ${lamLim} (${govAx.ax})`, d: govAx.lam, c: lamLim, u: '', util: govAx.lam / lamLim, fmt: 0 }];
    const alpha = { a: 0.21, b: 0.34, c: 0.49 };
    let Ncap;
    if (comp) {
      if (code === 'EC3') {
        const eps = sq(235 / fy), lam1 = PI * sq(E / fy);
        let worst = null;
        axes.forEach(a => {
          const lb = a.lam / lam1;
          const ph = 0.5 * (1 + alpha[a.curve] * (lb - 0.2) + lb * lb);
          const chi = Math.min(1, 1 / (ph + sq(Math.max(0, ph * ph - lb * lb))));
          a.chi = chi; a.lb = lb;
          if (!worst || chi < worst.chi) worst = a;
        });
        Ncap = worst.chi * pr.A * fy / 1.0;
        checks.push({ k: `Ổn định nén Nb,Rd (χ = ${worst.chi.toFixed(3)}, ${worst.ax})`, d: p.N, c: kN(Ncap), u: 'kN', util: N / Ncap });
        formulas.push('λ̄ = (KL/r)/λ1, λ1 = π√(E/fy) = 93,9ε;  Φ = 0,5[1 + α(λ̄ − 0,2) + λ̄²];  χ = 1/(Φ + √(Φ² − λ̄²))');
        formulas.push('Nb,Rd = χ·A·fy/γM1, γM1 = 1,0. Đường cong: H cán (h/b > 1,2): a/b; (h/b ≤ 1,2): b/c; U: c; góc: b; ống cán nóng: a, nguội: c.');
        formulas.push('Tiêu chuẩn: EN 1993-1-1 mục 6.3.1 (chỉ oằn uốn).');
        // phân loại cục bộ
        const ce = (v, lim, name) => { if (v > lim) notes.push({ t: 'warn', s: `${name} = ${r1(v)} > ${r1(lim)}: tiết diện class 4 (mảnh cục bộ), cần tính tiết diện hiệu dụng — app chưa tính.` }); else notes.push({ t: 'ok', s: `${name} = ${r1(v)} ≤ ${r1(lim)}: không mảnh cục bộ.` }); };
        if (type === 'H') { ce((dims[1] - dims[2]) / 2 / dims[3], 14 * eps, 'Cánh c/tf'); ce((dims[0] - 2 * dims[3]) / dims[2], 42 * eps, 'Bụng c/tw'); }
        if (type === 'U') { ce((dims[1] - dims[2]) / dims[3], 14 * eps, 'Cánh c/tf'); ce((dims[0] - 2 * dims[3]) / dims[2], 42 * eps, 'Bụng c/tw'); }
        if (type === 'L') { ce(Math.max(dims[0], dims[1]) / dims[2], 15 * eps, 'Cạnh h/t'); ce((dims[0] + dims[1]) / (2 * dims[2]), 11.5 * eps, '(b + h)/2t'); }
        if (type === 'CHS') ce(dims[0] / dims[1], 90 * eps * eps, 'd/t');
        if (type === 'RHS') ce((Math.max(dims[0], dims[1]) - 3 * dims[2]) / dims[2], 42 * eps, 'Thành c/t');
      } else {
        let worst = null;
        axes.forEach(a => {
          const Fe = PI * PI * E / (a.lam * a.lam);
          a.Fcr = a.lam <= 4.71 * sq(E / fy) ? Math.pow(0.658, fy / Fe) * fy : 0.877 * Fe;
          if (!worst || a.Fcr < worst.Fcr) worst = a;
        });
        Ncap = 0.9 * worst.Fcr * pr.A;
        checks.push({ k: `Ổn định nén φPn (Fcr = ${r1(worst.Fcr)} MPa)`, d: p.N, c: kN(Ncap), u: 'kN', util: N / Ncap });
        formulas.push('Fe = π²E/(KL/r)²;  KL/r ≤ 4,71√(E/Fy): Fcr = 0,658^(Fy/Fe)·Fy; ngược lại Fcr = 0,877Fe');
        formulas.push('φPn = 0,9·Fcr·Ag. Tiêu chuẩn: AISC 360-16 mục E3 (chỉ oằn uốn).');
        const ce = (v, lim, name) => { if (v > lim) notes.push({ t: 'warn', s: `${name} = ${r1(v)} > ${r1(lim)}: phần tử mảnh (slender), cần giảm khả năng chịu lực — app chưa tính.` }); else notes.push({ t: 'ok', s: `${name} = ${r1(v)} ≤ ${r1(lim)}: không mảnh cục bộ.` }); };
        const s = sq(E / fy);
        if (type === 'H') { ce(dims[1] / 2 / dims[3], 0.56 * s, 'Cánh b/2tf'); ce((dims[0] - 2 * dims[3]) / dims[2], 1.49 * s, 'Bụng h/tw'); }
        if (type === 'U') { ce(dims[1] / dims[3], 0.56 * s, 'Cánh b/tf'); ce((dims[0] - 2 * dims[3]) / dims[2], 1.49 * s, 'Bụng h/tw'); }
        if (type === 'L') ce(Math.max(dims[0], dims[1]) / dims[2], 0.45 * s, 'Cạnh b/t');
        if (type === 'CHS') ce(dims[0] / dims[1], 0.11 * E / fy, 'D/t');
        if (type === 'RHS') ce((Math.max(dims[0], dims[1]) - 3 * dims[2]) / dims[2], 1.40 * s, 'Thành b/t');
        if (type === 'L') notes.push({ t: 'info', s: 'AISC có cách tính riêng cho thép góc đơn (mục E5, độ mảnh hiệu dụng). App tính theo r nhỏ nhất, thường thiên về an toàn với thanh giằng liên kết một cánh.' });
      }
      if (type === 'L' || type === 'U') notes.push({ t: 'info', s: 'Chưa xét oằn uốn-xoắn của tiết diện không đối xứng kép. Kết quả là sơ bộ.' });
      if (type === 'U') notes.push({ t: 'warn', s: 'Thép U cánh vát (JIS) có Iz thực nhỏ hơn giá trị tính từ kích thước khoảng 10–15%. Đối chiếu bảng nhà sản xuất khi trục yếu khống chế.' });
    } else {
      Ncap = pr.A * fy / (code === 'EC3' ? 1.0 : 1 / 0.9);
      checks.push({ k: 'Kéo chảy tiết diện nguyên', d: p.N, c: kN(Ncap), u: 'kN', util: N / Ncap });
      notes.push({ t: 'info', s: 'Thanh kéo: chưa trừ lỗ bulông. Dùng màn "Thanh / bản mã chịu kéo" để kiểm tiết diện thực.' });
    }
    if (type === 'L') notes.push({ t: 'warn', s: `Thép góc oằn quanh trục chính v-v (xiên 45°): rv = ${r1(pr.rv)} mm nhỏ hơn rx = ${r1(pr.ry)} mm. Dùng rx là tính thiếu an toàn.` });
    const rows = [
      { k: 'Tiết diện', v: C.sectionName(type, dims), u: '' },
      { k: 'A', v: Math.round(pr.A), u: 'mm²' },
      { k: 'Khối lượng', v: pr.mass.toFixed(1), u: 'kg/m' },
      ...axes.map(a => ({ k: `KL/r trục ${a.ax}`, v: `${Math.round(a.lam)} (r = ${r1(a.r)})`, u: '', strong: a === govAx })),
    ];
    formulas.push('Đặc trưng hình học tính từ kích thước danh định, bỏ qua bán kính lượn (sai số vài %).');
    return { rows, checks, notes, formulas, gov: summarize(checks), props: pr };
  };

  /* ================= NỘI LỰC DẦM ================= */
  C.beamCase = function (p) {
    const L = +p.L * 1000, w = +p.w, P = +p.P * 1000, a = +p.a * 1000;
    const E = +p.E, I = +p.I * 1e4; // I nhập cm⁴
    const EI = E * I;
    const c = p.case;
    let M = 0, Mneg = 0, V = 0, d = 0, txt = '';
    if (c === 'ss_w') { M = w * L * L / 8; V = w * L / 2; d = 5 * w * L ** 4 / (384 * EI); txt = 'M = wL²/8; V = wL/2; δ = 5wL⁴/384EI'; }
    if (c === 'ss_p') { const b = L - a; M = P * a * b / L; V = P * Math.max(a, b) / L; const bb = Math.min(a, b); d = P * bb * Math.pow(L * L - bb * bb, 1.5) / (9 * sq(3) * L * EI); txt = 'M = Pab/L; V = P·max(a,b)/L; δmax = Pb(L² − b²)^1,5/(9√3·L·EI)'; }
    if (c === 'cant_w') { Mneg = w * L * L / 2; V = w * L; d = w * L ** 4 / (8 * EI); txt = 'M = wL²/2 (ngàm); V = wL; δ = wL⁴/8EI'; }
    if (c === 'cant_p') { Mneg = P * L; V = P; d = P * L ** 3 / (3 * EI); txt = 'M = PL (ngàm); V = P; δ = PL³/3EI'; }
    if (c === 'ff_w') { Mneg = w * L * L / 12; M = w * L * L / 24; V = w * L / 2; d = w * L ** 4 / (384 * EI); txt = 'M gối = wL²/12; M nhịp = wL²/24; V = wL/2; δ = wL⁴/384EI'; }
    if (c === 'ff_p') { Mneg = P * L / 8; M = P * L / 8; V = P / 2; d = P * L ** 3 / (192 * EI); txt = 'M gối = M nhịp = PL/8; V = P/2; δ = PL³/192EI (P ở giữa)'; }
    if (c === 'pc_w') { Mneg = w * L * L / 8; M = 9 * w * L * L / 128; V = 5 * w * L / 8; d = w * L ** 4 / (185 * EI); txt = 'M ngàm = wL²/8; M nhịp = 9wL²/128; V = 5wL/8; δ ≈ wL⁴/185EI'; }
    const rows = [];
    if (M) rows.push({ k: 'Moment dương lớn nhất', v: (M / 1e6).toFixed(2), u: 'kNm', strong: true });
    if (Mneg) rows.push({ k: 'Moment âm (tại ngàm)', v: (-Mneg / 1e6).toFixed(2), u: 'kNm', strong: true });
    rows.push({ k: 'Lực cắt lớn nhất', v: (V / 1000).toFixed(2), u: 'kN', strong: true });
    if (EI > 0) { rows.push({ k: 'Độ võng lớn nhất', v: d.toFixed(1), u: 'mm', strong: true }); rows.push({ k: 'Tỷ số L/δ', v: d > 0 ? `L/${Math.round((c.startsWith('cant') ? L : L) / d)}` : '—', u: '' }); }
    return { rows, checks: [], notes: [], formulas: [txt, 'w nhập kN/m (= N/mm), P kN, L m, I cm⁴, E MPa.'], gov: null, draw: { c, a: a / L } };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = C; else root.CALC = C;
})(this);
