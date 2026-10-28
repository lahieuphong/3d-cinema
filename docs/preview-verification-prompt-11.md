# Xác minh bản preview — Prompt 11

Ngày 28/10/2026. Bản preview được deploy và kiểm chứng trên Vercel thật. **Chưa promote, chưa merge vào
`main`, production không đổi.**

Liên quan: [release-audit-prompt-10.md](release-audit-prompt-10.md),
[preview-deployment-plan.md](preview-deployment-plan.md), [release-checklist.md](release-checklist.md).

## 1. Nhánh và commit

| | |
| --- | --- |
| Nhánh | `preview/p10-release-audit` (mới; trên remote trước đó chỉ có `main`) |
| Base | `origin/main` = `192318f` |

`192318f` do người dùng commit và push sau Prompt 10. Nó chứa đúng các thay đổi của Prompt 10 và đã lên
production lúc 07:04Z. Base này đã gồm bản sửa rewrite. Không reset, không force push, không dùng
`git add .`.

| Commit | Phạm vi |
| --- | --- |
| `1ef002f` chore(repo): stop tracking generated QA artifacts | Gỡ `artifacts/` khỏi index (1500 tệp, 881,4 MB, Prompt 01–09); sửa chú thích `.gitignore` |
| `dc759bf` fix(hosting): return 404 for missing assets on Vercel | `vercel.json` chuyển sang `routes`; `measure-build.mjs` và phần hosting của `acceptance.mjs` |
| `42f5dff` test(acceptance): pick a seat in 3D and toggle sound; bypass by header | Chỉ `scripts/acceptance.mjs` |
| commit tài liệu này | `docs/` |

**Bản đã kiểm chứng đầy đủ là `dc759bf`.**
- `42f5dff` và commit tài liệu không đổi gì trong `src/`, `public/`, HTML hay `vercel.json`.
- Sau khi push, chúng có deployment preview riêng. Phản hồi cuối của Prompt 11 ghi deployment đó và kết
  quả kiểm tra hosting lại trên nó.

**Bỏ theo dõi `artifacts/`:**
- Trước: 1500 tệp được theo dõi, 924 239 500 byte (881,4 MB).
- Trên đĩa trước và sau: **1806 tệp** (gồm log và ảnh Prompt 10–11 vốn không được theo dõi), không mất tệp
  nào.
- Không có đầu vào build/runtime nào nằm trong `artifacts/`:
  - `src/`, HTML, `vite.config.ts`, `vercel.json`, `package.json` không tham chiếu tới;
  - chỉ `capture-views`, `measure-build`, `acceptance` ghi kết quả vào đó (và `capture-views` đọc
    `baseline/` nếu có).
- Sau khi gỡ: `npm test` 180/180, `npm run build` thành công.
- **Commit này không làm giảm dung lượng lịch sử**: các tệp vẫn nằm trong những commit cũ. Không viết lại
  lịch sử, không dùng Git LFS.

## 2. Vercel: đã đọc qua API (Vercel CLI 62.2.0 có sẵn và đã đăng nhập trên máy)

Chạy từ thư mục scratch; không `vercel link`, không in token.

| Mục | Giá trị |
| --- | --- |
| Project | `tp3d-cinema`, ID `prj_pZtZMtkxGwLxsf995lvjAZr2R8NH`, team `la-hieu-phongs-projects` (`team_hFCrAVLz4P4a61cyEBOSf0pZ`) |
| Git | GitHub `lahieuphong/3d-cinema`; `createDeployments: disabled` nên không có GitHub Deployments, chỉ có commit status |
| Production Branch | **`main`** → nhánh preview là môi trường Preview |
| Preset | Vite, output `dist`, Node 24.x |
| Deployment Protection | Vercel Authentication `all_except_custom_domains`: URL preview cần đăng nhập (302 → `vercel.com/sso-api`) |
| Protection Bypass for Automation | Trước Prompt 11: **không có** |

**Secret bypass tạm thời** (người dùng đồng ý trong Prompt 11):
- Tạo bằng `vercel project protection enable tp3d-cinema --protection-bypass`, output bỏ đi.
- Script đọc secret từ API vào biến của tiến trình; không in, không ghi. Đã quét log và report: 0 tệp chứa
  secret.
- Deployment Protection không bị tắt lúc nào.
- **Thu hồi** sau lượt kiểm tra cuối (kết quả ở phản hồi cuối Prompt 11).
- Không dùng `vercel curl`: theo mã CLI 62.2.0, lệnh này tự tạo secret nếu chưa có.

## 3. Deployment preview đã kiểm chứng

