# Landing: "Cinematic Portal — Cánh cửa vào rạp"

Thiết kế lại trang mở đầu `/` (30/10/2026, nhánh `feature/cinematic-portal`). Bản này thay bản dải phim
trước đó. Chỉ landing và ảnh của nó thay đổi; `/cinema` (scene, nút điều khiển, chọn ghế, player,
âm thanh), định tuyến, metadata và cấu hình hosting/cache giữ nguyên.

## Vì sao đổi

Bản dải phim có những vấn đề sau:
- hai mép phim vàng nổi hơn ảnh;
- khung giữa làm rạp bị đóng hộp;
- menu kính dạng viên thuốc lệch phong cách;
- logo lặp ngay hero;
- tiêu đề quá đậm;
- nhiều ảnh cùng tông, nhiều phần lặp cùng một ý.

## Thiết kế

Nền đen than `#101011`, bề mặt phụ `#191719`, chữ trắng ngà `#F2EEE7`. Champagne `#C8B17C` chỉ dùng
cho nút vào rạp và vài điểm nhấn. Toàn bộ token để trong `.landing`, nên không ảnh hưởng `/cinema`.

1. **Hero:**
   - ảnh rạp tràn chiều rộng, cao gần một màn hình;
   - góc máy từ đầu lối đi trái, nhìn xuống các bậc có đèn và qua các hàng ghế tới màn chiếu;
   - màn chiếu mang slate logo Tân Phong Cinema; chữ nằm dưới màn chiếu nên không tranh với tiêu đề;
   - chỉ có lớp tối cục bộ sau chữ (góc dưới trái) và dưới header;
   - header phẳng: logo nhỏ, "Trải nghiệm", "Vào rạp" (viền champagne); trên điện thoại chỉ logo và
     "Vào rạp";
   - tiêu đề hai dòng "Một chỗ ngồi. / Một góc nhìn riêng.", đậm 600;
   - mô tả, nút "Vào rạp", liên kết "Khám phá không gian ↓", dòng demo;
   - chữ ở một phần ba dưới bên trái, dưới màn chiếu;
   - điện thoại dọc có ảnh riêng: màn chiếu ở trên, bậc lối đi và hàng ghế ở dưới;
   - màn thấp (điện thoại ngang, zoom): ảnh chiếm phần phải, chữ trên nền tối bên trái.
