use crate::SqlDialect;

/// Returns the positional placeholder for the active SQL dialect (`?1` vs `$1`).
#[allow(dead_code)]
pub fn positional_placeholder(dialect: SqlDialect, index: usize) -> String {
    match dialect {
        SqlDialect::Sqlite => format!("?{index}"),
        SqlDialect::Postgres => format!("${index}"),
    }
}

/// Cast a bound value needs so PostgreSQL accepts it for a non-text column.
///
/// PostgreSQL types every parameter from the Rust value that is bound, so a
/// `String` bind is a `TEXT` parameter and `None::<String>` is a `TEXT` NULL.
/// Assigning either to a column with another type is rejected while the
/// statement is parsed:
///
/// ```text
/// ERROR: column "created_at" is of type timestamp without time zone
///        but expression is of type text
/// HINT: You will need to rewrite or cast the expression.
/// ```
///
/// The statement therefore has to carry the cast itself. SQLite is dynamically
/// typed and needs no cast, so [`cast_placeholder`] keeps the `?` marker there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlCast {
    /// `TEXT` value (or NULL) written to a `timestamp`/`timestamptz` column.
    Timestamp,
    /// `TEXT` NULL written to a `bigint` column (`created_by`/`updated_by`).
    BigInt,
}

impl SqlCast {
    fn postgres_type(self) -> &'static str {
        match self {
            Self::Timestamp => "TIMESTAMP",
            Self::BigInt => "BIGINT",
        }
    }
}

/// Renders one placeholder, carrying the cast its target column requires.
///
/// SQLite needs no cast and must keep the anonymous `?` marker the plan
/// statements already use: mixing `?N` with bare `?` renumbers the remaining
/// parameters and silently shifts every later bind.
pub fn cast_placeholder(dialect: SqlDialect, index: usize, cast: SqlCast) -> String {
    match dialect {
        SqlDialect::Postgres => format!("${index}::{}", cast.postgres_type()),
        SqlDialect::Sqlite => "?".to_string(),
    }
}

/// Adapts `?N` markers and appends the cast for each listed placeholder.
///
/// `casts` lists the 1-based placeholder indexes whose bound value cannot be
/// typed by PostgreSQL from the Rust value alone.
pub fn adapt_placeholders_with_casts(
    dialect: SqlDialect,
    sql: &str,
    casts: &[(usize, SqlCast)],
) -> String {
    let adapted = adapt_sqlite_placeholders(dialect, sql);
    if dialect == SqlDialect::Sqlite || casts.is_empty() {
        return adapted;
    }
    cast_postgres_placeholders(&adapted, casts)
}

fn cast_postgres_placeholders(sql: &str, casts: &[(usize, SqlCast)]) -> String {
    let mut rendered = String::with_capacity(sql.len() + casts.len() * 12);
    let mut chars = sql.chars().peekable();
    let mut inside_literal = false;
    while let Some(ch) = chars.next() {
        if ch == '\'' {
            inside_literal = !inside_literal;
            rendered.push(ch);
            continue;
        }
        if inside_literal || ch != '$' {
            rendered.push(ch);
            continue;
        }

        let mut digits = String::new();
        while let Some(&next) = chars.peek() {
            if next.is_ascii_digit() {
                digits.push(chars.next().expect("digit"));
            } else {
                break;
            }
        }

        if digits.is_empty() {
            rendered.push('$');
            continue;
        }

        let index = digits.parse::<usize>().unwrap_or(0);
        rendered.push('$');
        rendered.push_str(&digits);
        if let Some((_, cast)) = casts.iter().find(|(target, _)| *target == index) {
            rendered.push_str("::");
            rendered.push_str(cast.postgres_type());
        }
    }
    rendered
}

