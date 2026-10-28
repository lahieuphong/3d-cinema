# Phát hành production — Prompt 12

Ngày 28/10/2026. Kết luận: **production chạy đúng ứng viên đã kiểm chứng; không cần rollback.**

> Tệp này **chưa được commit**: commit vào `main` sẽ kích hoạt thêm một deployment production. Các kiểm tra
> dưới đây áp dụng cho commit `52809eeaf759ac9713db0951e7c6dbc2d7ddbe8c`.

## 1. Repo, nhánh, commit

| | |
| --- | --- |
| Repo | `github.com/lahieuphong/3d-cinema` |
| Vercel | project `tp3d-cinema` (`prj_pZtZMtkxGwLxsf995lvjAZr2R8NH`), team `la-hieu-phongs-projects` (gói Hobby) |
| Production Branch | `main` (đọc qua Vercel API) |
| Nhánh bảo vệ | `main` không có branch protection hay ruleset (GitHub API) |
| Production trước | `192318f1907733720f1b339b809225c0beb38675` (Prompt 10) |
| Ứng viên preview | `52809eeaf759ac9713db0951e7c6dbc2d7ddbe8c`, đầu nhánh `preview/p10-release-audit` |
| Production sau | `52809eeaf759ac9713db0951e7c6dbc2d7ddbe8c`: cùng commit với ứng viên, không có merge commit |

**Cách `main` tới ứng viên.**
- Khi Prompt 12 bắt đầu, `main` và `origin/main` đã ở `52809ee`.
- Reflog: `fetch . preview/p10-release-audit:main: fast-forward` lúc 14:52:50 +07, rồi push.
- Không phải do phiên làm việc của Prompt 12. Tôi không merge hay push lại.

**Phạm vi phát hành** (`192318f..52809ee`):

| Commit | Nội dung |
| --- | --- |
| `1ef002f` | Ngừng theo dõi `artifacts/`: 1500 tệp xoá khỏi index, `.gitignore` |
| `dc759bf` | `vercel.json` dạng `routes`, `immutable` chỉ ở phase `hit`; `scripts/measure-build.mjs`; `scripts/acceptance.mjs` |
| `42f5dff` | `scripts/acceptance.mjs` |
| `52809ee` | `docs/` |

Không đổi `src/`, `public/`, HTML, `vite.config.ts` hay dependency. Tên "Tân Phong Cinema" giữ nguyên.

## 2. Deployment

| | Production (sau phát hành) | Preview của cùng commit |
| --- | --- | --- |
| ID | `dpl_2FS8fuhnhX3qgzBJ8Qse6NdUkD2z` | `dpl_E2F9VwhonQ255HKDFuD4Gb5tNowx` |
| URL | `https://tp3d-cinema-qmixwx4ca-la-hieu-phongs-projects.vercel.app` | `https://tp3d-cinema-hfho9lu9b-la-hieu-phongs-projects.vercel.app` |
| Nguồn | `git`, `main` @ `52809ee…` | `git`, `preview/p10-release-audit` @ `52809ee…` |
| Target / trạng thái | `production`, `READY` | preview, `READY` |
| Thời điểm | tạo 07:52:55Z, READY 07:53:46Z | 07:39:42Z → 07:40:33Z |
| Alias | `tp3d-cinema.vercel.app`, `tp3d-cinema-la-hieu-phongs-projects.vercel.app`, `tp3d-cinema-git-main-…` | alias nhánh |

- `targets.production` của project = `dpl_2FS8…`.
- Commit status GitHub: `Vercel — success`, 07:53:46Z.
- API không trả bảng định tuyến của deployment. Định tuyến và header được kiểm chứng bằng hành vi thật
  (mục 3).
- `vercel.json` không đổi từ `dc759bf`, bản đã `vercel build` và kiểm tra ở Prompt 11.

## 3. Kiểm tra

