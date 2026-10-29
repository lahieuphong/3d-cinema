# Bàn giao Prompt 09: trang mở đầu và lối vào rạp

Trạng thái: hoàn thành, chờ duyệt (28/10/2026). Chưa commit, push hay deploy; không nâng dependency nào.
Nền: commit `368d8f4` (Prompt 08), working tree sạch khi bắt đầu. Checklist phát hành đã cập nhật:
`docs/release-checklist.md`.

## Baseline

- Harness của Prompt 08 chạy trên code chưa sửa: **407/407** (`artifacts/prompt-09/baseline/`).
- `measure:build` của bản build Prompt 08: **11/11** (`artifacts/prompt-09/baseline/build-metrics.json`).
- Bản deploy Prompt 08 trên Vercel (`https://tp3d-cinema.vercel.app`) đã kiểm bằng vài request đơn lẻ:
  - `/cinema`: 200, `no-cache`;
  - `/assets/*`: `immutable`;
  - video: 206, `must-revalidate`.

## Nhận diện tạm

- **"Tân Phong Cinema"** là tên làm việc, chưa được duyệt chính thức. Tất cả nằm trong
  **`src/brand.ts`**: tên, wordmark, tagline, mô tả, ghi chú demo, màu, origin, ảnh chia sẻ, tiêu đề
  trang và hình dấu (`markSvg`).
- Đổi tên ở đó thì đổi theo:
  - trang mở đầu;
  - head của cả hai tài liệu HTML (qua plugin trong `vite.config.ts`);
  - link thương hiệu trong rạp;
  - tiêu đề tab.
- Chữ trên slate của ảnh và favicon được vẽ lại bằng `node scripts/capture-brand-assets.mjs`
  (`public/favicon.svg` sửa tay).
- **Màu:**

| | Mã | Dùng cho |
| --- | --- | --- |
| Đen than ấm | `#14110f` | nền trang |
| Đỏ rượu (từ ghế) | `#8a2636` / dấu `#7d2232` | nút chính, hàng ghế trong dấu |
| Champagne tiết chế | `#d9c08c` | eyebrow, số bước, viền nút phụ, khung màn trong dấu |

- **Chữ:** font hệ thống (`system-ui` …), không tải font ngoài. Wordmark là chữ: "Tân Phong" đậm,
  "CINEMA" nhỏ, giãn chữ.
- **Dấu:** khung màn 16:9 màu champagne trên một hàng ghế đỏ rượu (SVG inline, không tải logo ngoài).
- **Origin:** `https://tp3d-cinema.vercel.app`, chỉ dùng cho URL tuyệt đối của canonical và ảnh chia
  sẻ. Đây là bản deploy Vercel của chính repository này, đã kiểm tra trả 200; không phải tên miền
  chính thức. Đổi trong `BRAND.origin`.

## Nội dung trang mở đầu

Một trang ngắn (`src/landing/content.ts`, cùng một nguồn cho HTML tĩnh và cho app):

1. **Header:** wordmark (về `/`), "Trải nghiệm", "Cách sử dụng", "Vào rạp". Dưới 720 px chỉ còn
   wordmark và "Vào rạp"; hai liên kết kia vẫn có ở hero và trong trang.
2. **Hero:**
   - eyebrow "Trải nghiệm cinema 3D" (CSS viết hoa);
   - h1 "Bước vào rạp. Chọn góc nhìn của bạn.", mô tả;
   - "Bước vào rạp", "Cách trải nghiệm" (cuộn tới hướng dẫn), "Bản demo tương tác · Không bán vé".
3. **Trải nghiệm** (`#trai-nghiem`): ba ý có thật — 110 ghế, 10 hàng A–J; màn 16:9 rộng 8,5 m; chạy
   trên trình duyệt, cần WebGL.
4. **Cách sử dụng** (`#cach-su-dung`): ba bước, mỗi bước một ảnh lazy-load.
5. **Phần kết:** lời mời, "Bước vào rạp", ghi chú demo (ghế, sơ đồ, "đã đặt" là minh họa; không bán vé,
   không giữ chỗ).
6. **Footer:** ghi công video Big Buck Bunny (CC BY 3.0) và ghi chú ảnh là kết xuất của chính khán
   phòng.

Không có giá vé, lịch chiếu, đánh giá, số người dùng hay tuyên bố "rạp thật"; không form (có unit test
kiểm chữ cấm). Có skip link "Bỏ qua, tới nội dung chính". Heading h1 → h2 → h3.

