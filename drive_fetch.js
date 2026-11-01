/* ---------------------------------------------------------------------------
 * drive_fetch.js — download a view-only Google Drive document as a ZIP.
 *
 * Paste and it runs: open the document at /preview, F12, Console, pick the
 * viewer frame (see README, Step 1), paste this whole file, press Enter.
 *
 * The script detects the page count, downloads pages in parallel, retries the
 * failed ones (longer waits, fewer parallel requests), then builds a ZIP and
 * triggers the download. Nothing else to type.
 *
 * Manual control lives on __dl:
 *     await __dl.go({ total: 630, conc: 8, rounds: 4, quality: [1600, false] })
 *     __dl.status()                  // pages collected / pages missing
 *     await __dl.diag()              // print the sampled URL and fetch 2 pages
 *     window.__dlAutorun = false     // paste first to load without running
 *
 * Images stay in the tab's RAM; nothing is uploaded anywhere.
 * ------------------------------------------------------------------------- */
(() => {
  const cap = (window.__dl = {
    total: 0,     // 0 = detect the page count; set a number to skip detection
    conc: 6,      // parallel requests — keep it at 12 or below
    list: [],     // list[i] = page i+1; undefined = not fetched yet
    fail: [],     // page numbers that failed in the last pass
    base: null,   // URL prefix before the page number
    suffix: '',   // URL suffix after the page number
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const url = (i) => cap.base + i + cap.suffix;

  // Every request has a timeout, so one stalled fetch cannot block the run.
  function fetchOpts(ms) {
    const o = { credentials: 'include' };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      o.signal = AbortSignal.timeout(ms);
    }
    return o;
  }
  const extOf = (type) => (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const have = () => cap.list.filter(Boolean).length;

  // --- 1. Find the sample URL among the requests the viewer already made -----
  function resolveBase() {
    for (const entry of performance.getEntriesByType('resource')) {
      const m = entry.name.match(
        /^(https:\/\/(?:drive|docs)\.google\.com\/(?:viewer|viewerng)\/img\?.*[?&]page=)(\d+)(&.*)?$/
      );
      if (m) {
        cap.base = m[1];
        cap.suffix = m[3] || '';
        return true;
      }
    }
    return false;
  }

  // --- 2. Helpers ------------------------------------------------------------
  cap.missing = () => {
    const out = [];
    for (let i = 0; i < cap.total; i += 1) if (!cap.list[i]) out.push(i + 1);
    return out;
  };

  cap.status = () => {
    console.log(
      `[__dl] ${have()}/${cap.total} pages | missing ${cap.missing().length} | ` +
      `conc ${cap.conc} | suffix ${cap.suffix}`
    );
  };

  async function fetchPage(i) {
    const r = await fetch(url(i), fetchOpts(60000));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = await r.blob();
    if (!b.size) throw new Error('empty blob');
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

  // Fetch a list of page indices with progress output. Returns elapsed seconds.
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
          `${(done / s).toFixed(1)} pages/s`
        );
      }
    });
    return (performance.now() - t0) / 1000;
  }

  // --- 3. Quick check --------------------------------------------------------
  cap.test = async (n = 3) => {
    const to = Math.min(n, cap.total || n);
    for (let i = 0; i < to; i += 1) {
      try {
        const r = await fetch(url(i), fetchOpts(20000));
        const b = await r.blob();
        console.log(
          `[__dl] page=${i} | HTTP ${r.status} | ${b.type || '(empty)'} | ` +
          `${(b.size / 1024).toFixed(0)} KB`
        );
      } catch (err) {
        console.log(`[__dl] page=${i} | error: ${err.message}`);
      }
    }
  };

  // --- 4. Change the resolution ----------------------------------------------
  cap.setQuality = (w, webp) => {
    cap.suffix = cap.suffix
      .replace(/\bw=\d+/, `w=${w}`)
      .replace(/webp=(true|false)/, `webp=${webp}`);
    console.log('[__dl] new suffix:', cap.suffix);
  };

  // --- 5. Download everything (no retries) -----------------------------------
  cap.run = async (from = 0, to = cap.total) => {
    const indices = [];
    for (let i = from; i < Math.min(to, cap.total); i += 1) indices.push(i);
    cap.fail = [];
    const s = await downloadIndices(indices);
    console.log(`[__dl] DONE ${have()}/${cap.total} | ${s.toFixed(1)}s | errors: ${cap.fail.length}`);
    if (cap.fail.length && cap.fail.length <= 40) {
      console.log('[__dl] failed pages:', cap.fail.join(', '));
    }
  };

  // --- 6. Retry the missing pages at a lower rate ----------------------------
  cap.retry = async (conc = 2) => {
    const bad = cap.missing();
    if (!bad.length) {
      console.log('[__dl] No missing pages.');
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
    console.log(`[__dl] Retrying ${bad.length} pages | still missing ${left}`);
    return left;
  };

  // --- 7. Detect the page count by probing the endpoint ----------------------
  // true = page i exists (and is stored in the list), false = past the last page.
  // 429/5xx/network errors = inconclusive: throw so detection stops instead of truncating.
  async function probePage(i, tries = 2) {
    let status = 0;
    for (let t = 0; t < tries; t += 1) {
      try {
        const r = await fetch(url(i), fetchOpts(20000));
        if (r.status === 401 || r.status === 403) {
          const err = new Error(`HTTP ${r.status}`);
          err.fatal = true;
          throw err;
        }
        if (r.ok) {
          const b = await r.blob();
          if (b.size) {
            cap.list[i] = { index: i + 1, blob: b, type: b.type, size: b.size };
            console.log(`[__dl] ... page ${i}: ok (${(b.size / 1024).toFixed(0)} KB)`);
            return true;
          }
          status = 'empty';
        } else if (r.status === 429 || r.status >= 500) {
          status = r.status;
        } else {
          console.log(`[__dl] ... page ${i}: end of document (HTTP ${r.status})`);
          return false;   // 400/404/410...: past the last page
        }
      } catch (err) {
        if (err.fatal) throw err;
        status = err.name === 'TimeoutError' ? 'timeout' : err.message;
      }
      console.log(`[__dl] ... page ${i}: failed (${status})`);
      if (t + 1 < tries) await sleep(800);
    }
    const err = new Error(`could not probe page ${i} (${status})`);
    err.fatal = true;
    throw err;
  }

  cap.detectTotal = async (limit = 20000) => {
    console.log('[__dl] Detecting page count...');
    console.log('[__dl] base:', cap.base);
    try {
      let lo = -1;
      let hi = 1;
      while (hi < limit && (await probePage(hi))) {
        lo = hi;
        hi *= 2;
      }
      if (hi >= limit) {
        console.warn('[__dl] Could not find the last page (document too large?).');
        return 0;
      }
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (await probePage(mid)) lo = mid;
        else hi = mid;
      }
      if (hi <= 0) {
        console.warn('[__dl] The first page could not be loaded.');
        return 0;
      }
      console.log(`[__dl] Detected ${hi} pages.`);
      return hi;
    } catch (err) {
      console.log(`[__dl] Page count detection failed: ${err.message}`);
      return 0;
    }
  };

  // --- 8. One-shot: detect pages -> download -> retry -> save -----------------
  cap.go = async (opts = {}) => {
    const o = { total: 0, conc: 0, rounds: 3, save: true, quality: null, ...opts };
    if (o.total) cap.total = o.total;
    if (o.conc) cap.conc = o.conc;
    if (o.quality) cap.setQuality(o.quality[0], o.quality[1]);

    if (!cap.base && !resolveBase()) {
      console.warn('[__dl] No /viewer/img URL yet. Scroll 1-2 pages in the viewer and run again.');
      return { ok: false, reason: 'no-url' };
    }

    if (!cap.total) {
      cap.total = await cap.detectTotal();
      if (!cap.total) {
        console.log(
          '[__dl] Could not detect the page count. Scroll to the last page to read it, ' +
          'then run: await __dl.go({ total: 630 })'
        );
        return { ok: false, reason: 'no-total' };
      }
    }

    const t0 = performance.now();
    console.log(
      `[__dl] Starting: ${cap.total} pages | conc ${cap.conc} | ` +
      `up to ${o.rounds} retry rounds`
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
        `[__dl] Round ${round}/${o.rounds}: ${cap.missing().length} pages missing, ` +
        `waiting ${Math.round(wait / 1000)}s before retry`
      );
      await sleep(wait);
      if (!(await cap.retry(2))) break;
    }

    const missing = cap.missing();
    const seconds = +((performance.now() - t0) / 1000).toFixed(1);

    if (missing.length) {
      console.warn(
        `[__dl] STOPPED after ${seconds}s: ${missing.length} pages missing, ZIP not saved. ` +
        'Run await __dl.go() again to retry (missing pages only).'
      );
      if (missing.length <= 40) console.warn('[__dl] missing pages:', missing.join(', '));
      const tail = missing[missing.length - 1] === cap.total &&
        missing.every((p, k) => k === 0 || p === missing[k - 1] + 1);
      if (tail) {
        console.warn('[__dl] Missing pages form a contiguous tail: `total` may be larger than the real page count.');
      }
      return { ok: false, reason: 'missing', missing, seconds };
    }

    if (o.save) await cap.save();
    console.log(`[__dl] COMPLETE ${cap.total}/${cap.total} | ${seconds}s`);
    return { ok: true, pages: cap.total, seconds };
  };

  // --- 9. Build the ZIP inside the browser -----------------------------------
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
      lh.setUint16(6, 0x0800, true);   // UTF-8 file name
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

  // --- 10. Save --------------------------------------------------------------
  cap.save = async (limit = Infinity) => {
    const items = cap.list.filter(Boolean).slice(0, limit);
    if (!items.length) {
      console.warn('[__dl] No pages collected yet.');
      return;
    }

    const missing = cap.missing().length;
    if (missing) {
      console.warn(`[__dl] WARNING: ${missing} pages missing, the ZIP will be incomplete.`);
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
      `[__dl] Saved ${a.download} | ${(zip.size / 1048576).toFixed(1)} MB | ${files.length} pages`
    );
  };

  // --- 11. Diagnostics -------------------------------------------------------
  cap.diag = async () => {
    if (!cap.base) resolveBase();
    const entries = performance.getEntriesByType('resource')
      .filter((e) => e.name.includes('/viewer/img') || e.name.includes('/viewerng/img'));
    console.log('[__dl] /viewer/img resource entries in this frame:', entries.length);
    console.log('[__dl] base:', cap.base);
    console.log('[__dl] suffix:', cap.suffix);
    if (!cap.base) return;
    for (const p of [0, 1]) {
      try {
        const r = await fetch(url(p), fetchOpts(20000));
        const b = await r.blob();
        console.log(`[__dl] page=${p} | HTTP ${r.status} | ${b.type || '(empty)'} | ${b.size} bytes`);
      } catch (err) {
        console.log(`[__dl] page=${p} | ERROR ${err.name}: ${err.message}`);
      }
    }
  };

  // --- 12. Autorun -----------------------------------------------------------
  if (!resolveBase()) {
    console.log('[__dl] No /viewer/img request in this frame. Select the viewer frame and paste again.');
    return;
  }
  if (window.__dlAutorun === false) {
    console.log('[__dl] Ready (autorun disabled). Run: await __dl.go()');
    return;
  }

  cap.promise = cap.go().catch((err) => {
    console.error('[__dl] Error:', err);
    return { ok: false, reason: 'error', error: String(err) };
  });
})();
