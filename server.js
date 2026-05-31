"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const clients = new Set();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const roadSegments = [
  { from: "harbor", to: "central", capacity: 118 },
  { from: "central", to: "market", capacity: 136 },
  { from: "market", to: "stadium", capacity: 104 },
  { from: "central", to: "hospital", capacity: 96 },
  { from: "hospital", to: "university", capacity: 88 },
  { from: "central", to: "university", capacity: 116 },
  { from: "harbor", to: "hospital", capacity: 74 },
  { from: "market", to: "university", capacity: 82 }
];

const initialIntersections = [
  {
    id: "harbor",
    name: "Harbor Gate",
    corridor: "West Loop",
    x: 18,
    y: 62,
    lanes: 6,
    baseVolume: 72,
    phaseOffset: 0
  },
  {
    id: "central",
    name: "Central Square",
    corridor: "Civic Core",
    x: 44,
    y: 48,
    lanes: 10,
    baseVolume: 106,
    phaseOffset: 3
  },
  {
    id: "market",
    name: "Market Junction",
    corridor: "Retail Spine",
    x: 70,
    y: 39,
    lanes: 8,
    baseVolume: 96,
    phaseOffset: 8
  },
  {
    id: "stadium",
    name: "Stadium Exit",
    corridor: "Event Route",
    x: 88,
    y: 60,
    lanes: 6,
    baseVolume: 67,
    phaseOffset: 14
  },
  {
    id: "hospital",
    name: "Hospital Priority",
    corridor: "Emergency Corridor",
    x: 42,
    y: 76,
    lanes: 6,
    baseVolume: 62,
    phaseOffset: 19
  },
  {
    id: "university",
    name: "University Circle",
    corridor: "South Link",
    x: 67,
    y: 78,
    lanes: 7,
    baseVolume: 78,
    phaseOffset: 25
  }
];

const state = {
  tick: 0,
  startedAt: Date.now(),
  timestamp: new Date().toISOString(),
  control: {
    strategy: "adaptive",
    operatorMode: "auto",
    priorityIntersection: "hospital",
    manualHold: null
  },
  intersections: initialIntersections.map((item) => ({
    ...item,
    flow: item.baseVolume,
    queue: 14,
    avgSpeed: 42,
    avgWait: 28,
    congestion: 0.34,
    greenTime: 42,
    signal: "NS green",
    status: "smooth",
    trend: 0
  })),
  roads: roadSegments,
  incidents: [
    {
      id: randomUUID(),
      type: "lane_block",
      label: "Lane blockage",
      intersectionId: "market",
      severity: 0.54,
      status: "active",
      createdAt: Date.now() - 1000 * 60 * 4
    }
  ],
  metrics: {
    totalFlow: 0,
    avgSpeed: 0,
    avgWait: 0,
    congestionIndex: 0,
    optimizedSignals: 0,
    activeIncidents: 1,
    emergencyVehicles: 0,
    co2SavedKg: 0,
    reliability: 98
  }
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 0) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function findIntersection(id) {
  return state.intersections.find((item) => item.id === id);
}

function activeIncidentsFor(intersectionId) {
  return state.incidents.filter(
    (incident) => incident.status === "active" && incident.intersectionId === intersectionId
  );
}

function timePressure() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const morningPeak = Math.exp(-((hour - 8.4) ** 2) / 4.8);
  const eveningPeak = Math.exp(-((hour - 17.7) ** 2) / 5.4);
  const midday = Math.exp(-((hour - 13.1) ** 2) / 18);
  return 0.78 + morningPeak * 0.38 + eveningPeak * 0.44 + midday * 0.12;
}

function signalPhase(intersection, tick) {
  if (state.control.manualHold === intersection.id) {
    return "manual hold";
  }

  const phaseTick = (tick + intersection.phaseOffset) % 36;
  if (phaseTick < 17) return "NS green";
  if (phaseTick < 20) return "all red";
  if (phaseTick < 34) return "EW green";
  return "all red";
}

