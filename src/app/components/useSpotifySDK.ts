/**
 * useSpotifySDK — Spotify Web Playback SDK integration
 *
 * Creates a real in-browser Spotify player ("Make 4") that we fully control,
 * including volume. Requires Premium + `streaming` scope.
 *
 * When the SDK isn't available (no token / free account), returns `ready: false`
 * so the caller can fall back to the iframe embed.
 *
 * @version 2
 */
import { useState, useEffect, useRef, useCallback } from "react";

// Spotify SDK global types
declare global {
  interface Window {
    Spotify: {
      Player: new (opts: {
        name: string;
        getOAuthToken: (cb: (t: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

interface SpotifyPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (...args: any[]) => void) => void;
  removeListener: (event: string) => void;
  setVolume: (v: number) => Promise<void>;
  getVolume: () => Promise<number>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  getCurrentState: () => Promise<any | null>;
  _options: { id: string };
}

export interface SpotifySDKState {
  ready: boolean;
  deviceId: string | null;
  isPlaying: boolean;
  trackName: string | null;
  artistName: string | null;
  albumArt: string | null;
  durationMs: number;
  positionMs: number;
  volume: number; // 0-100
  error: string | null;
  setVolume: (v: number) => void;
  play: (contextUri: string) => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  disconnect: () => void;
}

const SDK_SCRIPT_ID = "spotify-web-playback-sdk";

function loadSDKScript(): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById(SDK_SCRIPT_ID)) {
      // Already loaded
      if (window.Spotify) {
        resolve();
      } else {
        // Script tag exists but SDK not ready yet — wait for callback
        const prev = window.onSpotifyWebPlaybackSDKReady;
        window.onSpotifyWebPlaybackSDKReady = () => {
          prev?.();
          resolve();
        };
      }
      return;
    }
    const script = document.createElement("script");
    script.id = SDK_SCRIPT_ID;
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    document.body.appendChild(script);
  });
}

export function useSpotifySDK(token: string | null, initialVolume = 80): SpotifySDKState {
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [artistName, setArtistName] = useState<string | null>(null);
  const [albumArt, setAlbumArt] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [volume, setVolumeState] = useState(initialVolume);

  const playerRef = useRef<SpotifyPlayer | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Initialize SDK + player
  useEffect(() => {
    if (!token) {
      setReady(false);
      setDeviceId(null);
      return;
    }

    let cancelled = false;
    let player: SpotifyPlayer | null = null;

    (async () => {
      try {
        await loadSDKScript();
        if (cancelled) return;

        player = new window.Spotify.Player({
          name: "Make 4",
          getOAuthToken: (cb) => {
            cb(tokenRef.current || "");
          },
          volume: initialVolume / 100,
        });

        player.addListener("ready", ({ device_id }: { device_id: string }) => {
          if (cancelled) return;
          console.log("[SpotifySDK] Ready with device_id:", device_id);
          setDeviceId(device_id);
          setReady(true);
          setError(null);
        });

        player.addListener("not_ready", ({ device_id }: { device_id: string }) => {
          console.log("[SpotifySDK] Device went offline:", device_id);
          if (!cancelled) {
            setReady(false);
            setDeviceId(null);
          }
        });

        player.addListener("initialization_error", ({ message }: { message: string }) => {
          console.error("[SpotifySDK] Init error:", message);
          if (!cancelled) setError(message);
        });

        player.addListener("authentication_error", ({ message }: { message: string }) => {
          console.error("[SpotifySDK] Auth error:", message);
          if (!cancelled) setError(message);
        });

        player.addListener("account_error", ({ message }: { message: string }) => {
          console.error("[SpotifySDK] Account error (Premium required?):", message);
          if (!cancelled) setError(message);
        });

        player.addListener("player_state_changed", (state: any) => {
          if (cancelled || !state) return;
          setIsPlaying(!state.paused);
          const track = state.track_window?.current_track;
          if (track) {
            setTrackName(track.name);
            setArtistName(track.artists?.map((a: any) => a.name).join(", ") || null);
            setAlbumArt(track.album?.images?.[0]?.url || null);
          }
          setDurationMs(state.duration || 0);
          setPositionMs(state.position || 0);
        });

        const connected = await player.connect();
        if (!connected && !cancelled) {
          setError("Failed to connect to Spotify");
        }
        playerRef.current = player;
      } catch (err: any) {
        if (!cancelled) {
          console.error("[SpotifySDK] Setup error:", err);
          setError(err?.message || "SDK setup failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (player) {
        player.disconnect();
        playerRef.current = null;
      }
      setReady(false);
      setDeviceId(null);
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Volume sync
  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    setVolumeState(clamped);
    playerRef.current?.setVolume(clamped / 100).catch(() => {});
  }, []);

  // Sync volume when initialVolume changes externally
  useEffect(() => {
    if (playerRef.current && ready) {
      playerRef.current.setVolume(initialVolume / 100).catch(() => {});
      setVolumeState(initialVolume);
    }
  }, [initialVolume, ready]);

  // Play a playlist URI via the Web API (transfers playback to our device)
  const play = useCallback(
    (contextUri: string) => {
      if (!token || !deviceId) return;
      // contextUri can be a playlist ID — convert to full URI
      const uri = contextUri.startsWith("spotify:")
        ? contextUri
        : `spotify:playlist:${contextUri}`;

      fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ context_uri: uri }),
      }).catch((err) => console.error("[SpotifySDK] Play error:", err));
    },
    [token, deviceId]
  );

  const pause = useCallback(() => {
    playerRef.current?.pause().catch(() => {});
  }, []);

  const resume = useCallback(() => {
    playerRef.current?.resume().catch(() => {});
  }, []);

  const togglePlay = useCallback(() => {
    playerRef.current?.togglePlay().catch(() => {});
  }, []);

  const disconnect = useCallback(() => {
    playerRef.current?.disconnect();
    playerRef.current = null;
    setReady(false);
    setDeviceId(null);
  }, []);

  return {
    ready,
    deviceId,
    isPlaying,
    trackName,
    artistName,
    albumArt,
    durationMs,
    positionMs,
    volume,
    error,
    setVolume,
    play,
    pause,
    resume,
    togglePlay,
    disconnect,
  };
}