# Rà soát phát hành — Prompt 10

Ngày 28/10/2026. Phạm vi:
- phiên bản ở `main` (`f55ef30`, Prompt 09);
- các thay đổi chưa commit của Prompt 10.

Prompt 10 không thêm tính năng, không commit, không push, không deploy.

Kế hoạch deploy preview: [preview-deployment-plan.md](preview-deployment-plan.md). Checklist:
[release-checklist.md](release-checklist.md).

## 1. Git baseline (xác minh bằng Git, không suy đoán)

| Mục | Kết quả |
| --- | --- |
| Repo root | `E:/Phong_Nho_IT/3d-cinema` |
| Nhánh | `main`, theo dõi `origin/main` |
| Remote | `origin` → `https://github.com/lahieuphong/3d-cinema.git`; `ls-remote`: chỉ có `refs/heads/main` = `f55ef30` |
| HEAD | `f55ef30` = `origin/main`; working tree sạch khi bắt đầu Prompt 10; không có stash |
| Kích thước `.git` | 667 MiB đối tượng rời (chưa pack) |

Các commit gần nhất (mới nhất trước):

| SHA | Nội dung |
| --- | --- |
| `f55ef30` | Add landing page and cinema entry route (prompt 09) — 28/10 13:11 +07 |
| `368d8f4` | Add task-based UI, responsive layout and release QA (prompt 08) — 28/10 11:22 +07 |
| `3ed4a3a` | Add video playback on the 3D cinema screen (prompt 07) |
| `8c92391` | Add seat selection with synced 2D seat map (prompt 06) |
| `992bb21` | Add camera tour, explore mode and collision (prompt 05) |
| `ce8d7f7` | Add materials, lighting and render quality tiers (prompt 04) |
| `d12cd26` | Add procedural cinema seats and interior architecture (prompts 02-03) |
| `90655a7` | Add Vercel config with SPA rewrite for /cinema |
| `f9778cb` | Initial commit |

**`368d8f4` (Prompt 08)** có tồn tại, gồm 398 tệp:
- 374 tệp `artifacts/prompt-08/`;
- source UI theo tác vụ (`taskLayout.ts`, `seatSummary.ts`…), `vercel.json`, video đã remux;
- `scripts/remux-mp4.mjs`, `measure-build.mjs`, tài liệu.

**`f55ef30` (Prompt 09)** gồm 446 tệp:
- toàn bộ mã Prompt 09 và ảnh thương hiệu;
- 400 tệp `artifacts/prompt-09/` (274,5 MB).

Báo cáo Prompt 09 viết "chưa commit, chưa deploy". Git cho thấy cả hai commit đã có trên `origin/main`,
do tài khoản `lahieuphong` tạo (theo metadata của commit). Không reset, không sửa lịch sử.

**Production đã chạy Prompt 09.**
- Commit status trên GitHub của `f55ef30`: `Vercel — success — Deployment has completed`, 06:12:34Z.
  Của `368d8f4`: 04:23:57Z.
- `https://tp3d-cinema.vercel.app/cinema` trả đúng tên các chunk có hash của bản build cục bộ từ cùng source
  (`main-D_k_CDc0.js`, `page-UxLl9iyQ.js`…).
- Vậy mục "cấu hình Vercel của Prompt 09 chưa deploy" trong `handoff-prompt-09.md` đã cũ. Mục 6 bên dưới
  thay cho nó.

## 2. Phạm vi diff của Prompt 10 (so với HEAD)

| Tệp | Thay đổi | Vì sao |
| --- | --- | --- |
| `vercel.json` | Rewrite dự phòng chỉ áp cho đường dẫn trang | Sửa lỗi tệp thiếu trả landing HTML với mã 200 (mục 5) |
| `.vercelignore` (mới) | Bỏ `/artifacts`, `/fixtures`, `/dist` khi tải lên Vercel | Vercel CLI tải lên mọi tệp không có trong danh sách mặc định; `.gitignore` không áp |
| `.gitignore` | Thêm `/artifacts/` | Ảnh/video QA giữ trên máy (mục 3) |
| `scripts/acceptance.mjs` (mới), `package.json` (`npm run acceptance`) | Luồng nghiệm thu trên bản production; kiểm tra hosting với `BASE_URL` | Kiểm chứng ứng viên cuối và bản preview sau này |
| `scripts/measure-build.mjs` | Kiểm tra quy tắc `vercel.json` trên `dist/`; check "video thôi đọc khi để yên"; ghi vào `prompt-10` | Mục 6 và 9 |
| `scripts/capture-views.mjs` | Thư mục mặc định `prompt-10` | Không ghi đè ảnh Prompt 09 |
| `docs/release-audit-prompt-10.md`, `docs/preview-deployment-plan.md` (mới), `docs/release-checklist.md` | Tài liệu | Mục 13 của prompt |

