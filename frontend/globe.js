// ── CONFIG ────────────────────────────────────────────────────────────────────
const WORKER_URL = "https://flight-tracker-worker.sidd-karani06.workers.dev";
const GLOBE_RADIUS = 5;
const REFRESH_MS   = 15000;

// ── Scene ─────────────────────────────────────────────────────────────────────
const canvas   = document.getElementById("globe");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 14);

// Lighting
scene.add(new THREE.AmbientLight(0x334466, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(10, 5, 10);
sun.castShadow = true;
scene.add(sun);
// Subtle fill light from opposite side
const fill = new THREE.DirectionalLight(0x4466aa, 0.4);
fill.position.set(-10, -5, -10);
scene.add(fill);

// Stars
const starGeo   = new THREE.BufferGeometry();
const starVerts = [];
for (let i = 0; i < 10000; i++) {
  const t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1), r = 250 + Math.random() * 100;
  starVerts.push(r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t));
}
starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starVerts, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35 })));

// ── Globe ─────────────────────────────────────────────────────────────────────
const loader   = new THREE.TextureLoader();
const earthGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
const earthTex = loader.load(
  "https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/textures/planets/earth_atmos_2048.jpg",
  () => document.getElementById("loading").style.display = "none"
);
const earthMat  = new THREE.MeshPhongMaterial({ map: earthTex, specular: 0x111122, shininess: 20 });
const earthMesh = new THREE.Mesh(earthGeo, earthMat);
earthMesh.receiveShadow = true;
scene.add(earthMesh);

// Atmosphere
const atmosMat = new THREE.MeshPhongMaterial({ color: 0x4488ff, transparent: true, opacity: 0.07, side: THREE.FrontSide });
scene.add(new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS * 1.02, 64, 64), atmosMat));

