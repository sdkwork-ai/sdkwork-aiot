//! Type-safe, schema-driven per-device settings.
//!
//! A capability model declares the settings a device family supports
//! ([`DeviceSettingDefinition`]). Each physical device inherits the declared
//! defaults and may override individual values stored as device-scoped
//! overrides. [`resolve_device_settings`] merges both planes into the effective
//! configuration the device should apply, and rejects unknown, read-only, or
//! ill-typed values before they ever reach persistence.
//!
//! The module intentionally keeps the wire-format concern out of the domain:
//! `serde_json::Value` is the neutral JSON carrier used by the admin API and the
//! device twin, but no HTTP or database type appears here.

use std::collections::BTreeMap;

use serde_json::Value;

/// Value domain supported by a device setting definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceSettingKind {
    /// Boolean toggle.
    Boolean,
    /// Signed whole number.
    Integer,
    /// Floating point number.
    Number,
    /// Free-form string.
    String,
    /// String restricted to the declared [`DeviceSettingOption`] values.
    Enum,
    /// Arbitrary JSON document.
    Json,
}

impl DeviceSettingKind {
    /// Canonical wire name for the setting kind.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Boolean => "boolean",
            Self::Integer => "integer",
            Self::Number => "number",
            Self::String => "string",
            Self::Enum => "enum",
            Self::Json => "json",
        }
    }

    /// Parses a wire name into a setting kind.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "boolean" => Some(Self::Boolean),
            "integer" => Some(Self::Integer),
            "number" => Some(Self::Number),
            "string" => Some(Self::String),
            "enum" => Some(Self::Enum),
            "json" => Some(Self::Json),
            _ => None,
        }
    }
}

/// Allowed value of an [`DeviceSettingKind::Enum`] setting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceSettingOption {
    /// Machine value persisted in the device configuration.
    pub value: String,
    /// Optional operator-facing label for the value.
    pub label: Option<String>,
}

impl DeviceSettingOption {
    /// Creates a labelled-free enum option.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            label: None,
        }
    }

    /// Attaches an operator-facing label.
    #[must_use]
    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }
}

/// Declares one configurable setting of a device family.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceSettingDefinition {
    /// Stable dotted setting key, for example `audio.volume`.
    pub key: String,
    /// Operator-facing setting name.
    pub display_name: String,
    /// Optional helper text describing the setting semantics.
    pub description: Option<String>,
    /// Value domain enforced for overrides.
    pub kind: DeviceSettingKind,
    /// Whether the effective configuration must carry a value.
    pub required: bool,
    /// Whether the device-scoped overrides may change the value.
    pub writable: bool,
    /// Whether the value must be masked in operator surfaces.
    pub sensitive: bool,
    /// Optional grouping bucket used by operator forms.
    pub group: Option<String>,
    /// Optional unit label such as `seconds` or `%`.
    pub unit: Option<String>,
    /// Inherited default applied when the device does not override the setting.
    pub default_value: Option<Value>,
    /// Inclusive lower bound for numeric settings.
    pub minimum: Option<f64>,
    /// Inclusive upper bound for numeric settings.
    pub maximum: Option<f64>,
    /// Maximum character count for string settings.
    pub max_length: Option<u32>,
    /// Allowed values for enum settings.
    pub options: Vec<DeviceSettingOption>,
}

impl DeviceSettingDefinition {
    /// Creates a required-to-name definition with safe defaults.
    #[must_use]
    pub fn new(key: impl Into<String>, kind: DeviceSettingKind) -> Self {
        let key = key.into();
        Self {
            display_name: key.clone(),
            key,
            description: None,
            kind,
            required: false,
            writable: true,
            sensitive: false,
            group: None,
            unit: None,
            default_value: None,
            minimum: None,
            maximum: None,
            max_length: None,
            options: Vec::new(),
        }
    }

    /// Overrides the operator-facing display name.
    #[must_use]
    pub fn with_display_name(mut self, display_name: impl Into<String>) -> Self {
        self.display_name = display_name.into();
        self
    }

