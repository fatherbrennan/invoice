use invoice_lib::{
    db::Store,
    model::{Customer, Draft, Line, LineTotal, Profile, Snapshot, Tax, Totals},
};
use rusqlite::{params, Connection};
use std::path::Path;

fn profile() -> Profile {
    Profile {
        name: "Synthetic Supplier".into(),
        abn: String::new(),
        address: "1 Test Street".into(),
        payment_details: "Synthetic payment details".into(),
        payment_methods: vec![],
        gst_registered: false,
        show_item_gst: false,
    }
}

#[test]
fn bsb_storage_is_raw_on_save_reopen_and_restore_without_changing_account_zeroes() {
    use invoice_lib::model::PaymentMethod;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.sqlite");
    let mut store = Store::open(&path).unwrap();
    let mut formatted = profile();
    formatted.payment_methods = vec![PaymentMethod::BankTransfer {
        account_name: "Supplier".into(),
        bsb: "012-345".into(),
        account_number: "001234567".into(),
    }];
    store.save_profile(formatted.clone()).unwrap();
    let expected = store.read().unwrap();
    let PaymentMethod::BankTransfer {
        bsb,
        account_number,
        ..
    } = &expected.profile.as_ref().unwrap().payment_methods[0]
    else {
        panic!("Missing bank details")
    };
    assert_eq!(bsb, "012345");
    assert_eq!(account_number, "001234567");
    drop(store);
    let mut store = Store::open(&path).unwrap();
    assert_eq!(store.read().unwrap(), expected);
    let mut imported = expected.clone();
    imported.profile = Some(formatted);
    store
        .replace(&imported, &expected, &dir.path().join("recovery"))
        .unwrap();
    assert_eq!(store.read().unwrap(), expected);
    let connection = Connection::open(&path).unwrap();
    let saved: String = connection
        .query_row(
            "SELECT json_extract(json,'$.paymentMethods[0].bsb') FROM profile",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(saved, "012345");
}

fn customer() -> Customer {
    Customer {
        id: "customer-abc".into(),
        code: "ABC".into(),
        name: "Synthetic Buyer".into(),
        abn: String::new(),
        address: String::new(),
        attention: String::new(),
        next_number: 1,
    }
}

fn draft() -> Draft {
    Draft {
        id: "draft-1".into(),
        customer_id: customer().id,
        reference: String::new(),
        bpay_reference: String::new(),
        due: Default::default(),
        date: "2026-11-15".into(),
        notes: String::new(),
        lines: vec![Line {
            service: None,
            description: "Synthetic service".into(),
            quantity: "1".into(),
            unit_price: "10.00".into(),
            tax: Tax::NoGst,
        }],
    }
}

fn seed_issued(path: &Path) -> Snapshot {
    let snapshot = Snapshot {
        due_date: None,
        template_version: 2,
        number: "IABC1".into(),
        profile: profile(),
        customer: customer(),
        draft: draft(),
        heading: "INVOICE".into(),
        totals: Totals {
            lines: vec![LineTotal {
                net: 1000,
                gst: 0,
                total: 1000,
            }],
            net: 1000,
            gst: 0,
            total: 1000,
        },
    };
    let connection = Connection::open(path).unwrap();
    connection
        .execute(
            "INSERT INTO issued(id,customer_id,number,snapshot,pdf,paid) VALUES (?1,?2,?3,?4,?5,0)",
            params![
                snapshot.draft.id,
                snapshot.customer.id,
                snapshot.number,
                serde_json::to_string(&snapshot).unwrap(),
                b"%PDF-synthetic\n%%EOF".as_slice()
            ],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE customers SET next_number=2 WHERE id=?1",
            [&snapshot.customer.id],
        )
        .unwrap();
    snapshot
}

#[test]
fn saves_reopens_edits_and_deletes_drafts() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("invoice.sqlite");
    {
        let mut store = Store::open(&path).unwrap();
        assert_eq!(store.read().unwrap(), Default::default());
        store.save_profile(profile()).unwrap();
        store.save_customer(customer()).unwrap();
        store.save_draft(draft()).unwrap();
    }
    let mut store = Store::open(&path).unwrap();
    let data = store.read().unwrap();
    assert_eq!(data.profile, Some(profile()));
    assert_eq!(data.customers, vec![customer()]);
    assert_eq!(data.drafts, vec![draft()]);
    assert!(data.issued.is_empty());
    let mut edited = draft();
    edited.notes = "Saved edit".into();
    store.save_draft(edited.clone()).unwrap();
    assert_eq!(store.read().unwrap().drafts, vec![edited]);
    store.delete_draft("draft-1").unwrap();
    drop(store);
    assert!(Store::open(&path)
        .unwrap()
        .read()
        .unwrap()
        .drafts
        .is_empty());
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        connection
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "wal"
    );
}

