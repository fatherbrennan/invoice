use crate::model::{
    Customer, Draft, DueDate, DueUnit, Line, LineTotal, PayIdType, PaymentMethod, Profile,
    Snapshot, Tax, Totals,
};

const MAX_TOTAL: u64 = 10_000_000_000;

fn text(
    value: &str,
    label: &str,
    max: usize,
    required: bool,
    multiline: bool,
) -> Result<(), String> {
    if required && value.trim().is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.chars().count() > max {
        return Err(format!("{label} exceeds {max} characters"));
    }
    if value
        .chars()
        .any(|c| c.is_control() && !(multiline && matches!(c, '\n' | '\r' | '\t')))
    {
        return Err(format!("{label} contains unsupported control characters"));
    }
    Ok(())
}

fn id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err(format!(
            "{label} must contain 1-64 ASCII letters, digits or hyphens"
        ));
    }
    Ok(())
}

pub fn validate_id(value: &str) -> Result<(), String> {
    id(value, "ID")
}

pub fn validate_service(service: &crate::model::Service) -> Result<(), String> {
    id(&service.id, "Service ID")?;
    text(&service.name, "Service name", 200, true, false)?;
    text(
        &service.description,
        "Service description",
        2000,
        true,
        true,
    )?;
    decimal(&service.unit_price, 2, 100_000_000, "Unit price")?;
    Ok(())
}

fn abn(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    if value.len() != 11 || !value.bytes().all(|c| c.is_ascii_digit()) {
        return Err("ABN must contain 11 digits".into());
    }
    let weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    let sum: i32 = value
        .bytes()
        .enumerate()
        .map(|(i, c)| (i32::from(c - b'0') - if i == 0 { 1 } else { 0 }) * weights[i])
        .sum();
    if sum % 89 != 0 {
        return Err("ABN checksum is invalid".into());
    }
    Ok(())
}

fn digits(value: &str, label: &str, min: usize, max: usize) -> Result<(), String> {
    if !(min..=max).contains(&value.len()) || !value.bytes().all(|c| c.is_ascii_digit()) {
        return Err(format!("{label} must contain {min}-{max} digits"));
    }
    Ok(())
}

pub fn validate_profile(profile: &Profile) -> Result<(), String> {
    text(&profile.name, "Business name", 200, true, false)?;
    text(&profile.address, "Business address", 1_000, true, true)?;
    text(
        &profile.payment_details,
        "Payment details",
        4_000,
        false,
        true,
    )?;
    abn(&profile.abn)?;
    if profile.payment_methods.len() > 10 {
        return Err("Use at most 10 payment methods".into());
    }
    if profile
        .payment_methods
        .iter()
        .filter(|m| matches!(m, PaymentMethod::Bpay { .. }))
        .count()
        > 1
    {
        return Err("Use one BPAY biller per business profile".into());
    }
    for method in &profile.payment_methods {
        match method {
            PaymentMethod::BankTransfer {
                account_name,
                bsb,
                account_number,
            } => {
                text(account_name, "Account name", 100, true, false)?;
                if !(bsb.len() == 6 || (bsb.len() == 7 && bsb.as_bytes()[3] == b'-')) {
                    return Err("Enter a six-digit BSB, with or without a hyphen".into());
                }
                digits(&bsb.replace('-', ""), "BSB", 6, 6)?;
                digits(account_number, "Account number", 1, 10)?;
            }
            PaymentMethod::PayId {
                pay_id_type,
                value,
                recipient_name,
            } => {
                text(recipient_name, "Recipient name", 100, false, false)?;
                text(value, "PayID", 256, true, false)?;
                match pay_id_type {
                    PayIdType::Email => {
                        let valid = value.split_once('@').is_some_and(|(local, domain)| {
                            !local.is_empty()
                                && !domain.contains('@')
                                && domain
                                    .split_once('.')
                                    .is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())
                        });
                        if !valid || value.chars().any(char::is_whitespace) {
                            return Err("Enter a valid PayID email address".into());
                        }
                    }
                    PayIdType::Mobile => {
                        let suffix = value
                            .strip_prefix("04")
                            .or_else(|| value.strip_prefix("+614"))
                            .ok_or("Use an Australian mobile PayID starting with 04 or +614")?;
                        digits(suffix, "PayID mobile suffix", 8, 8)?;
                    }
                    PayIdType::Abn => abn(value)?,
                    PayIdType::OrganisationId => {}
                }
            }
            PaymentMethod::Bpay { biller_code } => digits(biller_code, "BPAY biller code", 1, 10)?,
            PaymentMethod::Custom { label, value } => {
                text(label, "Payment method", 100, true, false)?;
                text(value, "Payment method details", 1_000, true, true)?;
            }
        }
    }
    if profile.gst_registered && profile.abn.is_empty() {
        return Err("A GST-registered business requires an ABN".into());
    }
    Ok(())
}

