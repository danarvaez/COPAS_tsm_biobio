// Servidor local de prueba:  npm start  → http://localhost:8080
// Genera data/sst.json en vivo con el mismo código que la GitHub Action. Lee SOFAR_TOKEN de .env.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import sensors from "./sensors.config.mjs";
import { collectSST } from "./lib/sources.mjs";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const root = join(import.meta.dirname, "public");

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/data/sst.json") {
    try {
      const data = await collectSST(sensors, process.env);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500).end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  const file = normalize(join(root, path === "/" ? "index.html" : path));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("Not found"); }
}).listen(process.env.PORT || 8080, () => console.log(`SST Biobío on http://localhost:${process.env.PORT || 8080}`));
