import { Hono } from "npm:hono@4.13.7";
import { cors } from "npm:hono@4.13.7/cors";
import { logger } from "npm:hono@4.13.7/logger";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";
import type { Database } from "./database.types.ts";

type Tables = Database["public"]["Tables"];
type RoomRow = Tables["rooms"]["Row"];

const app = new Hono();

// Supabase admin client for database and storage operations
const supabase = createClient<Database>(
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

// ─── Helpers ───

// Players are keyed by case-insensitive name
const playerKey = (name: string) => name.toLowerCase().trim();

// Tokens are keyed by a filesystem-safe version of the name
const tokenKey = (name: string) => playerKey(name).replace(/[^a-z0-9_-]/g, "_");

// Supabase errors are plain objects, so `${err}` would print "[object Object]"
const describe = (err: unknown) =>
  err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);

type StatsRow = Pick<Tables["players"]["Row"], "display_name" | "wins" | "losses" | "draws" | "games_played">;

const toPlayerStats = (row: StatsRow) => ({
  name: row.display_name,
  wins: row.wins,
  losses: row.losses,
  draws: row.draws,
  gamesPlayed: row.games_played,
});

const toRoom = (row: RoomRow) => ({
  code: row.code,
  hostName: row.host_name,
  guestName: row.guest_name,
  timerDuration: row.timer_duration,
  blastTokens: row.blast_tokens,
  status: row.status,
  createdAt: row.created_at,
  joinedAt: row.joined_at ?? undefined,
});

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
// Body: { player1: string, player2: string, winner: "player1" | "player2" | "draw", gameMode: "local" | "bot" | "online", timerDuration?: number }
app.post("/make-server-59149df1/record-game", async (c) => {
  try {
    const body = await c.req.json();
    const { player1, player2, winner, gameMode, timerDuration } = body;

    if (!player1 || !player2 || !winner) {
      return c.json({ error: "Missing required fields: player1, player2, winner" }, 400);
    }
    if (!["player1", "player2", "draw"].includes(winner)) {
      return c.json({ error: "winner must be player1, player2 or draw" }, 400);
    }

    const { data, error } = await supabase.rpc("record_game", {
      p_player1: player1,
      p_player2: player2,
      p_winner: winner,
      p_game_mode: gameMode ?? undefined,
      p_timer_duration: timerDuration ?? undefined,
    });
    if (error) throw error;

    const byKey = new Map(data.map((row) => [row.name_key, toPlayerStats(row)]));

    console.log(`Game recorded: ${player1} vs ${player2}, winner: ${winner}, timer: ${timerDuration || "none"}`);

    return c.json({
      success: true,
      player1: byKey.get(playerKey(player1)),
      player2: byKey.get(playerKey(player2)),
    });
  } catch (err) {
    console.log(`Error recording game result: ${describe(err)}`);
    return c.json({ error: `Failed to record game: ${describe(err)}` }, 500);
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

    const { error } = await supabase.from("token_configs").upsert({
      name_key: tokenKey(playerName),
      player_name: playerName.trim(),
      config: tokenConfig,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    console.log(`Token config saved for ${playerName}: type=${tokenConfig.type}`);
    return c.json({ success: true });
  } catch (err) {
    console.log(`Error saving token config: ${describe(err)}`);
    return c.json({ error: `Failed to save token config: ${describe(err)}` }, 500);
  }
});

// Get leaderboard (players sorted by wins, then win rate; optionally filtered by level)
app.get("/make-server-59149df1/leaderboard", async (c) => {
  try {
    const playerQuery = playerKey(c.req.query("player") || "");
    const limitParam = parseInt(c.req.query("limit") || "", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;
    const levelParam = parseInt(c.req.query("level") || "", 10); // e.g. "40", "35", "30" — empty = all games
    const level = levelParam > 0 ? levelParam : undefined;

    const { data: rows, error } = await supabase.rpc("get_leaderboard", {
      p_limit: limit,
      p_level: level,
      p_player: playerQuery || undefined,
    });
    if (error) throw error;

    const top = rows.filter((row) => row.rank <= limit);
    const players = top.map(toPlayerStats);
    const current = playerQuery ? rows.find((row) => row.name_key === playerQuery) : undefined;

    // Token configs for the top players, keyed by display name
    const tokenConfigs: Record<string, unknown> = {};
    if (players.length > 0) {
      const { data: configs, error: configError } = await supabase
        .from("token_configs")
        .select("name_key, config")
        .in("name_key", players.map((p) => tokenKey(p.name)));
      if (configError) throw configError;

      const configByKey = new Map(configs.map((row) => [row.name_key, row.config]));
      for (const p of players) {
        const config = configByKey.get(tokenKey(p.name));
        if (config) tokenConfigs[p.name] = config;
      }
    }

    return c.json({
      players,
      currentPlayer: current ? toPlayerStats(current) : null,
      currentPlayerRank: current ? current.rank : null,
      tokenConfigs,
    });
  } catch (err) {
    console.log(`Error fetching leaderboard: ${describe(err)}`);
    return c.json({ error: `Failed to fetch leaderboard: ${describe(err)}` }, 500);
  }
});

// Get a single player's stats
app.get("/make-server-59149df1/player/:name", async (c) => {
  try {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("name_key", playerKey(c.req.param("name")))
      .maybeSingle();
    if (error) throw error;

    return c.json({ player: data ? toPlayerStats(data) : null });
  } catch (err) {
    console.log(`Error fetching player ${c.req.param("name")}: ${describe(err)}`);
    return c.json({ error: `Failed to fetch player: ${describe(err)}` }, 500);
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

    const sanitizedName = tokenKey(playerName);
    const ext = file.name.split(".").pop() || "png";
    const filePath = `${sanitizedName}/token_${Date.now()}.${ext}`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const { error } = await supabase.storage
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

    // Remember which file is the player's current token image
    const { error: dbError } = await supabase.from("token_images").upsert({
      name_key: sanitizedName,
      file_path: filePath,
      uploaded_at: new Date().toISOString(),
    });
    if (dbError) throw dbError;

    console.log(`Token image uploaded for ${playerName}: ${filePath}`);

    return c.json({
      success: true,
      signedUrl: signedData.signedUrl,
      filePath,
    });
  } catch (err) {
    console.log(`Error in token upload: ${describe(err)}`);
    return c.json({ error: `Token upload failed: ${describe(err)}` }, 500);
  }
});

// Get a player's token image URL
app.get("/make-server-59149df1/token/:name", async (c) => {
  try {
    const name = c.req.param("name");
    const { data: tokenImage, error: dbError } = await supabase
      .from("token_images")
      .select("*")
      .eq("name_key", tokenKey(name))
      .maybeSingle();
    if (dbError) throw dbError;

    if (!tokenImage) {
      return c.json({ token: null });
    }

    // Re-generate a fresh signed URL
    const { data: signedData, error } = await supabase.storage
      .from(TOKEN_BUCKET)
      .createSignedUrl(tokenImage.file_path, 365 * 24 * 60 * 60);

    if (error) {
      console.log(`Error generating signed URL for token ${name}: ${error.message}`);
      return c.json({ token: null });
    }

    return c.json({
      token: {
        type: "image",
        filePath: tokenImage.file_path,
        uploadedAt: tokenImage.uploaded_at,
        imageUrl: signedData.signedUrl,
      },
    });
  } catch (err) {
    console.log(`Error fetching token for ${c.req.param("name")}: ${describe(err)}`);
    return c.json({ error: `Failed to fetch token: ${describe(err)}` }, 500);
  }
});

// ─── Site Stats & Visit Tracking ───

// Record a page visit (called once per session)
app.post("/make-server-59149df1/visit", async (c) => {
  try {
    const { data: totalVisits, error } = await supabase.rpc("record_visit");
    if (error) throw error;
    return c.json({ success: true, totalVisits });
  } catch (err) {
    console.log(`Error recording visit: ${describe(err)}`);
    return c.json({ error: `Failed to record visit: ${describe(err)}` }, 500);
  }
});

// Get site-wide stats: total visits, total games, active rooms
app.get("/make-server-59149df1/stats", async (c) => {
  try {
    // Lazily clean expired rooms
    const { count: expiredCount, error: cleanupError } = await supabase
      .from("rooms")
      .delete({ count: "exact" })
      .lt("created_at", new Date(Date.now() - ROOM_TTL_MS).toISOString());
    if (cleanupError) throw cleanupError;
    if (expiredCount) {
      console.log(`Cleaned up ${expiredCount} expired rooms`);
    }

    const [site, rooms, totals] = await Promise.all([
      supabase.from("site_stats").select("total_visits").single(),
      supabase.from("rooms").select("status"),
      supabase.rpc("player_totals").single(),
    ]);
    if (site.error) throw site.error;
    if (rooms.error) throw rooms.error;
    if (totals.error) throw totals.error;

    const activeRooms = rooms.data.length;
    const waitingRooms = rooms.data.filter((room) => room.status === "waiting").length;

    return c.json({
      totalVisits: site.data.total_visits,
      totalGamesPlayed: totals.data.total_games,
      totalPlayers: totals.data.total_players,
      activeRooms,
      waitingRooms,
      maxRooms: MAX_ACTIVE_ROOMS,
      capacityPercent: Math.round((activeRooms / MAX_ACTIVE_ROOMS) * 100),
    });
  } catch (err) {
    console.log(`Error fetching stats: ${describe(err)}`);
    return c.json({ error: `Failed to fetch stats: ${describe(err)}` }, 500);
  }
});

// ─── Online Multiplayer Room Routes ───

// Check if a room has expired (30-minute TTL)
function isRoomExpired(room: RoomRow): boolean {
  return Date.now() - new Date(room.created_at).getTime() > ROOM_TTL_MS;
}

// Look up a room by code, deleting it if it has expired
async function findRoom(code: string): Promise<RoomRow | "missing" | "expired"> {
  const { data: room, error } = await supabase.from("rooms").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  if (!room) return "missing";

  if (isRoomExpired(room)) {
    const { error: deleteError } = await supabase.from("rooms").delete().eq("code", code);
    if (deleteError) throw deleteError;
    console.log(`Room ${code} expired and was cleaned up`);
    return "expired";
  }

  return room;
}

// Create a new room
app.post("/make-server-59149df1/rooms", async (c) => {
  try {
    const body = await c.req.json();
    const { hostName, timerDuration, blastTokens } = body;

    if (!hostName) {
      return c.json({ error: "Missing required field: hostName" }, 400);
    }

    const { data: room, error } = await supabase.rpc("create_room", {
      p_host_name: hostName,
      p_timer_duration: timerDuration ?? 40,
      p_blast_tokens: blastTokens ?? true,
      p_max_rooms: MAX_ACTIVE_ROOMS,
      p_ttl_seconds: ROOM_TTL_MS / 1000,
    });

    if (error?.message === "room_capacity_reached") {
      return c.json({ error: "Maximum number of active rooms reached" }, 429);
    }
    if (error) throw error;

    console.log(`Room created: ${room.code} by ${hostName}`);

    return c.json({ success: true, room: toRoom(room) });
  } catch (err) {
    console.log(`Error creating room: ${describe(err)}`);
    return c.json({ error: `Failed to create room: ${describe(err)}` }, 500);
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

    const room = await findRoom(code);
    if (room === "missing") {
      return c.json({ error: "Room not found" }, 404);
    }
    if (room === "expired") {
      return c.json({ error: "Room has expired. Please create a new room." }, 410);
    }
    if (room.status !== "waiting") {
      return c.json({ error: "Room is no longer accepting players" }, 400);
    }

    // Only succeeds if the room is still waiting, so two guests can't both join
    const { data: joined, error } = await supabase
      .from("rooms")
      .update({
        guest_name: guestName.trim(),
        status: "playing",
        joined_at: new Date().toISOString(),
      })
      .eq("code", code)
      .eq("status", "waiting")
      .select()
      .maybeSingle();
    if (error) throw error;

    if (!joined) {
      return c.json({ error: "Room is no longer accepting players" }, 400);
    }

    console.log(`Room ${code}: ${guestName} joined (host: ${joined.host_name})`);

    return c.json({ success: true, room: toRoom(joined) });
  } catch (err) {
    console.log(`Error joining room ${c.req.param("code")}: ${describe(err)}`);
    return c.json({ error: `Failed to join room: ${describe(err)}` }, 500);
  }
});

// Get room status
app.get("/make-server-59149df1/rooms/:code", async (c) => {
  try {
    const code = c.req.param("code").toUpperCase().trim();
    const room = await findRoom(code);

    if (room === "missing") {
      return c.json({ error: "Room not found" }, 404);
    }
    if (room === "expired") {
      return c.json({ error: "Room has expired. Please create a new room." }, 410);
    }

    return c.json({ room: toRoom(room) });
  } catch (err) {
    console.log(`Error fetching room ${c.req.param("code")}: ${describe(err)}`);
    return c.json({ error: `Failed to fetch room: ${describe(err)}` }, 500);
  }
});

Deno.serve(app.fetch);
