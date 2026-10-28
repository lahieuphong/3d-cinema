# Bàn giao Prompt 08: giao diện theo tác vụ, bố cục responsive và QA phát hành

Trạng thái: hoàn thành, chờ duyệt (28/10/2026). Chưa commit, push hay deploy; không nâng dependency nào.
Nền: commit `3ed4a3a` (Prompt 07), working tree sạch khi bắt đầu. Checklist phát hành:
`docs/release-checklist.md`.

## Baseline

- Harness của Prompt 07 chạy trên code chưa sửa: **325/325** (`artifacts/prompt-08/baseline/`).
- Số đo giao diện Prompt 07 trên bản build production của chính nó (`artifacts/prompt-08/baseline/ui/`):
  - tỷ lệ canvas ở 7 kích thước;
  - request video;
  - thời gian tải.
- Phát hiện từ baseline:
  - **360×640, mở sơ đồ: canvas còn 2 px (0,3 %)**; 390×844: 17,7 %.
  - Với `preload="metadata"` mà Chrome vẫn tải **~3–4 MB video trước khi bấm Phát** (MP4 phân mảnh
    không ghi thời lượng). Xem hết tải ~13 MB cho tệp 8,3 MB.

## Ba tác vụ

`Khám phá` · `Chọn ghế` · `Xem phim` là ba cách *trình bày* một trang, không phải ba ứng dụng. Dùng
chung một scene, renderer, camera, `SeatSelection`, một `HTMLVideoElement`/`MediaController` và lựa
chọn chất lượng.

| Tác vụ | Dưới khung 3D (dock) | Thêm |
| --- | --- | --- |
| Khám phá | Tổng quan, Góc khác (Nhìn về ghế, Ghế F06, Về góc ban đầu), Tham quan, Đi bộ | Cần điều khiển chỉ hiện khi đang đi bộ |
| Chọn ghế | Dòng tóm tắt "Minh họa · Đã chọn n/8: …", Sơ đồ ghế / Mở sơ đồ, Xem từ ghế … | Panel ghế: bên phải (desktop, tablet ngang, điện thoại ngang); sheet (dọc) |
| Xem phim | Player: phát/tạm dừng, thời gian, tua, tắt tiếng, âm lượng; "Góc nhìn: …" + một hành động camera; tên phim và credits | Trạng thái phim là chip ở góc khung 3D |

- **Ghi công CC BY:** phim (hoặc poster) luôn hiện trên màn chiếu ở mọi tác vụ.
  - Khám phá và Chọn ghế: dòng "Big Buck Bunny (trailer): (c) copyright 2008, Blender Foundation /
    www.bigbuckbunny.org · CC BY 3.0" có liên kết, nằm dưới caption ở góc khung 3D.
  - Xem phim: dòng đó nằm trong player.
  - Có check ở 7 kích thước.

- **Header:** tên trang; công tắc ba tác vụ (nút `aria-pressed`, số ghế đã chọn cạnh "Chọn ghế"); nút
  mini ⏸/▶ của phim; "Cài đặt".
  - Nút mini chỉ hiện khi phim đã được phát và đang ở tác vụ khác Xem phim.
  - "Cài đặt" gồm chất lượng Cao/Tiết kiệm và "Công cụ kiểm tra": Mặt cắt bên, Mặt bằng, công tắc
    trần/vách, Kiểm tra ghế.
- **Quy tắc đổi tác vụ** (`src/cinema/taskLayout.ts`, hàm thuần, có unit test):
  - không đụng lựa chọn ghế, video/âm thanh, camera, canvas hay listener;
  - không tự phát; phim đang phát thì phát tiếp, và nút mini trên header luôn cho tạm dừng;
  - rời Khám phá thì tham quan và đi bộ dừng **tại chỗ** (camera không dời) — chúng thuộc tác vụ đó,
    và cần điều khiển chỉ hiện ở đó;
  - panel ghế chỉ hiện ở Chọn ghế. Panel quay lại như người dùng để; lần đầu mở sẵn nếu là panel
    bên, đóng nếu là sheet. Chế độ toàn màn hình không bao giờ tự mở;
  - "Xem từ ghế này" dời camera (người dùng yêu cầu). Trên sheet thì sheet đóng để thấy màn; panel
    bên thì giữ nguyên;
  - ẩn tab, mở inspector, mất context vẫn tạm dừng phim như Prompt 07;
  - tác vụ và lựa chọn panel được giữ qua lần mở inspector (`CinemaSession.task`, `seatPanelOpen`).

## Bố cục

Breakpoint CSS (`src/styles.css`). JS dùng đúng câu truy vấn `SHEET_LAYOUT_QUERY` để biết panel là
sheet.

| Điều kiện | Bố cục |
| --- | --- |
| Mặc định (desktop, tablet ngang) | Header một hàng; khung 3D; dock một hàng (Xem phim: hai hàng); panel ghế 396 px bên phải |
| `(orientation: portrait) and (max-width: 1024px)` | Panel ghế là **sheet** dưới khung 3D (tối đa 52 dvh), che dock khi mở; "Mở rộng" → **dialog toàn màn hình** |
| `max-width: 719px` | Các góc ít dùng gộp vào "Góc khác" (popover) |
| `max-width: 599px` | Header hai hàng: tên + mini + cài đặt; ba tác vụ chia đều toàn chiều ngang |
| `max-width: 399px` | Bỏ icon trang trí; nút Mở rộng chỉ còn icon (tên vẫn đọc được) |
| `(orientation: landscape) and (max-height: 500px)` | Header một hàng, tên trang ẩn trực quan; player một hàng + credits một dòng; panel 300 px |
| `pointer: coarse` | Vùng chạm chính 44 px; ghế sơ đồ 36 px cách 5 px, cuộn ngang |

