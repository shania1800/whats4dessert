// api/content.js
// Vercel Serverless Function — proxies Airtable so the API key
// never touches the browser. Deploy this to /api/content.js in
// your Vercel project.

module.exports = async function handler(req, res) {
  // ── CORS ─────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const TOKEN   = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!TOKEN || !BASE_ID) {
    return res.status(500).json({
      error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID environment variables."
    });
  }

  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };

  // Helper: fetch all records from a table (handles Airtable pagination)
  async function fetchTable(tableName, params = "") {
    let records = [];
    let offset  = null;

    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}?${params}${offset ? `&offset=${offset}` : ""}`;
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Airtable error on ${tableName}: ${err}`);
      }

      const data = await response.json();
      records = records.concat(data.records || []);
      offset  = data.offset || null;
    } while (offset);

    return records;
  }

  try {
    // ── Fetch all three tables in parallel ─────────────────────
    const [menuRaw, hoursRaw, galleryRaw] = await Promise.all([
      fetchTable("menu_items",  "filterByFormula={available}=1&sort[0][field]=sort_order&sort[0][direction]=asc"),
      fetchTable("hours",       "sort[0][field]=sort_order&sort[0][direction]=asc"),
      fetchTable("gallery",     "filterByFormula={active}=1&sort[0][field]=sort_order&sort[0][direction]=asc"),
    ]);

    // ── Shape menu data ────────────────────────────────────────
    const menu = menuRaw.map(r => ({
      id:          r.id,
      name:        r.fields.name        || "",
      description: r.fields.description || "",
      price:       r.fields.price       || "",
      category:    r.fields.category    || "",
      emoji:       r.fields.emoji       || "🍫",
      // Airtable attachment: grab the first image's URL if present
      image:       r.fields.image?.[0]?.url || null,
    }));

    // ── Shape hours data ───────────────────────────────────────
    const hours = hoursRaw.map(r => ({
      day:   r.fields.day   || "",
      hours: r.fields.hours || "",
    }));

    // ── Shape gallery data ─────────────────────────────────────
    const gallery = galleryRaw.map(r => ({
      id:      r.id,
      label:   r.fields.label   || "",
      caption: r.fields.caption || "",
      image:   r.fields.image?.[0]?.url || null,
    }));

    // ── Cache for 60 seconds at the CDN edge ──────────────────
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    return res.status(200).json({ menu, hours, gallery });

  } catch (err) {
    console.error("Airtable fetch failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
