/* Đổi tọa độ VN-2000 (phẳng TM) <-> WGS-84 (độ).
   - Elipxoit VN-2000 trùng WGS-84 (a = 6378137, f = 1/298,257223563).
   - Phép chiếu ngang (TM) theo chuỗi Krüger bậc 4, sai số dưới 1 mm trong múi.
   - Tính chuyển 7 tham số theo QĐ 05/2007/QĐ-BTNMT (EPSG 6960, quy ước coordinate frame).
   Độ chính xác của bộ 7 tham số cỡ 1 m: đủ để định vị sơ bộ. */
(function (root) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const RAD = Math.PI / 180, ASEC = RAD / 3600;
  const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64);
  const al = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180, 13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440, 61 * n3 / 240 - 103 * n4 / 140, 49561 * n4 / 161280];
  const be = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360, n2 / 48 + n3 / 15 - 437 * n4 / 1440, 17 * n3 / 480 - 37 * n4 / 840, 4397 * n4 / 161280];
  const de = [2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45, 7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45, 56 * n3 / 15 - 136 * n4 / 35, 4279 * n4 / 630];
  const c2 = 2 * Math.sqrt(n) / (1 + n);

  // (vĩ độ, kinh độ) độ -> {N, E} mét
  function tmFwd(lat, lon, lon0, k0, E0 = 500000, N0 = 0) {
    const p = lat * RAD, l = (lon - lon0) * RAD, s = Math.sin(p);
    const t = Math.sinh(Math.atanh(s) - c2 * Math.atanh(c2 * s));
    const xi = Math.atan2(t, Math.cos(l)), eta = Math.atanh(Math.sin(l) / Math.sqrt(1 + t * t));
    let x = xi, y = eta;
    for (let j = 1; j <= 4; j++) { x += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); y += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
    return { N: N0 + k0 * A * x, E: E0 + k0 * A * y };
  }
  // {N, E} mét -> (vĩ độ, kinh độ) độ
  function tmInv(N, E, lon0, k0, E0 = 500000, N0 = 0) {
    const xi = (N - N0) / (k0 * A), eta = (E - E0) / (k0 * A);
    let x = xi, y = eta;
    for (let j = 1; j <= 4; j++) { x -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); y -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
    const chi = Math.asin(Math.sin(x) / Math.cosh(y));
    let p = chi;
    for (let j = 1; j <= 4; j++) p += de[j - 1] * Math.sin(2 * j * chi);
    return { lat: p / RAD, lon: lon0 + Math.atan2(Math.sinh(y), Math.cos(x)) / RAD };
  }

  function toXYZ(lat, lon, h = 0) {
    const p = lat * RAD, l = lon * RAD, N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
    return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
  }
  function fromXYZ([X, Y, Z]) {
    const pr = Math.hypot(X, Y); let p = Math.atan2(Z, pr * (1 - e2)), h = 0;
    for (let i = 0; i < 8; i++) { const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2); h = pr / Math.cos(p) - N; p = Math.atan2(Z, pr * (1 - e2 * N / (N + h))); }
    return { lat: p / RAD, lon: Math.atan2(Y, X) / RAD, h };
  }
  // VN-2000 -> WGS-84 (QĐ 05/2007/QĐ-BTNMT; EPSG 6960)
  const P7 = { tx: -191.90441429, ty: -39.30318279, tz: -111.45032835, rx: -0.00928836, ry: 0.01975479, rz: -0.00427372, s: 0.252906278 };
  function helmert([X, Y, Z], sg) {
    const tx = sg * P7.tx, ty = sg * P7.ty, tz = sg * P7.tz, rx = sg * P7.rx * ASEC, ry = sg * P7.ry * ASEC, rz = sg * P7.rz * ASEC, m = 1 + sg * P7.s * 1e-6;
    // quy ước coordinate frame
    return [tx + m * (X + rz * Y - ry * Z), ty + m * (-rz * X + Y + rx * Z), tz + m * (ry * X - rx * Y + Z)];
  }
  function vnToWgs(lat, lon) { const r = fromXYZ(helmert(toXYZ(lat, lon), 1)); return { lat: r.lat, lon: r.lon }; }
  function wgsToVn(lat, lon) {
    // lặp ngược để khớp chính xác chiều đi
    let g = fromXYZ(helmert(toXYZ(lat, lon), -1));
    for (let i = 0; i < 3; i++) { const b = vnToWgs(g.lat, g.lon); g = { lat: g.lat + lat - b.lat, lon: g.lon + lon - b.lon }; }
    return g;
  }

  // Kinh tuyến trục múi 3° theo Thông tư 973/2001/TT-TCĐC (tỉnh cũ, trước sáp nhập 2025)
  const PROV = [
    ['An Giang', 104.75], ['Bà Rịa – Vũng Tàu', 107.75], ['Bạc Liêu', 105], ['Bắc Giang', 107], ['Bắc Kạn', 106.5], ['Bắc Ninh', 105.5],
    ['Bến Tre', 105.75], ['Bình Định', 108.25], ['Bình Dương', 105.75], ['Bình Phước', 106.25], ['Bình Thuận', 108.5], ['Cà Mau', 104.5],
    ['Cần Thơ', 105], ['Cao Bằng', 105.75], ['Đà Nẵng', 107.75], ['Đắk Lắk', 108.5], ['Đắk Nông', 108.5], ['Điện Biên', 103],
    ['Đồng Nai', 107.75], ['Đồng Tháp', 105], ['Gia Lai', 108.5], ['Hà Giang', 105.5], ['Hà Nam', 105], ['Hà Nội', 105],
    ['Hà Tĩnh', 105.5], ['Hải Dương', 105.5], ['Hải Phòng', 105.75], ['Hậu Giang', 105], ['Hòa Bình', 106], ['TP. Hồ Chí Minh', 105.75],
    ['Hưng Yên', 105.5], ['Khánh Hòa', 108.25], ['Kiên Giang', 104.5], ['Kon Tum', 107.5], ['Lai Châu', 103], ['Lâm Đồng', 107.75],
    ['Lạng Sơn', 107.25], ['Lào Cai', 104.75], ['Long An', 105.75], ['Nam Định', 105.5], ['Nghệ An', 104.75], ['Ninh Bình', 105],
    ['Ninh Thuận', 108.25], ['Phú Thọ', 104.75], ['Phú Yên', 108.5], ['Quảng Bình', 106], ['Quảng Nam', 107.75], ['Quảng Ngãi', 108],
    ['Quảng Ninh', 107.75], ['Quảng Trị', 106.25], ['Sóc Trăng', 105.5], ['Sơn La', 104], ['Tây Ninh', 105.5], ['Thái Bình', 105.5],
    ['Thái Nguyên', 106.5], ['Thanh Hóa', 105], ['Thừa Thiên Huế', 107], ['Tiền Giang', 105.75], ['Trà Vinh', 105.5], ['Tuyên Quang', 106],
    ['Vĩnh Long', 105.5], ['Vĩnh Phúc', 105], ['Yên Bái', 104.75],
  ];
  const ZONE6 = [['Múi 48 – KTT 105°', 105], ['Múi 49 – KTT 111°', 111], ['Múi 50 – KTT 117°', 117]];

  // Đọc góc: 10.7623 | 10°45'30.5" | 10 45 30.5 | 10d45m30.5s ; có N/S/E/W hoặc dấu âm
  function parseAngle(s) {
    if (s == null) return NaN;
    s = String(s).trim().toUpperCase();
    if (!s) return NaN;
    let sg = 1;
    if (/[SW]/.test(s) || /^-/.test(s)) sg = -1;
    const nums = s.replace(/^-/, '').replace(/[NSEW]/g, ' ').replace(/(\d),(\d)/g, '$1.$2').match(/\d+(\.\d+)?/g);
    if (!nums) return NaN;
    const [d, m = 0, sec = 0] = nums.map(Number);
    if (nums.length > 1 && (m >= 60 || sec >= 60)) return NaN;
    return sg * (d + m / 60 + sec / 3600);
  }
  function dms(x, pos, neg) {
    const sg = x < 0 ? neg : pos; x = Math.abs(x);
    let d = Math.floor(x), m = Math.floor((x - d) * 60), s = ((x - d) * 60 - m) * 60;
    if (s >= 59.9995) { s = 0; m++; } if (m >= 60) { m = 0; d++; }
    return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(3).padStart(6, '0').replace('.', ',')}″ ${sg}`;
  }
  function utmZone(lon) { return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1)); }
  function wgsUtm(lat, lon) { const z = utmZone(lon), r = tmFwd(lat, lon, z * 6 - 183, 0.9996, 500000, lat < 0 ? 1e7 : 0); return { zone: z + (lat < 0 ? 'S' : 'N'), E: r.E, N: r.N }; }

  // API chính. proj = {lon0, k0}
  function vn2wgs(X, Y, proj) { const g = tmInv(X, Y, proj.lon0, proj.k0); const w = vnToWgs(g.lat, g.lon); return { lat: w.lat, lon: w.lon, utm: wgsUtm(w.lat, w.lon) }; }
  function wgs2vn(lat, lon, proj) { const g = wgsToVn(lat, lon); const r = tmFwd(g.lat, g.lon, proj.lon0, proj.k0); return { X: r.N, Y: r.E, utm: wgsUtm(lat, lon) }; }

  const GEO = { vn2wgs, wgs2vn, tmFwd, tmInv, vnToWgs, wgsToVn, parseAngle, dms, PROV, ZONE6, P7 };
  if (typeof module !== 'undefined' && module.exports) module.exports = GEO; else root.GEO = GEO;
})(this);
