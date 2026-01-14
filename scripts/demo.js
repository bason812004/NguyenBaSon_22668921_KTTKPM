#!/usr/bin/env node

/**
 * Demo Script: Test the Order API with JWT and Message Queue
 * 
 * Usage:
 *   node scripts/demo.js
 * 
 * What it does:
 * 1. Login and get JWT token
 * 2. Create multiple orders (they go to queue immediately)
 * 3. Show queue status
 * 4. Check order status
 */

const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 3000;

let jwtToken = null;

// Helper function to make HTTP requests
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (jwtToken) {
      options.headers['Authorization'] = `Bearer ${jwtToken}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(body)
          });
        } catch {
          resolve({
            status: res.statusCode,
            data: body
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function demo() {
  console.log(`
╔════════════════════════════════════════════════════════╗
║  Demo: Order API with Redis Queue & JWT Auth          ║
║                                                        ║
║  Scenario: User places order → Email job queued       ║
║           Email worker sends confirmation in background║
╚════════════════════════════════════════════════════════╝
  `);

  try {
    // Step 1: Login and get JWT token
    console.log('\n[Step 1] Getting JWT token...');
    const loginResponse = await makeRequest('POST', '/login');
    if (loginResponse.status !== 200) {
      throw new Error('Login failed');
    }
    jwtToken = loginResponse.data.token;
    console.log('✅ Login successful!');
    console.log(`   Token: ${jwtToken.substring(0, 50)}...`);
    console.log(`   Expires: ${loginResponse.data.expiresIn}`);

    // Step 2: Create orders
    console.log('\n[Step 2] Creating orders (jobs pushed to queue)...');
    const orders = [
      {
        items: [
          { name: 'Laptop Dell XPS 13', price: 999.99 },
          { name: 'USB-C Cable', price: 15.99 }
        ],
        customerEmail: 'customer1@example.com',
        customerPhone: '+84901234567'
      },
      {
        items: [
          { name: 'iPhone 15 Pro', price: 1299.99 }
        ],
        customerEmail: 'customer2@example.com',
        customerPhone: '+84912345678'
      }
    ];

    const createdOrders = [];
    for (let i = 0; i < orders.length; i++) {
      const orderResponse = await makeRequest('POST', '/orders', orders[i]);
      if (orderResponse.status === 201) {
        createdOrders.push(orderResponse.data.orderId);
        console.log(`✅ Order ${i + 1} created: ${orderResponse.data.orderId}`);
        console.log(`   Message: ${orderResponse.data.message}`);
      }
    }

    // Step 3: Check queue status
    console.log('\n[Step 3] Queue status:');
    const queueResponse = await makeRequest('GET', '/queue/status');
    console.log(`✅ Queue Info:`);
    console.log(`   Pending jobs: ${queueResponse.data.pendingJobs}`);
    console.log(`   Status: ${queueResponse.data.status}`);

    // Step 4: Check order status
    console.log('\n[Step 4] Checking order status:');
    for (const orderId of createdOrders) {
      const orderResponse = await makeRequest('GET', `/orders/${orderId}`);
      console.log(`✅ Order ${orderId}`);
      console.log(`   Status: ${orderResponse.data.status}`);
      console.log(`   Amount: $${orderResponse.data.totalAmount.toFixed(2)}`);
      console.log(`   Email: ${orderResponse.data.customerEmail}`);
    }

    console.log(`
╔════════════════════════════════════════════════════════╗
║  Demo Complete!                                        ║
║                                                        ║
║  Check the Worker output to see:                      ║
║  • Email jobs being processed                         ║
║  • Order status changing to CONFIRMED                 ║
║                                                        ║
║  Run worker with: npm run worker                      ║
╚════════════════════════════════════════════════════════╝
    `);

  } catch (error) {
    console.error('❌ Demo error:', error.message);
  }
}

demo();
