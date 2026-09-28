const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.get("/preview", async (req, res) => {
  const target = req.query.url;
  const r = await fetch(target);
  const body = await r.text();
  res.type("text/plain").send(body.slice(0, 2000));
});

app.get("/status", (req, res) => res.json({ ok: true }));

app.listen(3000);
