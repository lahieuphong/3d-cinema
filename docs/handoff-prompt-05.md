# Bàn giao Prompt 05: camera, tham quan và khám phá

Trạng thái: hoàn thành, chờ duyệt (27/10/2026). Chưa commit, push hay deploy. Không nâng dependency nào (Vite 8.3.5, TypeScript 6.0.3, three 0.186.1, Vitest 5.0.5, playwright-core 1.64.1). Nền: commit `ce8d7f7` (Prompt 04), working tree sạch khi bắt đầu.

## Baseline

- Đã chụp baseline bằng harness với code Prompt 04, chưa sửa gì: `artifacts/prompt-05/baseline/`, 106/106 check pass.
- Ảnh trước/sau cùng tên file: `compare-p04-p05-*.png` (desktop, tablet, mobile).
- Hợp đồng giữ nguyên:
  - 110 ghế A01–J11 và `SeatData`; pivot, hướng ghế, ánh xạ instance → ghế.
  - Kiến trúc, màn chiếu, bề rộng lối đi.
  - Vật liệu, tone mapping, ánh sáng.
  - Hai mức Cao/Tiết kiệm và lựa chọn đã lưu.
  - Inspector ghế.
- Không di chuyển ghế, màn hay tường. Không đổi chất lượng hoặc ẩn nội thất để tour mượt hơn.

## Giao diện

| Nhóm | Nội dung |
| --- | --- |
| Góc nhìn | Tổng quan · Nhìn về ghế · Ghế F06 |
| Trải nghiệm | Tham quan (khi đang chạy đổi thành "Dừng tham quan") · Khám phá · Về góc ban đầu |
| Chất lượng | Cao · Tiết kiệm · nút **Kiểm tra** (bung một hàng riêng) |
| Kiểm tra (gập mặc định) | Mặt cắt bên · Mặt bằng · Kiểm tra ghế (mở inspector) · công tắc Trần / Vách sau / Vách phải |

- Trên khung 3D có:
  - caption;
  - thanh tour: tên điểm dừng và nút Dừng; khi giảm chuyển động thì có Trước / Tiếp / Thoát;
  - cần điều khiển khi khám phá trên thiết bị cảm ứng.
- Trên mobile dọc, thanh công cụ còn 3 hàng (trước đây 4), canvas chiếm khoảng 72 % chiều cao màn hình.

## Trạng thái camera và quyền ghi

`CinemaView.cameraState()` được phản chiếu ra `data-camera` trên phần tử gốc.

| Trạng thái | Ý nghĩa | Ai ghi camera |
| --- | --- | --- |
| `preset` | Đang ở một góc trải nghiệm hoặc xoay quanh từ đó | OrbitControls, bị giới hạn trong phòng |
| `inspection` | Mặt cắt bên, mặt bằng: xoay tự do, được ra ngoài phòng | OrbitControls, không giới hạn |
| `transition` | Đang chuyển tới preset, tới điểm đầu tour hoặc điểm bắt đầu khám phá | Transition của `CameraRig` |
| `tour` | Tour đang chạy, hoặc đang ở một điểm dừng (khi giảm chuyển động) | Driver tour, hoặc không ai nếu đứng ở điểm dừng |
| `explore` | Đang đi bộ | Driver walker |
| `free` | Đứng tại chỗ sau khi dừng tour hoặc dừng khám phá; kéo để nhìn quanh | OrbitControls, chế độ mắt |

- `CameraRig.owner` luôn là đúng một trong `controls | transition | driver`. OrbitControls chỉ bật khi owner là `controls`, nên không thể kéo camera về target cũ.
- Lệnh mới (preset, tour, khám phá, reset) luôn bắt đầu từ camera hiện tại và thay hẳn lệnh cũ, không xếp hàng.
- Khi nhả quyền khỏi OrbitControls, quán tính còn dư bị xóa.
- Harness kiểm tra: trong suốt tour, khi tour hoặc transition đang ghi thì `controlsEnabled` luôn là false.

## Framing và FOV

**FOV** (`fovForAspect`): dọc 50°. Màn dọc nới tới tối đa 65° để giữ ngang ≥ 42°. Màn rất ngang thu lại để ngang ≤ 90°.

