// Fetches SST from Sofar Spotters and ERDDAP datasets and returns one
// normalized structure for the web page:
// { generatedAt, demo, region, staleAfterHours, sensors: [
//     { id, name, source, lat, lon, latest: {t, v}, series: [{t, v}], error? } ] }

const SOFAR_API = "https://api.sofarocean.com/api";

export async function collectSST(config, env = process.env) {
  const since = new Date(Date.now() - config.historyHours * 3600e3);
  const tasks = [];

  const hasSofar = config.sofar?.enabled && env.SOFAR_TOKEN;
  const hasErddap = (config.erddap || []).length > 0;

  if (env.DEMO === "1" || (!hasSofar && !hasErddap)) {
    return { ...base(config), demo: true, sensors: demoSensors(config, since) };
  }

  if (hasSofar) tasks.push(sofarSensors(config, env.SOFAR_TOKEN, since, env));
  for (const ds of config.erddap || []) {
    tasks.push(
      ds.mode === "profiles" ? erddapProfiles(ds, config)
      : ds.mode === "latestByPlatform" ? erddapLatestByPlatform(ds, config)
      : erddapSensor(ds, since).then((s) => [s])
    );
  }

  const results = await Promise.allSettled(tasks);
  const sensors = [];
  const errors = [];
  for (const r of results) {
    if (r.status === "fulfilled") sensors.push(...r.value);
    else errors.push(String(r.reason?.message || r.reason));
  }
  // Public output: no serial numbers / platform IDs / dataset URLs
  const clean = sensors.map(({ id, link, ...s }, i) => ({ id: `s${i + 1}`, ...s }));
  return { ...base(config), demo: false, sensors: clean, errors };
}

function base(config) {
  return {
    generatedAt: new Date().toISOString(),
    region: config.region,
    staleAfterHours: config.staleAfterHours,
  };
}

// ── Sofar ───────────────────────────────────────────────────
async function sofarGet(path, token) {
  const res = await fetch(`${SOFAR_API}${path}`, { headers: { token } });
  if (!res.ok) throw new Error(`Sofar ${path.split("?")[0]}: error HTTP ${res.status}`);
  return res.json();
}

// SOFAR_SPOTTERS (secret) = "Coliumo=SPOT-XXXX;POSAR=SPOT-YYYY;Coronel=SPOT-ZZZZ"
// keeps the serial numbers out of the public repository.
function spottersFromEnv(v) {
  return String(v || "").split(/[;\n,]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const [name, id] = x.includes("=") ? x.split("=").map((y) => y.trim()) : [undefined, x];
    // Accept "32826C" as well as "SPOT-32826C"
    const full = /^spot-/i.test(id) ? id.toUpperCase() : `SPOT-${id.toUpperCase()}`;
    return { id: full, name };
  });
}
const mask = (id) => (id ? `…${String(id).slice(-3)}` : "?");

