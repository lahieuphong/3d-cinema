# Checklist phát hành — Tân Phong Cinema (sau Prompt 10)

Cập nhật 28/10/2026 (Prompt 10: rà soát phát hành). Chi tiết và bằng chứng:
[release-audit-prompt-10.md](release-audit-prompt-10.md). Kế hoạch preview:
[preview-deployment-plan.md](preview-deployment-plan.md).

**Trạng thái:**
- `main` = `f55ef30` (Prompt 09), đã push và **đang chạy trên production** (`tp3d-cinema.vercel.app`).
- Bản sửa hosting của Prompt 10 chưa commit, chưa deploy.

Phạm vi:
- trang mở đầu `/`;
- phòng chiếu `/cinema` (ba tác vụ Khám phá, Chọn ghế, Xem phim);
- trang kiểm tra ghế `/cinema?inspect=seat`;
- video demo.

"Tân Phong Cinema" là tên làm việc, chưa phải thương hiệu được duyệt.

"Đã kiểm chứng" chỉ có nghĩa là trên **Chrome 156 desktop (Windows 11, headless, ANGLE D3D11, RTX
3090)**, kể cả các kích thước mobile và tablet *giả lập*, cùng các luồng chính trên **Edge 156**
(cũng là Blink). Không có thiết bị thật, Safari, Firefox hay trình đọc màn hình thật nào được dùng.

## 1. Đã kiểm chứng

Bằng chứng (ứng viên Prompt 10; kết quả ở mục 9 của bản rà soát):
- `npm test`, `npm run typecheck`, `npm run build`;
- `npm run capture`: harness trên dev server, `artifacts/prompt-10/report.json`;
- `npm run measure:build`: bản production trên `vite preview`, `artifacts/prompt-10/build-metrics.json`;
- `npm run acceptance`: 14 luồng nghiệm thu trên bản production, Chrome và Edge.

Ảnh và báo cáo trong `artifacts/` chỉ ở máy; từ Prompt 10 chúng không vào Git.

**Nghiệm thu trên bản production (Prompt 10, `scripts/acceptance.mjs`)**
- [x] Landing → rạp → chọn ghế → nhìn từ ghế → Phát/Tạm dừng → Trở về; tour → dừng → đi bộ → sơ đồ.
- [x] Điện thoại dọc → ngang; sơ đồ toàn màn hình với Escape và focus trả về.
- [x] Đổi chất lượng; mất/khôi phục WebGL; inspector và Back.
- [x] Rời rạp khi đang phát (0 video/canvas/WebGL sau GC); 4 vòng Back/Forward.
- [x] Giảm chuyển động; landing không JavaScript; không WebGL (sơ đồ + video 2D).
- [x] Lỗi tải video; lỗi tải mã rạp rồi Thử lại.

**Trang mở đầu (Prompt 09)**
- [x] `/` là trang mở đầu, không chuyển hướng. Nội dung, ảnh và liên kết có ngay trong HTML, nên đọc
  được khi không có JavaScript (đã thử với JS tắt).
- [x] "Bước vào rạp" là liên kết thật tới `/cinema`:
  - click thường: điều hướng trong app một lần, màn "Đang mở phòng chiếu…" hiện ngay;
  - Ctrl/⌘/Shift/click giữa: mở tab mới;
  - bấm nhiều lần chỉ tạo một mục history.
- [x] Back/Forward giữa landing và rạp; refresh cả hai route; `/cinema/` có dấu `/` cuối; trang "Không
  tìm thấy"; link trong trang (`#cach-su-dung`) không dựng lại trang.
- [x] Landing không tải mã phòng chiếu, three.js hay video trước khi người dùng tương tác (bản
  production).
  - Hover/focus/nhấn CTA chỉ tải mã, không tạo canvas, WebGL hay video.
  - Save-Data: không tải trước.
- [x] Mã tải chậm thì có màn chờ rõ ràng. Mã tải lỗi thì có "Thử lại" (tải lại được) và "Về trang chủ".
  Back khi mã chưa tải xong thì không mount rạp phía sau.
- [x] Ra/vào rạp nhiều lần:
  - ở landing không còn canvas, video hay context WebGL (đếm sau GC); listener và heap ổn định;
  - rời trang khi phim đang phát thì không còn gì phát;
  - vào lại: một canvas; ghế, chất lượng và vị trí phim (tạm dừng) giữ nguyên; camera ở Tổng quan.
- [x] Bố cục ở 7 kích thước + zoom 200 %:
  - CTA ở màn hình đầu; không tràn ngang; header ≤ 80 px;
  - chữ không đè màn chiếu trong ảnh; nút ≥ 44 px; heading h1 → h2 → h3.
- [x] Giảm chuyển động: không có hiệu ứng vào, không parallax.
- [x] Parallax chỉ với chuột: ≤ 10 px, dừng xin frame khi đứng yên; tắt khi hero ra khỏi màn hình.
  Landing đứng yên: 0 animation frame.
