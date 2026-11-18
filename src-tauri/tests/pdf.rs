use invoice_lib::{model::*, pdf};

fn mixed() -> Snapshot {
    Snapshot {
        due_date: None,
        template_version: 2,
        number: "IABC1".into(),
        heading: "TAX INVOICE".into(),
        profile: Profile {
            name: "Synthetic Supplier Pty Ltd".into(),
            abn: "51824753556".into(),
            address: "1 Example Street\nAdelaide SA 5000".into(),
            payment_details: "Synthetic Bank\nReference: IABC1".into(),
            payment_methods: vec![],
            gst_registered: true,
            show_item_gst: true,
        },
        customer: Customer {
            id: "customer-abc".into(),
            code: "ABC".into(),
            name: "Example Buyer".into(),
            abn: "53004085616".into(),
            address: "2 Test Road\nMelbourne VIC 3000".into(),
            attention: String::new(),
            next_number: 1,
        },
        draft: Draft {
            id: "draft-1".into(),
            customer_id: "customer-abc".into(),
            reference: String::new(),
            bpay_reference: String::new(),
            due: Default::default(),
            date: "2026-11-15".into(),
            notes: "Thank you for your business.".into(),
            lines: vec![
                Line {
                    service: None,
                    description: "Consulting service".into(),
                    quantity: "1".into(),
                    unit_price: "100.00".into(),
                    tax: Tax::Taxable,
                },
                Line {
                    service: None,
                    description: "GST-free supply".into(),
                    quantity: "2".into(),
                    unit_price: "10.00".into(),
                    tax: Tax::GstFree,
                },
            ],
        },
        totals: Totals {
            lines: vec![
                LineTotal {
                    net: 10000,
                    gst: 1000,
                    total: 11000,
                },
                LineTotal {
                    net: 2000,
                    gst: 0,
                    total: 2000,
                },
            ],
            net: 12000,
            gst: 1000,
            total: 13000,
        },
    }
}

fn contents(snapshot: &Snapshot) -> (lopdf::Document, String) {
    let bytes = pdf::render(snapshot).expect("render synthetic invoice");
    assert!(bytes.starts_with(b"%PDF-"));
    let document = lopdf::Document::load_mem(&bytes).expect("parse rendered PDF");
    let pages: Vec<_> = document.get_pages().keys().copied().collect();
    let text = document
        .extract_text(&pages)
        .expect("extract PDF text")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (document, text)
}

// Read public PDF text and its page coordinates, independently of the layout planner.
fn positioned(doc: &lopdf::Document, page: u32) -> Vec<(String, f32, f32, f32)> {
    let id = doc.get_pages()[&page];
    let fonts = doc.get_page_fonts(id).unwrap();
    let content = lopdf::content::Content::decode(&doc.get_page_content(id)).unwrap();
    let (mut x, mut y, mut size) = (0.0, 0.0, 0.0);
    let mut font = Vec::new();
    let mut result = Vec::new();
    for op in content.operations {
        match op.operator.as_str() {
            "Td" => {
                x = op.operands[0].as_float().unwrap();
                y = op.operands[1].as_float().unwrap();
            }
            "Tf" => {
                font = op.operands[0].as_name().unwrap().to_vec();
                size = op.operands[1].as_float().unwrap();
            }
            "TJ" | "Tj" => {
                let encoding = fonts[font.as_slice()].get_font_encoding(doc).unwrap();
                let values = if op.operator == "TJ" {
                    op.operands[0].as_array().unwrap()
                } else {
                    &op.operands
                };
                let text = values
                    .iter()
                    .filter_map(|v| v.as_str().ok())
                    .map(|v| lopdf::Document::decode_text(&encoding, v).unwrap())
                    .collect::<String>();
                result.push((text, x, y, size));
            }
            _ => {}
        }
    }
    result
}