// ── 3D Plane model ────────────────────────────────────────────────────────────
// Builds a proper 3D aircraft shape using basic geometries
function create3DPlane(color = 0x00d4ff) {
  const group = new THREE.Group();
  const mat   = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.3, shininess: 80 });
  const white = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2 });

  // Fuselage — long thin cylinder
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.012, 0.22, 8),
    mat
  );
  fuselage.rotation.z = Math.PI / 2; // lay horizontal
  group.add(fuselage);

  // Nose cone
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.018, 0.06, 8),
    mat
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.14, 0, 0);
  group.add(nose);

  // Main wings — flat wide box
  const wings = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.004, 0.32),
    mat
  );
  wings.position.set(0.01, 0, 0);
  group.add(wings);

  // Wing tips (angled up slightly)
  [-1, 1].forEach(side => {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.003, 0.06), mat);
    tip.position.set(0.01, 0.012 * side, 0.19 * side);
    tip.rotation.x = 0.3 * side;
    group.add(tip);
  });

  // Tail fin (vertical stabilizer)
  const vTail = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.06, 0.004),
    mat
  );
  vTail.position.set(-0.09, 0.03, 0);
  group.add(vTail);

  // Horizontal stabilizers
  const hTail = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.003, 0.14),
    mat
  );
  hTail.position.set(-0.09, 0, 0);
  group.add(hTail);

  // Engines (2x under wings)
  [-0.08, 0.08].forEach(z => {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.055, 8), white);
    eng.rotation.z = Math.PI / 2;
    eng.position.set(0.0, -0.018, z);
    group.add(eng);
  });

  // Cockpit windows glow
  const cockpit = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.012, 0.025),
    new THREE.MeshPhongMaterial({ color: 0xaaddff, emissive: 0x88bbff, emissiveIntensity: 0.8 })
  );
  cockpit.position.set(0.1, 0.012, 0);
  group.add(cockpit);

  return group;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function latLonToVec3(lat, lon, r = GLOBE_RADIUS + 0.12) {
  const phi   = (90 - lat)  * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

function metersToFeet(m)  { return m ? Math.round(m * 3.28084).toLocaleString() : "—"; }
function msToKnots(ms)    { return ms ? Math.round(ms * 1.94384) : "—"; }

// ── Flight management ─────────────────────────────────────────────────────────
let planeObjects = {}; // icao24 → THREE.Group
let flightData   = [];
let highlighted  = null;

function updatePlanes(flights) {
  flightData = flights;
  const seen = new Set();

  flights.forEach(f => {
    if (f.lat == null || f.lon == null) return;
    seen.add(f.icao24);

    if (!planeObjects[f.icao24]) {
      const isTracked = window._tracked && window._tracked.includes(f.callsign);
      const color     = isTracked ? 0x34d399 : 0x00d4ff;
      const plane     = create3DPlane(color);
      plane.userData  = { flight: f };
      scene.add(plane);
      planeObjects[f.icao24] = plane;
    }

    const plane = planeObjects[f.icao24];
    plane.userData.flight = f;

    // Position on globe surface
    const pos    = latLonToVec3(f.lat, f.lon);
    plane.position.copy(pos);

    // Orient plane to sit flush on globe surface (normal pointing outward)
    const normal = pos.clone().normalize();
    const up     = new THREE.Vector3(0, 1, 0);
    const quat   = new THREE.Quaternion().setFromUnitVectors(up, normal);
    plane.quaternion.copy(quat);

    // Rotate plane to face its heading direction
    if (f.heading != null) {
      const headingRad = (f.heading * Math.PI) / 180;
      plane.rotateOnWorldAxis(normal, -headingRad);
    }

    // Scale based on camera distance for consistent apparent size
    plane.scale.setScalar(4.5);
  });

  // Remove stale planes
  Object.keys(planeObjects).forEach(id => {
    if (!seen.has(id)) { scene.remove(planeObjects[id]); delete planeObjects[id]; }
  });

  document.getElementById("flight-count").textContent =
    `${flights.length.toLocaleString()} flights live`;
}

// ── Live data ─────────────────────────────────────────────────────────────────
async function fetchFlights() {
  try {
    const res  = await fetch(`${WORKER_URL}/flights`);
    const data = await res.json();
    if (data.flights) updatePlanes(data.flights);
  } catch (e) { console.warn("Flight fetch error:", e); }
}
fetchFlights();
setInterval(fetchFlights, REFRESH_MS);

// ── Search ────────────────────────────────────────────────────────────────────
document.getElementById("search-btn").addEventListener("click", () => {
  const q = document.getElementById("search-input").value.trim().toUpperCase();
  const f = flightData.find(f => (f.callsign || "").toUpperCase().includes(q));
  if (f) selectFlight(f);
  else alert(`No active flight found matching "${q}"`);
});
document.getElementById("search-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("search-btn").click();
});

// ── Flight panel ──────────────────────────────────────────────────────────────
function selectFlight(f) {
  highlighted = f.icao24;

  // Reset all planes, highlight selected
  Object.entries(planeObjects).forEach(([id, p]) => {
    const isSelected = id === f.icao24;
    const isTracked  = window._tracked && window._tracked.includes(p.userData.flight?.callsign);
    const color      = isSelected ? 0xfbbf24 : isTracked ? 0x34d399 : 0x00d4ff;
    p.traverse(child => {
      if (child.isMesh && child.material.color) {
        child.material.color.setHex(color);
        child.material.emissive?.setHex(color);
      }
    });
    p.scale.setScalar(isSelected ? 6.5 : 4.5);
  });

  // Smoothly spin globe to face this flight
  targetLat = f.lat; targetLon = f.lon;

  document.getElementById("fp-callsign").textContent = f.callsign || f.icao24;
  document.getElementById("fp-country").textContent  = f.airline || f.origin_country || "—";
  document.getElementById("fp-alt").textContent      = f.altitude_m ? `${metersToFeet(f.altitude_m)} ft` : "—";
  document.getElementById("fp-speed").textContent    = f.velocity_ms ? `${msToKnots(f.velocity_ms)} kts` : "—";
  document.getElementById("fp-heading").textContent  = f.heading != null ? `${Math.round(f.heading)}°` : "—";
  document.getElementById("fp-vrate").textContent    = f.vertical_rate != null ? `${f.vertical_rate > 0 ? "+" : ""}${Math.round(f.vertical_rate)} m/s` : "—";
  document.getElementById("fp-pos").textContent      = `${f.lat?.toFixed(2)}°, ${f.lon?.toFixed(2)}°`;
  document.getElementById("flight-panel").style.display = "block";
  document.getElementById("track-btn").dataset.callsign  = f.callsign || f.icao24;

  // Add departure/arrival if available
  if (f.departure || f.arrival) {
    document.getElementById("fp-pos").textContent =
      `${f.departure || "?"} → ${f.arrival || "?"}`;
  }
}

