mod common;
use common::*;
use invoice_lib::{catalogue::SearchQuery, db::Store, model::*};
use rusqlite::{params, Connection};
fn q(text: &str) -> SearchQuery {
    SearchQuery {
        query: text.into(),
        ..Default::default()
    }
}
fn service() -> Service {
    Service {
        id: "service-1".into(),
        name: "Consulting".into(),
        description: "Technical advice".into(),
        unit_price: "100.00".into(),
        tax: Tax::Taxable,
    }
}

#[test]
fn grouped_abn_search_finds_raw_customer_and_invoice_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = setup(&dir.path().join("app.sqlite"));
    let mut customer = fixture().customer;
    customer.name.clear();
    customer.abn = "86474038153".into();
    store.save_customer(customer).unwrap();
    for search in ["86474038153", "86 474 038 153"] {
        assert_eq!(store.search_customers(&q(search)).unwrap().total, 1);
        let invoices = store.search_invoices(&q(search)).unwrap();
        assert_eq!(invoices.total, 1);
        assert_eq!(invoices.items[0].customer_name, "86 474 038 153");
    }
}

#[test]
fn invoice_lines_require_catalogue_values_and_preserve_saved_service_copies() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = setup(&dir.path().join("app.sqlite"));
    let mut draft = fixture().draft;
    draft.lines.truncate(1);
    assert!(store
        .validate_service_lines(&draft)
        .unwrap_err()
        .contains("Choose a service"));
    store.validate_saved_service_lines(&draft).unwrap();
    let s = service();
    draft.lines[0] = Line {
        service: Some(ServiceRef {
            id: s.id.clone(),
            name: s.name.clone(),
        }),
        description: s.description.clone(),
        quantity: "2".into(),
        unit_price: s.unit_price.clone(),
        tax: s.tax.clone(),
    };
    assert!(store
        .validate_service_lines(&draft)
        .unwrap_err()
        .contains("no longer exists"));
    store.save_service(s.clone()).unwrap();
    store.validate_service_lines(&draft).unwrap();
    let mut forged = draft.clone();
    forged.lines[0].unit_price = "1.00".into();
    assert!(store.validate_saved_service_lines(&forged).is_err());
    assert!(store
        .validate_service_lines(&forged)
        .unwrap_err()
        .contains("changed"));
    forged = draft.clone();
    forged.lines[0].description = "Unlisted service".into();
    assert!(store.validate_service_lines(&forged).is_err());
    store.save_draft(draft.clone()).unwrap();
    let mut changed = s;
    changed.unit_price = "300.00".into();
    store.save_service(changed).unwrap();
    draft.lines[0].quantity = "3".into();
    store.validate_service_lines(&draft).unwrap();
    store.delete_service("service-1").unwrap();
    store.validate_service_lines(&draft).unwrap();
    store.save_draft(draft.clone()).unwrap();
    let issued = store.issue(&draft.id).unwrap();
    assert_eq!(issued.snapshot.totals.total, 33000);
    let data = store.read().unwrap();
    let imported =
        invoice_lib::transfer::parse(&invoice_lib::transfer::encode(&data).unwrap()).unwrap();
    assert_eq!(imported.issued[0].snapshot.draft.lines, draft.lines);
    let mut new = draft;
    new.id = "new-draft".into();
    assert!(store
        .validate_service_lines(&new)
        .unwrap_err()
        .contains("no longer exists"));
}

#[test]
fn catalogue_crud_search_and_copied_lines_survive_removal() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = setup(&dir.path().join("app.sqlite"));
    store.save_service(service()).unwrap();
    assert_eq!(
        store.search_services(&q("tech adv")).unwrap().items,
        vec![service()]
    );
    let mut duplicate = service();
    duplicate.id = "other".into();
    store.save_service(duplicate).unwrap();
    store.delete_service("other").unwrap();
    let mut draft = fixture().draft;
    let source = service();
    draft.lines[0] = Line {
        service: None,
        description: source.description,
        unit_price: source.unit_price,
        tax: source.tax,
        quantity: "1".into(),
    };
    store.save_draft(draft.clone()).unwrap();
    let mut changed = service();
    changed.description = "Revised engineering".into();
    store.save_service(changed).unwrap();
    assert_eq!(store.search_services(&q("technical")).unwrap().total, 0);
    assert_eq!(store.search_services(&q("revised")).unwrap().total, 1);
    store.delete_service("service-1").unwrap();
    assert_eq!(store.search_services(&q("revised")).unwrap().total, 0);
    assert_eq!(store.draft("draft-1").unwrap(), draft);
    assert_eq!(store.issue("draft-1").unwrap().snapshot.draft, draft);
}

