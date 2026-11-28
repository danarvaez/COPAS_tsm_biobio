// SST Biobío – front end. Reads /api/sst and draws summary, map, cards.
(() => {
  const API = "data/sst.json"; // generado por la GitHub Action
  const REFRESH_MS = 5 * 60e3;
  const T_MIN = 9, T_MAX = 20; // colour scale range, °C

  const $ = (id) => document.getElementById(id);
  let map, layer, markers = {};

  // ── colour scale (cool blue → teal → yellow → red) ──
  const stops = [[0, [37, 99, 175]], [0.35, [20, 150, 170]], [0.65, [234, 179, 8]], [1, [200, 50, 40]]];
  function color(v) {
    const x = Math.max(0, Math.min(1, (v - T_MIN) / (T_MAX - T_MIN)));
    for (let i = 1; i < stops.length; i++) {
      if (x <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (x - a) / (b - a);
        return `rgb(${ca.map((c, k) => Math.round(c + f * (cb[k] - c))).join(",")})`;
      }
    }
    return "rgb(200,50,40)";
  }

  const fmt = (v) => v.toFixed(1);
  function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso)) / 60e3);
    if (m < 1) return "recién";
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
  }
  const localTime = (iso) =>
    new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  // ── map ──
  function initMap(region) {
    if (map) return;
    const [s, w, n, e] = region.bbox;
    map = L.map("map", { zoomControl: false, attributionControl: false }).fitBounds([[s, w], [n, e]]);
    // Batimetría GEBCO (WMS público, sin clave; capa más reciente: relieve sombreado)
    L.tileLayer.wms("https://wms.gebco.net/mapserv?", {
      layers: "gebco_latest", format: "image/png", maxZoom: 13,
    }).addTo(map);
    // Nombres de localidades costeras (dibujados aquí, sin servicios externos)
    const places = [
      ["Dichato", -36.546, -72.933], ["Tomé", -36.617, -72.957], ["Penco", -36.739, -72.995],
      ["Talcahuano", -36.724, -73.117], ["Concepción", -36.827, -73.050], ["Coronel", -37.030, -73.150],
      ["Lota", -37.091, -73.157], ["Arauco", -37.247, -73.317], ["Lebu", -37.608, -73.651],
      ["Isla Santa María", -37.030, -73.530], ["Tirúa", -38.343, -73.493],
    ];
    for (const [n, la, lo] of places) {
      L.marker([la, lo], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: "place", html: `<span>${n}</span>`, iconSize: null }),
      }).addTo(map);
    }
    L.control.zoom({ position: "bottomright" }).addTo(map);
    layer = L.layerGroup().addTo(map);
    $("legend").innerHTML =
      `<span>${T_MIN}°</span><span class="bar" style="background:linear-gradient(90deg,${[0, .25, .5, .75, 1]
        .map((f) => color(T_MIN + f * (T_MAX - T_MIN))).join(",")})"></span><span>${T_MAX}°C</span>`;
  }

  function drawMap(sensors, staleH) {
    layer.clearLayers(); markers = {};
    const pts = [];
    for (const s of sensors) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !s.latest) continue;
      // Plataformas móviles (buques): perfiles anteriores como puntos pequeños
      for (const p of (s.track || []).slice(0, -1)) {
        L.circleMarker([p.lat, p.lon], {
          radius: 5, weight: 1, color: "#fff", fillColor: color(p.v), fillOpacity: 0.85,
        }).bindTooltip(`${fmt(p.v)} °C · ${localTime(p.t)}`).addTo(layer);
        pts.push([p.lat, p.lon]);
      }
      const stale = isStale(s, staleH);
      const icon = L.divIcon({
        className: "", iconSize: [34, 34],
        html: `<div class="dot" style="width:34px;height:34px;background:${stale ? "var(--stale)" : color(s.latest.v)}">${fmt(s.latest.v)}</div>`,
      });
      const m = L.marker([s.lat, s.lon], { icon }).addTo(layer);
      const popup = document.createElement("div");
      const b = document.createElement("b"); b.textContent = s.name;
      popup.append(b, document.createElement("br"),
        `${fmt(s.latest.v)} °C · ${ago(s.latest.t)}`, document.createElement("br"), s.source);
      if (showCoords(s)) popup.append(document.createElement("br"), `Posición: ${coord(s.lat, s.lon)}`);
      m.bindPopup(popup);
      markers[s.id] = m; pts.push([s.lat, s.lon]);
    }
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 11 });
    else if (pts.length === 1) map.setView(pts[0], 10);
  }

  const isStale = (s, h) => !s.latest || Date.now() - new Date(s.latest.t) > (s.staleAfterHours ?? h) * 3600e3;

  // ── sparkline ──
  function spark(series) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "spark");
    if (series.length < 2) return svg;
    const W = 300, H = 44, P = 4;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const ts = series.map((d) => +new Date(d.t)), vs = series.map((d) => d.v);
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    let v0 = Math.min(...vs), v1 = Math.max(...vs);
    if (v1 - v0 < 0.5) { const c = (v0 + v1) / 2; v0 = c - 0.25; v1 = c + 0.25; }
    const x = (t) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
    const y = (v) => H - P - ((v - v0) / (v1 - v0)) * (H - 2 * P);
    const d = series.map((p, i) => `${i ? "L" : "M"}${x(ts[i]).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "var(--accent)");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(path);
    // tap / hover tooltip
    svg.addEventListener("pointermove", (ev) => showTip(ev, svg, series, ts, x));
    svg.addEventListener("pointerdown", (ev) => showTip(ev, svg, series, ts, x));
    svg.addEventListener("pointerleave", hideTip);
    return svg;
  }

  let tip;
  function showTip(ev, svg, series, ts, x) {
    ev.stopPropagation();
    const r = svg.getBoundingClientRect();
    const tx = ((ev.clientX - r.left) / r.width) * 300;
    let best = 0;
    for (let i = 1; i < ts.length; i++) if (Math.abs(x(ts[i]) - tx) < Math.abs(x(ts[best]) - tx)) best = i;
    tip ??= Object.assign(document.createElement("div"), { className: "tip" });
    document.body.append(tip);
    tip.textContent = `${fmt(series[best].v)} °C · ${localTime(series[best].t)}`;
    tip.style.left = Math.min(ev.clientX + 8, innerWidth - 150) + "px";
    tip.style.top = r.top - 28 + "px";
    clearTimeout(showTip.t); showTip.t = setTimeout(hideTip, 2500);
  }
  function hideTip() { tip?.remove(); }

  // ── cards ──
  // Categorías de la lista (mismo orden y nombres que la tabla de la página)
  const CATEGORIES = [
    ["copas", "Boyas COPAS"],
    ["fvon", "Embarcaciones pesqueras (Asoc. Pescadores/Armadores del Biobío - FONDEF - FVON-COPAS)"],
    ["shoa", "Estaciones SHOA"],
    ["gdp", "Boyas de deriva (GDP)"],
    ["buques", "Buques VOS y otros buques"],
    ["argo", "Flotadores Argo"],
    ["otros", "Otras fuentes"],
  ];
  const openGroups = new Set(); // recuerda qué grupos están abiertos entre actualizaciones

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const CHEVRON = '<svg class="g-chev" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6"/></svg>';

  // Coordenadas de la última medición: solo plataformas que se desplazan
  const SHOW_COORDS = new Set(["gdp", "buques", "argo"]);
  const coord = (lat, lon) =>
    `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(2)}°${lon < 0 ? "W" : "E"}`;
  const showCoords = (s) => SHOW_COORDS.has(s.category) && Number.isFinite(s.lat) && Number.isFinite(s.lon);

  function row(s, staleH) {
    const li = el("li", "row");
    const pill = el("div", "pill");
    const text = el("div", "r-text");
    const sub = el("div", "r-sub");
    text.append(el("div", "r-name", s.name), sub);
    if (showCoords(s)) text.append(el("div", "r-coord", `Posición: ${coord(s.lat, s.lon)}`));
    const detail = s.source.includes(" · ") ? s.source.split(" · ").slice(1).join(" · ") : "";
    if (s.latest) {
      const stale = isStale(s, staleH);
      pill.textContent = fmt(s.latest.v);
      pill.style.background = color(s.latest.v);
      if (stale) { pill.classList.add("stale"); sub.classList.add("stale"); }
      sub.textContent = [ago(s.latest.t), localTime(s.latest.t), detail].filter(Boolean).join(" · ");
      sub.title = `${s.source} · ${localTime(s.latest.t)}`;
    } else { pill.textContent = "—"; pill.classList.add("stale"); sub.textContent = detail || "sin datos"; }
    const hasSpark = s.series?.length > 1;
    if (!hasSpark) li.classList.add("nospark");
    li.append(pill, text, hasSpark ? spark(s.series) : el("span"));
    if (s.error) li.append(el("div", "r-err", s.error));
    li.addEventListener("click", () => {
      const m = markers[s.id]; if (!m) return;
      map.setView(m.getLatLng(), 11); m.openPopup();
      $("map").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return li;
  }

  function drawList(sensors, staleH) {
    const root = $("list"); root.replaceChildren();
    const known = new Set(CATEGORIES.map(([k]) => k));
    for (const [key, label] of CATEGORIES) {
      const items = sensors.filter((s) => (known.has(s.category) ? s.category : "otros") === key);
      if (!items.length) continue;
      items.sort((a, b) => (a.latest ? 0 : 1) - (b.latest ? 0 : 1) || a.name.localeCompare(b.name, "es", { numeric: true }));
      const live = items.filter((s) => s.latest && !isStale(s, staleH));

      const det = el("details", "group"); det.open = openGroups.has(key);
      det.addEventListener("toggle", () => (det.open ? openGroups.add(key) : openGroups.delete(key)));

      const sum = el("summary");
      const bar = el("span", "g-bar");
      const text = el("span", "g-text");
      const n = items.length;
      // Si el nombre trae una aclaración larga entre paréntesis, va como subtítulo
      const m = label.match(/^(.*?)\s*\((.{13,})\)$/);
      text.append(el("span", "g-title", m ? m[1] : label));
      if (m) text.append(el("span", "g-sub", m[2]));
      text.append(
        el("span", "g-meta", `${n} ${n === 1 ? "sensor" : "sensores"} · ${live.length} ${live.length === 1 ? "reciente" : "recientes"}`));
      const range = el("span", "g-range");
      if (live.length) {
        const vs = live.map((s) => s.latest.v);
        const lo = Math.min(...vs), hi = Math.max(...vs);
        range.textContent = lo === hi ? `${fmt(lo)} °C` : `${fmt(lo)}–${fmt(hi)} °C`;
        bar.style.background = `linear-gradient(180deg, ${color(hi)}, ${color(lo)})`;
      } else { range.textContent = "—"; range.classList.add("none"); }
      sum.append(bar, text, range);
      sum.insertAdjacentHTML("beforeend", CHEVRON);

      const ul = el("ul", "rows");
      for (const s of items) ul.append(row(s, staleH));
      det.append(sum, ul);
      root.append(det);
    }
  }

  // ── summary ──
  function drawSummary(d) {
    const live = d.sensors.filter((s) => s.latest && !isStale(s, d.staleAfterHours));
    const vals = live.map((s) => s.latest.v);
    if (vals.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      $("avg").textContent = fmt(avg);
      $("avg").style.color = color(avg);
      const lo = live.reduce((a, b) => (b.latest.v < a.latest.v ? b : a));
      const hi = live.reduce((a, b) => (b.latest.v > a.latest.v ? b : a));
      $("range").textContent = vals.length > 1
        ? `mín ${fmt(lo.latest.v)}° ${lo.name} · máx ${fmt(hi.latest.v)}° ${hi.name}`
        : live[0].name;
    } else {
      $("avg").textContent = "—"; $("avg").style.color = "";
      $("range").textContent = "Sin lecturas recientes";
    }
    $("updated").textContent = `Actualizado ${localTime(d.generatedAt)} (hora de Chile)`;
    $("count").textContent = `${live.length} de ${d.sensors.length} sensores reportando`;
    $("region").textContent = d.region?.name || "";
    $("demo").hidden = !d.demo;
    const errs = d.errors || [];
    $("errors").hidden = !errs.length;
    $("errors").textContent = errs.join(" · ");
  }

  async function load() {
    $("refresh").classList.add("spin");
    try {
      const res = await fetch(`${API}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      initMap(d.region);
      drawSummary(d);
      drawMap(d.sensors, d.staleAfterHours);
      drawList(d.sensors, d.staleAfterHours);
    } catch (e) {
      $("errors").hidden = false;
      $("errors").textContent = `No se pudieron cargar los datos: ${e.message}`;
    } finally {
      $("refresh").classList.remove("spin");
    }
  }

  $("refresh").addEventListener("click", load);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  load();
})();
