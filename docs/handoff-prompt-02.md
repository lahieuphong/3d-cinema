# Bàn giao Prompt 02: ghế cinema procedural

Trạng thái: hoàn thành, chờ duyệt (27/10/2026). Chưa commit; mọi thay đổi nằm trong working tree trên nhánh `main`.

## Hiện trạng đã xác minh trước khi sửa

| Hạng mục | Báo cáo Prompt 01 | Thực tế (source + lockfile) |
| --- | --- | --- |
| Vite / TypeScript / three / @types/three | 8.3.5 / 6.0.3 / 0.186.1 / 0.186.0 | khớp; không nâng dependency nào |
| Hợp đồng ghế (10 × 11, bước 0,78 / 1,15, nâng 0,18, footprint 0,78 × 0,75, pivot tâm footprint trên sàn, nhìn −Z) | như bàn giao | khớp |
| Git | "chưa phải git repo" | đã là repo, 2 commit của người dùng, working tree sạch lúc bắt đầu |
| Host tĩnh `/cinema` | cần SPA rewrite | đã có `vercel.json` (rewrite về `index.html`) |

Bố trí phòng, màn chiếu, hàng ghế và ID không đổi.

## Thiết kế và kích thước ghế

Ghế cinema tiêu chuẩn, bọc da đỏ rượu, khung graphite, không logo. Gồm:
- Tựa lưng: vỏ sau dạng tấm côn bo cạnh, rộng hơn ở vai, ngả 10° về +Z; phía trước có ba múi đệm phồng (thắt lưng, lưng trên, đệm đầu), giữa các múi có rãnh chia nhẹ.
- Đệm đầu: múi riêng, hẹp hơn, nhô hơn một chút, hài hoà với tựa lưng.
- Đệm ngồi: gối phồng có vồng, cạnh trước bo tròn, nghiêng 4° (mép trước cao hơn), đặt trên khay ẩn bên dưới.
- Tay vịn: hai cái mỗi ghế, có khe với ghế bên cạnh; đỡ bởi tấm chân bên dưới.
- Hốc cốc ở đầu tay vịn phải (của người ngồi nhìn màn): vành bo hai mép, lòng và đáy tối.
- Chân: tấm chân hình thang chạm sàn, có tấm đế; nối với khay đệm bằng trục bản lề, với tựa lưng bằng giá đỡ.
- Mặt sau: vỏ lưng đỏ sẫm, ốp graphite phần dưới lưng.

Kích thước cuối cùng, **đo từ geometry thật** (test `seats.test.ts` và bảng kích thước trong chế độ inspect):

| Hạng mục | Giá trị | Gợi ý đề bài |
| --- | --- | --- |
| Tổng rộng | 0,748 m (X −0,370 → 0,378; phía phải là hốc cốc) | 0,72–0,76 |
| Tổng sâu, kể cả tựa ngả | 0,724 m (Z −0,356 → 0,368) | ≤ 0,75 |
| Tổng cao | 1,087 m | 1,05–1,15 |
| Mặt ngồi cao | 0,463 m | 0,43–0,47 |
| Đệm ngồi | rộng 0,50, sâu 0,50, dày 0,11 m | rộng 0,48–0,52 |
| Tay vịn | đỉnh cao 0,655 m, rộng 0,08 m | — |
| Tựa lưng | bản lề tại Y 0,40, Z 0,195; vỏ rộng 0,54 → 0,58 m, cao 0,70 m, dày 0,055 m; ngả 10° | — |
| Hốc cốc | Ø trong 76 mm, Ø ngoài 96 mm, sâu 85 mm | — |
| Khe với ghế bên cạnh | 32 mm (giữa hai tay vịn: 40 mm) | — |
| Dư trong footprint | 32 mm ngang, 26 mm sâu | — |

Mọi kích thước nằm trong `AUDITORIUM_CONFIG.seat.model` (`src/cinema/config.ts`). Cấu hình placeholder cũ đã bị gỡ.

## Cách sinh geometry

`createCinemaSeatModel(config, materials)` trong `src/cinema/seats.ts`. Mỗi bộ phận là một "piece" có transform cục bộ riêng, được dựng bằng các primitive trong `src/cinema/seatGeometry.ts`:

