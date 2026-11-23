# TSM Biobío

Sitio web para celular que muestra la última temperatura superficial del mar (TSM) de tus boyas Sofar Spotter y de tus datasets ERDDAP en la Región del Biobío. Incluye el promedio regional, un mapa con batimetría GEBCO, una tarjeta por sensor con la tendencia de las últimas 72 horas, y se actualiza cada 30 minutos mediante GitHub Actions. Se puede agregar a la pantalla de inicio del teléfono como una app.

```
public/                        la página web (index.html, app.js, style.css)
lib/sources.mjs                consulta Sofar + ERDDAP/FVON y normaliza los datos
scripts/build-data.mjs         genera public/data/sst.json con las últimas lecturas
.github/workflows/pages.yml    GitHub Action: cada 30 min actualiza los datos y publica el sitio
sensors.config.mjs             AQUÍ VAN TUS SENSORES
server.mjs                     para probarlo en tu computador
```

**Cómo funciona en GitHub Pages:** GitHub Pages solo publica archivos estáticos, así que la página no consulta las APIs directamente. Una GitHub Action corre cada 30 minutos, descarga las lecturas usando el token guardado como *secret* del repositorio, escribe `data/sst.json` y vuelve a publicar el sitio. El token nunca aparece en la página ni en el repositorio.

Mientras no configures ningún sensor, el sitio muestra **datos de ejemplo** con un aviso.

## 1. Configura tus sensores

Edita `sensors.config.mjs`:

- **Sofar:** deja `spotters: []` para mostrar todos los Spotters de tu cuenta que estén dentro del área del Biobío, o indica IDs específicos (`{ id: "SPOT-1234", name: "Tomé" }`). Los Spotters sin sensor de TSM se omiten automáticamente.
- **ERDDAP:** agrega una entrada por estación con `server`, `datasetId` y `tempVar` (la columna de TSM). Si el dataset tiene varias estaciones, agrega `stationVar` y `stationValue`. Si no tiene columnas de latitud/longitud, agrega `lat` y `lon`.

**El token de Sofar nunca va en este archivo.** Se lee de la variable de entorno `SOFAR_TOKEN`, porque da acceso completo a tu cuenta Sofar.

## 2. Publícalo en GitHub Pages

1. Crea un repositorio **público** en github.com (GitHub Pages gratis requiere repositorio público; el token igual queda protegido como secret).
2. Sube todos los archivos **excepto `.env`**. Con "Add file → Upload files" puedes arrastrar las carpetas. Si tu explorador oculta la carpeta `.github`, créala a mano: "Add file → Create new file", escribe el nombre `.github/workflows/pages.yml` y pega el contenido de ese archivo.
3. **Settings → Secrets and variables → Actions → New repository secret**: nombre `SOFAR_TOKEN`, valor tu token.
4. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. **Actions → "Actualizar y publicar TSM Biobío" → Run workflow**. En 1–2 minutos el sitio queda en `https://<tu-usuario>.github.io/<nombre-del-repo>/`.

En el registro de cada ejecución (pestaña Actions) se ve qué sensores respondieron y con qué valor, útil para revisar si algo falla.

Notas:
- GitHub puede atrasar unos minutos las ejecuciones programadas.
- En repositorios sin actividad durante 60 días, GitHub desactiva las ejecuciones programadas; se reactivan con un clic en la pestaña Actions.
- El archivo `data/sst.json` publicado es público, igual que lo que muestra la página.

## 3. (Opcional) Pruébalo en tu computador

Necesitas Node.js 22.9 o superior (versión LTS desde nodejs.org).

```bash
cp .env.example .env      # luego pon tu token real en .env
npm start                 # abre http://localhost:8080
```

## Ajustes que quizás quieras cambiar

- `staleAfterHours` (por defecto 6): las lecturas más antiguas se muestran en gris y no cuentan en el promedio regional.
- `historyHours` (por defecto 72): cuántas horas muestran las líneas de tendencia.
- `region.bbox`: el área del mapa y el recuadro usado para filtrar Spotters a la deriva.
- La escala de colores va de 9 °C a 17 °C (`T_MIN`/`T_MAX` al inicio de `public/app.js`).

## Mapa

- Batimetría: servicio WMS de GEBCO (`https://wms.gebco.net/mapserv?`, capa `GEBCO_LATEST`, que GEBCO mantiene apuntando a su grilla más reciente). Cita sugerida: *GEBCO Compilation Group (2026) GEBCO_2026 Grid*.
- Etiquetas de ciudades: CARTO (datos © OpenStreetMap).
- Para usar la versión de colores por elevación en vez del relieve sombreado, cambia `GEBCO_LATEST` por `GEBCO_LATEST_2` en `public/app.js`.

## Datos FVON (buques pesqueros)

`sensors.config.mjs` ya incluye el dataset `FVON_Profile_FV_NRT` del ERDDAP de la Fishing Vessel Ocean Observing Network (perfiles de temperatura de sensores en artes de pesca). Para cada embarcación (`WMO_ID`) dentro del recuadro de la región se muestra **solo el último valor superficial**:

- se busca el perfil más reciente de cada buque en los últimos 14 días (`historyHours`);
- de ese perfil se toma la lectura más somera (a ≤ 5 m, `maxDepth`); la tarjeta indica a qué profundidad fue;
- no hay historial: ni línea de tendencia ni perfiles anteriores en el mapa;
- el buque se muestra en gris si su último perfil tiene más de 3 días (`staleAfterHours`);
- el dataset no trae banderas de control de calidad por fila, así que se descartan valores fuera de `validRange` (5–25 °C).

Uso de los datos según la política de datos de FVON: https://www.fvon.org/privacy-policy/
