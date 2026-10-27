# Bàn giao Prompt 06: chọn ghế và sơ đồ 2D đồng bộ

Trạng thái: hoàn thành, chờ duyệt (27/10/2026). Chưa commit, push hay deploy. Không nâng dependency nào. Nền: commit `992bb21` (Prompt 05), working tree sạch khi bắt đầu.

## Hiện trạng và baseline

- Source khớp `handoff-prompt-05.md`.
- Baseline đo trên code Prompt 05 bằng harness, chưa sửa gì: `artifacts/prompt-06/baseline/`, 203/203 check pass.
- Ảnh trước/sau cùng camera, viewport và chất lượng: `compare-p05-p06-*.png`.
- Hợp đồng giữ nguyên:
  - 110 ghế A01–J11; layout, vị trí, hướng, footprint;
  - ánh xạ instance → ghế, mức Cao/Tiết kiệm;
  - vật liệu và ánh sáng;
  - tour, khám phá, giảm chuyển động, inspector;
  - render theo nhu cầu, một bộ điều khiển ghi camera.
- Không dựng lại scene khi chọn ghế; không tạo geometry hay material riêng cho từng ghế.

## Mô hình trạng thái (`selection.ts`)

`SeatSelection` là nguồn duy nhất, độc lập với renderer và DOM. Khán phòng 3D, sơ đồ 2D, ô thông tin và danh sách đều đọc từ nó và mọi thay đổi đi qua nó. Không có bản trạng thái thứ hai.

| Trường | Ý nghĩa |
| --- | --- |
| Danh mục | Lấy từ `SeatData` (`layout.seats`) |
| `reserved` | Fixture demo cố định, không bao giờ đổi |
| `selected` | Tối đa `config.selection.maxSeats` = 8 |
| `active` | Ghế đang xem thông tin; "Xem từ ghế này" dùng ghế này. Độc lập với lựa chọn |
| `hovered` | Trạng thái tạm thời của con trỏ |

**Trạng thái hiển thị** được suy ra: `reserved` nếu thuộc fixture, `selected` nếu đang chọn, còn lại là `available`.

**Quy tắc:**
- Ghế đã đặt không chọn được (`toggle` trả `{ ok: false, reason: 'reserved' }`).
- Chạm ghế trống thì chọn; chạm ghế đang chọn thì bỏ.
- Ghế thứ 9 bị từ chối (`reason: 'limit'`), 8 ghế đã chọn giữ nguyên, kèm thông báo rõ.
- Có "Bỏ chọn tất cả" và bỏ từng ghế; không bao giờ đụng tới ghế đã đặt.
- Chạm ghế (3D hoặc sơ đồ) làm ghế đó thành `active` rồi đổi trạng thái chọn. Ghế đã đặt vẫn thành active để xem thông tin và góc nhìn, nhưng không vào lựa chọn. Bỏ chọn ghế active thì vẫn giữ thông tin ghế đó.

**Thông báo thay đổi** chỉ gồm các ghế vừa đổi; listener vẽ lại đúng những ghế đó.

**Phạm vi sống:** selection được tạo một lần trong `main.ts` (`CinemaSession`), ngoài mọi lần mount trang. Nhờ vậy nó còn nguyên khi đổi chất lượng, resize hay xoay máy, mở/đóng inspector, mất và khôi phục context. Không lưu vào localStorage: tải lại trang là mất. Chất lượng đồ họa vẫn lưu như cũ.

**Fixture đã đặt** (`DEMO_RESERVED_SEAT_IDS`, 18 ghế): A04 A05 · C07 C08 C09 · D01 D02 · E05 E06 E07 · G10 G11 · H03 H04 H05 H06 · J03 J04. A01, A06, F06, J06, J11 luôn còn trống (có test).

Giao diện ghi rõ: "Dữ liệu ghế minh họa — chưa giữ chỗ thực tế." Không có giá, thanh toán, đếm ngược hay thông báo "đặt thành công".

## Phân biệt chạm và kéo (`tapTracker.ts`)

**Cách gắn vào input hiện có:** không có bộ listener riêng tranh quyền với camera.
- Listener ở pha capture trên canvas chỉ *quan sát* sự kiện, không capture hay cancel con trỏ. OrbitControls và input khám phá vẫn nhận đủ sự kiện.
- Listener capture trên `window` đếm mọi con trỏ đang chạm trên trang.

