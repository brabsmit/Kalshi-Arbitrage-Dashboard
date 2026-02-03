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
            action: if is_buy {
                "buy".to_string()
            } else {
                "sell".to_string()
            },
            side: "yes".to_string(), // We only trade YES side
            count: quantity,
            order_type: order_type.to_string(),
            yes_price: Some(price),
            no_price: None,
            client_order_id: None,
        };

        // Submit to Kalshi API
        let response = self
            .rest
            .create_order(&order)
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

    /// Cancel an order by ID.
    /// In dry-run mode, logs the cancellation attempt and returns Ok.
    pub async fn cancel_order(&self, order_id: &str) -> Result<()> {
        if self.dry_run {
            tracing::info!(
                order_id = %order_id,
                "DRY RUN: would cancel order"
            );
            return Ok(());
        }

        self.rest
            .cancel_order(order_id)
            .await
            .context(format!("failed to cancel order {}", order_id))?;

        tracing::info!(order_id = %order_id, "order cancelled");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_executor_has_cancel_method() {
        // Compile-time verification that cancel_order exists with correct signature
        fn _assert_cancel_exists(executor: &OrderExecutor) {
            let _ = executor.cancel_order("test-id");
        }
    }
}
