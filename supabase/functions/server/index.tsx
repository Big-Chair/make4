import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
import { createClient } from "npm:@supabase/supabase-js";

const app = new Hono();

// Supabase admin client for storage operations
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Token image storage bucket name
const TOKEN_BUCKET = "make-59149df1-tokens";

// Room TTL: 30 minutes
const ROOM_TTL_MS = 30 * 60 * 1000;
// Max concurrent active rooms
const MAX_ACTIVE_ROOMS = 50;

// Idempotently create the token bucket on startup
(async () => {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some((bucket: any) => bucket.name === TOKEN_BUCKET);
    if (!bucketExists) {
      await supabase.storage.createBucket(TOKEN_BUCKET, { public: false });
      console.log(`Created storage bucket: ${TOKEN_BUCKET}`);
    } else {
      console.log(`Storage bucket already exists: ${TOKEN_BUCKET}`);
    }
  } catch (err) {
    console.log(`Error initializing storage bucket: ${err}`);
  }
})();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-59149df1/health", (c) => {
  return c.json({ status: "ok" });
});

// Record a game result
// Body: { player1: string, player2: string, winner: "player1" | "player2" | "draw", gameMode: "local" | "bot", timerDuration?: number }
app.post("/make-server-59149df1/record-game", async (c) => {
  try {
    const body = await c.req.json();
    const { player1, player2, winner, gameMode, timerDuration } = body;

    if (!player1 || !player2 || !winner) {
      return c.json({ error: "Missing required fields: player1, player2, winner" }, 400);
    }

    const p1Key = `player:${player1.toLowerCase().trim()}`;
    const p2Key = `player:${player2.toLowerCase().trim()}`;

    // Fetch existing records
    const p1Data = await kv.get(p1Key) || { name: player1.trim(), wins: 0, losses: 0, draws: 0, gamesPlayed: 0, byLevel: {} };
    const p2Data = await kv.get(p2Key) || { name: player2.trim(), wins: 0, losses: 0, draws: 0, gamesPlayed: 0, byLevel: {} };

    // Ensure byLevel exists for legacy records
    if (!p1Data.byLevel) p1Data.byLevel = {};
    if (!p2Data.byLevel) p2Data.byLevel = {};

    // Update aggregate stats
    p1Data.gamesPlayed++;
    p2Data.gamesPlayed++;

    if (winner === "draw") {
      p1Data.draws++;
      p2Data.draws++;
    } else if (winner === "player1") {
      p1Data.wins++;
      p2Data.losses++;
    } else if (winner === "player2") {
      p2Data.wins++;
      p1Data.losses++;
    }

    // Update per-level stats if timerDuration is provided
    if (timerDuration && timerDuration > 0) {
      const lvl = String(timerDuration);
      if (!p1Data.byLevel[lvl]) p1Data.byLevel[lvl] = { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
      if (!p2Data.byLevel[lvl]) p2Data.byLevel[lvl] = { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };

      p1Data.byLevel[lvl].gamesPlayed++;
      p2Data.byLevel[lvl].gamesPlayed++;

      if (winner === "draw") {
        p1Data.byLevel[lvl].draws++;
        p2Data.byLevel[lvl].draws++;
      } else if (winner === "player1") {
        p1Data.byLevel[lvl].wins++;
        p2Data.byLevel[lvl].losses++;
      } else if (winner === "player2") {
        p2Data.byLevel[lvl].wins++;
        p1Data.byLevel[lvl].losses++;
      }
    }

    // Preserve display name (use most recent casing)
    p1Data.name = player1.trim();
    if (gameMode !== "bot") {
      p2Data.name = player2.trim();
    }

    // Save both
    await kv.mset([p1Key, p2Key], [p1Data, p2Data]);

    console.log(`Game recorded: ${player1} vs ${player2}, winner: ${winner}, timer: ${timerDuration || "none"}`);

    return c.json({ success: true, player1: p1Data, player2: p2Data });
  } catch (err) {
    console.log(`Error recording game result: ${err}`);
    return c.json({ error: `Failed to record game: ${err}` }, 500);
  }
});

// Save a player's token config (for leaderboard display)
app.post("/make-server-59149df1/save-token-config", async (c) => {
  try {
    const body = await c.req.json();
    const { playerName, tokenConfig } = body;

    if (!playerName || !tokenConfig) {
      return c.json({ error: "Missing required fields: playerName, tokenConfig" }, 400);
    }

    const sanitizedName = playerName.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
    const configKey = `tokenconfig:${sanitizedName}`;
    await kv.set(configKey, {
      ...tokenConfig,
      playerName: playerName.trim(),
      updatedAt: new Date().toISOString(),
    });

    console.log(`Token config saved for ${playerName}: type=${tokenConfig.type}`);
    return c.json({ success: true });
  } catch (err) {
    console.log(`Error saving token config: ${err}`);
    return c.json({ error: `Failed to save token config: ${err}` }, 500);
  }
});

// Get leaderboard (all players sorted by wins, optionally filtered by level)
app.get("/make-server-59149df1/leaderboard", async (c) => {
  try {
    const playerQuery = c.req.query("player")?.toLowerCase().trim() || "";
    const limitParam = parseInt(c.req.query("limit") || "20", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);
    const level = c.req.query("level") || ""; // e.g. "40", "35", "30" — empty = aggregate
    const players = await kv.getByPrefix("player:");

    // Helper to extract stats for a given level (or aggregate)
    const getStats = (p: any) => {
      if (level && p.byLevel?.[level]) {
        return p.byLevel[level];
      }
      // Aggregate stats
      return { wins: p.wins || 0, losses: p.losses || 0, draws: p.draws || 0, gamesPlayed: p.gamesPlayed || 0 };
    };

    // Sort by wins descending, then by win rate
    const sorted = players
      .filter((p: any) => {
        if (!p?.name) return false;
        const s = getStats(p);
        return s.gamesPlayed > 0;
      })
      .sort((a: any, b: any) => {
        const sa = getStats(a);
        const sb = getStats(b);
        if (sb.wins !== sa.wins) return sb.wins - sa.wins;
        const aRate = sa.gamesPlayed > 0 ? sa.wins / sa.gamesPlayed : 0;
        const bRate = sb.gamesPlayed > 0 ? sb.wins / sb.gamesPlayed : 0;
        return bRate - aRate;
      });

    const topN = sorted.slice(0, limit);

    // Map players to include level-specific stats when filtering
    const topNMapped = topN.map((p: any) => {
      const s = getStats(p);
      return { name: p.name, wins: s.wins, losses: s.losses, draws: s.draws, gamesPlayed: s.gamesPlayed };
    });

    // Fetch token configs for the top players
    const tokenConfigs: Record<string, any> = {};
    const allTokenConfigs = await kv.getByPrefix("tokenconfig:");
    const tokenMap = new Map<string, any>();
    for (const tc of allTokenConfigs) {
      if (tc?.playerName) {
        tokenMap.set(tc.playerName.toLowerCase().trim(), tc);
      }
    }
    for (const p of topNMapped) {
      const key = p.name.toLowerCase().trim();
      if (tokenMap.has(key)) {
        const { playerName, updatedAt, ...config } = tokenMap.get(key);
        tokenConfigs[p.name] = config;
      }
    }

    // Find the requesting player's rank if they provided a name
    let currentPlayer: any = null;
    let currentPlayerRank: number | null = null;

    if (playerQuery) {
      const idx = sorted.findIndex(
        (p: any) => p.name.toLowerCase().trim() === playerQuery
      );
      if (idx >= 0) {
        currentPlayerRank = idx + 1;
        const raw = sorted[idx];
        const s = getStats(raw);
        currentPlayer = { name: raw.name, wins: s.wins, losses: s.losses, draws: s.draws, gamesPlayed: s.gamesPlayed };
      }
    }

    return c.json({ players: topNMapped, currentPlayer, currentPlayerRank, tokenConfigs });
  } catch (err) {
    console.log(`Error fetching leaderboard: ${err}`);
    return c.json({ error: `Failed to fetch leaderboard: ${err}` }, 500);
  }
});

// Get a single player's stats
app.get("/make-server-59149df1/player/:name", async (c) => {
  try {
    const name = c.req.param("name");
    const key = `player:${name.toLowerCase().trim()}`;
    const data = await kv.get(key);

    if (!data) {
      return c.json({ player: null });
    }

    return c.json({ player: data });
  } catch (err) {
    console.log(`Error fetching player ${c.req.param("name")}: ${err}`);
    return c.json({ error: `Failed to fetch player: ${err}` }, 500);
  }
});

// Upload a custom token image for a player
app.post("/make-server-59149df1/upload-token", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const playerName = formData.get("playerName") as string | null;

    if (!file || !playerName) {
      return c.json({ error: "Missing required fields: file, playerName" }, 400);
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return c.json({ error: "File must be an image" }, 400);
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      return c.json({ error: "File must be under 2MB" }, 400);
    }

    const sanitizedName = playerName.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
    const ext = file.name.split(".").pop() || "png";
    const filePath = `${sanitizedName}/token_${Date.now()}.${ext}`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const { data, error } = await supabase.storage
      .from(TOKEN_BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (error) {
      console.log(`Error uploading token image for ${playerName}: ${error.message}`);
      return c.json({ error: `Upload failed: ${error.message}` }, 500);
    }

    // Generate a signed URL (valid for 1 year)
    const { data: signedData, error: signedError } = await supabase.storage
      .from(TOKEN_BUCKET)
      .createSignedUrl(filePath, 365 * 24 * 60 * 60);

    if (signedError) {
      console.log(`Error creating signed URL for ${playerName}: ${signedError.message}`);
      return c.json({ error: `Failed to generate URL: ${signedError.message}` }, 500);
    }

    // Store the token config in KV for persistence
    const tokenKey = `token:${sanitizedName}`;
    await kv.set(tokenKey, {
      type: "image",
      filePath,
      imageUrl: signedData.signedUrl,
      uploadedAt: new Date().toISOString(),
    });

    console.log(`Token image uploaded for ${playerName}: ${filePath}`);

    return c.json({
      success: true,
      signedUrl: signedData.signedUrl,
      filePath,
    });
  } catch (err) {
    console.log(`Error in token upload: ${err}`);
    return c.json({ error: `Token upload failed: ${err}` }, 500);
  }
});

