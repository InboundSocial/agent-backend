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
// expects JSON body: { client_id, phone?, email?, name? }
app.post("/tools/find_or_create_contact", async (req, res) => {
  try {
    const { client_id, phone, email, name } = req.body;

    // Basic validation
    if (!client_id || (!phone && !email)) {
      return res
        .status(400)
        .json({ error: "client_id and phone or email are required" });
    }

    // 1) Get this client's GHL credentials from Supabase
    const { data: client, error: dbErr } = await supabase
      .from("clients")
      .select("ghl_token, location_id")
      .eq("id", client_id)
      .single();

    if (dbErr) return res.status(400).json({ error: dbErr.message });
    const { ghl_token, location_id } = client || {};
    if (!ghl_token || !location_id) {
      return res
        .status(400)
        .json({ error: "Missing ghl_token or location_id for this client." });
    }

    const GHL_BASE = "https://rest.gohighlevel.com/v1";

    // 2) Search GHL by phone (preferred) or email
    let searchUrl = new URL(`${GHL_BASE}/contacts/`);
    if (phone) searchUrl.searchParams.set("phone", phone);
    else if (email) searchUrl.searchParams.set("email", email);

    const foundResp = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${ghl_token}` },
    });

    if (!foundResp.ok) {
      const txt = await foundResp.text();
      return res.status(400).json({ error: `GHL search failed: ${txt}` });
    }

    const found = await foundResp.json();
    if (Array.isArray(found?.contacts) && found.contacts.length > 0) {
      const contact = found.contacts[0];
      return res.json({ contactId: contact.id, existed: true, contact });
    }

    // 3) Not found → create a new contact
    const createResp = await fetch(`${GHL_BASE}/contacts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghl_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId: location_id,
        phone: phone || "",
        email: email || "",
        name: name || "",
      }),
    });

    if (!createResp.ok) {
      const txt = await createResp.text();
      return res.status(400).json({ error: `GHL create failed: ${txt}` });
    }

    const created = await createResp.json();
    return res.json({
      contactId: created?.contact?.id,
      existed: false,
      contact: created?.contact,
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