    /// Attaches helper text.
    #[must_use]
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Declares the inherited default value.
    #[must_use]
    pub fn with_default(mut self, default_value: Value) -> Self {
        self.default_value = Some(default_value);
        self
    }

    /// Declares an inclusive numeric range.
    #[must_use]
    pub fn with_range(mut self, minimum: f64, maximum: f64) -> Self {
        self.minimum = Some(minimum);
        self.maximum = Some(maximum);
        self
    }

    /// Declares the maximum character count of a string value.
    #[must_use]
    pub fn with_max_length(mut self, max_length: u32) -> Self {
        self.max_length = Some(max_length);
        self
    }

    /// Adds one allowed enum value.
    #[must_use]
    pub fn with_option(mut self, option: DeviceSettingOption) -> Self {
        self.options.push(option);
        self
    }

    /// Assigns the operator form group.
    #[must_use]
    pub fn with_group(mut self, group: impl Into<String>) -> Self {
        self.group = Some(group.into());
        self
    }

    /// Assigns the unit label.
    #[must_use]
    pub fn with_unit(mut self, unit: impl Into<String>) -> Self {
        self.unit = Some(unit.into());
        self
    }

    /// Marks the setting as required in the effective configuration.
    #[must_use]
    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }

    /// Marks the setting as not overridable per device.
    #[must_use]
    pub fn read_only(mut self) -> Self {
        self.writable = false;
        self
    }

    /// Marks the value as sensitive for operator display.
    #[must_use]
    pub fn sensitive(mut self) -> Self {
        self.sensitive = true;
        self
    }

    /// Validates one candidate value against this definition.
    ///
    /// # Errors
    ///
    /// Returns a human-readable, field-scoped message when the value does not
    /// satisfy the declared value domain.
    pub fn validate_value(&self, value: &Value) -> Result<(), String> {
        if !self.writable {
            return Err("is read-only and cannot be overridden".to_string());
        }

        self.validate_value_domain(value)
    }

    fn validate_value_domain(&self, value: &Value) -> Result<(), String> {
        match self.kind {
            DeviceSettingKind::Boolean => {
                if value.as_bool().is_none() {
                    return Err("must be a boolean".to_string());
                }
            }
            DeviceSettingKind::Integer => {
                let Some(number) = value.as_f64() else {
                    return Err("must be an integer".to_string());
                };
                if !number.is_finite() || number.fract() != 0.0 {
                    return Err("must be an integer".to_string());
                }
                self.validate_numeric_range(number)?;
            }
            DeviceSettingKind::Number => {
                let Some(number) = value.as_f64() else {
                    return Err("must be a number".to_string());
                };
                if !number.is_finite() {
                    return Err("must be a finite number".to_string());
                }
                self.validate_numeric_range(number)?;
            }
            DeviceSettingKind::String => {
                let Some(text) = value.as_str() else {
                    return Err("must be a string".to_string());
                };
                if let Some(max_length) = self.max_length {
                    if text.chars().count() > max_length as usize {
                        return Err(format!("must be at most {max_length} characters"));
                    }
                }
            }
            DeviceSettingKind::Enum => {
                let Some(text) = value.as_str() else {
                    return Err("must be one of the declared option values".to_string());
                };
                if !self.options.iter().any(|option| option.value == text) {
                    let allowed = self
                        .options
                        .iter()
                        .map(|option| option.value.as_str())
                        .collect::<Vec<_>>()
                        .join(", ");
                    return Err(format!("must be one of: {allowed}"));
                }
            }
            DeviceSettingKind::Json => {}
        }

        Ok(())
    }

    fn validate_numeric_range(&self, number: f64) -> Result<(), String> {
        if let Some(minimum) = self.minimum {
            if number < minimum {
                return Err(format!("must be greater than or equal to {minimum}"));
            }
        }
        if let Some(maximum) = self.maximum {
            if number > maximum {
                return Err(format!("must be less than or equal to {maximum}"));
            }
        }
        Ok(())
    }
}

