import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { useKalshiConfig } from "../hooks/useQueries";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KalshiMarket {
  ticker: string;
  title: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  status: string;
}

type ConnectionStatus = "idle" | "testing" | "connected" | "error";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `${"*".repeat(Math.max(key.length - 4, 8))}${key.slice(-4)}`;
}

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Build the proxied URL for various CORS proxy services.
 *
 * Supported formats:
 *   corsproxy.io          → https://corsproxy.io/?url=<encoded>
 *   allorigins.win        → https://api.allorigins.win/raw?url=<encoded>
 *   cors-anywhere style   → https://proxy.example.com/<target>
 *   ?url= style (generic) → https://proxy.example.com/?url=<encoded>
 */
function buildProxiedUrl(proxyUrl: string, targetUrl: string): string {
  const proxy = proxyUrl.trim().replace(/\/$/, "");
  if (!proxy) return targetUrl;

  // corsproxy.io — https://corsproxy.io/?url=<encoded>
  if (proxy.includes("corsproxy.io")) {
    const base = proxy.split("?")[0];
    return `${base}/?url=${encodeURIComponent(targetUrl)}`;
  }

  // allorigins.win — https://api.allorigins.win/raw?url=<encoded>
  if (proxy.includes("allorigins.win")) {
    const base = proxy.includes("api.allorigins.win")
      ? proxy.split("?")[0]
      : "https://api.allorigins.win/raw";
    return `${base}?url=${encodeURIComponent(targetUrl)}`;
  }

  // If proxy already contains ?url= pattern, just append encoded target
  if (proxy.includes("?url=")) {
    return `${proxy.split("?url=")[0]}?url=${encodeURIComponent(targetUrl)}`;
  }

  // Generic path-based proxy (e.g. cors-anywhere, local proxy)
  return `${proxy}/${targetUrl}`;
}

/**
 * Encode an ASN.1 TLV (tag + length + value) block.
 */
function asn1Tlv(tag: number, value: Uint8Array): Uint8Array {
  const len = value.length;
  let lengthBytes: Uint8Array;
  if (len < 0x80) {
    lengthBytes = new Uint8Array([len]);
  } else if (len < 0x100) {
    lengthBytes = new Uint8Array([0x81, len]);
  } else if (len < 0x10000) {
    lengthBytes = new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
  } else {
    lengthBytes = new Uint8Array([
      0x83,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
    ]);
  }
  const result = new Uint8Array(1 + lengthBytes.length + len);
  result[0] = tag;
  result.set(lengthBytes, 1);
  result.set(value, 1 + lengthBytes.length);
  return result;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

/**
 * Convert a PKCS#1 RSA private key DER buffer to PKCS#8 DER format.
 * Web Crypto only natively supports PKCS#8, so PKCS#1 keys must be wrapped.
 *
 * PKCS#8 structure:
 *   SEQUENCE {
 *     INTEGER 0                            (version)
 *     SEQUENCE { OID rsaEncryption, NULL } (algorithm)
 *     OCTET STRING { <pkcs1-der> }         (privateKey)
 *   }
 */
function pkcs1DerToPkcs8Der(pkcs1Der: Uint8Array): ArrayBuffer {
  // RSA algorithm identifier: SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01, // OID
    0x05,
    0x00, // NULL
  ]);

  const version = new Uint8Array([0x02, 0x01, 0x00]); // INTEGER 0
  const privateKeyOctetString = asn1Tlv(0x04, pkcs1Der);

  const inner = concatBytes(
    version,
    rsaAlgorithmIdentifier,
    privateKeyOctetString,
  );
  const pkcs8 = asn1Tlv(0x30, inner);

  return pkcs8.buffer as ArrayBuffer;
}

/**
 * Sign a Kalshi API request using RSA-SHA256 (PKCS#1 v1.5).
 * Kalshi requires: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE`.
 * Supports both PKCS#1 (-----BEGIN RSA PRIVATE KEY-----) and
 * PKCS#8 (-----BEGIN PRIVATE KEY-----) PEM formats.
 */