#[test]
fn bottom_payment_position_is_independent_of_notes_and_pages() {
    let mut s = mixed();
    let (short, _) = contents(&s);
    let expected = positioned(&short, 1)
        .into_iter()
        .find(|p| p.0 == "PAYMENT DETAILS")
        .unwrap()
        .2;
    assert!(expected < 180.0, "Payments belong at the page bottom");
    s.draft.notes = "Long note with preserved content. ".repeat(100);
    let (long, text) = contents(&s);
    let last = long.get_pages().len() as u32;
    let actual = positioned(&long, last)
        .into_iter()
        .find(|p| p.0 == "PAYMENT DETAILS")
        .unwrap()
        .2;
    assert!((actual - expected).abs() < 0.01);
    assert_eq!(
        text.matches("Long note with preserved content.").count(),
        100
    );
    assert_eq!(text.matches("PAYMENT DETAILS").count(), 1);
}

#[test]
fn many_items_repeat_headings_keep_rows_whole_and_do_not_gain_numbers() {
    let mut s = mixed();
    s.draft.lines = (0..32)
        .map(|i| Line {
            description: format!("Service {}", (b'A' + i as u8) as char),
            ..s.draft.lines[0].clone()
        })
        .collect();
    s = invoice_lib::domain::snapshot(&s.profile, &s.customer, &s.draft, "IABC1").unwrap();
    let (doc, text) = contents(&s);
    assert_eq!(doc.get_pages().len(), 2);
    assert_eq!(
        text.matches("Description Qty Unit ex GST Tax rate GST Total")
            .count(),
        2
    );
    assert_eq!(text.matches("TOTAL AUD").count(), 1);
    assert_eq!(text.matches("PAYMENT DETAILS").count(), 1);
    assert!(text.contains("TOTAL AUD $3,520.00"));
    assert!(!text.contains("Item 1"));
    for line in &s.draft.lines {
        assert_eq!(text.matches(&line.description).count(), 1);
    }
    let last = doc.extract_text(&[2]).unwrap();
    assert!(last.contains("PAYMENT DETAILS"));
}

#[test]
fn oversized_payment_instructions_are_preserved_in_bottom_anchored_sections() {
    let mut s = mixed();
    s.profile.payment_details.clear();
    s.profile.payment_methods = (0..10)
        .map(|i| PaymentMethod::Custom {
            label: format!("Method {i}"),
            value: format!("{} END-METHOD-{i}", "Payment detail ".repeat(65)),
        })
        .collect();
    let (doc, text) = contents(&s);
    assert!(doc.get_pages().len() > 2);
    for i in 0..10 {
        assert_eq!(text.matches(&format!("END-METHOD-{i}")).count(), 1);
    }
    for page in doc.get_pages().keys() {
        let positions = positioned(&doc, *page);
        for heading in positions.iter().filter(|p| p.0.starts_with("Method ")) {
            assert!(
                positions.iter().any(|p| p.0.starts_with("Payment detail")
                    && (p.1 - heading.1).abs() < 0.1
                    && p.2 < heading.2
                    && p.2 > heading.2 - 55.0),
                "Payment heading must stay with its instructions"
            );
        }
        for (_, x, y, size) in positions {
            assert!(x >= 0.0 && x < 595.3);
            assert!(y - 0.275 * size >= 0.0 && y + 1.025 * size <= 841.9);
        }
    }
}

#[test]
fn mixed_length_payment_columns_split_independently_without_blank_pages() {
    let mut s = mixed();
    s.profile.payment_details.clear();
    s.profile.payment_methods = vec![
        PaymentMethod::BankTransfer {
            account_name: "Example Supplier".into(),
            bsb: "012345".into(),
            account_number: "001234567".into(),
        },
        PaymentMethod::PayId {
            pay_id_type: PayIdType::Email,
            value: "billing@example.test".into(),
            recipient_name: "Example Supplier".into(),
        },
        PaymentMethod::Bpay {
            biller_code: "012345".into(),
        },
        PaymentMethod::Custom {
            label: "Other arrangements".into(),
            value: "Contact accounts before paying.\nQuote the invoice number.".into(),
        },
    ];
    s.draft.bpay_reference = "00012345678901234567".into();
    s.profile
        .payment_methods
        .extend((0..6).map(|i| PaymentMethod::Custom {
            label: format!("Additional payment method {i}"),
            value: format!(
                "{} END-PAYMENT-{i}",
                "Long payment instructions. ".repeat(35)
            ),
        }));
    let (doc, text) = contents(&s);
    assert!(doc.get_pages().len() <= 4);
    for i in 0..6 {
        assert_eq!(text.matches(&format!("END-PAYMENT-{i}")).count(), 1);
    }
    for page in doc.get_pages().keys().skip(1) {
        let text = doc.extract_text(&[*page]).unwrap();
        assert!(text.contains("PAYMENT DETAILS"));
        assert!(text.contains("Long payment instructions."));
    }
}

