/**
 * OnlineLobby renders the Room's lobby projection and issues its commands. These
 * tests drive the create settings (timer and Blast tokens) and the open Room's
 * rules; the Room Module itself is covered in `useRoom.test.tsx`.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnlineLobby } from "./OnlineLobby";
import { projectLobby, type RoomLobby } from "./room";

const IDLE_LOBBY = projectLobby({ phase: "idle" });

function renderLobby(lobby: RoomLobby = IDLE_LOBBY) {
  const onCreate = vi.fn(async () => {});
  render(
    <OnlineLobby
      lobby={lobby}
      onCreate={onCreate}
      onJoin={vi.fn(async () => {})}
      onLeave={vi.fn(async () => {})}
      onTokenChange={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  return { onCreate };
}

afterEach(() => cleanup());

describe("OnlineLobby create settings", () => {
  it("creates a 40s Room with Blast tokens by default", () => {
    const { onCreate } = renderLobby();
    fireEvent.click(screen.getByRole("button", { name: /create room/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ timerDuration: 40, blastTokens: true }));
  });

  it("creates the Room with the host's timer and Blast-token choice", () => {
    const { onCreate } = renderLobby();
    fireEvent.click(screen.getByRole("switch", { name: /turn timer/i }));
    fireEvent.click(screen.getByRole("switch", { name: /blast tokens/i }));
    expect(screen.getByText("No Timer")).toBeTruthy();
    expect(screen.getByText("No Blasts")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /create room/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ timerDuration: 0, blastTokens: false }));
  });
});

describe("OnlineLobby open Room", () => {
  it("shows the open Room's persisted rules", () => {
    renderLobby({
      ...IDLE_LOBBY,
      openRoom: { code: "ABCD", synchronizing: false, timerDuration: 0, blastTokens: false },
    });
    expect(screen.getByText("No timer · No Blast tokens")).toBeTruthy();
  });
});
