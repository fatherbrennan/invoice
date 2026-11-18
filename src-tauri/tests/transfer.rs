mod common;
use common::*;
use invoice_lib::{db::Store, model::Dataset, transfer};
use std::fs;
use std::io::{Cursor, Read, Write};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

#[test]
fn plain_json_is_not_an_export() {
    let json = serde_json::to_vec(&Dataset::default()).unwrap();
    assert!(transfer::parse(&json).is_err());
}

fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zip.start_file(
            *name,
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

#[test]
fn zip_import_restores_original_pdf_and_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let mut source = setup(&directory.path().join("source.sqlite"));
    source.issue("draft-1").unwrap();
    source.set_paid("draft-1", true).unwrap();
    let original = source.read().unwrap();
    let mut manifest = serde_json::to_value(&original).unwrap();
    manifest["version"] = 3.into();
    manifest["issued"][0]["pdf"] = "pdfs/draft-1.pdf".into();
    let bytes = archive(&[
        ("data.json", &serde_json::to_vec(&manifest).unwrap()),
        ("pdfs/draft-1.pdf", &original.issued[0].pdf),
    ]);
    assert_eq!(transfer::parse(&bytes).unwrap(), original);
}

#[test]
fn zip_export_contains_portable_json_and_exact_pdf_files() {
    let directory = tempfile::tempdir().unwrap();
    let mut source = setup(&directory.path().join("source.sqlite"));
    source.issue("draft-1").unwrap();
    source.set_paid("draft-1", true).unwrap();
    source
        .correct_invoice("draft-1", "correction", "Correct the reference")
        .unwrap();
    source.issue("correction").unwrap();
    let original = source.read().unwrap();
    let bytes = transfer::encode(&original).unwrap();
    let mut zip = ZipArchive::new(Cursor::new(&bytes)).unwrap();
    assert_eq!(zip.len(), original.issued.len() + 1);
    let manifest: serde_json::Value =
        serde_json::from_reader(zip.by_name("data.json").unwrap()).unwrap();
    assert_eq!(manifest["version"], 3);
    for (index, invoice) in original.issued.iter().enumerate() {
        let path = format!("pdfs/{}.pdf", invoice.id);
        assert_eq!(manifest["issued"][index]["pdf"], path);
        let mut pdf = Vec::new();
        zip.by_name(&path).unwrap().read_to_end(&mut pdf).unwrap();
        assert_eq!(pdf, invoice.pdf);
    }
    assert_eq!(transfer::parse(&bytes).unwrap(), original);

    let recovery = source
        .replace(
            &Dataset::default(),
            &original,
            &directory.path().join("recovery"),
        )
        .unwrap();
    assert_eq!(recovery.extension().unwrap(), "zip");
    let recovered = transfer::parse(&fs::read(recovery).unwrap()).unwrap();
    assert_eq!(recovered, original);
    source
        .replace(
            &recovered,
            &source.read().unwrap(),
            &directory.path().join("recovery"),
        )
        .unwrap();
    assert_eq!(source.read().unwrap(), original);
    assert_eq!(
        transfer::parse(&transfer::encode(&Dataset::default()).unwrap()).unwrap(),
        Dataset::default()
    );
}