// Get a player's token image URL
app.get("/make-server-59149df1/token/:name", async (c) => {
  try {
    const name = c.req.param("name");
    const sanitizedName = name.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
    const tokenKey = `token:${sanitizedName}`;
    const tokenData = await kv.get(tokenKey);

    if (!tokenData || !tokenData.filePath) {
      return c.json({ token: null });
    }

    // Re-generate a fresh signed URL
    const { data: signedData, error } = await supabase.storage
      .from(TOKEN_BUCKET)
      .createSignedUrl(tokenData.filePath, 365 * 24 * 60 * 60);

    if (error) {
      console.log(`Error generating signed URL for token ${name}: ${error.message}`);
      return c.json({ token: null });
    }

    return c.json({
      token: {
        ...tokenData,
        imageUrl: signedData.signedUrl,
      },
    });
  } catch (err) {
    console.log(`Error fetching token for ${c.req.param("name")}: ${err}`);
    return c.json({ error: `Failed to fetch token: ${err}` }, 500);
  }
});

// ─── Site Stats & Visit Tracking ───

// Record a page visit (called once per session)
app.post("/make-server-59149df1/visit", async (c) => {
  try {
    const stats = await kv.get("site:stats") || { totalVisits: 0, totalGamesPlayed: 0 };
    stats.totalVisits++;
    await kv.set("site:stats", stats);
    return c.json({ success: true, totalVisits: stats.totalVisits });
  } catch (err) {
    console.log(`Error recording visit: ${err}`);
    return c.json({ error: `Failed to record visit: ${err}` }, 500);
  }
});

