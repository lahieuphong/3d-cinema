# Bàn giao Prompt 03: kiến trúc nội thất cinema

Trạng thái: hoàn thành, chờ duyệt (27/10/2026). Chưa commit. Lưu ý: thay đổi của Prompt 02 cũng chưa được commit, nên working tree hiện chứa cả Prompt 02 và Prompt 03 trên nền commit `90655a7`.

## Hiện trạng trước khi sửa

- Source khớp với `handoff-prompt-02.md`; phiên bản theo lockfile không đổi (Vite 8.3.5, TypeScript 6.0.3, three 0.186.1); không nâng dependency nào.
- Baseline đo lại bằng chính harness (`artifacts/prompt-03/baseline/`) khớp số liệu Prompt 02: góc tổng quan 31 draw call, 653 026 tam giác, 20 geometry, 1 texture.
- Hợp đồng giữ nguyên: thông thủy 12 × 18 × 6,5 m; 110 ghế; `SeatData`, ID A01–J11, thứ tự `seats[]`; pivot, hướng −Z, footprint; instance `i` = `seats[i]`; màn, bục, cao độ hàng; preset camera; inspector; render theo nhu cầu. Hình học ghế không đổi (652 520 tam giác cho 110 ghế).

## Giải quyết xung đột không gian ở hai vách bên

Mặt cắt ngang một bên (X dương; bên trái đối xứng):

| Vùng | X (m) |
| --- | --- |
| Mép khối ghế thực tế | 4,278 |
| Dải đệm vùng ghế | 4,29 → 4,50 |
| Lối đi (giữ nguyên 1,50 m) | 4,50 → 6,00 |
| **Mặt hoàn thiện (mặt panel) = giới hạn thông thủy** | 6,00 |
| Lớp vỏ: panel 6,00 → 6,06; hốc tay vịn 6,00 → 6,12 | 6,00 → 6,12 |
| Tường kết cấu (trước đây 6,00 → 6,30) | 6,12 → 6,42 |

- Panel dày 6 cm, gắn vào mặt tường cũ thì sẽ thu hẹp lối đi. Vì vậy tường kết cấu lùi ra ngoài 0,12 m (`room.sideLiningDepth`). Mặt panel nằm đúng X ±6,00, nên thông thủy 12 m tính tới mặt hoàn thiện được giữ nguyên.
- Panel không chạy xuống sàn mà dừng ở đường cách **1,2 m trên đường mũi bậc** (song song cầu thang). Phía dưới là một hốc lõm sâu 0,12 m chạy dọc cầu thang. Tay vịn và trụ đặt trong hốc này: tâm tay vịn ở X ±6,06; trụ đứng trên mặt bậc lối đi, phần mặt bậc này kéo dài vào tới tường kết cấu.
- **Bề rộng thông thoáng đo từ geometry** (`measureAisleClearance`, không gian từ sàn tới +2,1 m, suốt chiều dài lối đi) là **1,50 m cả hai bên**. Giới hạn là mặt panel, không phải tay vịn (tay vịn bắt đầu từ X 6,038). Tính từ đầu ghế thực tế tới mặt panel là 1,72 m.
- Loa gắn vách nhô vào phòng 0,20 m (loa trước 0,30 m) nhưng đáy loa ở Y 3,94, luôn cao hơn sàn lối đi tối thiểu 2,1 m. Test kiểm tra điều này.
- Hệ quả: khối nhà rộng thêm 0,24 m (vỏ ngoài ±6,42). Bố trí ghế, lối đi và thông thủy không đổi.

## Các nhóm nội thất và kích thước chính

Mọi kích thước nằm trong `AUDITORIUM_CONFIG.interior` (`src/cinema/config.ts`); vị trí suy ra từ phòng và các hàng.

