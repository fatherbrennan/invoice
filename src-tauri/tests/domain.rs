use invoice_lib::{
    domain,
    model::{Customer, Draft, Line, Profile, Tax},
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    profile: Profile,
    customer: Customer,
    draft: Draft,
    expected: Expected,
}

#[derive(Deserialize)]
struct Expected {
    net: u64,
    gst: u64,
    total: u64,
}

fn fixture() -> Fixture {
    serde_json::from_str(include_str!("../../tests/fixtures/invoices.json")).unwrap()
}

fn line(quantity: &str, unit_price: &str, tax: Tax) -> Line {
    Line {
        service: None,
        description: "Synthetic service".into(),
        quantity: quantity.into(),
        unit_price: unit_price.into(),
        tax,
    }
}

#[test]
fn independent_mixed_fixture_and_snapshot_are_preserved() {
    let f = fixture();
    let snapshot = domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").unwrap();
    assert_eq!(
        (
            snapshot.totals.net,
            snapshot.totals.gst,
            snapshot.totals.total
        ),
        (f.expected.net, f.expected.gst, f.expected.total)
    );
    assert_eq!(snapshot.totals.lines[0].total, 11_000);
    assert_eq!(snapshot.totals.lines[1].total, 2_000);
    assert_eq!(snapshot.profile, f.profile);
    assert_eq!(snapshot.customer, f.customer);
    assert_eq!(snapshot.draft, f.draft);
    assert_eq!(snapshot.number, "IABC1");
    assert_eq!(snapshot.heading, "TAX INVOICE");
}

#[test]
fn half_up_rounds_extended_net_then_gst_and_keeps_duplicate_lines() {
    let profile = fixture().profile;
    for (lines, expected) in [
        (vec![line("1", "0.05", Tax::Taxable)], (5, 1, 6)),
        (vec![line("1", "0.05", Tax::Taxable); 2], (10, 2, 12)),
        (vec![line("1.005", "1.00", Tax::Taxable)], (101, 10, 111)),
        (vec![line("0.005", "1", Tax::Taxable)], (1, 0, 1)),
        (vec![line("0.004", "1", Tax::Taxable)], (0, 0, 0)),
        (vec![line("1", "0.04", Tax::Taxable)], (4, 0, 4)),
        (vec![line("1.049", "1", Tax::Taxable)], (105, 11, 116)),
    ] {
        let totals = domain::calculate(&lines, &profile).unwrap();
        assert_eq!(
            (totals.net, totals.gst, totals.total),
            expected,
            "{lines:?}"
        );
        assert_eq!(totals.lines.len(), lines.len());
    }
}

#[test]
fn zero_prices_and_fractional_quantities_are_valid() {
    let profile = fixture().profile;
    let totals = domain::calculate(
        &[
            line("10000", "0", Tax::Taxable),
            line("0.001", "1000", Tax::GstFree),
        ],
        &profile,
    )
    .unwrap();
    assert_eq!((totals.net, totals.gst, totals.total), (100, 0, 100));
    assert_eq!(totals.lines[0].total, 0);
}

#[test]
fn display_setting_never_changes_money_or_heading() {
    let mut f = fixture();
    let shown = domain::snapshot(&f.profile, &f.customer, &f.draft, "PREVIEW").unwrap();
    f.profile.show_item_gst = false;
    let hidden = domain::snapshot(&f.profile, &f.customer, &f.draft, "PREVIEW").unwrap();
    assert_eq!(shown.totals, hidden.totals);
    assert_eq!(shown.heading, hidden.heading);
}

#[test]
fn heading_and_registration_matrix() {
    let mut f = fixture();
    for (registered, taxes, heading) in [
        (false, vec![Tax::NoGst], "INVOICE"),
        (true, vec![Tax::GstFree], "INVOICE"),
        (true, vec![Tax::InputTaxed], "INVOICE"),
        (true, vec![Tax::GstFree, Tax::InputTaxed], "INVOICE"),
        (true, vec![Tax::Taxable], "TAX INVOICE"),
        (true, vec![Tax::Taxable, Tax::GstFree], "TAX INVOICE"),
    ] {
        f.profile.gst_registered = registered;
        f.draft.lines = taxes.into_iter().map(|tax| line("1", "0", tax)).collect();
        for show in [false, true] {
            f.profile.show_item_gst = show;
            let snapshot = domain::snapshot(&f.profile, &f.customer, &f.draft, "PREVIEW").unwrap();
            assert_eq!(snapshot.heading, heading);
            assert_eq!(snapshot.totals.total, 0);
        }
    }
    for (registered, tax) in [
        (false, Tax::Taxable),
        (false, Tax::GstFree),
        (false, Tax::InputTaxed),
        (true, Tax::NoGst),
    ] {
        f.profile.gst_registered = registered;
        assert!(domain::calculate(&[line("1", "1", tax)], &f.profile).is_err());
    }
}

