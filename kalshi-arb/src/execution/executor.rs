use crate::kalshi::rest::KalshiRest;
use crate::kalshi::types::CreateOrderRequest;
use anyhow::{Context, Result};
use std::sync::Arc;

pub struct OrderExecutor {
    rest: Arc<KalshiRest>,
    dry_run: bool,
}

impl OrderExecutor {
    pub fn new(rest: Arc<KalshiRest>, dry_run: bool) -> Self {
        Self { rest, dry_run }
    }

    /// Submit order with validation
    pub async fn submit_order(
        &self,
        ticker: &str,
        quantity: u32,
        price: u32,
        is_buy: bool,
        is_taker: bool,
    ) -> Result<Option<String>> {
        // Validation
        if quantity == 0 {
            anyhow::bail!("quantity must be > 0");
        }
        if price == 0 || price > 99 {
            anyhow::bail!("price must be 1-99, got {}", price);
        }

        if self.dry_run {
            tracing::info!(
                ticker = %ticker,
                quantity = quantity,
                price = price,
                side = if is_buy { "BUY" } else { "SELL" },
                order_type = if is_taker { "TAKER" } else { "MAKER" },
                "DRY RUN: would submit order"
            );
            return Ok(None); // No order ID in dry run
        }

        // Build order request
        let order_type = if is_taker { "market" } else { "limit" };
        let order = CreateOrderRequest {
            ticker: ticker.to_string(),
            action: if is_buy { "buy" } else { "sell" },
            side: "yes".to_string(), // We only trade YES side
            count: quantity,
            r#type: order_type.to_string(),
            yes_price: Some(price),
            no_price: None,
            expiration_ts: None,
            sell_position_floor: None,
            buy_max_cost: None,
        };

        // Submit to Kalshi API
        let response = self.rest.create_order(&order)
            .await
            .context("order submission failed")?;

        tracing::info!(
            ticker = %ticker,
            order_id = %response.order.order_id,
            status = %response.order.status,
            "order submitted"
        );

        Ok(Some(response.order.order_id))
    }
}
