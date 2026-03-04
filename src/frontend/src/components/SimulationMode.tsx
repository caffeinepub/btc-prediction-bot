import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DollarSign,
  OctagonX,
  Pause,
  Play,
  RefreshCw,
  ShieldOff,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimCandle {
  index: number;
  open: number;
  close: number;
  high: number;
  low: number;
}

interface SimBet {
  candleIndex: number;
  streakType: "green" | "red";
  streakLength: number;
  betDirection: "green" | "red";
  amount: number;
  outcome: "WIN" | "LOSS" | "PENDING";
  runningBalance: number;
}

interface SimStats {
  balance: number;
  pnl: number;
  totalBets: number;
  wins: number;
  losses: number;
  maxGreenStreak: number;
  maxRedStreak: number;
  currentCandle: number;
}

type SimSpeed = "fast" | "normal" | "slow";
type SimTimeframe = "12h" | "24h" | "48h";
type SimStatus = "idle" | "running" | "paused" | "complete" | "stopped";
type StopReason = "completed" | "stop-loss" | "streak-limit";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);
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

function getBetAmount(streak: number, balance: number): number | null {
  if (streak < 3 || streak > 6) return null;
  const mult = computeBetMultiplier(balance);
  const base =
    streak === 3 ? 100 : streak === 4 ? 300 : streak === 5 ? 900 : 2700;
  return Math.round(base * mult);
}

function generateCandles(startPrice: number, count: number): SimCandle[] {
  const candles: SimCandle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const open = price;
    // Random walk: ~0.3% std dev per candle (BTC-like 15m volatility)
    const move = open * (0.003 * (Math.random() * 2 - 1));
    const close = open + move;
    // Small wick randomness
    const wickRange = Math.abs(move) * (0.5 + Math.random() * 1.5);
    const high = Math.max(open, close) + wickRange * Math.random();
    const low = Math.min(open, close) - wickRange * Math.random();

    candles.push({ index: i, open, close, high, low });
    price = close;
  }

  return candles;
}

const SPEED_MS: Record<SimSpeed, number> = {
  fast: 80,
  normal: 250,
  slow: 600,
};

const TIMEFRAME_CANDLES: Record<SimTimeframe, number> = {
  "12h": 48,
  "24h": 96,
  "48h": 192,
};

// ─── Mini Candlestick Chart ───────────────────────────────────────────────────