#[test]
fn duplicate_codes_and_missing_customer_writes_preserve_data() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("invoice.sqlite");
    let mut store = Store::open(&path).unwrap();
    store.save_customer(customer()).unwrap();
    store.save_draft(draft()).unwrap();
    let before = store.read().unwrap();
    let mut duplicate = customer();
    duplicate.id = "customer-other".into();
    assert_eq!(
        store.save_customer(duplicate).unwrap_err(),
        "Customer code is already in use"
    );
    let mut missing = draft();
    missing.customer_id = "missing".into();
    assert!(store.save_draft(missing).is_err());
    assert_eq!(store.read().unwrap(), before);
    drop(store);
    let mut reopened = Store::open(&path).unwrap();
    let mut missing = draft();
    missing.id = "other-draft".into();
    missing.customer_id = "missing".into();
    assert!(reopened.save_draft(missing).is_err());
    assert_eq!(reopened.read().unwrap(), before);
}

#[test]
fn malformed_updates_leave_saved_data_intact() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("invoice.sqlite");
    let mut store = Store::open(&path).unwrap();
    store.save_profile(profile()).unwrap();
    store.save_customer(customer()).unwrap();
    store.save_draft(draft()).unwrap();
    let before = store.read().unwrap();
    let mut invalid = profile();
    invalid.gst_registered = true;
    assert!(store.save_profile(invalid).is_err());
    let mut invalid = customer();
    invalid.code = "lowercase".into();
    assert!(store.save_customer(invalid).is_err());
    for (date, quantity, price) in [
        ("2026-02-29", "1", "10.00"),
        ("2026-11-15", "0", "10.00"),
        ("2026-11-15", "1", "-1.00"),
    ] {
        let mut invalid = draft();
        invalid.date = date.into();
        invalid.lines[0].quantity = quantity.into();
        invalid.lines[0].unit_price = price.into();
        assert!(store.save_draft(invalid).is_err());
    }
    assert_eq!(store.read().unwrap(), before);
    drop(store);
    assert_eq!(Store::open(&path).unwrap().read().unwrap(), before);
}

#[test]
fn counters_are_owned_by_storage_and_issued_content_is_immutable() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("invoice.sqlite");
    let mut store = Store::open(&path).unwrap();
    let mut invalid = customer();
    invalid.next_number = 42;
    assert!(store.save_customer(invalid).is_err());
    assert!(store.read().unwrap().customers.is_empty());
    store.save_customer(customer()).unwrap();
    let snapshot = seed_issued(&path);
    let mut updated = customer();
    updated.name = "Updated buyer".into();
    updated.next_number = 999;
    store.save_customer(updated.clone()).unwrap();
    updated.next_number = 2;
    assert_eq!(store.read().unwrap().customers, vec![updated.clone()]);
    updated.code = "XYZ".into();
    assert!(store.save_customer(updated).is_err());
    assert!(store.save_draft(draft()).is_err());
    store.delete_draft("draft-1").unwrap();
    let mut changed_profile = profile();
    changed_profile.name = "Updated supplier".into();
    store.save_profile(changed_profile).unwrap();
    drop(store);
    let data = Store::open(&path).unwrap().read().unwrap();
    assert_eq!(data.issued.len(), 1);
    assert_eq!(data.issued[0].snapshot, snapshot);
    assert_eq!(data.issued[0].pdf, b"%PDF-synthetic\n%%EOF");
    assert!(!data.issued[0].paid);
    assert!(data.drafts.is_empty());
    assert_eq!(data.customers[0].next_number, 2);
}