2. **Trải nghiệm — "Một không gian, ba cách khám phá":** ba chức năng có thật trong rạp, mỗi chức
   năng một ảnh và một bản phác hoạ động của đúng control làm việc đó, theo kiểu kính của rạp:
   - **Tham quan tự động** (`tour.ts`): ảnh bố trí phòng; đường đi vẽ dần qua các điểm dừng, chip
     tour lần lượt ghi tên điểm dừng thật ("Tổng quan phòng chiếu", "Màn chiếu, rèm và bục", "Nhìn lại
     các hàng ghế");
   - **Đi bộ trong rạp** (`walker.ts`, cần điều khiển, WASD): ảnh bậc lối đi; cần điều khiển đẩy
     tới, phím W sáng, mũi tên hiện dần lên bậc;
   - **Xem từ ghế này**: ảnh từ ghế F06; sơ đồ 110 ghế hiện ra, F06 được chọn, rồi chip "Xem từ ghế
     này" và máy quay "đến" chỗ ngồi;
   - mỗi thẻ có icon của rạp (`src/icons.ts`, dùng chung với rạp), câu mô tả và cách mở trong rạp;
   - dùng pattern tab: chuột, chạm, phím mũi tên, Home, End;
   - phác hoạ chạy một lần (2,6 s) khi phần này hiện lên và mỗi khi chọn mục khác, không lặp;
   - khi tắt JavaScript hoặc bật giảm chuyển động: phác hoạ đứng yên ở trạng thái cuối, ba mục hiện
     đủ.
3. **Lời mời — "Trên màn chiếu":**
   - ảnh căn phòng từ cuối lối giữa;
   - "Đèn đã dịu. Mời bạn vào rạp.";
   - ba phim của rạp trong một dải phim chạy ngang, nghiêng nhẹ, lỗ phim là ánh sáng mờ, mỗi khung
     ghi tên, độ dài, hãng và giấy phép; ảnh tĩnh `film-*.webp` làm từ poster, không tải từ `/media/`;
   - các khung sáng dần lần lượt khi hiện lên; dải phim trôi ngang theo cuộn (chỉ khi có chuột);
   - trên điện thoại vuốt ngang từng phim;
   - nút "Bước vào rạp".
4. **Footer:** credit ba phim và ghi chú demo, chữ nhỏ.

Ảnh mới chụp từ chính khán phòng bằng `scripts/capture-brand-assets.mjs` (`portal-hero`, `exp-*`,
`portal-finale`):
- giao diện ẩn khi chụp, chất lượng Ưu tiên đẹp, tỉ lệ điểm ảnh 2;
- màn chiếu dùng slate logo (hero, ảnh Xem phim) hoặc slate mới `screen-glow.png` (màn sáng dịu, không chữ: ảnh lời mời);
- scene production không đổi;
- ảnh `frame-*` và `hero-*` cũ đã bỏ. Ảnh chia sẻ `share-1200.jpg` giữ nguyên.

## Chuyển động

- **Mở trang** (khoảng 0,85 s):
  - ảnh hero hiện từ độ mờ 0,35, thu từ 1,025 về 1;
  - tiêu đề trượt lên 12 px (vẽ ngay từ đầu);
  - mô tả, nút, dòng demo hiện lần lượt;
  - nút bấm được ngay.
- **Cuộn:**
  - cuộn gốc của trình duyệt;
  - hai phần dưới hiện dần (16 px) khi vào màn hình;
  - ảnh hero trôi chậm hơn trang và theo chuột (có sẵn);
  - ảnh lời mời trôi ±14 px, chỉ khi có chuột.
- **Đổi ảnh Trải nghiệm:**
  - ảnh mới hiện đè lên ảnh cũ trong 0,28 s, sau khi đã giải mã xong;
  - không nháy đen, khung giữ nguyên kích thước.
- **Nút:**
  - vệt sáng mờ lướt qua một lần khi hover hoặc focus;
  - đã bỏ quầng sáng mạnh.
- **Vào rạp:**
  - lớp tối nhạt dần trong 0,28 s trên trang rạp đã có sẵn;
  - không chờ, không chặn bấm, tự gỡ.
- **Giảm chuyển động:** không có hiệu ứng nào ở trên.
- **Khi tắt JavaScript:** mọi phần hiện sẵn.
- **Khi đứng yên:** không có vòng vẽ nào.

## Dung lượng

Đo bằng `yarn measure:build`, bản production, 1280×720, lần đầu vào `/`:

| | Dải phim (trước) | Cinematic Portal (sau) |
| --- | --- | --- |
| Tổng trước khi bấm | 142,3 KB | 145,1 KB (có logo trên màn chiếu) |
| Ảnh | 123,0 KB | 123,6 KB |
| Ảnh hero (1440 WebP) | 47,7 KB | 55,5 KB |
| JS / CSS chính (gzip) | 8,0 / 6,1 KB | 8,4 / 5,8 KB |
| LCP, máy cục bộ | 72–80 ms (ảnh hero) | 64–76 ms (dòng tiêu đề) |
| LCP, 1,6 Mbit/s | 784–860 ms | 520–552 ms (có logo: 532–536 ms) |
| CLS | 0 | 0 |

- Lúc đầu bản mới tải tới 205,9 KB: trang ngắn hơn, nên Chrome tải sớm cả ba ảnh Trải nghiệm.
- Hai ảnh chưa được chọn giờ chỉ được gắn nguồn khi khung ảnh vào màn hình, hoặc khi người dùng chọn
  (`ways.ts`).
- Ảnh lời mời vẫn là lazy bình thường.

## Kiểm tra

- `yarn capture` các nhóm landing ở 9 kích thước:
  - nút ở màn hình đầu, không tràn ngang, mục bấm ≥ 44 px;
  - chữ không đè màn chiếu trong ảnh;
  - hero và ảnh cuối tràn đúng chiều rộng cửa sổ;
  - hero không lazy; không còn dải phim;
  - mọi phần hiện đủ khi cuộn;
  - ba lựa chọn Trải nghiệm (chuột, bàn phím, kích thước khung, không tự đổi) và khi tắt JavaScript;
  - vào/ra rạp, Back/Forward, giảm chuyển động.
- `measure:build`, `acceptance` (cả khi tắt JavaScript).
- Ảnh QA nằm ngoài Git, trong `artifacts/portal-qa/`.

## Chưa xác minh

- Safari, Firefox và máy thật;
- cảm nhận màu và độ sáng trên màn hình khác máy đo;
- chuyển động trên máy yếu thật.
