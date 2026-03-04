# BTC Prediction Bot

## Current State

A 15-minute BTC prediction bot dashboard with:
- Live bot tab: candle streak tracking, dynamic bet sizing (3-6 streak → $100/$300/$900/$2,700), 7-candle cap with auto-restart after 3 opposite candles, stop-loss (6-hour cooldown), dynamic bet multiplier (+10% per $1K above $10K)
- Simulation tab: 12h/24h/48h candle simulation with same strategy logic
- Kalshi tab: RSA-authenticated API integration, CORS proxy support, live trading toggle

## Requested Changes (Diff)

### Add
- **30-second candle-open delay**: When a new 15-minute candle opens, the bot must wait 30 seconds before placing any bet for that candle. During the delay, a visible countdown is shown on the dashboard. Bets are queued but not placed until the 30s window expires.
- In simulation mode: the 30-second delay should be simulated (represented as a configurable per-candle delay, shown in the trade log) — actual wall clock delay is not practical at sim speed, so it should be modeled as a logical "delay window" that prevents bets in the first slot of each new candle.

### Modify
- Live bot dashboard: show a countdown timer / progress bar when a new candle is detected and the 30s delay is active
- Strategy rules panel: document the 30-second entry delay rule
- Simulation trade log: annotate bets with a "DELAYED" label reflecting the 30s wait logic

### Remove
- Nothing removed

## Implementation Plan

1. Add `candleOpenDelaySeconds` constant (30) to App.tsx
2. Track `newCandleDetectedAt` timestamp in state (localStorage-persisted) — set when a new candle timestamp is detected
3. Compute `delayActive` = now < newCandleDetectedAt + 30_000
4. Add `candleDelayRemaining` countdown (seconds) computed from now vs newCandleDetectedAt
5. Block bet placement (NextBetPreview and handleToggleBot flows) when delayActive is true
6. Show a visible "CANDLE OPEN DELAY" countdown banner/progress bar on the live tab when delayActive
7. Update strategy rules in SettingsPanel to mention the 30s delay
8. In SimulationMode: add a logical "entry delay" flag — bets placed on streak detection are tagged as "DELAYED" in the trade log to reflect the 30s wait window concept (no wall-clock wait needed in simulation)
9. Update `stepCandle` in SimulationMode to mark newly queued bets with a simulated delay annotation
