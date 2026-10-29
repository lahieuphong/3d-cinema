# Hình ảnh: ánh sáng, bóng và che khuất

Vòng hoàn thiện hình ảnh cuối (30/10/2026), nhánh `visual/final-polish`, sau vòng hiệu năng
([performance.md](performance.md)). Tài liệu này ghi lại những gì đã rà, đã sửa, cách tổ chức ánh sáng
và bóng theo nhóm vật thể, số đo trước/sau, và những gì chưa xác minh.

## Đã rà

- **35 góc camera cố định**, ở bậc Ưu tiên đẹp (`high`) và Tiết kiệm (`economy`), 1440×900, DPR 1:
  - tổng quan từ cuối phòng, từ màn chiếu;
  - ngồi hàng A, E, J × trái, giữa, phải;
  - đi dọc hai lối đi (lên và xuống), lối ngang trước hàng A;
  - cận cảnh: chân ghế ở tầm thấp, giữa hai hàng, bậc, mép rèm (dưới và trên), mép bệ, góc trần–tường,
    góc tường sau, cửa thoát hiểm;
  - trần, sàn, tường sau, màn chiếu;
  - 7 khung dọc tour.
- **Ẩn từng phần:** bỏ trần (đèn kiểm tra), bỏ tường phải, bỏ tường sau, rồi hiện lại.
- **Mỗi góc:** ảnh chụp, độ sáng trung bình, tỷ lệ điểm gần đen (< 8/255) và tỷ lệ điểm cháy trắng
  (cả ba kênh > 250/255).
- **Đóng góp của từng đèn:** bật riêng từng nhóm đèn (các đèn khác cường độ 0, cùng shader).

Không thấy lỗi hình học: không có vật lơ lửng, xuyên nhau, khe hở, mặt thiếu hay z-fighting ở các góc
trên. Các kiểm tra hình học sẵn có (`interior.test.ts`, `scene.test.ts`: chồng lấn, mặt đồng phẳng,
khoảng hở lối đi, tường) vẫn qua. Vòng này không sửa hình học.

Lỗi tìm thấy là lỗi ánh sáng:
- **Thiếu tiếp xúc:** sàn dưới ghế, chân bậc, chân tường và quanh bệ sáng đều như sàn trống. Đèn
  duy nhất có bóng (đèn trần) chỉ cho bóng đổ; ánh sáng gián tiếp (hemisphere và môi trường) không
  bị gì che.
- **Ánh sáng gián tiếp lấn át:** trên sàn và bậc, phần gián tiếp lớn hơn đèn trần, nên mặt ngang trông
  phẳng.
- **Nếp rèm nông:** khe giữa hai nếp sáng gần bằng đỉnh nếp.

## Đã sửa

### Che khuất nướng sẵn (`src/cinema/bakedOcclusion.ts`)

**Sàn, bậc, lối đi, bệ:**
- Texture một kênh 408×600 (3 cm mỗi ô, 0,31 MiB kể cả mipmap, `NoColorSpace`), dựng một lần từ bố
  cục khi tải.
- Nội dung:
  - dưới mỗi ghế còn 38% (dấu chân ghế được làm mờ);
  - ở góc lõm (chân bậc, chân tường, chân bệ) còn 50%, sáng dần lên 100% trong 20–25 cm.
- Gắn làm `aoMap` (toạ độ mặt bằng ở `uv1`) cho vật liệu thảm, lối đi và bệ.
- `aoMap` chỉ giảm ánh sáng gián tiếp. Bóng của đèn trần không bị nhân đôi.

**Rèm:**
- Màu đỉnh theo độ sâu của nếp: khe sâu nhất (phía tường) còn 55%, đỉnh nếp 100%.
- Tính từ chính tham số của rèm (độ sâu nếp tăng dần về gấu).

**Chi phí:**
- Một bước dựng riêng, khoảng 9 ms trên máy đo (dev), để long task dài nhất không tăng.
- Một lần đọc texture trên sàn.
- Không thêm draw call.
- Thêm một chương trình shader (16 → 17): bệ có `aoMap` nên không còn dùng chung chương trình với tường.
  Chương trình vẫn được biên dịch nền trước khung đầu, nên thời gian chặn luồng chính không đổi.