#[test]
fn supported_maximum_amounts_and_two_hundred_items_remain_readable() {
    let mut s = mixed();
    s.draft.lines.truncate(1);
    s.draft.lines[0].quantity = "100".into();
    s.draft.lines[0].unit_price = "1000000.00".into();
    s.draft.lines[0].tax = Tax::GstFree;
    s = invoice_lib::domain::snapshot(&s.profile, &s.customer, &s.draft, "IABC1").unwrap();
    let (doc, text) = contents(&s);
    assert!(text.contains("$100,000,000.00"));
    let amounts: Vec<_> = positioned(&doc, 1)
        .into_iter()
        .filter(|p| p.0 == "$100,000,000.00")
        .collect();
    assert_eq!(amounts.len(), 3); // Line total, subtotal and invoice total.
    assert!(amounts.iter().all(|p| p.1 > 410.0 && p.3 >= 7.0));
    s.draft.lines = vec![
        Line {
            description: "Repeated service".into(),
            quantity: "1".into(),
            unit_price: "0.05".into(),
            tax: Tax::Taxable,
            service: None
        };
        200
    ];
    s = invoice_lib::domain::snapshot(&s.profile, &s.customer, &s.draft, "IABC1").unwrap();
    let (doc, text) = contents(&s);
    assert_eq!(text.matches("Repeated service").count(), 200);
    assert!(text.contains("Total GST $2.00"));
    assert!(text.contains("TOTAL AUD $12.00"));
    assert!(doc.get_pages().len() < 12);
}

#[test]
fn eight_and_thirty_two_item_examples_fit_one_and_two_pages() {
    let mut s = mixed();
    s.profile.name = "Example Studio".into();
    s.profile.address = "1 Sample Street, Adelaide SA 5000".into();
    s.profile.payment_details.clear();
    s.customer.name = "Example ABC".into();
    s.customer.abn.clear();
    s.customer.address = "2 Sample Street".into();
    s.customer.attention = "Accounts payable".into();
    s.draft.reference = "PO-2026-42".into();
    s.draft.notes = "Synthetic fixture".into();
    s.draft.bpay_reference = "00012345678901234567".into();
    s.profile.payment_methods = vec![
        PaymentMethod::BankTransfer {
            account_name: "Example Supplier".into(),
            bsb: "012345".into(),
            account_number: "001234567".into(),
        },
        PaymentMethod::PayId {
            pay_id_type: PayIdType::Email,
            value: "billing@example.test".into(),
            recipient_name: "Example Supplier".into(),
        },
        PaymentMethod::Bpay {
            biller_code: "012345".into(),
        },
        PaymentMethod::Custom {
            label: "Other arrangements".into(),
            value: "Contact accounts before paying.\nQuote the invoice number.".into(),
        },
    ];
    let descriptions = [
        "Consulting",
        "Design review",
        "Document preparation",
        "Project coordination",
        "Implementation review and follow-up recommendations",
        "GST-free supply",
        "Research and analysis",
        "Client workshop",
    ];
    for (count, pages) in [(8, 1), (32, 2)] {
        s.draft.lines = (0..count)
            .map(|i| Line {
                description: descriptions[i % 8].into(),
                quantity: "1".into(),
                unit_price: "100.00".into(),
                tax: Tax::Taxable,
                service: None,
            })
            .collect();
        s = invoice_lib::domain::snapshot(&s.profile, &s.customer, &s.draft, "IABC1").unwrap();
        let (doc, text) = contents(&s);
        assert_eq!(doc.get_pages().len(), pages);
        assert_eq!(text.matches("PAYMENT DETAILS").count(), 1);
        assert!(doc
            .extract_text(&[pages as u32])
            .unwrap()
            .contains("PAYMENT DETAILS"));
    }
}