- `100dvh` và `env(safe-area-inset-*)` cho cả trang.
- Khi sheet ở chế độ toàn màn hình, header và khung 3D rời layout (`display: none`). Canvas không vẽ
  gì; khi quay lại thì vẽ lại ngay, không có frame trống.
- Nhãn và kích thước cố định:
  - "Tham quan" / "Đi bộ" không đổi chữ (trạng thái thể hiện bằng `aria-pressed`);
  - dòng tóm tắt ghế luôn giữ 2 dòng trên điện thoại;
  - footer panel ghế có cùng cấu trúc khi có hay không có ghế đang xem;
  - trạng thái phim là chip đè lên góc khung 3D, không đẩy layout;
  - nút "Xem từ ghế F05" có độ rộng tối thiểu.

## Tỷ lệ canvas đo thực tế

Chiều cao và diện tích canvas chia cho viewport, đo bằng `getBoundingClientRect` của canvas trong Chrome
(giả lập). Prompt 07 đo trên bản build của chính nó; Prompt 08 đo trong `npm run capture`.

| Viewport | Trạng thái | P07 chiều cao | P07 diện tích | P08 chiều cao | P08 diện tích |
| --- | --- | ---: | ---: | ---: | ---: |
| desktop-1440x900 | Khám phá (P07: sơ đồ đóng) | 78 % | 76 % | 84 % | 82 % |
| desktop-1440x900 | Chọn ghế, sơ đồ đóng (P08: dòng tóm tắt) | — | — | 84 % | 82 % |
| desktop-1440x900 | Sơ đồ mở | 78 % | 53 % | 84 % | 57 % |
| desktop-1440x900 | Đang xem phim | 78 % | 76 % | 79 % | 77 % |
| laptop-1280x720 | Khám phá (P07: sơ đồ đóng) | 72 % | 70 % | 80 % | 77 % |
| laptop-1280x720 | Chọn ghế, sơ đồ đóng (P08: dòng tóm tắt) | — | — | 80 % | 77 % |
| laptop-1280x720 | Sơ đồ mở | 72 % | 47 % | 80 % | 52 % |
| laptop-1280x720 | Đang xem phim | 72 % | 70 % | 74 % | 72 % |
| tablet-portrait-820x1180 | Khám phá (P07: sơ đồ đóng) | 79 % | 76 % | 87 % | 84 % |
| tablet-portrait-820x1180 | Chọn ghế, sơ đồ đóng (P08: dòng tóm tắt) | — | — | 87 % | 84 % |
| tablet-portrait-820x1180 | Sơ đồ mở | 76 % | 35 % | 40 % | 39 % |
| tablet-portrait-820x1180 | Sơ đồ toàn màn hình (chủ động) | — | — | 0 % | 0 % |
| tablet-portrait-820x1180 | Đang xem phim | 79 % | 76 % | 84 % | 81 % |
| tablet-landscape-1180x820 | Khám phá (P07: sơ đồ đóng) | 76 % | 73 % | 81 % | 79 % |
| tablet-landscape-1180x820 | Chọn ghế, sơ đồ đóng (P08: dòng tóm tắt) | — | — | 81 % | 79 % |
| tablet-landscape-1180x820 | Sơ đồ mở | 76 % | 47 % | 81 % | 50 % |
| tablet-landscape-1180x820 | Đang xem phim | 76 % | 73 % | 76 % | 73 % |
| mobile-390x844 | Khám phá (P07: sơ đồ đóng) | 67 % | 62 % | 77 % | 73 % |
| mobile-390x844 | Chọn ghế, sơ đồ đóng (P08: dòng tóm tắt) | — | — | 72 % | 68 % |
| mobile-390x844 | Sơ đồ mở | 18 % | 17 % | 32 % | 30 % |
| mobile-390x844 | Sơ đồ toàn màn hình (chủ động) | — | — | 0 % | 0 % |
| mobile-390x844 | Đang xem phim | 67 % | 62 % | 67 % | 63 % |
| mobile-narrow-360x640 | Khám phá (P07: sơ đồ đóng) | 50 % | 46 % | 70 % | 65 % |
| mobile-narrow-360x640 | Chọn ghế, sơ đồ đóng (P08: dòng tóm tắt) | — | — | 63 % | 59 % |
| mobile-narrow-360x640 | Sơ đồ mở | 0 % | 0 % | 27 % | 25 % |
| mobile-narrow-360x640 | Sơ đồ toàn màn hình (chủ động) | — | — | 0 % | 0 % |
| mobile-narrow-360x640 | Đang xem phim | 50 % | 46 % | 57 % | 53 % |
| mobile-landscape-844x390 | Khám phá (P07: sơ đồ đóng) | 64 % | 61 % | 68 % | 65 % |
| mobile-landscape-844x390 | Chọn ghế, sơ đồ đóng (P08: dòng tóm tắt) | — | — | 68 % | 65 % |
| mobile-landscape-844x390 | Sơ đồ mở | 64 % | 39 % | 62 % | 37 % |
| mobile-landscape-844x390 | Đang xem phim | 64 % | 61 % | 64 % | 62 % |

