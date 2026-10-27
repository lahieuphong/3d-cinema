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
| Tệp trong dự án | `public/media/big-buck-bunny-trailer-720p.mp4`, `public/media/big-buck-bunny-trailer-poster.jpg` |

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
