# Bàn giao Prompt 07: phát video trên màn chiếu 3D

Trạng thái: hoàn thành, chờ duyệt (27/10/2026). Chưa commit, push hay deploy. Không nâng dependency nào. Nền: commit `8c92391` (Prompt 06), working tree sạch khi bắt đầu.

## Hiện trạng và baseline

- Source khớp `handoff-prompt-06.md`.
- Baseline đo trên code Prompt 06, chưa sửa gì: `artifacts/prompt-07/baseline/`, **261/261** check pass.
- Ảnh trước/sau cùng camera, viewport và chất lượng: `compare-p06-p07-*.png`. Khác biệt duy nhất trong cảnh là poster trên màn; khung 3D thấp hơn một chút vì player nằm dưới.
- Hợp đồng giữ nguyên: chọn ghế, sơ đồ, picking, camera/tour/khám phá, chất lượng, inspector, render theo nhu cầu. Không đổi tone mapping, đèn, vật liệu hay kích thước màn.

## Nguồn video và giấy phép

*Big Buck Bunny* trailer (2008), © Blender Foundation, **CC BY 3.0**, tải từ `download.blender.org/peach/trailer/trailer_720p.mov`. Giấy phép xác minh tại https://peach.blender.org/about/ và trên khung cuối của chính trailer. Chuyển mã sang MP4 (H.264 + AAC, 1280×720, 33,04 s, **8,34 MB**) bằng `MediaRecorder` của Chrome, không cắt. Chi tiết, hash, thay đổi và dòng ghi công: `docs/media-credits.md`.

- Tệp: `public/media/big-buck-bunny-trailer-720p.mp4` và poster `public/media/big-buck-bunny-trailer-poster.jpg` (100 KB). Cùng origin, không CORS, không YouTube, không base64, không fetch/blob cả tệp.
- Player luôn hiện: "(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org · CC BY 3.0", có liên kết.
- Clip kiểm tra do code sinh (`scripts/make-media-fixtures.mjs` → `fixtures/media/`): bảng màu 16:9, 9:16, 2,39:1, không tiếng, WebM không có thời lượng, tệp không phải video, tệp hỏng dữ liệu. Chỉ dùng trong dev qua `/cinema?film=<tên tệp>`; không vào `dist/`.

## Kiến trúc và quyền sở hữu

| Module | Trách nhiệm |
| --- | --- |
| `media.ts` | Cấu hình phim (`FilmSource`, `DEMO_FILM`) và credits; `devFilm()` cho fixture (chỉ dev) |
| `mediaController.ts` | Sở hữu **một** `HTMLVideoElement` (một luồng âm thanh). Trạng thái lấy từ sự kiện media, token thế hệ cho `play()`, tạm dừng vì lý do hệ thống, thử lại, giải phóng |
| `screenVideo.ts` | Gắn video lên màn: tấm đen phủ vùng hình, mặt hình fit kiểu contain, `VideoTexture` và poster. Chỉ sở hữu tài nguyên GPU |
| `videoFrames.ts` | `VideoFrameClock`: xin render theo frame video (rVFC), fallback hẹn giờ có giới hạn |
| `playerUi.ts` | Điều khiển, thanh tua, âm lượng, trạng thái/lỗi, credits, live region |
| `sharedTextureListeners.ts` | Workaround nội bộ three.js (mục riêng bên dưới) |
| `page.ts` | Vòng đời: tạo controller theo mount, ẩn tab, mất context, lưu vị trí khi rời trang, chế độ 2D |
| `view.ts` | Đặt `ScreenVideo` trong nội dung GPU (dựng lại khi khôi phục context), đồng hồ frame, hook dev |

Quyền sở hữu:
- `page` tạo `MediaController` một lần cho mỗi lần mount. Đổi ghế, camera, chất lượng không tạo element mới (có check cùng element).
- `view` sở hữu `ScreenVideo` (geometry, material, texture) và `VideoFrameClock`; không bao giờ dispose element.
- `CinemaSession.media` (trong `main.ts`) giữ `{ time, muted, volume, started }` qua lần mở inspector; luôn quay lại ở trạng thái tạm dừng.

## Trạng thái media

`idle → loading → ready → playing ⇄ paused`, cùng `buffering`, `ended`, `error`. Chỉ đổi theo sự kiện của element (`loadstart`, `loadedmetadata`, `playing`, `waiting`, `pause`, `ended`, `error`…). Gọi `play()` không làm UI thành "đang phát": chỉ sự kiện `playing` làm vậy.

