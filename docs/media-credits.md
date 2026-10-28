# Nguồn media và giấy phép

## Video demo trên màn chiếu

| Mục | Nội dung |
| --- | --- |
| Tác phẩm | *Big Buck Bunny* — trailer chính thức (2008) |
| Tác giả / đơn vị | Blender Foundation (Peach open movie project, Blender Institute) |
| URL nguồn (tệp gốc) | https://download.blender.org/peach/trailer/trailer_720p.mov |
| Trang dự án | https://peach.blender.org/about/ · https://www.bigbuckbunny.org |
| Giấy phép | Creative Commons Attribution 3.0 (CC BY 3.0) |
| URL giấy phép | https://creativecommons.org/licenses/by/3.0/ |
| Tệp trong dự án | `public/media/big-buck-bunny-trailer-720p.mp4` (remux "fast start" ở Prompt 08, xem bên dưới), `public/media/big-buck-bunny-trailer-poster.jpg` |

### Cách đã xác minh giấy phép (ngày 2026-10-27)

- Trang https://peach.blender.org/about/ (mục *License information*): kết quả dự án Peach
  "has been licensed under the Creative Commons Attribution 3.0 license. This includes all the data
  we've published online and on the DVDs…". Dòng ghi công trang này yêu cầu:
  **"(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org"**.
- Trang đó loại trừ khỏi giấy phép: mọi logo trên website (logo Blender, logo Creative Commons) và
  thương hiệu liên quan; bìa và nhãn đĩa DVD. Dự án này không dùng riêng logo nào; trailer được giữ
  nguyên nội dung, kể cả khung cuối của chính trailer.
- Khung cuối của trailer (khoảng giây 30,5) tự ghi: "WWW.BIGBUCKBUNNY.ORG — LICENCED AS CREATIVE
  COMMONS 3.0 ATTRIBUTION".
- Thư mục tải https://download.blender.org/peach/trailer/ liệt kê `trailer_720p.mov`, 18-Mar-2008,
  17 810 888 byte. SHA-256 của tệp đã tải:
  `cb7be60feb4fd4ff5b006e35e824201a48361b7ebc2f2bbcaf3351912035561a`.

### Thay đổi so với bản gốc

- **Chuyển mã, không cắt, không chỉnh sửa nội dung.** Bản gốc QuickTime `.mov` (H.264 + âm thanh,
  1280×720, 32,995 s, 17,8 MB) được phát trong Chrome 156 (headless, trên máy phát triển) và ghi lại
  bằng `MediaRecorder` với `video/mp4;codecs=avc1.640028,mp4a.40.2`, mục tiêu 1,4 Mbit/s hình +
  128 kbit/s tiếng. Không cài hay tải công cụ nào khác.
- Kết quả: MP4 (H.264 High + AAC), 1280×720, khoảng 24–25 hình/s, 33,04 s, 8 343 660 byte,
  SHA-256 `197363899c09056838caadf41c7b7302ff1eb6bc03d35f62286e262a3e7fdb8f`.
  Trình duyệt mở được thời lượng, tua được (kiểm tra bằng Chrome: tua tới 20 s, 5,5 s, 0 s đều đúng).
- Vì ghi theo thời gian thực, Chrome báo 15 hình bị bỏ khi phát bản gốc trong lúc ghi (trên khoảng 812):
  có thể có vài hình lặp; chất lượng nén thấp hơn bản gốc.
- Ảnh poster: hình ở giây 15 của bản MP4 đã chuyển mã, JPEG chất lượng 82, 1280×720, 100 075 byte,
  SHA-256 `5287d237ded7324ee58ae3a368e34952a5c17b7afded81d2ee73d9fcd3a2e99b`.

### Prompt 08: đổi container (remux), không đổi hình hay tiếng (ngày 2026-10-28)

- **Lý do.** Bản Prompt 07 là MP4 *phân mảnh* do `MediaRecorder` ghi: `moov` không có bảng mẫu,
  thời lượng ghi là 0. Với `preload="metadata"`, Chrome vẫn phải dò cả tệp để biết thời lượng.
  - Đo trên bản build production: 7–10 request range, **~3–4 MB (≈ 40–50 % tệp) trước khi bấm
    Phát**; xem hết tải ~13 MB cho tệp 8,3 MB.
  - Chi tiết: `artifacts/prompt-08/baseline/ui/metrics-network.json`.
- **Cách làm.** `node scripts/remux-mp4.mjs` (Node, không thư viện ngoài) ghi lại thành MP4 thường,
  "fast start": một `moov` đủ bảng mẫu và thời lượng ở đầu, rồi một `mdat`.
  - Từng mẫu hình và tiếng được chép nguyên byte, không giải mã, không mã hoá lại.
  - Thời điểm, độ dài và keyframe lấy từ các fragment.
  - Chỗ nối giữa các fragment hở vài ms (tiếng 8 chỗ ~3 ms, hình 8 chỗ 4–9 ms). Bảng mẫu không
    có khoảng hở, nên mẫu đứng trước mỗi chỗ nối được kéo dài đúng chừng đó. Nhờ vậy mọi mẫu giữ
    nguyên thời điểm giải mã cũ và hai track vẫn khớp nhau.
- **Kiểm chứng.**
  - SHA-256 của toàn bộ byte mẫu từng track trước và sau là như nhau.
  - Giải mã cả 814 frame của bản cũ và bản mới trong Chrome: thumbnail 64×36 giống hệt (chênh
    pixel 0), timestamp giống hệt.
