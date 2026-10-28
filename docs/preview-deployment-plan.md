# Kế hoạch deploy bản preview — sau Prompt 10

Ngày 28/10/2026. Kế hoạch này chỉ thực hiện ở Prompt 11, và chỉ khi người dùng yêu cầu commit, push và
tạo preview. Prompt 10 không commit, không push, không deploy.

Bối cảnh: [release-audit-prompt-10.md](release-audit-prompt-10.md). Checklist: [release-checklist.md](release-checklist.md).

## 1. Cách project đang được deploy (đã xác minh)

| Điều | Bằng chứng | Kết luận |
| --- | --- | --- |
| Repo | `git remote -v` → `https://github.com/lahieuphong/3d-cinema.git`; `git ls-remote --heads origin`: chỉ có `main` | Một nhánh trên remote |
| Deploy bằng Git | Commit status trên GitHub: `368d8f4` và `f55ef30` đều có context `Vercel`, "Deployment has completed" (04:23:57Z và 06:12:34Z ngày 28/10) | Vercel đã nối với repo GitHub (Vercel for GitHub) |
| `main` là nhánh production | `https://tp3d-cinema.vercel.app/cinema` phục vụ đúng các chunk có hash của bản build `f55ef30` (so với `dist/` build cục bộ từ cùng source) | Push `main` ⇒ deploy production |
| Liên kết CLI | Không có thư mục `.vercel/` trong máy; không có `vercel` CLI trong project | Không deploy bằng CLI |
| Dashboard | Link "Details" của commit status `Vercel` trỏ tới `vercel.com/la-hieu-phongs-projects/tp3d-cinema/…` | Đó là slug của team và project. Project ID và team ID không có trong repo, không suy ra từ tên miền |
| Biến môi trường | Mã chỉ dùng `import.meta.env.DEV`; không có `.env` | Không cần biến nào |
| Build trên Vercel | `vercel.json`: `npm ci`, `npm run build`, output `dist`, framework `vite` | Giữ nguyên |

**Chưa xác minh được từ máy này** (cần nhìn dashboard Vercel, Settings của project):
- *Git → Production Branch* là `main`. Bằng chứng gián tiếp ở bảng trên.
- *Deployment Protection*: preview có bật Vercel Authentication không.
- *Ignored Build Step*: có tắt build cho nhánh khác không.

## 2. Nhánh và commit đề xuất

- Nhánh: **`preview/p10-release-audit`**, tạo từ `main` (`f55ef30`).
- **Không push `main`**: `main` tự deploy production.
- Push một nhánh khác chỉ tạo *Preview deployment*; tên miền production không đổi.
  - Điều này đúng nếu Production Branch là `main`; kiểm tra dashboard trước khi push.
- Danh sách tệp, lý do và commit message: mục 12 của [release-audit-prompt-10.md](release-audit-prompt-10.md).

Lệnh (Prompt 11, sau khi người dùng đồng ý). Stage từng đường dẫn, không dùng `git add .`:

```sh
git switch -c preview/p10-release-audit

# Commit 1 (tuỳ chọn, người dùng quyết định): không theo dõi ảnh/video QA Prompt 09 nữa (tệp vẫn ở máy)
git rm -r --cached --quiet artifacts/prompt-09
git add .gitignore
git commit   # message: mục 12.2 của release-audit-prompt-10.md

# Commit 2: sửa hosting, công cụ nghiệm thu, tài liệu
git add vercel.json .vercelignore package.json scripts/acceptance.mjs scripts/measure-build.mjs \
        scripts/capture-views.mjs docs/release-audit-prompt-10.md docs/preview-deployment-plan.md \
        docs/release-checklist.md
git status --short   # chỉ còn những gì dự kiến; artifacts/prompt-10 bị .gitignore loại
git commit   # message: mục 12.2

git push -u origin preview/p10-release-audit
```

Nếu không làm commit 1, đưa `.gitignore` vào commit 2. Dòng `/artifacts/` vẫn đúng: nó chỉ chặn tệp mới,
không bỏ theo dõi tệp cũ.

## 3. Sau khi push: tìm bản preview và xác nhận đúng commit

1. `git rev-parse HEAD`: ghi lại SHA của commit vừa push.
2. Chờ commit status `Vercel` của **đúng SHA đó** chuyển sang `success`.
   - Xem trên GitHub, ở commit hoặc ở nhánh.
   - Hoặc gửi **một** request:
     `curl -s https://api.github.com/repos/lahieuphong/3d-cinema/commits/<SHA>/status`.
3. Lấy URL bản preview từ commit status (liên kết "Details") hoặc dashboard Vercel. Không đoán URL.
4. Build `dist/` ở máy từ đúng commit đó (working tree sạch): `npm ci && npm run build`.
   - Script nghiệm thu so tên các chunk có hash trong `cinema.html` của bản preview với `dist/`. Trùng nhau
     nghĩa là bản preview được build từ cùng source.