| Nhóm | Mô tả | Số đo chính (đo từ geometry) |
| --- | --- | --- |
| Panel tiêu âm | 15 khoang mỗi bên, rộng bằng bước hàng 1,15 m nên khe chia trùng cổ bậc; mỗi khoang 2 tấm (dưới/trên), khe 3 cm, dày 6 cm, cạnh vát 6 mm | 40 tấm; đáy theo đường bậc + 1,2 m; khe ngang ở Y 4,55; đỉnh Y 6,17 |
| Khoang đặc biệt | Khoang 0: loa trước; khoang 1: cửa; khoang 6, 9, 12: loa vòm (không có panel) | Z khoang 1: −7,15 → −6,00 |
| Nẹp champagne | Khảm vào khe hai bên khoang cửa và khoang loa, lõm 5 mm so với mặt panel | 18 nẹp |
| Chân tường | Graphite, bậc thang theo từng mặt bậc, ngắt ở cửa; chạy dọc vách sau | cao 0,10 m, dày 15 mm |
| Trần | 2 vòm hông (rộng 0,67 m, sâu 0,28 m) có khe đèn; 7 dầm ngang nông (rộng 0,30 m, sâu 0,20 m, bước 2,3 m) có khe đèn giữa | dầm đầu tiên Z −6,0; không có gì trên màn từ vách trước tới mép bục |
| Khe đèn | Dải phát sáng (emissive) lõm 2 cm trong khe; chỉ đánh dấu vị trí đèn, chưa chiếu sáng gì | 9 dải |
| Rèm | 2 rèm xếp nếp (5 nếp, sâu 0,20 m, sâu thêm 35 % ở gấu), khối kín dày 2 cm; hộp che ray phía trên | X 4,84 → 5,96, Y 0,01 → 6,14; hộp che X 4,78 → 6,12 |
| Loa | Thùng, mặt lưới có lỗ, màng loa trầm lõm, loa tép, giá treo (đế + tay); chĩa xuống 8°; cặp trước xoay 20° về khán giả | 10 loa (4 mỗi vách bên + 2 vách sau); 0,36 × 0,56 × 0,26 m; tâm Y 4,25 |
| Tay vịn | Ống Ø 44 mm liên tục, bo góc ở các chỗ đổi dốc, kéo dài 0,30 m qua mũi bậc đầu/cuối rồi uốn vào tường; 10 trụ Ø 32 mm mỗi bên có đế tròn | đỉnh tay vịn 0,90 m trên đường mũi bậc; Y 0,86 → 2,52; Z −4,02 → 6,97 |
| Cửa thoát | Ô cửa thật trong tường kết cấu; khung, cánh lùi trong ô, thanh đẩy, ngưỡng champagne; trạng thái đóng | cánh 0,95 × 2,15 m; ô Z −7,11 → −6,04; sàn Y 0 hai bên |
| Biển thoát hiểm | Hộp đèn trên cửa; mặt `CanvasTexture` 512 × 256 (người chạy, ô cửa, mũi tên xuống) dùng chung cho 2 biển | 0,38 × 0,19 m; Y 2,31 → 2,50 |
| Máy chiếu | Thân, ống kính, kính, khay đỡ, hai tay đỡ ngang vào bản đế trên vách sau; nhắm đúng tâm màn (nghiêng xuống 7,37°) | tâm kính (0; 5,55; 8,00); thân Z 8,08 → 8,83 |

Biển thoát hiểm là chi tiết minh hoạ của mô hình trải nghiệm. Thiết kế này không tuyên bố đáp ứng tiêu chuẩn công trình hay phòng cháy.

## Quy tắc ẩn/hiện

Cảnh được chia nhóm theo nơi từng chi tiết gắn vào:

