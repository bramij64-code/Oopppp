import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();
app.use(cors());
app.use(bodyParser.json());

let users = {}; 
// Example: users["raj"] = { coins: 100 };

app.post("/zapupi-webhook", (req, res) => {
  const data = req.body;

  const paidAmount = data.amount; // ZapUPI sends this
  const userId = data.note;       // You pass NOTE=userid during payment

  if (!userId) {
    return res.status(400).json({ message: "User ID not found!" });
  }

  if (!users[userId]) users[userId] = { coins: 0 };

  // Example: 1 টাকা = 100 কয়েন
  users[userId].coins += paidAmount * 100;

  console.log(`Payment Verified for ${userId}, Added Coins: ${paidAmount * 100}`);

  return res.json({ success: true });
});

// Get user coin
app.get("/coins/:id", (req, res) => {
  const id = req.params.id;
  if (!users[id]) return res.json({ coins: 0 });

  res.json({ coins: users[id].coins });
});

app.listen(3000, () => console.log("Server Running on 3000"));
