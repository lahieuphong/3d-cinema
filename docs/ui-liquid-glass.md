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
| `src/site.css` | Landing, màn tải, lỗi, 404 trên cùng token; skeleton (khối, chữ shimmer, phòng chiếu, ghế, trang /cinema). |
| `src/skeleton.ts` | HTML của các skeleton: `roomSkeleton`, `seatSkeleton`, `cinemaPageSkeleton` (dùng ở `cinema.html`, màn mở phòng chiếu và lớp trạng thái 3D). |

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
- Popover “Góc khác” (cửa sổ 600–899 px) vẫn gần như đặc: nó nằm ngoài tấm kính chứa nó, blur ở
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
  - Nút tròn (nút nổi trên điện thoại, cần điều khiển Đi bộ và núm, nút Phát/Âm thanh, ×/Quay
    lại, số bước ở trang chủ) không dùng viền theo cạnh hay vạch sáng lệch về một phía: trên hình
    tròn, phía sáng hơn trông như viền dày hơn. Chúng có viền một màu quanh vòng (`--glass-rim`),
    quầng sáng đều, ánh sáng nằm bên trong mặt kính (không chạm mép) và bóng tiếp xúc ở giữa
    (`--shadow-round`). Nút tròn luôn cao bằng rộng, kể cả trong panel 44 px trên điện thoại.
- **Hình khối.**
  - Nút 14 px; pill 999 px; panel 26 px.
  - Không có vùng sáng nào góc vuông: hover, nhấn và vòng focus luôn theo góc bo của phần tử;
    link chữ không có hình riêng được bo `--radius-xs` (`:where(a)` trong `src/site.css`, không
    tăng specificity); ghế trên sơ đồ bo `36% 36% 26% 26%`.
  - Khoảng cách 4/8/12/16/24/32.
  - Vùng bấm tối thiểu 40 px (chuột), 44 px (cảm ứng).
- **Chữ.**
  - Font: SF Pro ở mọi nơi có thể. `--font-sans`: `-apple-system, BlinkMacSystemFont, "SF Pro
    Text", "SF Pro", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial`; tiêu đề ≥ 20 px
    (`h1`, `h2`, tiêu đề bước) dùng `--font-display` với “SF Pro Display”. Trên iPhone, iPad, Mac
    là SF Pro của hệ thống (tự chọn Text/Display theo cỡ); máy đã cài SF Pro dùng nó theo tên.
    Không tải file SF Pro / SF Symbols: giấy phép của Apple chỉ cho dùng trên nền tảng của Apple,
    nên máy khác dùng font giao diện của máy (đều đủ dấu tiếng Việt). Cùng danh sách được viết sẵn
    trong `index.html`, `cinema.html` (trước khi CSS tới) và chữ trên slate của
    `scripts/capture-brand-assets.mjs`; nút và ô nhập kế thừa font của trang.
  - Mã hoá: mọi tệp là UTF-8 không BOM, chữ tiếng Việt ở dạng NFC (dấu dựng sẵn), hai HTML shell
    khai `<meta charset="UTF-8">` đầu tiên và `lang="vi"`.
  - Cỡ chữ: thân 15–16 px, nhãn phụ 13–14 px, tiêu đề panel 20 px, hero 40–72 px.
  - Dòng ≥ 1.4 cho thân, ≥ 1.1 cho tiêu đề (đủ chỗ cho dấu tiếng Việt).
  - Số và thời gian dùng `tabular-nums`. Không còn tiêu đề in hoa giãn chữ trong hub.
- **Motion.**
  - 160 ms cho phản hồi, 220–280 ms cho panel.
  - Chỉ animate opacity/transform (panel hiện ra bằng `@starting-style`).
  - Không animate blur, bóng hay kích thước.
