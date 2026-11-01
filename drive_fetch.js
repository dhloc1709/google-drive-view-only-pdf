/* ---------------------------------------------------------------------------
 * drive_fetch.js — tải toàn bộ trang của tài liệu Google Drive ở chế độ chỉ xem.
 *
 * Dùng: mở tài liệu dạng /preview → F12 → Console → chọn đúng frame của viewer
 * (xem README, Bước 1) → dán toàn bộ file này → sửa `total` → chạy:
 *
 *     await __dl.go()
 *
 * Một lệnh duy nhất: tải song song, tự thử lại các trang lỗi (giảm tốc độ dần),
 * rồi đóng gói ZIP và tải về. Nếu vẫn còn trang thiếu sau các vòng thử lại,
 * script dừng và không lưu ZIP hỏng.
 *
 * Tuỳ chọn: await __dl.go({ total: 630, conc: 8, rounds: 4, quality: [1600, false] })
 * Ảnh chỉ nằm trong RAM của tab, không upload đi đâu.
 * ------------------------------------------------------------------------- */
(() => {
  const cap = (window.__dl = {
    total: 630,   // số trang của tài liệu — sửa cho từng file
    conc: 6,      // số request song song — đừng vượt 12
    list: [],     // list[i] = trang thứ i+1; undefined = chưa tải được
    fail: [],     // số trang lỗi ở lần tải gần nhất
    base: null,   // phần URL đứng trước số trang
    suffix: '',   // phần URL đứng sau số trang
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const url = (i) => cap.base + i + cap.suffix;
  const extOf = (type) => (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const have = () => cap.list.filter(Boolean).length;

  // --- 1. Tìm URL mẫu trong các request mà viewer đã phát ra ----------------
  function resolveBase() {
    for (const entry of performance.getEntriesByType('resource')) {
      const m = entry.name.match(
        /^(https:\/\/drive\.google\.com\/viewer\/img\?.*[?&]page=)(\d+)(&.*)?$/
      );
      if (m) {
        cap.base = m[1];
        cap.suffix = m[3] || '';
        return true;
      }
    }
    return false;
  }

  // --- 2. Tiện ích ----------------------------------------------------------
  cap.missing = () => {
    const out = [];
    for (let i = 0; i < cap.total; i += 1) if (!cap.list[i]) out.push(i + 1);
    return out;
  };

  cap.status = () => {
    console.log(
      `[__dl] ${have()}/${cap.total} trang | thieu ${cap.missing().length} | ` +
      `conc ${cap.conc} | suffix ${cap.suffix}`
    );
  };

  async function fetchPage(i) {
    const r = await fetch(url(i), { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = await r.blob();
    if (!b.size) throw new Error('blob rong');
    return { index: i + 1, blob: b, type: b.type, size: b.size };
  }

  async function pool(count, limit, fn) {
    let next = 0;
    const workers = Array.from(
      { length: Math.max(1, Math.min(limit, count)) },
      async () => {
        for (;;) {
          const k = next++;
          if (k >= count) return;
          await fn(k);
        }
      }
    );
    await Promise.all(workers);
  }

  // Tải một danh sách chỉ số trang, có in tiến độ. Trả về số giây đã dùng.
  async function downloadIndices(indices) {
    const t0 = performance.now();
    let done = 0;
    await pool(indices.length, cap.conc, async (k) => {
      const i = indices[k];
      try {
        cap.list[i] = await fetchPage(i);
      } catch (err) {
        cap.fail.push(i + 1);
      }
      done += 1;
      if (done % 50 === 0 || done === indices.length) {
        const s = (performance.now() - t0) / 1000;
        console.log(
          `[__dl] ${done}/${indices.length} | ${s.toFixed(1)}s | ` +
          `${(done / s).toFixed(1)} trang/s`
        );
      }
    });
    return (performance.now() - t0) / 1000;
  }

  // --- 3. Kiểm tra nhanh ----------------------------------------------------
  cap.test = async (n = 3) => {
    for (let i = 0; i < Math.min(n, cap.total); i += 1) {
      try {
        const r = await fetch(url(i), { credentials: 'include' });
        const b = await r.blob();
        console.log(
          `[__dl] page=${i} | HTTP ${r.status} | ${b.type || '(rong)'} | ` +
          `${(b.size / 1024).toFixed(0)} KB`
        );
      } catch (err) {
        console.log(`[__dl] page=${i} | loi: ${err.message}`);
      }
    }
  };

  // --- 4. Đổi độ phân giải --------------------------------------------------
  cap.setQuality = (w, webp) => {
    cap.suffix = cap.suffix
      .replace(/\bw=\d+/, `w=${w}`)
      .replace(/webp=(true|false)/, `webp=${webp}`);
    console.log('[__dl] suffix moi:', cap.suffix);
  };

  // --- 5. Tải toàn bộ (không thử lại) ---------------------------------------
  cap.run = async (from = 0, to = cap.total) => {
    const indices = [];
    for (let i = from; i < Math.min(to, cap.total); i += 1) indices.push(i);
    cap.fail = [];
    const s = await downloadIndices(indices);
    console.log(`[__dl] XONG ${have()}/${cap.total} | ${s.toFixed(1)}s | loi: ${cap.fail.length}`);
    if (cap.fail.length && cap.fail.length <= 40) {
      console.log('[__dl] trang loi:', cap.fail.join(', '));
    }
  };

  // --- 6. Thử lại các trang còn thiếu với tốc độ thấp hơn -------------------
  cap.retry = async (conc = 2) => {
    const bad = cap.missing();
    if (!bad.length) {
      console.log('[__dl] Khong con trang nao thieu.');
      return 0;
    }
    const saved = cap.conc;
    cap.conc = Math.max(1, Math.min(conc, saved));
    cap.fail = [];
    try {
      await downloadIndices(bad.map((p) => p - 1));
    } finally {
      cap.conc = saved;
    }
    const left = cap.missing().length;
    console.log(`[__dl] Thu lai ${bad.length} trang | con thieu ${left}`);
    return left;
  };

  // --- 7. Một lệnh làm hết: tải → thử lại → lưu -----------------------------
  cap.go = async (opts = {}) => {
    const o = { total: 0, conc: 0, rounds: 3, save: true, quality: null, ...opts };
    if (o.total) cap.total = o.total;
    if (o.conc) cap.conc = o.conc;
    if (o.quality) cap.setQuality(o.quality[0], o.quality[1]);

    if (!cap.base && !resolveBase()) {
      console.warn('[__dl] Chua thay URL /viewer/img. Cuon 1-2 trang trong viewer roi chay lai.');
      return { ok: false, reason: 'no-url' };
    }

    const t0 = performance.now();
    console.log(
      `[__dl] Bat dau: ${cap.total} trang | conc ${cap.conc} | ` +
      `toi da ${o.rounds} vong thu lai`
    );

    cap.fail = [];
    const todo = [];
    for (let i = 0; i < cap.total; i += 1) if (!cap.list[i]) todo.push(i);
    if (todo.length) await downloadIndices(todo);

    let round = 0;
    while (cap.missing().length && round < o.rounds) {
      round += 1;
      const wait = Math.min(3000 * 2 ** (round - 1), 15000);
      console.log(
        `[__dl] Vong ${round}/${o.rounds}: thieu ${cap.missing().length} trang, ` +
        `doi ${Math.round(wait / 1000)}s roi thu lai`
      );
      await sleep(wait);
      if (!(await cap.retry(2))) break;
    }

    const missing = cap.missing();
    const seconds = +((performance.now() - t0) / 1000).toFixed(1);

    if (missing.length) {
      console.warn(
        `[__dl] DUNG sau ${seconds}s: con thieu ${missing.length} trang, chua luu ZIP. ` +
        'Chay lai await __dl.go() de thu tiep (chi tai trang con thieu).'
      );
      if (missing.length <= 40) console.warn('[__dl] trang thieu:', missing.join(', '));
      const tail = missing[missing.length - 1] === cap.total &&
        missing.every((p, k) => k === 0 || p === missing[k - 1] + 1);
      if (tail) {
        console.warn('[__dl] Cac trang thieu nam lien nhau o cuoi: co the `total` dang lon hon so trang thuc te.');
      }
      return { ok: false, reason: 'missing', missing, seconds };
    }

    if (o.save) await cap.save();
    console.log(`[__dl] HOAN TAT ${cap.total}/${cap.total} | ${seconds}s`);
    return { ok: true, pages: cap.total, seconds };
  };

  // --- 8. Đóng gói ZIP ngay trong trình duyệt -------------------------------
  function crc32(u8) {
    let c = -1;
    for (let i = 0; i < u8.length; i += 1) {
      c ^= u8[i];
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ -1) >>> 0;
  }

  async function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;

    const d = new Date();
    const t = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const name = enc.encode(f.name);
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);   // tên file UTF-8
      lh.setUint16(10, t, true);
      lh.setUint16(12, dt, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(12, t, true);
      cd.setUint16(14, dt, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);

      offset += 30 + name.length + data.length;
    }

    let cdSize = 0;
    for (const c of central) cdSize += c.length;

    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }

  // --- 9. Lưu ---------------------------------------------------------------
  cap.save = async (limit = Infinity) => {
    const items = cap.list.filter(Boolean).slice(0, limit);
    if (!items.length) {
      console.warn('[__dl] Chua co trang nao.');
      return;
    }

    const missing = cap.missing().length;
    if (missing) {
      console.warn(`[__dl] CANH BAO: con thieu ${missing} trang, ZIP se khong day du.`);
    }

    const files = items.map((it) => ({
      name: `trang_${String(it.index).padStart(3, '0')}.${extOf(it.type)}`,
      blob: it.blob,
    }));

    const zip = await makeZip(files);
    const a = document.createElement('a');
    const objUrl = URL.createObjectURL(zip);
    a.href = objUrl;
    a.download = `sach_${items[0].index}-${items[items.length - 1].index}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 60000);

    console.log(
      `[__dl] Da luu ${a.download} | ${(zip.size / 1048576).toFixed(1)} MB | ${files.length} trang`
    );
  };

  if (!resolveBase()) {
    console.warn('[__dl] Chua thay URL /viewer/img. Cuon 1-2 trang roi chay: await __dl.go()');
  } else {
    console.log(`[__dl] San sang: ${cap.total} trang, conc ${cap.conc}. Chay: await __dl.go()`);
  }
})();
