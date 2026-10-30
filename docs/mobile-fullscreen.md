# Tràn màn hình trên điện thoại và mở từ Màn hình chính

Vòng hoàn thiện trải nghiệm tràn màn hình (30/10/2026), ưu tiên iPhone. Tài liệu ghi lại phần nào do
trình duyệt quản lý, phần nào do layout của trang, những gì đã sửa, cách kiểm tra và những gì chưa
xác minh trên máy thật.

## Thanh của trình duyệt và khoảng trống do layout

- **Thanh địa chỉ và thanh công cụ của Safari** thuộc trình duyệt. CSS không ẩn được chúng.
  - Trang này không cuộn, nên Safari tự tô vùng phía sau thanh nổi (iOS 26) bằng một màu lấy từ trang.
    Dải tối ở đáy ảnh chụp tham chiếu chính là vùng đó.
  - Không dùng mẹo cuộn trang để giả vờ ẩn thanh.
- **Đồng hồ, Dynamic Island, thanh Home** thuộc hệ điều hành, kể cả khi mở như ứng dụng. Trang chỉ
  tránh để nút nằm dưới chúng, bằng `env(safe-area-inset-*)`.
- **Layout của trang:** khán phòng chiếm đúng phần trình duyệt để lại.
  - `.cinema-app` cao `100dvh` (dự phòng `100vh`); canvas phủ hết, không có margin hay padding.
  - Đã kiểm trong Chrome giả lập: canvas bằng đúng cửa sổ ở mọi kích thước thử, không có dải trống do
    layout. Bản trước cũng đã như vậy (xem ảnh trước/sau).
- **Muốn không còn thanh trình duyệt:** mở từ Màn hình chính (`display: standalone`).

## Đã làm

| Phần | Thay đổi |
| --- | --- |
| Viewport | Giữ `width=device-width, initial-scale=1, viewport-fit=cover`; không khoá zoom. |
| Chiều cao | Thêm `html[data-display="standalone"] .cinema-app { height: 100vh }`. Trong cửa sổ ứng dụng không có thanh trình duyệt, nên `100vh` là cả màn hình. iOS từng đo `svh` thiếu vùng an toàn ở chế độ này (WebKit bug 254868). |
| Cuộn | Trang rạp và trang kiểm tra ghế thêm `overscroll-behavior: none`. Landing không đổi, vẫn cuộn bình thường. |
| Manifest | `/manifest.webmanifest` sinh từ `webAppManifest()` trong `src/brand.ts`: name "Tân Phong Cinema", short_name "TP Cinema", id và start_url `/cinema`, scope `/`, `display: standalone`, theme/background `#0d0d10` (nền trang rạp, `--canvas`). |
| Icon | `public/brand/icon-192.png`, `icon-512.png` (purpose any) và `icon-maskable-512.png`, sinh bằng `BRAND_ONLY=icons node scripts/capture-brand-assets.mjs`. Logo trên nền charcoal, không kéo méo. Bản maskable giữ logo trong vòng tròn 80 % (đã kiểm từng điểm ảnh). |
| Metadata | Cả `index.html` và `cinema.html`: `link rel="manifest"`, `apple-mobile-web-app-title` = "TP Cinema", `apple-mobile-web-app-status-bar-style` = `black-translucent` (rạp vẽ dưới thanh trạng thái, nút tránh bằng safe area), `apple-mobile-web-app-capable` và `mobile-web-app-capable`, `apple-touch-icon` 180×180 sẵn có. |
| Màu | `theme-color` theo từng trang (rạp `#0d0d10`, landing `#14110f`), đổi theo khi chuyển trang trong app. Nền mở đầu của `cinema.html` đổi `#0f1013` → `#0d0d10` cho trùng màn khởi động. |
| Chế độ hiển thị | `src/display.ts`: `display-mode: standalone`, hoặc `navigator.standalone` của Safari trên iOS. Đặt `html[data-display]`. |
| Toàn màn hình | Giữ nút "Toàn màn hình" sẵn có: chỉ hiện khi `document.fullscreenEnabled` và có `requestFullscreen`; cả trang (rạp và nút điều khiển), không riêng video; xử lý từ chối và `fullscreenchange`. |
| Mở như ứng dụng | Cài đặt › Hiển thị có mục "Mở như ứng dụng" khi không có Fullscreen API (iPhone) và chưa ở chế độ ứng dụng. Mục này mở màn hướng dẫn chỉ khi được chạm, không tự bật. Không giả lập nút cài đặt. |

