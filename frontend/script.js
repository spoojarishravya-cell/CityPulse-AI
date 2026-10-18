
"use strict";

/*
 * CITYPULSE AI — Smart Waste Collection Dashboard
 * FastAPI-backed bin, fleet, collection, and vision data. Fleet movement and
 * sensor readings remain explicitly identified as local simulation.
 */

const API_BASE_URL = window.CITYPULSE_API_URL || "https://city-pulse-ai-ira8.onrender.com";
let backendConnected = false;
let backendPriorityOrder = [];
let backendRecommendations = [];

const INITIAL_BINS = [
  { bin_id: "BIN-01", area: "Harohalli Central", fill_level: 91, latitude: 12.9352, longitude: 77.6245 },
  { bin_id: "BIN-02", area: "Market Road", fill_level: 82, latitude: 12.9418, longitude: 77.6101 },
  { bin_id: "BIN-03", area: "Lake View", fill_level: 38, latitude: 12.9280, longitude: 77.6175 },
  { bin_id: "BIN-04", area: "University Gate", fill_level: 68, latitude: 12.9367, longitude: 77.6058 },
  { bin_id: "BIN-05", area: "Residential Block A", fill_level: 47, latitude: 12.9470, longitude: 77.6204 },
  { bin_id: "BIN-06", area: "Bus Stop North", fill_level: 76, latitude: 12.9302, longitude: 77.6320 },
  { bin_id: "BIN-07", area: "Community Park", fill_level: 24, latitude: 12.9218, longitude: 77.6150 },
  { bin_id: "BIN-08", area: "Commercial Street", fill_level: 59, latitude: 12.9440, longitude: 77.6302 },
  { bin_id: "BIN-09", area: "Service Lane", fill_level: 13, latitude: 12.9252, longitude: 77.6075 },
  { bin_id: "BIN-10", area: "Residential Block B", fill_level: 72, latitude: 12.9500, longitude: 77.6120 },
  { bin_id: "BIN-11", area: "South Junction", fill_level: 34, latitude: 12.9188, longitude: 77.6265 },
  { bin_id: "BIN-12", area: "Depot Approach", fill_level: 88, latitude: 12.9391, longitude: 77.6372 }
];

function getPriority(fillLevel) {
  if (fillLevel >= 75) return "HIGH";
  if (fillLevel >= 45) return "MEDIUM";
  return "LOW";
}

function normalizeWasteType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("plastic") || text.includes("polymer")) return "Plastic";
  if (text.includes("organic") || text.includes("food") || text.includes("compost")) return "Organic";
  if (text.includes("glass")) return "Glass";
  if (text.includes("paper") || text.includes("newspaper")) return "Paper";
  if (text.includes("metal") || text.includes("can") || text.includes("aluminum")) return "Metal";
  if (text.includes("cardboard") || text.includes("fiber")) return "Cardboard";
  return "Mixed";
}

const bins = INITIAL_BINS.map(bin => ({
  ...bin,
  waste_type: ["Plastic", "Organic", "Paper", "Mixed", "Metal", "Cardboard"][Number(bin.bin_id.slice(-2)) % 6],
  ward: ["Central", "North", "South"][Number(bin.bin_id.slice(-2)) % 3],
  priority: getPriority(bin.fill_level),
  priority_score: bin.fill_level,
  collection_needed: bin.fill_level >= 65,
  last_updated: new Date()
}));

const fleet = [
  {
    id: "TRK-01", name: "Central Collector", zone: "Central zone",
    status: "Available", assigned: 0, fuel: 76, capacity: 4,
    depot: [12.9325, 77.6200], color: "#00D9FF", bins: []
  },
  {
    id: "TRK-02", name: "North Runner", zone: "North zone",
    status: "Available", assigned: 0, fuel: 91, capacity: 4,
    depot: [12.9475, 77.6160], color: "#C084FC", bins: []
  },
  {
    id: "TRK-03", name: "South Sweeper", zone: "South zone",
    status: "Available", assigned: 0, fuel: 64, capacity: 4,
    depot: [12.9210, 77.6250], color: "#FF8A3D", bins: []
  }
];

let selectedBinId = "BIN-01";
let activeFilter = "ALL";
let mapPriorityFilter = "ALL";

let markers = {};
let map = null;
let truckMarkers = {};
let routeLines = {};
let routeOverviewLines = {};
let originalBinPositions = {};

let animationFrames = {};
let animationTokens = {};
let animationResolvers = {};
let simulationTimer = null;
let simulationPaused = true;
let activityEvents = [];
let collectionHistory = [];
let scanHistory = [];
let fillHistory = [];
let selectedMaterial = "Plastic";

const MATERIAL_GUIDANCE = {
  Plastic: { stream: "Dry recyclables · confirm local acceptance", summary: "Plastic packaging may be recyclable when clean and accepted by the local collection program.", steps: ["Empty and rinse food or liquid residue; allow the item to dry.", "Keep films and flexible wrappers separate from rigid containers.", "Check the resin mark and local acceptance rules before placing in recycling."], avoid: "Do not assume black, multilayer, or flexible plastic is accepted in every stream." },
  Paper: { stream: "Clean paper recycling", summary: "Keep paper clean and dry so fibers remain suitable for recovery.", steps: ["Remove food-contaminated or wet sections.", "Keep clean sheets and paper packaging separate from organic waste.", "Follow local guidance for coated or laminated paper."], avoid: "Greasy or heavily soiled paper can contaminate a clean paper batch." },
  Cardboard: { stream: "Flattened cardboard recycling", summary: "Clean corrugated cardboard can usually be prepared as a separate dry stream.", steps: ["Flatten boxes to reduce volume.", "Remove loose packing material and excess tape where practical.", "Keep cardboard dry and away from food waste."], avoid: "Wet or food-soiled cardboard may need a different handling route." },
  Metal: { stream: "Metal recovery · verify accepted items", summary: "Empty metal packaging and keep sharp or bulky objects handled safely.", steps: ["Empty and rinse cans or containers.", "Separate batteries and electronic parts from ordinary metal packaging.", "Store sharp edges safely and follow local collection rules."], avoid: "Never place batteries or pressurized containers into a regular recycling stream." },
  Glass: { stream: "Glass collection · protect against breakage", summary: "Glass needs careful handling and may use a separate collection stream.", steps: ["Keep reusable intact containers separate from broken glass.", "Protect handlers from shards; do not place loose fragments in an open bin.", "Check whether the local program accepts the glass type."], avoid: "Ceramics, mirrors, and heat-resistant glass may not belong with bottle glass." },
  Organic: { stream: "Wet waste / organics", summary: "Food scraps and other accepted organics should be kept separate from dry recyclables.", steps: ["Use the designated wet-waste container.", "Keep plastic, glass, and metal out of the organic stream.", "Follow local guidance for garden waste, bones, and liquids."], avoid: "Plastic liners and non-compostable packaging can contaminate organics." },
  "E-waste": { stream: "Authorized e-waste collection", summary: "Electronics and batteries need dedicated handling outside ordinary household waste.", steps: ["Keep batteries and electronics separate from mixed waste.", "Protect the item from damage and moisture.", "Use an authorized take-back or e-waste collection point."], avoid: "Do not place electronics or batteries in regular recycling or organic bins." },
  Mixed: { stream: "Manual sorting / residual review", summary: "Mixed material needs sorting before a reliable recovery route can be chosen.", steps: ["Separate visible clean recyclables from food residue.", "Keep hazardous or electronic items out of the mixed stream.", "Route remaining material according to the local waste program."], avoid: "Do not classify a mixed load as recyclable without checking contamination." }
};

