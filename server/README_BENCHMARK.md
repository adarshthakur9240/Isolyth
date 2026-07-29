# 🚀 Isolyth Load Testing & WASM Sandbox Benchmark Guide

This directory contains the Locust load-testing suite and automated benchmark script for measuring throughput, latency distribution (p50 / p95 / p99), and WASM sandbox overhead on the Isolyth MCP tool server.

---

## 📋 Quick Start

### Option 1: Automated Benchmark & Overhead Comparison Script

Run the self-contained benchmark script:

```bash
python server/bin/run_benchmark.py
```

This will automatically:
1. Spin up the Isolyth HTTP server (`server/http_server.py`) on port 8000.
2. Launch Locust in headless mode with **100 concurrent virtual users** ramping up over **30 seconds**.
3. Measure requests per second (RPS), latency percentiles (p50, p95, p99), and failure rates.
4. Output a summary table comparing WASM Sandbox (`code_exec`) vs. Plain Tool (`file_ops`, `db_query`, `web_fetch`) latency.

---

### Option 2: Interactive Locust Web Interface

1. Start the HTTP server:
   ```bash
   python server/http_server.py
   ```

2. Start the Locust web UI:
   ```bash
   locust -f server/locustfile.py --host http://localhost:8000
   ```

3. Open your browser to `http://localhost:8089`:
   * **Number of users**: `100`
   * **Ramp up rate**: `3.33` (reaches 100 users in 30s)
   * **Host**: `http://localhost:8000`

---

### Option 3: Headless Command Line Load Test

```bash
locust -f server/locustfile.py \
  --headless \
  -u 100 \
  -r 3.33 \
  --run-time 1m \
  --host http://localhost:8000
```

---

## 📊 Sample Output Format

When running `locust` or `run_benchmark.py`, you will get a report containing:

```text
======================================================================
 📊 ISOLYTH BENCHMARK RESULTS & WASM OVERHEAD SUMMARY
======================================================================
Type / Target                       | RPS      | p50 (ms)  | p95 (ms)  | p99 (ms)  | Fail %
----------------------------------------------------------------------
/tools/call [code_exec - WASM]      | 245.2    | 3.8       | 7.2       | 12.1      | 0.0%
/tools/call [file_ops]              | 312.6    | 1.4       | 3.1       | 5.8       | 0.0%
/tools/call [web_fetch]             | 185.1    | 2.1       | 4.5       | 8.2       | 0.0%
/tools/call [db_query]              | 298.4    | 1.6       | 3.4       | 6.1       | 0.0%
----------------------------------------------------------------------
TOTAL AGGREGATED                    | 1041.3   | 2.2       | 5.1       | 9.4       | 0.0%
----------------------------------------------------------------------
💡 WASM Sandbox Overhead: +2.40 ms p50 latency over plain tool calls
   (WASM Sandbox p50: 3.80 ms vs Plain Tool p50: 1.40 ms)
======================================================================
```

---

## 🔍 Understanding the Overhead

* **Plain Tool Call (`file_ops`, `db_query`)**: Executes direct Python logic (filesystem resolution, parameter validation, etc.).
* **WASM Sandbox (`code_exec`)**: Performs WASM `Engine`/`Store`/`WasiConfig` instantiation, fuel accounting, and epoch deadline management inside `wasmtime-py`.
* **Overhead Difference**: Represents the cost of isolation (memory limits, fuel traps, wall-clock epoch interrupt hooks).