- **Token thế hệ.** `play`, `pause`, `suspend`, `retry`, `dispose` đều tăng token. Promise `play()` đã cũ khi settle sẽ không đổi gì, và tạm dừng lại element nếu nó lỡ chạy. Kết quả trả về là `'playing' | 'blocked' | 'cancelled' | 'error'`.
- **Race đã xử lý (unit test + trình duyệt):** play rồi pause ngay; play rồi rời trang; tua khi đang tải (ghi nhận, áp sau `loadedmetadata`); mất context khi `play()` còn chờ.
- **Thông báo** (`notice`): `blocked` (trình duyệt từ chối), `hidden` (ẩn tab), `context-lost`, `slow` (buffering liên tục quá 12 s). Không bao giờ tự thử lại.
- **Mặc định:** `preload="metadata"`, `playsInline`, không autoplay, không loop. Âm thanh như người dùng để lại; không tự bật tiếng.
- **Âm lượng:** đọc lại `muted`/`volume` từ element (`volumechange`). Nơi script không đặt được volume (iOS: thử đặt rồi đọc lại), slider bị ẩn và thay bằng gợi ý "dùng phím của thiết bị". Trên màn hẹp, slider luôn ẩn.
- **Không có âm thanh** (phát hiện sau ~0,5 s phát, qua `webkitAudioDecodedByteCount` / `audioTracks` / `mozHasAudio`): nút tắt tiếng bị khoá và ghi "Video không có âm thanh".
- **Thời lượng chưa biết** (`Infinity`/`NaN`): thanh tua bị khoá, hiện `--:--`, không đoán. Tua ngoài khoảng bị kẹp vào `[0, duration − 0,05]`.

## Màu và tỷ lệ

- **Màu.** `VideoTexture` với `SRGBColorSpace` trên `MeshBasicMaterial({ toneMapped: false })`: không chịu đèn phòng, không tone mapping. Hình được giải sRGB một lần khi lấy mẫu và mã hoá lại sRGB một lần khi xuất, giống màn trắng cũ. Tone mapping toàn cảnh không đổi.
  - Đối chiếu bằng fixture bảng màu, cùng một frame đang dừng: pixel canvas (`gl.readPixels`) so với frame do trình duyệt tự vẽ lên canvas 2D. **Chênh tối đa 1/255** trên 7 vạch màu, thang xám 0/64/128/192 và marker cam. Xám 128 vẫn là 128.
- **Hướng.** Marker "TL" nằm đúng góc trên trái: không lật, không soi gương.
- **Tỷ lệ.** Màn giữ 8,5 × 4,78 m (16:9). Hình fit kiểu contain, phần thừa là tấm đen (letterbox/pillarbox). Tính lại khi có metadata và khi `resize`.
  - Đo được: 9:16 → 2,69 × 4,78 m; 2,39:1 → 8,5 × 3,56 m. Dải đen đo được là 0/0/0.
- **Không z-fighting.** Tấm đen đặt trước mặt màn cũ 2 mm, hình đặt trước 4 mm; khung màn nhô 3 cm nên che mép.
- **Trước khi có frame hợp lệ:** hiện poster. Nếu poster chưa tải xong thì hiện màn trắng cũ. Sau lỗi, poster quay lại. Khi chuyển sang video, frame hiện tại được upload ngay, nên không có khung đen hay texture rác.
- Area light của màn giữ màu/cường độ cũ; không đọc pixel video; không thêm tia chiếu, fog hay hậu kỳ.

## Lập lịch render

- **`VideoTexture` r186** tự đăng ký `requestVideoFrameCallback` để đặt `needsUpdate` mỗi frame được trình chiếu, nhưng không xin render. `VideoFrameClock` đăng ký đúng một callback riêng khi đang `playing`, và chỉ gọi `host.requestRender()`. Như vậy không có upload trùng: upload do texture lo, lịch render do đồng hồ lo.
- `RenderHost.requestRender` gộp mọi yêu cầu (camera, hover, chọn ghế, video) thành tối đa một frame mỗi lần trình duyệt vẽ.
  - Đo khi camera di chuyển và phim đang phát: **61 lần render trong 61 frame trình duyệt**.
