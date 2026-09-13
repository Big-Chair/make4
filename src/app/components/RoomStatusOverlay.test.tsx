import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadyRoom, RoomState } from "./room";
import { RoomStatusOverlay, roomNoticeFor } from "./RoomStatusOverlay";

const ROOM: ReadyRoom = {
  code: "ABCD",
  role: "guest",
  timerDuration: 40,
  blastTokens: true,
  participants: {
    red: { name: "Ana", token: { type: "default" } },
    yellow: { name: "Bo", token: { type: "default" } },
  },
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("roomNoticeFor", () => {
  it("has nothing to say about a ready Room", () => {
    expect(roomNoticeFor({ phase: "ready", room: ROOM })).toBeNull();
  });

  it("describes an interruption and a no-contest failure", () => {
    const interrupted: RoomState = {
      phase: "interrupted",
      room: ROOM,
      reason: "peer-left",
      reconnectDeadline: 123,
      resynchronizing: false,
    };
    expect(roomNoticeFor(interrupted)).toEqual({
      kind: "interrupted",
      reason: "peer-left",
      reconnectDeadline: 123,
      resynchronizing: false,
    });
    expect(
      roomNoticeFor({ phase: "failed", error: { kind: "peer-timeout", message: "Gone." }, previousRoom: ROOM }),
    ).toEqual({ kind: "no-contest", message: "Gone." });
  });
});

describe("RoomStatusOverlay", () => {
  it("renders nothing without a notice", () => {
    const { container } = render(<RoomStatusOverlay notice={null} onExit={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("counts down the reconnect deadline while the opponent is away", () => {
    render(
      <RoomStatusOverlay
        notice={{ kind: "interrupted", reason: "peer-left", reconnectDeadline: Date.now() + 20_000, resynchronizing: false }}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText("Opponent disconnected")).toBeTruthy();
    expect(screen.getByText(/20s/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/15s/)).toBeTruthy();
  });

  it("says when this device is the one reconnecting", () => {
    render(
      <RoomStatusOverlay
        notice={{ kind: "interrupted", reason: "channel-lost", reconnectDeadline: Date.now() + 20_000, resynchronizing: false }}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText("Connection lost")).toBeTruthy();
  });

  it("shows resynchronization once both players are back", () => {
    render(
      <RoomStatusOverlay
        notice={{ kind: "interrupted", reason: "peer-left", reconnectDeadline: Date.now() + 20_000, resynchronizing: true }}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText("Syncing the board")).toBeTruthy();
  });

  it("ends a failed Room as no contest with a way out", () => {
    const onExit = vi.fn();
    render(<RoomStatusOverlay notice={{ kind: "no-contest", message: "Your opponent left." }} onExit={onExit} />);

    expect(screen.getByText("No contest")).toBeTruthy();
    expect(screen.getByText("Your opponent left.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /main menu/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
