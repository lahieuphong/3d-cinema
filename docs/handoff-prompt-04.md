# Bàn giao Prompt 04: vật liệu, ánh sáng và chất lượng render

Trạng thái: hoàn thành, chờ duyệt (27/10/2026). Chưa commit, push hay deploy. Không nâng dependency nào (Vite 8.3.5, TypeScript 6.0.3, three 0.186.1, Vitest 5.0.5, playwright-core 1.64.1). Working tree vẫn chứa thay đổi chưa commit của Prompt 02 và 03, trên nền commit `90655a7`.

## Baseline trước khi sửa

- Source khớp `handoff-prompt-03.md`. Đo lại bằng harness với code Prompt 03 (chỉ thêm hook đo, không đổi hình ảnh), lưu ở `artifacts/prompt-04/baseline/` (79/79 check pass).
- Góc tổng quan 1440 × 900, DPR 1: **35 draw call, 682 966 tam giác**, 35 geometry, 2 texture. GPU trung vị 1,04 ms/khung trên đường camera cố định.
- Hợp đồng giữ nguyên: 110 ghế A01–J11, `SeatData` và thứ tự `seats[]`, pivot, hướng −Z, vị trí và cao độ ghế, footprint, thông thủy lối đi 1,50 m, vị trí màn, vách, trần, cửa và thiết bị, preset camera, ánh xạ instance và `seatForInstance`, inspector, render theo nhu cầu.

## Vật liệu (`src/cinema/materials.ts`)

Mọi vật liệu được chiếu sáng đều là `MeshStandardMaterial`/`MeshPhysicalMaterial`, để area light tác động được. `envMapIntensity` điều chỉnh mức phản chiếu môi trường dựng bằng code: kim loại dùng nhiều, vải gần như không dùng.

| Vai trò | Màu | Độ nhám / kim loại / env | Ghi chú |
| --- | --- | --- | --- |
| Da ghế (`upholstery`) | `#6e1328` đỏ rượu vang | 0,6 / 0 / 0,3 | Không kim loại, vùng sáng rộng và mềm. Đường may tối hơn bằng vertex color (`padShape.seamShade` 0,3), không thêm hình học đường chỉ |
| Vỏ lưng ghế (`shell`) | `#601226` | 0,68 / 0 / 0,25 | Cùng loại da, tông sâu hơn và lì hơn để tách khỏi đệm |
| Khung ghế (`frame`) | `#25282f` graphite | 0,78 / 0 / 0,25 | Sơn tĩnh điện lì. Mặt phẳng không loé khi nhìn sát mặt |
| Kim loại ghế (`metal`, mới) | `#3d3e43` | 0,38 / 0,85 / 0,7 | Thép tối lộ ra: trục, đế chân, bản lề. Tách khỏi phần sơn |
| Lòng cốc (`cupWell`) | `#151619` | 0,8 / 0 / 0,1 | Tối nhưng vẫn thấy hình |
| Thảm, bậc ghế (`carpet`) | `#33292d` + texture | 1 / 0 / 0,05 | Lì. Có vân vi mô rất nhẹ (bên dưới) |
| Lối đi (`aisle`) | `#45393e` + cùng texture | 1 / 0 / 0,05 | Sáng hơn thảm một bậc |
| Panel tiêu âm (`panel`) | `#48454a` | 1 / 0 / 0,05 | Lì hoàn toàn. Charcoal ấm, không xám bạc |
| Tường, tấm trần (`wall`) | `#4a4447` | 0,95 / 0 / 0,05 | |
| Graphite kiến trúc (`graphite`) | `#38393d` | 0,8 / 0 / 0,25 | Dầm, vòm, chân tường, cửa, thùng loa, hộp che ray |
| Champagne (`trim`) | `#9a8b70` | 0,5 / 0,75 / 0,6 | Phản chiếu rộng, mềm. Độ nhám tăng từ 0,42 và env giảm từ 0,9 để nẹp không thành vạch vàng chói |
| Rèm (`curtain`) | `#5c0f1b` | 0,9 / 0 / 0,05, sheen 0,7 `#9a3341` | Đỏ sâu và ngả lạnh hơn ghế. Nếp hiện ra nhờ hướng đèn, không dùng normal map |
| Khe đèn (`lightSlot`) | emissive `#ffc98f` × 0,7 | — | Chỉ đánh dấu nguồn sáng. Giảm từ 0,9 để khe có màu hổ phách, không trắng |
| Mũi bậc (`aisleNosing`) | emissive `#ffb866` × 0,45 | — | |
| Màn (`screen`) | `#d9dfe7`, unlit, không tone map | — | Trung tính, hơi lạnh. Hạ từ `#e8edf3` để màn không lấn át |
| Biển thoát hiểm | `CanvasTexture`, unlit, không tone map | — | Giữ đúng màu xanh và trắng |

