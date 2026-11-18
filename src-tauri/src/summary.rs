use crate::{
    db::Store,
    domain,
    model::{LineTotal, Snapshot, Tax},
};
use rusqlite::params;
use serde::{Deserialize, Serialize};

const MAX_SAFE_CENTS: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DateRange {
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: String,
}

impl DateRange {
    pub fn validate(&self) -> Result<(), String> {
        if self.from.is_empty() && self.to.is_empty() {
            return Ok(());
        }
        domain::date(&self.from).map_err(|_| "Enter a valid From date between 1900 and 9999")?;
        domain::date(&self.to).map_err(|_| "Enter a valid To date between 1900 and 9999")?;
        if self.from > self.to {
            return Err("From date must not be after To date".into());
        }
        Ok(())
    }

    pub(crate) fn bounds(&self) -> (&str, &str) {
        if self.from.is_empty() {
            ("1900-01-01", "9999-12-31")
        } else {
            (&self.from, &self.to)
        }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Amounts {
    pub net: u64,
    pub gst: u64,
    pub total: u64,
}

fn add(left: u64, right: u64) -> Result<u64, String> {
    left.checked_add(right)
        .filter(|n| *n <= MAX_SAFE_CENTS)
        .ok_or_else(|| "Summary exceeds the supported exact amount limit".into())
}

impl Amounts {
    fn include(&mut self, net: u64, gst: u64, total: u64) -> Result<(), String> {
        if add(net, gst)? != total {
            return Err("Stored invoice amounts do not reconcile".into());
        }
        self.net = add(self.net, net)?;
        self.gst = add(self.gst, gst)?;
        self.total = add(self.total, total)?;
        Ok(())
    }
}

#[derive(Debug, Default, Serialize)]
pub struct Group {
    pub count: u64,
    #[serde(flatten)]
    pub amounts: Amounts,
}

impl Group {
    fn include(&mut self, s: &Snapshot) -> Result<(), String> {
        self.count = add(self.count, 1)?;
        self.amounts
            .include(s.totals.net, s.totals.gst, s.totals.total)
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceReport {
    pub all: Group,
    pub paid: Group,
    pub unpaid: Group,
    pub overdue: Group,
    pub no_due_date: Group,
    pub taxable: Amounts,
    pub gst_free: Amounts,
    pub input_taxed: Amounts,
    pub no_gst: Amounts,
}

impl Store {
    pub fn invoice_summary(&self, range: &DateRange, today: &str) -> Result<InvoiceReport, String> {
        range.validate()?;
        domain::date(today).map_err(|_| "Invalid reporting date")?;
        let (from, to) = range.bounds();
        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        let mut report = InvoiceReport::default();
        {
            // Reuse the indexed dates; never load PDFs or the paginated ledger into a report.
            let mut statement = tx.prepare("SELECT i.snapshot,i.paid,x.date FROM invoice_index x JOIN issued i ON i.id=x.id WHERE i.void_reason='' AND x.kind='issued' AND x.date>=?1 AND x.date<=?2")
                .map_err(|e| e.to_string())?;
            let mut rows = statement
                .query(params![from, to])
                .map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let json: String = row.get(0).map_err(|e| e.to_string())?;
                let s: Snapshot = serde_json::from_str(&json)
                    .map_err(|e| format!("Stored invoice is invalid: {e}"))?;
                let paid: bool = row.get(1).map_err(|e| e.to_string())?;
                let indexed_date: String = row.get(2).map_err(|e| e.to_string())?;
                domain::date(&s.draft.date)?;
                if s.draft.date != indexed_date
                    || s.draft.lines.len() != s.totals.lines.len()
                    || s.draft.lines.is_empty()
                {
                    return Err("Stored invoice details are inconsistent".into());
                }
                if let Some(due) = &s.due_date {
                    domain::date(due)?;
                }
                let mut lines = Amounts::default();
                for (line, LineTotal { net, gst, total }) in
                    s.draft.lines.iter().zip(&s.totals.lines)
                {
                    if line.tax != Tax::Taxable && *gst != 0 {
                        return Err("Stored non-taxable line contains GST".into());
                    }
                    lines.include(*net, *gst, *total)?;
                    let bucket = match line.tax {
                        Tax::Taxable => &mut report.taxable,
                        Tax::GstFree => &mut report.gst_free,
                        Tax::InputTaxed => &mut report.input_taxed,
                        Tax::NoGst => &mut report.no_gst,
                    };
                    bucket.include(*net, *gst, *total)?;
                }
                if (lines.net, lines.gst, lines.total)
                    != (s.totals.net, s.totals.gst, s.totals.total)
                {
                    return Err("Stored invoice lines do not reconcile with its totals".into());
                }
                report.all.include(&s)?;
                if paid {
                    report.paid.include(&s)?;
                } else {
                    report.unpaid.include(&s)?;
                    match s.due_date.as_deref() {
                        Some(due) if due < today => report.overdue.include(&s)?,
                        None => report.no_due_date.include(&s)?,
                        _ => (),
                    }
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_amount_limit_never_silently_rounds_or_wraps() {
        assert_eq!(add(MAX_SAFE_CENTS - 1, 1).unwrap(), MAX_SAFE_CENTS);
        assert!(add(MAX_SAFE_CENTS, 1).is_err());
        assert!(add(u64::MAX, 1).is_err());
    }
}
