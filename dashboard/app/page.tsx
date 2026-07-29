"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, useSpring } from "framer-motion";
import {
  Zap,
  ShieldCheck,
  Lock,
  Activity,
  ExternalLink,
  ChevronRight,
  Database,
  Globe,
  FolderOpen,
  Cpu,
  ArrowRight,
} from "lucide-react";

// ── Animated counter hook ─────────────────────────────────────────────────────

function useCountUp(target: number, decimals = 0, duration = 1.8) {
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { duration: duration * 1000, bounce: 0 });
  const [display, setDisplay] = useState("0");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  useEffect(() => {
    if (inView) motionVal.set(target);
  }, [inView, target, motionVal]);

  useEffect(() => {
    return spring.on("change", (v) => {
      setDisplay(decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString());
    });
  }, [spring, decimals]);

  return { ref, display };
}

// ── Shared animation helpers ──────────────────────────────────────────────────

// Inline fade-up props (avoids Framer Motion Variants function-form typing issues)
function fadeUpProps(delay = 0) {
  return {
    initial: { opacity: 0, y: 28 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.55, delay, ease: "easeOut" as const },
  };
}

// ── Feature cards data ────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <Cpu size={22} strokeWidth={2.5} />,
    title: "WASM Sandboxing",
    accent: "var(--yellow)",
    shadowClass: "brut-card-yellow",
    body: "Every code execution runs inside a Wasmtime WebAssembly module with hard instruction-fuel caps and wall-clock epoch timeouts. The host process is never touched.",
    badge: "wasmtime",
  },
  {
    icon: <ShieldCheck size={22} strokeWidth={2.5} />,
    title: "SSRF + Path Traversal",
    accent: "var(--coral)",
    shadowClass: "brut-card-coral",
    body: "Pre-DNS IP resolution blocks RFC-1918 + cloud-metadata ranges. Redirect hooks catch open-redirect bypasses. Path.resolve() enforces an absolute filesystem jail.",
    badge: "zero-trust",
  },
  {
    icon: <Lock size={22} strokeWidth={2.5} />,
    title: "JWT Auth + Rate Limiting",
    accent: "var(--blue)",
    shadowClass: "brut-card-blue",
    body: "HS256/RS256 JWT gating on every tool call. Sliding token-bucket rate limiter backed by Redis atomic Lua scripts — with in-memory fallback for single-node deploys.",
    badge: "redis",
  },
  {
    icon: <Activity size={22} strokeWidth={2.5} />,
    title: "Full Observability",
    accent: "var(--green)",
    shadowClass: "brut-card-green",
    body: "OpenTelemetry spans for every tool call, Prometheus histograms scraped at /metrics, structured JSON logs on stderr. First-class Grafana dashboards via docker-compose.",
    badge: "opentelemetry",
  },
];

// ── Architecture flow nodes ───────────────────────────────────────────────────

const ARCH_NODES = [
  { label: "AI Agent", sub: "MCP Client / REST", color: "var(--yellow)", icon: <Zap size={16} strokeWidth={3} /> },
  { label: "Auth Guard", sub: "JWT HS256/RS256", color: "var(--coral)", icon: <Lock size={16} strokeWidth={2.5} /> },
  { label: "Rate Limiter", sub: "Token Bucket · Redis", color: "var(--blue)", icon: <Activity size={16} strokeWidth={2.5} /> },
  { label: "Tool Registry", sub: "MCP ToolRegistry", color: "var(--purple)", icon: <Cpu size={16} strokeWidth={2.5} /> },
];

const TOOL_NODES = [
  { label: "db_query", color: "var(--blue)", icon: <Database size={14} strokeWidth={2.5} /> },
  { label: "web_fetch", color: "var(--coral)", icon: <Globe size={14} strokeWidth={2.5} /> },
  { label: "file_ops", color: "var(--green)", icon: <FolderOpen size={14} strokeWidth={2.5} /> },
  { label: "code_exec", color: "var(--yellow)", icon: <Cpu size={14} strokeWidth={2.5} /> },
];

// ── Benchmark stats ───────────────────────────────────────────────────────────

const STATS = [
  { value: 847, suffix: "", label: "Requests / sec", decimals: 0, accent: "var(--yellow)" },
  { value: 4.2, suffix: "ms", label: "P95 Latency", decimals: 1, accent: "var(--blue)" },
  { value: 0, suffix: "%", label: "Error Rate", decimals: 0, accent: "var(--green)" },
  { value: 47, suffix: "ms", label: "WASM Overhead", decimals: 0, accent: "var(--coral)" },
];

