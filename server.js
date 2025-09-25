import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// connect to Supabase using env vars from Render
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get("/health", (req, res) => res.send("ok"));

// test route: fetch one client row by id
app.get("/test-client/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("server running");
});
