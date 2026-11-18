use invoice_lib::{db::Store, model::*};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
pub struct Fixture {
    pub profile: Profile,
    pub customer: Customer,
    pub draft: Draft,
}
pub fn fixture() -> Fixture {
    serde_json::from_str(include_str!("../../../tests/fixtures/invoices.json")).unwrap()
}
pub fn setup(path: &Path) -> Store {
    let f = fixture();
    let mut store = Store::open(path).unwrap();
    store.save_profile(f.profile).unwrap();
    store.save_customer(f.customer).unwrap();
    store.save_draft(f.draft).unwrap();
    store
}