## Ảnh hero và các ảnh khác

- `scripts/capture-brand-assets.mjs` mở chính khán phòng trên dev server, trong một Chrome có profile
  tạm riêng, chất lượng Cao, tỷ lệ điểm ảnh 2. Script ẩn giao diện, đặt camera rồi chụp canvas.
- **Màn chiếu trong ảnh là slate do script vẽ**, không phải frame phim:
  - đưa vào bằng `?poster=` (chỉ có ở dev, `src/cinema/media.ts`);
  - nguồn phim của rạp không đổi;
  - bước 2 và 3 là ảnh chụp giao diện thật (chữ ghi công Big Buck Bunny trong player vẫn có).

| Ảnh | Góc | Tệp (WebP, JPEG dự phòng) |
| --- | --- | --- |
| Hero 16:9 | từ cuối phòng bên phải `(3,5; 3,6; 7,5)` nhìn về `(−3,5; 1,6; −8)`: màn ở phải, nửa trái yên cho chữ | 960/1440/1920/2560 w (27–103 kB), JPEG 1920 (125 kB) |
| Hero dọc 2:3 | giữa cuối phòng, cao `(0,8; 4,2; 8,4)` | 720/1080/1440 w (22–54 kB), JPEG 1080 (77 kB) |
| Bước 1 | lối đi bên phải, tầm mắt người đứng | 640/960 w, JPEG 960 |
| Bước 2 | giao diện Chọn ghế, F05 và F06 đang chọn | 640/960 w, JPEG 960 |
| Bước 3 | Xem phim từ ghế F06 | 640/960 w, JPEG 960 |
| Chia sẻ | cắt từ hero, 1200 × 630 JPEG | 67 kB |
| Icon | dấu trên nền than: `favicon.svg`, `apple-touch-icon.png` 180 px | |

- `<picture>` chọn bản dọc khi `max-aspect-ratio: 4/5`; `srcset` / `sizes` theo bề ngang.
- Hero `fetchpriority="high"`, không lazy. Ảnh bước `loading="lazy"`. Mọi ảnh có `width`/`height`.
- Không có ảnh base64 trong JS.
- Không có AVIF: canvas của Chrome không mã hoá AVIF, và không cài thêm công cụ nào.
- Chữ không đè màn chiếu trong ảnh. Check tính vị trí màn đã vẽ theo `object-fit: cover`: ngang thì
  chữ ở bên trái màn, dọc thì chữ ở dưới màn; đạt ở 9 kích thước.

## Chuyển động 2.5D

`src/landing/motion.ts` + CSS:

- **Lớp:** ảnh (`.hero__media`), lớp tối hỗ trợ chữ, chữ và nút. Chữ và nút không bao giờ di chuyển.
- **Khi tải:** ảnh "lắng" từ scale 1,07 về 1,02 trong 1,6 s; dòng eyebrow trượt lên 10 px trong 0,5 s.
  Tiêu đề, mô tả và nút có từ lần vẽ đầu; không có splash.
- **Chuột** (chỉ `hover: hover` + `pointer: fine`): ảnh dịch tối đa 10 px ngang, 6 px dọc, ngược chiều
  chuột. Chuyển động được làm mượt (ease) và dừng xin frame khi đã tới vị trí.
- **Cuộn:** ảnh trôi bằng 12 % quãng cuộn trong phạm vi hero.
- **Khi nào tắt:** hero ra khỏi màn hình (IntersectionObserver) hay tab ẩn thì không xử lý input, không
  xin frame. Màn cảm ứng không dùng parallax chuột; không cần cảm biến nghiêng.
- **Giảm chuyển động:** không có hiệu ứng vào, không parallax (`data-motion="off"`), không cuộn mượt.
- Không có WebGL hay canvas thứ hai, không video nền.
- **Đo được:** dịch 7,2 px khi rê chuột; 0 frame trong 1 s sau khi dừng; 0 frame khi hero ra khỏi màn
  hình; landing đứng yên 0 animation frame trong 2 s.

## Routing, preload, metadata