Ghi chú:
- Mục tiêu ≥ 55–60 % chiều cao cho Khám phá và Xem phim đạt ở mọi kích thước đã đo; thấp nhất là
  360×640 khi Xem phim, 57 %.
- Sheet nửa màn hình để lại 32 % (390×844) và 27 % (360×640) cho khung 3D. Chế độ
  toàn màn hình thì khung 3D là 0 %, có chủ đích.

## Panel, menu và focus

- **Panel bên** (desktop, tablet ngang, điện thoại ngang): `role="region"`, không modal, không bẫy
  focus. Escape đóng và trả focus về "Sơ đồ ghế".
- **Sheet dọc:** `role="region"`, không modal (khung 3D phía trên vẫn dùng được). Escape đóng, focus về
  "Mở sơ đồ".
- **Sheet toàn màn hình:** `role="dialog"` + `aria-modal="true"`.
  - Header và khung 3D `inert`; Tab/Shift+Tab vòng trong dialog.
  - Escape về sheet (focus giữ nguyên); Escape lần nữa thì đóng.
  - "Trở lại phòng 3D" đóng và trả focus về "Mở sơ đồ".
- **"Cài đặt" và "Góc khác":** popover không modal.
  - Escape đóng và trả focus về nút.
  - Chọn một góc thì menu đóng.
  - Bấm ra ngoài thì đóng; nếu cú bấm đó rơi vào khung 3D thì nó bị "tiêu" luôn, không chọn ghế,
    không xoay camera.
- Phần bị ẩn (panel đóng, menu đóng, dock tác vụ khác) dùng `hidden`/`display: none`: không nằm trong
  thứ tự Tab, không nhận pointer.
- Thứ tự Tab: ba tác vụ → Cài đặt → (lớp phủ khung 3D: nút trở về) → dock của tác vụ hiện tại →
  panel ghế.
- Khi focus đang ở phần vừa bị ẩn, nó chuyển sang nút dẫn trở lại phần đó.
- **Picking:** tính theo `getBoundingClientRect` của canvas tại thời điểm chạm, nên đúng sau mọi lần
  layout đổi (có check sau khi đóng/mở panel, xoay máy, đổi chất lượng). Resize vẫn vẽ ngay trong
  callback của `ResizeObserver` (Prompt 07), nên không có frame trống.

## Loading, lỗi, fallback

| Trường hợp | Hiển thị | Thử lại |
| --- | --- | --- |
| Đang tải mã trang | `index.html` hiện "Đang tải trang…" (không có phần trăm). Sau 15 s mà chưa chạy được thì báo tải lâu + "Tải lại trang" | Tải lại trang |
| Đang tải phần 3D | "Đang tải phần 3D của trang…". Tác vụ, sơ đồ ghế, player đã hiện và dùng được; điều khiển camera và Phát khoá kèm lý do | — |
| Đang dựng phòng | "Đang dựng phòng chiếu 3D…" | — |
| Tải phần 3D thất bại | Lỗi + "Thử lại"; video 2D và sơ đồ vẫn dùng được. Chrome tải lại module được (đã thử) | Chỉ tải và dựng lại scene; ghế, video giữ nguyên |
| Lỗi khi dựng scene | Lỗi + "Thử lại" | Như trên |
| Không có WebGL | Lỗi gọn + video 2D (một phần tử); bắt đầu ở Chọn ghế với sơ đồ mở; Khám phá ghi lý do, điều khiển camera/chất lượng/kiểm tra bị khoá | Không (thử lại không giúp gì) |
| Mất context | "Đang chờ trình duyệt khôi phục…"; phim tạm dừng | Tự khôi phục như Prompt 07 |
| Context không được trả sau 5 s | "Cảnh 3D chưa được khôi phục" + "Dựng lại cảnh 3D" | Dựng renderer và scene mới; giữ ghế, góc nhìn từ ghế, phần tử video và thời điểm |
| Đang tải metadata / buffering video | Chip "Đang tải thông tin video…" / "Đang chờ dữ liệu…" ở góc | Sau 12 s: "Tải lại" (Prompt 07) |
| Lỗi video | Chip lỗi + "Thử lại", chữ dài xuống dòng trong chip | Chỉ tải lại video |
| Chưa chọn ghế | "Minh họa · Chưa chọn ghế nào — chạm một ghế trong phòng hoặc mở sơ đồ." | — |
| Đủ 8 ghế | Tóm tắt "Đã đủ 8/8: …"; ghế thứ 9 bị từ chối kèm lý do | — |

- Không spinner nào còn quay sau khi đã thất bại.
- Với giảm chuyển động: spinner đứng yên (`animation: none`), công tắc không trượt, panel và sheet
  không có hiệu ứng (vốn không có).

## Tải ban đầu và bundle

Prompt 07 có một chunk JS duy nhất: trang chỉ hiện gì đó sau khi ~1 MB JS đã tải và chạy. Nay
`page.ts` tải phần 3D (`view.ts`, three.js, phòng) bằng `import()` **ngay khi mount**, song song với
việc dựng UI. Tác vụ, sơ đồ ghế 2D và player chạy trước khi phần 3D tới. Không đổi area light, vật
liệu hay chất lượng hình; không nâng dependency; không nâng `chunkSizeWarningLimit`.