document.getElementById("track-btn").addEventListener("click", async () => {
  const cs  = document.getElementById("track-btn").dataset.callsign;
  const res = await fetch(`${WORKER_URL}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callsign: cs, action: "add" }),
  });
  const data = await res.json();
  window._tracked = data.trackedCallsigns;
  document.getElementById("track-btn").textContent = "Tracked!";
  setTimeout(() => document.getElementById("track-btn").textContent = "Track This Flight", 2000);
});

(async () => {
  try {
    const res = await fetch(`${WORKER_URL}/tracked`);
    const data = await res.json();
    window._tracked = data.trackedCallsigns || [];
  } catch (_) { window._tracked = []; }
})();

// ── Raycasting (click planes) ─────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
raycaster.params.Mesh.threshold = 0.1;

canvas.addEventListener("click", e => {
  mouse.x =  (e.clientX / innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = [];
  Object.values(planeObjects).forEach(p => p.traverse(c => { if (c.isMesh) meshes.push(c); }));
  const hits = raycaster.intersectObjects(meshes);
  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj.parent && !obj.userData.flight) obj = obj.parent;
    if (obj.userData.flight) selectFlight(obj.userData.flight);
  }
});

// ── Globe controls ────────────────────────────────────────────────────────────
let isDragging = false, prevX = 0, prevY = 0, velX = 0, velY = 0;
let targetLat = null, targetLon = null;

canvas.addEventListener("mousedown", e => { isDragging = true; prevX = e.clientX; prevY = e.clientY; targetLat = targetLon = null; });
window.addEventListener("mouseup",   () => isDragging = false);
window.addEventListener("mousemove", e => {
  if (!isDragging) return;
  velY += (e.clientX - prevX) * 0.005;
  velX += (e.clientY - prevY) * 0.005;
  prevX = e.clientX; prevY = e.clientY;
});
canvas.addEventListener("wheel", e => {
  camera.position.z = Math.max(7, Math.min(25, camera.position.z + e.deltaY * 0.02));
});

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ── Render loop ───────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  if (targetLat != null && targetLon != null) {
    const tX = -targetLat * Math.PI / 180;
    const tY  =  targetLon * Math.PI / 180;
    earthMesh.rotation.x += (tX - earthMesh.rotation.x) * 0.04;
    earthMesh.rotation.y += (tY - earthMesh.rotation.y) * 0.04;
  } else {
    if (!isDragging) {
      velX *= 0.92; velY *= 0.92;
      if (Math.abs(velY) < 0.0005) velY += 0.0006;
    }
    earthMesh.rotation.x += velX;
    earthMesh.rotation.y += velY;
  }

  // Sync plane positions with globe rotation
  Object.values(planeObjects).forEach(plane => {
    const f   = plane.userData.flight;
    if (!f) return;
    const pos    = latLonToVec3(f.lat, f.lon);
    pos.applyEuler(earthMesh.rotation);
    plane.position.copy(pos);

    // Re-orient normal to globe surface after rotation
    const normal = pos.clone().normalize();
    const up     = new THREE.Vector3(0, 1, 0);
    const quat   = new THREE.Quaternion().setFromUnitVectors(up, normal);
    plane.quaternion.copy(quat);

    if (f.heading != null) {
      plane.rotateOnWorldAxis(normal, -(f.heading * Math.PI) / 180);
    }
  });

  renderer.render(scene, camera);
}
animate();