#[test]
fn buyer_identity_is_required_below_and_at_one_thousand_dollars() {
    let mut f = fixture();
    for price in ["909.08", "909.09"] {
        f.draft.lines = vec![line("1", price, Tax::Taxable)];
        f.customer.name = "Example buyer".into();
        let snapshot = domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").unwrap();
        assert_eq!(
            snapshot.totals.total,
            if price == "909.08" { 99_999 } else { 100_000 }
        );
        f.customer.name.clear();
        assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").is_err());
        f.customer.abn = "51824753556".into();
        assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").is_ok());
        f.customer.abn.clear();
    }
}

#[test]
fn decimal_input_is_strict_and_bounded() {
    let profile = fixture().profile;
    for quantity in [
        "",
        "0",
        "0.000",
        "-1",
        "+1",
        " 1",
        "1 ",
        ".5",
        "1.",
        "1.0000",
        "1e2",
        "NaN",
        "１",
        "1..0",
        "10000.001",
        "18446744073709551616",
    ] {
        assert!(
            domain::calculate(&[line(quantity, "1", Tax::Taxable)], &profile).is_err(),
            "quantity {quantity}"
        );
    }
    for price in [
        "",
        "-0",
        "-1",
        "+1",
        " 1",
        "1 ",
        ".5",
        "1.",
        "1.001",
        "1e2",
        "Infinity",
        "１",
        "1..0",
        "1000000.01",
        "18446744073709551616",
    ] {
        assert!(
            domain::calculate(&[line("1", price, Tax::Taxable)], &profile).is_err(),
            "price {price}"
        );
    }
    assert!(domain::calculate(&[line("1.000", "1000000.00", Tax::Taxable)], &profile).is_ok());
}

#[test]
fn invoice_total_and_line_count_limits_apply_to_drafts_and_calculations() {
    let mut f = fixture();
    f.draft.lines = vec![line("100", "1000000", Tax::GstFree)];
    assert_eq!(
        domain::calculate(&f.draft.lines, &f.profile).unwrap().total,
        10_000_000_000
    );
    assert!(domain::validate_draft(&f.draft).is_ok());
    f.draft.lines[0].quantity = "100.001".into();
    assert!(domain::calculate(&f.draft.lines, &f.profile).is_err());
    assert!(domain::validate_draft(&f.draft).is_err());
    f.draft.lines = vec![line("100", "1000000", Tax::Taxable)];
    assert!(domain::calculate(&f.draft.lines, &f.profile).is_err());
    f.draft.lines = vec![line("1", "0", Tax::Taxable); 200];
    assert!(domain::validate_draft(&f.draft).is_ok());
    f.draft.lines.push(line("1", "0", Tax::Taxable));
    assert!(domain::validate_draft(&f.draft).is_err());
    assert!(domain::calculate(&f.draft.lines, &f.profile).is_err());
    f.draft.lines.clear();
    assert!(domain::validate_draft(&f.draft).is_err());
    assert!(domain::calculate(&f.draft.lines, &f.profile).is_err());
}

#[test]
fn gregorian_dates_include_century_leap_rules() {
    let mut draft = fixture().draft;
    for value in [
        "1900-01-01",
        "2000-02-29",
        "2024-02-29",
        "2026-11-15",
        "9999-12-31",
    ] {
        draft.date = value.into();
        assert!(domain::validate_draft(&draft).is_ok(), "{value}");
    }
    for value in [
        "",
        "1899-12-31",
        "10000-01-01",
        "1900-02-29",
        "2100-02-29",
        "2026-02-29",
        "2026-04-31",
        "2026-00-01",
        "2026-13-01",
        "2026-01-00",
        "2026-1-01",
        "2026/01/01",
        "２０２６-01-01",
        "2026-01-01T00:00:00",
    ] {
        draft.date = value.into();
        assert!(domain::validate_draft(&draft).is_err(), "{value}");
    }
}

#[test]
fn abn_checksum_is_required_when_supplied_and_for_registered_suppliers() {
    let mut f = fixture();
    assert!(domain::validate_profile(&f.profile).is_ok());
    for value in [
        "",
        "51824753557",
        "00000000000",
        "51 824 753 556",
        "5182475355x",
        "5182475355",
    ] {
        f.profile.abn = value.into();
        assert!(domain::validate_profile(&f.profile).is_err(), "{value}");
    }
    f.profile.gst_registered = false;
    f.profile.abn.clear();
    assert!(domain::validate_profile(&f.profile).is_ok());
    f.customer.abn = "51824753557".into();
    assert!(domain::validate_customer(&f.customer).is_err());
    f.customer.abn = "51824753556".into();
    f.customer.name.clear();
    assert!(domain::validate_customer(&f.customer).is_ok());
}

