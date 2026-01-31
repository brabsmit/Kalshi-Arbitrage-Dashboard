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
        // Validate API key looks reasonable
        let api_key = api_key.trim().to_string();
        if api_key.is_empty() {
            anyhow::bail!("API key is empty");
        }
        if api_key.len() < 10 {
            anyhow::bail!("API key too short ({} chars) — check for truncation", api_key.len());
        }
        if api_key.bytes().any(|b| !(0x20..=0x7e).contains(&b)) {
            anyhow::bail!(
                "API key contains non-printable characters — check for BOM, \\r, or copy-paste artifacts \
                 (first 20 bytes: {:?})",
                &api_key.as_bytes()[..api_key.len().min(20)]
            );
        }

        // Validate PEM has expected structure
        let pem_trimmed = private_key_pem.trim();
        if !pem_trimmed.contains("BEGIN") || !pem_trimmed.contains("END") {
            anyhow::bail!(
                "Private key does not look like PEM (missing BEGIN/END markers). \
                 File starts with: {:?}",
                &pem_trimmed[..pem_trimmed.len().min(60)]
            );
        }

        let der = pem_to_der(private_key_pem)?;

        if der.len() < 100 {
            anyhow::bail!(
                "Decoded private key is suspiciously small ({} bytes) — \
                 file may be truncated or corrupted",
                der.len()
            );
        }

        // Try PKCS#8 first, then fall back to PKCS#1 with wrapping
        let key_pair = match RsaKeyPair::from_pkcs8(&der) {
            Ok(kp) => kp,
            Err(pkcs8_err) => {
                // Key is likely PKCS#1 (BEGIN RSA PRIVATE KEY).
                // Wrap the raw PKCS#1 DER in a PKCS#8 envelope.
                let pkcs8 = wrap_pkcs1_in_pkcs8(&der);
                RsaKeyPair::from_pkcs8(&pkcs8)
                    .map_err(|pkcs1_err| anyhow::anyhow!(
                        "Failed to parse RSA key:\n  PKCS#8: {}\n  PKCS#1: {}\n  \
                         DER size: {} bytes. Check that the key file is not corrupted.",
                        pkcs8_err, pkcs1_err, der.len()
                    ))?
            }
        };

        let key_bits = key_pair.public().modulus_len() * 8;
        println!("  RSA key loaded: {} bits, API key: {}...",
            key_bits, &api_key[..api_key.len().min(8)]);

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

    #[allow(dead_code)]
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
/// Handles both PKCS#1 (BEGIN RSA PRIVATE KEY) and PKCS#8 (BEGIN PRIVATE KEY).
fn pem_to_der(pem: &str) -> Result<Vec<u8>> {
    let pem = pem.replace('\r', "");
    let pem = pem.trim();
    let b64: String = pem
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .context("Failed to decode PEM base64")
}

/// Wrap a PKCS#1 RSAPrivateKey DER blob in a PKCS#8 PrivateKeyInfo envelope.
///
/// PKCS#8 structure (DER):
///   SEQUENCE {
///     INTEGER 0                          -- version
///     SEQUENCE {                         -- algorithm
///       OID 1.2.840.113549.1.1.1        -- rsaEncryption
///       NULL
///     }
///     OCTET STRING <pkcs1_der>           -- privateKey
///   }
fn wrap_pkcs1_in_pkcs8(pkcs1_der: &[u8]) -> Vec<u8> {
    // RSA algorithm identifier: OID 1.2.840.113549.1.1.1 + NULL
    let algo_id: &[u8] = &[
        0x30, 0x0d, // SEQUENCE, 13 bytes
        0x06, 0x09, // OID, 9 bytes
        0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // 1.2.840.113549.1.1.1
        0x05, 0x00, // NULL
    ];

    let version: &[u8] = &[0x02, 0x01, 0x00]; // INTEGER 0

    // Build the OCTET STRING wrapping the PKCS#1 key
    let octet_string = der_wrap(0x04, pkcs1_der);

    // Inner content: version + algoId + octetString
    let mut inner = Vec::new();
    inner.extend_from_slice(version);
    inner.extend_from_slice(algo_id);
    inner.extend_from_slice(&octet_string);

    // Outer SEQUENCE
    der_wrap(0x30, &inner)
}

/// Wrap data in a DER TLV (tag-length-value), handling long-form lengths.
fn der_wrap(tag: u8, data: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let len = data.len();
    if len < 0x80 {
        out.push(len as u8);
    } else if len < 0x100 {
        out.push(0x81);
        out.push(len as u8);
    } else if len < 0x10000 {
        out.push(0x82);
        out.push((len >> 8) as u8);
        out.push(len as u8);
    } else {
        out.push(0x83);
        out.push((len >> 16) as u8);
        out.push((len >> 8) as u8);
        out.push(len as u8);
    }
    out.extend_from_slice(data);
    out
}
