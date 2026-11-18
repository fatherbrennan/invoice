use crate::{
    domain,
    model::{Customer, Dataset, Draft, Issued, Profile, Snapshot},
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{path::Path, time::Duration};

pub struct Store {
    pub(crate) connection: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut connection = Connection::open(path).map_err(error)?;
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(error)?;
        if version != 0 && version != 2 {
            return Err("Unsupported Invoice database schema".into());
        }
        // Issuance embeds fonts while holding the writer lock; allow slow machines to finish.
        connection
            .busy_timeout(Duration::from_secs(30))
            .map_err(error)?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(error)?;
        if version == 0 {
            let tx = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(error)?;
            let version: u32 = tx
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(error)?;
            if version == 0 {
                tx.execute_batch(include_str!("../schema.sql"))
                    .map_err(error)?;
            }
            if version != 0 && version != 2 {
                return Err("Unsupported Invoice database schema".into());
            }
            tx.commit().map_err(error)?;
        }
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(error)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(error)?;
        Ok(Self { connection })
    }

    pub fn read(&self) -> Result<Dataset, String> {
        let tx = self.connection.unchecked_transaction().map_err(error)?;
        let dataset = read_connection(&tx)?;
        tx.commit().map_err(error)?;
        Ok(dataset)
    }

    pub fn save_profile(&mut self, mut profile: Profile) -> Result<(), String> {
        domain::validate_profile(&profile)?;
        profile.normalize_identifiers();
        self.connection.execute(
            "INSERT INTO profile(singleton,json) VALUES (1,?1) ON CONFLICT(singleton) DO UPDATE SET json=excluded.json",
            [encode(&profile)?],
        ).map_err(error)?;
        Ok(())
    }

    pub fn save_customer(&mut self, mut customer: Customer) -> Result<(), String> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(error)?;
        let existing: Option<(String, u32)> = tx
            .query_row(
                "SELECT code,next_number FROM customers WHERE id=?1",
                [&customer.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(error)?;
        if let Some((code, next_number)) = existing {
            customer.next_number = next_number;
            if code != customer.code
                && tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM issued WHERE customer_id=?1)",
                        [&customer.id],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(error)?
            {
                return Err("Customer code cannot change after an invoice is issued".into());
            }
        } else if customer.next_number != 1 {
            return Err("New customers must start at invoice number 1".into());
        }
        domain::validate_customer(&customer)?;
        if tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM customers WHERE code=?1 AND id<>?2)",
                params![customer.code, customer.id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(error)?
        {
            return Err("Customer code is already in use".into());
        }
        tx.execute(
            "INSERT INTO customers(id,code,next_number,json) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET code=excluded.code,json=excluded.json",
            params![customer.id, customer.code, customer.next_number, encode(&customer)?],
        ).map_err(error)?;
        tx.commit().map_err(error)
    }

    pub fn save_draft(&mut self, draft: Draft) -> Result<(), String> {
        domain::validate_saved_draft(&draft)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(error)?;
        if tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM issued WHERE id=?1)",
                [&draft.id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(error)?
        {
            return Err("An issued invoice cannot be saved as a draft".into());
        }
        tx.execute(
            "INSERT INTO drafts(id,customer_id,json) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,json=excluded.json",
            params![draft.id, if draft.customer_id.is_empty() {None} else {Some(&draft.customer_id)}, encode(&draft)?],
        ).map_err(error)?;
        tx.commit().map_err(error)
    }

    pub fn delete_draft(&mut self, id: &str) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM drafts WHERE id=?1", [id])
            .map_err(error)?;
        Ok(())
    }
}

pub(crate) fn read_connection(connection: &Connection) -> Result<Dataset, String> {
    let mut dataset = Dataset::default();
    let profile: Option<String> = connection
        .query_row("SELECT json FROM profile WHERE singleton=1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(error)?;
    if let Some(json) = profile {
        let profile: Profile = serde_json::from_str(&json).map_err(error)?;
        domain::validate_profile(&profile)?;
        dataset.profile = Some(profile);
    }
    let mut services = connection
        .prepare("SELECT id,json FROM services ORDER BY id")
        .map_err(error)?;
    dataset.services = services
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(error)?
        .map(|row| {
            let (id, json) = row.map_err(error)?;
            let service: crate::model::Service = serde_json::from_str(&json).map_err(error)?;
            if service.id != id {
                return Err("Stored service is inconsistent".into());
            }
            domain::validate_service(&service)?;
            Ok(service)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut statement = connection
        .prepare("SELECT id,code,next_number,json FROM customers ORDER BY id")
        .map_err(error)?;
    let mut rows = statement.query([]).map_err(error)?;
    while let Some(row) = rows.next().map_err(error)? {
        let mut customer: Customer =
            serde_json::from_str(&row.get::<_, String>(3).map_err(error)?).map_err(error)?;
        customer.id = row.get(0).map_err(error)?;
        customer.code = row.get(1).map_err(error)?;
        customer.next_number = row.get(2).map_err(error)?;
        domain::validate_customer(&customer)?;
        dataset.customers.push(customer);
    }
    let mut statement = connection
        .prepare("SELECT id,customer_id,json FROM drafts ORDER BY id")
        .map_err(error)?;
    let mut rows = statement.query([]).map_err(error)?;
    while let Some(row) = rows.next().map_err(error)? {
        let mut draft: Draft =
            serde_json::from_str(&row.get::<_, String>(2).map_err(error)?).map_err(error)?;
        draft.id = row.get(0).map_err(error)?;
        draft.customer_id = row
            .get::<_, Option<String>>(1)
            .map_err(error)?
            .unwrap_or_default();
        domain::validate_saved_draft(&draft)?;
        if !draft.customer_id.is_empty()
            && !dataset
                .customers
                .iter()
                .any(|customer| customer.id == draft.customer_id)
        {
            return Err("Stored draft references a missing customer".into());
        }
        dataset.drafts.push(draft);
    }
    let mut statement = connection
        .prepare(
            "SELECT id,customer_id,number,snapshot,pdf,paid,void_reason FROM issued ORDER BY id",
        )
        .map_err(error)?;
    let mut rows = statement.query([]).map_err(error)?;
    while let Some(row) = rows.next().map_err(error)? {
        let id: String = row.get(0).map_err(error)?;
        let customer_id: String = row.get(1).map_err(error)?;
        let number: String = row.get(2).map_err(error)?;
        let snapshot: Snapshot =
            serde_json::from_str(&row.get::<_, String>(3).map_err(error)?).map_err(error)?;
        if snapshot.draft.id != id
            || snapshot.customer.id != customer_id
            || snapshot.draft.customer_id != customer_id
            || snapshot.number != number
            || !dataset
                .customers
                .iter()
                .any(|customer| customer.id == customer_id)
            || dataset.drafts.iter().any(|draft| draft.id == id)
        {
            return Err("Stored issued invoice is inconsistent".into());
        }
        dataset.issued.push(Issued {
            id,
            snapshot,
            pdf: row.get(4).map_err(error)?,
            paid: row.get(5).map_err(error)?,
            void_reason: row.get(6).map_err(error)?,
        });
    }
    Ok(dataset)
}

fn encode(value: &impl serde::Serialize) -> Result<String, String> {
    serde_json::to_string(value).map_err(error)
}

fn error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