function MiniCandlestickChart({ candles }: { candles: SimCandle[] }) {
  const last10 = candles.slice(-10);

  if (last10.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground mono text-xs">
        AWAITING CANDLES...
      </div>
    );
  }

  const allPrices = last10.flatMap((c) => [c.high, c.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice || 1;

  const svgHeight = 120;
  const svgPadding = 8;
  const chartHeight = svgHeight - svgPadding * 2;
  const candleWidth = 16;
  const wickWidth = 1.5;
  const gap = 7;
  const totalWidth = last10.length * (candleWidth + gap) + gap;

  function priceToY(p: number): number {
    return (
      svgPadding + chartHeight - ((p - minPrice) / priceRange) * chartHeight
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
        aria-label="Simulated BTC/USD candlestick chart"
      >
        <defs>
          <filter id="simGlowGreen">
            <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="simGlowRed">
            <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <line
            key={pct}
            x1="0"
            y1={svgPadding + chartHeight * (1 - pct)}
            x2={totalWidth}
            y2={svgPadding + chartHeight * (1 - pct)}
            stroke="oklch(0.70 0.22 145 / 0.07)"
            strokeWidth="1"
            strokeDasharray="3 3"
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
          const color = isGreen ? greenColor : redColor;

          return (
            <g key={candle.index}>
              <line
                x1={centerX}
                y1={wickTop}
                x2={centerX}
                y2={wickBottom}
                stroke={color}
                strokeWidth={wickWidth}
                opacity="0.7"
              />
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
                stroke={color}
                strokeWidth="0.5"
                filter={isGreen ? "url(#simGlowGreen)" : "url(#simGlowRed)"}
                rx="1"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Sim Stat Card ────────────────────────────────────────────────────────────

function SimStatCard({
  label,
  value,
  sub,
  icon,
  variant = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  variant?: "default" | "green" | "red" | "yellow";
}) {
  const borderClass =
    variant === "green"
      ? "border-candle-green/30"
      : variant === "red"
        ? "border-candle-red/30"
        : variant === "yellow"
          ? "border-candle-yellow/30"
          : "border-border";

  return (
    <motion.div
      layout
      className={`terminal-card rounded-lg p-3 border ${borderClass} relative overflow-hidden`}
    >
      <div className="absolute top-0 right-0 w-6 h-6 border-t border-r border-candle-green/10 rounded-bl-md" />
      <div className="flex items-start justify-between mb-2">
        <span className="mono text-xs text-muted-foreground tracking-widest uppercase leading-none">
          {label}
        </span>
        <span className="text-muted-foreground opacity-50">{icon}</span>
      </div>
      <div className="mono text-xl font-bold text-foreground leading-none">
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 mono text-xs text-muted-foreground">{sub}</div>
      )}
    </motion.div>
  );
}

// ─── Summary Panel ────────────────────────────────────────────────────────────

function SummaryPanel({
  stats,
  reason,
  totalCandles,
  timeframeLabel,
  onRunAgain,
}: {
  stats: SimStats;
  startingBalance?: number;
  reason: StopReason;
  totalCandles: number;
  timeframeLabel: string;
  onRunAgain: () => void;
}) {
  const winRate =
    stats.totalBets > 0 ? (stats.wins / stats.totalBets) * 100 : 0;
  const isProfit = stats.pnl >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="terminal-card rounded-lg border p-6 relative overflow-hidden"
      style={{
        borderColor:
          reason === "stop-loss"
            ? "oklch(0.62 0.22 22 / 0.5)"
            : reason === "streak-limit"
              ? "oklch(0.85 0.18 85 / 0.5)"
              : "oklch(0.70 0.22 145 / 0.4)",
        boxShadow:
          reason === "stop-loss"
            ? "0 0 24px oklch(0.62 0.22 22 / 0.12), 0 4px 20px oklch(0 0 0 / 0.4)"
            : reason === "streak-limit"
              ? "0 0 24px oklch(0.85 0.18 85 / 0.12), 0 4px 20px oklch(0 0 0 / 0.4)"
              : "0 0 24px oklch(0.70 0.22 145 / 0.12), 0 4px 20px oklch(0 0 0 / 0.4)",
      }}
    >
      {/* Corner brackets */}
      <div
        className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2"
        style={{
          borderColor:
            reason === "stop-loss"
              ? "oklch(0.62 0.22 22 / 0.8)"
              : reason === "streak-limit"
                ? "oklch(0.85 0.18 85 / 0.8)"
                : "oklch(0.70 0.22 145 / 0.8)",
        }}
      />
      <div
        className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2"
        style={{
          borderColor:
            reason === "stop-loss"
              ? "oklch(0.62 0.22 22 / 0.8)"
              : reason === "streak-limit"
                ? "oklch(0.85 0.18 85 / 0.8)"
                : "oklch(0.70 0.22 145 / 0.8)",
        }}
      />
      <div
        className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2"
        style={{
          borderColor:
            reason === "stop-loss"
              ? "oklch(0.62 0.22 22 / 0.8)"
              : reason === "streak-limit"
                ? "oklch(0.85 0.18 85 / 0.8)"
                : "oklch(0.70 0.22 145 / 0.8)",
        }}
      />
      <div
        className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2"
        style={{
          borderColor:
            reason === "stop-loss"
              ? "oklch(0.62 0.22 22 / 0.8)"
              : reason === "streak-limit"
                ? "oklch(0.85 0.18 85 / 0.8)"
                : "oklch(0.70 0.22 145 / 0.8)",
        }}
      />

      <div className="text-center mb-6">
        <div
          className="mono text-xs tracking-widest uppercase mb-2"
          style={{
            color:
              reason === "stop-loss"
                ? "oklch(0.62 0.22 22)"
                : reason === "streak-limit"
                  ? "oklch(0.85 0.18 85)"
                  : "oklch(0.70 0.22 145)",
          }}
        >
          {reason === "stop-loss"
            ? "⚠ SIMULATION HALTED"
            : reason === "streak-limit"
              ? "⚠ SIMULATION HALTED — 7-CANDLE LIMIT"
              : "✓ SIMULATION COMPLETE"}
        </div>
        <div className="mono text-xs text-muted-foreground">
          {reason === "stop-loss"
            ? "Stop-loss triggered — session losses exceeded dynamic limit"
            : reason === "streak-limit"
              ? `${MAX_STREAK_LIMIT} consecutive candles reached — bot auto-disabled at candle #${stats.currentCandle}`
              : `All ${totalCandles} candles (${timeframeLabel}) processed`}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <div className="terminal-card rounded p-3 text-center border border-border">
          <div className="mono text-xs text-muted-foreground mb-1 tracking-widest">
            FINAL BALANCE
          </div>
          <div
            className={`mono text-lg font-bold ${isProfit ? "text-green-glow" : "text-red-glow"}`}
          >
            {formatCurrency(stats.balance)}
          </div>
        </div>
        <div className="terminal-card rounded p-3 text-center border border-border">
          <div className="mono text-xs text-muted-foreground mb-1 tracking-widest">
            TOTAL P&L
          </div>
          <div
            className={`mono text-lg font-bold ${isProfit ? "text-green-glow" : "text-red-glow"}`}
          >
            {isProfit ? "+" : ""}
            {formatCurrency(stats.pnl)}
          </div>
        </div>
        <div className="terminal-card rounded p-3 text-center border border-border">
          <div className="mono text-xs text-muted-foreground mb-1 tracking-widest">
            WIN RATE
          </div>
          <div
            className={`mono text-lg font-bold ${winRate >= 50 ? "text-green-glow" : "text-red-glow"}`}
          >
            {stats.totalBets > 0 ? `${winRate.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="terminal-card rounded p-3 text-center border border-border">
          <div className="mono text-xs text-muted-foreground mb-1 tracking-widest">
            TOTAL BETS
          </div>
          <div className="mono text-lg font-bold text-foreground">
            {stats.totalBets}
          </div>
          <div className="mono text-xs text-muted-foreground">
            {stats.wins}W / {stats.losses}L
          </div>
        </div>
        <div className="terminal-card rounded p-3 text-center border border-border">
          <div className="mono text-xs text-muted-foreground mb-1 tracking-widest">
            MAX GREEN
          </div>
          <div className="mono text-lg font-bold text-candle-green">
            {stats.maxGreenStreak}
          </div>
          <div className="mono text-xs text-muted-foreground">consecutive</div>
        </div>
        <div className="terminal-card rounded p-3 text-center border border-border">
          <div className="mono text-xs text-muted-foreground mb-1 tracking-widest">
            MAX RED
          </div>
          <div className="mono text-lg font-bold text-candle-red">
            {stats.maxRedStreak}
          </div>
          <div className="mono text-xs text-muted-foreground">consecutive</div>
        </div>
      </div>

      <div className="flex justify-center">
        <Button
          onClick={onRunAgain}
          className="mono border border-candle-green/50 text-candle-green hover:bg-candle-green/10 bg-candle-green/5 px-8"
          variant="outline"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          RUN AGAIN
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Main SimulationMode Component ───────────────────────────────────────────

export default function SimulationMode() {
  // Config inputs
  const [startingBalance, setStartingBalance] = useState(15000);
  const [startingPrice, setStartingPrice] = useState(65000);
  const [speed, setSpeed] = useState<SimSpeed>("normal");
  const [timeframe, setTimeframe] = useState<SimTimeframe>("12h");

  const totalCandles = TIMEFRAME_CANDLES[timeframe];
  const totalCandlesRef = useRef(totalCandles);
  useEffect(() => {
    totalCandlesRef.current = totalCandles;
  }, [totalCandles]);

  // Sim state
  const [status, setStatus] = useState<SimStatus>("idle");
  const [_candles, setCandles] = useState<SimCandle[]>([]);
  const [playedCandles, setPlayedCandles] = useState<SimCandle[]>([]);
  const [bets, setBets] = useState<SimBet[]>([]);
  const [stats, setStats] = useState<SimStats>({
    balance: startingBalance,
    pnl: 0,
    totalBets: 0,
    wins: 0,
    losses: 0,
    maxGreenStreak: 0,
    maxRedStreak: 0,
    currentCandle: 0,
  });
  const [stopReason, setStopReason] = useState<StopReason>("completed");

  // Internal sim references
  const simStateRef = useRef({
    balance: startingBalance,
    greenStreak: 0,
    redStreak: 0,
    maxGreen: 0,
    maxRed: 0,
    totalBets: 0,
    wins: 0,
    losses: 0,
    bets: [] as SimBet[],
    triggeredStreaks: new Set<string>(),
    streakLimitPaused: false,
    streakPausedColor: null as "green" | "red" | null,
    restartWatchCount: 0,
  });

  // Display state for restart-watch banner in sim
  const [simRestartWatch, setSimRestartWatch] = useState<{
    active: boolean;
    pausedColor: "green" | "red" | null;
    count: number;
  }>({ active: false, pausedColor: null, count: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const candleIndexRef = useRef(0);
  const candlesRef = useRef<SimCandle[]>([]);

  function resetSimState(balance: number) {
    simStateRef.current = {
      balance,
      greenStreak: 0,
      redStreak: 0,
      maxGreen: 0,
      maxRed: 0,
      totalBets: 0,
      wins: 0,
      losses: 0,
      bets: [],
      triggeredStreaks: new Set<string>(),
      streakLimitPaused: false,
      streakPausedColor: null,
      restartWatchCount: 0,
    };
    setSimRestartWatch({ active: false, pausedColor: null, count: 0 });
  }

  function buildInitialStats(balance: number): SimStats {
    return {
      balance,
      pnl: 0,
      totalBets: 0,
      wins: 0,
      losses: 0,
      maxGreenStreak: 0,
      maxRedStreak: 0,
      currentCandle: 0,
    };
  }

  const stopIntervalFn = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Stable refs for config values used inside stepCandle interval
  const startingBalanceRef = useRef(startingBalance);
  useEffect(() => {
    startingBalanceRef.current = startingBalance;
  }, [startingBalance]);

  const stepCandle = useCallback(() => {
    const idx = candleIndexRef.current;
    const allCandles = candlesRef.current;
    const currentStartingBalance = startingBalanceRef.current;

    if (idx >= allCandles.length) {
      stopIntervalFn();
      setStatus("complete");
      setStopReason("completed");
      return;
    }

    const candle = allCandles[idx];
    const sim = simStateRef.current;
    const isGreen = candle.close > candle.open;

    // Update streaks
    if (isGreen) {
      sim.greenStreak += 1;
      sim.redStreak = 0;
    } else {
      sim.redStreak += 1;
      sim.greenStreak = 0;
    }
    sim.maxGreen = Math.max(sim.maxGreen, sim.greenStreak);
    sim.maxRed = Math.max(sim.maxRed, sim.redStreak);

    // Resolve any pending bet from the PREVIOUS candle
    const pendingBetIndex = sim.bets.findIndex((b) => b.outcome === "PENDING");
    if (pendingBetIndex !== -1) {
      const bet = sim.bets[pendingBetIndex];
      const won = bet.betDirection === (isGreen ? "green" : "red");
      const delta = won ? bet.amount : -bet.amount;
      sim.balance += delta;
      if (won) sim.wins++;
      else sim.losses++;
      bet.outcome = won ? "WIN" : "LOSS";
      bet.runningBalance = sim.balance;
    }

    // Place a new bet if current streak triggers one
    const checkStreakBet = (
      streak: number,
      streakType: "green" | "red",
      betDirection: "red" | "green",
    ) => {
      if (streak >= 3) {
        const milestone = Math.min(streak, 6);
        const key = `${streakType}-${idx}-${milestone}`;
        if (
          !sim.triggeredStreaks.has(key) &&
          getBetAmount(streak, sim.balance) !== null
        ) {
          const amount = getBetAmount(streak, sim.balance)!;
          sim.triggeredStreaks.add(key);
          const newBet: SimBet = {
            candleIndex: idx + 1,
            streakType,
            streakLength: streak,
            betDirection,
            amount,
            outcome: "PENDING",
            runningBalance: sim.balance,
          };
          sim.bets.push(newBet);
          sim.totalBets++;
        }
      }
    };

    if (isGreen) {
      checkStreakBet(sim.greenStreak, "green", "red");
    } else {
      checkStreakBet(sim.redStreak, "red", "green");
    }

    // Check stop-loss using dynamic session loss limit
    if (
      sim.balance <
      currentStartingBalance - computeSessionLossLimit(currentStartingBalance)
    ) {
      const finalStats: SimStats = {
        balance: sim.balance,
        pnl: sim.balance - currentStartingBalance,
        totalBets: sim.totalBets,
        wins: sim.wins,
        losses: sim.losses,
        maxGreenStreak: sim.maxGreen,
        maxRedStreak: sim.maxRed,
        currentCandle: idx + 1,
      };
      setStats(finalStats);
      setBets([...sim.bets]);
      setPlayedCandles(allCandles.slice(0, idx + 1));
      candleIndexRef.current = idx + 1;
      stopIntervalFn();
      setStatus("stopped");
      setStopReason("stop-loss");
      return;
    }

    // Check 7-candle streak limit — enter restart-watch mode (don't halt immediately)
    if (
      (sim.greenStreak >= MAX_STREAK_LIMIT ||
        sim.redStreak >= MAX_STREAK_LIMIT) &&
      !sim.streakLimitPaused
    ) {
      sim.streakLimitPaused = true;
      sim.streakPausedColor =
        sim.greenStreak >= MAX_STREAK_LIMIT ? "green" : "red";
      sim.restartWatchCount = 0;
      setSimRestartWatch({
        active: true,
        pausedColor: sim.streakPausedColor,
        count: 0,
      });
    }

    // If in restart-watch mode, count consecutive opposite candles
    if (sim.streakLimitPaused && sim.streakPausedColor) {
      const oppositeIsGreen = sim.streakPausedColor === "red";
      const currentIsOpposite = oppositeIsGreen ? isGreen : !isGreen;

      if (currentIsOpposite) {
        sim.restartWatchCount += 1;
      } else {
        sim.restartWatchCount = 0; // reset count if streak breaks
      }

      setSimRestartWatch({
        active: true,
        pausedColor: sim.streakPausedColor,
        count: sim.restartWatchCount,
      });

      if (sim.restartWatchCount >= 3) {
        // Resume normal betting — reset paused state and streak counters
        sim.streakLimitPaused = false;
        sim.streakPausedColor = null;
        sim.restartWatchCount = 0;
        // Set streak to reflect the 3 candles just formed
        sim.greenStreak = isGreen ? sim.restartWatchCount : 0;
        sim.redStreak = isGreen ? 0 : sim.restartWatchCount;
        // Use the actual current candle direction for clean restart
        sim.greenStreak = isGreen ? 3 : 0;
        sim.redStreak = isGreen ? 0 : 3;
        setSimRestartWatch({ active: false, pausedColor: null, count: 0 });
      } else {
        // Still paused — update display but skip bet placement
        const updatedStats: SimStats = {
          balance: sim.balance,
          pnl: sim.balance - currentStartingBalance,
          totalBets: sim.totalBets,
          wins: sim.wins,
          losses: sim.losses,
          maxGreenStreak: sim.maxGreen,
          maxRedStreak: sim.maxRed,
          currentCandle: idx + 1,
        };
        candleIndexRef.current = idx + 1;
        setStats(updatedStats);
        setBets([...sim.bets]);
        setPlayedCandles(allCandles.slice(0, idx + 1));

        // If we've run out of candles while paused, halt with streak-limit reason
        if (idx + 1 >= allCandles.length) {
          stopIntervalFn();
          setStatus("stopped");
          setStopReason("streak-limit");
        }
        return;
      }
    }

    // Update display state
    const updatedStats: SimStats = {
      balance: sim.balance,
      pnl: sim.balance - currentStartingBalance,
      totalBets: sim.totalBets,
      wins: sim.wins,
      losses: sim.losses,
      maxGreenStreak: sim.maxGreen,
      maxRedStreak: sim.maxRed,
      currentCandle: idx + 1,
    };

    candleIndexRef.current = idx + 1;
    setStats(updatedStats);
    setBets([...sim.bets]);
    setPlayedCandles(allCandles.slice(0, idx + 1));

    // Check complete
    if (idx + 1 >= allCandles.length) {
      stopIntervalFn();
      setStatus("complete");
      setStopReason("completed");
    }
  }, [stopIntervalFn]);

  function handleStart() {
    if (status === "paused") {
      setStatus("running");
      intervalRef.current = setInterval(stepCandle, SPEED_MS[speed]);
      return;
    }

    // Fresh start
    const newCandles = generateCandles(startingPrice, totalCandlesRef.current);
    candlesRef.current = newCandles;
    candleIndexRef.current = 0;
    resetSimState(startingBalance);
    setCandles(newCandles);
    setPlayedCandles([]);
    setBets([]);
    setStats(buildInitialStats(startingBalance));
    setStatus("running");

    intervalRef.current = setInterval(stepCandle, SPEED_MS[speed]);
  }

  function handlePause() {
    stopIntervalFn();
    setStatus("paused");
  }

  function handleReset() {
    stopIntervalFn();
    candleIndexRef.current = 0;
    candlesRef.current = [];
    resetSimState(startingBalance);
    setCandles([]);
    setPlayedCandles([]);
    setBets([]);
    setStats(buildInitialStats(startingBalance));
    setStatus("idle");
    setSimRestartWatch({ active: false, pausedColor: null, count: 0 });
  }

  function handleRunAgain() {
    stopIntervalFn();
    candleIndexRef.current = 0;
    const newCandles = generateCandles(startingPrice, totalCandlesRef.current);
    candlesRef.current = newCandles;
    resetSimState(startingBalance);
    setCandles(newCandles);
    setPlayedCandles([]);
    setBets([]);
    setStats(buildInitialStats(startingBalance));
    setStatus("running");
    setSimRestartWatch({ active: false, pausedColor: null, count: 0 });
    intervalRef.current = setInterval(stepCandle, SPEED_MS[speed]);
  }

  // Update interval when speed changes while running
  useEffect(() => {
    if (status === "running") {
      stopIntervalFn();
      intervalRef.current = setInterval(stepCandle, SPEED_MS[speed]);
    }
  }, [speed, status, stopIntervalFn, stepCandle]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopIntervalFn();
  }, [stopIntervalFn]);

  const progress = (stats.currentCandle / totalCandles) * 100;
  const isRunning = status === "running";
  const isPaused = status === "paused";
  const isIdle = status === "idle";
  const isDone = status === "complete" || status === "stopped";
  const winRate =
    stats.totalBets > 0 ? (stats.wins / stats.totalBets) * 100 : 0;

  // Current streak for display
  const sim = simStateRef.current;
  const displayGreenStreak = isIdle ? 0 : sim.greenStreak;
  const displayRedStreak = isIdle ? 0 : sim.redStreak;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-5"
    >
      {/* Controls Panel */}
      <div className="terminal-card rounded-lg border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-candle-yellow" />
          <span className="mono text-xs tracking-widest text-muted-foreground uppercase">
            Simulation Configuration
          </span>
          {(isRunning || isPaused) && (
            <span className="mono text-xs text-candle-yellow ticker-blink ml-2">
              ● {isPaused ? "PAUSED" : "RUNNING"}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {/* Starting Balance */}
          <div className="space-y-1.5">
            <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
              Start Balance
            </Label>
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="number"
                value={startingBalance}
                onChange={(e) => setStartingBalance(Number(e.target.value))}
                disabled={isRunning || isPaused}
                className="pl-8 mono bg-secondary/50 border-border text-foreground h-8 text-sm"
                placeholder="15000"
                data-ocid="sim.input"
              />
            </div>
          </div>

          {/* BTC Start Price */}
          <div className="space-y-1.5">
            <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
              BTC Price
            </Label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 mono text-xs text-muted-foreground">
                ₿
              </span>
              <Input
                type="number"
                value={startingPrice}
                onChange={(e) => setStartingPrice(Number(e.target.value))}
                disabled={isRunning || isPaused}
                className="pl-7 mono bg-secondary/50 border-border text-foreground h-8 text-sm"
                placeholder="65000"
              />
            </div>
          </div>

          {/* Speed */}
          <div className="space-y-1.5">
            <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
              Speed
            </Label>
            <Select
              value={speed}
              onValueChange={(v) => setSpeed(v as SimSpeed)}
            >
              <SelectTrigger className="mono bg-secondary/50 border-border text-foreground h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="mono bg-card border-border">
                <SelectItem value="fast" className="mono text-sm">
                  Fast (80ms)
                </SelectItem>
                <SelectItem value="normal" className="mono text-sm">
                  Normal (250ms)
                </SelectItem>
                <SelectItem value="slow" className="mono text-sm">
                  Slow (600ms)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Timeframe */}
          <div className="space-y-1.5">
            <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
              Timeframe
            </Label>
            <Select
              value={timeframe}
              onValueChange={(v) => setTimeframe(v as SimTimeframe)}
              disabled={isRunning || isPaused}
            >
              <SelectTrigger
                className="mono bg-secondary/50 border-border text-foreground h-8 text-sm"
                data-ocid="sim.select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="mono bg-card border-border">
                <SelectItem value="12h" className="mono text-sm">
                  12 Hours (48)
                </SelectItem>
                <SelectItem value="24h" className="mono text-sm">
                  24 Hours (96)
                </SelectItem>
                <SelectItem value="48h" className="mono text-sm">
                  48 Hours (192)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          {isIdle && (
            <Button
              onClick={handleStart}
              className="mono border border-candle-green/50 text-candle-green hover:bg-candle-green/10 bg-candle-green/5 h-8 px-4 text-xs"
              variant="outline"
            >
              <Play className="w-3.5 h-3.5 mr-2" />
              RUN SIMULATION
            </Button>
          )}
          {isRunning && (
            <Button
              onClick={handlePause}
              className="mono border border-candle-yellow/50 text-candle-yellow hover:bg-candle-yellow/10 bg-candle-yellow/5 h-8 px-4 text-xs"
              variant="outline"
            >
              <Pause className="w-3.5 h-3.5 mr-2" />
              PAUSE
            </Button>
          )}
          {isPaused && (
            <Button
              onClick={handleStart}
              className="mono border border-candle-green/50 text-candle-green hover:bg-candle-green/10 bg-candle-green/5 h-8 px-4 text-xs"
              variant="outline"
            >
              <Play className="w-3.5 h-3.5 mr-2" />
              RESUME
            </Button>
          )}
          {!isIdle && (
            <Button
              onClick={handleReset}
              className="mono border border-border text-muted-foreground hover:border-candle-red/30 hover:text-candle-red h-8 px-4 text-xs"
              variant="outline"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-2" />
              RESET
            </Button>
          )}

          {/* Progress */}
          {!isIdle && (
            <div className="flex items-center gap-3 flex-1 min-w-48">
              <span className="mono text-xs text-muted-foreground whitespace-nowrap">
                {stats.currentCandle} / {totalCandles}
              </span>
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "oklch(0.70 0.22 145)" }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
              <span className="mono text-xs text-candle-green whitespace-nowrap">
                {progress.toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Summary Panel (shown when complete or stopped) */}
      <AnimatePresence>
        {isDone && (
          <SummaryPanel
            key="summary"
            stats={stats}
            startingBalance={startingBalance}
            reason={stopReason}
            totalCandles={totalCandles}
            timeframeLabel={timeframe}
            onRunAgain={handleRunAgain}
          />
        )}
      </AnimatePresence>

      {/* Live Stats */}
      {!isIdle && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {/* Restart-watch banner */}
          <AnimatePresence>
            {simRestartWatch.active && (
              <motion.div
                key="sim-restart-watch"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="mb-3 flex items-center gap-3 rounded-lg border border-candle-yellow/40 bg-candle-yellow/8 px-4 py-2.5"
                style={{
                  background: "oklch(0.85 0.18 85 / 0.06)",
                  boxShadow: "0 0 12px oklch(0.85 0.18 85 / 0.08)",
                }}
              >
                <OctagonX className="w-4 h-4 text-candle-yellow flex-shrink-0" />
                <div className="flex-1 flex items-center gap-3 flex-wrap">
                  <span className="mono text-xs text-candle-yellow font-bold tracking-wide">
                    STREAK PAUSED
                  </span>
                  <span className="mono text-xs text-candle-yellow/70">
                    Watching for 3{" "}
                    {simRestartWatch.pausedColor === "green" ? "red" : "green"}{" "}
                    candles to resume betting
                  </span>
                  {/* Progress dots */}
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3].map((n) => (
                      <div
                        key={n}
                        className="w-2.5 h-2.5 rounded-full border transition-all duration-200"
                        style={{
                          borderColor:
                            simRestartWatch.pausedColor === "green"
                              ? "oklch(0.62 0.22 22 / 0.8)"
                              : "oklch(0.70 0.22 145 / 0.8)",
                          background:
                            simRestartWatch.count >= n
                              ? simRestartWatch.pausedColor === "green"
                                ? "oklch(0.62 0.22 22 / 0.7)"
                                : "oklch(0.70 0.22 145 / 0.7)"
                              : "transparent",
                        }}
                      />
                    ))}
                  </div>
                  <span className="mono text-xs text-candle-yellow/60">
                    {simRestartWatch.count}/3
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <SimStatCard
              label="Balance"
              icon={<DollarSign className="w-3.5 h-3.5" />}
              variant={stats.pnl >= 0 ? "green" : "red"}
              value={
                <span
                  className={
                    stats.pnl >= 0 ? "text-green-glow" : "text-red-glow"
                  }
                >
                  {formatCurrency(stats.balance)}
                </span>
              }
              sub={
                <span
                  className={
                    stats.pnl >= 0 ? "text-candle-green" : "text-candle-red"
                  }
                >
                  {stats.pnl >= 0 ? "+" : ""}
                  {formatCurrency(stats.pnl)}
                </span>
              }
            />
            <SimStatCard
              label="P&L"
              icon={<Activity className="w-3.5 h-3.5" />}
              variant={stats.pnl >= 0 ? "green" : "red"}
              value={
                <span
                  className={
                    stats.pnl >= 0 ? "text-green-glow" : "text-red-glow"
                  }
                >
                  {stats.pnl >= 0 ? "+" : ""}
                  {formatCurrency(stats.pnl)}
                </span>
              }
            />
            <SimStatCard
              label="Multiplier"
              icon={<Zap className="w-3.5 h-3.5" />}
              variant="yellow"
              value={
                <span className="text-candle-yellow">
                  {computeBetMultiplier(stats.balance).toFixed(2)}x
                </span>
              }
              sub={
                <span className="text-muted-foreground">
                  +10% / $1K &gt; $10K
                </span>
              }
            />
            <SimStatCard
              label="Bets"
              icon={<Target className="w-3.5 h-3.5" />}
              value={<span>{stats.totalBets}</span>}
              sub={
                <span>
                  {stats.wins}W / {stats.losses}L
                </span>
              }
            />
            <SimStatCard
              label="Win Rate"
              icon={<Trophy className="w-3.5 h-3.5" />}
              variant={
                winRate >= 50
                  ? "green"
                  : stats.totalBets > 0
                    ? "red"
                    : "default"
              }
              value={
                <span
                  className={
                    winRate >= 50
                      ? "text-green-glow"
                      : stats.totalBets > 0
                        ? "text-red-glow"
                        : ""
                  }
                >
                  {stats.totalBets > 0 ? `${winRate.toFixed(1)}%` : "—"}
                </span>
              }
            />
            <SimStatCard
              label="Green Streak"
              icon={<BarChart2 className="w-3.5 h-3.5" />}
              variant={displayGreenStreak >= 3 ? "green" : "default"}
              value={
                <span
                  className={displayGreenStreak >= 3 ? "text-green-glow" : ""}
                >
                  {displayGreenStreak >= 3 && (
                    <span className="flame-bounce mr-1">🔥</span>
                  )}
                  {displayGreenStreak}
                </span>
              }
              sub={<span>Max: {stats.maxGreenStreak}</span>}
            />
            <SimStatCard
              label="Red Streak"
              icon={<ShieldOff className="w-3.5 h-3.5" />}
              variant={displayRedStreak >= 3 ? "red" : "default"}
              value={
                <span className={displayRedStreak >= 3 ? "text-red-glow" : ""}>
                  {displayRedStreak >= 3 && (
                    <span className="flame-bounce mr-1">🔻</span>
                  )}
                  {displayRedStreak}
                </span>
              }
              sub={<span>Max: {stats.maxRedStreak}</span>}
            />
          </div>
        </motion.div>
      )}

      {/* Chart + Trade Log grid */}
      {!isIdle && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Mini Chart */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="lg:col-span-2 terminal-card rounded-lg border border-border p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <span className="mono text-xs tracking-widest text-muted-foreground uppercase">
                  BTC/USD · SIM · 15M
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm bg-candle-green opacity-80" />
                  <span className="mono text-xs text-muted-foreground">
                    Bull
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm bg-candle-red opacity-80" />
                  <span className="mono text-xs text-muted-foreground">
                    Bear
                  </span>
                </div>
              </div>
            </div>
            <MiniCandlestickChart candles={playedCandles} />
            {playedCandles.length > 0 &&
              (() => {
                const last = playedCandles[playedCandles.length - 1];
                const isGreen = last.close > last.open;
                return (
                  <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-x-4 gap-y-1">
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
                  </div>
                );
              })()}
          </motion.div>

          {/* Trade Log */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.15 }}
            className="lg:col-span-3 terminal-card rounded-lg border border-border p-4 flex flex-col"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <span className="mono text-xs tracking-widest text-muted-foreground uppercase">
                  Trade Log
                </span>
              </div>
              {bets.length > 0 && (
                <span className="mono text-xs text-muted-foreground border border-border rounded px-2 py-0.5">
                  {bets.length} trades
                </span>
              )}
            </div>

            {bets.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-8 text-center gap-2">
                <div className="w-10 h-10 rounded border border-border flex items-center justify-center mb-1 opacity-40">
                  <Target className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="mono text-sm text-muted-foreground">
                  NO TRADES YET
                </p>
                <p className="mono text-xs text-muted-foreground/60">
                  Bets placed after 3+ consecutive candles
                </p>
              </div>
            ) : (
              <ScrollArea className="flex-1 max-h-72">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 px-2">
                        Candle
                      </TableHead>
                      <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 px-2">
                        Streak
                      </TableHead>
                      <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 px-2">
                        Len
                      </TableHead>
                      <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 px-2">
                        Bet
                      </TableHead>
                      <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 px-2">
                        Amount
                      </TableHead>
                      <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 px-2">
                        Result
                      </TableHead>
                      <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 px-2">
                        Balance
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...bets].reverse().map((bet, i) => (
                      <TableRow
                        key={`${bet.candleIndex}-${i}`}
                        className="border-border hover:bg-secondary/30 transition-colors"
                      >
                        <TableCell className="py-1.5 px-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="mono text-xs text-muted-foreground">
                              #{bet.candleIndex}
                            </span>
                            {/* 30s delay annotation — all sim bets are logically delayed from candle open */}
                            <span
                              className="inline-flex items-center px-1 py-0 rounded text-candle-yellow/70 border border-candle-yellow/25 bg-candle-yellow/5"
                              style={{
                                fontSize: "9px",
                                fontFamily: "monospace",
                                lineHeight: "1.4",
                              }}
                            >
                              +30s
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-1.5 px-2">
                          {bet.streakType === "green" ? (
                            <span className="mono text-xs text-candle-green">
                              🟩
                            </span>
                          ) : (
                            <span className="mono text-xs text-candle-red">
                              🟥
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 px-2">
                          <span className="mono text-xs text-foreground font-bold">
                            {bet.streakLength}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5 px-2">
                          {bet.betDirection === "green" ? (
                            <span className="mono text-xs text-green-glow font-bold">
                              ▲ GREEN
                            </span>
                          ) : (
                            <span className="mono text-xs text-red-glow font-bold">
                              ▼ RED
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 px-2">
                          <span className="mono text-xs font-bold text-foreground">
                            {formatCurrency(bet.amount)}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5 px-2">
                          {bet.outcome === "PENDING" ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs mono font-semibold text-candle-yellow border border-candle-yellow/40 bg-candle-yellow/10">
                              PENDING
                            </span>
                          ) : bet.outcome === "WIN" ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs mono font-semibold text-candle-green border border-candle-green/40 bg-candle-green/10">
                              WIN
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs mono font-semibold text-candle-red border border-candle-red/40 bg-candle-red/10">
                              LOSS
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 px-2">
                          <span
                            className={`mono text-xs ${bet.runningBalance >= startingBalance ? "text-candle-green" : "text-candle-red"}`}
                          >
                            {formatCurrency(bet.runningBalance)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </motion.div>
        </div>
      )}

      {/* Idle state */}
      {isIdle && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="terminal-card rounded-lg border border-border p-12 text-center"
        >
          <div className="w-16 h-16 rounded border border-candle-green/20 flex items-center justify-center mx-auto mb-4 bg-candle-green/5">
            <Zap className="w-7 h-7 text-candle-green opacity-60" />
          </div>
          <p className="mono text-sm text-muted-foreground mb-2">
            SIMULATION READY
          </p>
          <p className="mono text-xs text-muted-foreground/60 mb-6">
            Configure parameters above and click RUN SIMULATION to generate{" "}
            {totalCandles} candles ({timeframe}) of synthetic BTC price action
          </p>
          <div className="inline-flex items-center gap-2 text-xs mono text-muted-foreground border border-border rounded px-3 py-1.5">
            <span className="text-candle-green/60">●</span>
            <span>
              STRATEGY: 3-6 CANDLE MEAN REVERSION · DYNAMIC BET SIZING ·
              7-CANDLE CAP · 30s ENTRY DELAY
            </span>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
