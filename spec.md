# BTC Prediction Bot

## Current State
- Live bot places bets at streak lengths 3, 4, 5, and 6 (four bet levels: $100, $300, $900, $2700)
- Simulation runs a fixed 48-candle (12-hour) timeframe
- 7-candle streak cap disables the bot; auto-restart after 3 opposite candles
- Dynamic bet sizing and session loss limit are in place

## Requested Changes (Diff)

### Add
- Simulation timeframe selector with three options: 12h (48 candles), 24h (96 candles), 48h (192 candles)
- `TOTAL_CANDLES` becomes a variable driven by the selected timeframe

### Modify
- Betting logic in both live bot (App.tsx) and simulation (SimulationMode.tsx): reduce from 4 bet levels to 3 by removing the streak=6 / $2700 bet. Bets now trigger only at streak lengths 3, 4, and 5
  - Streak 3 → $100 base (bet on opposite after 3 consecutive)
  - Streak 4 → $300 base
  - Streak 5 → $900 base
  - Streak 6+ → no bet (handled by the 7-candle cap at streak=7)
- `getNextBetAmount` / `getBetAmount` helpers: remove the streak===6 → 2700 branch; return null for streak >= 6
- Strategy Rules panel in Settings: remove the streak-6 row from both green and red tables
- Summary panel in SimulationMode: update "All X candles (Y hours) processed" to reflect the chosen timeframe

### Remove
- $2700 base bet tier (streak=6) from all bet calculation helpers, UI previews, and strategy reference tables

## Implementation Plan
1. Update `getNextBetAmount` in App.tsx: change condition to `streak < 3 || streak >= 6` (return null), remove streak===6 case from base calc
2. Update `getBetAmount` in SimulationMode.tsx: same change
3. Update strategy reference tables in SettingsPanel (App.tsx): remove streak-6 rows from both green/red grids
4. Update `checkStreakBet` in SimulationMode.tsx: the existing `getBetAmount` guard handles it automatically once updated
5. Add `SimTimeframe` type and state in SimulationMode: "12h" | "24h" | "48h"
6. Add timeframe selector UI in the Simulation Configuration panel
7. Replace `const TOTAL_CANDLES = 48` with a computed value from the selected timeframe
8. Update progress bar label and summary panel to show selected timeframe hours
9. Update "All X candles (Y hours) processed" message in SummaryPanel dynamically