- Thêm một texture (+0,31 MiB).

### Cân lại đèn (`src/cinema/lighting.ts`)

| Đèn | Trước | Sau | Vì sao |
|---|---|---|---|
| Hemisphere, phía trời (mặt hướng lên) | `#857565` × 2,0 | `#6c5f52` × 2,0 (≈ −36% tuyến tính) | Bớt nền phẳng trên sàn và mặt ghế |
| Hemisphere, phía đất (trần, mặt hướng xuống) | `#7a5a4a` × 2,0 | giữ | Giảm phần này làm trần đen (thử: điểm gần đen ở góc trần–tường 21% → 44%) |
| Đèn trần (có bóng) | 1,5 | 1,85 | Đèn chính dẫn trên sàn, ghế, bậc |
| `normalBias` của bóng | 0,025 | 0,012 | Bóng bám chân ghế hơn; không có acne ở cả 2048 và 1024 |
| Màn chiếu, hắt trần, dẫn lối, rèm | – | giữ | Đèn nhấn theo thiết kế |

Không thêm đèn, không thêm bloom, không đổi tone mapping (Neutral, exposure 1).

## Ánh sáng theo vai trò

1. **Chính:** đèn trần (DirectionalLight), đèn duy nhất đổ bóng.
2. **Gián tiếp nhẹ:**
   - hemisphere ấm: phía trời yếu hơn đèn chính, phía đất giữ trần đọc được;
   - môi trường phản xạ (PMREM của một phòng dựng bằng code), mỗi vật liệu có `envMapIntensity`
     riêng: kim loại dùng nhiều, vải gần như không.
3. **Nhấn:**
   - màn chiếu (RectAreaLight lạnh trung tính);
   - hai dải hắt trần rửa tường bên;
   - hai dải dẫn lối dọc lan can;
   - hai đèn rọi rèm.

Đèn area và đèn rọi không đổ bóng (RectAreaLight trong three.js không hỗ trợ bóng). Chỗ chúng bị che
được bù một phần bằng che khuất nướng sẵn.

Đóng góp từng nhóm khi bật riêng (độ sáng trung bình sRGB 0–255 của cả ảnh; không cộng được):

| Góc | Nhóm | Trước | Sau |
|---|---|---|---|
| Bậc lối đi (cận) | đèn trần | 11,9 | 13,3 |
| | hemisphere | 8,9 | 7,6 |
| | môi trường | 14,2 | 13,4 |
| Chân ghế (thấp) | đèn trần | 3,2 | 3,9 |
| | hemisphere | 2,6 | 1,9 |
| | môi trường | 6,4 | 5,5 |
| Từ màn chiếu nhìn về ghế | đèn trần | 2,4 | 2,7 |
| | hemisphere | 6,2 | 5,3 |

Môi trường vẫn là phần lớn nhất ở nhiều góc vì tường, trần và ghế phản xạ nó. Giảm nó nữa làm tường
và trần tối hẳn (đã thử ở hemisphere), nên giữ nguyên.

## Bóng và che khuất theo nhóm vật thể

Bóng động: đèn trần, shadow map PCF, chỉ vẽ lại khi cần (`autoUpdate = false`).

| Nhóm | Đổ bóng | Nhận bóng | Che khuất nướng sẵn | Ghi chú |
|---|---|---|---|---|
| Ghế (110, instanced) | có | có | sàn dưới ghế | Đệm, lưng, tay vịn tự đổ bóng lên nhau và xuống sàn |
| Sàn, bậc, lối đi (thảm) | không | có | dưới ghế, chân bậc, chân tường | Nẹp mũi bậc phát sáng: chỉ nhận |
| Bệ | có | có | chân bệ; mặt bệ dọc tường | |
| Tấm tiêu âm, sơn graphite (dầm, len chân tường, cửa, loa, diềm rèm), kim loại champagne (nẹp, lan can) | có | có | – | |
| Mặt tường kết cấu | không | có | – | |
| Rèm | có | có | màu đỉnh theo nếp | |
| Máy chiếu | có | có | – | |
| Trần | không | không | – | Nằm giữa đèn trần và phòng; nếu đổ bóng sẽ che cả phòng |
| Màn chiếu và khung | không | không | – | Màn chiếu không nhận đèn, giữ đúng màu video |

