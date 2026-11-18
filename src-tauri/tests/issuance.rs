mod common;
use common::*;
use invoice_lib::db::Store;
use std::sync::{Arc, Barrier};

#[test]
fn issue_reopen_retry_and_paid_preserve_original_document() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let mut store = setup(&path);
    assert_eq!(store.preview("draft-1").unwrap().number, "PREVIEW");
    assert_eq!(store.read().unwrap().customers[0].next_number, 1);
    let first = store.issue("draft-1").unwrap();
    assert_eq!(first.snapshot.number, "IABC1");
    assert_eq!(first.snapshot.totals.total, 13000);
    assert_eq!(store.issue("draft-1").unwrap(), first);
    assert_eq!(
        store.issued_pdf("draft-1").unwrap(),
        ("IABC1".into(), first.pdf.clone())
    );
    assert!(store.issued_pdf("missing").is_err());
    assert!(store.issued_pdf("../draft-1").is_err());
    drop(store);
    let mut store = Store::open(&path).unwrap();
    let mut profile = fixture().profile;
    profile.name = "Changed business".into();
    profile.show_item_gst = false;
    store.save_profile(profile).unwrap();
    let mut customer = fixture().customer;
    customer.name = "Changed buyer".into();
    store.save_customer(customer).unwrap();
    store.set_paid("draft-1", true).unwrap();
    let after = store.read().unwrap();
    assert_eq!(after.issued[0].snapshot, first.snapshot);
    assert_eq!(after.issued[0].pdf, first.pdf);
    assert!(after.issued[0].paid);
    assert!(after.drafts.is_empty());
    assert_eq!(after.customers[0].next_number, 2);
    assert!(store.save_draft(fixture().draft).is_err());
}

#[test]
fn failed_pdf_and_failed_sql_leave_draft_and_number_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let mut store = setup(&path);
    let mut draft = fixture().draft;
    draft.lines[0].description = "Unsupported rocket 🚀".into();
    store.save_draft(draft).unwrap();
    let before = store.read().unwrap();
    assert!(store.issue("draft-1").is_err());
    assert_eq!(store.read().unwrap(), before);
    store.save_draft(fixture().draft).unwrap();
    let before = store.read().unwrap();
    let control = rusqlite::Connection::open(&path).unwrap();
    control.execute_batch("CREATE TRIGGER fail_counter BEFORE UPDATE OF next_number ON customers BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;").unwrap();
    assert!(store
        .issue("draft-1")
        .unwrap_err()
        .contains("synthetic write failure"));
    assert_eq!(store.read().unwrap(), before);
    control.execute_batch("DROP TRIGGER fail_counter;").unwrap();
    assert_eq!(store.issue("draft-1").unwrap().snapshot.number, "IABC1");
}

#[test]
fn concurrent_duplicate_issue_commits_once() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    drop(setup(&path));
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut store = Store::open(&path).unwrap();
                barrier.wait();
                store.issue("draft-1").unwrap()
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results[0], results[1]);
    let data = Store::open(&path).unwrap().read().unwrap();
    assert_eq!(data.issued.len(), 1);
    assert_eq!(data.customers[0].next_number, 2);
}

#[test]
fn concurrent_distinct_drafts_get_unique_numbers_matching_their_pdfs() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let mut store = setup(&path);
    let mut second = fixture().draft;
    second.id = "draft-2".into();
    store.save_draft(second).unwrap();
    drop(store);
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = ["draft-1", "draft-2"]
        .into_iter()
        .map(|id| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut store = Store::open(&path).unwrap();
                barrier.wait();
                store.issue(id).unwrap()
            })
        })
        .collect();
    let mut numbers = Vec::new();
    for handle in handles {
        let invoice = handle.join().unwrap();
        let pdf = lopdf::Document::load_mem(&invoice.pdf).unwrap();
        let text = pdf
            .extract_text(&pdf.get_pages().keys().copied().collect::<Vec<_>>())
            .unwrap();
        assert!(
            text.contains(&invoice.snapshot.number),
            "Missing {} in {text:?}",
            invoice.snapshot.number
        );
        numbers.push(invoice.snapshot.number);
    }
    numbers.sort();
    assert_eq!(numbers, ["IABC1", "IABC2"]);
    assert_eq!(
        Store::open(&path).unwrap().read().unwrap().customers[0].next_number,
        3
    );
}

#[test]
fn live_unsaved_preview_never_saves_or_reserves_an_invoice_number() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = setup(&directory.path().join("app.sqlite"));
    let before = store.read().unwrap();
    let mut edited = fixture().draft;
    edited.lines[0].unit_price = "200.00".into();
    let preview = store.preview_draft(&edited).unwrap();
    assert_eq!(preview.number, "PREVIEW");
    assert_eq!(preview.totals.total, 24000);
    assert_eq!(preview.template_version, 2);
    assert_eq!(store.read().unwrap(), before);
    edited.lines[0].quantity = "invalid".into();
    assert!(store.preview_draft(&edited).is_err());
    assert_eq!(store.read().unwrap(), before);
    let issued = store.issue("draft-1").unwrap();
    assert_eq!(issued.snapshot.number, "IABC1");
    assert_eq!(issued.snapshot.totals.total, 13000);
}

#[test]
fn missing_bpay_reference_blocks_preview_and_issue_without_consuming_a_number() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = setup(&directory.path().join("payments.sqlite"));
    let mut f = fixture();
    f.profile.payment_methods = vec![invoice_lib::model::PaymentMethod::Bpay {
        biller_code: "012345".into(),
    }];
    store.save_profile(f.profile).unwrap();
    assert!(store
        .preview(&f.draft.id)
        .unwrap_err()
        .contains("BPAY reference"));
    assert!(store
        .issue(&f.draft.id)
        .unwrap_err()
        .contains("BPAY reference"));
    let data = store.read().unwrap();
    assert_eq!(data.customers[0].next_number, 1);
    assert!(data.issued.is_empty());
    assert_eq!(data.drafts.len(), 1);
    f.draft.bpay_reference = "00012345678901234567".into();
    store.save_draft(f.draft.clone()).unwrap();
    assert_eq!(store.issue(&f.draft.id).unwrap().snapshot.number, "IABC1");
}
