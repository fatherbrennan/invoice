mod common;
use common::*;
use invoice_lib::{catalogue::SearchQuery, domain, model::*, summary::DateRange};
use rusqlite::{params, Connection};

fn line(price: &str, tax: Tax) -> Line {
    Line {
        service: None,
        description: "Synthetic reporting service".into(),
        quantity: "1".into(),
        unit_price: price.into(),
        tax,
    }
}
fn insert(conn: &Connection, n: u32, date: &str, paid: bool, due: Option<&str>, registered: bool) {
    let mut f = fixture();
    f.profile.gst_registered = registered;
    f.customer.next_number = n;
    f.draft.id = format!("report-{n}");
    f.draft.date = date.into();
    f.draft.due = due
        .map(|date| DueDate::Exact { date: date.into() })
        .unwrap_or_default();
    f.draft.lines = if registered {
        vec![
            line("0.05", Tax::Taxable),
            line("0.05", Tax::Taxable),
            line("20", Tax::GstFree),
            line("30", Tax::InputTaxed),
        ]
    } else {
        vec![line("40", Tax::NoGst)]
    };
    let s = domain::snapshot(
        &f.profile,
        &f.customer,
        &f.draft,
        &format!("I{}{n}", f.customer.code),
    )
    .unwrap();
    // PDF bytes are deliberately absent: reporting must only read saved invoice data.
    conn.execute(
        "INSERT INTO issued(id,customer_id,number,snapshot,pdf,paid) VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            s.draft.id,
            s.customer.id,
            s.number,
            serde_json::to_string(&s).unwrap(),
            Vec::<u8>::new(),
            paid
        ],
    )
    .unwrap();
}

#[test]
fn full_range_reconciles_every_status_and_tax_bucket_beyond_one_page() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("summary.sqlite");
    let mut store = setup(&path);
    let conn = Connection::open(&path).unwrap();
    let mut draft = fixture().draft;
    draft.date = "2026-10-15".into();
    store.save_draft(draft).unwrap();
    for n in 1..=30 {
        let due = match n % 6 {
            1 => Some("2026-11-15"),
            3 => Some("2026-11-16"),
            _ => None,
        };
        insert(
            &conn,
            n,
            if n <= 15 { "2026-10-01" } else { "2026-10-31" },
            n % 2 == 0,
            due,
            true,
        );
    }
    insert(&conn, 31, "2026-09-30", false, None, true);
    insert(&conn, 32, "2026-11-01", false, None, true);
    insert(&conn, 33, "2026-10-10", false, None, false);
    insert(&conn, 34, "2027-01-01", false, None, true);
    let range = DateRange {
        from: "2026-10-01".into(),
        to: "2026-10-31".into(),
    };
    let report = store.invoice_summary(&range, "2026-11-16").unwrap();
    assert_eq!(
        (
            report.all.count,
            report.all.amounts.net,
            report.all.amounts.gst,
            report.all.amounts.total
        ),
        (31, 154300, 60, 154360)
    );
    assert_eq!((report.paid.count, report.paid.amounts.total), (15, 75180));
    assert_eq!(
        (report.unpaid.count, report.unpaid.amounts.total),
        (16, 79180)
    );
    assert_eq!(
        (report.overdue.count, report.overdue.amounts.total),
        (5, 25060)
    );
    assert_eq!(
        (report.no_due_date.count, report.no_due_date.amounts.total),
        (6, 29060)
    );
    assert_eq!(
        (report.taxable.net, report.taxable.gst, report.taxable.total),
        (300, 60, 360)
    );
    assert_eq!(report.gst_free.total, 60000);
    assert_eq!(report.input_taxed.total, 90000);
    assert_eq!(report.no_gst.total, 4000);
    assert_eq!(
        report.all.amounts.total,
        report.paid.amounts.total + report.unpaid.amounts.total
    );
    for (status, count) in [
        ("issued", 31),
        ("paid", 15),
        ("unpaid", 16),
        ("overdue", 5),
        ("noDueDate", 6),
    ] {
        let q = SearchQuery {
            range: range.clone(),
            today: "2026-11-16".into(),
            status: status.into(),
            ..Default::default()
        };
        let result = store.search_invoices(&q).unwrap();
        assert_eq!(result.total, count, "{status}");
        assert_eq!(result.items.len(), (count as usize).min(25));
        let searched = store
            .search_invoices(&SearchQuery {
                query: "Synthetic".into(),
                ..q
            })
            .unwrap();
        assert_eq!(searched.total, count);
    }
    let page = store
        .search_invoices(&SearchQuery {
            range: range.clone(),
            status: "issued".into(),
            page: 1,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(page.items.len(), 6);
    assert_eq!(
        store
            .invoice_summary(&DateRange::default(), "2026-11-16")
            .unwrap()
            .all
            .count,
        34
    );
    assert_eq!(
        store
            .invoice_summary(
                &DateRange {
                    from: "2026-10-01".into(),
                    to: "2026-10-01".into()
                },
                "2026-11-16"
            )
            .unwrap()
            .all
            .count,
        15
    );
    let empty = store
        .invoice_summary(
            &DateRange {
                from: "2028-01-01".into(),
                to: "2028-01-31".into(),
            },
            "2026-11-16",
        )
        .unwrap();
    assert_eq!((empty.all.count, empty.all.amounts.total), (0, 0));
    let before = store.issued_snapshot("report-1").unwrap().snapshot;
    store.set_paid("report-1", true).unwrap();
    let after = store.invoice_summary(&range, "2026-11-16").unwrap();
    assert_eq!(after.all.amounts.total, report.all.amounts.total);
    assert_eq!(after.paid.amounts.total, 80192);
    assert_eq!(after.overdue.count, 4);
    let mut profile = fixture().profile;
    profile.gst_registered = false;
    store.save_profile(profile).unwrap();
    assert_eq!(
        store
            .invoice_summary(&range, "2026-11-16")
            .unwrap()
            .all
            .amounts
            .gst,
        60
    );
    assert_eq!(store.issued_snapshot("report-1").unwrap().snapshot, before);
}

#[test]
fn invalid_dates_and_corrupt_amounts_fail_instead_of_returning_misleading_totals() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("summary.sqlite");
    let store = setup(&path);
    for (from, to) in [
        ("2026-02-29", "2026-03-01"),
        ("2026-12-01", "2026-01-01"),
        ("", "2026-01-01"),
        ("1900-02-29", "1900-03-01"),
        ("2026-01-01", ""),
        ("1899-12-31", "2026-01-01"),
    ] {
        let range = DateRange {
            from: from.into(),
            to: to.into(),
        };
        assert!(store.invoice_summary(&range, "2026-11-16").is_err());
        assert!(store
            .search_invoices(&SearchQuery {
                range,
                ..Default::default()
            })
            .is_err());
    }
    assert!(store
        .invoice_summary(&DateRange::default(), "2026-02-29")
        .is_err());
    let conn = Connection::open(&path).unwrap();
    insert(&conn, 1, "2026-10-01", false, None, true);
    // Simulate external corruption; ordinary app writes cannot change issued snapshots.
    conn.execute_batch("DROP TRIGGER issued_content_immutable; UPDATE issued SET snapshot=json_set(snapshot,'$.totals.gst',1)").unwrap();
    assert!(store
        .invoice_summary(&DateRange::default(), "2026-11-16")
        .unwrap_err()
        .contains("reconcile"));
}