- **Hai tài liệu HTML, một app:**
  - `index.html` cho `/` và mọi đường dẫn lạ: trang mở đầu được plugin `site-pages` trong
    `vite.config.ts` viết sẵn vào HTML lúc build;
  - `cinema.html` cho `/cinema` và `/cinema/`: màn "Đang mở phòng chiếu…" và `<noscript>` dẫn về `/`.
  - Cả hai nạp `src/main.ts`.
  - Mỗi tài liệu có title, description, canonical, Open Graph, `theme-color`, icon riêng, nên trình
    thu thập không chạy script vẫn đọc đúng từng route.
  - Ánh xạ `/cinema` → `cinema.html`: `vercel.json` (rewrite), dev và preview server (middleware trong
    plugin).
  - Lúc build, `cinema.html` khai báo sẵn (`modulepreload` + stylesheet) các chunk và CSS của trang rạp,
    nên mở thẳng `/cinema` không phải đợi entry rồi mới tải. `index.html` không có gì như vậy (plugin
    `cinema-preload`).
- **Router** (`src/router.ts` thuần, có test; điều phối trong `src/main.ts`):
  - `/` → landing; `/cinema` → rạp; `/cinema?inspect=seat` → inspector; còn lại → "Không tìm thấy";
  - không còn chuyển `/` sang `/cinema`;
  - click thường trên link vào rạp hoặc link thương hiệu thì điều hướng trong app (`pushState`, một
    lần, bỏ qua nếu đã ở đó). Ctrl/⌘/Shift/Alt/click giữa thì để trình duyệt mở tab hoặc cửa sổ mới;
  - mỗi lần đổi route: title, `meta[name=description]`, `html[data-route]`. Sau điều hướng trong app,
    focus về `main#noi-dung` (landing) hoặc h1 "Phòng chiếu 3D" (rạp);
  - link trong trang (`#cach-su-dung`) không dựng lại trang;
  - cuộn của landing khi Back do trình duyệt khôi phục.
- **Bộ đếm thế hệ:** mã tải xong muộn (người dùng đã Back) thì không mount gì.
- **CSS theo trang:**
  - `src/site.css` (landing, màn chờ, 404) đi với entry;
  - `src/styles.css` của rạp đi với mã rạp, và các quy tắc toàn trang (`html, body { overflow: hidden }`)
    chỉ áp dụng khi `html[data-route]` là `cinema` hoặc `inspector`. Nhờ vậy về lại landing vẫn cuộn
    được.
- **Tải có kiểm soát** (`src/landing/loader.ts`: một request cho nhiều lời gọi, lỗi thì quên để lần sau
  thử lại, preload không gây unhandled rejection):
  - landing tự nó **không** tải mã rạp, three.js, inspector hay video;
  - hover, focus hoặc nhấn vào "Bước vào rạp"/"Vào rạp" thì tải mã trang rạp và phần 3D, **không** tạo
    renderer, scene, canvas hay video. Với Save-Data thì không tải trước;
  - click: điều hướng, màn "Đang mở phòng chiếu…" hiện ngay, phần 3D bắt đầu tải song song;
  - mở thẳng `/cinema` cũng tải song song mã trang và phần 3D;
  - lỗi tải mã trang: "Không mở được phòng chiếu" + "Thử lại" (tải lại; Chrome cho phép) + "Về trang
    chủ";
  - không có hoạt ảnh bắt chờ.
- **Giới hạn metadata:**
  - điều hướng trong app chỉ đổi title và description trong DOM. Thẻ Open Graph là của tài liệu đã nạp
    đầu tiên, nhưng trình thu thập luôn tải thẳng từng URL nên vẫn nhận đúng tài liệu;
  - chưa thử với trình thu thập thật của mạng xã hội.

## Vòng đời ra/vào rạp

- **Rời rạp** (link thương hiệu, Back, đường dẫn khác): dùng hợp đồng unmount của Prompt 07–08.
  - Lưu vị trí, âm lượng của phim, rồi tạm dừng và giải phóng video.
  - Dừng tour, input, RAF, frame clock; dispose renderer (trước đó gỡ listener khỏi texture chung bằng
    workaround hiện có, chỉ của context này) và canvas.
- **Vào lại:**
  - một renderer, một canvas; không nhân subscription hay listener;
  - ghế đã chọn, tác vụ, trạng thái panel giữ trong phiên (biến `session` trong `main.ts`, tạo lần đầu
    vào rạp, sống tới khi tab tải lại);
  - chất lượng giữ trong `localStorage` như trước;
  - **phim:** tạm dừng đúng chỗ đã rời, không tự phát;
  - **camera:** về Tổng quan; không tự chạy tour.