| | |
| --- | --- |
| Deployment | `dpl_HPxnF8b92SQ4GJ7EK3DT4TgXkXVF` |
| URL | `https://tp3d-cinema-8yxqz3po8-la-hieu-phongs-projects.vercel.app` |
| Alias nhánh | `tp3d-cinema-git-preview-p10-rele-fba1b2-la-hieu-phongs-projects.vercel.app` |
| Nguồn | `source: git`, `gitSource.ref = preview/p10-release-audit`, `gitSource.sha = dc759bf245f42740fc980c9d6757fe91d34fdbb8` |
| Môi trường | `target: null` (Preview), `READY` (07:24:31Z → 07:25:28Z) |
| Commit status GitHub | `Vercel — success — Deployment has completed` (07:25:29Z) |
| `X-Robots-Tag` | `noindex` |
| Production sau khi push | vẫn `dpl_NpH96Mgh7xK14NLe7T7r1rxfHSxt` @ `192318f`; không có deployment production mới |

Bằng chứng nguồn build là `gitSource.sha` và commit status của đúng SHA. Tên chunk có hash trùng
`dist/` cục bộ, nhưng đó không phải bằng chứng commit, vì bản sửa nằm ở cấu hình.

## 4. Kiểm tra hosting trên preview

`BASE_URL=<URL ở trên> ACCEPTANCE_ONLY=hosting node scripts/acceptance.mjs`, kèm header bypass. Kết quả:
**8/8** (7 check hosting + console sạch).

| Kiểm tra | Kết quả |
| --- | --- |
| `/`, `/?utm_source=test` | 200, landing HTML, `no-cache` |
| `/cinema`, `/cinema/`, `/cinema?inspect=seat` | 200, `cinema.html`, `no-cache` (mở trực tiếp, tức như refresh) |
| `/khong-co-trang-nay` | 200, landing HTML; app hiện "Không tìm thấy trang" (soft 404, như trước) |
| Metadata | canonical `/` và `/cinema` trên `https://tp3d-cinema.vercel.app`, khớp `og:url` |
| `/assets/main-*.js` | `application/javascript`, `public, max-age=31536000, immutable` |
| `/brand/hero-960.webp`, poster | `image/webp`, `image/jpeg`; `public, max-age=0, must-revalidate` |
| Video | `206`, `video/mp4`; `bytes 0-1023/8347668` và tua `bytes 8000000-8000999/8347668` |
| Tệp thiếu, tên duy nhất mỗi lượt: `/assets/<x>.js`, `/brand/<x>.webp`, `/media/<x>.mp4`, `/<x>-favicon.ico` | **404** cho GET, HEAD và GET lặp lại; `text/plain`, không phải landing |
| Header của các 404 đó | `/assets`, `/brand`, `/media`: `public, max-age=0, must-revalidate`; favicon: `no-cache`. **Không có `immutable` hay `max-age` dài** |
| Chunk thật của Prompt 08 (`/assets/view-BXJOnfVJ.js`) | 404, `public, max-age=0, must-revalidate` |
| Cùng bản build với `dist/` | đạt |

**So với production `192318f`** (cùng script, cùng ngày): 7/8.
- Mọi tệp thiếu đã trả 404.
- Nhưng 404 dưới `/assets/` vẫn mang `public, max-age=31536000, immutable`. Nguyên nhân: rule `headers` được
  `vercel build` biên dịch thành route đứng trước `{"handle":"filesystem"}`.
- `dc759bf` đặt `immutable` trong phase `hit` của `routes`, nên chỉ áp cho tệp có thật.
- `vercel build` cục bộ (bản sao trong scratch) cho thấy Vercel giữ nguyên các phase này và không báo
  deprecated.

## 5. Nghiệm thu trên preview

`BASE_URL=<URL ở trên> node scripts/acceptance.mjs`: Chrome 156.0.8078.47 headless, profile tạm của
Playwright, kèm header bypass. Kết quả: **24/24** (7 hosting + 16 check của 15 luồng + console sạch).

| Luồng | Nội dung |
| --- | --- |
| A | Landing (không tải mã rạp hay video) → "Bước vào rạp" (1 mục history) → chọn F06 trên sơ đồ → nhìn từ ghế → Phát/Tạm dừng → Trở về |
| O | Chọn ghế bằng click trong 3D (F06, lần thử đầu) → hiện trên sơ đồ; tắt rồi bật tiếng khi phim đang phát |
| B | Tour → dừng → Đi bộ → mở sơ đồ |
| C | Điện thoại *giả lập* dọc → ngang: một canvas, không cuộn ngang |
| D | Sơ đồ toàn màn hình (modal) → Escape → focus về "Mở sơ đồ" |
| E, F | Chất lượng Tiết kiệm; mất/khôi phục WebGL giữ ghế và chất lượng |
| G | Inspector → Back |
| H | Rời rạp khi phim đang phát: 0 video, canvas, WebGL sau GC |
| I | 4 vòng Back/Forward: phim không tự phát, heap +0,32 MiB |
| J | Giảm chuyển động |
| K | Landing không JavaScript |
| L | Không WebGL: sơ đồ + video 2D |
| M | Video lỗi 404 (chặn trong trình duyệt): "Thử lại", Phát bị khoá |
| N | Mã rạp tải lỗi (chặn trong trình duyệt) → "Thử lại" mở được rạp |

