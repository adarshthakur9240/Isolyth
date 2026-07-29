"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, ShieldOff, Key, Clock, Cpu, Globe } from "lucide-react";
import type { DashboardData } from "../lib/hooks";

// ── Sidebar nav ───────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: <Cpu size={15} /> },
  { id: "auth", label: "Auth & Security", icon: <ShieldCheck size={15} /> },
  { id: "rate-limits", label: "Rate Limits", icon: <Clock size={15} /> },
  { id: "sandbox", label: "Sandbox", icon: <Globe size={15} /> },
];

// ── Auth panel ─────────────────────────────────────────────────────────────

interface AuthPanelProps {
  data: DashboardData;
}

function AuthStatusRow({
  label,
  value,
  valueColor,
  note,
}: {
  label: string;
  value: string | number;
  valueColor?: string;
  note?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
        {label}
      </span>
      <div style={{ textAlign: "right" }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: valueColor ?? "var(--text-primary)",
            fontFamily: "monospace",
          }}
        >
          {value}
        </span>
        {note && (
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

export function AuthPanel({ data }: AuthPanelProps) {
  const totalUnauth = data.tools.reduce((s, t) => s + t.unauthorized, 0);
  const threatLevel =
    totalUnauth === 0 ? "none" : totalUnauth < 5 ? "low" : totalUnauth < 20 ? "medium" : "high";
  const threatColor =
    threatLevel === "none"
      ? "var(--green)"
      : threatLevel === "low"
      ? "var(--yellow)"
      : threatLevel === "medium"
      ? "var(--yellow)"
      : "var(--coral)";

  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px 20px" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div
          style={{
            width: 36,
            height: 36,
            background: "var(--bg-raised)",
            border: "2px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Key size={16} color="var(--yellow)" />
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text-primary)" }}>
            JWT Auth Middleware
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
            HS256 · Bearer token · REQUIRE_AUTH=true
          </div>
        </div>
      </div>

      <AuthStatusRow
        label="Algorithm"
        value="HS256"
        valueColor="var(--blue)"
      />
      <AuthStatusRow
        label="Token Lifetime"
        value="1h (dev: 24h)"
        valueColor="var(--text-secondary)"
      />
      <AuthStatusRow
        label="Unauthorized Calls"
        value={totalUnauth}
        valueColor={totalUnauth > 0 ? "var(--coral)" : "var(--green)"}
        note="this polling window"
      />
      <AuthStatusRow
        label="Threat Level"
        value={threatLevel.toUpperCase()}
        valueColor={threatColor}
      />

      {/* Security score visual */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 6,
          }}
        >
          Auth Coverage
        </div>
        <div className="nm-inset" style={{ height: 8, borderRadius: 4, overflow: "hidden" }}>
          <motion.div
            style={{
              height: "100%",
              background:
                totalUnauth === 0
                  ? "var(--green)"
                  : "linear-gradient(90deg, var(--green), var(--yellow))",
              borderRadius: 4,
            }}
            animate={{ width: `${Math.max(60, 100 - totalUnauth * 3)}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {/* Per-tool unauth breakdown */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 8,
          }}
        >
          Per-Tool Unauthorized Calls
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.tools.map((t) => (
            <div
              key={t.name}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  fontWeight: 600,
                  fontFamily: "monospace",
                }}
              >
                {t.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: t.unauthorized > 0 ? "var(--coral)" : "var(--text-muted)",
                }}
              >
                {t.unauthorized}
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ── Rate limit panel ───────────────────────────────────────────────────────

const RATE_LIMIT_CONFIG: Record<string, { limit: number; window: string; color: string }> = {
  code_exec:      { limit: 20,  window: "1 min", color: "var(--yellow)" },
  file_ops:       { limit: 60,  window: "1 min", color: "var(--blue)" },
  query_database: { limit: 10,  window: "1 min", color: "var(--coral)" },
  fetch_url:      { limit: 30,  window: "1 min", color: "var(--green)" },
};

export function RateLimitPanel({ data }: { data: DashboardData }) {
  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.26 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div
          style={{
            width: 36,
            height: 36,
            background: "var(--bg-raised)",
            border: "2px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Clock size={16} color="var(--coral)" />
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text-primary)" }}>
            Redis Rate Limiter
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
            Token bucket · per-user per-tool · sliding window
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {data.tools.map((tool) => {
          const cfg = RATE_LIMIT_CONFIG[tool.name];
          if (!cfg) return null;
          const usagePct = tool.calls > 0 ? Math.min(100, (tool.calls / cfg.limit) * 100) : 0;
          const rateLimitedPct = tool.calls > 0 ? (tool.rateLimit / tool.calls) * 100 : 0;

          return (
            <div key={tool.name}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--text-secondary)",
                    fontFamily: "monospace",
                  }}
                >
                  {tool.name}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>
                    limit: {cfg.limit}/{cfg.window}
                  </span>
                  {tool.rateLimit > 0 && (
                    <span
                      className="badge badge-coral"
                      style={{ fontSize: 9, padding: "1px 5px" }}
                    >
                      {tool.rateLimit} 429s
                    </span>
                  )}
                </div>
              </div>

              {/* Usage bar */}
              <div className="nm-inset" style={{ height: 8, borderRadius: 4, overflow: "hidden" }}>
                <motion.div
                  style={{
                    height: "100%",
                    background: cfg.color,
                    borderRadius: 4,
                    opacity: 0.9,
                  }}
                  animate={{ width: `${usagePct}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginTop: 4,
                  fontWeight: 600,
                }}
              >
                {tool.calls} reqs · {rateLimitedPct.toFixed(1)}% rejected
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Sandbox panel ──────────────────────────────────────────────────────────

export function SandboxPanel({ data }: { data: DashboardData }) {
  const codeExecTool = data.tools.find((t) => t.name === "code_exec");

  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.32 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div
          style={{
            width: 36,
            height: 36,
            background: "var(--bg-raised)",
            border: "2px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Globe size={16} color="var(--blue)" />
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text-primary)" }}>
            WASM Sandbox
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
            Wasmtime · memory-isolated · timeout-enforced
          </div>
        </div>
      </div>

      {/* Active gauge */}
      <div
        className="brut-card brut-card-blue"
        style={{ padding: "16px 20px", marginBottom: 16, textAlign: "center" }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--text-muted)",
            marginBottom: 8,
          }}
        >
          Active Executions
        </div>
        <div
          className="metric-num"
          style={{
            color: data.activeSandboxes > 0 ? "var(--yellow)" : "var(--text-muted)",
            fontSize: 48,
          }}
        >
          {data.activeSandboxes}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontWeight: 500 }}>
          concurrent WASM processes
        </div>
      </div>

      {/* code_exec stats */}
      {codeExecTool && (
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 10,
            }}
          >
            code_exec tool (WASM)
          </div>
          {[
            { label: "Total calls", value: codeExecTool.calls },
            { label: "Success", value: codeExecTool.success, color: "var(--green)" },
            { label: "Errors", value: codeExecTool.error, color: "var(--coral)" },
            { label: "Avg duration", value: `${codeExecTool.avgDurationMs.toFixed(0)}ms`, color: "var(--blue)" },
            { label: "p95 duration", value: `${codeExecTool.p95DurationMs.toFixed(0)}ms`, color: "var(--yellow)" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "7px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: color ?? "var(--text-primary)", fontFamily: "monospace" }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
