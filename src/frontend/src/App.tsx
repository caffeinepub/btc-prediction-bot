import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  BarChart2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  FlaskConical,
  Link2,
  Loader2,
  OctagonX,
  Radio,
  RefreshCw,
  Settings,
  ShieldOff,
  Target,
  TrendingDown,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Bet, Candle } from "./backend.d";
import KalshiPanel from "./components/KalshiPanel";
import SimulationMode from "./components/SimulationMode";
import {
  useBets,
  useBotConfig,
  useCandles,
  useCurrentStreak,
  useDisableBot,
  useEnableBot,
  useManualTick,
  useRefreshAll,
  useSetStartingBalance,
} from "./hooks/useQueries";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);
}

function formatTime(tsMs: number): string {
  return new Date(tsMs).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(tsMs: number): string {
  return new Date(tsMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Multiplier: +10% for every $1,000 above $10,000 */
function computeBetMultiplier(balance: number): number {
  const extra = Math.max(0, Math.floor((balance - 10000) / 1000));
  return 1 + extra * 0.1;
}

/** Session loss limit: $5,000 base + 0.015% of balance per $1,000 in account */
function computeSessionLossLimit(balance: number): number {
  const increments = Math.floor(balance / 1000);
  return 5000 + increments * balance * 0.00015;
}

const MAX_STREAK_LIMIT = 7;

function getNextBetAmount(streak: number, balance: number): number | null {
  if (streak < 3 || streak > 6) return null;
  const mult = computeBetMultiplier(balance);
  const base =
    streak === 3 ? 100 : streak === 4 ? 300 : streak === 5 ? 900 : 2700;
  return Math.round(base * mult);
}

function formatCooldown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function computeRedStreak(candles: Candle[]): number {
  let count = 0;
  for (const candle of candles) {
    if (candle.close < candle.open) count++;
    else break;
  }
  return count;
}

// ─── Candlestick Chart ───────────────────────────────────────────────────────

function CandlestickChart({ candles }: { candles: Candle[] }) {
  const last10 = [...candles].slice(-10);
  if (last10.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground mono text-sm">
        NO CANDLE DATA
      </div>
    );
  }

  const allPrices = last10.flatMap((c) => [c.high, c.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice || 1;

  const svgHeight = 140;
  const svgPadding = 10;
  const chartHeight = svgHeight - svgPadding * 2;
  const candleWidth = 18;
  const wickWidth = 1.5;
  const gap = 8;
  const totalWidth = last10.length * (candleWidth + gap) + gap;

  function priceToY(price: number): number {
    return (
      svgPadding + chartHeight - ((price - minPrice) / priceRange) * chartHeight
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${totalWidth} ${svgHeight}`}
        width="100%"
        height={svgHeight}
        className="overflow-visible"
        role="img"
        aria-label="BTC/USD 15-minute candlestick chart"
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <line
            key={pct}
            x1="0"
            y1={svgPadding + chartHeight * (1 - pct)}
            x2={totalWidth}
            y2={svgPadding + chartHeight * (1 - pct)}
            stroke="oklch(0.70 0.22 145 / 0.08)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        ))}

        {last10.map((candle, i) => {
          const isGreen = candle.close > candle.open;
          const x = gap + i * (candleWidth + gap);
          const bodyTop = priceToY(Math.max(candle.open, candle.close));
          const bodyBottom = priceToY(Math.min(candle.open, candle.close));
          const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
          const wickTop = priceToY(candle.high);
          const wickBottom = priceToY(candle.low);
          const centerX = x + candleWidth / 2;

          const greenColor = "oklch(0.70 0.22 145)";
          const redColor = "oklch(0.62 0.22 22)";
          const candleColor = isGreen ? greenColor : redColor;
          const glowFilter = isGreen ? "url(#glowGreen)" : "url(#glowRed)";

          return (
            <g key={candle.timestamp.toString()}>
              {/* Wick */}
              <line
                x1={centerX}
                y1={wickTop}
                x2={centerX}
                y2={wickBottom}
                stroke={candleColor}
                strokeWidth={wickWidth}
                opacity="0.7"
              />
              {/* Body */}
              <rect
                x={x}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={
                  isGreen
                    ? "oklch(0.70 0.22 145 / 0.85)"
                    : "oklch(0.62 0.22 22 / 0.85)"
                }
                stroke={candleColor}
                strokeWidth="0.5"
                filter={glowFilter}
                rx="1"
              />
            </g>
          );
        })}

        {/* Glow filters */}
        <defs>
          <filter id="glowGreen">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glowRed">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Time labels */}
      <div
        className="flex items-start mt-1"
        style={{ gap: `${gap}px`, paddingLeft: `${gap}px` }}
      >
        {last10.map((candle) => (
          <div
            key={candle.timestamp.toString()}
            className="text-muted-foreground mono flex-shrink-0 text-center"
            style={{ width: `${candleWidth}px`, fontSize: "8px" }}
          >
            {formatTime(Number(candle.timestamp))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Outcome Badge ────────────────────────────────────────────────────────────

function OutcomeBadge({ bet }: { bet: Bet }) {
  if (!bet.resolved) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs mono font-semibold text-candle-yellow border border-candle-yellow/40 bg-candle-yellow/10">
        PENDING
      </span>
    );
  }
  if (bet.outcome === "win") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs mono font-semibold text-candle-green border border-candle-green/40 bg-candle-green/10">
        WIN
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs mono font-semibold text-candle-red border border-candle-red/40 bg-candle-red/10">
      LOSS
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  variant?: "default" | "green" | "red" | "yellow";
  delay?: number;
}

function StatCard({
  label,
  value,
  sub,
  icon,
  variant = "default",
  delay = 0,
}: StatCardProps) {
  const borderClass =
    variant === "green"
      ? "border-candle-green/30 shadow-glow-green/20"
      : variant === "red"
        ? "border-candle-red/30"
        : variant === "yellow"
          ? "border-candle-yellow/30"
          : "border-border";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={`terminal-card rounded-lg p-4 border ${borderClass} relative overflow-hidden`}
    >
      {/* Corner decoration */}
      <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-candle-green/15 rounded-bl-lg" />
      <div className="absolute bottom-0 left-0 w-6 h-6 border-b border-l border-candle-green/10 rounded-tr-lg" />

      <div className="flex items-start justify-between mb-3">
        <span className="mono text-xs text-muted-foreground tracking-widest uppercase">
          {label}
        </span>
        <span className="text-muted-foreground opacity-60">{icon}</span>
      </div>
      <div className="mono text-2xl font-bold text-foreground leading-none">
        {value}
      </div>
      {sub && (
        <div className="mt-2 mono text-xs text-muted-foreground">{sub}</div>
      )}
    </motion.div>
  );
}

// ─── Next Bet Preview ─────────────────────────────────────────────────────────

interface BetPreviewProps {
  greenStreak: number;
  redStreak: number;
  balance: number;
}

function NextBetPreview({ greenStreak, redStreak, balance }: BetPreviewProps) {
  const greenBetAmount = getNextBetAmount(greenStreak, balance);
  const redBetAmount = getNextBetAmount(redStreak, balance);

  if (greenBetAmount === null && redBetAmount === null) return null;

  return (
    <div className="space-y-3">
      {/* Green streak → Bet on RED */}
      {greenBetAmount !== null && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3 }}
          className="terminal-card-active rounded-lg p-4 border relative overflow-hidden"
        >
          {/* Corner brackets — green */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-candle-green/80" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-candle-green/80" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-candle-green/80" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-candle-green/80" />

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-candle-yellow" />
              <span className="mono text-xs text-muted-foreground tracking-widest uppercase">
                NEXT BET QUEUED
              </span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-green-glow mono text-xl font-bold">
                {formatCurrency(greenBetAmount)}
              </span>
              <span className="mono text-xs text-muted-foreground">ON</span>
              <span className="text-red-glow mono font-bold tracking-widest">
                ▼ RED
              </span>
              <span className="mono text-xs text-muted-foreground">
                ({greenStreak} consecutive green)
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="mono text-xs text-muted-foreground">
              MEAN REVERSION SIGNAL:
            </span>
            <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "oklch(0.70 0.22 145)" }}
                initial={{ width: "0%" }}
                animate={{ width: `${Math.min(greenStreak * 15, 95)}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <span className="mono text-xs text-candle-green">
              {Math.min(greenStreak * 15, 95)}%
            </span>
          </div>
        </motion.div>
      )}

      {/* Red streak → Bet on GREEN */}
      {redBetAmount !== null && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{
            duration: 0.3,
            delay: greenBetAmount !== null ? 0.1 : 0,
          }}
          className="rounded-lg p-4 border relative overflow-hidden"
          style={{
            background: "oklch(var(--card))",
            borderColor: "oklch(0.62 0.22 22 / 0.4)",
            boxShadow:
              "0 0 12px oklch(0.62 0.22 22 / 0.12), 0 4px 16px oklch(0 0 0 / 0.4), inset 0 1px 0 oklch(0.62 0.22 22 / 0.08)",
          }}
        >
          {/* Corner brackets — red */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-candle-red/80" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-candle-red/80" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-candle-red/80" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-candle-red/80" />

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-candle-yellow" />
              <span className="mono text-xs text-muted-foreground tracking-widest uppercase">
                NEXT BET QUEUED
              </span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-red-glow mono text-xl font-bold">
                {formatCurrency(redBetAmount)}
              </span>
              <span className="mono text-xs text-muted-foreground">ON</span>
              <span className="text-green-glow mono font-bold tracking-widest">
                ▲ GREEN
              </span>
              <span className="mono text-xs text-muted-foreground">
                ({redStreak} consecutive red)
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="mono text-xs text-muted-foreground">
              MEAN REVERSION SIGNAL:
            </span>
            <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "oklch(0.62 0.22 22)" }}
                initial={{ width: "0%" }}
                animate={{ width: `${Math.min(redStreak * 15, 95)}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <span className="mono text-xs text-candle-red">
              {Math.min(redStreak * 15, 95)}%
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({
  currentBalance,
  cooldownActive,
  onClearCooldown,
}: {
  currentBalance: number;
  cooldownActive: boolean;
  onClearCooldown: () => void;
}) {
  const [balanceInput, setBalanceInput] = useState(currentBalance.toString());
  const setBalance = useSetStartingBalance();
  const manualTick = useManualTick();

  async function handleSaveBalance() {
    const val = Number.parseFloat(balanceInput);
    if (Number.isNaN(val) || val <= 0) {
      toast.error("Enter a valid balance amount");
      return;
    }
    try {
      await setBalance.mutateAsync(val);
      toast.success(`Starting balance set to ${formatCurrency(val)}`);
    } catch {
      toast.error("Failed to set balance");
    }
  }

  async function handleManualTick() {
    try {
      await manualTick.mutateAsync();
      toast.success("Candle check executed");
    } catch {
      toast.error("Manual tick failed");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden"
    >
      <div className="terminal-card rounded-lg border border-border p-5 mt-1">
        <div className="flex items-center gap-2 mb-5">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="mono text-xs tracking-widest text-muted-foreground uppercase">
            Bot Configuration
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Starting Balance */}
          <div className="space-y-2">
            <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
              Starting Balance (USD)
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="number"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  className="pl-8 mono bg-secondary/50 border-border text-foreground"
                  placeholder="1000.00"
                  data-ocid="settings.input"
                  onKeyDown={(e) => e.key === "Enter" && handleSaveBalance()}
                />
              </div>
              <Button
                onClick={handleSaveBalance}
                disabled={setBalance.isPending}
                size="sm"
                className="mono bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30"
                variant="outline"
                data-ocid="settings.save_button"
              >
                {setBalance.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  "SAVE"
                )}
              </Button>
            </div>
            <p className="mono text-xs text-muted-foreground">
              Resets P&amp;L calculation baseline
            </p>
          </div>

          {/* Dynamic Session Loss Limit (info card — non-editable) */}
          <div className="space-y-2">
            <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
              Session Loss Limit
            </Label>
            <div className="rounded border border-candle-red/20 bg-candle-red/5 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="mono text-xs text-muted-foreground">
                  Current limit
                </span>
                <span className="mono text-sm font-bold text-candle-red">
                  {formatCurrency(computeSessionLossLimit(currentBalance))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="mono text-xs text-muted-foreground">
                  Formula
                </span>
                <span className="mono text-xs text-muted-foreground">
                  $5,000 base + 0.015% per $1K
                </span>
              </div>
            </div>
            <p className="mono text-xs text-muted-foreground">
              Auto-computed · triggers a 6-hour trading hold
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {/* Manual Tick */}
          <div className="space-y-2">
            <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
              Debug Controls
            </Label>
            <Button
              onClick={handleManualTick}
              disabled={manualTick.isPending}
              variant="outline"
              className="mono w-full border-candle-yellow/30 text-candle-yellow hover:bg-candle-yellow/10 bg-candle-yellow/5"
              data-ocid="settings.secondary_button"
            >
              {manualTick.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  CHECKING...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  FORCE CANDLE CHECK
                </>
              )}
            </Button>
            <p className="mono text-xs text-muted-foreground">
              Manually triggers strategy evaluation
            </p>
          </div>

          {/* Clear Cooldown */}
          <div className="space-y-2">
            <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
              Cooldown Override
            </Label>
            <Button
              onClick={onClearCooldown}
              disabled={!cooldownActive}
              variant="outline"
              className="mono w-full border-candle-red/30 text-candle-red hover:bg-candle-red/10 bg-candle-red/5 disabled:opacity-40 disabled:cursor-not-allowed"
              data-ocid="settings.delete_button"
            >
              <ShieldOff className="w-4 h-4 mr-2" />
              {cooldownActive ? "CLEAR COOLDOWN" : "NO ACTIVE COOLDOWN"}
            </Button>
            <p className="mono text-xs text-muted-foreground">
              Manually override the 6-hour stop-loss lockout
            </p>
          </div>
        </div>

        {/* Strategy Reference */}
        <div className="mt-5 pt-4 border-t border-border">
          <div className="mono text-xs text-muted-foreground tracking-widest uppercase mb-3">
            Strategy Rules
          </div>

          {/* Dynamic scaling info */}
          <div className="rounded border border-candle-yellow/20 bg-candle-yellow/5 px-4 py-3 mb-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="mono text-xs text-candle-yellow font-semibold">
                DYNAMIC BET SIZING
              </span>
              <span className="mono text-xs text-candle-yellow font-bold">
                {computeBetMultiplier(currentBalance).toFixed(2)}x multiplier
              </span>
            </div>
            <p className="mono text-xs text-muted-foreground">
              Bets scale +10% per $1,000 above $10,000. Current multiplier:{" "}
              {computeBetMultiplier(currentBalance).toFixed(2)}x
            </p>
            <p className="mono text-xs text-muted-foreground">
              Session loss limit: $5,000 base + 0.015% per $1,000 in account.
              Current: {formatCurrency(computeSessionLossLimit(currentBalance))}
            </p>
            <p className="mono text-xs text-candle-yellow/80 border-t border-candle-yellow/20 pt-1.5 mt-1">
              ⚠ Bets are disabled and bot auto-stops after {MAX_STREAK_LIMIT}{" "}
              consecutive candles in either direction.
            </p>
          </div>

          {/* Green streak → Bet RED */}
          <div className="mb-4">
            <div className="mono text-xs text-candle-green tracking-wider mb-2 flex items-center gap-1.5">
              <span>▲</span>
              <span>CONSECUTIVE GREEN → BET RED</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { streak: 3, base: 100 },
                { streak: 4, base: 300 },
                { streak: 5, base: 900 },
                { streak: 6, base: 2700 },
              ].map(({ streak, base }) => (
                <div
                  key={streak}
                  className="bg-candle-green/5 rounded border border-candle-green/20 p-2 text-center"
                >
                  <div className="mono text-xs text-muted-foreground mb-1">
                    {streak} 🟩 streak
                  </div>
                  <div className="mono text-sm font-bold text-candle-green">
                    {formatCurrency(
                      Math.round(base * computeBetMultiplier(currentBalance)),
                    )}
                  </div>
                  <div className="mono text-xs text-candle-red">▼ RED</div>
                </div>
              ))}
            </div>
          </div>

          {/* Red streak → Bet GREEN */}
          <div>
            <div className="mono text-xs text-candle-red tracking-wider mb-2 flex items-center gap-1.5">
              <span>▼</span>
              <span>CONSECUTIVE RED → BET GREEN</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { streak: 3, base: 100 },
                { streak: 4, base: 300 },
                { streak: 5, base: 900 },
                { streak: 6, base: 2700 },
              ].map(({ streak, base }) => (
                <div
                  key={streak}
                  className="bg-candle-red/5 rounded border border-candle-red/20 p-2 text-center"
                >
                  <div className="mono text-xs text-muted-foreground mb-1">
                    {streak} 🟥 streak
                  </div>
                  <div className="mono text-sm font-bold text-candle-red">
                    {formatCurrency(
                      Math.round(base * computeBetMultiplier(currentBalance)),
                    )}
                  </div>
                  <div className="mono text-xs text-candle-green">▲ GREEN</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

type AppTab = "live" | "simulation" | "kalshi";

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("live");
  const [showSettings, setShowSettings] = useState(false);
  const [_lastUpdated, setLastUpdated] = useState(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);

  // 7-candle streak disable state — persisted to localStorage
  const [streakLimitTriggered, setStreakLimitTriggered] = useState<boolean>(
    () => {
      return localStorage.getItem("btcbot_streak_limit_triggered") === "true";
    },
  );
  const [streakLimitInfo, setStreakLimitInfo] = useState<string>(() => {
    return localStorage.getItem("btcbot_streak_limit_info") ?? "";
  });
  const [waitingForRestart, setWaitingForRestart] = useState<boolean>(() => {
    return localStorage.getItem("btcbot_waiting_for_restart") === "true";
  });
  const [restartProgress, setRestartProgress] = useState<number>(() => {
    return Number(localStorage.getItem("btcbot_restart_progress") ?? "0");
  });
  const [streakLimitColor, setStreakLimitColor] = useState<
    "green" | "red" | null
  >(() => {
    return (
      (localStorage.getItem("btcbot_streak_limit_color") as
        | "green"
        | "red"
        | null) || null
    );
  });

  // Stop-loss state — persisted to localStorage
  const [stopLossTriggered, setStopLossTriggered] = useState<boolean>(() => {
    return localStorage.getItem("btcbot_stop_loss_triggered") === "true";
  });
  const [cooldownUntil, setCooldownUntil] = useState<number>(() => {
    const stored = localStorage.getItem("btcbot_stop_loss_cooldown_until");
    return stored ? Number.parseInt(stored, 10) : 0;
  });
  const [sessionStartBalance, setSessionStartBalance] = useState<number>(() => {
    const stored = localStorage.getItem("btcbot_session_start_balance");
    return stored ? Number.parseFloat(stored) : 0;
  });
  const [now, setNow] = useState(Date.now());

  const configQuery = useBotConfig();
  const betsQuery = useBets();
  const candlesQuery = useCandles();
  const streakQuery = useCurrentStreak();
  const enableBot = useEnableBot();
  const disableBot = useDisableBot();
  const refreshAll = useRefreshAll();

  const config = configQuery.data;
  const bets = betsQuery.data ?? [];
  const candles = candlesQuery.data ?? [];
  const streak = Number(streakQuery.data ?? 0n);
  // Candles from getCandles() are ordered most-recent first (index 0 = latest)
  const redStreak = computeRedStreak(candles);

  const isLoading =
    configQuery.isLoading ||
    betsQuery.isLoading ||
    candlesQuery.isLoading ||
    streakQuery.isLoading;

  // Auto-refresh
  const handleRefresh = useCallback(() => {
    refreshAll();
    setLastUpdated(Date.now());
    setSecondsAgo(0);
  }, [refreshAll]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsAgo((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Tick `now` every second for cooldown countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const cooldownActive = now < cooldownUntil;
  const cooldownRemaining = Math.max(0, cooldownUntil - now); // ms

  useEffect(() => {
    if (!isLoading) {
      setLastUpdated(Date.now());
      setSecondsAgo(0);
    }
  }, [isLoading]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(handleRefresh, 30_000);
    return () => clearInterval(interval);
  }, [handleRefresh]);

  // Computed stats
  const resolvedBets = bets.filter((b) => b.resolved);
  const wins = resolvedBets.filter((b) => b.outcome === "win");
  const winRate =
    resolvedBets.length > 0 ? (wins.length / resolvedBets.length) * 100 : 0;
  const pnl = config ? config.balance - config.startingBalance : 0;
  const sortedBets = [...bets]
    .sort((a, b) => Number(b.timestamp - a.timestamp))
    .slice(0, 20);

  // Stop-loss effect: auto-disable if session losses exceed dynamic limit
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — only react to balance/enabled/sessionStartBalance changes
  useEffect(() => {
    if (!config) return;
    if (
      config.enabled &&
      sessionStartBalance > 0 &&
      sessionStartBalance - config.balance >=
        computeSessionLossLimit(sessionStartBalance)
    ) {
      disableBot.mutateAsync().catch(() => {});
      setStopLossTriggered(true);
      localStorage.setItem("btcbot_stop_loss_triggered", "true");
      const until = Date.now() + 6 * 60 * 60 * 1000;
      setCooldownUntil(until);
      localStorage.setItem("btcbot_stop_loss_cooldown_until", until.toString());
      toast.error(
        `STOP LOSS TRIGGERED — Session losses exceeded ${formatCurrency(computeSessionLossLimit(sessionStartBalance))}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.balance, config?.enabled, sessionStartBalance]);

  // 7-candle streak auto-disable effect
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    if (!config?.enabled) return;
    const triggeredStreak =
      streak >= MAX_STREAK_LIMIT
        ? streak
        : redStreak >= MAX_STREAK_LIMIT
          ? redStreak
          : 0;
    const streakColor =
      streak >= MAX_STREAK_LIMIT
        ? "green"
        : redStreak >= MAX_STREAK_LIMIT
          ? "red"
          : null;
    if (streakColor && triggeredStreak >= MAX_STREAK_LIMIT) {
      disableBot.mutateAsync().catch(() => {});
      const info = `${triggeredStreak} consecutive ${streakColor.toUpperCase()} candles`;
      setStreakLimitTriggered(true);
      setStreakLimitInfo(info);
      setWaitingForRestart(true);
      setRestartProgress(0);
      setStreakLimitColor(streakColor);
      localStorage.setItem("btcbot_streak_limit_triggered", "true");
      localStorage.setItem("btcbot_streak_limit_info", info);
      localStorage.setItem("btcbot_waiting_for_restart", "true");
      localStorage.setItem("btcbot_restart_progress", "0");
      localStorage.setItem("btcbot_streak_limit_color", streakColor);
      toast.error(`BOT DISABLED — ${info} exceeded the 7-candle limit`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streak, redStreak, config?.enabled]);

  // Auto-restart watch: after 7-candle cap, count opposite-color candles toward restart
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    if (!waitingForRestart || !streakLimitColor || candles.length === 0) return;
    if (cooldownActive) return; // don't restart during stop-loss cooldown

    // streak = green streak (most recent), redStreak = red streak
    const oppositeCount = streakLimitColor === "green" ? redStreak : streak;
    const newProgress = Math.min(oppositeCount, 3);

    if (newProgress !== restartProgress) {
      setRestartProgress(newProgress);
      localStorage.setItem("btcbot_restart_progress", newProgress.toString());
    }

    if (newProgress >= 3) {
      enableBot
        .mutateAsync()
        .then(() => {
          setWaitingForRestart(false);
          setRestartProgress(0);
          setStreakLimitTriggered(false);
          setStreakLimitInfo("");
          setStreakLimitColor(null);
          localStorage.setItem("btcbot_waiting_for_restart", "false");
          localStorage.setItem("btcbot_restart_progress", "0");
          localStorage.setItem("btcbot_streak_limit_triggered", "false");
          localStorage.setItem("btcbot_streak_limit_info", "");
          localStorage.setItem("btcbot_streak_limit_color", "");
          const newSessionBalance = config?.balance ?? 0;
          setSessionStartBalance(newSessionBalance);
          localStorage.setItem(
            "btcbot_session_start_balance",
            newSessionBalance.toString(),
          );
          toast.success("Bot auto-restarted — 3 opposite candles formed");
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    streak,
    redStreak,
    candles,
    waitingForRestart,
    streakLimitColor,
    cooldownActive,
  ]);

  function handleClearCooldown() {
    setCooldownUntil(0);
    localStorage.setItem("btcbot_stop_loss_cooldown_until", "0");
    setStopLossTriggered(false);
    localStorage.setItem("btcbot_stop_loss_triggered", "false");
    const newSessionBalance = config?.balance ?? 0;
    setSessionStartBalance(newSessionBalance);
    localStorage.setItem(
      "btcbot_session_start_balance",
      newSessionBalance.toString(),
    );
    toast.success("Cooldown cleared — bot can now be re-enabled");
  }

  async function handleToggleBot() {
    if (!config) return;
    try {
      if (config.enabled) {
        await disableBot.mutateAsync();
        toast.success("Bot disabled");
      } else {
        if (cooldownActive) {
          toast.error(
            `COOLDOWN ACTIVE — ${formatCooldown(cooldownRemaining)} remaining before bot can be re-enabled`,
          );
          return;
        }
        setStopLossTriggered(false);
        localStorage.setItem("btcbot_stop_loss_triggered", "false");
        setStreakLimitTriggered(false);
        setStreakLimitInfo("");
        setWaitingForRestart(false);
        setRestartProgress(0);
        setStreakLimitColor(null);
        localStorage.setItem("btcbot_streak_limit_triggered", "false");
        localStorage.setItem("btcbot_streak_limit_info", "");
        localStorage.setItem("btcbot_waiting_for_restart", "false");
        localStorage.setItem("btcbot_restart_progress", "0");
        localStorage.setItem("btcbot_streak_limit_color", "");
        const newSessionBalance = config.balance;
        setSessionStartBalance(newSessionBalance);
        localStorage.setItem(
          "btcbot_session_start_balance",
          newSessionBalance.toString(),
        );
        await enableBot.mutateAsync();
        toast.success("Bot enabled — monitoring BTC candles");
      }
    } catch {
      toast.error("Failed to toggle bot");
    }
  }

  const isToggling = enableBot.isPending || disableBot.isPending;

  return (
    <div className="min-h-screen bg-background grid-bg">
      <Toaster
        theme="dark"
        toastOptions={{
          style: {
            background: "oklch(0.13 0.01 155)",
            border: "1px solid oklch(0.25 0.025 145)",
            color: "oklch(0.88 0.12 145)",
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "13px",
          },
        }}
      />

      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          {/* Logo / Title */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-8 h-8 rounded border border-candle-green/50 flex items-center justify-center bg-candle-green/10">
                <Activity className="w-4 h-4 text-candle-green" />
              </div>
              {config?.enabled && (
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-candle-green pulse-green" />
              )}
            </div>
            <div>
              <h1 className="font-display font-bold text-foreground text-lg leading-none tracking-tight">
                BTC Prediction Bot
              </h1>
              <p className="mono text-xs text-muted-foreground mt-0.5">
                15M CANDLE STRATEGY
              </p>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Last updated */}
            <div className="mono text-xs text-muted-foreground flex items-center gap-1.5">
              <RefreshCw
                className={`w-3 h-3 ${isLoading ? "animate-spin text-candle-green" : "text-muted-foreground"}`}
              />
              {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`}
            </div>

            {/* Refresh */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
              className="mono text-xs border-border hover:border-candle-green/40 hover:text-candle-green h-7 px-2"
            >
              <RefreshCw
                className={`w-3 h-3 mr-1 ${isLoading ? "animate-spin" : ""}`}
              />
              SYNC
            </Button>

            {/* Tab Toggle */}
            <div className="flex items-center rounded border border-border bg-secondary/50 p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("live")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs mono font-bold tracking-widest transition-all duration-150 ${
                  activeTab === "live"
                    ? "bg-candle-green/15 text-candle-green border border-candle-green/40"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <Radio className="w-3 h-3" />
                LIVE
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("simulation")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs mono font-bold tracking-widest transition-all duration-150 ${
                  activeTab === "simulation"
                    ? "bg-candle-yellow/15 text-candle-yellow border border-candle-yellow/40"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <FlaskConical className="w-3 h-3" />
                SIM
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("kalshi")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs mono font-bold tracking-widest transition-all duration-150 ${
                  activeTab === "kalshi"
                    ? "bg-candle-yellow/15 text-candle-yellow border border-candle-yellow/40"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <Link2 className="w-3 h-3" />
                KALSHI
              </button>
            </div>

            {/* Status badge */}
            {config && activeTab === "live" && (
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-2 h-2 rounded-full ${config.enabled ? "bg-candle-green pulse-green" : "bg-muted-foreground"}`}
                />
                <span
                  className={`mono text-xs font-bold tracking-widest ${config.enabled ? "text-candle-green" : "text-muted-foreground"}`}
                >
                  {config.enabled ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
            )}

            {/* Toggle (only on live tab) */}
            {activeTab === "live" && (
              <Button
                onClick={handleToggleBot}
                disabled={isToggling || !config}
                size="sm"
                variant="outline"
                className={`mono text-xs h-7 px-3 font-bold tracking-widest border ${
                  config?.enabled
                    ? "border-candle-red/50 text-candle-red hover:bg-candle-red/10"
                    : "border-candle-green/50 text-candle-green hover:bg-candle-green/10"
                }`}
              >
                {isToggling ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : config?.enabled ? (
                  "DISABLE"
                ) : (
                  "ENABLE"
                )}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Simulation Tab */}
        <AnimatePresence mode="wait">
          {activeTab === "simulation" && (
            <motion.div
              key="simulation"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <SimulationMode />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Kalshi Tab */}
        <AnimatePresence mode="wait">
          {activeTab === "kalshi" && <KalshiPanel />}
        </AnimatePresence>

        {/* Live Tab */}
        {activeTab === "live" && (
          <>
            {/* Loading skeleton */}
            {isLoading && !config && (
              <div className="flex items-center justify-center py-20">
                <div className="text-center space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-candle-green mx-auto" />
                  <p className="mono text-sm text-muted-foreground">
                    CONNECTING TO CANISTER...
                  </p>
                </div>
              </div>
            )}

            <AnimatePresence mode="wait">
              {config && (
                <motion.div
                  key="dashboard"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-5"
                >
                  {/* Stop-loss alert banner */}
                  <AnimatePresence>
                    {stopLossTriggered && (
                      <motion.div
                        key="stop-loss-banner"
                        initial={{ opacity: 0, y: -16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -16 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="relative flex items-center gap-3 rounded-lg border border-candle-red/50 bg-candle-red/10 px-4 py-3"
                        style={{
                          boxShadow:
                            "0 0 20px oklch(0.62 0.22 22 / 0.15), inset 0 1px 0 oklch(0.62 0.22 22 / 0.1)",
                        }}
                      >
                        <ShieldOff className="w-4 h-4 text-candle-red flex-shrink-0" />
                        <p className="mono text-sm text-candle-red font-bold tracking-wide flex-1">
                          STOP LOSS TRIGGERED —{" "}
                          <span className="font-normal text-candle-red/80">
                            Bot auto-disabled. Session losses exceeded{" "}
                            {formatCurrency(
                              computeSessionLossLimit(sessionStartBalance),
                            )}
                            .
                            {cooldownActive && (
                              <>
                                {" "}
                                6-hour cooldown:{" "}
                                <span className="font-semibold text-candle-red">
                                  {formatCooldown(cooldownRemaining)}
                                </span>{" "}
                                remaining.
                              </>
                            )}
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setStopLossTriggered(false);
                            localStorage.setItem(
                              "btcbot_stop_loss_triggered",
                              "false",
                            );
                          }}
                          className="text-candle-red/60 hover:text-candle-red transition-colors ml-2 flex-shrink-0"
                          aria-label="Dismiss stop loss alert"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 7-Candle Streak Limit banner */}
                  <AnimatePresence>
                    {streakLimitTriggered && (
                      <motion.div
                        key="streak-limit-banner"
                        initial={{ opacity: 0, y: -16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -16 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="relative rounded-lg border border-candle-yellow/50 bg-candle-yellow/10 px-4 py-3"
                        style={{
                          boxShadow:
                            "0 0 20px oklch(0.85 0.18 85 / 0.12), inset 0 1px 0 oklch(0.85 0.18 85 / 0.1)",
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <OctagonX className="w-4 h-4 text-candle-yellow flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="mono text-sm text-candle-yellow font-bold tracking-wide">
                              {waitingForRestart ? (
                                <>
                                  WATCHING FOR RESTART —{" "}
                                  <span className="font-normal text-candle-yellow/80">
                                    Bot will auto-restart when 3 consecutive{" "}
                                    {streakLimitColor === "green"
                                      ? "red"
                                      : "green"}{" "}
                                    candles appear.
                                  </span>
                                </>
                              ) : (
                                <>
                                  7-CANDLE STREAK LIMIT —{" "}
                                  <span className="font-normal text-candle-yellow/80">
                                    Bot auto-disabled.{" "}
                                    {streakLimitInfo
                                      ? `${streakLimitInfo} exceeded the 7-candle maximum.`
                                      : "Consecutive candle streak exceeded 7."}{" "}
                                    Re-enable the bot when conditions reset.
                                  </span>
                                </>
                              )}
                            </p>
                            {waitingForRestart && (
                              <div className="mt-2 flex items-center gap-3">
                                {/* Progress dots */}
                                <div className="flex items-center gap-1.5">
                                  {[1, 2, 3].map((n) => (
                                    <motion.div
                                      key={n}
                                      animate={{
                                        scale:
                                          restartProgress >= n
                                            ? [1, 1.3, 1]
                                            : 1,
                                      }}
                                      transition={{ duration: 0.3 }}
                                      className="w-3 h-3 rounded-full border"
                                      style={{
                                        borderColor:
                                          streakLimitColor === "green"
                                            ? "oklch(0.62 0.22 22 / 0.8)"
                                            : "oklch(0.70 0.22 145 / 0.8)",
                                        background:
                                          restartProgress >= n
                                            ? streakLimitColor === "green"
                                              ? "oklch(0.62 0.22 22 / 0.7)"
                                              : "oklch(0.70 0.22 145 / 0.7)"
                                            : "transparent",
                                      }}
                                    />
                                  ))}
                                </div>
                                <span className="mono text-xs text-candle-yellow/70">
                                  {restartProgress}/3{" "}
                                  {streakLimitColor === "green"
                                    ? "red"
                                    : "green"}{" "}
                                  candles formed
                                </span>
                                {/* Mini progress bar */}
                                <div className="flex-1 h-1 bg-candle-yellow/10 rounded-full overflow-hidden max-w-24">
                                  <motion.div
                                    className="h-full rounded-full"
                                    animate={{
                                      width: `${(restartProgress / 3) * 100}%`,
                                    }}
                                    transition={{ duration: 0.4 }}
                                    style={{
                                      background:
                                        streakLimitColor === "green"
                                          ? "oklch(0.62 0.22 22)"
                                          : "oklch(0.70 0.22 145)",
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setStreakLimitTriggered(false);
                              setStreakLimitInfo("");
                              setWaitingForRestart(false);
                              setRestartProgress(0);
                              setStreakLimitColor(null);
                              localStorage.setItem(
                                "btcbot_streak_limit_triggered",
                                "false",
                              );
                              localStorage.setItem(
                                "btcbot_streak_limit_info",
                                "",
                              );
                              localStorage.setItem(
                                "btcbot_waiting_for_restart",
                                "false",
                              );
                              localStorage.setItem(
                                "btcbot_restart_progress",
                                "0",
                              );
                              localStorage.setItem(
                                "btcbot_streak_limit_color",
                                "",
                              );
                            }}
                            className="text-candle-yellow/60 hover:text-candle-yellow transition-colors ml-2 flex-shrink-0"
                            aria-label="Dismiss streak limit alert"
                            data-ocid="streak_limit.close_button"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Stats Row */}
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    {/* Balance */}
                    <StatCard
                      label="Balance"
                      icon={<DollarSign className="w-4 h-4" />}
                      variant={pnl >= 0 ? "green" : "red"}
                      delay={0}
                      value={
                        <span
                          className={
                            pnl >= 0 ? "text-green-glow" : "text-red-glow"
                          }
                        >
                          {formatCurrency(config.balance)}
                        </span>
                      }
                      sub={
                        <div className="space-y-1">
                          <div className="text-muted-foreground">
                            Start: {formatCurrency(config.startingBalance)}
                          </div>
                          <div
                            className={
                              pnl >= 0 ? "text-candle-green" : "text-candle-red"
                            }
                          >
                            {pnl >= 0 ? "+" : ""}
                            {formatCurrency(pnl)} P&amp;L
                          </div>
                          <div className="text-candle-yellow">
                            Multiplier:{" "}
                            {computeBetMultiplier(config.balance).toFixed(2)}x
                          </div>
                          <div className="text-muted-foreground">
                            Session limit:{" "}
                            {formatCurrency(
                              computeSessionLossLimit(config.balance),
                            )}
                          </div>
                          {cooldownActive && (
                            <div className="text-candle-red/70">
                              Cooldown: {formatCooldown(cooldownRemaining)}
                            </div>
                          )}
                        </div>
                      }
                    />

                    {/* Green Streak */}
                    <StatCard
                      label="Green Streak"
                      icon={<BarChart2 className="w-4 h-4" />}
                      variant={
                        streak >= MAX_STREAK_LIMIT
                          ? "yellow"
                          : streak >= 3
                            ? "green"
                            : "default"
                      }
                      delay={0.05}
                      value={
                        <span
                          className={
                            streak >= MAX_STREAK_LIMIT
                              ? "text-candle-yellow"
                              : streak >= 3
                                ? "text-green-glow"
                                : ""
                          }
                        >
                          {streak >= MAX_STREAK_LIMIT && (
                            <span className="mr-1">⚠</span>
                          )}
                          {streak >= 3 && streak < MAX_STREAK_LIMIT && (
                            <span className="flame-bounce mr-1">🔥</span>
                          )}
                          {streak}
                        </span>
                      }
                      sub={
                        streak >= MAX_STREAK_LIMIT ? (
                          <span className="text-candle-yellow">
                            LIMIT REACHED — bets off
                          </span>
                        ) : streak >= 3 ? (
                          <span className="text-candle-green">
                            {streak} consecutive ▲
                          </span>
                        ) : streak > 0 ? (
                          <span>{streak} green so far</span>
                        ) : (
                          <span>No streak active</span>
                        )
                      }
                    />

                    {/* Red Streak */}
                    <StatCard
                      label="Red Streak"
                      icon={<TrendingDown className="w-4 h-4" />}
                      variant={
                        redStreak >= MAX_STREAK_LIMIT
                          ? "yellow"
                          : redStreak >= 3
                            ? "red"
                            : "default"
                      }
                      delay={0.1}
                      value={
                        <span
                          className={
                            redStreak >= MAX_STREAK_LIMIT
                              ? "text-candle-yellow"
                              : redStreak >= 3
                                ? "text-red-glow"
                                : ""
                          }
                        >
                          {redStreak >= MAX_STREAK_LIMIT && (
                            <span className="mr-1">⚠</span>
                          )}
                          {redStreak >= 3 && redStreak < MAX_STREAK_LIMIT && (
                            <span className="flame-bounce mr-1">🔻</span>
                          )}
                          {redStreak}
                        </span>
                      }
                      sub={
                        redStreak >= MAX_STREAK_LIMIT ? (
                          <span className="text-candle-yellow">
                            LIMIT REACHED — bets off
                          </span>
                        ) : redStreak >= 3 ? (
                          <span className="text-candle-red">
                            {redStreak} consecutive ▼
                          </span>
                        ) : redStreak > 0 ? (
                          <span>{redStreak} red so far</span>
                        ) : (
                          <span>No streak active</span>
                        )
                      }
                    />

                    {/* Total Bets */}
                    <StatCard
                      label="Total Bets"
                      icon={<Target className="w-4 h-4" />}
                      delay={0.15}
                      value={bets.length}
                      sub={
                        <div className="space-y-1">
                          <div>{resolvedBets.length} resolved</div>
                          <div>
                            {bets.filter((b) => !b.resolved).length} pending
                          </div>
                        </div>
                      }
                    />

                    {/* Win Rate */}
                    <StatCard
                      label="Win Rate"
                      icon={<Trophy className="w-4 h-4" />}
                      variant={
                        winRate >= 50
                          ? "green"
                          : winRate > 0
                            ? "red"
                            : "default"
                      }
                      delay={0.2}
                      value={
                        <span
                          className={
                            winRate >= 50
                              ? "text-green-glow"
                              : winRate > 0
                                ? "text-red-glow"
                                : ""
                          }
                        >
                          {resolvedBets.length > 0
                            ? `${winRate.toFixed(1)}%`
                            : "—"}
                        </span>
                      }
                      sub={
                        resolvedBets.length > 0 ? (
                          <span>
                            {wins.length}W / {resolvedBets.length - wins.length}
                            L
                          </span>
                        ) : (
                          <span>No resolved bets yet</span>
                        )
                      }
                    />
                  </div>

                  {/* Next Bet Preview */}
                  <AnimatePresence>
                    {(streak >= 3 || redStreak >= 3) && (
                      <NextBetPreview
                        key="next-bet"
                        greenStreak={streak}
                        redStreak={redStreak}
                        balance={config.balance}
                      />
                    )}
                  </AnimatePresence>

                  {/* Chart + Bet History grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                    {/* Candlestick Chart */}
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.2 }}
                      className="lg:col-span-2 terminal-card rounded-lg border border-border p-4"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <TrendingDown className="w-4 h-4 text-muted-foreground" />
                          <span className="mono text-xs tracking-widest text-muted-foreground uppercase">
                            BTC/USD · 15M
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm bg-candle-green opacity-80" />
                            <span className="mono text-xs text-muted-foreground">
                              Bull
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm bg-candle-red opacity-80" />
                            <span className="mono text-xs text-muted-foreground">
                              Bear
                            </span>
                          </div>
                        </div>
                      </div>

                      {candlesQuery.isLoading ? (
                        <div className="h-40 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 animate-spin text-candle-green" />
                        </div>
                      ) : (
                        <CandlestickChart candles={candles} />
                      )}

                      {/* Last candle info */}
                      {candles.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-x-4 gap-y-1">
                          {(() => {
                            const last = candles[candles.length - 1];
                            const isGreen = last.close > last.open;
                            return (
                              <>
                                <div>
                                  <span className="mono text-xs text-muted-foreground">
                                    OPEN{" "}
                                  </span>
                                  <span className="mono text-xs">
                                    {last.open.toFixed(2)}
                                  </span>
                                </div>
                                <div>
                                  <span className="mono text-xs text-muted-foreground">
                                    CLOSE{" "}
                                  </span>
                                  <span
                                    className={`mono text-xs ${isGreen ? "text-candle-green" : "text-candle-red"}`}
                                  >
                                    {last.close.toFixed(2)}
                                  </span>
                                </div>
                                <div>
                                  <span className="mono text-xs text-muted-foreground">
                                    HIGH{" "}
                                  </span>
                                  <span className="mono text-xs">
                                    {last.high.toFixed(2)}
                                  </span>
                                </div>
                                <div>
                                  <span className="mono text-xs text-muted-foreground">
                                    LOW{" "}
                                  </span>
                                  <span className="mono text-xs">
                                    {last.low.toFixed(2)}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </motion.div>

                    {/* Bet History */}
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.25 }}
                      className="lg:col-span-3 terminal-card rounded-lg border border-border p-4 flex flex-col"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-muted-foreground" />
                          <span className="mono text-xs tracking-widest text-muted-foreground uppercase">
                            Bet History
                          </span>
                        </div>
                        {bets.length > 0 && (
                          <Badge
                            variant="outline"
                            className="mono text-xs border-border text-muted-foreground"
                          >
                            {bets.length} total
                          </Badge>
                        )}
                      </div>

                      {betsQuery.isLoading ? (
                        <div className="flex-1 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 animate-spin text-candle-green" />
                        </div>
                      ) : bets.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center gap-2">
                          <div className="w-12 h-12 rounded border border-border flex items-center justify-center mb-2">
                            <Activity className="w-5 h-5 text-muted-foreground opacity-40" />
                          </div>
                          <p className="mono text-sm text-muted-foreground">
                            NO BETS PLACED YET
                          </p>
                          <p className="mono text-xs text-muted-foreground/60">
                            Bot places bets after 3+ consecutive green or red
                            candles
                          </p>
                        </div>
                      ) : (
                        <ScrollArea className="flex-1 max-h-72">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-border hover:bg-transparent">
                                <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2">
                                  Time
                                </TableHead>
                                <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2">
                                  Streak
                                </TableHead>
                                <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2">
                                  Amount
                                </TableHead>
                                <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2">
                                  Dir
                                </TableHead>
                                <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2">
                                  Result
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sortedBets.map((bet) => {
                                const tsMs = Number(bet.timestamp) / 1_000_000;
                                return (
                                  <TableRow
                                    key={bet.id.toString()}
                                    className="border-border hover:bg-secondary/30 transition-colors"
                                  >
                                    <TableCell className="py-2">
                                      <div className="mono text-xs text-foreground">
                                        {formatTime(tsMs)}
                                      </div>
                                      <div className="mono text-xs text-muted-foreground">
                                        {formatDate(tsMs)}
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-2">
                                      {bet.direction === "green" ? (
                                        <span className="mono text-xs text-candle-red font-bold">
                                          {Number(bet.streak)}🟥
                                        </span>
                                      ) : (
                                        <span className="mono text-xs text-candle-green font-bold">
                                          {Number(bet.streak)}🟩
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-2">
                                      <span className="mono text-xs font-bold text-foreground">
                                        {formatCurrency(bet.amount)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2">
                                      {bet.direction === "green" ? (
                                        <span className="mono text-xs text-green-glow font-bold">
                                          ▲ GREEN
                                        </span>
                                      ) : (
                                        <span className="mono text-xs text-red-glow font-bold">
                                          ▼ RED
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-2">
                                      <OutcomeBadge bet={bet} />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      )}
                    </motion.div>
                  </div>

                  {/* Settings */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowSettings((s) => !s)}
                      className="flex items-center gap-2 mono text-xs text-muted-foreground hover:text-foreground transition-colors py-2 group"
                    >
                      <Settings className="w-3.5 h-3.5 group-hover:text-candle-green transition-colors" />
                      <span className="tracking-widest uppercase">
                        Settings
                      </span>
                      {showSettings ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                    <AnimatePresence>
                      {showSettings && (
                        <SettingsPanel
                          currentBalance={config.balance}
                          cooldownActive={cooldownActive}
                          onClearCooldown={handleClearCooldown}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-8 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between flex-wrap gap-2">
          <div className="mono text-xs text-muted-foreground">
            <span className="text-candle-green/60">●</span> STRATEGY: 3-6 CANDLE
            MEAN REVERSION (GREEN↑ &amp; RED↓) · 7-CANDLE CAP · BTC/USD 15M
          </div>
          <div className="mono text-xs text-muted-foreground">
            © {new Date().getFullYear()}. Built with{" "}
            <span className="text-candle-red">♥</span> using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-candle-green hover:text-candle-green/80 transition-colors"
            >
              caffeine.ai
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