#[test]
fn layout_places_notes_before_bottom_payments_without_item_numbers() {
    let mut snapshot = mixed();
    snapshot.draft.lines[0].description = "Long unnumbered description ".repeat(12);
    let (_, text) = contents(&snapshot);
    assert!(text.contains("BILL TO"));
    assert!(text.contains("Tax rate"));
    assert!(text.find("ADDITIONAL NOTES").unwrap() < text.find("PAYMENT DETAILS").unwrap());
    assert!(!text.contains("Item 1"));
}

#[test]
fn new_pdf_formats_identifiers_and_short_prices_without_changing_source_values() {
    let mut source = mixed();
    source.profile.payment_methods = vec![
        PaymentMethod::PayId {
            pay_id_type: PayIdType::Abn,
            value: "51824753556".into(),
            recipient_name: String::new(),
        },
        PaymentMethod::PayId {
            pay_id_type: PayIdType::Mobile,
            value: "+61412345678".into(),
            recipient_name: String::new(),
        },
    ];
    source.draft.lines[0].unit_price = "1.7".into();
    source.draft.lines[0].quantity = "001.700".into();
    let snapshot =
        invoice_lib::domain::snapshot(&source.profile, &source.customer, &source.draft, "IABC1")
            .unwrap();
    let (_, text) = contents(&snapshot);
    for expected in [
        "ABN: 51 824 753 556",
        "ABN: 53 004 085 616",
        "+61 412 345 678",
        "$1.70",
    ] {
        assert!(text.contains(expected), "Missing {expected}: {text}");
    }
    assert!(!text.contains("51824753556"));
    assert!(text.contains("Consulting service 1.7 $1.70"));
    assert_eq!(snapshot.profile.abn, "51824753556");
    assert_eq!(snapshot.draft.lines[0].unit_price, "1.7");
    assert_eq!(snapshot.draft.lines[0].quantity, "001.700");
}

#[test]
fn pdf_uses_compressed_objects_and_cross_references() {
    let (document, _) = contents(&mixed());
    for kind in ["ObjStm", "XRef"] {
        assert!(
            document
                .objects
                .values()
                .any(|o| o.type_name().is_ok_and(|t| t == kind.as_bytes())),
            "Missing compressed {kind}"
        );
    }
}

#[test]
fn unsupported_template_versions_are_rejected() {
    for version in [0, 1, 3, 9, 255] {
        let mut snapshot = mixed();
        snapshot.template_version = version;
        assert!(pdf::render(&snapshot).unwrap_err().contains("Unsupported"));
    }
}

#[test]
fn new_invoices_embed_small_named_plex_subsets_with_searchable_unicode() {
    let mut snapshot = mixed();
    snapshot = invoice_lib::domain::snapshot(
        &snapshot.profile,
        &snapshot.customer,
        &snapshot.draft,
        "IABC1",
    )
    .unwrap();
    snapshot.customer.name = "Café André — Müller £ €".into();
    snapshot.draft.notes = "Résumé: naïve façade, Ångström; 0123456789 + − / % & @".into();
    let bytes = pdf::render(&snapshot).unwrap();
    assert!(
        bytes.len() < 60_000,
        "A short invoice should stay below 60 KB: {}",
        bytes.len()
    );
    let (document, text) = contents(&snapshot);
    assert!(text.contains(&snapshot.customer.name), "{text}");
    assert!(text.contains(&snapshot.draft.notes), "{text}");
    let mut names = Vec::new();
    for object in document.objects.values() {
        let Ok(descriptor) = object.as_dict() else {
            continue;
        };
        let Ok(file) = descriptor.get(b"FontFile2") else {
            continue;
        };
        let name = String::from_utf8_lossy(descriptor.get(b"FontName").unwrap().as_name().unwrap())
            .into_owned();
        assert!(name[..6].bytes().all(|b| b.is_ascii_uppercase()));
        assert!(name[6..].starts_with("+IBMPlexSans-"), "{name}");
        let font = document
            .get_object(file.as_reference().unwrap())
            .unwrap()
            .as_stream()
            .unwrap()
            .get_plain_content()
            .unwrap();
        assert!(
            font.len() < 35_000,
            "Only used glyphs should be embedded: {}",
            font.len()
        );
        names.push(name[7..].to_owned());
    }
    names.sort();
    assert_eq!(names, ["IBMPlexSans-Regular", "IBMPlexSans-SemiBold"]);
}