**Preflight trên preview (Prompt 11):**
- `dpl_HPxnF8b92SQ4GJ7EK3DT4TgXkXVF` (`dc759bf`): hosting 8/8, acceptance 24/24.
- `dpl_E2F9…` (`52809ee`): hosting 8/8.

Prompt 12 không chạy lại trên preview: lúc bắt đầu, production đã chạy đúng commit này, và chạy trên preview
cần tạo lại secret bypass, việc chưa được uỷ quyền trong phiên. Toàn bộ kiểm tra được chạy trên chính
production.

**Production `https://tp3d-cinema.vercel.app`** (Chrome 156.0.8078.47 headless, profile tạm):
- **Hosting 8/8**:
  - `/`, `/?utm_source=test` → landing; `/cinema`, `/cinema/`, `/cinema?inspect=seat` → `cinema.html`;
    HTML `no-cache`;
  - canonical và `og:url`: `/` và `/cinema`;
  - JS `application/javascript` và CSS `text/css`: `public, max-age=31536000, immutable`;
  - ảnh `/brand`, poster: `max-age=0, must-revalidate`;
  - video: 206 (`bytes 0-1023/8347668`, tua `bytes 8000000-8000999/8347668`);
  - cùng bản build với `dist/`.
- **Tệp thiếu** (tên mới mỗi lượt) dưới `/assets`, `/brand`, `/media` và favicon:
  - **404** cho GET, HEAD, GET lặp lại;
  - `public, max-age=0, must-revalidate` (favicon `no-cache`);
  - **không có `immutable`**.
- **URL đã hỏi trên production cũ** (không còn cache CDN cũ), đều trả 404 với `max-age=0, must-revalidate`:
  - `/assets/does-not-exist.js` (từng nhận HTML 200 kèm `immutable`);
  - `/assets/view-BXJOnfVJ.js` (chunk Prompt 08);
  - bốn tên thử của Prompt 11 (từng nhận 404 kèm `immutable`).
- **Acceptance 24/24** (7 hosting + 16 check của 15 luồng + console sạch):
  - landing → rạp; chọn ghế trên sơ đồ và bằng click 3D (F06); nhìn từ ghế;
  - Phát/Tạm dừng, tắt/bật tiếng khi đang phát;
  - rời rạp khi phim đang phát (0 video/canvas/WebGL sau GC); 4 vòng Back/Forward (heap +0,32 MiB);
  - chất lượng; mất/khôi phục WebGL; inspector;
  - điện thoại giả lập dọc/ngang và sơ đồ modal;
  - giảm chuyển động; không JavaScript; không WebGL;
  - video lỗi; mã rạp tải lỗi → "Thử lại".

Log, ảnh, report: `artifacts/prompt-12/` (ngoài Git).

## 4. Cache cũ trong trình duyệt

**Tái hiện cục bộ** (server Node trong scratch, profile Chrome 156 tạm, không chạm site thật):
- 404 kèm `public, max-age=31536000, immutable`:
  - Chrome dùng lại 404 đó cả khi server đã có tệp, và **cả sau khi tải lại trang**;
  - server chỉ bị hỏi một lần; HTML vẫn được tải lại.
- Đối chứng với header mới (`public, max-age=0, must-revalidate`): Chrome hỏi lại và nhận 200.

**Kết luận:**
- Phản hồi mới đã sửa. Nhưng trình duyệt đã nhận 404 (07:04–07:53Z) hoặc HTML 200 (06:12–07:04Z) kèm
  `immutable` cho một URL `/assets/…` thì vẫn giữ nó. Bản phát hành **không xoá** được cache đó.