**Chỉ chọn khi đủ các điều kiện:**
- Bắt đầu trên canvas, bằng nút chính.
- Dịch chuyển dưới ngưỡng và thả trong vòng `tapMaxMs` = 700 ms.
- Không có con trỏ nào khác đang chạm ở bất kỳ đâu trong suốt lần nhấn (ngón trên cần điều khiển, ngón thứ hai, nhấc một ngón của cử chỉ nhiều ngón).
- Không có `pointercancel` hay blur.
- Không phải lần nhấn đã dùng để dừng tour.

**Ngưỡng dịch chuyển** (`config.selection.tapSlopPx`, đơn vị CSS px): chuột 5, bút 8, ngón tay 12.

**Không bao giờ chọn:** cuộn chuột, chuột phải, kéo camera, cần điều khiển, đóng panel (nút nằm ngoài canvas). Khi tour đang chạy, lần nhấn đầu chỉ dừng tour; lần sau mới chọn.

## Picking và che khuất (`seatPicking.ts`)

**Proxy picking:**
- Mỗi ghế có các hộp của từng bộ phận thật (đệm, các tấm lưng, vỏ lưng, tay vịn, chân, giá cốc…), lấy từ bounds của chính model đã dựng, trong hệ tọa độ của ghế.
- Proxy bám sát ghế ở cả hai mức chất lượng, và để trống khe giữa các ghế và giữa các hàng. Collider đi bộ là một hộp cho cả hàng nên không dùng để pick.
- Tia được đưa về hệ tọa độ từng ghế rồi thử hộp tổng, sau đó các hộp bộ phận. Không duyệt tam giác.
- Instance `i` = `seats[i]`, cùng ánh xạ với các instance đang vẽ.

**Che khuất:**
- Ghế phía trước che ghế phía sau ngay qua proxy (lấy hit gần nhất).
- Sau đó raycast các mesh kiến trúc *đang hiện* (`traverseVisible`), chỉ tới khoảng cách của ghế vừa trúng: vách, bậc sàn, bục, rèm, màn.
- Vách hoặc trần đã ẩn trong chế độ Kiểm tra không chặn tia. Vách đang hiện thì chặn (có test và kiểm tra trên trình duyệt).

**Tọa độ con trỏ** tính theo `getBoundingClientRect()` hiện tại của canvas, nên vẫn đúng khi panel mở/đóng, khi resize và khi đổi DPR (đã kiểm tra trên trình duyệt sau khi panel đổi kích thước canvas).

**Chế độ khám phá:** chỉ pick trong `exploreReach` = 8 m. Ở góc xem từ ghế (và preset F06), ghế camera đang ngồi bị bỏ qua để không che mọi thứ. Sơ đồ 2D luôn là lối chọn thay thế.

**Quy tắc khác:**
- Pick được ở mọi góc, kể cả góc kiểm tra.
- Inspector là trang riêng, không chọn ghế.
- Hover chỉ cho chuột và bút: chỉ tính khi con trỏ di chuyển, không khi đang kéo hay khi camera tự chạy; rời canvas thì xóa hover. Con trỏ hiển thị `pointer` khi trỏ vào ghế, `not-allowed` khi trỏ vào ghế đã đặt.

**Chi phí đo trên trình duyệt** (300 lần pick rải trên canvas, gồm proxy và occluder): trung vị < 0,1 ms, p95 0,3 ms, tối đa 0,5 ms.

## Highlight (`seatHighlight.ts`)

**Màu instance** trên hai phần da và vỏ lưng có sẵn (không thêm material). Hệ số nhân với màu nền:

| Trạng thái | Hệ số (linear RGB) | Kết quả |
| --- | --- | --- |
| Còn trống | 1, 1, 1 | Giữ đỏ rượu |
| Đang chọn | 2,1; 6; 1,4 | Đỏ-amber sáng hơn |
| Đã đặt | 0,55; 1,6; 1,9 | Tối hơn, ngả tím; vẫn rõ hình khối |
| Hover / ghế active | × 1,3 | Chỉ làm sáng, giữ sắc của trạng thái |

**Thứ tự ưu tiên:** ghế đã đặt khi hover vẫn là đã đặt; ghế đang chọn khi focus/active vẫn là đang chọn. Test kiểm tra phép nhân màu: không bị tối, đúng hướng sắc.