| Primitive | Dùng cho | Ghi chú |
| --- | --- | --- |
| `createPillowGeometry` | đệm ngồi, 3 múi tựa lưng | superellipsoid (lưới chỉ số, dùng chung đỉnh qua đường nối và cực) + vồng ở mặt nhìn thấy; normals mượt |
| `createBeveledSlab` + `createPanelShape` / `roundedPolygon` | vỏ lưng, ốp lưng, tấm chân | `ExtrudeGeometry` có bevel với `bevelOffset = −bevel` để khối hoàn thiện khớp đúng silhouette (chân không lún sàn) |
| `RoundedBoxGeometry` (addons r186) | tay vịn, khay, giá đỡ, tấm đế | bán kính bo khác nhau theo bộ phận (4–24 mm) |
| `LatheGeometry` + `CircleGeometry` | hốc cốc | profile ngược chiều kim đồng hồ để normals hướng ra ngoài; đáy là đĩa riêng (lathe không chạm được trục mà không tạo lỗ kim hoặc tam giác suy biến) |
| `CylinderGeometry` | trục bản lề khay | — |

- Normals: tấm extrude dùng `toCreasedNormals` (mượt qua bevel, giữ cạnh cứng > 45°). Hàm này băm vị trí theo 1/100 đơn vị (= 1 cm), quá thô cho chi tiết ghế, nên geometry được phóng ×100 khi gọi rồi thu lại.
- Sau khi dựng, mỗi piece được nướng transform vào không gian ghế, đo bounds, rồi gộp theo vật liệu (`mergeSeatPieces`: chỉ giữ position + normal, `mergeGeometries`, rồi `mergeVertices` để dùng chung lại đỉnh).
- Không dùng file model, ảnh billboard hay texture.

## Vật liệu

`createSeatMaterials()` trong `src/cinema/materials.ts` (MeshStandardMaterial, metalness 0):
- `upholstery` đỏ rượu `#6d1420`, roughness 0,64.
- `shell` đỏ sẫm `#4a0d16`, roughness 0,70.
- `frame` graphite `#2a2b30`, roughness 0,62.
- `cupWell` gần đen `#151619`, roughness 0,80.

Vật liệu kiến trúc (Lambert) vẫn nằm trong `createBlockoutMaterials()`. Ánh sáng không đổi.

## Cấu trúc SeatModel

```ts
interface SeatModel {
  name: string;                       // 'cinema-seat'
  parts: SeatModelPart[];             // upholstery, shell, frame, cupWell — mỗi phần một geometry đã gộp
  components: SeatComponent[];        // từng piece trước khi gộp: { name, part, bounds } đo từ geometry
  cupHolder: { center, radius, depth };
  dispose(): void;                    // dispose 4 geometry; vật liệu thuộc người gọi
}
interface SeatModelPart { name; geometry; material; matrix }  // matrix = identity vì transform đã nướng vào geometry
```

Chế độ inspect và khán phòng dùng **cùng** `createCinemaSeatModel` + `createSeatMaterials` + `createSeatInstances`; không có bản hình học thứ hai.

## Pivot, hướng và ánh xạ instance

- Hợp đồng Prompt 01 giữ nguyên: pivot tại tâm footprint trên mặt sàn, local Y = 0 chạm sàn, ghế nhìn local −Z, mọi `yaw` = 0.
- `createSeatInstances(model, layout.seats)` tạo 4 `InstancedMesh` (một cho mỗi vật liệu), mỗi mesh 110 instance. **Instance `i` của mọi mesh là `seats[i]`.**
- Truy ngược khi chọn ghế (Prompt sau): `seatInstances.seatForInstance(hit.instanceId)` trả `SeatData` (có `id` như `F06`) cho hit trên bất kỳ mesh nào; `seatInstances.seats` là chính mảng `layout.seats`.
- Sau khi gán ma trận instance, `computeBoundingBox()` và `computeBoundingSphere()` được gọi trên từng mesh. Test kiểm tra mọi đỉnh của mọi instance nằm trong bounding sphere, nên culling không làm mất ghế.

## Chế độ duyệt ghế (inspect)

