use anyhow::{Context, Result};
use base64::Engine as _;
use ring::rand::SystemRandom;
use ring::signature::{RsaKeyPair, RSA_PSS_SHA256};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct KalshiAuth {
    api_key: String,
    key_pair: RsaKeyPair,
    rng: SystemRandom,
}

impl KalshiAuth {
    pub fn new(api_key: String, private_key_pem: &str) -> Result<Self> {
        let der = pem_to_der(private_key_pem)?;
        let key_pair = RsaKeyPair::from_pkcs8(&der)
            .map_err(|e| anyhow::anyhow!("Failed to parse RSA key: {}", e))?;
        Ok(Self {
            api_key,
            key_pair,
            rng: SystemRandom::new(),
        })
    }

    pub fn timestamp_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    /// Sign a request and return (timestamp, signature) for headers.
    pub fn sign(&self, method: &str, path: &str) -> Result<(String, String)> {
        let timestamp = Self::timestamp_ms().to_string();
        // Strip query params before signing
        let path_clean = path.split('?').next().unwrap_or(path);
        let message = format!("{}{}{}", timestamp, method, path_clean);

        let mut signature = vec![0u8; self.key_pair.public().modulus_len()];
        self.key_pair
            .sign(&RSA_PSS_SHA256, &self.rng, message.as_bytes(), &mut signature)
            .map_err(|e| anyhow::anyhow!("RSA signing failed: {}", e))?;

        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(&signature);
        Ok((timestamp, sig_b64))
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    /// Build auth headers for a request.
    pub fn headers(&self, method: &str, path: &str) -> Result<Vec<(String, String)>> {
        let (timestamp, signature) = self.sign(method, path)?;
        Ok(vec![
            ("KALSHI-ACCESS-KEY".to_string(), self.api_key.clone()),
            ("KALSHI-ACCESS-TIMESTAMP".to_string(), timestamp),
            ("KALSHI-ACCESS-SIGNATURE".to_string(), signature),
        ])
    }
}

/// Convert PEM-encoded private key to DER bytes.
fn pem_to_der(pem: &str) -> Result<Vec<u8>> {
    let pem = pem.trim();
    let b64: String = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .context("Failed to decode PEM base64")
}
