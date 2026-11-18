mod common;

use common::*;
use invoice_lib::{db::Store, domain, model::*, summary::DateRange, transfer};

// Tax invoice example: https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices
fn line(quantity: &str, price: &str, tax: Tax) -> Line {
    Line {
        service: None,
        description: "Calculation test supply".into(),
        quantity: quantity.into(),
        unit_price: price.into(),
        tax,
    }
}

fn amounts(net: u64, gst: u64, total: u64) -> LineTotal {
    LineTotal { net, gst, total }
}

#[test]
fn ato_tax_invoice_example_two_matches_published_total() {
    let result = domain::calculate(
        &[
            line("50", "150", Tax::Taxable),
            line("10", "40", Tax::Taxable),
        ],
        &fixture().profile,
    )
    .unwrap();
    assert_eq!(
        result,
        Totals {
            lines: vec![
                amounts(750_000, 75_000, 825_000),
                amounts(40_000, 4_000, 44_000)
            ],
            net: 790_000,
            gst: 79_000,
            total: 869_000,
        }
    );
}

#[test]
fn literal_rounding_vectors_cover_both_sides_of_half_cents_and_rounding_order() {
    let profile = fixture().profile;
    for (quantity, price, net, gst, total) in [
        ("1", "0", 0, 0, 0),
        ("1", "0.04", 4, 0, 4),
        ("1", "0.05", 5, 1, 6),
        ("1", "0.06", 6, 1, 7),
        ("1", "0.14", 14, 1, 15),
        ("1", "0.15", 15, 2, 17),
        ("1", "0.16", 16, 2, 18),
        ("0.499", "0.01", 0, 0, 0),
        ("0.500", "0.01", 1, 0, 1),
        ("0.501", "0.01", 1, 0, 1),
        ("1.499", "0.01", 1, 0, 1),
        ("1.500", "0.01", 2, 0, 2),
        ("1.501", "0.01", 2, 0, 2),
        ("1.044", "1", 104, 10, 114),
        ("1.045", "1", 105, 11, 116),
        ("1.046", "1", 105, 11, 116),
        ("2.5", "19.99", 4_998, 500, 5_498),
        ("3", "0.05", 15, 2, 17),
        ("0.001", "1000000", 100_000, 10_000, 110_000),
        ("10000", "0.01", 10_000, 1_000, 11_000),
        ("0001.000", "0000001.00", 100, 10, 110),
    ] {
        let result = domain::calculate(&[line(quantity, price, Tax::Taxable)], &profile)
            .unwrap_or_else(|error| panic!("{quantity} x {price}: {error}"));
        assert_eq!(
            result.lines,
            [amounts(net, gst, total)],
            "{quantity} x {price}"
        );
        assert_eq!((result.net, result.gst, result.total), (net, gst, total));
    }
}

#[test]
fn non_taxable_categories_keep_nonzero_value_without_gst() {
    for tax in [Tax::GstFree, Tax::InputTaxed, Tax::NoGst] {
        let mut profile = fixture().profile;
        profile.gst_registered = tax != Tax::NoGst;
        let result = domain::calculate(&[line("2.5", "19.99", tax.clone())], &profile).unwrap();
        assert_eq!(result.lines, [amounts(4_998, 0, 4_998)], "{tax:?}");
        assert_eq!((result.net, result.gst, result.total), (4_998, 0, 4_998));
    }
}

#[test]
fn separate_supplies_round_individually_and_quantity_is_not_a_supply_count() {
    let profile = fixture().profile;
    for (price, each_gst, each_total, invoice_net, invoice_gst, invoice_total) in [
        ("0.04", 0, 4, 800, 0, 800),
        ("0.05", 1, 6, 1_000, 200, 1_200),
        ("0.06", 1, 7, 1_200, 200, 1_400),
    ] {
        let result =
            domain::calculate(&vec![line("1", price, Tax::Taxable); 200], &profile).unwrap();
        assert_eq!(result.lines.len(), 200);
        for item in &result.lines {
            assert_eq!((item.gst, item.total), (each_gst, each_total));
        }
        assert_eq!(
            (result.net, result.gst, result.total),
            (invoice_net, invoice_gst, invoice_total)
        );
    }
    let separate = domain::calculate(&vec![line("1", "0.05", Tax::Taxable); 2], &profile).unwrap();
    let combined = domain::calculate(&[line("2", "0.05", Tax::Taxable)], &profile).unwrap();
    assert_eq!((separate.net, separate.gst, separate.total), (10, 2, 12));
    assert_eq!((combined.net, combined.gst, combined.total), (10, 1, 11));
}

