# Tải tài liệu Google Drive "chỉ xem" thành PDF

Công cụ cá nhân gồm hai phần:

1. **`drive_fetch.js`** — đoạn JavaScript dán vào DevTools Console, tải toàn bộ các trang của một tài liệu Drive ở chế độ chỉ xem và đóng gói thành ZIP ngay trong trình duyệt.
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

`drive_fetch.js` làm ba việc:

- lấy URL mẫu từ `performance.getEntriesByType('resource')` — nhờ vậy không phải tự bắt request bằng tay;
- tải song song với một pool giới hạn (`conc`, mặc định 6);
- đóng gói kết quả thành ZIP bằng `Blob` + tự viết header ZIP, không cần thư viện ngoài và không upload gì lên mạng.

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

### Bước 2 — nạp script

Mở [`drive_fetch.js`](drive_fetch.js), copy toàn bộ, dán vào Console, Enter. Sửa `total` ở đầu file (hoặc sau khi nạp: `__dl.total = 630`) cho đúng số trang của tài liệu.

Nếu thấy `Chua thay request /viewer/img` thì chưa có request ảnh nào: cuộn viewer 1–2 trang rồi dán lại.

### Bước 3 — kiểm tra 3 trang đầu

```js
await __dl.test()
```

Phải thấy `HTTP 200` kèm `image/webp` hoặc `image/png`. Nếu ra `403` thì token phiên đã hết hạn — F5 trang và làm lại từ Bước 1.

### Bước 4 — tải toàn bộ

```js
await __dl.run()
```

Kỳ vọng: `XONG 630/630 | 43.6s | loi: 0`.

Nếu có trang lỗi, chạy lại phần còn thiếu:

```js
await __dl.retry()
```

`retry()` chỉ tải lại đúng các trang chưa có, chạy tuần tự để tránh bị chặn.

### Bước 5 — lưu ZIP

```js
await __dl.save()
```

Trình duyệt tải về `sach_1-630.zip` (khoảng 40 MB với 630 trang ở `w=800`). Nếu còn trang thiếu, script in cảnh báo trước khi lưu.

### Bước 6 — ghép thành PDF

```bash
python build_pdf.py "sach_1-630.zip" "sach.pdf"
```

Kết quả: file PDF 630 trang, mỗi trang đúng tỉ lệ ảnh gốc.

---

## Cấu trúc repo

```
pdf-on-drive-downloader/
├─ README.md          # file này
├─ drive_fetch.js     # đoạn script dán vào DevTools Console
├─ build_pdf.py       # ghép các zip ảnh thành PDF
└─ .gitignore         # không đưa *.zip, *.pdf lên repo
```

---

## Chất lượng ảnh

| Tham số | Ảnh trả về | In A4 | Dung lượng 630 trang |
|---|---|---|---|
| `w=800&webp=true` (mặc định) | 800 × 1035 | ~88 dpi | ~40 MB |
| `w=1600&webp=false` | 1600 × 2070 | ~176 dpi | ~120–160 MB |

Đổi bằng:

```js
__dl.setQuality(1600, false)
await __dl.test()   // xác nhận server trả đúng cỡ
```

`SCALE` trong `build_pdf.py` quyết định khổ trang: `0.75` nghĩa là 1 px = 0,75 pt (96 dpi), tức trang 800 × 1035 px thành 600 × 776 pt. Script giữ đúng tỉ lệ nên thường không cần sửa.

---

## Xử lý sự cố

| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| `Chua thay request /viewer/img` | Chưa có request ảnh nào | Cuộn 1–2 trang rồi dán lại |
| `HTTP 403` | Token phiên hết hạn | F5, làm lại từ Bước 1 |
| `HTTP 429`, nhiều trang lỗi | Gửi quá nhiều request | `__dl.conc = 3` rồi `await __dl.retry()` |
| `__dl is not defined` | Sai frame, hoặc đã F5 | Chọn lại frame, dán lại script |
| `setQuality` xong test vẫn ra cỡ cũ | Bản script cũ đóng gói biến cục bộ | Dùng `drive_fetch.js` trong repo này |
| ZIP tải về 0 KB | Chrome chặn tải tự động | Cho phép `[*.]drive.google.com` trong `chrome://settings/content/automaticDownloads` |
| PDF mở ra trắng trang | ZIP thiếu/hỏng | Kiểm tra số entry trong ZIP có đúng `total` không |
| PDF thiếu trang | `retry()` chưa chạy hết | Chạy `__dl.status()` xem còn thiếu bao nhiêu, rồi `__dl.save()` lại |

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

## Giới hạn đã biết

- ZIP được tạo theo chuẩn ZIP32: tối đa 65.535 trang và 4 GB. Vượt mức đó phải chia nhỏ.
- Token `id`/`fssid` sống khoảng một giờ. Lấy được URL thì chạy luôn.
- Đừng đóng tab khi đang chạy — mất `__dl` là mất toàn bộ ảnh đã tải.
- Giữ `conc` ≤ 12; cao hơn dễ bị chặn tạm thời.
- Ảnh nằm trong RAM của tab trong suốt quá trình, nên tài liệu rất lớn (hơn ~1.500 trang ở `w=1600`) có thể làm tab nặng.
- `build_pdf.py` lấy **toàn bộ chữ số** trong tên file làm số trang, nên tên file trong ZIP phải chứa đúng một nhóm số (`trang_001.webp` ✅, `page_12_v2.png` ❌ → ra 122). Script của repo này đặt tên đúng chuẩn đó.
- Mỗi tài liệu mới chỉ cần đổi `total`; mọi thứ khác giữ nguyên.

---

## Miễn trừ

Repo này là ghi chú kỹ thuật cá nhân, không khuyến khích vi phạm điều khoản của Google hay quyền của người giữ bản quyền. Bạn tự chịu trách nhiệm về việc dùng công cụ này với tài liệu nào.