#[test]
fn ids_codes_and_final_numbers_are_canonical_and_linked() {
    let mut f = fixture();
    for value in ["", "has space", "a_b", "ü", "../a", &"a".repeat(65)] {
        assert!(domain::validate_id(value).is_err(), "{value}");
        f.draft.id = value.into();
        assert!(domain::validate_draft(&f.draft).is_err());
    }
    f.draft.id = "Draft-A09".into();
    assert!(domain::validate_draft(&f.draft).is_ok());
    for code in ["", "abc", "A1", "A-B", "Ä", "ABCDEFGHIJKLM"] {
        f.customer.code = code.into();
        assert!(domain::validate_customer(&f.customer).is_err(), "{code}");
    }
    f.customer.code = "ABC".into();
    for number in [
        "",
        "IABC0",
        "IABC01",
        "IABC+1",
        "IABC-1",
        "IABC1 ",
        "IABC1.0",
        "IXYZ1",
        "IABC4294967296",
        "IABC2",
    ] {
        assert!(
            domain::snapshot(&f.profile, &f.customer, &f.draft, number).is_err(),
            "{number}"
        );
    }
    assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "PREVIEW").is_ok());
    f.customer.next_number = u32::MAX;
    assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC4294967295").is_ok());
    f.customer.next_number = 0;
    assert!(domain::validate_customer(&f.customer).is_err());
    f.customer.next_number = 1;
    f.draft.customer_id = "other".into();
    assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").is_err());
}

#[test]
fn text_limits_count_characters_and_reject_missing_or_control_text() {
    let mut f = fixture();
    f.profile.name = "名".repeat(200);
    f.profile.address = "a".repeat(1000);
    f.profile.payment_details = "a".repeat(4000);
    assert!(domain::validate_profile(&f.profile).is_ok());
    f.profile.name.push('名');
    assert!(domain::validate_profile(&f.profile).is_err());
    f.profile = fixture().profile;
    f.profile.name = " \t".into();
    assert!(domain::validate_profile(&f.profile).is_err());
    f.profile = fixture().profile;
    f.profile.address.clear();
    assert!(domain::validate_profile(&f.profile).is_err());
    f.draft.notes = "a".repeat(4000);
    f.draft.lines[0].description = "名".repeat(2000);
    assert!(domain::validate_draft(&f.draft).is_ok());
    f.draft.lines[0].description.push('名');
    assert!(domain::validate_draft(&f.draft).is_err());
    for description in ["", "  \n", "bad\0text", "bad\u{7f}text"] {
        f.draft.lines[0].description = description.into();
        assert!(domain::validate_draft(&f.draft).is_err());
    }
    f.draft.lines[0].description = "Line one\nLine two\r\n\tIndented".into();
    assert!(domain::validate_draft(&f.draft).is_ok());
    f.draft.notes.push('a');
    assert!(domain::validate_draft(&f.draft).is_err());
}

#[test]
fn native_json_rejects_unknown_fields_numbers_and_unknown_tax_modes() {
    let f = fixture();
    let mut value = serde_json::to_value(f.draft).unwrap();
    value["extra"] = true.into();
    assert!(serde_json::from_value::<Draft>(value.clone()).is_err());
    value.as_object_mut().unwrap().remove("extra");
    value["lines"][0]["quantity"] = 1.into();
    assert!(serde_json::from_value::<Draft>(value.clone()).is_err());
    value["lines"][0]["quantity"] = "1".into();
    value["lines"][0]["tax"] = "specialScheme".into();
    assert!(serde_json::from_value::<Draft>(value).is_err());
}
#[test]
fn due_dates_use_calendar_months_exact_dates_or_no_date() {
    use invoice_lib::model::{DueDate, DueUnit};
    let relative = |amount, unit| DueDate::Relative { amount, unit };
    for (start, amount, unit, expected) in [
        ("2026-01-31", 1, DueUnit::Months, "2026-02-28"),
        ("2028-01-31", 1, DueUnit::Months, "2028-02-29"),
        ("2026-12-31", 1, DueUnit::Months, "2027-01-31"),
        ("2028-02-29", 12, DueUnit::Months, "2029-02-28"),
        ("2026-01-31", 30, DueUnit::Days, "2026-03-02"),
        ("2028-02-28", 1, DueUnit::Days, "2028-02-29"),
        ("2026-11-16", 0, DueUnit::Days, "2026-11-16"),
    ] {
        assert_eq!(
            domain::due_date(start, &relative(amount, unit))
                .unwrap()
                .as_deref(),
            Some(expected)
        );
    }
    assert_eq!(
        domain::due_date("2026-11-16", &DueDate::None).unwrap(),
        None
    );
    assert_eq!(
        domain::due_date(
            "2026-11-16",
            &DueDate::Exact {
                date: "2027-02-03".into()
            }
        )
        .unwrap()
        .as_deref(),
        Some("2027-02-03")
    );
    for invalid in ["2026-02-29", "2026-13-01", "", "1899-12-31"] {
        assert!(domain::due_date(
            "2026-11-16",
            &DueDate::Exact {
                date: invalid.into()
            }
        )
        .is_err());
    }
    for unit in [DueUnit::Days, DueUnit::Months] {
        assert!(domain::due_date("9999-12-31", &relative(1, unit.clone())).is_err());
        assert!(domain::due_date("2026-11-16", &relative(10000, unit)).is_err());
    }
}

