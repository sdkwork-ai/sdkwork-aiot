//! Device-scoped configuration overrides for AIoT terminal devices.
//!
//! Each device inherits the settings schema and defaults declared by the
//! capability model of its product, and may store per-device overrides. The
//! overrides live in the admin entity store (`iot_admin_entity`, kind
//! `device_settings`) keyed by device id, carry a monotonic revision for
//! optimistic concurrency, and are validated against the inherited schema
//! before they are persisted.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use sdkwork_aiot_storage::AiotStorageAssociation;
use sdkwork_aiot_storage_sqlx::PersistedEntityRepository;
use sdkwork_iot_device_service::{
    resolve_device_settings, DeviceSettingDefinition, DeviceSettingKind, DeviceSettingOption,
    DeviceSettingViolation, DeviceSettingsResolution,
};
use serde_json::{Map, Value};

/// Admin entity kind used to persist device settings overrides.
pub(crate) const ENTITY_DEVICE_SETTINGS: &str = "device_settings";

/// Admin entity kind used to persist the append-only settings revision history.
pub(crate) const ENTITY_DEVICE_SETTINGS_HISTORY: &str = "device_settings_history";

/// Why a settings revision was created.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AiotDeviceSettingsChangeAction {
    /// An operator replaced the override set.
    Update,
    /// An operator cleared every override so inherited defaults apply.
    Reset,
    /// An operator restored a previous revision.
    Rollback,
}

impl AiotDeviceSettingsChangeAction {
    #[must_use]
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Update => "update",
            Self::Reset => "reset",
            Self::Rollback => "rollback",
        }
    }

    #[must_use]
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "update" => Some(Self::Update),
            "reset" => Some(Self::Reset),
            "rollback" => Some(Self::Rollback),
            _ => None,
        }
    }
}

/// One append-only settings revision of a device.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AiotDeviceSettingsHistoryEntry {
    pub device_id: String,
    pub revision: i64,
    pub overrides: BTreeMap<String, Value>,
    pub changed_keys: Vec<String>,
    pub action: AiotDeviceSettingsChangeAction,
    pub updated_at: String,
    pub updated_by: Option<String>,
}

/// Persisted override set of one device.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AiotDeviceSettingsRecord {
    pub device_id: String,
    pub revision: i64,
    pub overrides: BTreeMap<String, Value>,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
}

impl AiotDeviceSettingsRecord {
    fn empty(device_id: &str) -> Self {
        Self {
            device_id: device_id.to_string(),
            revision: 0,
            overrides: BTreeMap::new(),
            updated_at: None,
            updated_by: None,
        }
    }
}

/// Repository-level failure of a device settings mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AiotDeviceSettingsRepositoryError {
    /// The caller's `expectedRevision` does not match the stored revision.
    RevisionConflict { expected: i64, actual: i64 },
    /// The backing store could not read or write the record.
    StorageFailure,
}

/// In-memory or persisted storage of device settings overrides.
///
/// Writes are serialized inside one process by the repository write guard so the
/// revision check and the write form one critical section. Cross-process
/// deployments rely on the admin entity store being single-writer per tenant or
/// on a future row-version compare-and-set; the revision guard is therefore
/// authoritative for concurrent operators served by the same process.
#[derive(Clone, Default)]
pub struct AiotDeviceSettingsRepositoryHandle {
    memory: Arc<Mutex<BTreeMap<String, AiotDeviceSettingsRecord>>>,
    history: Arc<Mutex<BTreeMap<String, AiotDeviceSettingsHistoryEntry>>>,
    store: Option<Arc<PersistedEntityRepository>>,
    write_guard: Arc<Mutex<()>>,
}

impl AiotDeviceSettingsRepositoryHandle {
    #[must_use]
    pub fn new_in_memory() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn from_entity_store(store: Arc<PersistedEntityRepository>) -> Self {
        Self {
            memory: Arc::new(Mutex::new(BTreeMap::new())),
            history: Arc::new(Mutex::new(BTreeMap::new())),
            store: Some(store),
            write_guard: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) fn get(
        &self,
        association: &AiotStorageAssociation,
        device_id: &str,
    ) -> AiotDeviceSettingsRecord {
        if let Some(store) = &self.store {
            return store
                .get_entity(association, ENTITY_DEVICE_SETTINGS, device_id)
                .and_then(|entity| parse_record(&entity.payload_json))
                .unwrap_or_else(|| AiotDeviceSettingsRecord::empty(device_id));
        }
        self.memory
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&scoped_key(association, device_id))
            .cloned()
            .unwrap_or_else(|| AiotDeviceSettingsRecord::empty(device_id))
    }

