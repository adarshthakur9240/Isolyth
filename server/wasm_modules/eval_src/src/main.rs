//! eval/src/main.rs
//!
//! A hand-rolled recursive-descent math expression evaluator compiled to
//! wasm32-wasip1.  Reads one expression from stdin, prints the result to
//! stdout, and exits 0 on success or 1 on a parse/evaluation error.
//!
//! Supported syntax:
//!   Literals : integers and floats (e.g. 42, 3.14, 1e-3)
//!   Operators: + - * / % ^ (right-associative power)
//!   Groups   : (expr)
//!   Functions: abs, sqrt, floor, ceil, round, min(a,b), max(a,b), log, log2, log10, sin, cos, tan
//!   Constants: pi, e
//!
//! Grammar (simplified):
//!   expr   = addend (('+' | '-') addend)*
//!   addend = factor (('*' | '/' | '%') factor)*
//!   factor = primary ('^' factor)?         // right-associative
//!   primary= NUMBER | CONST | FUNC '(' args ')' | '(' expr ')' | '-' primary
//!   args   = expr (',' expr)*
//!
//! Build:
//!   cd server/wasm_modules/eval_src
//!   cargo build --target wasm32-wasip1 --release
//!   cp target/wasm32-wasip1/release/eval.wasm ../eval.wasm

use std::io::{self, BufRead};
use std::iter::Peekable;
use std::str::Chars;
use std::process;

// ─── Tokeniser ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Caret,
    LParen,
    RParen,
    Comma,
}

struct Lexer<'a> {
    chars: Peekable<Chars<'a>>,
}

impl<'a> Lexer<'a> {
    fn new(src: &'a str) -> Self {
        Lexer { chars: src.chars().peekable() }
    }

    fn skip_whitespace(&mut self) {
        while self.chars.peek().map(|c| c.is_whitespace()).unwrap_or(false) {
            self.chars.next();
        }
    }

    fn read_number(&mut self, first: char) -> Result<Token, String> {
        let mut s = String::from(first);
        while let Some(&c) = self.chars.peek() {
            if c.is_ascii_digit() || c == '.' || c == 'e' || c == 'E' {
                s.push(c);
                self.chars.next();
                // handle optional sign after exponent marker
                if (c == 'e' || c == 'E') {
                    if let Some(&sign) = self.chars.peek() {
                        if sign == '+' || sign == '-' {
                            s.push(sign);
                            self.chars.next();
                        }
                    }
                }
            } else {
                break;
            }
        }
        s.parse::<f64>()
            .map(Token::Number)
            .map_err(|_| format!("Invalid number: {s:?}"))
    }

    fn read_ident(&mut self, first: char) -> Token {
        let mut s = String::from(first);
        while let Some(&c) = self.chars.peek() {
            if c.is_alphanumeric() || c == '_' {
                s.push(c);
                self.chars.next();
            } else {
                break;
            }
        }
        Token::Ident(s)
    }

    fn tokenise(&mut self) -> Result<Vec<Token>, String> {
        let mut tokens = Vec::new();
        loop {
            self.skip_whitespace();
            match self.chars.next() {
                None => break,
                Some('+') => tokens.push(Token::Plus),
                Some('-') => tokens.push(Token::Minus),
                Some('*') => tokens.push(Token::Star),
                Some('/') => tokens.push(Token::Slash),
                Some('%') => tokens.push(Token::Percent),
                Some('^') => tokens.push(Token::Caret),
                Some('(') => tokens.push(Token::LParen),
                Some(')') => tokens.push(Token::RParen),
                Some(',') => tokens.push(Token::Comma),
                Some(c) if c.is_ascii_digit() || c == '.' => {
                    tokens.push(self.read_number(c)?);
                }
                Some(c) if c.is_alphabetic() || c == '_' => {
                    tokens.push(self.read_ident(c));
                }
                Some(c) => return Err(format!("Unexpected character: {c:?}")),
            }
        }
        Ok(tokens)
    }
}

