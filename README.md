# AI-Powered 3D Global Flight Tracker

A real-time, AI-powered 3D flight tracker built on Cloudflare's developer platform as part of the optional engineering assignment.

Track every plane in the sky on an interactive 3D globe, chat with an AI assistant about any flight, and bookmark flights to follow — all powered by Cloudflare's edge infrastructure.

---

## Live Demo

Frontend: https://flight-tracker-bmy.pages.dev

Worker API: https://flight-tracker-worker.sidd-karani06.workers.dev

---

## Assignment Requirements

| Requirement | Implementation |
|---|---|
| LLM | Llama 3.3 70B via Cloudflare Workers AI |
| Workflow / Coordination | Cloudflare Workers + Agents SDK (Durable Objects) |
| User Input via Chat | Real-time AI chat UI + flight search on Cloudflare Pages |
| Memory / State | Durable Objects built-in SQL — persists tracked flights and chat history |

---

## What It Does

- Live 3D globe with every airborne plane rendered as a 3D aircraft model in real time
- Real flight data powered by AviationStack API (live ADS-B data, updated every 15 seconds)
- AI chat assistant powered by Llama 3.3 — ask anything about flights, routes, or airports
- Persistent memory — bookmarked flights and chat history saved via Durable Objects
- Search any flight by callsign (e.g. TLM758, LOT728)
- Click any plane to see real-time altitude, speed, heading, departure, and arrival

---

## Architecture

```
AviationStack API  (polled every 15 seconds)
        |
Cloudflare Worker — FlightAgent (Durable Object)
        |-- Caches flight state in Durable Object SQL
        |-- GET  /flights  --> returns live flight data to frontend
        |-- POST /chat     --> Llama 3.3 on Workers AI, returns AI reply
        |-- POST /track    --> saves bookmarked callsigns to state
        |-- GET  /tracked  --> returns saved callsigns
        |
Cloudflare Pages (frontend)
        |-- Three.js 3D globe with real Earth texture
        |-- 3D aircraft models built from Three.js geometries
        |-- AI chat panel (bottom right)
        |-- Click any plane for flight details
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend Agent | Cloudflare Workers + Agents SDK |
| AI Model | Llama 3.3 70B (Cloudflare Workers AI) |
| State / Memory | Durable Objects (SQLite) |
| Frontend | Vanilla JS + Three.js r128 |
| Hosting | Cloudflare Pages |
| Flight Data | AviationStack REST API |

---

## Project Structure

```
cf_ai_flight-tracker/
├── README.md
├── worker/
│   ├── package.json          # Worker dependencies
│   ├── wrangler.jsonc        # Cloudflare config (AI binding + Durable Objects)
│   └── src/
│       └── index.ts          # Agent: AviationStack proxy, Llama 3.3 chat, state
└── frontend/
    ├── index.html            # App shell and UI layout
    ├── globe.js              # Three.js 3D globe, 3D plane models, drag/zoom/click
    └── chat.js               # AI chat panel
```

---

## Running Locally

### Prerequisites
- Node.js v18 or higher
- A free Cloudflare account at dash.cloudflare.com
- Wrangler CLI: `npm install -g wrangler`
- An AviationStack API key (free at aviationstack.com)

### 1. Clone the repo
```bash
git clone https://github.com/siddkarani/cf_ai_flight-tracker.git
cd cf_ai_flight-tracker
```

### 2. Run the Worker locally
```bash
cd worker
npm install
npx wrangler login
npx wrangler dev
```

The worker will run at `http://localhost:8787`

### 3. Run the frontend locally
Open a second terminal:
```bash
cd frontend
npx serve .
```

Open `http://localhost:3000` in your browser. Make sure `WORKER_URL` in `globe.js` points to `http://localhost:8787`.

---

## Deploying to Cloudflare

### 1. Deploy the Worker
```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Copy the worker URL printed in the terminal (e.g. `https://flight-tracker-worker.YOUR_SUBDOMAIN.workers.dev`) and update `WORKER_URL` on line 2 of `frontend/globe.js`.

### 2. Deploy the Frontend
```bash
cd frontend
npx wrangler pages deploy . --project-name=cf-ai-flight-tracker
```

---

## Cloudflare Bindings

Configured automatically via `wrangler.jsonc` — no manual setup needed.

| Binding | Purpose |
|---|---|
| `AI` | Workers AI — Llama 3.3 70B inference |
| `FlightAgent` | Durable Object — persistent state and chat memory |

---

## How to Use

1. Open the live demo link above
2. The globe loads automatically with all live flights shown as 3D aircraft
3. Click any plane to see its details (airline, altitude, speed, heading, route)
4. Use the search bar to find a specific flight by callsign
5. Click "Track This Flight" to bookmark a flight — it will be highlighted in green
6. Click the chat button (bottom right) to ask the AI assistant anything about flights
