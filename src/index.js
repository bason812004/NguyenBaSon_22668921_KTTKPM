require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ==================== Redis Setup ====================
const redisClient = createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  db: process.env.REDIS_DB
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.connect().catch(console.error);

// ==================== Middleware ====================
// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token', details: err.message });
    }
    req.user = user;
    next();
  });
};

// ==================== API Routes ====================

// 1. Login - Get JWT Token
app.post('/login', (req, res) => {
  const user = {
    id: 'user123',
    email: 'customer@example.com',
    name: 'John Doe'
  };

  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });

  res.json({
    message: 'Login successful',
    token: token,
    expiresIn: process.env.JWT_EXPIRES_IN
  });
});

// 2. Create Order (with JWT) - Publish to Queue
app.post('/orders', authenticateToken, async (req, res) => {
  try {
    const { items, customerEmail, customerPhone } = req.body;

    if (!items || !customerEmail || !customerPhone) {
      return res.status(400).json({
        error: 'Missing required fields: items, customerEmail, customerPhone'
      });
    }

    // Tạo đơn hàng ngay (ghi DB)
    const orderId = uuidv4();
    const order = {
      id: orderId,
      userId: req.user.id,
      items: items,
      customerEmail: customerEmail,
      customerPhone: customerPhone,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      totalAmount: items.reduce((sum, item) => sum + item.price, 0)
    };

    // Lưu order vào Redis (simulating DB)
    await redisClient.set(
      `order:${orderId}`,
      JSON.stringify(order),
      { EX: 86400 } // Expire after 24 hours
    );

    // Đẩy job vào queue: SendEmailJob(orderId, email, ...)
    const emailJob = {
      jobId: uuidv4(),
      type: 'SEND_ORDER_CONFIRMATION',
      orderId: orderId,
      email: customerEmail,
      phone: customerPhone,
      customerName: req.user.name,
      totalAmount: order.totalAmount,
      createdAt: new Date().toISOString()
    };

    // Push to Redis queue (RPUSH - right push)
    await redisClient.rPush(
      process.env.EMAIL_QUEUE,
      JSON.stringify(emailJob)
    );

    console.log(`[${new Date().toISOString()}] Order created: ${orderId}`);
    console.log(`[${new Date().toISOString()}] Email job queued for: ${customerEmail}`);

    // Trả kết quả ngay (không chờ email gửi)
    res.status(201).json({
      message: 'Order created successfully! Confirmation email will be sent shortly.',
      orderId: orderId,
      status: 'PENDING',
      confirmationNote: 'Check your email for order confirmation'
    });

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      error: 'Failed to create order',
      details: error.message
    });
  }
});

// 3. Get Order Status
app.get('/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const order = await redisClient.get(`order:${req.params.orderId}`);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(JSON.parse(order));
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch order',
      details: error.message
    });
  }
});

// 4. Queue Status (monitoring)
app.get('/queue/status', authenticateToken, async (req, res) => {
  try {
    const queueLength = await redisClient.lLen(process.env.EMAIL_QUEUE);

    res.json({
      queue: process.env.EMAIL_QUEUE,
      pendingJobs: queueLength,
      status: queueLength > 0 ? 'ACTIVE' : 'IDLE'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get queue status',
      details: error.message
    });
  }
});

// ==================== Server Start ====================
const PORT = process.env.API_PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║   Order Service API running on port ${PORT}            ║
║                                                        ║
║   1. Get Token: POST /login                           ║
║   2. Create Order: POST /orders (with JWT)            ║
║   3. Check Order: GET /orders/:orderId                ║
║   4. Queue Status: GET /queue/status                  ║
║                                                        ║
║   Start worker: npm run worker                        ║
╚════════════════════════════════════════════════════════╝
  `);
});
