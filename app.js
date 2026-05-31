"use strict";

const trafficCanvas = document.querySelector("#trafficCanvas");
const trendCanvas = document.querySelector("#trendCanvas");
const ctx = trafficCanvas.getContext("2d");
const trendCtx = trendCanvas.getContext("2d");

const els = {
  connectionState: document.querySelector("#connectionState"),
  totalFlow: document.querySelector("#totalFlow"),
  avgSpeed: document.querySelector("#avgSpeed"),
  avgWait: document.querySelector("#avgWait"),
  reliability: document.querySelector("#reliability"),
  optimizedSignals: document.querySelector("#optimizedSignals"),
  activeIncidents: document.querySelector("#activeIncidents"),
  co2Saved: document.querySelector("#co2Saved"),
  congestionIndex: document.querySelector("#congestionIndex"),
  intersectionRows: document.querySelector("#intersectionRows"),
  incidentList: document.querySelector("#incidentList"),
  mapNodes: document.querySelector("#mapNodes"),
  prioritySelect: document.querySelector("#prioritySelect"),
  manualSelect: document.querySelector("#manualSelect"),
  resetButton: document.querySelector("#resetButton"),
  addIncidentButton: document.querySelector("#addIncidentButton")
};

let latestState = null;
let trend = [];
let animationClock = 0;

function fmt(value, digits = 0) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function statusColor(status) {
  if (status === "critical") return "#c44b44";
  if (status === "busy") return "#cf8a18";
  return "#2d9b66";
}

function setConnection(online) {
  els.connectionState.classList.toggle("offline", !online);
  els.connectionState.querySelector("span:last-child").textContent = online ? "Live stream" : "Reconnecting";
}

function postJson(url, body = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then((response) => {
    if (!response.ok) throw new Error("Request failed");
    return response.json();
  });
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, dpr };
}

function pointFor(intersection, size) {
  return {
    x: (intersection.x / 100) * size.width,
    y: (intersection.y / 100) * size.height
  };
}

function drawRoad(from, to, road, size) {
  const congestion = Math.max(from.congestion, to.congestion);
  const color = congestion > 0.76 ? "#c44b44" : congestion > 0.55 ? "#cf8a18" : "#394033";
  const a = pointFor(from, size);
  const b = pointFor(to, size);

  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.setLineDash([12, 14]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.66)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const vehicleCount = Math.max(3, Math.round(((from.flow + to.flow) / road.capacity) * 4));
  for (let i = 0; i < vehicleCount; i += 1) {
    const t = (animationClock * (0.002 + (1 - congestion) * 0.003) + i / vehicleCount) % 1;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    ctx.fillStyle = i % 3 === 0 ? "#2b73c9" : i % 3 === 1 ? "#ffffff" : "#ffd166";
    ctx.beginPath();
    ctx.roundRect(x - 5, y - 3, 10, 6, 3);
    ctx.fill();
  }
}

function drawIntersection(intersection, size) {
  const p = pointFor(intersection, size);
  const color = statusColor(intersection.status);
  const radius = 15 + intersection.congestion * 10;

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius + 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius + Math.sin(animationClock / 18) * 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.max(11, size.width * 0.012)}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(intersection.greenTime)), p.x, p.y);
}

function drawTrafficMap() {
  const size = resizeCanvas(trafficCanvas);
  ctx.clearRect(0, 0, size.width, size.height);

  if (!latestState) return;

  const intersections = new Map(latestState.intersections.map((item) => [item.id, item]));
  for (const road of latestState.roads) {
    drawRoad(intersections.get(road.from), intersections.get(road.to), road, size);
  }
  for (const intersection of latestState.intersections) {
    drawIntersection(intersection, size);
  }
}

function renderMapLabels(state) {
  els.mapNodes.innerHTML = state.intersections
    .map((item) => {
      const top = `${item.y}%`;
      const left = `${item.x}%`;
      return `<div class="node-label ${item.status}" style="left:${left};top:${top}">
        <b>${item.name}</b>
        <span>${fmt(item.avgSpeed)} km/h | ${fmt(item.avgWait)} sec</span>
      </div>`;
    })
    .join("");
}

function drawTrend() {
  const size = resizeCanvas(trendCanvas);
  trendCtx.clearRect(0, 0, size.width, size.height);
  const pad = 18 * size.dpr;
  const chartWidth = size.width - pad * 2;
  const chartHeight = size.height - pad * 2;

  trendCtx.strokeStyle = "rgba(32,35,31,0.12)";
  trendCtx.lineWidth = 1;
  for (let i = 0; i <= 3; i += 1) {
    const y = pad + (chartHeight / 3) * i;
    trendCtx.beginPath();
    trendCtx.moveTo(pad, y);
    trendCtx.lineTo(size.width - pad, y);
    trendCtx.stroke();
  }

  if (trend.length < 2) return;

  trendCtx.lineWidth = 3 * size.dpr;
  trendCtx.lineJoin = "round";
  trendCtx.lineCap = "round";
  const gradient = trendCtx.createLinearGradient(pad, 0, size.width - pad, 0);
  gradient.addColorStop(0, "#2d9b66");
  gradient.addColorStop(0.5, "#cf8a18");
  gradient.addColorStop(1, "#c44b44");
  trendCtx.strokeStyle = gradient;
  trendCtx.beginPath();
  trend.forEach((value, index) => {
    const x = pad + (index / (trend.length - 1)) * chartWidth;
    const y = pad + chartHeight - value * chartHeight;
    if (index === 0) trendCtx.moveTo(x, y);
    else trendCtx.lineTo(x, y);
  });
  trendCtx.stroke();
}

