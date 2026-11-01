# -*- coding: utf-8 -*-
"""Ghep cac file zip anh trang thanh mot PDF duy nhat.

Dung:
    python build_pdf.py "<glob>" "<file-ra.pdf>"

Vi du:
    python build_pdf.py "C:\\Users\\Hoang Loc\\Downloads\\sach_1-630.zip" "%USERPROFILE%\\Downloads\\sach.pdf"

Dac diem:
  - Trang goc la PNG 8-bit khong chen dong duoc nhung NGUYEN luong nen vao PDF
    (/FlateDecode + /Predictor 15), khong giai ma, khong mat du lieu.
  - Trang WEBP hoac JPEG duoc giai ma va ma hoa lai thanh JPEG.
  - Tu tim so trang tu noi dung zip, khong can khai bao.
"""
import glob
import io
import os
import struct
import sys
import zipfile

import numpy as np
from PIL import Image

SCALE = 0.75  # 1 px = 0.75 pt, tuc 96 dpi. Trang 800x1035 thanh 600x776 pt.


def png_stream(data):
    """Tra ve thong so neu la PNG 8-bit, khong chen dong, khong trong suot."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos, idat = 8, []
    w = h = bits = ctype = interlace = None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bits, ctype, _c, _f, interlace = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat.append(body)
        elif typ == b"IEND":
            break
        elif typ == b"tRNS":
            return None
        pos += 12 + ln
    if interlace != 0 or bits != 8 or ctype not in (0, 2):
        return None
    return w, h, bits, ctype, b"".join(idat)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    pattern, out_path = sys.argv[1], sys.argv[2]

    paths = sorted(glob.glob(pattern))
    if not paths:
        print(f"Khong tim thay file nao khop: {pattern}")
        return 1

    blobs, dup = {}, []
    for p in paths:
        with zipfile.ZipFile(p) as z:
            for info in z.infolist():
                if info.is_dir():
                    continue
                num = int("".join(c for c in os.path.basename(info.filename) if c.isdigit()))
                if num in blobs:
                    dup.append(num)
                blobs[num] = z.read(info)

    nums = sorted(blobs)
    if dup:
        print(f"CANH BAO: {len(dup)} trang bi trung giua cac zip, giu ban doc sau cung: {sorted(set(dup))[:15]}")
    gap = [i for i in range(nums[0], nums[-1] + 1) if i not in blobs]
    total = nums[-1]
    if gap:
        print(f"CANH BAO: thieu {len(gap)} trang: {gap[:20]}")

    print(f"{len(paths)} zip | {len(nums)} trang | {sum(len(v) for v in blobs.values()) / 1048576:.1f} MB")

    enc = []
    n_png = n_jpg = 0
    for n in nums:
        raw = blobs[n]
        im = Image.open(io.BytesIO(raw))
        im.load()
        w, h = im.size
        st = png_stream(raw)

        if st is not None:
            pw, ph, bits, ctype, idat = st
            assert (pw, ph) == (w, h), (n, pw, ph, w, h)
            enc.append((n, w, h, "DeviceGray" if ctype == 0 else "DeviceRGB",
                        "FlateDecode", 1 if ctype == 0 else 3, bits, idat))
            n_png += 1
        else:
            im = im.convert("RGB")
            small = im.copy()
            small.thumbnail((256, 256))
            a = np.asarray(small).astype(np.int16)
            dev = int(np.max(np.maximum.reduce([
                np.abs(a[:, :, 0] - a[:, :, 1]),
                np.abs(a[:, :, 1] - a[:, :, 2]),
                np.abs(a[:, :, 0] - a[:, :, 2]),
            ])))
            buf = io.BytesIO()
            if dev <= 12:
                im.convert("L").save(buf, "JPEG", quality=85, optimize=True)
                cs = "DeviceGray"
            else:
                im.save(buf, "JPEG", quality=90, optimize=True, subsampling=0)
                cs = "DeviceRGB"
            enc.append((n, w, h, cs, "DCTDecode", None, None, buf.getvalue()))
            n_jpg += 1

        if n % 100 == 0:
            print(f"  xu ly {n}/{total}")

    print(f"nhung nguyen PNG: {n_png} | ma hoa lai JPEG: {n_jpg}")
    blobs.clear()

    out = bytearray(b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}

    def add_obj(num, payload):
        offsets[num] = len(out)
        out.extend(b"%d 0 obj\n" % num)
        out.extend(payload)
        out.extend(b"\nendobj\n")

    kids = " ".join("%d 0 R" % (4 + i * 3) for i in range(len(enc)))
    add_obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    add_obj(2, ("<< /Type /Pages /Count %d /Kids [%s] >>" % (len(enc), kids)).encode("ascii"))
    add_obj(3, b"<< /Title (sach) /Producer (build_pdf.py) >>")

    for idx, (n, w, h, cs, filt, colors, bits, data) in enumerate(enc):
        pnum = 4 + idx * 3
        W, H = round(w * SCALE, 2), round(h * SCALE, 2)
        content = ("q %s 0 0 %s 0 0 cm /Im0 Do Q" % (W, H)).encode("ascii")
        add_obj(pnum, (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] "
            "/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
            % (W, H, pnum + 2, pnum + 1)).encode("ascii"))
        add_obj(pnum + 1, ("<< /Length %d >>\nstream\n" % len(content)).encode("ascii")
                + content + b"\nendstream")
        if filt == "FlateDecode":
            head = ("<< /Type /XObject /Subtype /Image /Width %d /Height %d "
                    "/ColorSpace /%s /BitsPerComponent %d /Filter /FlateDecode "
                    "/DecodeParms << /Predictor 15 /Colors %d /BitsPerComponent %d "
                    "/Columns %d >> /Length %d >>\nstream\n"
                    % (w, h, cs, bits, colors, bits, w, len(data)))
        else:
            head = ("<< /Type /XObject /Subtype /Image /Width %d /Height %d "
                    "/ColorSpace /%s /BitsPerComponent 8 /Filter /DCTDecode "
                    "/Length %d >>\nstream\n" % (w, h, cs, len(data)))
        add_obj(pnum + 2, head.encode("ascii") + data + b"\nendstream")

    count = 3 + len(enc) * 3
    xref_off = len(out)
    out.extend(b"xref\n0 %d\n" % (count + 1))
    out.extend(b"0000000000 65535 f \n")
    for num in range(1, count + 1):
        out.extend(b"%010d 00000 n \n" % offsets[num])
    out.extend(b"trailer\n<< /Size %d /Root 1 0 R /Info 3 0 R >>\nstartxref\n%d\n%%%%EOF\n"
               % (count + 1, xref_off))

    with open(out_path, "wb") as f:
        f.write(out)
    print(f"ghi {out_path} | {len(out) / 1048576:.1f} MB | {len(enc)} trang")
    return 0


if __name__ == "__main__":
    sys.exit(main())