pub fn validate_customer(customer: &Customer) -> Result<(), String> {
    id(&customer.id, "Customer ID")?;
    if customer.code.is_empty()
        || customer.code.len() > 12
        || !customer.code.bytes().all(|c| c.is_ascii_uppercase())
    {
        return Err("Customer code must contain 1-12 uppercase ASCII letters".into());
    }
    text(&customer.name, "Customer name", 200, false, false)?;
    text(&customer.attention, "Attention", 200, false, false)?;
    text(&customer.address, "Customer address", 1_000, false, true)?;
    abn(&customer.abn)?;
    if customer.name.trim().is_empty() && customer.abn.is_empty() {
        return Err("Customer name or ABN is required".into());
    }
    if customer.next_number == 0 {
        return Err("Customer invoice increment must be positive".into());
    }
    Ok(())
}

pub(crate) fn date(value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7) || c.is_ascii_digit())
    {
        return Err("Invoice date must be YYYY-MM-DD".into());
    }
    let year: u32 = value[0..4].parse().map_err(|_| "Invalid invoice year")?;
    let month: usize = value[5..7].parse().map_err(|_| "Invalid invoice month")?;
    let day: u32 = value[8..10].parse().map_err(|_| "Invalid invoice day")?;
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(1900..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day == 0
        || day > days[month - 1]
    {
        return Err("Invoice date must be a real Gregorian date between 1900 and 9999".into());
    }
    Ok(())
}

fn month_days(year: u32, month: u32) -> u32 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) => {
            29
        }
        2 => 28,
        _ => 31,
    }
}

pub fn due_date(invoice_date: &str, due: &DueDate) -> Result<Option<String>, String> {
    date(invoice_date)?;
    match due {
        DueDate::None => Ok(None),
        DueDate::Exact { date: value } => {
            date(value).map_err(|e| e.replace("Invoice date", "Due date"))?;
            Ok(Some(value.clone()))
        }
        DueDate::Relative { amount, unit } => {
            if *amount > 9999 {
                return Err("Due date offset must be between 0 and 9999".into());
            }
            let mut year: u32 = invoice_date[..4].parse().unwrap();
            let mut month: u32 = invoice_date[5..7].parse().unwrap();
            let mut day: u32 = invoice_date[8..].parse().unwrap();
            match unit {
                DueUnit::Months => {
                    let months = year * 12 + month - 1 + amount;
                    year = months / 12;
                    month = months % 12 + 1;
                    day = day.min(month_days(year, month));
                }
                DueUnit::Days => {
                    let mut remaining = *amount;
                    while remaining > month_days(year, month) - day {
                        remaining -= month_days(year, month) - day + 1;
                        day = 1;
                        if month == 12 {
                            year += 1;
                            month = 1;
                        } else {
                            month += 1;
                        }
                    }
                    day += remaining;
                }
            }
            if year > 9999 {
                return Err("Due date exceeds year 9999".into());
            }
            Ok(Some(format!("{year:04}-{month:02}-{day:02}")))
        }
    }
}

pub(crate) fn decimal(value: &str, precision: u32, max: u64, label: &str) -> Result<u64, String> {
    let invalid =
        || format!("{label} must be a nonnegative decimal with at most {precision} decimal places");
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || !whole.bytes().all(|c| c.is_ascii_digit())
        || (value.contains('.') && fraction.is_empty())
        || fraction.len() > precision as usize
        || !fraction.bytes().all(|c| c.is_ascii_digit())
    {
        return Err(invalid());
    }
    let scale = 10_u64.pow(precision);
    let whole: u64 = whole.parse().map_err(|_| invalid())?;
    let fraction: u64 = if fraction.is_empty() {
        0
    } else {
        fraction.parse::<u64>().map_err(|_| invalid())?
            * 10_u64.pow(precision - fraction.len() as u32)
    };
    let scaled = whole
        .checked_mul(scale)
        .and_then(|n| n.checked_add(fraction))
        .ok_or_else(invalid)?;
    if scaled > max {
        return Err(format!("{label} exceeds the supported limit"));
    }
    Ok(scaled)
}

fn line_totals(lines: &[Line]) -> Result<Totals, String> {
    if !(1..=200).contains(&lines.len()) {
        return Err("An invoice requires 1-200 lines".into());
    }
    let mut totals = Totals {
        lines: Vec::with_capacity(lines.len()),
        net: 0,
        gst: 0,
        total: 0,
    };
    for line in lines {
        text(&line.description, "Line description", 2_000, true, true)?;
        let quantity = decimal(&line.quantity, 3, 10_000_000, "Quantity")?;
        if quantity == 0 {
            return Err("Quantity must be positive".into());
        }
        let price = decimal(&line.unit_price, 2, 100_000_000, "Unit price")?;
        let net = (price * quantity + 500) / 1_000;
        let gst = if line.tax == Tax::Taxable {
            (net + 5) / 10
        } else {
            0
        };
        let total = net + gst;
        totals.net += net;
        totals.gst += gst;
        totals.total += total;
        if totals.total > MAX_TOTAL {
            return Err("Invoice total exceeds AUD 100,000,000".into());
        }
        totals.lines.push(LineTotal { net, gst, total });
    }
    Ok(totals)
}

