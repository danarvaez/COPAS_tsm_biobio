// Genera public/data/sst.json con las últimas lecturas.
// Lo ejecuta la GitHub Action cada 30 minutos (SOFAR_TOKEN viene de los secrets del repo).
import { mkdir, writeFile } from "node:fs/promises";
import sensors from "../sensors.config.mjs";
import { collectSST } from "../lib/sources.mjs";

const out = new URL("../public/data/sst.json", import.meta.url);
const data = await collectSST(sensors, process.env);
await mkdir(new URL(".", out), { recursive: true });
await writeFile(out, JSON.stringify(data));
console.log(`sst.json: ${data.sensors.length} sensores, demo=${data.demo}, errores=${(data.errors || []).length}`);
for (const s of data.sensors) console.log(` - ${s.name}: ${s.latest ? `${s.latest.v} °C @ ${s.latest.t}` : s.error}`);