- Mở: `http://localhost:5173/cinema?inspect=seat`. Không có nút trong giao diện chính.
- Góc nhìn: Trước 3/4, Bên, Sau 3/4, Từ trên, Cận hốc cốc. Kéo để xoay, cuộn/chụm để thu phóng, chuột phải/hai ngón để dịch.
- Công tắc: "3 ghế" (cụm ba ghế đặt theo bước 0,78 m), "Footprint" (khung 0,78 × 0,75 m mỗi ghế), "Kích thước" (hộp bao đo từ geometry và bảng số đo).
- Đóng: nút "Đóng" hoặc phím Esc, quay về `/cinema` trong cùng trang. Nút Back của trình duyệt mở lại inspector.
- Chỉ một renderer tồn tại tại một thời điểm: router (`src/main.ts`) unmount trang hiện tại trước khi mount trang mới. Module inspector được nạp theo nhu cầu (chunk riêng ~8 kB) và cũng có trong bản production, chỉ không được liên kết từ giao diện.

## Thay đổi cấu trúc so với Prompt 01

- `src/cinema/renderHost.ts` (mới): tách vòng đời renderer khỏi `CinemaView` (kiểm tra WebGL 2, canvas, resize và pixel ratio, render theo nhu cầu, mất/khôi phục context, dispose). `CinemaView` và inspector cùng dùng.
- `CameraRig` nhận cấu hình camera (`CameraRigSettings`) thay vì toàn bộ config phòng; `fovForAspect` cũng vậy. Inspector có cấu hình camera riêng trong `config.inspector.camera`.
- `ui.ts` xuất thêm `renderStatus`, `switchControl`, `el`, `group` để inspector dùng lại.
- `validation.ts` bỏ phép kiểm tra trần dựa trên số placeholder; thay bằng test dùng bounds geometry thật của ghế hàng J trong `seats.test.ts`.
- Test ghế chuyển từ `scene.test.ts` sang `seats.test.ts`; các assertion cũ giữ nguyên với cùng dung sai.
- `yarn capture` mặc định ghi vào `artifacts/prompt-02/`; ảnh Prompt 01 không bị đụng tới.

## Số liệu renderer trước/sau

Đo bằng `renderer.info` sau khung cuối của từng preset, Chrome 156 headless, GPU RTX 3090 (ANGLE D3D11), viewport 1440 × 900, DPR 1, cùng camera. "Trước" là code tại commit `90655a7`, đo bằng cùng script (`artifacts/prompt-02/baseline/report.json`).

| Preset | Draw call trước → sau | Tam giác trước → sau | Geometry | Texture |
| --- | --- | --- | --- | --- |
| Tổng quan | 31 → 31 | 5 786 → 653 026 | 19 → 20 | 0 → 1 |
| Nhìn về ghế | 35 → 35 | 5 834 → 653 074 | 19 → 20 | 0 → 1 |
| Kiểm tra bên | 36 → 36 | 5 846 → 653 086 | 19 → 20 | 0 → 1 |
| Tầm mắt tại ghế | 19 → 19 | 5 642 → 652 882 | 19 → 20 | 0 → 1 |

- Draw call không tăng: ghế vẫn là 4 InstancedMesh (một cho mỗi vật liệu).
- Mỗi ghế 5 932 tam giác: đệm 2 496, vỏ lưng 572, khung 2 648, lòng hốc cốc 216. Cả 110 ghế khoảng 652 500 tam giác. Mỗi InstancedMesh bị culling như một khối, nên mọi preset đều vẽ đủ 110 ghế.
- Geometry +1: ghế có 4 geometry thay vì 3 như placeholder.
- Texture 1 là `DFG_LUT`, bảng tra nội bộ three r186 tạo cho vật liệu PBR (MeshStandardMaterial); project không dùng texture nào.
- Inspector, một ghế, góc trước 3/4: 6 draw call, 5 996 tam giác.
- **Chưa đo FPS** và chưa thử trên GPU yếu; không suy ra hiệu năng máy yếu từ máy này.

## Kết quả kiểm tra

