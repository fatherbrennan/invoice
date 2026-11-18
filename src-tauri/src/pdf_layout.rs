use crate::model::{PaymentMethod, Snapshot, Tax};
use genpdf::{
    fonts::FontCache,
    style::{Color, Style},
    Element,
};
use std::collections::VecDeque;

const MM: f64 = 25.4 / 72.0;
const LEFT: f64 = 38.0;
const RIGHT: f64 = 557.0;
const BOTTOM: f64 = 776.0;
const BODY: f64 = 748.0;

fn style(size: u8, bold: bool, grey: u8) -> Style {
    let s = Style::new()
        .with_font_size(size)
        .with_color(Color::Rgb(grey, grey, grey));
    if bold {
        s.bold()
    } else {
        s
    }
}
fn normal() -> Style {
    style(10, false, 20)
}
fn label() -> Style {
    style(9, true, 84)
}
fn width(cache: &FontCache, text: &str, style: Style) -> f64 {
    f64::from(style.str_width(cache, text)) / MM
}
pub(crate) fn money(cents: u64) -> String {
    let digits = (cents / 100).to_string();
    let mut result = String::from("$");
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            result.push(',');
        }
        result.push(c);
    }
    format!("{result}.{:02}", cents % 100)
}
fn date(value: &str) -> String {
    if value.len() == 10 && value.is_ascii() {
        format!("{}/{}/{}", &value[8..10], &value[5..7], &value[..4])
    } else {
        value.into()
    }
}

// Measure with the same font metrics used to draw; split unbroken tokens without losing glyphs.
fn wrap(cache: &FontCache, value: &str, s: Style, max: f64) -> Result<Vec<String>, String> {
    let value = value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\t', "    ");
    let font = cache.get_rt_font(s.font(cache));
    for c in value.chars().filter(|c| *c != '\n') {
        if c.is_control() || font.glyph(c).id().0 == 0 {
            return Err(format!(
                "PDF font cannot display character U+{:04X}; replace it before issuing",
                c as u32
            ));
        }
    }
    let mut lines = Vec::new();
    for source in value.split('\n') {
        let mut line = String::new();
        for c in source.chars() {
            line.push(c);
            if width(cache, &line, s) > max {
                line.pop();
                if line.is_empty() {
                    return Err("PDF column is too narrow for this character".into());
                }
                if let Some(space) = line.rfind(' ') {
                    let rest = line.split_off(space + 1);
                    lines.push(line.trim_end().into());
                    line = rest;
                } else {
                    lines.push(std::mem::take(&mut line));
                }
                if c != ' ' || !line.is_empty() {
                    line.push(c);
                }
            }
        }
        lines.push(line);
    }
    Ok(lines)
}

#[derive(Clone)]
enum Draw {
    Text {
        x: f64,
        y: f64,
        value: String,
        style: Style,
    },
    Rule {
        x: f64,
        y: f64,
        width: f64,
    },
    Logo {
        x: f64,
        y: f64,
    },
}
impl Draw {
    fn y(&self) -> f64 {
        match self {
            Self::Text { y, .. } | Self::Rule { y, .. } | Self::Logo { y, .. } => *y,
        }
    }
    fn bottom(&self) -> f64 {
        self.y()
            + match self {
                Self::Text { style, .. } => f64::from(style.font_size()) * 1.3,
                Self::Logo { .. } => 36.4,
                Self::Rule { .. } => 0.0,
            }
    }
    fn shift(&mut self, dx: f64, dy: f64) {
        let (x, y) = match self {
            Self::Text { x, y, .. } | Self::Rule { x, y, .. } | Self::Logo { x, y, .. } => (x, y),
        };
        *x += dx;
        *y += dy;
    }
}
#[derive(Clone, Default)]
struct Block {
    draws: Vec<Draw>,
    height: f64,
}
impl Block {
    fn text(&mut self, cache: &FontCache, x: f64, y: f64, value: &str, s: Style, right: bool) {
        let x = if right { x - width(cache, value, s) } else { x };
        self.draws.push(Draw::Text {
            x,
            y,
            value: value.into(),
            style: s,
        });
        self.height = self.height.max(y + f64::from(s.font_size()) * 1.3);
    }
    fn para(
        &mut self,
        cache: &FontCache,
        x: f64,
        y: f64,
        value: &str,
        s: Style,
        max: f64,
        right: bool,
    ) -> Result<f64, String> {
        let lines = wrap(cache, value, s, max)?;
        let leading = f64::from(s.font_size()) * 1.4;
        for (i, line) in lines.iter().enumerate() {
            self.text(cache, x, y + i as f64 * leading, line, s, right);
        }
        Ok(y + lines.len() as f64 * leading)
    }
    fn rule(&mut self, x: f64, y: f64, width: f64) {
        self.draws.push(Draw::Rule { x, y, width });
        self.height = self.height.max(y);
    }
    fn append(&mut self, mut block: Block, x: f64, y: f64) {
        self.height = self.height.max(y + block.height);
        for draw in &mut block.draws {
            draw.shift(x, y);
        }
        self.draws.extend(block.draws);
    }
    // Only oversized content is split, at a boundary that cannot cut through text or a logo.
    fn take(&mut self, available: f64) -> Block {
        let mut cut = available.min(self.height);
        loop {
            let next = self
                .draws
                .iter()
                .filter(|d| {
                    // Keep a heading with its first detail line across oversized-block splits.
                    let following = if matches!(d, Draw::Text {style,..} if style.is_bold()) {
                        18.0
                    } else {
                        0.0
                    };
                    d.y() < cut && d.bottom() + following > cut + 0.01
                })
                .map(Draw::y)
                .fold(cut, f64::min);
            if next == cut {
                break;
            }
            cut = next;
        }
        let mut prefix = Block {
            height: cut,
            ..Default::default()
        };
        let mut rest = Vec::new();
        for mut draw in self.draws.drain(..) {
            if draw.bottom() <= cut + 0.01 {
                prefix.draws.push(draw);
            } else {
                draw.shift(0.0, -cut);
                rest.push(draw);
            }
        }
        self.draws = rest;
        self.height -= cut;
        prefix
    }
}

