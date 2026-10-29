# Hiệu năng, tải trang và chất lượng tự động

Vòng tối ưu cuối (30/10/2026), nhánh `perf/final-optimization`. Tài liệu này ghi lại các nút thắt đã
đo, cách sửa, những gì đã thử mà không giữ, cách chọn chất lượng, cách đo lại, và những gì chưa xác
minh được.

## Môi trường đo

| Mục | Giá trị |
|---|---|
| Máy | Windows 11, Intel Core i9-12900K (16 nhân), 128 GiB RAM |
| GPU rời | NVIDIA GeForce RTX 3090 (ANGLE D3D11, `--force_high_performance_gpu`) |
| GPU tích hợp | Intel UHD Graphics 770 (ANGLE D3D11, `--force_low_power_gpu`) |
| Render phần mềm | SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`) |
| Không WebGL | `--disable-webgl` |
| Trình duyệt | Chrome 156, headless, hồ sơ tạm mới cho mỗi lần chạy |
| Máy chủ | Node phục vụ `dist/` theo đúng `vercel.json` (HTML `no-cache`, `/assets` `immutable`, br/gzip, byte range) |
| Bản trước | `b7df72d` (main trước vòng này), build production lưu ở `artifacts/perf-baseline-dist/` |

Kích thước điện thoại và tablet là **viewport giả lập trên máy desktop này** (cùng GPU và CPU, có thể
bóp CPU 4×). Đó không phải số đo của điện thoại hay tablet thật.

## Cách đo lại

```
yarn build
yarn measure:perf                                               # mọi phần, 3 lượt (~2 giờ)
PERF_DIST=<thư mục dist> PERF_OUT=<tên> PERF_ONLY=load,runtime PERF_GPUS=rtx,uhd PERF_QUALITY=high,economy,auto PERF_SCENARIOS=tour,film yarn measure:perf
PERF_COMPARE=perf/baseline,perf/final yarn measure:perf               # bảng trước/sau
```

`scripts/measure-perf.mjs` không cần hook trong app: nó chèn bộ đo vào trang trước khi trang chạy.
- **Đếm WebGL:** draw call, tam giác, bộ nhớ texture/renderbuffer ước tính từ kích thước khai báo
  với WebGL.
- **Thời gian khung:** CPU của mỗi callback có vẽ; thời gian GPU qua `EXT_disjoint_timer_query_webgl2`.
  Khi app tự đo GPU (bản mới), script đọc kết quả của app. Thời gian khung không bao giờ được coi là
  thời gian GPU.
- **Sự kiện của trang:** khoảng cách giữa các khung, long task, layout shift, paint, event timing cho
  thao tác, các trạng thái tải của trang và các mốc `cinema:*` (User Timing) của app.

Các phần đo:
- `load`: `/cinema` ở trạng thái lạnh (trình duyệt mới: cache HTTP và cache shader đều trống, như
  lần đầu vào) và ấm (tải lại), với mạng cục bộ và mạng chậm (150 ms RTT, 1,6 Mbit/s, CPU 4×).
- `runtime`: theo GPU × kích thước × chất lượng, gồm các cảnh: đứng yên, tour, kéo xoay, đi bộ,
  phim đang phát.
- `interact`: chuyển tác vụ, chọn ghế (sơ đồ và trong phòng), tour, phát/tua.
- `lifecycle`: ra/vào rạp 9 lần, đo sau GC.
- `fallback`: không WebGL, mất context rồi được trả lại, mất context không được trả lại.
- `shots`: ảnh cùng góc camera để so sánh.

Kết quả nằm trong `artifacts/perf/<tên>/perf.json` (và ảnh). Thư mục `artifacts/` không vào Git.

## Nút thắt đã tìm thấy và cách sửa

### 1. Lần vào đầu tiên: biên dịch shader chặn trang 2,4–2,8 giây

**Đo được.** Khi cache shader còn trống, khung 3D đầu tiên tốn 2,4 s CPU trên main thread. Trong đó
2,8 s là chờ trong `getProgramParameter`/`getProgramInfoLog`: 16 chương trình được biên dịch đồng bộ
ngay trong lần `render()` đầu (ANGLE dịch sang HLSL rồi biên dịch D3D). Trong lúc đó skeleton đứng
hình và trang không nhận thao tác.

**Sửa:**
- `CinemaView` biên dịch mọi material bằng `renderer.compileAsync()`
  (`KHR_parallel_shader_compile`) trước khung đầu tiên. RenderHost không vẽ gì trước `start()`.
- Môi trường phản chiếu (PMREM) cũng biên dịch nền (`createInteriorEnvironmentAsync`): các material
  basic của phòng giả, shader blur và GGX của PMREMGenerator được biên dịch trước với cùng render
  target half-float, nên `fromScene()` dùng lại đúng các chương trình đó.
  - Bài học: geometry dùng để biên dịch trước phải có thuộc tính `position`, vì
    `hasPositionAttribute` nằm trong khóa của chương trình. Thiếu nó thì đó là chương trình khác, và
    lần vẽ thật lại biên dịch đồng bộ (đã đo: 308 ms).
  - Cách này dùng vài thành phần nội bộ của PMREMGenerator (three r186). Nếu không tìm thấy chúng,
    hàm tự quay về cách cũ.
- `renderer.debug.checkShaderErrors` chỉ bật khi dev. Ở production, three.js khuyên tắt vì mỗi chương
  trình tốn thêm một vòng hỏi đồng bộ.

### 2. Dựng cảnh trong một long task (145 ms; 450–580 ms khi CPU chậm 4×)

**Sửa:** `prepareScene()` dựng các phần không cần renderer theo từng bước: nhóm sàn, màn chiếu và
trần, từng vách, rồi đèn và ghế. Giữa các bước trang được nhường lượt (`scheduler.yield()`, nếu
không có thì `MessageChannel`). Sau đó mới tạo renderer. `buildArchitecture` vẫn chạy đồng bộ cho
lúc khôi phục context và cho test.

### 3. Phim trên GPU tích hợp: mỗi khung video vẽ lại cả khán phòng

**Đo được.** Thí nghiệm trên UHD 770, 1440×900, đo từng phần:

| Biến thể | GPU tour p50 | GPU khung phim | Phim rớt khung |
|---|---|---|---|
| Hiện trạng | 23,7 ms | 50,3 ms | 20/88 |
| Tắt 5 đèn area (LTC) | 11,3 | 18,5 | 1/106 |
| Tắt MSAA | 19,5 | 38,9 | 3/88 |
| Pixel ratio 0,75 | 15,6 | 33,8 | 1/101 |
| Tắt shadow / env / spot / blur kính | ~19–20 | 46–50 | ~20 |
| Upload video bằng `texSubImage2D` | 23,2 | 49,9 | 17/88 |

Upload video không phải nguyên nhân. Khi camera đứng yên, mỗi khung video (24 lần/giây) lại vẽ toàn
bộ phòng với 5 đèn area, trong khi chỉ màn chiếu thay đổi.

**Sửa:**
- **Chỉ vẽ lại vùng màn chiếu.** Canvas giữ khung trước (`preserveDrawingBuffer: true`). Khung chỉ có
  video mới (`requestPartialRender`) thì vẽ đúng phần màn chiếu bằng scissor: cùng scene, cùng shader,
  chỉ bị cắt vùng. Mọi yêu cầu vẽ khác (camera, ghế, shadow, đổi cỡ, poster) vẫn vẽ toàn bộ.
  - Đã kiểm chứng: vùng ngoài màn chiếu trùng từng pixel với khung vẽ toàn bộ (`yarn capture`, mục
    phim).
  - Đo trên UHD (bậc Cao): 50,3 → 2,2 ms/khung ở 1440×900; 69,9 → 2,7 ms ở 1920×1080; 147,6 → 9,7
    ms trên laptop HiDPI. Rớt khung 29/57/85 → 0. Trên RTX: 7–12 → 0,7–2,5 ms.
  - Chi phí của `preserveDrawingBuffer` lên tour nằm trong mức nhiễu (~0–1 ms).
- **Màn chiếu ngoài khung nhìn** (đi bộ quay lưng, góc "Nhìn về ghế"): khung video mới không làm vẽ lại
  phòng. Mesh bị cull nên texture cũng không upload.

### 4. Mặc định "Cao" trên laptop HiDPI dùng GPU tích hợp: 8 fps

UHD 770 ở 1440×900 CSS, DPR 2: bậc Cao (pixel ratio 2, 5,2 MP) cho tour 8,3 fps, GPU 103 ms/khung.
Bậc Tiết kiệm (pixel ratio 1,25) đạt 36,7 fps. Trên máy này, pixel ratio là đòn bẩy quyết định. Hướng
xử lý: chế độ "Tự động" (mục dưới) mặc định cho mọi thiết bị.

### 5. Render phần mềm: 1–2,5 giây mỗi khung

SwiftShader ở 1440×900 mất 1,3–2,5 s/khung. Tắt MSAA hoặc pixel ratio 0,5 chỉ còn khoảng 0,7 s,
vẫn không đủ để chuyển động mượt, nên không đánh đổi độ nét ở đây.

**Sửa:**
- Nhận biết renderer phần mềm (SwiftShader, llvmpipe, Microsoft Basic Render…).
- "Tự động" bắt đầu ở bậc tối giản.
- Camera chuyển cảnh tức thì và tour đi từng điểm, như khi giảm chuyển động.
- Một dòng chú thích nói rõ máy đang dựng hình bằng phần mềm; sơ đồ ghế và phim vẫn dùng bình thường.

Chrome hiện không tự rơi về SwiftShader cho WebGL nữa (khi đó WebGL lỗi và trang dùng chế độ 2D sẵn
có). Trường hợp này vẫn gặp ở máy ảo, Remote Desktop và Linux không có driver.

### 6. Tải: chuyển cảnh và trạng thái

- **Skeleton mờ dần khi có khung hình đầu tiên** (220 ms). Với giảm chuyển động thì biến mất ngay.
  Trong lúc mờ, skeleton không nhận thao tác và bị ẩn khỏi trình đọc màn hình.
- **Hai trạng thái chờ đều dựa trên tín hiệu thật:**
  - "Đang tải phần 3D của trang…": chunk 3D đang tải.
  - "Đang dựng phòng chiếu 3D…": dựng, biên dịch, khung đầu.
- Không có phần trăm giả hay thời gian chờ trang trí.

## Đã thử nhưng không giữ

| Thử | Kết quả | Lý do bỏ |
|---|---|---|
| Upload video vào storage cố định (`texSubImage2D`, RGBA8 + decode sRGB trong shader) | Không đổi (49,9 so với 50,3 ms) | Không có lợi |
| Tắt đèn area / shadow / env / spot khi cần tiết kiệm | Tour nhanh hơn tới 2× (đèn area) | Đổi ánh sáng của phòng (yêu cầu giữ ánh sáng và màu vật liệu) |
| MSAA tắt; pixel ratio < 1 cho GPU | Nhanh hơn 18–34% | Răng cưa và mờ hình; GPU tích hợp ở DPR 1 vẫn ~32–46 fps, chấp nhận được |
| Pipeline nén texture (KTX2/Basis) | – | Không có texture raster lớn: thảm 128², biển EXIT dựng bằng canvas, poster 1280×720 JPEG, video. Thêm decoder không có lợi |
| Hạ cả bậc khi GPU tích hợp ở DPR 1 quá tải | Ghế thô + shadow 1024 chỉ lợi 2–3% | Làm xấu hình mà không nhanh hơn; "Tự động" giữ hình (xem quy tắc 12%) |

## Chất lượng: Tự động / Ưu tiên đẹp / Tiết kiệm

Cài đặt › Hiển thị có ba lựa chọn. **Chỉ lựa chọn này được lưu** (`localStorage cinema3d.quality`).
Giá trị "Cao" lưu từ trước tương ứng với "Ưu tiên đẹp".

Các bậc vẽ (`config.quality`). Tất cả dùng chung ánh sáng, material và texture, nên đổi bậc không bao
giờ phải biên dịch shader mới:

| Bậc | Pixel ratio tối đa | Shadow map | Ghế | Kính |
|---|---|---|---|---|
| đẹp nhất (`high`, "Ưu tiên đẹp") | 2 | 2048 | mịn | đầy đủ |
| cân bằng (`balanced`) | 1,5 | 2048 | mịn | đầy đủ |
| tiết kiệm (`economy`, "Tiết kiệm") | 1,25 | 1024 | thô (~40% tam giác) | blur nhẹ, không ánh |
| tối giản (`minimal`, chỉ "Tự động" tới) | 1 | 1024 | thô | không blur, nền đặc |

Ngoài ra pixel ratio không bao giờ vượt `MAX_VIEWPORT_DIMS`/`MAX_RENDERBUFFER_SIZE` của GPU, ở mọi bậc.

**"Tự động"** (mặc định, `qualityGovernor.ts`):
- **Bắt đầu vừa phải.**
  - Bậc cân bằng (trên màn 1× thì giống hệt đẹp nhất).
  - Tiết kiệm với thiết bị cảm ứng, ≤ 4 nhân hoặc ≤ 4 GiB.
  - Tối giản với renderer phần mềm.
  - Trong cùng một lần ghé, quay lại rạp thì bắt đầu từ bậc đã đạt.
- **Chỉ học từ các khung vẽ liền nhau** (camera chuyển động, tour, đi bộ). Phòng đứng yên không vẽ
  gì; khung phim lẻ không nói gì về tốc độ khung hình. Khi đang tải, tab ẩn, đổi cỡ hoặc vừa đổi bậc
  thì bỏ số đo cũ và chờ 2,5 s.
- **Hạ khi quá tải kéo dài:** 90 khung liền nhau có trung vị > 22 ms (≈ 45 fps), hoặc GPU p75 > 16 ms
  (không còn giữ được 60 fps).
  - Chỉ hạ tới bậc được dự đoán rẻ hơn ít nhất 12%. Chi phí dự đoán chủ yếu theo số pixel trên màn
    này; ghế thô chỉ tính 5%, kính 2–5%, theo số đo. Không có bậc nào như vậy thì giữ nguyên hình.
  - Cửa sổ đo kế tiếp phải cho thấy thật sự nhanh hơn 12%. Nếu không, lần nghỉ sau quay lại bậc cũ và
    không thử bậc thấp hơn nữa.
- **Nâng chậm và chỉ khi đứng yên:** cần 300 khung êm. Nếu có thời gian GPU, bậc trên phải được dự
  đoán dưới 11 ms. Nếu không có, nâng thử và hạ lại (không thử lại) nếu chậm đi. Bậc đã phải rời thì
  không thử lại trong lần ghé đó. Không nâng giữa lúc kéo, đi bộ, tour hay khi phim đang chạy.
- **Đổi ghế (dựng lại geometry) chỉ khi đứng yên.** Khi đang chuyển động, hạ bậc chỉ đổi pixel ratio
  và shadow ngay.
- **Không lưu kết luận "máy yếu"** ngoài phiên.
- **Không suy thời gian khung thành thời gian GPU.** Safari và Firefox không có timer query; khi đó
  "Tự động" chỉ dựa vào khoảng cách khung.
- Dòng nhỏ dưới lựa chọn cho biết "Tự động" đang ở bậc nào. Thuộc tính `data-quality-reason` trên
  `.cinema-app` ghi lý do lần đổi gần nhất (cho script đo, không hiển thị).

**Thứ tự hy sinh:**
- **Bậc thấp hơn bỏ theo thứ tự:** pixel ratio trên 1,5 → blur kính + shadow 1024 + ghế thô → pixel
  ratio trên 1 và blur.
- **Không bao giờ bỏ:** ánh sáng, tone mapping (Khronos PBR Neutral), không gian màu, màu vật liệu.
  Texture cũng không hạ: phòng không có texture raster lớn.
- **Phim không bị hạ độ phân giải.**
- **"Giảm hiệu ứng kính"** và `prefers-reduced-transparency` luôn thắng.

## Số đo trước/sau

Cách đọc:
- Mỗi ô là "trước → sau", trung vị của 3 lượt (2 lượt với SwiftShader); độ biến thiên (min/max) nằm
  trong `perf.json`.
- "Trước" là `artifacts/perf/baseline`. "Sau" là `artifacts/perf/final`, ghép từ hai lượt:
  - tour, kéo, đi bộ, thao tác, vòng đời, fallback: lượt `perf/after`;
  - tải trang và phim: lượt đo lại trên bản build cuối (`perf/after-film`), sau khi sửa vùng vẽ lại
    của màn chiếu (lượt đầu có lỗi chỉ vẽ một ô 1 × 1 m nên số phim không dùng được).
- **Bậc cố định (high, economy) tách riêng với auto.** Ở bậc cố định, hình không đổi giữa trước và
  sau. Ở auto, bậc được ghi trong `levels` của `perf.json`:
  - RTX: balanced → high sau khoảng 13–24 s ở mọi kích thước. Điện thoại/tablet bắt đầu ở economy,
    rồi lên balanced, rồi high.
  - UHD ở DPR 1 (1440, 1920): giữ balanced, không đổi bậc nào.
  - UHD HiDPI: balanced → economy → minimal (đều vì GPU bận). Tablet: economy → minimal.
    Điện thoại 390: giữ economy (60 fps).
  - SwiftShader: minimal ngay từ đầu.
- **Tour SwiftShader sau là "–":** trên renderer phần mềm, tour đi từng điểm (không có khung liền
  nhau để đo), đúng như thiết kế.
- **Phim trên SwiftShader:** khung phim nhanh hơn ~10× (60–120 ms thay vì ~1 s), nhưng bộ giải mã vẫn
  bỏ khung vì CPU đang bận vẽ.
- **Tour trên GPU tích hợp ở bậc cố định gần như không đổi:** vòng này không đổi cách vẽ phòng (xem
  "Đã thử nhưng không giữ").

#### Tải trang (trung vị, ms)

| Kích thước | Mạng | Cache | Giao diện dùng được | Khung 3D đầu tiên | Long task dài nhất | TBT | CLS |
|---|---|---|---|---|---|---|---|
| desktop-1440 | cục bộ | lạnh | 79 → 62 | 3352 → 1385 | 2392 → 57 | 2342 → 0 | 0.000 → 0.000 |
| desktop-1440 | cục bộ | ấm | 29 → 26 | 298 → 238 | 153 → 0 | 43 → 0 | 0.000 → 0.000 |
| desktop-1440 | chậm + CPU 4× | lạnh | 773 → 780 | 5533 → 3782 | 2523 → 150 | 3459 → 480 | 0.000 → 0.000 |
| desktop-1440 | chậm + CPU 4× | ấm | 314 → 286 | 952 → 1059 | 447 → 135 | 480 → 276 | 0.000 → 0.000 |
| phone-390 | cục bộ | lạnh | 68 → 65 | 3414 → 1357 | 2531 → 56 | 2481 → 0 | 0.000 → 0.000 |
| phone-390 | cục bộ | ấm | 27 → 29 | 235 → 266 | 132 → 0 | 30 → 0 | 0.000 → 0.000 |
| phone-390 | chậm + CPU 4× | lạnh | 795 → 806 | 5541 → 3858 | 2521 → 164 | 3472 → 483 | 0.000 → 0.000 |
| phone-390 | chậm + CPU 4× | ấm | 324 → 303 | 1139 → 1041 | 582 → 131 | 679 → 268 | 0.000 → 0.000 |

#### Khung hình (trung vị của các lượt; GPU = timer query, ms)

| GPU | Kích thước | Chất lượng | Tour fps | Tour GPU p50/p95 | Khung > 25 ms (tour) | Phim GPU p50 | Phim rớt khung | Đứng yên: khung vẽ |
|---|---|---|---|---|---|---|---|---|
| rtx | desktop-1440 | high | 58.1 → 60.0 | 2.55/4.93 → 3.21/5.38 | 0 → 0 | 7.08 → 0.85 | 2 → 0 | 0 → 0 |
| rtx | desktop-1440 | economy | 58.1 → 59.9 | 2.01/5.02 → 2.46/4.99 | 0 → 0 | 6.03 → 0.66 | 0 → 0 | 0 → 0 |
| rtx | desktop-1440 | auto | – → 60.0 | 2.44/5.87 | – → 0 | – → 0.84 | – → 1 | – → 0 |
| rtx | desktop-1920 | high | 58.1 → 60.0 | 3.1/4.9 → 2.23/6.29 | 0 → 0 | 7.41 → 0.98 | 4 → 0 | 0 → 0 |
| rtx | desktop-1920 | economy | 58.1 → 59.9 | 2.51/4.16 → 3.04/4.41 | 0 → 0 | 8.33 → 0.81 | 2 → 1 | 0 → 0 |
| rtx | desktop-1920 | auto | – → 59.9 | 3.1/5.4 | – → 0 | – → 0.96 | – → 0 | – → 0 |
| rtx | laptop-hidpi | high | 58.2 → 60.0 | 3.51/4.58 → 3.57/5.09 | 0 → 0 | 11.75 → 2.00 | 0 → 2 | 0 → 0 |
| rtx | laptop-hidpi | economy | 58.1 → 60.1 | 2.98/4.58 → 2.3/5.45 | 0 → 0 | 10.18 → 0.87 | 1 → 2 | 0 → 0 |
| rtx | laptop-hidpi | auto | – → 60.0 | 3.38/5.96 | – → 0 | – → 0.68 | – → 2 | – → 0 |
| rtx | tablet-portrait | high | 58.2 → 59.9 | 3.04/4.21 → 3.51/5.17 | 0 → 0 | 10.68 → 2.47 | 0 → 0 | 0 → 0 |
| rtx | tablet-portrait | economy | 58.1 → 60.1 | 2.83/4.58 → 2.18/3.77 | 0 → 0 | 8.48 → 1.00 | 1 → 0 | 0 → 0 |
| rtx | tablet-portrait | auto | – → 60.1 | 2.55/5.5 | – → 0 | – → 0.97 | – → 1 | – → 0 |
| rtx | tablet-landscape | high | 58.1 → 60.0 | 3.02/4.5 → 2.97/6.5 | 0 → 0 | 10.47 → 1.57 | 0 → 0 | 0 → 0 |
| rtx | tablet-landscape | economy | 58.1 → 60.0 | 2.71/4.73 → 1.98/4.74 | 0 → 0 | 8.06 → 0.75 | 1 → 0 | 0 → 0 |
| rtx | tablet-landscape | auto | – → 60.0 | 2.49/4.07 | – → 0 | – → 0.65 | – → 0 | – → 0 |
| rtx | phone-390 | high | 58.1 → 60.1 | 3.32/5.22 → 3.06/5.11 | 0 → 0 | 7.80 → 1.22 | 0 → 0 | 0 → 0 |
| rtx | phone-390 | economy | 58.1 → 60.1 | 1.78/4.92 → 1.55/3.56 | 0 → 0 | 3.45 → 0.59 | 0 → 0 | 0 → 0 |
| rtx | phone-390 | auto | – → 60.0 | 1.49/3.56 | – → 0 | – → 0.73 | – → 0 | – → 0 |
| rtx | phone-430 | high | 58.2 → 59.9 | 3.39/5.28 → 3.36/5.4 | 0 → 0 | 9.39 → 1.49 | 0 → 1 | 0 → 0 |
| rtx | phone-430 | economy | 58.1 → 60.0 | 1.84/4.37 → 1.88/4.17 | 0 → 0 | 4.00 → 0.45 | 0 → 0 | 0 → 0 |
| rtx | phone-430 | auto | – → 60.0 | 1.86/4.08 | – → 0 | – → 0.23 | – → 0 | – → 0 |
| uhd | desktop-1440 | high | 45.2 → 46.5 | 13.29/44.4 → 13.08/43.62 | 49 → 47 | 50.32 → 2.23 | 29 → 0 | 0 → 0 |
| uhd | desktop-1440 | economy | 47.6 → 49.1 | 12.96/35.86 → 12.74/35.76 | 47 → 50 | 39.99 → 1.74 | 5 → 0 | 0 → 0 |
| uhd | desktop-1440 | auto | – → 46.7 | 13.06/43.56 | – → 46 | – → 2.12 | – → 0 | – → 0 |
| uhd | desktop-1920 | high | 30.8 → 31.9 | 20.83/62.75 → 20.47/62.33 | 102 → 96 | 69.89 → 2.70 | 57 → 0 | 0 → 0 |
| uhd | desktop-1920 | economy | 33.3 → 34.6 | 20.38/51.72 → 20.06/51.51 | 105 → 97 | 57.66 → 4.79 | 42 → 0 | 0 → 0 |
| uhd | desktop-1920 | auto | – → 31.9 | 20.47/62.3 | – → 98 | – → 5.57 | – → 0 | – → 0 |
| uhd | laptop-hidpi | high | 8.3 → 8.7 | 103.54/147.05 → 118.84/145.95 | 54 → 44 | 147.57 → 9.72 | 85 → 0 | 0 → 0 |
| uhd | laptop-hidpi | economy | 36.7 → 37.6 | 19.19/52.03 → 19/51.93 | 87 → 79 | 57.53 → 5.13 | 43 → 0 | 0 → 0 |
| uhd | laptop-hidpi | auto | – → 32.1 | 19.53/84.93 | – → 63 | – → 7.19 | – → 0 | – → 0 |
| uhd | tablet-portrait | high | 17.6 → 18.0 | 31.22/100.84 → 30.42/100.57 | 106 → 89 | 99.27 → 12.19 | 47 → 0 | 0 → 0 |
| uhd | tablet-portrait | economy | 45.6 → 47.3 | 12.37/38.56 → 12.1/38.39 | 55 → 49 | 39.07 → 5.83 | 3 → 1 | 0 → 0 |
| uhd | tablet-portrait | auto | – → 52.9 | 9.77/26.63 | – → 32 | – → 5.83 | – → 0 | – → 0 |
| uhd | phone-390 | high | 46.9 → 48.2 | 11.06/38.5 → 10.85/38.9 | 38 → 41 | 39.64 → 6.60 | 2 → 0 | 0 → 0 |
| uhd | phone-390 | economy | 58.1 → 60.0 | 9.76/15.46 → 9.65/15.45 | 0 → 0 | 17.94 → 3.06 | 1 → 0 | 0 → 0 |
| uhd | phone-390 | auto | – → 59.9 | 9.65/15.45 | – → 0 | – → 3.06 | – → 0 | – → 0 |
| sw | desktop-1440 | high | 0.0 → 0.0 | 2459.55/2459.55 → –/– | 0 → 0 | – → 111.22 | – → 70 | 0 → 0 |
| sw | desktop-1440 | economy | 0.1 → 0.0 | 981.47/1015.48 → –/– | 1 → 0 | 1013.84 → 67.85 | 17 → 53 | 0 → 0 |
| sw | desktop-1440 | auto | – → 0.0 | –/– | – → 0 | – → 67.71 | – → 58 | – → 0 |
| sw | phone-390 | high | 0.3 → 0.0 | 964.62/967.73 → –/– | 1 → 0 | 968.04 → 122.32 | 13 → 66 | 0 → 0 |
| sw | phone-390 | economy | 1.2 → 0.0 | 380.74/387.08 → –/– | 9 → 0 | 381.39 → 58.49 | 3 → 45 | 0 → 0 |
| sw | phone-390 | auto | – → 0.0 | –/– | – → 0 | – → 58.94 | – → 47 | – → 0 |

#### Thao tác (event timing, ms)

| Kích thước | Thao tác | Trước | Sau |
|---|---|---|---|
| desktop-1440 | task: Chọn ghế | 64 | 48 |
| desktop-1440 | task: Xem phim | 32 | 32 |
| desktop-1440 | task: Khám phá | 32 | 32 |
| desktop-1440 | seat on the map | 32 | 48 |
| desktop-1440 | click in the room | 24 | 24 |
| desktop-1440 | tour start | 32 | 32 |
| desktop-1440 | tour stop | 32 | 32 |
| desktop-1440 | play | 32 | 32 |
| desktop-1440 | play → picture moving | 355 | 352 |
| desktop-1440 | seek → frame | 56 | 62 |
| phone-390 | task: Chọn ghế | 48 | 32 |
| phone-390 | task: Xem phim | 32 | 32 |
| phone-390 | task: Khám phá | 32 | 32 |
| phone-390 | seat on the map | 48 | 48 |
| phone-390 | click in the room | 24 | 24 |
| phone-390 | tour start | 32 | 32 |
| phone-390 | tour stop | 32 | 32 |
| phone-390 | play | 32 | 32 |
| phone-390 | play → picture moving | 349 | 350 |
| phone-390 | seek → frame | 50 | 49 |

#### Vòng đời (sau GC)

| Mốc | Heap MiB | Node DOM | Listener | Context sống | Texture MiB |
|---|---|---|---|---|---|
| first mount | 6.00 → 6.00 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| landing after 1 mount | 4.90 → 4.97 | 298 → 297 | 35 → 35 | 0 → 0 | 0.0 → 0.0 |
| mount 2 | 6.31 → 6.37 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| mount 3 | 6.61 → 6.64 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| mount 4 | 6.76 → 6.78 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| mount 5 | 6.92 → 6.96 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| mount 6 | 7.09 → 7.17 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| mount 7 | 7.15 → 7.25 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| mount 8 | 7.23 → 7.32 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| mount 9 | 7.60 → 7.72 | 982 → 985 | 164 → 165 | 1 → 1 | 43.6 → 43.6 |
| landing after 9 mounts | 6.20 → 6.32 | 298 → 297 | 35 → 35 | 0 → 0 | 0.0 → 0.0 |

## Ảnh so sánh

Thư mục `artifacts/perf/baseline-shots/` và `artifacts/perf/after-shots/` chứa ảnh cùng góc camera:
- ở bậc Cao và Tiết kiệm;
- desktop 1440 và điện thoại 390;
- các góc: tổng quan, ghế gần ("Nhìn về ghế"), màn chiếu từ F06, kính Xem phim, giữa lúc kéo.

So sánh từng pixel trước/sau:
- **Mọi góc đứng yên của phòng: 0,00% khác.** Vòng này không đổi material, ánh sáng, tone mapping hay
  texture.
- **Phần khác còn lại** nằm ở thanh tác vụ (trạng thái nút) và ở ảnh chụp giữa/sau cú kéo (camera
  dừng lệch nhau theo nhịp thời gian).
- **Phim khi camera đứng yên:** vùng ngoài màn chiếu trùng từng pixel với khung vẽ toàn bộ (kiểm tra
  trong `yarn capture`).

Chưa có ảnh so sánh giữa các bậc trên thiết bị thật.

## Kiểm thử

Trên nhánh `perf/final-optimization`, bản build cuối:
- `yarn typecheck`; `yarn test`: 219/219 (thêm `qualityGovernor.test.ts`, kiểm tra bậc chất lượng,
  phân loại GPU, `ScreenVideo.inView`).
- `yarn build`.
- `yarn capture`: 552 kiểm tra, có các mục mới:
  - mặc định "Tự động" và bậc khởi đầu theo thiết bị; lưu lựa chọn (không lưu bậc);
  - skeleton mờ dần rồi biến mất;
  - khung phim chỉ vẽ lại màn chiếu: cả khung phim đổi, ngoài màn chiếu không đổi;
  - nhìn ra chỗ khác thì không vẽ.

  Lần chạy đầy đủ: 551/552. Mục còn lại là bộ chọn chất lượng 3 nút làm Cài đặt tràn ngang 72 px khi
  chữ 200%; đã sửa, chạy lại `ui-settings` và `ui-zoom` 17/17. Sau đó sửa thêm việc gỡ trang (bên
  dưới) và chạy lại `lifecycle`, `landing-flows`, `inspector-from-page`, `ui-flows`: 40/40.
- `yarn measure:build`: 23/23.
- `yarn acceptance`: 17/17, chạy hai lần.
  - Lần đầu luồng I lỗi: rời rạp trong 220 ms skeleton đang mờ thì bộ hẹn giờ giữ cây DOM cũ (và qua
    listener của nó là phần tử video) tới khi chạy.
  - Đã sửa: hủy bộ hẹn giờ khi gỡ trang (`stopStatusFade`).
- `node scripts/measure-perf.mjs`: các lượt nêu ở trên.

## Chưa xác minh

- **Thiết bị thật:** điện thoại, tablet, Mac/iPhone/iPad. Mọi số đo "phone"/"tablet" ở trên là
  viewport giả lập trên máy desktop.
- **Safari và Firefox:** không chạy. Ở đó không có `EXT_disjoint_timer_query_webgl2`, nên "Tự động"
  chỉ dựa vào khoảng cách khung. Chưa đo `KHR_parallel_shader_compile` và hành vi của
  `preserveDrawingBuffer`.
- **GPU khác:** AMD, Apple, Adreno/Mali, Intel Arc. Chỉ đo RTX 3090, UHD 770 và SwiftShader.
- **Giải mã video bằng phần cứng:** chưa so headless với trình duyệt có giao diện.
- **Màn hình 120/144 Hz:** headless chạy 60 Hz.

## Còn lại

- **Năm đèn area là chi phí lớn nhất trên GPU tích hợp** (một nửa thời gian GPU của tour). Muốn tour
  đạt 60 fps trên GPU tích hợp ở 1080p mà không đổi ánh sáng, cần bake ánh sáng tĩnh vào lightmap.
  Đó là việc lớn, nằm ngoài vòng này.
- **Tải ấm có lúc tới "ready" chậm hơn một chút:**
  - desktop, CPU chậm 4×: 952 → 1059 ms;
  - điện thoại, cục bộ: 235 → 266 ms;
  - nhưng điện thoại với CPU chậm 4× thì 1139 → 1041 ms.

  Đây là cái giá của việc chia nhỏ để trang luôn phản hồi: long task dài nhất giảm từ 447–582 ms
  xuống 131–135 ms, TBT giảm khoảng một nửa. Tải lạnh (lần vào đầu) nhanh hơn 30–60%.
