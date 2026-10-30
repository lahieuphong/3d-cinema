# Landing: "Cuộn phim dẫn vào rạp"

Thiết kế lại trang mở đầu `/` (30/10/2026). Chỉ landing và bước chuyển vào rạp thay đổi. `/cinema`,
nút điều khiển trên điện thoại, player, chọn ghế, chất lượng hiển thị và cấu hình hosting/cache giữ
nguyên.

## Thiết kế

Cả trang là một dải phim 35 mm chạy dọc, từ đầu trang tới chân trang.

- **Hai mép phim:**
  - màu champagne trầm (`#b8a67f`), có lỗ chữ nhật đen bo góc nhẹ;
  - mỗi mép là một pseudo-element (`.filmstrip::before`, `::after`), lặp một ô SVG nhỏ theo chiều
    dọc, nên không có phần tử DOM nào cho từng lỗ;
  - không nhận con trỏ, không có trong cây trợ năng;
  - rộng 16–44 px tuỳ màn hình.
- **Giữa hai mép:** phim tối; các phần của trang là các khung, cách nhau một vạch khung mảnh. Khung
  luôn nằm trong hai mép, nên lỗ phim không bao giờ đè lên chữ hay nút (`yarn capture` kiểm tra ở
  mọi kích thước).
- **Nền ngoài:** đen than với ba vệt sáng ấm tĩnh (không chuyển động).
- **Thanh điều hướng:** kính nổi như cũ, nằm gọn trong bề rộng dải phim.

| Khung | Nội dung | Ảnh |
| --- | --- | --- |
| 01 Mở màn | Logo và tên, h1 "Bước vào rạp. Chọn góc nhìn của bạn.", một câu giới thiệu, dòng "Khám phá không gian. Chọn ghế. Thưởng thức bộ phim.", nút "Vào rạp" | `hero-*` (16:9 và bản dọc), có sẵn |
| 02 Góc nhìn | Chọn ghế và xem từ chỗ đó; 110 ghế, màn 16:9 rộng 8,5 m | `frame-seat-*`: từ ghế F06 |
| 03 Khám phá | Ba ảnh theo nhịp khung (một ảnh dọc, hai ảnh chồng): Khám phá, Chọn ghế, Xem phim | `frame-aisle-*` (bậc lối đi phải), `frame-rows-*` (hàng ghế nhìn từ bục), `frame-screen-*` (màn chiếu từ lối trái) |
| 04 Vào rạp | Lời mời, nút "Bước vào rạp", ghi chú bản demo | `frame-finale-*`: tỉ lệ scope 2,39:1, bản dọc 4:5 cho điện thoại |
| Đuôi phim | Tên, ghi chú demo, ghi công và giấy phép ba phim | — |

- **Ảnh mới:**
  - chụp từ chính khán phòng bằng `scripts/capture-brand-assets.mjs` (`BRAND_ONLY=frame-seat,…`);
  - UI ẩn khi chụp, bậc chất lượng Ưu tiên đẹp, tỉ lệ điểm ảnh 2;
  - WebP ở 2–3 cỡ, kèm một JPEG dự phòng.
- **Ảnh bỏ đi:** ba ảnh `step-*` cũ (hai trong số đó là ảnh chụp giao diện).

## Chuyển động

- **Mở trang:**
  - ảnh hero sáng dần lên, từ một lớp tối mờ đi trong 1,1 s;
  - logo, tiêu đề, câu giới thiệu, nút và ghi chú hiện lần lượt, cách nhau 0,1 s, xong trong khoảng
    1 s;
  - nút bấm được ngay từ đầu.
- **Cuộn:**
  - cuộn gốc của trình duyệt, không ghim section nào;
  - khung 02–04 hiện dần khi vào màn hình (IntersectionObserver, nhích 20 px);
  - ảnh hero trôi chậm hơn trang như trước;
  - ảnh trong khung trôi ±14 px, chỉ khi có chuột; trên màn hình cảm ứng ảnh đứng yên;
  - mỗi bước cuộn vẽ một khung hình; trang đứng yên thì không có vòng vẽ nào.
- **Nút:**
  - hover hoặc focus: một vệt sáng lướt qua một lần (transition, không lặp);
  - nút chính có quầng sáng nhẹ;
  - focus ring giữ như cũ.
- **Vào rạp:**
  - trang rạp hiện ngay dưới một lớp tối, lớp này nhạt đi trong 0,32 s;
  - không chờ, không chặn bấm (`pointer-events: none`);
  - lớp tự gỡ khi xong; Back/Forward không bị kẹt màn tối.
- **Giảm chuyển động:** không có hiệu ứng mở trang, hiện dần, parallax, vệt sáng hay lớp tối.
- **Không có JavaScript:** mọi khung hiện sẵn (chỉ bị ẩn khi script đã chạy).
- Không có âm thanh, không nhấp nháy, không vết xước phim.

## Hiệu năng

Đo bằng `yarn measure:build`, bản production, 1280×720, lần đầu vào `/`:

| | Trước | Sau |
| --- | --- | --- |
| Tổng tải trước khi bấm | 139,1 KB | 142,3 KB |
| Ảnh | 121,7 KB | 123,0 KB |
| JS / CSS (nén) | 7,6 / 5,4 KB | 8,3 / 6,4 KB |
| Phần tử LCP | h1 | ảnh hero (khung không còn tràn cả cửa sổ) |
| LCP, máy cục bộ | 88–92 ms | 72–80 ms |
| LCP, 1,6 Mbit/s, RTT 150 ms | 520–552 ms | 784–860 ms |
| CLS | 0 | 0 |

- Tăng 2,3 %:
  - JS chứa markup landing (để vẽ lại khi quay về từ rạp);
  - CSS có thêm dải phim.
- Bốn ảnh khung nhỏ (11–20 KB) mà Chrome tải sẵn vì nằm gần màn hình đầu thay chỗ ba ảnh step cũ.
- Ảnh khung 04 chỉ tải khi cuộn tới.
- Landing vẫn không tải mã rạp, three.js hay phim trước khi người dùng tỏ ý muốn vào.

## Kiểm tra

- `yarn capture`, các nhóm landing, ở 9 kích thước (1440×900 tới 360×640, ngang, zoom 200 %):
  - nút ở màn hình đầu;
  - không tràn ngang;
  - chữ không đè màn chiếu trong ảnh;
  - mép phim không đè chữ hay nút;
  - dải phim chạy tới chân trang;
  - mọi khung hiện đủ khi cuộn;
  - giảm chuyển động, bàn phím, Back/Forward, vào/ra rạp nhiều lần.
- `measure:build` và `acceptance`: kể cả trang khi tắt JavaScript.
- Ảnh QA nằm ngoài Git, trong `artifacts/landing-final/` và `artifacts/landing-redesign/`.

## Chưa xác minh

- Safari, Firefox;
- màn hình thật ngoài Chrome giả lập;
- cảm nhận chuyển động trên máy yếu thật.
