# MyOffice: Antigravity CLI Integration & Windows Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển đổi MyOffice từ Claude Code sang Antigravity CLI (`agy`), tối ưu hóa hiệu năng và đa ổ đĩa (D:\) trên Windows, hỗ trợ cách ly brain cho từng task và duyệt quyền qua giao diện 3D.

**Architecture:** Tạo module `server/agy-tasks.mjs` thay thế `server/tasks.mjs` để spawn `agy -p ... --output-format stream-json`, chuyển đổi stream NDJSON sang các sự kiện bàn làm việc của 3D office, tối ưu hóa `server/platform/win32.mjs` dùng Node OS API thay thế PowerShell polling, bổ sung kiểm tra ổ đĩa C/D và script khởi chạy Windows thân thiện.

**Tech Stack:** Node.js v20+, Next.js 16, React 19, Three.js, Antigravity CLI (`agy`), Windows Process API (`taskkill`).

**Spec:** `docs/superpowers/specs/2026-10-30-myoffice-antigravity-windows-design.md`

## Global Constraints

- Không làm gián đoạn giao diện 3D Three.js và hệ thống Server-Sent Events (SSE) `/events`.
- Mọi tác vụ `agy` phải chạy ngầm (`windowsHide: true`), mặc định hỗ trợ thư mục làm việc trên ổ đĩa `D:\`.
- Mỗi task phải gắn liền với một `conversation_id` (brain) độc lập trong `~/.gemini/antigravity-cli/brain/<id>`.
- Dọn dẹp tiến trình con triệt để bằng `taskkill /pid <PID> /T /F` khi hủy task.

## Review Focus

- Trường hợp đường dẫn thư mục làm việc trên ổ D không tồn tại: báo lỗi rõ ràng trước khi spawn `agy`.
- Trường hợp `agy` trả về lỗi hoặc thoát đột ngột: bắt sự kiện `exit`, cập nhật trạng thái nhân vật và thông báo vào group chat.
- Trường hợp `agy` stream nhiều dòng NDJSON nhanh: buffer và phân tích chính xác từng dòng JSON, không bị nuốt ký tự xuống dòng.
- Tải CPU khi ứng dụng nhàn rỗi: không được vượt quá 1% CPU cho việc đo lường hệ thống.
- Cú pháp lệnh khởi động trên Windows: không được dùng lệnh POSIX shell như `NODE_ENV=...` gây lỗi trong cmd/powershell.

---

### Task 1: Tối ưu hóa giám sát hệ thống trên Windows (`server/platform/win32.mjs`)

**Files:**
- Modify: `my-office/server/platform/win32.mjs`
- Create: `my-office/tests/platform-win32.test.mjs`

- [ ] Viết unit test trong `tests/platform-win32.test.mjs` kiểm tra các hàm `memory()`, `disk()`, `processes()` trên Windows.
- [ ] Chạy test và xác nhận fail hoặc baseline: `node --test tests/platform-win32.test.mjs`.
- [ ] Cải tiến `server/platform/win32.mjs`:
  - Thay thế việc gọi PowerShell mỗi 2 giây bằng `os.freemem()`, `os.totalmem()`, `os.cpus()`.
  - Cập nhật hàm `disk()` để trả về thông tin cả ổ `C:\` và `D:\` bằng `fs.statfsSync`.
  - Thiết lập throttle/cache 10s cho việc truy vấn danh sách port/tiến trình.
- [ ] Chạy lại test `node --test tests/platform-win32.test.mjs` và xác nhận PASS.
- [ ] Commit thay đổi: `git commit -m "perf(win32): optimize windows system monitoring and add multi-drive disk stats"`.

---

### Task 2: Xây dựng trình thực thi Antigravity CLI (`server/agy-tasks.mjs`)

**Files:**
- Create: `my-office/server/agy-tasks.mjs`
- Create: `my-office/tests/agy-tasks.test.mjs`

- [ ] Viết unit test trong `tests/agy-tasks.test.mjs` kiểm tra:
  - Khởi tạo task với đường dẫn trên ổ `D:\`.
  - Bắt `conversation_id` từ sự kiện `init`.
  - Ánh xạ sự kiện `step_update` (tool: `run_command`, `read_file`, `agent_response`).
  - Hủy task bằng `taskkill` trên Windows.
- [ ] Triển khai `server/agy-tasks.mjs`:
  - Hàm `findAgy()`: định vị binary `agy.cmd` hoặc `agy.exe` trong PATH hoặc `.gemini/antigravity-cli/bin`.
  - Hàm `createAgyTasks({ onStart, onUpdate, onDone })`:
    - Spawn `agy.cmd -p "<prompt>" --output-format stream-json` với `cwd` được truyền vào.
    - Nếu có `from.conversationId`, thêm `--conversation <id>`.
    - Buffer và phân tích NDJSON từ `stdout`.
    - Gọi callback `onStart`, `onUpdate`, `onDone` tương ứng.
    - Hàm `stop(id)` thực thi `taskkill /pid <PID> /T /F`.
- [ ] Chạy test `node --test tests/agy-tasks.test.mjs` và xác nhận PASS.
- [ ] Commit thay đổi: `git commit -m "feat(agent): implement agy task runner with brain isolation and ndjson streaming"`.

---

### Task 3: Tích hợp `agy-tasks` vào Server Backend & Gợi ý Workspace (`server/index.mjs`)

**Files:**
- Modify: `my-office/server/index.mjs`
- Modify: `my-office/server/tasks.mjs`

- [ ] Cập nhật endpoint `/api/tasks` để hỗ trợ:
  - Tiếp nhận `conversationId` cho các task nối tiếp trên cùng bàn làm việc.
  - Endpoint đọc danh sách `trustedWorkspaces` từ `~/.gemini/antigravity-cli/settings.json` để gợi ý các folder dự án trên ổ D.
- [ ] Kết nối `agy-tasks` với hệ thống SSE `/events` của văn phòng:
  - Khi `agy` bắt đầu chạy tool `run_command` -> emit event bàn làm việc `typing`/`running`.
  - Khi `agy` đọc file -> emit event `reading`.
  - Khi `agy` trả kết quả -> emit event vào khung Chat của văn phòng.
- [ ] Commit thay đổi: `git commit -m "feat(server): wire agy runner into office desks and sse event stream"`.

---

### Task 4: Hook Phê duyệt quyền tương tác (`hooks/agy-hook.mjs`)

**Files:**
- Create: `my-office/hooks/agy-hook.mjs`
- Modify: `my-office/hooks/hooks.json`

- [ ] Viết `hooks/agy-hook.mjs`:
  - Đọc context JSON từ stdin của `agy` (chứa `toolCall`, `conversationId`, `workspacePaths`).
  - POST đến `http://127.0.0.1:4310/hook/permission`.
  - Nhận quyết định từ server và in ra stdout `{ "decision": "allow" }` hoặc `{ "decision": "deny" }`.
