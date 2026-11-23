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

  // ── Sofar Spotters ─────────────────────────────────────────
  // Token comes from the SOFAR_TOKEN environment variable.
  sofar: {
    enabled: true,
    // true: también se agregan todas las boyas de tu cuenta que estén dentro de la región.
    autoDiscover: true,
    // Boyas que se muestran SIEMPRE (aunque no estén en tu cuenta, estén fuera de la
    // región o no tengan datos recientes; en ese caso la tarjeta muestra un aviso).
    spotters: [
      { id: "SPOT-31491C" },
      // { id: "SPOT-1234", name: "Bahía de Concepción" },
    ],
  },

  // ── ERDDAP datasets ────────────────────────────────────────
  // One entry per sensor/station. Find these values on your ERDDAP
  // server's dataset page (…/erddap/tabledap/<datasetId>.html).
  erddap: [
    // FVON – perfiles de temperatura de sensores en artes de pesca (tiempo casi real).
    // Plataformas móviles: por cada embarcación (WMO_ID) dentro de la región se muestra
    // solo el último valor superficial = la lectura más somera (≤ maxDepth) de su último perfil.
    {
      name: "FVON",
      sourceLabel: "FVON (buques pesqueros)",
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