- **Kết quả:** `public/media/big-buck-bunny-trailer-720p.mp4` giữ tên cũ, 8 347 668 byte (+4 KB bảng
  mẫu), SHA-256 `cd6885f649a62f9086640df3546cbdf8721207abdbaa9c7787e065333a862a3b`. Thời lượng
  33,04 s có ngay trong `moov`.

### Chất lượng bản chuyển mã (đo ở Prompt 08)

Bản gốc `trailer_720p.mov` có 812 frame, nhịp cố định 25 frame/s (32,48 s hình, 33,0 s tiếng). Bản
chuyển mã có 814 frame. Hai bản được giải mã từng frame trong Chrome (thumbnail xám 64×36) rồi dóng
hàng đơn điệu (quy hoạch động). Script và kết quả: `artifacts/prompt-08/media/`.

- **Frame lặp hoặc mất do chuyển mã:**
  - Không có frame nào bị mất mà nhìn thấy được. 14 frame gốc không xuất hiện đều nằm trong đoạn
    hình tĩnh (thẻ tiêu đề trắng ở giây đầu).
  - Không có frame lặp nào trong lúc hình chuyển động. 13 lần "lặp" đều ở 0,5 s cuối: frame cuối
    được giữ cho tới hết phần tiếng; bản gốc cũng có 0,5 s tiếng sau frame cuối.
- **Đồng bộ:** độ lệch thời gian giữa bản chuyển mã và bản gốc cố định ~0,044 s (≈ 1 frame) từ đầu
  đến cuối, không trôi.
- **Nhịp frame không đều** (do ghi theo thời gian thực):
  - Khoảng cách giữa hai frame dao động 30–52 ms, thay vì đều 40 ms.
  - Có một khoảng hở 514 ms ở frame thứ 11, rơi đúng vào đoạn thẻ tiêu đề tĩnh.
  - Remux giữ nguyên các timestamp này, vì đổi chúng sẽ làm lệch hình với tiếng. Muốn nhịp đều
    phải mã hoá lại từ bản gốc theo cách tất định; việc đó chưa làm.
- **Nén:** chênh lệch trung bình so với bản gốc là 1,7/255 (tối đa 6,9) trên thumbnail; bản nén
  1,4 Mbit/s nhẹ hơn bản gốc (~4,3 Mbit/s).
- **Frame drop khi phát** là chuyện riêng của trình duyệt (`getVideoPlaybackQuality`). Chrome
  headless trên máy phát triển báo 0 frame bị bỏ (số đo trong `report.json`, mục `film`). Số lần
  render của cảnh 3D không phải là FPS của tệp.

### Dòng ghi công hiển thị

Trình phát luôn hiện (desktop, mobile dọc, mobile ngang, chế độ 2D):

> (c) copyright 2008, Blender Foundation / www.bigbuckbunny.org · CC BY 3.0

với liên kết tới https://peach.blender.org/about/ và trang giấy phép. Nếu đổi giao diện player, giữ
nguyên dòng này (nguồn: `DEMO_FILM.credit` trong `src/cinema/media.ts`).

### Phụ đề

Trailer không có lời thoại (chỉ chữ trên hình và nhạc), nên không có phụ đề đi kèm; player chưa hỗ trợ
phụ đề (`captions: null`).

## Clip kiểm tra nội bộ (không phát hành)

`fixtures/media/` chứa các clip **do code sinh ra** bằng `node scripts/make-media-fixtures.mjs`
(canvas + Web Audio trong Chrome, ghi bằng `MediaRecorder`): bảng màu 16:9, 9:16, 2,39:1, bản không
tiếng, bản WebM không có thời lượng, một tệp không phải video và một tệp hỏng dữ liệu. Không dùng hình
hay âm thanh bên ngoài. Chỉ dùng cho `npm run capture` qua `?film=<tên tệp>` ở chế độ dev; `vite build`
không chép thư mục này vào `dist/`.

## Ảnh của trang mở đầu (Prompt 09)

`public/brand/*` (hero 16:9 và dọc, ba ảnh "Cách sử dụng", ảnh chia sẻ 1200 × 630) và
`public/apple-touch-icon.png`, `public/favicon.svg`:

- **Nguồn:** kết xuất từ chính khán phòng 3D của dự án (`node scripts/capture-brand-assets.mjs`,
  Chrome cục bộ, chất lượng Cao, tỷ lệ điểm ảnh 2). Không dùng ảnh rạp, logo hay font bên ngoài.
- **Màn chiếu không có frame phim nào.** Màn hiện một tấm slate do script vẽ bằng canvas: dấu
  hình học và chữ "Tân Phong Cinema". Slate được đưa vào qua tham số `?poster=` *chỉ có ở chế độ dev*;
  tệp nằm ở `fixtures/brand/screen-slate.png`, không vào `dist/`.
  - Nguồn phim của khán phòng (Big Buck Bunny và poster của nó) không đổi.
- **Ảnh bước 2 và 3** là ảnh chụp giao diện thật của trang `/cinema`. Trong đó có dòng ghi công Big
  Buck Bunny của trình phát (chữ), nhưng không có hình của phim.
- **Ghi công video:** footer của trang mở đầu vẫn ghi công *Big Buck Bunny* (CC BY 3.0), vì video này
  được phát trong phòng chiếu mà trang dẫn vào.
- **Mã hoá:** WebP (và JPEG dự phòng) bằng canvas của Chrome. AVIF không dùng được: canvas của Chrome
  không mã hoá AVIF và không cài thêm công cụ nào.