- Thực tế chỉ những URL không tồn tại trong bản hiện tại bị ảnh hưởng: chủ yếu các chunk lazy của Prompt 08.
  - Tab mở từ Prompt 08 dù sao cũng phải **tải lại trang**: chunk cũ không còn trên server.
  - Sau khi tải lại, HTML (`no-cache`) dẫn tới tên chunk hiện tại (`main-D_k_CDc0.js`, `page-UxLl9iyQ.js`,
    `ui-G9uKr0fh.js`…), vốn tồn tại liên tục từ `f55ef30` và chưa bao giờ trả 404.
- Rủi ro còn lại chỉ xuất hiện nếu một URL cũ **có lại** trên server, tức rollback về `368d8f4`. Vì vậy:
  **không rollback về `368d8f4`**.
- Không purge, không thêm cache-busting: chưa có bằng chứng người dùng nào bị ảnh hưởng.

## 5. Rollback

**Bản dự phòng** (READY; URL deployment trả 302 sang đăng nhập Vercel, tức còn tồn tại và được bảo vệ):

| | Deployment | Commit | Lỗi đã biết sẽ quay lại nếu rollback |
| --- | --- | --- | --- |
| Chính | `dpl_NpH96Mgh7xK14NLe7T7r1rxfHSxt`, `https://tp3d-cinema-123n90jvr-la-hieu-phongs-projects.vercel.app` | `192318f1907733720f1b339b809225c0beb38675` | 404 dưới `/assets/` kèm `immutable` (Chrome giữ được, mục 4) |
| Phụ | `dpl_FVoxAkbu6LMmGmGGA4JgAHUEZ7Rj`, `https://tp3d-cinema-2f49rug5t-la-hieu-phongs-projects.vercel.app` | `f55ef303b8e9f40c22c69a4c3e250496349c334f` | tệp thiếu trả landing HTML 200, dưới `/assets/` kèm `immutable` |

Cả hai dùng đúng tên chunk của bản hiện tại, nên rollback không làm mất chunk của tab đang mở.

**Khôi phục dịch vụ nhanh (rollback deployment).**
- Lệnh: `vercel rollback dpl_NpH96Mgh7xK14NLe7T7r1rxfHSxt --scope la-hieu-phongs-projects`.
- Gói Hobby chỉ rollback được về deployment production **liền trước**, tức `dpl_NpH96…`. `dpl_FVoxAkbu…`
  không dùng Instant Rollback được.
- Sau khi rollback, Vercel **tắt tự gán tên miền production**: push `main` không tự lên production nữa. Muốn
  trở lại bình thường: `vercel promote <deployment>` (tài liệu Instant Rollback của Vercel, 07/07/2026).

**Để `main` khớp với production (revert Git).** Nếu cần, dùng commit revert có lịch sử rõ, ví dụ
`git revert dc759bf`, rồi push bình thường. Không reset, không force push.

**Điều kiện kích hoạt:** regression nghiêm trọng do lần phát hành này. Kiểm tra ở mục 3 **không phát hiện**
regression nào, nên không rollback.

## 6. Giới hạn còn lại (chưa kiểm chứng, không tính là PASS)

- Nghe âm thanh bằng tai. Luồng O chỉ kiểm tra trạng thái tắt/bật tiếng.
- Điện thoại và máy tính bảng thật. Mới giả lập viewport, touch, DPR.
- Safari/iOS, Firefox, trình đọc màn hình thật.
- Ảnh chia sẻ trên mạng xã hội.
- Edge: chỉ chạy trên bản build cục bộ (Prompt 10), chưa chạy với production.
- Luồng lỗi video và lỗi tải mã là chặn request trong trình duyệt, không phải sự cố thật của server.
- Trong phiên này người dùng chưa cung cấp kết quả thử tay nào.

## 7. Git cuối phiên

- Nhánh `main` = `origin/main` = `origin/preview/p10-release-audit` = `52809ee…`.
- Chưa commit: `docs/production-release-prompt-12.md` (tệp này, mới) và `docs/release-checklist.md` (cập nhật
  trạng thái).
- `artifacts/` không được theo dõi; ảnh, video, log nằm ở máy.
