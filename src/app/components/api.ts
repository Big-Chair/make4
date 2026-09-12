import { projectId, publicAnonKey } from "../../../utils/supabase/info";

const BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-59149df1`;

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${publicAnonKey}`,
};

// ─── Typed gateway ───
//
// Every call returns a discriminated `Result<T>` so the failure mode lives in
// the interface: callers branch on `res.ok` instead of guessing between null,
// empty objects, or thrown errors. A dead backend is now a value, not silence.

export interface ApiError {
  kind: "http" | "network";
  status?: number; // present for http failures
  message: string; // server-provided when available
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

/**
 * The single transport core. Builds the URL + headers, performs the fetch,
 * normalizes both HTTP and network failures into `ApiError`, and tolerates
 * empty/204 bodies. FormData bodies skip the JSON Content-Type so the browser
 * can set the multipart boundary.
 */
async function request<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const isForm = init?.body instanceof FormData;
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: isForm
        ? { Authorization: `Bearer ${publicAnonKey}`, ...init?.headers }
        : { ...headers, ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return {
        ok: false,
        error: {
          kind: "http",
          status: res.status,
          message: body?.error || `Request failed (${res.status})`,
        },
      };
    }
    const data = (await res.json().catch(() => ({}))) as T; // tolerate 204 / empty
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "network",
        message: err instanceof Error ? err.message : "Network error",
      },
    };
  }
}

export interface PlayerStats {
  name: string;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
}

export function recordGame(
  player1: string,
  player2: string,
  winner: "player1" | "player2" | "draw",
  gameMode: "local" | "bot" | "online",
  timerDuration?: number
): Promise<Result<{ player1: PlayerStats; player2: PlayerStats }>> {
  return request("/record-game", {
    method: "POST",
    body: JSON.stringify({ player1, player2, winner, gameMode, timerDuration }),
  });
}

export interface LeaderboardResponse {
  players: PlayerStats[];
  currentPlayer: PlayerStats | null;
  currentPlayerRank: number | null;
  tokenConfigs?: Record<string, any>;
}

export async function fetchLeaderboard(
  currentPlayerName?: string,
  limit?: number,
  level?: string
): Promise<Result<LeaderboardResponse>> {
  const params = new URLSearchParams();
  if (currentPlayerName) params.set("player", currentPlayerName.toLowerCase().trim());
  if (limit) params.set("limit", String(limit));
  if (level) params.set("level", level);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const res = await request<LeaderboardResponse>(`/leaderboard${qs}`);
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      players: res.data.players || [],
      currentPlayer: res.data.currentPlayer || null,
      currentPlayerRank: res.data.currentPlayerRank || null,
      tokenConfigs: res.data.tokenConfigs || {},
    },
  };
}

export async function fetchPlayer(name: string): Promise<Result<PlayerStats | null>> {
  const res = await request<{ player?: PlayerStats }>(
    `/player/${encodeURIComponent(name.toLowerCase().trim())}`
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.player || null };
}

// Upload a custom token image
export async function uploadTokenImage(
  playerName: string,
  file: File
): Promise<Result<{ signedUrl: string; filePath: string }>> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("playerName", playerName);
  return request("/upload-token", { method: "POST", body: formData });
}

// Get a player's token image URL
export async function getTokenImageUrl(playerName: string): Promise<Result<string | null>> {
  const res = await request<{ token?: { imageUrl?: string } }>(
    `/token/${encodeURIComponent(playerName.toLowerCase().trim())}`
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.token?.imageUrl || null };
}

// Save a player's token config to the server (for leaderboard persistence)
export function saveTokenConfig(
  playerName: string,
  tokenConfig: any
): Promise<Result<unknown>> {
  return request("/save-token-config", {
    method: "POST",
    body: JSON.stringify({ playerName, tokenConfig }),
  });
}

// ─── Online Multiplayer Room API ───

export interface Room {
  code: string;
  hostName: string;
  guestName: string | null;
  timerDuration: number;
  blastTokens: boolean;
  status: "waiting" | "playing" | "finished";
  createdAt: string;
  joinedAt?: string;
}

export async function createRoom(
  hostName: string,
  timerDuration = 40,
  blastTokens = true
): Promise<Result<Room>> {
  const res = await request<{ room: Room }>("/rooms", {
    method: "POST",
    body: JSON.stringify({ hostName, timerDuration, blastTokens }),
  });
  if (!res.ok) {
    if (res.error.status === 429) {
      return {
        ok: false,
        error: {
          ...res.error,
          message:
            "Server is at capacity — all room slots are full. Please try again in a few minutes.",
        },
      };
    }
    return res;
  }
  return { ok: true, data: res.data.room };
}

export async function joinRoom(code: string, guestName: string): Promise<Result<Room>> {
  const res = await request<{ room: Room }>(
    `/rooms/${encodeURIComponent(code)}/join`,
    { method: "POST", body: JSON.stringify({ guestName }) }
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.room };
}

export async function fetchRoom(code: string): Promise<Result<Room>> {
  const res = await request<{ room: Room }>(`/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) return res;
  return { ok: true, data: res.data.room };
}

// ─── Site Stats ───

export interface SiteStats {
  totalVisits: number;
  totalGamesPlayed: number;
  totalPlayers: number;
  activeRooms: number;
  waitingRooms: number;
  maxRooms: number;
  capacityPercent: number;
}

export function fetchStats(): Promise<Result<SiteStats>> {
  return request("/stats");
}

export async function recordVisit(): Promise<Result<number>> {
  const res = await request<{ totalVisits: number }>("/visit", { method: "POST" });
  if (!res.ok) return res;
  return { ok: true, data: res.data.totalVisits };
}
