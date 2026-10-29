# Bàn giao Prompt 01: nền tảng và khối thô kiến trúc

Trạng thái: hoàn thành, chờ duyệt (27/10/2026). Chưa commit, project chưa phải git repo.

## Stack

| Thành phần | Phiên bản |
| --- | --- |
| Node / Yarn | 24.19 / 1.22.22 |
| Vite | 8.3.5 |
| TypeScript | 6.0.3 (theo template `create-vite` hiện hành) |
| three / @types/three | 0.186.1 / 0.186.0 (r186, renderer WebGL 2) |
| Vitest | 5.0.5 |
| playwright-core | 1.64.1 (chỉ dùng cho `yarn capture`, chạy Chrome/Edge có sẵn trên máy) |

Toàn bộ hình học được dựng bằng code, không có file model.

## Chạy

```bash
yarn install
yarn dev          # http://localhost:5173/cinema  ("/" tự chuyển sang /cinema)
yarn typecheck
yarn test             # kiểm tra dữ liệu bố trí và hình học (Node, không cần WebGL)
yarn build        # typecheck + build production vào dist/
yarn preview      # phục vụ dist/, /cinema vẫn hoạt động nhờ SPA fallback
yarn capture      # kiểm tra trên trình duyệt thật + chụp ảnh vào artifacts/prompt-01/
```

`yarn capture` tự bật Vite dev server, mở Chrome (hoặc Edge) headless, chạy 67 kiểm tra và ghi
`artifacts/prompt-01/report.json`. Nếu máy dùng trình duyệt ở vị trí khác: `BROWSER_PATH=... yarn capture`.

## Cấu trúc mã

| File | Trách nhiệm |
| --- | --- |
| `src/cinema/config.ts` | **Nguồn duy nhất** cho mọi kích thước (phòng, ghế, lối đi, bục, màn, mắt người xem, camera). |
| `src/cinema/layout.ts` | Sinh hàng, ghế, các bậc sàn, lối đi, bục, màn và số đo dẫn xuất từ config. Thuần dữ liệu, không phụ thuộc three. |
| `src/cinema/validation.ts` | `validateLayout()`: danh sách lỗi hình học; dùng trong test và cảnh báo console ở chế độ dev. |
| `src/cinema/architecture.ts` | Vỏ phòng, sàn bậc (extrude từ profile hàng), lối đi + viền bậc, bục, màn và khung. |
| `src/cinema/seats.ts` | Hợp đồng mẫu ghế, ghế placeholder, đặt ghế bằng `InstancedMesh` theo bộ phận. |
| `src/cinema/materials.ts` | Vật liệu blockout dùng chung. |
| `src/cinema/lighting.ts` | Ánh sáng kiểm tra, không bóng đổ, không hậu kỳ. |
| `src/cinema/cameraPresets.ts` | Bốn preset, tính từ layout; FOV thích ứng màn hình dọc. |
| `src/cinema/cameraRig.ts` | Camera + OrbitControls, một transition duy nhất, chế độ orbit/eye. |
| `src/cinema/view.ts` | Renderer, scene, vòng render theo nhu cầu, resize, mất context, dispose. |
| `src/cinema/ui.ts`, `page.ts` | Giao diện /cinema và phần nối UI với view. |
| `src/main.ts` | Router tối giản: `/` → `/cinema`, đường dẫn khác → trang 404. |
| `scripts/capture-views.mjs` | Kiểm thử trình duyệt và chụp ảnh. |

## Hệ tọa độ

- 1 unit = 1 m. +Y hướng lên. X là chiều ngang phòng, Z là chiều dài phòng.
- Gốc tại tâm mặt bằng; mặt trên sàn phòng tại Y = 0.
- Màn chiếu ở phía Z âm, cuối phòng ở Z dương. Mọi ghế nhìn về −Z.
- Khi ngồi nhìn về màn chiếu, +X là phía tay phải.

## Kích thước đã chốt