Không thêm service worker, không cache trước gì, không ghi là chạy offline.

Không đổi:
- renderer vẫn đổi kích thước theo container thật (ResizeObserver), camera aspect và chọn ghế theo kích
  thước canvas;
- giới hạn DPR theo bậc chất lượng;
- FOV theo tỉ lệ khung hình như trước;
- nút nổi tự quay về vùng an toàn khi đổi kích thước.

## Kiểm tra

`yarn capture`, nhóm `edge` (Chrome 156 giả lập; vùng an toàn bằng CDP
`Emulation.setSafeAreaInsetsOverride`):

- iPhone trong tab (390×844, thanh trạng thái 47 px, thanh Home 34 px):
  - canvas bằng đúng cửa sổ; trang không cuộn; buffer = kích thước × DPR theo bậc; aspect đúng;
  - nút tròn trong vùng an toàn, kể cả khi kéo lên mép trên hoặc mép dưới;
  - Cài đặt có "Mở như ứng dụng", không có "Toàn màn hình"; màn hướng dẫn đúng chữ; Quay lại trả
    focus về đúng mục.
- Xoay ngang/dọc 3 lần, vùng an toàn chuyển sang hai bên:
  - mỗi lần đều phủ kín;
  - vẫn là canvas và phần tử video cũ (không dựng lại);
  - chạm một ghế sau đó vẫn chọn đúng ghế.
- Mở từ Màn hình chính (393×852, `navigator.standalone`, thanh trạng thái 59 px):
  - đánh dấu standalone; rạp cao 852 px, phủ cả dưới thanh trạng thái;
  - không còn mục cài đặt hay toàn màn hình;
  - sơ đồ ghế toàn màn hình nằm trong vùng an toàn, nút "Trở lại phòng 3D" chạm được, danh sách cuộn
    bên trong.
- Có Fullscreen API (412×915): vào và thoát toàn màn hình; vẫn canvas và video cũ, phủ kín cả hai lần.
- Manifest:
  - đúng các trường, phục vụ dạng `application/manifest+json`;
  - icon đúng kích thước, không trong suốt; bản maskable không có điểm nào ngoài vòng an toàn.
- Landing cuộn được trước và sau khi vào rạp.

Ảnh trước/sau (bản build trước và sau, cùng giả lập): `artifacts/edge-final/before-after/`.

## Chưa xác minh

Chưa có iPhone hay Safari thật trong môi trường. Các mục dưới đây chỉ đúng trên giấy cho tới khi thử
trên máy:

- màu Safari tô sau thanh nổi khi ở tab;
- chiều cao thật trong cửa sổ ứng dụng trên iOS 26, gồm cả quy tắc `100vh` ở trên;
- thanh trạng thái `black-translucent`;
- tên "TP Cinema" và icon trên Màn hình chính;
- xoay máy trong cửa sổ ứng dụng.

Android Chrome thật (cài đặt, icon maskable, toàn màn hình) cũng chưa thử.

## Thử trên iPhone

1. Mở `https://tp3d-cinema.vercel.app/cinema` trong Safari.
2. Chia sẻ (có thể nằm trong menu của thanh địa chỉ) → Thêm vào Màn hình chính → bật "Mở dưới dạng
   ứng dụng" nếu có → Thêm.
3. Mở **TP Cinema** từ Màn hình chính.
4. Xem:
   - không có thanh địa chỉ;
   - rạp phủ cả dưới đồng hồ;
   - nút tròn và sơ đồ ghế không nằm dưới Dynamic Island hay thanh Home;
   - xoay máy vài lần;
   - chạm chọn ghế;
   - phát phim.
5. Đã thêm trước đây mà icon hay tên chưa đổi: xoá icon cũ rồi thêm lại.