/// One rejected setting value, shaped for `ProblemDetail.errors[]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceSettingViolation {
    /// Setting key the violation belongs to, or `settings` for schema errors.
    pub setting_key: String,
    /// Field-scoped failure message.
    pub message: String,
}

impl DeviceSettingViolation {
    /// Creates a violation for one setting key.
    #[must_use]
    pub fn new(setting_key: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            setting_key: setting_key.into(),
            message: message.into(),
        }
    }

    /// Field path used by `ProblemDetail.errors[].field`.
    #[must_use]
    pub fn field_path(&self) -> String {
        if self.setting_key.is_empty() {
            "overrides".to_string()
        } else {
            format!("overrides.{}", self.setting_key)
        }
    }
}

/// Result of validating definitions and merging device overrides.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceSettingsResolution {
    /// Values inherited from the capability model defaults.
    pub defaults: BTreeMap<String, Value>,
    /// Validated device-scoped overrides.
    pub overrides: BTreeMap<String, Value>,
    /// Defaults merged with overrides; the configuration the device applies.
    pub effective: BTreeMap<String, Value>,
}

/// Validates a declared settings schema.
///
/// # Errors
///
/// Returns every schema defect: duplicate keys, malformed keys, enum settings
/// without options, inverted ranges, and defaults outside the declared domain.
pub fn validate_device_setting_definitions(
    definitions: &[DeviceSettingDefinition],
) -> Result<(), Vec<DeviceSettingViolation>> {
    let mut violations = Vec::new();
    let mut seen = BTreeMap::<&str, usize>::new();

    for definition in definitions {
        let key = definition.key.trim();
        if key.is_empty() {
            violations.push(DeviceSettingViolation::new(
                "",
                "setting key must not be blank",
            ));
            continue;
        }
        if key.chars().count() > 128 {
            violations.push(DeviceSettingViolation::new(
                key,
                "setting key must be at most 128 characters",
            ));
        }
        if !key.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        }) {
            violations.push(DeviceSettingViolation::new(
                key,
                "setting key may only contain letters, digits, '.', '_' and '-'",
            ));
        }
        if seen.insert(key, 1).is_some() {
            violations.push(DeviceSettingViolation::new(
                key,
                "setting key is declared more than once",
            ));
        }
        if definition.display_name.trim().is_empty() {
            violations.push(DeviceSettingViolation::new(
                key,
                "display name must not be blank",
            ));
        }
        if definition.kind == DeviceSettingKind::Enum {
            if definition.options.is_empty() {
                violations.push(DeviceSettingViolation::new(
                    key,
                    "enum setting must declare at least one option",
                ));
            }
            let mut option_values = BTreeMap::<&str, usize>::new();
            for option in &definition.options {
                if option.value.trim().is_empty() {
                    violations.push(DeviceSettingViolation::new(
                        key,
                        "enum option value must not be blank",
                    ));
                }
                if option_values.insert(option.value.as_str(), 1).is_some() {
                    violations.push(DeviceSettingViolation::new(
                        key,
                        format!("enum option '{}' is declared more than once", option.value),
                    ));
                }
            }
        } else if !definition.options.is_empty() {
            violations.push(DeviceSettingViolation::new(
                key,
                "only enum settings may declare options",
            ));
        }
        if definition.max_length.is_some()
            && !matches!(
                definition.kind,
                DeviceSettingKind::String | DeviceSettingKind::Enum
            )
        {
            violations.push(DeviceSettingViolation::new(
                key,
                "maxLength is only supported by string and enum settings",
            ));
        }
        if let (Some(minimum), Some(maximum)) = (definition.minimum, definition.maximum) {
            if minimum > maximum {
                violations.push(DeviceSettingViolation::new(
                    key,
                    "minimum must not be greater than maximum",
                ));
            }
        }
        if (definition.minimum.is_some() || definition.maximum.is_some())
            && !matches!(
                definition.kind,
                DeviceSettingKind::Integer | DeviceSettingKind::Number
            )
        {
            violations.push(DeviceSettingViolation::new(
                key,
                "minimum/maximum are only supported by numeric settings",
            ));
        }
        if let Some(default_value) = &definition.default_value {
            if let Err(message) = definition.validate_value_domain(default_value) {
                violations.push(DeviceSettingViolation::new(
                    key,
                    format!("default value {message}"),
                ));
            }
        }
    }

    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations)
    }
}