async function sofarSensors(config, token, since, env = {}) {
  const fromEnv = spottersFromEnv(env.SOFAR_SPOTTERS);
  const listed = (fromEnv.length ? fromEnv : config.sofar.spotters || [])
    .map((s) => (typeof s === "string" ? { id: s } : s));
  const auto = config.sofar.autoDiscover ?? listed.length === 0;
  const byId = new Map(listed.map((s) => [s.id, { ...s, listed: true }]));

  if (auto) {
    const j = await sofarGet("/devices", token);
    const devs = j.data?.devices || [];
    console.log(`[Sofar] /devices: ${devs.length} boyas en la cuenta: ${devs.map((d) => mask(d.spotterId)).join(", ")}`);
    for (const d of devs) if (!byId.has(d.spotterId)) byId.set(d.spotterId, { id: d.spotterId });
  }
  let n = 0;
  for (const s of byId.values()) {
    s.label = s.name || `Boya Sofar ${++n}`;
    s.tag = s.name ? s.name : mask(s.id);
  }

  const out = await Promise.all(
    [...byId.values()].map(async ({ id, label, tag, listed }) => {
      const base = { id: `sofar:${id}`, name: label, source: "Boya Sofar", series: [] };
      try {
        const r = await sofarTemperature(id, token, since);
        if (!r) {
          console.log(`[Sofar] ${tag}: sin datos de temperatura → ${listed ? "se muestra con aviso" : "omitida"}`);
          return listed ? { ...base, error: "Sin datos de temperatura disponibles para esta boya" } : null;
        }
        const last = r.rows[r.rows.length - 1];
        const s = { ...base, source: `Boya Sofar${r.label ? " · " + r.label : ""}`,
          lat: last.lat, lon: last.lon, latest: { t: last.t, v: last.v },
          series: r.rows.map(({ t, v }) => ({ t, v })) };
        const inside = inBox(s, config.region.bbox);
        console.log(`[Sofar] ${tag}: ${last.v} °C @ ${last.t} (${r.label || "superficie"}), ` +
          `pos ${s.lat?.toFixed?.(3)}, ${s.lon?.toFixed?.(3)} → ${inside || listed ? "se muestra" : "omitida (fuera de la región)"}`);
        return inside || listed ? s : null;
      } catch (e) {
        console.log(`[Sofar] ${tag}: error ${e.message}`);
        return { ...base, error: e.message };
      }
    })
  );
  return out.filter(Boolean);
}

// Temperature for one Spotter, trying in order:
// 1) surface temperature sensor in the window, 2) Smart Mooring / Bristlemouth
// temperature (shallowest sensor) in the window, 3) last surface value ever reported.
async function sofarTemperature(id, token, since) {
  const end = new Date().toISOString();
  const q = new URLSearchParams({ spotterId: id, startDate: since.toISOString(), endDate: end,
    includeWaves: "false", includeSurfaceTempData: "true", limit: "500" });
  const j = await sofarGet(`/wave-data?${q}`, token);
  let rows = surfaceRows(j.data?.surfaceTemp);
  if (rows.length) return { rows };

  try {
    const q2 = new URLSearchParams({ spotterId: id, startDate: since.toISOString(), endDate: end });
    const j2 = await sofarGet(`/sensor-data?${q2}`, token);
    const temps = (j2.data || []).filter((r) =>
      /temp/i.test(String(r.unit_type || "")) || /temp/i.test(String(r.data_type_name || "")));
    const vals = temps.map((r) => ({ ...r, v: Number(r.value) })).filter((r) => Number.isFinite(r.v) && r.v > -3 && r.v < 40);
    if (vals.length) {
      const pos = Math.min(...vals.map((r) => Number(r.sensorPosition ?? 1)));
      rows = vals.filter((r) => Number(r.sensorPosition ?? 1) === pos)
        .map((r) => ({ t: r.timestamp, v: round2(r.v), lat: r.latitude, lon: r.longitude }))
        .sort((a, b) => String(a.t).localeCompare(String(b.t)));
      // Smart Mooring rows may lack position: borrow the Spotter's last track position.
      if (rows.some((r) => !Number.isFinite(r.lat))) {
        const pos2 = await lastPosition(id, token);
        rows = rows.map((r) => (Number.isFinite(r.lat) ? r : { ...r, ...pos2 }));
      }
      if (rows.length) return { rows, label: `sensor de fondeo (posición ${pos})` };
    }
  } catch (e) {
    console.log(`[Sofar] ${mask(id)}: /sensor-data no disponible (${e.message})`);
  }

  const j3 = await sofarGet(`/latest-data?${new URLSearchParams({ spotterId: id, includeSurfaceTempData: "true" })}`, token);
  rows = surfaceRows(j3.data?.surfaceTemp);
  if (rows.length) return { rows: rows.slice(-1), label: "última lectura disponible" };
  return null;
}