- **Đo được** (Chrome headless, CDP, sau GC):
  - rời khi phim đang phát: 0 `HTMLVideoElement`, 0 canvas, 0 context WebGL, không gì đang phát;
  - 6 vòng ra/vào: ở landing mỗi lần 0/0/0; listener window/document 18/1 ở vòng đầu và vòng cuối; heap 12,02 → 12,39 MiB (lượt capture-3);
  - vào lại: 1 canvas, F05 vẫn chọn, Tiết kiệm giữ nguyên, phim `paused` ở 1,52 s (rời lúc ~1,49 s).

## Responsive và accessibility

- **Kích thước đã đo:**
  - 1440×900, 1280×720;
  - 820×1180, 1180×820 (DPR 2, cảm ứng);
  - 390×844, 360×640, 844×390 (DPR 3, cảm ứng);
  - zoom 200 % (720×450, 640×360).
- **Ở mọi kích thước:** CTA ở màn hình đầu, không tràn ngang, header 64 px (≤ 80), chữ không đè màn
  trong ảnh, nút ≥ 44 px.
- **Màn hình hẹp:**
  - dọc (`max-aspect-ratio: 4/5`): ảnh dọc ở trên, chữ ở dưới đè lên phần ảnh đã mờ dần;
  - thấp (`max-height: 500px`, ngang): chữ gọn hơn, cột chữ ≤ 42 vw.
- **Tương phản** (WCAG):
  - chữ trên nền 16,2:1; chữ phụ 8,9:1; champagne 10,6:1; chữ nút trên đỏ rượu 8,3:1;
  - chữ hero trên lớp tối của ảnh ≥ 7,1:1 (tính với điểm ảnh sáng).
- Focus viền champagne 3 px. Ảnh hero có alt ngắn mô tả căn phòng; ảnh bước có alt theo nội dung.
- Không JS: nội dung và liên kết vẫn đọc được, có `noscript` giải thích.
- **Chưa thử trình đọc màn hình thật.**

## Số đo

Bản production (`yarn measure:build`): `vite preview` có gzip, Chrome 156 headless với profile tạm
riêng, viewport 1280×720, ANGLE D3D11 / RTX 3090. Cache tắt, trừ phần "cache ấm". Số liệu máy mạnh,
không đại diện cho điện thoại.

**Bundle** (raw / gzip):

| Tệp | raw | gzip | Tải khi |
| --- | ---: | ---: | --- |
| `main-*.js`: router, landing, nhận diện, motion, loader | 15,4 kB | 6,4 kB | mọi trang |
| `main-*.css`: landing, màn chờ, 404 | 9,2 kB | 2,8 kB | mọi trang |
| `page-*.js` + `ui-*.js` + `cameraPresets-*.js` (trang rạp) | 61,6 kB | 22,7 kB | vào rạp; khai báo sẵn trong `cinema.html` |
| `ui-*.css` (rạp) | 23,2 kB | 5,1 kB | như trên |
| `view-*.js` + `seats-*.js` (phần 3D, có three.js) | 940 kB | 283,7 kB | vào rạp, hoặc khi có ý định |
| `seatInspector-*.js` | 10,3 kB | 4,2 kB | chỉ inspector |

**Landing, cache lạnh, trước tương tác: 118 kB truyền**
- HTML 4,0 kB; JS 6,7 kB; CSS 3,1 kB; favicon 0,7 kB;
- ảnh hero 46 kB;
- ba ảnh bước 57 kB (lazy, nhưng nằm trong ngưỡng nạp sớm của Chrome).
- Không có chunk rạp, three.js hay video.

**Thời gian** (trung vị của 2 lần):

| Mạng | FCP / LCP (h1) | CLS | Click → cảnh sẵn sàng, đã hover trước | Click → cảnh sẵn sàng, bấm ngay |
| --- | ---: | ---: | ---: | ---: |
| Máy cục bộ | 64–76 ms | 0 | 0,24 s | 0,26 s |
| 1,6 Mbit/s, RTT 150 ms (CDP) | 0,46–0,48 s | 0 | **0,24 s** | **2,0 s** |

- Hover tải sẵn mã: trang rạp và phần 3D, 314 kB trên mạng chậm.
- Mở thẳng `/cinema`, mạng chậm: trang rạp dùng được ở **0,57 s**, cảnh 3D ở **2,35 s**.
  - Prompt 08: 0,51 s / 2,33 s.
  - Trước khi `cinema.html` khai báo sẵn chunk: 0,87 s.

