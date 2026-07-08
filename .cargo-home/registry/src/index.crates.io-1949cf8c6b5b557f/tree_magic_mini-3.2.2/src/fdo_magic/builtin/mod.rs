//! Read magic file bundled in crate

use super::MagicRule;
use crate::Mime;
use petgraph::prelude::*;
use std::collections::HashMap;
use std::sync::LazyLock;

pub mod check;
pub mod init;

#[cfg(not(feature = "with-gpl-data"))]
mod runtime;

/// Preload alias list
static ALIASES: LazyLock<HashMap<Mime, Mime>> = LazyLock::new(init::get_aliaslist);

/// Load magic file before anything else.
static ALL_RULES: LazyLock<HashMap<Mime, DiGraph<MagicRule<'static>, u32>>> = LazyLock::new(|| {
    #[cfg(feature = "with-gpl-data")]
    return super::ruleset::from_u8(tree_magic_db::magic()).unwrap_or_default();
    #[cfg(not(feature = "with-gpl-data"))]
    return runtime::rules().unwrap_or_default();
});