#[test]
fn compact_rows_align_six_columns_and_use_fine_rules_without_shading() {
    let (document, _) = contents(&mixed());
    let positions = positioned(&document, 1);
    let row = positions
        .iter()
        .find(|p| p.0 == "Consulting service")
        .unwrap();
    let cells: Vec<_> = positions
        .iter()
        .filter(|p| (p.2 - row.2).abs() < 0.05 && p.3 == 10.0)
        .collect();
    assert_eq!(cells.len(), 6);
    let next = positions.iter().find(|p| p.0 == "GST-free supply").unwrap();
    assert!((row.2 - next.2 - 24.0).abs() < 0.05);
    for id in document.get_pages().values() {
        let content = lopdf::content::Content::decode(&document.get_page_content(*id)).unwrap();
        assert!(
            !content.operations.iter().any(|op| op.operator == "f"),
            "No shaded rows"
        );
        assert!(content
            .operations
            .iter()
            .any(|op| op.operator == "w" && op.operands[0].as_float().unwrap() == 0.5));
        for op in content
            .operations
            .iter()
            .filter(|op| matches!(op.operator.as_str(), "rg" | "RG"))
        {
            assert_eq!(op.operands[0], op.operands[1]);
            assert_eq!(op.operands[1], op.operands[2]);
        }
    }
}

#[test]
fn invoice_composition_matches_approved_header_items_notes_and_payments() {
    let (document, text) = contents(&mixed());
    assert_eq!(document.get_pages().len(), 1);
    let labels = [
        "TAX INVOICE",
        "Invoice number",
        "BILL TO",
        "Description",
        "Subtotal",
        "ADDITIONAL NOTES",
        "PAYMENT DETAILS",
    ];
    let positions: Vec<_> = labels
        .iter()
        .map(|label| text.find(label).unwrap())
        .collect();
    assert!(positions.windows(2).all(|p| p[0] < p[1]));
    let positions = positioned(&document, 1);
    let title = positions.iter().find(|p| p.0 == "TAX INVOICE").unwrap();
    assert_eq!(title.3, 32.0);
    assert!(!text.contains("Item 1"));
}

#[test]
fn required_details_and_supplied_mixed_totals_are_printed() {
    let (_, text) = contents(&mixed());
    for expected in [
        "TAX INVOICE",
        "IABC1",
        "15/11/2026",
        "Synthetic Supplier Pty Ltd",
        "51 824 753 556",
        "1 Example Street",
        "Adelaide SA 5000",
        "Example Buyer",
        "53 004 085 616",
        "2 Test Road",
        "Melbourne VIC 3000",
        "Consulting service",
        "GST-free supply",
        "10%",
        "GST-free",
        "Qty",
        "Unit ex GST",
        "$100.00",
        "$110.00",
        "$20.00",
        "Subtotal $120.00",
        "Total GST $10.00",
        "TOTAL AUD $130.00",
        "PAYMENT DETAILS",
        "Synthetic Bank",
        "Reference: IABC1",
        "Thank you for your business.",
    ] {
        assert!(text.contains(expected), "missing {expected:?} in {text:?}");
    }
    assert!(!text.contains("No GST charged"));
}

#[test]
fn item_gst_display_does_not_change_heading_classification_or_totals() {
    let mut snapshot = mixed();
    let (_, shown) = contents(&snapshot);
    snapshot.profile.show_item_gst = false;
    let (_, hidden) = contents(&snapshot);
    assert_eq!(
        shown.matches("$10.00").count(),
        hidden.matches("$10.00").count() + 1
    );
    for expected in [
        "TAX INVOICE",
        "10%",
        "GST-free",
        "Total GST $10.00",
        "TOTAL AUD $130.00",
    ] {
        assert!(hidden.contains(expected), "missing {expected}");
    }
}