**Cache ấm** (lần thứ hai cùng profile, `vite preview` hỏi lại theo ETag):
- landing 2,4 kB (lạnh 118 kB); rạp 3,6 kB (lạnh 418 kB).
- Trên Vercel, `/assets/*` là `immutable` nên không cần hỏi lại.

**Video:** không đổi so với Prompt 08.
- Trước Phát: 1 request, 1,0–1,8 MB tuỳ lần chạy (Chrome đọc trước dù `preload="metadata"`).
- Xem hết: đúng 1,0 × tệp.

**Landing đứng yên** (dev server, harness): 0 animation frame trong 2 s; 0 context WebGL; 0 phần tử
video.

**Vòng đời:** xem mục "Vòng đời ra/vào rạp".

## Kiểm tra

- **`yarn test`: 180/180** (12 file; Prompt 08: 170/11).
  - Mới: `src/landing/landing.test.ts` (10 test): route, click thường hay click mở tab, loader (một
    request; lỗi thì thử lại; không unhandled rejection; Save-Data), nội dung landing (chữ đã chốt,
    một h1, ba link thật vào rạp, hero không lazy, ảnh bước lazy và có kích thước, không base64,
    không có chữ về giá vé/lịch chiếu/đánh giá, có ghi công).
- `yarn typecheck`: sạch. `yarn build`: thành công.
  - Hai tài liệu HTML; cảnh báo chunk > 500 kB vẫn cho chunk three.js, không nâng giới hạn.
- **`yarn capture`: 456/456**, 0 lỗi console ngoài dự kiến, 12 lỗi dự kiến của các luồng cố tình gây lỗi (`logs/capture-3.log`).
  - 49 check mới cho trang mở đầu và lối vào. Các check Prompt 03–08 chạy lại, đều đạt.
  - `logs/capture-2.log`: 456/456. Lượt đó có `report.json` bị một lượt chạy riêng phần so sánh ghi đè, nên chạy lại toàn bộ (`capture-3.log`).
  - Lượt đầu (`logs/capture-1.log`) dừng giữa chừng vì hai check cần cập nhật:
    - check "tải phần 3D thất bại" (P08): giờ app hỏi phần 3D hai lần cùng lúc nên một request lỗi tự
      được thử lại; test phải chặn cả hai;
    - check "phím W" so tọa độ bằng chuỗi JSON, fail vì sai số 3·10⁻¹⁶ m; nay so có dung sai.
- **`yarn measure:build`: 16/16** (`artifacts/prompt-09/build-metrics.json`).
  - Ngưỡng "video đọc trước" nâng từ 20 % lên 25 % tệp vì Chrome đọc 1,0–1,8 MB tuỳ lần (ghi chú
    trong script); vẫn yêu cầu ≤ 2 request.
- **Edge 156.0.4314.42** (`artifacts/prompt-09/edge/`): luồng landing, mạng landing, luồng A–F của rạp,
  không WebGL: **35/35**.
- **Baseline Prompt 08:** harness 407/407, `measure:build` 11/11.

**Check đổi theo hành vi mới:**
- `"/" redirects to /cinema` → `"/" shows the landing page`;
- `routes: / lands on /cinema` → `/ is the landing page` (+ `/cinema/`);
- thứ tự Tab trong rạp bắt đầu bằng link thương hiệu.

**Sửa trong lúc làm:**
- chữ hero chạm mép màn chiếu trong ảnh ở 844×390 và zoom 200 % → cột chữ ≤ 42 vw, căn trái;
- dải ảnh lộ dưới hero dọc → `overflow: hidden` cho lớp ảnh;
- header rạp ở 820 px cao thêm 1,2 px khi nút mini xuất hiện ("Cài đặt" xuống dòng) → giữ một dòng;
- chữ hero mờ dần khi vào làm trang chậm hiện → chỉ còn eyebrow có hiệu ứng;
- `measure-build.mjs` còn ghi mặc định vào `prompt-08` → đã đổi, và khôi phục tệp Prompt 08 bằng git.

## Ảnh và video (`artifacts/prompt-09/`)

212 tệp ở thư mục gốc, cộng `baseline/`, `edge/`, `logs/`.

- **Landing ở 7 kích thước:** `landing-<viewport>-1-top`, `-2-page` (cả trang).
- **Zoom 200 %:** `landing-zoom200-{1440x900,1280x720}-1-top`.
- **Ảnh render:** `landing-hero-render-16x9`, `landing-hero-render-portrait`, `landing-share-card`
  (tệp gốc ở `public/brand/`).