// Drafts preserve unfinished inputs; preview and issue still require validate_draft.
pub fn validate_saved_draft(draft: &Draft) -> Result<(), String> {
    id(&draft.id, "Draft ID")?;
    if !draft.customer_id.is_empty() {
        id(&draft.customer_id, "Customer ID")?;
    }
    if !draft.date.is_empty() {
        date(&draft.date)?;
    }
    if !matches!(&draft.due, DueDate::Exact { date } if date.is_empty()) {
        due_date(
            if draft.date.is_empty() {
                "2000-01-01"
            } else {
                &draft.date
            },
            &draft.due,
        )?;
    }
    text(&draft.reference, "Reference/P.O.", 200, false, false)?;
    text(&draft.bpay_reference, "BPAY reference", 20, false, false)?;
    text(&draft.notes, "Invoice notes", 4_000, false, true)?;
    if draft.lines.len() > 200 {
        return Err("Use at most 200 items".into());
    }
    for line in &draft.lines {
        text(&line.description, "Description", 2_000, false, true)?;
        text(&line.quantity, "Quantity", 32, false, false)?;
        text(&line.unit_price, "Unit price", 32, false, false)?;
        if !line.quantity.is_empty() && decimal(&line.quantity, 3, 10_000_000, "Quantity")? == 0 {
            return Err("Quantity must be positive".into());
        }
        if !line.unit_price.is_empty() {
            decimal(&line.unit_price, 2, 100_000_000, "Unit price")?;
        }
        if let Some(service) = &line.service {
            id(&service.id, "Service ID")?;
            text(&service.name, "Service name", 200, true, false)?;
        }
    }
    if !draft.lines.is_empty()
        && draft.lines.iter().all(|line| {
            !line.description.trim().is_empty()
                && !line.quantity.is_empty()
                && !line.unit_price.is_empty()
        })
    {
        line_totals(&draft.lines)?;
    }
    Ok(())
}

pub fn validate_draft(draft: &Draft) -> Result<(), String> {
    id(&draft.id, "Draft ID")?;
    id(&draft.customer_id, "Customer ID")?;
    date(&draft.date)?;
    due_date(&draft.date, &draft.due)?;
    text(&draft.reference, "Reference/P.O.", 200, false, false)?;
    if !draft.bpay_reference.is_empty() {
        digits(&draft.bpay_reference, "BPAY reference", 2, 20)?;
    }
    text(&draft.notes, "Invoice notes", 4_000, false, true)?;
    for line in &draft.lines {
        if let Some(service) = &line.service {
            validate_service(&crate::model::Service {
                id: service.id.clone(),
                name: service.name.clone(),
                description: line.description.clone(),
                unit_price: line.unit_price.clone(),
                tax: line.tax.clone(),
            })?;
        }
    }
    line_totals(&draft.lines)?;
    Ok(())
}

pub fn calculate(lines: &[Line], profile: &Profile) -> Result<Totals, String> {
    validate_profile(profile)?;
    for line in lines {
        if profile.gst_registered == (line.tax == Tax::NoGst) {
            return Err(if profile.gst_registered {
                "A GST-registered business must classify each line as taxable, GST-free or input taxed"
            } else {
                "A business not registered for GST must use No GST for every line"
            }.into());
        }
    }
    line_totals(lines)
}

pub fn snapshot(
    profile: &Profile,
    customer: &Customer,
    draft: &Draft,
    number: &str,
) -> Result<Snapshot, String> {
    validate_profile(profile)?;
    validate_customer(customer)?;
    validate_draft(draft)?;
    if profile
        .payment_methods
        .iter()
        .any(|m| matches!(m, PaymentMethod::Bpay { .. }))
    {
        digits(&draft.bpay_reference, "BPAY reference", 2, 20)?;
    } else if !draft.bpay_reference.is_empty() {
        return Err("Remove the BPAY reference or enable BPAY in the business profile".into());
    }
    if draft.customer_id != customer.id {
        return Err("Draft customer does not match the invoice customer".into());
    }
    if number != "PREVIEW" {
        let prefix = format!("I{}", customer.code);
        let suffix = number
            .strip_prefix(&prefix)
            .ok_or("Invoice number does not match the customer code")?;
        let increment = suffix
            .parse::<u32>()
            .map_err(|_| "Invoice number requires a positive integer increment")?;
        if increment == 0 || suffix != increment.to_string() {
            return Err(
                "Invoice number requires a positive integer increment without leading zeroes"
                    .into(),
            );
        }
        if increment != customer.next_number {
            return Err("Invoice number does not match the snapshotted customer increment".into());
        }
    }
    let totals = calculate(&draft.lines, profile)?;
    let heading =
        if profile.gst_registered && draft.lines.iter().any(|line| line.tax == Tax::Taxable) {
            "TAX INVOICE"
        } else {
            "INVOICE"
        };
    Ok(Snapshot {
        template_version: 2,
        number: number.into(),
        due_date: due_date(&draft.date, &draft.due)?,
        profile: profile.clone(),
        customer: customer.clone(),
        draft: draft.clone(),
        heading: heading.into(),
        totals,
    })
}