| Màn hình | Aspect canvas | FOV dọc / ngang |
| --- | --- | --- |
| Desktop 1440 × 900 | 1,78–1,90 | 50° / 79–81° |
| Tablet dọc 820 × 1180 | 0,77–0,81 | 51–53° / 42° |
| Mobile dọc 390 × 844 | 0,56–0,65 | 61–65° / 42° |
| Mobile ngang 844 × 390 | 2,6–2,9 | 38–43° / 90° |

- Near 0,05 m: khi khám phá, mắt luôn cách vật ít nhất 0,25 m nên không bị cắt. Far 80 m, đủ cho các góc kiểm tra từ ngoài phòng.
- Khi resize hoặc xoay máy:
  - nếu người dùng chưa xoay khỏi preset, preset được đóng khung lại ngay;
  - camera tự do, tour và khám phá giữ nguyên vị trí và hướng, chỉ đổi FOV.

| Preset | Ngang (aspect ≥ 1) | Dọc |
| --- | --- | --- |
| Tổng quan | Trên sàn sau (0; 4,42; 8,40), nhìn về màn. Pitch tính sao cho mép trên khung màn cách mép trên khung hình 12 % FOV | Từ trên lối đi phải (4,90; 4,42; 8,40), vẫn nhắm tâm màn. Khung hẹp thấy màn, các hàng ghế và một lối đi chạy tới trước |
| Nhìn về ghế | Như cũ: trước màn, cao (0; 4,90; −7,70) | Nhìn chéo từ góc trước phải (5,10; 5,10; −7,10) về phía sau trái; hàng ghế chạy xéo khung hình. Test: thấy ≥ 50 % số ghế |
| Ghế F06 | `seatViewPose` | Như bên ngang |
| Mặt cắt bên (kiểm tra) | Ngoài vách phải, vách tạm ẩn | Như bên ngang |
| Mặt bằng (kiểm tra, mới) | Nhìn từ trên, trần tạm ẩn; màn ở bên trái | Màn ở phía trên |

- Các bộ phận do preset kiểm tra ẩn chỉ hiện lại sau khi camera đã tới góc mới, nên camera không bay xuyên vách vừa hiện lại.
- Khi xoay ở góc trải nghiệm, camera bị giữ trong phòng: cách vách, trần, sàn 0,3 m, cao hơn lưng ghế và bục.

## Chuyển camera

- Đường đi do `planCameraPath` chọn:
  - đường thẳng nếu mọi điểm cách 5 cm dọc đường đều cách vật cản ≥ 0,15 m;
  - nếu không, nhấc lên cao hơn vật cao nhất 1 m, đi ngang, rồi hạ xuống (ví dụ từ ghế F06 ra lối đi);
  - nếu vẫn không có đường hợp lệ thì cắt thẳng tới góc mới, không bay xuyên vật.
- Hướng nhìn được nội suy theo yaw (đường ngắn) và pitch, không bao giờ roll; easing cubic.
- Thời lượng 0,63–1,8 s, tùy quãng đường và góc quay.
- Thời gian tính theo delta giữa hai khung, chặn tối đa 0,1 s, nên quay lại tab không làm camera nhảy.

## Tour (`tour.ts`)

Khoảng 29,9 s, cộng khoảng 0,6 s di chuyển tới điểm đầu; không lặp, không tự chạy khi mở trang. Có 6 điểm dừng; 5 điểm đầu giữ 0,8–1,8 s, điểm cuối là chính góc tổng quan:

1. Tổng quan.
2. Trên hàng B, nhìn màn, rèm và bục.
3. Phía trước bên phải: rèm, loa trước, cửa thoát.
4. Chân lối đi phải. Chặng tới đây quay khoảng 177°, ép quay qua phía trong phòng chứ không sát vách. Nhìn lại các hàng ghế.
5. Đi lên lối đi phải theo đường mũi bậc, mắt ở độ cao đứng, nhìn ngang qua các đầu hàng.
6. Về tổng quan.

