"use client";

import { useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import SplitType from "split-type";
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
  Terminal,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

// Register GSAP plugins safely
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

// Dynamically import Three.js Canvas with ssr: false for SSR safety
const HeroCanvas = dynamic(() => import("./components/HeroCanvas"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(circle, rgba(245,216,0,0.05) 0%, transparent 70%)",
      }}
    />
  ),
});

// ── Feature Card Specs ────────────────────────────────────────────────────────

const FEATURES = [
  {
    id: "wasm",
    icon: <Cpu size={24} strokeWidth={2.5} />,
    title: "WASM Sandboxing",
    accent: "var(--yellow)",
    shadowClass: "brut-card-yellow",
    body: "Every tool invocation runs inside a Wasmtime WebAssembly module with hard instruction-fuel caps and wall-clock epoch timeouts.",
    backTitle: "Wasmtime Engine Specs",
    backDetails: [
      { label: "Instruction Budget", val: "10,000,000 fuel" },
      { label: "Memory Boundary", val: "16 MB RAM limit" },
      { label: "Epoch Timeout", val: "3.0s wall-clock" },
      { label: "Host Isolation", val: "No OS syscalls" },
    ],
    badge: "wasmtime",
  },
  {
    id: "ssrf",
    icon: <ShieldCheck size={24} strokeWidth={2.5} />,
    title: "SSRF & Path Jail",
    accent: "var(--coral)",
    shadowClass: "brut-card-coral",
    body: "Pre-DNS IP resolution blocks RFC-1918 + AWS metadata ranges. Path.resolve() enforces an absolute workspace filesystem jail.",
    backTitle: "Zero-Trust Guards",
    backDetails: [
      { label: "IP Blocklist", val: "10/8, 172/16, 192/168" },
      { label: "Cloud Metadata", val: "169.254.169.254" },
      { label: "Path Resolution", val: "Path.resolve() jail" },
      { label: "Redirect Interceptor", val: "301/302 SSRF check" },
    ],
    badge: "ssrf-guard",
  },
  {
    id: "auth",
    icon: <Lock size={24} strokeWidth={2.5} />,
    title: "JWT Auth & Redis Limits",
    accent: "var(--blue)",
    shadowClass: "brut-card-blue",
    body: "HS256/RS256 JWT gating on every tool call. Sliding token-bucket rate limiter backed by Redis atomic Lua scripts.",
    backTitle: "Gating Parameters",
    backDetails: [
      { label: "Algorithm", val: "HS256 / RS256 JWT" },
      { label: "Rate Backend", val: "Redis 7 Lua scripts" },
      { label: "Fallback Engine", val: "In-memory token bucket" },
      { label: "Token Lifespan", val: "24h dev / 1h prod" },
    ],
    badge: "redis-limiter",
  },
  {
    id: "otel",
    icon: <Activity size={24} strokeWidth={2.5} />,
    title: "Full Observability",
    accent: "var(--green)",
    shadowClass: "brut-card-green",
    body: "OpenTelemetry spans for every tool call, Prometheus metrics scraped at /metrics, structured JSON logs on stderr.",
    backTitle: "Telemetry Stack",
    backDetails: [
      { label: "Tracing Standard", val: "OpenTelemetry Spans" },
      { label: "Metrics Format", val: "Prometheus 0.0.4" },
      { label: "Scrape Endpoint", val: "/metrics" },
      { label: "Active Gauges", val: "WASM execution count" },
    ],
    badge: "opentelemetry",
  },
];

// ── Pinned Architecture Nodes ─────────────────────────────────────────────────

const ARCH_STEPS = [
  { id: 1, title: "1. AI Agent Request", sub: "HTTP POST /tools/call", color: "var(--yellow)", icon: <Zap size={20} /> },
  { id: 2, title: "2. JWT Auth Guard", sub: "HS256 Signature Check", color: "var(--coral)", icon: <Lock size={20} /> },
  { id: 3, title: "3. Redis Rate Limiter", sub: "Sliding Window Lua Script", color: "var(--blue)", icon: <Activity size={20} /> },
  { id: 4, title: "4. Tool Registry", sub: "Schema Validation & Dispatch", color: "var(--purple)", icon: <Cpu size={20} /> },
  { id: 5, title: "5. WASM Sandbox", sub: "Isolated Wasmtime Execution", color: "var(--green)", icon: <ShieldCheck size={20} /> },
];

