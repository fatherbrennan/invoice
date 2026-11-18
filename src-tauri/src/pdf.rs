use crate::model::Snapshot;
use genpdf::fonts;

pub fn render(snapshot: &Snapshot) -> Result<Vec<u8>, String> {
    if snapshot.template_version != 2 {
        return Err("Unsupported invoice template version".into());
    }
    if snapshot.draft.lines.len() != snapshot.totals.lines.len() {
        return Err("PDF line totals do not match invoice items".into());
    }
    let mut display = snapshot.clone();
    display.profile.abn = crate::format::abn(&snapshot.profile.abn);
    display.customer.abn = crate::format::abn(&snapshot.customer.abn);
    for method in &mut display.profile.payment_methods {
        if let crate::model::PaymentMethod::PayId {
            pay_id_type, value, ..
        } = method
        {
            *value = match pay_id_type {
                crate::model::PayIdType::Abn => crate::format::abn(value),
                crate::model::PayIdType::Mobile => crate::format::mobile(value),
                _ => value.clone(),
            };
        }
    }
    for line in &mut display.draft.lines {
        let cents = crate::domain::decimal(&line.unit_price, 2, 100_000_000, "Unit price")?;
        line.unit_price = format!("{}.{:02}", cents / 100, cents % 100);
        let quantity = crate::domain::decimal(&line.quantity, 3, 10_000_000, "Quantity")?;
        line.quantity = format!("{}.{:03}", quantity / 1000, quantity % 1000)
            .trim_end_matches('0')
            .trim_end_matches('.')
            .into();
    }
    let regular = fonts::FontData::new(
        include_bytes!("../fonts/IBMPlexSans-Regular.ttf").to_vec(),
        None,
    )
    .map_err(|e| e.to_string())?;
    let bold = fonts::FontData::new(
        include_bytes!("../fonts/IBMPlexSans-SemiBold.ttf").to_vec(),
        None,
    )
    .map_err(|e| e.to_string())?;
    let mut document = genpdf::Document::new(fonts::FontFamily {
        regular: regular.clone(),
        bold: bold.clone(),
        italic: regular,
        bold_italic: bold,
    });
    document.set_minimal_conformance();
    document.set_title(format!("{} {}", snapshot.heading, snapshot.number));
    document.set_paper_size(genpdf::Size::new(
        595.28 * 25.4 / 72.0,
        841.89 * 25.4 / 72.0,
    ));
    let pages = crate::pdf_layout::plan(document.font_cache(), &display)?;
    document.push(pages);
    let mut bytes = Vec::new();
    document
        .render(&mut bytes)
        .map_err(|e| format!("Cannot render PDF: {e}"))?;
    finish(&bytes)
}

fn finish(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut document = lopdf::Document::load_mem(bytes).map_err(|e| e.to_string())?;
    // genpdf does not expose stroke width; the table uses half-point rules.
    for id in document.get_pages().values() {
        let mut content = lopdf::content::Content::decode(&document.get_page_content(*id))
            .map_err(|e| e.to_string())?;
        content
            .operations
            .insert(0, lopdf::content::Operation::new("w", vec![0.5.into()]));
        document
            .change_page_content(*id, content.encode().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    // printpdf 0.3 writes Unicode scalars instead of UTF-16 for supplementary glyphs.
    let maps: Vec<_> = document
        .objects
        .values()
        .filter_map(|object| {
            object
                .as_dict()
                .ok()?
                .get(b"ToUnicode")
                .ok()?
                .as_reference()
                .ok()
        })
        .collect();
    for id in maps {
        let stream = document
            .get_object_mut(id)
            .map_err(|e| e.to_string())?
            .as_stream_mut()
            .map_err(|e| e.to_string())?;
        let source = String::from_utf8(stream.get_plain_content().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let mut mapped = String::new();
        for line in source.lines() {
            let parts: Vec<_> = line.split_whitespace().collect();
            if parts.len() == 2 && parts.iter().all(|s| s.starts_with('<') && s.ends_with('>')) {
                if let Ok(code) = u32::from_str_radix(parts[1].trim_matches(['<', '>']), 16) {
                    // Normalize shared space/hyphen glyphs for predictable text extraction.
                    let code = match code {
                        0x00a0 => 0x20,
                        0x2011 => 0x2d,
                        other => other,
                    };
                    if let Some(c) = char::from_u32(code) {
                        let utf16: String = c
                            .encode_utf16(&mut [0; 2])
                            .iter()
                            .map(|v| format!("{v:04x}"))
                            .collect();
                        mapped.push_str(&format!("{} <{utf16}>\n", parts[0]));
                        continue;
                    }
                }
            }
            mapped.push_str(line);
            mapped.push('\n');
        }
        stream.set_plain_content(mapped.into_bytes());
    }
    crate::pdf_subset::embed(&mut document).map_err(|e| format!("Cannot subset PDF fonts: {e}"))?;
    document.compress();
    let mut result = Vec::new();
    document
        .save_modern(&mut result)
        .map_err(|e| e.to_string())?;
    Ok(result)
}