- **Camera đứng yên, phim đang phát:** số lần render bằng số frame video được trình chiếu (~20 lần/s trong Chrome headless, `dropped` = 0), không theo tần số màn hình.
- **Pause, kết thúc, buffering, ẩn tab, mất context:** đồng hồ huỷ callback. Sau pause hoặc tua khi đang dừng, view upload frame hiện tại một lần rồi vẽ một frame, sau đó **0 lần render/s**.
- **Fallback khi không có rVFC:** hẹn giờ 30 lần/s chỉ trong lúc `playing`; `VideoTexture.update()` tự upload mỗi lần render.
  - Đo bằng cách xoá API: 30,4 lần render/s khi phát, 0 khi dừng.
- Shadow map vẫn tĩnh (chỉ vẽ lại khi cảnh đổi). Không cập nhật environment hay PMREM.
- **Sửa thêm (có từ trước, lộ rõ khi xem phim):** đổi kích thước canvas sẽ xoá nó. Khi container đổi cỡ (mở sơ đồ ghế, đổi cửa sổ, xoay máy), `ResizeObserver` chạy *sau* rAF của frame đó, nên frame xin từ đó rơi sang frame sau và trình duyệt hiện canvas trống một khung.
  - Nay `RenderHost` vẽ ngay trong callback (trước khi paint).
  - Đổi chất lượng vẫn dùng `requestRender`, vì được gọi từ task click nên rAF vẫn kịp trước paint. Vẽ ngay ở đó thì gặp shadow map vừa bị giải phóng; bản thử đầu làm vậy và sinh cảnh báo `GL_INVALID_OPERATION … sampler type`, đã bỏ.
  - Có check screencast cho cả hai trường hợp.

## Quy tắc tạm dừng, khôi phục, giải phóng

| Sự kiện | Hành vi |
| --- | --- |
| Ẩn tab | `suspend('hidden')`: pause, huỷ callback. Quay lại không tự phát; nút ghi "Tiếp tục" |
| Mở inspector | Lưu `{time, muted, volume, started}` vào session, pause, dispose controller (bỏ `src`, `load()`, nên giải phóng decoder và kết nối). Inspector không có element media nào sống (đếm sau GC = 0). Quay lại: tạm dừng đúng thời điểm, âm thanh như cũ, hiện frame |
| Đổi Cao/Tiết kiệm | Không đụng media hay `ScreenVideo`; vẫn phát, giữ thời gian, tiếng, cùng element |
| Mất WebGL context | Page `suspend('context-lost')`, nút phát bị khoá kèm lý do. View dừng đồng hồ và dispose `ScreenVideo` ngay lúc mất (sự kiện dispose chỉ tới bộ quản lý của context đang chết, nên lệnh GL không làm gì; huỷ luôn rVFC của texture). Metadata giữ trong element |
| Khôi phục | Dựng lại `ScreenVideo` cùng nội dung GPU; hiện frame hiện tại (hoặc poster); giữ ghế và camera; không tự phát hay bật tiếng; nút "Tiếp tục" |
| Rời trang / hot reload | Lưu session, pause, `view.dispose()` (texture, material, geometry của player; đồng hồ), huỷ listener của player, `media.dispose()`. Tài nguyên dùng chung của phòng không bị đụng. Promise cũ không khởi động lại được |

## Workaround nội bộ three.js (`sharedTextureListeners.ts`)

- **Nguyên nhân (r186).** Các bảng LTC (`UniformsLib.LTC_*`) và bảng DFG của vật liệu PBR là texture chung cả trang. Context nào upload chúng cũng thêm `onTextureDispose` của mình làm listener `dispose`, và không ai gỡ khi context mất hoặc renderer bị huỷ. Closure cũ giữ cả bookkeeping của context cũ (đo ở Prompt 06: ~0,37 MiB mỗi lần khôi phục).
- **Thay đổi so với Prompt 06.** Bản cũ chụp và gỡ *mọi* listener trên các texture đó. Nay chỉ gỡ listener **đã chứng minh thuộc context đã kết thúc**:
  - Một texture probe 1×1 riêng được renderer này upload ở mỗi context.
  - Listener trên probe chính là `onTextureDispose` của context hiện tại (mỗi bộ quản lý texture dùng một hàm cho mọi texture).
  - Khi mất context hoặc dispose renderer, chỉ đúng hàm đó bị gỡ khỏi texture chung.
  - Listener của renderer khác và mọi texture khác (kể cả `VideoTexture`) không bị đụng. Unit test có listener "ngoại lai" và texture phim để chứng minh.