function maybeCreateIncident() {
  const activeCount = state.incidents.filter((incident) => incident.status === "active").length;
  if (activeCount >= 3) return;
  if (state.tick < 10 || Math.random() > 0.04) return;

  const candidates = state.intersections
    .filter((item) => item.congestion > 0.48)
    .sort((a, b) => b.congestion - a.congestion);
  const intersection = candidates[0] || state.intersections[Math.floor(Math.random() * state.intersections.length)];
  const types = [
    { type: "lane_block", label: "Lane blockage" },
    { type: "signal_fault", label: "Signal timing drift" },
    { type: "vehicle_breakdown", label: "Vehicle breakdown" },
    { type: "event_surge", label: "Event surge" }
  ];
  const picked = types[Math.floor(Math.random() * types.length)];

  state.incidents.unshift({
    id: randomUUID(),
    type: picked.type,
    label: picked.label,
    intersectionId: intersection.id,
    severity: round(0.35 + Math.random() * 0.45, 2),
    status: "active",
    createdAt: Date.now()
  });

  state.incidents = state.incidents.slice(0, 12);
}

function updateSimulation() {
  state.tick += 1;
  state.timestamp = new Date().toISOString();

  const pressure = timePressure();
  const strategy = state.control.strategy;
  let totalFlow = 0;
  let totalSpeed = 0;
  let totalWait = 0;
  let congestionSum = 0;
  let optimizedSignals = 0;
  let emergencyVehicles = 0;

  for (const intersection of state.intersections) {
    const previousCongestion = intersection.congestion;
    const incidents = activeIncidentsFor(intersection.id);
    const incidentLoad = incidents.reduce((sum, incident) => sum + incident.severity, 0);
    const eventPulse = intersection.id === "stadium" ? Math.sin(state.tick / 18) * 11 : 0;
    const hospitalPulse = intersection.id === "hospital" ? Math.max(0, Math.sin(state.tick / 14)) * 6 : 0;
    const wave = Math.sin(state.tick / 7 + intersection.phaseOffset) * 8;
    const randomNoise = (Math.random() - 0.5) * 10;
    const demand = clamp(
      intersection.baseVolume * pressure + wave + eventPulse + hospitalPulse + randomNoise,
      28,
      172
    );

    const emergencyBoost =
      strategy === "emergency-priority" && intersection.id === state.control.priorityIntersection ? 0.2 : 0;
    const ecoSoftening = strategy === "eco" ? -0.05 : 0;
    const adaptiveRelief = strategy === "adaptive" ? previousCongestion * 0.18 : 0.07;
    const discharge = clamp(0.64 + adaptiveRelief + emergencyBoost + ecoSoftening - incidentLoad * 0.08, 0.42, 1.1);

    intersection.queue = clamp(intersection.queue * 0.7 + (demand * (1 - discharge) + incidentLoad * 22), 1, 130);
    intersection.flow = round(clamp(demand - intersection.queue * 0.13, 18, 158));
    intersection.congestion = round(
      clamp(intersection.queue / 125 + demand / 260 + incidentLoad * 0.24 - adaptiveRelief * 0.24, 0.06, 0.98),
      2
    );
    intersection.avgSpeed = round(clamp(58 - intersection.congestion * 42 - incidentLoad * 7, 8, 58));
    intersection.avgWait = round(clamp(12 + intersection.congestion * 86 + incidentLoad * 28, 8, 132));
    intersection.greenTime = round(
      clamp(28 + intersection.congestion * 43 + emergencyBoost * 48 - ecoSoftening * 20, 24, 92)
    );
    intersection.signal = signalPhase(intersection, state.tick);
    intersection.status =
      intersection.congestion > 0.76 ? "critical" : intersection.congestion > 0.55 ? "busy" : "smooth";
    intersection.trend = round(intersection.congestion - previousCongestion, 2);

    if (intersection.greenTime > 48) optimizedSignals += 1;
    if (intersection.id === "hospital" && Math.random() < 0.08 + emergencyBoost) emergencyVehicles += 1;

    totalFlow += intersection.flow;
    totalSpeed += intersection.avgSpeed;
    totalWait += intersection.avgWait;
    congestionSum += intersection.congestion;
  }

  maybeCreateIncident();

  const activeIncidents = state.incidents.filter((incident) => incident.status === "active");
  const congestionIndex = congestionSum / state.intersections.length;
  state.metrics = {
    totalFlow: round(totalFlow),
    avgSpeed: round(totalSpeed / state.intersections.length),
    avgWait: round(totalWait / state.intersections.length),
    congestionIndex: round(congestionIndex, 2),
    optimizedSignals,
    activeIncidents: activeIncidents.length,
    emergencyVehicles,
    co2SavedKg: round((1 - congestionIndex) * 28 + optimizedSignals * 2.8, 1),
    reliability: round(clamp(99 - activeIncidents.length * 1.7 - congestionIndex * 5, 91, 99.8), 1)
  };

  broadcast();
}