- Vận tốc là hình thang (tăng tốc và giảm tốc mỗi đầu 30 %): đỉnh khoảng 1,43 lần vận tốc trung bình, dưới 3,5 m/s; quay dưới 60°/s.
- Test lấy mẫu mỗi 0,02 s trên toàn tour, mọi điểm đều cách vật cản ≥ 0,15 m. Harness lấy mẫu lần chạy thật: không roll, đi đủ các điểm theo thứ tự.
- **Dừng ngay**, camera giữ nguyên chỗ, không trôi, tour không tự chạy lại, khi:
  - kéo hoặc cuộn trên canvas;
  - nhấn phím di chuyển;
  - chạm và kéo trên canvas;
  - bấm nút Dừng, chọn preset, reset, hoặc bắt đầu khám phá;
  - mở inspector;
  - tab bị ẩn;
  - mất context.
- Đổi chất lượng giữa chừng không dừng tour.
- Mất context hoặc ẩn tab: **quy tắc là dừng hẳn**, không pause, để khi quay lại không có gì tự chạy. Caption báo lý do.

## Khám phá

**Desktop:**
- WASD hoặc phím mũi tên để đi, theo `event.code` nên mọi bố cục bàn phím đều dùng được.
- Kéo để nhìn quanh, không cần pointer lock. Pitch giới hạn ±60°, không roll.
- Bấm Khám phá lần nữa để dừng tại chỗ. "Về góc ban đầu" luôn dùng được.

**Cảm ứng** (khi `(any-pointer: coarse)`):
- Cần điều khiển 124 px ở góc dưới trái, tránh safe area, có vùng chết 15 %.
- Kéo phần còn lại của canvas để nhìn.
- Mỗi pointer thuộc về đúng một vai: một ngón trên cần và một ngón nhìn hoạt động cùng lúc. Đã thử bằng sự kiện cảm ứng thật qua CDP.
- Không chiếm cử chỉ ngoài canvas và cần điều khiển.

**Quản lý input:**
- Bỏ qua phím khi focus đang ở ô nhập, select, nội dung sửa được, widget dùng phím mũi tên, hoặc có Ctrl/Alt/Meta.
- Blur, tab ẩn, pointercancel, lostpointercapture, tắt chế độ khám phá hay mất context đều xóa mọi phím và pointer đang giữ.
- Tốc độ 1,4 m/s nhân delta; delta bị chặn 0,1 s.

**Điểm bắt đầu:**
- Nếu một người đứng vừa ngay dưới camera (từ góc tổng quan thì đúng là vậy), camera hạ xuống tầm mắt đứng tại chỗ.
- Nếu không (đang ở ghế F06, hay giữa không trung trên các hàng ghế), camera đi tới điểm gần nhất trong 4 điểm: lối đi phải, lối đi trái, sàn sau, khu trước màn. Đường đi do `planCameraPath` chọn và nhìn thấy được; caption ghi "Đã đưa bạn tới …".

## Va chạm (`collision.ts`, `walker.ts`)

- **Collider** đều là hộp lấy từ dữ liệu layout, không raycast tam giác:
  - 10 hộp hàng ghế, phủ footprint, cao 1,15 m (ghế thật cao 1,09 m ở cả hai mức);
  - bục;
  - 2 rèm.
- **Vách, trần, cửa đóng:** hộp phòng tính tới mặt hoàn thiện. Tay vịn nằm sau mặt panel nên vách đã chặn. Loa và biển thoát cao hơn đầu ở mọi chỗ đứng được (có test).
- **Thân người:** trụ bán kính 0,25 m, mắt 1,6 m, đầu 1,8 m.
- **Bậc:** bước tối đa 0,25 m, nên lên bậc lối đi 0,18 m được, lên bục 0,5 m thì không. Mắt dịu theo bậc với hằng số thời gian 0,12 s và dừng khi lệch dưới 1 mm.
- **Chống xuyên:** mỗi bước di chuyển chia nhỏ ≤ 0,125 m (nửa bán kính), đẩy ra khỏi hộp, kẹp trong vách, từ chối bậc quá cao, rồi trượt theo từng trục. Có test cho một bước 20 m, cho delta 30 s, đi chéo, và giảm tốc CPU 6× trên trình duyệt.
- **Chế độ kiểm tra:** ẩn trần hay vách chỉ ảnh hưởng hình ảnh, không ảnh hưởng va chạm khi khám phá. Ở góc kiểm tra, camera xoay tự do và được ra ngoài phòng.

