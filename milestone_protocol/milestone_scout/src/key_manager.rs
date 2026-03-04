use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct KeyManager {
    keys: Vec<String>,
    current_index: Arc<AtomicUsize>,
    _provider_name: String, // Added underscore prefix
}

impl KeyManager {
    pub fn new(env_var_name: &str, provider_name: &str) -> Self {
        let keys_str = std::env::var(env_var_name)
            .unwrap_or_else(|_| panic!("{} must be set in .env", env_var_name));
        
        let keys: Vec<String> = keys_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        if keys.is_empty() {
            panic!("No keys found for {}", provider_name);
        }

        println!("✅ Loaded {} keys for {}", keys.len(), provider_name);

        Self {
            keys,
            current_index: Arc::new(AtomicUsize::new(0)),
            _provider_name: provider_name.to_string(),
        }
    }

    /// Returns the next key in Round-Robin fashion
    pub fn get_next_key(&self) -> String {
        let idx = self.current_index.fetch_add(1, Ordering::SeqCst);
        let key = &self.keys[idx % self.keys.len()];
        // Optional: Log rotation for debugging
        // println!("🔄 Rotating {} Key to index {}", self.provider_name, idx % self.keys.len());
        key.clone()
    }
}