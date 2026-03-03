import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Bet, BotConfig, Candle } from "../backend.d";
import { useActor } from "./useActor";

export function useBotConfig() {
  const { actor, isFetching } = useActor();
  return useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => {
      if (!actor) throw new Error("No actor");
      return actor.getBotConfig();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 30_000,
  });
}

export function useBets() {
  const { actor, isFetching } = useActor();
  return useQuery<Bet[]>({
    queryKey: ["bets"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getBets();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 30_000,
  });
}

export function useCandles() {
  const { actor, isFetching } = useActor();
  return useQuery<Candle[]>({
    queryKey: ["candles"],
    queryFn: async () => {
      if (!actor) return [];
      return actor.getCandles();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 30_000,
  });
}

export function useCurrentStreak() {
  const { actor, isFetching } = useActor();
  return useQuery<bigint>({
    queryKey: ["currentStreak"],
    queryFn: async () => {
      if (!actor) return BigInt(0);
      return actor.getCurrentStreak();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 30_000,
  });
}

export function useEnableBot() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error("No actor");
      return actor.enableBot();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
    },
  });
}

export function useDisableBot() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error("No actor");
      return actor.disableBot();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
    },
  });
}

export function useSetStartingBalance() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (balance: number) => {
      if (!actor) throw new Error("No actor");
      return actor.setStartingBalance(balance);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
    },
  });
}

export function useManualTick() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error("No actor");
      return actor.manualTick();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      queryClient.invalidateQueries({ queryKey: ["bets"] });
      queryClient.invalidateQueries({ queryKey: ["candles"] });
      queryClient.invalidateQueries({ queryKey: ["currentStreak"] });
    },
  });
}

export function useRefreshAll() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["botConfig"] });
    queryClient.invalidateQueries({ queryKey: ["bets"] });
    queryClient.invalidateQueries({ queryKey: ["candles"] });
    queryClient.invalidateQueries({ queryKey: ["currentStreak"] });
  };
}

// ─── Kalshi Config (localStorage-backed) ─────────────────────────────────────

export interface KalshiConfig {
  apiKey: string;
  apiEmail: string;
  proxyUrl: string;
  liveEnabled: boolean;
  selectedMarket: string;
  setCredentials: (key: string, email: string) => void;
  clearCredentials: () => void;
  setLiveEnabled: (enabled: boolean) => void;
  setSelectedMarket: (ticker: string) => void;
  setProxyUrl: (url: string) => void;
}

export function useKalshiConfig(): KalshiConfig {
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem("kalshi_api_key") ?? "",
  );
  const [apiEmail, setApiEmail] = useState<string>(
    () => localStorage.getItem("kalshi_api_email") ?? "",
  );
  const [proxyUrl, setProxyUrlState] = useState<string>(
    () => localStorage.getItem("kalshi_proxy_url") ?? "",
  );
  const [liveEnabled, setLiveEnabledState] = useState<boolean>(
    () => localStorage.getItem("kalshi_live_trading_enabled") === "true",
  );
  const [selectedMarket, setSelectedMarketState] = useState<string>(
    () => localStorage.getItem("kalshi_selected_market") ?? "",
  );

  const setCredentials = useCallback((key: string, email: string) => {
    localStorage.setItem("kalshi_api_key", key);
    localStorage.setItem("kalshi_api_email", email);
    setApiKey(key);
    setApiEmail(email);
  }, []);

  const clearCredentials = useCallback(() => {
    localStorage.removeItem("kalshi_api_key");
    localStorage.removeItem("kalshi_api_email");
    localStorage.removeItem("kalshi_live_trading_enabled");
    localStorage.removeItem("kalshi_selected_market");
    setApiKey("");
    setApiEmail("");
    setLiveEnabledState(false);
    setSelectedMarketState("");
  }, []);

  const setLiveEnabled = useCallback((enabled: boolean) => {
    localStorage.setItem(
      "kalshi_live_trading_enabled",
      enabled ? "true" : "false",
    );
    setLiveEnabledState(enabled);
  }, []);

  const setSelectedMarket = useCallback((ticker: string) => {
    localStorage.setItem("kalshi_selected_market", ticker);
    setSelectedMarketState(ticker);
  }, []);

  const setProxyUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (trimmed) {
      localStorage.setItem("kalshi_proxy_url", trimmed);
    } else {
      localStorage.removeItem("kalshi_proxy_url");
    }
    setProxyUrlState(trimmed);
  }, []);

  return {
    apiKey,
    apiEmail,
    proxyUrl,
    liveEnabled,
    selectedMarket,
    setCredentials,
    clearCredentials,
    setLiveEnabled,
    setSelectedMarket,
    setProxyUrl,
  };
}