#[test]
fn malformed_zip_exports_are_rejected_before_restore() {
    let directory = tempfile::tempdir().unwrap();
    let mut source = setup(&directory.path().join("source.sqlite"));
    source.issue("draft-1").unwrap();
    let original = source.read().unwrap();
    let mut manifest = serde_json::to_value(&original).unwrap();
    manifest["version"] = 3.into();
    manifest["issued"][0]["pdf"] = "pdfs/draft-1.pdf".into();
    let json = serde_json::to_vec(&manifest).unwrap();
    let pdf = &original.issued[0].pdf;
    let good = archive(&[("data.json", &json), ("pdfs/draft-1.pdf", pdf)]);
    let mut invalids = vec![
        archive(&[("data.json", &json)]),
        archive(&[("pdfs/draft-1.pdf", pdf)]),
        archive(&[("data.json", b"{"), ("pdfs/draft-1.pdf", pdf)]),
        archive(&[("data.json", &json), ("pdfs/draft-1.pdf", b"%PDF-corrupt")]),
        archive(&[
            ("data.json", &json),
            ("pdfs/draft-1.pdf", pdf),
            ("../outside", b"bad"),
        ]),
        good[..good.len() / 2].to_vec(),
    ];
    for path in [
        "../outside.pdf",
        "C:/outside.pdf",
        "pdfs\\draft-1.pdf",
        "pdfs/other.pdf",
    ] {
        let mut changed = manifest.clone();
        changed["issued"][0]["pdf"] = path.into();
        invalids.push(archive(&[
            ("data.json", &serde_json::to_vec(&changed).unwrap()),
            ("pdfs/draft-1.pdf", pdf),
        ]));
    }
    for version in [2, 99] {
        let mut changed = manifest.clone();
        changed["version"] = version.into();
        invalids.push(archive(&[
            ("data.json", &serde_json::to_vec(&changed).unwrap()),
            ("pdfs/draft-1.pdf", pdf),
        ]));
    }
    let mut wrong = original.issued[0].snapshot.clone();
    wrong.draft.notes = "A different invoice".into();
    invalids.push(archive(&[
        ("data.json", &json),
        (
            "pdfs/draft-1.pdf",
            &invoice_lib::pdf::render(&wrong).unwrap(),
        ),
    ]));
    let mut wrong = manifest.clone();
    wrong["issued"][0]["snapshot"]["totals"]["total"] = 1.into();
    invalids.push(archive(&[
        ("data.json", &serde_json::to_vec(&wrong).unwrap()),
        ("pdfs/draft-1.pdf", pdf),
    ]));
    // Rename equal-length entries in both ZIP headers to create an ambiguous duplicate.
    let mut duplicate = archive(&[
        ("data.json", &json),
        ("copy.json", &json),
        ("pdfs/draft-1.pdf", pdf),
    ]);
    for index in 0..duplicate.len() - 8 {
        if &duplicate[index..index + 9] == b"copy.json" {
            duplicate[index..index + 9].copy_from_slice(b"data.json");
        }
    }
    invalids.push(duplicate);
    for (index, bytes) in invalids.iter().enumerate() {
        assert!(
            transfer::parse(bytes).is_err(),
            "Accepted invalid ZIP case {index}"
        );
    }
    assert_eq!(source.read().unwrap(), original);
}

#[test]
fn zip_size_limits_apply_to_expanded_contents() {
    let oversized = vec![0; 16 * 1024 * 1024 + 1];
    let bytes = archive(&[("pdfs/oversized.pdf", &oversized)]);
    assert!(bytes.len() < 100_000);
    assert!(transfer::parse(&bytes).unwrap_err().contains("size limit"));

    // Claim a huge manifest in the central directory without allocating it.
    let mut bytes = archive(&[("data.json", b"{}")]);
    let header = bytes.windows(4).position(|w| w == b"PK\x01\x02").unwrap();
    bytes[header + 24..header + 28]
        .copy_from_slice(&((transfer::MAX_EXPORT_BYTES + 1) as u32).to_le_bytes());
    assert!(transfer::parse(&bytes).unwrap_err().contains("size limit"));
}

#[test]
fn portable_roundtrip_keeps_pdf_paid_draft_and_customer_sequences() {
    let directory = tempfile::tempdir().unwrap();
    let mut source = setup(&directory.path().join("source.sqlite"));
    source
        .save_service(invoice_lib::model::Service {
            id: "svc".into(),
            name: "Consulting".into(),
            description: "Advice".into(),
            unit_price: "100.00".into(),
            tax: invoice_lib::model::Tax::Taxable,
        })
        .unwrap();
    let first = source.issue("draft-1").unwrap();
    source.set_paid("draft-1", true).unwrap();
    let mut draft = fixture().draft;
    draft.id = "draft-2".into();
    source.save_draft(draft.clone()).unwrap();
    let mut xyz = fixture().customer;
    xyz.id = "xyz".into();
    xyz.code = "XYZ".into();
    xyz.name = "Example XYZ".into();
    source.save_customer(xyz).unwrap();
    let original = source.read().unwrap();
    let bytes = transfer::encode(&original).unwrap();
    let parsed = transfer::parse(&bytes).unwrap();
    assert_eq!(parsed, original);
    let path = directory.path().join("restored.sqlite");
    let mut target = Store::open(&path).unwrap();
    let previous = target.read().unwrap();
    let recovery = target
        .replace(&parsed, &previous, &directory.path().join("recovery"))
        .unwrap();
    assert_eq!(
        transfer::parse(&fs::read(recovery).unwrap()).unwrap(),
        previous
    );
    drop(target);
    let mut target = Store::open(&path).unwrap();
    assert_eq!(target.read().unwrap(), original);
    assert_eq!(target.read().unwrap().issued[0].pdf, first.pdf);
    assert_eq!(target.issue("draft-2").unwrap().snapshot.number, "IABC2");
    draft.id = "xyz-draft".into();
    draft.customer_id = "xyz".into();
    target.save_draft(draft).unwrap();
    assert_eq!(target.issue("xyz-draft").unwrap().snapshot.number, "IXYZ1");
}

