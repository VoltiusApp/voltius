use serde_json::Value;
use std::fmt::Display;
use std::io::Write;

pub struct Output {
    pub json: bool,
    pub quiet: bool,
    sink: Box<dyn Write>,
    err: Box<dyn Write>,
}

impl Output {
    pub fn stdout(json: bool, quiet: bool) -> Self {
        Self::with_sinks(
            json,
            quiet,
            Box::new(anstream::stdout()),
            Box::new(anstream::stderr()),
        )
    }

    pub fn with_sink(json: bool, quiet: bool, sink: Box<dyn Write>) -> Self {
        Self::with_sinks(json, quiet, sink, Box::new(std::io::sink()))
    }

    pub fn with_sinks(json: bool, quiet: bool, sink: Box<dyn Write>, err: Box<dyn Write>) -> Self {
        Output {
            json,
            quiet,
            sink,
            err,
        }
    }

    pub fn warn(&mut self, message: impl Display) {
        if !self.quiet {
            let yellow = anstyle::AnsiColor::Yellow.on_default();
            let _ = writeln!(self.err, "{yellow}warning{yellow:#}: {message}");
        }
    }

    pub fn line(&mut self, styled: impl Display) {
        if !self.quiet {
            let _ = writeln!(self.sink, "{styled}");
        }
    }

    pub fn json(&mut self, v: &Value) {
        let text = serde_json::to_string_pretty(v).unwrap_or_default();
        let _ = writeln!(self.sink, "{text}");
    }
}