Ảnh, report và log ở `artifacts/prompt-11/` (ngoài Git).

## 6. Production và cache cũ ở trình duyệt

**Production đang chạy `192318f`** (`dpl_NpH96…`):
- tệp thiếu đã trả 404 (không còn landing 200);
- 404 dưới `/assets/` còn `immutable`. Bản sửa chỉ có trên preview.
- Đưa lên production cần yêu cầu riêng (Prompt 12).

**Client có thể đã cache sai:**
- Tên chunk của Prompt 09, 10 và preview này trùng nhau: `main-D_k_CDc0.js`, `page-UxLl9iyQ.js`,
  `view-…`.
- Các chunk lazy của Prompt 08 (`view-BXJOnfVJ.js`, `seats-DE3FvkGO.js`, `seatInspector-gQ10ELE9.js`,
  `index-DxnZCBXk.js`, `index-DQe-JNBH.css`) không còn trong bản nào sau đó.
- Một tab mở từ bản Prompt 08 rồi mới tải chunk lazy:
  - sau 06:12Z (lúc `f55ef30` lên production): nhận **landing HTML 200 kèm `immutable`**;
  - sau 07:04Z (`192318f`): nhận **404 kèm `immutable`**.
  - Trình duyệt có thể giữ phản hồi đó dưới URL chunk cũ tới một năm.
- Bản sửa hosting **không xoá** được cache đã có ở trình duyệt. Không thể nói mọi tab cũ sẽ tự hồi phục.
- Ảnh hưởng thực tế: tab cũ báo "Không tải được phần 3D". "Thử lại" vẫn lấy từ cache nên vẫn lỗi. **Tải lại
  trang** thì lấy HTML mới (`no-cache`), dùng tên chunk mới và chạy bình thường.
  - Không có tên chunk nào đang dùng bị ảnh hưởng: chúng tồn tại liên tục từ `f55ef30`.

**Phương án cho bước production:**
1. Promote đúng ứng viên đã kiểm chứng. Tên chunk không đổi, nên không có tab đang mở nào bị mất chunk.
2. **Không rollback về bản Prompt 08** (`dpl_69Ac…`, `368d8f4`): trình duyệt có thể đã cache HTML hoặc 404
   dưới chính các URL chunk của bản đó.
   - Bản rollback an toàn, cùng tên chunk: `dpl_NpH96…` (`192318f`) hoặc `dpl_FVoxAkbu…` (`f55ef30`).
3. Nếu có người dùng bị kẹt: hướng dẫn tải lại trang. Nếu vẫn lỗi: xoá dữ liệu trang của
   `tp3d-cinema.vercel.app`.
4. Chỉ cân nhắc biện pháp phía server khi tái hiện được trên một trình duyệt cụ thể, ví dụ đổi tên chunk
   bằng một build mới, hoặc header `Clear-Site-Data: "cache"` tạm trên HTML. Không purge, không đổi production
   trong lượt này.

## 7. Giới hạn và việc cần thử tay

- Mobile mới là **giả lập** (viewport, touch, DPR); chưa có thiết bị thật.
- Safari/iOS, Firefox, trình đọc màn hình thật: **chưa thử**.
- Âm thanh: luồng O chỉ kiểm tra trạng thái mute/unmute. **Chưa nghe bằng tai.**
- Ảnh chia sẻ trên mạng xã hội: chưa thử. Bản preview có `noindex` và cần đăng nhập, nên phải thử trên
  production.
- Luồng M và N gây lỗi bằng cách chặn request trong trình duyệt, không phải lỗi thật từ server.
- Chỉ chạy Chrome trên preview. Edge đạt trên bản build cục bộ ở Prompt 10, chưa chạy với preview.

**Thử tay trên preview** (mở URL ở mục 3 khi đã đăng nhập Vercel):
1. iPhone (Safari) và Android (Chrome), dọc và ngang:
   - landing → "Bước vào rạp" → chọn ghế → "Xem từ ghế này" → Phát;
   - nghe tiếng, tắt/bật tiếng, âm lượng;
   - về trang chủ khi đang phát: tiếng phải tắt hẳn.
2. Refresh `/cinema` và `/cinema/`; Back/Forward.
3. Xác nhận hoặc đổi tên "Tân Phong Cinema" (vẫn là tên làm việc).

## 8. Production còn cần

- Người dùng duyệt preview: hình ảnh, tên, luồng, âm thanh, thiết bị thật.
- Khi có yêu cầu rõ ràng: đưa `dc759bf` (hoặc commit tài liệu sau nó, cùng bản build) lên `main` hoặc
  promote. Sau đó chạy lại kiểm tra hosting và luồng chính trên `https://tp3d-cinema.vercel.app`.
- Giữ bản rollback đã biết tốt: `dpl_NpH96…` / `dpl_FVoxAkbu…`.