- **Focus:** `landing-focus-1-skip-link`, `landing-focus-2-cta`.
- **Giảm chuyển động:** `landing-reduced-motion`.
- **Không JavaScript:** `landing-no-javascript` (bản build).
- **Lối vào:** `landing-way-in-1-opening` (mạng chậm), `landing-way-in-2-failed` (lỗi + Thử lại),
  `landing-way-in-3-no-webgl`.
- **Video:** `video-landing-cinema-landing.webm` (landing → hover → vào rạp → về landing), cùng các
  video Prompt 05–08 quay lại.
- **Phòng chiếu:** toàn bộ ảnh Prompt 03–08 chụp lại trên giao diện có link thương hiệu (`ui-*`,
  `film-*`, `seats-*`…); `compare-p08-p09-*` (cùng camera, Prompt 08 ở `baseline/` cạnh Prompt 09).
- **Báo cáo:**
  - `report.json` (mục `landing`: layouts, network, flows);
  - `build-metrics.json` (mục `landing`: cold, warm, noScript, metadata);
  - `logs/` (test, typecheck, build, capture, measure, Edge, ảnh thương hiệu).

## Hạn chế còn lại

- **Thiết bị và trình duyệt:** chỉ Chrome 156 headless (mobile và tablet là giả lập) và Edge 156
  (Blink). Chưa thử điện thoại thật, Safari/iOS, Firefox, trình đọc màn hình thật.
- **Âm thanh chưa kiểm chứng bằng tai.**
- **Vercel:** cấu hình mới của Prompt 09 (rewrite `cinema.html`, header) chưa deploy nên chưa kiểm
  chứng. Cấu hình cache của Prompt 08 đã kiểm trên bản deploy.
- **Ảnh chia sẻ:** chưa thử với mạng xã hội. Điều hướng trong app không đổi thẻ Open Graph (trình
  thu thập không cần điều này).
- **Ảnh lazy:** Chrome vẫn tải sớm ba ảnh bước (~57 kB) vì chúng nằm trong ngưỡng lazy-load của trình
  duyệt.
- **LCP:** Chrome không tính ảnh lớn hơn khung nhìn (coi như nền), nên "largest paint" là tiêu đề h1.
- **Tên "Tân Phong Cinema"** là tên làm việc.
- **AVIF:** không có, vì canvas của Chrome không mã hoá được.
- **Còn lại từ trước:** nhịp frame của video không đều (30–52 ms); Chrome đọc trước ~1 MB đầu tệp video
  sau khi cảnh sẵn sàng; chunk three.js ~885 kB.

## File và lệnh

- **Mới:**
  - `src/brand.ts`, `src/router.ts`, `src/site.css`;
  - `src/landing/{content,landing,loader,motion}.ts`, `src/landing/landing.test.ts`;
  - `cinema.html`, `public/favicon.svg`, `public/apple-touch-icon.png`, `public/brand/*`;
  - `fixtures/brand/screen-slate.png` (dev), `scripts/capture-brand-assets.mjs`;
  - tài liệu này.
- **Sửa:**
  - `src/main.ts`: router, landing, tải rạp lười, màn chờ/lỗi, focus, title;
  - `src/cinema/page.ts`: `createCinemaSession`, `goHome`, nạp CSS rạp;
  - `src/cinema/ui.ts`: link thương hiệu về trang chủ, h1 ẩn trực quan;
  - `src/cinema/seatInspector.ts`: CSS, title;
  - `src/cinema/media.ts`: `?poster=` chỉ ở dev;
  - `src/styles.css`: quy tắc toàn trang chỉ trên route rạp, link thương hiệu;
  - `index.html`, `vite.config.ts` (plugin `site-pages`, hai input), `vercel.json` (rewrite
    `cinema.html`);
  - `docs/media-credits.md`, `docs/release-checklist.md`;
  - `scripts/capture-views.mjs`: landing, luồng, mạng; thư mục mặc định `prompt-09`;
  - `scripts/measure-build.mjs`: landing production, cache, không JS, metadata.
- **Lệnh:**
  - `yarn test`, `yarn typecheck`, `yarn build`;
  - `yarn capture` (khoảng 30 phút; `CAPTURE_ONLY=landing-layouts,landing-network,landing-flows`
    cho phần mới);
  - `yarn measure:build`;
  - `node scripts/capture-brand-assets.mjs` (vẽ lại ảnh).
