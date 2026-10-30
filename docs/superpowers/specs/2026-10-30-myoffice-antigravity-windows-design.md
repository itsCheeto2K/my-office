# Design Spec: Chuyển đổi MyOffice sang Antigravity CLI (agy) & Tối ưu hóa Windows

## 1. Tổng quan (Overview)

Tài liệu thiết kế này đặc tả việc chuyển đổi toàn diện dự án `my-office` từ môi trường Claude Code (macOS-centric) sang **Antigravity CLI (`agy`)**, đồng thời tối ưu hóa hiệu năng, tương thích hoàn toàn với hệ điều hành Windows, đặc biệt là quản lý thư mục làm việc trên ổ đĩa `D:\` và cách ly ngữ cảnh (brain isolation) cho từng task.

---

## 2. Mục tiêu kỹ thuật (Technical Goals)

1. **Thay thế AI Runtime**: Chuyển đổi từ `claude -p` sang `agy -p` (Antigravity CLI) với định dạng `--output-format stream-json`.
2. **Cách ly Brain (Conversation Isolation)**:
   - Mỗi task mới tạo một cuộc trò chuyện (`conversation_id`) và brain riêng trong `~/.gemini/antigravity-cli/brain/<conversation_id>/`.
   - Các lượt giao tiếp tiếp theo (follow-up) trên cùng bàn làm việc sử dụng lại cờ `--conversation <conversation_id>` để giữ đúng ngữ cảnh.
3. **Ánh xạ sự kiện thời gian thực (Real-time Event Mapping)**:
   - Phân tích luồng NDJSON từ `agy`: ánh xạ các sự kiện `init`, `step_update` (`tool_name`, `agent_response`), `result` sang các sự kiện bàn làm việc của văn phòng 3D (gõ phím, đọc file, chat, hoàn thành).
4. **Phê duyệt quyền tương tác (Interactive Approval)**:
   - Tích hợp hook `PreToolUse` của Antigravity gửi payload đến endpoint `/hook/permission` của `my-office`.
   - Hiển thị yêu cầu cấp quyền trên giao diện 3D và web di động (LAN), nhận quyết định `allow` / `deny`.
5. **Tối ưu hóa Windows**:
   - Viết lại `server/platform/win32.mjs`: thay thế việc gọi PowerShell định kỳ (gây CPU spike) bằng Node.js Native API (`os.cpus()`, `os.freemem()`, `os.totalmem()`).
   - Hỗ trợ giám sát dung lượng ổ đĩa `C:\` và `D:\`.
   - Sử dụng `taskkill /pid <PID> /T /F` để dọn sạch toàn bộ tiến trình con khi dừng task trên Windows.
   - Thêm launcher script `.bat` và script npm cross-platform.

---

## 3. Kiến trúc chi tiết (Architecture)

### 3.1. Sơ đồ tương tác

```
┌────────────────────────────────────────────────────────┐
│                     Văn phòng 3D                       │
│    (Three.js + Next.js: Bàn làm việc, Nhân vật, Chat) │
└───────────────────────▲────────────────────────────────┘
                        │ SSE /events & POST /api/tasks
┌───────────────────────▼────────────────────────────────┐
│               MyOffice Server (Port 4310)              │
│                                                        │
│  - server/index.mjs: Web server, Desks & SSE stream    │
│  - server/agy-tasks.mjs: Quản lý tiến trình agy        │
│  - server/platform/win32.mjs: Tối ưu Windows metrics   │
└───────────────────────▲────────────────────────────────┘
                        │ spawn(agy.cmd, args, { cwd: D:\... })
                        │ stdin/stdout (NDJSON stream)
