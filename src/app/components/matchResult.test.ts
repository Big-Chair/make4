import { describe, expect, it } from "vitest";
import type { ReadyRoom, Role, RoomState } from "./room";
import { persistsMatchResult } from "./matchResult";

function readyRoom(role: Role): ReadyRoom {
  return {
    code: "ABCD",
    role,
    timerDuration: 40,
    blastTokens: true,
    participants: {
      red: { name: "Ana", token: { type: "default" } },
      yellow: { name: "Bo", token: { type: "default" } },
    },
  };
}

const IDLE: RoomState = { phase: "idle" };

describe("persistsMatchResult", () => {
  it("persists a timed local or bot Match, never an untimed one", () => {
    expect(persistsMatchResult({ gameMode: "local", timerDuration: 40, room: IDLE })).toBe(true);
    expect(persistsMatchResult({ gameMode: "bot", timerDuration: 30, room: IDLE })).toBe(true);
    expect(persistsMatchResult({ gameMode: "local", timerDuration: 0, room: IDLE })).toBe(false);
  });

  it("persists an online result only from the host of a live Room", () => {
    const host = readyRoom("host");
    const guest = readyRoom("guest");
    expect(persistsMatchResult({ gameMode: "online", timerDuration: 40, room: { phase: "ready", room: host } })).toBe(true);
    expect(
      persistsMatchResult({
        gameMode: "online",
        timerDuration: 40,
        room: { phase: "interrupted", room: host, reason: "revision-gap", reconnectDeadline: 0, resynchronizing: true },
      }),
    ).toBe(true);
    expect(persistsMatchResult({ gameMode: "online", timerDuration: 40, room: { phase: "ready", room: guest } })).toBe(false);
  });

  it("never persists a no-contest Room", () => {
    const failed: RoomState = {
      phase: "failed",
      error: { kind: "peer-timeout", message: "gone" },
      previousRoom: readyRoom("host"),
    };
    expect(persistsMatchResult({ gameMode: "online", timerDuration: 40, room: failed })).toBe(false);
    expect(persistsMatchResult({ gameMode: "online", timerDuration: 40, room: IDLE })).toBe(false);
  });
});
