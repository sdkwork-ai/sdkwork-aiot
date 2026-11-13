use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::WebSocketSessionReply;
use sdkwork_aiot_storage::AiotStorageAssociation;

#[derive(Debug)]
struct ActiveWsSession {
    outbound: std::sync::mpsc::Sender<Vec<WebSocketSessionReply>>,
    last_touched: Instant,
    association: AiotStorageAssociation,
    session_id: String,
}

fn store() -> &'static Mutex<HashMap<String, ActiveWsSession>> {
    static STORE: OnceLock<Mutex<HashMap<String, ActiveWsSession>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn register_active_ws_session(
    device_id: &str,
    session_id: &str,
    outbound: std::sync::mpsc::Sender<Vec<WebSocketSessionReply>>,
    association: AiotStorageAssociation,
) {
    if let Ok(mut guard) = store().lock() {
        guard.insert(
            device_id.to_string(),
            ActiveWsSession {
                outbound,
                last_touched: Instant::now(),
                association,
                session_id: session_id.to_string(),
            },
        );
    }
}

pub fn unregister_active_ws_session(device_id: &str) {
    if let Ok(mut guard) = store().lock() {
        guard.remove(device_id);
    }
}

/// Unregisters only when the caller still owns the live session.
///
/// A device may reconnect before its previous socket finishes closing; the old
/// guard must not evict the new session.
pub fn unregister_active_ws_session_if(device_id: &str, session_id: &str) {
    if let Ok(mut guard) = store().lock() {
        let matches = guard
            .get(device_id)
            .is_some_and(|session| session.session_id == session_id);
        if matches {
            guard.remove(device_id);
        }
    }
}

pub fn push_ws_command_replies(device_id: &str, replies: Vec<WebSocketSessionReply>) -> bool {
    let Ok(guard) = store().lock() else {
        return false;
    };
    let Some(session) = guard.get(device_id) else {
        return false;
    };
    session.outbound.send(replies).is_ok()
}

pub fn touch_active_ws_session(device_id: &str) {
    if let Ok(mut guard) = store().lock() {
        if let Some(session) = guard.get_mut(device_id) {
            session.last_touched = Instant::now();
        }
    }
}

/// Protocol session id of the live WebSocket session for a device, if any.
pub fn active_ws_session_id(device_id: &str) -> Option<String> {
    store().lock().ok().and_then(|guard| {
        guard
            .get(device_id)
            .map(|session| session.session_id.clone())
    })
}

pub fn evict_stale_active_ws_sessions(ttl: Duration) -> usize {
    let Ok(mut guard) = store().lock() else {
        return 0;
    };
    let now = Instant::now();
    let before = guard.len();
    guard.retain(|_, session| now.duration_since(session.last_touched) <= ttl);
    before.saturating_sub(guard.len())
}

pub fn active_ws_sessions() -> Vec<(String, AiotStorageAssociation)> {
    store()
        .lock()
        .ok()
        .map(|guard| {
            guard
                .iter()
                .map(|(device_id, session)| (device_id.clone(), session.association.clone()))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
pub fn active_ws_device_ids() -> Vec<String> {
    active_ws_sessions()
        .into_iter()
        .map(|(device_id, _)| device_id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_and_push_roundtrip() {
        unregister_active_ws_session("dev-test");
        let (sender, receiver) = std::sync::mpsc::channel();
        register_active_ws_session(
            "dev-test",
            "session-test",
            sender,
            AiotStorageAssociation::default(),
        );
        assert!(push_ws_command_replies(
            "dev-test",
            vec![WebSocketSessionReply::Text(
                "{\"type\":\"tts\"}".to_string()
            )],
        ));
        let replies = receiver.recv().expect("outbound");
        assert_eq!(replies.len(), 1);
        assert!(active_ws_device_ids().contains(&"dev-test".to_string()));
        assert_eq!(
            active_ws_session_id("dev-test").as_deref(),
            Some("session-test")
        );
        unregister_active_ws_session("dev-test");
    }

    #[test]
    fn stale_guard_does_not_evict_reconnected_session() {
        unregister_active_ws_session("dev-reconnect");
        let (old_sender, _old_receiver) = std::sync::mpsc::channel();
        register_active_ws_session(
            "dev-reconnect",
            "session-old",
            old_sender,
            AiotStorageAssociation::default(),
        );
        let (new_sender, _new_receiver) = std::sync::mpsc::channel();
        register_active_ws_session(
            "dev-reconnect",
            "session-new",
            new_sender,
            AiotStorageAssociation::default(),
        );
        unregister_active_ws_session_if("dev-reconnect", "session-old");
        assert_eq!(
            active_ws_session_id("dev-reconnect").as_deref(),
            Some("session-new")
        );
        unregister_active_ws_session_if("dev-reconnect", "session-new");
        assert!(active_ws_session_id("dev-reconnect").is_none());
    }
}
