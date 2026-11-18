use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub name: String,
    pub abn: String,
    pub address: String,
    pub payment_details: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub payment_methods: Vec<PaymentMethod>,
    pub gst_registered: bool,
    pub show_item_gst: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Customer {
    pub id: String,
    pub code: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub attention: String,
    pub abn: String,
    pub address: String,
    pub next_number: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Tax {
    Taxable,
    GstFree,
    InputTaxed,
    NoGst,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceRef {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Line {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<ServiceRef>,
    pub description: String,
    pub quantity: String,
    pub unit_price: String,
    pub tax: Tax,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Service {
    pub id: String,
    pub name: String,
    pub description: String,
    pub unit_price: String,
    pub tax: Tax,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub id: String,
    pub customer_id: String,
    pub date: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub reference: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub bpay_reference: String,
    #[serde(default, skip_serializing_if = "DueDate::is_none")]
    pub due: DueDate,
    pub notes: String,
    pub lines: Vec<Line>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaymentMethod {
    BankTransfer {
        account_name: String,
        bsb: String,
        account_number: String,
    },
    PayId {
        pay_id_type: PayIdType,
        value: String,
        recipient_name: String,
    },
    Bpay {
        biller_code: String,
    },
    Custom {
        label: String,
        value: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PayIdType {
    Email,
    Mobile,
    Abn,
    OrganisationId,
}

impl PaymentMethod {
    pub fn display(&self, reference: &str) -> (String, String) {
        match self {
            Self::BankTransfer {
                account_name,
                bsb,
                account_number,
            } => {
                let bsb = bsb.replace('-', "");
                let formatted = if bsb.len() == 6 && bsb.is_ascii() {
                    format!("{}-{}", &bsb[..3], &bsb[3..])
                } else {
                    bsb
                };
                ("Bank transfer".into(), format!("Account name: {account_name}\nBSB: {formatted}\nAccount number: {account_number}"))
            }
            Self::PayId {
                value,
                recipient_name,
                ..
            } => (
                "PayID".into(),
                if recipient_name.is_empty() {
                    value.clone()
                } else {
                    format!("{value}\nName: {recipient_name}")
                },
            ),
            Self::Bpay { biller_code } => (
                "BPAY".into(),
                format!("Biller code: {biller_code}\nRef: {reference}"),
            ),
            Self::Custom { label, value } => (label.clone(), value.clone()),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum DueDate {
    #[default]
    None,
    Exact {
        date: String,
    },
    Relative {
        amount: u32,
        unit: DueUnit,
    },
}

impl DueDate {
    fn is_none(&self) -> bool {
        matches!(self, Self::None)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DueUnit {
    Days,
    Months,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineTotal {
    pub net: u64,
    pub gst: u64,
    pub total: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Totals {
    pub lines: Vec<LineTotal>,
    pub net: u64,
    pub gst: u64,
    pub total: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub template_version: u8,
    pub number: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    pub profile: Profile,
    pub customer: Customer,
    pub draft: Draft,
    pub heading: String,
    pub totals: Totals,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Issued {
    pub id: String,
    pub snapshot: Snapshot,
    #[serde(skip)]
    pub pdf: Vec<u8>,
    pub paid: bool,
    #[serde(default)]
    pub void_reason: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dataset {
    pub profile: Option<Profile>,
    pub customers: Vec<Customer>,
    pub drafts: Vec<Draft>,
    pub issued: Vec<Issued>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub services: Vec<Service>,
}