fn first_header(cache: &FontCache, s: &Snapshot) -> Result<Block, String> {
    let mut b = Block::default();
    let name_end = b.para(
        cache,
        LEFT,
        43.0,
        &s.profile.name,
        style(18, true, 20),
        270.0,
        false,
    )?;
    let supplier = [
        if s.profile.abn.is_empty() {
            String::new()
        } else {
            format!("ABN: {}", s.profile.abn)
        },
        s.profile.address.clone(),
    ]
    .into_iter()
    .filter(|v| !v.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    let supplier_end = b.para(
        cache,
        LEFT,
        name_end + 7.0,
        &supplier,
        normal(),
        270.0,
        false,
    )?;
    let title_end = b.para(
        cache,
        RIGHT,
        33.0,
        &s.heading,
        style(32, true, 20),
        255.0,
        true,
    )?;
    let mut y = (title_end + 10.0).max(88.0);
    if s.number == "PREVIEW" {
        y = b.para(
            cache,
            RIGHT,
            y,
            "DRAFT PREVIEW - not issued",
            label(),
            210.0,
            true,
        )? + 8.0;
    }
    let mut details = vec![
        ("Invoice number", s.number.clone()),
        ("Invoice date", date(&s.draft.date)),
    ];
    if !s.draft.reference.is_empty() {
        details.push(("Reference / P.O.", s.draft.reference.clone()));
    }
    if let Some(due) = &s.due_date {
        details.push(("Due date", date(due)));
    }
    for (key, value) in details {
        b.text(cache, 351.0, y, key, style(9, false, 84), false);
        y = b.para(cache, RIGHT, y, &value, normal(), 118.0, true)? + 8.0;
    }
    let buyer_y = (supplier_end + 24.0).max(153.0);
    b.text(cache, LEFT, buyer_y, "BILL TO", label(), false);
    let mut end = b.para(
        cache,
        LEFT,
        buyer_y + 16.0,
        &s.customer.name,
        style(12, true, 20),
        270.0,
        false,
    )? + 3.0;
    for value in [
        if s.customer.attention.is_empty() {
            String::new()
        } else {
            format!("Attention: {}", s.customer.attention)
        },
        if s.customer.abn.is_empty() {
            String::new()
        } else {
            format!("ABN: {}", s.customer.abn)
        },
        s.customer.address.clone(),
    ]
    .into_iter()
    .filter(|v| !v.is_empty())
    {
        end = b.para(cache, LEFT, end, &value, normal(), 270.0, false)?;
    }
    b.height = (end + 18.0).max(y + 16.0).max(234.0);
    Ok(b)
}
fn continuation(cache: &FontCache, s: &Snapshot) -> Result<Block, String> {
    let mut b = Block::default();
    b.text(cache, LEFT, 34.0, &s.heading, style(19, true, 20), false);
    b.para(
        cache,
        RIGHT,
        38.0,
        &format!("{} / Continued", s.number),
        style(11, true, 20),
        270.0,
        true,
    )?;
    // Long party names already appear in full on the first page.
    b.height = 88.0;
    Ok(b)
}

fn table_header(cache: &FontCache, show_gst: bool) -> Block {
    let mut b = Block::default();
    b.text(cache, LEFT, 0.0, "Description", label(), false);
    for (x, value) in [
        (276.0, "Qty"),
        (359.0, "Unit ex GST"),
        (432.0, "Tax rate"),
        (492.0, "GST"),
        (RIGHT, "Total"),
    ] {
        if value == "GST" && !show_gst {
            continue;
        }
        b.text(cache, x, 0.0, value, label(), true);
    }
    b.rule(LEFT, 19.0, RIGHT - LEFT);
    b.height = 22.0;
    b
}
fn item_rows(cache: &FontCache, s: &Snapshot) -> Result<VecDeque<Block>, String> {
    let mut rows = VecDeque::new();
    for (line, total) in s.draft.lines.iter().zip(&s.totals.lines) {
        let mut b = Block::default();
        let description_end =
            b.para(cache, LEFT, 4.0, &line.description, normal(), 202.0, false)?;
        let tax = match line.tax {
            Tax::Taxable => "10%",
            Tax::GstFree => "GST-free",
            Tax::InputTaxed => "Input taxed",
            Tax::NoGst => "No GST",
        };
        for (x, max, value) in [
            (276.0, 38.0, line.quantity.clone()),
            (359.0, 73.0, format!("${}", line.unit_price)),
            (432.0, 63.0, tax.into()),
            (
                492.0,
                50.0,
                if s.profile.show_item_gst {
                    money(total.gst)
                } else {
                    String::new()
                },
            ),
            (RIGHT, 61.0, money(total.total)),
        ] {
            let mut text_style = normal();
            while text_style.font_size() > 7 && width(cache, &value, text_style) > max {
                text_style = text_style.with_font_size(text_style.font_size() - 1);
            }
            b.para(cache, x, 4.0, &value, text_style, max, true)?;
        }
        b.height = (b.height + 6.0).max(description_end + 6.0).max(24.0);
        b.rule(LEFT, b.height, RIGHT - LEFT);
        rows.push_back(b);
    }
    Ok(rows)
}

fn totals(cache: &FontCache, s: &Snapshot) -> Block {
    let mut b = Block::default();
    for (y, key, value) in [
        (12.0, "Subtotal", s.totals.net),
        (33.0, "Total GST", s.totals.gst),
    ] {
        b.text(cache, 352.0, y, key, style(10, false, 84), false);
        b.text(cache, RIGHT, y, &money(value), normal(), true);
    }
    b.rule(352.0, 58.0, 205.0);
    b.text(cache, 352.0, 69.0, "TOTAL AUD", style(10, true, 20), false);
    let amount = money(s.totals.total);
    let mut amount_style = style(19, true, 20);
    while width(cache, &amount, amount_style) > 135.0 {
        amount_style = amount_style.with_font_size(amount_style.font_size() - 1);
    }
    b.text(cache, RIGHT, 64.0, &amount, amount_style, true);
    if s.totals.gst == 0 {
        b.text(
            cache,
            RIGHT,
            94.0,
            "No GST charged",
            style(9, false, 84),
            true,
        );
    }
    b.height += 12.0;
    b
}
fn notes(cache: &FontCache, value: &str) -> Result<Block, String> {
    if value.is_empty() {
        return Ok(Block::default());
    }
    let mut b = Block::default();
    b.rule(LEFT, 0.0, RIGHT - LEFT);
    b.text(cache, LEFT, 12.0, "ADDITIONAL NOTES", label(), false);
    b.para(cache, LEFT, 30.0, value, normal(), RIGHT - LEFT, false)?;
    Ok(b)
}

fn payments(cache: &FontCache, s: &Snapshot) -> Result<Vec<Block>, String> {
    let mut columns = [Block::default(), Block::default(), Block::default()];
    for method in &s.profile.payment_methods {
        let (title, value) = method.display(&s.draft.bpay_reference);
        let mut b = Block::default();
        let title_end = b.para(cache, 0.0, 0.0, &title, style(11, true, 20), 154.0, false)?;
        let start = title_end + 8.0;
        match method {
            PaymentMethod::BankTransfer {
                account_name,
                bsb: _,
                account_number: _,
            } => {
                b.text(cache, 0.0, start, "Account name", normal(), false);
                let end = b.para(
                    cache,
                    0.0,
                    start + 14.0,
                    account_name,
                    normal(),
                    154.0,
                    false,
                )?;
                let rest = value
                    .lines()
                    .skip(1)
                    .collect::<Vec<_>>()
                    .join("\n")
                    .replace("Account number:", "Account:");
                b.para(cache, 0.0, end, &rest, normal(), 154.0, false)?;
            }
            PaymentMethod::Bpay { biller_code } => {
                b.draws.push(Draw::Logo { x: 0.0, y: start });
                let mut end = b.para(
                    cache,
                    34.0,
                    start,
                    &format!("Biller code: {biller_code}"),
                    style(9, true, 20),
                    120.0,
                    false,
                )?;
                end = b.para(
                    cache,
                    34.0,
                    end + 3.0,
                    "Ref:",
                    style(9, true, 20),
                    120.0,
                    false,
                )?;
                end = b.para(
                    cache,
                    34.0,
                    end,
                    &s.draft.bpay_reference,
                    style(9, true, 20),
                    120.0,
                    false,
                )?;
                b.para(cache,0.0,(start+36.4).max(end)+12.0,"Pay through your bank's internet or telephone banking using the biller code and reference above.",style(9,false,20),154.0,false)?;
            }
            _ => {
                b.para(cache, 0.0, start, &value, normal(), 154.0, false)?;
            }
        }
        let index = columns
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| a.height.total_cmp(&b.height))
            .unwrap()
            .0;
        let y = if columns[index].draws.is_empty() {
            0.0
        } else {
            columns[index].height + 18.0
        };
        columns[index].append(b, 0.0, y);
    }
    let capacity = BOTTOM - 88.0 - 38.0;
    let mut result = Vec::new();
    // Independent columns need independent break points; their text baselines need not align.
    while columns.iter().any(|column| !column.draws.is_empty()) {
        let mut page = Block::default();
        for (i, column) in columns.iter_mut().enumerate() {
            let chunk = if column.height > capacity {
                column.take(capacity)
            } else {
                std::mem::take(column)
            };
            if chunk.draws.is_empty() && !column.draws.is_empty() {
                return Err("Payment details cannot fit on a PDF page".into());
            }
            page.append(chunk, LEFT + i as f64 * 182.5, 0.0);
        }
        result.push(page);
    }
    if !s.profile.payment_details.is_empty() {
        let mut extra = Block::default();
        extra.para(
            cache,
            LEFT,
            0.0,
            &s.profile.payment_details,
            normal(),
            RIGHT - LEFT,
            false,
        )?;
        if let Some(last) = result
            .last_mut()
            .filter(|last| last.height + 16.0 + extra.height <= capacity)
        {
            let y = last.height + 16.0;
            last.append(extra, 0.0, y);
        } else {
            while extra.height > capacity {
                result.push(extra.take(capacity));
            }
            result.push(extra);
        }
    }
    Ok(result)
}

