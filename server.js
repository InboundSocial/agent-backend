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

// Test: fetch one client row by id (UUID from Supabase)
app.get("/test-client/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json(data);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server_error", details: String(e) });
  }
});

// ----- Tool: find_or_create_contact -----
// expects JSON: { client_id, phone?, email?, name? }
app.post("/tools/find_or_create_contact", async (req, res) => {
  try {
    const { client_id, phone, email, name } = req.body;
    if (!client_id || (!phone && !email)) {
      return res.status(400).json({ error: "client_id and phone or email are required" });
    }

    // 1) Pull creds from Supabase
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
    const baseHeaders = {
      Authorization: `Bearer ${ghl_token}`,
      Version: "2021-07-28",
      LocationId: location_id
    };

    // 2) Try a simple lookup first (GET /contacts)
    if (phone || email) {
      const q = phone ? `phone=${encodeURIComponent(phone)}` : `email=${encodeURIComponent(email)}`;
      const lookupResp = await fetch(`${GHL_BASE}/contacts/?${q}`, { headers: baseHeaders });
      // If lookup allowed + found
      if (lookupResp.ok) {
        const data = await lookupResp.json();
        if (Array.isArray(data.contacts) && data.contacts.length > 0) {
          const contact = data.contacts[0];
          return res.json({ contactId: contact.id, existed: true, contact });
        }
        // if ok but not found -> fall through to create
      }
      // If 403 or other issue, we’ll just create below
    }

    // 3) Create (works with your key)
    const createResp = await fetch(`${GHL_BASE}/contacts/`, {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: location_id,
        phone: phone || "",
        email: email || "",
        name: name || ""
      })
    });

    if (!createResp.ok) {
      const txt = await createResp.text();
      return res.status(400).json({ error: `GHL create failed: ${txt}` });
    }

    const created = await createResp.json();
    return res.json({
      contactId: created?.contact?.id,
      existed: false,
      contact: created?.contact
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server_error", details: String(e) });
  }
});

// ----- Start server -----
app.listen(process.env.PORT || 3000, () => {
  console.log("server running");
});
