# Checklist phát hành — Phòng chiếu 3D (sau Prompt 08)

Cập nhật 28/10/2026. Phạm vi: trang `/cinema` (ba tác vụ Khám phá, Chọn ghế, Xem phim), trang kiểm tra
ghế `/cinema?inspect=seat`, video demo. Chưa có trang mở đầu (Prompt 09).

"Đã kiểm chứng" chỉ có nghĩa là trên **Chrome 156 desktop (Windows 11, headless, ANGLE D3D11, RTX
3090)**, kể cả các kích thước mobile và tablet *giả lập* bằng chế độ thiết bị của Chrome. Không có thiết
bị thật, Safari, Firefox hay trình đọc màn hình thật nào được dùng.

## 1. Đã kiểm chứng (Chrome 156 desktop, kể cả giả lập mobile/tablet)

Bằng chứng: `npm test`, `npm run typecheck`, `npm run build`, `npm run capture`
(`artifacts/prompt-08/report.json`), `npm run measure:build` (`artifacts/prompt-08/build-metrics.json`).

**Giao diện và bố cục**
- [x] Ba tác vụ dùng chung một scene, renderer, camera, lựa chọn ghế, một phần tử video và cài đặt
  chất lượng. Đổi tác vụ không tạo canvas, listener hay video mới, không tự phát, không dời camera.
  Đã thử 64 lần đổi tác vụ và 32 lần mở/đóng panel, menu.
- [x] Đo tỷ lệ canvas thực tế ở 7 kích thước:
  - 1440×900, 1280×720, 820×1180, 1180×820, 390×844, 360×640, 844×390;
  - ở Khám phá và Xem phim, canvas cao ≥ 55 % viewport (bảng số trong `docs/handoff-prompt-08.md`).
- [x] Mobile dọc: sơ đồ là sheet nửa màn hình, hoặc toàn màn hình dạng dialog khi người dùng chủ động
  mở rộng. Không còn dải canvas 14 % hay 0,3 %.
- [x] Kích thước header, dock và canvas không đổi khi: bắt đầu/dừng tham quan; play/pause; chọn 1→8
  ghế; nút mini của phim xuất hiện.
- [x] Không tràn ngang hay dọc ở mọi trạng thái đã đo; zoom 200 % (720×450, 640×360 CSS px) vẫn dùng
  được.
- [x] Thanh trình duyệt co giãn 70 px (giả lập bằng đổi chiều cao viewport): canvas co theo, không
  có frame trắng.

**Focus, bàn phím, input**
- [x] Thứ tự Tab theo tác vụ. Phần ẩn (panel đóng, menu đóng, dock của tác vụ khác) không nằm trong
  thứ tự Tab.
- [x] Escape đóng menu hoặc panel và trả focus về nút mở.
- [x] Sheet toàn màn hình là dialog modal: bẫy focus, phần còn lại `inert`, Escape lùi từng bước.
- [x] Chuỗi thao tác chỉ bằng bàn phím: chọn ghế → xem từ ghế → phát, tua, tắt tiếng, tạm dừng.
- [x] Phím đang giữ khi đổi tác vụ không làm người đi bộ tiếp tục đi.
- [x] Thao tác trên UI không chọn ghế phía sau, không xoay camera, không phát hay dừng phim ngoài ý muốn.
- [x] Vùng chạm chính ≥ 44 × 44 CSS px trên màn cảm ứng. Ghế trong sơ đồ 36 px, cách nhau 5 px, sơ
  đồ cuộn ngang.

**Trạng thái và lỗi**
- [x] Đang tải phần 3D: sơ đồ ghế đã dùng được.
- [x] Tải phần 3D thất bại: báo lỗi, "Thử lại" (Chrome tải lại được), sơ đồ và video 2D vẫn dùng được.
- [x] Mất context không được trả lại: sau 5 s có "Dựng lại cảnh 3D", giữ ghế, góc nhìn từ ghế, video
  và vị trí phát.
- [x] Lỗi video: "Thử lại" chỉ tải lại video, không dựng lại scene.
- [x] Không có WebGL: bắt đầu ở Chọn ghế; một video 2D; điều khiển camera bị khoá và có ghi lý do.
- [x] Giảm chuyển động: tham quan theo từng điểm; không có spinner quay hay chuyển động của panel.

**Tải và phát hành**
- [x] Bản build: `/cinema` mở trực tiếp và sau refresh; `/` chuyển sang `/cinema`; `?inspect=seat`
  chạy; đường dẫn lạ ra trang "Không tìm thấy".
- [x] MIME type đúng; video trả về 206 cho request range; `?film=` bị bỏ qua và fixture không có
  trong `dist/`.
- [x] Mã cho màn hình đầu là chunk riêng (UI); phần 3D tải song song; video không tải trước khi bấm
  Phát, ngoài phần đầu tệp chứa metadata.