    /// Replaces the overrides of one device.
    ///
    /// # Errors
    ///
    /// Returns [`AiotDeviceSettingsRepositoryError::RevisionConflict`] when the
    /// caller expected a different revision, and
    /// [`AiotDeviceSettingsRepositoryError::StorageFailure`] when persistence
    /// fails.
    pub(crate) fn replace_overrides(
        &self,
        association: &AiotStorageAssociation,
        device_id: &str,
        expected_revision: Option<i64>,
        overrides: BTreeMap<String, Value>,
        updated_at: &str,
        updated_by: Option<&str>,
    ) -> Result<AiotDeviceSettingsRecord, AiotDeviceSettingsRepositoryError> {
        let _write_guard = self
            .write_guard
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let current = self.get(association, device_id);
        if let Some(expected) = expected_revision {
            if expected != current.revision {
                return Err(AiotDeviceSettingsRepositoryError::RevisionConflict {
                    expected,
                    actual: current.revision,
                });
            }
        }
        let record = AiotDeviceSettingsRecord {
            device_id: device_id.to_string(),
            revision: current.revision.saturating_add(1),
            overrides,
            updated_at: Some(updated_at.to_string()),
            updated_by: updated_by.map(str::to_string),
        };

        if let Some(store) = &self.store {
            store
                .upsert_entity(
                    association,
                    ENTITY_DEVICE_SETTINGS,
                    device_id,
                    &record_json(&record),
                )
                .map_err(|_| AiotDeviceSettingsRepositoryError::StorageFailure)?;
            return Ok(record);
        }

        self.memory
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(scoped_key(association, device_id), record.clone());
        Ok(record)
    }

    /// Appends one settings revision to the device history.
    ///
    /// # Errors
    ///
    /// Returns [`AiotDeviceSettingsRepositoryError::StorageFailure`] when the
    /// backing store cannot persist the entry.
    pub(crate) fn append_history(
        &self,
        association: &AiotStorageAssociation,
        entry: &AiotDeviceSettingsHistoryEntry,
    ) -> Result<(), AiotDeviceSettingsRepositoryError> {
        if let Some(store) = &self.store {
            return store
                .upsert_entity(
                    association,
                    ENTITY_DEVICE_SETTINGS_HISTORY,
                    &history_entity_key(&entry.device_id, entry.revision),
                    &history_entry_json(entry),
                )
                .map_err(|_| AiotDeviceSettingsRepositoryError::StorageFailure);
        }
        self.history
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                history_memory_key(association, &entry.device_id, entry.revision),
                entry.clone(),
            );
        Ok(())
    }

    /// Lists the settings revisions of one device, newest first.
    pub(crate) fn list_history(
        &self,
        association: &AiotStorageAssociation,
        device_id: &str,
    ) -> Vec<AiotDeviceSettingsHistoryEntry> {
        let mut entries = if let Some(store) = &self.store {
            store
                .list_entities(association, ENTITY_DEVICE_SETTINGS_HISTORY)
                .into_iter()
                .filter_map(|entity| parse_history_entry(&entity.payload_json))
                .filter(|entry| entry.device_id == device_id)
                .collect::<Vec<_>>()
        } else {
            let prefix = format!(
                "{}:{}:{}:",
                association.tenant_id, association.organization_id, device_id
            );
            self.history
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .iter()
                .filter(|(key, _)| key.starts_with(&prefix))
                .map(|(_, entry)| entry.clone())
                .collect::<Vec<_>>()
        };
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.revision));
        entries
    }

    /// Returns one recorded revision of a device.
    pub(crate) fn find_history_revision(
        &self,
        association: &AiotStorageAssociation,
        device_id: &str,
        revision: i64,
    ) -> Option<AiotDeviceSettingsHistoryEntry> {
        if let Some(store) = &self.store {
            return store
                .get_entity(
                    association,
                    ENTITY_DEVICE_SETTINGS_HISTORY,
                    &history_entity_key(device_id, revision),
                )
                .and_then(|entity| parse_history_entry(&entity.payload_json))
                .filter(|entry| entry.device_id == device_id && entry.revision == revision);
        }
        self.history
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&history_memory_key(association, device_id, revision))
            .cloned()
    }

    /// Removes the overrides of a deleted device so a later device created with
    /// the same id starts from the inherited defaults.
    ///
    /// # Errors
    ///
    /// Returns [`AiotDeviceSettingsRepositoryError::StorageFailure`] when the
    /// backing store cannot delete the record.
    pub(crate) fn delete(
        &self,
        association: &AiotStorageAssociation,
        device_id: &str,
    ) -> Result<(), AiotDeviceSettingsRepositoryError> {
        let _write_guard = self
            .write_guard
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(store) = &self.store {
            store
                .delete_entity(association, ENTITY_DEVICE_SETTINGS, device_id)
                .map_err(|_| AiotDeviceSettingsRepositoryError::StorageFailure)?;
            for entry in self.list_history(association, device_id) {
                let _ = store.delete_entity(
                    association,
                    ENTITY_DEVICE_SETTINGS_HISTORY,
                    &history_entity_key(device_id, entry.revision),
                );
            }
            return Ok(());
        }
        {
            let mut history = self
                .history
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let prefix = format!(
                "{}:{}:{}:",
                association.tenant_id, association.organization_id, device_id
            );
            history.retain(|key, _| !key.starts_with(&prefix));
        }
        self.memory
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&scoped_key(association, device_id));
        Ok(())
    }
}

