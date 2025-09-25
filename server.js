import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// ----- Supabase connection (Render env vars) -----
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY environment variables.");
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ----- Basic routes -----
app.get("/", (_req, res) => res.send("agent-backend is running"));
app.get("/health", (_req, res) => res.send("ok"));

// ----- Tool: find_or_create_contact -----
// expects JSON body: { client_id, phone?, email?, name? }
app.post("/tools/find_or_create_contact", async (req, res) => {
  try {
    const { client_id, phone, email, name } = req.body;

    if (!client_id || (!phone && !email)) {
      return res.status(400).json({ error: "client_id and phone or email are required" });
    }

    // 1) Pull GHL creds for this client from Supabase
    const { data: client, error: dbErr } = await supabase
      .from("clients")
      .select("ghl_token, location_id")
      .eq("id", client_id)
      .single();

    if (dbErr) return res.status(400).json({ error: dbErr.message });
    const { ghl_token, location_id } = client || {};
    if (!ghl_token || !location_id) {
      return res.status(400).json({ error: "Missing ghl_token or location_id for this client." });
    }

    const GHL_BASE = "https://services.leadconnectorhq.com";

    // Common headers
    const authHeaders = {
      Authorization: `Bearer ${ghl_token}`,
      Version: "2021-07-28",
    };

    // 2) Try a GET lookup first (locationId as
