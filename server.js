require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json()); // for webhook JSON
app.use(bodyParser.urlencoded({ extended: true })); // if you want to accept form posts

// Initialize Firebase Admin
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!fs.existsSync(serviceAccountPath)) {
  console.error('Firebase service account JSON not found at', serviceAccountPath);
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});
const db = admin.database();

const ZAPUPI_CREATE_URL = 'https://api.zapupi.com/api/create-order';
const TOKEN_KEY = process.env.ZAPUPI_TOKEN_KEY;
const SECRET_KEY = process.env.ZAPUPI_SECRET_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || SECRET_KEY; // use if given separately

// Utility: verify webhook HMAC (example; adapt to zapupi header name and algorithm)
function verifySignature(rawBody, headerSignature) {
  if (!headerSignature) return false;
  const computed = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(headerSignature));
}

// Endpoint: create-order (client calls this)
app.post('/create-order', async (req, res) => {
  try {
    const { order_id, amount, customer_mobile, metadata } = req.body;
    if (!order_id || !amount) return res.status(400).json({ error: 'order_id and amount required' });

    const ordersRef = db.ref('orders').child(order_id);

    // Use transaction to prevent race / duplicate
    const txResult = await ordersRef.transaction(current => {
      if (current === null) {
        // not exist -> create a pending order record
        return {
          order_id,
          amount: Number(amount),
          status: 'CREATED',
          created_at: Date.now(),
          customer_mobile: customer_mobile || null,
          metadata: metadata || null
        };
      } else {
        // already exists -> abort transaction (return undefined keeps value unchanged)
        return; // abort
      }
    }, (error, committed, snapshot) => {
      // callback not strictly needed; we'll check committed below
    }, false);

    // The transaction returns a Promise but some admin SDK versions return differently; read back
    const snapshot = await ordersRef.once('value');
    const exists = snapshot.exists();
    const orderData = snapshot.val();

    if (!exists) {
      // should not happen — transaction didn't create
      return res.status(500).json({ error: 'Failed to reserve order_id' });
    }

    if (orderData.status !== 'CREATED') {
      // if it existed before and not created in this call -> it's duplicate
      return res.status(409).json({ error: 'order_id already exists', order: orderData });
    }

    // Prepare form-urlencoded body for ZapUPI
    const params = new URLSearchParams();
    params.append('token_key', TOKEN_KEY);
    params.append('secret_key', SECRET_KEY);
    params.append('amount', String(Math.round(Number(amount)))); // integer rupees/paise per API
    params.append('order_id', order_id);
    if (customer_mobile) params.append('customer_mobile', customer_mobile);

    // Call ZapUPI create-order
    const zapResp = await axios.post(ZAPUPI_CREATE_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000
    });

    // Example: zapResp.data likely contains payment_url or payment_link and some ids
    // Save response in Firebase under orders/{order_id}/zapupi_response
    await ordersRef.update({
      zapupi_response: zapResp.data,
      zapupi_created_at: Date.now()
    });

    // Return ZapUPI response to client
    return res.json({ success: true, zapupi: zapResp.data });
  } catch (err) {
    console.error('create-order error', err?.response?.data || err.message || err);
    return res.status(500).json({ error: 'server_error', details: err?.response?.data || err.message });
  }
});

// Endpoint: webhook to receive payment status updates from ZapUPI
// Make sure in ZapUPI dashboard you set webhook URL to https://yourdomain.com/webhook
app.post('/webhook', bodyParser.raw({ type: '*/*' }), async (req, res) => {
  try {
    const rawBody = req.body; // Buffer
    const headerSig = req.headers['x-zapupi-signature'] || req.headers['x-signature'] || null;

    // Verify signature if available
    if (headerSig) {
      const ok = verifySignature(rawBody, headerSig.toString());
      if (!ok) {
        console.warn('Webhook signature mismatch');
        return res.status(400).send('invalid signature');
      }
    }

    // Parse JSON
    const payload = JSON.parse(rawBody.toString('utf8'));
    // Expected example payload: { order_id: 'Abc123', status: 'SUCCESS', txn_id: '...', amount: 100, ... }
    const { order_id, status } = payload;
    if (!order_id) return res.status(400).send('missing order_id');

    const ordersRef = db.ref('orders').child(order_id);
    const snap = await ordersRef.once('value');
    if (!snap.exists()) {
      // optionally create record if not exists
      await ordersRef.set({
        order_id,
        amount: payload.amount || null,
        status: status || 'UNKNOWN',
        zapupi_webhook_payload: payload,
        updated_at: Date.now()
      });
      return res.status(200).send('created record');
    }

    // Update the order with webhook payload; ensure idempotency: only update if status changed
    const existing = snap.val();
    if (existing.status === status) {
      // already processed
      return res.status(200).send('already processed');
    }

    await ordersRef.update({
      status: status,
      zapupi_webhook_payload: payload,
      updated_at: Date.now()
    });

    // Optionally: if success, credit coins etc — do safe checks before adding
    if (status === 'SUCCESS' || status === 'PAID') {
      // e.g. mark credited true after checking not already credited
      if (!existing.credited) {
        await ordersRef.update({
          credited: true,
          credited_at: Date.now()
        });
        // add coins to user wallet etc (implement as needed)
      }
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).send('server error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on', PORT));