| Tệp (`npm run build`) | raw | gzip | brotli | Tải khi |
| --- | ---: | ---: | ---: | --- |
| `index-*.js`: trang, tác vụ, sơ đồ, player, media controller | 63,7 kB | 22,4 kB | 20,0 kB | màn hình đầu |
| `index-*.css` | 22,1 kB | 4,9 kB | 4,4 kB | màn hình đầu |
| `view-*.js`: phòng, camera, render, picking | 55,1 kB | 18,6 kB | 16,8 kB | ngay sau (import động) |
| `seats-*.js`: three.js + mô hình ghế, vật liệu dùng chung với inspector | 884,9 kB | 265,1 kB | 207,9 kB | ngay sau |
| `seatInspector-*.js` | 10,2 kB | 4,2 kB | 3,8 kB | chỉ khi mở Kiểm tra ghế |

- **Màn hình đầu** (HTML + entry + CSS): **87,6 kB / 28,4 kB gzip**, so với 1 005,5 kB / 305,5 kB ở
  Prompt 07 (−91 %). Đây là mã thực sự không phải tải trước khi dùng được trang, không chỉ là đổi tên
  chunk.
- **Tới khi cảnh 3D sẵn sàng** vẫn cần cả three.js: 1 027,6 kB / 312,1 kB gzip, so với 1 005,5 / 305,5 kB
  ở Prompt 07 (+2 %: mã UI mới và chi phí tách chunk).
  - Cảnh báo chunk > 500 kB vẫn còn, cho `seats-*.js` (phần lớn là three.js). Không che bằng cách nâng
    giới hạn.
  - Rolldown tự đặt tên chunk dùng chung theo module đầu tiên (`seats`).
- **Thời gian** (`npm run measure:build`: `vite preview` có gzip, Chrome 156, cache tắt, trung vị 3 lần):

| Mạng | Trang dùng được | Byte tới lúc đó | Cảnh 3D sẵn sàng | Byte tới lúc đó | Prompt 07 (trang có gì đó / cảnh) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Máy cục bộ, không giới hạn | 43 ms | 48 kB | 336 ms | 415 kB | 230 ms / 290 ms |
| 1,6 Mbit/s xuống, RTT 150 ms (giả lập CDP) | **514 ms** | 29 kB | **2 348 ms** | 315 kB | 2 088 ms / 2 153 ms |

  - Trên mạng chậm, trang dùng được sớm hơn ~1,6 s.
  - Cảnh 3D chậm hơn ~0,2 s, do thêm một vòng tải chunk sau entry.
  - Bản đầu tiên của Prompt 08 có cảnh sẵn sàng ở 4,2 s, vì video (metadata) và poster tải cùng lúc
    với phần 3D. Đã sửa:
    - `MediaController({ loadNow: false })` chỉ gắn nguồn video khi cảnh đã sẵn sàng (hoặc khi vào
      chế độ 2D, hoặc khi bấm Phát);
    - poster chỉ tải khi mã 3D đã về.
- **Video và poster trước/sau khi bấm Phát** (CDP, bản build):

| | Request video | Byte video | Poster |
| --- | ---: | ---: | ---: |
| Prompt 07 trước Phát | 7–10 (range, dò khắp tệp) | 2,9–4,2 MB | 1 (100 kB) |
| Prompt 08 trước Phát | 1 | 1,0–1,4 MB (Chrome đọc trước đầu tệp dù `preload="metadata"`) | 1 (100 kB) |
| Prompt 08, 4 s sau Phát | 2 | 4,7–6,6 MB | — |
| Prompt 08 xem hết | 2 | 8,35 MB = 1,00 × tệp (Prompt 07: ~13 MB) | — |

  - Không tải video hai lần, không có request trùng.
  - Poster 1280×720 JPEG 100 kB (giữ nguyên): là texture trên màn 8,5 m, nhìn từ ghế F06 chiếm gần
    hết khung 1440 px, nên nhỏ hơn sẽ mờ.
- **Production** (`vite preview`, có check trong `measure-build.mjs`):
  - `/cinema` mở trực tiếp và refresh; `/` chuyển sang `/cinema`; `?inspect=seat` chạy; đường dẫn lạ
    ra trang "Không tìm thấy";
  - asset `text/javascript`, `text/css`; video `video/mp4`, request range trả 206;
  - `?film=` bị bỏ qua (luôn là phim demo, không có hook dev); `fixtures/` không có trong `dist/`.
- **Cache** (`vercel.json`, *chưa kiểm chứng trên Vercel*):
  - `/assets/*` (tên có hash): `public, max-age=31536000, immutable`;
  - mọi đường dẫn trang (`index.html`, `/cinema`): `no-cache` (luôn hỏi lại, nên không giữ bản cũ);
  - `/media/*` để mặc định của Vercel (hỏi lại theo ETag). Tệp video giữ tên cũ khi được remux, nên
    không được cache "immutable".
- **Lúc tải mã trang:** `index.html` có sẵn một dòng "Đang tải trang…" (CSS inline, không phần trăm
  giả). Sau 15 s nếu app chưa chạy thì báo tải lâu và có "Tải lại trang".

## Media