// ── Benchmark Target Stats ────────────────────────────────────────────────────

const BENCHMARKS = [
  { label: "Sustained Throughput", target: 585.4, decimals: 1, suffix: " req/s", accent: "var(--yellow)" },
  { label: "P95 Latency", target: 4.2, decimals: 1, suffix: " ms", accent: "var(--blue)" },
  { label: "Error Rate", target: 0.0, decimals: 2, suffix: "%", accent: "var(--green)" },
  { label: "WASM Overhead", target: 0.4, decimals: 1, suffix: " ms", accent: "var(--coral)" },
];

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const btnCtaRef = useRef<HTMLAnchorElement>(null);

  // States
  const [loading, setLoading] = useState(true);
  const [flippedCard, setFlippedCard] = useState<string | null>(null);
  const [activeArchStep, setActiveArchStep] = useState(1);
  const [statValues, setStatValues] = useState<number[]>([0, 0, 0, 0]);

  // Intro Preloader Timeout
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 900);
    return () => clearTimeout(timer);
  }, []);

  // GSAP Animations
  useGSAP(
    () => {
      if (loading) return;

      // 1. Text Split & Entrance Animation for Headline
      if (headlineRef.current) {
        const split = new SplitType(headlineRef.current, { types: "chars" });
        if (split.chars) {
          gsap.fromTo(
            split.chars,
            { opacity: 0, y: 50, rotateX: -90 },
            {
              opacity: 1,
              y: 0,
              rotateX: 0,
              stagger: 0.04,
              duration: 1,
              ease: "back.out(1.7)",
              delay: 0.1,
            }
          );
        }
      }

      // 2. Navbar Scroll Compression with ScrollTrigger
      if (navRef.current) {
        ScrollTrigger.create({
          trigger: containerRef.current,
          start: "top -50px",
          onEnter: () => {
            gsap.to(navRef.current, {
              height: 50,
              backgroundColor: "rgba(17,18,20,0.95)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.8)",
              duration: 0.3,
            });
          },
          onLeaveBack: () => {
            gsap.to(navRef.current, {
              height: 64,
              backgroundColor: "rgba(17,18,20,0.8)",
              boxShadow: "none",
              duration: 0.3,
            });
          },
        });
      }

      // 3. Top Scroll Progress Bar (Width & Hue Shift)
      if (progressBarRef.current) {
        gsap.to(progressBarRef.current, {
          scaleX: 1,
          ease: "none",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.1,
            onUpdate: (self) => {
              const hue = Math.round(self.progress * 180 + 45); // Yellow -> Coral -> Blue
              if (progressBarRef.current) {
                progressBarRef.current.style.background = `hsl(${hue}, 100%, 50%)`;
              }
            },
          },
        });
      }

      // 4. Feature Cards 3D Scroll Entrance
      const featureCards = gsap.utils.toArray<HTMLElement>(".feature-card");
      featureCards.forEach((card, idx) => {
        gsap.fromTo(
          card,
          { opacity: 0, y: 60, rotateY: idx % 2 === 0 ? 25 : -25 },
          {
            opacity: 1,
            y: 0,
            rotateY: 0,
            duration: 0.8,
            ease: "power3.out",
            scrollTrigger: {
              trigger: card,
              start: "top 85%",
              toggleActions: "play none none reverse",
            },
          }
        );
      });

      // 5. Pinned Architecture Section ScrollTrigger
      const archSection = document.getElementById("arch-section");
      if (archSection) {
        ScrollTrigger.create({
          trigger: archSection,
          start: "top top",
          end: "+=1200",
          pin: true,
          scrub: 0.5,
          onUpdate: (self) => {
            const step = Math.min(5, Math.floor(self.progress * 5) + 1);
            setActiveArchStep(step);
          },
        });
      }

      // 6. Benchmarks Stat Counters via GSAP
      const benchSection = document.getElementById("bench-section");
      if (benchSection) {
        const obj = { val0: 0, val1: 0, val2: 0, val3: 0 };
        ScrollTrigger.create({
          trigger: benchSection,
          start: "top 75%",
          onEnter: () => {
            gsap.to(obj, {
              val0: BENCHMARKS[0].target,
              val1: BENCHMARKS[1].target,
              val2: BENCHMARKS[2].target,
              val3: BENCHMARKS[3].target,
              duration: 2,
              ease: "power2.out",
              onUpdate: () => {
                setStatValues([obj.val0, obj.val1, obj.val2, obj.val3]);
              },
            });
          },
        });
      }

      // 7. CTA Button Magnetic Hover Physics
      if (btnCtaRef.current) {
        const btn = btnCtaRef.current;
        const xTo = gsap.quickTo(btn, "x", { duration: 0.3, ease: "power2.out" });
        const yTo = gsap.quickTo(btn, "y", { duration: 0.3, ease: "power2.out" });

        const handleMouseMove = (e: MouseEvent) => {
          const rect = btn.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const dist = Math.hypot(dx, dy);

          if (dist < 100) {
            xTo(dx * 0.3);
            yTo(dy * 0.3);
          } else {
            xTo(0);
            yTo(0);
          }
        };

        const handleMouseLeave = () => {
          xTo(0);
          yTo(0);
        };

        window.addEventListener("mousemove", handleMouseMove);
        btn.addEventListener("mouseleave", handleMouseLeave);

        return () => {
          window.removeEventListener("mousemove", handleMouseMove);
          btn.removeEventListener("mouseleave", handleMouseLeave);
        };
      }
    },
    { scope: containerRef, dependencies: [loading] }
  );

  return (
    <div
      ref={containerRef}
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        overflowX: "hidden",
        position: "relative",
      }}
    >
      {/* ── Intro Preloader Screen ────────────────────────────────────────── */}
      {loading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "#111214",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              background: "var(--yellow)",
              border: "3px solid #000",
              borderRadius: 6,
              boxShadow: "4px 4px 0 #000",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "spin 1s ease-in-out infinite",
            }}
          >
            <Zap size={24} color="#000" strokeWidth={3} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase" }}>
            ISOLYTH INITIALISING…
          </span>
        </div>
      )}

      {/* ── Dynamic Top Scroll Progress Line ─────────────────────────────── */}
      <div
        ref={progressBarRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          zIndex: 1000,
          transformOrigin: "left",
          transform: "scaleX(0)",
          background: "var(--yellow)",
          borderBottom: "1px solid #000",
        }}
      />

      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <header
        ref={navRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 64,
          zIndex: 900,
          background: "rgba(17,18,20,0.8)",
          backdropFilter: "blur(12px)",
          borderBottom: "2px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          transition: "background 0.3s ease",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            width: "100%",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                background: "var(--yellow)",
                border: "2px solid #000",
                borderRadius: 4,
                boxShadow: "3px 3px 0 #000",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Zap size={16} color="#000" strokeWidth={3} />
            </div>
            <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.03em" }}>ISOLYTH</span>
          </div>

          {/* Links */}
          <nav style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {["features", "architecture", "benchmarks"].map((sec) => (
              <a
                key={sec}
                href={`#${sec}`}
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  textDecoration: "none",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--yellow)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              >
                {sec}
              </a>
            ))}
            <a
              href="/overview"
              className="btn-brut btn-yellow"
              style={{ padding: "6px 14px", fontSize: 12, textDecoration: "none" }}
            >
              Dashboard <ChevronRight size={14} />
            </a>
          </nav>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 — HERO WITH THREE.JS 3D CANVAS & GSAP HEADLINE               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          minHeight: "100vh",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "100px 24px 60px",
          overflow: "hidden",
        }}
      >
        {/* 3D WebGL Canvas Layer */}
        <HeroCanvas />

        {/* Foreground Content Layer */}
        <div style={{ position: "relative", zIndex: 10, textAlign: "center", maxWidth: 900 }}>
          {/* Badge */}
          <div style={{ marginBottom: 20, display: "inline-block" }}>
            <span className="badge badge-yellow" style={{ fontSize: 11, padding: "4px 14px", borderWidth: 2 }}>
              WASM Sandboxed MCP Tool Server · v0.1.0
            </span>
          </div>

          {/* GSAP SplitType Animated Headline */}
          <h1
            ref={headlineRef}
            id="hero-headline"
            style={{
              fontSize: "clamp(64px, 12vw, 120px)",
              fontWeight: 900,
              letterSpacing: "-0.05em",
              lineHeight: 0.88,
              marginBottom: 28,
              perspective: 1000,
            }}
          >
            ISO<span style={{ color: "var(--yellow)", textShadow: "5px 5px 0 #000" }}>LY</span>TH
          </h1>

          {/* Subheading */}
          <p
            style={{
              fontSize: "clamp(16px, 2.2vw, 22px)",
              fontWeight: 600,
              color: "var(--text-secondary)",
              maxWidth: 680,
              margin: "0 auto 40px",
              lineHeight: 1.5,
            }}
          >
            Zero-trust execution server for untrusted AI agent tool calls.
            Isolated Wasmtime WASM sandboxing, SSRF guards, JWT auth, and OpenTelemetry monitoring.
          </p>

          {/* CTA Group with Magnetic Physics */}
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <a
              ref={btnCtaRef}
              href="/try"
              className="btn-brut btn-yellow"
              style={{ padding: "14px 32px", fontSize: 14, textDecoration: "none" }}
            >
              <Terminal size={18} />
              Try Interactive Tool Tester
            </a>
            <a
              href="/overview"
              className="btn-brut btn-outline"
              style={{ padding: "14px 28px", fontSize: 14, textDecoration: "none" }}
            >
              Live Dashboard
            </a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 — WHY ISOLYTH (3D FLIP CARDS & SCROLLTRIGGER)               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section id="features" style={{ padding: "120px 24px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <span className="badge badge-coral" style={{ fontSize: 11, marginBottom: 12 }}>
            Security Matrix
          </span>
          <h2 style={{ fontSize: "clamp(36px, 6vw, 56px)", fontWeight: 900, letterSpacing: "-0.04em" }}>
            Defense in Depth, <span style={{ color: "var(--yellow)" }}>Built for LLM Agents</span>
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>
            Click or hover any card to inspect internal sandbox parameters on the flip side.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
          {FEATURES.map((f) => {
            const isFlipped = flippedCard === f.id;
            return (
              <div
                key={f.id}
                className="feature-card"
                onClick={() => setFlippedCard(isFlipped ? null : f.id)}
                style={{
                  perspective: 1000,
                  height: 320,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    position: "relative",
                    transformStyle: "preserve-3d",
                    transition: "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                    transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                  }}
                >
                  {/* FRONT SIDE */}
                  <div
                    className={`brut-card ${f.shadowClass}`}
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      padding: 24,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          background: f.accent,
                          border: "3px solid #000",
                          borderRadius: 6,
                          boxShadow: "3px 3px 0 #000",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#000",
                          marginBottom: 16,
                        }}
                      >
                        {f.icon}
                      </div>
                      <h3 style={{ fontSize: 18, fontWeight: 900, marginBottom: 8, letterSpacing: "-0.02em" }}>
                        {f.title}
                      </h3>
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6, fontWeight: 500 }}>
                        {f.body}
                      </p>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="badge badge-muted" style={{ fontSize: 9 }}>{f.badge}</span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>
                        Click to flip 🔄
                      </span>
                    </div>
                  </div>

                  {/* BACK SIDE */}
                  <div
                    className="brut-card"
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      transform: "rotateY(180deg)",
                      padding: 24,
                      background: "#18191d",
                      borderColor: f.accent,
                      boxShadow: `6px 6px 0 ${f.accent}`,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 900, color: f.accent, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
                        {f.backTitle}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {f.backDetails.map((item) => (
                          <div key={item.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 4 }}>
                            <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{item.label}</span>
                            <span style={{ fontWeight: 800, fontFamily: "monospace", color: "var(--text-primary)" }}>{item.val}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, textAlign: "right" }}>
                      Click to flip back 🔄
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3 — PINNED ARCHITECTURE FLOW (SCROLLTRIGGER SCROLL STORY)      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section
        id="arch-section"
        style={{
          minHeight: "100vh",
          background: "var(--bg-panel)",
          borderTop: "3px solid #000",
          borderBottom: "3px solid #000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 24px",
        }}
      >
        <div style={{ maxWidth: 1000, margin: "0 auto", width: "100%", textAlign: "center" }}>
          <span className="badge badge-blue" style={{ fontSize: 11, marginBottom: 16 }}>
            Pinned Interactive Pipeline
          </span>
          <h2 style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 900, marginBottom: 48, letterSpacing: "-0.03em" }}>
            Request Execution <span style={{ color: "var(--blue)" }}>Pipeline</span>
          </h2>

          {/* Horizontal Step Pipeline */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 40 }}>
            {ARCH_STEPS.map((step) => {
              const isActive = activeArchStep >= step.id;
              return (
                <div
                  key={step.id}
                  className="brut-card"
                  style={{
                    padding: "16px 20px",
                    minWidth: 170,
                    boxShadow: isActive ? `5px 5px 0 ${step.color}` : "3px 3px 0 #000",
                    borderColor: isActive ? step.color : "#000",
                    background: isActive ? "#1e2025" : "rgba(255,255,255,0.02)",
                    opacity: isActive ? 1 : 0.4,
                    transform: isActive ? "scale(1.05)" : "scale(1)",
                    transition: "all 0.3s ease",
                  }}
                >
                  <div style={{ color: step.color, marginBottom: 8, display: "flex", justifyContent: "center" }}>
                    {step.icon}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "var(--text-primary)" }}>{step.title}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, fontWeight: 600 }}>{step.sub}</div>
                </div>
              );
            })}
          </div>

          {/* Active Step Progress Status */}
          <div
            style={{
              padding: "16px 24px",
              background: "var(--bg-card)",
              border: "3px solid #000",
              borderRadius: 6,
              boxShadow: "5px 5px 0 #000",
              maxWidth: 600,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)" }}>
              CURRENT SCROLL STEP:
            </span>
            <span style={{ fontSize: 13, fontWeight: 900, color: ARCH_STEPS[activeArchStep - 1].color }}>
              {ARCH_STEPS[activeArchStep - 1].title} ({ARCH_STEPS[activeArchStep - 1].sub})
            </span>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4 — BENCHMARKS (GSAP COUNT UP STATS)                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <section id="bench-section" style={{ padding: "120px 24px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <span className="badge badge-green" style={{ fontSize: 11, marginBottom: 12 }}>
            Locust Verified Metrics
          </span>
          <h2 style={{ fontSize: "clamp(36px, 6vw, 56px)", fontWeight: 900, letterSpacing: "-0.04em" }}>
            Production Benchmark <span style={{ color: "var(--green)" }}>Results</span>
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>
            Sustained load test with 500 concurrent virtual users.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24 }}>
          {BENCHMARKS.map((b, idx) => (
            <div
              key={b.label}
              className="brut-card"
              style={{
                padding: "32px 24px",
                boxShadow: `6px 6px 0 ${b.accent}`,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "clamp(42px, 6vw, 56px)", fontWeight: 900, color: b.accent, lineHeight: 1, marginBottom: 8 }}>
                {statValues[idx].toFixed(b.decimals)}
                <span style={{ fontSize: "0.55em" }}>{b.suffix}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {b.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* FOOTER                                                                 */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <footer
        style={{
          background: "var(--bg-panel)",
          borderTop: "3px solid #000",
          padding: "40px 24px",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, background: "var(--yellow)", border: "3px solid #000", borderRadius: 4, boxShadow: "3px 3px 0 #000", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={18} color="#000" strokeWidth={3} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 900 }}>ISOLYTH</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>MIT License · WASM MCP Tool Server</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <a href="/try" style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textDecoration: "none" }}>Try Tool</a>
            <a href="/overview" style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textDecoration: "none" }}>Dashboard</a>
            <a href="https://github.com/adarshthakur9240/Isolyth" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textDecoration: "none" }}>GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