**Thẻ amber** trên đỉnh lưng ghế đang chọn: một InstancedMesh (capsule phát sáng nhẹ) chỉ chứa các ghế đang chọn (tối đa 8). Mesh bị ẩn khi chưa chọn ghế nào, nên lúc đó không tốn draw call. Đây là dấu hiệu bằng hình dạng, không chỉ bằng màu.

**Ngoài ra:**
- Không nhấp nháy, không pulse, không bloom, không outline.
- Chỉ xin vẽ lại khi màu hoặc thẻ thực sự đổi.
- So sánh màu có dung sai, vì màu instance lưu dạng float 32-bit.

## Sơ đồ và accessibility (`seatPanel.ts`)

**Panel "Chọn ghế"** mở/đóng bằng nút "Sơ đồ ghế" trên thanh công cụ (`aria-expanded`, `aria-controls`). Thứ tự nội dung:
1. Thông báo dữ liệu minh họa.
2. Sơ đồ — đặt trên cùng để không bị xô khi các phần dưới thay đổi chiều cao (xem lỗi đã sửa bên dưới).
3. Ghế đang xem: ID, hàng, số, trạng thái bằng chữ; nút "Chọn/Bỏ chọn ghế này" và "Xem từ ghế này".
4. "Đã chọn n/8 ghế": danh sách theo thứ tự hàng/cột, nút × bỏ từng ghế, "Bỏ chọn tất cả", thông báo khi đạt giới hạn.

**Sơ đồ:**
- HTML sinh từ `SeatData`: màn chiếu ở trên, hàng A gần màn, ghế số 1 → 11 từ trái sang phải đúng chiều X của phòng, nhãn hàng hai bên.
- Chú giải: Còn trống / Đang chọn (✓) / Đã đặt (✕) / Đang xem (viền trắng). Trạng thái có ký hiệu và chữ, không chỉ dựa vào màu.

**Pattern ARIA:**
- `role="grid"` → `row` → `rowheader` + `gridcell`, mỗi ô chứa một `<button>`.
- Roving tabindex: cả sơ đồ chỉ là một điểm Tab.
- Phím: mũi tên đi theo hàng/cột; Home/End tới đầu/cuối hàng; Ctrl+Home/End tới A01/J11; Enter hoặc Space chọn/bỏ chọn (hành vi gốc của nút).
- Tên truy cập: "A01, còn trống" / "B03, đang chọn" / "A04, đã đặt, không chọn được". Ghế đang chọn có `aria-pressed="true"`, ghế đã đặt có `aria-disabled="true"` (vẫn focus được để nghe trạng thái).
- Viền focus 3 px rõ ràng; có dòng hướng dẫn phím ngắn.
- Phím bấm trong sơ đồ không bao giờ điều khiển camera hay người đi bộ: `keyBelongsToFocus` bỏ qua grid, listbox, tablist… và các sự kiện đã `preventDefault`.

**Live region** `aria-live="polite"` nằm ngoài panel nên vẫn đọc được khi panel đóng. Mỗi thay đổi đọc một câu ngắn ("Đã chọn B05 (3/8).", "A04 đã được đặt, không chọn được.", "Đã đạt giới hạn 8 ghế, chưa chọn A11."), không đọc lại cả sơ đồ. Thao tác chọn từ 3D còn có thông báo nhìn thấy trên khung 3D.

**Theo thiết bị:**
- Desktop (≥ 1100 px): panel bên phải, mở sẵn. Canvas resize theo và preset chưa bị xoay được đóng khung lại.
- Mobile dọc: bottom sheet dưới khung 3D, cao tối đa 48 % màn hình, cuộn được, tránh safe area. Ghế 36 × 36 px; sơ đồ cuộn ngang khi không đủ chỗ, có dòng "Vuốt ngang để xem cả hàng". Trang không bị tràn ngang.
- Mobile ngang: panel 270 px bên cạnh.
- Panel **không modal**: không có `aria-modal`, không bẫy focus. Escape trong panel đóng nó và trả focus về nút "Sơ đồ ghế".

**Canvas** có nhãn hướng dẫn: "…Nhấn vào một ghế để chọn; với bàn phím hoặc trình đọc màn hình, dùng Sơ đồ ghế…". Không bắt người dùng bàn phím phải chọn trên mesh 3D.

**Không có WebGL:** khung 3D báo lỗi, các nút camera/hiển thị bị khóa. Panel tự mở và sơ đồ vẫn chọn được đầy đủ. "Xem từ ghế này" bị khóa kèm lý do bằng chữ.

