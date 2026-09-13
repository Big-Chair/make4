import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, X, Copy, Check, Wifi, WifiOff, Clock, Activity, AlertTriangle, ChevronDown, Mail, MessageSquare, Link2, Gamepad2, QrCode, Smartphone } from "lucide-react";
import { ArrowRightIcon, type ArrowRightIconHandle } from "../../imports/arrow-right-icon";
import { UserIcon, type UserIconHandle } from "../../imports/user-icon";
import { UsersIcon, type UsersIconHandle } from "../../imports/users-icon";
import { PencilIcon, type PencilIconHandle } from "../../imports/pencil-icon";
import { FigmaLogo, GridDots, DiamondShape, CrossShape } from "./FigmaDecorations";
import Make4Logo from "../../imports/Make4Logo";
import { TokenCustomizer } from "./TokenCustomizer";
import { type TokenConfig, DEFAULT_TOKEN_RED, getTokenVisuals, getSlotToken, save as saveToken } from "./tokens";
import { colorFor, type Role } from "./room";
import type { UseRoomReturn } from "./useRoom";
import type { SiteStats } from "./api";
import { QRCodeSVG } from "qrcode.react";
import { g } from "./ThemeContext";

interface OnlineLobbyProps {
  /** The owning Room Module. The lobby renders its state and issues its commands. */
  room: UseRoomReturn;
  initialRoomCode?: string | null;
  siteStats?: SiteStats | null;
  onBack: () => void;
}

type LobbyView = "choose" | "join" | "waiting";

