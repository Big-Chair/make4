import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronLeft, ChevronRight, ChevronDown, Disc3, ExternalLink, Play, Pause, SkipForward, Volume2 } from "lucide-react";
import { fetchSpotifyPlaylists, fetchCurrentlyPlaying } from "./useAuth";
import { MusicalNoteIcon, type MusicalNoteIconHandle } from "../../imports/musical-note-icon";
import type { SpotifySDKState } from "./useSpotifySDK"; // v2

const DEFAULT_PLAYLISTS = [
  { name: "Chill Vibes", uri: "37i9dQZF1DX4WYpdgoIcn6", imageUrl: null },
  { name: "Lo-Fi Beats", uri: "37i9dQZF1DWWQRwui0ExPn", imageUrl: null },
  { name: "Deep Focus", uri: "37i9dQZF1DWZeKCadgRdKQ", imageUrl: null },
  { name: "Peaceful Piano", uri: "37i9dQZF1DX4sWSpwq3LiO", imageUrl: null },
  { name: "Jazz Vibes", uri: "37i9dQZF1DX0SM0LYsmbMT", imageUrl: null },
];

interface SpotifyPlaylist {
  name: string;
  uri: string;
  imageUrl: string | null;
}

interface NowPlaying {
  trackName: string;
  artistName: string;
  albumArt: string | null;
  isPlaying: boolean;
}

interface SpotifyPlayerProps {
  spotifyToken?: string | null;
  sdk?: SpotifySDKState | null;
  volume?: number;
  onVolumeChange?: (v: number) => void;
}