const $ = id => document.getElementById(id);

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Backend request failed (${response.status}).`);
  return payload;
}

function updateBackendStatus(connected, message = "") {
  backendConnected = connected;
  const card = $("backend-status-card");
  const pill = $("backend-status-pill");
  if (card) card.querySelector("p").textContent = connected
    ? "FastAPI is connected. Bin readings, fleet assignments, collections, and scan results are stored by the backend for this server session."
    : (message || "FastAPI is unavailable. Start the backend to load or save dashboard data.");
  if (pill) {
    pill.textContent = connected ? "CONNECTED" : "OFFLINE";
    pill.classList.toggle("status-connected", connected);
    pill.classList.toggle("status-pending", !connected);
  }
}

function adaptBackendBin(row, index) {
  const fill = Number(row.fill_level) || 0;
  return { ...row, ward: row.ward || ["Central", "North", "South"][index % 3],
    waste_type: normalizeWasteType(row.waste_type), priority: getPriority(fill),
    priority_score: fill, collection_needed: fill >= 65,
    last_updated: row.updated_at ? new Date(row.updated_at) : new Date(),
    history: row.history || [fill] };
}

function adaptBackendTruck(row, index) {
  const depot = row.depot || row.current_location || [12.9325, 77.62];
  return { ...row, zone: row.zone || row.name || `Zone ${index + 1}`,
    status: row.status === "On collection" ? "On collection" : "Available",
    bins: [...(row.assigned_bins || [])], assigned: row.assigned_bins_count || 0,
    capacity: 4, fuel: row.battery_level || 100, color: row.color || ["#00D9FF", "#C084FC", "#FF8A3D"][index % 3],
    depot, current_location: row.current_location || depot };
}

async function syncBackendState() {
  try {
    await apiRequest("/api/health");
    const [serverBins, serverFleet, serverCollections, serverActivities, serverPriorities, serverRecommendations] = await Promise.all([
      apiRequest("/api/bins"), apiRequest("/api/fleet"), apiRequest("/api/collections"), apiRequest("/api/activities"),
      apiRequest("/api/priorities"), apiRequest("/api/recommendations")
    ]);
    bins.splice(0, bins.length, ...serverBins.map(adaptBackendBin));
    fleet.splice(0, fleet.length, ...serverFleet.map(adaptBackendTruck));
    collectionHistory = serverCollections.map(item => ({ at: new Date(item.timestamp), bin: item.bin_id,
      area: bins.find(bin => bin.bin_id === item.bin_id)?.area || item.bin_id,
      before: item.fill_level_before, waste: item.waste_category, truck: item.vehicle_id }));
    activityEvents = serverActivities.map(item => ({ id: item.id, title: item.message,
      description: item.bin_id ? `Backend record · ${item.bin_id}` : "Recorded by FastAPI", time: new Date(), type: "normal" }));
    backendPriorityOrder = serverPriorities.map(item => item.bin_id);
    backendRecommendations = serverRecommendations.recommendations || [];
    updateBackendStatus(true);
    return true;
  } catch (error) {
    updateBackendStatus(false, `Cannot reach ${API_BASE_URL}. Start FastAPI, then refresh this page. (${error.message})`);
    return false;
  }
}

async function refreshVisionStatus() {
  const pill = $("vision-readiness-pill");
  if (!pill) return;
  try {
    const status = await apiRequest("/api/vision/status");
    pill.textContent = status.available ? "YOLO PACKAGE OK" : "VISION SETUP NEEDED";
    pill.title = status.available
      ? `Ultralytics ${status.ultralytics_version}; ${status.waste_model} (first scan may download weights). No API key required.`
      : `Install the vision dependencies in backend: python -m pip install -r requirements.txt. ${status.dependency_error || ""}`;
    pill.classList.toggle("status-pending", !status.available);
    pill.classList.toggle("status-connected", status.available);
  } catch (error) {
    pill.textContent = "VISION SERVICE OFFLINE";
    pill.title = error.message;
    pill.classList.add("status-pending");
  }
}

/* ---------- General helpers ---------- */

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatTime(date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getCollectionRecommendations() {
  return bins
    .filter(bin => bin.collection_needed)
    .sort((a, b) =>
      ((backendPriorityOrder.indexOf(a.bin_id) < 0 ? 999 : backendPriorityOrder.indexOf(a.bin_id)) -
       (backendPriorityOrder.indexOf(b.bin_id) < 0 ? 999 : backendPriorityOrder.indexOf(b.bin_id))) ||
      b.fill_level - a.fill_level ||
      a.bin_id.localeCompare(b.bin_id)
    );
}

/* ---------- Activity feed ---------- */

function addActivity(title, description, type) {
  activityEvents.unshift({
    id: Date.now() + Math.random(),
    title,
    description,
    type: type || "normal",
    time: new Date()
  });

  activityEvents = activityEvents.slice(0, 30);
  renderActivity();
}

function renderActivity() {
  const feed = $("activity-feed");
  if (!feed) return;

  if (!activityEvents.length) {
    feed.innerHTML =
      '<div class="queue-empty"><strong>No recent events</strong><span>Events generated by the simulation will appear here.</span></div>';
    return;
  }

  feed.innerHTML = activityEvents.map(event => {
    let icon = "↻";

    if (event.type === "critical") icon = "!";
    else if (event.type === "warning") icon = "△";
    else if (event.type === "success") icon = "✓";

    const iconClass =
      event.type === "critical" || event.type === "warning"
        ? event.type
        : "";

    return `
      <article class="activity-item">
        <span class="activity-icon ${iconClass}">${icon}</span>
        <div class="activity-copy">
          <strong>${escapeHTML(event.title)}</strong>
          <p>${escapeHTML(event.description)}</p>
        </div>
        <time class="activity-time">${formatTime(event.time)}</time>
      </article>
    `;
  }).join("");
}

/* ---------- Bin list and selection ---------- */

function getFilteredBins() {
  const query = $("search-bin")
    ? $("search-bin").value.trim().toLowerCase()
    : "";

  const results = bins.filter(bin => {
    const matchesSearch =
      bin.bin_id.toLowerCase().includes(query) ||
      bin.area.toLowerCase().includes(query);

    const matchesPriority =
      activeFilter === "ALL" || bin.priority === activeFilter;

    const matchesMapPriority =
      mapPriorityFilter === "ALL" ||
      bin.priority === mapPriorityFilter;

    return matchesSearch && matchesPriority && matchesMapPriority;
  });
  return results;
}

function renderBinList() {
  const container = $("bin-list");
  if (!container) return;

  const visibleBins = getFilteredBins();

  if ($("bin-count")) {
    $("bin-count").textContent = String(bins.length).padStart(2, "0");
  }

  if ($("visible-bin-count")) {
    $("visible-bin-count").textContent = visibleBins.length;
  }

  if (!visibleBins.length) {
    container.innerHTML =
      '<div class="empty-detail">No bins match your search or filters.</div>';
    return;
  }

  container.innerHTML = visibleBins.map(bin => {
    const selected = bin.bin_id === selectedBinId;

    return `
      <button type="button"
        class="bin-item ${selected ? "selected" : ""}"
        data-bin-id="${bin.bin_id}"
        aria-pressed="${selected}">
        <div class="bin-item-top">
          <span class="bin-name">${escapeHTML(bin.bin_id)}</span>
          <span class="priority-label ${bin.priority}">${bin.priority}</span>
        </div>
        <div class="mini-track">
          <div class="mini-fill ${bin.priority}"
            style="width:${bin.fill_level}%"></div>
        </div>
        <div class="bin-item-bottom">
          <span>${escapeHTML(bin.area)}</span>
          <strong>${bin.fill_level}%</strong>
        </div>
      </button>
    `;
  }).join("");

  container.querySelectorAll("[data-bin-id]").forEach(button => {
    button.addEventListener("click", () => {
      selectBin(button.dataset.binId, true);
    });
  });
}

function renderBinDetails(bin) {
  const panel = $("bin-detail-content");
  if (!bin || !panel) return;
  const truck = fleet.find(item => item.bins.includes(bin.bin_id));
  const status = bin.fill_level >= 90 ? "Overflow risk" : bin.fill_level >= 75 ? "Full" : bin.fill_level >= 65 ? "Nearly full" : "Normal";
  panel.innerHTML = `<div class="detail-grid"><div><span>Bin / area</span><strong>${escapeHTML(bin.bin_id)} · ${escapeHTML(bin.area)}</strong></div><div><span>Fill level</span><strong>${bin.fill_level}%</strong></div><div><span>Waste category</span><strong>${escapeHTML(bin.waste_type)} waste</strong></div><div><span>Status / priority</span><strong>${status} · ${bin.priority}</strong></div><div><span>Assigned truck</span><strong>${truck ? escapeHTML(truck.id) : "Unassigned"}</strong></div><div><span>Last reading</span><strong>${formatTime(bin.last_updated)}</strong></div><div><span>Last collection</span><strong>${bin.last_collection ? formatTime(bin.last_collection) : "No session collection"}</strong></div><div><span>Data source</span><strong>${escapeHTML(bin.data_type || "FastAPI demo record")}</strong></div></div><div class="detail-actions"><button class="button button-secondary button-small" data-detail-dispatch="${bin.bin_id}">Dispatch truck</button><button class="button button-primary button-small" data-detail-collect="${bin.bin_id}">Complete collection</button></div><div class="history-caption">Fill history · FastAPI backend</div><div class="mini-history">${renderMiniHistory(bin)}</div>`;
  panel.querySelector("[data-detail-dispatch]")?.addEventListener("click", () => dispatchBin(bin.bin_id));
  panel.querySelector("[data-detail-collect]")?.addEventListener("click", () => collectBin(bin.bin_id));
}

function renderMiniHistory(bin) {
  const points = fillHistory.filter(point => point.id === bin.bin_id).slice(-12);
  if (!points.length) return `<span class="empty-state">History starts with the next simulated reading.</span>`;
  const max = Math.max(100, ...points.map(point => point.fill));
  return points.map(point => `<i title="${point.fill}%" style="height:${Math.max(8, point.fill / max * 100)}%"></i>`).join("");
}

async function collectBin(binId) {
  const bin = bins.find(item => item.bin_id === binId);
  if (!bin) return;
  const before = bin.fill_level;
  try {
    await apiRequest(`/api/bins/${encodeURIComponent(binId)}/collect?vehicle_id=${encodeURIComponent(truck?.id || "TRK-01")}`, { method: "POST" });
    await syncBackendState();
  } catch (error) {
    addActivity("Collection was not saved", error.message, "warning");
    return;
  }
  bin.fill_level = 0;
  bin.priority = "LOW";
  bin.priority_score = 0;
  bin.collection_needed = false;
  bin.last_updated = new Date();
  bin.last_collection = new Date();
  bin.status = "Collected";
  addActivity("Collection saved to FastAPI", `${binId} reset from ${before}% to 0%. Vehicle movement remains a local route simulation.`, "success");
  renderDashboard(); renderNewSections();
}

async function dispatchBin(binId) {
  const bin = bins.find(item => item.bin_id === binId);
  const truck = fleet.find(item => item.status === "Available" && item.bins.length < item.capacity);
  if (!bin || !truck) { addActivity("Dispatch unavailable", "No available demo truck has spare capacity.", "warning"); return; }
  try {
    const assignments = [...new Set([...truck.bins, binId])];
    await apiRequest("/api/fleet/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ truck_id: truck.id, bin_ids: assignments }) });
    bin.collection_needed = true;
    bin.priority = getPriority(bin.fill_level);
    bin.priority_score = bin.fill_level;
    addActivity("Truck route saved", `${truck.id} assigned to ${binId} in ${bin.area} through FastAPI.`, "success");
    renderDashboard();
    generateTruckRoutes();
  } catch (error) { addActivity("Dispatch failed", error.message, "warning"); }
}

function createMarkerIcon(bin, isSelected) {
  const dustbinIcon = `
    <svg xmlns="http://www.w3.org/2000/svg"
      width="23" height="23" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" focusable="false">
      <path d="M3 6h18"/>
      <path d="M8 6V4h8v2"/>
      <path d="m19 6-1 14H6L5 6"/>
      <path d="M10 10v6M14 10v6"/>
    </svg>
  `;

  return L.divIcon({
    className: "custom-bin-marker",
    html: `
      <div class="bin-marker ${bin.priority}${isSelected ? " selected" : ""}"
        title="${escapeHTML(bin.bin_id)}">
        ${dustbinIcon}
      </div>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -22]
  });
}

function updateMarker(bin) {
  const marker = markers[bin.bin_id];
  if (!marker) return;

  marker.setIcon(createMarkerIcon(bin, bin.bin_id === selectedBinId));

  const assignedTruck = fleet.find(truck =>
    truck.bins.includes(bin.bin_id)
  );

  marker.setPopupContent(`
    <strong>${escapeHTML(bin.bin_id)}</strong><br>
    <span class="popup-muted">${escapeHTML(bin.area)}</span><br>
    Fill level: <b>${bin.fill_level}%</b><br>
    Priority: <b>${bin.priority}</b><br>
    Collection: <b>${bin.collection_needed ? "Required" : "Not currently flagged"}</b><br>
    ${
      assignedTruck
        ? `<span style="color:${assignedTruck.color};font-weight:700">🚛 Assigned to ${escapeHTML(assignedTruck.id)}</span><br>`
        : '<span class="popup-muted">No truck assigned yet</span><br>'
    }
    <span class="popup-muted">Simulated reading · ${formatTime(bin.last_updated)}</span>
  `);
}

function selectBin(binId, moveMap) {
  const bin = bins.find(item => item.bin_id === binId);
  if (!bin) return;

  selectedBinId = binId;
  renderBinList();
  renderBinDetails(bin);
  renderExtraAnalytics();

  Object.keys(markers).forEach(id => {
    const marker = markers[id];
    const markerBin = bins.find(item => item.bin_id === id);
    if (!marker || !markerBin) return;

    marker.setIcon(createMarkerIcon(markerBin, id === selectedBinId));
    marker.setZIndexOffset(id === selectedBinId ? 1000 : 0);
  });

  if (moveMap && map) {
    map.flyTo([bin.latitude, bin.longitude], 16, { duration: 0.5 });
    if (markers[binId]) markers[binId].openPopup();
  }
}