- **Điều kiện áp dụng:** một renderer giữ một context. Gọi `attach` khi context lên, `collect` sau mỗi frame, `release` khi mất, `dispose` khi huỷ renderer. In ghi chú ở dev nếu `REVISION` khác `186`.
- **Cách bỏ:** khi three.js tự gỡ listener lúc mất context và lúc dispose renderer, xoá module và các lệnh gọi trong `RenderHost`. Check lifecycle của `npm run capture` (mỗi texture chung chỉ một listener sau nhiều lần khôi phục/remount) cho biết còn cần hay không.
- **Video không bị ảnh hưởng:** sau mất/khôi phục, phim vẫn phát và vẽ frame mới (23,9 frame/s). Không có cảnh báo "does not belong to this context".
- **Không khẳng định về bộ nhớ GPU:** chỉ đo được số đếm `renderer.info`, đối tượng JS sống sau GC và heap JS.

## Input và accessibility

- **Vị trí.** Player nằm **dưới** khung 3D, trong cột riêng (`.cinema-screen`), không phủ lên canvas, cần điều khiển, nút "Trở về" hay sơ đồ. Mobile dọc: giữa khung 3D và bottom sheet. Mobile ngang: một hàng điều khiển và một dòng credits nhỏ. Có tính safe area.
- **Cô lập thao tác.**
  - Bấm hay kéo trên player không chọn ghế, không xoay camera (có check).
  - `data-keys="own"` khiến mũi tên/WASD/Space khi focus ở player không điều khiển người đi bộ.
  - Không có phím tắt toàn trang: Space khi không focus gì không phát/dừng.
- **Bàn phím.** Thanh tua: ←/→ ±5 s, PageUp/PageDown ±10 s, Home/End. Khi đang giữ chuột trên thanh tua, `timeupdate` không kéo thumb về.
- **Nhãn và trạng thái.**
  - Nút chính có `aria-label` theo trạng thái ("Phát", "Tạm dừng", "Tiếp tục", "Phát lại").
  - Tắt tiếng là nút bật/tắt (`aria-pressed`).
  - Slider có `aria-valuetext` ("0:12 trên 0:33", "80 % (đang tắt tiếng)").
  - Live region chỉ đọc khi đổi trạng thái hoặc có sự cố, không đọc theo giây.
- **Phụ đề:** trailer không có lời thoại, nên không có phụ đề; player chưa hỗ trợ phụ đề. Accessibility chỉ được kiểm tra qua thuộc tính và hành vi phím, chưa thử với trình đọc màn hình thật.

## Lỗi và fallback

| Trường hợp | Kết quả (đã kiểm tra trong trình duyệt) |
| --- | --- |
| Tệp không tồn tại | Dev server trả `index.html`, Chrome báo lỗi 4: "Không mở được video: tệp không tồn tại hoặc trình duyệt không hỗ trợ định dạng này." |
| Không phải video / codec không hỗ trợ | Như trên. Nếu `canPlayType` trả rỗng thì báo lỗi ngay, không tải |
| Lỗi giải mã (tệp hỏng) | "Video bị lỗi khi giải mã." |
| Trình duyệt chặn `play()` | Thông báo, nút vẫn là "Phát", không giả "đang phát"; bấm lại khi được phép thì phát |
| Mạng chậm | `buffering` với "Đang chờ dữ liệu…", sau 12 s thêm thông báo mạng chậm và nút "Tải lại"; dữ liệu về lại thì tự phát tiếp |
| Không có âm thanh / chưa biết thời lượng | Xem mục Trạng thái media |
| Không có WebGL | Sơ đồ vẫn chạy như Prompt 06. Phim phát dạng 2D bằng **cùng element và cùng điều khiển** trong vùng khung nhìn, ghi rõ "Đang xem video ở chế độ 2D". Không có 3D nên không bao giờ phát song song |

Không spinner vô hạn: lỗi luôn tắt spinner, khoá nút phát và hiện "Thử lại". Không tự thử lại.

## Số đo

Chrome 156 headless, ANGLE D3D11, RTX 3090. Viewport 1440 × 900, DPR 1, mức Cao, góc Tổng quan, panel đóng.

