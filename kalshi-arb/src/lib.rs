// Temporary lib target so we can run `cargo test --lib` on individual modules
// while main.rs is being refactored. Remove once main.rs compiles again.
pub mod config;
pub mod engine;
pub mod execution;
pub mod feed;
// Note: pipeline and tui modules excluded — they have cross-references to types
// that will be refactored. Re-add once main.rs is cleaned up.