## Helper xem từ ghế (`seatView.ts`)

- `seatViewPose(layout, seat)`:
  - mắt ở `viewer.eyeHeight` 1,15 m trên sàn của ghế, lùi 0,15 m về phía tựa lưng, xoay theo yaw của ghế;
  - nhìn vào tâm màn, chế độ mắt.
- Đang dùng cho F06. Test ở A01, A06, A11, F06, J01, J06, J11, cả hai mức hình học: mắt không nằm trong đệm, tựa lưng hay đệm đầu, cao hơn đệm ngồi ít nhất 0,5 m.
- **Hạn chế hàng A:** cách màn 5,8 m, góc ngước tới mép trên ảnh 38,6° (thoải mái khoảng ≤ 30–35°).
  - Trên desktop, từ A01 và A11 không thấy trọn một góc màn trong một khung.
  - Trên màn dọc, cả hàng A đều phải quay đầu.
  - Các hàng khác thấy trọn màn.
  - Ảnh: `seat-view-*.png`.

## Giảm chuyển động

- Theo dõi `prefers-reduced-motion`, kể cả khi thay đổi lúc đang chạy.
- Preset chuyển thẳng, không có khung trung gian.
- Tour thành các điểm dừng tĩnh với Trước / Tiếp / Thoát; tới điểm cuối thì Kết thúc về tổng quan.
- Bật giảm chuyển động khi tour đang chạy: chuyển sang chế độ điểm dừng ngay tại điểm hiện tại.
- Mắt khi khám phá không dịu theo bậc nữa.

## Render và vòng đời

- Chỉ render khi có transition, damping của OrbitControls, tour, input khám phá đang giữ, mắt đang dịu theo bậc, hoặc cảnh thay đổi.
- Sau đó dừng hẳn. Khung đầu tiên sau khi nghỉ có delta = 0.
- Đã kiểm tra không có khung mới sau: hết tour, đứng yên khi khám phá, thả ngón tay, đổi chất lượng, và trong inspector.
- **Mở inspector** (nút Kiểm tra ghế): trang phòng chiếu bị unmount hoàn toàn (tour, input, vòng render); chỉ còn một canvas.
- **Đóng inspector:** quay lại một phòng chiếu mới ở góc tổng quan, không tiếp tục tour cũ.

## Điều tra cảnh báo context của Prompt 04

**Tái hiện trên code Prompt 04** (`ctx-repro.mjs` trong scratchpad; ghi lại trong log phiên):

| Kịch bản sau khi khôi phục context | Cảnh báo `delete` / `deleteVertexArray: object does not belong to this context` |
| --- | --- |
| Đổi chất lượng | 34 |
| Bật/tắt trần | 0 |
| Unmount (mở inspector) | 187 |
| Inspector: đổi chất lượng | 34 |

**Nguyên nhân:**
- Khi khôi phục context, three r186 gọi `initGLContext()`, tạo mới các module WebGL bên trong (attributes, geometries, bindingStates, textures…).
- Geometry, texture và render target tạo trước khi mất context vẫn còn giữ listener `dispose` của module cũ.
- Ứng dụng tiếp tục dùng các đối tượng đó, nên khi chúng bị hủy, listener cũ xóa các handle của context đã chết.
- Ứng dụng tránh được việc này; không phải lỗi driver.

**Đã sửa ở phía ứng dụng:**
- `CinemaView` và inspector gom mọi tài nguyên GPU vào một `content`.
- Khi khôi phục, dựng lại `content` từ đầu: vật liệu, texture, hình học, ghế, đèn, shadow map, môi trường. Giữ nguyên trạng thái chất lượng, phần đang ẩn, cluster và overlay.
- Bản cũ chỉ bị bỏ đi, không gọi dispose: GPU object của nó đã chết theo context cũ, còn JS object được garbage collect.
- Thêm: `RenderHost` không xếp khung mới khi đang mất context; tour dừng và input bị xóa khi mất context.