// Get site-wide stats: total visits, total games, active rooms
app.get("/make-server-59149df1/stats", async (c) => {
  try {
    const stats = await kv.get("site:stats") || { totalVisits: 0, totalGamesPlayed: 0 };

    // Count active (non-expired) rooms
    const rooms = await kv.getByPrefix("room:");
    const now = Date.now();
    let activeRooms = 0;
    let waitingRooms = 0;
    const expiredKeys: string[] = [];

    for (const room of rooms) {
      if (!room?.createdAt) continue;
      if (now - new Date(room.createdAt).getTime() > ROOM_TTL_MS) {
        expiredKeys.push(`room:${room.code}`);
      } else {
        activeRooms++;
        if (room.status === "waiting") waitingRooms++;
      }
    }

    // Lazily clean expired rooms
    if (expiredKeys.length > 0) {
      await kv.mdel(expiredKeys);
      console.log(`Cleaned up ${expiredKeys.length} expired rooms`);
    }

    // Count total unique players from the leaderboard
    const players = await kv.getByPrefix("player:");
    const totalPlayers = players.filter((p: any) => p?.gamesPlayed > 0).length;
    const totalGames = players.reduce((sum: number, p: any) => sum + (p?.gamesPlayed || 0), 0) / 2; // each game involves 2 players

    return c.json({
      totalVisits: stats.totalVisits,
      totalGamesPlayed: Math.floor(totalGames),
      totalPlayers,
      activeRooms,
      waitingRooms,
      maxRooms: MAX_ACTIVE_ROOMS,
      capacityPercent: Math.round((activeRooms / MAX_ACTIVE_ROOMS) * 100),
    });
  } catch (err) {
    console.log(`Error fetching stats: ${err}`);
    return c.json({ error: `Failed to fetch stats: ${err}` }, 500);
  }
});

