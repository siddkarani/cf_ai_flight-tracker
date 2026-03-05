import { Agent, AgentNamespace, getAgentByName } from "agents";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Env {
  AI: Ai;
  FlightAgent: AgentNamespace<FlightAgent>;
}

interface FlightState {
  // flights the user has pinned/bookmarked
  trackedCallsigns: string[];
  // last N chat messages for LLM context
  chatHistory: { role: "user" | "assistant"; content: string }[];
  // cached snapshot of live flights (refreshed every ~10s by the frontend)
  lastFlightSnapshot: string; // JSON string of up to 50 nearby flights
}

// ─── OpenSky helpers ──────────────────────────────────────────────────────────

const OPENSKY_URL = "https://opensky-network.org/api/states/all";

// OpenSky state vector indices (positional array)
const IDX = {
  icao24: 0, callsign: 1, origin_country: 2,
  time_position: 3, last_contact: 4,
  longitude: 5, latitude: 6, baro_altitude: 7,
  on_ground: 8, velocity: 9, true_track: 10,
  vertical_rate: 11, sensors: 12, geo_altitude: 13,
  squawk: 14, spi: 15, position_source: 16,
};

function parseStates(raw: any[][]): object[] {
  return raw
    .filter(s => s[IDX.latitude] != null && s[IDX.longitude] != null && !s[IDX.on_ground])
    .map(s => ({
      icao24:          s[IDX.icao24],
      callsign:        (s[IDX.callsign] || "").trim(),
      origin_country:  s[IDX.origin_country],
      lat:             s[IDX.latitude],
      lon:             s[IDX.longitude],
      altitude_m:      s[IDX.baro_altitude],
      velocity_ms:     s[IDX.velocity],
      heading:         s[IDX.true_track],
      vertical_rate:   s[IDX.vertical_rate],
    }));
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class FlightAgent extends Agent<Env, FlightState> {

  // Default state (first time this agent runs for a user)
  initialState: FlightState = {
    trackedCallsigns: [],
    chatHistory: [],
    lastFlightSnapshot: "[]",
  };

  // HTTP router — all requests to the worker arrive here
  async onRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    // ── GET /flights — proxy OpenSky, cache in agent state ──────────────────
    if (url.pathname === "/flights" && req.method === "GET") {
      try {
        const res = await fetch(OPENSKY_URL, {
          headers: { "User-Agent": "CloudflareFlightTracker/1.0" },
          // 10 second cache so we don't hammer OpenSky
          cf: { cacheTtl: 10 },
        });
        if (!res.ok) throw new Error(`OpenSky ${res.status}`);
        const data: { states: any[][] } = await res.json();
        const flights = parseStates(data.states || []);

        // Persist a small snapshot (first 100 airborne flights) in agent state
        // so the LLM has context without us passing the whole world every time
        const snapshot = flights.slice(0, 100);
        this.setState({ ...this.state, lastFlightSnapshot: JSON.stringify(snapshot) });

        return new Response(JSON.stringify({ flights }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    // ── POST /track — pin/unpin a callsign ───────────────────────────────────
    if (url.pathname === "/track" && req.method === "POST") {
      const { callsign, action } = await req.json<{ callsign: string; action: "add" | "remove" }>();
      let tracked = [...(this.state.trackedCallsigns || [])];
      if (action === "add" && !tracked.includes(callsign)) tracked.push(callsign);
      if (action === "remove") tracked = tracked.filter(c => c !== callsign);
      this.setState({ ...this.state, trackedCallsigns: tracked });
      return new Response(JSON.stringify({ trackedCallsigns: tracked }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── GET /tracked — return pinned callsigns ───────────────────────────────
    if (url.pathname === "/tracked" && req.method === "GET") {
      return new Response(JSON.stringify({ trackedCallsigns: this.state.trackedCallsigns }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── POST /chat — LLM chat with flight context ────────────────────────────
    if (url.pathname === "/chat" && req.method === "POST") {
      const { message } = await req.json<{ message: string }>();

      // Build history (keep last 10 turns to stay within context limits)
      const history = (this.state.chatHistory || []).slice(-10);

      // Give the LLM a snapshot of current flights as context
      const snapshot = JSON.parse(this.state.lastFlightSnapshot || "[]");
      const flightContext = snapshot.length
        ? `Here is a sample of ${snapshot.length} currently airborne flights (from OpenSky live data):\n${JSON.stringify(snapshot.slice(0, 20), null, 2)}`
        : "No live flight snapshot is currently available.";

      const systemPrompt = `You are an expert aviation AI assistant embedded in a live 3D global flight tracker.
You have access to real-time ADS-B data from the OpenSky Network.

${flightContext}

The user's tracked (bookmarked) callsigns: ${JSON.stringify(this.state.trackedCallsigns || [])}.

You can help with:
- Questions about specific flights (callsign, altitude, speed, heading, country)
- Airport and route information
- Aviation terminology and concepts
- Interpreting flight data

Always be concise and helpful. If asked about a specific callsign, search the flight data above first.
`;

      // Call Llama 3.3 on Workers AI
      const messages = [
        ...history,
        { role: "user" as const, content: message },
      ];

      const aiResponse = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        { system: systemPrompt, messages }
      ) as { response?: string };

      const reply = aiResponse.response || "Sorry, I couldn't process that request.";

      // Persist chat history
      const updatedHistory = [
        ...history,
        { role: "user" as const, content: message },
        { role: "assistant" as const, content: reply },
      ];
      this.setState({ ...this.state, chatHistory: updatedHistory });

      return new Response(JSON.stringify({ reply }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404, headers: cors });
  }
}

// ─── Worker entrypoint ────────────────────────────────────────────────────────
// Every request is routed to the same named agent instance ("global")
// so state is shared/persistent across all sessions.

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Route all traffic to a single named agent instance
    const agent = await getAgentByName<FlightAgent>(env.FlightAgent, "global");
    return agent.fetch(req);
  },
} satisfies ExportedHandler<Env>;
