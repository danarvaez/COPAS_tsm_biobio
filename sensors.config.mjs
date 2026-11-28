// ─────────────────────────────────────────────────────────────
//  SST Biobío – sensor configuration
//  Edit this file to point the website at your own sensors.
//  Secrets (the Sofar token) go in an environment variable, NOT here.
// ─────────────────────────────────────────────────────────────

export default {
  // Region shown on the map, and used to keep only drifting Spotters
  // that are inside the Biobío area. [south, west, north, east]
  region: {
    name: "Región del Biobío",
    bbox: [-38.6, -74.2, -36.3, -72.6],
  },

  // How many hours of history to load for the small trend charts.
  historyHours: 72,

  // A reading older than this is shown as "stale" (grey).
  staleAfterHours: 6,

  // ── Boyas COPAS (Sofar Spotters) ───────────────────────────
  // Token comes from the SOFAR_TOKEN environment variable.
  sofar: {
    enabled: true,
    // Solo se muestran las boyas listadas (Coliumo, POSAR, Coronel).
    autoDiscover: false,
    // Los números de serie NO van aquí (el repositorio es público). Se leen del secret
    // SOFAR_SPOTTERS de GitHub, con el formato:
    //   Coliumo=SPOT-XXXXXX;POSAR=SPOT-YYYYYY;Coronel=SPOT-ZZZZZZ
    // Esta lista solo se usa si ese secret no existe (por ejemplo, pruebas locales sin .env).
    spotters: [],
  },

  // ── SHOA – Red Mareográfica Nacional (sensor de temperatura del agua) ──
  // Misma fuente que el visualizador de TSM del SHOA. Códigos disponibles en la zona:
  // CONST Constitución, COLI Coliumo, QUIR Isla Quiriquina, TALC Talcahuano,
  // CRNL Coronel, LEBU Lebu, NTUE Nehuentué (BOYE Boyeruca, más al norte).
  shoa: {
    enabled: true,
    stations: ["CONST", "COLI", "QUIR", "TALC", "CRNL", "LEBU", "NTUE"],
    historyHours: 48,
    staleAfterHours: 6,
    validRange: [5, 25],
  },

  // ── ERDDAP datasets ────────────────────────────────────────
  // One entry per sensor/station. Find these values on your ERDDAP
  // server's dataset page (…/erddap/tabledap/<datasetId>.html).
  erddap: [
    // GTS (Global Telecommunication System) vía el ERDDAP de NOAA OSMC: último valor de TSM de
    // cada plataforma que haya pasado por 30–42°S, 70–90°W. Incluye boyas de deriva del Global
    // Drifter Program, flotadores Argo (temperatura más somera del perfil) y buques de observación
    // voluntaria (VOS). Los tipos son los valores exactos de platform_type en OSMC.
    {
      name: "GTS",
      server: "https://osmc.noaa.gov/erddap",
      datasetId: "OSMC_30day",
      mode: "latestByPlatform",
      tempVar: "sst",
      groupVar: "platform_code",
      typeVar: "platform_type",
      types: {
        "DRIFTING BUOYS":               { category: "gdp",     label: "Boya de deriva", source: "Global Drifter Program (GTS · NOAA OSMC)", staleAfterHours: 24 },
        "PROFILING FLOATS AND GLIDERS": { category: "argo",    label: "Flotador Argo",  source: "Argo (GTS · NOAA OSMC)",                   staleAfterHours: 24 * 11 },
        "VOLUNTEER OBSERVING SHIPS":    { category: "buques",  label: "Buque VOS",      source: "Buque de observación voluntaria (GTS)",    staleAfterHours: 48 },
        "SHIPS":                        { category: "buques",  label: "Buque",          source: "Buque (GTS · NOAA OSMC)",                  staleAfterHours: 48 },
        "MOORED BUOYS":                 { category: "otros",   label: "Boya fondeada",  source: "Boya fondeada (GTS · NOAA OSMC)",          staleAfterHours: 24 },
      },
      bbox: [-42, -90, -30, -70],            // [sur, oeste, norte, este] = 30–42°S, 70–90°W
      validRange: [5, 25],                   // °C
      historyHours: 24 * 10,                 // Argo perfila cada ~10 días
    },
    // FVON – perfiles de temperatura de sensores en artes de pesca (tiempo casi real).
    // Plataformas móviles: por cada embarcación (WMO_ID) dentro de la región se muestra
    // solo el último valor superficial = la lectura más somera (≤ maxDepth) de su último perfil.
    {
      name: "FVON",
      sourceLabel: "Embarcaciones pesqueras (Asoc. Pescadores/Armadores del Biobío - FONDEF - FVON-COPAS)",
      itemName: "Embarcación pesquera",
      category: "fvon",
      server: "https://erddap.fvon.org/erddap",
      datasetId: "FVON_Profile_FV_NRT",
      mode: "profiles",
      tempVar: "temperature",
      depthVar: "depth",
      profileVar: "profile_id",
      groupVar: "WMO_ID",
      maxDepth: 5,              // m – qué se considera "superficie"
      validRange: [5, 25],      // °C – descarta valores imposibles (el dataset no trae banderas QC)
      historyHours: 24 * 14,    // cuánto buscar hacia atrás el último perfil de cada buque
      staleAfterHours: 72,      // gris si el último perfil tiene más de 3 días
    },
    // {
    //   name: "Boya Coliumo",
    //   server: "https://your-erddap-server.cl/erddap",   // no trailing slash
    //   datasetId: "your_dataset_id",
    //   tempVar: "sea_surface_temperature",              // the SST column name
    //   timeVar: "time",                                  // usually "time"
    //   // If the dataset holds several stations, filter one:
    //   // stationVar: "station_id", stationValue: "COLIUMO",
    //   // If the dataset has no latitude/longitude columns, give the position:
    //   // lat: -36.54, lon: -72.96,
    // },
  ],
};