- **Đang tải: skeleton, không spinner.** Thứ gì đang tới thì hiện khung đúng hình dạng của nó,
  một vệt sáng mềm lướt qua từ trái sang phải (`.skeleton`, 1.8 s; nền `--skeleton-fill`, vệt
  `--skeleton-sheen`); chữ đang chờ có cùng vệt sáng chạy trong chữ (`.shimmer-text`). Giảm chuyển
  động: đứng yên. Khung chỉ để nhìn (`aria-hidden`); câu nói điều đang xảy ra vẫn có cho mọi người.
  - `/cinema` trước khi có code (`cinema.html`) và lúc tải code từ landing: skeleton của chính
    trang — hai cụm header, màn chiếu, các hàng ghế, thanh tác vụ (điện thoại: nút tròn) — chữ
    “Đang mở phòng chiếu…” và “Về trang chủ” nằm trên màn chiếu. Chờ quá 15 s: câu báo và “Tải lại
    trang” thay chỗ đó.
  - Phần 3D đang tải / đang dựng, hay mất ngữ cảnh WebGL đang chờ: lớp trạng thái là skeleton phòng
    chiếu (trang ghế: một chiếc ghế) với chữ trên đó. Lỗi luôn là thẻ có lý do và “Thử lại”, không
    bao giờ là skeleton.
  - Landing: ảnh chưa tới thì chỗ của nó shimmer (`landing.ts` đánh dấu `data-loading`), ảnh hero
    hiện dần khi tới; không có script thì ảnh cứ thế hiện.
  - Phim đang tải / chờ dữ liệu: chữ trạng thái shimmer thay cho vòng xoay. Trang lạ trước khi app
    chạy: “Đang tải trang…” shimmer.

## Bố cục theo màn hình

- **Desktop và tablet ngang (`data-layout="standard"`).**
  - Khán phòng tràn cửa sổ.
  - Header là hai cụm kính ở mép trên: thương hiệu (về trang chủ) bên trái; mini player và “Cài
    đặt” bên phải.
  - Thanh tác vụ ở dưới giữa: chip lỗi phim, rồi dock của tác vụ đang chọn, rồi thanh chọn tác vụ
    Khám phá / Chọn ghế / Xem phim. Dock gồm:
    - Khám phá: góc nhìn, tham quan, đi bộ;
    - Chọn ghế: tóm tắt, sơ đồ, “Xem từ ghế”;
    - Xem phim: trình phát kèm dòng ghi công. Tên phim là một nút viên thuốc (icon dải phim, tên,
      mũi tên menu — cùng khuôn với “Góc khác”); dòng ghi công đứng cạnh, thành cột riêng.
  - Chọn phim (3 phim): bấm tên phim mở danh sách kính gần đặc phía trên trình phát (như “Góc
    khác”, không blur lần hai), tiêu đề nhỏ “Phim”, mỗi phim một dòng: ảnh nhỏ 16:9 bo 8 px (shimmer
    tới khi tải xong), tên đậm, “thời lượng · hãng” nhỏ, dấu ✓ champagne ở phim đang chiếu (nền
    sáng hơn, bo tròn). Hover là một giọt sáng bo tròn, không có ô vuông. Esc hoặc bấm ra ngoài là
    đóng và trả focus về tên phim. Đổi phim: phim cũ dừng; nếu đang phát thì phim mới phát tiếp từ
    đầu, nếu không thì poster của nó lên màn chiếu; tên, ghi công và dấu ✓ đổi theo, trình đọc màn
    hình nghe “Đang chiếu: …” (hoặc “Đang phát: …”). Phim đã chọn được giữ khi qua Duyệt mẫu ghế rồi
    quay lại.
  - Nút có chữ trong cùng một cụm đều theo một khuôn: icon 18 px, cách 8 px, rồi chữ (không có nút
    chỉ-chữ cạnh nút icon-chữ). Khám phá: Tổng quan (màn chiếu và hàng ghế), Nhìn về ghế (ghế),
    Ghế F06 (mắt — cùng icon với “Xem từ ghế …”), Về góc ban đầu, Tham quan, Đi bộ; “Góc khác” có
    icon khung chồng và mũi tên menu. Dưới 900 px các góc ít dùng gộp vào “Góc khác” để Khám phá
    luôn nằm trên một hàng. Nút đóng sơ đồ ghế: × “Đóng”, hoặc ‹ “Trở lại phòng 3D” khi toàn màn
    hình. Nút chỉ có icon chỉ dùng cho điều khiển quen thuộc (phát, âm thanh, ×).
  - Tham quan: một thẻ kính “đang diễn ra” ở góc trên (dưới thương hiệu; trên điện thoại trải
    ngang mép trên, tối đa 480 px): icon ghim trong giọt champagne, dòng nhỏ “Đang tham quan · 2/6”
    trên tên điểm (đậm, tối đa 2 dòng), mỗi điểm một đoạn tiến độ (đã qua, đang ở — champagne,
    sắp tới), bên phải ■ “Dừng”. Đi từng điểm (giảm chuyển động): × “Thoát”, hàng ‹ “Trước” /
    “Tiếp” › bên dưới, tên điểm một dòng; điện thoại ngang gom tất cả trên một hàng. Trình đọc màn
    hình nghe một câu ẩn (aria-live) mỗi khi tới điểm mới. Thẻ cao 71 px (123 px khi đi từng
    điểm); nút tròn trên điện thoại không vào dải 144 px trên cùng nên không che thẻ.
  - “Chọn ghế” mở sidebar kính đè lên bên phải khán phòng; canvas không đổi kích thước, thanh tác
    vụ dời sang khoảng còn lại.
  - “Cài đặt” mở thẳng màn Cài đặt chính (xem “Cài đặt” bên dưới).