function surfaceRows(arr) {
  return (arr || [])
    .filter((r) => Number.isFinite(r.degrees))
    .map((r) => ({ t: r.timestamp, v: r.degrees, lat: r.latitude, lon: r.longitude }))
    .sort((a, b) => String(a.t).localeCompare(String(b.t)));
}

async function lastPosition(id, token) {
  const j = await sofarGet(`/latest-data?${new URLSearchParams({ spotterId: id })}`, token);
  const tr = j.data?.track || [];
  const w = j.data?.waves || [];
  const p = tr[tr.length - 1] || w[w.length - 1] || {};
  return { lat: p.latitude, lon: p.longitude };
}

function inBox(s, [south, west, north, east]) {
  return s.lat >= south && s.lat <= north && s.lon >= west && s.lon <= east;
}

// ── ERDDAP ──────────────────────────────────────────────────
async function erddapSensor(ds, since) {
  const timeVar = ds.timeVar || "time";
  const hasPos = !(Number.isFinite(ds.lat) && Number.isFinite(ds.lon));
  const vars = [timeVar, ds.tempVar, ...(hasPos ? ["latitude", "longitude"] : [])];
  const constraints = [`${timeVar}>=${since.toISOString()}`];
  if (ds.stationVar) constraints.push(`${ds.stationVar}="${ds.stationValue}"`);
  constraints.push(`orderBy("${timeVar}")`);

  const url =
    `${ds.server.replace(/\/$/, "")}/tabledap/${encodeURIComponent(ds.datasetId)}.json?` +
    [vars.join(","), ...constraints].map(encodeURIComponent).join("&");

  const sensor = {
    id: `erddap:${ds.datasetId}${ds.stationValue ? ":" + ds.stationValue : ""}`,
    name: ds.name || ds.datasetId,
    source: "ERDDAP",
    link: url.replace(".json?", ".htmlTable?"),
    series: [],
  };

  try {
    const res = await fetch(url);
    // ERDDAP answers 404 "Your query produced no matching results" when the window is empty.
    if (res.status === 404) throw new Error("sin datos en el período consultado");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const cols = j.table.columnNames;
    const iT = cols.indexOf(timeVar), iV = cols.indexOf(ds.tempVar);
    const iLat = cols.indexOf("latitude"), iLon = cols.indexOf("longitude");
    const rows = j.table.rows
      .filter((r) => Number.isFinite(r[iV]))
      .sort((a, b) => String(a[iT]).localeCompare(String(b[iT])));
    if (!rows.length) throw new Error("sin valores válidos de TSM en el período consultado");
    sensor.series = rows.map((r) => ({ t: r[iT], v: r[iV] }));
    const last = rows[rows.length - 1];
    sensor.latest = { t: last[iT], v: last[iV] };
    sensor.lat = hasPos ? last[iLat] : ds.lat;
    sensor.lon = hasPos ? last[iLon] : ds.lon;
  } catch (e) {
    sensor.error = `ERDDAP ${ds.datasetId}: ${e.message}`;
    if (!hasPos) { sensor.lat = ds.lat; sensor.lon = ds.lon; }
  }
  return sensor;
}