// ─── Online Multiplayer Room Routes ───

// Generate a 6-character room code
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Check if a room has expired (30-minute TTL)
function isRoomExpired(room: any): boolean {
  if (!room?.createdAt) return true;
  return Date.now() - new Date(room.createdAt).getTime() > ROOM_TTL_MS;
}

// Create a new room
app.post("/make-server-59149df1/rooms", async (c) => {
  try {
    const body = await c.req.json();
    const { hostName, timerDuration, blastTokens } = body;

    if (!hostName) {
      return c.json({ error: "Missing required field: hostName" }, 400);
    }

    // Check if the maximum number of active rooms is reached
    const rooms = await kv.getByPrefix("room:");
    const activeRooms = rooms.filter((room: any) => !isRoomExpired(room));
    if (activeRooms.length >= MAX_ACTIVE_ROOMS) {
      return c.json({ error: "Maximum number of active rooms reached" }, 429);
    }

    // Generate unique room code (retry if collision)
    let code = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      code = generateRoomCode();
      const existing = await kv.get(`room:${code}`);
      if (!existing) break;
    }

    const room = {
      code,
      hostName: hostName.trim(),
      guestName: null,
      timerDuration: timerDuration ?? 40,
      blastTokens: blastTokens ?? true,
      status: "waiting", // waiting | playing | finished
      createdAt: new Date().toISOString(),
    };

    await kv.set(`room:${code}`, room);
    console.log(`Room created: ${code} by ${hostName}`);

    return c.json({ success: true, room });
  } catch (err) {
    console.log(`Error creating room: ${err}`);
    return c.json({ error: `Failed to create room: ${err}` }, 500);
  }
});

// Join a room
app.post("/make-server-59149df1/rooms/:code/join", async (c) => {
  try {
    const code = c.req.param("code").toUpperCase().trim();
    const body = await c.req.json();
    const { guestName } = body;

    if (!guestName) {
      return c.json({ error: "Missing required field: guestName" }, 400);
    }

    const roomKey = `room:${code}`;
    const room = await kv.get(roomKey);

    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    if (isRoomExpired(room)) {
      await kv.del(roomKey);
      console.log(`Room ${code} expired and was cleaned up`);
      return c.json({ error: "Room has expired. Please create a new room." }, 410);
    }

    if (room.status !== "waiting") {
      return c.json({ error: "Room is no longer accepting players" }, 400);
    }

    room.guestName = guestName.trim();
    room.status = "playing";
    room.joinedAt = new Date().toISOString();

    await kv.set(roomKey, room);
    console.log(`Room ${code}: ${guestName} joined (host: ${room.hostName})`);

    return c.json({ success: true, room });
  } catch (err) {
    console.log(`Error joining room ${c.req.param("code")}: ${err}`);
    return c.json({ error: `Failed to join room: ${err}` }, 500);
  }
});

// Get room status
app.get("/make-server-59149df1/rooms/:code", async (c) => {
  try {
    const code = c.req.param("code").toUpperCase().trim();
    const roomKey = `room:${code}`;
    const room = await kv.get(roomKey);

    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    if (isRoomExpired(room)) {
      await kv.del(roomKey);
      console.log(`Room ${code} expired and was cleaned up`);
      return c.json({ error: "Room has expired. Please create a new room." }, 410);
    }

    return c.json({ room });
  } catch (err) {
    console.log(`Error fetching room ${c.req.param("code")}: ${err}`);
    return c.json({ error: `Failed to fetch room: ${err}` }, 500);
  }
});

Deno.serve(app.fetch);