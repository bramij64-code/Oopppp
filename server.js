const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json());

// ---------------------------
// Database file
// ---------------------------
const DB = "orders.json";
if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({}));

function readDB() {
  return JSON.parse(fs.readFileSync(DB));
}

function writeDB(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

// ---------------------------
// Root Route
// ---------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI Payment Gateway Live 🔥");
});

// ---------------------------
// Create Order (ZapUPI)
// ---------------------------
app.post("/create-order", async (req, res) => {
  const amount = req.body.amount || 10;
  const orderId = "ORDER_" + Date.now();

  try {
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: "4637a43f8e8db38a97a5d68a110758d3",      // ← তোমার ZapUPI Token বসাও
        secret_key: "40961dcda5338e0cad148a6838fc3dbb",    // ← তোমার ZapUPI Secret বসাও
        amount: amount,
        order_id: orderId
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const zapData = zap.data;

    // Save order in DB
    const db = readDB();
    db[orderId] = {
      orderId,
      amount,
      status: "PENDING",
      utr_check: zapData.utr_check,
      payment_url: zapData.payment_url,
      upi_intent: zapData.payment_data
    };
    writeDB(db);

    res.json({
      success: true,
      orderId,
      payment_page: `https://oopppp.onrender.com/payment/${orderId}`,
      zapData
    });

  } catch (err) {
    res.json({
      success: false,
      error: err.message
    });
  }
});

// ---------------------------
// Payment Page (SkillClash Style)
// ---------------------------
app.get("/payment/:id", (req, res) => {
  const id = req.params.id;
  const db = readDB();

  if (!db[id]) return res.send("Invalid Order ID");

  const { amount, payment_url, upi_intent } = db[id];

  const html = `
  <html>
  <body style="font-family: Arial; text-align: center; padding-top: 40px;">
    
      <h2>Add Money ₹${amount}</h2>
      <p>Order ID: ${id}</p>

      <br>

      <a href="${payment_url}">
        <button style="
          padding: 12px 22px;
          background: #00c853;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 18px;
        ">Pay Using QR</button>
      </a>

      <br><br>

      <a href="${upi_intent}">
        <button style="
          padding: 12px 22px;
          background: #2962ff;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 18px;
        ">Pay Using UPI App</button>
      </a>

      <br><br>

      <h3 id="msg">Waiting for payment...</h3>

      <script>
        setInterval(async () => {
          let res = await fetch("/check-status/${id}");
          let data = await res.json();

          if (data.status === "PAID") {
            document.getElementById("msg").innerHTML =
             "Payment Success! ₹${amount} Added 🎉";
          }
        }, 2000);
      </script>

  </body>
  </html>
  `;

  res.send(html);
});

// ---------------------------
// Auto Status Check
// ---------------------------
app.get("/check-status/:id", async (req, res) => {
  const id = req.params.id;
  const db = readDB();

  if (!db[id]) return res.json({ error: "Invalid order" });

  try {
    // Check live status from ZapUPI
    const zapStatus = await axios.get(db[id].utr_check);

    if (zapStatus.data.status === "PAID") {
      db[id].status = "PAID";
      writeDB(db);
    }

    res.json({ status: db[id].status });

  } catch (e) {
    res.json({ status: db[id].status });
  }
});

// ---------------------------
// Health Check
// ---------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running:", PORT));