Không đổi `src/`, `public/`, `index.html`, `cinema.html`, `vite.config.ts` hay dependency. Vì vậy bản build
giống hệt bản đang chạy production: cùng tên chunk có hash.

## 3. Phân loại phạm vi phát hành

| Nhóm | Đường dẫn | Dung lượng | Chính sách |
| --- | --- | ---: | --- |
| **A. Source và cấu hình** | `src/`, `index.html`, `cinema.html`, `vite.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, `vercel.json`, `.vercelignore`, `.gitignore` | ~1 MB | Commit |
| **B. Public assets** | `public/media/` (video 8 347 668 B + poster 100 075 B), `public/brand/` (22 ảnh), `favicon.svg`, `apple-touch-icon.png` | 8,97 MB | Commit; đều có trong `dist/` và đều được tham chiếu (đã đối chiếu từng tệp) |
| **C. Test, scripts, fixture** | `src/**/*.test.ts`, `scripts/*.mjs`, `fixtures/media/` (7 clip do code sinh), `fixtures/brand/screen-slate.png` | fixture 2,61 MB | Giữ; fixture không vào `dist/` (kiểm tra trong `measure:build`) |
| **D. Tài liệu** | `docs/*.md` | nhỏ | Commit |
| **E. QA lớn** | `artifacts/` | xem dưới | Không commit thêm; giữ trên máy |
| **F. Tạm, cache** | `node_modules/`, `dist/`, `*.log`, `artifacts/*/logs/` | — | Đã bị `.gitignore` loại; không có `.env`, profile trình duyệt hay cookie trong repo |

**Ảnh/video QA (E):**
- Đang được Git theo dõi ở HEAD: Prompt 01–09, 1 500 tệp, ~881 MB:

  | Prompt | Dung lượng |
  | --- | ---: |
  | 01 | 1,7 MB |
  | 02 | 7,9 MB |
  | 03 | 14,4 MB |
  | 04 | 29,4 MB |
  | 05 | 73,3 MB |
  | 06 | 109,4 MB |
  | 07 | 135,7 MB |
  | 08 | 235,2 MB |
  | 09 | 274,5 MB |

- Tệp lớn nhất: các `video-tour.webm` 12–14 MB. Không tệp nào chạm giới hạn 100 MB của GitHub.
- Trên máy: `artifacts/` 885 MB, gồm log không được theo dõi; `artifacts/prompt-10/` là của lượt này, chỉ ở
  máy.

**Chính sách đề xuất:**
- Từ Prompt 09 trở đi, ảnh/video QA ở máy; tóm tắt và cách tái tạo ở `docs/`.
- `artifacts/prompt-09/` đã nằm trong `f55ef30` và đã push, nên:
  - không viết lại lịch sử (dung lượng `.git` không giảm, việc này cần người dùng quyết riêng);
  - phương án bỏ theo dõi mà vẫn giữ tệp ở máy:
    `git rm -r --cached artifacts/prompt-09` + dòng `/artifacts/` trong `.gitignore` (commit 1, mục 12).
  - Ảnh của Prompt 01–08 vẫn được theo dõi như người dùng đã commit. Bỏ theo dõi chúng là lựa chọn riêng,
    không đề xuất trong lượt này.
- Không dùng Git LFS.

**Tệp thừa và trùng:**
- Không có tệp trùng hash trong `public/` và `fixtures/`.
- Mọi tệp `public/` đều được tham chiếu: ảnh thương hiệu ghép tên động trong `src/landing/content.ts`, có
  trong `dist/index.html`.
- Mọi fixture đều được `capture-views.mjs`, `make-media-fixtures.mjs` hoặc `capture-brand-assets.mjs` dùng.
  `screen-slate.png` do `capture-brand-assets.mjs` vẽ lại mỗi lần chạy.

**Dung lượng riêng từng phần:**

| Phần | Dung lượng |
| --- | ---: |
| Sản phẩm (`public/`) | 8,97 MB |
| `dist/` | 10,0 MB (assets 1,01 MB, video 8,06 MB, ảnh thương hiệu 0,91 MB, HTML + icon 17 kB) |
| Fixture | 2,61 MB |
| QA đã commit | ~881 MB |
| QA Prompt 09 trên máy | 274,9 MB |

## 4. Thông tin nhạy cảm

Đã quét các tệp được theo dõi (`git ls-files`, `git grep`):
- tên tệp `.env`, khoá, cookie, storage state, profile, `.har`;
- nội dung dạng token/khoá: API key, bearer, private key, `ghp_`, `github_pat_`, `sk-`, `AKIA`,
  `VERCEL_TOKEN`, `NPM_TOKEN`;
- đường dẫn cá nhân (`C:\Users\…`, `AppData`) và địa chỉ email.

**Không phát hiện gì.**
- Từ "token" chỉ có trong mã như "token thế hệ" của `mediaController`.
- Log của harness có đường dẫn máy. Chúng nằm trong `artifacts/*/logs/`, bị `*.log` / `logs` trong
  `.gitignore` loại. Với deploy bằng CLI, `.vercelignore` mới cũng loại chúng.
- Profile trình duyệt của automation là thư mục tạm của Playwright, không nằm trong repo.

## 5. Vấn đề phát hiện và đã sửa

### 5.1 Tệp thiếu trả landing HTML với mã 200 (có trên production)

**Bằng chứng** (production, mỗi đường dẫn một request, 28/10/2026):

| Request | Trả về |
| --- | --- |
| `/assets/does-not-exist.js` | `200`, `text/html`, `Cache-Control: public, max-age=31536000, immutable` |
| `/brand/does-not-exist.webp` | `200`, `text/html` |
| `/media/khong-co.mp4`, `/favicon.ico` | `200`, `text/html` |

Lặp lại bằng `BASE_URL=https://tp3d-cinema.vercel.app ACCEPTANCE_ONLY=hosting npm run acceptance`:
6/7, chỉ hỏng mục tệp thiếu.

**Hậu quả.**
- Một chunk không còn tồn tại (ví dụ tab mở từ trước một lần deploy mới) nhận HTML. Trình duyệt từ chối
  vì sai MIME, và có thể **giữ HTML đó trong cache một năm** dưới URL của chunk.
- Ảnh hoặc video thiếu cũng nhận HTML thay vì lỗi.

**Nguyên nhân.** Rewrite dự phòng `/(.*)` → `/index.html` áp cho mọi đường dẫn không khớp tệp, kể cả trong
`/assets/`. Theo tài liệu Vercel, filesystem được ưu tiên trước rewrite: "precedence is given to the
filesystem prior to rewrites being applied" (vercel.com/docs/project-configuration/vercel-json, mục
rewrites, cập nhật 14/08/2026).

**Sửa.** Rewrite dự phòng nay là:

```
/((?!assets/|media/|brand/)(?!.*\.[^/]+$).*)
```

Nó bỏ qua ba thư mục tài nguyên và mọi đường dẫn có phần mở rộng tệp. Negative lookahead trong `source` có
trong ví dụ chính thức (`/((?!maintenance).*)`) và đã chạy trên production ở rule header hiện có.
- Đường dẫn trang lạ (`/khong-co`, `/cinema/x`) vẫn về `index.html`, để app hiện "Không tìm thấy trang".
- `/cinema`, `/cinema/` vẫn về `cinema.html`.

**Kiểm chứng đã có.**
- Cấu hình (`measure:build`, mô phỏng thứ tự của Vercel trên `dist/`):
  - trang → đúng tài liệu HTML;
  - `/assets/khong-co.js`, `/brand/khong-co.webp`, `/media/khong-co.mp4`, `/favicon.ico`, `/robots.txt`
    → 404;
  - tệp có thật phục vụ nguyên; đích của rewrite là tệp có thật; không có redirect nên không có vòng lặp.
- `vite preview` **không** mô phỏng được điều này: preview trả `index.html` 200 cho mọi tệp thiếu, cả trước
  và sau khi sửa. Không thêm middleware, vì `vite.config.ts` không có kiểu Node và không thêm dependency.
- **Trên Vercel: chờ preview.**

### 5.2 Gói tải lên Vercel bằng CLI

- Không có `.vercelignore`. Theo tài liệu Vercel ("Ignored files and folders" và ".vercelignore"), CLI chỉ
  bỏ một danh sách mặc định (`.git`, `node_modules`…), không dùng `.gitignore`.
- Hệ quả: `vercel deploy` từ máy này sẽ tải lên `artifacts/` (885 MB, gồm log có đường dẫn máy), `dist/` và
  `fixtures/`.
- Thêm `.vercelignore` với `/artifacts`, `/fixtures`, `/dist`. Build trên Vercel chỉ cần `src/`, `public/`,
  hai tệp HTML và các tệp cấu hình.
- Với deploy qua Git (cách project đang dùng), Vercel clone repo. Tài liệu nói về "upload", nên việc tệp này
  có áp cho deploy qua Git hay không là **chưa kiểm chứng (chờ preview**, xem log build hoặc `/_src`).
- Dù vậy `dist/` vẫn là thứ duy nhất được phục vụ (`outputDirectory`).

### 5.3 Ngưỡng "video đọc trước khi Phát"

Xem mục 8. Không đổi ngưỡng; thêm một check.

## 6. Hosting và route

**Ba mức kiểm chứng:**

| Mục | Cấu hình/source | `vite preview` (`dist/`) | Vercel production (`f55ef30`, trước sửa) | Vercel sau sửa |
| --- | --- | --- | --- | --- |
| `/` → landing HTML | đạt | đạt | đạt (200, `no-cache`) | chờ preview |
| `/cinema`, `/cinema/` → `cinema.html`; refresh | đạt | đạt | đạt | chờ preview |
| Query (`?inspect=seat`, `?utm_source`) | đạt (router bỏ qua query lạ) | đạt | đạt | chờ preview |
| Tệp thiếu → 404 | **đạt sau sửa** | không (luôn 200 HTML) | **không: 200 HTML** | chờ preview |
| Trang lạ → app báo "Không tìm thấy trang" | đạt | đạt | đạt (HTTP 200) | chờ preview |
| Không redirect, không vòng lặp | đạt (không có `redirects`) | — | đạt | chờ preview |
| Canonical: `/` và `/cinema`, khớp `og:url` | đạt | đạt | đạt | chờ preview |
| Range 206 (đầu tệp và khi tua) | — | đạt | đạt | chờ preview |

**Header cache đo trên production:**
- HTML (`/`, `/cinema`): `no-cache`;
- `/assets/*`: `public, max-age=31536000, immutable`, `application/javascript`;
- `/brand/*.webp`: `image/webp`, `public, max-age=0, must-revalidate` (mặc định của Vercel);
- video: `206`, `video/mp4`, `Content-Range: bytes 0-1023/8347668`, `public, max-age=0, must-revalidate`.

Như vậy:
- tệp không có hash (video, poster, ảnh thương hiệu, favicon) không bị `immutable`; trình duyệt hỏi lại
  bằng ETag;
- chỉ `/assets/*` (tên có hash) được cache dài.

**Hạn chế còn lại (không sửa trong lượt này):**
- Trang lạ là "soft 404": HTTP 200, HTML của landing với canonical `/`.
  - Có JavaScript: app hiện "Không tìm thấy trang".
  - Không có JavaScript: hiện nội dung landing.
  - Muốn trả 404 thật cần thêm trang `404.html`; để sau.
- `/index.html` và `/cinema.html` mở trực tiếp:
  - server trả đúng tệp (canonical của route thật);
  - router chỉ biết `/` và `/cinema` nên app hiện "Không tìm thấy trang".
  - Không có link nào dẫn tới hai địa chỉ này.
- Một chunk thiếu (sau khi sửa) trả 404, nhưng header `immutable` của rule `/assets/(.*)` có thể vẫn đi kèm.
  Vô hại với tên có hash; xác nhận trên preview.
- Tab mở từ trước một lần deploy mới: chunk cũ không còn.
  - Màn "Không mở được phòng chiếu" hiện ra, nhưng "Thử lại" không giúp được; phải tải lại trang.
  - Cải thiện sau: nút tải lại trang, hoặc Skew Protection của Vercel.
- Chưa có CSP hay security header. Không thêm theo checklist chung:
  - `index.html` và `cinema.html` có script/style inline;
  - còn WebGL, video, `blob:`;
  - cần thử riêng.

## 7. Credits và nhận diện

- **Video và poster khớp `docs/media-credits.md`:**
  - MP4: 8 347 668 B, SHA-256 `cd6885f6…862a3b`;
  - poster: 100 075 B, SHA-256 `5287d237…a2e99b`;
  - mô tả remux "fast start" của Prompt 08 đúng với tệp hiện tại.
- **Ghi công trên giao diện:**
  - trình phát: `DEMO_FILM.credit` + link giấy phép, ở mọi tác vụ;
  - footer landing: "(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org · CC BY 3.0", có link.
- **Ảnh thương hiệu:**
  - `share-1200.jpg`, hero và ba ảnh bước là kết xuất của chính khán phòng;
  - màn chiếu là slate thương hiệu, không có frame phim (đã xem lại `share-1200.jpg` và
    `step-3-960.jpg`);
  - ảnh bước 3 có dòng ghi công của trình phát.
- **Tên:**
  - `src/brand.ts` là nguồn cho title, metadata, wordmark, footer;
  - ngoại lệ: chữ "Tân Phong" vẽ trên slate nằm cứng ở `scripts/capture-brand-assets.mjs:84`. Đổi tên thì
    sửa cả chỗ này rồi chạy lại script.
- **"Tân Phong Cinema" vẫn là tên làm việc, chưa được duyệt.** Cần người dùng xác nhận hoặc đổi.

## 8. Ngưỡng video đọc trước khi Phát

**Lịch sử.**
- Prompt 08 đặt ≤ 20 % tệp và ≤ 2 request.
- Prompt 09 nâng lên 25 % sau một lượt đọc 1,84 MB (22 %). Hành vi của app không đổi:
  `preload="metadata"`, cùng tệp, cùng thời điểm nạp.

**Dữ liệu** (Chrome 156, bản production trên `vite preview`, cache tắt, profile mới mỗi lần):

| Lượt | Byte trước Phát | Tỷ lệ | Request |
| --- | ---: | ---: | ---: |
| P08 `measure:build` | 1 048 576 | 12,6 % | 1 |
| P09 baseline (mã P08) | 1 441 792 | 17,3 % | 1 |
| P09 lượt hỏng | ~1 840 000 | ~22 % | — |
| P09 cuối | 1 310 720 | 15,7 % | 1 |
| P10 đo riêng, 5 lượt | 957 440 – 1 703 936 | 11,5–20,4 % | 1–2 |
| P10 `measure:build` | 1 376 256 | 16,5 % | 1 |

- Ở 5 lượt đo riêng, số byte sau 10 s bằng đúng số byte sau 3 s: Chrome đọc một đoạn đầu cố định rồi dừng,
  không đọc dần theo thời gian.
- Landing không có request video nào trước tương tác (5/5 lượt; và check "landing (production)").

**Kết luận.**
- Biến động 0,96–1,84 MB thuộc bộ đệm đọc trước của Chrome.
- Giữ 25 % vì nó vẫn bắt được các regression đáng lo:
  - MP4 phân mảnh của Prompt 07: 7–10 request, 40–50 % tệp;
  - `preload="auto"`: đọc tiếp.
- Thêm check **"trước Phát, video thôi đọc khi để yên 5 s"**, bắt việc đọc không dừng mà không phụ thuộc
  ngưỡng.
- Không chạy lặp để tìm kết quả xanh: tổng cộng 6 lượt đo có chủ đích.

## 9. Kiểm tra ứng viên cuối

Ứng viên: working tree của Prompt 10, tức `f55ef30` cộng các tệp ở mục 2. `src/` không đổi; `dist/` build lại
cho cùng tên chunk.

| Kiểm tra | Kết quả | Log (ở máy, `artifacts/prompt-10/logs/`) |
| --- | --- | --- |
| `npm test` | **180/180** (12 tệp) | `test.log` |
| `npm run typecheck` | sạch | `typecheck.log` |
| `npm run build` | thành công; vẫn có cảnh báo chunk three.js > 500 kB | `build.log` |
| `npm run measure:build` | **21/21** (16 cũ + 4 hosting/cấu hình + 1 video thôi đọc) | `measure-build.log`, `artifacts/prompt-10/build-metrics.json` |
| `npm run acceptance`, Chrome 156.0.8078.47 | **16/16** (14 luồng + console sạch) | `acceptance-chrome.log` |
| `npm run acceptance`, Edge 156.0.4314.42 | **16/16** | `acceptance-edge.log` |
| `npm run capture` (harness đầy đủ, dev server) | **456/456**; 0 lỗi console ngoài dự kiến (12 dự kiến, từ các luồng cố tình gây lỗi) | `capture.log`, `artifacts/prompt-10/report.json` |
| Hosting production (trước sửa) | 6/7 (hỏng: tệp thiếu) | `acceptance-production-before-fix.log` |

Vitest chạy từ `cmd /c "cd /d E:\Phong_Nho_IT\3d-cinema && npm test"`; không gặp lỗi "no tests".

**Luồng nghiệm thu trên bản production** (`scripts/acceptance.mjs`; chỉ dùng giao diện, vì bản build không có
hook debug):

| Luồng | Nội dung | Cũng có trong harness (dev) |
| --- | --- | --- |
| A | Landing → rạp (một mục history) → chọn F06 → nhìn từ ghế → Phát/Tạm dừng → Trở về | flow A, "way in" |
| B | Tour → dừng → Đi bộ → mở sơ đồ | tour, explore |
| C | Điện thoại dọc → ngang: một canvas, buffer theo kích thước, không cuộn ngang | mobile → landscape |
| D | Sơ đồ toàn màn hình là modal; Escape lùi về đóng; focus về "Mở sơ đồ" | mobile sheet/modal |
| E | Đổi chất lượng | quality |
| F | Mất/khôi phục context: giữ F05 và Tiết kiệm | lifecycle, context |
| G | Inspector rồi Back | inspector |
| H | Rời rạp khi phim đang phát: 0 video, canvas, WebGL sau GC | "leaving while the film plays" |
| I | 4 vòng Back/Forward: heap +0,3 MiB | history, lifecycle |
| J | Giảm chuyển động: landing không parallax, tour từng điểm | reduced motion, flow F |
| K | Landing không JavaScript | `measure:build` |
| L | Không WebGL: sơ đồ + video 2D | flow E |
| M | Lỗi tải video (404) | film error |
| N | Lỗi tải mã rạp, rồi Thử lại | landing-code-fails |

## 10. Phân loại kết quả

| | Phạm vi | Trạng thái |
| --- | --- | --- |
| A | Chrome 156 desktop, Windows 11, headless, ANGLE D3D11, RTX 3090 | Đã kiểm chứng (mục 9) |
| B | Edge 156 | Đã kiểm chứng: 14 luồng nghiệm thu (bản production) |
| C | Mobile *giả lập* (viewport, touch, DPR qua CDP/Playwright) | Đã kiểm chứng ở mức giả lập; không thay cho máy thật |
| D | Thiết bị thật | **Chưa thử** |
| E | Safari/iOS, Firefox | **Chưa thử** (không có trong môi trường) |
| F | Trình đọc màn hình thật | **Chưa thử**; mới kiểm tra ARIA, focus, phím bằng script |
| G | Âm thanh bằng tai | **Chưa nghe**; mới biết track tiếng được giải mã, mute/volume đúng. Không kết luận đồng bộ hình–tiếng bằng cảm nhận |
| H | Vercel rewrite/cache của bản sửa | **Chờ preview**. Cấu hình Prompt 09 đã chạy trên production (mục 6) |
| I | Ảnh chia sẻ trên mạng xã hội | **Chưa kiểm chứng**; thẻ OG có trong HTML server trả |

## 11. Mức độ các vấn đề

- **Lỗi chặn chạy bản preview:** không có.
- **Lỗi cần đưa lên production sớm:** tệp thiếu → 200 HTML (`immutable` dưới `/assets/`). Đang có trên
  production; đã sửa trong mã, chờ preview rồi người dùng quyết định đưa lên `main`.
- **Chặn quảng bá cho người dùng mobile / Safari / trình đọc màn hình:** D, E, F, G ở mục 10. Cần thử tay
  theo `release-checklist.md` mục 4.
- **Hạn chế cần ghi nhận:**
  - soft 404;
  - `/index.html`, `/cinema.html` mở trực tiếp;
  - tab cũ sau deploy mới;
  - header `immutable` có thể kèm 404 của chunk;
  - tên thương hiệu tạm và chữ cứng trên slate;
  - ~881 MB ảnh QA trong lịch sử Git.
- **Cải thiện sau:**
  - `404.html` thật;
  - nút tải lại trang khi chunk mất;
  - CSP/security header (cần thử với WebGL/video);
  - mã hoá lại video theo cách tất định (nhịp frame đều);
  - AVIF;
  - chunk three.js > 500 kB.

## 12. Commit đề xuất (chưa thực hiện)

### 12.1 Đường dẫn

**Commit 1 — tuỳ chọn, người dùng quyết:** ngừng theo dõi ảnh QA Prompt 09.
- `git rm -r --cached artifacts/prompt-09`: 400 tệp, tệp vẫn ở máy và trong lịch sử.
- `.gitignore`

**Commit 2 — sửa hosting, công cụ nghiệm thu, tài liệu:**
- `vercel.json`, `.vercelignore`, `package.json`;
- `scripts/acceptance.mjs`, `scripts/measure-build.mjs`, `scripts/capture-views.mjs`;
- `docs/release-audit-prompt-10.md`, `docs/preview-deployment-plan.md`, `docs/release-checklist.md`;
- (`.gitignore` nếu bỏ commit 1).

**Không đưa vào commit:**
- `artifacts/prompt-10/` (ảnh, video, báo cáo QA của lượt này): ở máy, bị `.gitignore` loại;
- `dist/`, `node_modules/`, `*.log`: đã bị loại.

Lý do chia hai commit: một commit xoá 400 tệp khỏi index dễ xem và dễ bỏ qua riêng. Phần còn lại là một thay
đổi thống nhất (hosting + kiểm thử của nó + tài liệu).

### 12.2 Commit message

```
Keep QA artifacts out of Git from prompt 09 on

- Ignore artifacts/: screenshots, videos and reports stay on the
  machine; summaries live in docs/
- Stop tracking artifacts/prompt-09 (400 files, 274.5 MB); the files
  stay on disk and in history (f55ef30)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```
Return 404 for missing files on Vercel; add release audit (prompt 10)

- vercel.json: the SPA fallback now rewrites page paths only. Missing
  files under /assets, /brand, /media or with a file extension get a
  404 instead of the landing HTML (served as 200, and immutable under
  /assets)
- .vercelignore: keep QA artifacts, dev fixtures and a local dist out
  of CLI uploads
- scripts/acceptance.mjs: acceptance flows on the production build,
  plus hosting checks against a deployment (BASE_URL)
- measure-build: vercel.json rules checked against dist/; the film's
  read-ahead must stop while idle; results go to prompt-10
- Release audit, preview deployment plan, release checklist update

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### 12.3 Kiểm tra trước khi commit

- `git status --short` chỉ có các đường dẫn trên.
- `npm test`, `npm run typecheck`, `npm run build` sạch (đã chạy, mục 9).

## 13. Kế hoạch preview

[preview-deployment-plan.md](preview-deployment-plan.md):
- nhánh `preview/p10-release-audit`;
- push nhánh (không push `main`);
- xác nhận commit status `Vercel` của đúng SHA;
- `BASE_URL=<preview> ACCEPTANCE_ONLY=hosting npm run acceptance`, rồi một lượt đầy đủ, rồi thử tay;
- không promote lên production.