- [ ] Cập nhật `hooks/hooks.json` để đăng ký cấu hình hook chuẩn cho Antigravity.
- [ ] Commit thay đổi: `git commit -m "feat(hooks): add interactive approval hook for antigravity tools"`.

---

### Task 5: Chuẩn hóa khởi chạy trên Windows & Kiểm thử toàn diện

**Files:**
- Modify: `my-office/package.json`
- Create: `my-office/start-office.cmd`
- Create: `my-office/scripts/start.mjs`

- [ ] Cập nhật `package.json` để lệnh `npm start` và `npm run dev` không bị lỗi cú pháp POSIX trên Windows.
- [ ] Tạo `scripts/start.mjs` để thiết lập `NODE_ENV=production` bằng JavaScript thuần và khởi chạy server.
- [ ] Tạo file `start-office.cmd` cho phép khởi động văn phòng bằng 1 click chuột trên Windows.
- [ ] Cài đặt dependencies (`npm.cmd install`) và build Next.js (`npm.cmd run build`).
- [ ] Chạy kiểm thử End-to-End: Khởi động server văn phòng, giao việc cho `agy` trên thư mục ổ `D:\`, kiểm tra brain được tạo và nhân vật 3D phản hồi trực tiếp.
- [ ] Commit hoàn tất: `git commit -m "chore(windows): add native launch script and verify full agy office workflow"`.
