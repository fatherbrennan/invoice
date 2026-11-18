use lopdf::{content::Content, dictionary, Document, Object, ObjectId, Stream};
use std::collections::{BTreeMap, BTreeSet};

// This consumes our genpdf output, whose text codes are the original TrueType glyph IDs.
pub(crate) fn embed(document: &mut Document) -> Result<(), Box<dyn std::error::Error>> {
    let mut used: BTreeMap<ObjectId, BTreeSet<u16>> = BTreeMap::new();
    for page in document.get_pages().values() {
        let fonts = document.get_page_fonts(*page)?;
        let content = Content::decode(&document.get_page_content(*page))?;
        let mut current = None;
        let mut stack = Vec::new();
        for op in content.operations {
            match op.operator.as_str() {
                "q" => stack.push(current),
                "Q" => current = stack.pop().ok_or("Unbalanced PDF graphics state")?,
                "Tf" => {
                    let font = fonts
                        .get(op.operands[0].as_name()?)
                        .ok_or("Missing PDF font")?;
                    current = Some(font.get(b"ToUnicode")?.as_reference()?);
                }
                "Tj" | "TJ" => {
                    let codes = used
                        .entry(current.ok_or("Text without a PDF font")?)
                        .or_default();
                    let operands = if op.operator == "TJ" {
                        op.operands[0].as_array()?
                    } else {
                        &op.operands
                    };
                    for operand in operands {
                        if let Object::String(bytes, _) = operand {
                            if bytes.len() % 2 != 0 {
                                return Err("Invalid two-byte PDF glyph code".into());
                            }
                            codes.extend(
                                bytes
                                    .chunks_exact(2)
                                    .map(|b| u16::from_be_bytes([b[0], b[1]])),
                            );
                        }
                    }
                }
                "Do" => {
                    // Raster logos contain no text; form XObjects still require recursive font tracking.
                    let resources =
                        document.get_dict_in_dict(document.get_dictionary(*page)?, b"Resources")?;
                    let objects = document.get_dict_in_dict(resources, b"XObject")?;
                    let object = objects.get(
                        op.operands
                            .first()
                            .ok_or("Missing XObject name")?
                            .as_name()?,
                    )?;
                    let (_, object) = document.dereference(object)?;
                    if object.as_stream()?.dict.get(b"Subtype")?.as_name()? != b"Image" {
                        return Err("Unsupported form XObject in invoice PDF".into());
                    }
                }
                "'" | "\"" => return Err("Unsupported text or XObject in invoice PDF".into()),
                _ => {}
            }
        }
    }
    let font_ids: Vec<_> = document
        .objects
        .iter()
        .filter_map(|(id, object)| {
            let font = object.as_dict().ok()?;
            (font.get(b"Subtype").ok()?.as_name().ok()? == b"Type0").then_some(*id)
        })
        .collect();
    let mut unused = BTreeSet::new();
    for id in font_ids {
        let mut font = document.get_object(id)?.as_dict()?.clone();
        let cmap_id = font.get(b"ToUnicode")?.as_reference()?;
        let Some(glyphs) = used.get(&cmap_id) else {
            unused.insert(id);
            continue;
        };
        let mut cid = font.get(b"DescendantFonts")?.as_array()?[0]
            .as_dict()?
            .clone();
        let descriptor_id = cid.get(b"FontDescriptor")?.as_reference()?;
        let file_id = document
            .get_object(descriptor_id)?
            .as_dict()?
            .get(b"FontFile2")?
            .as_reference()?;
        let full = document
            .get_object(file_id)?
            .as_stream()?
            .get_plain_content()?;
        let name = if full == include_bytes!("../fonts/IBMPlexSans-Regular.ttf") {
            "PLEXAA+IBMPlexSans-Regular"
        } else if full == include_bytes!("../fonts/IBMPlexSans-SemiBold.ttf") {
            "PLEXAB+IBMPlexSans-SemiBold"
        } else {
            return Err("Unexpected font in new invoice".into());
        };
        let mut remapper = subsetter::GlyphRemapper::new();
        for glyph in glyphs {
            remapper.remap(*glyph);
        }
        let subset = subsetter::subset(&full, 0, &remapper)?;
        document.objects.insert(
            file_id,
            Stream::new(dictionary! { "Length1" => subset.len() as i64 }, subset).into(),
        );

        // Keep text codes, widths and Unicode stable; map only the embedded outline IDs.
        let mut mapping =
            vec![0; (usize::from(*glyphs.last().ok_or("Empty font subset")?) + 1) * 2];
        for glyph in glyphs {
            let offset = usize::from(*glyph) * 2;
            mapping[offset..offset + 2].copy_from_slice(
                &remapper
                    .get(*glyph)
                    .ok_or("Missing subset glyph")?
                    .to_be_bytes(),
            );
        }
        cid.set(
            "CIDToGIDMap",
            document.add_object(Stream::new(dictionary! {}, mapping)),
        );
        let mut widths = Vec::new();
        for range in cid.get(b"W")?.as_array()?.chunks_exact(2) {
            let first = range[0].as_i64()?;
            for (offset, width) in range[1].as_array()?.iter().enumerate() {
                let glyph = u16::try_from(first + offset as i64)?;
                if glyphs.contains(&glyph) {
                    widths.push(Object::Integer(i64::from(glyph)));
                    widths.push(Object::Array(vec![width.clone()]));
                }
            }
        }
        cid.set("W", widths);
        cid.set("BaseFont", Object::Name(name.as_bytes().to_vec()));
        font.set("BaseFont", Object::Name(name.as_bytes().to_vec()));
        font.set("DescendantFonts", vec![Object::Dictionary(cid)]);
        document.objects.insert(id, Object::Dictionary(font));
        document
            .get_object_mut(descriptor_id)?
            .as_dict_mut()?
            .set("FontName", Object::Name(name.as_bytes().to_vec()));

        let source = String::from_utf8(
            document
                .get_object(cmap_id)?
                .as_stream()?
                .get_plain_content()?,
        )?;
        let mut entries = Vec::new();
        let mut in_chars = false;
        for line in source.lines() {
            if line.ends_with("beginbfchar") {
                in_chars = true;
            } else if line == "endbfchar" {
                in_chars = false;
            } else if in_chars {
                let code = line
                    .split_whitespace()
                    .next()
                    .ok_or("Empty Unicode mapping")?;
                let glyph = u16::from_str_radix(code.trim_matches(['<', '>']), 16)?;
                if glyphs.contains(&glyph) {
                    entries.push(line);
                }
            }
        }
        if entries.len() != glyphs.len() {
            return Err("Missing Unicode mapping for subset glyph".into());
        }
        let mut cmap = format!("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /{name}-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n");
        for chunk in entries.chunks(100) {
            cmap.push_str(&format!(
                "{} beginbfchar\n{}\nendbfchar\n",
                chunk.len(),
                chunk.join("\n")
            ));
        }
        cmap.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
        document.objects.insert(
            cmap_id,
            Stream::new(dictionary! {}, cmap.into_bytes()).into(),
        );
    }
    // genpdf registers unused italic faces in its shared font resource dictionary.
    for object in document.objects.values_mut() {
        if let Ok(dict) = object.as_dict_mut() {
            let keys: Vec<_> = dict
                .iter()
                .filter_map(|(key, value)| {
                    value
                        .as_reference()
                        .ok()
                        .filter(|id| unused.contains(id))
                        .map(|_| key.clone())
                })
                .collect();
            for key in keys {
                dict.remove(&key);
            }
        }
    }
    document.prune_objects();
    Ok(())
}
