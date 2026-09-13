/**
 * RoomStatusOverlay — what an online Match shows while its Room is not ready.
 *
 * Interrupted: input and the timer are paused; the overlay says who is missing
 * and how long is left before the Match ends as no contest. Resynchronizing:
 * both players are back and the board is being restored from the host. Failed:
 * the Match is over as no contest — nothing was recorded — and the only way on
 * is out.
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Home, Loader2, WifiOff } from "lucide-react";
import type { InterruptReason, RoomState } from "./room";

export type RoomNotice =
  | { kind: "interrupted"; reason: InterruptReason; reconnectDeadline: number; resynchronizing: boolean }
  | { kind: "no-contest"; message: string };

export function roomNoticeFor(state: RoomState): RoomNotice | null {
  if (state.phase === "interrupted") {
    return {
      kind: "interrupted",
      reason: state.reason,
      reconnectDeadline: state.reconnectDeadline,
      resynchronizing: state.resynchronizing,
    };
  }
  if (state.phase === "failed") return { kind: "no-contest", message: state.error.message };
  return null;
}

function useSecondsUntil(deadline: number | null): number {
  const remaining = () => (deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  const [seconds, setSeconds] = useState(remaining);
  useEffect(() => {
    if (deadline === null) return;
    setSeconds(remaining());
    const interval = setInterval(() => setSeconds(remaining()), 250);
    return () => clearInterval(interval);
    // `remaining` only closes over `deadline`.
  }, [deadline]);
  return seconds;
}

function interruptionCopy(notice: Extract<RoomNotice, { kind: "interrupted" }>) {
  if (notice.resynchronizing) {
    return { title: "Syncing the board", detail: "Both players are back. Restoring the host's board..." };
  }
  if (notice.reason === "channel-lost") {
    return { title: "Connection lost", detail: "Reconnecting to the room..." };
  }
  if (notice.reason === "peer-left") {
    return { title: "Opponent disconnected", detail: "Waiting for them to reconnect..." };
  }
  return { title: "Syncing the board", detail: "The boards disagreed. Restoring the host's board..." };
}

interface RoomStatusOverlayProps {
  notice: RoomNotice | null;
  onExit: () => void;
}

export function RoomStatusOverlay({ notice, onExit }: RoomStatusOverlayProps) {
  const seconds = useSecondsUntil(notice?.kind === "interrupted" ? notice.reconnectDeadline : null);
  if (!notice) return null;

  const noContest = notice.kind === "no-contest";
  const copy = noContest ? { title: "No contest", detail: notice.message } : interruptionCopy(notice);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role={noContest ? "alertdialog" : "status"}
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-g-overlay backdrop-blur-[12px]"
    >
      <div className="rounded-3xl p-6 sm:p-8 text-center mx-4 w-full max-w-[380px] bg-g-surface border border-g-border">
        {noContest ? (
          <WifiOff size={36} className="mx-auto mb-4 text-figma-red" />
        ) : (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            className="mx-auto mb-4 w-fit"
          >
            <Loader2 size={32} className="text-figma-blue" />
          </motion.div>
        )}

        <h2 className="text-2xl text-g-text tracking-tight">{copy.title}</h2>
        <p className="mt-2 text-g-text-muted text-sm">{copy.detail}</p>

        {noContest ? (
          <p className="mt-2 text-g-text-dim text-xs">No result was recorded.</p>
        ) : (
          <p className="mt-4 text-g-text-dim text-sm">
            Match ends as no contest in <span className="font-semibold text-g-text-secondary">{seconds}s</span>
          </p>
        )}

        <button
          type="button"
          onClick={onExit}
          className="mt-6 px-4 py-2.5 rounded-xl cursor-pointer inline-flex items-center justify-center gap-2 text-sm bg-g-surface-faint text-g-text-muted border border-g-border"
        >
          <Home size={14} />
          {noContest ? "Main Menu" : "Leave match"}
        </button>
      </div>
    </motion.div>
  );
}
