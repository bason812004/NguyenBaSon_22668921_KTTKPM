# Message Queue + JWT Demo: Order Confirmation System

Hệ thống thực tế: Khi user đặt hàng, cần gửi email/SMS xác nhận **không chặn** (non-blocking). 

## 🎯 Bài toán

**Không dùng Message Queue (❌ Xấu):**
```
User → Order API → Create Order (DB) → Send Email → Return Response
                       ↑                    ↑
                   Nhanh              Chậm (2-5s)
Vấn đề: Email lỗi → Toàn bộ request fail ❌
```

**Dùng Message Queue (✅ Tốt):**
```
User → Order API → Create Order (DB) → Push to Queue → Return Response (ngay)
                                              ↓
                                        Email Worker (nền)
                                        • Gửi email
                                        • Gửi SMS
                                        • Cập nhật status
```

## 🏗️ Kiến trúc

```
┌─────────────────────────────────────────────────────────┐
│                    API Server (port 3000)               │
│                                                         │
│  POST /login           → Get JWT Token                 │
│  POST /orders          → Create Order + Queue Job      │
│  GET  /orders/:id      → Check Order Status            │
│  GET  /queue/status    → Monitor Queue                 │
└─────────────────────────────────────────────────────────┘
             ↓ (Push Jobs)
┌─────────────────────────────────────────────────────────┐
│              Redis Queue                                │
│                                                         │
│  email_queue → [Job1, Job2, Job3, ...]                │
└─────────────────────────────────────────────────────────┘
             ↓ (Poll Jobs)
┌─────────────────────────────────────────────────────────┐
│           Email/SMS Worker Process                      │
│                                                         │
│  While loop:                                            │
│  1. BLPOP job from queue                               │
│  2. Send Email/SMS                                      │
│  3. Update order status                                 │
│  4. Repeat                                              │
└─────────────────────────────────────────────────────────┘
```

## 🚀 Cài đặt

### 1. Yêu cầu
- **Node.js** v14+
- **Redis** (có thể dùng Docker)

### 2. Cài Redis (nếu chưa có)

#### Cách 1: Dùng Docker
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

#### Cách 2: Cài trực tiếp
- **Windows**: https://github.com/microsoftarchive/redis/releases
- **macOS**: `brew install redis`
- **Linux**: `sudo apt-get install redis-server`

### 3. Cài dependencies
```bash
npm install
```

## 📝 Cấu hình

File `.env`:
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

JWT_SECRET=your_super_secret_jwt_key_change_me_in_production_12345
JWT_EXPIRES_IN=1h

ORDER_QUEUE=order_queue
EMAIL_QUEUE=email_queue

API_PORT=3000
NODE_ENV=development
```

## ▶️ Chạy Demo

### Terminal 1: Khởi động API Server
```bash
npm start
```

Output:
```
╔════════════════════════════════════════════════════════╗
║   Order Service API running on port 3000              ║
╚════════════════════════════════════════════════════════╝
```

### Terminal 2: Khởi động Email Worker
```bash
npm run worker
```

Output:
```
╔════════════════════════════════════════════════════════╗
║   Email/SMS Worker Started                            ║
║   Queue: email_queue                                  ║
║   Listening for jobs...                               ║
╚════════════════════════════════════════════════════════╝
```

### Terminal 3: Chạy Demo Script
```bash
node scripts/demo.js
```

## 📡 API Endpoints

### 1. Login - Lấy JWT Token
```bash
curl -X POST http://localhost:3000/login

Response:
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "1h"
}
```

### 2. Create Order - Đặt Hàng (Yêu cầu JWT)
```bash
TOKEN="your_jwt_token_here"

curl -X POST http://localhost:3000/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"name": "Laptop", "price": 999.99},
      {"name": "USB Cable", "price": 15.99}
    ],
    "customerEmail": "customer@example.com",
    "customerPhone": "+84901234567"
  }'

Response:
{
  "message": "Order created successfully! Confirmation email will be sent shortly.",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING",
  "confirmationNote": "Check your email for order confirmation"
}
```

### 3. Check Order Status (Yêu cầu JWT)
```bash
curl -X GET http://localhost:3000/orders/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer $TOKEN"

Response:
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user123",
  "status": "CONFIRMED",
  "items": [...],
  "totalAmount": 1015.98,
  "createdAt": "2024-01-14T10:30:00.000Z",
  "confirmationSentAt": "2024-01-14T10:30:02.000Z"
}
```

### 4. Queue Status
```bash
curl -X GET http://localhost:3000/queue/status \
  -H "Authorization: Bearer $TOKEN"