// ─────────────────────────────────────────────────────────────────────────────
// LANDING PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", overflowX: "hidden" }}>

      {/* ── Sticky nav bar ─────────────────────────────────────────────────── */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 200,
          background: "rgba(17,18,20,0.88)",
          backdropFilter: "blur(12px)",
          borderBottom: "2px solid rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              style={{ width: 32, height: 32, background: "var(--yellow)", border: "3px solid #000", borderRadius: 4, boxShadow: "3px 3px 0 #000", display: "flex", alignItems: "center", justifyContent: "center" }}
              whileHover={{ rotate: -8, scale: 1.08 }}
              transition={{ duration: 0.18 }}
            >
              <Zap size={16} strokeWidth={3} color="#000" />
            </motion.div>
            <span style={{ fontSize: 15, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>ISOLYTH</span>
          </div>

          {/* Nav links */}
          <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {["Features", "Architecture", "Benchmarks"].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase()}`}
                style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 12px", textDecoration: "none", borderRadius: 4, transition: "color 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              >
                {item}
              </a>
            ))}
            <a
              href="/overview"
              className="btn-brut btn-yellow"
              style={{ marginLeft: 8, padding: "6px 16px", fontSize: 12, textDecoration: "none" }}
            >
              Dashboard <ChevronRight size={13} />
            </a>
          </nav>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 — HERO                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          minHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 24px 60px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background grid decoration */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "linear-gradient(rgba(245,216,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(245,216,0,0.03) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            pointerEvents: "none",
          }}
        />

        {/* Glow blob */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "10%",
            left: "50%",
            transform: "translateX(-50%)",
            width: 600,
            height: 600,
            background: "radial-gradient(ellipse, rgba(245,216,0,0.06) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ textAlign: "center", maxWidth: 820, position: "relative", zIndex: 1 }}>
          {/* Badge */}
          <motion.div {...fadeUpProps(0)} style={{ marginBottom: 28, display: "inline-block" }}>
            <span
              className="badge badge-yellow"
              style={{ fontSize: 10, letterSpacing: "0.14em", padding: "4px 12px", borderWidth: 2 }}
            >
              MCP Tool Server · v0.1.0
            </span>
          </motion.div>

          {/* Main headline */}
          <motion.h1
            {...fadeUpProps(0.08)}
            style={{
              fontSize: "clamp(64px, 12vw, 108px)",
              fontWeight: 900,
              letterSpacing: "-0.055em",
              lineHeight: 0.9,
              color: "var(--text-primary)",
              marginBottom: 28,
            }}
          >
            ISO
            <span style={{ color: "var(--yellow)", textShadow: "4px 4px 0 #000" }}>LY</span>
            TH
          </motion.h1>

          {/* Tagline */}
          <motion.p
            {...fadeUpProps(0.18)}
            style={{
              fontSize: "clamp(16px, 2.5vw, 21px)",
              fontWeight: 500,
              color: "var(--text-secondary)",
              lineHeight: 1.55,
              marginBottom: 44,
              maxWidth: 640,
              margin: "0 auto 44px",
            }}
          >
            <strong style={{ color: "var(--text-primary)", fontWeight: 700 }}>WASM-Sandboxed MCP Tool Server</strong>
            {" "}for safe AI agent execution — with SSRF protection, JWT auth,
            Redis rate limiting, and full OpenTelemetry observability.
          </motion.p>

          {/* CTA buttons */}
          <motion.div
            {...fadeUpProps(0.28)}
            style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}
          >
            <motion.a
              href="/overview"
              className="btn-brut btn-yellow"
              style={{ fontSize: 14, padding: "12px 28px", textDecoration: "none" }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97, y: 1 }}
            >
              <Activity size={16} />
              Launch Dashboard
            </motion.a>
            <motion.a
              href="https://github.com/adarshthakur9240/Isolyth"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-brut btn-outline"
              style={{ fontSize: 14, padding: "12px 28px", textDecoration: "none" }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97, y: 1 }}
            >
              <ExternalLink size={16} />
              GitHub
            </motion.a>
          </motion.div>

          {/* Animated accent line */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.7, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            style={{
              height: 4,
              background: "linear-gradient(90deg, var(--yellow), var(--coral), var(--blue))",
              borderRadius: 2,
              marginTop: 64,
              transformOrigin: "left",
              border: "1px solid rgba(0,0,0,0.3)",
            }}
          />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 — WHY ISOLYTH                                               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section id="features" style={{ padding: "100px 24px", maxWidth: 1140, margin: "0 auto" }}>
        <SectionLabel color="var(--coral)" text="Why Isolyth" />

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--text-primary)", marginBottom: 56, lineHeight: 1.1 }}
        >
          Defense in depth,<br />
          <span style={{ color: "var(--yellow)" }}>built for LLM agents.</span>
        </motion.h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
          }}
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              {...fadeUpProps(i * 0.1)}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              whileHover={{ rotate: i % 2 === 0 ? -1.5 : 1.5, scale: 1.025, y: -4 }}
              transition={{ duration: 0.2 }}
              className={`brut-card ${f.shadowClass}`}
              style={{ padding: 26, display: "flex", flexDirection: "column", gap: 14, cursor: "default" }}
            >
              {/* Icon block */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  background: f.accent,
                  border: "3px solid #000",
                  borderRadius: 6,
                  boxShadow: "3px 3px 0 #000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: f.accent === "var(--yellow)" || f.accent === "var(--green)" ? "#000" : "#fff",
                  flexShrink: 0,
                }}
              >
                {f.icon}
              </div>

              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.02em" }}>
                  {f.title}
                </div>
                <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.65, fontWeight: 500 }}>
                  {f.body}
                </p>
              </div>

              <span
                className="badge badge-muted"
                style={{ alignSelf: "flex-start", fontSize: 9, letterSpacing: "0.1em" }}
              >
                {f.badge}
              </span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3 — ARCHITECTURE                                              */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section id="architecture" style={{ padding: "100px 24px", background: "var(--bg-panel)", borderTop: "3px solid #000", borderBottom: "3px solid #000" }}>
        <div style={{ maxWidth: 1140, margin: "0 auto" }}>
          <SectionLabel color="var(--blue)" text="Architecture" />

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--text-primary)", marginBottom: 64, lineHeight: 1.1 }}
          >
            Request flow,{" "}
            <span style={{ color: "var(--blue)" }}>lock-step security.</span>
          </motion.h2>

          {/* Main pipeline */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", justifyContent: "center", marginBottom: 40 }}>
            {ARCH_NODES.map((node, i) => (
              <div key={node.label} style={{ display: "flex", alignItems: "center" }}>
                <ArchNode node={node} delay={i * 0.13} />
                {i < ARCH_NODES.length - 1 && (
                  <FlowArrow delay={i * 0.13 + 0.12} />
                )}
              </div>
            ))}
          </div>

          {/* Connector to tools */}
          <motion.div
            initial={{ scaleY: 0, opacity: 0 }}
            whileInView={{ scaleY: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6, duration: 0.4 }}
            style={{ width: 3, height: 32, background: "var(--purple)", margin: "0 auto", transformOrigin: "top", border: "1px solid #000" }}
          />

          {/* Tool nodes */}
          <div
            style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 0 }}
          >
            {TOOL_NODES.map((tool, i) => (
              <motion.div
                key={tool.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.7 + i * 0.07, duration: 0.4, ease: "easeOut" }}
                whileHover={{ y: -4, scale: 1.04 }}
                className="brut-card"
                style={{
                  padding: "12px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderColor: "#000",
                  boxShadow: `5px 5px 0 ${tool.color}`,
                  cursor: "default",
                  minWidth: 130,
                  justifyContent: "center",
                }}
              >
                <span style={{ color: tool.color }}>{tool.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.02em" }}>
                  {tool.label}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Legend */}
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.5 }}
            style={{ textAlign: "center", marginTop: 32, fontSize: 11, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}
          >
            AI Agent → Auth Guard → Rate Limiter → Tool Registry → Isolated Execution Sandbox
          </motion.p>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4 — BENCHMARKS                                                */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section id="benchmarks" style={{ padding: "100px 24px", maxWidth: 1140, margin: "0 auto" }}>
        <SectionLabel color="var(--green)" text="Benchmarked" />

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--text-primary)", marginBottom: 16, lineHeight: 1.1 }}
        >
          Production load tested
          <br />
          <span style={{ color: "var(--green)" }}>with Locust.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 56, fontWeight: 500 }}
        >
          Results from sustained load test · 500 concurrent users · 5-minute ramp
        </motion.p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20 }}>
          {STATS.map((stat) => (
            <BenchStat key={stat.label} {...stat} />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5, duration: 0.45 }}
          style={{
            marginTop: 32,
            padding: "16px 22px",
            border: "2px dashed rgba(46,213,115,0.3)",
            borderRadius: 6,
            background: "rgba(46,213,115,0.04)",
            fontSize: 12,
            color: "var(--text-muted)",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span className="dot-live" />
          Tested with{" "}
          <code style={{ color: "var(--blue)", background: "var(--bg-raised)", padding: "1px 6px", borderRadius: 3, fontSize: 11, border: "1px solid rgba(255,255,255,0.07)" }}>
            locust -f server/locustfile.py --host http://localhost:8000
          </code>
          — see{" "}
          <code style={{ color: "var(--blue)", background: "var(--bg-raised)", padding: "1px 6px", borderRadius: 3, fontSize: 11, border: "1px solid rgba(255,255,255,0.07)" }}>
            server/README_BENCHMARK.md
          </code>{" "}
          for methodology.
        </motion.div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* FOOTER                                                                 */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <footer
        style={{
          background: "var(--bg-panel)",
          borderTop: "3px solid #000",
          boxShadow: "0 -3px 0 #000",
          padding: "36px 24px",
        }}
      >
        <div
          style={{
            maxWidth: 1140,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 20,
          }}
        >
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
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
              }}
            >
              <Zap size={17} strokeWidth={3} color="#000" />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>ISOLYTH</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                MIT License · v0.1.0
              </div>
            </div>
          </div>

          {/* Links */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a
              href="/overview"
              style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textDecoration: "none", letterSpacing: "0.04em", transition: "color 0.15s" }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "var(--yellow)")}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              Dashboard
            </a>
            <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>·</span>
            <a
              href="https://github.com/adarshthakur9240/Isolyth"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              <ExternalLink size={14} />
              GitHub
            </a>
            <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>·</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
              Python 3.12 · FastAPI · Wasmtime · PostgreSQL · Redis
            </span>
          </div>
        </div>
      </footer>

      {/* ── Responsive styles ─────────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 680px) {
          nav a.btn-brut { display: none; }
        }
        @media (max-width: 480px) {
          nav { gap: 0; }
          nav a[href*="Features"], nav a[href*="Architecture"], nav a[href*="Benchmarks"] { display: none; }
          nav a.btn-brut { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ color, text }: { color: string; text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45 }}
      style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}
    >
      <span style={{ width: 28, height: 4, background: color, borderRadius: 2, border: "1px solid #000", display: "inline-block" }} />
      <span style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: "0.16em", textTransform: "uppercase" }}>{text}</span>
    </motion.div>
  );
}

function ArchNode({ node, delay }: { node: typeof ARCH_NODES[0]; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, scale: 1.05 }}
      className="brut-card"
      style={{
        padding: "14px 20px",
        minWidth: 140,
        boxShadow: `5px 5px 0 ${node.color}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        cursor: "default",
        textAlign: "center",
      }}
    >
      <span style={{ color: node.color }}>{node.icon}</span>
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>{node.label}</div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.04em" }}>{node.sub}</div>
    </motion.div>
  );
}