**Texture tạo bằng code.** Chỉ có một texture mới, dùng cho thảm (`createCarpetTexture`):

- 128 × 128 RGBA8, khoảng 85 KiB tính cả mipmap. Seed cố định `0x5eed2604`.
- Nhiễu trắng làm mờ hai lần theo kiểu wrap để lặp liền mạch. Giá trị ép vào dải 228–255, nên chỉ điều biến màu thảm vài phần trăm và không nhấp nháy khi camera di chuyển.
- Dùng không gian màu sRGB, RepeatWrapping, mipmap và anisotropy tối đa 8. Mỗi ô lặp 0,5 m theo UV toạ độ thế giới (`withWorldUv` trong `architecture.ts`).
- Tạo một lần cho mỗi scene, dùng chung cho thảm và lối đi. `disposeMaterials` giải phóng mỗi texture đúng một lần.

## Ánh sáng (`src/cinema/lighting.ts`)

Chỉ có một trạng thái ánh sáng, "Khám phá rạp". Không có đèn chuyển động, bụi, chùm sáng, bloom, fog hay vignette. Cường độ được chỉnh bằng mắt cho tone mapping ở exposure 1, không phải số đo quang học thật.

| Nhóm | Đèn | Loại, màu, cường độ | Gắn vào | Vai trò |
| --- | --- | --- | --- | --- |
| A. Nền | `base` | Hemisphere, trời `#857565`, đất `#7a5a4a`, 2,0 | phòng | Thay cho ánh sáng gián tiếp. "Trời" là ánh sáng từ hốc và khe đèn chiếu xuống. "Đất" là ánh sáng ấm dội lên từ thảm và ghế, đây là nguồn duy nhất chiếu tới trần |
| A. Đèn chính | `ceiling-downlight` | Directional `#ffe2c4`, 1,5 | trần | Đại diện cho các khe đèn dầm. **Nguồn đổ bóng duy nhất** |
| B. Màn | `screen` | RectAreaLight `#dde7f5`, 1,6, đúng kích thước màn | phòng | Ánh trung tính, hơi lạnh lên bục và các hàng đầu. Vật liệu màn tự nó không chiếu sáng gì |
| C. Hốc trần | `cove-left`, `cove-right` | RectAreaLight `#ffc98f`, 45, dài bằng vòm × 5 cm | trần | Mỗi bên một đèn, rửa sáng vách từ trên xuống |
| C. Dẫn lối | `aisle-guide-left`, `aisle-guide-right` | RectAreaLight `#ffc98f`, 28, dài bằng cầu thang × 3 cm | phòng / vách phải | Chiếu lên bậc từ hốc tay vịn. Mỗi lối đi một đèn, không đặt đèn theo từng bậc |
| D. Rèm | `curtain-left`, `curtain-right` | SpotLight `#ffe4cc`, 90, góc 0,5, penumbra 0,8 | trần | Đặt trên trần, phía trong và phía trước rèm, chiếu chéo ngang qua các nếp để tạo khối |

- **Nguồn sáng thật cho đèn dẫn lối.** Có thêm một dải LED nhỏ `guide-strip-*` (vật liệu `lightSlot`, 12 × 20 mm) trong hốc tay vịn, song song cầu thang, sát dưới mép panel. Dải nằm ngoài mặt panel X ±6,00, nên thông thủy lối đi không đổi. Test kiểm tra dải nằm sau tay vịn và cao hơn chân tường.
- **Quy tắc bật/tắt.** Đèn tắt cùng bộ phận nó gắn vào: ẩn trần thì tắt hai đèn hốc và hai đèn rèm; ẩn vách phải thì tắt `aisle-guide-right`. Khi ẩn trần, đèn chính đổi sang màu kiểm tra trung tính `#f2efea` (`inspection-light`) và vẫn đổ bóng, nên phòng vẫn đủ sáng để xem. Hiện lại thì mọi thứ trở về như cũ.
- **Môi trường phản chiếu** (`environment.ts`): một phòng tối dựng bằng code, có dải sáng ấm HDR ở mép trần và dầm, một tấm lạnh ở vị trí màn và một mặt sàn ấm. Lọc trước một lần bằng `PMREMGenerator.fromScene` (sigma 0,04, đặt ở tầm mắt giữa phòng). Không dùng HDRI ngoài trời, không cập nhật mỗi khung, không hiển thị làm nền. Đây là xấp xỉ, không phải phản chiếu thật của phòng. Sau khi mất và khôi phục ngữ cảnh WebGL, môi trường được dựng lại.
- **API của three r186:** `RectAreaLightUniformsLib.init()` không tự chống gọi lặp, nên bọc trong một guard cấp module. RectAreaLight chỉ tác động lên Standard/Physical, nên mọi vật liệu được chiếu sáng đều dùng hai loại này.