┌───────────────────────▼────────────────────────────────┐
│                 Antigravity CLI (agy)                  │
│                                                        │
│  - Brain: ~/.gemini/antigravity-cli/brain/<id>         │
│  - Working Directory: D:\Project\...                   │
└────────────────────────────────────────────────────────┘
```

### 3.2. Quản lý tác vụ & Luồng NDJSON (`server/agy-tasks.mjs`)

Module `server/agy-tasks.mjs` thay thế cho logic cũ trong `server/tasks.mjs`:
- **Khởi chạy task mới**:
  ```javascript
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json'
  ];
  if (from?.conversationId) {
    args.push('--conversation', from.conversationId);
  }
  const proc = spawn('agy.cmd', args, {
    cwd: dir, // Đường dẫn thư mục trên ổ D:
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  ```
- **Phân tích luồng NDJSON từ `agy`**:
  - `event === 'init'`: Lưu `conversation_id`, gán vào bàn làm việc tương ứng.
  - `event === 'step_update'`:
    - `step_type === 'tool'`: Lấy `tool_name` (ví dụ `run_command`, `read_file`, `edit_file`, `search_web`). Cập nhật hành vi nhân vật 3D sang `working` / `reading` / `running`.
    - `step_type === 'agent_response'`: Cập nhật text delta lên bong bóng chat của nhân vật.
  - `event === 'result'`: Lấy nội dung phản hồi cuối cùng, cập nhật trạng thái bàn làm việc thành `idle`, đẩy kết quả vào group chat.
- **Hủy tác vụ**:
  - Thực hiện gọi `taskkill /pid <PID> /T /F` để đảm bảo không còn tiến trình mồ côi (orphaned process).

### 3.3. Tích hợp Phê duyệt quyền (Approval via Antigravity Hook)

Cấu hình Antigravity hook trong `~/.gemini/antigravity-cli/hooks.json` hoặc workspace `.agents/hooks.json`:
- Đăng ký `PreToolUse` matcher `run_command|edit_file|write_to_file`.
- Gọi script node chuyển tiếp payload sang `http://127.0.0.1:4310/hook/permission`.
- Server giữ connection HTTP chờ người dùng bấm **Cho phép (Allow)** hoặc **Từ chối (Deny)** trên UI văn phòng, sau đó trả về `{ "decision": "allow" }` hoặc `{ "decision": "deny" }`.

### 3.4. Tối ưu hóa nền tảng Windows (`server/platform/win32.mjs`)

1. **CPU & RAM**:
   - Sử dụng `os.cpus()` tính toán CPU delta.
   - Sử dụng `os.freemem()` và `os.totalmem()` đo lượng RAM thực tế mà không cần gọi tiến trình ngoài.
2. **Kiểm tra Ổ đĩa**:
   - Sử dụng `fs.statfsSync('C:\\')` và `fs.statfsSync('D:\\')` để lấy dung lượng trống của cả 2 ổ đĩa.
3. **Quét Port TCP**:
   - Chạy lệnh `netstat -ano` với cache 10 giây một lần (giảm 80% tần suất so với ban đầu).

### 3.5. Trải nghiệm người dùng (UX) trên giao diện Office

- Giao diện **Giao việc (Task Sheet)**:
  - Trường chọn đường dẫn: Đọc danh sách `trustedWorkspaces` từ `settings.json` của Antigravity CLI để làm danh sách gợi ý nhanh.
  - Cho phép nhập trực tiếp bất kỳ đường dẫn nào trên ổ `D:\`.
  - Hiển thị danh sách các bàn làm việc cùng Brain ID (`conversation_id`) đang gắn với từng bàn.

---

## 4. Kế hoạch kiểm thử & Tiêu chí nghiệm thu (Testing & Acceptance Criteria)

1. **Khởi động**: Ứng dụng khởi động mượt mà trên Windows với lệnh tiện ích hoặc `node server/index.mjs` trên cổng 4310.
2. **CPU không giật lag**: Tải CPU của background monitoring dưới 1% khi không có task nào chạy.
3. **Giao việc thành công**:
   - Giao việc từ Task Sheet trên thư mục ổ `D:\`.
   - `agy` khởi động ngầm trong thư mục đó.
   - Nhân vật 3D trên bàn tương ứng bắt đầu hoạt động (hiển thị hoạt ảnh theo công cụ đang chạy).
   - Nội dung phản hồi của `agy` hiển thị đầy đủ trong group chat.
4. **Cách ly Brain**:
   - Mỗi task tạo một thư mục brain riêng trong `.gemini/antigravity-cli/brain/`.
   - Chat tiếp tục trên cùng bàn tái sử dụng đúng `conversation_id`.
5. **Duyệt quyền**: Popup duyệt quyền xuất hiện khi `agy` yêu cầu và phản hồi đúng quyết định của người dùng.