Chi tiết và số liệu: `docs/media-credits.md` (mục Prompt 08) và `artifacts/prompt-08/media/`. Tệp, giấy
phép và dòng ghi công giữ nguyên.

- **Remux, không mã hoá lại** (`scripts/remux-mp4.mjs`). MP4 phân mảnh của MediaRecorder → MP4 thường
  có `moov` (bảng mẫu, thời lượng 33,04 s) ở đầu.
  - Byte mẫu hình và tiếng giống hệt (SHA-256 theo track).
  - 814/814 frame giải mã giống hệt (chênh pixel 0), timestamp giống hệt.
  - Tệp +4 kB; SHA-256 mới `cd6885f6…62a3b`.
  - Kết quả: thời lượng có ngay; trước Phát còn 1 request; xem hết tải đúng 1 lần tệp.
- **Frame lặp/mất:** giải mã từng frame của bản gốc `.mov` (812 frame, 25 frame/s cố định) và bản chuyển
  mã (814 frame), rồi dóng hàng.
  - **Trong nguồn:** 376 cặp frame liền nhau trông giống hệt — đoạn tĩnh có chủ đích (thẻ tiêu đề,
    cảnh đứng).
  - **Do chuyển mã:** 0 frame mất mà nhìn thấy được (14 frame gốc bị bỏ đều trong đoạn tĩnh). 0 frame
    lặp khi hình chuyển động; 13 frame "lặp" là frame cuối được giữ 0,5 s cho tới hết tiếng.
  - Độ lệch thời gian cố định ~44 ms (≈ 1 frame), không trôi.
  - Nhịp frame **không đều** (30–52 ms, một khoảng hở 514 ms trong đoạn tiêu đề tĩnh), vì bản chuyển
    mã ghi theo thời gian thực. Không sửa: muốn sửa phải mã hoá lại một cách tất định.
  - **Khi phát:** `getVideoPlaybackQuality().droppedVideoFrames` = 0 trong các lần đo ở Chrome
    headless (`report.json`, mục `film`).
  - Số lần render cảnh 3D theo frame video không phải FPS của tệp.
- **Âm thanh:** chỉ xác nhận có track tiếng được giải mã và tắt tiếng/âm lượng đọc lại đúng từ phần
  tử; **chưa kiểm chứng bằng tai**.
- **Sửa thêm:** bấm tắt tiếng hai lần nhanh trước đây bị bỏ lần thứ hai, vì nút đọc trạng thái cũ
  trong lúc sự kiện `volumechange` chưa tới. Harness bàn phím phát hiện lỗi này. Nay nút đảo theo
  `video.muted` thật.

## Accessibility

- **Tên, vai trò, trạng thái:**
  - ba tác vụ là nút `aria-pressed` trong `role="group"` "Tác vụ";
  - menu là nút `aria-expanded` + `aria-controls`; "Sơ đồ ghế" / "Mở sơ đồ" có `aria-expanded`;
  - panel `region` / `dialog` như trên; nút mini của phim có tên "Tạm dừng phim · Đang phát";
  - nút chỉ có icon (Cài đặt, Mở rộng trên màn rất hẹp) vẫn có tên;
  - canvas `role="img"` có hướng dẫn dùng Sơ đồ ghế cho bàn phím.
- **Live region:**
  - caption (chỉ ghi khi chữ đổi);
  - tham quan (mỗi điểm một lần);
  - chọn ghế (một câu mỗi thay đổi);
  - phim (đổi trạng thái hoặc có sự cố; đã chuyển ra gốc trang để không bị ẩn theo tác vụ);
  - status `role=status` / `alert`.
  - Không vùng nào cập nhật theo frame hay theo giây.
- **Focus thấy được:** viền vàng 2–3 px trên mọi nút, ghế, liên kết, thanh tua (ảnh `focus-*`).
- **Độ tương phản** (WCAG, tính từ màu CSS):

| Cặp màu | Tỷ lệ |
| --- | ---: |
| Chữ trên nền trang / panel | 15,8 / 14,6 |
| Chữ phụ trên panel / footer, menu | 7,3 / 6,9 |
| Chữ trên nút vàng (đang chọn, tác vụ hiện tại) | 9,5 |
| Số ghế còn trống | 9,9 |
| Số ghế đã đặt (trước: ~3,2) | 5,6 |
| Thông báo lỗi / giới hạn 8 ghế | 7,7 / 8,5 |
| Caption, chip trên lớp phủ tối | ≥ 13 |

- **Vùng chạm** (màn cảm ứng): tác vụ, dock, player, mini, cài đặt, nút panel đều ≥ 44 × 44 CSS px (có
  check ở mọi kích thước cảm ứng). Ghế trong sơ đồ 36 × 36 px cách nhau 5 px; sơ đồ cuộn ngang, không
  ép 11 ghế vừa màn. Nút bỏ từng ghế 40 px.
- **Zoom 200 %:** 1440×900 → 720×450 và 1280×720 → 640×360 CSS px.
  - Mọi tác vụ dùng được, không tràn.
  - Khung 3D chiếm 67–74 % chiều cao ở Khám phá, 63–70 % ở Xem phim.
  - Menu cài đặt cuộn trong chính nó.
- **Giảm chuyển động:** áp dụng cho tham quan (từng điểm), di chuyển camera (tức thì), spinner (đứng
  yên), công tắc (không trượt).