**Sau khi sửa:** harness chạy lần lượt mất context khi đang tour, khi đang đi bộ, sau khi đổi chất lượng và ẩn trần, rồi đổi chất lượng và unmount sau khôi phục. Kết quả 0 cảnh báo; check console tổng sẽ báo lỗi nếu có bất kỳ cảnh báo nào.

**Cảnh báo X4122:** vẫn chỉ được xếp vào loại "đã biết" theo mẫu cụ thể `WebGLProgram: Program Info Log … warning X4122`. Lần chạy cuối gặp đúng 1 lần.

## Kiểm tra

- `npm test`: **119/119** (6 file). File mới `camera.test.ts` có 25 test:
  - collider phủ ghế ở cả hai mức;
  - đứng được ở đâu;
  - lên/xuống bậc;
  - không lên bục, không xuyên hàng ghế khi đi thẳng hay đi chéo;
  - bước lớn không xuyên;
  - trượt theo vách, đi chéo không nhanh hơn;
  - giới hạn pitch;
  - quy tắc điểm bắt đầu;
  - easing và nội suy hướng;
  - đường quanh ghế; mọi cặp góc trải nghiệm đều có đường;
  - tour: thời lượng, độ hở mọi điểm, tốc độ, độ cao mắt trên bậc;
  - helper ghế;
  - FOV;
  - preset nằm trong phòng; tổng quan thấy trọn màn và một lối đi;
  - mặt bằng thấy trọn phòng;
  - "Nhìn về ghế" thấy ≥ 95 % ghế (màn ngang) hoặc ≥ 50 % (màn dọc).
- `npm run typecheck`: sạch. `npm run build`: thành công.
  - JS chính 944,7 kB (gzip 291 kB), trước đây 916 / 281 kB.
  - Inspector 10,2 kB.
  - Vẫn có cảnh báo chunk > 500 kB.
- `npm run capture`: **203/203**, 0 cảnh báo console ngoài dự kiến. Chạy trên Chrome 156 headless, ANGLE D3D11, RTX 3090.
  - Thiết bị: desktop, tablet, mobile dọc, mobile ngang (mới).
  - Tour: đường đi, độ hở, roll, một bên ghi camera, 6 cách dừng, tab ẩn, đổi chất lượng giữa chừng.
  - Khám phá: điểm bắt đầu, va chạm, đi chéo khi CPU chậm 6×, ô nhập không nhận phím, blur, pointercancel, cầu thang, đổi chất lượng.
  - Cảm ứng: sự kiện thật qua CDP — dừng tour bằng ngón tay, cần điều khiển và ngón nhìn cùng lúc, touchcancel, xoay máy khi đang đi và khi ở preset.
  - Mở/đóng inspector từ trang; giảm chuyển động (từ đầu và bật giữa tour); mất context khi đang di chuyển; video.

**Phân biệt giả lập:**
- "Mobile/tablet" trong harness là Chrome giả lập (viewport, DPR, `hasTouch`, `isMobile`), cảm ứng gửi qua CDP `Input.dispatchTouchEvent`.
- Chưa thử trên điện thoại hay tablet thật, Safari iOS hay Firefox.
- Một cú vuốt tổng hợp không có thời gian giữa các sự kiện bị Chrome coi là fling và lấy mất lần chạm kế tiếp. Harness kéo theo nhịp tay người; hiện tượng này không xảy ra với thao tác thật.

## Ảnh, video và số đo (`artifacts/prompt-05/`)

- **Baseline và so sánh:** `baseline/`, `compare-p04-p05-*`.
- **Preset:** `{desktop,tablet,mobile,mobile-landscape}-{1-overview,2-seats,3-side,4-seat-eye,5-plan}`.
- **Mobile và xoay máy:** `mobile-explore-ui`, `mobile-landscape-explore`, `mobile-rotated-to-landscape-overview`.
- **Khám phá desktop:** `explore-1-desktop-start`, `explore-2-desktop-aisle`.
- **Ghế:** `seat-view-{A01,A06,F06,J06,J11}`.
- **Tour:** `tour-frames-contact-sheet` (20 khung cách nhau 1,5 s), `debug-tour-path-colliders` (collider và đường tour, chế độ dev).
- **Giảm chuyển động và inspection:** `reduced-motion-tour-steps`, `desktop-6-cutaway-orbit`.
- **Video WebM:**
  - `video-tour.webm` (30,8 s);
  - `video-tour-cancel.webm` (16,2 s: dừng bằng kéo, phím, chọn preset);
  - `video-mobile-explore.webm` (4,2 s, cần điều khiển).
  - Quay bằng CDP screencast có cả UI, mã hóa trong Chrome bằng MediaRecorder. Không dùng recorder của playwright-core vì cần tải thêm ffmpeg-1013, máy chỉ có ffmpeg-1011.

