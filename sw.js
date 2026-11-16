/* TOKI — service worker
   - le code de l'app est mis en cache : l'app s'ouvre tout de suite avec sa copie, puis la met à jour en arrière-plan
   - le contenu (données, audios, images, polices) vient du pack importé, rangé dans le cache "ile-pack"
   → une fois le pack importé, tout fonctionne hors ligne. */
const V = "toki-v8";
const SHELL = ["./", "index.html", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== V && k !== "ile-pack" && k !== "ile-media").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Safari exige des réponses partielles (206) pour lire l'audio
async function ranged(req, res) {
  const range = req.headers.get("range");
  if (!range || !res) return res;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return res;
  const blob = await res.blob();
  const size = blob.size;
  let start = m[1] === "" ? Math.max(0, size - +m[2]) : +m[1];
  let end = m[1] !== "" && m[2] !== "" ? Math.min(+m[2], size - 1) : size - 1;
  if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/octet-stream", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" },
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    // 1) contenu du pack
    const pack = await caches.open("ile-pack");
    const ph = await pack.match(url.href, { ignoreSearch: true });
    if (ph) return ranged(req, ph);
    // 2) code de l'app : la copie locale tout de suite (ouverture instantanée, même avec un mauvais réseau),
    //    et la version en ligne est rangée en arrière-plan pour la prochaine ouverture
    const c = await caches.open(V);
    const net = (req.mode === "navigate" ? fetch(req.url, { cache: "no-cache" }) : fetch(req, { cache: "no-cache" }))
      .then((r) => { if (r.ok && r.status === 200 && !req.headers.get("range")) c.put(req, r.clone()); return r; });
    let hit = await c.match(req, { ignoreSearch: true });
    if (!hit && req.mode === "navigate") hit = (await c.match("index.html")) || (await c.match("./"));
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    try { return await net; } catch (err) { return Response.error(); }
  })());
});