| Nhóm | Ẩn được | Gồm |
| --- | --- | --- |
| `floor` | không | sàn, bậc ghế, lối đi, mũi bậc, bục, **tay vịn** (đứng trên sàn nên không bao giờ lơ lửng) |
| `screen` | không | mặt màn, khung |
| `ceiling` | Trần | tấm trần, vòm hông, dầm, mọi khe đèn |
| `right-wall` | Vách phải | tường kết cấu phải (chia quanh ô cửa), panel, nẹp, chân tường, loa, cửa, biển thoát hiểm |
| `left-wall` | không | tương tự bên trái |
| `back-wall` | Vách sau | tường sau, chân tường, 2 loa sau, máy chiếu và giá |
| `front-wall` | không | tường trước, rèm, hộp che ray |

`architecture.toggleable` giờ là các `Group`, nên ẩn một vách là ẩn luôn mọi thứ gắn vào nó.

## Cấu trúc geometry / material / texture

- `src/cinema/interior.ts`: các bộ dựng (`buildSideWall`, `buildBackWall`, `buildFrontWall`, `buildCeiling`, `buildHandrails`), phân khoang (`sideWallBays`), ô cửa (`doorOpening`), khung máy chiếu (`projectorFrame`), đo lối đi (`measureAisleClearance`).
- `src/cinema/interiorGeometry.ts`: ống quét có bo góc và khung truyền song song (tay vịn), rèm xếp nếp (extrude dải sóng có độ dày), cụm loa.
- `src/cinema/meshBatch.ts`: mỗi chi tiết được đặt vị trí, **ghi bounds thật** vào `architecture.pieces`, rồi gộp thành **một mesh cho mỗi vật liệu trong mỗi nhóm**. Module lặp lại (40 panel, 10 loa, 7 dầm…) không làm tăng draw call.
- `layout.ts`: thêm `structure` (mặt trong tường kết cấu) và `stairPitchY(layout, z)` (đường mũi bậc, dùng chung cho tay vịn và đường panel).
- `materials.ts`: 16 vật liệu phòng theo vai trò, gồm 7 vật liệu vỏ phòng (`carpet`, `aisle`, `aisleNosing`, `stage`, `wall`, `screenFrame`, `screen`) và 9 vật liệu nội thất (`panel`, `graphite`, `trim`, `grille`, `driver`, `curtain`, `projector`, `lightSlot`, `exitSign`). Tấm trần dùng chung `wall`; sàn và bậc ghế dùng chung `carpet`. Một texture: biển thoát hiểm 512 × 256, anisotropy 8. `disposeMaterials` giải phóng mọi vật liệu và mỗi texture đúng một lần.
- Trong Node (test), texture biển dùng bản 1 × 1 thay thế; bản vẽ canvas chỉ được kiểm bằng ảnh trong trình duyệt.

## Số liệu renderer (Chrome 156, RTX 3090, 1440 × 900, DPR 1, cùng camera)

| Preset | Draw call trước → sau | Tam giác trước → sau | Geometry | Texture |
| --- | --- | --- | --- | --- |
| Tổng quan | 31 → 35 | 653 026 → 682 966 | 20 → 35 | 1 → 2 |
| Nhìn về ghế | 35 → 33 | 653 074 → 682 962 | 20 → 35 | 1 → 2 |
| Kiểm tra bên | 36 → 29 | 653 086 → 674 960 | 20 → 36 | 1 → 2 |
| Tầm mắt ghế | 19 → 33 | 652 882 → 680 678 | 20 → 36 | 1 → 2 |

Tách chi phí (hook `measureCost` trong chế độ dev: lần lượt render khi ẩn ghế, rồi khi ẩn nội thất):

| Preset | Ghế (draw call / tam giác) | Nội thất mới | Vỏ phòng |
| --- | --- | --- | --- |
| Tổng quan | 4 / 652 520 | **20 / 29 820** | 11 / 626 |
| Nhìn về ghế | 4 / 652 520 | 18 / 29 816 | 11 / 626 |
| Kiểm tra bên | 4 / 652 520 | 15 / 21 850 | 10 / 590 |
| Tầm mắt ghế | 4 / 652 520 | 18 / 27 532 | 11 / 626 |