// ── ERDDAP profile datasets (e.g. FVON fishing-vessel profiles) ──
// Moving platforms: for each vessel (groupVar) inside the region, returns only the
// latest surface value = shallowest reading (≤ maxDepth) of its most recent profile.
async function erddapProfiles(ds, config) {
  const lookback = ds.historyHours || config.historyHours;
  const since = new Date(Date.now() - lookback * 3600e3);
  const [south, west, north, east] = ds.bbox || config.region.bbox;
  const maxDepth = ds.maxDepth ?? 5;
  const [vMin, vMax] = ds.validRange || [-2, 35];
  const timeVar = ds.timeVar || "time";
  const profVar = ds.profileVar || "profile_id";
  const groupVar = ds.groupVar || "WMO_ID";
  const depthVar = ds.depthVar || "depth";

  const vars = [timeVar, "latitude", "longitude", depthVar, ds.tempVar, profVar, groupVar];
  const constraints = [
    `${timeVar}>=${since.toISOString()}`,
    `latitude>=${south}`, `latitude<=${north}`,
    `longitude>=${west}`, `longitude<=${east}`,
    `${depthVar}<=${maxDepth}`,
    `${ds.tempVar}>=${vMin}`, `${ds.tempVar}<=${vMax}`,
  ];
  const url =
    `${ds.server.replace(/\/$/, "")}/tabledap/${encodeURIComponent(ds.datasetId)}.json?` +
    [vars.join(","), ...constraints].map(encodeURIComponent).join("&");

  const res = await fetch(url);
  if (res.status === 404) {
    // ERDDAP's way of saying "no rows": not an error, just nothing recent in the area.
    return [{ id: `erddap:${ds.datasetId}`, name: ds.name || ds.datasetId, source: ds.sourceLabel || "ERDDAP",
      error: `Sin perfiles en la región en los últimos ${Math.round(lookback / 24)} días`, series: [] }];
  }
  if (!res.ok) throw new Error(`ERDDAP ${ds.datasetId}: HTTP ${res.status}`);
  const j = await res.json();
  const c = Object.fromEntries(j.table.columnNames.map((n, i) => [n, i]));

  // 1) group readings into profiles
  const profiles = new Map();
  for (const r of j.table.rows) {
    const v = r[c[ds.tempVar]];
    if (!Number.isFinite(v) || v < vMin || v > vMax) continue;
    const key = String(r[c[profVar]]);
    let p = profiles.get(key);
    if (!p) profiles.set(key, (p = { group: r[c[groupVar]] || "sin ID", t: r[c[timeVar]], rows: [] }));
    p.rows.push({ d: r[c[depthVar]], v, lat: r[c.latitude], lon: r[c.longitude] });
    if (r[c[timeVar]] < p.t) p.t = r[c[timeVar]];
  }

  // 2) surface value of each profile = its shallowest reading(s)
  //    (median if several readings share the minimum depth, within 0.5 m)
  // 3) keep only the most recent profile of each vessel
  const latestByVessel = new Map();
  for (const p of profiles.values()) {
    const dMin = Math.min(...p.rows.map((r) => r.d));
    const top = p.rows.filter((r) => r.d <= dMin + 0.5);
    const pt = { t: p.t, v: round2(median(top.map((r) => r.v))), d: round2(dMin),
      lat: mean(top.map((r) => r.lat)), lon: mean(top.map((r) => r.lon)) };
    const prev = latestByVessel.get(p.group);
    if (!prev || String(pt.t) > String(prev.t)) latestByVessel.set(p.group, pt);
  }

  const sortedV = [...latestByVessel.entries()].sort((a, b) => String(b[1].t).localeCompare(String(a[1].t)));
  return sortedV.map(([g, last], i) => ({
    id: `erddap:${ds.datasetId}:${g}`,
    name: `${ds.itemName || "Buque pesquero"} ${i + 1}`,
    source: `${ds.sourceLabel || "ERDDAP"} · último perfil, a ${last.d.toFixed(1)} m`,
    mobile: true,
    staleAfterHours: ds.staleAfterHours,
    lat: last.lat, lon: last.lon,
    latest: { t: last.t, v: last.v },
    series: [],
  }));
}

