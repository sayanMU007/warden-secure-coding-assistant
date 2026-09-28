const express = require("express");
const app = express();

const items = ["apple", "banana", "cherry", "date"];

app.get("/search", (req, res) => {
  const q = req.query.q || "";
  const hits = items.filter((i) => i.includes(q));
  res.send("<h1>Results for " + q + "</h1><ul>" + hits.map((h) => "<li>" + h + "</li>").join("") + "</ul>");
});

app.listen(3000);
