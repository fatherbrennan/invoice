use crate::{db::Store, domain, model::*};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

const PAGE_SIZE: u32 = 25;
#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchQuery {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub page: u32,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub range: crate::summary::DateRange,
    #[serde(default)]
    pub today: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerDetail {
    pub customer: Customer,
    pub code_locked: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub profile: Option<Profile>,
    pub customer_count: u32,
    pub service_count: u32,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceSummary {
    pub id: String,
    pub kind: String,
    pub customer_id: String,
    pub number: String,
    pub customer_name: String,
    pub date: String,
    pub total: Option<i64>,
    pub paid: bool,
    pub description: String,
    pub due_date: Option<String>,
    pub void_reason: String,
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn decode<T: serde::de::DeserializeOwned>(value: String) -> Result<T, String> {
    serde_json::from_str(&value).map_err(error)
}
fn query(value: &SearchQuery) -> Result<String, String> {
    if value.query.chars().count() > 200 || value.page > 40_000 {
        return Err("Search exceeds the supported limit".into());
    }
    let compact = value.query.replace(' ', "");
    let term = if compact.len() == 11 && compact.bytes().all(|c| c.is_ascii_digit()) {
        &compact
    } else {
        &value.query
    };
    let tokens: Vec<_> = term
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .take(13)
        .collect();
    if tokens.len() > 12 {
        return Err("Use at most 12 search words".into());
    }
    Ok(tokens
        .iter()
        .map(|s| format!("\"{s}\"*"))
        .collect::<Vec<_>>()
        .join(" AND "))
}
impl Store {
    // New line values must come from the catalogue; previously saved copies stay stable.
    pub fn validate_service_lines(&self, draft: &Draft) -> Result<(), String> {
        domain::validate_draft(draft)?;
        if let Some(index) = draft.lines.iter().position(|line| line.service.is_none()) {
            return Err(format!("Choose a service for line {}", index + 1));
        }
        self.validate_saved_service_lines(draft)
    }

    pub fn validate_saved_service_lines(&self, draft: &Draft) -> Result<(), String> {
        domain::validate_saved_draft(draft)?;
        let saved: Option<Draft> = self
            .connection
            .query_row("SELECT json FROM drafts WHERE id=?1", [&draft.id], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map_err(error)?
            .map(decode)
            .transpose()?;
        for (index, line) in draft.lines.iter().enumerate() {
            let Some(reference) = line.service.as_ref() else {
                continue;
            };
            if saved.as_ref().is_some_and(|old| {
                old.lines.iter().any(|v| {
                    v.service == line.service
                        && v.description == line.description
                        && v.unit_price == line.unit_price
                        && v.tax == line.tax
                })
            }) {
                continue;
            }
            let service: Service = self
                .connection
                .query_row(
                    "SELECT json FROM services WHERE id=?1",
                    [&reference.id],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .map_err(error)?
                .map(decode)
                .transpose()?
                .ok_or_else(|| {
                    format!(
                        "Service for line {} no longer exists. Choose or create a service.",
                        index + 1
                    )
                })?;
            if reference.name != service.name
                || line.description != service.description
                || line.unit_price != service.unit_price
                || line.tax != service.tax
            {
                return Err(format!(
                    "Service for line {} changed. Select it again to use its saved values.",
                    index + 1
                ));
            }
        }
        Ok(())
    }

    pub fn workspace(&self) -> Result<Workspace, String> {
        let profile = self
            .connection
            .query_row("SELECT json FROM profile WHERE singleton=1", [], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map_err(error)?
            .map(decode)
            .transpose()?;
        Ok(Workspace {
            profile,
            customer_count: self
                .connection
                .query_row("SELECT count(*) FROM customers", [], |r| r.get(0))
                .map_err(error)?,
            service_count: self
                .connection
                .query_row("SELECT count(*) FROM services", [], |r| r.get(0))
                .map_err(error)?,
        })
    }
    pub fn customer(&self, id: &str) -> Result<CustomerDetail, String> {
        domain::validate_id(id)?;
        let (json,next,locked) = self.connection.query_row("SELECT json,next_number,EXISTS(SELECT 1 FROM issued WHERE customer_id=customers.id) FROM customers WHERE id=?1",[id],|r| Ok((r.get::<_,String>(0)?,r.get(1)?,r.get(2)?))).optional().map_err(error)?.ok_or("Customer not found")?;
        let mut customer: Customer = decode(json)?;
        customer.next_number = next;
        Ok(CustomerDetail {
            customer,
            code_locked: locked,
        })
    }
    pub fn customer_code_available(&self, code: &str, id: &str) -> Result<bool, String> {
        Ok(!self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM customers WHERE code=?1 AND id<>?2)",
                params![code, id],
                |r| r.get::<_, bool>(0),
            )
            .map_err(error)?)
    }
    pub fn draft(&self, id: &str) -> Result<Draft, String> {
        domain::validate_id(id)?;
        decode(
            self.connection
                .query_row("SELECT json FROM drafts WHERE id=?1", [id], |r| {
                    r.get::<_, String>(0)
                })
                .optional()
                .map_err(error)?
                .ok_or("Draft not found")?,
        )
    }
    pub fn issued_snapshot(&self, id: &str) -> Result<Issued, String> {
        domain::validate_id(id)?;
        let (json, paid, void_reason) = self
            .connection
            .query_row(
                "SELECT snapshot,paid,void_reason FROM issued WHERE id=?1",
                [id],
                |r| Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(error)?
            .ok_or("Issued invoice not found")?;
        Ok(Issued {
            id: id.into(),
            snapshot: decode(json)?,
            paid,
            void_reason,
            pdf: vec![],
        })
    }
    pub fn search_invoices(&self, request: &SearchQuery) -> Result<Page<InvoiceSummary>, String> {
        let search = query(request)?;
        request.range.validate()?;
        let (from, to) = request.range.bounds();
        let mut bindings = vec![from, to];
        if matches!(request.status.as_str(), "overdue" | "noDueDate") {
            domain::date(&request.today).map_err(|_| "Invalid reporting date")?;
        }
        let status = match request.status.as_str() {
            "" | "all" => "1=1",
            "draft" => "kind='draft'",
            "issued" => "kind='issued' AND id IN (SELECT id FROM issued WHERE void_reason='')",
            "void" => "id IN (SELECT id FROM issued WHERE void_reason<>'')",
            "paid" => "kind='issued' AND paid=1 AND id IN (SELECT id FROM issued WHERE void_reason='')",
            "unpaid" => "kind='issued' AND paid=0 AND id IN (SELECT id FROM issued WHERE void_reason='')",
            "overdue" => {
                bindings.push(request.today.as_str());
                "kind='issued' AND paid=0 AND id IN (SELECT id FROM issued WHERE void_reason='' AND json_extract(snapshot,'$.dueDate') < ?3)"
            },
            "noDueDate" => "kind='issued' AND paid=0 AND id IN (SELECT id FROM issued WHERE void_reason='' AND json_extract(snapshot,'$.dueDate') IS NULL)",
            _ => return Err("Invalid invoice status filter".into()),
        };
        let filter = if search.is_empty() {
            "1=1".to_string()
        } else {
            bindings.push(search.as_str());
            format!(
                "rowid IN (SELECT rowid FROM invoices_fts WHERE invoices_fts MATCH ?{})",
                bindings.len()
            )
        };
        let clause = format!("{status} AND {filter} AND ((date>=?1 AND date<=?2) OR (kind='draft' AND date='' AND ?1='1900-01-01' AND ?2='9999-12-31'))");
        let tx = self.connection.unchecked_transaction().map_err(error)?;
        let total = tx
            .query_row(
                &format!("SELECT count(*) FROM invoice_index WHERE {clause}"),
                rusqlite::params_from_iter(bindings.iter()),
                |r| r.get(0),
            )
            .map_err(error)?;
        let sql=format!("SELECT id,kind,customer_id,number,customer_name,date,total,paid,description,(SELECT json_extract(snapshot,'$.dueDate') FROM issued WHERE id=invoice_index.id),coalesce((SELECT void_reason FROM issued WHERE id=invoice_index.id),''),CASE WHEN kind='issued' THEN coalesce((SELECT json_extract(snapshot,'$.customer.name') FROM issued WHERE id=invoice_index.id),'') ELSE coalesce((SELECT json_extract(json,'$.name') FROM customers WHERE id=invoice_index.customer_id),'') END FROM invoice_index WHERE {clause} ORDER BY date DESC,id LIMIT {PAGE_SIZE} OFFSET {}",request.page*PAGE_SIZE);
        let items = {
            let mut statement = tx.prepare(&sql).map_err(error)?;
            let rows = statement
                .query_map(rusqlite::params_from_iter(bindings.iter()), |r| {
                    Ok(InvoiceSummary {
                        id: r.get(0)?,
                        kind: r.get(1)?,
                        customer_id: r.get(2)?,
                        number: r.get(3)?,
                        customer_name: if r.get::<_, String>(11)?.trim().is_empty() {
                            crate::format::abn(&r.get::<_, String>(4)?)
                        } else {
                            r.get(4)?
                        },
                        date: r.get(5)?,
                        total: r.get(6)?,
                        paid: r.get(7)?,
                        description: r.get(8)?,
                        due_date: r.get(9)?,
                        void_reason: r.get(10)?,
                    })
                })
                .map_err(error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(error)?
        };
        tx.commit().map_err(error)?;
        Ok(Page {
            items,
            total,
            page: request.page,
            page_size: PAGE_SIZE,
        })
    }
    fn search_records<T: serde::de::DeserializeOwned>(
        &self,
        table: &str,
        request: &SearchQuery,
    ) -> Result<Page<T>, String> {
        let search = query(request)?;
        let filter = if search.is_empty() {
            "1=1".into()
        } else {
            format!("rowid IN (SELECT rowid FROM {table}_fts WHERE {table}_fts MATCH ?1)")
        };
        let bindings = if search.is_empty() {
            vec![]
        } else {
            vec![search.as_str()]
        };
        let tx = self.connection.unchecked_transaction().map_err(error)?;
        let total = tx
            .query_row(
                &format!("SELECT count(*) FROM {table} WHERE {filter}"),
                rusqlite::params_from_iter(bindings.iter()),
                |r| r.get(0),
            )
            .map_err(error)?;
        let json = if table == "customers" {
            "json_set(json, '$.nextNumber', next_number)"
        } else {
            "json"
        };
        let order = if table == "services" {
            "json_extract(json,'$.name') COLLATE NOCASE,id"
        } else {
            "code"
        };
        let items = {
            let mut statement=tx.prepare(&format!("SELECT {json} FROM {table} WHERE {filter} ORDER BY {order} LIMIT {PAGE_SIZE} OFFSET {}",request.page*PAGE_SIZE)).map_err(error)?;
            let rows = statement
                .query_map(rusqlite::params_from_iter(bindings.iter()), |r| {
                    r.get::<_, String>(0)
                })
                .map_err(error)?;
            rows.map(|r| decode(r.map_err(error)?))
                .collect::<Result<Vec<_>, String>>()?
        };
        tx.commit().map_err(error)?;
        Ok(Page {
            items,
            total,
            page: request.page,
            page_size: PAGE_SIZE,
        })
    }
    pub fn search_customers(&self, q: &SearchQuery) -> Result<Page<Customer>, String> {
        self.search_records("customers", q)
    }
    pub fn search_services(&self, q: &SearchQuery) -> Result<Page<Service>, String> {
        self.search_records("services", q)
    }
    pub fn save_service(&mut self, service: Service) -> Result<(), String> {
        domain::validate_service(&service)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(error)?;
        tx.execute("INSERT INTO services(id,json) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET json=excluded.json",params![service.id,serde_json::to_string(&service).map_err(error)?]).map_err(error)?;
        tx.commit().map_err(error)
    }
    pub fn delete_service(&mut self, id: &str) -> Result<(), String> {
        domain::validate_id(id)?;
        if self
            .connection
            .execute("DELETE FROM services WHERE id=?1", [id])
            .map_err(error)?
            != 1
        {
            return Err("Service not found".into());
        }
        Ok(())
    }
}