#[test]
fn every_cent_in_first_hundred_dollars_satisfies_nearest_cent_gst_rule() {
    let profile = fixture().profile;
    for cents in 0..=10_000_u64 {
        let price = format!("{}.{:02}", cents / 100, cents % 100);
        let result = domain::calculate(&[line("1", &price, Tax::Taxable)], &profile).unwrap();
        // Error in tenths of a cent: nearest rounding, with a positive half-cent tie.
        let error = i128::from(result.gst) * 10 - i128::from(cents);
        assert!((-4..=5).contains(&error), "{price}: {result:?}");
        assert_eq!(result.net, cents);
        assert_eq!(result.total, result.net + result.gst);
        assert_eq!(
            result.lines,
            [amounts(result.net, result.gst, result.total)]
        );
    }
}

#[test]
fn fractional_quantity_grid_satisfies_exact_rational_rounding_bounds() {
    let profile = fixture().profile;
    for mills in 1..=2_000_u64 {
        let quantity = format!("{}.{:03}", mills / 1_000, mills % 1_000);
        for cents in [1_u64, 5, 7, 99, 100, 1_999, 100_000_000] {
            let price = format!("{}.{:02}", cents / 100, cents % 100);
            let result =
                domain::calculate(&[line(&quantity, &price, Tax::Taxable)], &profile).unwrap();
            let net_error = i128::from(result.net) * 1_000 - i128::from(mills) * i128::from(cents);
            let gst_error = i128::from(result.gst) * 10 - i128::from(result.net);
            assert!(
                (-499..=500).contains(&net_error),
                "{quantity} x {price}: {result:?}"
            );
            assert!(
                (-4..=5).contains(&gst_error),
                "{quantity} x {price}: {result:?}"
            );
            assert_eq!(result.total, result.net + result.gst);
        }
    }
}

#[test]
fn taxable_total_limit_includes_gst_and_applies_at_every_calculation_entry() {
    let mut f = fixture();
    f.draft.lines = vec![
        line("100", "909090.90", Tax::Taxable),
        line("1", "0.91", Tax::Taxable),
    ];
    let expected = Totals {
        lines: vec![
            amounts(9_090_909_000, 909_090_900, 9_999_999_900),
            amounts(91, 9, 100),
        ],
        net: 9_090_909_091,
        gst: 909_090_909,
        total: 10_000_000_000,
    };
    assert_eq!(
        domain::calculate(&f.draft.lines, &f.profile).unwrap(),
        expected
    );
    domain::validate_saved_draft(&f.draft).unwrap();
    domain::validate_draft(&f.draft).unwrap();
    assert_eq!(
        domain::snapshot(&f.profile, &f.customer, &f.draft, "PREVIEW")
            .unwrap()
            .totals,
        expected
    );
    for lines in [
        vec![
            line("100", "909090.90", Tax::Taxable),
            line("1", "0.92", Tax::Taxable),
        ],
        vec![line("10000", "1000000", Tax::Taxable)],
    ] {
        f.draft.lines = lines;
        for result in [
            domain::calculate(&f.draft.lines, &f.profile).map(|_| ()),
            domain::validate_saved_draft(&f.draft),
            domain::validate_draft(&f.draft),
            domain::snapshot(&f.profile, &f.customer, &f.draft, "PREVIEW").map(|_| ()),
        ] {
            assert_eq!(result.unwrap_err(), "Invoice total exceeds AUD 100,000,000");
        }
    }
}