function applyFilters() {
  const visibleIds = getFilteredBins().map(bin => bin.bin_id);

  renderBinList();

  Object.keys(markers).forEach(id => {
    const marker = markers[id];
    if (!marker || !map) return;

    if (visibleIds.includes(id)) {
      if (!map.hasLayer(marker)) marker.addTo(map);
    } else if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });

  if (visibleIds.length && !visibleIds.includes(selectedBinId)) {
    selectBin(visibleIds[0], false);
  }
}

/* ---------- Dashboard metrics ---------- */

function renderMetrics() {
  const total = bins.length;
  const highCount = bins.filter(bin => bin.priority === "HIGH").length;

  const average = total
    ? Math.round(bins.reduce((sum, bin) => sum + bin.fill_level, 0) / total)
    : 0;

  const queue = getCollectionRecommendations();

  if ($("metric-total")) $("metric-total").textContent = total;
  if ($("metric-high")) $("metric-high").textContent = highCount;
  if ($("metric-average")) $("metric-average").textContent = average;
  if ($("metric-queue")) $("metric-queue").textContent = queue.length;
  if ($("nav-queue-count")) $("nav-queue-count").textContent = queue.length;
  if ($("hero-queue-count")) $("hero-queue-count").textContent = String(queue.length).padStart(2, "0");

  if ($("queue-count")) {
    $("queue-count").textContent =
      queue.length + (queue.length === 1 ? " bin" : " bins");
  }

  if ($("readiness-flagged")) $("readiness-flagged").textContent = queue.length;
  if ($("readiness-clear")) $("readiness-clear").textContent = total - queue.length;

  const criticalCount = bins.filter(bin => bin.fill_level >= 90).length;
  if ($("readiness-critical")) $("readiness-critical").textContent = criticalCount;

  if ($("readiness-flagged-bar")) {
    $("readiness-flagged-bar").style.width =
      (total ? queue.length / total * 100 : 0) + "%";
  }

  if ($("readiness-clear-bar")) {
    $("readiness-clear-bar").style.width =
      (total ? (total - queue.length) / total * 100 : 0) + "%";
  }

  if ($("readiness-critical-bar")) {
    $("readiness-critical-bar").style.width =
      (total ? criticalCount / total * 100 : 0) + "%";
  }

  if ($("health-score")) $("health-score").textContent = average + "%";

  const healthColor =
    average >= 80 ? "#fb7185" :
    average >= 60 ? "#fbbf24" :
    "#2dd4bf";

  if ($("health-ring")) {
    $("health-ring").style.background =
      `conic-gradient(${healthColor} ${average * 3.6}deg, #26364a 0deg)`;
  }

  if ($("health-title") && $("health-description")) {
    if (average >= 80) {
      $("health-title").textContent = "Capacity under pressure";
      $("health-description").textContent =
        "The average fill level is high in this simulated dataset. Prioritize bins approaching capacity.";
    } else if (average >= 60) {
      $("health-title").textContent = "Monitor capacity closely";
      $("health-description").textContent =
        "The average capacity is elevated. Review the ranked queue and monitor changes.";
    } else {
      $("health-title").textContent = "Capacity within demo range";
      $("health-description").textContent =
        "The current average is below the elevated range. Individual bins may still require collection.";
    }
  }

  if ($("fleet-total")) $("fleet-total").textContent = fleet.length;

  if ($("fleet-available")) {
    $("fleet-available").textContent =
      fleet.filter(truck => truck.status === "Available").length;
  }

  if ($("fleet-active")) {
    $("fleet-active").textContent =
      fleet.filter(truck => truck.status === "On collection").length;
  }
}