- `yarn typecheck`: sạch.
- `yarn test`: 38/38 (3 file). `seats.test.ts` kiểm tra trên geometry thật:
  - Kích thước nằm trong khoảng gợi ý; mọi piece (kể cả tựa ngả, tay vịn, hốc cốc) nằm trong footprint.
  - Chỉ chân và tấm đế chạm sàn (đáy = 0 trong dung sai 1 µm).
  - Ghế nhìn −Z, tựa ngả về +Z.
  - Tia thả xuống hốc cốc chạm đáy tối trước, không vướng tay vịn.
  - 0 tam giác suy biến, 0 tam giác có normals ngược chiều cuộn.
  - Mắt người ngồi không nằm trong ghế của chính mình.
  - Khe ≥ 2 cm giữa ghế cạnh nhau, ≥ 30 cm giữa các hàng; không lấn lối đi, không vượt sàn hàng; hàng J cách trần > 3 m.
  - Ánh xạ instance → `seats[i]` đúng cho cả 4 mesh và 110 ghế.
  - Bounding sphere bao mọi đỉnh của mọi instance.
  - Mỗi geometry và vật liệu dùng chung bị dispose đúng một lần.
- Thử đột biến: cho tay vịn bịt hốc cốc → test hốc cốc fail; đảo chiều ngả lưng → test hướng fail. Cả hai đã khôi phục.
- `yarn build`: thành công. JS chính 632 kB (gzip 164 kB), chunk inspector 8 kB; vẫn có cảnh báo chunk > 500 kB do three.js.
- `yarn capture`: 75/75, không có cảnh báo console ngoài dự kiến (chỉ 2 lỗi cố ý của bài giả lập không có WebGL). Gồm toàn bộ kiểm tra Prompt 01, cộng thêm:
  - Inspector mở thẳng, chỉ 1 canvas và không có renderer khán phòng chạy song song.
  - Đủ các góc nhìn; kích thước đo trong trình duyệt khớp; cụm 3 ghế; overlay footprint và kích thước.
  - Đóng → `/cinema` với context của inspector đã được giải phóng; Back mở lại; Esc đóng.

## Ảnh (`artifacts/prompt-02/`)

| Ảnh | Nội dung |
| --- | --- |
| `seat-1-front-34.png`, `seat-2-side.png`, `seat-3-back-34.png` | ghế mẫu trước 3/4, bên, sau 3/4 |
| `seat-4-cup-holder.png` | cận hốc cốc |
| `seat-5-cluster-front.png`, `seat-6-cluster-top-footprint.png` | cụm 3 ghế; nhìn từ trên với footprint và kích thước |
| `desktop-1…4-*.png` | bốn preset khán phòng trên desktop |
| `desktop-7-seats-close-up.png` | ghế chi tiết trong khán phòng, nhìn gần |
| `mobile-1-overview.png`, `mobile-4-seat-eye.png` | tổng quan và tầm mắt trên mobile (cùng các ảnh tablet/mobile khác) |
| `baseline/` | cùng bộ góc với ghế placeholder, chụp trước khi thay |

Ảnh Prompt 01 vẫn nằm nguyên trong `artifacts/prompt-01/`.

## Hạn chế còn lại

- **Riêng (đã có từ Prompt 01, không đổi):** trên điện thoại dọc, preset "Nhìn về ghế" cắt hai đầu hàng A vì camera không thể lùi ra sau màn chiếu (`mobile-2-seats.png`). Không thay kiến trúc để che vấn đề này.
- Ở góc nhìn rất xiên, mặt phẳng chân graphite còn một đốm phản xạ Fresnel từ đèn key định hướng (thấy rõ ở `seat-4-cup-holder.png`). Đây là hiện tượng ánh sáng, không phải lỗi hình học; xử lý khi làm lighting ở Prompt 04.
- ~653k tam giác cho 110 ghế, chưa có LOD. Ổn trên GPU mạnh đã thử; chưa đo trên mobile thật hoặc GPU yếu.
- Vành hốc cốc (24 phân đoạn) hơi gãy cạnh khi nhìn rất gần.
- Đệm là các khối gối liền; chưa có đường chỉ hay texture da.
- Mọi ghế giống hệt nhau (hốc cốc luôn ở tay vịn phải).
- Chế độ inspect có trong bản production (không liên kết từ giao diện).
- Chưa thử trên thiết bị di động thật, Safari hay Firefox. Cảnh báo "object does not belong to this context" của three r186 sau khi khôi phục context rồi unmount (chỉ khi HMR) vẫn như Prompt 01.

## Lỗi chặn trước Prompt 03

Không có.