function FlowArrow({ delay }: { delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0 }}
      whileInView={{ opacity: 1, scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.3, ease: "easeOut" }}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 6px",
        transformOrigin: "left",
      }}
    >
      <ArrowRight size={18} color="var(--text-muted)" strokeWidth={2.5} />
    </motion.div>
  );
}

function BenchStat({
  value,
  suffix,
  label,
  decimals,
  accent,
}: {
  value: number;
  suffix: string;
  label: string;
  decimals: number;
  accent: string;
}) {
  const { ref, display } = useCountUp(value, decimals);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5 }}
      whileHover={{ y: -4, scale: 1.03 }}
      className="brut-card"
      style={{
        padding: "28px 24px",
        boxShadow: `6px 6px 0 ${accent}`,
        textAlign: "center",
        cursor: "default",
      }}
    >
      <div
        className="metric-num"
        style={{ color: accent, fontSize: "clamp(42px, 6vw, 58px)", marginBottom: 6 }}
      >
        {display}
        <span style={{ fontSize: "0.55em", fontWeight: 800 }}>{suffix}</span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {label}
      </div>
      {/* Accent underline */}
      <div style={{ height: 3, background: accent, borderRadius: 2, marginTop: 16, border: "1px solid #000" }} />
    </motion.div>
  );
}
