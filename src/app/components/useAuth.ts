import { useState, useEffect, useCallback } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export interface SpotifyProfile {
  displayName: string;
  avatarUrl: string | null;
  spotifyId: string;
  providerToken: string | null;
}

export interface AuthState {
  session: Session | null;
  spotifyProfile: SpotifyProfile | null;
  loading: boolean;
  signInError: string | null;
  signInWithSpotify: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [spotifyProfile, setSpotifyProfile] = useState<SpotifyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signInError, setSignInError] = useState<string | null>(null);

  const extractSpotifyProfile = useCallback((session: Session | null): SpotifyProfile | null => {
    if (!session?.user) return null;

    const meta = session.user.user_metadata;
    const providerToken = session.provider_token || null;

    return {
      displayName: meta?.full_name || meta?.name || meta?.preferred_username || session.user.email || "Spotify User",
      avatarUrl: meta?.avatar_url || meta?.picture || null,
      spotifyId: meta?.provider_id || meta?.sub || "",
      providerToken,
    };
  }, []);

  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSpotifyProfile(extractSpotifyProfile(session));
      setLoading(false);
    });

    // Listen for auth changes (handles OAuth redirect)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setSpotifyProfile(extractSpotifyProfile(session));
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [extractSpotifyProfile]);

  const signInWithSpotify = useCallback(async () => {
    setSignInError(null);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "spotify",
        options: {
          scopes: "playlist-read-private playlist-read-collaborative user-read-currently-playing user-read-playback-state streaming user-modify-playback-state",
          redirectTo: `${window.location.origin}/oauth/consent`,
        },
      });
      if (error) {
        console.error("Spotify sign-in error:", error);
        setSignInError(error.message || "Failed to start Spotify sign-in");
      } else if (!data?.url) {
        console.error("Spotify sign-in: no redirect URL returned");
        setSignInError("No redirect URL — is the Spotify provider enabled in Supabase?");
      }
      // If successful, the browser will redirect to data.url
    } catch (err: any) {
      console.error("Spotify sign-in exception:", err);
      setSignInError(err?.message || "Unexpected error during sign-in");
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign-out error:", error);
    }
    setSession(null);
    setSpotifyProfile(null);
  }, []);

  return {
    session,
    spotifyProfile,
    loading,
    signInError,
    signInWithSpotify,
    signOut,
  };
}

// Spotify Web API helpers
export async function fetchSpotifyPlaylists(token: string): Promise<any[]> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/playlists?limit=10", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error("Spotify playlists error:", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error("Error fetching Spotify playlists:", err);
    return [];
  }
}

export async function fetchCurrentlyPlaying(token: string): Promise<any | null> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 204) return null; // Nothing playing
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function setSpotifyVolume(token: string, volumePercent: number): Promise<boolean> {
  try {
    const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
    const res = await fetch(
      `https://api.spotify.com/v1/me/player/volume?volume_percent=${clamped}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.status === 204 || res.ok) return true;
    console.error("Spotify volume error:", res.status);
    return false;
  } catch (err) {
    console.error("Error setting Spotify volume:", err);
    return false;
  }
}