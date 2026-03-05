import { Agent, AgentNamespace, getAgentByName } from "agents";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Env {
  AI: Ai;
  FlightAgent: AgentNamespace<FlightAgent>;
}

interface FlightState {
  trackedCallsigns: string[];
  chatHistory: { role: "user" | "assistant"; content: string }[];
  lastFlightSnapshot: string;
}

// ─── AviationStack fetch ──────────────────────────────────────────────────────

const AVIATION_KEY = "acc86a44ca55250ec740993818340170";

async function fetchLiveFlights(): Promise<object[]> {
  const url = `https://api.aviationstack.com/v1/flights?access_key=${AVIATION_KEY}&flight_status=active&limit=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AviationStack ${res.status}`);
  const data: any = await res.json();
  if (!data.data) throw new Error("No flight data returned");

  return data.data
    .filter((f: any) => f.live && f.live.latitude != null && f.live.longitude != null)
    .map((f: any) => ({
      icao24:         f.flight?.icao || f.flight?.iata || "unknown",
      callsign:       f.flight?.icao || f.flight?.iata || "",
      origin_country: f.airline?.name || "Unknown",
      lat:            f.live.latitude,
      lon:            f.live.longitude,
      altitude_m:     f.live.altitude,
      velocity_ms:    f.live.speed_horizontal ? f.live.speed_horizontal / 3.6 : null,
      heading:        f.live.direction,
      vertical_rate:  f.live.speed_vertical ? f.live.speed_vertical / 60 : null,
      departure:      f.departure?.airport || null,
      arrival:        f.arrival?.airport || null,
      airline:        f.airline?.name || null,
    }));
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class FlightAgent extends Agent<Env, FlightState> {

  initialState: FlightState = {
    trackedCallsigns: [],
    chatHistory: [],
    lastFlightSnapshot: "[]",
  };

  async onRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    // ── GET /flights ─────────────────────────────────────────────────────────
    if (url.pathname === "/flights" && req.method === "GET") {
      try {
        const flights = await fetchLiveFlights();
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

    // ── POST /track ──────────────────────────────────────────────────────────
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

    // ── GET /tracked ─────────────────────────────────────────────────────────
    if (url.pathname === "/tracked" && req.method === "GET") {
      return new Response(JSON.stringify({ trackedCallsigns: this.state.trackedCallsigns }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── POST /chat ───────────────────────────────────────────────────────────
    if (url.pathname === "/chat" && req.method === "POST") {
      const { message } = await req.json<{ message: string }>();
      const history = (this.state.chatHistory || []).slice(-10);
      const snapshot = JSON.parse(this.state.lastFlightSnapshot || "[]");
      const flightContext = snapshot.length
        ? `Here is a sample of ${snapshot.length} currently active flights:\n${JSON.stringify(snapshot.slice(0, 20), null, 2)}`
        : "No live flight snapshot is currently available.";

      const systemPrompt = `You are an expert aviation AI assistant embedded in a live 3D global flight tracker.
You have access to real-time flight data from AviationStack.

${flightContext}

The user's tracked callsigns: ${JSON.stringify(this.state.trackedCallsigns || [])}.

Help with questions about specific flights, airports, routes, and aviation in general.
Be concise and helpful. If asked about a specific callsign, search the flight data above first.`;

      const messages = [
        ...history,
        { role: "user" as const, content: message },
      ];

      const aiResponse = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        { system: systemPrompt, messages }
      ) as { response?: string };

      const reply = aiResponse.response || "Sorry, I couldn't process that request.";
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const agent = await getAgentByName<FlightAgent>(env.FlightAgent, "global");
    return agent.fetch(req);
  },
} satisfies ExportedHandler<Env>;