- **Tablet dọc.** Sơ đồ là sheet kính nổi phía dưới, đè lên khán phòng (cao 52dvh, cách mép 12 px);
  canvas không đổi kích thước, thanh chọn tác vụ nằm ngay trên sheet. Mở rộng được thành toàn màn
  hình.
- **Điện thoại (`data-layout="immersive"`).**
  - Khán phòng tràn màn hình, chỉ có nút tròn kính (kéo, bám cạnh, nhớ vị trí như trước).
  - Hub có ba tác vụ ở đầu, bên dưới là nội dung của tác vụ đang chọn, cuối cùng một hàng
    “Cài đặt” chuyển chính panel đó sang màn Cài đặt. Đóng rồi mở lại luôn về màn tác vụ.
  - Khám phá trong hub: hai nhóm có tiêu đề nhỏ (“Góc nhìn”, “Di chuyển”), mỗi nhóm là lưới 2 cột
    ô bằng nhau; trong ô, icon 20 px rồi chữ, canh trái, nên icon và chữ thẳng cột dù chữ dài ngắn.
  - Xem phim trong hub: trình phát, rồi nhóm “Phim” là ba dòng luôn hiện (ảnh nhỏ 80 px, tên, thời
    lượng · hãng, ✓), không có menu phải mở; dòng ghi công của phim đang chiếu ở dưới.
  - Khi phim đã phát, mini player “Đang phát / Tạm dừng” ở góc dưới.
  - Sơ đồ ghế vẫn toàn màn hình, giờ là một tấm kính đè lên khán phòng: phòng vẫn hiện mờ phía
    sau (inert, không đổi kích thước), thay cho nền đen.

### Cài đặt

Một panel, mỗi lúc một màn (state nội bộ của `controlHub.ts`: `task` / `settings` / `help` /
`about` / `advanced`, chỉ chọn nội dung panel, không đụng tới tác vụ). Đổi màn là thay nội dung tại
chỗ, không mở thêm modal và không bung accordion.

- **Màn chính “Cài đặt”** (header: tiêu đề, ×; trên điện thoại thêm nút Quay lại về màn tác vụ):
  - Hiển thị: Chất lượng (Cao / Tiết kiệm, xuống dưới nhãn khi không đủ rộng), Giảm hiệu ứng kính
    (switch, giữ tên và giá trị lưu `tp-glass`), Toàn màn hình (thành “Thoát toàn màn hình” khi đang
    bật; ẩn nếu trình duyệt không hỗ trợ).
  - Khác: Hướng dẫn nhanh ›, Thông tin ›, Công cụ nâng cao ›.
  - Cuối: link “Về trang chủ”.
  - Không có mô tả camera, danh sách hướng dẫn hay chú thích thường trực. Chỉ hiện chữ khi cần:
    trình duyệt từ chối toàn màn hình, hoặc lý do các nút bị tắt khi không có cảnh 3D.
