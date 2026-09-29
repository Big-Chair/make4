import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronLeft, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import { MusicalNoteIcon, type MusicalNoteIconHandle } from "../../imports/musical-note-icon";

// Curated public playlists rendered through the Spotify embed iframe. There is no
// account link-up: the player never holds a token, so it only plays these.
const DEFAULT_PLAYLISTS = [
  { name: "Chill Vibes", uri: "37i9dQZF1DX4WYpdgoIcn6" },
  { name: "Lo-Fi Beats", uri: "37i9dQZF1DWWQRwui0ExPn" },
  { name: "Deep Focus", uri: "37i9dQZF1DWZeKCadgRdKQ" },
  { name: "Peaceful Piano", uri: "37i9dQZF1DX4sWSpwq3LiO" },
  { name: "Jazz Vibes", uri: "37i9dQZF1DX0SM0LYsmbMT" },
];

type SpotifyPlaylist = (typeof DEFAULT_PLAYLISTS)[number];

export function SpotifyPlayer() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylist>(DEFAULT_PLAYLISTS[0]);
  const [embedActive, setEmbedActive] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Track the URI that the persistent iframe was loaded with
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const playlistRef = useRef<HTMLDivElement>(null);
  const musicIconRef = useRef<MusicalNoteIconHandle>(null);
  const collapsedMusicRef = useRef<MusicalNoteIconHandle>(null);

  const handleToggleDrawer = () => {
    if (!drawerOpen) {
      setEmbedActive(true);
      setActiveUri(selectedPlaylist.uri);
      setDrawerOpen(true);
    } else {
      setDrawerOpen(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    // Keep music playing in mini-bar
  };

  const handleStopMusic = () => {
    setIsOpen(false);
    setEmbedActive(false);
    setActiveUri(null);
    setDrawerOpen(false);
  };

  // Determine UI state
  const showMiniBar = !isOpen && embedActive;
  const showFAB = !isOpen && !embedActive;
  const showPanel = isOpen;
  // The iframe should be user-visible (interactable) when panel is open and drawer is expanded
  const iframeUserVisible = showPanel && drawerOpen && embedActive;

  return (
    <>
      {/* ─── Persistent Spotify Embed Iframe ─── */}
      {embedActive && activeUri && (
        <div
          key={activeUri}
          className="fixed z-[9999]"
          style={
            iframeUserVisible
              ? {
                  bottom: "88px",
                  right: "25px",
                  width: "308px",
                  height: "152px",
                  borderRadius: "12px",
                  overflow: "hidden",
                  pointerEvents: "auto",
                  transition: "all 0.25s ease",
                }
              : {
                  bottom: 0,
                  right: 0,
                  width: 0,
                  height: 0,
                  overflow: "hidden",
                  pointerEvents: "none",
                  opacity: 0,
                  position: "fixed",
                }
          }
        >
          <iframe
            src={`https://open.spotify.com/embed/playlist/${activeUri}?utm_source=generator&theme=0`}
            width="100%"
            height="152"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="rounded-xl"
            style={{ border: "none" }}
          />
        </div>
      )}

      {/* ─── Collapsed Mini-Bar ─── */}
      <AnimatePresence>
        {showMiniBar && (
          <motion.div
            key="mini-bar"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: "spring", damping: 20 }}
            className="fixed bottom-5 right-5 z-40 rounded-2xl flex items-center gap-3 px-4 py-3 cursor-pointer"
            style={{
              background: "#181818",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
              maxWidth: "320px",
            }}
            onClick={() => setIsOpen(true)}
            onMouseEnter={() => collapsedMusicRef.current?.startAnimation()}
            onMouseLeave={() => collapsedMusicRef.current?.stopAnimation()}
          >
            {/* Playing indicator */}
            <div className="flex items-end gap-[2px] h-3 flex-shrink-0">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ height: ["4px", "12px", "4px"] }}
                  transition={{
                    repeat: Infinity,
                    duration: 0.8,
                    delay: i * 0.15,
                    ease: "easeInOut",
                  }}
                  className="w-[2px] rounded-full"
                  style={{ background: "#1DB954" }}
                />
              ))}
            </div>

            <div className="flex-1 min-w-0">
              <span className="truncate block text-sm text-white">{selectedPlaylist.name}</span>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Playing
              </span>
            </div>

            <MusicalNoteIcon ref={collapsedMusicRef} size={18} color="#1DB954" />

            <motion.button
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => {
                e.stopPropagation();
                handleStopMusic();
              }}
              className="w-6 h-6 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.08)", border: "none" }}
            >
              <X size={12} color="rgba(255,255,255,0.5)" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── FAB (no music active) ─── */}
      <AnimatePresence>
        {showFAB && (
          <motion.button
            key="fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 15, delay: 0.5 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            onMouseEnter={() => musicIconRef.current?.startAnimation()}
            onMouseLeave={() => musicIconRef.current?.stopAnimation()}
            className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full flex items-center justify-center cursor-pointer"
            style={{
              background: "#1DB954",
              boxShadow: "0 4px 20px rgba(29,185,84,0.4)",
              border: "none",
            }}
            title="Open Music"
          >
            <MusicalNoteIcon ref={musicIconRef} size={20} color="white" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── Full Expanded Panel ─── */}
      <AnimatePresence>
        {showPanel && (
          <motion.div
            key="panel"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 22 }}
            className="fixed bottom-5 right-5 z-40 rounded-2xl overflow-hidden"
            style={{
              width: "340px",
              background: "#181818",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#1DB954">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                <span className="text-sm text-white">Music</span>
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={handleClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer"
                style={{ background: "rgba(255,255,255,0.06)", border: "none" }}
              >
                <X size={14} color="rgba(255,255,255,0.6)" />
              </motion.button>
            </div>

            {/* Playlist tabs with arrows and drag scroll */}
            <div className="flex items-center gap-1 px-2 pb-3">
              <motion.button
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  if (playlistRef.current) {
                    playlistRef.current.scrollBy({ left: -100, behavior: "smooth" });
                  }
                }}
                className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer"
                style={{ background: "rgba(255,255,255,0.08)", border: "none" }}
              >
                <ChevronLeft size={14} color="rgba(255,255,255,0.6)" />
              </motion.button>

              <div
                ref={playlistRef}
                className="flex gap-2 overflow-x-auto flex-1 cursor-grab active:cursor-grabbing"
                style={{ scrollbarWidth: "none" }}
                onMouseDown={(e) => {
                  const el = playlistRef.current;
                  if (!el) return;
                  const startX = e.pageX;
                  const scrollLeft = el.scrollLeft;
                  let dragged = false;

                  const onMove = (ev: MouseEvent) => {
                    const dx = ev.pageX - startX;
                    if (Math.abs(dx) > 3) dragged = true;
                    el.scrollLeft = scrollLeft - dx;
                  };
                  const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    if (dragged) {
                      const suppress = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
                      el.addEventListener("click", suppress, { capture: true, once: true });
                    }
                  };
                  document.addEventListener("mousemove", onMove);
                  document.addEventListener("mouseup", onUp);
                }}
              >
                {DEFAULT_PLAYLISTS.map((playlist) => (
                  <button
                    key={playlist.uri}
                    onClick={() => {
                      setSelectedPlaylist(playlist);
                      // Reset iframe for new playlist
                      setEmbedActive(false);
                      setActiveUri(null);
                      setDrawerOpen(false);
                    }}
                    className="flex-shrink-0 px-3 py-1.5 rounded-full cursor-pointer whitespace-nowrap select-none flex items-center gap-1.5 text-xs"
                    style={{
                      background:
                        selectedPlaylist.uri === playlist.uri
                          ? "rgba(29,185,84,0.15)"
                          : "rgba(255,255,255,0.05)",
                      border:
                        selectedPlaylist.uri === playlist.uri
                          ? "1px solid rgba(29,185,84,0.4)"
                          : "1px solid rgba(255,255,255,0.06)",
                      color:
                        selectedPlaylist.uri === playlist.uri
                          ? "#1DB954"
                          : "rgba(255,255,255,0.5)",
                      transition: "all 0.15s",
                    }}
                  >
                    {playlist.name}
                  </button>
                ))}
              </div>

              <motion.button
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  if (playlistRef.current) {
                    playlistRef.current.scrollBy({ left: 100, behavior: "smooth" });
                  }
                }}
                className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer"
                style={{ background: "rgba(255,255,255,0.08)", border: "none" }}
              >
                <ChevronRight size={14} color="rgba(255,255,255,0.6)" />
              </motion.button>
            </div>

            {/* Collapsible Mini Player Drawer */}
            <div className="px-4 pb-2">
              <button
                onClick={handleToggleDrawer}
                className="w-full py-2.5 rounded-xl cursor-pointer flex items-center justify-between px-4 text-sm"
                style={{
                  background: drawerOpen ? "rgba(29,185,84,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${drawerOpen ? "rgba(29,185,84,0.2)" : "rgba(255,255,255,0.06)"}`,
                  color: drawerOpen ? "#1DB954" : "rgba(255,255,255,0.4)",
                  transition: "all 0.15s",
                }}
              >
                <span className="flex items-center gap-2">
                  <MusicalNoteIcon size={14} color={drawerOpen ? "#1DB954" : "rgba(255,255,255,0.4)"} />
                  {drawerOpen ? "Hide Mini Player" : "Mini Player"}
                </span>
                <motion.div
                  animate={{ rotate: drawerOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown size={16} color={drawerOpen ? "#1DB954" : "rgba(255,255,255,0.4)"} />
                </motion.div>
              </button>
            </div>

            {/* Drawer spacer — reserves space for the persistent iframe overlay when visible */}
            <AnimatePresence>
              {drawerOpen && embedActive && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 160 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="px-4 pb-2"
                />
              )}
            </AnimatePresence>

            {/* Open in Spotify Web Player */}
            <div className="px-4 py-3">
              <a
                href={`https://open.spotify.com/playlist/${selectedPlaylist.uri}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full no-underline text-sm text-white"
                style={{
                  background: "#1DB954",
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <ExternalLink size={14} color="white" />
                Open in Spotify
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