export function OnlineLobby({ room, initialRoomCode, siteStats, onBack }: OnlineLobbyProps) {
  // If we have an initial room code from a shared link, start in "join" view
  const [view, setView] = useState<LobbyView>(initialRoomCode ? "join" : "choose");
  const [playerName, setPlayerName] = useState(() => {
    try { return localStorage.getItem("make4_p1Name") || ""; } catch { return ""; }
  });
  const [joinCode, setJoinCode] = useState(initialRoomCode || "");
  const [copied, setCopied] = useState(false);
  const [playerToken, setPlayerToken] = useState<TokenConfig>(() => getSlotToken("p1") ?? DEFAULT_TOKEN_RED);
  const [customizingToken, setCustomizingToken] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  const arrowRef = useRef<ArrowRightIconHandle>(null);
  const pencilRef = useRef<PencilIconHandle>(null);

  // ── Everything below is rendered from Room state ──
  // No readiness effect, no startup delay, no Role-to-player assembly: the Room
  // Module decides when a Ready Room exists and App starts the Match from it.
  const state = room.state;
  const phase = state.phase;
  const roomRecord =
    state.phase === "waiting" || state.phase === "synchronizing" ? state.room : null;
  const roomError = state.phase === "failed" ? state.error.message : null;
  const localRole: Role | null =
    state.phase === "synchronizing"
      ? state.role
      : state.phase === "ready"
        ? state.room.role
        : null;
  const localColor = localRole ? colorFor(localRole) : "red";
  // A live Room (waiting for a guest, or synchronizing into a Ready Room) owns the view.
  const effectiveView: LobbyView = roomRecord ? "waiting" : view;

  const rememberName = (name: string) => {
    try { localStorage.setItem("make4_p1Name", name); } catch { /* ignore */ }
  };

  const handleCreateRoom = async () => {
    const name = playerName.trim() || "Player 1";
    rememberName(name);
    await room.create({ hostName: name, timerDuration: 40, token: playerToken });
  };

  const handleJoinRoom = async () => {
    const name = playerName.trim() || "Player 2";
    rememberName(name);
    await room.join({ code: joinCode, guestName: name, token: playerToken });
  };

  const copyLink = () => {
    if (!roomRecord) return;
    const link = `${window.location.origin}${window.location.pathname}?room=${roomRecord.code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const copyCode = () => {
    if (!roomRecord) return;
    navigator.clipboard.writeText(roomRecord.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const tv = getTokenVisuals(playerToken, localColor);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden py-6 sm:py-8 bg-g-bg">
      {/* Background grid */}
      <div
        className="absolute inset-0"
        style={{
          opacity: "var(--g-grid-opacity)",
          backgroundImage: `linear-gradient(var(--g-grid-dot) 1px, transparent 1px),
                            linear-gradient(90deg, var(--g-grid-dot) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />

      {/* Floating decorations */}
      <motion.div
        animate={{ y: [0, -15, 0], rotate: [0, 5, 0] }}
        transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
        className="absolute top-[10%] left-[8%] hidden md:block"
      >
        <GridDots />
      </motion.div>
      <motion.div
        animate={{ y: [0, 10, 0] }}
        transition={{ repeat: Infinity, duration: 5, delay: 1 }}
        className="absolute top-[20%] right-[10%] hidden md:block"
      >
        <DiamondShape color="#1ABCFE" />
      </motion.div>

      {/* Glow effects */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(31,30,31,1) 0%, rgba(31,30,31,0) 100%)" }}
      />

      {/* Main Content */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 text-center px-6 max-w-md w-full"
      >
        {/* Logo */}
        <div className="flex justify-center mb-4">
          <div className="w-[clamp(140px,35vw,200px)] aspect-[208.586/48.7687]">
            <Make4Logo />
          </div>
        </div>

        {/* Online badge */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <Wifi size={14} className="text-figma-blue" />
          <span className="text-figma-blue text-sm tracking-[2px] uppercase">
            Invite & Play
          </span>
        </div>

        {/* Back button */}
        <button
          onClick={() => { void room.leave(); onBack(); }}
          className="absolute top-0 left-6 cursor-pointer px-3 py-1.5 rounded-lg text-sm bg-g-surface border border-g-border text-g-text-muted"
        >
          Back
        </button>

        {/* ─── Choose: Create or Join ─── */}
        <AnimatePresence mode="wait">
          {effectiveView === "choose" && (
            <motion.div
              key="choose"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-4"
            >
              {/* Player name input */}
              <div className="flex items-center gap-3 mb-2">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setCustomizingToken(true)}
                  onMouseEnter={() => pencilRef.current?.startAnimation()}
                  onMouseLeave={() => pencilRef.current?.stopAnimation()}
                  className="w-10 h-10 rounded-full flex-shrink-0 relative overflow-hidden cursor-pointer group"
                  style={{
                    background: tv.bg,
                    border: `2px solid ${tv.highlight}`,
                  }}
                  title="Customize token"
                >
                  {playerToken.type === "image" && playerToken.imageUrl && (
                    <img src={playerToken.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full" />
                  )}
                  {playerToken.emoji && (
                    <span className="absolute inset-0 flex items-center justify-center text-base" style={{ textShadow: playerToken.type === "image" ? "0 1px 3px rgba(0,0,0,0.7)" : "none" }}>{playerToken.emoji}</span>
                  )}
                  <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all">
                    <PencilIcon ref={pencilRef} size={12} color="white" strokeWidth={2} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.button>
                <input
                  type="text"
                  placeholder="Your name"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  maxLength={20}
                  className="flex-1 rounded-xl px-4 py-3 outline-none bg-g-input-bg border border-g-input-border text-g-input-text text-base"
                />
              </div>

              {/* Create Room */}
              <motion.button
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCreateRoom}
                disabled={phase === "creating"}
                className="w-full py-4 rounded-2xl cursor-pointer flex items-center justify-center gap-3 text-white text-base font-semibold border-none"
                style={{
                  background: "linear-gradient(135deg, #1ABCFE, #0E9BD8)",
                  boxShadow: "0 4px 30px rgba(26,188,254,0.3)",
                  opacity: phase === "creating" ? 0.7 : 1,
                }}
              >
                {phase === "creating" ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    Create Room
                    <span className="text-xl">+</span>
                  </>
                )}
              </motion.button>

              {/* Room expiry note */}
              <div className="flex items-center justify-center gap-1.5">
                <Clock size={11} color={g.textGhost} />
                <span className="text-g-text-ghost text-xs">
                  Rooms expire after 30 minutes of inactivity
                </span>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-4 my-1">
                <div className="flex-1 h-px bg-g-border-light" />
                <span className="text-g-text-dim text-sm">or</span>
                <div className="flex-1 h-px bg-g-border-light" />
              </div>

              {/* Join Room */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter room code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                  maxLength={6}
                  onKeyDown={(e) => e.key === "Enter" && joinCode.length === 6 && handleJoinRoom()}
                  className="flex-1 rounded-xl px-4 py-3 outline-none text-center tracking-[4px] uppercase bg-g-input-bg border border-g-input-border text-g-input-text text-lg font-semibold font-mono"
                />
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleJoinRoom}
                  onMouseEnter={() => arrowRef.current?.startAnimation()}
                  onMouseLeave={() => arrowRef.current?.stopAnimation()}
                  disabled={joinCode.length < 4 || phase === "joining"}
                  className="px-5 py-3 rounded-xl cursor-pointer flex items-center gap-2 text-base font-medium"
                  style={{
                    background: joinCode.length >= 4 ? g.surfaceHover : g.surfaceFaint,
                    border: joinCode.length >= 4 ? `1px solid ${g.borderHover}` : `1px solid ${g.borderLight}`,
                    color: joinCode.length >= 4 ? g.text : g.textDim,
                    opacity: phase === "joining" ? 0.7 : 1,
                  }}
                >
                  {phase === "joining" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      Join
                      <ArrowRightIcon ref={arrowRef} size={14} />
                    </>
                  )}
                </motion.button>
              </div>

              {/* Error display */}
              {roomError && (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-figma-red text-sm"
                >
                  {roomError}
                </motion.p>
              )}

              {/* ─── How it works ─── */}
              <button
                onClick={() => setShowHowToPlay(!showHowToPlay)}
                className="mt-2 mx-auto flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg transition-all text-base font-medium text-g-text-secondary"
                style={{
                  background: showHowToPlay ? g.surfaceHover : g.surface,
                  border: `1px solid ${g.borderHover}`,
                }}
              >
                <Wifi size={14} color={g.textMuted} />
                How it works
                <motion.div
                  animate={{ rotate: showHowToPlay ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown size={15} color={g.textMuted} />
                </motion.div>
              </button>

              <AnimatePresence>
                {showHowToPlay && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="mt-1 rounded-xl text-left flex flex-col gap-0 px-5 py-5 bg-g-surface-faint border border-g-border">
                      {/* Step 1 */}
                      <div className="flex items-start gap-3.5">
                        <div className="step-badge bg-figma-blue/15 border border-figma-blue/30">
                          <span className="text-figma-blue">1</span>
                        </div>
                        <div>
                          <strong className="step-title">Create a Room</strong>
                          <p className="step-desc">
                            Enter your name and hit <span className="text-figma-blue font-medium">Create Room</span>. You'll get a unique 6-character room code and a shareable link.
                          </p>
                        </div>
                      </div>

                      <div className="ml-3.5 my-2 w-px h-4 bg-figma-blue/20" />

                      {/* Step 2 */}
                      <div className="flex items-start gap-3.5">
                        <div className="step-badge bg-figma-green/15 border border-figma-green/30">
                          <span className="text-figma-green">2</span>
                        </div>
                        <div>
                          <strong className="step-title">Share with a Friend</strong>
                          <p className="step-desc">
                            Send the invite link or room code to your friend however you like:
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className="share-chip">
                              <Mail size={11} /> Email
                            </span>
                            <span className="share-chip">
                              <MessageSquare size={11} /> Text / DM
                            </span>
                            <span className="share-chip">
                              <Link2 size={11} /> Paste Link
                            </span>
                            <span className="inline-flex sm:hidden items-center gap-1.5 px-2.5 py-1 rounded-lg bg-figma-blue/10 border border-figma-blue/25 text-figma-blue text-xs">
                              <QrCode size={11} /> QR Code
                            </span>
                          </div>
                          {/* Mobile-only QR hint */}
                          <p className="block sm:hidden mt-2 text-figma-blue/50 text-xs leading-[1.5]">
                            <Smartphone size={10} className="inline mr-1 align-[-1px]" />
                            On mobile? A scannable QR code appears in the waiting room!
                          </p>
                        </div>
                      </div>

                      <div className="ml-3.5 my-2 w-px h-4 bg-figma-purple/20" />

                      {/* Step 3 */}
                      <div className="flex items-start gap-3.5">
                        <div className="step-badge bg-figma-purple/15 border border-figma-purple/30">
                          <span className="text-figma-purple">3</span>
                        </div>
                        <div>
                          <strong className="step-title">They Click & Join</strong>
                          <p className="step-desc">
                            Your friend opens the link (auto-joins!) or enters the code here. Once they join, the game starts instantly.
                          </p>
                        </div>
                      </div>

                      <div className="ml-3.5 my-2 w-px h-4 bg-figma-yellow/20" />

                      {/* Step 4 */}
                      <div className="flex items-start gap-3.5">
                        <div className="step-badge bg-figma-yellow/15 border border-figma-yellow/30">
                          <span className="text-figma-yellow">4</span>
                        </div>
                        <div>
                          <strong className="step-title">Play!</strong>
                          <p className="step-desc">
                            Host plays as <span className="text-figma-red font-medium">Red</span>, guest as <span className="text-figma-yellow font-medium">Yellow</span>. Moves sync in real-time — including Blast Tokens!
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ─── Join via shared link ─── */}
          {effectiveView === "join" && (
            <motion.div
              key="join"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-5"
            >
              {/* Invitation message */}
              <div className="rounded-2xl p-5 bg-figma-blue/[0.06] border border-figma-blue/20">
                <p className="text-g-text-muted text-base mb-2">
                  You've been invited to play!
                </p>
                <div className="flex items-center justify-center gap-2">
                  <span className="label-caps-sm" style={{ color: g.textDim }}>Room</span>
                  <span className="text-2xl font-bold text-figma-blue font-mono tracking-[6px]">
                    {joinCode}
                  </span>
                </div>
              </div>

              {/* Name input */}
              <div className="flex items-center gap-3">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setCustomizingToken(true)}
                  onMouseEnter={() => pencilRef.current?.startAnimation()}
                  onMouseLeave={() => pencilRef.current?.stopAnimation()}
                  className="w-10 h-10 rounded-full flex-shrink-0 relative overflow-hidden cursor-pointer group"
                  style={{
                    background: tv.bg,
                    border: `2px solid ${tv.highlight}`,
                  }}
                  title="Customize token"
                >
                  {playerToken.type === "image" && playerToken.imageUrl && (
                    <img src={playerToken.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full" />
                  )}
                  {playerToken.emoji && (
                    <span className="absolute inset-0 flex items-center justify-center text-base" style={{ textShadow: playerToken.type === "image" ? "0 1px 3px rgba(0,0,0,0.7)" : "none" }}>{playerToken.emoji}</span>
                  )}
                  <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all">
                    <PencilIcon ref={pencilRef} size={12} color="white" strokeWidth={2} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.button>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  maxLength={20}
                  onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                  className="flex-1 rounded-xl px-4 py-3 outline-none bg-g-input-bg border border-g-input-border text-g-input-text text-base"
                  autoFocus
                />
              </div>

              {/* Join button */}
              <motion.button
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleJoinRoom}
                onMouseEnter={() => arrowRef.current?.startAnimation()}
                onMouseLeave={() => arrowRef.current?.stopAnimation()}
                disabled={phase === "joining"}
                className="w-full py-4 rounded-2xl cursor-pointer flex items-center justify-center gap-3 text-white text-base font-semibold border-none"
                style={{
                  background: "linear-gradient(135deg, #0ACF83, #07A868)",
                  boxShadow: "0 4px 30px rgba(10,207,131,0.3)",
                  opacity: phase === "joining" ? 0.7 : 1,
                }}
              >
                {phase === "joining" ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    Join Game
                    <ArrowRightIcon ref={arrowRef} size={16} />
                  </>
                )}
              </motion.button>

              {/* Error display */}
              {roomError && (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-figma-red text-sm"
                >
                  {roomError}
                </motion.p>
              )}

              {/* Or enter a different code */}
              <button
                onClick={() => { setJoinCode(""); setView("choose"); }}
                className="cursor-pointer text-g-text-dim text-sm"
              >
                Enter a different code or create a room
              </button>
            </motion.div>
          )}

          {/* ─── Waiting for opponent ─── */}
          {effectiveView === "waiting" && roomRecord && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col items-center gap-6"
            >
              {/* Room code display */}
              <div className="rounded-2xl p-6 w-full bg-g-surface-faint border border-figma-blue/20">
                <p className="label-caps mb-3" style={{ color: g.textFaint }}>
                  Room Code
                </p>

                <div className="flex items-center justify-center gap-3 mb-4">
                  <span
                    className="tracking-[8px] select-all text-4xl font-bold text-figma-blue font-mono"
                    style={{ textShadow: "0 0 20px rgba(26,188,254,0.3)" }}
                  >
                    {roomRecord.code}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={copyCode}
                    className="px-4 py-2 rounded-lg cursor-pointer flex items-center gap-2 text-sm bg-g-surface border border-g-input-border text-g-text-muted"
                  >
                    {copied ? <Check size={14} className="text-figma-green" /> : <Copy size={14} />}
                    {copied ? "Copied!" : "Copy Code"}
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={copyLink}
                    className="px-4 py-2 rounded-lg cursor-pointer flex items-center gap-2 text-sm bg-figma-blue/10 border border-figma-blue/25 text-figma-blue"
                  >
                    {copied ? <Check size={14} className="text-figma-green" /> : <Copy size={14} />}
                    {copied ? "Copied!" : "Copy Link"}
                  </motion.button>
                </div>

                {/* Mobile-only QR Code */}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="block sm:hidden mt-4"
                >
                  <div className="flex items-center justify-center gap-1.5 mb-3">
                    <QrCode size={12} color={g.textFaint} />
                    <span className="label-caps-sm" style={{ color: g.textFaint, letterSpacing: "1.5px" }}>
                      Scan to Join
                    </span>
                  </div>
                  <div
                    className="mx-auto rounded-xl p-3 inline-flex"
                    style={{
                      background: "white",
                      boxShadow: `0 0 30px rgba(26,188,254,0.15), 0 4px 20px ${g.shadowMd}`,
                    }}
                  >
                    <QRCodeSVG
                      value={`${window.location.origin}${window.location.pathname}?room=${roomRecord.code}`}
                      size={140}
                      level="M"
                      bgColor="white"
                      fgColor="#1E1E1E"
                      style={{ display: "block" }}
                    />
                  </div>
                  <p className="mt-2 text-g-text-dim text-xs">
                    Your friend can scan this with their camera
                  </p>
                </motion.div>

                {/* Room expiry note */}
                <div className="flex items-center justify-center gap-1.5 mt-3">
                  <Clock size={11} color={g.textGhost} />
                  <span className="text-g-text-ghost text-xs">
                    Rooms expire after 30 minutes of inactivity
                  </span>
                </div>
              </div>

              {/* Waiting indicator */}
              <div className="flex flex-col items-center gap-3">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                >
                  <Loader2 size={24} className="text-figma-blue" />
                </motion.div>
                <p className="text-g-text-muted text-base">
                  {phase === "synchronizing"
                    ? "Getting the board ready..."
                    : "Waiting for opponent to join..."}
                </p>
                <p className="text-g-text-dim text-sm">
                  {phase === "synchronizing"
                    ? "Both players are connecting to the room"
                    : "Share the room code or link with your friend"}
                </p>
              </div>

              {/* Animated dots */}
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
                    transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.3 }}
                    className="w-2 h-2 rounded-full bg-figma-blue"
                  />
                ))}
              </div>

              {/* Connected indicator */}
              {phase === "synchronizing" && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-figma-green/10 border border-figma-green/30"
                >
                  <div className="w-2 h-2 rounded-full bg-figma-green shadow-[0_0_8px_#0ACF83]" />
                  <span className="text-figma-green text-sm font-medium">
                    Opponent connected! Starting match...
                  </span>
                </motion.div>
              )}

              {/* Cancel button */}
              <button
                onClick={() => { void room.leave(); setView("choose"); }}
                className="cursor-pointer px-4 py-2 rounded-lg text-sm bg-g-surface-faint border border-g-border-light text-g-text-faint"
              >
                Cancel
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Live Stats Ticker ─── */}
        {siteStats && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="mt-8"
          >
            <div className="rounded-2xl px-5 py-4 bg-g-surface-faint border border-g-border-subtle">
              <div className="flex items-center gap-2 mb-3">
                <Activity size={13} color={g.textFaint} />
                <span className="label-caps" style={{ color: g.textFaint }}>
                  Live Stats
                </span>
                <div className="w-1.5 h-1.5 rounded-full ml-1 animate-pulse bg-figma-green shadow-[0_0_6px_#0ACF83]" />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex flex-col items-center gap-1 py-2 rounded-xl bg-g-surface-subtle">
                  <span className="stat-value text-figma-blue">
                    {siteStats.totalVisits.toLocaleString()}
                  </span>
                  <span className="label-caps-sm">Visits</span>
                </div>
                <div className="flex flex-col items-center gap-1 py-2 rounded-xl bg-g-surface-subtle">
                  <span className="stat-value text-figma-purple">
                    {siteStats.totalGamesPlayed.toLocaleString()}
                  </span>
                  <span className="label-caps-sm">Games Played</span>
                </div>
                <div className="flex flex-col items-center gap-1 py-2 rounded-xl bg-g-surface-subtle">
                  <span className="stat-value text-figma-green">
                    {siteStats.totalPlayers.toLocaleString()}
                  </span>
                  <span className="label-caps-sm">Players</span>
                </div>
                <div className="flex flex-col items-center gap-1 py-2 rounded-xl bg-g-surface-subtle">
                  <span className="stat-value" style={{ color: siteStats.capacityPercent >= 80 ? "#F24E1E" : "#FFBF00" }}>
                    {siteStats.activeRooms}/{siteStats.maxRooms}
                  </span>
                  <span className="label-caps-sm">Active Rooms</span>
                </div>
              </div>

              {/* Capacity alert */}
              {siteStats.capacityPercent >= 80 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg"
                  style={{
                    background: siteStats.capacityPercent >= 100 ? "rgba(242,78,30,0.1)" : "rgba(255,191,0,0.08)",
                    border: siteStats.capacityPercent >= 100 ? "1px solid rgba(242,78,30,0.3)" : "1px solid rgba(255,191,0,0.2)",
                  }}
                >
                  <AlertTriangle size={13} color={siteStats.capacityPercent >= 100 ? "#F24E1E" : "#FFBF00"} />
                  <span className="text-xs" style={{ color: siteStats.capacityPercent >= 100 ? "#F24E1E" : "#FFBF00" }}>
                    {siteStats.capacityPercent >= 100
                      ? "All rooms are full! Try again shortly \u2014 rooms expire after 30 minutes."
                      : "Server getting busy \u2014 room slots filling up. Jump in soon!"
                    }
                  </span>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {/* Powered by Figma Make */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 flex items-center justify-center gap-2.5"
        >
          <span className="text-g-text-dim text-sm">Powered by</span>
          <FigmaLogo size={16} />
          <span className="text-g-text-faint text-sm font-semibold">Figma Make</span>
        </motion.div>
      </motion.div>

      {/* Token Customizer Modal */}
      <TokenCustomizer
        isOpen={customizingToken}
        onClose={() => setCustomizingToken(false)}
        playerColor={localColor}
        playerName={playerName.trim() || "Player 1"}
        currentConfig={playerToken}
        onSave={(config) => {
          setPlayerToken(config);
          // Lobby edits stay local-only (no server sync) to preserve prior behavior
          saveToken(playerName, config, { slot: "p1", toServer: false });
          // Cosmetic, non-blocking: the Room broadcasts and reconciles it.
          room.updateLocalToken(config);
        }}
      />
    </div>
  );
}