mod common;
use invoice_lib::{catalogue::SearchQuery, db::Store, transfer};

#[test]
fn unfinished_draft_survives_reopen_export_and_delete_but_cannot_issue() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("draft.sqlite");
    let mut store = Store::open(&path).unwrap();
    let mut draft = common::fixture().draft;
    draft.customer_id.clear();
    draft.date.clear();
    draft.lines.clear();
    draft.due = invoice_lib::model::DueDate::Exact {
        date: String::new(),
    };
    draft.notes = "Waiting for customer details".into();
    store.save_draft(draft.clone()).unwrap();
    assert!(store.issue(&draft.id).is_err());
    drop(store);
    let mut store = Store::open(&path).unwrap();
    assert_eq!(store.draft(&draft.id).unwrap(), draft);
    let listed = store.search_invoices(&SearchQuery::default()).unwrap();
    assert_eq!(listed.total, 1);
    assert_eq!(listed.items[0].customer_name, "No customer selected");
    let export = store.read().unwrap();
    transfer::validate(&export).unwrap();
    let mut restored = Store::open(&dir.path().join("restored.sqlite")).unwrap();
    restored
        .replace(
            &export,
            &restored.read().unwrap(),
            &dir.path().join("recovery"),
        )
        .unwrap();
    assert_eq!(restored.draft(&draft.id).unwrap(), draft);
    store.delete_draft(&draft.id).unwrap();
    assert_eq!(
        store
            .search_invoices(&SearchQuery::default())
            .unwrap()
            .total,
        0
    );
}

#[test]
fn correction_is_atomic_preserves_original_and_excludes_void_from_totals() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = common::setup(&dir.path().join("correction.sqlite"));
    let original = store.issue("draft-1").unwrap();
    assert!(store
        .correct_invoice("draft-1", "replacement", " ")
        .is_err());
    assert!(store
        .correct_invoice("draft-1", "draft-1", "Wrong description")
        .is_err());
    let mut collision = common::fixture().draft;
    collision.id = "collision".into();
    store.save_draft(collision).unwrap();
    assert!(store
        .correct_invoice("draft-1", "collision", "Wrong description")
        .is_err());
    assert!(store
        .issued_snapshot("draft-1")
        .unwrap()
        .void_reason
        .is_empty());
    store
        .correct_invoice("draft-1", "replacement", "Wrong description")
        .unwrap();
    assert_eq!(store.issued_pdf("draft-1").unwrap().1, original.pdf);
    assert_eq!(
        store.issued_snapshot("draft-1").unwrap().void_reason,
        "Wrong description"
    );
    assert_eq!(
        store.draft("replacement").unwrap().lines,
        original.snapshot.draft.lines
    );
    assert!(store
        .correct_invoice("draft-1", "another", "Repeat")
        .is_err());
    assert!(store.set_paid("draft-1", true).is_err());
    assert_eq!(
        store
            .invoice_summary(&Default::default(), "2026-11-17")
            .unwrap()
            .all
            .count,
        0
    );
    assert_eq!(
        store
            .search_invoices(&SearchQuery {
                status: "void".into(),
                ..Default::default()
            })
            .unwrap()
            .total,
        1
    );
    let replacement = store.issue("replacement").unwrap();
    assert_eq!(replacement.snapshot.number, "IABC2");
    assert_eq!(
        store
            .invoice_summary(&Default::default(), "2026-11-17")
            .unwrap()
            .all
            .amounts
            .total,
        13000
    );
    let exported = store.read().unwrap();
    transfer::validate(&exported).unwrap();
    let mut restored = Store::open(&dir.path().join("restore.sqlite")).unwrap();
    restored
        .replace(
            &exported,
            &restored.read().unwrap(),
            &dir.path().join("recovery"),
        )
        .unwrap();
    assert_eq!(
        restored.issued_snapshot("draft-1").unwrap().void_reason,
        "Wrong description"
    );
}
