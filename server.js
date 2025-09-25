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

    // 2) Try a GET lookup first (locationId as QUERY PARAM — per docs)
    const searchUrl = new URL(`${GHL_BASE}/contacts/`);
    searchUrl.searchParams.set("locationId", location_id);
    if (phone) searchUrl.searchParams.set("phone", phone);
    else if (email) searchUrl.searchParams.set("email", email);

    let foundResp = await fetch(searchUrl.toString(), { headers: authHeaders });

    if (foundResp.ok) {
      const found = await foundResp.json();
      if (Array.isArray(found?.contacts) && found.contacts.length > 0) {
        const contact = found.contacts[0];
        return res.json({ contactId: contact.id, existed: true, contact });
      }
      // not found → proceed to create
    } else {
      // if lookup blocked or fails, we'll proceed to create
    }

    // 3) Create contact (locationId in body + LocationId header)
    const createHeaders = {
      ...authHeaders,
      "Content-Type": "application/json",
      LocationId: location_id,
    };

    const createResp = await fetch(`${GHL_BASE}/contacts/`, {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify({
        locationId: location_id,
        phone: phone || "",
        email: email || "",
        name: name || "",
      }),
    });

    const createTxt = await createResp.text();
    let created;
    try { created = JSON.parse(createTxt); } catch { created = {}; }

    // Handle duplicate error (400) and return existing ID
    if (createResp.status === 400 && created?.meta?.contactId) {
      return res.json({
        contactId: created.meta.contactId,
        existed: true,
        duplicate: true,
        contact: null,
      });
    }

    if (!createResp.ok) {
      return res.status(400).json({ error: `GHL create failed: ${createTxt}` });
    }

    // New contact created
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