async function buildKalshiHeaders(
  apiKeyId: string,
  rsaPem: string,
  method: string,
  path: string,
): Promise<Record<string, string>> {
  const timestampMs = Date.now();

  // Import the RSA private key
  let cryptoKey: CryptoKey;
  try {
    // Normalise the PEM: trim whitespace, normalise line endings
    const pemNorm = rsaPem.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Detect key type from the PEM header
    const isPkcs1 = pemNorm.includes("BEGIN RSA PRIVATE KEY");
    const isPkcs8 = pemNorm.includes("BEGIN PRIVATE KEY");

    if (!isPkcs1 && !isPkcs8) {
      throw new Error(
        "Unrecognised PEM header. Expected -----BEGIN RSA PRIVATE KEY----- (PKCS#1) or -----BEGIN PRIVATE KEY----- (PKCS#8).",
      );
    }

    // Strip PEM headers/footers and decode base64
    const pemClean = pemNorm
      .replace(/-----BEGIN [^-]+-----/g, "")
      .replace(/-----END [^-]+-----/g, "")
      .replace(/\s+/g, "");

    let derBytes: Uint8Array;
    try {
      derBytes = Uint8Array.from(atob(pemClean), (c) => c.charCodeAt(0));
    } catch {
      throw new Error(
        "Base64 decode failed — the PEM body contains invalid characters. Make sure you copied the full unmodified key.",
      );
    }

    // Web Crypto only supports PKCS#8 natively.
    // If the key is PKCS#1, wrap it in a PKCS#8 envelope first.
    const keyBuffer = isPkcs1
      ? pkcs1DerToPkcs8Der(derBytes)
      : (derBytes.buffer as ArrayBuffer);

    cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to import RSA private key. ${detail}`);
  }

  // Message to sign: timestamp_ms (as string) + method (uppercase) + path
  const message = `${timestampMs}${method.toUpperCase()}${path}`;
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(message),
  );

  // Base64-encode the signature
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": apiKeyId,
    "KALSHI-ACCESS-TIMESTAMP": String(timestampMs),
    "KALSHI-ACCESS-SIGNATURE": sigBase64,
  };
}

// Sample markets shown when API is unreachable due to CORS
const SAMPLE_MARKETS: KalshiMarket[] = [
  {
    ticker: "KXBTC-25JAN15T",
    title: "Bitcoin above $95,000 at 3:15 PM?",
    yes_bid: 48,
    yes_ask: 52,
    no_bid: 48,
    no_ask: 52,
    volume: 12450,
    status: "open",
  },
  {
    ticker: "KXBTC-25JAN30T",
    title: "Bitcoin above $95,000 at 3:30 PM?",
    yes_bid: 47,
    yes_ask: 53,
    no_bid: 47,
    no_ask: 53,
    volume: 8920,
    status: "open",
  },
  {
    ticker: "KXBTC-25JAN45T",
    title: "Bitcoin above $95,000 at 3:45 PM?",
    yes_bid: 45,
    yes_ask: 55,
    no_bid: 45,
    no_ask: 55,
    volume: 6710,
    status: "open",
  },
  {
    ticker: "KXBTC-25JAN00T",
    title: "Bitcoin above $95,000 at 4:00 PM?",
    yes_bid: 44,
    yes_ask: 56,
    no_bid: 44,
    no_ask: 56,
    volume: 4830,
    status: "open",
  },
];

// ─── Status Badge ─────────────────────────────────────────────────────────────

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs mono font-bold text-candle-green border border-candle-green/40 bg-candle-green/10">
        <CheckCircle2 className="w-3 h-3" />
        CONNECTED
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs mono font-bold text-candle-red border border-candle-red/40 bg-candle-red/10">
        <XCircle className="w-3 h-3" />
        ERROR
      </span>
    );
  }
  if (status === "testing") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs mono font-bold text-candle-yellow border border-candle-yellow/40 bg-candle-yellow/10">
        <Loader2 className="w-3 h-3 animate-spin" />
        TESTING...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs mono font-bold text-muted-foreground border border-border bg-secondary/50">
      <Wifi className="w-3 h-3" />
      NOT TESTED
    </span>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="mono text-xs tracking-widest text-muted-foreground uppercase">
          {title}
        </span>
      </div>
      {badge}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KalshiPanel() {
  const {
    apiKey,
    apiEmail,
    rsaPrivateKey,
    proxyUrl,
    liveEnabled,
    selectedMarket,
    setCredentials,
    clearCredentials,
    setLiveEnabled,
    setSelectedMarket,
    setProxyUrl,
  } = useKalshiConfig();

  // Local form state
  const [keyInput, setKeyInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [rsaKeyInput, setRsaKeyInput] = useState("");
  const [proxyInput, setProxyInput] = useState(() => proxyUrl);
  const [showKey, setShowKey] = useState(false);
  const [showRsaKey, setShowRsaKey] = useState(false);

  // Connection state
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("idle");
  const [connMessage, setConnMessage] = useState("");
  const [connBalance, setConnBalance] = useState<number | null>(null);

  // Markets state
  const [markets, setMarkets] = useState<KalshiMarket[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsFromSample, setMarketsFromSample] = useState(false);

  const hasCredentials = apiKey.length > 0;
  const hasRsaKey = rsaPrivateKey.length > 0;

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleSaveCredentials() {
    if (!keyInput.trim()) {
      toast.error("API Key ID is required");
      return;
    }
    if (!emailInput.trim()) {
      toast.error("Email is required");
      return;
    }
    if (!rsaKeyInput.trim()) {
      toast.error("RSA Private Key is required");
      return;
    }
    setCredentials(keyInput.trim(), emailInput.trim(), rsaKeyInput.trim());
    setKeyInput("");
    setEmailInput("");
    setRsaKeyInput("");
    toast.success("Credentials saved to localStorage");
  }

  function handleClearCredentials() {
    clearCredentials();
    setConnStatus("idle");
    setConnMessage("");
    setConnBalance(null);
    setMarkets([]);
    setMarketsFromSample(false);
    toast.success("Credentials cleared");
  }

  async function handleTestConnection() {
    if (!hasCredentials) {
      toast.error("Save credentials first");
      return;
    }
    if (!hasRsaKey) {
      toast.error("RSA private key is required for authentication");
      return;
    }
    setConnStatus("testing");
    setConnMessage("");
    setConnBalance(null);

    const targetPath = "/trade-api/v2/portfolio/balance";
    const targetUrl = `https://trading-api.kalshi.com${targetPath}`;
    const finalUrl = buildProxiedUrl(proxyUrl, targetUrl);

    try {
      const headers = await buildKalshiHeaders(
        apiKey,
        rsaPrivateKey,
        "GET",
        targetPath,
      );

      const res = await fetch(finalUrl, {
        method: "GET",
        headers,
      });

      if (res.ok) {
        const data = await res.json();
        const balanceCents: number =
          data?.balance?.balance ?? data?.balance ?? 0;
        setConnBalance(balanceCents);
        setConnStatus("connected");
        setConnMessage(`Account balance: ${formatUSD(balanceCents)}`);
        toast.success("Connected to Kalshi successfully");
      } else if (res.status === 401) {
        setConnStatus("error");
        setConnMessage(
          "Invalid API credentials (401 Unauthorized) — double-check your API Key ID and that the RSA private key matches the key registered on Kalshi.",
        );
        toast.error("Invalid Kalshi API credentials");
      } else if (res.status === 403) {
        setConnStatus("error");
        setConnMessage(
          "Access forbidden (403) — your API key may not have trading permissions enabled on Kalshi.",
        );
        toast.error("Kalshi access forbidden (403)");
      } else {
        const body = await res.text().catch(() => "");
        setConnStatus("error");
        setConnMessage(
          `API returned status ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        );
        toast.error(`Kalshi API error: ${res.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("RSA") ||
        msg.includes("import") ||
        msg.includes("key")
      ) {
        setConnStatus("error");
        setConnMessage(
          `RSA key error: ${msg}. Make sure you paste the full PEM block including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines.`,
        );
      } else {
        const isProxySet = proxyUrl.trim().length > 0;
        setConnStatus("error");
        setConnMessage(
          isProxySet
            ? `Network request blocked through proxy (${proxyUrl.trim()}). Most free CORS proxies strip custom auth headers required by Kalshi. For reliable access, run a local proxy: install Node.js, then run: npx local-cors-proxy --proxyUrl https://trading-api.kalshi.com --port 8010 — then set your proxy URL to http://localhost:8010/proxy. Your credentials are saved correctly.`
            : "Network request blocked — Kalshi's API does not allow direct browser requests (CORS). Set the proxy URL field to https://corsproxy.io and try again. If that still fails, a local proxy gives the most reliable access.",
        );
      }
    }
  }

  async function handleRefreshMarkets() {
    if (!hasCredentials) {
      toast.error("Save credentials first");
      return;
    }
    setMarketsLoading(true);
    setMarketsFromSample(false);

    const targetPath =
      "/trade-api/v2/markets?limit=20&status=open&series_ticker=KXBTC";
    const targetUrl = `https://trading-api.kalshi.com${targetPath}`;
    const finalUrl = buildProxiedUrl(proxyUrl, targetUrl);

    try {
      const headers = hasRsaKey
        ? await buildKalshiHeaders(apiKey, rsaPrivateKey, "GET", targetPath)
        : {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          };

      const res = await fetch(finalUrl, { method: "GET", headers });

      if (res.ok) {
        const data = await res.json();
        const fetched: KalshiMarket[] = (data?.markets ?? []).map(
          (m: KalshiMarket) => ({
            ticker: m.ticker,
            title: m.title,
            yes_bid: m.yes_bid ?? 0,
            yes_ask: m.yes_ask ?? 0,
            no_bid: m.no_bid ?? 0,
            no_ask: m.no_ask ?? 0,
            volume: m.volume ?? 0,
            status: m.status ?? "open",
          }),
        );
        setMarkets(fetched);
        toast.success(`Loaded ${fetched.length} BTC markets`);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (_err) {
      // Fall back to sample data with CORS notice
      setMarkets(SAMPLE_MARKETS);
      setMarketsFromSample(true);
      toast.warning(
        "Using sample market data — real data requires server-side access",
      );
    } finally {
      setMarketsLoading(false);
    }
  }

  function handleToggleLive(enabled: boolean) {
    if (enabled && !hasCredentials) {
      toast.error("Save API credentials before enabling live trading");
      return;
    }
    setLiveEnabled(enabled);
    if (enabled) {
      toast.warning("LIVE MODE ENABLED — Real orders will be placed on Kalshi");
    } else {
      toast.success("Live trading disabled");
    }
  }

  const selectedMarketData = markets.find((m) => m.ticker === selectedMarket);
  const orderPreview = JSON.stringify(
    {
      action: "buy",
      type: "limit",
      ticker: selectedMarket || "[select a market above]",
      side: "yes",
      count: 1,
      yes_price: 50,
    },
    null,
    2,
  );

  return (
    <motion.div
      key="kalshi"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      {/* Page Title */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-3"
      >
        <div className="w-8 h-8 rounded border border-candle-yellow/50 flex items-center justify-center bg-candle-yellow/10">
          <ShieldCheck className="w-4 h-4 text-candle-yellow" />
        </div>
        <div>
          <h2 className="font-display font-bold text-foreground text-lg leading-none tracking-tight">
            Kalshi Integration
          </h2>
          <p className="mono text-xs text-muted-foreground mt-0.5">
            LIVE PREDICTION MARKET TRADING · KXBTC SERIES
          </p>
        </div>
        <div className="ml-auto">
          <ConnectionBadge status={connStatus} />
        </div>
      </motion.div>

      {/* ── API Credentials ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
        className="terminal-card rounded-lg border border-border p-5"
      >
        <SectionHeader
          icon={<Key className="w-4 h-4" />}
          title="API Credentials"
        />

        {hasCredentials ? (
          /* Saved credentials view */
          <div className="space-y-4">
            <div className="bg-candle-green/5 border border-candle-green/20 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-candle-green flex-shrink-0" />
                <span className="mono text-xs text-candle-green tracking-widest">
                  CREDENTIALS SAVED
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="mono text-xs text-muted-foreground w-14">
                    KEY ID
                  </span>
                  <span className="mono text-xs text-foreground flex-1 truncate">
                    {maskKey(apiKey)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="mono text-xs text-muted-foreground w-14">
                    EMAIL
                  </span>
                  <span className="mono text-xs text-foreground flex-1 truncate">
                    {apiEmail}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="mono text-xs text-muted-foreground w-14">
                    RSA KEY
                  </span>
                  <span
                    className={`mono text-xs flex-1 ${hasRsaKey ? "text-candle-green" : "text-candle-red"}`}
                  >
                    {hasRsaKey
                      ? `Saved (${rsaPrivateKey.length} chars)`
                      : "NOT SET"}
                  </span>
                </div>
              </div>
            </div>

            {/* Proxy URL — always editable regardless of saved creds */}
            <div className="space-y-1.5">
              <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
                CORS Proxy URL{" "}
                <span className="normal-case font-normal">(optional)</span>
              </Label>
              <Input
                type="url"
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                onBlur={() => setProxyUrl(proxyInput)}
                placeholder="https://corsproxy.io"
                className="mono bg-secondary/50 border-border text-foreground text-xs"
                autoComplete="off"
                data-ocid="kalshi.proxy_url.input"
              />
              <p className="mono text-xs text-muted-foreground/70 leading-relaxed">
                Free options:{" "}
                <span className="text-candle-yellow">https://corsproxy.io</span>{" "}
                or{" "}
                <span className="text-candle-yellow">
                  https://api.allorigins.win/raw
                </span>
                . For best results use a local proxy:{" "}
                <span className="text-candle-yellow">
                  http://localhost:8010/proxy
                </span>{" "}
                (run{" "}
                <span className="text-candle-green">
                  npx local-cors-proxy --proxyUrl https://trading-api.kalshi.com
                  --port 8010
                </span>
                ).
              </p>
              {proxyUrl && (
                <div className="flex items-center gap-2 rounded border border-candle-yellow/25 bg-candle-yellow/5 px-3 py-2 mt-1">
                  <AlertTriangle className="w-3 h-3 text-candle-yellow flex-shrink-0" />
                  <p className="mono text-xs text-candle-yellow/90">
                    Proxy active — <span className="font-bold">{proxyUrl}</span>
                  </p>
                </div>
              )}
            </div>

            <Button
              onClick={handleClearCredentials}
              variant="outline"
              size="sm"
              className="mono text-xs border-candle-red/30 text-candle-red hover:bg-candle-red/10 bg-candle-red/5"
              data-ocid="kalshi.credentials.clear_button"
            >
              <Unplug className="w-3.5 h-3.5 mr-1.5" />
              CLEAR CREDENTIALS
            </Button>
          </div>
        ) : (
          /* Input form */
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
                  API Key ID
                </Label>
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="mono bg-secondary/50 border-border text-foreground pr-10 text-xs"
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleSaveCredentials()
                    }
                    autoComplete="off"
                    data-ocid="kalshi.api_key.input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                  >
                    {showKey ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="mono text-xs text-muted-foreground/60">
                  The Key ID (UUID) from your Kalshi API settings
                </p>
              </div>

              <div className="space-y-2">
                <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
                  Email
                </Label>
                <Input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="you@example.com"
                  className="mono bg-secondary/50 border-border text-foreground text-xs"
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleSaveCredentials()
                  }
                  autoComplete="email"
                  data-ocid="kalshi.email.input"
                />
              </div>
            </div>

            {/* RSA Private Key — full width textarea */}
            <div className="space-y-2">
              <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
                RSA Private Key
              </Label>
              <div className="relative">
                <Textarea
                  value={
                    showRsaKey
                      ? rsaKeyInput
                      : rsaKeyInput
                        ? "•".repeat(Math.min(rsaKeyInput.length, 40))
                        : ""
                  }
                  onChange={(e) => {
                    if (showRsaKey) setRsaKeyInput(e.target.value);
                  }}
                  onFocus={() => setShowRsaKey(true)}
                  placeholder={
                    "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
                  }
                  className="mono bg-secondary/50 border-border text-foreground text-xs font-mono h-28 resize-none"
                  autoComplete="off"
                  spellCheck={false}
                  data-ocid="kalshi.rsa_key.textarea"
                />
                <button
                  type="button"
                  onClick={() => setShowRsaKey((s) => !s)}
                  className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showRsaKey ? "Hide RSA key" : "Show RSA key"}
                >
                  {showRsaKey ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <p className="mono text-xs text-muted-foreground/70 leading-relaxed">
                Paste your full RSA private key PEM — include the{" "}
                <span className="text-candle-yellow">
                  -----BEGIN PRIVATE KEY-----
                </span>{" "}
                and{" "}
                <span className="text-candle-yellow">
                  -----END PRIVATE KEY-----
                </span>{" "}
                lines. Stored locally, never transmitted to any server other
                than Kalshi.
              </p>
            </div>

            {/* Proxy URL — full width */}
            <div className="space-y-1.5">
              <Label className="mono text-xs text-muted-foreground tracking-widest uppercase">
                CORS Proxy URL{" "}
                <span className="normal-case font-normal">(optional)</span>
              </Label>
              <Input
                type="url"
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                onBlur={() => setProxyUrl(proxyInput)}
                placeholder="https://corsproxy.io"
                className="mono bg-secondary/50 border-border text-foreground text-xs"
                autoComplete="off"
                data-ocid="kalshi.proxy_url.input"
              />
              <p className="mono text-xs text-muted-foreground/70 leading-relaxed">
                Free options:{" "}
                <span className="text-candle-yellow">https://corsproxy.io</span>{" "}
                or{" "}
                <span className="text-candle-yellow">
                  https://api.allorigins.win/raw
                </span>
                . Local proxy (most reliable):{" "}
                <span className="text-candle-yellow">
                  http://localhost:8010/proxy
                </span>
                .
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleSaveCredentials}
                size="sm"
                className="mono text-xs bg-candle-green/15 border border-candle-green/40 text-candle-green hover:bg-candle-green/25"
                variant="outline"
                data-ocid="kalshi.credentials.save_button"
              >
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                SAVE CREDENTIALS
              </Button>
              <p className="mono text-xs text-muted-foreground">
                Stored in localStorage — never transmitted except to Kalshi
              </p>
            </div>
          </div>
        )}
      </motion.div>

      {/* ── Connection Test ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        className="terminal-card rounded-lg border border-border p-5"
      >
        <SectionHeader
          icon={<Wifi className="w-4 h-4" />}
          title="Connection Test"
          badge={<ConnectionBadge status={connStatus} />}
        />

        <div className="space-y-4">
          <Button
            onClick={handleTestConnection}
            disabled={!hasCredentials || connStatus === "testing"}
            size="sm"
            variant="outline"
            className="mono text-xs border-candle-yellow/30 text-candle-yellow hover:bg-candle-yellow/10 bg-candle-yellow/5 disabled:opacity-40"
            data-ocid="kalshi.test_connection.button"
          >
            {connStatus === "testing" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                TESTING...
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 mr-1.5" />
                TEST CONNECTION
              </>
            )}
          </Button>

          <AnimatePresence>
            {connMessage && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className={`rounded-lg border p-4 ${
                  connStatus === "connected"
                    ? "border-candle-green/30 bg-candle-green/5"
                    : "border-candle-red/30 bg-candle-red/5"
                }`}
                data-ocid={
                  connStatus === "connected"
                    ? "kalshi.connection.success_state"
                    : "kalshi.connection.error_state"
                }
              >
                {connStatus === "connected" ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-candle-green flex-shrink-0" />
                    <div>
                      <p className="mono text-xs text-candle-green font-bold">
                        CONNECTION SUCCESSFUL
                      </p>
                      {connBalance !== null && (
                        <p className="mono text-sm text-foreground mt-1 font-bold">
                          Balance: {formatUSD(connBalance)}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <WifiOff className="w-4 h-4 text-candle-red flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="mono text-xs text-candle-red font-bold mb-1">
                        CONNECTION FAILED
                      </p>
                      <p className="mono text-xs text-muted-foreground leading-relaxed">
                        {connMessage}
                      </p>
                      <p className="mono text-xs text-candle-yellow/80 mt-2 leading-relaxed">
                        Your credentials are saved. Configure markets and
                        strategy below.
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── Live Trading Toggle ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
        className="terminal-card rounded-lg border border-border p-5"
      >
        <SectionHeader
          icon={<Zap className="w-4 h-4" />}
          title="Live Trading"
        />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="mono text-sm text-foreground font-bold">
                Enable Live Order Placement
              </p>
              <p className="mono text-xs text-muted-foreground mt-1">
                Bot will submit real orders to Kalshi on each strategy trigger
              </p>
            </div>
            <Switch
              checked={liveEnabled}
              onCheckedChange={handleToggleLive}
              disabled={!hasCredentials}
              className="data-[state=checked]:bg-candle-red/80"
              aria-label="Enable live Kalshi trading"
              data-ocid="kalshi.live_trading.switch"
            />
          </div>

          <AnimatePresence>
            {liveEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div
                  className="flex items-center gap-3 rounded-lg border border-candle-red/50 bg-candle-red/10 px-4 py-3"
                  style={{
                    boxShadow:
                      "0 0 20px oklch(0.62 0.22 22 / 0.12), inset 0 1px 0 oklch(0.62 0.22 22 / 0.08)",
                  }}
                >
                  <AlertTriangle className="w-4 h-4 text-candle-red flex-shrink-0" />
                  <p className="mono text-xs text-candle-red font-bold tracking-wide">
                    LIVE MODE ACTIVE —{" "}
                    <span className="font-normal text-candle-red/80">
                      Real orders will be placed on Kalshi using your account
                      funds.
                    </span>
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!hasCredentials && (
            <p className="mono text-xs text-muted-foreground/60">
              Save API credentials above to enable live trading
            </p>
          )}
        </div>
      </motion.div>

      {/* ── BTC Markets ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        className="terminal-card rounded-lg border border-border p-5"
      >
        <SectionHeader
          icon={<RefreshCw className="w-4 h-4" />}
          title="BTC Markets · KXBTC Series"
          badge={
            markets.length > 0 ? (
              <Badge
                variant="outline"
                className="mono text-xs border-border text-muted-foreground"
              >
                {markets.length} markets
              </Badge>
            ) : undefined
          }
        />

        <div className="space-y-4">
          <Button
            onClick={handleRefreshMarkets}
            disabled={!hasCredentials || marketsLoading}
            size="sm"
            variant="outline"
            className="mono text-xs border-candle-green/30 text-candle-green hover:bg-candle-green/10 bg-candle-green/5 disabled:opacity-40"
            data-ocid="kalshi.markets.refresh_button"
          >
            {marketsLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                LOADING...
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                REFRESH MARKETS
              </>
            )}
          </Button>

          {marketsFromSample && (
            <div className="flex items-start gap-2 rounded border border-candle-yellow/30 bg-candle-yellow/5 px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-candle-yellow flex-shrink-0 mt-0.5" />
              <p className="mono text-xs text-candle-yellow/90">
                Showing sample market data — real data requires server-side API
                access (CORS restriction applies to browser requests)
              </p>
            </div>
          )}

          {markets.length > 0 && (
            <ScrollArea className="max-h-72">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 w-4">
                      &nbsp;
                    </TableHead>
                    <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2">
                      Ticker
                    </TableHead>
                    <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2">
                      Title
                    </TableHead>
                    <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 text-right">
                      YES ¢
                    </TableHead>
                    <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 text-right">
                      NO ¢
                    </TableHead>
                    <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2 text-right">
                      Volume
                    </TableHead>
                    <TableHead className="mono text-xs text-muted-foreground tracking-widest uppercase py-2">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {markets.map((market) => {
                    const isSelected = selectedMarket === market.ticker;
                    return (
                      <TableRow
                        key={market.ticker}
                        onClick={() => setSelectedMarket(market.ticker)}
                        className={`border-border transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-candle-green/10 hover:bg-candle-green/15"
                            : "hover:bg-secondary/30"
                        }`}
                      >
                        <TableCell className="py-2 pr-0">
                          <div
                            className={`w-2 h-2 rounded-full mx-auto ${isSelected ? "bg-candle-green" : "bg-transparent border border-border"}`}
                          />
                        </TableCell>
                        <TableCell className="py-2">
                          <span
                            className={`mono text-xs font-bold ${isSelected ? "text-candle-green" : "text-foreground"}`}
                          >
                            {market.ticker}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 max-w-[200px]">
                          <span className="mono text-xs text-muted-foreground truncate block">
                            {market.title}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <span className="mono text-xs text-candle-green font-bold">
                            {market.yes_bid}¢
                          </span>
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <span className="mono text-xs text-candle-red font-bold">
                            {market.no_bid}¢
                          </span>
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <span className="mono text-xs text-muted-foreground">
                            {market.volume.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs mono font-semibold ${
                              market.status === "open"
                                ? "text-candle-green border border-candle-green/30 bg-candle-green/10"
                                : "text-muted-foreground border border-border"
                            }`}
                          >
                            {market.status.toUpperCase()}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}

          {markets.length === 0 && !marketsLoading && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <div className="w-10 h-10 rounded border border-border flex items-center justify-center">
                <RefreshCw className="w-4 h-4 text-muted-foreground opacity-40" />
              </div>
              <p className="mono text-xs text-muted-foreground">
                NO MARKETS LOADED
              </p>
              <p className="mono text-xs text-muted-foreground/60">
                Click Refresh Markets to fetch open KXBTC contracts
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Order Preview ────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.25 }}
        className="terminal-card rounded-lg border border-border p-5"
      >
        <SectionHeader
          icon={<FileCode className="w-4 h-4" />}
          title="Order Preview"
        />

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="mono text-xs text-muted-foreground tracking-widest uppercase">
                Selected Market
              </span>
              <div
                className={`mono text-sm font-bold ${selectedMarket ? "text-candle-green" : "text-muted-foreground"}`}
              >
                {selectedMarket || "None selected"}
              </div>
              {selectedMarketData && (
                <p className="mono text-xs text-muted-foreground truncate">
                  {selectedMarketData.title}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <span className="mono text-xs text-muted-foreground tracking-widest uppercase">
                Order Endpoint
              </span>
              <p className="mono text-xs text-foreground break-all">
                POST{" "}
                <span className="text-candle-yellow">/trade-api/v2/orders</span>
              </p>
              <p className="mono text-xs text-muted-foreground">
                Limit order · YES (bullish) or NO (bearish)
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <span className="mono text-xs text-muted-foreground tracking-widest uppercase">
              Sample Request Body
            </span>
            <div className="relative">
              <pre className="mono text-xs text-candle-green bg-candle-green/5 border border-candle-green/20 rounded-lg p-4 overflow-x-auto leading-relaxed">
                {orderPreview}
              </pre>
              <div className="absolute top-2 right-2">
                <span className="mono text-xs text-muted-foreground/50 select-none">
                  READ-ONLY
                </span>
              </div>
            </div>
            <p className="mono text-xs text-muted-foreground/70">
              YES = betting the candle direction continues · NO = betting mean
              reversion. The bot's strategy maps green streaks → NO (expecting
              red) and red streaks → YES (expecting green).
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Inline Zap icon to avoid import collision with App.tsx scope
function Zap({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

// Inline FileCode icon
function FileCode({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="m10 13-2 2 2 2" />
      <path d="m14 17 2-2-2-2" />
    </svg>
  );
}