- **Chưa thử với trình đọc màn hình thật.** Mọi điều trên kiểm tra qua thuộc tính DOM và thao tác phím
  bằng script.

## QA: trình duyệt và thiết bị đã thực sự thử

| Trình duyệt / engine | Phiên bản | Cách chạy | Đã thử |
| --- | --- | --- | --- |
| Google Chrome (Blink) | 156.0.8078.47, Windows 11, ANGLE D3D11, RTX 3090 | headless, playwright-core | Toàn bộ `npm run capture` và `npm run measure:build` |
| Microsoft Edge (Blink) | 156.0.4314.42 | headless, `BROWSER_PATH` | Luồng A, B, D, E, F, bàn phím/focus, không WebGL (`CAPTURE_ONLY=ui-flows,ui-focus,webgl-failure`): **21/21** (`artifacts/prompt-08/edge/`) |
| Firefox, WebKit/Safari | — | không có trong môi trường, không cài | chưa thử |
| Điện thoại / tablet thật | — | — | chưa thử (chỉ giả lập kích thước, DPR, cảm ứng) |

Các kích thước đã kiểm tra là kích thước giả lập, không phải bằng chứng trên thiết bị thật:
- 1440×900, 1280×720;
- 820×1180, 1180×820 (DPR 2, cảm ứng);
- 390×844, 360×640, 844×390 (DPR 3, cảm ứng);
- zoom 200 % của hai kích thước desktop.

Các luồng end-to-end (`report.json` mục `ui.flows`, video `video-p08-flow-*.webm`):
- **A. Desktop:** tour → dừng bằng kéo → chọn ghế 3D → sơ đồ → chọn/bỏ → xem từ ghế → phát → tạm
  dừng → trở về.
- **B. Điện thoại dọc:** góc khác → sơ đồ toàn màn hình → chọn → xem từ ghế (sheet tự đóng) → phát →
  xoay ngang → tạm dừng → quay lại sơ đồ, ghế còn.
- **C. Bàn phím:** tác vụ → sơ đồ → chọn bằng phím → xem từ ghế → điều khiển player → Escape, trả
  focus.
- **D. Vòng đời:** đổi chất lượng, mất/khôi phục context, context không về rồi dựng lại, inspector,
  rời trang (các check Prompt 05–07 cộng các check mới).
- **E. Không WebGL:** sơ đồ → chọn → player 2D → tạm dừng.
- **F. Giảm chuyển động.**

## Kiểm tra và regression

- **`npm test`: 170/170** (11 file; trước là 160/10).
  - Mới: `taskLayout.test.ts` (9 test: đổi tác vụ, nhớ panel, toàn màn hình không tự mở, Escape từng
    bước, "Xem từ ghế này" trên sheet/panel bên, đổi bố cục, chỉ dừng tham quan/đi bộ khi rời Khám
    phá).
  - Mới trong `media.test.ts`: hoãn tải video tới `load()`/`play()`.
- **Lỗi "no tests" của Vitest đã tìm ra nguyên nhân** (không phải lỗi ngẫu nhiên):
  - Process chạy với thư mục làm việc có ổ đĩa chữ thường (`e:\…`) thì Vitest nạp hai bản chính nó
    và mọi suite hỏng. `cd /d E:\…` thì luôn pass.
  - Tái hiện 4/4 lần; log và giải thích ở `artifacts/prompt-08/logs/vitest-no-tests-NOTE.md`.
  - Không phải lỗi code dự án; không nâng Vitest. Cách tránh: chạy từ terminal có ổ đĩa viết hoa.
- `npm run typecheck`: sạch. `npm run build`: thành công; cảnh báo chunk > 500 kB cho chunk three.js.
- **`npm run capture`: 407/407**, 0 cảnh báo console ngoài dự kiến (`artifacts/prompt-08/report.json`, log `logs/capture-2.log`). Lượt trước khi thêm dòng credits cạnh caption: 400/400 (`logs/capture-1-before-credit-line.log`)**; baseline Prompt 07 là 325/325.
- **`npm run measure:build`: 11/11** (`artifacts/prompt-08/build-metrics.json`).**

**Check cũ phải đổi cách thao tác.** Mục đích giữ nguyên; helper `reveal`/`clickUi` thao tác như
người dùng: chuyển tác vụ, mở "Cài đặt"/"Góc khác"/panel trước khi bấm.
- "Panel mở sẵn trên desktop" → "trang mở ở Khám phá, panel đóng"; panel mở sẵn khi vào Chọn ghế trên
  desktop (unit test + check bố cục).
- "Phím trong sơ đồ không làm người đi bộ di chuyển (khi đang đi bộ)" →
  - "chuyển sang Chọn ghế dừng đi bộ tại chỗ; phím trong sơ đồ không dời camera";
  - lý do: khi đi bộ, sơ đồ không còn trên màn.
- "Phím mũi tên trên player không làm đi bộ" → "Xem phim dừng đi bộ tại chỗ; phím trên player không
  dời camera", cùng lý do.
- "Khi không có WebGL, các nút trong `.cinema-toolbar` bị khoá" → check toàn bộ nút camera, chất lượng,
  kiểm tra (trong dock và menu), kèm lý do. Selector cũ khớp 0 phần tử nên bản Prompt 07 sẽ luôn pass;
  check mới yêu cầu > 8 nút.