**Lỗi đã sửa trong quá trình kiểm tra:** khi sơ đồ còn nằm dưới ô thông tin, lần click đầu tiên làm ô thông tin hiện ra và đẩy sơ đồ xuống, khiến `pointerup` rơi ra ngoài nút và ghế không được chọn. Đã đưa sơ đồ lên trên.

## Xem từ ghế

- "Xem từ ghế này" dùng `seatViewPose` có sẵn; UI không tự tính tọa độ.
- Khi bấm:
  - hủy tour hoặc khám phá đang chạy;
  - di chuyển bằng đường đi an toàn (`planCameraPath`); giảm chuyển động thì cắt thẳng;
  - caption ghi đúng ID, hàng và số ghế;
  - giữ nguyên toàn bộ lựa chọn.
- Trạng thái camera mới là `seat`: kéo để quay đầu, mắt giữ nguyên chỗ (đã đo: lệch < 6 cm, do điểm xoay đặt trước mắt 5 cm), không bao giờ chuyển thành đi bộ.
- Nút "← Trở về …" trên khung 3D đưa về preset đang dùng trước khi vào xem từ ghế (nếu khi đó không ở preset nào thì về Tổng quan). Chuyển từ ghế này sang ghế khác vẫn giữ đích trở về ban đầu. Không tự chạy lại tour cũ.
- Đã kiểm tra A01, A06, F06, J06, J11. Hàng A được giữ đúng thực tế (không zoom, không dời mắt): từ A01 phải quay đầu mới thấy hết màn; khi panel mở trên desktop, màn chiếu chiếm trọn khung từ A06.

## Chất lượng và khôi phục context

- **Đổi Cao/Tiết kiệm:** dựng lại instance ghế, gắn highlight vào instance mới và tô lại từ selection, tạo proxy mới cho model mới. Ánh xạ không đổi.
- **Khôi phục context:** toàn bộ nội dung GPU được dựng lại (gồm cả highlighter và proxy), tô lại từ selection, xóa hover.
- Selection nằm ngoài vòng đời GPU, nên không mất gì trong cả hai trường hợp.

**Đọc lại cách sửa của Prompt 05** ("dựng lại và bỏ tài nguyên cũ mà không dispose"): cách đó đúng với handle GPU (không gọi xóa handle đã chết), nhưng chưa đủ.

**Vấn đề tìm thấy:**
- Đo heap JS sau GC: tăng **0,37 MiB mỗi lần khôi phục**, tuyến tính (12,35 → 17,95 MiB sau 16 lần).
- So sánh heap snapshot: mỗi lần giữ thêm khoảng 11 `WebGLProgram` cùng hàng nghìn uniform, các `BufferAttribute` và closure của `WebGLState` cũ.
- Đường giữ: texture `lut` toàn cục (bảng DFG của three r186) → `_listeners.dispose` → `onTextureDispose` của `WebGLTextures` thuộc context cũ → `info.programs` cũ.
- Các bảng LTC của area light cũng bị như vậy.
- Mỗi renderer bị dispose (mở/đóng inspector, hot reload) cũng để lại một listener: tăng **0,25 MiB mỗi lần mở/đóng inspector** (12,53 → 15,28 MiB sau 12 lần).

**Cách sửa trong `RenderHost`:**
- Tìm các texture dùng chung cả trang: `UniformsLib.LTC_*`, và bảng DFG qua `renderer.properties` của một vật liệu đã vẽ (`textureProbe`).
- Khi mất context, ghi lại listener của chúng; khi khôi phục thì gỡ đi.
- Khi dispose renderer, gỡ mọi listener trên các texture đó (ứng dụng chỉ có một renderer tại một thời điểm).
- Không xóa handle GPU nào. Chỉ cắt liên kết phía CPU, còn handle đã chết theo context.
- Việc này phụ thuộc field nội bộ `_listeners` của three r186; đã ghi chú trong code.

**Kết quả** (lần chạy cuối, sau GC qua CDP):