#[test]
fn nil_gst_and_zero_taxable_gst_preserve_snapshot_heading() {
    let mut snapshot = mixed();
    snapshot.draft.lines.truncate(1);
    snapshot.draft.lines[0].unit_price = "0.01".into();
    snapshot.totals = Totals {
        lines: vec![LineTotal {
            net: 1,
            gst: 0,
            total: 1,
        }],
        net: 1,
        gst: 0,
        total: 1,
    };
    let (_, registered) = contents(&snapshot);
    assert!(registered.contains("TAX INVOICE"));
    assert!(registered.contains("No GST charged"));
    assert!(registered.contains("TOTAL AUD $0.01"));
    snapshot.heading = "INVOICE".into();
    snapshot.profile.gst_registered = false;
    snapshot.profile.abn.clear();
    snapshot.draft.lines[0].tax = Tax::NoGst;
    let (_, unregistered) = contents(&snapshot);
    assert!(!unregistered.contains("TAX INVOICE"));
    assert!(unregistered.contains("No GST"));
    assert!(unregistered.contains("No GST charged"));
    assert!(unregistered.contains("$0.00"));
}

#[test]
fn registered_all_nontaxable_invoice_has_nil_gst_and_classifications() {
    let mut snapshot = mixed();
    snapshot.heading = "INVOICE".into();
    snapshot.draft.lines[0].tax = Tax::InputTaxed;
    snapshot.totals.lines[0] = LineTotal {
        net: 10000,
        gst: 0,
        total: 10000,
    };
    snapshot.totals.gst = 0;
    snapshot.totals.total = 12000;
    let (_, text) = contents(&snapshot);
    for expected in [
        "INVOICE",
        "Input taxed",
        "GST-free",
        "Total GST $0.00",
        "No GST charged",
        "TOTAL AUD $120.00",
    ] {
        assert!(text.contains(expected), "missing {expected}");
    }
    assert!(!text.contains("TAX INVOICE"));
}

#[test]
fn preview_is_clearly_unissued_and_input_taxed_classification_is_visible() {
    let mut snapshot = mixed();
    snapshot.number = "PREVIEW".into();
    snapshot.draft.lines[1].tax = Tax::InputTaxed;
    let (_, text) = contents(&snapshot);
    assert!(text.contains("DRAFT PREVIEW - not issued"));
    assert!(!text.contains("Invoice number:"));
    assert!(text.contains("Input taxed"));
}

#[test]
fn long_descriptions_unbroken_tokens_and_notes_survive_multiple_pages() {
    let mut snapshot = mixed();
    snapshot.profile.name = "Café André — Synthetic Supplier".into();
    snapshot.draft.lines[0].description = "Z".repeat(2000);
    for index in 1..8 {
        let mut line = snapshot.draft.lines[1].clone();
        line.description = format!(
            "Start item {index} {} End item {index}",
            "long description ".repeat(110)
        );
        snapshot.draft.lines.push(line);
        snapshot.totals.lines.push(LineTotal {
            net: 2000,
            gst: 0,
            total: 2000,
        });
    }
    snapshot.totals.net = 26000;
    snapshot.totals.total = 27000;
    snapshot.draft.notes = format!("{} END OF NOTES", "N".repeat(3987));
    let (document, text) = contents(&snapshot);
    assert!(document.get_pages().len() >= 4);
    assert_eq!(text.matches('Z').count(), 2000, "unbroken token was lost");
    assert!(text.contains("Café André — Synthetic Supplier"));
    for index in 1..8 {
        assert!(text.contains(&format!("End item {index}")));
    }
    assert!(text.contains("END OF NOTES"));
    assert!(text.contains("TOTAL AUD $270.00"));
    let last_page = *document.get_pages().keys().last().unwrap();
    assert!(document
        .extract_text(&[last_page])
        .unwrap()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .contains(&format!("IABC1 · {last_page} of {last_page}")));
}

#[test]
fn unsupported_glyph_and_missing_line_totals_fail_visibly() {
    let mut snapshot = mixed();
    snapshot.draft.lines[0].description = "Unsupported 漢".into();
    assert!(pdf::render(&snapshot).unwrap_err().contains("U+6F22"));
    snapshot = mixed();
    snapshot.totals.lines.pop();
    assert!(pdf::render(&snapshot).unwrap_err().contains("line totals"));
}

