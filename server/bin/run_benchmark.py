#!/usr/bin/env python3
"""
run_benchmark.py – Automated Performance & Overhead Benchmark Script
========================================================================
Runs an automated Locust load test against the Isolyth MCP tool server
to compare:
  1. WASM Sandbox Execution (`code_exec_tool`)
  2. Plain Tool Execution (`file_ops_tool` / `db_query_tool`)

Outputs:
  • Requests per second (RPS)
  • p50 / p95 / p99 Latency (ms)
  • WASM Sandbox Overhead Comparison Table

Usage:
  python server/bin/run_benchmark.py
"""

import contextlib
import csv
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

PORT = 8000
HOST = f"http://localhost:{PORT}"


def wait_for_server(url: str, timeout_s: float = 10.0) -> bool:
    """Poll health check endpoint until server is ready."""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


def run_benchmark() -> None:
    print("=" * 70)
    print(" 🚀 Starting Isolyth Performance & WASM Sandbox Overhead Benchmark")
    print("=" * 70)

    # 1. Start HTTP Server as subprocess
    env = os.environ.copy()
    env["PORT"] = str(PORT)
    env["REQUIRE_AUTH"] = "false"
    env["PYTHONPATH"] = str(PROJECT_ROOT)

    server_proc = subprocess.Popen(
        [sys.executable, str(PROJECT_ROOT / "server" / "http_server.py")],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        print("Waiting for HTTP server to start...")
        if not wait_for_server(HOST):
            print("❌ Server failed to start within timeout.")
            return
        print("✅ HTTP server ready on", HOST)

        # 2. Run Locust Headless Benchmark
        print("\n🔥 Running Locust Load Test (100 Virtual Users, 30s Ramp-up, 15s Duration)...")
        csv_prefix = PROJECT_ROOT / "server" / "benchmark_stats"
        locust_cmd = [
            "locust",
            "-f", str(PROJECT_ROOT / "server" / "locustfile.py"),
            "--headless",
            "-u", "100",
            "-r", "3.33",
            "--run-time", "15s",
            "--host", HOST,
            "--csv", str(csv_prefix),
            "MixedMCPUser",
        ]

        result = subprocess.run(locust_cmd, capture_output=True, text=True)

        if result.returncode != 0 and "KeyboardInterrupt" not in result.stderr:
            print("Locust stderr:", result.stderr)

        # 3. Parse CSV Stats
        stats_csv = PROJECT_ROOT / "server" / "benchmark_stats_stats.csv"
        if not stats_csv.exists():
            print("❌ Could not find benchmark stats CSV output.")
            return

        rows = []
        with open(stats_csv, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)

        print("\n" + "=" * 70)
        print(" 📊 ISOLYTH BENCHMARK RESULTS & WASM OVERHEAD SUMMARY")
        print("=" * 70)
        print(f"{'Type / Target':<35} | {'RPS':<8} | {'p50 (ms)':<9} | {'p95 (ms)':<9} | {'p99 (ms)':<9} | {'Fail %':<6}")
        print("-" * 88)

        wasm_p50 = 0.0
        plain_p50 = 0.0

        for r in rows:
            name = r.get("Name", "")
            req_count = r.get("Request Count", "0")
            rps = r.get("Requests/s", "0.0")
            p50 = r.get("50%", "0.0")
            p95 = r.get("95%", "0.0")
            p99 = r.get("99%", "0.0")
            fails = r.get("Failure Count", "0")

            try:
                fail_pct = f"{float(fails) / max(1, int(req_count)) * 100:.1f}%"
                rps_fmt = f"{float(rps):.1f}"
                p50_fmt = f"{float(p50):.1f}"
                p95_fmt = f"{float(p95):.1f}"
                p99_fmt = f"{float(p99):.1f}"
            except ValueError:
                fail_pct = "0%"
                rps_fmt, p50_fmt, p95_fmt, p99_fmt = rps, p50, p95, p99

            if "code_exec" in name:
                with contextlib.suppress(ValueError):
                    wasm_p50 = float(p50)
            elif "file_ops" in name:
                with contextlib.suppress(ValueError):
                    plain_p50 = float(p50)

            disp_name = name[:34] if name != "Aggregated" else "TOTAL AGGREGATED"
            print(f"{disp_name:<35} | {rps_fmt:<8} | {p50_fmt:<9} | {p95_fmt:<9} | {p99_fmt:<9} | {fail_pct:<6}")

        print("-" * 88)
        if wasm_p50 > 0 and plain_p50 > 0:
            overhead = wasm_p50 - plain_p50
            print(f"💡 WASM Sandbox Overhead: +{overhead:.2f} ms p50 latency over plain tool calls")
            print(f"   (WASM Sandbox p50: {wasm_p50:.2f} ms vs Plain Tool p50: {plain_p50:.2f} ms)")
        print("=" * 70)

        # Cleanup CSV artifacts
        for p in PROJECT_ROOT.glob("server/benchmark_stats_*"):
            with contextlib.suppress(OSError):
                p.unlink()

    finally:
        server_proc.terminate()
        try:
            server_proc.wait(timeout=2.0)
        except Exception:
            server_proc.kill()


if __name__ == "__main__":
    run_benchmark()