| Đo | Trước khi sửa | Sau khi sửa |
| --- | --- | --- |
| Heap qua 16 lần khôi phục (script riêng) | +0,37 MiB/lần, tuyến tính | 12,11 → 13,41 MiB, chậm dần (≈ 0,05 MiB/lần ở cuối) |
| Heap, 4 lần khôi phục (harness) | — | 13,12 → 13,45 MiB |
| Heap, 6 lần mở/đóng inspector (harness) | +0,25 MiB/lần | 13,53 → 14,04 MiB |
| Object three còn sống (BufferGeometry/Material/Texture/Object3D/WebGLRenderTarget) | — | 98/57/30/132/5, không đổi qua khôi phục và remount |
| Listener window/document/canvas | — | 25/3/20, không đổi |
| Số subscriber của selection | — | 2 (view + panel), không đổi |
| Listener trên mỗi texture toàn cục | tăng thêm 1 mỗi lần | ≤ 1 (của context đang sống) |
| Tài nguyên renderer sau warm-up | — | 40 geometry, 8 texture, 14 program, không đổi |

- Lần đổi chất lượng đầu tiên sau khi khôi phục biên dịch thêm 3 biến thể shader (11 → 14), sau đó đứng yên. Đây không phải rò rỉ.
- Không còn khung render nào khi đứng yên sau các lần khôi phục.

**Giới hạn của phép đo:**
- Heap JS và số object được đếm qua `HeapProfiler`/`queryObjects` sau khi ép GC; bộ nhớ GPU không đo trực tiếp được.
- `renderer.info` chỉ phản ánh renderer hiện tại.
- Phần tăng nhỏ còn lại (vài chục KB mỗi lần) theo snapshot là cache của context đang sống và các mục lịch sử trình duyệt do `pushState`.

## Số đo (Chrome 156 headless, RTX 3090, 1440 × 900, DPR 1, mức Cao, góc Tổng quan, panel đóng)

| | Draw call | Tam giác | Geometry | Texture |
| --- | --- | --- | --- | --- |
| Prompt 05 (baseline) | 38 | 682 990 | 39 | 8 |
| Prompt 06, chưa chọn ghế | 38 | 682 990 | 39 | 8 |
| Prompt 06, có ghế đang chọn | +1 | +288 mỗi ghế đang chọn | +1 (sau lần đầu) | 8 |

- Sau 30 lần chọn/bỏ và 4 lần đổi chất lượng: geometry/texture/program giữ nguyên 40/8/23.
- Lượt bóng không đổi (thẻ amber không đổ bóng).
- Đứng yên sau khi đổi lựa chọn: không render thêm khung nào.
- Bundle: JS chính 968,9 kB (gzip 299,0 kB), trước đây 944,7 / 291,1 kB.

## Kiểm tra

- `npm test`: **136/136** (8 file). File mới:
  - `selection.test.ts`:
    - quy tắc, fixture, giới hạn, active độc lập;
    - màu highlight nhân với màu nền;
    - thẻ chỉ cho ghế chọn, ẩn khi rỗng;
    - picking đúng từng ghế ở cả hai mức;
    - khe giữa ghế và giữa hàng trống;
    - ghế trước che ghế sau; vách đang hiện chặn, vách ẩn không chặn;
    - giới hạn tầm với; bỏ qua ghế đang ngồi;
    - chi phí truy vấn proxy.
  - `tapTracker.test.ts`: ngưỡng theo loại con trỏ, kéo quay về chỗ cũ, nhấn lâu, chuột phải, nhiều ngón, ngón trên cần điều khiển, cancel, blur, lần nhấn dừng tour.
- `npm run typecheck`: sạch. `npm run build`: thành công (vẫn có cảnh báo chunk > 500 kB).
- `npm run capture`: **261/261**, 0 cảnh báo console ngoài dự kiến.
  - Desktop, chuột thật:
    - chọn 3D → sơ đồ, sơ đồ → 3D;
    - ghế đã đặt; hover;
    - kéo, chuột phải và cuộn không chọn;
    - bàn phím trong sơ đồ (mũi tên, Home/End, Ctrl+Home/End, Enter/Space, ghế đã đặt, một điểm Tab);
    - phím trong sơ đồ không di chuyển người đi bộ;
    - giới hạn 8, bỏ một ghế, bỏ tất cả; active độc lập;
    - click đầu khi tour chạy chỉ dừng tour;
    - xem từ 5 ghế và trở về;
    - panel resize canvas mà pick vẫn đúng; đổi chất lượng;
    - che khuất qua vách; render dừng khi đứng yên; tài nguyên ổn định; chi phí pick;
    - mở inspector rồi quay về vẫn giữ lựa chọn.
  - Mobile, chạm thật qua CDP:
    - tap 3D, tap sơ đồ, kích thước ghế và cuộn ngang;
    - hai ngón, touchcancel, vuốt từ ghế đều không chọn;
    - cần điều khiển + ngón thứ hai không chọn;
    - xoay ngang khi panel đang mở; Escape trả focus.
  - Lifecycle: 5 chu kỳ mất/khôi phục và 6 lần mở/đóng inspector như bảng trên.
  - Không WebGL: sơ đồ vẫn chọn được, nút xem bị khóa kèm lý do.
