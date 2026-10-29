# Giao diện kính (Liquid Glass) — hệ thống thiết kế

Trạng thái: bản redesign trên nhánh `feature/liquid-glass-ui`, chờ duyệt (29/10/2026); vòng 2 cùng
ngày làm mọi bề mặt trong suốt hơn. Đây là cách diễn giải Liquid Glass cho web bằng CSS: kính trong,
viền sáng, ánh trên mặt kính và bóng. CSS không tái tạo được hiệu ứng quang học native của Apple
(khúc xạ thật, biến dạng theo nội dung).

Nguyên tắc chung:

- Khán phòng 3D luôn là nội dung chính, và luôn nhìn thấy qua lớp kính: không còn bề mặt đặc nào
  trên khán phòng (trừ khi người dùng chọn “Giảm hiệu ứng kính”).
- Điều khiển nổi trên khán phòng thành từng cụm kính nhỏ, xếp theo tác vụ.
- Chữ dài và sơ đồ ghế nằm trên kính dày hơn (blur nhiều hơn), vẫn trong suốt.

## File

| File | Nội dung |
| --- | --- |
| `src/tokens.css` | Token dùng chung (màu, vật liệu, viền, bóng, radius, spacing, chữ, motion, z-index); chế độ giảm kính, fallback không có `backdrop-filter`, giảm blur trên điện thoại. Nạp đầu tiên ở `src/main.ts`. |
| `src/glass.ts` | Lựa chọn “Giảm hiệu ứng kính” (`html[data-glass="reduced"]`, lưu `localStorage` khoá `tp-glass`). Hai HTML shell đặt thuộc tính này trước lần vẽ đầu. |
| `src/styles.css` | Khán phòng: vật liệu theo thành phần, header, thanh tác vụ, dock, sidebar ghế, hub điện thoại, trạng thái, seat inspector. |
| `src/site.css` | Landing, màn tải, lỗi, 404 trên cùng token. |

## Token chính

- **Màu chữ.**
  - Ngà `--ink` `#f5f1ea`.
  - Phụ `--ink-secondary` `#d3cdc4` (chỉ dùng trên vật liệu regular/dense).
  - Mờ `--ink-tertiary`.
- **Màu nhấn và trạng thái.**
  - Champagne `--accent` `#d9c08c`, chỉ cho lựa chọn và hành động quan trọng: Phát, “Xem từ ghế
    này”, ghế đang chọn, số ghế trên “Chọn ghế”.
  - `--success`, `--warning`, `--danger`.
- **Vật liệu.** Mỗi loại là một lớp màu mỏng (chỉ alpha) cộng một `backdrop-filter`:

| Vật liệu | Dùng cho | Lớp màu | Bộ lọc (desktop / điện thoại) |
| --- | --- | --- | --- |
| clear | brand, cụm “Cài đặt”, thanh chọn tác vụ, nút trở về, thanh tham quan, thông báo, cần đi bộ, mini player điện thoại, nhãn video 2D | `rgb(14 14 18 / .16)` | `blur(8px)` + `saturate(190%) brightness(2.8) brightness(.34)` |
| regular | dock của tác vụ, bảng Cài đặt / hub, chip lỗi phim, thẻ ghế, gợi ý lần đầu, thẻ trạng thái | `rgb(14 14 18 / .22)` | `blur(14px)` / `blur(12px)` + `saturate(180%) brightness(2.8) brightness(.34)` |
| dense | sidebar / sheet / sơ đồ ghế toàn màn hình | `rgb(12 12 16 / .3)` | `blur(20px)` / `blur(16px)` + `saturate(170%) brightness(2.5) brightness(.38)` |

- **Bộ giới hạn sáng.** Cặp `brightness(k) brightness(c/k)` giữ nguyên phần tối của khán phòng
  (×0,95) và chặn mọi điểm sáng hơn ở mức `c`, vì trình duyệt kẹp giá trị giữa hai hàm filter (đã
  đo trên Chrome: nền trắng 255 → 102 với `brightness(2.5) brightness(.4)`, nền 64 giữ 64). Kính
  vì thế trong suốt trên phòng tối, và chữ ngà vẫn ≥ 4,5:1 trên khung phim gần trắng (kể cả nút
  đang chọn). Safari/Firefox chưa đo: nếu trình duyệt không kẹp giữa hai hàm, kính chỉ còn
  ×0,95 (trong hơn, nhưng chữ trên phim rất sáng sẽ kém tương phản hơn).
- **Nút tròn (điện thoại)** là thấu kính trong hơn cả lớp clear (không có chữ):
  `blur(5px) saturate(200%) brightness(.92)`, mép sáng như ánh sáng bẻ cong ở rìa, một vệt sáng
  phía trên, ba vòng tròn đồng tâm kiểu nút home nổi. Khi mở: kính sáng hơn, lõi màu champagne.
- **Sơ đồ ghế:** một “giếng” nông trong kính (`rgb(0 0 0 / .16)`); ghế là giọt kính màu (đỏ rượu
  vang trong 62%, ghế đã đặt gần như trong suốt có dấu ✕, ghế đang chọn champagne đặc).
- Popover “Góc khác” (cửa sổ hẹp 600–719 px) vẫn gần như đặc: nó nằm ngoài tấm kính chứa nó, blur ở
  đó không thấy gì phía sau.
