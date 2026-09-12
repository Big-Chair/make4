// Database types for the tables in supabase/migrations/.
// Written by hand in the `supabase gen types typescript` format — regenerate
// with that command once the Supabase CLI is set up, and replace this file.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type PlayerRow = {
  name_key: string;
  display_name: string;
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
  updated_at: string;
};

type RoomRow = {
  code: string;
  host_name: string;
  guest_name: string | null;
  timer_duration: number;
  blast_tokens: boolean;
  status: string;
  created_at: string;
  joined_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      players: {
        Row: PlayerRow;
        Insert: {
          name_key: string;
          display_name: string;
          wins?: number;
          losses?: number;
          draws?: number;
          games_played?: number;
          updated_at?: string;
        };
        Update: Partial<PlayerRow>;
        Relationships: [];
      };
      player_level_stats: {
        Row: {
          name_key: string;
          level: number;
          wins: number;
          losses: number;
          draws: number;
          games_played: number;
        };
        Insert: {
          name_key: string;
          level: number;
          wins?: number;
          losses?: number;
          draws?: number;
          games_played?: number;
        };
        Update: {
          name_key?: string;
          level?: number;
          wins?: number;
          losses?: number;
          draws?: number;
          games_played?: number;
        };
        Relationships: [
          {
            foreignKeyName: "player_level_stats_name_key_fkey";
            columns: ["name_key"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["name_key"];
          },
        ];
      };
      token_configs: {
        Row: {
          name_key: string;
          player_name: string;
          config: Json;
          updated_at: string;
        };
        Insert: {
          name_key: string;
          player_name: string;
          config: Json;
          updated_at?: string;
        };
        Update: {
          name_key?: string;
          player_name?: string;
          config?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      token_images: {
        Row: {
          name_key: string;
          file_path: string;
          uploaded_at: string;
        };
        Insert: {
          name_key: string;
          file_path: string;
          uploaded_at?: string;
        };
        Update: {
          name_key?: string;
          file_path?: string;
          uploaded_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: RoomRow;
        Insert: {
          code: string;
          host_name: string;
          guest_name?: string | null;
          timer_duration?: number;
          blast_tokens?: boolean;
          status?: string;
          created_at?: string;
          joined_at?: string | null;
        };
        Update: Partial<RoomRow>;
        Relationships: [];
      };
      site_stats: {
        Row: {
          id: boolean;
          total_visits: number;
        };
        Insert: {
          id?: boolean;
          total_visits?: number;
        };
        Update: {
          id?: boolean;
          total_visits?: number;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      record_game: {
        Args: {
          p_player1: string;
          p_player2: string;
          p_winner: string;
          p_game_mode?: string;
          p_timer_duration?: number;
        };
        Returns: PlayerRow[];
      };
      get_leaderboard: {
        Args: {
          p_limit: number;
          p_level?: number;
          p_player?: string;
        };
        Returns: {
          rank: number;
          name_key: string;
          display_name: string;
          wins: number;
          losses: number;
          draws: number;
          games_played: number;
        }[];
      };
      player_totals: {
        Args: Record<PropertyKey, never>;
        Returns: {
          total_players: number;
          total_games: number;
        }[];
      };
      record_visit: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      create_room: {
        Args: {
          p_host_name: string;
          p_timer_duration: number;
          p_blast_tokens: boolean;
          p_max_rooms: number;
          p_ttl_seconds: number;
        };
        Returns: RoomRow;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