Theo bậc chất lượng:

| Bậc | Shadow map | Bán kính PCF | Ghế | Che khuất nướng sẵn |
|---|---|---|---|---|
| Ưu tiên đẹp / cân bằng | 2048 | 3 | chi tiết | như nhau ở mọi bậc |
| Tiết kiệm / tối giản | 1024 | 2 | thô | như nhau ở mọi bậc |

Che khuất nướng sẵn không đổi theo bậc, nên Tiết kiệm vẫn có tiếp xúc ở chân ghế và chân bậc.

**Camera của bóng:**
- Ôm khít khối kết cấu nhìn từ hướng đèn (18,4 × 22,6 m, lề 0,2 m), nên không có bóng bị cắt.
- Mỗi texel khoảng 1 cm ở 2048, 2 cm ở 1024.
- `bias` −0,0004, `normalBias` 0,012 (1,2 cm).

**Vẽ lại shadow map khi:**
- khung đầu;
- ẩn/hiện trần, tường phải, tường sau (đèn gắn trên phần đó tắt theo; bỏ trần thì đèn chính thành đèn
  kiểm tra trung tính);
- đổi bậc làm đổi kích thước map;
- dựng lại ghế;
- khôi phục context WebGL.

Camera di chuyển không vẽ lại bóng, nên bóng không nhấp nháy khi đi.

## Vật liệu

Rà, không đổi giá trị:
- **Vải** (rèm, tấm tiêu âm, thảm): độ nhám 0,9–1, gần như không phản xạ môi trường. Rèm có sheen.
- **Da ghế:** nhám 0,6–0,68, không bóng nhựa.
- **Kim loại** (nẹp champagne, chi tiết thép ghế): nhám 0,38–0,5, phản xạ mềm.
- **Tường:** nhám 0,95–1.
- **Sàn:** nhám 1, không bóng gương.
- **Màn chiếu:** vật liệu không chiếu sáng, không tone map, nên giữ đúng màu video.

Không gian màu:
- texture màu (thảm, biển EXIT, poster, video): sRGB;
- texture dữ liệu (che khuất): tuyến tính (`NoColorSpace`).

## Ánh sáng từ màn chiếu

Đã có từ trước: một RectAreaLight lạnh trung tính, phủ đúng khung hình, chiếu lên bệ và các hàng đầu.
Cường độ cố định.

Không làm đèn đổi theo màu phim:
- cách đúng là đọc màu trung bình của khung video, tức đọc pixel GPU (không được phép);
- cách còn lại là dựng sẵn một dải màu cho từng phim, tức là thêm dữ liệu và tính năng (ngoài phạm vi).

## Số đo trước/sau

Cùng cách đo với [performance.md](performance.md): `scripts/measure-perf.mjs` trên bản production.
- Trước: `6245333` (main trước vòng này), build ở `artifacts/visual-before-dist/`.
- Sau: build ở `artifacts/visual-after-dist/`.
- Mỗi bên: RTX 3090 và UHD 770; Ưu tiên đẹp và Tiết kiệm; desktop 1440, laptop HiDPI, điện thoại 390;
  3 lượt, lấy trung vị.

```
PERF_ONLY=load,runtime,shots PERF_GPUS=rtx,uhd PERF_QUALITY=high,economy \
PERF_VIEWPORTS=desktop-1440,laptop-hidpi,phone-390 PERF_DIST=<dist> PERF_OUT=visual-perf/<tên> yarn measure:perf
PERF_COMPARE=visual-perf/before,visual-perf/after yarn measure:perf
```

#### Khung hình khi tour (GPU = timer query, ms, p50/p95)