// ── ERDDAP moving platforms reporting surface values (e.g. GDP drifters via OSMC) ──
// Returns the latest value of each platform (groupVar) seen inside ds.bbox.
async function erddapLatestByPlatform(ds, config) {
  const lookback = ds.historyHours || config.historyHours;
  const since = new Date(Date.now() - lookback * 3600e3);
  const [south, west, north, east] = ds.bbox || config.region.bbox;
  const [vMin, vMax] = ds.validRange || [-2, 35];
  const timeVar = ds.timeVar || "time";
  const groupVar = ds.groupVar || "platform_code";

  const vars = [timeVar, "latitude", "longitude", ds.tempVar, groupVar];
  const constraints = [
    `${timeVar}>=${since.toISOString()}`,
    `latitude>=${south}`, `latitude<=${north}`,
    `longitude>=${west}`, `longitude<=${east}`,
    `${ds.tempVar}>=${vMin}`, `${ds.tempVar}<=${vMax}`,
    ...Object.entries(ds.filters || {}).map(([k, v]) => `${k}="${v}"`),
  ];
  const url =
    `${ds.server.replace(/\/$/, "")}/tabledap/${encodeURIComponent(ds.datasetId)}.json?` +
    [vars.join(","), ...constraints].map(encodeURIComponent).join("&");

  const res = await fetch(url);
  if (res.status === 404) {
    console.log(`[${ds.name}] sin datos en ${south}..${north}°, ${west}..${east}° desde ${since.toISOString()}`);
    return [{ id: `erddap:${ds.datasetId}:${ds.name}`, name: ds.name || ds.datasetId, source: ds.sourceLabel || "ERDDAP",
      error: `Sin observaciones en el área en los últimos ${Math.round(lookback / 24)} días`, series: [] }];
  }
  if (!res.ok) throw new Error(`${ds.name || ds.datasetId}: HTTP ${res.status}`);
  const j = await res.json();
  const c = Object.fromEntries(j.table.columnNames.map((n, i) => [n, i]));

  const latest = new Map();
  for (const r of j.table.rows) {
    const v = r[c[ds.tempVar]];
    if (!Number.isFinite(v) || v < vMin || v > vMax) continue;
    const g = String(r[c[groupVar]] ?? "sin ID");
    const pt = { t: r[c[timeVar]], v, lat: r[c.latitude], lon: r[c.longitude] };
    const prev = latest.get(g);
    if (!prev || String(pt.t) > String(prev.t)) latest.set(g, pt);
  }
  console.log(`[${ds.name}] ${latest.size} plataformas: ` +
    [...latest].map(([g, p]) => `${mask(g)}=${p.v}°C@${p.t}`).join(", "));

  const sortedP = [...latest.entries()].sort((a, b) => String(b[1].t).localeCompare(String(a[1].t)));
  return sortedP.map(([g, p], i) => ({
    id: `erddap:${ds.datasetId}:${g}`,
    name: `${ds.itemName || "Boya de deriva"} ${i + 1}`,
    source: ds.sourceLabel || "ERDDAP",
    mobile: true,
    staleAfterHours: ds.staleAfterHours,
    lat: p.lat, lon: p.lon,
    latest: { t: p.t, v: round2(p.v) },
    series: [],
  }));
}

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const round2 = (x) => Math.round(x * 100) / 100;

// ── Demo data (shown when nothing is configured, or DEMO=1) ─
function demoSensors(config, since) {
  const sites = [
    ["Bahía de Concepción", -36.68, -73.04, 13.1],
    ["Golfo de Arauco", -37.12, -73.35, 12.6],
    ["Coliumo", -36.54, -72.96, 12.2],
    ["Isla Santa María", -37.03, -73.53, 13.4],
    ["Lebu", -37.6, -73.68, 12.9],
  ];
  const now = Date.now();
  return sites.map(([name, lat, lon, mean], i) => {
    const series = [];
    for (let t = since.getTime(); t <= now - i * 20 * 60e3; t += 30 * 60e3) {
      const h = (t / 3600e3) % 24;
      const v = mean + 0.6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + 0.15 * Math.sin(t / 7e6 + i);
      series.push({ t: new Date(t).toISOString(), v: Math.round(v * 100) / 100 });
    }
    return {
      id: `demo:${i}`, name, source: i % 2 ? "ERDDAP" : "Sofar Spotter",
      lat, lon, latest: series[series.length - 1], series,
    };
  });
}
