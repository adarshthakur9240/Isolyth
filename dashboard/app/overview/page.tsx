"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Cpu,
  ShieldCheck,
  Clock,
  Globe,
  Zap,
  ChevronRight,
  Terminal,
  BarChart3,
  Play,
} from "lucide-react";
import { useDashboardData } from "../lib/hooks";
import { KpiRow, HealthPanel } from "../components/Stats";
import { ThroughputChart, DurationChart, ToolBreakdown, SuccessDonut } from "../components/Charts";
import { AuthPanel, RateLimitPanel, SandboxPanel } from "../components/Panels";
import { TryPanel } from "../components/TryPanel";
import { RefreshButton } from "../components/ui";

// ── Tab config ────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",   label: "Overview",   icon: <BarChart3 size={15} /> },
  { id: "try",        label: "Try a Tool", icon: <Play size={15} /> },
  { id: "auth",       label: "Auth",       icon: <ShieldCheck size={15} /> },
  { id: "ratelimits", label: "Rate Limits",icon: <Clock size={15} /> },
  { id: "sandbox",    label: "Sandbox",    icon: <Globe size={15} /> },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ── Main dashboard page ───────────────────────────────────────────────────

export default function DashboardPage() {
  const { data, isLive, isDemo, isMounted, refresh } = useDashboardData();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 600);
  }, [refresh]);

  // ── Skeleton / loading state (SSR + first paint before client hydration) ──
  if (!isMounted || !data) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg-base)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
        }}
      >
        {/* Logo */}
        <motion.div
          style={{
            width: 52,
            height: 52,
            background: "var(--yellow)",
            border: "3px solid #000",
            borderRadius: 6,
            boxShadow: "4px 4px 0 #000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#000",
          }}
          animate={{ rotate: [0, -8, 8, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <Zap size={24} strokeWidth={3} />
        </motion.div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>ISOLYTH</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, marginTop: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>Initialising dashboard…</div>
        </div>
        {/* Pulse bars */}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 24 }}>
          {[1, 0.7, 0.9, 0.5, 0.8].map((h, i) => (
            <motion.div
              key={i}
              style={{ width: 6, borderRadius: 3, background: i % 2 === 0 ? "var(--yellow)" : "var(--blue)" }}
              animate={{ height: [`${h * 100}%`, "20%", `${h * 100}%`] }}
              transition={{ duration: 0.9, delay: i * 0.12, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
      }}
    >
      {/* ── Top Bar ──────────────────────────────────────────────────── */}
      <header
        style={{
          background: "var(--bg-panel)",
          borderBottom: "3px solid #000",
          boxShadow: "0 3px 0 #000",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 58,
            gap: 16,
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <motion.div
              style={{
                width: 34,
                height: 34,
                background: "var(--yellow)",
                border: "3px solid #000",
                borderRadius: 4,
                boxShadow: "3px 3px 0 #000",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#000",
              }}
              whileHover={{ rotate: -6, scale: 1.05 }}
              transition={{ duration: 0.18 }}
            >
              <Zap size={17} strokeWidth={3} />
            </motion.div>
            <div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 900,
                  color: "var(--text-primary)",
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                ISOLYTH
              </div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                }}
              >
                MCP Dashboard
              </div>
            </div>
          </div>

          {/* Nav tabs */}
          <nav
            style={{
              display: "flex",
              gap: 2,
              background: "var(--bg-base)",
              border: "2px solid rgba(255,255,255,0.06)",
              borderRadius: 6,
              padding: 3,
            }}
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 13px",
                  borderRadius: 4,
                  border: activeTab === tab.id ? "2px solid #000" : "2px solid transparent",
                  background:
                    activeTab === tab.id ? "var(--yellow)" : "transparent",
                  color: activeTab === tab.id ? "#000" : "var(--text-secondary)",
                  fontFamily: "Poppins, sans-serif",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                  transition: "all 0.15s ease",
                  boxShadow: activeTab === tab.id ? "2px 2px 0 #000" : "none",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.icon}
                <span className="hidden-mobile">{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Right controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {/* Live indicator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                fontWeight: 700,
                color: isDemo ? "var(--yellow)" : "var(--green)",
              }}
            >
              {isDemo ? (
                <>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--yellow)",
                      display: "inline-block",
                    }}
                  />
                  DEMO
                </>
              ) : (
                <>
                  <span className="dot-live" />
                  LIVE
                </>
              )}
            </div>

            <RefreshButton onClick={handleRefresh} spinning={refreshing} />
          </div>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 1400, margin: "0 auto", width: "100%", padding: "24px 24px 40px" }}>

        {/* Health bar */}
        <div style={{ marginBottom: 20 }}>
          <HealthPanel data={data} isLive={isLive} isDemo={isDemo} />
        </div>

        {/* KPI row */}
        <div style={{ marginBottom: 24 }}>
          <KpiRow data={data} />
        </div>

        {/* ── Tab content ──────────────────────────────────────────── */}
        <AnimatePresence mode="wait">

          {activeTab === "overview" && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {/* Charts row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  marginBottom: 16,
                }}
                className="charts-grid"
              >
                <ThroughputChart data={data} />
                <DurationChart data={data} />
              </div>

              {/* Lower row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 340px",
                  gap: 16,
                }}
                className="lower-grid"
              >
                <ToolBreakdown data={data} />
                <SuccessDonut data={data} />
              </div>
            </motion.div>
          )}

          {activeTab === "auth" && (
            <motion.div
              key="auth"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
                className="auth-grid"
              >
                <AuthPanel data={data} />
                <AuthInfoCard />
              </div>
            </motion.div>
          )}

          {activeTab === "ratelimits" && (
            <motion.div
              key="ratelimits"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
              >
                <RateLimitPanel data={data} />
                <RateLimitInfoCard />
              </div>
            </motion.div>
          )}

          {activeTab === "sandbox" && (
            <motion.div
              key="sandbox"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
                className="sandbox-grid"
              >
                <SandboxPanel data={data} />
                <SandboxInfoCard />
              </div>
            </motion.div>
          )}

          {activeTab === "try" && (
            <motion.div
              key="try"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <TryPanel onToolExecuted={handleRefresh} />
            </motion.div>
          )}

        </AnimatePresence>

        {/* ── Demo banner ──────────────────────────────────────────── */}
        {isDemo && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              marginTop: 28,
              border: "3px dashed rgba(245,216,0,0.4)",
              borderRadius: 6,
              padding: "14px 20px",
              background: "rgba(245,216,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--yellow)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Terminal size={14} /> DEMO MODE
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
              Server not reachable at localhost:8000. Showing simulated live data.
              Start the MCP server with{" "}
              <code
                style={{
                  background: "var(--bg-raised)",
                  padding: "1px 6px",
                  borderRadius: 3,
                  fontSize: 11,
                  color: "var(--blue)",
                  fontFamily: "monospace",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                python server/http_server.py
              </code>{" "}
              to see live metrics.
            </span>
          </motion.div>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: "2px solid rgba(255,255,255,0.04)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          ISOLYTH · MCP TOOL SERVER · v0.1.0
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
          Polling every 3s · OpenTelemetry · Prometheus · JWT Auth · Redis Rate Limiting
        </span>
      </footer>

      {/* ── Responsive CSS ───────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 900px) {
          .charts-grid, .lower-grid, .auth-grid, .sandbox-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 620px) {
          .hidden-mobile { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ── Info cards for auth / rate-limit / sandbox tabs ────────────────────────

function InfoCard({ title, accentColor, items }: {
  title: string;
  accentColor: string;
  items: { label: string; value: string; mono?: boolean; badge?: string }[];
}) {
  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: accentColor,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ width: 16, height: 3, background: accentColor, borderRadius: 2, display: "inline-block" }} />
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map(({ label, value, mono, badge }) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              padding: "9px 0",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, textAlign: "right" }}>
              <span
                style={{
                  fontSize: mono ? 11 : 12,
                  fontWeight: 700,
                  color: "var(--text-secondary)",
                  fontFamily: mono ? "monospace" : "inherit",
                  wordBreak: "break-all",
                }}
              >
                {value}
              </span>
              {badge && (
                <span
                  className={`badge badge-${badge}`}
                  style={{ fontSize: 9, padding: "1px 5px" }}
                >
                  {badge}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function AuthInfoCard() {
  return (
    <InfoCard
      title="Auth Configuration"
      accentColor="var(--yellow)"
      items={[
        { label: "Algorithm", value: "HS256", mono: true },
        { label: "Token field", value: "_auth_token", mono: true },
        { label: "Header", value: "Authorization: Bearer …", mono: true },
        { label: "REQUIRE_AUTH", value: "true (env override)", mono: true },
        { label: "Dev token lifetime", value: "86400s (24h)" },
        { label: "Prod token lifetime", value: "3600s (1h)" },
        { label: "Generate dev token", value: "python -m server.core.auth", mono: true },
        { label: "Secret env var", value: "JWT_SECRET_KEY", mono: true },
        { label: "Middleware location", value: "server/core/auth.py", mono: true },
      ]}
    />
  );
}

function RateLimitInfoCard() {
  return (
    <InfoCard
      title="Rate Limit Config"
      accentColor="var(--coral)"
      items={[
        { label: "Backend", value: "Redis (in-memory fallback)" },
        { label: "Strategy", value: "Sliding window / token bucket" },
        { label: "key scheme", value: "user_id:tool_name", mono: true },
        { label: "code_exec limit", value: "20 req/min", badge: "yellow" },
        { label: "file_ops limit", value: "60 req/min", badge: "blue" },
        { label: "query_database limit", value: "10 req/min", badge: "coral" },
        { label: "fetch_url limit", value: "30 req/min", badge: "green" },
        { label: "Disable for tests", value: "RATE_LIMIT_DISABLED=true", mono: true },
        { label: "Module", value: "server/core/rate_limit.py", mono: true },
        { label: "429 response", value: "MCP error: rate_limited" },
      ]}
    />
  );
}

function SandboxInfoCard() {
  return (
    <InfoCard
      title="Sandbox Config"
      accentColor="var(--blue)"
      items={[
        { label: "Runtime", value: "Wasmtime (WASM)" },
        { label: "Isolation", value: "Memory & CPU sandboxed" },
        { label: "Timeout", value: "Configurable (default 5s)" },
        { label: "Memory limit", value: "Configurable per-run" },
        { label: "Supported langs", value: "C, WAT, WASM binary" },
        { label: "WAT modules dir", value: "server/wasm_modules/", mono: true },
        { label: "Sandbox module", value: "server/core/sandbox.py", mono: true },
        { label: "Active gauge metric", value: "isolyth_active_sandbox_executions", mono: true },
        { label: "Telemetry module", value: "server/core/telemetry.py", mono: true },
        { label: "Tracing", value: "OpenTelemetry (OTEL_CONSOLE_EXPORTER=true)" },
      ]}
    />
  );
}