fn scoped_key(association: &AiotStorageAssociation, device_id: &str) -> String {
    format!(
        "{}:{}:{}",
        association.tenant_id, association.organization_id, device_id
    )
}

fn record_json(record: &AiotDeviceSettingsRecord) -> String {
    let mut payload = Map::new();
    payload.insert(
        "deviceId".to_string(),
        Value::String(record.device_id.clone()),
    );
    payload.insert("revision".to_string(), Value::from(record.revision));
    payload.insert(
        "overrides".to_string(),
        Value::Object(record.overrides.clone().into_iter().collect()),
    );
    if let Some(updated_at) = &record.updated_at {
        payload.insert("updatedAt".to_string(), Value::String(updated_at.clone()));
    }
    if let Some(updated_by) = &record.updated_by {
        payload.insert("updatedBy".to_string(), Value::String(updated_by.clone()));
    }
    Value::Object(payload).to_string()
}

fn parse_record(payload_json: &str) -> Option<AiotDeviceSettingsRecord> {
    let value: Value = serde_json::from_str(payload_json).ok()?;
    let object = value.as_object()?;
    let device_id = object.get("deviceId")?.as_str()?.to_string();
    let revision = object
        .get("revision")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let overrides = object
        .get("overrides")
        .and_then(Value::as_object)
        .map(|overrides| {
            overrides
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    Some(AiotDeviceSettingsRecord {
        device_id,
        revision,
        overrides,
        updated_at: object
            .get("updatedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
        updated_by: object
            .get("updatedBy")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn history_memory_key(
    association: &AiotStorageAssociation,
    device_id: &str,
    revision: i64,
) -> String {
    format!(
        "{}:{}:{}:{revision:020}",
        association.tenant_id, association.organization_id, device_id
    )
}

fn history_entity_key(device_id: &str, revision: i64) -> String {
    format!("{device_id}:{revision:020}")
}

fn history_entry_json(entry: &AiotDeviceSettingsHistoryEntry) -> String {
    let mut payload = Map::new();
    payload.insert(
        "deviceId".to_string(),
        Value::String(entry.device_id.clone()),
    );
    payload.insert(
        "revision".to_string(),
        Value::String(entry.revision.to_string()),
    );
    payload.insert(
        "overrides".to_string(),
        Value::Object(entry.overrides.clone().into_iter().collect()),
    );
    payload.insert(
        "changedKeys".to_string(),
        Value::Array(
            entry
                .changed_keys
                .iter()
                .map(|key| Value::String(key.clone()))
                .collect(),
        ),
    );
    payload.insert(
        "action".to_string(),
        Value::String(entry.action.as_str().to_string()),
    );
    payload.insert(
        "updatedAt".to_string(),
        Value::String(entry.updated_at.clone()),
    );
    if let Some(updated_by) = &entry.updated_by {
        payload.insert("updatedBy".to_string(), Value::String(updated_by.clone()));
    }
    Value::Object(payload).to_string()
}

fn parse_history_entry(payload_json: &str) -> Option<AiotDeviceSettingsHistoryEntry> {
    let value: Value = serde_json::from_str(payload_json).ok()?;
    let object = value.as_object()?;
    let device_id = object.get("deviceId")?.as_str()?.to_string();
    let revision = object.get("revision").and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_str()?.parse::<i64>().ok())
    })?;
    let overrides = object
        .get("overrides")
        .and_then(Value::as_object)
        .map(|overrides| {
            overrides
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let changed_keys = object
        .get("changedKeys")
        .and_then(Value::as_array)
        .map(|keys| {
            keys.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let action = object
        .get("action")
        .and_then(Value::as_str)
        .and_then(AiotDeviceSettingsChangeAction::parse)
        .unwrap_or(AiotDeviceSettingsChangeAction::Update);
    let updated_at = object.get("updatedAt")?.as_str()?.to_string();
    Some(AiotDeviceSettingsHistoryEntry {
        device_id,
        revision,
        overrides,
        changed_keys,
        action,
        updated_at,
        updated_by: object
            .get("updatedBy")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// Serializes one history entry for `data.items[]`.
pub(crate) fn history_entry_resource_json(entry: &AiotDeviceSettingsHistoryEntry) -> String {
    let parsed: Value = serde_json::from_str(&history_entry_json(entry))
        .unwrap_or_else(|_| Value::Object(Map::new()));
    parsed.to_string()
}

/// Computes the settings keys whose override values differ between revisions.
pub(crate) fn changed_override_keys(
    previous: &BTreeMap<String, Value>,
    next: &BTreeMap<String, Value>,
) -> Vec<String> {
    let mut keys = BTreeMap::<&str, ()>::new();
    for key in previous.keys().chain(next.keys()) {
        keys.insert(key.as_str(), ());
    }
    keys.into_keys()
        .filter(|key| previous.get(*key) != next.get(*key))
        .map(str::to_string)
        .collect()
}

/// Parses the `settings` array of a capability model request body.
///
/// # Errors
///
/// Returns a field-scoped message when the payload shape is invalid.
pub(crate) fn settings_definitions_from_json(
    value: Option<&Value>,
) -> Result<Vec<DeviceSettingDefinition>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let Some(items) = value.as_array() else {
        return Err("Field settings must be an array".to_string());
    };
    items.iter().map(definition_from_json).collect()
}

fn definition_from_json(value: &Value) -> Result<DeviceSettingDefinition, String> {
    let Some(object) = value.as_object() else {
        return Err("Setting definitions must be JSON objects".to_string());
    };
    let key = required_string(object, "settingKey")?;
    let kind_name = required_string(object, "kind")?;
    let kind = DeviceSettingKind::parse(&kind_name)
        .ok_or_else(|| format!("Setting '{key}' declares an unknown kind '{kind_name}'"))?;
    let mut definition = DeviceSettingDefinition::new(key.clone(), kind).with_display_name(
        object
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or(key.as_str()),
    );
    if let Some(description) = object.get("description").and_then(Value::as_str) {
        definition = definition.with_description(description);
    }
    if let Some(group) = object.get("group").and_then(Value::as_str) {
        definition = definition.with_group(group);
    }
    if let Some(unit) = object.get("unit").and_then(Value::as_str) {
        definition = definition.with_unit(unit);
    }
    if let Some(default_value) = object.get("defaultValue") {
        definition = definition.with_default(default_value.clone());
    }
    if object.get("required").and_then(Value::as_bool) == Some(true) {
        definition = definition.required();
    }
    if object.get("writable").and_then(Value::as_bool) == Some(false) {
        definition = definition.read_only();
    }
    if object.get("sensitive").and_then(Value::as_bool) == Some(true) {
        definition = definition.sensitive();
    }
    if let Some(max_length) = object.get("maxLength").and_then(Value::as_u64) {
        let max_length = u32::try_from(max_length)
            .map_err(|_| format!("Setting '{key}' declares an invalid maxLength"))?;
        definition = definition.with_max_length(max_length);
    }
    let minimum = object.get("minimum").and_then(Value::as_f64);
    let maximum = object.get("maximum").and_then(Value::as_f64);
    if let (Some(minimum), Some(maximum)) = (minimum, maximum) {
        definition = definition.with_range(minimum, maximum);
    }
    if let Some(options) = object.get("options") {
        let Some(options) = options.as_array() else {
            return Err(format!("Setting '{key}' declares non-array options"));
        };
        for option in options {
            let Some(option_object) = option.as_object() else {
                return Err(format!("Setting '{key}' declares a non-object option"));
            };
            let option_value = required_string(option_object, "value")?;
            let mut parsed = DeviceSettingOption::new(option_value);
            if let Some(label) = option_object.get("label").and_then(Value::as_str) {
                parsed = parsed.with_label(label);
            }
            definition = definition.with_option(parsed);
        }
    }
    Ok(definition)
}

fn required_string(object: &Map<String, Value>, field: &str) -> Result<String, String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Field {field} is required"))
}

/// Serializes settings definitions into the admin API wire shape.
pub(crate) fn settings_definitions_json(definitions: &[DeviceSettingDefinition]) -> Value {
    Value::Array(definitions.iter().map(definition_json).collect())
}

fn definition_json(definition: &DeviceSettingDefinition) -> Value {
    let mut object = Map::new();
    object.insert(
        "settingKey".to_string(),
        Value::String(definition.key.clone()),
    );
    object.insert(
        "displayName".to_string(),
        Value::String(definition.display_name.clone()),
    );
    object.insert(
        "kind".to_string(),
        Value::String(definition.kind.as_str().to_string()),
    );
    object.insert("required".to_string(), Value::Bool(definition.required));
    object.insert("writable".to_string(), Value::Bool(definition.writable));
    object.insert("sensitive".to_string(), Value::Bool(definition.sensitive));
    if let Some(description) = &definition.description {
        object.insert(
            "description".to_string(),
            Value::String(description.clone()),
        );
    }
    if let Some(group) = &definition.group {
        object.insert("group".to_string(), Value::String(group.clone()));
    }
    if let Some(unit) = &definition.unit {
        object.insert("unit".to_string(), Value::String(unit.clone()));
    }
    if let Some(default_value) = &definition.default_value {
        object.insert("defaultValue".to_string(), default_value.clone());
    }
    if let Some(minimum) = definition.minimum {
        object.insert("minimum".to_string(), Value::from(minimum));
    }
    if let Some(maximum) = definition.maximum {
        object.insert("maximum".to_string(), Value::from(maximum));
    }
    if let Some(max_length) = definition.max_length {
        object.insert("maxLength".to_string(), Value::from(max_length));
    }
    if !definition.options.is_empty() {
        object.insert(
            "options".to_string(),
            Value::Array(
                definition
                    .options
                    .iter()
                    .map(|option| {
                        let mut option_object = Map::new();
                        option_object
                            .insert("value".to_string(), Value::String(option.value.clone()));
                        if let Some(label) = &option.label {
                            option_object.insert("label".to_string(), Value::String(label.clone()));
                        }
                        Value::Object(option_object)
                    })
                    .collect(),
            ),
        );
    }
    Value::Object(object)
}

/// Serializes one device settings resource for `data.item`.
pub(crate) fn device_settings_resource_json(
    device_id: &str,
    product_id: &str,
    capability_model_id: &str,
    definitions: &[DeviceSettingDefinition],
    record: &AiotDeviceSettingsRecord,
    resolution: &DeviceSettingsResolution,
) -> String {
    let mut object = Map::new();
    object.insert("deviceId".to_string(), Value::String(device_id.to_string()));
    object.insert(
        "productId".to_string(),
        Value::String(product_id.to_string()),
    );
    object.insert(
        "capabilityModelId".to_string(),
        Value::String(capability_model_id.to_string()),
    );
    object.insert(
        "revision".to_string(),
        Value::String(record.revision.to_string()),
    );
    object.insert(
        "definitions".to_string(),
        settings_definitions_json(definitions),
    );
    object.insert(
        "defaults".to_string(),
        Value::Object(resolution.defaults.clone().into_iter().collect()),
    );
    object.insert(
        "overrides".to_string(),
        Value::Object(resolution.overrides.clone().into_iter().collect()),
    );
    object.insert(
        "effective".to_string(),
        Value::Object(resolution.effective.clone().into_iter().collect()),
    );
    if let Some(updated_at) = &record.updated_at {
        object.insert("updatedAt".to_string(), Value::String(updated_at.clone()));
    }
    if let Some(updated_by) = &record.updated_by {
        object.insert("updatedBy".to_string(), Value::String(updated_by.clone()));
    }
    Value::Object(object).to_string()
}

/// Serializes setting violations into `ProblemDetail.errors[]`.
pub(crate) fn settings_violations_json(violations: &[DeviceSettingViolation]) -> Value {
    Value::Array(
        violations
            .iter()
            .map(|violation| {
                serde_json::json!({
                    "field": violation.field_path(),
                    "message": violation.message,
                    "code": 40011,
                })
            })
            .collect(),
    )
}

/// Resolves the effective settings of one device.
///
/// # Errors
///
/// Returns [`DeviceSettingViolation`] values when the stored overrides no longer
/// satisfy the capability model schema.
pub(crate) fn resolve_recorded_settings(
    definitions: &[DeviceSettingDefinition],
    record: &AiotDeviceSettingsRecord,
) -> Result<DeviceSettingsResolution, Vec<DeviceSettingViolation>> {
    resolve_device_settings(definitions, &record.overrides)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn definitions_json() -> Value {
        json!([
            {
                "settingKey": "audio.volume",
                "displayName": "Volume",
                "kind": "integer",
                "defaultValue": 60,
                "minimum": 0,
                "maximum": 100,
                "unit": "%"
            },
            {
                "settingKey": "assistant.wakeWord",
                "displayName": "Wake word",
                "kind": "enum",
                "defaultValue": "hello",
                "options": [{"value": "hello", "label": "Hello"}, {"value": "hi"}]
            }
        ])
    }

    #[test]
    fn definitions_round_trip_through_the_wire_shape() {
        let definitions =
            settings_definitions_from_json(Some(&definitions_json())).expect("definitions");
        assert_eq!(definitions.len(), 2);
        let serialized = settings_definitions_json(&definitions);
        let reparsed = settings_definitions_from_json(Some(&serialized)).expect("reparsed");
        assert_eq!(definitions, reparsed);
    }

    #[test]
    fn resource_json_carries_revision_defaults_overrides_and_effective_values() {
        let definitions =
            settings_definitions_from_json(Some(&definitions_json())).expect("definitions");
        let mut overrides = BTreeMap::new();
        overrides.insert("audio.volume".to_string(), json!(25));
        let record = AiotDeviceSettingsRecord {
            device_id: "dev-1".to_string(),
            revision: 3,
            overrides: overrides.clone(),
            updated_at: Some("2026-11-12T00:00:00Z".to_string()),
            updated_by: Some("1001".to_string()),
        };
        let resolution = resolve_recorded_settings(&definitions, &record).expect("resolution");
        let resource = device_settings_resource_json(
            "dev-1",
            "9001",
            "capmodel-xiaozhi-core",
            &definitions,
            &record,
            &resolution,
        );
        let value: Value = serde_json::from_str(&resource).expect("resource json");
        assert_eq!(value["deviceId"].as_str(), Some("dev-1"));
        assert_eq!(value["revision"].as_str(), Some("3"));
        assert_eq!(value["defaults"]["audio.volume"], json!(60));
        assert_eq!(value["overrides"]["audio.volume"], json!(25));
        assert_eq!(value["effective"]["audio.volume"], json!(25));
        assert_eq!(
            value["definitions"][1]["options"][1]["value"].as_str(),
            Some("hi")
        );
    }

    #[test]
    fn in_memory_repository_enforces_expected_revision() {
        let repository = AiotDeviceSettingsRepositoryHandle::new_in_memory();
        let association = AiotStorageAssociation::tenant_org(1, 0);
        let mut overrides = BTreeMap::new();
        overrides.insert("audio.volume".to_string(), json!(20));
        let first = repository
            .replace_overrides(&association, "dev-1", None, overrides, "t1", Some("9"))
            .expect("first write");
        assert_eq!(first.revision, 1);

        let stale = repository.replace_overrides(
            &association,
            "dev-1",
            Some(0),
            BTreeMap::new(),
            "t2",
            None,
        );
        assert_eq!(
            stale,
            Err(AiotDeviceSettingsRepositoryError::RevisionConflict {
                expected: 0,
                actual: 1
            })
        );

        let second = repository
            .replace_overrides(
                &association,
                "dev-1",
                Some(1),
                BTreeMap::new(),
                "t3",
                Some("9"),
            )
            .expect("second write");
        assert_eq!(second.revision, 2);
        assert!(second.overrides.is_empty());
    }

    #[test]
    fn persisted_repository_round_trips_records() {
        let store = Arc::new(PersistedEntityRepository::new_in_memory().expect("entity store"));
        let repository = AiotDeviceSettingsRepositoryHandle::from_entity_store(store);
        let association = AiotStorageAssociation::tenant_org(7, 0);
        let mut overrides = BTreeMap::new();
        overrides.insert("assistant.wakeWord".to_string(), json!("hi"));
        repository
            .replace_overrides(&association, "dev-9", None, overrides, "t1", Some("5"))
            .expect("write");

        let record = repository.get(&association, "dev-9");
        assert_eq!(record.revision, 1);
        assert_eq!(
            record.overrides.get("assistant.wakeWord"),
            Some(&json!("hi"))
        );
        assert_eq!(record.updated_by.as_deref(), Some("5"));
    }
}