export function SpotifyPlayer({ spotifyToken, sdk, volume = 80, onVolumeChange }: SpotifyPlayerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>(DEFAULT_PLAYLISTS);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylist>(DEFAULT_PLAYLISTS[0]);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [embedActive, setEmbedActive] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  // Track the URI that the persistent iframe was loaded with
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const playlistRef = useRef<HTMLDivElement>(null);
  const nowPlayingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const musicIconRef = useRef<MusicalNoteIconHandle>(null);
  const collapsedMusicRef = useRef<MusicalNoteIconHandle>(null);

  // SDK mode: use the Web Playback SDK for playback + volume control
  const useSDK = !!sdk?.ready;

  // Fetch user playlists when token is available
  useEffect(() => {
    if (!spotifyToken) {
      setPlaylists(DEFAULT_PLAYLISTS);
      setSelectedPlaylist(DEFAULT_PLAYLISTS[0]);
      return;
    }

    setLoadingPlaylists(true);
    fetchSpotifyPlaylists(spotifyToken).then((items) => {
      if (items.length > 0) {
        const mapped: SpotifyPlaylist[] = items.map((p: any) => ({
          name: p.name,
          uri: p.id,
          imageUrl: p.images?.[0]?.url || null,
        }));
        setPlaylists(mapped);
        setSelectedPlaylist(mapped[0]);
      } else {
        setPlaylists(DEFAULT_PLAYLISTS);
        setSelectedPlaylist(DEFAULT_PLAYLISTS[0]);
      }
      setLoadingPlaylists(false);
    });
  }, [spotifyToken]);

  // Poll currently playing when open and token available (non-SDK mode)
  useEffect(() => {
    if (useSDK) return; // SDK handles its own state
    if ((!isOpen && !embedActive) || !spotifyToken) {
      setNowPlaying(null);
      if (nowPlayingInterval.current) clearInterval(nowPlayingInterval.current);
      return;
    }

    const poll = async () => {
      const data = await fetchCurrentlyPlaying(spotifyToken);
      if (data && data.item) {
        setNowPlaying({
          trackName: data.item.name,
          artistName: data.item.artists?.map((a: any) => a.name).join(", ") || "Unknown",
          albumArt: data.item.album?.images?.[0]?.url || null,
          isPlaying: data.is_playing,
        });
      } else {
        setNowPlaying(null);
      }
    };

    poll();
    nowPlayingInterval.current = setInterval(poll, 10000);

    return () => {
      if (nowPlayingInterval.current) clearInterval(nowPlayingInterval.current);
    };
  }, [isOpen, embedActive, spotifyToken, useSDK]);

  // Build nowPlaying from SDK state
  const effectiveNowPlaying: NowPlaying | null = useSDK
    ? sdk.trackName
      ? {
          trackName: sdk.trackName,
          artistName: sdk.artistName || "Unknown",
          albumArt: sdk.albumArt,
          isPlaying: sdk.isPlaying,
        }
      : null
    : nowPlaying;

  // Is music actively playing (either via SDK or iframe)?
  const musicActive = useSDK ? sdk.isPlaying || !!sdk.trackName : embedActive;

  const handleToggleDrawer = () => {
    if (!drawerOpen) {
      if (useSDK) {
        // Start playback via SDK
        sdk.play(selectedPlaylist.uri);
        setDrawerOpen(true);
        setEmbedActive(true);
      } else {
        setEmbedActive(true);
        setActiveUri(selectedPlaylist.uri);
        setDrawerOpen(true);
      }
    } else {
      setDrawerOpen(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    // Keep music playing in mini-bar
  };

  const handleFullClose = () => {
    setIsOpen(false);
    setDrawerOpen(false);
  };

  const handleStopMusic = () => {
    setIsOpen(false);
    if (useSDK) {
      sdk.pause();
    }
    setEmbedActive(false);
    setActiveUri(null);
    setDrawerOpen(false);
  };

  const isUserPlaylist = !!spotifyToken && playlists !== DEFAULT_PLAYLISTS;

  // Determine UI state
  const showMiniBar = !isOpen && musicActive;
  const showFAB = !isOpen && !musicActive;
  const showPanel = isOpen;
  // The iframe should be user-visible (interactable) when panel is open and drawer is expanded
  const iframeUserVisible = showPanel && drawerOpen && embedActive && !useSDK;

  return (
    <>
      {/* ─── Persistent Spotify Embed Iframe (non-SDK fallback) ───
          Only rendered when NOT using SDK. */}
      {!useSDK && embedActive && activeUri && (
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
              <span
                className="truncate block text-sm text-white"
              >
                {useSDK && sdk.trackName ? sdk.trackName : selectedPlaylist.name}
              </span>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                {useSDK && sdk.artistName ? sdk.artistName : "Playing"}
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
                <span className="text-sm text-white">
                  {isUserPlaylist ? "Your Music" : "Music"}
                </span>
                {useSDK && (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-2xs"
                    style={{ background: "rgba(29,185,84,0.15)", color: "#1DB954" }}
                  >
                    SDK
                  </span>
                )}
                {isUserPlaylist && !useSDK && (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-2xs"
                    style={{ background: "rgba(29,185,84,0.15)", color: "#1DB954" }}
                  >
                    Connected
                  </span>
                )}
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

            {/* Now Playing (SDK or polled) */}
            <AnimatePresence>
              {effectiveNowPlaying && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-4 pb-3"
                >
                  <div
                    className="flex items-center gap-3 p-2.5 rounded-xl"
                    style={{
                      background: "rgba(29,185,84,0.06)",
                      border: "1px solid rgba(29,185,84,0.15)",
                    }}
                  >
                    {effectiveNowPlaying.albumArt ? (
                      <img
                        src={effectiveNowPlaying.albumArt}
                        alt="Album"
                        className="w-10 h-10 rounded-lg flex-shrink-0 object-cover"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center"
                        style={{ background: "rgba(29,185,84,0.15)" }}
                      >
                        <Disc3 size={18} color="#1DB954" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {effectiveNowPlaying.isPlaying && (
                          <div className="flex items-end gap-[2px] h-3">
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
                        )}
                        <span
                          className="truncate block text-xs"
                          style={{ color: "white", maxWidth: "180px" }}
                        >
                          {effectiveNowPlaying.trackName}
                        </span>
                      </div>
                      <span
                        className="truncate block text-xs"
                        style={{ color: "rgba(255,255,255,0.4)", maxWidth: "180px" }}
                      >
                        {effectiveNowPlaying.artistName}
                      </span>
                    </div>

                    {/* SDK playback controls */}
                    {useSDK && (
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => sdk.togglePlay()}
                        className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0"
                        style={{ background: "#1DB954", border: "none" }}
                      >
                        {sdk.isPlaying ? (
                          <Pause size={14} color="white" fill="white" />
                        ) : (
                          <Play size={14} color="white" fill="white" />
                        )}
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* SDK Volume slider — inside the panel */}
            {useSDK && musicActive && (
              <div className="px-4 pb-3">
                <div
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <Volume2 size={14} color="rgba(255,255,255,1)" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      onVolumeChange?.(v);
                      sdk.setVolume(v);
                    }}
                    className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                    style={{
                      accentColor: "#1DB954",
                      background: `linear-gradient(to right, #1DB954 ${volume}%, rgba(255,255,255,0.1) ${volume}%)`,
                      outline: "none",
                      border: "none",
                    }}
                  />
                  <span className="text-xs tabular-nums text-white" style={{ minWidth: "28px", textAlign: "right" }}>
                    {volume}%
                  </span>
                </div>
              </div>
            )}

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
                {loadingPlaylists ? (
                  <div className="flex items-center justify-center w-full py-1">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="w-4 h-4 rounded-full border-2 border-t-transparent"
                      style={{ borderColor: "rgba(29,185,84,0.3)", borderTopColor: "transparent" }}
                    />
                  </div>
                ) : (
                  playlists.map((playlist) => (
                    <button
                      key={playlist.uri}
                      onClick={() => {
                        setSelectedPlaylist(playlist);
                        if (useSDK) {
                          // Switch playlist via SDK
                          sdk.play(playlist.uri);
                        } else {
                          // Reset iframe for new playlist
                          setEmbedActive(false);
                          setActiveUri(null);
                          setDrawerOpen(false);
                        }
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
                      {playlist.imageUrl && (
                        <img src={playlist.imageUrl} alt="" className="w-4 h-4 rounded-sm object-cover" />
                      )}
                      {playlist.name}
                    </button>
                  ))
                )}
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

            {/* Collapsible Mini Player Drawer — only for non-SDK mode */}
            {!useSDK && (
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
            )}

            {/* SDK Play button — when SDK ready but not yet playing */}
            {useSDK && !musicActive && (
              <div className="px-4 pb-2">
                <button
                  onClick={() => {
                    sdk.play(selectedPlaylist.uri);
                    setEmbedActive(true);
                  }}
                  className="w-full py-2.5 rounded-xl cursor-pointer flex items-center justify-center gap-2 px-4 text-sm"
                  style={{
                    background: "rgba(29,185,84,0.1)",
                    border: "1px solid rgba(29,185,84,0.2)",
                    color: "#1DB954",
                    transition: "all 0.15s",
                  }}
                >
                  <Play size={14} fill="#1DB954" />
                  Play with Volume Control
                </button>
              </div>
            )}

            {/* Drawer spacer — reserves space for the persistent iframe overlay when visible */}
            {!useSDK && (
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
            )}

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