//! factorial/src/main.rs
//!
//! Reads a single non-negative integer from stdin, computes its factorial,
//! and prints the result to stdout.
//!
//! Compiled to WebAssembly via:
//!
//!   cargo build --target wasm32-wasip1 --release
//!
//! The resulting binary is at:
//!   target/wasm32-wasip1/release/factorial.wasm
//!
//! Copy it into the shared wasm_modules directory:
//!   cp target/wasm32-wasip1/release/factorial.wasm \
//!      ../factorial.wasm
//!
//! Quick test with wasmtime CLI (optional):
//!   wasmtime run --fuel 100000000 ../factorial.wasm <<< "10"
//!   # Expected: 3628800

use std::io::{self, BufRead, Write};
use std::process;

fn factorial(n: u64) -> Option<u128> {
    // Use u128 to handle inputs up to 34! without overflow.
    // (34! ≈ 2.95 × 10^38, which fits in a u128; 35! would overflow.)
    let mut result: u128 = 1;
    for i in 2..=n as u128 {
        result = result.checked_mul(i)?;
    }
    Some(result)
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());

    // Read the first non-empty line from stdin.
    let line = stdin
        .lock()
        .lines()
        .next()
        .unwrap_or_else(|| {
            eprintln!("Error: no input provided on stdin");
            process::exit(1);
        })
        .unwrap_or_else(|e| {
            eprintln!("Error: failed to read stdin: {e}");
            process::exit(1);
        });

    let trimmed = line.trim();

    // Parse as a u64 (negative numbers are rejected by the type).
    let n: u64 = trimmed.parse().unwrap_or_else(|_| {
        eprintln!("Error: expected a non-negative integer, got {:?}", trimmed);
        process::exit(1);
    });

    // Compute with overflow detection.
    match factorial(n) {
        Some(result) => {
            writeln!(out, "{result}").unwrap_or_else(|e| {
                eprintln!("Error: failed to write output: {e}");
                process::exit(1);
            });
        }
        None => {
            eprintln!(
                "Error: {n}! overflows u128 (max supported input is 34)"
            );
            process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_factorial_base_cases() {
        assert_eq!(factorial(0), Some(1));
        assert_eq!(factorial(1), Some(1));
    }

    #[test]
    fn test_factorial_small() {
        assert_eq!(factorial(5), Some(120));
        assert_eq!(factorial(10), Some(3_628_800));
    }

    #[test]
    fn test_factorial_20() {
        assert_eq!(factorial(20), Some(2_432_902_008_176_640_000));
    }

    #[test]
    fn test_factorial_large_u128() {
        // 34! fits in u128; 35! overflows.
        assert!(factorial(34).is_some());
        assert!(factorial(35).is_none());
    }
}