pub(crate) struct Pages {
    pages: VecDeque<Block>,
}
struct Planner<'a> {
    cache: &'a FontCache,
    snapshot: &'a Snapshot,
    pages: Vec<Block>,
    y: f64,
}
impl<'a> Planner<'a> {
    fn next(&mut self) -> Result<(), String> {
        let block = continuation(self.cache, self.snapshot)?;
        self.y = block.height;
        self.pages.push(block);
        if self.pages.len() > 300 {
            return Err("Invoice exceeds 300 PDF pages".into());
        }
        Ok(())
    }
    fn put(&mut self, block: Block) {
        let h = block.height;
        self.pages.last_mut().unwrap().append(block, 0.0, self.y);
        self.y += h;
    }
    fn flow(&mut self, mut block: Block, table: bool) -> Result<(), String> {
        let start = if table { 110.0 } else { 88.0 };
        if block.height <= BODY - start && self.y + block.height > BODY {
            self.next()?;
            if table {
                self.put(table_header(
                    self.cache,
                    self.snapshot.profile.show_item_gst,
                ));
            }
        }
        while self.y + block.height > BODY {
            let prefix = block.take(BODY - self.y);
            if prefix.height > 0.0 {
                self.put(prefix);
            }
            self.next()?;
            if table {
                self.put(table_header(
                    self.cache,
                    self.snapshot.profile.show_item_gst,
                ));
            }
        }
        self.put(block);
        Ok(())
    }
}
pub(crate) fn plan(cache: &FontCache, s: &Snapshot) -> Result<Pages, String> {
    let payment = payments(cache, s)?;
    let payment_height = match payment.as_slice() {
        [] => 0.0,
        [single] => single.height + 38.0,
        _ => BOTTOM,
    };
    let total = totals(cache, s);
    let note = notes(cache, &s.draft.notes)?;
    let mut p = Planner {
        cache,
        snapshot: s,
        pages: vec![Block::default()],
        y: 0.0,
    };
    p.flow(first_header(cache, s)?, false)?;
    let mut rows = item_rows(cache, s)?;
    if p.y + 22.0 + rows.front().map_or(0.0, |b| b.height.min(40.0)) > BODY {
        p.next()?;
    }
    p.put(table_header(cache, s.profile.show_item_gst));
    while let Some(row) = rows.pop_front() {
        p.flow(row, true)?;
    }
    let tail = total.height + note.height + payment_height + 12.0;
    if tail <= BOTTOM - 88.0 && p.y + tail > BOTTOM {
        p.next()?;
    }
    p.flow(total, false)?;
    p.flow(note, false)?;
    for chunk in payment {
        let top = BOTTOM - chunk.height - 38.0;
        if p.y > 88.0 && p.y + 12.0 > top {
            p.next()?;
        }
        let mut section = Block::default();
        section.rule(LEFT, 0.0, RIGHT - LEFT);
        section.text(cache, LEFT, 14.0, "PAYMENT DETAILS", label(), false);
        section.append(chunk, 0.0, 38.0);
        p.pages.last_mut().unwrap().append(section, 0.0, top);
        p.y = BOTTOM;
    }
    let count = p.pages.len();
    for (i, page) in p.pages.iter_mut().enumerate() {
        page.rule(LEFT, 793.0, RIGHT - LEFT);
        page.text(
            cache,
            RIGHT,
            803.0,
            &format!("{} · {} of {count}", s.number, i + 1),
            style(8, false, 84),
            true,
        );
        if i + 1 < count {
            let payment_page = page
                .draws
                .iter()
                .any(|d| matches!(d,Draw::Text {value,..} if value=="PAYMENT DETAILS"));
            page.text(
                cache,
                if payment_page { LEFT } else { RIGHT },
                if payment_page { 803.0 } else { 764.0 },
                &format!("Continued on page {}", i + 2),
                style(9, false, 84),
                !payment_page,
            );
        }
    }
    Ok(Pages {
        pages: p.pages.into(),
    })
}
impl Element for Pages {
    fn render(
        &mut self,
        context: &genpdf::Context,
        area: genpdf::render::Area<'_>,
        _: Style,
    ) -> Result<genpdf::RenderResult, genpdf::error::Error> {
        let page = self.pages.pop_front().expect("Planned PDF page");
        for draw in page.draws {
            match draw {
                Draw::Text { x, y, value, style } => {
                    let font = context
                        .font_cache
                        .get_rt_font(style.font(&context.font_cache));
                    let descent = f64::from(font.v_metrics_unscaled().descent)
                        / f64::from(font.units_per_em())
                        * f64::from(style.font_size());
                    if !area.print_str(
                        &context.font_cache,
                        genpdf::Position::new(x * MM, (y + descent) * MM),
                        style,
                        &value,
                    )? {
                        return Err(genpdf::error::Error::new(
                            "Text exceeded the PDF page",
                            genpdf::error::ErrorKind::InvalidData,
                        ));
                    }
                }
                Draw::Rule { x, y, width } => area.draw_line(
                    vec![
                        genpdf::Position::new(x * MM, y * MM),
                        genpdf::Position::new((x + width) * MM, y * MM),
                    ],
                    style(1, false, 194),
                ),
                Draw::Logo { x, y } => {
                    let mut image = genpdf::elements::Image::from_reader(std::io::Cursor::new(
                        include_bytes!("../assets/bpay-mono.png"),
                    ))?
                    .with_dpi(1140.48);
                    let mut target = area.clone();
                    target.add_offset(genpdf::Position::new(x * MM, y * MM));
                    image.render(context, target, normal())?;
                }
            }
        }
        Ok(genpdf::RenderResult {
            size: area.size(),
            has_more: !self.pages.is_empty(),
        })
    }
}