Response:
{
  "queue": "email_queue",
  "pendingJobs": 3,
  "status": "ACTIVE"
}
```

## 🔄 Flow Chi Tiết

### Step 1: User Đặt Hàng
```javascript
// Client gọi API
POST /orders
Authorization: Bearer <JWT_TOKEN>
{
  items: [...],
  customerEmail: "...",
  customerPhone: "..."
}
```

### Step 2: Server Xử Lý (Nhanh)
```javascript
// src/index.js - POST /orders
1. Kiểm tra JWT token ✓
2. Validate dữ liệu ✓
3. Tạo order object
4. Lưu vào Redis: order:<orderId> → {status: PENDING, ...}
5. Tạo email job: {jobId, orderId, email, phone, ...}
6. Push vào queue: RPUSH email_queue <job_json>
7. Return response ngay (orderId + status PENDING)
```

Thời gian: **~100ms** ✅

### Step 3: Email Worker Xử Lý (Nền)
```javascript
// src/workers/emailWorker.js - Background process
Worker chạy liên tục:
1. BLPOP email_queue (chờ job)
2. Lấy job: {jobId, orderId, email, ...}
3. Gửi email → transporter.sendMail()
4. Gửi SMS → (mô phỏng)
5. Cập nhật order: {status: CONFIRMED, confirmationSentAt: ...}
6. Lặp lại
```

Thời gian: **~2-5s** (không ảnh hưởng API)

## 🧪 Kiểm Tra

### Scenario 1: Gửi Email Thành Công
```bash
# Terminal 1: API chạy
npm start

# Terminal 2: Worker chạy
npm run worker
# Output: ✅ Email sent successfully!

# Terminal 3: Demo
node scripts/demo.js
# Output: Order created + Job queued
```

### Scenario 2: JWT Authentication
```bash
# Không có token → 401
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '...'
# Response: {"error": "No token provided"}

# Token sai → 403
curl -X POST http://localhost:3000/orders \
  -H "Authorization: Bearer invalid_token" \
  -d '...'
# Response: {"error": "Invalid token"}
```

### Scenario 3: Queue Monitoring
```bash
# Tạo nhiều orders
node scripts/demo.js

# Ngay lập tức check queue
curl http://localhost:3000/queue/status \
  -H "Authorization: Bearer $TOKEN"
# Response: {pendingJobs: 2, status: "ACTIVE"}

# Sau vài giây (worker xử lý)
curl http://localhost:3000/queue/status \
  -H "Authorization: Bearer $TOKEN"
# Response: {pendingJobs: 0, status: "IDLE"}
```

## 🎓 Học Hỏi từ Code

### 1. JWT Authentication
```javascript
// Tạo token
const token = jwt.sign(user, SECRET, { expiresIn: '1h' });

// Verify token
jwt.verify(token, SECRET, (err, decoded) => {
  if (err) return res.status(403).json({error: 'Invalid'});
  req.user = decoded;
  next();
});
```

### 2. Redis Queue
```javascript
// Push job vào queue
await redisClient.rPush(QUEUE_NAME, JSON.stringify(job));

// Pop job từ queue (blocking, chờ 30s)
const jobData = await redisClient.blPop(QUEUE_NAME, 30);
```

### 3. Non-blocking Pattern
```javascript
// API trả response ngay, không chờ email
res.json({ orderId, status: 'PENDING' });

// Email được gửi ở background (worker)
// không chặn response
```

## 📚 Tài Liệu Tham Khảo

- **JWT**: https://jwt.io
- **Redis**: https://redis.io/commands/
- **Express**: https://expressjs.com
- **Nodemailer**: https://nodemailer.com

## ⚠️ Production Checklist

- [ ] Đổi `JWT_SECRET` thành key mạnh mẽ
- [ ] Cấu hình SMTP thực (Gmail, SendGrid, v.v.)
- [ ] Thêm database thực (MongoDB, PostgreSQL)
- [ ] Thêm error handling & logging
- [ ] Thêm retry mechanism cho email
- [ ] Thêm health checks
- [ ] Implement graceful shutdown
- [ ] Thêm rate limiting
- [ ] Thêm request validation schema (joi, zod)
- [ ] Deploy on cloud (AWS, Azure, GCP)

## 🆘 Troubleshooting

### Redis connection refused
```bash
# Kiểm tra Redis có chạy không
redis-cli ping
# Should return: PONG

# Nếu không, khởi động Redis
redis-server
# hoặc
docker run -d -p 6379:6379 redis:7-alpine
```

### Port 3000 already in use
```bash
# Tìm process dùng port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill process
kill -9 <PID>
```

### Email not sending
- Kiểm tra SMTP credentials trong `.env`
- Demo dùng Ethereal (fake SMTP) - kiểm tra console log
- Trong production, cần real SMTP service

---

**Happy coding! 🎉**
