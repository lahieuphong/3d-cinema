# Giao diện kính (Liquid Glass) — hệ thống thiết kế

Trạng thái: bản redesign trên nhánh `feature/liquid-glass-ui`, chờ duyệt (29/10/2026). Đây là
cách diễn giải Liquid Glass cho web bằng CSS: kính mờ, viền sáng và bóng. CSS không tái tạo được
hiệu ứng quang học native của Apple (khúc xạ, biến dạng theo nội dung).

Nguyên tắc chung:

- Khán phòng 3D luôn là nội dung chính.
- Điều khiển nổi trên khán phòng thành từng cụm kính nhỏ, xếp theo tác vụ.
- Chữ dài và sơ đồ ghế nằm trên bề mặt ổn định hơn.

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
- **Vật liệu.** Mỗi loại là một lớp màu (chỉ alpha) cộng một `backdrop-filter`:

| Vật liệu | Dùng cho | Lớp màu | Bộ lọc (desktop / điện thoại) |
| --- | --- | --- | --- |
| clear | brand, cụm “Cài đặt”, thanh chọn tác vụ, nút tròn, nút trở về, thanh tham quan, thông báo, cần đi bộ, mini player điện thoại | `rgb(22 22 26 / .5)` | `blur(16px)` / `blur(12px)` + `saturate(160%) brightness(.72)` |
| regular | dock của tác vụ, bảng Cài đặt / hub, sidebar ghế, chip lỗi phim, thẻ ghế, gợi ý lần đầu, thẻ trạng thái | `rgb(20 20 24 / .66)` | `blur(24px)` / `blur(18px)` + `saturate(150%) brightness(.72)` |
| dense | sơ đồ ghế, popover “Góc khác”, nhãn video 2D | `rgb(16 16 19 / .92)` | không blur riêng (nằm trong một tấm kính khác) |

- `brightness(.72)` làm tối phần phía sau, nên chữ ngà vẫn đủ tương phản trên khung phim sáng mà
  lớp màu không phải đậm.
- Mỗi cụm chỉ có một lớp blur; nút bên trong không blur lần nữa.
- **Viền và bóng.**
  - Viền trắng 14% (`--glass-border`), 22% khi đậm.
  - Highlight 1 px ở cạnh trên (`--glass-highlight`).
  - Ánh sáng nhẹ trên mặt kính (`--glass-sheen`).
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
- **Tablet dọc.** Sơ đồ là sheet dưới khán phòng như trước, mở rộng được thành toàn màn hình.
- **Điện thoại (`data-layout="immersive"`).**
  - Khán phòng tràn màn hình, chỉ có nút tròn kính (kéo, bám cạnh, nhớ vị trí như trước).
  - Hub có ba tác vụ ở đầu, bên dưới chỉ là nội dung của tác vụ đang chọn. “Cài đặt và trợ giúp”
    gập lại và lần mở sau gập lại như cũ.
  - Khi phim đã phát, mini player “Đang phát / Tạm dừng” ở góc dưới.
  - Sơ đồ ghế vẫn toàn màn hình.

Tác vụ vẫn chỉ do `taskLayout.ts` quyết định. Các nút tác vụ gọi `onTask`, trang `dispatch`. Đổi
bố cục chỉ di chuyển chính các phần tử DOM, không tạo bản sao, không gắn listener mới.

## Trợ năng và hiệu năng

- **Focus.** Vòng sáng 2 px cộng quầng tối, thấy được trên phim sáng lẫn khán phòng tối. Giữ nguyên
  focus trap, Escape, trả focus và `inert` như trước.
- **Ít chuyển động.** `prefers-reduced-motion` tắt mọi transition/animation.
- **Giảm độ trong.** `prefers-reduced-transparency` và nút “Giảm hiệu ứng kính” cho nền đặc, không
  blur.
- **Chế độ Tiết kiệm.** Blur giảm còn 8–10 px, bỏ ánh sáng trên mặt kính.
- **Thanh tác vụ khi đang xem.** Lúc phim phát và người dùng không chạm vào trang (3,5 s), thanh chọn
  tác vụ lùi đi. Dock trình phát và dòng ghi công vẫn ở lại. Rê chuột, phím hoặc focus là hiện lại;
  thanh không lùi khi đang hover, focus hay kéo thanh tua.
- **Không thêm gì nặng.** Không có canvas WebGL thứ hai, không shader khúc xạ, không đọc pixel
  canvas, không có dependency mới.

## Kiểm tra

Dùng `npm run capture`, `npm run acceptance`, `node scripts/measure-build.mjs` như cũ. Số đo của bản
redesign: `artifacts/prompt-15/`.
