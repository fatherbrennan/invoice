pub(crate) fn abn(value: &str) -> String {
    if value.len() == 11 && value.bytes().all(|c| c.is_ascii_digit()) {
        format!(
            "{} {} {} {}",
            &value[..2],
            &value[2..5],
            &value[5..8],
            &value[8..]
        )
    } else {
        value.into()
    }
}

pub(crate) fn mobile(value: &str) -> String {
    if value.len() == 10 && value.starts_with("04") && value.bytes().all(|c| c.is_ascii_digit()) {
        format!("{} {} {}", &value[..4], &value[4..7], &value[7..])
    } else if value.len() == 12
        && value.starts_with("+614")
        && value[1..].bytes().all(|c| c.is_ascii_digit())
    {
        format!("+61 {} {} {}", &value[3..6], &value[6..9], &value[9..])
    } else {
        value.into()
    }
}

impl crate::model::Profile {
    pub(crate) fn normalize_identifiers(&mut self) {
        for method in &mut self.payment_methods {
            if let crate::model::PaymentMethod::BankTransfer { bsb, .. } = method {
                *bsb = bsb.replace('-', "");
            }
        }
    }
}