#[test]
fn invoice_index_tracks_drafts_issuance_and_payment_but_freezes_customer() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.sqlite");
    let mut store = setup(&path);
    assert_eq!(
        store.search_invoices(&q("consult")).unwrap().items[0].kind,
        "draft"
    );
    let first = store.issue("draft-1").unwrap();
    assert_eq!(store.search_invoices(&q("IABC1")).unwrap().total, 1);
    let mut customer = fixture().customer;
    customer.name = "Renamed buyer".into();
    store.save_customer(customer).unwrap();
    let mut draft = fixture().draft;
    draft.id = "draft-2".into();
    store.save_draft(draft).unwrap();
    assert_eq!(
        store.search_invoices(&q("Renamed")).unwrap().items[0].kind,
        "draft"
    );
    assert_eq!(store.search_invoices(&q("Example ABC")).unwrap().total, 1);
    store.set_paid("draft-1", true).unwrap();
    let paid = store
        .search_invoices(&SearchQuery {
            status: "paid".into(),
            ..q("")
        })
        .unwrap();
    assert_eq!(paid.total, 1);
    assert!(paid.items[0].paid);
    assert_eq!(
        store
            .search_invoices(&SearchQuery {
                status: "unpaid".into(),
                ..q("")
            })
            .unwrap()
            .total,
        0
    );
    assert_eq!(
        store.search_customers(&q("ABC")).unwrap().items[0].next_number,
        2
    );
    assert_eq!(
        store.issued_snapshot("draft-1").unwrap().snapshot,
        first.snapshot
    );
    assert!(store.issued_snapshot("draft-1").unwrap().pdf.is_empty());
    let conn = Connection::open(path).unwrap();
    for sql in [
        "UPDATE issued SET snapshot='{}'",
        "UPDATE issued SET pdf=x'00'",
        "UPDATE issued SET number='IABC9'",
        "UPDATE issued SET customer_id='other'",
        "UPDATE issued SET id='other'",
    ] {
        assert!(conn
            .execute(sql, [])
            .unwrap_err()
            .to_string()
            .contains("immutable"));
    }
    assert_eq!(store.issued_pdf("draft-1").unwrap().1, first.pdf);
    store.delete_draft("draft-2").unwrap();
    assert_eq!(store.search_invoices(&q("Renamed")).unwrap().total, 0);
}

#[test]
fn indexed_search_is_bounded_with_twenty_thousand_services() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("scale.sqlite");
    let store = Store::open(&path).unwrap();
    let mut conn = Connection::open(&path).unwrap();
    let tx = conn.transaction().unwrap();
    {
        let mut insert = tx.prepare("INSERT INTO services VALUES(?1,?2)").unwrap();
        for i in 0..20_000 {
            let mut s = service();
            s.id = format!("service-{i}");
            s.description = format!("Engineering region{}", i % 100);
            insert
                .execute(params![s.id, serde_json::to_string(&s).unwrap()])
                .unwrap();
        }
    }
    tx.commit().unwrap();
    let start = std::time::Instant::now();
    let first = store.search_services(&q("engineer region42")).unwrap();
    assert_eq!(first.total, 200);
    assert_eq!(first.items.len(), 25);
    let second = store
        .search_services(&SearchQuery {
            page: 1,
            ..q("engineer region42")
        })
        .unwrap();
    assert_eq!(second.items.len(), 25);
    assert!(first
        .items
        .iter()
        .all(|a| !second.items.iter().any(|b| a.id == b.id)));
    assert_eq!(store.search_services(&q("\" OR 1=1 --")).unwrap().total, 0);
    assert!(store.search_services(&q(&"x".repeat(201))).is_err());
    assert!(store
        .search_invoices(&SearchQuery {
            status: "invalid".into(),
            ..q("")
        })
        .is_err());
    let plan=conn.query_row("EXPLAIN QUERY PLAN SELECT rowid FROM services_fts WHERE services_fts MATCH 'engineering*'",[],|r|r.get::<_,String>(3)).unwrap();
    assert!(plan.contains("VIRTUAL TABLE INDEX"));
    println!(
        "20,000 services: two 25-row FTS pages + validation in {:?}; {}",
        start.elapsed(),
        plan
    );
}
#[test]
fn fresh_database_has_search_indexes_and_reopens_without_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("invoice.sqlite");
    let mut store = setup(&path);
    store.save_service(service()).unwrap();
    let before = store.read().unwrap();
    assert_eq!(store.search_invoices(&q("consult")).unwrap().total, 1);
    assert_eq!(store.search_customers(&q("ABC")).unwrap().total, 1);
    assert_eq!(store.search_services(&q("technical")).unwrap().total, 1);
    drop(store);
    let store = Store::open(&path).unwrap();
    assert_eq!(store.read().unwrap(), before);
    assert_eq!(store.search_services(&q("technical")).unwrap().total, 1);
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        2
    );
}