## Pipeline màu, tone mapping, exposure

- Texture màu được giải mã sRGB → linear, chiếu sáng trong không gian linear. Tone mapping chỉ áp **một lần** trong shader vật liệu rồi ghi thẳng ra canvas sRGB. Không có post-processing, nên không bị tone map hay gamma hai lần.
- Chọn **`NeutralToneMapping`** (Khronos PBR Neutral), exposure 1,0:
  - Giữ màu gần tuyến tính ở vùng tối và trung bình, chỉ nén phần sáng. Đỏ rượu vang của ghế và đỏ rèm giữ đúng sắc độ.
  - ACES đẩy đỏ sang cam và làm tăng tương phản vùng tối.
  - AgX làm xám các màu đỏ bão hoà.
- Không hack exposure toàn cục. Vùng tối được nâng bằng albedo charcoal hợp lý (độ phản xạ linear khoảng 0,04–0,07) và ánh sáng nền ấm.
- Kiểm tra trên ảnh (độ sáng sRGB 0–255, trung vị theo vùng): vách dưới khoảng 23, vách trên khoảng 33, trần khoảng 15–23, cửa khoảng 16. Ở Prompt 04 lần đầu chưa chỉnh, các vùng này chỉ khoảng 3–8.
- Màn là bề mặt sáng nhất, khoảng 222/255, không cháy. Khe đèn sáng nhất ở mức hổ phách (244, 192, 136), không cháy trắng. Màu trắng thuần duy nhất là hình vẽ trên biển thoát hiểm, đúng chủ ý.

## Bóng đổ và khử răng cưa

- **Một nguồn đổ bóng:** đèn chính, dùng `PCFShadowMap` với `shadow.radius` (r186 đã bỏ `PCFSoftShadowMap`). Bias −0,0004, normalBias 0,025: không bị shadow acne hay bóng tách khỏi chân ghế trong các ảnh cận (`material-3-seat-legs-carpet.png`).
- **Camera bóng ôm sát hộp kết cấu phòng** (`fitShadowCamera`). Test kiểm tra phòng nằm trọn trong khung và khung không vượt quá đường chéo phòng + 1 m.
- **Vật đổ bóng:** ghế, panel, graphite, champagne, rèm, máy chiếu, bục. Mọi thứ khác chỉ nhận bóng. Nhóm trần và màn không đổ cũng không nhận bóng. Ghế nằm sát sàn nhờ bóng mềm ngay dưới ghế, không dùng decal oval.
- **Bóng tĩnh:** `shadowMap.autoUpdate = false`. Shadow map chỉ được vẽ lại khi tải, khi ẩn/hiện một bộ phận, khi đổi chất lượng và sau khi khôi phục ngữ cảnh. Di chuyển camera không vẽ lại (đã có check). Ẩn trần hay vách sẽ vẽ lại ngay, nên không còn bóng ma của phần đã ẩn.
- **Khử răng cưa:** MSAA của canvas (`antialias: true`), không có pass hậu kỳ. Texture thảm có mipmap và anisotropy. Trên ảnh không thấy nhấp nháy rõ ở mép ghế hay vân thảm.

## Hai mức chất lượng (`src/cinema/quality.ts`, `config.quality`)

| | Cao | Tiết kiệm |
| --- | --- | --- |
| DPR tối đa | 2 | 1,25 |
| Shadow map | 2048² (khoảng 16 MiB), radius 3 | 1024² (khoảng 4 MiB), radius 2 |
| Ghế: pillow radial/rings | 24 / 7 | 14 / 4 |
| Ghế: đường cong vỏ / bevel | 8 / 3 | 4 / 1 |
| Ghế: đường cong chuẩn / bevel nhỏ / box | 6 / 2 / 2 | 3 / 1 / 1 |
| Ghế: tiện tròn / trục | 24 / 16 | 12 / 8 |
| Tam giác mỗi ghế | 5 932 | 2 400 (**−59,5 %**) |

