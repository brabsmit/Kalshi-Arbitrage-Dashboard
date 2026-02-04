use crate::config::{MomentumConfig, RiskConfig, SimulationConfig, StrategyConfig};
use crate::pipeline::{FairValueSource, SportPipeline};

#[derive(Debug, Clone)]
pub struct ConfigField {
    pub label: String,
    pub value: String,
    pub field_type: FieldType,
    pub is_override: bool,   // differs from global default
    pub config_path: String, // TOML dotted path for persistence
    pub read_only: bool,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum FieldType {
    U8,
    U16,
    U32,
    U64,
    F64,
    Bool,
    String,
    Enum(Vec<std::string::String>),
}

#[derive(Debug, Clone)]
pub struct ConfigTab {
    pub label: String,
    pub sport_key: Option<String>, // None for Global tab
    pub fields: Vec<ConfigField>,
}

#[derive(Debug, Clone)]
pub struct ConfigViewState {
    pub tabs: Vec<ConfigTab>,
    pub active_tab: usize,
    pub selected_field: usize,
    pub editing: bool,
    pub edit_buffer: String,
}

impl ConfigViewState {
    pub fn new(tabs: Vec<ConfigTab>) -> Self {
        Self {
            tabs,
            active_tab: 0,
            selected_field: 0,
            editing: false,
            edit_buffer: String::new(),
        }
    }
}

pub fn build_config_tabs(
    pipelines: &[SportPipeline],
    global_strategy: &StrategyConfig,
    global_momentum: &MomentumConfig,
    risk: &RiskConfig,
    sim: &SimulationConfig,
    available_odds_sources: &[String],
) -> Vec<ConfigTab> {
    let mut tabs = Vec::new();

    // Global tab
    tabs.push(ConfigTab {
        label: "Global".to_string(),
        sport_key: None,
        fields: build_global_fields(global_strategy, global_momentum, risk, sim),
    });

    // Per-sport tabs
    for pipe in pipelines {
        tabs.push(ConfigTab {
            label: pipe.label.clone(),
            sport_key: Some(pipe.key.clone()),
            fields: build_sport_fields(
                pipe,
                global_strategy,
                global_momentum,
                available_odds_sources,
            ),
        });
    }

    tabs
}

fn build_global_fields(
    strategy: &StrategyConfig,
    momentum: &MomentumConfig,
    risk: &RiskConfig,
    sim: &SimulationConfig,
) -> Vec<ConfigField> {
    vec![
        // Strategy
        ConfigField {
            label: "strategy.taker_edge_threshold".to_string(),
            value: strategy.taker_edge_threshold.to_string(),
            field_type: FieldType::U8,
            is_override: false,
            config_path: "strategy.taker_edge_threshold".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "strategy.maker_edge_threshold".to_string(),
            value: strategy.maker_edge_threshold.to_string(),
            field_type: FieldType::U8,
            is_override: false,
            config_path: "strategy.maker_edge_threshold".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "strategy.min_edge_after_fees".to_string(),
            value: strategy.min_edge_after_fees.to_string(),
            field_type: FieldType::U8,
            is_override: false,
            config_path: "strategy.min_edge_after_fees".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "strategy.max_edge_threshold".to_string(),
            value: strategy.max_edge_threshold.to_string(),
            field_type: FieldType::U8,
            is_override: false,
            config_path: "strategy.max_edge_threshold".to_string(),
            read_only: false,
        },
        // Risk
        ConfigField {
            label: "risk.kelly_fraction".to_string(),
            value: format!("{}", risk.kelly_fraction),
            field_type: FieldType::F64,
            is_override: false,
            config_path: "risk.kelly_fraction".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "risk.max_contracts_per_market".to_string(),
            value: risk.max_contracts_per_market.to_string(),
            field_type: FieldType::U32,
            is_override: false,
            config_path: "risk.max_contracts_per_market".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "risk.max_total_exposure_cents".to_string(),
            value: risk.max_total_exposure_cents.to_string(),
            field_type: FieldType::U64,
            is_override: false,
            config_path: "risk.max_total_exposure_cents".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "risk.max_concurrent_markets".to_string(),
            value: risk.max_concurrent_markets.to_string(),
            field_type: FieldType::U32,
            is_override: false,
            config_path: "risk.max_concurrent_markets".to_string(),
            read_only: false,
        },
        // Momentum
        ConfigField {
            label: "momentum.taker_momentum_threshold".to_string(),
            value: momentum.taker_momentum_threshold.to_string(),
            field_type: FieldType::U8,
            is_override: false,
            config_path: "momentum.taker_momentum_threshold".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "momentum.maker_momentum_threshold".to_string(),
            value: momentum.maker_momentum_threshold.to_string(),
            field_type: FieldType::U8,
            is_override: false,
            config_path: "momentum.maker_momentum_threshold".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "momentum.cancel_threshold".to_string(),
            value: momentum.cancel_threshold.to_string(),
            field_type: FieldType::U8,
            is_override: false,
            config_path: "momentum.cancel_threshold".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "momentum.velocity_weight".to_string(),
            value: format!("{}", momentum.velocity_weight),
            field_type: FieldType::F64,
            is_override: false,
            config_path: "momentum.velocity_weight".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "momentum.book_pressure_weight".to_string(),
            value: format!("{}", momentum.book_pressure_weight),
            field_type: FieldType::F64,
            is_override: false,
            config_path: "momentum.book_pressure_weight".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "momentum.velocity_window_size".to_string(),
            value: momentum.velocity_window_size.to_string(),
            field_type: FieldType::U32,
            is_override: false,
            config_path: "momentum.velocity_window_size".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "momentum.cancel_check_interval_ms".to_string(),
            value: momentum.cancel_check_interval_ms.to_string(),
            field_type: FieldType::U64,
            is_override: false,
            config_path: "momentum.cancel_check_interval_ms".to_string(),
            read_only: false,
        },
        // Simulation
        ConfigField {
            label: "simulation.latency_ms".to_string(),
            value: sim.latency_ms.to_string(),
            field_type: FieldType::U64,
            is_override: false,
            config_path: "simulation.latency_ms".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "simulation.use_break_even_exit".to_string(),
            value: sim.use_break_even_exit.to_string(),
            field_type: FieldType::Bool,
            is_override: false,
            config_path: "simulation.use_break_even_exit".to_string(),
            read_only: false,
        },
        ConfigField {
            label: "simulation.validate_fair_value".to_string(),
            value: sim.validate_fair_value.to_string(),
            field_type: FieldType::Bool,
            is_override: false,
            config_path: "simulation.validate_fair_value".to_string(),
            read_only: false,
        },
    ]
}

fn build_sport_fields(
    pipe: &SportPipeline,
    global_strategy: &StrategyConfig,
    global_momentum: &MomentumConfig,
    available_odds_sources: &[String],
) -> Vec<ConfigField> {
    let key = &pipe.key;
    let mut fields = Vec::new();

    // Header: fair_value as editable Enum with all available sources
    let fv_str = match &pipe.fair_value_source {
        FairValueSource::ScoreFeed { .. } => "score-feed",
        FairValueSource::OddsFeed => &pipe.odds_source,
    };

    // Build list of valid sources: score-feed (if available) + all odds sources
    let mut valid_sources = Vec::new();
    if pipe.score_feed_config.is_some() && pipe.win_prob_config.is_some() {
        valid_sources.push("score-feed".to_string());
    }
    for source in available_odds_sources {
        valid_sources.push(source.clone());
    }

    fields.push(ConfigField {
        label: "fair_value".to_string(),
        value: fv_str.to_string(),
        field_type: FieldType::Enum(valid_sources),
        is_override: false,
        config_path: format!("sports.{}.fair_value", key),
        read_only: false,
    });
    fields.push(ConfigField {
        label: "odds_source".to_string(),
        value: pipe.odds_source.clone(),
        field_type: FieldType::String,
        is_override: false,
        config_path: format!("sports.{}.odds_source", key),
        read_only: true,
    });
    fields.push(ConfigField {
        label: "kalshi_series".to_string(),
        value: pipe.series.clone(),
        field_type: FieldType::String,
        is_override: false,
        config_path: format!("sports.{}.kalshi_series", key),
        read_only: true,
    });
    fields.push(ConfigField {
        label: "enabled".to_string(),
        value: pipe.enabled.to_string(),
        field_type: FieldType::Bool,
        is_override: false,
        config_path: format!("sports.{}.enabled", key),
        read_only: false,
    });

    // Strategy fields
    let s = &pipe.strategy_config;
    fields.push(ConfigField {
        label: "strategy.taker_edge_threshold".to_string(),
        value: s.taker_edge_threshold.to_string(),
        field_type: FieldType::U8,
        is_override: s.taker_edge_threshold != global_strategy.taker_edge_threshold,
        config_path: format!("sports.{}.strategy.taker_edge_threshold", key),
        read_only: false,
    });
    fields.push(ConfigField {
        label: "strategy.maker_edge_threshold".to_string(),
        value: s.maker_edge_threshold.to_string(),
        field_type: FieldType::U8,
        is_override: s.maker_edge_threshold != global_strategy.maker_edge_threshold,
        config_path: format!("sports.{}.strategy.maker_edge_threshold", key),
        read_only: false,
    });
    fields.push(ConfigField {
        label: "strategy.min_edge_after_fees".to_string(),
        value: s.min_edge_after_fees.to_string(),
        field_type: FieldType::U8,
        is_override: s.min_edge_after_fees != global_strategy.min_edge_after_fees,
        config_path: format!("sports.{}.strategy.min_edge_after_fees", key),
        read_only: false,
    });

    // Momentum fields
    let m = &pipe.momentum_config;
    fields.push(ConfigField {
        label: "momentum.taker_momentum_threshold".to_string(),
        value: m.taker_momentum_threshold.to_string(),
        field_type: FieldType::U8,
        is_override: m.taker_momentum_threshold != global_momentum.taker_momentum_threshold,
        config_path: format!("sports.{}.momentum.taker_momentum_threshold", key),
        read_only: false,
    });
    fields.push(ConfigField {
        label: "momentum.maker_momentum_threshold".to_string(),
        value: m.maker_momentum_threshold.to_string(),
        field_type: FieldType::U8,
        is_override: m.maker_momentum_threshold != global_momentum.maker_momentum_threshold,
        config_path: format!("sports.{}.momentum.maker_momentum_threshold", key),
        read_only: false,
    });
    fields.push(ConfigField {
        label: "momentum.cancel_threshold".to_string(),
        value: m.cancel_threshold.to_string(),
        field_type: FieldType::U8,
        is_override: m.cancel_threshold != global_momentum.cancel_threshold,
        config_path: format!("sports.{}.momentum.cancel_threshold", key),
        read_only: false,
    });

    // Score feed fields (if applicable)
    if let FairValueSource::ScoreFeed {
        poller,
        live_poll_s,
        pre_game_poll_s,
        ..
    } = &pipe.fair_value_source
    {
        fields.push(ConfigField {
            label: "score_feed.primary_url".to_string(),
            value: poller.primary_url().to_string(),
            field_type: FieldType::String,
            is_override: false,
            config_path: format!("sports.{}.score_feed.primary_url", key),
            read_only: true,
        });
        fields.push(ConfigField {
            label: "score_feed.live_poll_s".to_string(),
            value: live_poll_s.to_string(),
            field_type: FieldType::U64,
            is_override: false,
            config_path: format!("sports.{}.score_feed.live_poll_s", key),
            read_only: false,
        });
        fields.push(ConfigField {
            label: "score_feed.pre_game_poll_s".to_string(),
            value: pre_game_poll_s.to_string(),
            field_type: FieldType::U64,
            is_override: false,
            config_path: format!("sports.{}.score_feed.pre_game_poll_s", key),
            read_only: false,
        });
    }

    fields
}