- Ngân sách nội thất ở góc tổng quan (≤ 25 draw call, ≤ 50k tam giác) đạt: 20 draw call, 29 820 tam giác. Harness kiểm tra tự động.
- Vỏ phòng giảm từ 27 draw call xuống 11 vì 18 dải mũi bậc và 4 thanh khung màn được gộp lại.
- Ở preset tầm mắt, draw call tăng từ 19 lên 33. Trước đây 27 mesh kiến trúc rời bị frustum culling cắt bớt; nay mỗi nhóm là một mesh lớn nên hiếm khi bị cắt.
- Texture thứ hai là biển thoát hiểm; texture thứ nhất vẫn là `DFG_LUT` nội bộ của three.
- **Chưa đo FPS**; chưa thử GPU yếu hay mobile thật. Không suy ra hiệu năng từ số draw call và tam giác.

## Kiểm tra

- `yarn typecheck`: sạch. `yarn build`: thành công. JS chính 652 kB (gzip 170 kB), chunk inspector 8 kB; vẫn có cảnh báo chunk > 500 kB.
- `yarn test`: 67/67, trong đó `interior.test.ts` có 29 test:
  - Mặt panel nằm đúng X ±6,00.
  - Lối đi thông thoáng 1,50 m đo từ geometry, giới hạn bởi mặt panel.
  - Loa cao hơn sàn lối đi ≥ 2,1 m; không chi tiết nào lấn footprint của 110 ghế.
  - Khoang cửa/loa không có panel; khe chia trùng cổ bậc.
  - Mọi trụ chạm đúng mặt bậc và đỡ tới tâm tay vịn; tay vịn đúng cao độ, nằm trong hốc; panel cách tay vịn ≥ 0,2 m.
  - Raycast từ mắt ghế A01, A06, A11, F06, J01, J11 tới tâm và 4 góc màn không bị chắn.
  - Đường chiếu từ ống kính máy chiếu tới tâm và 4 góc màn không bị chắn; máy chiếu nhắm đúng tâm màn.
  - Không có gì của trần trên màn (từ vách trước tới mép bục); rèm ngoài khung màn và không chạm bục.
  - Các cặp dễ đâm xuyên được kiểm riêng: loa/panel, loa/nẹp, cửa/panel, biển/panel, dầm/máy chiếu, vòm hông/panel, vòm hông/hộp che ray, tay vịn/cửa, loa sau/máy chiếu.
  - Ô cửa thật: không có tường sau cánh cửa; ngưỡng ở Y 0.
  - Nhóm ẩn/hiện chứa đúng đồ gắn vào nó; mỗi nhóm có một mesh cho mỗi vật liệu.
  - Mọi geometry, vật liệu và texture biển được dispose đúng một lần.
- Test kiến trúc cũ ở `scene.test.ts` giờ tra bảng `pieces` thay vì tên mesh, vì mesh đã được gộp. Phép kiểm "nằm trong phòng" chặt hơn trước: kết cấu không được lấn vào `structure`.
- Thử đột biến:
  - Tay vịn lấn vào lối đi → 2 test fail.
  - Loa hạ ngang đầu người → 2 test fail.
  - Dầm đặt trên màn → ban đầu **lọt** vì vùng kiểm tra được dựng từ chính cấu hình dầm. Đã sửa để vùng kiểm tra độc lập với cấu hình, chạy lại thì test bắt được.
- `yarn capture`: 78/78, không có cảnh báo console ngoài 2 lỗi cố ý của bài giả lập không có WebGL. Gồm:
  - Đủ 4 preset ở desktop, tablet, mobile; reset; công tắc; bàn phím; không trôi camera; resize.
  - HMR re-mount vẫn một canvas; mất/khôi phục context.
  - Inspector mở/đóng/Back/Esc.
  - Ảnh cận nội thất; ngân sách nội thất.