- **Cùng một định nghĩa thiết kế.** `createCinemaSeatModel(config, materials, detail)` chỉ đổi số đoạn chia. Mức Tiết kiệm vẫn có tựa lưng, tựa đầu, tay vịn, đệm ngồi và giá để cốc, không bị thay bằng khối hộp. Mọi thành phần nằm trong ±1 cm so với mức Cao (đo được tối đa 2 mm). Không có LOD theo khoảng cách.
- **Mặc định thận trọng.** Chọn Tiết kiệm nếu con trỏ chính là cảm ứng (`pointer: coarse`), hoặc có ≤ 4 nhân, hoặc ≤ 4 GiB bộ nhớ (`deviceMemory`). Không dựa vào chuỗi user-agent. Không tự chuyển mức trong lúc chạy.
- **Lưu lựa chọn.** Lựa chọn của người dùng lưu ở `localStorage['cinema3d.quality']` và luôn được ưu tiên. Giá trị không hợp lệ bị bỏ qua. Nếu storage bị chặn thì vẫn chạy với mặc định.
- **Giao diện.** Hai nút "Cao" và "Tiết kiệm" ở thanh công cụ (`aria-pressed`). Inspector có nút riêng để so sánh hai mức, không ghi đè lựa chọn của phòng chiếu.
- **Khi đổi mức:** dựng lại instance ghế, đổi shadow map và DPR. Giữ nguyên canvas, renderer, camera, preset và trạng thái ẩn/hiện. Ánh xạ `i` → `seats[i]` không đổi. Sau 6 lần đổi qua lại, số geometry, texture và shader program không tăng (39 / 8 / 32).

## Số đo (Chrome 156 headless, ANGLE D3D11, RTX 3090)

**Lượt vẽ chính, góc tổng quan, 1440 × 900, DPR 1:**

| | Draw call | Tam giác | trong đó ghế | nội thất | vỏ phòng |
| --- | --- | --- | --- | --- | --- |
| Prompt 03 (baseline) | 35 | 682 966 | 4 / 652 520 | 20 / 29 820 | 11 / 626 |
| Prompt 04, Cao | 38 | 682 990 | 5 / 652 520 | 22 / 29 844 | 11 / 626 |
| Prompt 04, Tiết kiệm | 38 | 294 470 | 5 / 264 000 | 22 / 29 844 | 11 / 626 |

- Có thêm 3 draw call: vật liệu `metal` của ghế, và dải LED dẫn lối ở hai nhóm vách.
- **Lượt bóng** (chỉ chạy khi cảnh thay đổi): Cao 17 call / 671 268 tam giác, Tiết kiệm 17 / 282 748. Không có post-processing.
- **Tài nguyên:** 39 geometry, 8 texture (trước đây 35 / 2). Texture gồm thảm, biển thoát hiểm, môi trường PMREM, shadow map, bảng LTC của area light và LUT nội bộ của three.

**Thời gian khung theo đường camera cố định** (120 khung: tổng quan → lối trái → từ màn nhìn lại → mắt F06 → tổng quan, render đồng bộ):

| Lần chạy | Buffer | DPR | CPU submit trung vị | GPU trung vị / p95 |
| --- | --- | --- | --- | --- |
| P03 baseline, desktop | 1398 × 784 | 1 | 0,1 ms | 1,04 / 4,30 ms |
| P04 Cao, desktop | 1398 × 784 | 1 | 0,1 ms | 1,71 / 3,51 ms |
| P04 Tiết kiệm, desktop | 1398 × 784 | 1 | 0,1 ms | 1,90 / 5,27 ms |
| P04 Tiết kiệm, tablet 820 × 1180 | 981 × 1275 | 1,25 | 0,1 ms | 2,96 / 4,89 ms |
| P04 Cao, tablet 820 × 1180 | 1570 × 2040 | 2 | 0,1 ms | 3,02 / 8,67 ms |