function renderCollectionRecommendations() {
  const container = $("collection-queue");
  if (!container) return;

  const recommendations = getCollectionRecommendations();

  if (!recommendations.length) {
    container.innerHTML = `
      <div class="queue-empty">
        <strong>No bins currently flagged for collection</strong>
        <span>The simulated collection threshold is 65%.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = recommendations.map((bin, index) => {
    let reason = "Collection threshold reached";

    if (bin.fill_level >= 95) reason = "Near capacity — collect first";
    else if (bin.fill_level >= 90) reason = "Critical fill level";
    else if (bin.fill_level >= 75) reason = "High priority collection";
    else if (bin.fill_level >= 65) reason = "Threshold reached";

    return `
      <button type="button" class="recommendation-item"
        data-recommendation-bin="${bin.bin_id}">
        <div class="recommendation-top">
          <span class="recommendation-rank">#${index + 1}</span>
          <strong>${escapeHTML(bin.bin_id)}</strong>
          <span class="priority-label ${bin.priority}">${bin.priority}</span>
        </div>
        <div class="recommendation-area">${escapeHTML(bin.area)}</div>
        <div class="recommendation-progress">
          <span class="${bin.priority}" style="width:${bin.fill_level}%"></span>
        </div>
        <div class="recommendation-bottom">
          <strong>${bin.fill_level}% full</strong>
          <span class="recommendation-reason">${reason}</span>
        </div>
      </button>
    `;
  }).join("");

  container.querySelectorAll("[data-recommendation-bin]").forEach(button => {
    button.addEventListener("click", () => {
      selectBin(button.dataset.recommendationBin, true);
    });
  });
}

function renderFillDistribution() {
  const container = $("fill-distribution");
  if (!container) return;

  const groups = [
    { label: "Low · 0–44%", key: "low", test: bin => bin.fill_level < 45 },
    { label: "Medium · 45–74%", key: "medium", test: bin => bin.fill_level >= 45 && bin.fill_level < 75 },
    { label: "High · 75–89%", key: "high", test: bin => bin.fill_level >= 75 && bin.fill_level < 90 },
    { label: "Critical · 90–100%", key: "critical", test: bin => bin.fill_level >= 90 }
  ];

  container.innerHTML = groups.map(group => {
    const count = bins.filter(group.test).length;
    const width = bins.length ? count / bins.length * 100 : 0;

    return `
      <button type="button" class="distribution-row chart-row-button" data-chart-kind="fill-band" data-chart-key="${group.key}">
        <span class="distribution-label">${group.label}</span>
        <div class="distribution-track">
          <div class="distribution-bar ${group.key}" style="width:${width}%"></div>
        </div>
        <span class="distribution-value">${count}</span>
      </button>
    `;
  }).join("");
}

function renderPriorityBreakdown() {
  const container = $("priority-breakdown");
  if (!container) return;

  container.innerHTML = ["HIGH", "MEDIUM", "LOW"].map(priority => {
    const count = bins.filter(bin => bin.priority === priority).length;
    const percentage = bins.length
      ? Math.round(count / bins.length * 100)
      : 0;

    return `
      <button type="button" class="priority-breakdown-row chart-row-button" data-chart-kind="priority" data-chart-key="${priority}">
        <div class="priority-breakdown-label">
          <span>${priority.charAt(0) + priority.slice(1).toLowerCase()} priority</span>
          <strong>${count}
            <span style="color:#8297ae;font-weight:500">(${percentage}%)</span>
          </strong>
        </div>
        <div class="priority-track">
          <span class="${priority}" style="width:${percentage}%"></span>
        </div>
      </button>
    `;
  }).join("");
}

function renderFleet() {
  const container = $("fleet-table");
  if (!container) return;

  container.innerHTML = fleet.map(truck => {
    const available = truck.status === "Available";

    return `
      <tr>
        <td>
          <span class="vehicle-name" style="color:${truck.color}">
            🚛 ${escapeHTML(truck.id)}
          </span>
          <span class="vehicle-sub">${escapeHTML(truck.name)}</span>
        </td>
        <td>${escapeHTML(truck.zone)}</td>
        <td>
          <span class="fleet-status ${available ? "available" : "on-route"}">
            ${available ? "● Available" : "● On collection"}
          </span>
        </td>
        <td>${truck.assigned}/${truck.capacity}<span class="vehicle-sub"> bins</span></td>
        <td>${truck.fuel}%<span class="vehicle-sub">Illustrative level</span></td>
      </tr>
    `;
  }).join("");
}

/* ---------- Map controls ---------- */

function addTruckMapControls() {
  if (!map || $("truck-map-controls")) return;

  const control = document.createElement("div");
  control.id = "truck-map-controls";

  control.innerHTML = `
    <div class="truck-control-title">🚛 Fleet dispatch</div>
    <div class="truck-control-subtitle">Dispatch to pending bins. The truck follows the highlighted active leg, completes a demo collection at each stop, then clears that segment.</div>
    <button type="button" id="generate-truck-routes">Dispatch &amp; animate route</button>
    <button type="button" id="clear-truck-routes" class="secondary">Clear routes</button>
    <div id="truck-route-summary" aria-live="polite">No routes generated yet.</div>
    <div class="truck-legend">
      <div><span style="background:#00D9FF"></span> TRK-01 · Central</div>
      <div><span style="background:#C084FC"></span> TRK-02 · North</div>
      <div><span style="background:#FF8A3D"></span> TRK-03 · South</div>
    </div>
  `;

  Object.assign(control.style, {
    position: "absolute",
    top: "12px",
    right: "12px",
    zIndex: "1000",
    width: "230px",
    padding: "14px",
    borderRadius: "14px",
    background: "rgba(12,23,39,.97)",
    color: "#e8f0fb",
    border: "1px solid rgba(148,163,184,.3)",
    boxShadow: "0 8px 28px rgba(0,0,0,.35)",
    font: "12px/1.45 system-ui,sans-serif"
  });

  const style = document.createElement("style");

  style.textContent = `
    #truck-map-controls .truck-control-title {
      font-size:14px;font-weight:800;margin-bottom:3px
    }
    #truck-map-controls .truck-control-subtitle {
      color:#9fb1c8;margin-bottom:10px
    }
    #truck-map-controls button {
      display:block;width:100%;border:0;border-radius:8px;
      padding:9px 10px;margin:6px 0 0;cursor:pointer;
      background:linear-gradient(100deg,#22d3ee,#38bdf8);color:#04131e;font-weight:800
    }
    #truck-map-controls button.secondary {
      background:#0e1725;color:#e2e8f0;border:1px solid #26374b
    }
    #truck-map-controls button:disabled {
      opacity:.65;cursor:wait
    }
    #truck-route-summary {
      border-top:1px solid #304157;margin-top:10px;
      padding-top:9px;color:#b9c8da
    }
    #truck-map-controls .truck-legend {
      border-top:1px solid #304157;margin-top:9px;
      padding-top:8px;display:grid;gap:5px;color:#c7d4e4
    }
    #truck-map-controls .truck-legend div {
      display:flex;align-items:center;gap:7px
    }
    #truck-map-controls .truck-legend span {
      width:11px;height:11px;border-radius:50%;
      display:inline-block;box-shadow:0 0 0 2px #ffffff20
    }
    .citypulse-truck-icon {background:transparent;border:0}
  `;

  document.head.appendChild(style);
  map.getContainer().appendChild(control);

  $("generate-truck-routes").addEventListener("click", generateTruckRoutes);
  $("clear-truck-routes").addEventListener("click", clearTruckRoutes);
}

/* ---------- Road routing ---------- */

async function getRoadRoute(points) {
  const coordinates = points.map(point => point[1] + "," + point[0]).join(";");

  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    coordinates +
    "?overview=full&geometries=geojson&steps=false";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Routing service returned HTTP " + response.status);
    const data = await response.json();
    if (data.code !== "Ok" || !data.routes?.length || !data.waypoints?.length) {
      throw new Error("No usable road route was returned.");
    }
    return {
      coordinates: data.routes[0].geometry.coordinates.map(point => [point[1], point[0]]),
      snappedWaypoints: data.waypoints.map(waypoint => [waypoint.location[1], waypoint.location[0]]),
      distance: data.routes[0].distance,
      duration: data.routes[0].duration,
      source: "OSRM"
    };
  } catch (error) {
    // Offline/demo fallback keeps the truck animation usable without claiming road directions.
    const route = [];
    let distance = 0;
    const radians = value => value * Math.PI / 180;
    for (let leg = 0; leg < points.length - 1; leg++) {
      const [lat1, lon1] = points[leg];
      const [lat2, lon2] = points[leg + 1];
      const latDelta = lat2 - lat1;
      const lonDelta = lon2 - lon1;
      const span = Math.hypot(latDelta, lonDelta);
      const curve = Math.min(span * 0.12, 0.0018) * (leg % 2 ? -1 : 1);
      for (let step = 0; step <= 18; step++) {
        if (leg && step === 0) continue;
        const t = step / 18;
        const bend = Math.sin(Math.PI * t) * curve;
        route.push([
          lat1 + latDelta * t + (span ? -lonDelta / span : 0) * bend,
          lon1 + lonDelta * t + (span ? latDelta / span : 0) * bend
        ]);
      }
      const a = radians(lat1);
      const b = radians(lat2);
      const dLat = b - a;
      const dLon = radians(lon2 - lon1);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dLon / 2) ** 2;
      distance += 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    return {
      coordinates: route,
      snappedWaypoints: points,
      distance: distance * 1.25,
      duration: distance * 1.25 / (20 / 3.6),
      source: "SIMULATED",
      fallbackMessage: error.message
    };
  }
}

function nearestRouteIndex(path, point, startIndex) {
  let bestIndex = startIndex;
  let bestDistance = Infinity;

  for (let i = startIndex; i < path.length; i++) {
    const latDiff = path[i][0] - point[0];
    const lngDiff = path[i][1] - point[1];
    const distance = latDiff * latDiff + lngDiff * lngDiff;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function shadeTruckColor(hex, amount, towardWhite) {
  const value = hex.replace("#", "");
  const channels = [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];

  return "#" + channels.map(channel => {
    const target = towardWhite ? 255 : 0;
    return Math.round(channel + (target - channel) * amount)
      .toString(16).padStart(2, "0");
  }).join("");
}

function removeCurrentTruckLeg(truckId) {
  const layers = routeLines[truckId] || [];

  layers.forEach(layer => {
    if (map && map.hasLayer(layer)) map.removeLayer(layer);
  });

  delete routeLines[truckId];
}

function removeTruckOverview(truckId) {
  const layer = routeOverviewLines[truckId];
  if (map && layer && map.hasLayer(layer)) map.removeLayer(layer);
  delete routeOverviewLines[truckId];
}

function drawTruckLeg(truck, segment, legIndex) {
  removeCurrentTruckLeg(truck.id);

  const routeColor = legIndex === 0
    ? shadeTruckColor(truck.color, 0.25, false)
    : shadeTruckColor(truck.color, 0.30, true);

  const casing = L.polyline(segment, {
    color: "#07111F",
    weight: 11,
    opacity: 0.97,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(map);

  const coloredLine = L.polyline(segment, {
    color: routeColor,
    weight: 6,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(map);

  routeLines[truck.id] = [casing, coloredLine];
}

function animateTruckLeg(truckId, path, marker) {
  if (!path || path.length < 2 || !marker) {
    return Promise.resolve(true);
  }

  const token = (animationTokens[truckId] || 0) + 1;
  animationTokens[truckId] = token;

  const startTime = performance.now();
  const duration = Math.max(4000, Math.min(path.length * 18, 8500));

  return new Promise(resolve => {
    let finished = false;

    function finish(success) {
      if (finished) return;
      finished = true;
      delete animationFrames[truckId];
      delete animationResolvers[truckId];
      resolve(success);
    }

    animationResolvers[truckId] = finish;

    function animate(now) {
      if (animationTokens[truckId] !== token) {
        finish(false);
        return;
      }

      const progress = Math.min((now - startTime) / duration, 1);
      const position = progress * (path.length - 1);
      const index = Math.min(Math.floor(position), path.length - 2);
      const fraction = position - index;
      const current = path[index];
      const next = path[index + 1];

      marker.setLatLng([
        current[0] + (next[0] - current[0]) * fraction,
        current[1] + (next[1] - current[1]) * fraction
      ]);

      if (progress < 1) {
        animationFrames[truckId] = requestAnimationFrame(animate);
      } else {
        marker.setLatLng(path[path.length - 1]);
        finish(true);
      }
    }

    animationFrames[truckId] = requestAnimationFrame(animate);
  });
}

async function runTruckRouteProgress(plan) {
  const { truck, path, waypointIndices, orderedBins, marker } = plan;

  for (let leg = 0; leg < waypointIndices.length - 1; leg++) {
    if (animationTokens[truck.id] === -1) return;

    const startIndex = waypointIndices[leg];
    const endIndex = waypointIndices[leg + 1];

    if (endIndex <= startIndex) continue;

    const segment = path.slice(startIndex, endIndex + 1);
    if (segment.length < 2) continue;

    // Only this leg is visible while the truck travels.
    drawTruckLeg(truck, segment, leg);

    const completed = await animateTruckLeg(truck.id, segment, marker);
    if (!completed || animationTokens[truck.id] === -1) return;

    removeCurrentTruckLeg(truck.id);

    if (leg < orderedBins.length) {
      const bin = orderedBins[leg];

      await collectBin(bin.bin_id);
      if (originalBinPositions[bin.bin_id] && markers[bin.bin_id]) {
        markers[bin.bin_id].setLatLng(originalBinPositions[bin.bin_id]);
        delete originalBinPositions[bin.bin_id];
      }

      addActivity(
        "Truck reached route stop",
        truck.id + " reached " + bin.bin_id +
          " (" + bin.area + "). The next leg is now being revealed.",
        "success"
      );

      const summary = $("truck-route-summary");
      if (summary) {
        summary.dataset.progress = truck.id + " reached " + bin.bin_id;
      }
    }
  }

  truck.status = "Available";
  renderDashboard();

  addActivity(
    "Demo route completed",
    truck.id + " finished its simulated route. No real-world collection was verified.",
    "success"
  );

  const summary = $("truck-route-summary");
  if (summary) {
    const row = document.createElement("div");
    row.style.color = "#4ade80";
    row.textContent = truck.id + ": route animation completed.";
    summary.appendChild(row);
  }
}

function clearTruckRoutes(resetAssignments) {
  Object.keys(animationFrames).forEach(id => {
    cancelAnimationFrame(animationFrames[id]);
  });

  Object.keys(animationResolvers).forEach(id => {
    animationTokens[id] = -1;
    const finish = animationResolvers[id];
    if (finish) finish(false);
  });

  animationFrames = {};
  animationResolvers = {};

  Object.keys(routeLines).forEach(removeCurrentTruckLeg);
  Object.keys(routeOverviewLines).forEach(removeTruckOverview);

  Object.keys(truckMarkers).forEach(id => {
    if (map && truckMarkers[id] && map.hasLayer(truckMarkers[id])) {
      map.removeLayer(truckMarkers[id]);
    }
  });

  routeLines = {};
  truckMarkers = {};

  Object.keys(originalBinPositions).forEach(id => {
    if (markers[id]) markers[id].setLatLng(originalBinPositions[id]);
  });

  originalBinPositions = {};

  if (resetAssignments !== false) {
    fleet.forEach(truck => {
      truck.bins = [];
      truck.assigned = 0;
      truck.status = "Available";
    });

    bins.forEach(bin => {
      delete bin.assignedTruckId;
    });

    renderDashboard();

    const summary = $("truck-route-summary");
    if (summary) {
      summary.textContent = "Routes cleared. Generate routes to assign bins.";
      delete summary.dataset.progress;
    }

    addActivity(
      "Routes cleared",
      "Truck routes and assignments were reset.",
      "normal"
    );
  }
}

async function generateTruckRoutes() {
  if (!map) return;

  const generateButton = $("generate-truck-routes");
  const summary = $("truck-route-summary");

  if (!generateButton || !summary || generateButton.disabled) return;

  generateButton.disabled = true;
  generateButton.textContent = "Preparing truck routes...";
  summary.textContent = "Assigning collection stops and preparing truck paths...";

  try {
    clearTruckRoutes(false);

    fleet.forEach(truck => {
      truck.bins = [];
      truck.assigned = 0;
      truck.status = "Available";
    });

    bins.forEach(bin => {
      delete bin.assignedTruckId;
    });

    const queue = bins
      .filter(bin => bin.collection_needed)
      .sort((a, b) => b.fill_level - a.fill_level);

    // Simple nearest-next assignment heuristic, not an AI optimizer.
    queue.forEach(bin => {
      const candidates = fleet
        .filter(truck => truck.bins.length < truck.capacity)
        .sort((a, b) => {
          function distanceToTruck(truck) {
            const lastBin = truck.bins.length
              ? bins.find(item => item.bin_id === truck.bins[truck.bins.length - 1])
              : null;

            const point = lastBin
              ? [lastBin.latitude, lastBin.longitude]
              : truck.depot;

            return Math.hypot(
              bin.latitude - point[0],
              bin.longitude - point[1]
            );
          }

          return distanceToTruck(a) - distanceToTruck(b);
        });

      if (candidates.length) {
        candidates[0].bins.push(bin.bin_id);
        bin.assignedTruckId = candidates[0].id;
      }
    });

    for (const truck of fleet) {
      if (!truck.bins.length) continue;
      await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ truck_id: truck.id, bin_ids: truck.bins })
      });
      truck.status = "On collection";
      truck.assigned = truck.bins.length;
    }

    let successfulRoutes = 0;
    let failedRoutes = 0;
    let totalDistance = 0;
    let totalDuration = 0;
    let assignedTotal = 0;
    const plans = [];

    for (const truck of fleet) {
      if (!truck.bins.length) continue;

      const orderedBins = truck.bins
        .map(id => bins.find(bin => bin.bin_id === id))
        .filter(Boolean);

      const requestedPoints = [
        truck.depot,
        ...orderedBins.map(bin => [bin.latitude, bin.longitude]),
        truck.depot
      ];

      try {
        const roadRoute = await getRoadRoute(requestedPoints);
        const path = roadRoute.coordinates;
        const stops = roadRoute.snappedWaypoints;

        if (path.length < 2 || stops.length !== requestedPoints.length) {
          throw new Error("The returned route is incomplete.");
        }

        routeOverviewLines[truck.id] = L.polyline(path, {
          color: truck.color,
          weight: 4,
          opacity: 0.72,
          dashArray: "8 7",
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        }).addTo(map);

        orderedBins.forEach((bin, index) => {
          const marker = markers[bin.bin_id];
          const snappedStop = stops[index + 1];

          if (marker && snappedStop) {
            if (!originalBinPositions[bin.bin_id]) {
              originalBinPositions[bin.bin_id] = marker.getLatLng();
            }
            marker.setLatLng(snappedStop);
          }
        });

        const waypointIndices = [];
        let searchFrom = 0;

        stops.forEach(stop => {
          const index = nearestRouteIndex(path, stop, searchFrom);
          waypointIndices.push(index);
          searchFrom = index;
        });

        const truckIcon = L.divIcon({
          className: "citypulse-truck-icon",
          html: `
            <div title="${escapeHTML(truck.id)}"
              style="background:${truck.color};width:38px;height:38px;
              border:2px solid #fff;border-radius:12px;display:flex;
              align-items:center;justify-content:center;
              box-shadow:0 4px 12px #0008;font-size:22px">
              🚛
            </div>
          `,
          iconSize: [42, 42],
          iconAnchor: [21, 21]
        });

        const truckMarker = L.marker(stops[0], {
          icon: truckIcon,
          zIndexOffset: 2000
        }).addTo(map);

        truckMarkers[truck.id] = truckMarker;

        truckMarker.bindPopup(`
          <strong style="color:${truck.color}">${escapeHTML(truck.id)}</strong><br>
          ${escapeHTML(truck.name)}<br>
          Assigned bins: ${orderedBins.length}<br>
          Collection order:<br>
          ${orderedBins.map(bin => escapeHTML(bin.bin_id)).join(" → ")}<br>
          <span class="popup-muted">${roadRoute.source === "OSRM" ? "Road directions · demo vehicle animation" : "Simulated demo route · routing service unavailable"}</span>
        `);

        truck.assigned = orderedBins.length;
        truck.status = "On collection";

        plans.push({
          truck,
          path,
          waypointIndices,
          orderedBins,
          marker: truckMarker,
          source: roadRoute.source
        });

        totalDistance += roadRoute.distance;
        totalDuration += roadRoute.duration;
        assignedTotal += orderedBins.length;
        successfulRoutes++;

      } catch (error) {
        failedRoutes++;
        console.error("Route failed for " + truck.id, error);
        removeTruckOverview(truck.id);

        truck.status = "Available";
        truck.assigned = 0;

        truck.bins.forEach(id => {
          const bin = bins.find(item => item.bin_id === id);
          if (bin) delete bin.assignedTruckId;
        });

        truck.bins = [];
      }
    }

    renderDashboard();
    summary.replaceChildren();

    [
      successfulRoutes + " truck route(s) generated",
      assignedTotal + " bin(s) assigned",
      (plans.some(plan => plan.source !== "OSRM") ? "Illustrative route distance: " : "Estimated road distance: ") + (totalDistance / 1000).toFixed(1) + " km",
      (plans.some(plan => plan.source !== "OSRM") ? "Illustrative route time: " : "Estimated road time: ") + Math.round(totalDuration / 60) + " min"
    ].forEach(line => {
      const row = document.createElement("div");
      row.textContent = line;
      summary.appendChild(row);
    });

    const note = document.createElement("div");
    note.style.color = "#9fb1c8";
    note.style.marginTop = "6px";
    const hasSimulatedRoute = plans.some(plan => plan.source !== "OSRM");
    note.textContent = hasSimulatedRoute
      ? "A routing service was unavailable, so the map shows a simulated demo path. The truck visits each assigned bin, clears that stop from the queue, then returns to its depot."
      : "The highlighted line shows the truck’s current leg to its next assigned collection stop. At each stop, the demo bin resets, that leg clears, and the truck continues before returning to its depot.";
    summary.appendChild(note);

    if (failedRoutes > 0) {
      const warning = document.createElement("div");
      warning.style.color = "#fbbf24";
      warning.style.marginTop = "6px";
      warning.textContent = failedRoutes + " truck route(s) could not be prepared. Try again.";
      summary.appendChild(warning);
    }

    if (assignedTotal < queue.length) {
      const warning = document.createElement("div");
      warning.style.color = "#fbbf24";
      warning.style.marginTop = "6px";
      warning.textContent =
        (queue.length - assignedTotal) +
        " bin(s) remain unassigned because of capacity or route failures.";
      summary.appendChild(warning);
    }

    addActivity(
      "Truck routes generated",
      successfulRoutes + " route(s) generated; " + assignedTotal + " bin(s) assigned.",
      successfulRoutes ? "success" : "warning"
    );

    plans.forEach(plan => {
      runTruckRouteProgress(plan).catch(error => {
        console.error("Truck animation failed:", error);
      });
    });

  } catch (error) {
    console.error("Route generation failed:", error);

    summary.textContent =
      "Route generation failed. Check your connection and try again.";

    addActivity(
      "Route generation failed",
      error.message || "An unexpected error occurred.",
      "warning"
    );

  } finally {
    generateButton.disabled = false;
    generateButton.textContent = "Generate collection routes";
  }
}

/* ---------- Main dashboard refresh ---------- */

function seedFillHistory() {
  fillHistory = [];
  bins.forEach((bin, binIndex) => {
    for (let step = 0; step < 8; step++) {
      const rise = (7 - step) * 2;
      const variation = Math.round(Math.sin((binIndex + 1) * (step + 2)) * 4);
      fillHistory.push({ id:bin.bin_id, fill:Math.max(0, Math.min(100, bin.fill_level - rise + variation)), at:new Date(Date.now() - (7 - step) * 10 * 60 * 1000) });
    }
    fillHistory.push({ id:bin.bin_id, fill:bin.fill_level, at:new Date() });
  });
}

function renderDashboard() {
  renderMetrics();
  renderCollectionRecommendations();
  renderFillDistribution();
  renderPriorityBreakdown();
  renderExtraAnalytics();
  renderFleet();
  applyFilters();

  bins.forEach(updateMarker);

  const selected = bins.find(bin => bin.bin_id === selectedBinId);
  if (selected) renderBinDetails(selected);
  renderNewSections();
}

function renderDonut(svgId, legendId, groups, kind) {
  const svg = $(svgId), legend = $(legendId);
  if (!svg || !legend) return;
  const total = groups.reduce((sum, group) => sum + group.value, 0);
  const radius = 68, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = groups.map(group => {
    const length = total ? circumference * group.value / total : 0;
    const circle = group.value ? `<circle class="donut-segment" tabindex="0" role="button" aria-label="${escapeHTML(group.label)}: ${group.value}" data-chart-kind="${kind}" data-chart-key="${escapeHTML(group.key)}" cx="110" cy="110" r="${radius}" fill="none" stroke="${group.color}" stroke-width="24" stroke-dasharray="${Math.max(0, length - 3)} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 110 110)"><title>${escapeHTML(group.label)} · ${group.value}</title></circle>` : "";
    offset += length;
    return circle;
  }).join("");
  svg.innerHTML = `${segments}<circle cx="110" cy="110" r="49" fill="#0b1320"/><text x="110" y="104" class="donut-total" text-anchor="middle">${total}</text><text x="110" y="126" class="donut-total-label" text-anchor="middle">BINS</text>`;
  legend.innerHTML = groups.map(group => `<button class="legend-item" type="button" data-chart-kind="${kind}" data-chart-key="${escapeHTML(group.key)}"><i style="--legend-color:${group.color}"></i><span>${escapeHTML(group.label)}</span><strong>${group.value}</strong></button>`).join("");
}

function renderExtraAnalytics() {
  const colors = { Plastic: "#22d3ee", Organic: "#34d399", Paper: "#60a5fa", Mixed: "#fbbf24", Metal: "#c084fc", Cardboard: "#fb7185", Glass: "#f59e0b", Collected: "#10b981", "To collect": "#f97316", "On track": "#3b82f6" };
  const categories = ["Plastic", "Organic", "Paper", "Mixed", "Metal", "Cardboard", "Glass"].map(type => ({ key:type, label:type, color:colors[type], value:bins.filter(bin => normalizeWasteType(bin.waste_type) === type).length }));
  const statuses = [
    { key:"To collect", label:"To collect", color:colors["To collect"], value:bins.filter(bin => bin.collection_needed).length },
    { key:"On track", label:"On track", color:colors["On track"], value:bins.filter(bin => !bin.collection_needed && bin.fill_level > 0 && bin.status !== "Collected").length },
    { key:"Collected", label:"Collected", color:colors.Collected, value:bins.filter(bin => bin.fill_level === 0).length }
  ];
  renderDonut("composition-donut", "waste-composition", categories, "composition");
  renderDonut("status-donut", "status-legend", statuses, "status");

  const wards = $("ward-comparison");
  if (wards) wards.innerHTML = ["Central", "North", "South"].map((ward, index) => {
    const count = bins.filter(bin => bin.ward === ward && bin.collection_needed).length;
    const width = Math.max(0, count / Math.max(1, bins.length) * 100);
    return `<button type="button" class="ward-bar-row" data-chart-kind="ward" data-chart-key="${ward}"><span>${ward}</span><span class="composition-track"><b style="width:${width}%;background:${["#22d3ee", "#60a5fa", "#fbbf24"][index]}"></b></span><strong>${count}</strong></button>`;
  }).join("");

  const chart = $("fill-trend-chart");
  const bin = bins.find(item => item.bin_id === selectedBinId);
  if (!chart || !bin) return;
  const points = fillHistory.filter(point => point.id === bin.bin_id).slice(-12);
  const left = 48, right = 620, top = 34, bottom = 196;
  const xFor = index => points.length < 2 ? (left + right) / 2 : left + index * (right - left) / (points.length - 1);
  const yFor = fill => bottom - Math.max(0, Math.min(100, fill)) / 100 * (bottom - top);
  const grid = [0, 50, 100].map(value => `<g class="trend-grid"><line x1="${left}" x2="${right}" y1="${yFor(value)}" y2="${yFor(value)}"/><text x="${left - 10}" y="${yFor(value) + 4}" text-anchor="end">${value}%</text></g>`).join("");
  const line = points.map((point, index) => `${index ? "L" : "M"}${xFor(index)},${yFor(point.fill)}`).join(" ");
  const area = points.length > 1 ? `${line} L${xFor(points.length - 1)},${bottom} L${xFor(0)},${bottom} Z` : "";
  const circles = points.map((point, index) => `<circle class="trend-point" tabindex="0" role="button" aria-label="${bin.bin_id}, ${point.fill}% fill" data-chart-kind="trend" data-chart-key="${index}" data-chart-fill="${point.fill}" data-chart-time="${escapeHTML(formatTime(point.at))}" cx="${xFor(index)}" cy="${yFor(point.fill)}" r="5"><title>${escapeHTML(formatTime(point.at))} · ${point.fill}%</title></circle>`).join("");
  chart.innerHTML = `${grid}${area ? `<path class="trend-area" d="${area}"/>` : ""}<path class="trend-line" d="${line}"/>${circles}<text class="trend-x-label" x="${left}" y="222">Oldest</text><text class="trend-x-label" x="${right}" y="222" text-anchor="end">Latest</text>`;
  $("trend-caption").textContent = `${bin.bin_id} · ${bin.area} · illustrative browser-only trend`;
}