#[test]
fn optional_fields_are_validated_and_absent_terms_have_no_due_date() {
    use invoice_lib::model::{DueDate, PaymentMethod};
    let mut f = fixture();
    assert_eq!(f.draft.due, DueDate::None);
    assert_eq!(
        domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1")
            .unwrap()
            .due_date,
        None
    );
    f.draft.reference = "PO-123".into();
    f.customer.attention = "Accounts team".into();
    f.profile.payment_methods = vec![PaymentMethod::Custom {
        label: "Bank transfer".into(),
        value: "BSB: 000-000\nAccount: 123456".into(),
    }];
    assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").is_ok());
    f.draft.reference = "x".repeat(201);
    assert!(domain::validate_draft(&f.draft).is_err());
    f.customer.attention = "not\nmultiline".into();
    assert!(domain::validate_customer(&f.customer).is_err());
    if let PaymentMethod::Custom { value, .. } = &mut f.profile.payment_methods[0] {
        value.clear();
    }
    assert!(domain::validate_profile(&f.profile).is_err());
    if let PaymentMethod::Custom { value, .. } = &mut f.profile.payment_methods[0] {
        *value = "123456".into();
    }
    f.profile.payment_methods = vec![f.profile.payment_methods[0].clone(); 11];
    assert!(domain::validate_profile(&f.profile).is_err());
}

#[test]
fn structured_payments_validate_all_types_and_require_invoice_bpay_reference() {
    use invoice_lib::model::PaymentMethod;
    use serde_json::json;
    let mut f = fixture();
    let valid = vec![
        json!({"type":"bankTransfer","accountName":"Supplier","bsb":"012-345","accountNumber":"001234567"}),
        json!({"type":"payId","payIdType":"email","value":"billing@example.test","recipientName":"Supplier"}),
        json!({"type":"payId","payIdType":"mobile","value":"+61412345678","recipientName":""}),
        json!({"type":"payId","payIdType":"abn","value":"51824753556","recipientName":""}),
        json!({"type":"payId","payIdType":"organisationId","value":"supplier-123","recipientName":""}),
        json!({"type":"bpay","billerCode":"012345"}),
        json!({"type":"custom","label":"Other","value":"First line\nSecond line"}),
    ];
    f.profile.payment_methods = valid
        .iter()
        .map(|m| serde_json::from_value(m.clone()).unwrap())
        .collect();
    assert!(domain::validate_profile(&f.profile).is_ok());
    assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").is_err());
    for invalid in [
        "",
        "1",
        "123456789012345678901",
        "12 34",
        "\u{ff11}\u{ff12}",
    ] {
        f.draft.bpay_reference = invalid.into();
        assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").is_err());
    }
    f.draft.bpay_reference = "00012345678901234567".into();
    let snapshot = domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").unwrap();
    assert_eq!(snapshot.draft.bpay_reference, "00012345678901234567");
    f.profile
        .payment_methods
        .push(f.profile.payment_methods[5].clone());
    assert!(domain::validate_profile(&f.profile).is_err());
    for (index, field, value) in [
        (0, "accountName", " "),
        (0, "bsb", "01-2345"),
        (0, "accountNumber", "12345678901"),
        (1, "value", "a@@b.test"),
        (1, "value", "bad@example"),
        (2, "value", "04123"),
        (3, "value", "51824753557"),
        (4, "value", " "),
        (5, "billerCode", "12 34"),
        (6, "label", ""),
    ] {
        let mut method = valid[index].clone();
        method[field] = json!(value);
        f.profile.payment_methods = vec![serde_json::from_value(method).unwrap()];
        assert!(
            domain::validate_profile(&f.profile).is_err(),
            "{index} {field} {value}"
        );
    }
    for value in [
        json!({"label":"Old","value":"format"}),
        json!({"type":"bpay","billerCode":"123","extra":true}),
        json!({"type":"unknown"}),
    ] {
        assert!(serde_json::from_value::<PaymentMethod>(value).is_err());
    }
    f.profile.payment_methods.clear();
    assert!(domain::snapshot(&f.profile, &f.customer, &f.draft, "IABC1").is_err());
}
