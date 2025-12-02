const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// ------------------------------------
// Firebase Firestore Init
// ------------------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});

const db = admin.firestore();

// ------------------------------------
// Home Route
// ------------------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI + Firebase Firestore LIVE 🚀");
});

// ------------------------------------
// Create Order (Call ZapUPI API)
// ------------------------------------
app.post("/create-order", async (req, res) => {
  const amount = req.body.amount || 10;
  const orderId = "ORD" + Date.now();

  try {
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: process.env.ZAPUPI_TOKEN,
        secret_key: process.env.ZAPUPI_SECRET,
        amount: amount,
        order_id: orderId,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const zapData = zap.data;

    // Save to Firestore
    await db.collection("orders").doc(orderId).set({
      orderId,
      amount,
      payment_url: zapData.payment_url,
      upi_intent: zapData.payment_data,
      utr_check: zapData.utr_check,
      status: "PENDING",
      createdAt: Date.now(),
    });

    res.json({
      success: true,
      orderId,
      payment_page: `https://oopppp.onrender.com/payment/${orderId}`,
      zapData,
    });
  } catch (err) {
    res.json({
      success: false,
      error: err.message,
    });
  }
});

// ------------------------------------
// Payment Page (User Will Pay Here)
// ------------------------------------
app.get("/payment/:id", async (req, res) => {
  const id = req.params.id;

  const doc = await db.collection("orders").doc(id).get();
  if (!doc.exists) return res.send("Invalid Order ID");

  const data = doc.data();

  const html = `
  <html>
  <body style="text-align:center; font-family:Arial; padding-top:40px;">
    <h2>Add Money ₹${data.amount}</h2>
    <p>Order ID: ${id}</p>

    <a href="${data.payment_url}">
      <button style="padding:12px 22px; background:#00c853; color:white; border:none; border-radius:10px;">
        Pay Using QR
      </button>
    </a>

    <br><br>

    <a href="${data.upi_intent}">
      <button style="padding:12px 22px; background:#2962ff; color:white; border:none; border-radius:10px;">
        Pay Using UPI App
      </button>
    </a>

    <br><br>

    <h3 id="msg">Waiting for payment...</h3>

    <script>
      setInterval(async () => {
        let res = await fetch("/check-status/${id}");
        let data = await res.json();

        if (data.status === "PAID") {
          document.getElementById("msg").innerHTML = "Payment Successful 🎉";
        }
      }, 2000);
    </script>
  </body>
  </html>
  `;

  res.send(html);
});

// ------------------------------------
// Auto Payment Status Checker
// ------------------------------------
app.get("/check-status/:id", async (req, res) => {
  const id = req.params.id;

  const doc = await db.collection("orders").doc(id).get();
  if (!doc.exists) return res.json({ error: "Invalid Order ID" });

  const order = doc.data();

  try {
    const zap = await axios.get(order.utr_check);

    if (zap.data.status === "PAID") {
      await db.collection("orders").doc(id).update({
        status: "PAID",
      });

      return res.json({ status: "PAID" });
    }

    res.json({ status: order.status });
  } catch (e) {
    res.json({ status: order.status });
  }
});

// ------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on:", PORT));