- [x] Bàn phím: "Bỏ qua, tới nội dung chính" là điểm Tab đầu; vào rạp và về trang chủ bằng Enter;
  focus rõ.
- [x] Không có WebGL: landing → vào rạp → video 2D phát và tạm dừng.
- [x] Metadata riêng cho `/` và `/cinema` ngay trong HTML (title, description, canonical, Open Graph,
  icon, `lang="vi"`); ảnh chia sẻ có trong `dist/`.
- [x] Ảnh trên trang là kết xuất của chính khán phòng; màn chiếu trong ảnh là slate, không có frame phim.

**Phòng chiếu (Prompt 05–08, chạy lại toàn bộ)**
- [x] Ba tác vụ dùng chung scene, camera, lựa chọn ghế, video và chất lượng.
- [x] Tỷ lệ canvas ≥ 55 % chiều cao ở Khám phá và Xem phim, 7 kích thước.
- [x] Sheet và dialog toàn màn hình, focus, Escape, phím đang giữ.
- [x] Loading, lỗi tải 3D, context không trả lại, lỗi video, không WebGL, giảm chuyển động.
- [x] Tour, đi bộ, chọn ghế và sơ đồ, xem từ ghế, video, chất lượng, mất/khôi phục context, inspector.
- [x] Credits CC BY luôn trên màn ở mọi tác vụ; footer trang mở đầu cũng ghi công video.

**Hosting: production đang chạy `f55ef30` (Prompt 09)**

Kiểm tra bằng vài request đơn lẻ ngày 28/10/2026, và
`BASE_URL=https://tp3d-cinema.vercel.app ACCEPTANCE_ONLY=hosting npm run acceptance`.
- [x] Đúng bản build: commit status `Vercel — success` của `f55ef30`; tên các chunk có hash trùng bản build
  cục bộ.
- [x] `/` → landing; `/cinema`, `/cinema/`, `/cinema?inspect=seat` → `cinema.html`; HTML `no-cache`;
  canonical và `og:url` riêng cho `/` và `/cinema`.
- [x] `/assets/*`: `public, max-age=31536000, immutable`, kiểu JS đúng.
- [x] `/brand/*`, `/media/*`: mặc định `max-age=0, must-revalidate`, không `immutable`.
- [x] Video: 206 khi Range ở đầu tệp và khi tua, `video/mp4`.
- [ ] **Lỗi:** tệp thiếu (`/assets/…`, `/brand/…`, `/media/…`, `/favicon.ico`) trả landing HTML với mã 200,
  dưới `/assets/` còn kèm `immutable`.
  - Đã sửa trong `vercel.json` (Prompt 10, chưa commit).
  - Cấu hình đã kiểm tra bằng `measure:build`.
  - Trên Vercel: **chờ preview**.

## 2. Chưa kiểm chứng

- [ ] **Âm thanh bằng tai** — chưa nghe; chỉ biết track tiếng được giải mã và mute/volume đúng.
- [ ] **Điện thoại và máy tính bảng thật** (iOS Safari, Android Chrome):
  - cảm ứng, thanh địa chỉ, safe area/notch, bàn phím ảo;
  - hiệu năng GPU, nhiệt, pin;
  - landing: cuộn, ảnh dọc, chuyển trang.
- [ ] **Safari / WebKit, Firefox:** không có trong môi trường. Điểm riêng cần thử:
  - Safari: `inert`, `dvh`/`svh`, `requestVideoFrameCallback`, MP4 H.264 High, `playsInline`, volume
    trên iOS, `text-wrap: balance`;
  - Firefox: rVFC từ bản 132.
- [ ] **Trình đọc màn hình thật** (NVDA, VoiceOver, TalkBack): mới kiểm tra thuộc tính ARIA, focus và
  phím bằng script.
- [ ] **Bản sửa hosting của Prompt 10 trên Vercel** (chờ preview):
  - tệp thiếu trả 404, trang lạ vẫn về app;
  - header `Cache-Control` của 404 dưới `/assets/`;
  - `.vercelignore` có áp cho deploy qua Git không (log build hoặc `/_src`);
  - Deployment Protection của preview.
- [ ] **Tab mở từ trước một lần deploy mới:** chunk cũ không còn, "Thử lại" không giúp, phải tải lại trang.
  Chưa xử lý.
- [ ] **Ảnh chia sẻ trên mạng xã hội thật** (Facebook, Zalo, X…): thẻ Open Graph có trong HTML, nhưng
  chưa thử với trình thu thập của từng nơi.
- [ ] **Mạng chậm thật:** mới giả lập 1,6 Mbit/s, RTT 150 ms (CDP) và giữ request ở route Playwright.
- [ ] **Bộ nhớ GPU:** không đo trực tiếp.
- [ ] **Độ tương phản ở mọi trạng thái:**
  - mới tính tỷ lệ WCAG cho các cặp màu chính (rạp ≥ 5,6:1, landing ≥ 7:1 trên lớp phủ của ảnh);
  - chưa quét tự động mọi trạng thái.