- `filmMobile`:
  - "player không đè sheet" → "ở Chọn ghế, player nhường chỗ, header còn nút Tạm dừng phim";
  - "cần điều khiển không đè player" → "không đè dock, caption, nút trở về; header còn nút Tạm dừng".
- Live region của player kiểm tra qua `[data-film-live]` (đã chuyển ra gốc trang).
- Tìm ghế nhìn thấy được khi đi bộ trên mobile: duyệt mọi ghế, không chỉ 6 ghế cố định (khung nhìn
  đổi kích thước).

**Check mới** (`ui-*`, `measure-build.mjs`): tỷ lệ canvas 7 kích thước; độ ổn định kích thước; vùng
chạm; ghi công CC BY ở mọi tác vụ; sheet modal và bẫy focus; thứ tự Tab; Escape và trả focus; phím đang
giữ; loading và tải 3D thất bại/thử lại; context không về; lỗi video trên màn hẹp; trạng thái trống và
đủ ghế; luồng A–F; 64 lần đổi tác vụ; zoom 200 %; route, MIME, range, cache; byte video.

**Lỗi thật mà check mới bắt được** (đã sửa):
1. Bấm tắt tiếng hai lần nhanh: lần hai bị bỏ.
2. Không WebGL, điện thoại: chạm ghế ở mép dưới sơ đồ chỉ "xem" mà không chọn. Footer đổi chiều cao
   nên ghế bị cuộn đi dưới ngón tay; nay footer giữ một cấu trúc cố định.
3. Dựng lại cảnh khi context đã mất sinh cảnh báo three.js (`forceContextLoss` trên context đã mất).
4. Sheet toàn màn hình trên tablet dọc chỉ phủ 73 % (lỗi grid row).
5. Cảnh 3D chậm gấp đôi trên mạng chậm vì video và poster tranh băng thông.

## Số đo vòng đời

Chrome 156 headless; đếm đối tượng JS sống sau GC qua CDP (`Runtime.queryObjects`).

- **64 lần đổi tác vụ + 32 lần mở/đóng panel và menu** (luồng D):
  - không đổi: 1 canvas, 1 `MediaController`, 1 `HTMLVideoElement` (cùng phần tử);
  - Texture/Material/BufferGeometry/Object3D: 33/59/100/135 trước và sau;
  - listener window/document: 28/4 trước và sau; `renderer.info` 41 geometry / 10 texture /
    11 program;
  - heap JS 12,89 → 13,12 MiB;
  - **0 render** trong 1,5 s sau khi đứng yên (phim tạm dừng).
- **Phim:**
  - chưa phát hoặc tạm dừng: 0 render/s;
  - đang phát, camera đứng yên: 19,9 render/s = 19,9 frame video/s, 0 frame bị bỏ (như Prompt 07);
  - 13 vòng phát/dừng/tua + 3 lần mở inspector: 1 controller, 1 phần tử, đối tượng và listener không
    đổi, heap 14,33 → 14,70 MiB.
- **Mất/khôi phục context:**
  - 5 lần khôi phục: heap 13,59 → 13,91 MiB (+0,32; Prompt 07: +0,33);
  - 6 lần mở/đóng inspector: 14,00 → 14,48 MiB (+0,48; Prompt 07: +0,52);
  - mỗi texture chung của three.js giữ 1 listener.
- **Dựng lại cảnh khi context không về:** canvas mới, vẫn 1 canvas; cùng phần tử video; ghế và góc
  nhìn từ ghế giữ nguyên.
- Không đo trực tiếp bộ nhớ GPU.

## Ảnh và video (`artifacts/prompt-08/`)

208 tệp ảnh/video/báo cáo ở thư mục gốc, cộng `baseline/`, `edge/`, `media/`, `logs/`.

- **Ba tác vụ ở 7 kích thước:**
  - `ui-<viewport>-1-explore`, `-2-seats` (tóm tắt), `-2b-seats-eight-selected`, `-3-seats-open`
    (panel/sheet), `-4-seats-expanded` (toàn màn hình, chỉ bố cục dọc), `-5-watch`;
  - viewport: `desktop-1440x900`, `laptop-1280x720`, `tablet-portrait-820x1180`,
    `tablet-landscape-1180x820`, `mobile-390x844`, `mobile-narrow-360x640`, `mobile-landscape-844x390`.
- **Trước/sau cùng viewport:**
  - `compare-p07-p08-<viewport>-{explore,map-open,watching}.png`: Prompt 07 (baseline, bản build của
    chính nó) cạnh Prompt 08;
  - `compare-p07-p08-{desktop,tablet,mobile}-*`: cùng camera preset.
- **Zoom 200 %:** `zoom200-{1440x900,1280x720}-{1-explore,2-seats,3-watch,4-settings}`.
- **Focus:** `focus-1-task-button`, `focus-2-map-seat`, `focus-3-player`.
- **Trạng thái:**
  - `ui-state-1-loading-3d-code`, `ui-state-2-3d-download-failed`, `ui-state-3-context-not-restored`,
    `ui-state-4-scene-rebuilt`;
  - `ui-state-5-media-error-narrow`, `ui-state-6-limit-reached-sheet`, `ui-state-7-summary-eight`.
- **Không WebGL:** `flow-e-no-webgl-{seats,2d-player,explore}`, `webgl-unavailable`,
  `film-14-2d-fallback`.