| Hạng mục | Giá trị |
| --- | --- |
| Thông thủy phòng | 12 × 18 × 6,5 m: X −6 → 6, Z −9 → 9, Y 0 → 6,5 |
| Tường / sàn / trần | dày 0,3 m, nằm ngoài thể tích thông thủy |
| Ghế | 10 hàng A–J × 11 ghế = 110 |
| Bước ghế / bước hàng / nâng mỗi hàng | 0,78 / 1,15 / 0,18 m |
| Cụm ghế | rộng 8,58 m theo footprint (tâm ghế ngoài cùng cách nhau 7,80 m), X −4,29 → 4,29 |
| Khoảng hai bên | mỗi bên 1,71 m = lối đi 1,50 m + đệm 0,21 m |
| Lối đi | X −6 → −4,5 và 4,5 → 6, chạy từ mép trước hàng A (Z −3,70) đến vách sau |
| Chiều dài cụm hàng | 11,50 m (Z −3,70 → 7,80); tâm hàng A → J cách nhau 10,35 m |
| Hàng A | sàn Y 0 (nằm trên sàn phòng), tâm ghế Z −3,025 |
| Hàng J | sàn Y 1,62, tâm ghế Z 7,325 |
| Chiếu nghỉ sau | Z 7,80 → 9,00 ở cao độ 1,62; sau lưng ghế J còn 1,30 m |
| Bục | 9,6 × 1,4 × 0,5 m, Z −9,00 → −7,60 |
| Sàn trống trước hàng A | 3,90 m (từ mép bục đến mép trước bậc hàng A) |
| Màn chiếu | 8,5 × 4,781 m (16:9), mặt màn tại Z −8,70, đáy Y 1,00, đỉnh Y 5,78, tâm Y 3,39 |
| Khung màn | viền 0,18 m → ngoài 8,86 × 5,14 m (Y 0,82 → 5,96), dày 0,10 m, nhô 0,03 m trước mặt màn |
| Mắt người ngồi (giả định) | 1,15 m trên sàn của ghế, lùi 0,15 m về phía tựa lưng |
| Khoảng nhìn | mắt hàng A → màn 5,83 m; hàng J → màn 16,18 m |

**Điều chỉnh so với đề xuất:** không thay đổi số nào của đề bài. Các giá trị đề bài chưa nêu được chọn như
sau: lối đi 1,50 m, đệm 0,21 m, bục 9,6 × 1,4 × 0,5 m, đáy màn 1,0 m, chiếu nghỉ sau 1,2 m, mỗi ghế đặt sát
phía sau bậc của nó (cách cổ bậc hàng sau 0,10 m, chừa 0,40 m lối đi chân giữa hai hàng). Hàng A đặt trên sàn
phòng nên có 9 cổ bậc (B → J). Bậc của hàng J kéo dài liền mạch thành chiếu nghỉ sau.

**Lưu ý thiết kế (không phải lỗi hình học):** góc ngước từ mắt hàng A lên mép trên màn là khoảng 38,5°,
cao hơn mức thường coi là thoải mái (~30–35°). Có thể giảm bằng cách hạ màn, thu nhỏ màn hoặc rút chiếu nghỉ
sau để đẩy hàng A lùi lại. Chưa chỉnh vì đề bài cố định kích thước phòng và số hàng.

## Dữ liệu ghế

`createAuditoriumLayout()` trả về `layout.seats: SeatData[]` (110 phần tử, thứ tự A01, A02 … J11):

```ts
interface SeatData {
  id: string;          // "A01" … "J11"
  index: number;       // vị trí trong layout.seats = instance id của mesh ghế
  rowIndex: number;    // 0 = A (gần màn nhất)
  columnIndex: number; // 0 = X âm nhất
  rowLabel: string;    // "A" … "J"
  seatNumber: number;  // 1 … 11, tăng theo +X (ghế 01 ở tay trái khi ngồi nhìn màn)
  position: Vec3;      // pivot ghế, world space
  yaw: number;         // rad quanh +Y; 0 = nhìn về −Z
  floorY: number;      // cao độ mặt sàn đỡ ghế (= position.y)
}
```

Cũng có `layout.rows`, `layout.treads` (dải sàn nâng dùng để dựng hình học), `layout.seatById`,
`layout.aisles`, `layout.seatingZone`, `layout.stage`, `layout.screen`, `layout.metrics`.
Sàn bậc, vị trí ghế và camera tầm mắt đều đọc từ cùng nguồn dữ liệu này.

## Pivot, hướng và hợp đồng mẫu ghế

- Pivot = tâm footprint của ghế, nằm trên mặt sàn (local Y = 0 chạm sàn).
- Ghế nhìn về local −Z; tựa lưng ở phía local +Z. Hàng thẳng nên mọi `yaw` = 0.
- Footprint 0,78 (X) × 0,75 (Z), căn giữa tại pivot. Mẫu ghế phải nằm trọn trong footprint.
- Một mẫu ghế là `SeatModel { parts: { name, geometry, material, matrix }[] }`.
  `createSeatInstances(model, seats)` tạo một `InstancedMesh` cho mỗi bộ phận; instance `i` là `seats[i]`.
  Thay mẫu ghế chỉ cần một `SeatModel` mới, không đụng vào bố trí.