**Video**
- [x] Credits CC BY luôn trên màn ở mọi tác vụ: dưới caption ở Khám phá/Chọn ghế, trong player ở Xem
  phim. Có check ở 7 kích thước; chế độ 2D có check riêng.
- [x] Tắt tiếng và âm lượng đọc lại đúng từ phần tử video.
- [x] Có track tiếng được giải mã.

## 2. Chưa kiểm chứng

- [ ] **Âm thanh bằng tai** — chưa nghe; chỉ biết track tiếng được giải mã và các thuộc tính
  mute/volume đúng.
- [ ] **Điện thoại và máy tính bảng thật** (iOS Safari, Android Chrome): cảm ứng thật, thanh địa chỉ
  thật, safe area/notch, bàn phím ảo, hiệu năng GPU, nhiệt, pin.
- [ ] **Safari / WebKit, Firefox:** không có trong môi trường. Các điểm riêng cần thử:
  - Safari: `inert`, `dvh`, `requestVideoFrameCallback`, MP4 H.264 High, `playsInline`, volume trên iOS;
  - Firefox: rVFC từ bản 132.
- [ ] **Trình đọc màn hình thật** (NVDA, VoiceOver, TalkBack). Mới kiểm tra thuộc tính ARIA và hành vi
  phím bằng script.
- [ ] **Cấu hình cache trên Vercel** (`vercel.json`, mục `headers`) — cú pháp chưa được Vercel xác
  nhận vì chưa deploy.
- [ ] **Mạng chậm thật.** Mới giả lập: 1,6 Mbit/s với RTT 150 ms qua CDP, và giữ request ở route
  Playwright.
- [ ] **Bộ nhớ GPU:** không đo trực tiếp; chỉ có số đếm `renderer.info`, đối tượng JS sống sau GC
  và heap JS.
- [ ] **Độ tương phản ở mọi trạng thái:** mới tính tỷ lệ WCAG cho 14 cặp màu chính, đều ≥ 5,6:1
  (bảng trong handoff). Chưa quét tự động mọi trạng thái, nhất là chữ đè trên khung 3D đang đổi.

## 3. Blocker thực sự

Không có blocker cho việc deploy bản demo trên Chrome desktop. Các mục "chưa kiểm chứng" ở trên là
rủi ro cho mobile, Safari và người dùng trình đọc màn hình. Những rủi ro đó cần người thử thủ công
trước khi gọi là "sẵn sàng cho mọi nền tảng".

## 4. Việc cần người dùng thử thủ công

1. **iPhone (Safari) và một máy Android (Chrome), dọc và ngang.** Làm hết luồng:
   - mở `/cinema`;
   - Khám phá: Tham quan, Đi bộ bằng cần điều khiển;
   - Chọn ghế: Mở sơ đồ, Mở rộng, chọn 2 ghế, Xem từ ghế này;
   - Xem phim: Phát, xoay máy, Tạm dừng;
   - quay lại Chọn ghế, kiểm tra ghế vẫn còn.
2. **Nghe tiếng:** Phát, tắt/bật tiếng, kéo âm lượng (desktop), dùng phím âm lượng (iOS).
3. **Thanh địa chỉ và notch:** cuộn hoặc chạm để thanh địa chỉ co/giãn; kiểm tra không có nút nào bị
   che bởi notch hay thanh điều hướng.
4. **VoiceOver (iOS/macOS) hoặc NVDA (Windows):**
   - đọc tên ba tác vụ, nút chính của player, sơ đồ ghế (lưới, trạng thái từng ghế);
   - live region không đọc liên tục.
5. **Safari desktop và Firefox:** mở `/cinema`, phát video, chọn ghế bằng bàn phím.
6. **Mạng thật chậm** (3G/4G yếu): thời gian tới khi trang dùng được, tới khi cảnh sẵn sàng, và video
   khi bấm Phát.

## 5. Điều kiện trước khi commit / push / deploy

- [ ] Duyệt Prompt 08 (bản bàn giao này) và ảnh/video trong `artifacts/prompt-08/`.
- [ ] `npm test`, `npm run typecheck`, `npm run build` sạch trên máy sẽ build. Harness
  `npm run capture` và `npm run measure:build` cần Chrome hoặc Edge cài sẵn.
- [ ] Kiểm tra `git status`: chỉ có thay đổi dự kiến; không đưa `artifacts/prompt-08-dev` (nếu còn)
  hay tệp tạm vào commit.
- [ ] Sau khi deploy lên Vercel preview:
  - mở `/cinema` trực tiếp và refresh;
  - xem header `Cache-Control` của `index.html` (`no-cache`), của `/assets/*` (`immutable`) và của
    `/media/*.mp4` (mặc định của Vercel, có `206` cho range).
- [ ] Làm các mục ở phần 4 trên ít nhất một iPhone và một Android trước khi quảng bá cho người dùng
  mobile.
- [ ] Giữ dòng ghi công CC BY của Big Buck Bunny ở mọi nơi phát video (xem `docs/media-credits.md`).