#[test]
fn rounded_money_survives_preview_issue_pdf_reopen_transfer_and_reporting() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("calculations.sqlite");
    let mut store = setup(&path);
    let mut f = fixture();
    f.draft.lines = vec![
        line("1", "0.05", Tax::Taxable),
        line("1", "0.05", Tax::Taxable),
        line("1.005", "1", Tax::Taxable),
        line("2.5", "19.99", Tax::GstFree),
        line("3", "0.07", Tax::InputTaxed),
    ];
    let expected = Totals {
        lines: vec![
            amounts(5, 1, 6),
            amounts(5, 1, 6),
            amounts(101, 10, 111),
            amounts(4_998, 0, 4_998),
            amounts(21, 0, 21),
        ],
        net: 5_130,
        gst: 12,
        total: 5_142,
    };
    assert_eq!(store.preview_draft(&f.draft).unwrap().totals, expected);
    store.save_draft(f.draft.clone()).unwrap();
    assert_eq!(store.preview(&f.draft.id).unwrap().totals, expected);
    let issued = store.issue(&f.draft.id).unwrap();
    assert_eq!(issued.snapshot.totals, expected);
    let pdf = lopdf::Document::load_mem(&issued.pdf).unwrap();
    let text = pdf
        .extract_text(&pdf.get_pages().keys().copied().collect::<Vec<_>>())
        .unwrap();
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    for amount in ["Subtotal $51.30", "Total GST $0.12", "TOTAL AUD $51.42"] {
        assert!(text.contains(amount), "Missing {amount}: {text}");
    }
    store.set_paid(&f.draft.id, true).unwrap();
    f.profile.gst_registered = false;
    store.save_profile(f.profile).unwrap();
    f.draft.id = "no-gst".into();
    f.draft.lines = vec![line("1", "40", Tax::NoGst)];
    store.save_draft(f.draft).unwrap();
    store.issue("no-gst").unwrap();
    drop(store);
    let mut store = Store::open(&path).unwrap();
    assert_eq!(
        store.issued_snapshot(&issued.id).unwrap().snapshot.totals,
        expected
    );
    assert_eq!(store.issued_pdf(&issued.id).unwrap().1, issued.pdf);
    let data = store.read().unwrap();
    let parsed = transfer::parse(&transfer::encode(&data).unwrap()).unwrap();
    assert_eq!(parsed, data);
    let report = store
        .invoice_summary(&DateRange::default(), "2026-11-18")
        .unwrap();
    assert_eq!(
        (
            report.all.count,
            report.all.amounts.net,
            report.all.amounts.gst,
            report.all.amounts.total
        ),
        (2, 9_130, 12, 9_142)
    );
    assert_eq!(
        (
            report.paid.count,
            report.paid.amounts.net,
            report.paid.amounts.gst,
            report.paid.amounts.total
        ),
        (1, 5_130, 12, 5_142)
    );
    assert_eq!(
        (
            report.unpaid.count,
            report.unpaid.amounts.net,
            report.unpaid.amounts.gst,
            report.unpaid.amounts.total
        ),
        (1, 4_000, 0, 4_000)
    );
    for (bucket, expected) in [
        (report.taxable, (111, 12, 123)),
        (report.gst_free, (4_998, 0, 4_998)),
        (report.input_taxed, (21, 0, 21)),
        (report.no_gst, (4_000, 0, 4_000)),
    ] {
        assert_eq!((bucket.net, bucket.gst, bucket.total), expected);
    }
    // A reconciled but incorrectly rounded import must still be rejected.
    let mut tampered = data;
    let totals = &mut tampered
        .issued
        .iter_mut()
        .find(|item| item.id == issued.id)
        .unwrap()
        .snapshot
        .totals;
    totals.lines[0].gst = 0;
    totals.lines[0].total = 5;
    totals.gst = 11;
    totals.total = 5_141;
    assert_eq!(
        transfer::validate(&tampered).unwrap_err(),
        "Issued invoice snapshot or totals do not match"
    );
    store
        .correct_invoice(&issued.id, "replacement", "Synthetic correction")
        .unwrap();
    let report = store
        .invoice_summary(&DateRange::default(), "2026-11-18")
        .unwrap();
    assert_eq!(
        (
            report.all.count,
            report.all.amounts.net,
            report.all.amounts.gst,
            report.all.amounts.total
        ),
        (1, 4_000, 0, 4_000)
    );
    assert_eq!(report.paid.count, 0);
    assert_eq!(
        store.issued_snapshot(&issued.id).unwrap().snapshot.totals,
        expected
    );
}
