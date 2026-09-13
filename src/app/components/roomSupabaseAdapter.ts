/**
 * roomSupabaseAdapter.ts — the production Room Adapter.
 *
 * Translates Supabase specifics (Edge Function routes, Realtime subscription
 * status, Presence sync, broadcast envelopes, channel teardown) into the
 * `RoomAdapter` port. It is the only file in the Room seam that knows Supabase
 * exists; `useRoom` never imports it directly, so tests substitute an in-memory
 * Adapter with no Supabase involved.
 *
 * Payloads are passed through raw — decoding happens in the Room Module against
 * the decoders in `room.ts`.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { createRoom, joinRoom, fetchRoom, type Room as RoomRecord } from "./api";
import type {
  OpenChannelInput,
  RoomAdapter,
  RoomApiResult,
  RoomChannel,
  RoomPresence,
  MatchWireMessage,
} from "./room";
import type { Result } from "./api";

/** One Broadcast event carries every Room/Match message; the decoder discriminates. */
const ROOM_EVENT = "room_message";

const channelName = (code: string) => `make4-room-${code}`;

function toApiResult<T>(res: Result<T>): RoomApiResult<T> {
  if (res.ok) return { ok: true, data: res.data };
  return { ok: false, error: { status: res.error.status, message: res.error.message } };
}

/** A fresh identity. A page reload builds a new Room Module and so a new one,
 *  which is how reload recovery is told apart from same-session reconnect. */
function createClientId(): string {
  const globalCrypto = typeof crypto !== "undefined" ? crypto : undefined;
  return globalCrypto && "randomUUID" in globalCrypto
    ? globalCrypto.randomUUID()
    : `client-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/** Page-session storage survives a reload of this tab, and nothing else. */
const ACTIVE_ROOM_KEY = "make4_active_room";

export const supabaseRoomAdapter: RoomAdapter = {
  async createRoom({ hostName, timerDuration, blastTokens = true }) {
    return toApiResult(await createRoom(hostName, timerDuration, blastTokens));
  },

  async joinRoom({ code, guestName }) {
    return toApiResult(await joinRoom(code, guestName));
  },

  async fetchRoom(code: string) {
    return toApiResult<RoomRecord>(await fetchRoom(code));
  },

  openChannel({ code, clientId, onStatus, onPresence, onMessage }: OpenChannelInput): RoomChannel {
    const channel: RealtimeChannel = supabase.channel(channelName(code), {
      config: { broadcast: { self: false }, presence: { key: clientId } },
    });

    let closed = false;

    channel
      .on("broadcast", { event: ROOM_EVENT }, ({ payload }) => {
        onMessage(payload);
      })
      .on("presence", { event: "sync" }, () => {
        // presenceState() is keyed by presence key; each value is that client's
        // tracked payloads. Flatten to a raw list for the Room Module to decode.
        const state = channel.presenceState<Record<string, unknown>>();
        onPresence(Object.values(state).flat());
      })
      // Realtime rejoins on its own after CHANNEL_ERROR / TIMED_OUT and reports
      // SUBSCRIBED again, which the Room Module treats as a reconnect.
      .subscribe((status, err) => {
        if (closed) return;
        if (status === "SUBSCRIBED") onStatus("subscribed");
        else if (status === "CLOSED") onStatus("closed");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          onStatus("error", err?.message ?? status);
        }
      });

    return {
      async track(payload: RoomPresence) {
        if (closed) return;
        await channel.track(payload);
      },
      async send(message: MatchWireMessage) {
        if (closed) return;
        await channel.send({ type: "broadcast", event: ROOM_EVENT, payload: message });
      },
      async close() {
        if (closed) return;
        closed = true;
        try {
          await channel.untrack();
        } catch {
          /* channel may already be gone */
        }
        await supabase.removeChannel(channel);
      },
    };
  },

  createClientId,

  recallActiveRoom() {
    try {
      return sessionStorage.getItem(ACTIVE_ROOM_KEY);
    } catch {
      return null;
    }
  },

  rememberActiveRoom(code) {
    try {
      if (code) sessionStorage.setItem(ACTIVE_ROOM_KEY, code);
      else sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    } catch {
      /* storage unavailable: reload refusal degrades to a peer timeout */
    }
  },
};
