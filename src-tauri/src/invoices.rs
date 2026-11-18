use crate::{db::Store, domain, model::*, pdf};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

fn decode<T: serde::de::DeserializeOwned>(json: String) -> Result<T, String> {
    serde_json::from_str(&json).map_err(|e| format!("Stored record is invalid: {e}"))
}

impl Store {
    pub fn preview_draft(&self, draft: &Draft) -> Result<Snapshot, String> {
        domain::validate_draft(draft)?;
        // Live editing must not read every saved PDF on each keystroke.
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let profile: Profile = decode(
            tx.query_row("SELECT json FROM profile WHERE singleton=1", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("Save the business profile first")?,
        )?;
        let (json, code, next): (String, String, u32) = tx
            .query_row(
                "SELECT json,code,next_number FROM customers WHERE id=?1",
                [&draft.customer_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("Choose a customer to preview this invoice")?;
        let mut customer: Customer = decode(json)?;
        customer.id = draft.customer_id.clone();
        customer.code = code;
        customer.next_number = next;
        let result = domain::snapshot(&profile, &customer, draft, "PREVIEW")?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn issued_pdf(&self, id: &str) -> Result<(String, Vec<u8>), String> {
        domain::validate_id(id)?;
        self.connection
            .query_row("SELECT number,pdf FROM issued WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("Issued invoice not found".into())
    }

    pub fn preview(&self, id: &str) -> Result<Snapshot, String> {
        self.preview_draft(&self.draft(id)?)
    }

    pub fn issue(&mut self, id: &str) -> Result<Issued, String> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let existing = tx
            .query_row(
                "SELECT snapshot,pdf,paid,void_reason FROM issued WHERE id=?1",
                [id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Vec<u8>>(1)?,
                        r.get::<_, bool>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((json, pdf, paid, void_reason)) = existing {
            return Ok(Issued {
                id: id.into(),
                snapshot: decode(json)?,
                pdf,
                paid,
                void_reason,
            });
        }
        let draft: Draft = decode(
            tx.query_row("SELECT json FROM drafts WHERE id=?1", [id], |r| r.get(0))
                .map_err(|_| "Draft not found")?,
        )?;
        let profile: Profile = decode(
            tx.query_row("SELECT json FROM profile WHERE singleton=1", [], |r| {
                r.get(0)
            })
            .map_err(|_| "Save the issuing business profile first")?,
        )?;
        let (customer_json, next_number): (String, u32) = tx
            .query_row(
                "SELECT json,next_number FROM customers WHERE id=?1",
                [&draft.customer_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let mut customer: Customer = decode(customer_json)?;
        customer.next_number = next_number;
        let next = next_number
            .checked_add(1)
            .ok_or("Customer invoice sequence is exhausted")?;
        let number = format!("I{}{next_number}", customer.code);
        let snapshot = domain::snapshot(&profile, &customer, &draft, &number)?;
        let pdf = pdf::render(&snapshot)?;
        let json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO issued(id,customer_id,number,snapshot,pdf,paid) VALUES (?1,?2,?3,?4,?5,0)",
            params![id, customer.id, number, json, pdf],
        )
        .map_err(|e| e.to_string())?;
        customer.next_number = next;
        tx.execute(
            "UPDATE customers SET next_number=?1,json=?2 WHERE id=?3",
            params![
                next,
                serde_json::to_string(&customer).map_err(|e| e.to_string())?,
                customer.id
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM drafts WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Issued {
            id: id.into(),
            snapshot,
            pdf,
            paid: false,
            void_reason: String::new(),
        })
    }

    pub fn correct_invoice(&mut self, id: &str, new_id: &str, reason: &str) -> Result<(), String> {
        domain::validate_id(id)?;
        domain::validate_id(new_id)?;
        let reason = reason.trim();
        if reason.is_empty() || reason.chars().count() > 500 || reason.chars().any(char::is_control)
        {
            return Err("Enter a correction reason of 1-500 characters".into());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM issued WHERE id=?1)",
                [new_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            return Err("Replacement ID is already issued".into());
        }
        let json: String = tx
            .query_row(
                "SELECT snapshot FROM issued WHERE id=?1 AND void_reason=''",
                [id],
                |r| r.get(0),
            )
            .map_err(|_| "Invoice is missing or already voided")?;
        let snapshot: Snapshot = decode(json)?;
        let mut draft = snapshot.draft;
        draft.id = new_id.into();
        // The original PDF stays intact; its replacement gets a new invoice number on issue.
        tx.execute(
            "INSERT INTO drafts(id,customer_id,json) VALUES (?1,?2,?3)",
            params![
                draft.id,
                draft.customer_id,
                serde_json::to_string(&draft).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE issued SET void_reason=?1 WHERE id=?2",
            params![reason, id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn set_paid(&mut self, id: &str, paid: bool) -> Result<(), String> {
        let changed = self
            .connection
            .execute(
                "UPDATE issued SET paid=?1 WHERE id=?2 AND void_reason=''",
                params![paid, id],
            )
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("Issued invoice not found".into());
        }
        Ok(())
    }
}