| Tình huống | Render/s | Draw call | Tam giác | Geometry / texture / program |
| --- | --- | --- | --- | --- |
| Prompt 06 (baseline) | 0 | 38 | 682 990 | 39 / 8 / 11 |
| Chưa phát (poster) | 0 | 40 | 682 994 | 41 / 10 / 11 |
| Đang phát, camera đứng | 19,9 (= 19,9 frame video/s) | 40 | 682 994 | 41 / 11 / 12 |
| Đang phát, camera di chuyển | 61 trong 61 frame trình duyệt | — | — | — |
| Tạm dừng, đứng yên | 0 | — | — | — |

- Phần tăng thêm: tấm đen và mặt hình (+2 draw call, +4 tam giác, +2 geometry); texture poster và probe của workaround (+2 texture); `VideoTexture` khi phát (+1 texture); biến thể `map` của `MeshBasicMaterial` (+1 program).
- **Media:** 1280×720, 33,04 s. Decode 50 frame / 2,5 s, `dropped` = 0 (`getVideoPlaybackQuality`). Trong lần thử nhanh không có panel: ~26 frame/s; tệp nguồn khoảng 24–25 frame/s.
- **Thời gian frame** (đường camera cố định 120 frame trong lúc phim phát): CPU submit trung vị 0,1 ms; GPU trung vị 2,98 ms, p95 7,5 ms (timer `EXT_disjoint_timer_query_webgl2`). Lần chạy trước: 0,90 / 7,5 ms. Không phát: 0,90 / 4,7 ms. Dao động giữa các lần chạy lớn hơn chênh lệch giữa phát và không phát.
  - GPU timer chỉ đo lệnh vẽ của WebGL, không gồm giải mã video, upload texture trong driver, compositing hay âm thanh. Headless không phản ánh tải thật trên điện thoại.
- **Dung lượng:**
  - JS chính 989,2 kB (gzip 304,9 kB), trước là 968,9 / 299,0 kB.
  - Video 8,34 MB và poster 100 KB nằm riêng trong `dist/media/`. Chỉ tải metadata cho tới khi bấm Phát.
- **Vòng đời:**
  - 13 vòng phát/dừng/tua cộng 3 lần mở/đóng inspector: đúng **1** `MediaController`, **1** `HTMLVideoElement`; số Texture, Material, Geometry sống không đổi (33/59/100); listener window/document không đổi (27/4); subscriber 2; callback chờ 0; tài nguyên renderer không đổi. Heap JS sau GC 14,18 → 14,52 MiB (< 1 MiB, không chứng minh là 0).
  - 4 lần khôi phục context: đối tượng và listener không đổi, heap +0,33 MiB (baseline +0,32).
  - 6 lần mở/đóng inspector: heap +0,52 MiB (baseline +0,50).
  - Mỗi texture chung chỉ giữ 1 listener.

## Kiểm tra

- **`npm test`: 160/160** (10 file; trước là 136/8).
  - `media.test.ts` (fake element, sự kiện do test phát): không autoplay; "playing" chỉ theo sự kiện; `play()` bị từ chối; play → pause; play → rời trang; mất context khi play chờ; ẩn tab; tua khi đang tải; kẹp tua; thời lượng không biết; kết thúc/phát lại; buffering và thông báo chậm (fake timer, không tự thử lại); lỗi và thử lại; `canPlayType`; mute/volume; phát hiện không tiếng; resume từ session; contain; poster/video; định dạng giờ; nút chính; `devFilm`.
  - Cũng trong `media.test.ts`: `VideoFrameClock` (một callback, nhiều vòng không tích tụ, fallback giới hạn).
  - `sharedTextureListeners.test.ts`: chỉ gỡ listener của context đã kết thúc, giữ listener ngoại lai và texture phim, 20 vòng không tích tụ.
