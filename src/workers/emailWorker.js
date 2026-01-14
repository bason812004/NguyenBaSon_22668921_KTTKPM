require('dotenv').config();
const { createClient } = require('redis');
const nodemailer = require('nodemailer');

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

// ==================== Email Setup ====================
// For demo: using Ethereal Email (fake SMTP service)
// In production: use real email service
const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: {
    user: 'barton.kub@ethereal.email',  // Demo account
    pass: 'JygB4cD4c2P8HdCM7p'           // Demo password
  }
});

// ==================== Email Worker ====================
const processEmailJob = async (job) => {
  try {
    const { jobId, type, orderId, email, phone, customerName, totalAmount } = job;

    console.log(`\n[${new Date().toISOString()}] ⏳ Processing job: ${jobId}`);
    console.log(`   Type: ${type}`);
    console.log(`   Customer: ${customerName} <${email}>`);
    console.log(`   Order: ${orderId}`);

    // Simulate processing time (sending email takes time)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Compose email
    const mailOptions = {
      from: 'noreply@orderapp.com',
      to: email,
      subject: `✅ Order Confirmation - Order ${orderId}`,
      html: `
        <h2>Order Confirmation</h2>
        <p>Dear ${customerName},</p>
        <p>Your order has been successfully placed!</p>
        <br/>
        <table border="1" cellpadding="10">
          <tr>
            <td><strong>Order ID:</strong></td>
            <td>${orderId}</td>
          </tr>
          <tr>
            <td><strong>Total Amount:</strong></td>
            <td>$${totalAmount.toFixed(2)}</td>
          </tr>
          <tr>
            <td><strong>Confirmation Time:</strong></td>
            <td>${new Date().toLocaleString()}</td>
          </tr>
        </table>
        <br/>
        <p>We will send you SMS updates at: ${phone}</p>
        <p>Thank you for your order!</p>
        <br/>
        <footer>Order Confirmation System</footer>
      `
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully!`);
    console.log(`   Preview URL: ${nodemailer.getTestMessageUrl(info)}`);

    // Simulate SMS sending
    console.log(`📱 SMS sent to: ${phone}`);
    console.log(`   Message: Order ${orderId} confirmed. Total: $${totalAmount.toFixed(2)}`);

    // Update order status in Redis
    const orderKey = `order:${orderId}`;
    const order = JSON.parse(await redisClient.get(orderKey));
    order.status = 'CONFIRMED';
    order.confirmationSentAt = new Date().toISOString();
    await redisClient.set(orderKey, JSON.stringify(order), { EX: 86400 });

    console.log(`✔️  Job ${jobId} completed successfully!\n`);
    return true;

  } catch (error) {
    console.error(`❌ Job processing failed:`, error.message);
    return false;
  }
};

// ==================== Start Worker ====================
const startWorker = async () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║   Email/SMS Worker Started                             ║
║   Queue: ${process.env.EMAIL_QUEUE}                           ║
║   Listening for jobs...                                ║
╚════════════════════════════════════════════════════════╝
  `);

  while (true) {
    try {
      // BLPOP: Blocking Left Pop (wait for job with timeout)
      const jobData = await redisClient.blPop(
        process.env.EMAIL_QUEUE,
        30 // 30 second timeout
      );

      if (!jobData) {
        // Timeout - no job available
        continue;
      }

      const job = JSON.parse(jobData.element);
      await processEmailJob(job);

    } catch (error) {
      console.error('Worker error:', error.message);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Start the worker
startWorker().catch(console.error);
