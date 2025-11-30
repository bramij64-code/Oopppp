import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(bodyParser.json());

let users = {};

const TOKEN_KEY = "4637a43f8e8db38a97a5d68a110758d3";
const SECRET_KEY = "40961dcda5338e0cad148a6838fc3dbb";

// 🔹 Step 1 → CREATE ORDER API
app.post("/create-order", async (req, res) => {
  const { amount, userId } = req.body;

  try {
    const response = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: TOKEN_KEY,
        secret_key: SECRET_KEY,
        amount: amount,
        order_id: "order_" + Date.now(),
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    // Checkout Link Return
    const checkoutURL = `${response.data.data.payment_url}?note=${userId}`;
    return res.json({ url: checkoutURL });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 🔹 Step 2 → WEBHOOK (payment success)
app.post("/zapupi-webhook", (req, res) => {
  const data = req.body;

  const paidAmount = data.amount;
  const userId = data.note;

  if (!users[userId]) users[userId] = { coins: 0 };

  users[userId].coins += paidAmount * 100;

  console.log(`✓ Payment Verified: ${userId}, Added Coins = ${paidAmount * 100}`);
  res.json({ success: true });
});

// 🔹 Step 3 → CHECK COINS
app.get("/coins/:id", (req, res) => {
  const id = req.params.id;
  if (!users[id]) users[id] = { coins: 0 };

  res.json({ coins: users[id].coins });
});

app.listen(3000, () => console.log("🔥 Server Running on Port 3000"));