function updateSelects(state) {
  if (!els.prioritySelect.options.length) {
    els.prioritySelect.innerHTML = state.intersections
      .map((item) => `<option value="${item.id}">${item.name}</option>`)
      .join("");
  }
  if (els.manualSelect.options.length === 1) {
    els.manualSelect.insertAdjacentHTML(
      "beforeend",
      state.intersections.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")
    );
  }
  els.prioritySelect.value = state.control.priorityIntersection;
  els.manualSelect.value = state.control.manualHold || "";
  document.querySelectorAll("[data-strategy]").forEach((button) => {
    button.classList.toggle("active", button.dataset.strategy === state.control.strategy);
  });
}

function renderMetrics(state) {
  els.totalFlow.textContent = fmt(state.metrics.totalFlow);
  els.avgSpeed.textContent = fmt(state.metrics.avgSpeed);
  els.avgWait.textContent = fmt(state.metrics.avgWait);
  els.reliability.textContent = fmt(state.metrics.reliability, 1);
  els.optimizedSignals.textContent = fmt(state.metrics.optimizedSignals);
  els.activeIncidents.textContent = fmt(state.metrics.activeIncidents);
  els.co2Saved.textContent = fmt(state.metrics.co2SavedKg, 1);
  els.congestionIndex.textContent = fmt(state.metrics.congestionIndex, 2);
}

function renderTable(state) {
  els.intersectionRows.innerHTML = state.intersections
    .map(
      (item) => `<tr>
        <td>${item.name}</td>
        <td>${item.corridor}</td>
        <td>${item.signal}</td>
        <td>${fmt(item.flow)}</td>
        <td>${fmt(item.queue)}</td>
        <td>${fmt(item.avgSpeed)} km/h</td>
        <td>${fmt(item.avgWait)} sec</td>
        <td><span class="status-pill ${item.status}">${item.status}</span></td>
      </tr>`
    )
    .join("");
}

function renderIncidents(state) {
  const active = state.incidents.filter((incident) => incident.status === "active");
  if (!active.length) {
    els.incidentList.innerHTML = `<div class="incident"><div><strong>No active incidents</strong><span>Network running normally</span></div></div>`;
    return;
  }

  const intersections = new Map(state.intersections.map((item) => [item.id, item.name]));
  els.incidentList.innerHTML = active
    .map((incident) => {
      const high = incident.severity > 0.68 ? " high" : "";
      const place = intersections.get(incident.intersectionId) || "Unknown";
      return `<div class="incident${high}">
        <div>
          <strong>${incident.label}</strong>
          <span>${place} | severity ${fmt(incident.severity, 2)}</span>
        </div>
        <button type="button" data-resolve="${incident.id}" aria-label="Resolve ${incident.label}" title="Resolve">X</button>
      </div>`;
    })
    .join("");
}

function renderState(state) {
  latestState = state;
  trend.push(state.metrics.congestionIndex);
  trend = trend.slice(-30);
  renderMetrics(state);
  renderTable(state);
  renderIncidents(state);
  renderMapLabels(state);
  updateSelects(state);
  drawTrafficMap();
  drawTrend();
}

function setupEvents() {
  document.querySelectorAll("[data-strategy]").forEach((button) => {
    button.addEventListener("click", () => {
      postJson("/api/control", { strategy: button.dataset.strategy }).then(renderState).catch(() => setConnection(false));
    });
  });

  els.prioritySelect.addEventListener("change", () => {
    postJson("/api/control", { priorityIntersection: els.prioritySelect.value })
      .then(renderState)
      .catch(() => setConnection(false));
  });

  els.manualSelect.addEventListener("change", () => {
    postJson("/api/control", { manualHold: els.manualSelect.value || null })
      .then(renderState)
      .catch(() => setConnection(false));
  });

  els.resetButton.addEventListener("click", () => {
    postJson("/api/reset").then(renderState).catch(() => setConnection(false));
  });

  els.addIncidentButton.addEventListener("click", () => {
    if (!latestState) return;
    const sorted = [...latestState.intersections].sort((a, b) => b.congestion - a.congestion);
    const target = sorted[0] || latestState.intersections[0];
    postJson("/api/incidents", {
      intersectionId: target.id,
      type: "operator_report",
      label: "Operator report",
      severity: Math.min(0.95, target.congestion + 0.2)
    })
      .then(renderState)
      .catch(() => setConnection(false));
  });

  els.incidentList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-resolve]");
    if (!button) return;
    postJson(`/api/incidents/${button.dataset.resolve}/resolve`).then(renderState).catch(() => setConnection(false));
  });

  window.addEventListener("resize", () => {
    drawTrafficMap();
    drawTrend();
  });
}

function connectStream() {
  const source = new EventSource("/events");
  source.onopen = () => setConnection(true);
  source.onerror = () => setConnection(false);
  source.onmessage = (event) => {
    setConnection(true);
    renderState(JSON.parse(event.data));
  };
}

function animate() {
  animationClock += 1;
  drawTrafficMap();
  requestAnimationFrame(animate);
}

fetch("/api/snapshot")
  .then((response) => response.json())
  .then(renderState)
  .catch(() => setConnection(false));

setupEvents();
connectStream();
animate();