function showChartDrilldown(kind, key, extra = {}) {
  const panel = $("analytics-drilldown");
  if (!panel) return;
  if (kind === "trend") {
    panel.innerHTML = `<strong>${escapeHTML(selectedBinId)} · ${extra.fill}% full</strong><span>Recorded at ${escapeHTML(extra.time)} in this browser session. This is simulated bin history, not backend data.</span>`;
    openDetailPopup("Fill history · " + selectedBinId, panel.innerHTML);
    return;
  }
  let matches = [];
  let heading = "";
  let description = "";
  if (kind === "composition") {
    matches = bins.filter(bin => normalizeWasteType(bin.waste_type) === key);
    const guidance = MATERIAL_GUIDANCE[key];
    heading = `${key} · ${matches.length} demo bin${matches.length === 1 ? "" : "s"}`;
    description = guidance ? `${guidance.stream}. ${guidance.summary}` : "Demo category count.";
  } else if (kind === "status") {
    matches = key === "To collect" ? bins.filter(bin => bin.collection_needed) : key === "Collected" ? bins.filter(bin => bin.fill_level === 0) : bins.filter(bin => !bin.collection_needed && bin.fill_level > 0);
    heading = `${key} · ${matches.length} bin${matches.length === 1 ? "" : "s"}`;
    description = key === "To collect" ? "These bins are at or above the demo collection threshold." : key === "Collected" ? "These bins were completed in this demo state." : "These bins are below the collection threshold.";
  } else if (kind === "ward") {
    matches = bins.filter(bin => bin.ward === key && bin.collection_needed);
    heading = `${key} ward · ${matches.length} pending collection bin${matches.length === 1 ? "" : "s"}`;
    description = "Click a bin below to focus its marker on the map.";
  } else if (kind === "priority") {
    matches = bins.filter(bin => bin.priority === key);
    heading = `${key} priority · ${matches.length} bin${matches.length === 1 ? "" : "s"}`;
    description = "Priority is calculated from the current simulated fill level.";
  } else if (kind === "fill-band") {
    const bands = {
      low:bin => bin.fill_level < 45,
      medium:bin => bin.fill_level >= 45 && bin.fill_level < 75,
      high:bin => bin.fill_level >= 75 && bin.fill_level < 90,
      critical:bin => bin.fill_level >= 90
    };
    matches = bins.filter(bands[key] || (() => false));
    heading = `${key.charAt(0).toUpperCase() + key.slice(1)} fill · ${matches.length} bin${matches.length === 1 ? "" : "s"}`;
    description = "Fill bands use the current FastAPI bin readings.";
  }
  const binButtons = matches.map(bin => `<button class="drilldown-bin" type="button" data-drill-bin="${bin.bin_id}"><strong>${escapeHTML(bin.bin_id)}</strong><span>${escapeHTML(bin.area)} · ${bin.fill_level}%</span><b>↗</b></button>`).join("");
  panel.innerHTML = `<strong>${escapeHTML(heading)}</strong><span>${escapeHTML(description)}</span>${binButtons ? `<div class="drilldown-bin-list">${binButtons}</div>` : `<small>No matching demo bins.</small>`}`;
  panel.querySelectorAll("[data-drill-bin]").forEach(button => button.addEventListener("click", () => {
    selectBin(button.dataset.drillBin, true);
    $("live-map").scrollIntoView({ behavior:"smooth", block:"start" });
  }));
  openDetailPopup(heading || "Chart details", panel.innerHTML);
}