/// Merges capability-model defaults with device overrides and validates the
/// overrides against the declared schema.
///
/// A `null` override removes the value from the device overrides so the
/// inherited default applies again.
///
/// # Errors
///
/// Returns one [`DeviceSettingViolation`] per rejected override, unknown key,
/// read-only key, and unsatisfied required setting.
pub fn resolve_device_settings(
    definitions: &[DeviceSettingDefinition],
    overrides: &BTreeMap<String, Value>,
) -> Result<DeviceSettingsResolution, Vec<DeviceSettingViolation>> {
    validate_device_setting_definitions(definitions)?;

    let definitions_by_key = definitions
        .iter()
        .map(|definition| (definition.key.as_str(), definition))
        .collect::<BTreeMap<_, _>>();
    let mut violations = Vec::new();
    let mut accepted_overrides = BTreeMap::new();

    for (key, value) in overrides {
        let Some(definition) = definitions_by_key.get(key.as_str()) else {
            violations.push(DeviceSettingViolation::new(
                key,
                "is not defined by the device capability model",
            ));
            continue;
        };
        if value.is_null() {
            if definition.required && definition.default_value.is_none() {
                violations.push(DeviceSettingViolation::new(
                    key,
                    "is required and cannot be cleared",
                ));
            }
            continue;
        }
        match definition.validate_value(value) {
            Ok(()) => {
                accepted_overrides.insert(key.clone(), value.clone());
            }
            Err(message) => {
                violations.push(DeviceSettingViolation::new(key, message));
            }
        }
    }

    let mut next_defaults = BTreeMap::new();
    for definition in definitions {
        if let Some(default_value) = &definition.default_value {
            next_defaults.insert(definition.key.clone(), default_value.clone());
        }
    }

    let mut next_effective = next_defaults.clone();
    for (key, value) in &accepted_overrides {
        next_effective.insert(key.clone(), value.clone());
    }

    for definition in definitions {
        if definition.required && !next_effective.contains_key(&definition.key) {
            violations.push(DeviceSettingViolation::new(
                &definition.key,
                "is required but has no value",
            ));
        }
    }

    if violations.is_empty() {
        Ok(DeviceSettingsResolution {
            defaults: next_defaults,
            overrides: accepted_overrides,
            effective: next_effective,
        })
    } else {
        Err(violations)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn speaker_definitions() -> Vec<DeviceSettingDefinition> {
        vec![
            DeviceSettingDefinition::new("audio.volume", DeviceSettingKind::Integer)
                .with_display_name("Volume")
                .with_default(json!(60))
                .with_range(0.0, 100.0)
                .with_unit("%"),
            DeviceSettingDefinition::new("assistant.wakeWord", DeviceSettingKind::Enum)
                .with_default(json!("你好小智"))
                .with_option(DeviceSettingOption::new("你好小智").with_label("默认唤醒词"))
                .with_option(DeviceSettingOption::new("小智小智")),
            DeviceSettingDefinition::new("network.heartbeatSeconds", DeviceSettingKind::Integer)
                .with_default(json!(30))
                .with_range(15.0, 300.0),
            DeviceSettingDefinition::new("system.autoSleep", DeviceSettingKind::Boolean)
                .with_default(json!(true)),
            DeviceSettingDefinition::new("assistant.instructions", DeviceSettingKind::String)
                .with_max_length(500)
                .with_default(json!("")),
        ]
    }

    #[test]
    fn resolution_inherits_defaults_and_applies_overrides() {
        let mut overrides = BTreeMap::new();
        overrides.insert("audio.volume".to_string(), json!(35));

        let resolution = resolve_device_settings(&speaker_definitions(), &overrides)
            .expect("valid settings resolution");
        assert_eq!(resolution.defaults.get("audio.volume"), Some(&json!(60)));
        assert_eq!(resolution.effective.get("audio.volume"), Some(&json!(35)));
        assert_eq!(
            resolution.effective.get("assistant.wakeWord"),
            Some(&json!("你好小智"))
        );
    }

    #[test]
    fn null_override_restores_inherited_default() {
        let mut overrides = BTreeMap::new();
        overrides.insert("audio.volume".to_string(), Value::Null);

        let resolution =
            resolve_device_settings(&speaker_definitions(), &overrides).expect("valid resolution");
        assert!(resolution.overrides.is_empty());
        assert_eq!(resolution.effective.get("audio.volume"), Some(&json!(60)));
    }

    #[test]
    fn rejects_unknown_read_only_and_out_of_range_values() {
        let mut overrides = BTreeMap::new();
        overrides.insert("audio.volume".to_string(), json!(140));
        overrides.insert("unknown.key".to_string(), json!("value"));
        overrides.insert("assistant.wakeWord".to_string(), json!("not-a-wake-word"));

        let violations = resolve_device_settings(&speaker_definitions(), &overrides)
            .expect_err("invalid settings must be rejected");
        assert!(violations
            .iter()
            .any(|violation| violation.setting_key == "audio.volume"
                && violation.message.contains("less than or equal")));
        assert!(violations
            .iter()
            .any(|violation| violation.setting_key == "unknown.key"));
        assert!(violations
            .iter()
            .any(|violation| violation.setting_key == "assistant.wakeWord"));
    }

    #[test]
    fn read_only_definitions_reject_device_overrides() {
        let definitions =
            vec![
                DeviceSettingDefinition::new("device.serialNumber", DeviceSettingKind::String)
                    .read_only(),
            ];
        let mut overrides = BTreeMap::new();
        overrides.insert("device.serialNumber".to_string(), json!("SN-1"));

        let violations = resolve_device_settings(&definitions, &overrides)
            .expect_err("read-only overrides must be rejected");
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains("read-only"));
        assert_eq!(violations[0].field_path(), "overrides.device.serialNumber");
    }

    #[test]
    fn integer_settings_reject_fractional_values() {
        let mut overrides = BTreeMap::new();
        overrides.insert("audio.volume".to_string(), json!(35.5));

        let violations = resolve_device_settings(&speaker_definitions(), &overrides)
            .expect_err("fractional integer must be rejected");
        assert_eq!(violations[0].setting_key, "audio.volume");
        assert!(violations[0].message.contains("integer"));
    }

    #[test]
    fn schema_validation_reports_duplicate_keys_and_enum_options() {
        let definitions = vec![
            DeviceSettingDefinition::new("audio.volume", DeviceSettingKind::Integer),
            DeviceSettingDefinition::new("audio.volume", DeviceSettingKind::Integer),
            DeviceSettingDefinition::new("mode", DeviceSettingKind::Enum),
        ];

        let violations = validate_device_setting_definitions(&definitions)
            .expect_err("schema defects must be reported");
        assert!(violations
            .iter()
            .any(|violation| violation.message.contains("declared more than once")));
        assert!(violations
            .iter()
            .any(|violation| violation.message.contains("at least one option")));
    }

    #[test]
    fn required_settings_without_value_are_reported() {
        let definitions =
            vec![
                DeviceSettingDefinition::new("device.activationCode", DeviceSettingKind::String)
                    .required(),
            ];

        let violations = resolve_device_settings(&definitions, &BTreeMap::new())
            .expect_err("required setting must be reported");
        assert_eq!(violations[0].setting_key, "device.activationCode");
        assert!(violations[0].message.contains("required"));
    }

    #[test]
    fn default_values_must_match_the_declared_domain() {
        let definitions =
            vec![
                DeviceSettingDefinition::new("audio.volume", DeviceSettingKind::Integer)
                    .with_default(json!(140))
                    .with_range(0.0, 100.0),
            ];

        let violations = validate_device_setting_definitions(&definitions)
            .expect_err("invalid default must be reported");
        assert!(violations[0].message.contains("default value"));
    }
}