## 3. Lỗi chặn

- **Bản preview:** không có lỗi chặn.
- **Production:** đang có lỗi tệp thiếu → 200 HTML (phần 1, Hosting). Bản sửa cần qua preview rồi người dùng
  mới đưa lên `main`.
- **Mobile, Safari/Firefox, người dùng trình đọc màn hình:** các mục ở phần 2 là rủi ro. Cần thử tay trước
  khi gọi là "sẵn sàng cho mọi nền tảng".

## 4. Việc cần người dùng thử thủ công

1. **iPhone (Safari) và một máy Android (Chrome), dọc và ngang.**
   - Mở `/`, cuộn trang, bấm "Cách trải nghiệm", rồi "Bước vào rạp".
   - Trong rạp: Khám phá (Tham quan, Đi bộ); Chọn ghế (Mở sơ đồ, Mở rộng, chọn 2 ghế, Xem từ ghế này);
     Xem phim (Phát, xoay máy, Tạm dừng).
   - Bấm tên "Tân Phong Cinema" để về trang chủ; Back để vào lại; kiểm tra ghế vẫn còn.
2. **Nghe tiếng:**
   - Phát, tắt/bật tiếng, kéo âm lượng (desktop), dùng phím âm lượng (iOS);
   - rời rạp khi đang phát: không còn tiếng.
3. **Thanh địa chỉ và notch:** cuộn hoặc chạm để thanh địa chỉ co/giãn; không nút nào bị che.
4. **VoiceOver (iOS/macOS) hoặc NVDA (Windows):**
   - landing: liên kết "Bỏ qua…", h1, ba bước;
   - rạp: ba tác vụ, nút chính của player, sơ đồ ghế;
   - live region không đọc liên tục.
5. **Safari desktop và Firefox:** landing → rạp → phát video → chọn ghế bằng bàn phím → về trang chủ.
6. **Mạng thật chậm** (3G/4G yếu): thời gian tới khi landing hiện, tới khi vào được rạp, và video khi
   bấm Phát.
7. **Chia sẻ đường dẫn** `/` và `/cinema` lên một mạng xã hội hoặc ứng dụng nhắn tin: xem ảnh và tiêu
   đề.
8. **Tên "Tân Phong Cinema"** và nhận diện tạm: xác nhận hoặc đổi trong `src/brand.ts` (rồi chạy lại
   `node scripts/capture-brand-assets.mjs` nếu đổi tên trên slate).

## 5. Điều kiện trước khi commit / push / deploy

- [ ] Người dùng duyệt Prompt 10: bản rà soát, kế hoạch preview, commit đề xuất (mục 12 của bản rà soát).
- [ ] Người dùng quyết có ngừng theo dõi `artifacts/prompt-09/` không (commit 1, tuỳ chọn). Tệp vẫn ở máy.
- [ ] `npm test`, `npm run typecheck`, `npm run build` sạch.
  - Trên Windows chạy từ thư mục có ổ đĩa viết hoa: `cmd /c "cd /d E:\Phong_Nho_IT\3d-cinema && npm test"`.
    Nếu process chạy từ `e:\…` (chữ thường), npm nạp hai bản Vitest và mọi suite báo "no tests"
    (Prompt 08 đã tái hiện chắc chắn, 4/4 lần; `process.chdir` trong config không giúp).
  - `npm run capture`, `npm run measure:build`, `npm run acceptance` cần Chrome hoặc Edge cài sẵn.
- [ ] `git status --short`: chỉ có các đường dẫn ở mục 12 của bản rà soát.
  - Stage từng đường dẫn, không dùng `git add .`.
  - `artifacts/` bị `.gitignore` loại.
  - `fixtures/` là tệp dev, không vào `dist/`.
- [ ] Deploy preview theo [preview-deployment-plan.md](preview-deployment-plan.md):
  - đẩy nhánh `preview/p10-release-audit`; **không push `main`** (`main` tự deploy production);
  - xác nhận commit status `Vercel` của đúng SHA;
  - chạy `BASE_URL=<preview> ACCEPTANCE_ONLY=hosting npm run acceptance`, rồi một lượt đầy đủ, rồi thử tay;
  - chỉ gửi request đơn lẻ, không chạy vòng lặp: Vercel có checkpoint chống bot.
- [ ] Đưa lên production (merge hoặc push `main`) chỉ khi người dùng quyết, sau khi preview đạt.
- [ ] Làm các mục ở phần 4 trên ít nhất một iPhone và một Android trước khi quảng bá cho người dùng
  mobile.
- [ ] Giữ dòng ghi công CC BY của Big Buck Bunny ở mọi nơi phát video và trong footer trang mở đầu
  (xem `docs/media-credits.md`).