- Mỗi cụm chỉ có một lớp blur; nút bên trong không blur lần nữa.
- **Viền, ánh sáng và bóng.**
  - Viền sáng theo từng cạnh (`--glass-edge`: trên 30%, trái 20%, phải 12%, dưới 8%); nút bên
    trong có viền nhẹ hơn (`--glass-edge-soft`).
  - Vạch sáng 1 px bên trong cạnh trên (`--glass-highlight`) và quầng sáng mỏng trong mép kính
    (`--glass-depth`).
  - Ánh trên mặt kính (`--glass-sheen`): vệt sáng phía trên, phản chiếu nhẹ ở đáy.
  - Chữ trên kính có bóng mềm (`--glass-text-shadow`); chữ trên nền champagne thì không.
  - Bóng `--shadow-sm` / `--shadow-lg`.
- **Hình khối.**
  - Nút 14 px; pill 999 px; panel 26 px.
  - Khoảng cách 4/8/12/16/24/32.
  - Vùng bấm tối thiểu 40 px (chuột), 44 px (cảm ứng).
- **Chữ.**
  - Font hệ thống: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial`.
    Không tải SF Pro / SF Symbols.
  - Cỡ chữ: thân 15–16 px, nhãn phụ 13–14 px, tiêu đề panel 20 px, hero 40–72 px.
  - Dòng ≥ 1.4 cho thân, ≥ 1.1 cho tiêu đề (đủ chỗ cho dấu tiếng Việt).
  - Số và thời gian dùng `tabular-nums`. Không còn tiêu đề in hoa giãn chữ trong hub.
- **Motion.**
  - 160 ms cho phản hồi, 220–280 ms cho panel.
  - Chỉ animate opacity/transform (panel hiện ra bằng `@starting-style`).
  - Không animate blur, bóng hay kích thước.

## Bố cục theo màn hình

- **Desktop và tablet ngang (`data-layout="standard"`).**
  - Khán phòng tràn cửa sổ.
  - Header là hai cụm kính ở mép trên: thương hiệu (về trang chủ) bên trái; mini player và “Cài
    đặt” bên phải.
  - Thanh tác vụ ở dưới giữa: chip lỗi phim, rồi dock của tác vụ đang chọn, rồi thanh chọn tác vụ
    Khám phá / Chọn ghế / Xem phim. Dock gồm:
    - Khám phá: góc nhìn, tham quan, đi bộ;
    - Chọn ghế: tóm tắt, sơ đồ, “Xem từ ghế”;
    - Xem phim: trình phát kèm dòng ghi công.
  - “Chọn ghế” mở sidebar kính đè lên bên phải khán phòng; canvas không đổi kích thước, thanh tác
    vụ dời sang khoảng còn lại.
  - “Cài đặt” chỉ còn Hiển thị (chất lượng, giảm hiệu ứng kính, toàn màn hình, công cụ kiểm tra gập
    lại), Trợ giúp và Về trang chủ.
- **Tablet dọc.** Sơ đồ là sheet kính nổi phía dưới, đè lên khán phòng (cao 52dvh, cách mép 12 px);
  canvas không đổi kích thước, thanh chọn tác vụ nằm ngay trên sheet. Mở rộng được thành toàn màn
  hình.
- **Điện thoại (`data-layout="immersive"`).**
  - Khán phòng tràn màn hình, chỉ có nút tròn kính (kéo, bám cạnh, nhớ vị trí như trước).
  - Hub có ba tác vụ ở đầu, bên dưới chỉ là nội dung của tác vụ đang chọn. “Cài đặt và trợ giúp”
    gập lại và lần mở sau gập lại như cũ.
  - Khi phim đã phát, mini player “Đang phát / Tạm dừng” ở góc dưới.
  - Sơ đồ ghế vẫn toàn màn hình, giờ là một tấm kính đè lên khán phòng: phòng vẫn hiện mờ phía
    sau (inert, không đổi kích thước), thay cho nền đen.

Tác vụ vẫn chỉ do `taskLayout.ts` quyết định. Các nút tác vụ gọi `onTask`, trang `dispatch`. Đổi
bố cục chỉ di chuyển chính các phần tử DOM, không tạo bản sao, không gắn listener mới.

## Trợ năng và hiệu năng

- **Focus.** Vòng sáng 2 px cộng quầng tối, thấy được trên phim sáng lẫn khán phòng tối. Giữ nguyên
  focus trap, Escape, trả focus và `inert` như trước.
- **Ít chuyển động.** `prefers-reduced-motion` tắt mọi transition/animation.
- **Giảm độ trong.** `prefers-reduced-transparency` và nút “Giảm hiệu ứng kính” cho nền đặc, không
  blur.
- **Chế độ Tiết kiệm.** Blur giảm còn 6–10 px (giữ nguyên bộ giới hạn sáng), bỏ ánh trên mặt kính.
- **Thanh tác vụ khi đang xem.** Lúc phim phát và người dùng không chạm vào trang (3,5 s), thanh chọn
  tác vụ lùi đi. Dock trình phát và dòng ghi công vẫn ở lại. Rê chuột, phím hoặc focus là hiện lại;
  thanh không lùi khi đang hover, focus hay kéo thanh tua.
- **Không thêm gì nặng.** Không có canvas WebGL thứ hai, không shader khúc xạ, không đọc pixel
  canvas, không có dependency mới.

## Kiểm tra

Dùng `npm run capture`, `npm run acceptance`, `node scripts/measure-build.mjs` như cũ. Số đo của bản
redesign: `artifacts/prompt-15/`; vòng kính trong suốt: `artifacts/prompt-16/`.
