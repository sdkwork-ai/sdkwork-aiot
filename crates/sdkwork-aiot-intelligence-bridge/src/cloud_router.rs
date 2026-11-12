use cloudrouter_open_sdk::{SdkworkAiClient, SdkworkError};
use sdkwork_utils_rust::service_base_url::registry_base_url_or;
use std::sync::Arc;

use crate::config::{IntelligenceConfig, CLOUDROUTER_API_KEY_ENV};

#[derive(Clone)]
pub struct CloudRouterClient {
    client: Arc<SdkworkAiClient>,
    base_url: String,
}

impl CloudRouterClient {
    pub fn from_config(config: &IntelligenceConfig) -> Result<Self, String> {
        // DISCOVERY_SPEC §12.1: registry-first, configured topology as fallback.
        let base_url = registry_base_url_or("cloudrouter", &config.cloud_router_http_url);
        let client = SdkworkAiClient::new_with_base_url(base_url.clone()).map_err(map_sdk_error)?;
        if let Some(api_key) = &config.cloud_router_api_key {
            client.set_api_key(api_key.clone());
        } else if let Ok(api_key) = std::env::var(CLOUDROUTER_API_KEY_ENV) {
            if !sdkwork_utils_rust::is_blank(Some(api_key.as_str())) {
                client.set_api_key(api_key);
            }
        }
        Ok(Self {
            client: Arc::new(client),
            base_url,
        })
    }

    pub fn sdk_client(&self) -> Arc<SdkworkAiClient> {
        Arc::clone(&self.client)
    }

    /// The base URL this client was built for (registry or configured).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

pub fn map_sdk_error(error: SdkworkError) -> String {
    error.to_string()
}

/// Provider TTS bytes from cloud-router (standard audio, not Xiaozhi Opus).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderTtsAudio {
    pub format: String,
    pub sample_rate: u32,
    pub bytes: Vec<u8>,
}
