import express from "express";
const app = express();
app.use(express.json());

// health check
app.get("/health", (req, res) => res.send("ok"));

// placeholder tool endpoint (we'll fill this next)
app.post("/tools/find_or_create_contact", async (req, res) => {
  return res.json({ ok: true, received: req.body });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("server running");
});