#[test]
fn invalid_imports_and_backup_failure_never_replace_data() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = setup(&directory.path().join("app.sqlite"));
    store.issue("draft-1").unwrap();
    let before = store.read().unwrap();
    let mut invalids = Vec::new();
    let mut bad = before.clone();
    bad.customers.push(bad.customers[0].clone());
    invalids.push(bad);
    let mut bad = before.clone();
    bad.customers.clear();
    invalids.push(bad);
    let mut bad = before.clone();
    bad.customers[0].next_number = 1;
    invalids.push(bad);
    let mut bad = before.clone();
    bad.issued[0].snapshot.totals.total += 1;
    invalids.push(bad);
    let mut bad = before.clone();
    bad.issued[0].pdf = b"%PDF-corrupt".to_vec();
    invalids.push(bad);
    for candidate in invalids {
        assert!(store
            .replace(&candidate, &before, &directory.path().join("recovery"))
            .is_err());
        assert_eq!(store.read().unwrap(), before);
    }
    assert!(transfer::parse(b"not a ZIP").is_err());
    let blocked = directory.path().join("blocked");
    fs::write(&blocked, b"sentinel").unwrap();
    assert!(store
        .replace(&Dataset::default(), &before, &blocked)
        .is_err());
    assert_eq!(store.read().unwrap(), before);
    assert_eq!(fs::read(blocked).unwrap(), b"sentinel");
}

#[test]
fn replacement_sql_failure_rolls_back_and_stale_confirmation_is_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let mut store = setup(&path);
    let before = store.read().unwrap();
    let control = rusqlite::Connection::open(&path).unwrap();
    control.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON customers BEGIN SELECT RAISE(ABORT,'synthetic import failure'); END;").unwrap();
    assert!(store
        .replace(&before, &before, &directory.path().join("recovery"))
        .unwrap_err()
        .contains("synthetic import failure"));
    assert_eq!(store.read().unwrap(), before);
    let recovered = fs::read_dir(directory.path().join("recovery"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        transfer::parse(&fs::read(recovered).unwrap()).unwrap(),
        before
    );
    control.execute_batch("DROP TRIGGER fail_import;").unwrap();
    let mut profile = fixture().profile;
    profile.name = "Edited while reviewing import".into();
    store.save_profile(profile).unwrap();
    let updated = store.read().unwrap();
    assert!(store
        .replace(
            &Dataset::default(),
            &before,
            &directory.path().join("recovery")
        )
        .unwrap_err()
        .contains("changed since confirmation"));
    assert_eq!(store.read().unwrap(), updated);
}

#[test]
fn atomic_export_preserves_existing_file_when_destination_cannot_be_replaced() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("export.json");
    transfer::write_atomic(&target, b"old data").unwrap();
    transfer::write_atomic(&target, b"new data").unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"new data");
    assert!(transfer::write_atomic(directory.path(), b"bad destination").is_err());
    assert_eq!(fs::read(target).unwrap(), b"new data");
}

#[test]
fn valid_but_wrong_pdf_and_incomplete_history_are_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = setup(&directory.path().join("app.sqlite"));
    store.issue("draft-1").unwrap();
    let good = store.read().unwrap();
    let mut bad = good.clone();
    let mut different = bad.issued[0].snapshot.clone();
    different.draft.notes = "This belongs to a different invoice".into();
    bad.issued[0].pdf = invoice_lib::pdf::render(&different).unwrap();
    assert!(transfer::validate(&bad)
        .unwrap_err()
        .contains("does not match"));
    let mut bad = good.clone();
    bad.profile = None;
    assert!(transfer::validate(&bad).is_err());
    let mut bad = good.clone();
    bad.customers[0].next_number = 3;
    assert!(transfer::validate(&bad).unwrap_err().contains("incomplete"));
    assert_eq!(store.read().unwrap(), good);
}

#[test]
fn imported_pdf_rejects_nested_and_stream_active_content() {
    use lopdf::{dictionary, Object, Stream};
    let directory = tempfile::tempdir().unwrap();
    let mut store = setup(&directory.path().join("app.sqlite"));
    store.issue("draft-1").unwrap();
    let good = store.read().unwrap();
    let payloads = [
        Object::Dictionary(dictionary! { "Nested" => Object::Array(vec![
            Object::Dictionary(dictionary! { "JS" => Object::string_literal("app.alert('test')") })
        ]) }),
        Object::Stream(Stream::new(
            dictionary! { "EmbeddedFiles" => Object::Null },
            vec![],
        )),
        Object::Dictionary(dictionary! { "S" => Object::Name(b"Launch".to_vec()) }),
    ];
    for (payload, compressed) in payloads
        .iter()
        .flat_map(|payload| [(payload, false), (payload, true)])
    {
        let mut bad = good.clone();
        let mut pdf = lopdf::Document::load_mem(&bad.issued[0].pdf).unwrap();
        pdf.add_object(payload.clone());
        bad.issued[0].pdf.clear();
        if compressed {
            pdf.save_modern(&mut bad.issued[0].pdf).unwrap();
        } else {
            pdf.save_to(&mut bad.issued[0].pdf).unwrap();
        }
        let error = transfer::validate(&bad).expect_err("Active PDF content must be rejected");
        assert!(error.contains("Active content"), "{error}");
    }
    assert_eq!(store.read().unwrap(), good);
}