#[test]
fn code_can_change_before_first_issue_and_drafts_survive_profile_changes() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(&directory.path().join("invoice.sqlite")).unwrap();
    store.save_customer(customer()).unwrap();
    let mut updated = customer();
    updated.code = "XYZ".into();
    store.save_customer(updated.clone()).unwrap();
    let mut draft = draft();
    draft.lines[0].tax = Tax::Taxable;
    store.save_draft(draft.clone()).unwrap();
    store.save_profile(profile()).unwrap();
    let data = store.read().unwrap();
    assert_eq!(data.customers, vec![updated]);
    assert_eq!(data.drafts, vec![draft]);
}

#[test]
fn unsupported_schema_is_rejected_without_mutation() {
    for version in [1, 3] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future.sqlite");
        {
            let connection = Connection::open(&path).unwrap();
            connection.execute_batch(&format!("CREATE TABLE unsupported(value TEXT); INSERT INTO unsupported VALUES ('keep'); PRAGMA user_version={version};")).unwrap();
        }
        let before = std::fs::read(&path).unwrap();
        assert!(Store::open(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(!path.with_extension("sqlite-wal").exists());
    }
}

#[test]
fn failed_schema_initialization_rolls_back_every_change() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("conflict.sqlite");
    {
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("CREATE TABLE drafts(value TEXT); INSERT INTO drafts VALUES ('keep');")
            .unwrap();
    }
    assert!(Store::open(&path).is_err());
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row("SELECT value FROM drafts", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "keep"
    );
    let tables: u32 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 1);
}

#[test]
fn relational_and_snapshot_mismatch_is_rejected_on_read() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("invoice.sqlite");
    let mut store = Store::open(&path).unwrap();
    store.save_customer(customer()).unwrap();
    seed_issued(&path);
    Connection::open(&path)
        .unwrap()
        .execute_batch("DROP TRIGGER issued_content_immutable; UPDATE issued SET number='IABC2';")
        .unwrap();
    assert!(store.read().is_err());
}

#[test]
fn issued_schema_enforces_unique_numbers_and_customer_references() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("invoice.sqlite");
    let mut store = Store::open(&path).unwrap();
    store.save_customer(customer()).unwrap();
    seed_issued(&path);
    let before = store.read().unwrap();
    let connection = Connection::open(&path).unwrap();
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .unwrap();
    assert!(connection.execute(
        "INSERT INTO issued(id,customer_id,number,snapshot,pdf,paid) SELECT 'duplicate',customer_id,number,snapshot,pdf,paid FROM issued",
        [],
    ).is_err());
    assert!(connection.execute(
        "INSERT INTO issued(id,customer_id,number,snapshot,pdf,paid) SELECT 'missing-ref','missing','IABC2',snapshot,pdf,paid FROM issued",
        [],
    ).is_err());
    assert!(connection
        .execute("DELETE FROM customers WHERE id=?1", [&customer().id])
        .is_err());
    assert_eq!(store.read().unwrap(), before);
}

#[test]
fn catalogue_read_rejects_a_mismatched_stored_service_identity() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("services.sqlite");
    let mut store = Store::open(&path).unwrap();
    let service = invoice_lib::model::Service {
        id: "service-1".into(),
        name: "Consulting".into(),
        description: "Advice".into(),
        unit_price: "10.00".into(),
        tax: Tax::NoGst,
    };
    store.save_service(service.clone()).unwrap();
    assert_eq!(store.read().unwrap().services, vec![service]);
    Connection::open(&path)
        .unwrap()
        .execute("UPDATE services SET id='MISMATCH'", [])
        .unwrap();
    assert_eq!(store.read().unwrap_err(), "Stored service is inconsistent");
}