#[test]
fn long_descriptions_remain_in_the_table_without_numbered_item_sections() {
    let mut snapshot = mixed();
    snapshot.draft.lines = (1..=8)
        .map(|n| Line {
            service: None,
            description: format!(
                "Line {n}: {} END-OF-LINE-{n}",
                "Detailed synthetic service description with deliverables and supporting notes. "
                    .repeat(12)
            ),
            quantity: "1".into(),
            unit_price: "100.00".into(),
            tax: Tax::Taxable,
        })
        .collect();
    snapshot.totals = Totals {
        lines: vec![
            LineTotal {
                net: 10000,
                gst: 1000,
                total: 11000
            };
            8
        ],
        net: 80000,
        gst: 8000,
        total: 88000,
    };
    let (document, text) = contents(&snapshot);
    for n in 1..=8 {
        assert!(text.contains(&format!("END-OF-LINE-{n}")));
    }
    for n in 1..=8 {
        let matching: Vec<_> = document
            .get_pages()
            .keys()
            .copied()
            .filter(|page| {
                document
                    .extract_text(&[*page])
                    .unwrap()
                    .contains(&format!("END-OF-LINE-{n}"))
            })
            .collect();
        assert_eq!(matching.len(), 1);
        assert!(document
            .extract_text(&[matching[0]])
            .unwrap()
            .contains(&format!("Line {n}:")));
    }
    assert!(!text.contains("Item 1"));
    assert!(text.contains("TOTAL AUD $880.00"));
}
#[test]
fn optional_fields_print_when_present_and_disappear_when_empty() {
    let mut snapshot = mixed();
    snapshot.due_date = Some("2027-01-15".into());
    snapshot.draft.reference = "PO-12345".into();
    snapshot.customer.attention = "Accounts team".into();
    snapshot.profile.payment_methods = vec![
        PaymentMethod::Custom {
            label: "PayID".into(),
            value: "billing@example.test".into(),
        },
        PaymentMethod::Custom {
            label: "Bank transfer".into(),
            value: "BSB: 000-000\nAccount: 123456".into(),
        },
    ];
    let (_, text) = contents(&snapshot);
    for expected in [
        "Due date 15/01/2027",
        "Reference / P.O. PO-12345",
        "Attention: Accounts team",
        "PAYMENT DETAILS",
        "PayID",
        "billing@example.test",
        "Bank transfer",
        "BSB: 000-000",
        "Account: 123456",
    ] {
        assert!(text.contains(expected), "Missing {expected:?} in {text:?}");
    }
    snapshot.due_date = None;
    snapshot.draft.reference.clear();
    snapshot.customer.attention.clear();
    snapshot.profile.payment_methods.clear();
    snapshot.profile.payment_details.clear();
    let (_, text) = contents(&snapshot);
    for absent in [
        "Due date",
        "Reference / P.O.",
        "Attention:",
        "PAYMENT DETAILS",
    ] {
        assert!(!text.contains(absent));
    }
}

#[test]
fn structured_payment_pdf_contains_all_fields_and_bpay_logo() {
    let mut s = mixed();
    s.profile.payment_methods = vec![
        PaymentMethod::BankTransfer {
            account_name: "Supplier".into(),
            bsb: "012345".into(),
            account_number: "001234567".into(),
        },
        PaymentMethod::PayId {
            pay_id_type: PayIdType::Mobile,
            value: "+61412345678".into(),
            recipient_name: "Supplier".into(),
        },
        PaymentMethod::Bpay {
            biller_code: "012345".into(),
        },
        PaymentMethod::Custom {
            label: "Other".into(),
            value: "First line\nSecond line".into(),
        },
    ];
    s.draft.bpay_reference = "00012345678901234567".into();
    let (doc, text) = contents(&s);
    for expected in [
        "Account name Supplier",
        "BSB: 012-345",
        "Account: 001234567",
        "PayID",
        "+61 412 345 678",
        "Name: Supplier",
        "BPAY",
        "Biller code: 012345",
        "00012345678901234567",
        "First line",
        "Second line",
    ] {
        assert!(text.contains(expected), "Missing {expected} in {text}");
    }
    assert!(doc
        .objects
        .values()
        .any(|o| o.as_stream().is_ok_and(|stream| stream
            .dict
            .get(b"Subtype")
            .is_ok_and(|v| v.as_name().ok() == Some(b"Image")))));
}
