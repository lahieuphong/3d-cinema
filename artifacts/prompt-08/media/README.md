# Phân tích media (Prompt 08)

- `container-source-mov.json`, `container-after-remux.json`: số mẫu, thời lượng, keyframe, phân bố khoảng
  cách frame (ms) đọc từ container (`mp4samples.mjs`).
- `frame-alignment-transcode-vs-source.json`: dóng hàng từng frame giải mã của bản chuyển mã với 812 frame
  của `trailer_720p.mov` gốc (`frame-compare.mjs` giải mã trong Chrome, `frame-align.mjs` dóng hàng).
- `remux-decoded-frames-identical.json`: 814/814 frame của bản remux giống hệt bản trước remux.
- `boxes-after-remux.txt`: cây box của tệp sau remux (`moov` ở đầu).

Các script là công cụ phân tích dùng một lần, chạy bằng Node + playwright-core với đường dẫn tuyệt đối trên
máy phát triển; tệp gốc `.mov` (17,8 MB) không nằm trong repo. Công cụ remux dùng cho dự án là
`scripts/remux-mp4.mjs`.