- **Hướng dẫn nhanh:** bốn dòng theo chuột hoặc cảm ứng (Nhìn quanh, Chọn ghế, Đi bộ, Phát phim).
- **Thông tin:** Tân Phong Cinema, “Bản demo — không bán vé hoặc giữ chỗ.”, rồi mỗi phim một nhóm
  (tiêu đề là tên phim): ghi công và giấy phép, có liên kết. Dòng ghi công trong trình phát vẫn giữ
  nguyên (theo phim đang chiếu).
- **Công cụ nâng cao:** Góc kiểm tra (Mặt cắt bên, Mặt bằng), Thành phần phòng (Trần, Vách sau,
  Vách phải), hành động riêng “Kiểm tra ghế”.
- **Duyệt mẫu ghế (`/cinema?inspect=seat`):** header chỉ có tiêu đề, “Tùy chọn” và “Đóng” (icon +
  chữ). “Tùy chọn” mở một panel kính cùng kiểu hàng với Cài đặt: Chất lượng (Cao / Tiết kiệm), 3
  ghế, Footprint, Kích thước; bấm ra ngoài hoặc Escape thì đóng (Escape đóng panel trước, rồi mới
  đóng trang). Không còn nút góc nhìn: ghế mở ở góc trước 3/4, người xem tự kéo để xoay, cuộn hoặc
  chụm để thu phóng (các góc cố định chỉ còn cho `yarn capture`, qua hook dev). Thay dòng chữ
  hướng dẫn là một bàn tay đung đưa dưới mũi tên cong giữa khung; nó mờ đi và biến mất ở lần chạm,
  kéo hoặc cuộn đầu tiên (đứng yên khi giảm chuyển động); câu hướng dẫn vẫn có cho trình đọc màn
  hình.
  - Không gian 3D cùng tông với site: nền than ấm có quầng sáng nhẹ sau ghế (như slate trên màn
    chiếu), sàn là một vũng sáng ấm dưới ghế mờ dần vào nền (không có mép), lưới 10 cm màu champagne
    rất nhạt cũng mờ dần; ánh viền champagne, đèn chính gần trắng để màu bọc ghế vẫn đúng. Footprint
    màu champagne, khung kích thước màu trắng ấm (`inspector` trong `src/cinema/config.ts`).
- **Điều hướng:** màn con có nút Quay lại (tên đọc: “Quay lại Cài đặt”); quay lại trả focus về hàng
  đã mở. Escape lùi một màn, ở màn đầu thì đóng. × luôn đóng cả panel. Mỗi lần đổi màn: tiêu đề và
  tên dialog đổi theo, focus vào tiêu đề; màn ẩn dùng `hidden` nên không focus và không bị đọc.
  Đổi bố cục desktop ↔ điện thoại đóng panel; mở lại thì về màn đầu của bố cục đó.
- **Trình bày:** mỗi hàng nhãn trái, điều khiển / giá trị / chevron phải; nhóm có tiêu đề nhỏ và
  separator mảnh thụt vào 12 px hai đầu, không có card riêng cho từng hàng; hàng cao ≥ 48 px, nút
  ≥ 44 px. Hàng bấm được khi hover / nhấn / focus sáng lên thành khối kính bo 14 px
  (`--radius-md`), separator ngay trên và dưới nó ẩn đi để không cắt góc. Panel cao theo
  nội dung, tối đa bằng khoảng trống trên màn hình, phần thân cuộn dưới header cố định.

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

Dùng `yarn capture`, `yarn acceptance`, `node scripts/measure-build.mjs` như cũ. Số đo của bản
redesign: `artifacts/prompt-15/`; vòng kính trong suốt: `artifacts/prompt-16/`.