- GPU đo bằng `EXT_disjoint_timer_query_webgl2` (không gặp disjoint). CPU là thời gian JavaScript trong `render()`, độ phân giải `performance.now` chỉ 0,1 ms.
- `renderer.info` reset mỗi lần `render()`. Phần tách lượt chính và lượt bóng dùng các lần render riêng (`measureCost`).
- Trên RTX 3090, khác biệt giữa hai mức nằm trong nhiễu khi DPR 1, vì GPU này không bị nghẽn ở số đỉnh. Ở DPR 2, Tiết kiệm giảm p95 từ 8,7 xuống 4,9 ms nhờ DPR thấp hơn. Các số này **không** đại diện cho điện thoại.
- **Khi đứng yên không render:** sau khi camera dừng, 1 giây không có khung mới. Check này chạy ở desktop, tablet (cả hai mức) và sau khi đổi mức.
- **Bundle:** JS chính 916 kB (gzip 281 kB), trước đây 652 kB (gzip 170 kB). Gần như toàn bộ phần tăng là bảng LTC của `RectAreaLightTexturesLib` trong three: 315 kB nguồn, khoảng 110 kB gzip, bắt buộc phải có để dùng RectAreaLight.

## Test và kiểm tra

- `yarn test`: **94/94** test pass (5 file). Phần mới:
  - Mọi kiểm tra hình học ghế chạy cho **cả hai mức**: chạm sàn tại pivot, nằm trong footprint, tỉ lệ, hướng −Z, tay vịn, giá cốc thông, winding và normal, mắt ngồi.
  - Mức Tiết kiệm: cùng thành phần, ±1 cm, ≤ 50 % tam giác, ánh xạ 110 instance.
  - `render.test.ts`: giá trị chất lượng hợp lệ, mặc định theo thiết bị, lưu/đọc/storage bị chặn; mức Tiết kiệm rẻ hơn ở mọi tham số; đúng một nguồn đổ bóng; khung bóng ôm sát; đèn tắt theo trần/vách phải và phục hồi; đổi kích thước shadow map; texture thảm có seed, tile liền và dải giá trị hẹp.
  - `interior.test.ts`: giải phóng mọi texture đúng một lần (exit sign và thảm dùng chung); dải LED không va chạm.
- `yarn typecheck`: sạch. `yarn build`: thành công, vẫn có cảnh báo chunk > 500 kB.
- `yarn capture`: **106/106** check pass, 0 cảnh báo console ngoài dự kiến. Phần mới:
  - Mặc định Cao trên desktop, Tiết kiệm trên tablet/mobile.
  - Cùng camera ở hai mức; đổi mức giữ camera, ẩn/hiện và preset; lưu lựa chọn và đọc lại khi tải lại trang; giá trị lạ thì về mặc định; tài nguyên ổn định sau 6 lần đổi; không render khi đứng yên.
  - Đèn và bóng theo trần/vách phải; camera di chuyển không vẽ lại bóng.
  - Mất ngữ cảnh sau khi đổi mức và ẩn trần thì giữ được Tiết kiệm, trần vẫn ẩn và bóng được vẽ lại. Inspector cũng render lại được sau khi khôi phục.
  - Inspector ở mức Tiết kiệm: ≤ 50 % tam giác, kích thước đo lệch ≤ 1 cm.

## Ảnh trong `artifacts/prompt-04/`

| Nhóm | File |
| --- | --- |
| Baseline Prompt 03 (cùng camera) | `baseline/*.png`; ghép đôi trước/sau: `compare-p03-p04-*.png` |
| 4 preset desktop, mức Cao | `desktop-1-overview` … `desktop-4-seat-eye` |
| Mobile, mức Tiết kiệm (mặc định) | `mobile-1-overview`, `mobile-4-seat-eye` (cùng các preset khác, và tablet) |
| Cao và Tiết kiệm, cùng camera và độ phân giải | `quality-*-high/economy`, `compare-quality-*.png` (tổng quan, mắt ghế, da ghế, graphite góc sát) |
| Cận cảnh vật liệu (góc thêm) | `material-1-seat-leather`, `material-2-graphite-grazing`, `material-3-seat-legs-carpet`, `material-4-curtain-front`, `material-5-exit-sign`, `material-6-handrail` |
| Trạng thái ẩn | `state-1-ceiling-hidden`, `state-2-ceiling-hidden-seat-eye`, `desktop-3-side` (ẩn vách phải), `desktop-5-ceiling-back-hidden`, `interior-7-overview-ceiling-hidden` |
| Khôi phục ngữ cảnh | `context-restored-economy`, `seat-8-after-context-restore` |
| Inspector | `seat-1` … `seat-6`, `seat-7-front-economy` |
| Số liệu | `report.json` (renderer, rendererSplit, frameTiming, quality, rendererBaseline) |

Các góc `material-*` và `state-*` là góc trình bày bổ sung, không thay preset camera.

## Tự rà soát