- **Phân biệt giả lập:** "mobile" là Chrome giả lập viewport/DPR/touch, cảm ứng gửi qua CDP `Input.dispatchTouchEvent`. Chưa thử trên điện thoại thật, Safari iOS, Firefox, hay với trình đọc màn hình thật (NVDA/VoiceOver). ARIA chỉ được kiểm tra bằng thuộc tính và hành vi phím.
- **Flake quan sát được:** hai lần `npm test` chạy trong một chuỗi lệnh ngay sau khi sửa file báo "8 failed / no tests" mà không có lỗi test nào. Mọi lần chạy khác (foreground, chạy nền, sau khi chạm file) đều 136/136. Không tái hiện được; có thể do Vitest nạp module trong lúc file vừa được ghi.

## Ảnh và video (`artifacts/prompt-06/`)

- `seats-1-auditorium-selected-reserved`: khán phòng có ghế đang chọn (thẻ amber) và ghế đã đặt, sơ đồ đồng bộ.
- `seats-2-keyboard-focus`: focus bàn phím trên A04 (đã đặt).
- `seats-3-limit-reached`: đạt giới hạn 8 ghế.
- `seats-4-mobile-sheet`: bottom sheet trên mobile.
- `seats-5-mobile-landscape`: panel cạnh khung 3D khi xoay ngang.
- `seat-view-from-{A01,A06,F06,J06,J11}`: góc nhìn từ các ghế kiểm tra.
- `webgl-unavailable`: sơ đồ vẫn dùng được khi không có WebGL.
- Video:
  - `video-select-3d-map-seat-view.webm`: chọn ghế trong 3D → sơ đồ đồng bộ → xem từ ghế → trở về.
  - `video-drag-without-selecting.webm`: kéo camera từ trên ghế không chọn nhầm; cú click cuối chọn đúng một ghế.
  - Video tour và khám phá của Prompt 05 được quay lại.
- `compare-p05-p06-*`: các góc preset không đổi (khi chưa chọn ghế và panel đóng).
- `report.json`: `seats`, `lifecycle`, `renderer`, `rendererBaseline`…

## Hạn chế

- Chỉ là dữ liệu demo: không giữ chỗ trên server, không lưu lựa chọn khi tải lại trang.
- Proxy picking dùng hộp theo bộ phận ghế: ở mép vỏ lưng ngả sau, hộp rộng hơn hình thật vài cm.
- Hover chỉ tính khi con trỏ di chuyển; khi camera tự chạy (tour, chuyển cảnh) thì không cập nhật và hover bị xóa.
- Phần gỡ listener trên texture toàn cục dựa vào chi tiết nội bộ của three r186 (`_listeners`, bảng DFG lấy qua `renderer.properties`). Khi nâng three phải kiểm tra lại; harness có check số listener cho việc này.
- Trên mobile dọc khi mở sheet, khung 3D còn khoảng một nửa chiều cao. Có thể đóng sheet bất kỳ lúc nào.

## File

- **Mới:**
  - `src/cinema/selection.ts`, `seatPicking.ts`, `seatHighlight.ts`, `seatPanel.ts`, `tapTracker.ts`
  - `src/cinema/selection.test.ts`, `tapTracker.test.ts`
  - `docs/handoff-prompt-06.md`, `artifacts/prompt-06/`
- **Sửa:**
  - `view.ts`: picking, tap, hover, highlight, trạng thái `seat`, hook debug.
  - `renderHost.ts`: gỡ listener trên texture toàn cục, thông tin debug.
  - `config.ts` (`selection`), `ui.ts` (nút sơ đồ, vùng main, thông báo, nút trở về), `page.ts`, `main.ts` (`CinemaSession`)
  - `exploreInput.ts` (bỏ qua phím thuộc widget), `seatInspector.ts` (`textureProbe`), `styles.css`
  - `scripts/capture-views.mjs`

**Lệnh:** `npm test`, `npm run typecheck`, `npm run build`, `npm run capture` (ghi ra `artifacts/prompt-06/`; đo baseline bằng `CAPTURE_DIR=prompt-06/baseline`).
