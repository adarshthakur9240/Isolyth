/*
 * factorial.c – SUPERSEDED by the Rust implementation
 * =====================================================
 * This C source is kept for reference only.
 * The canonical build target is now the Rust project at:
 *
 *   server/wasm_modules/factorial_src/
 *
 * ─── Compile to factorial.wasm (Rust / Cargo) ────────────────────────────────
 *
 * From the project root (requires rustc >= 1.95 and wasm32-wasip1 target):
 *
 *   cd server/wasm_modules/factorial_src
 *   cargo build --target wasm32-wasip1 --release
 *   cp target/wasm32-wasip1/release/factorial.wasm ../factorial.wasm
 *
 * Or as a single shell one-liner from the project root:
 *
 *   (cd server/wasm_modules/factorial_src && \
 *    cargo build --target wasm32-wasip1 --release) && \
 *   cp server/wasm_modules/factorial_src/target/wasm32-wasip1/release/factorial.wasm \
 *      server/wasm_modules/factorial.wasm
 *
 * ─── Quick test with wasmtime CLI ────────────────────────────────────────────
 *   wasmtime run --fuel 100000000 server/wasm_modules/factorial.wasm <<< "10"
 *   # Expected output: 3628800
 *
 * ─── C reference implementation (not compiled) ───────────────────────────────
 */

#include <stdio.h>
#include <stdint.h>

int main(void) {
    long long n;
    if (scanf("%lld", &n) != 1 || n < 0) {
        fprintf(stderr, "Error: expected a non-negative integer on stdin\n");
        return 1;
    }

    /* Cap at 20 to avoid overflow with 64-bit integers. */
    if (n > 20) {
        fprintf(stderr, "Error: input must be <= 20 to avoid integer overflow\n");
        return 1;
    }

    uint64_t result = 1;
    for (long long i = 2; i <= n; i++) {
        result *= (uint64_t)i;
    }

    printf("%llu\n", (unsigned long long)result);
    return 0;
}

