# Smart Traffic Management System

A new real-time smart traffic management project built from scratch. It runs locally with no external dependencies and streams traffic updates from a Node.js server to the browser with Server-Sent Events.

## Features

- Live traffic flow, queue length, wait time, and speed metrics.
- Adaptive, emergency-priority, and eco signal strategies.
- Real-time animated city network map.
- Incident creation, incident resolution, and auto-generated traffic events.
- Operator controls for priority intersections and manual signal hold.
- REST endpoints that can later be connected to camera, IoT, or city traffic APIs.

## Run

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

If npm is available in your terminal, `npm start` runs the same command.

## API

- `GET /api/snapshot` returns the current traffic state.
- `GET /events` streams live updates.
- `POST /api/control` updates the signal strategy, priority intersection, or manual hold.
- `POST /api/incidents` creates an incident.
- `POST /api/incidents/:id/resolve` resolves an incident.
- `POST /api/reset` clears active incidents and returns to auto control.

## Real Data Integration

Replace or extend `updateSimulation()` in `server.js` with data from live sensors, camera analytics, GPS feeds, or a city traffic API. Keep the response shape the same and the dashboard will continue updating automatically.