/// Adapts SQLite-style `?N` placeholders to Postgres `$N` placeholders.
pub fn adapt_sqlite_placeholders(dialect: SqlDialect, sql: &str) -> String {
    if dialect == SqlDialect::Sqlite {
        return sql.to_owned();
    }

    let mut adapted = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    let mut inside_literal = false;
    while let Some(ch) = chars.next() {
        if ch == '\'' {
            inside_literal = !inside_literal;
            adapted.push(ch);
            continue;
        }
        if inside_literal || ch != '?' {
            adapted.push(ch);
            continue;
        }

        let mut index = String::new();
        while let Some(&next) = chars.peek() {
            if next.is_ascii_digit() {
                index.push(chars.next().expect("digit"));
            } else {
                break;
            }
        }

        if index.is_empty() {
            adapted.push('?');
            continue;
        }

        adapted.push('$');
        adapted.push_str(&index);
    }

    adapted
}

#[cfg(test)]
mod dialect_sql_tests {
    use super::*;

    #[test]
    fn adapt_sqlite_placeholders_rewrites_numbered_markers_for_postgres() {
        let sql = "SELECT * FROM iot_device WHERE tenant_id = ?1 AND device_id = ?2";
        assert_eq!(
            adapt_sqlite_placeholders(SqlDialect::Postgres, sql),
            "SELECT * FROM iot_device WHERE tenant_id = $1 AND device_id = $2"
        );
    }

    #[test]
    fn adapt_sqlite_placeholders_preserves_sqlite_markers() {
        let sql = "SELECT * FROM iot_device WHERE tenant_id = ?1";
        assert_eq!(adapt_sqlite_placeholders(SqlDialect::Sqlite, sql), sql);
    }

    #[test]
    fn cast_placeholder_renders_the_postgres_cast() {
        assert_eq!(
            cast_placeholder(SqlDialect::Postgres, 18, SqlCast::Timestamp),
            "$18::TIMESTAMP"
        );
        assert_eq!(
            cast_placeholder(SqlDialect::Postgres, 21, SqlCast::BigInt),
            "$21::BIGINT"
        );
        // SQLite is dynamically typed: the placeholder stays the anonymous `?`
        // that the plan statements use, so bind positions do not shift.
        assert_eq!(
            cast_placeholder(SqlDialect::Sqlite, 18, SqlCast::Timestamp),
            "?"
        );
    }

    #[test]
    fn adapt_placeholders_with_casts_keeps_sqlite_statements_untouched() {
        let sql = "INSERT INTO iot_device (last_seen_at, created_at) VALUES (?1, ?2)";
        assert_eq!(
            adapt_placeholders_with_casts(
                SqlDialect::Sqlite,
                sql,
                &[(1, SqlCast::Timestamp), (2, SqlCast::Timestamp)],
            ),
            sql
        );
    }

    #[test]
    fn adapt_placeholders_with_casts_casts_only_the_listed_indexes() {
        let sql = "UPDATE iot_command SET status = ?1, updated_at = ?2 WHERE id = ?3";
        assert_eq!(
            adapt_placeholders_with_casts(SqlDialect::Postgres, sql, &[(2, SqlCast::Timestamp)]),
            "UPDATE iot_command SET status = $1, updated_at = $2::TIMESTAMP WHERE id = $3"
        );
    }

    #[test]
    fn adapt_placeholders_with_casts_ignores_markers_inside_string_literals() {
        let sql = "INSERT INTO iot_device_session (protocol_id, created_at) VALUES ('?9', ?9)";
        assert_eq!(
            adapt_placeholders_with_casts(SqlDialect::Postgres, sql, &[(9, SqlCast::Timestamp)]),
            "INSERT INTO iot_device_session (protocol_id, created_at) VALUES ('?9', $9::TIMESTAMP)"
        );
    }

    #[test]
    fn adapt_placeholders_with_casts_does_not_confuse_index_prefixes() {
        // `$1` must not be treated as a prefix match for a cast declared on `$10`.
        let sql = "SELECT * FROM iot_outbox_event WHERE status = ?1 AND next_attempt_at = ?10";
        assert_eq!(
            adapt_placeholders_with_casts(SqlDialect::Postgres, sql, &[(10, SqlCast::Timestamp)]),
            "SELECT * FROM iot_outbox_event WHERE status = $1 AND next_attempt_at = $10::TIMESTAMP"
        );
    }
}