#[test]
fn export_preserves_pdf_and_numbering_and_requires_a_supported_template() {
    let directory = tempfile::tempdir().unwrap();
    let mut source = setup(&directory.path().join("source.sqlite"));
    source.issue("draft-1").unwrap();
    let original = source.read().unwrap();
    let bytes = transfer::encode(&original).unwrap();
    let mut zip = ZipArchive::new(Cursor::new(&bytes)).unwrap();
    let mut json: serde_json::Value =
        serde_json::from_reader(zip.by_name("data.json").unwrap()).unwrap();
    let pack = |manifest: &serde_json::Value| {
        archive(&[
            ("data.json", &serde_json::to_vec(manifest).unwrap()),
            ("pdfs/draft-1.pdf", &original.issued[0].pdf),
        ])
    };
    let restored = transfer::parse(&bytes).unwrap();
    assert_eq!(restored.issued[0].snapshot.template_version, 2);
    assert_eq!(restored, original);
    let mut target = Store::open(&directory.path().join("new.sqlite")).unwrap();
    target
        .replace(
            &restored,
            &target.read().unwrap(),
            &directory.path().join("recovery"),
        )
        .unwrap();
    assert_eq!(target.read().unwrap(), original);
    let mut next = fixture().draft;
    next.id = "new-draft".into();
    target.save_draft(next).unwrap();
    let issued = target.issue("new-draft").unwrap();
    assert_eq!(issued.snapshot.number, "IABC2");
    assert_eq!(issued.snapshot.template_version, 2);
    json["issued"][0]["snapshot"]
        .as_object_mut()
        .unwrap()
        .remove("templateVersion");
    assert!(transfer::parse(&pack(&json)).is_err());
    json["issued"][0]["snapshot"]["templateVersion"] = 99.into();
    assert!(transfer::parse(&pack(&json)).is_err());
}

#[test]
fn unsupported_template_is_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = setup(&directory.path().join("source.sqlite"));
    store.issue("draft-1").unwrap();
    let mut data = store.read().unwrap();
    data.issued[0].snapshot.template_version = 1;
    assert!(transfer::validate(&data).unwrap_err().contains("snapshot"));
}

#[test]
fn invoice_fields_survive_issue_profile_changes_and_export_restore() {
    use invoice_lib::model::{DueDate, DueUnit, PaymentMethod};
    let directory = tempfile::tempdir().unwrap();
    let mut source = setup(&directory.path().join("source.sqlite"));
    let mut f = fixture();
    f.profile.payment_methods = vec![
        PaymentMethod::Custom {
            label: "Other".into(),
            value: "First line\nSecond line".into(),
        },
        PaymentMethod::BankTransfer {
            account_name: "Supplier".into(),
            bsb: "012345".into(),
            account_number: "001234567".into(),
        },
        PaymentMethod::PayId {
            pay_id_type: invoice_lib::model::PayIdType::Email,
            value: "billing@example.test".into(),
            recipient_name: "Supplier".into(),
        },
        PaymentMethod::Bpay {
            biller_code: "012345".into(),
        },
    ];
    f.draft.bpay_reference = "00012345678901234567".into();
    f.customer.attention = "Accounts payable".into();
    f.draft.reference = "PO-2026-42".into();
    f.draft.date = "2026-01-31".into();
    f.draft.due = DueDate::Relative {
        amount: 1,
        unit: DueUnit::Months,
    };
    source.save_profile(f.profile.clone()).unwrap();
    source.save_customer(f.customer.clone()).unwrap();
    source.save_draft(f.draft.clone()).unwrap();
    assert_eq!(source.draft(&f.draft.id).unwrap(), f.draft);
    let issued = source.issue(&f.draft.id).unwrap();
    assert_eq!(issued.snapshot.due_date.as_deref(), Some("2026-02-28"));
    assert_eq!(issued.snapshot.draft.bpay_reference, "00012345678901234567");
    if let PaymentMethod::Custom { value, .. } = &mut f.profile.payment_methods[0] {
        *value = "changed@example.test".into();
    }
    f.customer.attention = "Changed contact".into();
    source.save_profile(f.profile).unwrap();
    source.save_customer(f.customer).unwrap();
    let original = source.read().unwrap();
    assert_eq!(original.issued[0], issued);
    let restored = transfer::parse(&transfer::encode(&original).unwrap()).unwrap();
    let mut target = Store::open(&directory.path().join("target.sqlite")).unwrap();
    target
        .replace(
            &restored,
            &target.read().unwrap(),
            &directory.path().join("recovery"),
        )
        .unwrap();
    assert_eq!(target.read().unwrap(), original);
}