## Ảnh (`artifacts/prompt-03/`)

| Ảnh | Nội dung |
| --- | --- |
| `desktop-1…4-*.png` | bốn preset desktop |
| `mobile-1-overview.png`, `mobile-4-seat-eye.png` | tổng quan và tầm mắt trên mobile |
| `interior-1-door-wall.png` | cửa, biển thoát hiểm, panel, loa trước |
| `interior-2-panels-speakers.png` | vách trái: panel, loa vòm, tay vịn trong hốc |
| `interior-3-ceiling-projector.png` | trần, dầm, khe đèn, máy chiếu, loa sau |
| `interior-4-curtain-screen.png`, `interior-5-curtain-edge.png` | rèm và khu vực màn |
| `interior-6-handrail-stairs.png` | tay vịn nhìn dọc cầu thang |
| `interior-7-overview-ceiling-hidden.png`, `desktop-5-ceiling-back-hidden.png`, `desktop-3-side.png` | các trạng thái ẩn trần / vách sau / vách phải |
| `baseline/` | cùng bộ góc trước khi thêm nội thất |

Ảnh cận được chụp ở chế độ `eye` qua hook dev `__cinema.setCamera(pos, target, 'eye')`. Camera orbit tự nâng lên trên điểm nhìn (giới hạn góc 88°), nên không dùng được cho các góc nhìn ngửa.

## Thay đổi so với code Prompt 02

- `architecture.ts` viết lại thành bộ điều phối các nhóm; lối đi kéo dài tới tường kết cấu; mũi bậc và khung màn được gộp.
- `materials.ts`: đổi tên `floor`/`tier` thành `carpet`; bỏ `ceiling` (dùng `wall`); thêm 9 vật liệu nội thất và texture biển.
- `seatGeometry.ts`: `mergeSeatPieces` đổi tên thành `mergePieces` (có tham số thuộc tính); hành vi với ghế không đổi.
- `lighting.ts`: **đèn fill 0,9 → 1,3**. Đây là điều chỉnh tối thiểu để đọc được vách, rèm và mặt sau ghế trong bảng màu tối; không thêm đèn, không bóng, không hậu kỳ. Inspector dùng chung ánh sáng nên cũng sáng hơn một chút.
- `view.ts` / `page.ts`: hai hook chỉ có trong dev, `setCamera` và `measureCost`; anisotropy cho texture biển.
- `scripts/capture-views.mjs`: thư mục mặc định `prompt-03`; baseline đọc từ `<thư mục>/baseline`; thêm ảnh nội thất, tách chi phí, check ngân sách.

## Hạn chế và việc còn lại

- **Riêng (từ Prompt 01, không đổi):** trên điện thoại dọc, preset "Nhìn về ghế" cắt hai đầu hàng trước.
- Khe đèn chỉ là bề mặt phát sáng đánh dấu vị trí; chưa có ánh sáng thật hắt lên vật thể (Prompt 04).
- Nếp rèm đọc rõ ở góc tổng quan và tầm mắt, nhưng nhìn cận chính diện thì độ tương phản thấp. Đây là vấn đề hướng sáng, để lighting ở Prompt 04 xử lý.
- Đốm loá trên graphite ở góc xiên (từ Prompt 02) vẫn còn.
- Gộp mesh theo nhóm làm frustum culling thô hơn (thấy rõ ở preset tầm mắt). Nếu cần, có thể chia nhỏ theo khoang; chưa làm vì tổng chi phí vẫn nhỏ so với ghế.
- Ghế chiếm ~96 % số tam giác (652 520); chưa có LOD.
- Cửa không có chi tiết phía ngoài phòng (hành lang không được dựng); ô cửa và cánh đã sẵn cho hoạt hoạ mở sau này.
- Chưa thử trên thiết bị di động thật, Safari, Firefox, GPU yếu; chưa đo FPS.

## Lỗi chặn trước Prompt 04

Không có.