Nếu preview bật Deployment Protection, request tự động sẽ nhận 401 hoặc bị chuyển sang trang đăng nhập
Vercel. Khi đó có hai cách:
- mở bằng trình duyệt đã đăng nhập Vercel để thử tay;
- tạo "Protection Bypass for Automation" trong dashboard và đặt vào biến môi trường
  `VERCEL_PROTECTION_BYPASS` khi chạy script. Không ghi giá trị này vào repo, log hay tài liệu.

## 4. Kiểm tra sau khi deploy preview

Chạy từng bước một, không lặp. Vercel có checkpoint chống bot nếu bị gửi request dồn dập.

**Bước 1 — trả lời của server** (khoảng 20 request):

```sh
BASE_URL=https://<preview-url> ACCEPTANCE_ONLY=hosting npm run acceptance
```

Script kiểm tra:
- `/`, `/?utm_source=test` → landing; `/cinema`, `/cinema/`, `/cinema?inspect=seat` → HTML rạp; trang lạ
  → landing HTML (app hiện "Không tìm thấy trang");
- **tệp thiếu → 404**: `/assets/khong-co.js`, `/brand/khong-co.webp`, `/media/khong-co.mp4`, `/favicon.ico`
  (production hiện trả 200 HTML; đây là chỗ Prompt 10 sửa);
- HTML `no-cache`; `/assets/*` `immutable`, đúng kiểu JS; ảnh `/brand/`, poster `/media/` không `immutable`;
- video: `206`, `video/mp4`, Range ở đầu tệp và ở byte 8 000 000 (tua);
- canonical và `og:url` trong HTML do server trả: `/` và `/cinema`, cùng origin;
- tên các chunk có hash giống `dist/` cục bộ (đúng bản build).

Thêm hai điểm cần xem tay trong kết quả:
- `/assets/khong-co.js` trả 404 thì header `Cache-Control` là gì. Nếu là `immutable`, ghi lại; chưa cần sửa,
  vì tên có hash không đổi nội dung.
- Bản preview có header `X-Robots-Tag: noindex` không (Vercel mặc định thêm cho preview).

**Bước 2 — luồng nghiệm thu trong trình duyệt** (một lượt, 14 luồng, khoảng 3 phút):

```sh
BASE_URL=https://<preview-url> npm run acceptance
```

Gồm:
- landing → rạp → chọn ghế → nhìn từ ghế → phát/tạm dừng;
- tour → dừng → đi bộ → sơ đồ;
- xoay điện thoại; sơ đồ toàn màn hình với Escape và focus;
- chất lượng; mất/khôi phục WebGL; inspector;
- rời rạp khi phim đang phát; Back/Forward;
- giảm chuyển động; không JavaScript; không WebGL;
- lỗi tải video; lỗi tải mã.

Luồng "lỗi tải video" và "lỗi tải mã" chặn request ngay trong trình duyệt, không đụng tới server.

**Bước 3 — thử tay** (máy thật, mạng thật):
- cold load: mở `/` trong cửa sổ ẩn danh, DevTools → Network, "Disable cache":
  - trước khi bấm, không có `page-*`, `view-*`, `seats-*` hay `/media/`;
  - hover "Bước vào rạp" thì tải mã, không tải video;
- vào rạp: chọn ghế → "Xem từ ghế này" → Phát → tua → Tạm dừng; đổi chất lượng Cao ↔ Tiết kiệm;
- refresh `/cinema`, `/cinema/`, `/cinema?inspect=seat`; Back/Forward;
- iPhone (Safari) và Android (Chrome): mục 4 của [release-checklist.md](release-checklist.md);
- nghe tiếng: phát, tắt/bật, âm lượng; rời rạp khi đang phát thì không còn tiếng.

**Bước 4 — ghi kết quả** vào `docs/release-checklist.md`:
- SHA, URL preview, ngày giờ;
- mục nào đạt, mục nào chưa thử.

## 5. Những gì Prompt 11 không làm

- Không promote bản preview lên production, không merge vào `main`, không push `main`. Người dùng tự
  quyết sau khi xem kết quả.
- Không xoá deployment, không đổi cấu hình project trên Vercel.
- Không viết lại lịch sử Git để xoá ảnh/video cũ.
- Nếu bước 1 hoặc 2 có lỗi: dừng, báo bằng chứng, sửa trên nhánh preview rồi push lại. Không đưa lên production.

## 6. Production hiện tại

- `https://tp3d-cinema.vercel.app` đang chạy bản `f55ef30` (Prompt 09) từ 06:12 UTC ngày 28/10/2026.
- Lỗi tệp thiếu → 200 HTML đang có trên production. Lỗi này chỉ hết khi người dùng đưa bản sửa lên
  `main`, sau khi preview đạt.