- Placeholder hiện tại: đệm ngồi, tựa lưng ngả 9° và hai chân đỡ cao đến tầm tay vịn (4 draw call cho 110 ghế).
  Đỉnh ghế khoảng 1,05 m.

## Preset camera

| Preset | Vị trí → nhìn tới (16:9) | Ghi chú |
| --- | --- | --- |
| Tổng quan (mặc định) | (0; 4,42; 8,40) → (0; 1,70; −6,20) | Trong phòng, trên chiếu nghỉ sau, 2,8 m trên sàn |
| Nhìn về ghế | (0; 4,90; −7,70) → (0; 0,65; 0,90) | Trước mặt màn 1 m, dưới trần 1,6 m |
| Kiểm tra bên | ngoài vách phải, ví dụ (17,4; 5,7; −2,1) → tâm phòng | Tự ẩn vách phải và hiện lại khi đổi preset; khoảng cách tự fit theo tỉ lệ màn hình |
| Tầm mắt tại ghế | mắt ghế F06 (0; 2,05; 2,875) → tâm màn | Chế độ "eye": kéo để nhìn quanh, tắt zoom/pan |

- F06 được chọn làm "ghế giữa phòng": ghế giữa của hàng thứ 6/10 (10 hàng nên không có hàng giữa duy nhất).
- Orbit: khoảng cách 0,5–45 m, góc cực tối đa 88° (không chui xuống dưới sàn), target giữ trong bán kính 14 m
  quanh tâm phòng. FOV dọc 50°, tự mở rộng tới 75° trên màn hình dọc.
- Đổi preset: xoá quán tính damping, khoá controls trong lúc chuyển 0,9 s, chỉ có một transition tại một thời điểm
  (bấm preset mới sẽ thay transition cũ), đồng bộ target của controls khi kết thúc. Tôn trọng `prefers-reduced-motion`.
- Công tắc hiển thị: Trần, Vách sau, Vách phải. "Về góc ban đầu" = Tổng quan + hiện lại mọi thành phần.

## Kết quả kiểm chứng (27/10/2026)

- `yarn typecheck`: sạch. `yarn test`: 29/29. `yarn build`: thành công (cảnh báo chunk 604 kB, xem hạn chế).
- `yarn capture`: 67/67 kiểm tra trên Chrome 156 headless với GPU thật (ANGLE D3D11). Viewport giả lập
  desktop 1440×900, tablet 820×1180 @2x, mobile 390×844 @3x. Gồm: vào thẳng /cinema, `/` chuyển hướng, đủ 4 preset,
  reset, công tắc, bàn phím, kéo orbit rồi đổi preset (không trôi), bấm preset liên tiếp, resize desktop → mobile,
  không tràn ngang, giới hạn pixel ratio, mất/khôi phục context, re-mount bằng HMR thật (vẫn 1 canvas, context cũ
  đã được giải phóng), giả lập không có WebGL (hiện lỗi, không quay vô hạn). Console không có cảnh báo ngoài dự kiến.
- Ảnh: `artifacts/prompt-01/` (4 preset × 3 thiết bị, cutaway, mặt bằng, resize, lỗi WebGL).

## Chưa kiểm chứng / hạn chế

- Chưa thử trên thiết bị di động thật, Safari hay Firefox; cử chỉ chụm/hai ngón chỉ được giả lập qua viewport,
  không thao tác cảm ứng thật.
- Chưa đo hiệu năng trên GPU yếu.
- Production trên host tĩnh: truy cập thẳng `/cinema` cần cấu hình SPA fallback (rewrite về `index.html`);
  dev và `vite preview` đã tự xử lý.
- Bundle 604 kB (gzip 155 kB) chủ yếu là three.js; chưa tách chunk.
- Trên điện thoại dọc, preset "Nhìn về ghế" cắt hai đầu hàng A vì camera không thể lùi ra sau màn chiếu.
- Nếu WebGL context bị mất rồi khôi phục, sau đó unmount (chỉ xảy ra khi HMR), three r186 in ra cảnh báo
  "object does not belong to this context" từ listener nội bộ cũ. Vô hại.
- Camera là camera kiểm tra: không có va chạm, có thể orbit xuyên tường.

## Lỗi nền tảng cần sửa trước Prompt 02

Không có.
