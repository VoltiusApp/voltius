use serde_json::Value;
use std::fmt::Display;
use std::io::Write;

pub struct Output {
    pub json: bool,
    pub quiet: bool,
    sink: Box<dyn Write>,
}

impl Output {
    pub fn stdout(json: bool, quiet: bool) -> Self {
        Self::with_sink(json, quiet, Box::new(anstream::stdout()))
    }

    pub fn with_sink(json: bool, quiet: bool, sink: Box<dyn Write>) -> Self {
        Output { json, quiet, sink }
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