function snapshot() {
  return {
    ...state,
    uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
    connectedClients: clients.size
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text);
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    sendJson(res, 500, { error: "Could not read file" });
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/snapshot") {
    sendJson(res, 200, snapshot());
    return;
  }

  if (req.method === "POST" && pathname === "/api/control") {
    try {
      const body = await readBody(req);
      const strategies = new Set(["adaptive", "emergency-priority", "eco"]);
      if (body.strategy && strategies.has(body.strategy)) {
        state.control.strategy = body.strategy;
      }
      if (typeof body.manualHold === "string" || body.manualHold === null) {
        state.control.manualHold = body.manualHold;
        state.control.operatorMode = body.manualHold ? "manual" : "auto";
      }
      if (typeof body.priorityIntersection === "string" && findIntersection(body.priorityIntersection)) {
        state.control.priorityIntersection = body.priorityIntersection;
      }
      updateSimulation();
      sendJson(res, 200, snapshot());
    } catch (error) {
      sendJson(res, 400, { error: "Invalid control payload" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/incidents") {
    try {
      const body = await readBody(req);
      const intersection = findIntersection(body.intersectionId);
      if (!intersection) {
        sendJson(res, 404, { error: "Intersection not found" });
        return;
      }
      const incident = {
        id: randomUUID(),
        type: body.type || "operator_report",
        label: body.label || "Operator report",
        intersectionId: intersection.id,
        severity: clamp(Number(body.severity || 0.55), 0.15, 0.95),
        status: "active",
        createdAt: Date.now()
      };
      state.incidents.unshift(incident);
      updateSimulation();
      sendJson(res, 201, snapshot());
    } catch (error) {
      sendJson(res, 400, { error: "Invalid incident payload" });
    }
    return;
  }

  const resolveMatch = pathname.match(/^\/api\/incidents\/([^/]+)\/resolve$/);
  if (req.method === "POST" && resolveMatch) {
    const incident = state.incidents.find((item) => item.id === resolveMatch[1]);
    if (!incident) {
      sendJson(res, 404, { error: "Incident not found" });
      return;
    }
    incident.status = "resolved";
    incident.resolvedAt = Date.now();
    updateSimulation();
    sendJson(res, 200, snapshot());
    return;
  }

  if (req.method === "POST" && pathname === "/api/reset") {
    state.incidents = [];
    state.control.manualHold = null;
    state.control.operatorMode = "auto";
    updateSimulation();
    sendJson(res, 200, snapshot());
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url.pathname);
    return;
  }

  await serveStatic(req, res, url.pathname);
});

setInterval(updateSimulation, 1000);
updateSimulation();

server.listen(PORT, () => {
  console.log(`Smart traffic management system running at http://localhost:${PORT}`);
});