// ─── Parser / evaluator ──────────────────────────────────────────────────────

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Parser { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn consume(&mut self) -> Option<Token> {
        let t = self.tokens.get(self.pos).cloned();
        if t.is_some() { self.pos += 1; }
        t
    }

    fn expect(&mut self, expected: &Token) -> Result<(), String> {
        match self.peek() {
            Some(t) if t == expected => { self.consume(); Ok(()) }
            Some(t) => Err(format!("Expected {expected:?} but got {t:?}")),
            None => Err(format!("Expected {expected:?} but got end of input")),
        }
    }

    // expr = addend (('+' | '-') addend)*
    fn parse_expr(&mut self) -> Result<f64, String> {
        let mut left = self.parse_addend()?;
        loop {
            match self.peek() {
                Some(Token::Plus) => { self.consume(); left += self.parse_addend()?; }
                Some(Token::Minus) => { self.consume(); left -= self.parse_addend()?; }
                _ => break,
            }
        }
        Ok(left)
    }

    // addend = factor (('*' | '/' | '%') factor)*
    fn parse_addend(&mut self) -> Result<f64, String> {
        let mut left = self.parse_factor()?;
        loop {
            match self.peek() {
                Some(Token::Star) => { self.consume(); left *= self.parse_factor()?; }
                Some(Token::Slash) => {
                    self.consume();
                    let right = self.parse_factor()?;
                    if right == 0.0 { return Err("Division by zero".to_string()); }
                    left /= right;
                }
                Some(Token::Percent) => {
                    self.consume();
                    let right = self.parse_factor()?;
                    if right == 0.0 { return Err("Modulo by zero".to_string()); }
                    left %= right;
                }
                _ => break,
            }
        }
        Ok(left)
    }

    // factor = primary ('^' factor)?   (right-associative)
    fn parse_factor(&mut self) -> Result<f64, String> {
        let base = self.parse_primary()?;
        if let Some(Token::Caret) = self.peek() {
            self.consume();
            let exp = self.parse_factor()?;
            Ok(base.powf(exp))
        } else {
            Ok(base)
        }
    }

    // primary = NUMBER | CONST | FUNC '(' args ')' | '(' expr ')' | '-' primary
    fn parse_primary(&mut self) -> Result<f64, String> {
        match self.peek().cloned() {
            Some(Token::Number(n)) => { self.consume(); Ok(n) }

            Some(Token::Minus) => {
                self.consume();
                Ok(-self.parse_primary()?)
            }

            Some(Token::LParen) => {
                self.consume();
                let val = self.parse_expr()?;
                self.expect(&Token::RParen)?;
                Ok(val)
            }

            Some(Token::Ident(name)) => {
                self.consume();
                // Constants
                match name.as_str() {
                    "pi" => return Ok(std::f64::consts::PI),
                    "e"  => return Ok(std::f64::consts::E),
                    _ => {}
                }
                // Functions — must be followed by '('
                match self.peek() {
                    Some(Token::LParen) => {
                        self.consume(); // eat '('
                        let val = self.call_function(&name)?;
                        self.expect(&Token::RParen)?;
                        Ok(val)
                    }
                    _ => Err(format!("Unknown identifier {name:?} (missing parentheses for function call?)"))
                }
            }

            Some(t) => Err(format!("Unexpected token in expression: {t:?}")),
            None => Err("Unexpected end of input".to_string()),
        }
    }

    fn call_function(&mut self, name: &str) -> Result<f64, String> {
        // Parse argument list
        let mut args: Vec<f64> = Vec::new();
        loop {
            if let Some(Token::RParen) = self.peek() {
                break; // zero-arg call (shouldn't happen for our functions but be safe)
            }
            args.push(self.parse_expr()?);
            match self.peek() {
                Some(Token::Comma) => { self.consume(); }
                _ => break,
            }
        }

        let one_arg = |args: &Vec<f64>| -> Result<f64, String> {
            if args.len() == 1 { Ok(args[0]) }
            else { Err(format!("{name}() takes 1 argument, got {}", args.len())) }
        };
        let two_args = |args: &Vec<f64>| -> Result<(f64, f64), String> {
            if args.len() == 2 { Ok((args[0], args[1])) }
            else { Err(format!("{name}() takes 2 arguments, got {}", args.len())) }
        };

        match name {
            "abs"   => { let a = one_arg(&args)?; Ok(a.abs()) }
            "sqrt"  => { let a = one_arg(&args)?; Ok(a.sqrt()) }
            "floor" => { let a = one_arg(&args)?; Ok(a.floor()) }
            "ceil"  => { let a = one_arg(&args)?; Ok(a.ceil()) }
            "round" => { let a = one_arg(&args)?; Ok(a.round()) }
            "log"   => { let a = one_arg(&args)?; Ok(a.ln()) }
            "log2"  => { let a = one_arg(&args)?; Ok(a.log2()) }
            "log10" => { let a = one_arg(&args)?; Ok(a.log10()) }
            "sin"   => { let a = one_arg(&args)?; Ok(a.sin()) }
            "cos"   => { let a = one_arg(&args)?; Ok(a.cos()) }
            "tan"   => { let a = one_arg(&args)?; Ok(a.tan()) }
            "min"   => { let (a, b) = two_args(&args)?; Ok(a.min(b)) }
            "max"   => { let (a, b) = two_args(&args)?; Ok(a.max(b)) }
            _ => Err(format!("Unknown function: {name:?}")),
        }
    }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

fn evaluate(input: &str) -> Result<f64, String> {
    let mut lexer = Lexer::new(input);
    let tokens = lexer.tokenise()?;
    if tokens.is_empty() {
        return Err("Empty expression".to_string());
    }
    let mut parser = Parser::new(tokens);
    let result = parser.parse_expr()?;
    if parser.pos < parser.tokens.len() {
        return Err(format!(
            "Unexpected trailing token: {:?}",
            parser.tokens[parser.pos]
        ));
    }
    Ok(result)
}

fn main() {
    let stdin = io::stdin();
    let line = match stdin.lock().lines().next() {
        Some(Ok(l)) => l,
        Some(Err(e)) => {
            eprintln!("Error reading stdin: {e}");
            process::exit(1);
        }
        None => {
            eprintln!("No input provided");
            process::exit(1);
        }
    };

    match evaluate(line.trim()) {
        Ok(result) => {
            // Print without trailing zeros for integer results.
            if result.fract() == 0.0 && result.abs() < 1e15 {
                println!("{}", result as i64);
            } else {
                println!("{result}");
            }
        }
        Err(e) => {
            eprintln!("Error: {e}");
            process::exit(1);
        }
    }
}

// ─── Unit tests (run with `cargo test`, not compiled into WASM) ──────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn eval(s: &str) -> f64 {
        evaluate(s).unwrap()
    }

    #[test]
    fn test_basic_arithmetic() {
        assert_eq!(eval("2 + 3"), 5.0);
        assert_eq!(eval("10 - 4"), 6.0);
        assert_eq!(eval("3 * 4"), 12.0);
        assert_eq!(eval("10 / 4"), 2.5);
        assert_eq!(eval("10 % 3"), 1.0);
    }

    #[test]
    fn test_power() {
        assert_eq!(eval("2 ^ 10"), 1024.0);
        assert_eq!(eval("2 ^ 3 ^ 2"), 512.0); // right-associative: 2^(3^2) = 2^9
    }

    #[test]
    fn test_precedence() {
        assert_eq!(eval("2 + 3 * 4"), 14.0);
        assert_eq!(eval("(2 + 3) * 4"), 20.0);
    }

    #[test]
    fn test_negation() {
        assert_eq!(eval("-5"), -5.0);
        assert_eq!(eval("-(3 + 2)"), -5.0);
    }

    #[test]
    fn test_functions() {
        assert_eq!(eval("abs(-7)"), 7.0);
        assert!((eval("sqrt(2)") - 1.4142135623).abs() < 1e-8);
        assert_eq!(eval("floor(3.7)"), 3.0);
        assert_eq!(eval("ceil(3.2)"), 4.0);
        assert_eq!(eval("round(3.5)"), 4.0);
        assert_eq!(eval("min(3, 7)"), 3.0);
        assert_eq!(eval("max(3, 7)"), 7.0);
    }

    #[test]
    fn test_constants() {
        assert!((eval("pi") - std::f64::consts::PI).abs() < 1e-10);
        assert!((eval("e") - std::f64::consts::E).abs() < 1e-10);
    }

    #[test]
    fn test_error_division_by_zero() {
        assert!(evaluate("1 / 0").is_err());
    }

    #[test]
    fn test_error_unknown_function() {
        assert!(evaluate("foo(1)").is_err());
    }

    #[test]
    fn test_error_unmatched_paren() {
        assert!(evaluate("(1 + 2").is_err());
    }
}