| GPU | Kích thước | Bậc | Trước | Sau | fps trước → sau |
|---|---|---|---|---|---|
| RTX 3090 | desktop 1440 | cao | 3,18 / 4,82 | 3,22 / 4,84 | 60,1 → 59,9 |
| RTX 3090 | desktop 1440 | Tiết kiệm | 3,06 / 4,86 | 3,09 / 4,94 | 60,1 → 60,0 |
| RTX 3090 | laptop HiDPI | cao | 3,45 / 4,00 | 3,52 / 4,45 | 60,0 → 60,0 |
| RTX 3090 | điện thoại 390 | cao | 3,05 / 5,67 | 3,06 / 5,63 | 59,9 → 60,0 |
| UHD 770 | desktop 1440 | cao | 13,09 / 43,16 | 13,12 / 43,68 | 46,6 → 46,7 |
| UHD 770 | desktop 1440 | Tiết kiệm | 12,74 / 35,68 | 12,78 / 35,79 | 49,1 → 49,0 |
| UHD 770 | laptop HiDPI | cao | 106,8 / 146,0 | 122,1 / 146,3 | 9,1 → 8,8 |
| UHD 770 | laptop HiDPI | Tiết kiệm | 18,97 / 51,74 | 19,08 / 51,85 | 38,3 → 37,6 |
| UHD 770 | điện thoại 390 | cao | 10,92 / 38,85 | 11,21 / 38,48 | 48,3 → 48,3 |
| UHD 770 | điện thoại 390 | Tiết kiệm | 9,65 / 15,45 | 9,69 / 15,50 | 60,1 → 60,0 |

- Hầu hết chênh 0–3%, trong mức dao động giữa các lượt.
- **UHD 770, laptop HiDPI, cao** lệch nhiều hơn ở p50. Đã đo lại, xen kẽ trước/sau, 2 × 3 lượt mỗi bên:
  - trước 114,7 và 118,9 ms; sau 115,6 và 123,0 ms;
  - trong một lượt đã dao động 111–127 ms;
  - chênh khoảng 2%, không tách được khỏi nhiễu.

  Đây là trường hợp vốn quá tải (9 fps); "Tự động" không ở bậc này trên máy như vậy.
- **Phim** (chỉ vẽ lại màn chiếu): như trước, ví dụ UHD 770 desktop 4,54 → 4,54 ms. Đứng yên: 0 khung.

#### Tải trang (trung vị, ms)

| Kích thước | Mạng | Cache | Khung 3D đầu tiên | Long task dài nhất | TBT |
|---|---|---|---|---|---|
| desktop 1440 | cục bộ | lạnh | 1408 → 1481 | 126 → 121 | 0 → 0 |
| desktop 1440 | cục bộ | ấm | 230 → 229 | 0 → 0 | 0 → 0 |
| desktop 1440 | chậm + CPU 4× | lạnh | 3742 → 3690 | 138 → 132 | 411 → 378 |
| desktop 1440 | chậm + CPU 4× | ấm | 970 → 999 | 116 → 110 | 203 → 201 |
| điện thoại 390 | cục bộ | lạnh | 1226 → 1253 | 101 → 105 | 9 → 5 |
| điện thoại 390 | chậm + CPU 4× | lạnh | 3570 → 3714 | 138 → 140 | 326 → 392 |
| điện thoại 390 | chậm + CPU 4× | ấm | 904 → 971 | 110 → 109 | 166 → 165 |

- Long task dài nhất không tăng, vì che khuất có bước dựng riêng.
- Khung đầu chậm hơn tới khoảng 70 ms khi CPU chậm 4×: bước dựng che khuất (~9 ms, ×4) và một chương
  trình shader thêm. Ở các trường hợp còn lại, chênh nằm trong nhiễu (có trường hợp nhanh hơn).

#### Bộ nhớ và ảnh

- Texture: 14 → 15, +0,31 MiB (43,56 → 43,87 MiB ở bậc cao).
- Draw call như cũ (39–40 khi tour).
- Ảnh cùng camera của bộ đo (tổng quan, ghế, màn chiếu, kính Xem phim, giữa lúc kéo; desktop và điện
  thoại; hai bậc): lệch trung bình khoảng 1/255, gần 0% điểm lệch quá 8/255. Thay đổi chỉ nằm ở chỗ
  tiếp xúc, không đổi tổng thể.

## Ảnh so sánh

Thư mục `artifacts/visual-final/before-after/` (không commit):
- `before-high/`, `after-high/`, `before-economy/`, `after-economy/`: 35 góc, cùng camera, 1440×900,
  DPR 1, kèm `stats.json` (độ sáng, điểm gần đen, điểm cháy).
- `compare-high.png`, `compare-economy.png`: tổng quan, sát ghế, ghế giữa phòng, lối đi và bậc,
  góc trần–tường, màn chiếu và rèm, tường sau, chân ghế ở tầm thấp; trước bên trái, sau bên phải.