- `npm run typecheck`: sạch. `npm run build`: thành công (cảnh báo chunk > 500 kB như trước).
- **`npm run capture`: 325/325**, 0 cảnh báo console ngoài dự kiến. 63 check video mới gồm:
  - không autoplay; poster; phát thật (currentTime tăng, frame decode/trình chiếu, ảnh trên màn đổi);
  - nhịp render; mute/volume đọc lại từ element; giữ thanh tua; ←/→; pause dừng render; tua khi dừng hiện frame mới rồi dừng;
  - player không chọn ghế, không xoay camera, không làm người đi bộ di chuyển; Space;
  - chọn ghế 3D và xem từ F06 khi đang phát; đổi chất lượng khi đang phát; ẩn/hiện tab; kết thúc/phát lại;
  - mất/khôi phục context khi đang phát và khi `play()` còn chờ; inspector; play → pause → rời trang;
  - vòng đời; mở panel / đổi chất lượng không có khung trống;
  - màu, hướng, 9:16, 2,39:1, không tiếng, không thời lượng;
  - 3 loại lỗi và "Thử lại"; `play()` bị chặn; mạng chậm (giả lập bằng cách giữ request range ở route Playwright); không có rVFC;
  - mobile dọc/ngang (sheet, seat view, khám phá); 2D khi không có WebGL.
- **Bằng chứng âm thanh:** có track được giải mã (`webkitAudioDecodedByteCount` > 0); `muted`/`volume` đọc lại từ element sau khi bấm. **Chưa kiểm chứng bằng tai.**
- **Lỗi "no tests" của Vitest:** chạy `npm test` 4 lần ở chế độ ổn định (không sửa file đồng thời, lưu stdout/stderr và exit code), đều 160/160, exit 0. Không tái diễn nên không có log lỗi để điều tra thêm. Log ở `artifacts/prompt-07/logs/`.

## Ảnh và video (`artifacts/prompt-07/`)

- `film-1-waiting-overview` (poster), `film-2-playing-overview`, `film-4-playing-from-F06`
- `film-3-paused-after-seek`, `film-5-ended`, `film-6-context-restored-paused`
- `film-7-colour-check-16x9`, `film-8-pillarbox-9x16`, `film-9-letterbox-239`
- `film-10-error-not-a-video`, `film-11-error-decode`, `film-12-play-blocked`, `film-13-slow-network`
- `film-14-2d-fallback`
- `film-mobile-{portrait,landscape}-{playing,seat-view,explore}`
- Video `video-film-seat-view-play-pause.webm`: chọn ghế → xem từ ghế → phát → tạm dừng.
- Các ảnh, video và so sánh của Prompt 05–06 được chụp lại; `report.json` có mục `film` (số đo, màu, vòng đời).

## Hạn chế và phần chưa kiểm chứng

- **Âm thanh** chưa nghe bằng tai.
- **Thiết bị và trình duyệt:** chỉ chạy Chrome 156 desktop (headless) với giả lập mobile. Chưa thử điện thoại thật, Safari/iOS (volume, `playsInline`, MP4 phân mảnh từ MediaRecorder), Firefox (rVFC từ v132), hay trình đọc màn hình.
- **Mạng chậm** chỉ được giả lập ở phía server (giữ request range). Với MP4 này, thời lượng chỉ biết khi đọc được cuối tệp, nên khi mạng chậm thời lượng hiện `--:--` một lúc.
- **Chất lượng video:** bản chuyển mã thời gian thực có thể lặp vài frame (Chrome báo 15 frame bị bỏ khi ghi) và chất lượng nén thấp hơn bản gốc.
- **Bố cục:** mobile dọc khi mở sơ đồ thì khung 3D còn ~14 % màn hình (player 2 dòng + sheet 48 %); nên sắp xếp lại ở Prompt 08.
- **Bộ nhớ:** không đo trực tiếp bộ nhớ GPU. Heap JS tăng ~0,35 MiB sau nhiều vòng (tương đương baseline).

## File

- **Mới:** `src/cinema/{media,mediaController,screenVideo,videoFrames,playerUi,sharedTextureListeners}.ts`, `src/cinema/{media,sharedTextureListeners}.test.ts`, `scripts/make-media-fixtures.mjs`, `fixtures/media/*`, `public/media/*`, `docs/media-credits.md`, tài liệu này.
- **Sửa:** `src/cinema/{view,page,renderHost,ui,exploreInput}.ts`, `src/main.ts`, `src/styles.css`, `scripts/capture-views.mjs` (thư mục mặc định `prompt-07`, mục film, `compare-p06-p07-*`).
- **Lệnh:**
  - `npm test`, `npm run typecheck`, `npm run build`
  - `npm run capture` (khoảng 16 phút)
  - `node scripts/make-media-fixtures.mjs` (sinh lại fixture)
  - `npm run dev` rồi mở `/cinema` hoặc `/cinema?film=pattern-16x9.mp4`
