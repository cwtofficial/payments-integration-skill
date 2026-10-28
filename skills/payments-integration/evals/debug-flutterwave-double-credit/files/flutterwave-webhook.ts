import { Router } from "express";
import axios from "axios";
import { prisma } from "../lib/prisma";

const router = Router();

async function creditForPayment(txRef: string, transactionId: number) {
  const payment = await prisma.payment.findUnique({ where: { txRef } });
  if (!payment || payment.status === "successful") return;

  const { data } = await axios.get(
    `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
    { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
  );

  if (data.status === "success") {
    await prisma.wallet.update({
      where: { userId: payment.userId },
      data: { balance: { increment: data.data.amount } },
    });
    await prisma.payment.update({
      where: { txRef },
      data: { status: "successful", flwTransactionId: transactionId },
    });
  }
}

router.post("/webhooks/flutterwave", async (req, res) => {
  if (req.headers["verif-hash"] !== process.env.FLW_SECRET_HASH) {
    return res.sendStatus(401);
  }
  const { event, data } = req.body;
  if (event === "charge.completed") {
    await creditForPayment(data.tx_ref, data.id);
  }
  res.sendStatus(200);
});

// User lands here after paying
router.get("/payments/flutterwave/callback", async (req, res) => {
  const { tx_ref, transaction_id } = req.query as Record<string, string>;
  await creditForPayment(tx_ref, Number(transaction_id));
  res.redirect("/wallet");
});

export default router;