- `compare-tour.png`: khung dọc tour và hai góc đi bộ (trước cao, sau cao, sau Tiết kiệm).
- `compare-detail.png`: cận chân ghế, chân bậc, mép rèm, cửa thoát hiểm.

Số đo ảnh (bậc cao; Tiết kiệm tương tự):

| Góc | Độ sáng trung bình trước → sau | Điểm gần đen trước → sau |
|---|---|---|
| Tổng quan từ cuối phòng | 37,5 → 37,4 | 7,4% → 8,4% |
| Ghế hàng E, giữa | 68,6 → 68,6 | 4,6% → 5,0% |
| Chân ghế, tầm thấp | 14,0 → 13,1 | 33,5% → 35,8% |
| Bậc lối đi, cận | 31,3 → 30,7 | 0,4% → 2,9% |
| Góc trần–tường | 24,3 → 24,1 | 21,2% → 22,7% |
| Màn chiếu, cận | 187,0 → 187,0 | 0% → 0% |
| Tường sau | 23,2 → 22,7 | 3,5% → 4,0% |

- Không góc nào có điểm cháy trắng, trước cũng như sau.
- Độ sáng chung gần như giữ nguyên; phần tối thêm nằm đúng ở chân ghế, chân bậc và chân tường.
- Màn chiếu giữ nguyên từng giá trị.

Ở cả hai bậc đã xem: ghế giữ màu đỏ; bóng ghế bám chân; rèm có độ sâu giữa các nếp; không có acne,
bóng tách khỏi vật hay quầng tối dày. Tiết kiệm (bóng 1024, ghế thô) vẫn có tiếp xúc ở chân ghế và
chân bậc.

## Kiểm thử

Trên nhánh `visual/final-polish`, cây code cuối:
- `yarn typecheck`.
- `yarn test`: 224/224. Mới: `bakedOcclusion.test.ts`, kiểm tra:
  - texture một kênh, tuyến tính, đọc qua `uv1`;
  - tối dưới mọi ghế, không đụng sàn trống;
  - chân bậc, chân tường, chân bệ tối nhẹ;
  - `uv1` khớp toạ độ mặt bằng;
  - khe nếp rèm tối hơn đỉnh.

  Một lần chạy đầu báo 14 file lỗi khi khởi động worker mà không chạy test nào. Ba lần chạy lại đều
  224/224.
- `yarn build`.
- `yarn capture`: 552/552, không có cảnh báo hay lỗi console ngoài dự kiến. Gồm:
  - bóng không vẽ lại khi camera di chuyển, có vẽ lại khi ẩn trần/tường;
  - đổi bậc giữ camera, không rò geometry/texture/shader;
  - mất/khôi phục context giữ Tiết kiệm và phần đang ẩn, vẽ lại bóng;
  - chọn ghế, phim, tour, đi bộ.

  Lần chạy đầu bị bỏ: trong lúc chạy, việc giải nén mã nguồn bản trước (có file HTML) vào `artifacts/`
  làm Vite tải lại trang giữa chừng. Lỗi đó do thao tác đo, không phải do code. Lần chạy lại sạch.
- `yarn measure:build`: 23/23.
- `yarn acceptance`: 17/17, gồm đổi sang Tiết kiệm, mất/khôi phục context, rời phòng khi phim đang
  chạy không giữ lại video/canvas/context.

## Chưa xác minh

- **Màn hình thật:** ảnh chỉ xem trên máy đo. Màn hình có độ sáng hay gamma khác có thể làm vùng tối
  (chân ghế, trần) tối hơn hay sáng hơn.
- **Thiết bị thật, Safari, Firefox, GPU khác:** như trong [performance.md](performance.md).
- **Không bake toàn bộ ánh sáng:** đèn area và đèn rọi vẫn không đổ bóng. Che khuất nướng sẵn chỉ
  bù cho sàn và rèm. Mặt dưới tay vịn, bên trong ghế và chân tường đứng không có che khuất riêng.
- **Rà bằng mắt có giới hạn:** 35 góc cố định, tour và các phần ẩn/hiện, ở hai bậc. Không phải mọi
  bề mặt từ mọi góc.