| Lỗi cần tránh | Kết quả |
| --- | --- |
| Ghế bóng như nhựa | Da nhám 0,6, highlight rộng và mềm, đường may tối. Đã chỉnh sắc đỏ bớt ngả cam |
| Graphite loé | Khung sơn lì 0,78, kim loại tách riêng. Ảnh nhìn sát mặt không thấy vệt loé |
| Rèm phẳng | Đèn rèm chiếu chéo ngang và mạnh hơn. Nếp rõ ở ảnh nhìn thẳng (`material-4`) |
| Vùng tối mất chi tiết | Albedo charcoal và ánh sáng nền ấm. Vách, trần, cửa đều đọc được |
| Champagne quá vàng | Nhám hơn, env thấp hơn. Ra màu đồng ấm, không phải vàng phát sáng |
| Khe đèn cháy trắng | Emissive 0,7. Pixel sáng nhất vẫn giữ màu hổ phách |
| Bóng nổi hoặc xuyên vật | Không thấy trong ảnh cận chân ghế và thảm. Ẩn trần/vách thì vẽ lại bóng |
| Răng cưa hoặc nhấp nháy | MSAA, texture có mipmap. Không thấy nhấp nháy rõ |

## Giới hạn và việc còn mở

- **Cảnh báo X4122 của driver.** ANGLE/D3D11 ghi `warning X4122` (gấp hằng số float trong code packing của three) vào program info log, và three in ra như một cảnh báo dù link shader thành công. Harness xếp nó vào nhóm cảnh báo driver đã biết. Lần chạy cuối gặp đúng 1 lần, ở trang đầu tiên; các trang sau dùng shader đã được Chrome cache.
- **Hủy tài nguyên sau khi khôi phục ngữ cảnh.** Với three r186, nếu hủy một tài nguyên tạo *trước* khi mất ngữ cảnh (ví dụ đổi mức chất lượng ngay sau khi khôi phục, hoặc đóng trang), trình duyệt sẽ in cảnh báo "object does not belong to this context". Cảnh báo này vô hại. Lúc khôi phục, môi trường mới được dựng lại còn bản cũ chỉ bị bỏ đi chứ không hủy, nên chính bước khôi phục không sinh cảnh báo.
- **Giật nhẹ ở lần ẩn/hiện đầu tiên.** Ẩn trần hay vách phải làm đổi số đèn đang bật, nên three biên dịch thêm biến thể shader ở lần đầu (sau đó dùng cache). Trên máy yếu có thể thấy giật nhẹ một lần.
- **Chưa đo trên thiết bị thật.** Chưa thử điện thoại/tablet thật hay Safari, Firefox. Mọi số đo đều từ RTX 3090 headless. Chi phí fragment của 5 RectAreaLight trên GPU di động chưa đo được.
- **Mobile dọc** vẫn bị cắt khung như ghi chú trước; sẽ xử lý ở Prompt 05.
- **Camera:** chưa có camera đi bộ hay va chạm. Góc nhìn từ hàng đầu cần đánh giá lại khi làm camera.
- **Bundle tăng khoảng 110 kB gzip** vì bảng LTC. Nếu cần giảm, có thể thay RectAreaLight bằng spot/point, nhưng sẽ phải chấp nhận ánh rửa vách kém mượt hơn.

## File thay đổi

- **Mới:**
  - `src/cinema/environment.ts`, `src/cinema/quality.ts`, `src/cinema/frameProbe.ts`
  - `src/cinema/render.test.ts`, `docs/handoff-prompt-04.md`, `artifacts/prompt-04/`
- **Sửa:**
  - `config.ts` (`render`, `quality`, `padShape.seamShade`)
  - `materials.ts`, `lighting.ts`, `view.ts`, `seatInspector.ts`, `renderHost.ts` (giới hạn DPR đổi được, đếm khung, callback khôi phục, đếm program)
  - `seats.ts`, `seatGeometry.ts` (mức chi tiết, vật liệu `metal`, vertex color đường may)
  - `architecture.ts` (UV thế giới cho thảm), `interior.ts` (dải LED dẫn lối)
  - `ui.ts`, `page.ts`, `styles.css` (nút chất lượng)
  - `seats.test.ts`, `interior.test.ts`, `scripts/capture-views.mjs`

**Lệnh:** `yarn test`, `yarn typecheck`, `yarn build`, `yarn capture` (dùng Chrome hoặc Edge đã cài, ghi ra `artifacts/prompt-04/`). Đo lại baseline bằng `CAPTURE_DIR=prompt-04/baseline yarn capture`, chạy trên code của prompt trước.
