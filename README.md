# Tải tài liệu Google Drive "chỉ xem" thành PDF

Công cụ cá nhân gồm hai phần:

1. **`drive_fetch.js`** — đoạn JavaScript dán vào DevTools Console. Một lần dán là chạy: tự dò số trang, tải toàn bộ các trang của tài liệu Drive, tự thử lại chỗ lỗi rồi đóng gói ZIP ngay trong trình duyệt.
2. **`build_pdf.py`** — script Python ghép các ảnh trang đó thành một file PDF duy nhất, giữ nguyên chất lượng ảnh gốc.

> ⚠️ **Chỉ dùng cho tài liệu bạn được chia sẻ quyền xem.** Chế độ "chỉ xem" là thiết lập có chủ ý của người chia sẻ. Bản tải về chỉ nên để đọc cá nhân — không phát tán lại, không đăng lại, không dùng cho mục đích thương mại.

Đã chạy thử với một cuốn 630 trang (800 × 1035 px/trang): tải khoảng **44 giây**, ZIP khoảng **40 MB**, PDF thành phẩm **42,6 MB**, khổ 600 × 776 pt.

---

## Cách hoạt động

Viewer của Drive không trả file gốc. Nó render từng trang rồi tải ảnh qua một endpoint:

```
https://drive.google.com/viewer/img?id=<token>&...&page=<N>&skiphighlight=true&w=800&webp=true
```

`id` và `fssid` giữ nguyên cho mọi trang, chỉ `page` thay đổi, bắt đầu từ `0`. Nghĩa là không cần cuộn, không cần chờ viewer render — có thể gọi song song toàn bộ N trang.

`drive_fetch.js` tự chạy ngay khi dán và làm năm việc:

- lấy URL mẫu từ `performance.getEntriesByType('resource')` — nhờ vậy không phải tự bắt request bằng tay;
- dò số trang bằng cách thăm dò endpoint, nên không cần biết trước tài liệu dài bao nhiêu (các trang dò được giữ lại, không tải lại);
- tải song song với một pool giới hạn (`conc`, mặc định 6);
- tự thử lại các trang lỗi theo nhiều vòng, mỗi vòng chờ lâu hơn và giảm số request song song;
- đóng gói kết quả thành ZIP bằng `Blob` + tự viết header ZIP, không cần thư viện ngoài và không upload gì lên mạng.

Toàn bộ chạy trong RAM của tab. Nếu sau các vòng thử lại vẫn còn trang thiếu, script dừng và **không lưu ZIP** — thà không có file còn hơn có file PDF thiếu trang mà không biết.

`build_pdf.py` ghép ảnh thành PDF. Điểm đáng chú ý: phần lớn trang là **PNG 8-bit không alpha**, và luồng nén bên trong PNG trùng đúng định dạng mà bộ lọc `Predictor 15` của PDF mong đợi. Vì vậy script nhúng **nguyên xi** luồng nén vào PDF (`/FlateDecode` + `/DecodeParms`), không giải mã rồi nén lại — không mất một điểm ảnh nào và gần như không tốn CPU. Chỉ trang WEBP/JPEG mới phải giải mã và mã hoá lại thành JPEG (tự chọn grayscale nếu ảnh gần như không có màu).

---

## Yêu cầu

- Chrome trên máy tính, có DevTools (F12).
- Tài khoản đã được chia sẻ quyền xem tài liệu đó.
- Python 3.8+ với `Pillow` và `numpy` — chỉ cần cho bước ghép PDF.

---

## Cài đặt

```bash
git clone https://github.com/dhloc1709/pdf-on-drive-downloader.git
cd pdf-on-drive-downloader
python -m pip install pillow numpy
```

Bước tải ảnh không cần cài gì thêm: mọi thứ chạy trong Chrome.

---

## Sử dụng

### Bước 1 — mở đúng frame của viewer

Mở tài liệu ở dạng `/preview`, ví dụ:

```
https://drive.google.com/file/d/<id>/preview
```

Bấm F12, sang tab **Console**. Dropdown chọn context ở góc trên bên trái đang ghi `top`; chọn lần lượt từng frame và chạy:

```js
({
  url: location.href.slice(0, 60),
  anh: document.querySelectorAll('img[src^="blob:"]').length,
  req: performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('/viewer/img')).length,
})
```

Frame nào có `req` (hoặc `anh`) lớn hơn `0` là frame của viewer — ở lại frame đó.

### Bước 2 — dán script, thế là xong

Có hai bản, nội dung y hệt nhau:

| Bản | Dùng khi nào |
|---|---|
| [`drive_fetch.min.js`](drive_fetch.min.js) | một dòng, 8 KB — bản đưa cho đồng nghiệp dán |
| [`drive_fetch.js`](drive_fetch.js) | 446 dòng, có chú thích — bản để đọc và sửa |

Copy toàn bộ một trong hai, dán vào Console, Enter. **Không phải gõ thêm lệnh nào** — script tự:

1. dò số trang (khoảng 10–20 request thăm dò, không tải ảnh thừa),
2. tải song song toàn bộ trang,
3. tự thử lại các trang lỗi (3 vòng, chờ 3s → 6s → 12s, giảm dần số request song song),
4. đóng gói ZIP và tải về máy.

Kỳ vọng (bước dò in từng lần thử, nên không bị "đứng im"):

```
[__dl] Detecting page count...
[__dl] base: https://drive.google.com/viewer/img?id=...&page=
[__dl] ... page 1: ok (58 KB)
[__dl] ... page 2: ok (61 KB)
...
[__dl] ... page 1024: end of document (HTTP 404)
[__dl] Detected 630 pages.
[__dl] Starting: 630 pages | conc 6 | up to 3 retry rounds
[__dl] 630/630 | 43.6s | 14.4 pages/s
[__dl] Saved sach_1-630.zip | 40.2 MB | 630 pages
[__dl] COMPLETE 630/630 | 43.6s
```

Dòng `undefined` hiện ngay sau khi dán là giá trị trả về của đoạn code — không phải lỗi, các dòng log vẫn chạy tiếp bên dưới nó.

ZIP nằm trong thư mục Downloads. Với tài liệu khác: F5 trang, chọn lại frame rồi dán lại — không cần giữ gì từ lần trước.

Lần đầu dán, Chrome có thể chặn vì "dán code lạ" — làm theo hướng dẫn của nó (gõ `allow pasting`) rồi dán lại.

| Nếu thấy | Nghĩa là | Xử lý |
|---|---|---|
| `No /viewer/img request in this frame` | Chưa cuộn trang nào, hoặc sai frame | Cuộn viewer 1–2 trang rồi dán lại |
| `Could not detect the page count` | Server trả 429/5xx lúc dò, hoặc trang cuối không trả lỗi | Cuộn tới trang cuối xem số trang, rồi chạy `await __dl.go({ total: 630 })` |

### Bước 3 — (tuỳ chọn) đổi tuỳ chọn hoặc điều khiển tay

Script tự chạy ngay khi dán. Muốn tự tay chọn tham số thì dán dòng này **trước**:

```js
window.__dlAutorun = false
```

rồi dán `drive_fetch.js` như Bước 2, sau đó chạy:

```js
await __dl.go({ total: 630, conc: 8, rounds: 4, quality: [1600, false] })
```

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `total` | `0` | số trang; `0` = tự dò |
| `conc` | `6` | số request song song |
| `rounds` | `3` | số vòng thử lại trang lỗi |
| `quality` | — | `[w, webp]`, ví dụ `[1600, false]` |
| `save` | `true` | đặt `false` để chỉ tải, không tự lưu ZIP |

Các lệnh lẻ (`run`, `retry`, `save`, `status`, `test`) ở mục *Dùng thủ công* bên dưới.

### Bước 4 — ghép thành PDF

```bash
python build_pdf.py "sach_1-630.zip" "sach.pdf"
```

Kết quả: file PDF 630 trang, mỗi trang đúng tỉ lệ ảnh gốc.

---

## Cấu trúc repo

```
pdf-on-drive-downloader/
├─ README.md           # file này
├─ drive_fetch.js      # script đầy đủ, có chú thích (để đọc và sửa)
├─ drive_fetch.min.js  # cùng script, nén một dòng (để dán)
├─ build_pdf.py        # ghép các zip ảnh thành PDF
└─ .gitignore          # không đưa *.zip, *.pdf lên repo
```

Bản `.min.js` sinh lại sau mỗi lần sửa bằng:

```bash
npx -y terser drive_fetch.js -c -m -o drive_fetch.min.js
```

---

## Chất lượng ảnh

| Tham số | Ảnh trả về | In A4 | Dung lượng 630 trang |
|---|---|---|---|
| `w=800&webp=true` (mặc định) | 800 × 1035 | ~88 dpi | ~40 MB |
| `w=1600&webp=false` | 1600 × 2070 | ~176 dpi | ~120–160 MB |

Đổi bằng:

```js
await __dl.go({ quality: [1600, false] })
```

Hoặc đổi thủ công rồi mới chạy:

```js
__dl.setQuality(1600, false)
await __dl.test()   // xác nhận server trả đúng cỡ
await __dl.go()
```

`SCALE` trong `build_pdf.py` quyết định khổ trang: `0.75` nghĩa là 1 px = 0,75 pt (96 dpi), tức trang 800 × 1035 px thành 600 × 776 pt. Script giữ đúng tỉ lệ nên thường không cần sửa.

---

## Xử lý sự cố

| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| `No /viewer/img request in this frame` | Chưa có request ảnh nào | Cuộn 1–2 trang rồi dán lại |
| `Could not detect the page count` | Server trả 429/5xx lúc dò, hoặc trang cuối trả ảnh rỗng | Cuộn tới trang cuối xem số trang rồi chạy `await __dl.go({ total: 630 })` |
| Dừng ở `... page N: failed (429)` | Bị chặn tạm khi dò | Đợi 1–2 phút, F5 rồi dán lại; hoặc đặt `total` thủ công |
| Cần biết script gặp gì | — | `await __dl.diag()` — in URL mẫu và kết quả tải thử 2 trang |
| Chrome không cho dán | DevTools chặn paste lần đầu | Gõ `allow pasting` vào Console, Enter, rồi dán lại |
| `HTTP 403` | Token phiên hết hạn | F5, làm lại từ Bước 1 |
| `HTTP 429`, nhiều trang lỗi | Gửi quá nhiều request | `go()` tự giảm tốc và thử lại; nếu vẫn lỗi, chạy `await __dl.go({ conc: 3 })` |
| `__dl is not defined` | Sai frame, hoặc đã F5 | Chọn lại frame, dán lại script |
| `setQuality` xong test vẫn ra cỡ cũ | Bản script cũ đóng gói biến cục bộ | Dùng `drive_fetch.js` trong repo này |
| ZIP tải về 0 KB | Chrome chặn tải tự động | Cho phép `[*.]drive.google.com` trong `chrome://settings/content/automaticDownloads` |
| PDF mở ra trắng trang | ZIP thiếu/hỏng | Kiểm tra số entry trong ZIP có đúng `total` không |
| Chạy mãi vẫn thiếu vài trang cuối | `total` lớn hơn số trang thật | `go()` in cảnh báo khi các trang thiếu nằm liền nhau ở cuối; giảm `total` rồi chạy lại |

Với tài liệu render bằng canvas (không có endpoint `/viewer/img`), dùng chế độ dự phòng: chặn lúc blob được tạo ra.

```js
(() => {
  if (!window.__dl) { console.warn('Dan drive_fetch.js truoc.'); return; }
  const seen = (__dl._seen = __dl._seen || new Set());
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (o) {
    const u = orig(o);
    try {
      if (o instanceof Blob && o.size > 4096) {
        const k = `${o.type}:${o.size}`;
        if (!seen.has(k)) {
          seen.add(k);
          __dl.list.push({ index: __dl.list.length + 1, blob: o, type: o.type, size: o.size });
        }
      }
    } catch (e) {}
    return u;
  };
  console.log('Da chan blob. Cuon het tai lieu roi await __dl.save()');
})();
```

Sau đó cuộn từ đầu đến cuối tài liệu rồi `await __dl.save()`. Cách này xếp trang theo thứ tự blob được tạo, nên phải cuộn một chiều và không biết được nếu sót trang — chỉ dùng khi Cách 1 không chạy được.

---

## Dùng thủ công (nếu cần)

`go()` là cách nhanh nhất, nhưng từng bước vẫn gọi riêng được:

| Lệnh | Việc |
|---|---|
| `await __dl.go(opts)` | tải → tự thử lại → tự lưu ZIP, một lệnh |
| `await __dl.run()` | chỉ tải, không thử lại, không lưu |
| `await __dl.retry()` | thử lại các trang còn thiếu với tốc độ thấp hơn |
| `await __dl.save()` | đóng gói và tải ZIP từ những gì đang có |
| `__dl.status()` | in số trang đã có / còn thiếu |
| `await __dl.test()` | kiểm tra 3 trang đầu: HTTP status, content-type, dung lượng |

---

## Giới hạn đã biết

- Script tự chạy ngay khi dán. Muốn nạp mà không chạy (để tự gọi `go()` với tham số), dán `window.__dlAutorun = false` trước rồi mới dán script.
- Bước dò số trang tốn thêm khoảng log₂(N) request (630 trang ≈ 6 request), và những trang dò được giữ lại trong bộ nhớ — không tải hai lần.
- ZIP được tạo theo chuẩn ZIP32: tối đa 65.535 trang và 4 GB. Vượt mức đó phải chia nhỏ.
- Token `id`/`fssid` sống khoảng một giờ. Lấy được URL thì chạy luôn.
- Đừng đóng tab khi đang chạy — mất `__dl` là mất toàn bộ ảnh đã tải.
- Giữ `conc` ≤ 12; cao hơn dễ bị chặn tạm thời.
- Ảnh nằm trong RAM của tab trong suốt quá trình, nên tài liệu rất lớn (hơn ~1.500 trang ở `w=1600`) có thể làm tab nặng.
- `build_pdf.py` lấy **toàn bộ chữ số** trong tên file làm số trang, nên tên file trong ZIP phải chứa đúng một nhóm số (`trang_001.webp` ✅, `page_12_v2.png` ❌ → ra 122). Script của repo này đặt tên đúng chuẩn đó.
- Mỗi tài liệu mới chỉ cần đổi `total`; mọi thứ khác giữ nguyên.
- `go()` chỉ lưu ZIP khi đã đủ trang. Muốn lưu bản thiếu để xem trước, gọi `await __dl.save()` — script vẫn in cảnh báo số trang thiếu.

---

## Miễn trừ

Repo này là ghi chú kỹ thuật cá nhân, không khuyến khích vi phạm điều khoản của Google hay quyền của người giữ bản quyền. Bạn tự chịu trách nhiệm về việc dùng công cụ này với tài liệu nào.
