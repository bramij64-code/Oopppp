const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json());

// Database file
const DB = "orders.json";
if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({}));

function readDB() {
  return JSON.parse(fs.readFileSync(DB));
}
function writeDB(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

// Root
app.get("/", (req, res) => {
  res.send("ZapUPI Payment Gateway Live 🔥");
});

// Create Order (ZapUPI API)
app.post("/create-order", async (req, res) => {
  const amount = req.body.amount || 10;
  const orderId = "ORDER_" + Date.now();

  try {
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: "YOUR_TOKEN_KEY",
        secret_key: "YOUR_SECRET_KEY",
        amount: amount,
        order_id: orderId
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const zapData = zap.data;

    const db = readDB();
    db[orderId] = {
      amount,
      status: "PENDING",
      payment_url: zapData.payment_url,
      upi_intent: zapData.payment_data,
      utr_check: zapData.utr_check
    };
    writeDB(db);

    res.json({
      success: true,
      orderId,
      payment_page: `https://your-render-url/payment/${orderId}`,
      zapData
    });

  } catch (err) {
    res.json({
      success: false,
      error: err.message
    });
  }
});

// Payment Page (SkillClash Style)
app.get("/payment/:id", (req, res) => {
  const id = req.params.id;
  const db = readDB();

  if (!db[id]) return res.send("Invalid Order ID");

  const amount = db[id].amount;
  const paymentURL = db[id].payment_url;
  const upiLink = db[id].upi_intent;
  const utrCheck = db[id].utr_check;

  const html = `
  <html>
  <body style="text-align:center;font-family:sans-serif;">
      <h2>Pay ₹${amount}</h2>
      <p>Order ID: ${id}</p>

      <h3 id="msg">Waiting for Payment...</h3>

      <a href="${paymentURL}">
        <button style="padding:10px 20px;font-size:18px;background:#00c853;color:#fff;border-radius:8px;border:none;">
          Pay Now (ZapUPI Page)
        </button>
      </a>

      <br><br>
      <a href="${upiLink}">
        <button style="padding:10px 20px;font-size:18px;background:#2962ff;color:#fff;border-radius:8px;border:none;">
          Open UPI App
        </button>
      </a>

      <script>
          setInterval(async () => {
              let res = await fetch("/check-status/${id}");
              let data = await res.json();
              if(data.status === "PAID"){
                  document.getElementById("msg").innerText = "Payment Success! ₹${amount} Added Successfully 🎉";
              }
          }, 2000);
      </script>
  </body>
  </html>
  `;

  res.send(html);
});

// Check Status
app.get("/check-status/:id", async (req, res) => {
  const id = req.params.id;
  const db = readDB();

  if (!db[id]) return res.json({ error: "Invalid ID" });

  // Always fetch latest status from ZapUPI
  try {
    const zapStatus = await axios.get(db[id].utr_check);
    const paid = zapStatus.data.status === "PAID";

    if (paid) {
      db[id].status = "PAID";
      writeDB(db);
    }

    res.json({ status: db[id].status });

  } catch {
    res.json({ status: db[id].status });
  }
});

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running PORT:", PORT));