**Thời gian khung GPU** (EXT_disjoint_timer_query_webgl2, không gặp disjoint; CPU submit trung vị 0,1 ms, đúng bằng độ phân giải của timer):

| Đường đo | Mức | Buffer, DPR | GPU trung vị / p95 |
| --- | --- | --- | --- |
| Tour, 150 khung, lần 1 | Cao | 1398 × 734, 1 | 1,49 / 6,29 ms |
| Tour, lần 1 | Tiết kiệm | 1398 × 734, 1 | 0,61 / 0,83 ms |
| Tour, lần 2 | Cao | 1398 × 734, 1 | 0,74 / 1,02 ms |
| Tour, lần 2 | Tiết kiệm | 1398 × 734, 1 | 0,67 / 0,87 ms |
| Đường cố định P04 | Tiết kiệm, tablet | 981 × 1212, 1,25 | 0,85 / 4,40 ms |
| Đường cố định P04 | Cao, tablet | 1570 × 1940, 2 | 2,20 / 6,89 ms |

- Hai lần chạy cùng mức Cao chênh nhau gấp đôi (xung nhịp GPU và khởi động). Trên RTX 3090, khác biệt giữa hai mức nằm trong nhiễu; tour không làm việc nặng hơn các góc tĩnh.
- Các số này **không** suy ra được hiệu năng điện thoại.

## Hạn chế và việc còn mở

- **Hàng A:** góc ngước 38,6°. Từ hai đầu hàng (và cả hàng trên màn dọc) phải quay đầu mới thấy hết màn. Đây là đặc điểm của bố trí, không xử lý bằng cách dời ghế hay màn.
- **Mobile dọc, Tổng quan:** đặt lệch sang trên lối đi phải để thấy được lối đi, nên ảnh không đối xứng. Muốn thấy toàn mặt bằng thì dùng Mặt bằng trong Kiểm tra.
- **Cử chỉ:** chưa có chụm hai ngón để zoom khi khám phá (chỉ có cần điều khiển và kéo để nhìn). Ở góc trải nghiệm, OrbitControls vẫn hỗ trợ chụm và kéo hai ngón như trước.
- **Lần đầu bật/tắt trần hay vách phải** vẫn có thể giật nhẹ vì phải biên dịch biến thể shader (đã ghi ở Prompt 04).
- **Video** chỉ có hình, không có tiếng. Tốc độ khung của video theo nhịp vẽ thực tế của trang (render theo nhu cầu).

## File

- **Mới:**
  - `src/cinema/collision.ts`, `walker.ts`, `cameraPath.ts`, `tour.ts`, `seatView.ts`, `exploreInput.ts`
  - `src/cinema/camera.test.ts`
  - `docs/handoff-prompt-05.md`, `artifacts/prompt-05/`
- **Sửa:**
  - `cameraRig.ts` (quyền ghi, đường đi, yaw/pitch, delta), `cameraPresets.ts` (framing, Mặt bằng)
  - `view.ts` (trạng thái, tour, khám phá, `content` dựng lại khi khôi phục), `seatInspector.ts` (như trên)
  - `renderHost.ts` (delta, chặn khung khi mất context), `frameProbe.ts` (đo theo đường tour)
  - `config.ts` (`camera`), `ui.ts`, `page.ts`, `main.ts`, `styles.css`
  - `scripts/capture-views.mjs`

**Lệnh:** `npm test`, `npm run typecheck`, `npm run build`, `npm run capture` (ghi ra `artifacts/prompt-05/`; đo baseline bằng `CAPTURE_DIR=prompt-05/baseline`).