function openDetailPopup(title, content) {
  const dialog = $("detail-modal"), heading = $("detail-modal-title"), body = $("detail-modal-content");
  if (!dialog || !heading || !body) return;
  heading.textContent = title;
  body.innerHTML = content;
  if (!dialog.open) dialog.showModal();
}

function showDashboardMetricDetail(metric) {
  const definitions = {
    total:{ title:"Total registered bins", description:"Every bin included in the local demo dataset." , matches:bins },
    high:{ title:"High-priority bins", description:"Bins with a current simulated fill level of 75% or more.", matches:bins.filter(bin => bin.fill_level >= 75) },
    average:{ title:"Average fill level", description:"The mean fill percentage across the current demo bins.", matches:[...bins].sort((a, b) => b.fill_level - a.fill_level).slice(0, 5) },
    queue:{ title:"Collection queue", description:"Bins currently flagged for collection at the demo threshold of 65%.", matches:bins.filter(bin => bin.collection_needed) }
  };
  const item = definitions[metric];
  if (!item) return;
  const list = item.matches.map(bin => `<button class="drilldown-bin" type="button" data-drill-bin="${escapeHTML(bin.bin_id)}"><strong>${escapeHTML(bin.bin_id)}</strong><span>${escapeHTML(bin.area)} · ${bin.fill_level}%</span><b>↗</b></button>`).join("");
  const html = `<strong>${item.matches.length} ${item.matches.length === 1 ? "bin" : "bins"}</strong><span>${escapeHTML(item.description)}</span>${list ? `<div class="drilldown-bin-list">${list}</div>` : `<small>No bins match this metric right now.</small>`}`;
  openDetailPopup(item.title, html);
}

function renderChartInlineDetail(kind, key, extra = {}) {
  const targets = { composition:"composition-inline-detail", status:"status-inline-detail", trend:"trend-inline-detail", ward:"ward-inline-detail", priority:"priority-inline-detail", "fill-band":"fill-inline-detail" };
  const target = $(targets[kind]);
  if (!target) return;
  if (kind === "trend") {
    target.innerHTML = `<strong>${escapeHTML(selectedBinId)} · ${extra.fill}%</strong><span>fill at ${escapeHTML(extra.time)} · simulated session reading</span>`;
    return;
  }
  let matches = [];
  let label = key;
  let note = "";
  if (kind === "composition") {
    matches = bins.filter(bin => bin.waste_type === key);
    note = MATERIAL_GUIDANCE[key]?.stream || "Demo material group";
  } else if (kind === "status") {
    matches = key === "To collect" ? bins.filter(bin => bin.collection_needed) : key === "Collected" ? bins.filter(bin => bin.fill_level === 0) : bins.filter(bin => !bin.collection_needed && bin.fill_level > 0);
    note = key === "To collect" ? "at/above 65% fill" : key === "Collected" ? "at 0% fill" : "below collection threshold";
  } else if (kind === "ward") {
    matches = bins.filter(bin => bin.ward === key && bin.collection_needed);
    label = `${key} ward`;
    note = "pending collections";
  } else if (kind === "priority") {
    matches = bins.filter(bin => bin.priority === key);
    label = `${key} priority`;
    note = "current simulated bins";
  } else if (kind === "fill-band") {
    const bands = { low:bin => bin.fill_level < 45, medium:bin => bin.fill_level >= 45 && bin.fill_level < 75, high:bin => bin.fill_level >= 75 && bin.fill_level < 90, critical:bin => bin.fill_level >= 90 };
    matches = bins.filter(bands[key] || (() => false));
    note = "current fill range";
  }
  const names = matches.slice(0, 3).map(bin => `<button type="button" class="inline-bin-link" data-inline-bin="${bin.bin_id}">${escapeHTML(bin.bin_id)} <span>${bin.fill_level}%</span></button>`).join("");
  target.innerHTML = `<span><strong>${escapeHTML(label)} · ${matches.length}</strong> ${escapeHTML(note)}</span>${names ? `<div class="inline-bin-list">${names}</div>` : ""}`;
}

function renderNewSections() {
  const insightList = $("insight-list");
  if (insightList) {
    const urgent = [...bins].sort((a, b) => b.fill_level - a.fill_level).slice(0, 3);
    const available = fleet.find(truck => truck.status === "Available");
    const fallbackInsights = [
      { title: urgent[0]?.fill_level >= 90 ? "Overflow risk" : "Top collection priority", body: urgent[0] ? `${urgent[0].bin_id} in ${urgent[0].area} is ${urgent[0].fill_level}% full. Prioritize this stop.` : "No bin readings available.", reason: "Ranked by current simulated fill level.", action: urgent[0] ? `select:${urgent[0].bin_id}` : "" },
      { title: "Suggested truck assignment", body: urgent[0] ? (available ? `Assign ${available.id} to ${urgent[0].bin_id}.` : "All demo trucks are currently assigned.") : "No pending collection recommendation.", reason: "Uses current demo fleet availability and bin priority.", action: urgent[0] ? `dispatch:${urgent[0].bin_id}` : "" },
      { title: "Segregation opportunity", body: `${bins.filter(bin => bin.waste_type === "Mixed" && bin.fill_level >= 65).length} high-fill mixed-waste bin(s) may benefit from local sorting guidance.`, reason: "Illustrative categories are assigned to the demo dataset.", action: "" }
    ];
    const insights = backendRecommendations.length
      ? backendRecommendations.slice(0, 3).map(item => ({ title: item.title, body: item.message,
        reason: `${item.category} recommendation · ${item.priority} priority`, action: `select:${item.bin_id}` }))
      : fallbackInsights;
    insightList.innerHTML = insights.map(item => `<article class="panel insight-card"><span class="insight-kicker">RULE-BASED DEMO</span><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.body)}</p><small>${escapeHTML(item.reason)}</small>${item.action ? `<button class="button button-secondary button-small" data-insight-action="${item.action}">Review action</button>` : ""}</article>`).join("");
    insightList.querySelectorAll("[data-insight-action]").forEach(button => button.addEventListener("click", () => { const [action, id] = button.dataset.insightAction.split(":"); if (action === "select") selectBin(id, true); else dispatchBin(id); }));
  }
  const alerts = bins.filter(bin => bin.fill_level >= 75);
  const alertList = $("alert-list");
  if (alertList) {
    $("alert-count").textContent = `${alerts.length} active`;
    if ($("nav-alert-count")) $("nav-alert-count").textContent = alerts.length;
    if ($("topbar-alert-count")) $("topbar-alert-count").textContent = alerts.length;
    alertList.innerHTML = alerts.length ? alerts.map(bin => `<article class="panel alert-item ${bin.fill_level >= 90 ? "alert-critical" : ""}"><span class="alert-severity">${bin.fill_level >= 90 ? "CRITICAL" : "WARNING"}</span><div><strong>${escapeHTML(bin.bin_id)} · ${escapeHTML(bin.area)}</strong><p>${bin.fill_level}% full · ${escapeHTML(bin.waste_type)} · ${formatTime(bin.last_updated)}</p></div><button class="button button-secondary button-small" data-alert-bin="${bin.bin_id}">View bin</button></article>`).join("") : `<div class="panel empty-state">No active fill threshold alerts.</div>`;
    alertList.querySelectorAll("[data-alert-bin]").forEach(button => button.addEventListener("click", () => selectBin(button.dataset.alertBin, true)));
  }
  const reports = $("report-summary");
  if (reports) {
    const avg = Math.round(bins.reduce((sum, bin) => sum + bin.fill_level, 0) / bins.length);
    const completed = collectionHistory.length;
    reports.innerHTML = [["Waste collected", `${completed} demo collections`, "Session count; weight is not tracked"], ["Collection completion", `${completed} completed`, "Completed actions in this browser session"], ["Overflow incidents", bins.filter(bin => bin.fill_level >= 90).length, "Current bins at or above 90%"], ["Truck utilization", `${fleet.filter(truck => truck.status !== "Available").length}/${fleet.length} active`, "Illustrative fleet status"], ["Average bin fill", `${avg}%`, "Current simulated readings"], ["Recycling / segregation", "Not measured", "Requires verified weight or inspection data"]].map(([label, value, note]) => `<article class="panel report-card"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(note)}</small></article>`).join("");
  }
  const history = $("collection-history");
  if (history) history.innerHTML = collectionHistory.length ? collectionHistory.slice(0, 12).map(item => `<div class="scan-history-item"><strong>${escapeHTML(item.bin)} · ${escapeHTML(item.area)} · ${item.before}% → 0%</strong><time>${formatTime(item.at)}</time></div>`).join("") : `<span class="empty-state">No collections completed in this session.</span>`;
}