- **Video end-to-end:** `video-p08-flow-desktop.webm` (luồng A), `video-p08-flow-mobile.webm` (luồng
  B), cùng các video Prompt 05–07 được quay lại trên giao diện mới.
- **Mobile:** `film-mobile-{portrait,landscape}-{playing,seat-view,explore}`, `seats-4-mobile-sheet`,
  `seats-5-mobile-landscape`, `mobile-landscape-*`.
- **Báo cáo và số đo:**
  - `report.json` (mục `ui`: canvas, chrome, focus, states, flows, zoom);
  - `build-metrics.json`, `canvas-share.md`;
  - `media/` (phân tích frame, remux);
  - `logs/` (test, typecheck, build, capture, đo, lỗi Vitest);
  - `baseline/` (Prompt 07: harness 325/325, `ui/metrics*.json` và ảnh).

## Hạn chế còn lại

- **Chỉ một engine:** mọi số đo đều trên Chrome 156 headless (cùng máy), cộng các luồng chính trên Edge
  156 (cũng là Blink).
  - Không có Firefox hay WebKit trong môi trường; không cài thêm.
  - Mobile và tablet là giả lập (kích thước, DPR, cảm ứng CDP), không phải thiết bị thật.
  - WebKit desktop, nếu có, cũng không thay được Safari trên iPhone.
- **Âm thanh chưa kiểm chứng bằng tai.**
- **Trình đọc màn hình chưa thử thật** (NVDA, VoiceOver, TalkBack).
- **Mobile dọc, Xem phim ở 360×640:** khung 3D cao 57 %, sát ngưỡng dưới của mục tiêu
  55–60 %. Dock Xem phim cần: điều khiển, dòng góc nhìn, hai dòng credits bắt buộc.
- **Sheet nửa màn hình** chỉ cho thấy ~4 hàng ghế ở 360×640; muốn thấy cả sơ đồ thì dùng "Mở rộng".
- **Tải trước video:** dù `preload="metadata"`, Chrome vẫn đọc trước 1–1,4 MB đầu tệp sau khi cảnh sẵn
  sàng. Ai không xem phim vẫn tốn chừng đó dữ liệu. Có thể hoãn tới khi mở Xem phim (khi đó thời
  lượng chỉ hiện sau khi mở tác vụ này) — chưa làm.
- **Nhịp frame của video** không đều (30–52 ms). Cần mã hoá lại một cách tất định từ bản gốc mới sửa
  được; chưa làm.
- **Mạng chậm** chỉ giả lập (CDP, route Playwright). Cấu hình cache Vercel chưa kiểm chứng vì chưa
  deploy.
- **Bộ nhớ GPU** không đo trực tiếp. Không khẳng định "không rò GPU"; chỉ có số đếm `renderer.info`,
  đối tượng JS sống sau GC và heap JS.
- **Chunk three.js ~885 kB** (cảnh báo > 500 kB). Cảnh 3D vẫn cần toàn bộ; muốn giảm phải đổi cách
  dùng three.js, ngoài phạm vi Prompt 08.
- **Lỗi Vitest "no tests"** tái diễn một lần, ngay sau khi tạo module và test mới; không tái hiện được
  (ghi chú ở `artifacts/prompt-08/logs/vitest-no-tests-NOTE.md`).

## File và lệnh

- **Mới:**
  - `src/cinema/taskLayout.ts` (+ `taskLayout.test.ts`): tác vụ và trạng thái panel;
  - `src/cinema/seatSummary.ts`: dòng tóm tắt của Chọn ghế;
  - `scripts/remux-mp4.mjs`: remux MP4 phân mảnh;
  - `scripts/measure-build.mjs` (`npm run measure:build`): đo bản build;
  - `docs/release-checklist.md`, tài liệu này;
  - `artifacts/prompt-08/`.
- **Sửa:**
  - `src/cinema/ui.ts`: header, tác vụ, menu, dock, trạng thái;
  - `src/cinema/page.ts`: điều phối tác vụ, tải 3D lười, thử lại scene, dựng lại khi context không
    về, hoãn video/poster;
  - `src/cinema/seatPanel.ts`: header/thân/footer, toàn màn hình modal, bẫy focus;
  - `src/cinema/playerUi.ts`: nút mini, chip trạng thái, live region, tắt tiếng theo element;
  - `src/cinema/mediaController.ts`: `loadNow`, `load()`;
  - `src/cinema/view.ts`: lý do `task` khi dừng tham quan, `DEBUG_TYPES`;
  - `src/cinema/renderHost.ts`: không `forceContextLoss` khi context đã mất;
  - `src/cinema/quality.ts`: `prefersReducedMotion` chuyển về đây để trang không phải tải three.js;
  - `src/cinema/media.test.ts`, `src/main.ts`, `src/styles.css`, `index.html`, `vercel.json`,
    `package.json` (chỉ thêm script `measure:build`), `docs/media-credits.md`;
  - `public/media/big-buck-bunny-trailer-720p.mp4` (remux);
  - `scripts/capture-views.mjs`.
- **Lệnh:**
  - `npm test`, `npm run typecheck`, `npm run build`;
  - `npm run capture` (~25 phút; `CAPTURE_ONLY=ui-layouts,ui-flows` chạy một phần);
  - `npm run measure:build` (sau `npm run build`);
  - `node scripts/remux-mp4.mjs <vào.mp4> <ra.mp4>`.