async function updateSimulatedMonitoring() {
  if (simulationPaused) return;
  try {
    if (!backendConnected && !(await syncBackendState())) return;
    await apiRequest("/api/simulation/tick", { method: "POST" });
    if (await syncBackendState()) {
      const now = new Date();
      bins.forEach(bin => fillHistory.push({ id: bin.bin_id, fill: bin.fill_level, at: now }));
      renderDashboard();
      updateCurrentDate();
    }
  } catch (error) {
    updateBackendStatus(false, `FastAPI update failed: ${error.message}`);
  }
}

/* ---------- Map initialization ---------- */

function initializeMap() {
  const mapElement = $("map");
  if (!mapElement) return;

  if (typeof L === "undefined") {
    mapElement.innerHTML =
      '<div class="queue-empty"><strong>Map library unavailable</strong><span>Check your internet connection and refresh to load Leaflet.</span></div>';
    return;
  }

  map = L.map("map").setView([12.9352, 77.6245], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    keepBuffer: 3,
    updateWhenZooming: false,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  addTruckMapControls();

  bins.forEach(bin => {
    const marker = L.marker(
      [bin.latitude, bin.longitude],
      { icon: createMarkerIcon(bin, bin.bin_id === selectedBinId) }
    ).addTo(map);

    marker.bindPopup("");
    marker.on("click", () => selectBin(bin.bin_id, false));

    markers[bin.bin_id] = marker;
    updateMarker(bin);
  });

  setTimeout(() => map.invalidateSize(), 250);
}

/* ---------- CSV export and priority recalculation ---------- */

function exportBinCSV() {
  const headers = [
    "bin_id", "area", "fill_level", "priority", "priority_score",
    "collection_needed", "latitude", "longitude", "last_updated", "data_type"
  ];

  const rows = bins.map(bin => [
    bin.bin_id,
    bin.area,
    bin.fill_level,
    bin.priority,
    bin.priority_score,
    bin.collection_needed ? "Yes" : "No",
    bin.latitude,
    bin.longitude,
    bin.last_updated.toISOString(),
    "SIMULATED"
  ]);

  const csv = [headers, ...rows].map(row =>
    row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(",")
  ).join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "citypulse-demo-bin-data.csv";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  addActivity(
    "Bin data exported",
    "Downloaded a CSV file containing " + bins.length + " simulated bin records.",
    "success"
  );
}

async function recalculatePriorities() {
  if (await syncBackendState()) {
    renderDashboard();
    addActivity("Priorities refreshed", `FastAPI priority and recommendation data refreshed for ${bins.length} bins.`, "success");
  }
}

function updateCurrentDate() {
  const element = $("current-date");
  if (!element) return;

  element.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function setActiveNavigation() {
  const links = document.querySelectorAll(".nav-link");
  const sectionTitles = {
    overview:"Operations overview", "live-map":"Live Bengaluru map", collection:"Collection queue",
    analytics:"Analytics & environmental impact", fleet:"Fleet operations", "digital-twin":"Digital twin simulation",
    scanner:"Computer vision waste detection", insights:"AI recommendations", alerts:"Active alerts",
    reports:"Collection history & reports", activity:"Activity log", "data-status":"Data & system status"
  };
  const trackedSections = [...links].map(link => ({ link, section:document.getElementById(link.getAttribute("href").slice(1)) })).filter(item => item.section);
  let scheduled = false;
  const updateActiveSection = () => {
    scheduled = false;
    let active = trackedSections[0];
    for (const item of trackedSections) {
      if (item.section.getBoundingClientRect().top <= 155) active = item;
      else break;
    }
    if (!active) return;
    links.forEach(link => link.classList.toggle("active", link === active.link));
    const label = $("current-section-title");
    if (label) label.textContent = sectionTitles[active.section.id] || active.link.textContent.replace(/\d+/g, "").trim();
  };
  const scheduleUpdate = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateActiveSection);
  };
  window.addEventListener("scroll", scheduleUpdate, { passive:true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("hashchange", scheduleUpdate);
  links.forEach(link => link.addEventListener("click", () => requestAnimationFrame(updateActiveSection)));
  scheduleUpdate();
}

/* ---------- Event listeners ---------- */

function setupEventListeners() {
  const filters = $("priority-filters");

  if (filters) {
    filters.addEventListener("click", event => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;

      activeFilter = button.dataset.filter;

      document.querySelectorAll("#priority-filters .filter-btn")
        .forEach(item => item.classList.toggle("active", item === button));

      applyFilters();
    });
  }

  const searchInput = $("search-bin");
  if (searchInput) searchInput.addEventListener("input", applyFilters);

  const mapFilter = $("map-priority-filter");
  if (mapFilter) {
    mapFilter.addEventListener("change", event => {
      mapPriorityFilter = event.target.value;
      applyFilters();
    });
  }

  const resetButton = $("reset-map");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      if (map) map.setView([12.9352, 77.6245], 13);

      mapPriorityFilter = "ALL";
      activeFilter = "ALL";

      if ($("search-bin")) $("search-bin").value = "";
      if ($("map-priority-filter")) $("map-priority-filter").value = "ALL";

      document.querySelectorAll("#priority-filters .filter-btn")
        .forEach(item => {
          item.classList.toggle("active", item.dataset.filter === "ALL");
        });

      applyFilters();
    });
  }

  if ($("export-csv")) {
    $("export-csv").addEventListener("click", exportBinCSV);
  }

  if ($("run-prioritization")) {
    $("run-prioritization").addEventListener("click", recalculatePriorities);
  }

  if ($("refresh-data")) {
    $("refresh-data").addEventListener("click", async () => {
      await updateSimulatedMonitoring();
      updateCurrentDate();

      const button = $("refresh-data");
      button.classList.add("spinning");

      setTimeout(() => button.classList.remove("spinning"), 300);
    });
  }

  if ($("clear-activity")) {
    $("clear-activity").addEventListener("click", async () => {
      try {
        await apiRequest("/api/activities", { method: "DELETE" });
        activityEvents = [];
        renderActivity();
      } catch (error) { addActivity("Could not clear backend activity", error.message, "warning"); }
    });
  }

  $("analytics")?.addEventListener("click", event => {
    const binButton = event.target.closest("[data-inline-bin]");
    if (binButton) {
      selectBin(binButton.dataset.inlineBin, true);
      $("live-map").scrollIntoView({ behavior:"smooth", block:"start" });
      return;
    }
    const target = event.target.closest("[data-chart-kind]");
    if (!target) return;
    const details = {
      fill:target.dataset.chartFill,
      time:target.dataset.chartTime
    };
    showChartDrilldown(target.dataset.chartKind, target.dataset.chartKey, details);
    renderChartInlineDetail(target.dataset.chartKind, target.dataset.chartKey, details);
  });
  $("analytics")?.addEventListener("keydown", event => {
    if ((event.key !== "Enter" && event.key !== " ") || !event.target.matches(".donut-segment,.trend-point")) return;
    event.preventDefault();
    const target = event.target;
    const details = {
      fill:target.dataset.chartFill,
      time:target.dataset.chartTime
    };
    showChartDrilldown(target.dataset.chartKind, target.dataset.chartKey, details);
    renderChartInlineDetail(target.dataset.chartKind, target.dataset.chartKey, details);
  });
  document.addEventListener("click", event => {
    const metric = event.target.closest("[data-dashboard-metric]");
    if (metric) showDashboardMetricDetail(metric.dataset.dashboardMetric);
  });
  document.querySelectorAll(".metric-card[data-dashboard-metric]").forEach(card => card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showDashboardMetricDetail(card.dataset.dashboardMetric); }
  }));
  const detailModal = $("detail-modal");
  detailModal?.querySelector(".modal-close")?.addEventListener("click", () => detailModal.close());
  detailModal?.addEventListener("click", event => {
    if (event.target === detailModal) detailModal.close();
    const binButton = event.target.closest("[data-drill-bin]");
    if (binButton) {
      selectBin(binButton.dataset.drillBin, true);
      detailModal.close();
      $("live-map").scrollIntoView({ behavior:"smooth", block:"start" });
    }
  });

  $("toggle-simulation")?.addEventListener("click", event => {
    simulationPaused = !simulationPaused;
    if (simulationPaused && simulationTimer) { clearInterval(simulationTimer); simulationTimer = null; }
    else if (!simulationTimer) simulationTimer = setInterval(updateSimulatedMonitoring, 60000);
    event.currentTarget.textContent = simulationPaused ? "Start simulation" : "Pause simulation";
    $("simulation-state").textContent = simulationPaused ? "Automatic fill updates are paused." : "Automatic fill updates are running.";
    addActivity(simulationPaused ? "Simulation paused" : "Simulation started", "Fill-level ticks are written to the FastAPI backend.", "normal");
  });
  $("simulate-fill")?.addEventListener("click", async () => {
    const target = bins.find(bin => bin.bin_id === selectedBinId);
    if (!target) return;
    const newFill = Math.min(100, target.fill_level + 15);
    try {
      await apiRequest(`/api/bins/${encodeURIComponent(target.bin_id)}/fill`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fill_level: newFill }) });
      await syncBackendState();
      fillHistory.push({ id: target.bin_id, fill: newFill, at: new Date() });
      addActivity("Backend bin reading updated", `${target.bin_id} increased by 15 points to ${newFill}%.`, newFill >= 90 ? "critical" : "warning");
      renderDashboard();
    } catch (error) { addActivity("Bin update failed", error.message, "warning"); }
  });
  $("complete-selected")?.addEventListener("click", () => collectBin(selectedBinId));
  $("generate-insights")?.addEventListener("click", () => { renderNewSections(); addActivity("Recommendations generated", "Rule-based suggestions refreshed from the current simulated state.", "success"); });
  $("reset-demo")?.addEventListener("click", async () => {
    clearTruckRoutes(true);
    try {
      simulationPaused = true;
      if (simulationTimer) clearInterval(simulationTimer);
      simulationTimer = null;
      $("toggle-simulation").textContent = "Start simulation";
      $("simulation-state").textContent = "Automatic fill updates are paused.";
      await apiRequest("/api/simulation/reset", { method: "POST" });
      collectionHistory = []; fillHistory = []; scanHistory = [];
      await syncBackendState();
      seedFillHistory();
      renderDashboard(); renderScanHistory();
      addActivity("Backend data reset", "All 12 bins and fleet assignments returned to their configured starting state.", "normal");
    } catch (error) { addActivity("Reset failed", error.message, "warning"); }
  });

  const imageInput = $("waste-image");
  const preview = $("scan-preview");
  const detectButton = $("detect-waste");
  let selectedScanFile = null;
  function loadScanFile(file) {
    if (!file || !file.type.startsWith("image/")) { addActivity("Waste scan failed", "Choose a valid image file.", "warning"); return; }
    selectedScanFile = file;
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    const objectUrl = URL.createObjectURL(file); preview.src = objectUrl; preview.dataset.objectUrl = objectUrl; preview.hidden = false; detectButton.disabled = false;
  }
  imageInput?.addEventListener("change", () => loadScanFile(imageInput.files[0]));
  const uploadZone = $("upload-zone");
  uploadZone?.addEventListener("dragover", event => { event.preventDefault(); uploadZone.classList.add("dragging"); });
  uploadZone?.addEventListener("dragleave", () => uploadZone.classList.remove("dragging"));
  uploadZone?.addEventListener("drop", event => { event.preventDefault(); uploadZone.classList.remove("dragging"); loadScanFile(event.dataTransfer.files[0]); });
  detectButton?.addEventListener("click", async () => {
    const file = selectedScanFile;
    if (!file) return;
    detectButton.disabled = true;
    detectButton.textContent = "Analyzing…";
    $("scan-result").innerHTML = `<div class="empty-state">Running local computer-vision models. The first run may take longer while model weights are downloaded.</div>`;
    try {
      const form = new FormData();
      form.append("file", file);
      if (selectedBinId) form.append("bin_id", selectedBinId);
      const response = await fetch(`${API_BASE_URL}/api/vision/analyze`, { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Vision service returned ${response.status}.`);
      const categoryMap = { plastic:"Plastic", metal:"Metal", glass:"Glass", cardboard:"Cardboard", paper:"Paper", organic:"Organic", hazardous:"E-waste", general_waste:"Mixed", uncertain:"Mixed" };
      const category = categoryMap[payload.primary_category] || "Mixed";
      const best = [...(payload.detections || [])].sort((a, b) => b.confidence - a.confidence)[0];
      const result = { category, label: best?.label || payload.primary_label || "No confident object detected", confidence: best ? best.confidence * 100 : null, objectCount: payload.total_items || 0, composition: payload.waste_analysis?.counts_by_type || {} };
      renderWasteDetectionResult(result);
      await syncBackendState();
      if (payload.bin_updated && payload.bin_id) fillHistory.push({ id: payload.bin_id, fill: payload.fill_level_percent, at: new Date() });
      renderDashboard();
      scanHistory.unshift({ name: file.name, at: new Date(), category });
      scanHistory = scanHistory.slice(0, 5);
      addActivity("Computer-vision scan completed", payload.message || `${file.name} analyzed by the local vision service.`, "success");
      renderScanHistory();
    } catch (error) {
      $("scan-result").innerHTML = `<div class="empty-state">${escapeHTML(error.message)} Start the FastAPI backend and try again.</div>`;
      addActivity("Computer-vision scan failed", error.message, "warning");
    } finally {
      detectButton.disabled = !selectedScanFile;
      detectButton.textContent = "Analyze image";
    }
  });
  $("clear-scan")?.addEventListener("click", () => { if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl); preview.removeAttribute("src"); preview.hidden = true; selectedScanFile = null; if (imageInput) imageInput.value = ""; detectButton.disabled = true; $("scan-result").innerHTML = `<div class="empty-state">Upload an image and analyze it to see computer-vision results.</div>`; });
  $("material-picker")?.addEventListener("click", event => {
    const button = event.target.closest("[data-material]");
    if (!button) return;
    selectedMaterial = button.dataset.material;
    renderMaterialGuidance(selectedMaterial);
  });
  $("export-report")?.addEventListener("click", () => exportReportCSV());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (simulationTimer) {
        clearInterval(simulationTimer);
        simulationTimer = null;
      }
    } else if (!simulationPaused && !simulationTimer) {
      simulationTimer = setInterval(updateSimulatedMonitoring, 60000);
    }
  });
}

function renderScanHistory() {
  const container = $("scan-history"); if (!container) return;
  container.innerHTML = scanHistory.length ? scanHistory.map(item => `<div class="scan-history-item"><strong>${escapeHTML(item.name)}</strong><time>${formatTime(item.at)}</time></div>`).join("") : `<span class="empty-state">No scans in this session.</span>`;
}

function renderMaterialGuidance(material) {
  const picker = $("material-picker"), details = $("material-guidance");
  const guide = MATERIAL_GUIDANCE[material];
  if (!picker || !details || !guide) return;
  picker.innerHTML = Object.keys(MATERIAL_GUIDANCE).map(name => `<button type="button" class="material-chip ${name === material ? "selected" : ""}" data-material="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join("");
  details.innerHTML = `<div class="guidance-topline"><span>Suggested stream</span><strong>${escapeHTML(guide.stream)}</strong></div><p>${escapeHTML(guide.summary)}</p><div class="guidance-columns"><div><strong>Handling steps</strong><ol>${guide.steps.map(step => `<li>${escapeHTML(step)}</li>`).join("")}</ol></div><div class="guidance-caution"><strong>Contamination / safety note</strong><p>${escapeHTML(guide.avoid)}</p></div></div><small class="guidance-source">General illustrative guidance · verify with local collection rules</small>`;
}

// Stable UI contract for future CV results: { category, label, confidence, objectCount, boxes }.
function renderWasteDetectionResult(result, options = {}) {
  const category = MATERIAL_GUIDANCE[result.category] ? result.category : "Mixed";
  const label = result.label || category;
  const confidence = result.confidence != null && Number.isFinite(Number(result.confidence)) ? `${Math.round(Number(result.confidence))}%` : "—";
  const count = Number.isFinite(Number(result.objectCount)) ? Number(result.objectCount) : 0;
  const composition = Object.entries(result.composition || {}).filter(([, value]) => Number(value) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
  const compositionTotal = composition.reduce((sum, [, value]) => sum + Number(value), 0);
  const compositionLabels = { plastic:"Plastic", metal:"Metal", glass:"Glass", cardboard:"Cardboard", paper:"Paper", organic:"Organic", hazardous:"E-waste", general_waste:"Mixed / residual", uncertain:"Needs review" };
  const compositionMarkup = `<section class="scan-composition"><strong>Detected waste composition</strong>${composition.length ? `<div class="composition-chart">${composition.map(([key, value]) => `<div class="composition-row"><span><i style="background:${key === "plastic" ? "#22d3ee" : key === "organic" ? "#34d399" : key === "paper" ? "#60a5fa" : key === "metal" ? "#c084fc" : key === "glass" ? "#f59e0b" : key === "cardboard" ? "#fb7185" : "#fbbf24"}"></i>${escapeHTML(compositionLabels[key] || key)}</span><span class="composition-track"><b style="width:${Math.round(Number(value) / compositionTotal * 100)}%;background:var(--accent,#22d3ee)"></b></span><strong>${Number(value)}</strong></div>`).join("")}</div><small>Counts from this image · verify material composition before sorting.</small>` : `<p class="scan-composition-empty">No waste items were detected confidently. Try a closer, well-lit image with the items separated.</p>`}</section>`;
  $("scan-result").innerHTML = `${options.sample ? `<div class="sample-warning">Illustrative sample only · the uploaded image was not analyzed by a computer-vision model.</div>` : ""}<div class="detection-summary"><div class="detection-icon">⌗</div><div><span class="detection-kicker">${options.sample ? "SAMPLE DETECTION" : "CLASSIFICATION RESULT"}</span><strong>${escapeHTML(label)}</strong><small>${escapeHTML(category)} material · ${count} object${count === 1 ? "" : "s"}</small></div><div class="confidence-badge"><strong>${confidence}</strong><span>confidence</span></div></div><div class="detection-facts"><div><span>Material class</span><strong>${escapeHTML(category)}</strong></div><div><span>Detected objects</span><strong>${count}</strong></div><div><span>Suggested stream</span><strong>${escapeHTML(MATERIAL_GUIDANCE[category].stream)}</strong></div></div>${compositionMarkup}`;
  selectedMaterial = category;
  renderMaterialGuidance(category);
}

function exportReportCSV() {
  const rows = [["Report item", "Value", "Scope"], ["Collections completed", collectionHistory.length, "Browser session"], ["Current overflow risk bins", bins.filter(bin => bin.fill_level >= 90).length, "Current simulated records"], ["Active demo trucks", fleet.filter(truck => truck.status !== "Available").length, "Illustrative fleet"], ["Environmental impact", "Not measured", "No weight data or verified calculation"]];
  const blob = new Blob([rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "citypulse-session-report.csv"; link.click(); URL.revokeObjectURL(url);
  addActivity("Session report exported", "Downloaded current browser-session summary CSV.", "success");
}

/* ---------- Start the application ---------- */

async function initializeDashboard() {
  updateCurrentDate();
  initializeMap();
  setupEventListeners();
  setActiveNavigation();

  const connected = await syncBackendState();
  if (connected) await refreshVisionStatus();

  addActivity(
    connected ? "FastAPI monitoring initialized" : "Dashboard opened offline",
    connected ? bins.length + " backend bin records loaded." : "Showing sample values; no backend changes will be saved until FastAPI is running.",
    "success"
  );

  addActivity(
    "Decision engine ready",
    "Collection queue uses a demonstration threshold of 65% fill. Priority categories are based on fill level.",
    "normal"
  );

  seedFillHistory();
  renderDashboard();
  renderMaterialGuidance(selectedMaterial);
  renderScanHistory();
  const simulationToggle = $("toggle-simulation");
  if (simulationToggle) simulationToggle.textContent = "Start simulation";
  if ($("simulation-state")) $("simulation-state").textContent = "Automatic fill updates are paused.";
}

document.addEventListener("DOMContentLoaded", initializeDashboard);
